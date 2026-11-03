//@ts-check
"use strict";

// perf.mjs — module load measurement (the extension core).
//
// The browser does not tell an extension how much CPU or memory it uses, let alone
// an individual module: all modules run in a shared context (content scripts
// moreover on the page's main thread, where every millisecond delays rendering).
// So the core measures by itself what can be measured from inside JavaScript:
//
//   - Callbacks — DOM event handlers (EventTarget.addEventListener),
//     timers (setTimeout, setInterval, requestAnimationFrame,
//     requestIdleCallback), observers (MutationObserver, ResizeObserver,
//     IntersectionObserver, PerformanceObserver) and chrome.* events
//     (chrome.tabs.onUpdated, chrome.runtime.onMessage, …). The hooks
//     (installPerfHooks()) wrap a callback when it is registered and the wrapper measures how
//     long the callback ran synchronously — self time, without nested measured
//     callbacks. Who the callback belongs to is recognized by the call stack at
//     registration: the first frame from the modules/<name>/ folder is the module, otherwise the core
//     (PERF_CORE).
//   - Phases started by the core — importing the module file, creating the element,
//     init(), pageInit(), setup() of the background part, … (measurePerf()).
//   - api.* calls (instrumentModuleApi()): count, time waiting for the result and
//     errors — and the module code that runs right after await on the result (an estimate, see
//     wrapApiMethod()).
//   - On web pages, long frames (Long Animation Frames in Chrome,
//     otherwise long tasks) and how much of them falls on module callbacks.
//
// What is not measured: code after await on anything other than api.* (fetch, chrome.*
// directly, import()), the modules' MAIN-world scripts (they run in the page's world, without
// chrome.*), handlers assigned by a property (element.onclick = …), port messages
// (runtime.connect), browser work outside JS (rendering injected CSS,
// declarativeNetRequest rules, writes to IndexedDB) and memory — that is shared by
// all modules of one context.
//
// The hooks are always installed (base.mjs turns them on right when it loads,
// before module code runs), but measuring happens only with the switch on
// (PERF_STATE_KEY in chrome.storage.local, a module turns it on through
// api.perf.setEnabled()). With the measurement off, callbacks are not wrapped at all —
// except those registered before the switch could be read (typically
// listeners of background parts at startup); they cost only a check of one
// variable per call. So turning it on takes effect for callbacks registered after
// it: fully on pages loaded after it was turned on, only partially on pages already open.
//
// Measured values are summed in memory in each context (page, background, popup, …)
// and after FLUSH_DELAY_MS sent to background.js (PERF_REPORT_MESSAGE),
// which merges them (mergePerfReport()) and stores them in its own IndexedDB
// (PERF_DB_NAME) — not in chrome.storage, every change of which is broadcast to all
// content scripts in all tabs, so the measurement itself would load the pages.
//
// When merging, a module's values are also credited to the activation mode the
// module currently has set (Settings → Module activation mode) — so it is possible
// to compare how a mode change affects the load. The measurement time and loaded pages
// are counted per mode too (average per page, per hour), see advancePerfModes().

// The measurement switch in chrome.storage.local: { owner, defaultMode?, since }
// (Types.PerfSwitch); without it nothing is measured. owner is the module that turned the measurement on —
// background.js deletes the switch when that module disappears from the module list or
// is turned off (the same as api.networkRules rules).
export const PERF_STATE_KEY = "perfMeasurement";

// Messages to background.js: measured values of one context, the overview for display
// (only extension pages — it contains visited domains) and a reset.
export const PERF_REPORT_MESSAGE = "SDK_PERF_REPORT";
export const PERF_GET_MESSAGE = "SDK_PERF_GET";
export const PERF_RESET_MESSAGE = "SDK_PERF_RESET";

// The "module" core code belongs to (base.mjs, background.js, extension
// pages, floating window) — a name no module folder can have.
export const PERF_CORE = "@core";

// A module activation mode the user has not set — the module's default mode
// applies, but background.js does not know it (only an extension page has the module
// registry, see resolvePerfModes()). The mode key of a module with multiple
// instances is the list of its instances' modes separated by PERF_MODE_SEPARATOR.
export const PERF_DEFAULT_MODE = "@default";
export const PERF_MODE_SEPARATOR = ",";

// Where the code runs: page = a content script in a web page, background =
// background.js, extension = another extension page (e.g. a module page).
/** @type {Enums.PerfContext[]} */
export const PERF_CONTEXTS = ["page", "background", "popup", "sidebar", "floating", "options", "onboarding", "extension"];

// Thresholds for the counters: a callback longer than a frame at 60 Hz delays
// rendering, one longer than 50 ms is a long task (Long Tasks API).
export const PERF_FRAME_MS = 16;
export const PERF_LONG_MS = 50;

// Own database of measured values (background.js only).
export const PERF_DB_NAME = "ExtensionPerformance";
const PERF_DB_VERSION = 1;
const PERF_DB_STORE = "stats";
const PERF_DB_KEY = "current";

// How long after the first unreported measurement the values are sent — it batches
// messages (not one per callback) and a popup, which lives a few seconds, manages
// to report its rendering too.
const FLUSH_DELAY_MS = 2000;

// Page callbacks that are paired with long frames (the browser reports those
// with a delay): at most the last INTERVAL_CAPACITY.
const INTERVAL_CAPACITY = 512;

// Size safeguards: different kinds of callbacks (kind = event, timer, …)
// of one module in one context, unreported keys in one context,
// domains in the overview and the length of names (module, kind, domain).
const MAX_KINDS = 100;
const MAX_PENDING_KEYS = 2000;
export const PERF_MAX_DOMAINS = 300;
const MAX_NAME_LENGTH = 120;
const MAX_REPORT_ITEMS = 5000;
const TOP_DOMAINS = 20;
// The kind everything over MAX_KINDS is summed into.
export const PERF_OTHER_KIND = "other";

// Hooks only once per global object (even if perf.mjs got loaded twice).
const HOOKS_FLAG = Symbol.for("analyticExtension.perfHooks");

// Extension pages by path. Firefox runs the background script in a
// generated page, Chrome as a service worker (see detectPerfContext()).
/** @type {Record<string, Enums.PerfContext>} */
const PAGE_CONTEXTS = {
	"/popup.html": "popup",
	"/sidebar.html": "sidebar",
	"/floating.html": "floating",
	"/options.html": "options",
	"/onboarding.html": "onboarding",
	"/_generated_background_page.html": "background",
};

// Timers: global function → callback kind.
/** @type {[string, string][]} */
const TIMERS = [
	["setTimeout", "timeout"],
	["setInterval", "interval"],
	["requestAnimationFrame", "animationFrame"],
	["requestIdleCallback", "idleCallback"],
];

// Observers whose callback is measured (kind "observer:<name>").
const OBSERVERS = ["MutationObserver", "ResizeObserver", "IntersectionObserver", "PerformanceObserver"];

// chrome.* namespaces whose events (on…) are measured. A namespace
// that appears only after an optional permission is granted is wrapped after
// chrome.permissions.onAdded.
const CHROME_EVENT_NAMESPACES = [
	"action",
	"alarms",
	"bookmarks",
	"browserAction",
	"commands",
	"contextMenus",
	"cookies",
	"downloads",
	"history",
	"idle",
	"management",
	"menus",
	"notifications",
	"omnibox",
	"permissions",
	"runtime",
	"sessions",
	"storage",
	"tabGroups",
	"tabs",
	"webNavigation",
	"webRequest",
	"windows",
];

// Measurement state in this context (one per realm). enabled: null = the switch
// has not been read yet — measuring in advance, and after reading the values are either
// sent or discarded.
/** @type {Types.PerfCollector} */
const collector = createCollector();

