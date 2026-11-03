//@ts-check
"use strict";

// background.js — service worker (Chrome) / background script (Firefox); both are
// loaded as a module in the manifest ("type": "module").
//
// base.mjs is imported statically, not with a dynamic import(): that is forbidden in a Service
// Worker (Chrome) by the HTML specification, so the original
// `await import(chrome.runtime.getURL("base.mjs"))` threw a TypeError there
// and the background never started working (Firefox managed it, because its
// background script is not a Service Worker). A static import also makes sure the
// message listeners are registered synchronously right when the script is evaluated, as
// MV3 requires for waking up the service worker.
import * as base from "./base.mjs";
// Texts of errors that extension pages show — t() only after loadI18n() in the handler.
import { t, loadI18n } from "./i18n.mjs";
// Module load measurement — the hooks are already installed by base.mjs, here the
// reports of all contexts are just collected into the overview (see the "Module load measurement" section below).
import * as perf from "./perf.mjs";
// Module background parts (modules/<name>/background-script.mjs, see
// registerBackgroundScript() in base.mjs) — their list is in
// modules-background.mjs. The import is static for the same reason as for
// base.mjs above: the modules are evaluated before the rest of this file and register their
// listeners on the first pass through the script.
import "./modules-background.mjs";

(() => {
	const BaseStorage = base.BaseStorage;
	const storage = new BaseStorage();

	// api.debugger (see base.mjs) only for extension pages (popup, side
	// panel, Settings, floating window), not for content scripts — the DevTools
	// protocol can run any code in any tab. Attaching is queued
	// one after another (debuggerQueue), so two surfaces do not fight over the same target
	// ("Another debugger is already attached").
	/** @type {Promise<unknown>} */
	let debuggerQueue = Promise.resolve();


	/** @type {Functions.Background.isExtensionPageSender} */
	function isExtensionPageSender(sender) {
		return typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
	}

	// Listeners of core messages (data service, shared limits, ... below).
	// Messages from other contexts are delivered to them by chrome.runtime.onMessage; queries
	// from module background parts that run right here are not delivered by the browser to the
	// sender — those are passed to them by createLocalDispatcher() (see sendToBackground()
	// in base.mjs).
	/** @type {Types.BackgroundMessageListener[]} */
	const coreMessageListeners = [];

	/** @type {Functions.Background.addCoreMessageListener} */
	function addCoreMessageListener(listener) {
		coreMessageListeners.push(listener);
		chrome.runtime.onMessage.addListener(listener);
	}

	// Sender of a message from background.js itself: the extension, without a tab.
	base.setBackgroundDispatcher(base.createLocalDispatcher(coreMessageListeners, { id: chrome.runtime.id, url: location.href }));

	// Clicks and closing of extension notifications (api.notifications) in the service
	// worker — the listeners must be created on the first pass through the script.
	base.listenForNotificationEvents();

	// Modules from other extensions (see base.mjs): the messages of a service provider or of its clients, and the
	// registration of this extension with its provider when it is a client — also right now from its Settings.
	base.startExtensionServices();
	addCoreMessageListener((message, sender, sendResponse) => {
		if (!message || message.type !== base.EXTENSION_SERVICE_REGISTER_NOW_MESSAGE || !isExtensionPageSender(sender)) return;
		base.registerWithServiceProvider(true).then(
			(state) => sendResponse({ state }),
			(err) => sendResponse({ state: null, error: err instanceof Error ? err.message : String(err) })
		);
		return true;
	});

	// Services of the background parts (api.services.provide(), see base.mjs) for the extension pages of this
	// extension — a function of the catalog of uploaded modules the background part of a module does
	// (callModuleService()). Only from an extension page; a page that cannot tell its window (the floating
	// window) is in the window of its tab.
	addCoreMessageListener((message, sender, sendResponse) => {
		if (!message || message.type !== base.MODULE_SERVICE_MESSAGE || !isExtensionPageSender(sender)) return;
		const context = base.normalizeServiceContext(message.context, "page");
		if (context.windowId === null && sender.tab && typeof sender.tab.windowId === "number") context.windowId = sender.tab.windowId;
		base.runBackgroundService(message.name, message.args, context).then(
			(value) => sendResponse({ ok: true, value }),
			(err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
		);
		return true;
	});

	// A service of another module (api.services.call(), see "Services of other modules" in base.mjs) for an extension page
	// or a background part of this extension — wherever the module runs: a client of this extension, this extension, its
	// service provider.
	addCoreMessageListener((message, sender, sendResponse) => {
		if (!message || message.type !== base.MODULE_SERVICE_ROUTE_MESSAGE || !isExtensionPageSender(sender)) return;
		const context = base.normalizeServiceContext(message.context, "page");
		if (context.windowId === null && sender.tab && typeof sender.tab.windowId === "number") context.windowId = sender.tab.windowId;
		base.routeModuleService(message.name, message.args, context).then(
			(value) => sendResponse({ ok: true, value }),
			(err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
		);
		return true;
	});

	// A general data service for createModuleApi().data (see base.mjs and sdk.mjs):
	// the background does not know the names of individual modules in advance, it just stores/counts
	// by the "module" field of the received message. It replaces the former hard-wired
	// DATA_VOLUME_UPDATE (only for transferredDataVolume) and
	// GET_LOG_COUNT (only for logger) messages — a new module that wants to store its own
	// data thus does not require any change of background.js.
	// After every finished write the extension pages learn which module's record changed and where it
	// came from (base.DATA_CHANGED_MESSAGE — never its payload): a consumer of the details collects
	// again by itself (api.details.onChange()). No page open = nobody to receive it, not an error.
	/** @type {Functions.Background.notifyDataChanged} */
	function notifyDataChanged(change) {
		chrome.runtime.sendMessage(/** @satisfies {Types.Message<'SDK_DATA_CHANGED'>} */ ({ type: base.DATA_CHANGED_MESSAGE, ...change })).catch(() => {});
	}

	// The start of this run of the browser (base.BROWSER_SESSION_START_KEY) for DATA_LIST_MESSAGE: the
	// moment the service worker / background script that gets onStartup began — the browser delivers the
	// event to the first one of the run, so it writes every record of the run. Kept in memory too, so that
	// a listing asked for meanwhile does not read the value of the previous run.
	/** @type {number | null} */
	let browserSessionStart = null;
	chrome.runtime.onStartup.addListener(() => {
		browserSessionStart = performance.timeOrigin;
		chrome.storage.local.set({ [base.BROWSER_SESSION_START_KEY]: browserSessionStart }).catch((err) => {
			console.error("Začátek běhu prohlížeče se nepodařilo uložit:", err);
		});
	});

	addCoreMessageListener((message, sender, sendResponse) => {
		if (message.type === base.DATA_LOG_MESSAGE) {
			const pageUrl = sender.tab ? sender.tab.url : null;
			// Domain key of the page the record came from (see getDomainKey() in
			// base.mjs, api.data.findByDomain()) — computed by the core, not by the module.
			const domainKey = base.getDomainKey(pageUrl);
			storage
				.logData({
					module: message.module,
					payload: message.payload,
					tabId: sender.tab ? sender.tab.id : null,
					url: pageUrl,
					// Only from a content script (see getDocumentKey() in base.mjs) —
					// IndexedDB does not put a record without it into the "documentKey" index.
					...(typeof message.documentKey === "number" ? { documentKey: message.documentKey } : {}),
					// Not filled in without a web page (chrome://, a write from an extension page without
					// a tab), and the record does not get into the "moduleDomain" index.
					...(domainKey ? { domainKey } : {}),
					// The record's own key chosen by the module (api.data.log(payload,
					// { key })) — without it the record does not get into the "moduleRecordKey" index.
					...(typeof message.key === "string" && message.key !== "" ? { recordKey: message.key } : {}),
				})
				// Respond only after the write — so api.data.log() can be "awaited" and the record
				// read right after it (see createModuleApi().data.log in base.mjs).
				// The id of the new record is for a later api.data.update().
				.then(
					(id) => {
						sendResponse(typeof id === "number" ? { id } : {});
						notifyDataChanged({
							module: message.module,
							change: "log",
							domainKey: domainKey || null,
							tabId: sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null,
							documentKey: typeof message.documentKey === "number" ? message.documentKey : null,
						});
					},
					(err) => {
						console.error("Nelze uložit data modulu:", err);
						sendResponse({});
					}
				);

			return true;
		}

		// Completing a module record that is already stored (see api.data.update() in
		// base.mjs) — BaseStorage.updatePayload() changes only a record of the module
		// whose name the message carries.
		if (message.type === base.DATA_UPDATE_MESSAGE) {
			const { module, id, patch } = message;
			if (typeof module !== "string" || typeof id !== "number" || !patch || typeof patch !== "object" || Array.isArray(patch)) {
				sendResponse({ updated: false });
				return true;
			}
			storage
				.updatePayload({ module, id, patch })
				.then((updated) => {
					sendResponse({ updated });
					if (updated) notifyDataChanged({ module, change: "update", id });
				})
				.catch((err) => {
					console.error("Nelze doplnit data modulu:", err);
					sendResponse({ updated: false });
				});

			return true;
		}

		// Deleting a module record (see api.data.remove() in base.mjs) —
		// BaseStorage.removeEntry() deletes only a record of the module named in the message.
		if (message.type === base.DATA_REMOVE_MESSAGE) {
			const { module, id } = message;
			if (typeof module !== "string" || typeof id !== "number") {
				sendResponse({ removed: false });
				return true;
			}
			storage
				.removeEntry({ module, id })
				.then((removed) => {
					sendResponse({ removed });
					if (removed) notifyDataChanged({ module, change: "remove", id });
				})
				.catch((err) => {
					console.error("Nelze smazat data modulu:", err);
					sendResponse({ removed: false });
				});

			return true;
		}

		// The module's last N records from all tabs (see
		// api.data.listLatest() in base.mjs) — the same read as DATA_LIST_MESSAGE
		// below, just without the restriction to a tab.
		if (message.type === base.DATA_LATEST_MESSAGE) {
			if (typeof message.module !== "string") {
				sendResponse({ entries: [] });
				return true;
			}
			storage
				.listEntries({ module: message.module, limit: Number(message.limit) || 0 })
				.then((entries) => sendResponse({ entries }))
				.catch((err) => {
					console.error("Nelze načíst poslední data modulu:", err);
					sendResponse({ entries: [] });
				});

			return true;
		}

		// The module's last N records for one tab (see
		// api.data.listForActiveTab() in base.mjs). message.tabId is sent by the
		// popup/sidebar, sender.tab.id applies to the floating window's <iframe> (and
		// a content script), the same convention as for PAGE_URL_MESSAGE below.
		// Only records of this run of the browser: a tab of an earlier run could have had the same id.
		if (message.type === base.DATA_LIST_MESSAGE) {
			const tabId = message.tabId ?? (sender.tab && sender.tab.id);
			if (typeof tabId !== "number") {
				sendResponse({ entries: [] });
				return true;
			}
			(browserSessionStart !== null ? Promise.resolve(browserSessionStart) : base.readBrowserSessionStart())
				.then((since) => storage.listEntries({ module: message.module, tabId, limit: Number(message.limit) || 0, since: since ?? undefined }))
				.then((entries) => sendResponse({ entries }))
				.catch((err) => {
					console.error("Nelze načíst data modulu:", err);
					sendResponse({ entries: [] });
				});

			return true;
		}

		// The module's records from one document (see api.data.findByDocument() in
		// base.mjs) — the caller sends both tabId and documentKey explicitly.
		if (message.type === base.DATA_FIND_BY_DOCUMENT_MESSAGE) {
			if (typeof message.tabId !== "number" || typeof message.documentKey !== "number") {
				sendResponse({ entries: [] });
				return true;
			}
			storage
				.findByDocument({ module: message.module, tabId: message.tabId, documentKey: message.documentKey })
				.then((entries) => sendResponse({ entries }))
				.catch((err) => {
					console.error("Nelze načíst data modulu pro dokument:", err);
					sendResponse({ entries: [] });
				});

			return true;
		}

		// The module's records from pages of one domain (see api.data.findByDomain() in
		// base.mjs) — the caller sends the domain key (from the context of the details contract
		// or from api.tabs.getActive()).
		if (message.type === base.DATA_FIND_BY_DOMAIN_MESSAGE) {
			if (typeof message.module !== "string" || typeof message.domain !== "string" || !message.domain) {
				sendResponse({ entries: [] });
				return true;
			}
			storage
				.findByDomain({ module: message.module, domainKey: message.domain, limit: Number(message.limit) || 0 })
				.then((entries) => sendResponse({ entries }))
				.catch((err) => {
					console.error("Nelze načíst data modulu pro doménu:", err);
					sendResponse({ entries: [] });
				});

			return true;
		}

		// The module's records under one own key (see api.data.findByKey() in
		// base.mjs) — the module chose the key itself in api.data.log(payload, { key }).
		if (message.type === base.DATA_FIND_BY_KEY_MESSAGE) {
			if (typeof message.module !== "string" || typeof message.key !== "string" || !message.key) {
				sendResponse({ entries: [] });
				return true;
			}
			storage
				.findByKey({ module: message.module, recordKey: message.key, limit: Number(message.limit) || 0 })
				.then((entries) => sendResponse({ entries }))
				.catch((err) => {
					console.error("Nelze načíst data modulu podle klíče:", err);
					sendResponse({ entries: [] });
				});

			return true;
		}

		// Backup of one module's records in batches (see
		// api.backup.exportModule()/importModule() in base.mjs) — only for
		// extension pages: an export gives out records of any module, an import
		// overwrites them. An error is returned in the response, so a backup does not silently end up incomplete.
		if (message.type === base.DATA_EXPORT_MESSAGE) {
			if (!isExtensionPageSender(sender) || typeof message.module !== "string" || !message.module) {
				sendResponse({ records: [], lastId: null, error: "forbidden" });
				return true;
			}
			storage
				.exportEntries({ module: message.module, afterId: typeof message.afterId === "number" ? message.afterId : null, limit: base.BACKUP_DATA_BATCH })
				.then((result) => sendResponse(result))
				.catch((err) => {
					console.error("Nelze vydat zálohu dat modulu:", err);
					sendResponse({ records: [], lastId: null, error: base.describeError(err) });
				});
			return true;
		}
		if (message.type === base.DATA_IMPORT_MESSAGE) {
			if (!isExtensionPageSender(sender) || typeof message.module !== "string" || !message.module || !Array.isArray(message.records)) {
				sendResponse({ imported: 0, error: "forbidden" });
				return true;
			}
			storage
				.importEntries({ module: message.module, records: message.records, replace: message.replace === true })
				.then((imported) => sendResponse({ imported }))
				.catch((err) => {
					console.error("Nelze obnovit data modulu ze zálohy:", err);
					sendResponse({ imported: 0, error: base.describeError(err) });
				});
			return true;
		}

		// Shared rate limit (see api.rateLimit in base.mjs) — a decision
		// for all tabs in one place, queued one after another (rateLimitQueue).
		// An invalid query or a storage error does not allow the operation.
		if (message.type === base.RATE_LIMIT_ACQUIRE_MESSAGE) {
			/** @type {Types.RateLimitDecision} */
			const refused = { granted: false, waitMs: 10000, blockedUntil: null };
			const key = rateLimitKey(message);
			if (!key) {
				sendResponse(refused);
				return true;
			}
			const windows = base.normalizeRateLimitWindows(message.windows);
			withRateLimitEntry(key, (entry, now) => ({ result: base.tryAcquireRateLimit(entry, windows, now), changed: true }))
				.then((result) => sendResponse(result))
				.catch((err) => {
					console.error("Sdílený limit selhal:", err);
					sendResponse(refused);
				});
			return true;
		}
		if (message.type === base.RATE_LIMIT_BLOCK_MESSAGE) {
			const key = rateLimitKey(message);
			if (!key) {
				sendResponse({ blockedUntil: null });
				return true;
			}
			withRateLimitEntry(key, (entry, now) => ({ result: { blockedUntil: base.blockRateLimit(entry, Number(message.ms), now) }, changed: true }))
				.then((result) => sendResponse(result))
				.catch((err) => {
					console.error("Sdílený limit selhal:", err);
					sendResponse({ blockedUntil: null });
				});
			return true;
		}
		if (message.type === base.RATE_LIMIT_STATE_MESSAGE) {
			const key = rateLimitKey(message);
			if (!key) {
				sendResponse({ blockedUntil: null, times: [] });
				return true;
			}
			withRateLimitEntry(key, (entry, now) => {
				const keepMs = entry.keepMs || 0;
				return {
					result: {
						blockedUntil: entry.blockedUntil && entry.blockedUntil > now ? entry.blockedUntil : null,
						times: (entry.times || []).filter((t) => now - t < keepMs),
					},
					changed: false,
				};
			})
				.then((result) => sendResponse(result))
				.catch((err) => {
					console.error("Sdílený limit selhal:", err);
					sendResponse({ blockedUntil: null, times: [] });
				});
			return true;
		}

		// The sender's tab for api.tabs.getActive() (see base.mjs) — typically
		// the floating window's <iframe>, which has no chrome.tabs, but does have sender.tab
		// (the tab it is embedded in). tab.url only with a host permission.
		if (message.type === base.GET_SENDER_TAB_MESSAGE) {
			sendResponse({ tab: sender.tab ? { id: sender.tab.id, url: sender.tab.url || null } : null });
			return true;
		}

		// api.floatingWindow.toggle() from inside the floating window's <iframe> (see
		// base.mjs) — that one has no chrome.tabs, so background.js sends the instruction
		// for the floating window's content script to the sender's tab (sender.tab is
		// the tab the window is embedded in).
		if (message.type === base.TOGGLE_SENDER_FLOATING_WINDOW_MESSAGE) {
			if (sender.tab && typeof sender.tab.id === "number") {
				chrome.tabs.sendMessage(sender.tab.id, { type: base.TOGGLE_FLOATING_WINDOW_MESSAGE }).catch(() => {});
			}
			sendResponse({});
			return true;
		}

		// tabs.activate of an uploaded module from inside the floating window's <iframe> (see
		// base.mjs) — only the tab the window is embedded in.
		if (message.type === base.ACTIVATE_TAB_MESSAGE) {
			if (!sender.tab || sender.tab.id !== message.tabId) {
				sendResponse({ error: t("core_sandbox_capability_bad_tab", String(message.tabId)) });
				return true;
			}
			base
				.activateTab(message.tabId)
				.then(() => sendResponse({}))
				.catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
			return true;
		}


		if (message.type === base.DATA_COUNT_MESSAGE) {
			storage
				.countEntries(message.module)
				.then((count) => sendResponse({ count }))
				.catch(() => sendResponse({ count: 0 }));

			return true;
		}

		if (message.type === base.DATA_TOTAL_MESSAGE) {
			storage
				.countEntries()
				.then((count) => sendResponse({ count }))
				.catch(() => sendResponse({ count: 0 }));

			return true;
		}

		// A fallback path for api.permissions.contains() (see base.mjs) when the
		// calling context has no chrome.permissions at all (typically the floating
		// window's <iframe>) — background.js always has it. Read-only, therefore
		// without the user gesture restriction (unlike request(), which
		// cannot be redirected this way, see the comment at api.permissions.request()).
		if (message.type === base.PERMISSIONS_CONTAINS_MESSAGE) {
			// Inside .then() — Firefox rejects an unknown permission synchronously
			// with an exception (see _createDependenciesField() in options.mjs).
			Promise.resolve()
				.then(() => chrome.permissions.contains(message.permissions))
				.then((result) => sendResponse({ contains: result }))
				.catch(() => sendResponse({ contains: false }));

			return true;
		}

		// api.debugger.getTargets()/sendCommands() — see isExtensionPageSender()
		// and debuggerQueue above. chrome.debugger is missing without the "debugger" permission
		// (and in Firefox always).
		if (message.type === base.DEBUGGER_TARGETS_MESSAGE || message.type === base.DEBUGGER_COMMANDS_MESSAGE) {
			if (!isExtensionPageSender(sender)) {
				loadI18n().then(() => sendResponse({ error: t("background_debugger_extension_pages_only") }));
				return true;
			}
			if (typeof chrome.debugger === "undefined") {
				loadI18n().then(() => sendResponse({ error: t("background_debugger_unavailable") }));
				return true;
			}
			if (message.type === base.DEBUGGER_TARGETS_MESSAGE) {
				chrome.debugger
					.getTargets()
					.then((targets) => sendResponse({ targets }))
					.catch((err) => sendResponse({ error: err.message || String(err) }));
				return true;
			}
			const run = debuggerQueue.then(() => base.runDebuggerCommands(message.debuggee, message.commands));
			debuggerQueue = run.catch(() => {});
			run
				.then((results) => sendResponse({ results }))
				.catch((err) => sendResponse({ error: err.message || String(err) }));
			return true;
		}

		// api.networkRules.set() — see setModuleNetworkRules() below. Only from
		// extension pages: a rule can redirect any request.
		if (message.type === base.NETWORK_RULES_SET_MESSAGE) {
			if (!isExtensionPageSender(sender)) {
				loadI18n().then(() => sendResponse({ status: { active: 0, reason: "error", error: t("background_network_rules_extension_pages_only") } }));
				return true;
			}
			setModuleNetworkRules(message)
				.then((status) => sendResponse({ status }))
				.catch((err) => sendResponse({ status: { active: 0, reason: "error", error: err.message || String(err) } }));
			return true;
		}

		// api.networkRules.getStatus() — the module's rule status from the last
		// recalculation (cachedNetworkRulesStatus()), otherwise after a new recalculation (without
		// a change of the set the browser rebuilds nothing).
		if (message.type === base.NETWORK_RULES_STATUS_MESSAGE) {
			moduleNetworkRulesStatus(message.module)
				.then((status) => sendResponse({ status }))
				.catch((err) => sendResponse({ status: { active: 0, reason: "error", error: err.message || String(err) } }));
			return true;
		}

		// The last commit of the tab's main frame navigation (see
		// onMainFrameCommitted below), or null. With an address and a document start
		// in the query only the commit of THAT document (see answerForDocument below).
		if (message.type === base.GET_TAB_NAVIGATION_MESSAGE) {
			answerForDocument({
				store: lastNavigationByTabId,
				waiters: navigationWaiters,
				tabId: sender.tab ? sender.tab.id : message.tabId,
				query: message,
				urlOf: (navigation) => navigation.url,
				tracking: !!chrome.webNavigation?.onCommitted?.hasListener(onMainFrameCommitted),
				respond: (navigation) => sendResponse({ navigation }),
			});
			return true;
		}

		// The HTTP redirect chain that led to the tab's current document
		// (see onMainFrameRedirect below) — { finalUrl, redirects: [...],
		// timeStamp }, or null when nothing has been recorded for the tab yet
		// (the "webRequest" permission is missing, the page was opened before it was granted,
		// ...). With an address and a document start in the query only the chain of THAT
		// document (see answerForDocument below).
		if (message.type === base.GET_TAB_REDIRECTS_MESSAGE) {
			answerForDocument({
				store: redirectChainByTabId,
				waiters: redirectChainWaiters,
				tabId: sender.tab ? sender.tab.id : message.tabId,
				query: message,
				urlOf: (chain) => chain.finalUrl,
				tracking: !!chrome.webRequest?.onResponseStarted?.hasListener(onMainFrameResponseStarted),
				respond: (chain) => sendResponse({ chain }),
			});
			return true;
		}

		// A fallback path for api.network.getIpForActiveTab() (see base.mjs) —
		// the last recorded IP address of the main document of the given tab
		// (see chrome.webRequest.onResponseStarted below). sender.tab.id applies
		// to a query from a content script, message.tabId to a direct call without
		// sender.tab (a module element). Without a recorded IP (the page has not loaded
		// yet AFTER WEBREQUEST_PERMISSIONS were granted, a chrome:// page, ...)
		// it returns null, not an error.
		if (message.type === base.GET_TAB_IP_MESSAGE) {
			const tabId = sender.tab ? sender.tab.id : message.tabId;
			sendResponse({ ip: tabIpByTabId.get(/** @type {number} */ (tabId)) || null });
			return true;
		}

		// A module notification (api.notifications.show() from anywhere, see
		// showExtensionNotification() in base.mjs) — it is shown only here, so that
		// the api.notifications.onEvent() listeners of background parts see it.
		if (message.type === base.NOTIFICATION_SHOW_MESSAGE) {
			if (typeof message.module !== "string" || !message.module) {
				sendResponse({ error: "chybí jméno modulu" });
				return true;
			}
			base
				.showExtensionNotification(message.module, message.title, message.options)
				.then(() => sendResponse({}))
				.catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
			return true;
		}
	});

	// --- Shared rate limits (api.rateLimit) ---
	//
	// The state of all keys is kept in memory and written to
	// chrome.storage.local (RATE_LIMITS_KEY) after every change — the service worker reloads
	// what applied after it was put to sleep (even a block for tens of minutes). Operations are
	// queued one after another, so two tabs do not take the last free slot at the same time.
	/** @type {Types.RateLimitStore | null} */
	let rateLimitStore = null;
	/** @type {Promise<unknown>} */
	let rateLimitQueue = Promise.resolve();

	// State key "<module>:<key>", or null for an invalid message.
	/** @type {Functions.Background.rateLimitKey} */
	function rateLimitKey({ module, bucket }) {
		if (typeof module !== "string" || !module || typeof bucket !== "string" || !bucket || bucket.length > 200) return null;
		return `${module}:${bucket}`;
	}

	/** @type {Functions.Background.withRateLimitEntry} */
	function withRateLimitEntry(key, fn) {
		const run = rateLimitQueue.then(async () => {
			if (!rateLimitStore) {
				const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(base.RATE_LIMITS_KEY))[base.RATE_LIMITS_KEY];
				rateLimitStore = stored && typeof stored === "object" ? /** @type {Types.RateLimitStore} */ (stored) : {};
			}
			const store = rateLimitStore;
			const entry = store[key] || { times: [] };
			const { result, changed } = fn(entry, Date.now());
			if (changed) {
				// An empty key (without times and a block) is not stored.
				if (entry.times.length > 0 || entry.blockedUntil) store[key] = entry;
				else delete store[key];
				await chrome.storage.local.set({ [base.RATE_LIMITS_KEY]: store });
			}
			return result;
		});
		rateLimitQueue = run.catch(() => {});
		return run;
	}

	// --- Dynamic network request rules (api.networkRules) ---
	//
	// Module rules (NETWORK_RULES_KEY) are put into chrome.declarativeNetRequest
	// only by background.js — dynamic rule ids have one namespace for the
	// whole extension, so background.js is their sole owner: after every
	// change (module rules, activation mode, module list, permissions) it
	// recalculates the whole set (see planNetworkRules() in base.mjs) and replaces
	// all dynamic rules at once. Rules of a module that is turned off or removed from the list
	// thus stop applying immediately, even without an open extension
	// page. Without the declarativeNetRequest* permission the browser does not provide the API —
	// the rules stay stored and are used after it is granted. Recalculations and writes
	// go one after another (networkRulesQueue), so two changes do not overwrite each other. Bulk
	// rules (api.networkRules.set(…, { bulk: true }), the core's network filters — adBlockerSandbox) are
	// in IndexedDB, in a layer below the others and only into the free space — see
	// NETWORK_RULES_BULK_MAX_PRIORITY in base.mjs.
	/** @type {Promise<unknown>} */
	let networkRulesQueue = Promise.resolve();

	// How many rule recalculations or writes are queued (or running) — while any
	// is waiting, the status from the last recalculation (NETWORK_RULES_STATUS_CACHE_KEY) is not valid.
	let networkRulesPending = 0;

	/** @type {Functions.Background.queueNetworkRules} */
	function queueNetworkRules(task) {
		networkRulesPending += 1;
		const run = networkRulesQueue.then(task).finally(() => {
			networkRulesPending -= 1;
		});
		networkRulesQueue = run.catch(() => {});
		return run;
	}

	// The rule status of all modules after the last recalculation (chrome.storage.session:
	// it survives the service worker going to sleep, not a browser restart) — api.networkRules
	// .getStatus() returns it immediately, without a new recalculation (which with bulk rules
	// costs ~0.6 s: reading IndexedDB and all dynamic rules from the browser).
	// Every change that changes the status (module rules, activation mode, module
	// list, permissions, installation) goes through queueNetworkRules() and at the end of the
	// recalculation overwrites the status.
	const NETWORK_RULES_STATUS_CACHE_KEY = "networkRulesStatus";

	/** @type {Functions.Background.cachedNetworkRulesStatus} */
	async function cachedNetworkRulesStatus(module) {
		if (networkRulesPending > 0 || !chrome.storage.session) return null;
		try {
			const cache = /** @type {Record<string, Types.NetworkRulesStatus> | undefined} */ ((await chrome.storage.session.get(NETWORK_RULES_STATUS_CACHE_KEY))[NETWORK_RULES_STATUS_CACHE_KEY]);
			return networkRulesPending === 0 && cache && cache[module] ? cache[module] : null;
		} catch {
			return null;
		}
	}

	// How many rules to verify at most at once (session rules, see
	// addBulkNetworkRules()) and how many attempts of searching directly in the dynamic
	// rules to allow at most — there every attempt costs a rebuild of all
	// dynamic rules (Chrome with 20,000 rules ~0.5 s).
	const BULK_RULES_CHUNK = 500;
	const BULK_RULES_MAX_ATTEMPTS = 200;

	// Adds a module's bulk rules (already with ids) to the rules in the browser in a way that
	// skips the rules the browser rejects:
	// 1. regular expressions the browser cannot handle are dropped in advance
	//    (isRegexSupported — Chrome rejects an expression over 2 KB of memory),
	// 2. the rest is verified in batches in session rules — a separate small set
	//    that the browser checks the same way, but does not rebuild the dynamic
	//    rules because of it (no module uses session rules, after verification
	//    they stay empty); a rejected batch is halved, a rule that Chrome
	//    names in the error ("Rule with id …") is dropped right away,
	// 3. the valid rules are added in one call.
	// Without session rules (or when adding the valid ones fails anyway) it halves directly
	// in the dynamic rules, at most BULK_RULES_MAX_ATTEMPTS attempts — then
	// it also skips the rest of the untried ones. Returns the skipped rules.
	/** @type {Functions.Background.addBulkNetworkRules} */
	async function addBulkNetworkRules(dnr, rules) {
		/** @type {Set<chrome.declarativeNetRequest.Rule>} */
		const rejected = new Set();
		/** @type {chrome.declarativeNetRequest.Rule[]} */
		const candidates = [];
		for (const rule of rules) {
			const regex = rule.condition.regexFilter;
			if (regex && typeof dnr.isRegexSupported === "function") {
				try {
					const result = await dnr.isRegexSupported({ regex, isCaseSensitive: !!rule.condition.isUrlFilterCaseSensitive });
					if (!result.isSupported) {
						rejected.add(rule);
						continue;
					}
				} catch {
					// The check is not possible — the browser decides when adding.
				}
			}
			candidates.push(rule);
		}

		/** @type {(list: chrome.declarativeNetRequest.Rule[]) => chrome.declarativeNetRequest.Rule[][]} */
		const chunks = (list) => {
			/** @type {chrome.declarativeNetRequest.Rule[][]} */
			const stack = [];
			for (let i = list.length; i > 0; i -= BULK_RULES_CHUNK) stack.push(list.slice(Math.max(0, i - BULK_RULES_CHUNK), i));
			return stack;
		};
		/** @type {(chunk: chrome.declarativeNetRequest.Rule[], stack: chrome.declarativeNetRequest.Rule[][], err: unknown) => void} */
		const split = (chunk, stack, err) => {
			const named = /Rule with id (\d+)/.exec(String((err && /** @type {Error} */ (err).message) || err));
			const culprit = named ? chunk.find((rule) => rule.id === Number(named[1])) : undefined;
			if (culprit) {
				rejected.add(culprit);
				const rest = chunk.filter((rule) => rule !== culprit);
				if (rest.length > 0) stack.push(rest);
			} else if (chunk.length === 1) {
				rejected.add(chunk[0]);
			} else {
				const half = Math.ceil(chunk.length / 2);
				stack.push(chunk.slice(half), chunk.slice(0, half));
			}
		};

		if (typeof dnr.updateSessionRules === "function" && typeof dnr.getSessionRules === "function") {
			try {
				/** @type {chrome.declarativeNetRequest.Rule[]} */
				const valid = [];
				let sessionIds = (await dnr.getSessionRules()).map((rule) => rule.id);
				const stack = chunks(candidates);
				while (stack.length > 0) {
					const chunk = /** @type {chrome.declarativeNetRequest.Rule[]} */ (stack.pop());
					try {
						await dnr.updateSessionRules({ removeRuleIds: sessionIds, addRules: chunk });
						sessionIds = chunk.map((rule) => rule.id);
						valid.push(...chunk);
					} catch (err) {
						split(chunk, stack, err);
					}
				}
				if (sessionIds.length > 0) await dnr.updateSessionRules({ removeRuleIds: sessionIds });
				await dnr.updateDynamicRules({ addRules: valid });
				return [...rejected];
			} catch (err) {
				console.warn("Ověření hromadných pravidel v session pravidlech nevyšlo, zkouším přímo:", err);
			}
		}

		let attempts = 0;
		const stack = chunks(candidates.filter((rule) => !rejected.has(rule)));
		while (stack.length > 0) {
			const chunk = /** @type {chrome.declarativeNetRequest.Rule[]} */ (stack.pop());
			if (attempts >= BULK_RULES_MAX_ATTEMPTS) {
				for (const rule of chunk) rejected.add(rule);
				continue;
			}
			attempts += 1;
			try {
				await dnr.updateDynamicRules({ addRules: chunk });
			} catch (err) {
				split(chunk, stack, err);
			}
		}
		return [...rejected];
	}

	// Status of modules after the recalculation: module name -> Types.NetworkRulesStatus.
	/** @type {Functions.Background.applyNetworkRules} */
	async function applyNetworkRules() {
		const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get([base.NETWORK_RULES_KEY, base.SETTINGS_KEY]));
		const store = stored[base.NETWORK_RULES_KEY] || {};
		/** @type {Set<string>} */
		let moduleNames;
		try {
			const paths = JSON.parse(await new base.BaseController().getModulesJson());
			if (!Array.isArray(paths)) throw new Error("modules.json musí být pole řetězců");
			moduleNames = new Set(paths.map((path) => base.getModuleKey(path)));
		} catch (err) {
			// Without the module list there is no way to tell whose rules should apply — the current
			// rules in the browser stay unchanged.
			console.error("Nelze načíst seznam modulů pro pravidla síťových požadavků:", err);
			return {};
		}
		/** @type {Types.NetworkRulesBulkStore} */
		let bulkStore;
		try {
			bulkStore = await base.readBulkNetworkRules();
		} catch (err) {
			// Without the bulk rules they would be deleted from the browser — better do nothing.
			console.error("Nelze načíst hromadná pravidla síťových požadavků:", err);
			return {};
		}

		const { groups, skipped } = base.planNetworkRules(store, stored[base.SETTINGS_KEY] || {}, moduleNames, bulkStore);
		/** @type {Record<string, Types.NetworkRulesStatus>} */
		const status = { ...skipped };
		const dnr = chrome.declarativeNetRequest;
		if (!dnr || typeof dnr.updateDynamicRules !== "function") {
			for (const group of groups) status[group.module] = { active: 0, reason: "unavailable" };
			return status;
		}

		let nextId = 1;
		const numbered = base
			.fitNetworkRules(groups, base.networkRulesLimits(dnr))
			.map((group) => ({ ...group, rules: group.rules.map((rule) => /** @type {chrome.declarativeNetRequest.Rule} */ ({ ...rule, id: nextId++ })) }));
		const addRules = numbered.flatMap((group) => group.rules);
		// Bulk rules the browser rejected in this recalculation (module → count).
		/** @type {Map<string, number>} */
		const rejectedNow = new Map();
		const current = await dnr.getDynamicRules();
		if (!base.networkRulesMatch(current, addRules)) {
			const removeRuleIds = current.map((rule) => rule.id);
			try {
				await dnr.updateDynamicRules({ removeRuleIds, addRules });
			} catch (err) {
				// One invalid rule (e.g. a too complex regular expression)
				// breaks the whole batch — so the rules are set module by module, so that an error
				// of one module does not cancel the rules of the others. For bulk rules
				// the rejected ones are searched out and skipped (and remembered with the set).
				console.error("Nastavení pravidel síťových požadavků selhalo, zkouším po modulech:", err);
				await dnr.updateDynamicRules({ removeRuleIds });
				for (const group of numbered) {
					if (group.bulk) {
						const rejected = await addBulkNetworkRules(dnr, group.rules);
						if (rejected.length === 0) continue;
						rejectedNow.set(group.module, rejected.length);
						const firstId = group.rules[0].id;
						const entry = bulkStore[group.module];
						const indexes = rejected.map((rule) => group.indexes[rule.id - firstId]);
						console.warn(`Prohlížeč odmítl ${rejected.length} hromadných pravidel modulu ${group.module}.`);
						try {
							await base.writeBulkNetworkRules(group.module, { ...entry, rejected: [...new Set([...(entry.rejected || []), ...indexes])] });
						} catch (writeErr) {
							console.error("Nelze uložit odmítnutá hromadná pravidla:", writeErr);
						}
						continue;
					}
					try {
						await dnr.updateDynamicRules({ addRules: group.rules });
					} catch (moduleErr) {
						status[group.module] = { active: 0, reason: "error", error: /** @type {Error} */ (moduleErr).message || String(moduleErr) };
					}
				}
			}
		}
		for (const group of numbered) {
			if (status[group.module]) continue;
			const rejected = rejectedNow.get(group.module) || 0;
			status[group.module] = group.bulk
				? { active: group.rules.length - rejected, reason: null, dropped: group.dropped, rejected: group.rejected + rejected }
				: { active: group.rules.length, reason: null };
		}
		if (chrome.storage.session) await chrome.storage.session.set({ [NETWORK_RULES_STATUS_CACHE_KEY]: status }).catch(() => {});
		return status;
	}

	// Saves the module's new rule set (only when it changed) and recalculates the
	// rules in the browser; returns the module's rule status. Bulk rules
	// (bulk) go to IndexedDB instead of chrome.storage.local — a module always has only
	// one kind (regular or bulk), the other is deleted.
	/** @type {Functions.Background.setModuleNetworkRules} */
	function setModuleNetworkRules({ module, rules, defaultMode, bulk }) {
		return queueNetworkRules(async () => {
			if (typeof module !== "string" || !module) {
				await loadI18n();
				return { active: 0, reason: "error", error: t("background_missing_module_name") };
			}
			const store = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(base.NETWORK_RULES_KEY))[base.NETWORK_RULES_KEY] || {};
			/** @type {{ defaultMode?: Enums.ActivationMode }} */
			const mode = defaultMode && base.ACTIVATION_MODES.some((m) => m.value === defaultMode) ? { defaultMode } : {};
			const sanitized = base.sanitizeNetworkRules(rules);
			const previousBulk = await base.readBulkNetworkRulesOf(module);
			if (bulk) {
				const sameRules = !!previousBulk && JSON.stringify(previousBulk.rules) === JSON.stringify(sanitized);
				if (!previousBulk || !sameRules || previousBulk.defaultMode !== mode.defaultMode) {
					// Rejected rules apply only to the same set.
					await base.writeBulkNetworkRules(module, { rules: sanitized, ...mode, rejected: previousBulk && sameRules ? previousBulk.rejected || [] : [] });
				}
				if (module in store) {
					const { [module]: _removed, ...rest } = store;
					await chrome.storage.local.set({ [base.NETWORK_RULES_KEY]: rest });
				}
			} else {
				/** @type {Types.NetworkRulesEntry} */
				const entry = { rules: sanitized, ...mode };
				if (JSON.stringify(store[module]) !== JSON.stringify(entry)) {
					await chrome.storage.local.set({ [base.NETWORK_RULES_KEY]: { ...store, [module]: entry } });
				}
				if (previousBulk) await base.writeBulkNetworkRules(module, null);
			}
			return (await applyNetworkRules())[module] || { active: 0, reason: null };
		});
	}


	// The rule status of a module — the same answer as NETWORK_RULES_STATUS_MESSAGE.
	/** @type {Functions.Background.moduleNetworkRulesStatus} */
	function moduleNetworkRulesStatus(module) {
		return cachedNetworkRulesStatus(module).then(
			(cached) => cached || queueNetworkRules(applyNetworkRules).then((all) => all[module] || { active: 0, reason: null })
		);
	}

	/** @type {Functions.Background.scheduleNetworkRules} */
	function scheduleNetworkRules() {
		queueNetworkRules(applyNetworkRules).catch((err) => console.error("Přepočet pravidel síťových požadavků selhal:", err));
	}

	// A module's activation mode (a bare name without a dot in moduleSettings), the module
	// list or stored rules (including a restore from a backup, see api.backup) —
	// recalculate right away, not only at the next wake-up of the service worker.
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local") return;
		const settingsChange = changes[base.SETTINGS_KEY];
		const before = /** @type {Types.ModuleSettings} */ ((settingsChange && settingsChange.oldValue) || {});
		const after = /** @type {Types.ModuleSettings} */ ((settingsChange && settingsChange.newValue) || {});
		const modeChanged =
			!!settingsChange && [...new Set([...Object.keys(before), ...Object.keys(after)])].some((key) => !key.includes(".") && before[key] !== after[key]);
		if (modeChanged || changes[base.MODULES_JSON_KEY] || changes[base.NETWORK_RULES_KEY]) {
			scheduleNetworkRules();
		}
	});

	// Granting/removing the declarativeNetRequest* permission — the API appears or
	// disappears at runtime.
	if (chrome.permissions && chrome.permissions.onAdded) {
		chrome.permissions.onAdded.addListener(scheduleNetworkRules);
	}
	if (chrome.permissions && chrome.permissions.onRemoved) {
		chrome.permissions.onRemoved.addListener(scheduleNetworkRules);
	}
	chrome.runtime.onInstalled.addListener(scheduleNetworkRules);
	chrome.runtime.onStartup.addListener(scheduleNetworkRules);

	// --- "Do not use the sidebar" (base.SIDEBAR_DISABLED_KEY, the Settings page) ---
	//
	// Chrome: the extension's side panel off or on (base.applySidebarDisabled()) on every wake-up of
	// the service worker — the stored choice holds even if the browser forgot the panel options — and
	// after every change, also from a restored backup. Firefox has no API for it, there it does nothing.
	/** @type {Functions.Background.applyStoredSidebarDisabled} */
	function applyStoredSidebarDisabled() {
		base.readSidebarDisabled()
			.then((disabled) => base.applySidebarDisabled(disabled))
			.catch((err) => console.error("Nastavení postranního panelu se nepodařilo použít:", err));
	}
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && base.SIDEBAR_DISABLED_KEY in changes) applyStoredSidebarDisabled();
	});
	applyStoredSidebarDisabled();





	// --- Tracking the IP address of the main document per tab (geoipForDomain) ---
	//
	// Page-level JS (a content script, fetch()) has no access at all to the IP address
	// of the server — the only way is chrome.webRequest, a generic
	// pass without knowing the module name (the same spirit as PAGE_URL_MESSAGE/
	// badge above). "webRequest" is an optional permission (WEBREQUEST_PERMISSIONS
	// in base.mjs, together with the "<all_urls>" host access) — without it
	// chrome.webRequest does exist in the manifest as an optional_permission,
	// but calling addListener/the API without the permission granted would always fail,
	// so the listener is registered only when the API is really available
	// (the guard below), and even then it depends on whether the user really
	// granted the permission (without a host permission for the given page Chrome simply
	// does not call the listener for it at all, it does not throw an error).
	//
	// Stored only in memory (a Map), not in chrome.storage — it is ephemeral
	// "what is currently open" data, not a permanent record; after the service worker wakes up
	// it is filled again on the next navigation of the main document.
	/** @type {Map<number, string>} */
	const tabIpByTabId = new Map();

	// --- HTTP redirect chain of the main document per tab ---
	//
	// A redirect by the Location header (301/302/303/307/308) does not create any document
	// at the intermediate address, so a content script has no way to
	// know about it — it sees only the target page. The same generic pass through
	// chrome.webRequest as for the IP above: onBeforeRedirect builds the chain in progress
	// (each further redirect continues from the "to" of the previous one),
	// onResponseStarted (a response that is NOT a redirect anymore) closes it as
	// "the chain that led to the tab's current document". A content script
	// asks for it with the GET_TAB_REDIRECTS_MESSAGE message (see
	// api.network.getRedirectChain() in base.mjs) — the core knows neither the module name
	// nor what it does with the chain. Only in memory, the same as tabIpByTabId.
	//
	// onBeforeRedirect also reports INTERNAL redirects — those the
	// browser did itself, not the server with the Location header: an upgrade to HTTPS (HSTS,
	// HTTPS-First), a redirect by an extension, ... A redirect by the server always has
	// a 3xx status code. Chrome reports internal ones as "307 Internal Redirect",
	// Firefox with code 0 and an empty statusLine, a redirect by an extension (DNR)
	// also with the code of the response it was applied to (200). In the chain they are
	// marked (internal). In addition, Firefox reports this way a navigation intercepted by
	// the site's service worker (reddit.com) — as a redirect to the SAME address;
	// it is none, so it does not get into the chain at all.
	/** @type {Map<number, Types.RedirectEntry[]>} */
	const pendingRedirectsByTabId = new Map();
	/** @type {Map<number, Types.RedirectChain>} */
	const redirectChainByTabId = new Map();

	// --- A content script query for data about ITS document ---
	//
	// A content script asks for the redirect chain and the navigation type (lastNavigationByTabId below)
	// after the page loads, but the maps always hold only
	// the tab's LAST data. Firefox sometimes delivers the chrome.webRequest/webNavigation events
	// only AFTER the query (measured: by a few ms) — the map then still holds
	// the data of the previous navigation: with the same address the redirects would be credited
	// to a different visit, with a different one they would be missing. So the query carries the document address
	// and the start of its navigation (performance.timeOrigin): data for a different address
	// or older than the navigation is not used, and the right data is awaited at most
	// DOCUMENT_WAIT_MS, then null comes. There is no waiting when the events
	// are not tracked (the permission is missing), nor for an address other than http(s) — the
	// main frame's webRequest/webNavigation do not report it anyway. A query without
	// an address and a start gets the tab's last data as before.
	const DOCUMENT_WAIT_MS = 1000;
	// The event's timeStamp and the page's performance.timeOrigin are counted by different
	// clocks — how far they may drift apart.
	const CLOCK_TOLERANCE_MS = 250;
	/** @type {Map<number, Set<Types.DocumentWaiter<Types.RedirectChain>>>} */
	const redirectChainWaiters = new Map();
	/** @type {Map<number, Set<Types.DocumentWaiter<Types.NavigationTransition>>>} */
	const navigationWaiters = new Map();

	/** @type {Functions.Background.stripHash} */
	const stripHash = (url) => String(url).split("#")[0];

	/** @type {Functions.Background.answerForDocument} */
	function answerForDocument({ store, waiters, tabId, query, urlOf, tracking, respond }) {
		// Without a tab (tabId undefined) nothing is found and the answer is null.
		const current = (typeof tabId === "number" && store.get(tabId)) || null;
		const { url, timeOrigin } = query;
		if (typeof url !== "string" || typeof timeOrigin !== "number" || typeof tabId !== "number") {
			respond(current);
			return;
		}
		/** @type {(entry: Parameters<typeof urlOf>[0]) => boolean} */
		const fits = (entry) => stripHash(urlOf(entry)) === stripHash(url) && entry.timeStamp >= timeOrigin - CLOCK_TOLERANCE_MS;
		if (current && fits(current)) {
			respond(current);
			return;
		}
		if (!tracking || !/^https?:/i.test(url)) {
			respond(null);
			return;
		}
		const tabWaiters = waiters.get(tabId) || new Set();
		waiters.set(tabId, tabWaiters);
		const waiter = {
			fits,
			respond,
			timer: setTimeout(() => {
				tabWaiters.delete(waiter);
				if (tabWaiters.size === 0 && waiters.get(tabId) === tabWaiters) waiters.delete(tabId);
				respond(null);
			}, DOCUMENT_WAIT_MS),
		};
		tabWaiters.add(waiter);
	}

	// New tab data (a chain, a navigation commit): answers the queries that are
	// waiting for it (see answerForDocument above). null = the tab was closed.
	/** @type {Functions.Background.resolveDocumentWaiters} */
	function resolveDocumentWaiters(waiters, tabId, entry) {
		const tabWaiters = waiters.get(tabId);
		if (!tabWaiters) return;
		for (const waiter of tabWaiters) {
			if (entry !== null && !waiter.fits(entry)) continue;
			clearTimeout(waiter.timer);
			tabWaiters.delete(waiter);
			waiter.respond(entry);
		}
		if (tabWaiters.size === 0) waiters.delete(tabId);
	}

	/** @type {Functions.Background.onMainFrameRedirect} */
	function onMainFrameRedirect(details) {
		if (typeof details.tabId !== "number" || details.tabId < 0) return;
		const internal = !(details.statusCode >= 300 && details.statusCode < 400) || /\bInternal Redirect\b/i.test(details.statusLine || "");
		if (internal && details.redirectUrl === details.url) return;
		const pending = pendingRedirectsByTabId.get(details.tabId);
		const entry = {
			url: details.url,
			redirectUrl: details.redirectUrl,
			statusCode: details.statusCode,
			internal,
			// ms since the epoch; Chrome gives it with a fractional part too (below ms).
			timeStamp: details.timeStamp,
		};
		if (pending && pending.length > 0 && pending[pending.length - 1].redirectUrl === details.url) {
			pending.push(entry);
		} else {
			pendingRedirectsByTabId.set(details.tabId, [entry]);
		}
	}

	/** @type {Functions.Background.onMainFrameResponseStarted} */
	function onMainFrameResponseStarted(details) {
		if (typeof details.tabId !== "number" || details.tabId < 0) return;
		if (details.ip) {
			tabIpByTabId.set(details.tabId, details.ip);
		}
		const pending = pendingRedirectsByTabId.get(details.tabId) || [];
		pendingRedirectsByTabId.delete(details.tabId);
		const continues = pending.length > 0 && pending[pending.length - 1].redirectUrl === details.url;
		const chain = { finalUrl: details.url, redirects: continues ? pending : [], timeStamp: details.timeStamp };
		redirectChainByTabId.set(details.tabId, chain);
		resolveDocumentWaiters(redirectChainWaiters, details.tabId, chain);
	}

	// chrome.webRequest is available only after the optional "webRequest" permission
	// is granted — so registering the listeners is attempted at startup AND
	// after every grant of the permission (chrome.permissions.onAdded below), otherwise
	// after a grant at runtime nothing would be tracked until the next wake-up of the service
	// worker. hasListener() prevents a double registration.
	// --- Navigation type of the main document per tab ---
	//
	// chrome.webNavigation.onCommitted (the main frame, frameId 0) carries
	// transitionType ("link", "typed", "auto_bookmark", "form_submit",
	// "reload", ...) and transitionQualifiers ("client_redirect",
	// "server_redirect", "forward_back", "from_address_bar") — the only source
	// that distinguishes e.g. a click on a link from typing the address (Navigation Timing
	// in a content script knows only navigate/reload/back_forward). A generic
	// pass without knowing the module, only in memory (the same as tabIpByTabId),
	// queried with the GET_TAB_NAVIGATION_MESSAGE message.
	/** @type {Map<number, Types.NavigationTransition>} */
	const lastNavigationByTabId = new Map();

	/** @type {Functions.Background.onMainFrameCommitted} */
	function onMainFrameCommitted(details) {
		if (details.frameId !== 0 || typeof details.tabId !== "number" || details.tabId < 0) return;
		const navigation = {
			url: details.url,
			transitionType: details.transitionType || null,
			transitionQualifiers: details.transitionQualifiers || [],
			timeStamp: details.timeStamp,
		};
		lastNavigationByTabId.set(details.tabId, navigation);
		resolveDocumentWaiters(navigationWaiters, details.tabId, navigation);
	}

	/** @type {Functions.Background.registerWebNavigationListeners} */
	function registerWebNavigationListeners() {
		if (!chrome.webNavigation || !chrome.webNavigation.onCommitted) return;
		try {
			if (!chrome.webNavigation.onCommitted.hasListener(onMainFrameCommitted)) {
				chrome.webNavigation.onCommitted.addListener(onMainFrameCommitted);
			}
		} catch (err) {
			console.error("Registrace posluchače chrome.webNavigation selhala:", err);
		}
	}

	/** @type {Functions.Background.registerWebRequestListeners} */
	function registerWebRequestListeners() {
		if (!chrome.webRequest || !chrome.webRequest.onResponseStarted || !chrome.webRequest.onBeforeRedirect) {
			return;
		}
		/** @type {chrome.webRequest.RequestFilter} */
		const filter = { urls: ["<all_urls>"], types: ["main_frame"] };
		try {
			if (!chrome.webRequest.onResponseStarted.hasListener(onMainFrameResponseStarted)) {
				chrome.webRequest.onResponseStarted.addListener(onMainFrameResponseStarted, filter);
			}
			if (!chrome.webRequest.onBeforeRedirect.hasListener(onMainFrameRedirect)) {
				chrome.webRequest.onBeforeRedirect.addListener(onMainFrameRedirect, filter);
			}
		} catch (err) {
			console.error("Registrace posluchačů chrome.webRequest selhala:", err);
		}
	}
	registerWebRequestListeners();
	registerWebNavigationListeners();
	if (chrome.permissions && chrome.permissions.onAdded) {
		chrome.permissions.onAdded.addListener(() => {
			registerWebRequestListeners();
			registerWebNavigationListeners();
		});
	}

	if (chrome.tabs && chrome.tabs.onRemoved) {
		chrome.tabs.onRemoved.addListener((tabId) => {
			tabIpByTabId.delete(tabId);
			pendingRedirectsByTabId.delete(tabId);
			redirectChainByTabId.delete(tabId);
			lastNavigationByTabId.delete(tabId);
			resolveDocumentWaiters(redirectChainWaiters, tabId, null);
			resolveDocumentWaiters(navigationWaiters, tabId, null);
		});
	}

	// --- Permission to inject into pages (scripting + <all_urls>) ---
	//
	// Since minimal permissions were introduced, both are optional (see the manifest,
	// optional_permissions/optional_host_permissions) — without them the extension
	// itself (popup, Settings, module list, chrome.storage) keeps working
	// unchanged, only the floating window and the content scripts of
	// modules (bookmarkChecker, transferredDataVolume) are not injected. The user requests them
	// with a button in the popup/module element (chrome.permissions.request(), see
	// sdk.mjs -> api.permissions, popup.mjs and PAGE_ACCESS_PERMISSIONS in
	// base.mjs). chrome.permissions.onAdded below starts the registration as soon as
	// the permission is granted, without having to restart the extension.
	/** @type {Functions.Background.hasPageInjectionAccess} */
	async function hasPageInjectionAccess() {
		try {
			return await chrome.permissions.contains(base.PAGE_ACCESS_PERMISSIONS);
		} catch (err) {
			console.error("Nelze zjistit oprávnění scripting/<all_urls>:", err);
			return false;
		}
	}

	// --- Dynamic registration of module content scripts ---
	//
	// An alternative to the static list in manifest.json (content_scripts): for
	// each module from the current list (modules.json, possibly edited by
	// the user through options) it checks whether the file
	// modules/<name>/content-script.js exists, and if so and it is not
	// registered yet, registers it through chrome.scripting.registerContentScripts.
	// A new module with its own content-script.js is thus activated without editing
	// the manifest — it is enough to add it to modules.json. A module that has the scripts in pages
	// turned off by its own setting (PAGE_SCRIPTS_FIELD, see
	// base.mjs) is skipped and its earlier registration is cancelled.
	//
	// The extension is .js (not .mjs) on purpose: a content script is a classic script without
	// top-level import/export (it loads base.mjs with a dynamic import()), which
	// matches the rule in validateModuleFileExtension() in base.mjs.
	//
	// A drawback compared to a static declaration: the registration runs asynchronously only after
	// startup/installation (and only after the permission is granted, see above), so there is
	// a short window when a page opened right after the browser starts may not
	// get the content script yet.

	/** @type {Functions.Background.resourceExists} */
	async function resourceExists(path) {
		try {
			const res = await fetch(chrome.runtime.getURL(path));
			if (!res.ok) {
				return false;
			}
			// For a nonexistent extension file, Firefox first returns 200 OK and
			// fails only when reading the body (AbortError), Chrome already on fetch() itself.
			// Without reading the body, Firefox would register "phantom"
			// content scripts even for modules that have none.
			await res.arrayBuffer();
			return true;
		} catch {
			return false;
		}
	}

	/** @type {Functions.Background.discoverAndRegisterModuleContentScripts} */
	async function discoverAndRegisterModuleContentScripts() {
		if (!chrome.scripting || !chrome.scripting.registerContentScripts) {
			console.warn("chrome.scripting.registerContentScripts není v tomto prohlížeči dostupné.");
			return;
		}
		if (!(await hasPageInjectionAccess())) {
			// The permission has not been granted yet — nothing is registered until the
			// user grants it (see hasPageInjectionAccess above). It is not an error,
			// just a feature not available yet.
			return;
		}

		const controller = new base.BaseController();
		let modulePaths;
		try {
			const jsonText = await controller.getModulesJson();
			modulePaths = JSON.parse(jsonText);
			if (!Array.isArray(modulePaths)) {
				throw new Error("modules.json musí být pole řetězců");
			}
		} catch (err) {
			console.error("Nelze načíst seznam modulů pro registraci content scriptů:", err);
			return;
		}

		const settings = await controller.loadSettings();

		let registeredById;
		try {
			registeredById = new Map(
				(await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s])
			);
		} catch (err) {
			console.error("Nelze zjistit už zaregistrované content scripty:", err);
			return;
		}

		/** @type {chrome.scripting.RegisteredContentScript[]} */
		const toRegister = [];
		/** @type {chrome.scripting.RegisteredContentScript[]} */
		const toUpdate = [];
		// Ids that should stay registered after this run (the module is in
		// modules.json, does not have the scripts in pages turned off AND still has
		// content-script.js on disk) — see the cleanup of orphaned registrations below (e.g. after
		// deleting content-script.js of a module that itself still exists, like
		// bookmarkChecker after switching to the icon instead of a label on the page).
		const expectedIds = new Set();

		// Each module only once — a module with multiple instances has several entries
		// in the list (see parseModuleEntry() in base.mjs), but only one set of scripts.
		for (const folderName of new Set(modulePaths.map((path) => base.getModuleKey(path)))) {
			const contentScriptPath = `modules/${folderName}/content-script.js`;
			const registered = registeredById.get(folderName);

			if (!base.arePageScriptsEnabled(settings, folderName)) {
				continue;
			}

			// The registration survives a browser restart (persistAcrossSessions) — if
			// the content script were renamed or moved in the meantime (most recently
			// content-script.mjs -> content-script.js), the old, no longer
			// existing path would stay in it and the script would stop being injected into pages. So for an
			// already registered module the stored path is compared with the expected one and
			// fixed if needed.
			if (registered && (registered.js || []).includes(contentScriptPath)) {
				expectedIds.add(folderName);
				continue;
			}

			if (!(await resourceExists(contentScriptPath))) {
				continue;
			}

			expectedIds.add(folderName);
			await base.validateModuleFileExtension(contentScriptPath);

			(registered ? toUpdate : toRegister).push({
				id: folderName,
				js: [contentScriptPath],
				matches: ["<all_urls>"],
				runAt: "document_idle",
			});
		}

		// Orphaned registrations: an id this function manages (recognized by its
		// own path ".../content-script.js" — so it does not touch the id of the floating window
		// or of the MAIN-world scripts, see their own registration functions), but
		// whose module has either disappeared from modules.json, turned off its scripts in pages
		// (PAGE_SCRIPTS_FIELD), or its content-script.js has meanwhile disappeared from disk
		// (typically because the feature was taken over by another mechanism, like the icon badge
		// for bookmarkChecker).
		const toUnregister = [...registeredById.entries()]
			.filter(([id, reg]) => !expectedIds.has(id) && (reg.js || []).some((f) => f.endsWith("/content-script.js")))
			.map(([id]) => id);

		if (toUnregister.length > 0 && chrome.scripting.unregisterContentScripts) {
			try {
				await chrome.scripting.unregisterContentScripts({ ids: toUnregister });
				console.log("Odregistrované content scripty modulů (odebraných, bez souboru nebo s vypnutými skripty ve stránkách):", toUnregister.join(", "));
			} catch (err) {
				console.error("Odregistrace osiřelých content scriptů modulů selhala:", err);
			}
		}

		if (toUpdate.length > 0 && chrome.scripting.updateContentScripts) {
			try {
				await chrome.scripting.updateContentScripts(toUpdate);
				console.log(
					"Opravená cesta zaregistrovaných content scriptů modulů:",
					toUpdate.map((s) => s.id).join(", ")
				);
			} catch (err) {
				console.error("Oprava zaregistrovaných content scriptů modulů selhala:", err);
			}
		}

		if (toRegister.length > 0) {
			try {
				await chrome.scripting.registerContentScripts(toRegister);
				console.log(
					"Dynamicky zaregistrované content scripty modulů:",
					toRegister.map((s) => s.id).join(", ")
				);
			} catch (err) {
				console.error("Registrace content scriptů modulů selhala:", err);
			}
		}
	}

	// --- Dynamic registration of module MAIN-world scripts ---
	//
	// The same principle as for the regular (isolated) content scripts above, just for
	// modules that need to intervene in the page BEFORE its own JS manages to
	// run — e.g. visualHistory has to wrap
	// history.pushState()/replaceState() before the page manages to use them. Such a
	// file has the fixed name main-world-script.js (not content-script.js) and
	// is registered into the MAIN world (the page context, not the isolated world of content
	// scripts) and with "document_start" instead of "document_idle".
	//
	// The second variant, main-world-domain-script.js, is registered the same way, but only
	// for domains from the list in the module settings (MAIN_WORLD_DOMAINS_FIELD, see
	// base.mjs) and into all frames — nowhere without the list. The list must be part of the
	// registration (matches), not a decision of the script itself: a MAIN-world script
	// cannot read the settings and an isolated content script only asynchronously,
	// i.e. only after the page would have managed to run its own JS.
	//
	// A MAIN-world script has no access to the chrome.* API (see the comment in
	// modules/visualHistory/main-world-script.js) — so it cannot check by itself
	// either its own activation mode or PAGE_ACCESS_PERMISSIONS. Unlike
	// the regular content scripts above (those are registered regardless of the module's activation
	// mode and handle their behavior themselves through api.settings.getMode()),
	// an explicitly turned-off module (mode "disabled") is therefore not registered at all
	// here — and if it was registered before, it is unregistered again. The same
	// happens to a module with the scripts in pages turned off (PAGE_SCRIPTS_FIELD).
	// background.js watches changes of the activation mode, the domain list and PAGE_SCRIPTS_FIELD
	// (see chrome.storage.onChanged at scheduleDiscovery()
	// below), but they take effect only on the next page load, not on pages
	// already open.
	/** @type {Types.MainWorldScriptVariant[]} */
	const MAIN_WORLD_SCRIPT_VARIANTS = [
		{ file: "main-world-script.js", idSuffix: "-main", domainRestricted: false },
		{ file: "main-world-domain-script.js", idSuffix: "-main-domain", domainRestricted: true },
	];

	/** @type {Functions.Background.mainWorldScriptId} */
	function mainWorldScriptId(folderName, variant = MAIN_WORLD_SCRIPT_VARIANTS[0]) {
		return /** @type {Types.MainWorldScriptId} */ (`${folderName}${variant.idSuffix}`);
	}

	/** @type {Functions.Background.isMainWorldScriptRegistration} */
	function isMainWorldScriptRegistration(registration) {
		return (registration.js || []).some((f) => MAIN_WORLD_SCRIPT_VARIANTS.some((v) => f.endsWith(`/${v.file}`)));
	}

	// Does the registered script differ from the requested one so that it needs to be
	// updated (a different path, different domains, different frames)?
	/** @type {Functions.Background.isSameRegistration} */
	function isSameRegistration(registered, desired) {
		const sorted = (/** @type {string[] | undefined} */ list) => JSON.stringify([...(list || [])].sort());
		return (
			sorted(registered.js) === sorted(desired.js) &&
			sorted(registered.matches) === sorted(desired.matches) &&
			!!registered.allFrames === !!desired.allFrames
		);
	}

	// registerContentScripts()/updateContentScripts() with matchOriginAsFallback —
	// a browser that does not know this (newer) property rejects the WHOLE call. Then
	// it is tried again without it: the script will run at least in frames with the domain's own
	// address, just not in about:blank/srcdoc frames.
	/** @type {Functions.Background.withMatchOriginFallback} */
	async function withMatchOriginFallback(call, scripts) {
		try {
			await call(scripts);
		} catch (err) {
			if (!scripts.some((s) => s.matchOriginAsFallback)) throw err;
			console.warn("matchOriginAsFallback není podporované, registruji bez něj:", err);
			await call(scripts.map(({ matchOriginAsFallback: _unused, ...rest }) => rest));
		}
	}

	/** @type {Functions.Background.discoverAndRegisterMainWorldScripts} */
	async function discoverAndRegisterMainWorldScripts() {
		if (!chrome.scripting || !chrome.scripting.registerContentScripts) {
			return;
		}
		if (!(await hasPageInjectionAccess())) {
			return;
		}

		const controller = new base.BaseController();
		let modulePaths;
		try {
			const jsonText = await controller.getModulesJson();
			modulePaths = JSON.parse(jsonText);
			if (!Array.isArray(modulePaths)) {
				throw new Error("modules.json musí být pole řetězců");
			}
		} catch (err) {
			console.error("Nelze načíst seznam modulů pro registraci MAIN-world skriptů:", err);
			return;
		}

		const settings = await controller.loadSettings();

		let registeredById;
		try {
			registeredById = new Map(
				(await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s])
			);
		} catch (err) {
			console.error("Nelze zjistit už zaregistrované content scripty:", err);
			return;
		}

		/** @type {chrome.scripting.RegisteredContentScript[]} */
		const toRegister = [];
		/** @type {chrome.scripting.RegisteredContentScript[]} */
		const toUpdate = [];
		/** @type {string[]} */
		const toUnregister = [];
		// Ids that should stay registered after this run — see the cleanup of
		// orphaned registrations after the loop.
		const expectedIds = new Set();

		// Each module only once (see the registration of content scripts above).
		for (const folderName of new Set(modulePaths.map((path) => base.getModuleKey(path)))) {
			for (const variant of MAIN_WORLD_SCRIPT_VARIANTS) {
				const scriptPath = `modules/${folderName}/${variant.file}`;
				const id = mainWorldScriptId(folderName, variant);
				const registered = registeredById.get(id);
				const matches = variant.domainRestricted ? await base.getMainWorldMatches(settings, folderName) : ["<all_urls>"];

				// A module explicitly turned off by the user (see the comment above), a module
				// with the scripts in pages turned off, or a script restricted to domains
				// with an empty list — if it was registered before, it is now
				// unregistered.
				if (settings[folderName] === "disabled" || !base.arePageScriptsEnabled(settings, folderName) || matches.length === 0) {
					if (registered) {
						toUnregister.push(id);
					}
					continue;
				}

				/** @type {chrome.scripting.RegisteredContentScript} */
				const desired = {
					id,
					js: [scriptPath],
					matches,
					runAt: "document_start",
					world: "MAIN",
					...(variant.domainRestricted ? { allFrames: true, matchOriginAsFallback: true } : {}),
				};

				if (registered && isSameRegistration(registered, desired)) {
					expectedIds.add(id);
					continue;
				}

				if (!(await resourceExists(scriptPath))) {
					continue;
				}

				expectedIds.add(id);
				await base.validateModuleFileExtension(scriptPath);

				(registered ? toUpdate : toRegister).push(desired);
			}
		}

		// Orphaned registrations (the same principle as for content scripts above): an id
		// with its own path ".../main-world-script.js" (or
		// ".../main-world-domain-script.js") whose module has meanwhile disappeared
		// from modules.json, was renamed (a new folder = a new id) or lost
		// its file — otherwise a registration with an old, no longer existing path would
		// survive browser restarts (persistAcrossSessions).
		for (const [id, reg] of registeredById) {
			if (!expectedIds.has(id) && !toUnregister.includes(id) && isMainWorldScriptRegistration(reg)) {
				toUnregister.push(id);
			}
		}

		if (toUnregister.length > 0 && chrome.scripting.unregisterContentScripts) {
			try {
				await chrome.scripting.unregisterContentScripts({ ids: toUnregister });
				console.log("Odregistrované MAIN-world skripty vypnutých/odebraných modulů:", toUnregister.join(", "));
			} catch (err) {
				console.error("Odregistrace MAIN-world skriptů vypnutých modulů selhala:", err);
			}
		}

		if (toUpdate.length > 0 && chrome.scripting.updateContentScripts) {
			try {
				await withMatchOriginFallback((scripts) => chrome.scripting.updateContentScripts(scripts), toUpdate);
				console.log(
					"Aktualizované zaregistrované MAIN-world skripty:",
					toUpdate.map((s) => s.id).join(", ")
				);
			} catch (err) {
				console.error("Aktualizace zaregistrovaných MAIN-world skriptů selhala:", err);
			}
		}

		if (toRegister.length > 0) {
			try {
				await withMatchOriginFallback((scripts) => chrome.scripting.registerContentScripts(scripts), toRegister);
				console.log(
					"Dynamicky zaregistrované MAIN-world skripty modulů:",
					toRegister.map((s) => s.id).join(", ")
				);
			} catch (err) {
				// Most often because the browser does not support world: "MAIN" in
				// registerContentScripts yet (a newer API) — a module
				// without this registration simply does not work, the rest of the extension does.
				console.error("Registrace MAIN-world skriptů selhala:", err);
			}
		}
	}

	// --- Dynamic registration of the floating window ---
	//
	// The same principle as for module content scripts above, just hard-coded for one
	// file (content-scripts/floating-window.js) — formerly it was a static
	// content_scripts entry in the manifest, which however required <all_urls> in the
	// required host_permissions. For scripting/<all_urls> to be
	// optional (see the manifest), this too has to be injected dynamically and wait for
	// hasPageInjectionAccess() the same as module content scripts.
	// Chrome rejects a content script ID starting with an underscore ("Invalid
	// content script id") — it is reserved for internally generated IDs.
	const FLOATING_WINDOW_SCRIPT_ID = "extensionFloatingWindow";

	/** @type {Functions.Background.registerFloatingWindowContentScript} */
	async function registerFloatingWindowContentScript() {
		if (!chrome.scripting || !chrome.scripting.registerContentScripts) {
			return;
		}
		if (!(await hasPageInjectionAccess())) {
			return;
		}

		let registered;
		try {
			registered = new Map(
				(await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s])
			);
		} catch (err) {
			console.error("Nelze zjistit už zaregistrované content scripty:", err);
			return;
		}

		if (registered.has(FLOATING_WINDOW_SCRIPT_ID)) {
			return;
		}

		try {
			await chrome.scripting.registerContentScripts([
				{
					id: FLOATING_WINDOW_SCRIPT_ID,
					js: [base.FLOATING_WINDOW_SCRIPT],
					matches: ["<all_urls>"],
					runAt: "document_idle",
				},
			]);
			console.log(`Zaregistrováno plovoucí okno (${base.FLOATING_WINDOW_SCRIPT}).`);
		} catch (err) {
			console.error("Registrace plovoucího okna selhala:", err);
		}
	}

	// --- Module load measurement (api.perf, see perf.mjs) ---
	//
	// Reports of all contexts (content scripts, extension pages and this
	// background itself through setPerfSink()) are merged into one overview in
	// memory, which is saved at most once per PERF_SAVE_DELAY_MS into its own
	// IndexedDB (perf.PERF_DB_NAME) — the service worker reloads what applied after going to sleep.
	// Operations are queued one after another (perfQueue). The report context is determined by the sender,
	// not by the report itself: a content script is always "page" (the domain is taken from the
	// tab), an extension page must not report "page" or "background".
	//
	// Module values are also credited to their activation modes — the modes (and the measurement
	// time in them, perf.advancePerfModes()) are maintained by checkPerfSwitch() below according to
	// the settings and the module list.
	const PERF_SAVE_DELAY_MS = 5000;
	// Id of the browser run in chrome.storage.session — a browser restart (and reloading
	// the extension) empties it, the service worker going to sleep keeps it.
	// It tells the time when the browser was not running (perf.resumePerfModes()).
	const PERF_BOOT_KEY = "perfBootId";
	/** @type {Types.PerfStats | null} */
	let perfStats = null;
	/** @type {Promise<unknown>} */
	let perfQueue = Promise.resolve();
	let perfSaveScheduled = false;
	/** @type {Promise<string> | null} */
	let perfBootPromise = null;

	// "" without chrome.storage.session — the time when the browser was not running is then
	// not recognized and is counted.
	/** @type {Functions.Background.getPerfBootId} */
	function getPerfBootId() {
		if (!perfBootPromise) {
			perfBootPromise = (async () => {
				const stored = await chrome.storage.session.get(PERF_BOOT_KEY);
				const current = stored[PERF_BOOT_KEY];
				if (typeof current === "string" && current) return current;
				const id = crypto.randomUUID();
				await chrome.storage.session.set({ [PERF_BOOT_KEY]: id });
				return id;
			})().catch(() => "");
		}
		return perfBootPromise;
	}

	/** @type {Functions.Background.withPerfStats} */
	function withPerfStats(fn) {
		const run = perfQueue.then(async () => {
			if (!perfStats) {
				try {
					perfStats = await perf.loadPerfStats();
				} catch (err) {
					console.error("Nelze načíst přehled měření zátěže:", err);
				}
				if (!perfStats) perfStats = perf.createPerfStats(Date.now());
				if (perf.resumePerfModes(perfStats, await getPerfBootId(), Date.now())) schedulePerfSave();
			}
			return fn(perfStats);
		});
		perfQueue = run.catch(() => {});
		return run;
	}

	/** @type {Functions.Background.savePerfStatsNow} */
	function savePerfStatsNow() {
		return withPerfStats((stats) => perf.savePerfStats(stats)).catch((err) => console.error("Nelze uložit přehled měření zátěže:", err));
	}

	// A timer without the measurement hook (perf.perfTimeout()) — saving the measured
	// values is not measured itself, otherwise reporting and saving would alternate forever.
	/** @type {Functions.Background.schedulePerfSave} */
	function schedulePerfSave() {
		if (perfSaveScheduled) return;
		perfSaveScheduled = true;
		perf.perfTimeout(() => {
			perfSaveScheduled = false;
			savePerfStatsNow();
		}, PERF_SAVE_DELAY_MS);
	}

	/** @type {Functions.Background.mergePerf} */
	function mergePerf(report, context, domain) {
		withPerfStats((stats) => perf.mergePerfReport(stats, report, { context, domain, now: Date.now() })).catch((err) =>
			console.error("Nelze sloučit hlášení měření zátěže:", err)
		);
		schedulePerfSave();
	}

	perf.setPerfSink((report) => mergePerf(report, "background", null));

	addCoreMessageListener((message, sender, sendResponse) => {
		if (message.type === perf.PERF_REPORT_MESSAGE) {
			const report = perf.sanitizePerfReport(message.report);
			if (!report) return;
			const fromExtensionPage = isExtensionPageSender(sender);
			/** @type {Enums.PerfContext} */
			const context = !fromExtensionPage ? "page" : report.context === "page" || report.context === "background" ? "extension" : report.context;
			const domain = !fromExtensionPage && sender.tab ? base.getDomainKey(sender.tab.url) : null;
			mergePerf(report, context, domain);
			return;
		}

		// Overview for display — only for extension pages: it contains the domains
		// the user has visited.
		if (message.type === perf.PERF_GET_MESSAGE) {
			if (!isExtensionPageSender(sender)) {
				sendResponse({ snapshot: null });
				return true;
			}
			// First what the background itself has not reported yet.
			perf.flushPerf();
			withPerfStats((stats) => perf.buildPerfSnapshot(stats, message.domain, Date.now())).then(
				(snapshot) => sendResponse({ snapshot }),
				(err) => {
					console.error("Nelze sestavit přehled měření zátěže:", err);
					sendResponse({ snapshot: null });
				}
			);
			return true;
		}

		if (message.type === perf.PERF_RESET_MESSAGE) {
			if (!isExtensionPageSender(sender)) {
				sendResponse({ ok: false });
				return true;
			}
			withPerfStats((previous) => {
				const now = Date.now();
				perfStats = perf.createPerfStats(now);
				// Measuring continues in the same modes — the measurement time in them from now on.
				const clock = previous.modeClock;
				if (clock.at !== null) perf.advancePerfModes(perfStats, now, clock.modes, clock.boot);
				return perf.savePerfStats(perfStats);
			}).then(
				() => sendResponse({ ok: true }),
				(err) => {
					console.error("Nelze vynulovat přehled měření zátěže:", err);
					sendResponse({ ok: false });
				}
			);
			return true;
		}
	});

	// Advances the mode clock (perf.advancePerfModes()): modes = the modules' current
	// activation modes, null = not measuring.
	/** @type {Functions.Background.updatePerfModes} */
	async function updatePerfModes(modes) {
		const boot = await getPerfBootId();
		await withPerfStats((stats) => {
			if (perf.advancePerfModes(stats, Date.now(), modes, boot)) schedulePerfSave();
		});
	}

	// Turns the measurement off when the module that turned it on (the owner of the switch) has disappeared
	// from the module list or is turned off — nobody would see the results and it would keep
	// measuring. The same principle as for the api.networkRules rules above. An unreadable
	// module list leaves the switch as it is. With the measurement on it passes the current
	// activation modes of the modules from the list to the overview, with it off it stops the mode
	// clock — but without the switch only after its change or with the overview already
	// loaded (a service worker start without measurement does not open the database).
	/** @type {Functions.Background.checkPerfSwitch} */
	async function checkPerfSwitch(switchChanged = false) {
		const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get([perf.PERF_STATE_KEY, base.SETTINGS_KEY]));
		const entry = stored[perf.PERF_STATE_KEY];
		if (entry === undefined) {
			if (switchChanged || perfStats) await updatePerfModes(null);
			return;
		}
		let active = false;
		/** @type {Record<string, string>} */
		let modes = {};
		if (perf.isPerfSwitch(entry)) {
			try {
				const paths = JSON.parse(await new base.BaseController().getModulesJson());
				const entries = Array.isArray(paths) ? paths.filter((path) => typeof path === "string").map((path) => base.parseModuleEntry(path)) : [];
				const settings = stored[base.SETTINGS_KEY] || {};
				const listed = entries.some((item) => item.name === entry.owner);
				const mode = base.getModuleMode(settings, entry.owner, entry.defaultMode);
				active = listed && !base.DISABLED_SPEC.isSatisfiedBy({ mode });
				modes = perf.perfModesFromEntries(
					entries,
					settings,
					base.ACTIVATION_MODES.map((option) => option.value)
				);
			} catch (err) {
				console.error("Nelze ověřit vlastníka měření zátěže:", err);
				return;
			}
		}
		// Deleting the switch triggers a storage change and with it stopping the clock.
		if (!active) await chrome.storage.local.remove(perf.PERF_STATE_KEY);
		else await updatePerfModes(modes);
	}

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && (changes[base.SETTINGS_KEY] || changes[base.MODULES_JSON_KEY] || changes[perf.PERF_STATE_KEY])) {
			checkPerfSwitch(!!changes[perf.PERF_STATE_KEY]).catch((err) => console.error("Kontrola přepínače měření zátěže selhala:", err));
		}
	});
	checkPerfSwitch().catch((err) => console.error("Kontrola přepínače měření zátěže selhala:", err));

	// Before going to sleep (Firefox background page, Chrome service worker) save
	// right away, not only after PERF_SAVE_DELAY_MS.
	if (chrome.runtime.onSuspend) {
		chrome.runtime.onSuspend.addListener(() => {
			if (perfStats) savePerfStatsNow();
		});
	}

	// --- A green dot in the icon while the service worker/background runs ---
	//
	// In MV3, Chrome puts the service worker to sleep after ~30 s of inactivity and wakes it up again only
	// on the next relevant event (a message, an alarm, a click on the icon, ...) —
	// this indicator can be watched in real time right in the browser toolbar.
	// It is drawn through OffscreenCanvas (a service worker has no <canvas>/document,
	// but OffscreenCanvas is available there too) — the original icon.png is loaded,
	// drawn unchanged, and only in the active state a small green dot with a soft
	// (transparent) edge through createRadialGradient() is added to the bottom left
	// corner. In Firefox (where the background RUNS as a plain
	// script, not a service worker, see the comment at the beginning of the file) it will be
	// green practically permanently — which meaningfully reflects that the same
	// "going to sleep" does not happen there.
	//
	// iconDrawPromise chains the calls, so that two in quick succession (typically
	// onSuspend immediately followed by onSuspendCanceled, when the browser cancels going to sleep
	// in the meantime) really end in the right ORDER OF REQUESTS, not in the
	// order in which their async work (fetch/decode) happens to finish.
	/** @type {Promise<void>} */
	let iconDrawPromise = Promise.resolve();
	/** @type {Functions.Background.updateExtensionIcon} */
	function updateExtensionIcon(active) {
		iconDrawPromise = iconDrawPromise.catch(() => {}).then(() => drawExtensionIcon(active));
		return iconDrawPromise;
	}

	/** @type {Functions.Background.drawExtensionIcon} */
	async function drawExtensionIcon(active) {
		if (!chrome.action || !chrome.action.setIcon || typeof OffscreenCanvas === "undefined") {
			return;
		}
		try {
			const response = await fetch(chrome.runtime.getURL("icon.png"));
			const bitmap = await createImageBitmap(await response.blob());
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			// The 2D context of an OffscreenCanvas is always available (null only for an unsupported type).
			const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext("2d"));
			ctx.drawImage(bitmap, 0, 0);

			if (active) {
				// The given size (~9 px) applies to the icon shown at 32 px
				// (the common size in the browser toolbar on displays with higher
				// resolution) — converted by the ratio to the real size of the
				// source image (icon.png, 256×256), so the dot looks the same
				// size regardless of what size the browser is currently
				// scaling it to.
				const scale = bitmap.width / 32;
				const radius = (9 / 2) * scale;
				const margin = radius * 0.6;
				const cx = margin + radius;
				const cy = bitmap.height - margin - radius;

				const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
				gradient.addColorStop(0, "rgba(30, 180, 70, 1)");
				gradient.addColorStop(0.7, "rgba(30, 180, 70, 1)");
				gradient.addColorStop(1, "rgba(30, 180, 70, 0)");

				ctx.fillStyle = gradient;
				ctx.beginPath();
				ctx.arc(cx, cy, radius, 0, Math.PI * 2);
				ctx.fill();
			}

			await chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) });
		} catch (err) {
			console.error("Překreslení ikonky rozšíření (indikátor běžícího service workeru) selhalo:", err);
		}
	}

	if (chrome.runtime.onSuspend) {
		chrome.runtime.onSuspend.addListener(() => {
			updateExtensionIcon(false);
		});
	}
	if (chrome.runtime.onSuspendCanceled) {
		chrome.runtime.onSuspendCanceled.addListener(() => {
			updateExtensionIcon(true);
		});
	}
	// Evaluating this file FROM THE BEGINNING (this line) is exactly the
	// moment the service worker/background script starts running — that is why
	// the active state is set right here (not in some later handler).
	updateExtensionIcon(true);

	// --- Coloring the extension icon by bookmarks ---
	//
	// Generic application of the rules from createModuleApi().badge (see base.mjs and
	// sdk.mjs): the core here does not know the name of any specific module, it just reads
	// BADGE_RULES_KEY ({ [module name]: [{ folderId, color, text }] }) and for the
	// URL of A SPECIFIC TAB (it arrives in the PAGE_URL_MESSAGE message, see below and
	// base.mjs) finds through bookmarkFolderContainsUrl (a generic pass over
	// chrome.bookmarks) the first matching rule across all modules (in the order
	// in which they are in BADGE_RULES_KEY — the first match wins). The only current
	// module that writes rules is bookmarkChecker.
	//
	// "bookmarks" is an optional permission (see BOOKMARKS_PERMISSIONS) — without it
	// the icon is just cleared, the same as for tabs without an http(s) URL (new
	// empty tabs, chrome:// pages, ...).
	/** @type {Functions.Background.hasBookmarksAccess} */
	async function hasBookmarksAccess() {
		try {
			return await chrome.permissions.contains({ permissions: ["bookmarks"] });
		} catch (err) {
			console.error("Nelze zjistit oprávnění bookmarks:", err);
			return false;
		}
	}

	/** @type {Functions.Background.clearBadge} */
	async function clearBadge(tabId) {
		try {
			await chrome.action.setBadgeText({ tabId, text: "" });
		} catch {
			// The tab may have disappeared in the meantime — harmless.
		}
	}

	// bookmarkUrls: other addresses under which the page may be saved as a
	// bookmark (see PAGE_URL_MESSAGE in base.mjs) — the rule applies to them too.
	/** @type {Functions.Background.updateBadgeForTab} */
	async function updateBadgeForTab(tabId, url, bookmarkUrls = []) {
		if (!chrome.action || !chrome.bookmarks || !tabId) {
			return;
		}
		if (!url || !/^https?:/i.test(url) || !(await hasBookmarksAccess())) {
			await clearBadge(tabId);
			return;
		}

		let allRules;
		try {
			allRules = await new Promise((resolve) => {
				chrome.storage.local.get([base.BADGE_RULES_KEY], (result) => resolve(result[base.BADGE_RULES_KEY] || {}));
			});
		} catch (err) {
			console.error("Nelze načíst pravidla pro ikonku:", err);
			return;
		}

		const rules = Object.values(allRules).flat();
		for (const rule of rules) {
			if (!rule || !rule.folderId) continue;
			if (await base.bookmarkFolderContainsUrl(rule.folderId, [url, ...(Array.isArray(bookmarkUrls) ? bookmarkUrls : [])])) {
				try {
					await chrome.action.setBadgeBackgroundColor({ tabId, color: rule.color || "#808080" });
					await chrome.action.setBadgeText({ tabId, text: rule.text || "" });
				} catch (err) {
					console.error("Nastavení barvy ikonky selhalo:", err);
				}
				return;
			}
		}

		await clearBadge(tabId);
	}

	// The Chrome badge is state TIED TO A SPECIFIC tabId (once set it stays
	// shown, even when switching between tabs) — so it is enough to set it
	// whenever we learn which URL a specific tab is on (see
	// PAGE_URL_MESSAGE above), not to keep recomputing it for the "active tab"
	// (chrome.tabs.onActivated/onUpdated would not give a reliable tab.url anyway without the "tabs"
	// permission, see the comment at PAGE_URL_MESSAGE in base.mjs).
	addCoreMessageListener((message, sender) => {
		if (message.type === base.PAGE_URL_MESSAGE) {
			const tabId = message.tabId ?? (sender.tab && sender.tab.id);
			if (tabId) {
				updateBadgeForTab(tabId, message.url, message.bookmarkUrls);
			}
		}
	});

	// Removing any optional permission already used to delete the registered
	// content scripts (see chrome.permissions.onRemoved below) — when removing
	// "bookmarks" there is moreover no other opportunity to clear the icons (no
	// new PAGE_URL_MESSAGE comes until the page is reloaded), so
	// ALL currently open tabs are gone through directly here. Works without
	// the "tabs" permission — chrome.tabs.query({}) returns at least the id/
	// windowId of each tab even without it, which is enough for clearing the badge.
	if (chrome.permissions && chrome.permissions.onRemoved) {
		chrome.permissions.onRemoved.addListener(async (permissions) => {
			if (!chrome.action || !(permissions.permissions || []).includes("bookmarks")) {
				return;
			}
			try {
				const tabs = await chrome.tabs.query({});
				await Promise.all(tabs.filter((tab) => tab.id).map((tab) => clearBadge(tab.id)));
			} catch (err) {
				console.error("Vyčištění ikonek po odebrání oprávnění bookmarks selhalo:", err);
			}
		});
	}

	// Overlapping calls (the script start coincides with onInstalled/
	// onStartup) would concurrently try to register the same ID and the second one
	// would fail with "Duplicate script ID" — so they are merged into one run.
	/** @type {Types.DiscoveryRun | null} */
	let discoveryRun = null;
	/** @type {Functions.Background.scheduleDiscovery} */
	function scheduleDiscovery() {
		if (!discoveryRun) {
			discoveryRun = Promise.all([
				discoverAndRegisterModuleContentScripts(),
				registerFloatingWindowContentScript(),
				discoverAndRegisterMainWorldScripts(),
			]).finally(() => {
				discoveryRun = null;
			});
		}
		return discoveryRun;
	}

	// A change of settings the registration of module scripts in pages depends on
	// (a module's activation mode — a bare name without a dot —, the domain list
	// MAIN_WORLD_DOMAINS_FIELD or the PAGE_SCRIPTS_FIELD switch, see
	// discoverAndRegisterModuleContentScripts() and
	// discoverAndRegisterMainWorldScripts()) starts the registration again right away, not
	// only at the next wake-up of the service worker. If another pass is running at the moment,
	// it may have read the settings before the change — so a new one is scheduled only after
	// it finishes.
	chrome.storage.onChanged.addListener((changes, area) => {
		const change = changes[base.SETTINGS_KEY];
		if (area !== "local" || !change) return;
		const before = /** @type {Types.ModuleSettings} */ (change.oldValue || {});
		const after = /** @type {Types.ModuleSettings} */ (change.newValue || {});
		const affectsRegistration = [...new Set([...Object.keys(before), ...Object.keys(after)])].some(
			(key) =>
				(!key.includes(".") ||
					key.endsWith(`.${base.MAIN_WORLD_DOMAINS_FIELD}`) ||
					key.endsWith(`.${base.MAIN_WORLD_BOOKMARK_FOLDERS_FIELD}`) ||
					key.endsWith(`.${base.PAGE_SCRIPTS_FIELD}`)) &&
				JSON.stringify(before[key]) !== JSON.stringify(after[key])
		);
		if (!affectsRegistration) return;
		(discoveryRun || Promise.resolve()).finally(() => scheduleDiscovery());
	});

	// The domains of main-world-domain-script.js also come from bookmark folders
	// (MAIN_WORLD_BOOKMARK_FOLDERS_FIELD, see base.mjs) — a bookmark change registers it
	// again. An import or a moved folder fires a burst of events, hence the wait.
	// chrome.bookmarks exists only with the "bookmarks" permission — the listeners are
	// attached also after it is granted (chrome.permissions.onAdded below).
	const BOOKMARK_DISCOVERY_DELAY_MS = 1000;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let bookmarkDiscoveryTimer;
	let bookmarkListenersAttached = false;
	/** @type {Functions.Background.attachBookmarkDiscoveryListeners} */
	function attachBookmarkDiscoveryListeners() {
		if (bookmarkListenersAttached || !chrome.bookmarks) return;
		bookmarkListenersAttached = true;
		const onBookmarksChanged = () => {
			clearTimeout(bookmarkDiscoveryTimer);
			bookmarkDiscoveryTimer = setTimeout(() => {
				(discoveryRun || Promise.resolve()).finally(() => scheduleDiscovery());
			}, BOOKMARK_DISCOVERY_DELAY_MS);
		};
		for (const event of [
			chrome.bookmarks.onCreated,
			chrome.bookmarks.onRemoved,
			chrome.bookmarks.onChanged,
			chrome.bookmarks.onMoved,
			chrome.bookmarks.onImportEnded,
		]) {
			if (event) event.addListener(onBookmarksChanged);
		}
	}
	attachBookmarkDiscoveryListeners();

	// After the extension is installed and updated, moves the entries and settings of modules
	// the extension replaced over to their successors (base.migrateRenamedModules():
	// contentDivider → contentDividerSandbox, mainButtons → mainButtonsSandbox, floatingWindowOverview →
	// floatingWindowOverviewSandbox, adBlocker → adBlockerSandbox, youtubeAdBlocker → youtubeAdBlockerSandbox, domainDetails →
	// domainDetailsSandbox, storageInfo → storageInfoSandbox) and the values of settings that became shared over to the
	// shared keys (base.migrateSharedSettings(): saving data and the probability of loading of contactsModule and
	// domainInfo), fills in the default settings of the
	// module list entries (default-settings.json, only missing values — see
	// BaseController.seedDefaultSettings()) and only then calls the
	// api.activation.onInstalled() listeners of module background parts: a module that after
	// installation opens an extension page (onboardingModule) thus does not start before
	// the settings are ready. A write error does not stop the listeners. The uploaded modules
	// the extension brings itself are installed by the first extension page that needs them
	// (base.ensureBundledSandboxModules() — it evaluates them in a sandbox <iframe>, which the
	// service worker cannot create).
	/** @type {Functions.Background.handleInstalled} */
	async function handleInstalled(details) {
		if (details.reason === "install" || details.reason === "update") {
			try {
				await base.migrateRenamedModules();
			} catch (err) {
				console.error("Přejmenované moduly se nepodařilo převést:", err);
			}
			try {
				await base.migrateSharedSettings();
			} catch (err) {
				console.error("Sdílená nastavení modulů se nepodařilo převést:", err);
			}
			try {
				const controller = new base.BaseController();
				const paths = JSON.parse(await controller.getModulesJson());
				if (!Array.isArray(paths)) {
					throw new Error("modules.json musí být pole řetězců");
				}
				await controller.seedDefaultSettings(paths);
			} catch (err) {
				console.error("Výchozí nastavení modulů se nepodařilo zapsat:", err);
			}
		}
		base.notifyInstalled(details);
	}

	chrome.runtime.onInstalled.addListener((details) => {
		scheduleDiscovery();
		handleInstalled(details);
		// A new version of a client brings new packages — its provider learns them right away.
		base.registerWithServiceProvider(true).catch((err) => console.error("Registrace u poskytovatele služeb selhala:", err));
	});
	chrome.runtime.onStartup.addListener(() => {
		scheduleDiscovery();
		base.registerWithServiceProvider(true).catch((err) => console.error("Registrace u poskytovatele služeb selhala:", err));
	});

	// The user can grant the scripting/<all_urls> permission at any time at runtime
	// (a button in the popup/module, see base.mjs -> PAGE_ACCESS_PERMISSIONS) —
	// without this listener the registration would start only at the next
	// wake-up of the service worker, not right after the grant.
	if (chrome.permissions && chrome.permissions.onAdded) {
		chrome.permissions.onAdded.addListener(() => {
			attachBookmarkDiscoveryListeners();
			scheduleDiscovery();
		});
	}

	// Symmetrically for removal — previously registered content scripts would otherwise
	// keep hanging in the list (chrome.scripting.getRegisteredContentScripts()),
	// even though the browser stops running them. An error here is not critical
	// (injection stops working anyway), it is just logged.
	if (chrome.permissions && chrome.permissions.onRemoved) {
		chrome.permissions.onRemoved.addListener(async () => {
			if (!chrome.scripting || !chrome.scripting.unregisterContentScripts) {
				return;
			}
			try {
				await chrome.scripting.unregisterContentScripts();
			} catch (err) {
				console.error("Odregistrace content scriptů po odebrání oprávnění selhala:", err);
			}
			// Another permission (e.g. "bookmarks", which only changes the domains of
			// main-world-domain-script.js) leaves page access — the scripts are registered
			// again right away; without page access the pass ends at the start.
			(discoveryRun || Promise.resolve()).finally(() => scheduleDiscovery());
		});
	}

	// Even outside onInstalled/onStartup — in MV3 the service worker falls asleep and wakes up
	// for other reasons too (e.g. a message delivery); this makes sure missing
	// registrations are filled in as soon as possible after any wake-up. The call is
	// idempotent (see the comparison of the already registered path above) and calls that
	// overlap are merged into one (see scheduleDiscovery), so
	// running it repeatedly does no harm.
	scheduleDiscovery();
})();