/** @type {Functions.Perf.createCollector} */
function createCollector() {
	return {
		global: null,
		context: null,
		enabled: null,
		switchVersion: 0,
		baseUrl: "",
		now: () => Date.now(),
		setTimeout: null,
		clearTimeout: null,
		queueMicrotask: (task) => {
			Promise.resolve().then(task);
		},
		pending: new Map(),
		pendingApi: new Map(),
		page: null,
		intervals: [],
		intervalNext: 0,
		stack: [],
		flushTimer: null,
		sink: null,
		NativePerformanceObserver: null,
		longFrameObserver: null,
		nativeAddEventListener: null,
		nativeAddListener: new WeakMap(),
	};
}

// --------------------------------------------------------------------
// Context and installing the hooks
// --------------------------------------------------------------------

// Where the code runs — by the address of the global object: an extension page by
// path (PAGE_CONTEXTS), service worker = background, a foreign address = a content
// script in a web page. Without chrome.runtime (Node, the page's main world)
// null — nothing is measured there.
/** @type {Functions.Perf.detectPerfContext} */
export function detectPerfContext(global = globalThis) {
	try {
		const runtime = global.chrome && global.chrome.runtime;
		if (!runtime || typeof runtime.getURL !== "function") return null;
		const href = global.location ? String(global.location.href) : "";
		if (!href) return null;
		const base = runtime.getURL("");
		if (!href.startsWith(base)) return "page";
		const Sw = /** @type {{ ServiceWorkerGlobalScope?: Function }} */ (/** @type {unknown} */ (global)).ServiceWorkerGlobalScope;
		if (typeof Sw === "function" && global instanceof Sw) return "background";
		// Path from the extension root, without the query and the fragment.
		const path = `/${href.slice(base.length).split(/[?#]/)[0]}`;
		return PAGE_CONTEXTS[path] || "extension";
	} catch {
		return null;
	}
}

// Installs the hooks into the global object (once) and starts watching the measurement
// switch. Returns true when the hooks were installed. context and baseUrl only for
// tests (otherwise from detectPerfContext() and chrome.runtime.getURL("")).
/** @type {Functions.Perf.installPerfHooks} */
export function installPerfHooks({ global = globalThis, context, baseUrl } = {}) {
	const flags = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (global));
	if (!global || flags[HOOKS_FLAG]) return false;
	const ctx = context || detectPerfContext(global);
	if (!ctx) return false;
	flags[HOOKS_FLAG] = true;

	Object.assign(collector, createCollector());
	collector.global = global;
	collector.context = ctx;
	try {
		collector.baseUrl = baseUrl ?? global.chrome.runtime.getURL("");
	} catch {
		collector.baseUrl = "";
	}
	const perf = global.performance;
	if (perf && typeof perf.now === "function") {
		collector.now = () => perf.now();
	}
	// The measurement's own timers — the original functions, captured before the hooks
	// wrap them (otherwise the collecting and reporting itself would be measured too).
	if (typeof global.setTimeout === "function" && typeof global.clearTimeout === "function") {
		const nativeSetTimeout = global.setTimeout;
		const nativeClearTimeout = global.clearTimeout;
		collector.setTimeout = (task, ms) => Reflect.apply(nativeSetTimeout, undefined, [task, ms]);
		collector.clearTimeout = (id) => Reflect.apply(nativeClearTimeout, undefined, [id]);
	}
	if (typeof global.queueMicrotask === "function") {
		const nativeQueueMicrotask = global.queueMicrotask;
		collector.queueMicrotask = (task) => Reflect.apply(nativeQueueMicrotask, undefined, [task]);
	}
	if (ctx === "page") {
		collector.page = { newDocument: true, longFrames: emptyLongFrames(), overlap: new Map() };
	}

	for (const patch of [patchEventTarget, patchTimers, patchObservers]) {
		try {
			patch(global);
		} catch (err) {
			console.error("Měření zátěže: háček se nepodařilo nainstalovat:", err);
		}
	}
	patchChromeEvents(global.chrome);
	watchSwitch(global);

	// Report before leaving the page (the popup is closing, the page changes) —
	// unreliable, the message may not get sent in time, but nothing more can be done. On
	// window, not on the global object: in a Firefox content script the global
	// object is a sandbox, which is not an EventTarget.
	const nativeAdd = collector.nativeAddEventListener;
	const win = global.window && typeof global.window === "object" ? global.window : null;
	if (ctx !== "background" && nativeAdd && win) {
		try {
			nativeAdd.call(win, "pagehide", () => flushPerf());
			if (global.document) {
				nativeAdd.call(global.document, "visibilitychange", () => {
					if (global.document.visibilityState === "hidden") flushPerf();
				});
			}
		} catch {
			// Without the report on leaving it is only delayed by FLUSH_DELAY_MS.
		}
	}

	// Namespaces that appear after an optional permission is granted
	// (chrome.bookmarks, chrome.webRequest, …).
	const permissionsAdded = global.chrome && global.chrome.permissions && global.chrome.permissions.onAdded;
	if (permissionsAdded) {
		rawAddChromeListener(/** @type {Types.PerfChromeEvent} */ (/** @type {unknown} */ (permissionsAdded)), () => patchChromeEvents(global.chrome));
	}
	return true;
}

// background.js: merges the measured values of its own context directly, without
// a message (the background does not send messages to itself).
/** @type {Functions.Perf.setPerfSink} */
export function setPerfSink(sink) {
	collector.sink = sink;
}

// Timers the hooks do not wrap — for the core's work with the measurement (saving
// measured values in background.js), which should not be measured itself.
/** @type {Functions.Perf.perfTimeout} */
export function perfTimeout(task, ms) {
	if (collector.setTimeout) return collector.setTimeout(task, ms);
	return setTimeout(task, ms);
}

// --------------------------------------------------------------------
// Attribution to a module
// --------------------------------------------------------------------

// Module name by the call stack: the first (innermost) frame from the
// modules/<name>/ folder of the extension address. Core frames (base.mjs, background.js, …)
// are skipped, so a listener a module registers through api.* belongs to the
// module. Without a module frame PERF_CORE.
/** @type {Functions.Perf.perfModuleFromStack} */
export function perfModuleFromStack(stack, baseUrl) {
	if (typeof stack !== "string" || !stack) return PERF_CORE;
	const prefix = `${baseUrl}modules/`;
	let from = 0;
	for (;;) {
		const index = stack.indexOf(prefix, from);
		if (index === -1) return PERF_CORE;
		const start = index + prefix.length;
		const end = stack.indexOf("/", start);
		if (end !== -1) {
			const name = stack.slice(start, end);
			if (/^[A-Za-z0-9_$-]+$/.test(name)) return name;
		}
		from = start;
	}
}

// The stack at the moment the callback is registered. The stack text itself (expensive) is
// built only on the first measured call — while nothing is measured, registration costs
// only creating an Error object.
/** @type {Functions.Perf.captureOrigin} */
function captureOrigin() {
	/** @type {Types.PerfOrigin} */
	const origin = { module: null, error: null };
	try {
		const E = /** @type {ErrorConstructor & { stackTraceLimit?: number }} */ (Error);
		const limit = E.stackTraceLimit;
		if (typeof limit === "number") E.stackTraceLimit = 50;
		origin.error = new E();
		if (typeof limit === "number") E.stackTraceLimit = limit;
	} catch {
		// Without a stack the callback belongs to the core.
	}
	if (collector.enabled === true) originModule(origin);
	return origin;
}

/** @type {Functions.Perf.originModule} */
function originModule(origin) {
	if (origin.module === null) {
		let stack = "";
		try {
			stack = String((origin.error && origin.error.stack) || "");
		} catch {
			// An unreadable stack — the core.
		}
		origin.module = perfModuleFromStack(stack, collector.baseUrl);
		origin.error = null;
	}
	return origin.module;
}

// --------------------------------------------------------------------
// Measurement
// --------------------------------------------------------------------

// A shortened name (module, kind, domain) — protection of the overview size.
/** @type {Functions.Perf.clampName} */
function clampName(value) {
	const text = String(value);
	return text.length > MAX_NAME_LENGTH ? text.slice(0, MAX_NAME_LENGTH) : text;
}

/** @type {Functions.Perf.emptyBucket} */
function emptyBucket() {
	return { calls: 0, timeMs: 0, maxMs: 0, over16: 0, over50: 0, waitMs: 0 };
}

/** @type {Functions.Perf.emptyLongFrames} */
function emptyLongFrames() {
	return { count: 0, durationMs: 0, blockingMs: 0 };
}

// Records one measurement: timeMs = self time on the thread, waitMs = the total time
// of an asynchronous phase (import, init(), …; otherwise 0), start/end = when the callback
// ran (performance.now()) — on a web page for pairing with long
// frames. Nothing without hooks or with the measurement off.
/** @type {Functions.Perf.recordPerf} */
export function recordPerf(module, kind, timeMs, waitMs = 0, start = 0, end = 0) {
	if (!collector.context || collector.enabled === false) return;
	let key = `${clampName(module)}\u0000${clampName(kind)}`;
	if (!collector.pending.has(key) && collector.pending.size >= MAX_PENDING_KEYS) {
		key = `${clampName(module)}\u0000${PERF_OTHER_KIND}`;
	}
	let bucket = collector.pending.get(key);
	if (!bucket) {
		bucket = emptyBucket();
		collector.pending.set(key, bucket);
	}
	const time = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
	bucket.calls++;
	bucket.timeMs += time;
	if (time > bucket.maxMs) bucket.maxMs = time;
	if (time >= PERF_FRAME_MS) bucket.over16++;
	if (time >= PERF_LONG_MS) bucket.over50++;
	if (Number.isFinite(waitMs) && waitMs > 0) bucket.waitMs += waitMs;
	if (collector.page && end > start) pushInterval(module, start, end);
	scheduleFlush();
}

// Page callbacks for pairing with long frames — a fixed-length circular
// queue, the oldest are overwritten.
/** @type {Functions.Perf.pushInterval} */
function pushInterval(module, start, end) {
	/** @type {Types.PerfInterval} */
	const interval = { module, start, end };
	if (collector.intervals.length < INTERVAL_CAPACITY) {
		collector.intervals.push(interval);
	} else {
		collector.intervals[collector.intervalNext] = interval;
	}
	collector.intervalNext = (collector.intervalNext + 1) % INTERVAL_CAPACITY;
}

// Runs fn and measures its self time: nested measured callbacks (e.g. an event
// dispatched synchronously through dispatchEvent()) are subtracted and belong to their own module.
/** @type {Functions.Perf.runMeasured} */
function runMeasured(origin, kind, fn, thisArg, args) {
	/** @type {Types.PerfFrame} */
	const frame = { child: 0 };
	const stack = collector.stack;
	stack.push(frame);
	const start = collector.now();
	try {
		return Reflect.apply(fn, thisArg, args);
	} finally {
		const end = collector.now();
		stack.pop();
		const total = end - start;
		const parent = stack[stack.length - 1];
		if (parent) parent.child += total;
		recordPerf(originModule(origin), kind, Math.max(0, total - frame.child), 0, start, end);
	}
}

// Wrapper of a callback (timer, observer, chrome.* event). Messages of the measurement itself
// (SDK_PERF_*) are not measured — otherwise extension pages, which receive
// all messages, would keep passing around reports about receiving reports forever.
/** @type {Functions.Perf.wrapCallback} */
function wrapCallback(callback, origin, kind) {
	return function (...args) {
		if (collector.enabled === false || isPerfMessage(args[0])) {
			return Reflect.apply(callback, this, args);
		}
		return runMeasured(origin, kind, callback, this, args);
	};
}

/** @type {Functions.Perf.isPerfMessage} */
function isPerfMessage(value) {
	if (!value || typeof value !== "object") return false;
	const type = /** @type {{ type?: unknown }} */ (value).type;
	return typeof type === "string" && type.startsWith("SDK_PERF_");
}

// Runs a module phase called by the core (importing the file, creating the element,
// init(), pageInit(), setup(), …) and measures it: the self time of the synchronous part and,
// for a returned Promise, also the total time until it settles (waitMs). Returns the result
// (even a Promise) unchanged.
/**
 * @template T
 * @param {string} module
 * @param {string} kind
 * @param {() => T} fn
 * @returns {T}
 */
export function measurePerf(module, kind, fn) {
	if (!collector.context || collector.enabled === false) return fn();
	/** @type {Types.PerfFrame} */
	const frame = { child: 0 };
	const stack = collector.stack;
	stack.push(frame);
	const start = collector.now();
	let syncEnd = start;
	let threw = true;
	/** @type {T} */
	let result;
	try {
		result = fn();
		threw = false;
	} finally {
		syncEnd = collector.now();
		stack.pop();
		const parent = stack[stack.length - 1];
		if (parent) parent.child += syncEnd - start;
		if (threw) recordPerf(module, kind, Math.max(0, syncEnd - start - frame.child), 0, start, syncEnd);
	}
	const selfMs = Math.max(0, syncEnd - start - frame.child);
	const thenable = /** @type {PromiseLike<unknown> | null} */ (result && typeof (/** @type {{ then?: unknown }} */ (result)).then === "function" ? result : null);
	if (thenable) {
		const settle = () => recordPerf(module, kind, selfMs, collector.now() - start, start, syncEnd);
		thenable.then(settle, settle);
	} else {
		recordPerf(module, kind, selfMs, 0, start, syncEnd);
	}
	return result;
}

// Wraps the methods of a module's API (the result of createModuleApi()): every call is
// counted (count, time to the result, errors) under "<namespace>.<method>".
// api.perf is not wrapped — it is the measurement itself.
/** @type {Functions.Perf.instrumentModuleApi} */
export function instrumentModuleApi(module, api) {
	const source = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (api));
	/** @type {Record<string, unknown>} */
	const result = {};
	for (const [namespace, value] of Object.entries(source)) {
		if (namespace === "perf" || !value || typeof value !== "object") {
			result[namespace] = value;
			continue;
		}
		/** @type {Record<string, unknown>} */
		const wrapped = {};
		for (const [name, member] of Object.entries(value)) {
			wrapped[name] = typeof member === "function" ? wrapApiMethod(module, `${namespace}.${name}`, /** @type {Types.AnyFunction} */ (member)) : member;
		}
		result[namespace] = wrapped;
	}
	return /** @type {typeof api} */ (/** @type {unknown} */ (result));
}

// Wrapper of one API method. For a method that returns a Promise, the time of the
// module code that runs right after await on the result is also estimated (kind "then:<method>"):
// the module gets the result in its own microtask and right after it a microtask
// is queued that measures how long the continuation ran. It is an estimate —
// a continuation after another await (on something already settled) is not counted, and conversely
// a foreign microtask queued between them may be counted.
/** @type {Functions.Perf.wrapApiMethod} */
function wrapApiMethod(module, method, fn) {
	return function (...args) {
		if (!collector.context || collector.enabled === false) return Reflect.apply(fn, this, args);
		const start = collector.now();
		/** @type {unknown} */
		let result;
		try {
			result = Reflect.apply(fn, this, args);
		} catch (err) {
			recordApi(module, method, collector.now() - start, true);
			throw err;
		}
		const thenable = /** @type {PromiseLike<unknown> | null} */ (result && typeof (/** @type {{ then?: unknown }} */ (result)).then === "function" ? result : null);
		if (!thenable) {
			recordApi(module, method, collector.now() - start, false);
			return result;
		}
		return new Promise((resolve, reject) => {
			/** @type {Functions.Perf.wrapApiMethod.settle} */
			const settle = (done, value, failed) => {
				recordApi(module, method, collector.now() - start, failed);
				if (collector.enabled !== true) {
					done(value);
					return;
				}
				collector.queueMicrotask(() => {
					const continuationStart = collector.now();
					done(value);
					collector.queueMicrotask(() => {
						const continuationEnd = collector.now();
						recordPerf(module, `then:${method}`, continuationEnd - continuationStart, 0, continuationStart, continuationEnd);
					});
				});
			};
			thenable.then(
				(value) => settle(resolve, value, false),
				(err) => settle(reject, err, true)
			);
		});
	};
}

// One api.* call — count, time to the result, error.
/** @type {Functions.Perf.recordApi} */
function recordApi(module, method, waitMs, failed) {
	if (!collector.context || collector.enabled === false) return;
	const key = `${clampName(module)}\u0000${clampName(method)}`;
	let bucket = collector.pendingApi.get(key);
	if (!bucket) {
		if (collector.pendingApi.size >= MAX_PENDING_KEYS) return;
		bucket = { calls: 0, waitMs: 0, errors: 0 };
		collector.pendingApi.set(key, bucket);
	}
	bucket.calls++;
	if (Number.isFinite(waitMs) && waitMs > 0) bucket.waitMs += waitMs;
	if (failed) bucket.errors++;
	scheduleFlush();
}

// --------------------------------------------------------------------
// Hooks
// --------------------------------------------------------------------

// addEventListener/removeEventListener of all EventTargets (element, document,
// window, …). One wrapper per listener — so removeEventListener() finds it
// wherever the listener was registered. The kind is "event:<event type>".
//
// With the measurement off, a listener is not wrapped (DevTools then show the
// module code for the event, not the wrapper, and an exception has no extra frames in the stack) —
// so turning it on takes effect for listeners registered only after that. Whether a listener
// is wrapped is decided by its first registration and holds forever: the browser registers the same
// function on the same event only once, and if it were registered once
// raw and the second time in a wrapper, it would be called twice.
/** @type {Functions.Perf.patchEventTarget} */
function patchEventTarget(global) {
	const proto = global.EventTarget && global.EventTarget.prototype;
	if (!proto) return;
	const nativeAdd = proto.addEventListener;
	const nativeRemove = proto.removeEventListener;
	if (typeof nativeAdd !== "function" || typeof nativeRemove !== "function") return;
	collector.nativeAddEventListener = nativeAdd;

	/** @type {WeakMap<object, EventListener>} */
	const wrappers = new WeakMap();
	// Listeners registered without a wrapper (without measurement) — they stay without it.
	/** @type {WeakSet<object>} */
	const unwrapped = new WeakSet();

	/** @type {Functions.Perf.patchEventTarget.addEventListener} */
	const addEventListener = function (type, listener, options) {
		/** @type {EventListenerOrEventListenerObject | null | undefined} */
		let registered = listener;
		if (listener && (typeof listener === "function" || typeof listener === "object")) {
			let wrapped = wrappers.get(listener);
			if (!wrapped && (unwrapped.has(listener) || collector.enabled === false)) {
				unwrapped.add(listener);
			} else {
				if (!wrapped) {
					wrapped = wrapEventListener(listener, captureOrigin());
					wrappers.set(listener, wrapped);
				}
				registered = wrapped;
			}
		}
		return nativeAdd.call(this, type, /** @type {EventListenerOrEventListenerObject | null} */ (registered), options);
	};
	/** @type {Functions.Perf.patchEventTarget.removeEventListener} */
	const removeEventListener = function (type, listener, options) {
		const wrapped = listener && (typeof listener === "function" || typeof listener === "object") ? wrappers.get(listener) : undefined;
		if (wrapped) nativeRemove.call(this, type, wrapped, options);
		return nativeRemove.call(this, type, /** @type {EventListenerOrEventListenerObject | null} */ (listener), options);
	};
	proto.addEventListener = addEventListener;
	proto.removeEventListener = removeEventListener;
}

// Wrapper of an event listener — a function, or an object with handleEvent() (that one is
// looked up only at the event, the same as the browser does).
/** @type {Functions.Perf.wrapEventListener} */
function wrapEventListener(listener, origin) {
	return function (event) {
		const isFunction = typeof listener === "function";
		const fn = /** @type {Types.AnyFunction} */ (/** @type {unknown} */ (isFunction ? listener : listener.handleEvent));
		const thisArg = isFunction ? this : listener;
		if (collector.enabled === false || typeof fn !== "function") {
			return Reflect.apply(fn, thisArg, [event]);
		}
		const type = event && typeof event.type === "string" ? event.type : "?";
		return runMeasured(origin, `event:${type}`, fn, thisArg, [event]);
	};
}

// setTimeout, setInterval, requestAnimationFrame, requestIdleCallback.
// Timers are registered often (debouncing while typing, animations), so without
// the measurement on they are not wrapped at all, and instead of a stack on every call the
// attribution is remembered by the callback function.
/** @type {Functions.Perf.patchTimers} */
function patchTimers(global) {
	const target = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (global));
	for (const [name, kind] of TIMERS) {
		const native = target[name];
		if (typeof native !== "function") continue;
		/** @type {WeakMap<Function, Types.PerfOrigin>} */
		const origins = new WeakMap();
		target[name] = function (/** @type {unknown} */ callback, /** @type {unknown[]} */ ...rest) {
			if (typeof callback !== "function" || collector.enabled === false) {
				return Reflect.apply(native, undefined, [callback, ...rest]);
			}
			let origin = origins.get(callback);
			if (!origin) {
				origin = captureOrigin();
				origins.set(callback, origin);
			}
			return Reflect.apply(native, undefined, [wrapCallback(/** @type {Types.AnyFunction} */ (callback), origin, kind), ...rest]);
		};
	}
}

// Observer constructors: the callback is wrapped, the instance stays of the original type
// (the prototype and static properties like PerformanceObserver.supportedEntryTypes
// are taken over from the original constructor).
/** @type {Functions.Perf.patchObservers} */
function patchObservers(global) {
	const target = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (global));
	for (const name of OBSERVERS) {
		const Native = /** @type {Types.AnyConstructor} */ (target[name]);
		if (typeof Native !== "function") continue;
		if (name === "PerformanceObserver") {
			collector.NativePerformanceObserver = /** @type {typeof PerformanceObserver} */ (/** @type {unknown} */ (Native));
		}
		const kind = `observer:${name}`;
		/** @type {Types.AnyConstructor} */
		const Patched = /** @type {Types.AnyConstructor} */ (/** @type {unknown} */ (
			function (/** @type {unknown} */ callback, /** @type {unknown[]} */ ...rest) {
				if (!new.target) return Reflect.apply(Native, undefined, [callback, ...rest]);
				// Without measurement without a wrapper (see patchEventTarget()) — an observer
				// created before the measurement was turned on is not measured.
				const wrapped =
					typeof callback === "function" && collector.enabled !== false ? wrapCallback(/** @type {Types.AnyFunction} */ (callback), captureOrigin(), kind) : callback;
				return Reflect.construct(Native, [wrapped, ...rest], new.target === Patched ? Native : new.target);
			}
		));
		Object.defineProperty(Patched, "prototype", { value: Native.prototype });
		Object.defineProperty(Patched, "name", { value: name, configurable: true });
		try {
			Object.setPrototypeOf(Patched, Native);
		} catch {
			if (name === "PerformanceObserver") {
				Object.defineProperty(Patched, "supportedEntryTypes", { get: () => /** @type {typeof PerformanceObserver} */ (/** @type {unknown} */ (Native)).supportedEntryTypes });
			}
		}
		target[name] = Patched;
	}
}

// chrome.* events from the CHROME_EVENT_NAMESPACES namespaces that
// exist in the context. Again after a permission is granted (already wrapped ones are skipped).
/** @type {Functions.Perf.patchChromeEvents} */
function patchChromeEvents(chromeApi) {
	if (!chromeApi) return;
	const root = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (chromeApi));
	for (const namespace of CHROME_EVENT_NAMESPACES) {
		/** @type {unknown} */
		let api;
		try {
			api = root[namespace];
		} catch {
			continue;
		}
		if (!api || typeof api !== "object") continue;
		for (const key of eventKeys(/** @type {Record<string, unknown>} */ (api))) {
			patchChromeEvent(/** @type {Record<string, unknown>} */ (api), key, `chrome:${namespace}.${key}`);
		}
	}
}

// Event names of a namespace (on + an upper-case letter).
/** @type {Functions.Perf.eventKeys} */
function eventKeys(api) {
	/** @type {Set<string>} */
	const keys = new Set();
	const isEvent = (/** @type {string} */ key) => /^on[A-Z]/.test(key);
	try {
		for (const key of Object.getOwnPropertyNames(api)) if (isEvent(key)) keys.add(key);
	} catch {
		// A namespace without enumerable properties.
	}
	try {
		for (const key in api) if (isEvent(key)) keys.add(key);
	} catch {
		// The same.
	}
	return keys;
}

// Wraps addListener/removeListener/hasListener of one event. Only when the
// event is still the same object (otherwise removeListener() of another access would not find
// the wrapper) and the browser allows overriding the methods — otherwise it stays unmeasured.
// A listener registered without measurement stays without a wrapper (see patchEventTarget()).
/** @type {Functions.Perf.patchChromeEvent} */
function patchChromeEvent(api, key, kind) {
	/** @type {Types.PerfChromeEvent} */
	let event;
	try {
		event = /** @type {Types.PerfChromeEvent} */ (api[key]);
		if (!event || typeof event !== "object" || api[key] !== event) return;
	} catch {
		return;
	}
	if (collector.nativeAddListener.has(event)) return;
	const nativeAdd = event.addListener;
	const nativeRemove = event.removeListener;
	const nativeHas = event.hasListener;
	if (typeof nativeAdd !== "function" || typeof nativeRemove !== "function") return;

	/** @type {WeakMap<Function, Types.AnyFunction>} */
	const wrappers = new WeakMap();
	/** @type {WeakSet<Function>} */
	const unwrapped = new WeakSet();
	/** @type {Types.PerfChromeEvent['addListener']} */
	const addListener = function (listener, ...rest) {
		/** @type {unknown} */
		let registered = listener;
		if (typeof listener === "function") {
			let wrapped = wrappers.get(listener);
			if (!wrapped && (unwrapped.has(listener) || collector.enabled === false)) {
				unwrapped.add(listener);
			} else {
				if (!wrapped) {
					wrapped = wrapCallback(/** @type {Types.AnyFunction} */ (listener), captureOrigin(), kind);
					wrappers.set(listener, wrapped);
				}
				registered = wrapped;
			}
		}
		return Reflect.apply(nativeAdd, event, [registered, ...rest]);
	};
	/** @type {Types.PerfChromeEvent['removeListener']} */
	const removeListener = function (listener) {
		const wrapped = typeof listener === "function" ? wrappers.get(listener) : undefined;
		if (wrapped) Reflect.apply(nativeRemove, event, [wrapped]);
		return Reflect.apply(nativeRemove, event, [listener]);
	};
	/** @type {Types.PerfChromeEvent['hasListener']} */
	const hasListener = function (listener) {
		const wrapped = typeof listener === "function" ? wrappers.get(listener) : undefined;
		const has = /** @type {Types.AnyFunction} */ (nativeHas);
		return (!!wrapped && !!Reflect.apply(has, event, [wrapped])) || !!Reflect.apply(has, event, [listener]);
	};

	const restore = () => {
		try {
			event.addListener = nativeAdd;
			event.removeListener = nativeRemove;
			if (typeof nativeHas === "function") event.hasListener = nativeHas;
		} catch {
			// Cannot be reverted — left as the browser allowed it.
		}
	};
	try {
		event.addListener = addListener;
		event.removeListener = removeListener;
		if (typeof nativeHas === "function") event.hasListener = hasListener;
	} catch {
		restore();
		return;
	}
	if (event.addListener !== addListener || event.removeListener !== removeListener || (typeof nativeHas === "function" && event.hasListener !== hasListener)) {
		restore();
		return;
	}
	collector.nativeAddListener.set(event, nativeAdd);
}

// A core listener without a wrapper (watching the switch, permissions) — the measurement
// does not measure itself.
/** @type {Functions.Perf.rawAddChromeListener} */
function rawAddChromeListener(event, listener) {
	const add = collector.nativeAddListener.get(event) || event.addListener;
	Reflect.apply(add, event, [listener]);
}

// --------------------------------------------------------------------
// Switch, reporting, long frames
// --------------------------------------------------------------------

/** @type {Functions.Perf.isPerfSwitch} */
export function isPerfSwitch(value) {
	if (!value || typeof value !== "object") return false;
	const entry = /** @type {Record<string, unknown>} */ (value);
	return typeof entry.owner === "string" && entry.owner !== "" && typeof entry.since === "number" && Number.isFinite(entry.since);
}

// Switch state for api.perf.getState(): { enabled, since, owner }.
/** @type {Functions.Perf.perfStateFromSwitch} */
export function perfStateFromSwitch(value) {
	if (!isPerfSwitch(value)) return { enabled: false, since: null, owner: null };
	const entry = /** @type {Types.PerfSwitch} */ (value);
	return { enabled: true, since: entry.since, owner: entry.owner };
}

// Reads the switch and watches its changes. A change that comes before the
// response to the read takes precedence (the read may have returned an older value).
/** @type {Functions.Perf.watchSwitch} */
function watchSwitch(global) {
	const storage = global.chrome && global.chrome.storage;
	if (!storage || !storage.local || !storage.onChanged) {
		applySwitch(undefined);
		return;
	}
	rawAddChromeListener(/** @type {Types.PerfChromeEvent} */ (/** @type {unknown} */ (storage.onChanged)), (/** @type {Record<string, chrome.storage.StorageChange>} */ changes, /** @type {string} */ area) => {
		if (area === "local" && changes && changes[PERF_STATE_KEY]) {
			collector.switchVersion++;
			applySwitch(changes[PERF_STATE_KEY].newValue);
		}
	});
	const version = collector.switchVersion;
	Promise.resolve()
		.then(() => storage.local.get(PERF_STATE_KEY))
		.then(
			(result) => {
				if (collector.switchVersion === version) applySwitch(result && /** @type {Record<string, unknown>} */ (result)[PERF_STATE_KEY]);
			},
			() => {
				if (collector.switchVersion === version) applySwitch(undefined);
			}
		);
}

/** @type {Functions.Perf.applySwitch} */
function applySwitch(value) {
	const enabled = isPerfSwitch(value);
	collector.enabled = enabled;
	if (!enabled) {
		collector.pending.clear();
		collector.pendingApi.clear();
		collector.intervals.length = 0;
		collector.intervalNext = 0;
		if (collector.page) {
			collector.page.longFrames = emptyLongFrames();
			collector.page.overlap.clear();
		}
		if (collector.longFrameObserver) {
			try {
				collector.longFrameObserver.disconnect();
			} catch {
				// Already disconnected.
			}
			collector.longFrameObserver = null;
		}
		if (collector.flushTimer !== null && collector.clearTimeout) collector.clearTimeout(collector.flushTimer);
		collector.flushTimer = null;
		return;
	}
	startLongFrames();
	// A web page reports even without measured callbacks — the number of loaded
	// pages (average per page) and its long frames.
	if (collector.page || collector.pending.size > 0 || collector.pendingApi.size > 0) scheduleFlush();
}

// Long frames of a web page: Long Animation Frames (Chrome 123+), otherwise
// long tasks; Firefox has neither. buffered: also frames from before the
// content script started (page loading).
/** @type {Functions.Perf.startLongFrames} */
function startLongFrames() {
	const Observer = collector.NativePerformanceObserver;
	if (!collector.page || collector.longFrameObserver || !Observer) return;
	const supported = Observer.supportedEntryTypes || [];
	const type = supported.includes("long-animation-frame") ? "long-animation-frame" : supported.includes("longtask") ? "longtask" : null;
	if (!type) return;
	try {
		const observer = new Observer((list) => onLongFrames(list.getEntries()));
		observer.observe({ type, buffered: true });
		collector.longFrameObserver = observer;
	} catch {
		// The browser rejected the entry type — a page without long frames.
	}
}

// Long frames → page totals and for each module how many of its callbacks
// fell into them (overlap of times).
/** @type {Functions.Perf.onLongFrames} */
export function onLongFrames(entries) {
	const page = collector.page;
	if (!page || collector.enabled !== true) return;
	for (const entry of entries) {
		const start = Number(entry.startTime) || 0;
		const duration = Number(entry.duration) || 0;
		const end = start + duration;
		const blocking = /** @type {{ blockingDuration?: unknown }} */ (entry).blockingDuration;
		page.longFrames.count++;
		page.longFrames.durationMs += duration;
		page.longFrames.blockingMs += typeof blocking === "number" ? blocking : Math.max(0, duration - PERF_LONG_MS);
		for (const interval of collector.intervals) {
			const overlap = Math.min(interval.end, end) - Math.max(interval.start, start);
			if (overlap > 0) page.overlap.set(interval.module, (page.overlap.get(interval.module) || 0) + overlap);
		}
	}
	scheduleFlush();
}

/** @type {Functions.Perf.scheduleFlush} */
function scheduleFlush() {
	if (collector.enabled !== true || collector.flushTimer !== null || !collector.setTimeout) return;
	collector.flushTimer = collector.setTimeout(() => {
		collector.flushTimer = null;
		flushPerf();
	}, FLUSH_DELAY_MS);
}

// Sends the unreported values (background.js merges them). Called by itself after
// FLUSH_DELAY_MS, when leaving the page and before reading the overview
// (api.perf.getStats()), so that it also contains what the asking page measured.
/** @type {Functions.Perf.flushPerf} */
export function flushPerf() {
	if (collector.flushTimer !== null && collector.clearTimeout) collector.clearTimeout(collector.flushTimer);
	collector.flushTimer = null;
	if (collector.enabled !== true || !collector.context) return;
	const report = takeReport();
	if (!report) return;
	if (collector.sink) {
		try {
			collector.sink(report);
		} catch (err) {
			console.error("Měření zátěže: hodnoty se nepodařilo uložit:", err);
		}
		return;
	}
	try {
		const runtime = collector.global && collector.global.chrome && collector.global.chrome.runtime;
		if (!runtime || typeof runtime.sendMessage !== "function") return;
		/** @type {Types.Message<'SDK_PERF_REPORT'>} */
		const message = { type: PERF_REPORT_MESSAGE, report };
		const sent = /** @type {unknown} */ (runtime.sendMessage(message));
		if (sent && typeof (/** @type {Promise<unknown>} */ (sent)).catch === "function") {
			/** @type {Promise<unknown>} */ (sent).catch(() => {});
		}
	} catch {
		// The extension has been reloaded in the meantime (the content script context is gone).
	}
}

// The unreported values as a report (and emptying the stock); nothing = null.
/** @type {Functions.Perf.takeReport} */
function takeReport() {
	/** @type {Types.PerfReportEntry[]} */
	const entries = [];
	for (const [key, bucket] of collector.pending) {
		const split = key.indexOf("\u0000");
		entries.push({ module: key.slice(0, split), kind: key.slice(split + 1), ...bucket });
	}
	/** @type {Types.PerfReportApi[]} */
	const api = [];
	for (const [key, bucket] of collector.pendingApi) {
		const split = key.indexOf("\u0000");
		api.push({ module: key.slice(0, split), method: key.slice(split + 1), ...bucket });
	}
	collector.pending.clear();
	collector.pendingApi.clear();

	/** @type {Types.PerfReportPage | undefined} */
	let page;
	const state = collector.page;
	if (state && (state.newDocument || state.longFrames.count > 0 || state.overlap.size > 0)) {
		page = {
			newDocument: state.newDocument,
			longFrames: state.longFrames,
			overlap: [...state.overlap].map(([module, ms]) => ({ module, ms })),
		};
		state.newDocument = false;
		state.longFrames = emptyLongFrames();
		state.overlap = new Map();
	}
	if (entries.length === 0 && api.length === 0 && !page) return null;
	/** @type {Types.PerfReport} */
	const report = { context: /** @type {Enums.PerfContext} */ (collector.context), entries, api };
	if (page) report.page = page;
	return report;
}

// --------------------------------------------------------------------
// Overview (background.js) — pure functions, without chrome.*
// --------------------------------------------------------------------

/** @type {Functions.Perf.createPerfStats} */
export function createPerfStats(now) {
	return {
		version: 1,
		since: now,
		updatedAt: now,
		modules: {},
		longFrameMs: {},
		api: {},
		pages: { documents: 0, longFrames: emptyLongFrames() },
		domains: {},
		modes: {},
		modeClock: emptyModeClock(),
	};
}

/** @type {Functions.Perf.emptyModeClock} */
function emptyModeClock() {
	return { at: null, boot: "", modes: {} };
}

// An overview stored before measuring also by activation modes — fills in
// the missing fields (the other values stay).
/** @type {Functions.Perf.upgradePerfStats} */
function upgradePerfStats(stats) {
	if (!stats.modes || typeof stats.modes !== "object") stats.modes = {};
	const clock = /** @type {Partial<Types.PerfModeClock> | undefined} */ (stats.modeClock);
	if (!clock || typeof clock !== "object" || !clock.modes || typeof clock.modes !== "object") {
		stats.modeClock = emptyModeClock();
	}
	return stats;
}

/** @type {Functions.Perf.isPerfStats} */
export function isPerfStats(value) {
	if (!value || typeof value !== "object") return false;
	const stats = /** @type {Record<string, unknown>} */ (value);
	return (
		stats.version === 1 &&
		typeof stats.since === "number" &&
		!!stats.modules &&
		typeof stats.modules === "object" &&
		!!stats.api &&
		typeof stats.api === "object" &&
		!!stats.domains &&
		typeof stats.domains === "object" &&
		!!stats.pages &&
		typeof stats.pages === "object"
	);
}

/** @type {Functions.Perf.nonNegative} */
function nonNegative(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : 0;
}

/** @type {Functions.Perf.validName} */
function validName(value) {
	return typeof value === "string" && value !== "" && value.length <= MAX_NAME_LENGTH;
}

// A report from a message (from a content script or an extension page — untrusted
// input) with only valid fields, otherwise null.
/** @type {Functions.Perf.sanitizePerfReport} */
export function sanitizePerfReport(raw) {
	if (!raw || typeof raw !== "object") return null;
	const input = /** @type {Record<string, unknown>} */ (raw);
	const context = PERF_CONTEXTS.find((c) => c === input.context);
	if (!context) return null;
	const rawEntries = Array.isArray(input.entries) ? input.entries.slice(0, MAX_REPORT_ITEMS) : [];
	const rawApi = Array.isArray(input.api) ? input.api.slice(0, MAX_REPORT_ITEMS) : [];

	/** @type {Types.PerfReportEntry[]} */
	const entries = [];
	for (const item of rawEntries) {
		if (!item || !validName(item.module) || !validName(item.kind)) continue;
		entries.push({
			module: item.module,
			kind: item.kind,
			calls: Math.floor(nonNegative(item.calls)),
			timeMs: nonNegative(item.timeMs),
			maxMs: nonNegative(item.maxMs),
			over16: Math.floor(nonNegative(item.over16)),
			over50: Math.floor(nonNegative(item.over50)),
			waitMs: nonNegative(item.waitMs),
		});
	}
	/** @type {Types.PerfReportApi[]} */
	const api = [];
	for (const item of rawApi) {
		if (!item || !validName(item.module) || !validName(item.method)) continue;
		api.push({
			module: item.module,
			method: item.method,
			calls: Math.floor(nonNegative(item.calls)),
			waitMs: nonNegative(item.waitMs),
			errors: Math.floor(nonNegative(item.errors)),
		});
	}
	/** @type {Types.PerfReport} */
	const report = { context, entries, api };
	const rawPage = /** @type {Record<string, unknown> | null} */ (input.page && typeof input.page === "object" ? input.page : null);
	if (rawPage) {
		const frames = /** @type {Record<string, unknown>} */ (rawPage.longFrames && typeof rawPage.longFrames === "object" ? rawPage.longFrames : {});
		/** @type {{ module: string; ms: number }[]} */
		const overlap = [];
		for (const item of Array.isArray(rawPage.overlap) ? rawPage.overlap.slice(0, MAX_REPORT_ITEMS) : []) {
			if (item && validName(item.module)) overlap.push({ module: item.module, ms: nonNegative(item.ms) });
		}
		report.page = {
			newDocument: rawPage.newDocument === true,
			longFrames: {
				count: Math.floor(nonNegative(frames.count)),
				durationMs: nonNegative(frames.durationMs),
				blockingMs: nonNegative(frames.blockingMs),
			},
			overlap,
		};
	}
	return report;
}

/** @type {Functions.Perf.addBucket} */
function addBucket(target, source) {
	target.calls += source.calls;
	target.timeMs += source.timeMs;
	target.maxMs = Math.max(target.maxMs, source.maxMs);
	target.over16 += source.over16;
	target.over50 += source.over50;
	target.waitMs += source.waitMs;
}

/** @type {Functions.Perf.addLongFrames} */
function addLongFrames(target, source) {
	target.count += source.count;
	target.durationMs += source.durationMs;
	target.blockingMs += source.blockingMs;
}

// Totals of a module in one activation mode (creates them when missing).
/** @type {Functions.Perf.modeStats} */
function modeStats(stats, module, mode) {
	const byMode = stats.modes[module] || (stats.modes[module] = {});
	return byMode[mode] || (byMode[mode] = { durationMs: 0, documents: 0, contexts: {}, longFrameMs: 0, api: { calls: 0, waitMs: 0, errors: 0 } });
}

/** @type {Functions.Perf.addApiBucket} */
function addApiBucket(target, source) {
	target.calls += source.calls;
	target.waitMs += source.waitMs;
	target.errors += source.errors;
}

// Merges a report of one context into the overview. context is determined by background.js
// by the sender (content script = "page"), not by the report itself; domain =
// the domain of the page the content script reports from (getDomainKey()), otherwise null.
// A module's values are also credited to its current activation mode
// (stats.modeClock.modes, see advancePerfModes()) — modules outside the module
// list (the core) have no mode. A report comes at most FLUSH_DELAY_MS after the
// measurement, so values from right before a mode change may already be credited to the new one.
/** @type {Functions.Perf.mergePerfReport} */
export function mergePerfReport(stats, report, { context, domain, now }) {
	const currentModes = stats.modeClock.modes;
	/** @type {Functions.Perf.mergePerfReport.modeOf} */
	const modeOf = (module) => (Object.hasOwn(currentModes, module) ? modeStats(stats, module, currentModes[module]) : null);

	/** @type {Types.PerfDomainStats | null} */
	let domainStats = null;
	if (context === "page" && domain) {
		domainStats = stats.domains[domain] || null;
		if (!domainStats) {
			domainStats = { documents: 0, lastSeen: now, longFrames: emptyLongFrames(), modules: {} };
			stats.domains[domain] = domainStats;
		}
		domainStats.lastSeen = now;
	}

	for (const entry of report.entries) {
		const moduleStats = stats.modules[entry.module] || (stats.modules[entry.module] = {});
		const kinds = moduleStats[context] || (moduleStats[context] = {});
		const kind = entry.kind in kinds || Object.keys(kinds).length < MAX_KINDS ? entry.kind : PERF_OTHER_KIND;
		addBucket(kinds[kind] || (kinds[kind] = emptyBucket()), entry);
		const inMode = modeOf(entry.module);
		if (inMode) addBucket(inMode.contexts[context] || (inMode.contexts[context] = emptyBucket()), entry);
		if (domainStats) {
			const moduleOnDomain = domainStats.modules[entry.module] || (domainStats.modules[entry.module] = { calls: 0, timeMs: 0, maxMs: 0, longFrameMs: 0 });
			moduleOnDomain.calls += entry.calls;
			moduleOnDomain.timeMs += entry.timeMs;
			moduleOnDomain.maxMs = Math.max(moduleOnDomain.maxMs, entry.maxMs);
		}
	}

	for (const entry of report.api) {
		const methods = stats.api[entry.module] || (stats.api[entry.module] = {});
		addApiBucket(methods[entry.method] || (methods[entry.method] = { calls: 0, waitMs: 0, errors: 0 }), entry);
		const inMode = modeOf(entry.module);
		if (inMode) addApiBucket(inMode.api, entry);
	}

	if (report.page && context === "page") {
		if (report.page.newDocument) {
			stats.pages.documents++;
			// A loaded page is counted for every module in its current mode
			// (average per page in the mode, even for a module that did nothing on it).
			for (const [module, mode] of Object.entries(currentModes)) modeStats(stats, module, mode).documents++;
		}
		addLongFrames(stats.pages.longFrames, report.page.longFrames);
		if (domainStats) {
			if (report.page.newDocument) domainStats.documents++;
			addLongFrames(domainStats.longFrames, report.page.longFrames);
		}
		for (const { module, ms } of report.page.overlap) {
			stats.longFrameMs[module] = (stats.longFrameMs[module] || 0) + ms;
			const inMode = modeOf(module);
			if (inMode) inMode.longFrameMs += ms;
			if (domainStats) {
				const moduleOnDomain = domainStats.modules[module] || (domainStats.modules[module] = { calls: 0, timeMs: 0, maxMs: 0, longFrameMs: 0 });
				moduleOnDomain.longFrameMs += ms;
			}
		}
	}

	pruneDomains(stats);
	stats.updatedAt = now;
	return stats;
}

// At most PERF_MAX_DOMAINS domains — those measured longest ago are removed.
/** @type {Functions.Perf.pruneDomains} */
function pruneDomains(stats) {
	const names = Object.keys(stats.domains);
	if (names.length <= PERF_MAX_DOMAINS) return;
	names
		.sort((a, b) => stats.domains[a].lastSeen - stats.domains[b].lastSeen)
		.slice(0, names.length - PERF_MAX_DOMAINS)
		.forEach((name) => delete stats.domains[name]);
}

// Total time of modules on a domain.
/** @type {Functions.Perf.domainTimeMs} */
function domainTimeMs(domain) {
	return Object.values(domain.modules).reduce((sum, m) => sum + m.timeMs, 0);
}

// --------------------------------------------------------------------
// Module activation modes (background.js) — pure functions, without chrome.*
// --------------------------------------------------------------------

// Mode key from a list of modes (of instances) — without repetition, sorted.
/** @type {Functions.Perf.perfModeKey} */
export function perfModeKey(modes) {
	return [...new Set(modes)].sort().join(PERF_MODE_SEPARATOR);
}

// The activation mode of each module from the module list: entries = list entries
// (parseModuleEntry()), settings = moduleSettings, validModes = valid
// mode values. A mode that is not set (or invalid) is PERF_DEFAULT_MODE.
// For a module with multiple instances each instance has its own mode — the key is
// the list of their modes (the template without an instance id is not counted).
/** @type {Functions.Perf.perfModesFromEntries} */
export function perfModesFromEntries(entries, settings, validModes) {
	/** @type {Map<string, { plain: string[]; instances: string[] }>} */
	const byModule = new Map();
	for (const entry of entries) {
		const value = settings[entry.key];
		const mode = typeof value === "string" && validModes.includes(value) ? value : PERF_DEFAULT_MODE;
		let item = byModule.get(entry.name);
		if (!item) {
			item = { plain: [], instances: [] };
			byModule.set(entry.name, item);
		}
		(entry.instance ? item.instances : item.plain).push(mode);
	}
	/** @type {Record<string, string>} */
	const modes = {};
	for (const [name, item] of byModule) {
		modes[name] = perfModeKey(item.instances.length > 0 ? item.instances : item.plain);
	}
	return modes;
}

// Mode clock: modeClock.at = since when the measurement time runs in the current modes
// (modeClock.modes), null = not measuring. Credits the elapsed time to the modes that
// applied until now and sets new ones: modes = module modes (perfModesFromEntries())
// with the measurement on, null = the measurement is off (the clock stops, the modes
// stay). boot = id of the browser run (see resumePerfModes()). Returns true
// when the overview changed.
/** @type {Functions.Perf.advancePerfModes} */
export function advancePerfModes(stats, now, modes, boot = "") {
	const clock = stats.modeClock;
	let changed = false;
	if (clock.at !== null) {
		const elapsed = Math.max(0, now - clock.at);
		for (const [module, mode] of Object.entries(clock.modes)) modeStats(stats, module, mode).durationMs += elapsed;
		clock.at = null;
		changed = true;
	}
	if (modes) {
		clock.modes = { ...modes };
		// Even a module that has not measured anything in the mode yet has a row (the measurement time).
		for (const [module, mode] of Object.entries(modes)) modeStats(stats, module, mode);
		clock.at = now;
		clock.boot = boot;
		changed = true;
	}
	return changed;
}

// An overview loaded in a different browser run than the one in which the clock ran
// (the browser was closed and started again, the extension was reloaded): the time it was
// not running is not counted — the clock moves only up to the last report
// (stats.updatedAt) and starts running again from now. Returns true when the overview
// changed.
/** @type {Functions.Perf.resumePerfModes} */
export function resumePerfModes(stats, boot, now) {
	const clock = stats.modeClock;
	if (clock.at === null || clock.boot === boot) return false;
	const until = Math.min(now, Math.max(clock.at, stats.updatedAt));
	advancePerfModes(stats, until, clock.modes, boot);
	clock.at = now;
	return true;
}

// Module totals by modes for the overview: the measurement time in the current mode
// including what has elapsed since the last clock advance.
/** @type {Functions.Perf.snapshotModes} */
function snapshotModes(stats, now) {
	const clock = stats.modeClock;
	const running = clock.at === null ? 0 : Math.max(0, now - clock.at);
	/** @type {Types.PerfSnapshot['modes']} */
	const modes = {};
	for (const [module, byMode] of Object.entries(stats.modes)) {
		modes[module] = {};
		for (const [mode, entry] of Object.entries(byMode)) {
			modes[module][mode] = { ...entry, durationMs: entry.durationMs + (running > 0 && clock.modes[module] === mode ? running : 0) };
		}
	}
	return modes;
}

/** @type {Functions.Perf.addModeStats} */
function addModeStats(target, source) {
	target.durationMs += source.durationMs;
	target.documents += source.documents;
	target.longFrameMs += source.longFrameMs;
	addApiBucket(target.api, source.api);
	for (const [context, bucket] of Object.entries(source.contexts)) {
		if (!bucket) continue;
		const key = /** @type {Enums.PerfContext} */ (context);
		addBucket(target.contexts[key] || (target.contexts[key] = emptyBucket()), bucket);
	}
}

// Overview with the default mode replaced by the real one (an extension page, which
// knows the module registry — background.js does not): defaultModeOf(module) = the module's default
// activation mode, or null (an unknown module — it stays
// PERF_DEFAULT_MODE). Rows that come out the same this way (the default mode and the same
// mode set manually) are summed.
/** @type {Functions.Perf.resolvePerfModes} */
export function resolvePerfModes(snapshot, defaultModeOf) {
	/** @type {Functions.Perf.resolvePerfModes.resolveKey} */
	const resolveKey = (module, key) => {
		const fallback = defaultModeOf(module);
		if (!fallback) return key;
		return perfModeKey(key.split(PERF_MODE_SEPARATOR).map((mode) => (mode === PERF_DEFAULT_MODE ? fallback : mode)));
	};
	/** @type {Types.PerfSnapshot['modes']} */
	const modes = {};
	for (const [module, byMode] of Object.entries(snapshot.modes || {})) {
		/** @type {Record<string, Types.PerfModeStats>} */
		const merged = {};
		for (const [key, entry] of Object.entries(byMode)) {
			const resolved = resolveKey(module, key);
			const target = merged[resolved] || (merged[resolved] = { durationMs: 0, documents: 0, contexts: {}, longFrameMs: 0, api: { calls: 0, waitMs: 0, errors: 0 } });
			addModeStats(target, entry);
		}
		modes[module] = merged;
	}
	/** @type {Record<string, string>} */
	const currentModes = {};
	for (const [module, key] of Object.entries(snapshot.currentModes || {})) currentModes[module] = resolveKey(module, key);
	return { ...snapshot, modes, currentModes };
}

// Overview for display (api.perf.getStats()): total values, one domain
// in detail and TOP_DOMAINS domains with the highest module time — not all domains
// in detail, so that every refresh of the output does not transfer the whole overview. now = the
// measurement time in the current modes up to now.
/** @type {Functions.Perf.buildPerfSnapshot} */
export function buildPerfSnapshot(stats, domain, now = Date.now()) {
	const names = Object.keys(stats.domains);
	const topDomains = names
		.map((name) => {
			const entry = stats.domains[name];
			return { domain: name, documents: entry.documents, timeMs: domainTimeMs(entry), longFrames: entry.longFrames, lastSeen: entry.lastSeen };
		})
		.sort((a, b) => b.timeMs - a.timeMs)
		.slice(0, TOP_DOMAINS);
	const selected = typeof domain === "string" && domain && stats.domains[domain] ? { name: domain, ...stats.domains[domain] } : null;
	return {
		since: stats.since,
		updatedAt: stats.updatedAt,
		modules: stats.modules,
		longFrameMs: stats.longFrameMs,
		api: stats.api,
		pages: stats.pages,
		domainCount: names.length,
		topDomains,
		domain: selected,
		modes: snapshotModes(stats, now),
		currentModes: { ...stats.modeClock.modes },
	};
}

// --------------------------------------------------------------------
// Overview storage (background.js) — its own IndexedDB, one record
// --------------------------------------------------------------------

/** @type {Promise<IDBDatabase> | null} */
let databasePromise = null;

/** @type {Functions.Perf.openPerfDatabase} */
function openPerfDatabase() {
	if (!databasePromise) {
		const opening = new Promise((resolve, reject) => {
			const request = indexedDB.open(PERF_DB_NAME, PERF_DB_VERSION);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(PERF_DB_STORE)) {
					request.result.createObjectStore(PERF_DB_STORE);
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		// A failed open is retried next time.
		opening.catch(() => {
			databasePromise = null;
		});
		databasePromise = opening;
	}
	return databasePromise;
}

// The stored overview, or null (none, or invalid).
/** @type {Functions.Perf.loadPerfStats} */
export async function loadPerfStats() {
	const db = await openPerfDatabase();
	return new Promise((resolve, reject) => {
		const request = db.transaction(PERF_DB_STORE, "readonly").objectStore(PERF_DB_STORE).get(PERF_DB_KEY);
		request.onsuccess = () => resolve(isPerfStats(request.result) ? upgradePerfStats(/** @type {Types.PerfStats} */ (request.result)) : null);
		request.onerror = () => reject(request.error);
	});
}

/** @type {Functions.Perf.savePerfStats} */
export async function savePerfStats(stats) {
	const db = await openPerfDatabase();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(PERF_DB_STORE, "readwrite");
		tx.objectStore(PERF_DB_STORE).put(stats, PERF_DB_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}
