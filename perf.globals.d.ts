/**
 * @file perf.globals.d.ts
 * @description Global TypeScript declarations for perf.mjs — module load measurement: hooks on callbacks,
 * module phases and api.* calls, reporting to background.js and the overview of measured values in IndexedDB.
 */

declare global {

	namespace Enums {

		/**
		 * Where the measured code runs: page = a content script in a web page, background = background.js,
		 * extension = an extension page other than those listed (e.g. a module page).
		 */
		type PerfContext = 'page' | 'background' | 'popup' | 'sidebar' | 'floating' | 'options' | 'onboarding' | 'extension';

	}

	namespace Types {

		/** Any function (a wrapped callback or an API method). */
		type AnyFunction = ( this: unknown, ...args: unknown[] ) => unknown;

		/** Any constructor (a wrapped observer). */
		type AnyConstructor = ( new ( ...args: unknown[] ) => unknown ) & AnyFunction & { prototype: unknown };

		/** The measurement switch in chrome.storage.local (PERF_STATE_KEY) — who turned the measurement on and when. */
		type PerfSwitch = {

			/** The module that turned the measurement on (api.perf.setEnabled()) */
			owner: string;

			/** Its default activation mode — background.js has no module registry */
			defaultMode?: Enums.ActivationMode;

			/** When the measurement was turned on (Date.now()) */
			since: number;
		};

		/** Measurement state for a module (api.perf.getState()). */
		type PerfState = { enabled: boolean; since: number | null; owner: string | null };

		/** Totals of one kind of a module's callbacks (or a phase) in one context. */
		type PerfBucket = {

			/** Number of measured runs */
			calls: number;

			/** Self time on the thread (ms) — synchronous run without nested measured callbacks */
			timeMs: number;

			/** The longest single run (ms) */
			maxMs: number;

			/** Runs from PERF_FRAME_MS (16 ms) on — they delayed a frame */
			over16: number;

			/** Runs from PERF_LONG_MS (50 ms) on — long tasks */
			over50: number;

			/** Asynchronous phases (import, init(), …): the total time until settled, including waiting (ms); otherwise 0 */
			waitMs: number;
		};

		/** Totals of calls of one api.* method of a module. */
		type PerfApiBucket = { calls: number; waitMs: number; errors: number };

		/** Long frames (Long Animation Frames), otherwise long tasks of the web page. */
		type PerfLongFrames = {
			count: number;
			durationMs: number;

			/** The blocking part (blockingDuration; for long tasks the time over 50 ms) */
			blockingMs: number;
		};

		/** One kind of a module's callbacks in a report. */
		type PerfReportEntry = { module: string; kind: string } & PerfBucket;

		/** One api.* method of a module in a report. */
		type PerfReportApi = { module: string; method: string } & PerfApiBucket;

		/** Web page data in a content script report. */
		type PerfReportPage = {

			/** First report of a document (number of loaded pages) */
			newDocument: boolean;
			longFrames: PerfLongFrames;

			/** How many ms of long frames fall on the module's callbacks (overlap of times) */
			overlap: { module: string; ms: number }[];
		};

		/** A report of one context to background.js (PERF_REPORT_MESSAGE). */
		type PerfReport = {
			context: Enums.PerfContext;
			entries: PerfReportEntry[];
			api: PerfReportApi[];
			page?: PerfReportPage;
		};

		/** A module on one domain (totals of all kinds of callbacks in pages). */
		type PerfDomainModule = { calls: number; timeMs: number; maxMs: number; longFrameMs: number };

		/** One domain in the overview. */
		type PerfDomainStats = {

			/** Loaded pages (documents) with the measurement on */
			documents: number;

			/** When the last report came from here (Date.now()) */
			lastSeen: number;
			longFrames: PerfLongFrames;
			modules: Record<string, PerfDomainModule>;
		};

		/** Overview of the measured values (background.js, IndexedDB PERF_DB_NAME). */
		type PerfStats = {
			version: 1;

			/** Since when it is being summed (creation, reset) */
			since: number;
			updatedAt: number;

			/** module → context → kind → totals */
			modules: Record<string, Partial<Record<Enums.PerfContext, Record<string, PerfBucket>>>>;

			/** module → ms of long frames that fall on its callbacks (all pages) */
			longFrameMs: Record<string, number>;

			/** module → api.* method → totals */
			api: Record<string, Record<string, PerfApiBucket>>;

			/** All web pages together */
			pages: { documents: number; longFrames: PerfLongFrames };

			/** domain → totals (at most PERF_MAX_DOMAINS) */
			domains: Record<string, PerfDomainStats>;

			/** module → activation mode key → totals (see PERF_DEFAULT_MODE, perfModeKey()) */
			modes: Record<string, Record<string, PerfModeStats>>;

			/** Clock of the measurement time in the modules' current modes */
			modeClock: PerfModeClock;
		};

		/** Totals of a module in one activation mode. */
		type PerfModeStats = {

			/** How long (ms) the module had this mode with the measurement on — without the time the browser was not running */
			durationMs: number;

			/** Web pages loaded during that time */
			documents: number;

			/** context → totals of all kinds of callbacks and phases */
			contexts: Partial<Record<Enums.PerfContext, PerfBucket>>;

			/** ms of the pages' long frames that fall on the module's callbacks */
			longFrameMs: number;

			/** api.* calls together */
			api: PerfApiBucket;
		};

		/** Clock of the modes (advancePerfModes()). */
		type PerfModeClock = {

			/** Since when the measurement time runs in the modes of modes; null = not measuring */
			at: number | null;

			/** Id of the browser run in which the clock runs (resumePerfModes()) */
			boot: string;

			/** module → key of the current activation mode (modules from the module list) */
			modes: Record<string, string>;
		};

		/** A module list entry for perfModesFromEntries() (the result of parseModuleEntry()). */
		type PerfModeEntry = { name: string; key: string; instance: string | null };

		/** A domain in the overview ranking. */
		type PerfDomainSummary = { domain: string; documents: number; timeMs: number; longFrames: PerfLongFrames; lastSeen: number };

		/** Overview for display (api.perf.getStats()) — without the details of all domains. */
		type PerfSnapshot = Omit<PerfStats, 'version' | 'domains' | 'modeClock'> & {

			/** module → key of the current activation mode (from api.perf.getStats() already without PERF_DEFAULT_MODE if the module is known) */
			currentModes: Record<string, string>;

			/** How many domains the overview knows */
			domainCount: number;

			/** Domains with the highest module time */
			topDomains: PerfDomainSummary[];

			/** The requested domain in detail, or null (unknown, or none) */
			domain: ( PerfDomainStats & { name: string } ) | null;
		};

		/** api.perf — module load measurement. */
		interface ModulePerfApi {

			/** Is it measuring? Since when and who turned the measurement on */
			getState(): Promise<PerfState>;

			/** Turns the measurement in the whole extension on (the calling module is the owner) or off */
			setEnabled( enabled: boolean ): Promise<void>;

			/** On turning the measurement on/off from anywhere; returns a function to unsubscribe */
			onChange( handler: ( state: PerfState ) => void ): () => void;

			/** Overview of the measured values (domain = the domain in detail), or null */
			getStats( domain?: string | null ): Promise<PerfSnapshot | null>;

			/** Resets the overview; true = succeeded */
			reset(): Promise<boolean>;

			/** Measures a custom code section of the module (kind "measure:<label>"); returns the result of fn unchanged */
			measure<T>( label: string, fn: () => T ): T;

		}

		interface StorageLocal {
			perfMeasurement?: PerfSwitch;
		}

		interface Messages {

			/** Measured values of one context (background.js determines the page/extension context by the sender) */
			SDK_PERF_REPORT: { request: { report: PerfReport }; response: undefined };

			/** Overview for display — only from extension pages (contains the visited domains) */
			SDK_PERF_GET: { request: { domain?: string | null }; response: { snapshot: PerfSnapshot | null } };

			/** Resetting the overview — only from extension pages */
			SDK_PERF_RESET: { request: {}; response: { ok: boolean } };

		}

		/** The stack at the moment the callback is registered; the module is determined from it only on the first measured call. */
		type PerfOrigin = { module: string | null; error: Error | null };

		/** A measurement in progress — the time of nested measured callbacks (subtracted). */
		type PerfFrame = { child: number };

		/** When a web page callback ran (performance.now()) — for pairing with long frames. */
		type PerfInterval = { module: string; start: number; end: number };

		/** Web page state between reports. */
		type PerfPageState = { newDocument: boolean; longFrames: PerfLongFrames; overlap: Map<string, number> };

		/** A chrome.* event (addListener/removeListener/hasListener) as the hooks wrap it. */
		type PerfChromeEvent = {
			addListener: ( this: unknown, listener: unknown, ...rest: unknown[] ) => unknown;
			removeListener: ( this: unknown, listener: unknown ) => unknown;
			hasListener?: ( this: unknown, listener: unknown ) => unknown;
		};

		/** Measurement state in one context (realm). */
		type PerfCollector = {
			global: typeof globalThis | null;
			context: Enums.PerfContext | null;

			/** null = the switch has not been read yet (measuring in advance) */
			enabled: boolean | null;

			/** Number of switch changes (an older read does not overwrite a newer change) */
			switchVersion: number;

			/** chrome.runtime.getURL("") — module files are recognized in the stack by it */
			baseUrl: string;
			now: () => number;

			/** The original timers (the hooks do not wrap them) */
			setTimeout: ( ( task: () => void, ms: number ) => unknown ) | null;
			clearTimeout: ( ( id: unknown ) => void ) | null;
			queueMicrotask: ( task: () => void ) => void;

			/** Unreported totals: "<module>\0<kind>" → totals */
			pending: Map<string, PerfBucket>;

			/** Unreported api.* calls: "<module>\0<method>" → totals */
			pendingApi: Map<string, PerfApiBucket>;

			/** Only on a web page */
			page: PerfPageState | null;
			intervals: PerfInterval[];
			intervalNext: number;
			stack: PerfFrame[];
			flushTimer: unknown;

			/** background.js: reports of its own context go straight into the overview */
			sink: ( ( report: PerfReport ) => void ) | null;
			NativePerformanceObserver: typeof PerformanceObserver | null;
			longFrameObserver: PerformanceObserver | null;
			nativeAddEventListener: EventTarget['addEventListener'] | null;

			/** Wrapped chrome.* events → their original addListener */
			nativeAddListener: WeakMap<object, PerfChromeEvent['addListener']>;
		};

	}

	namespace Functions {

		namespace Perf {

			/** A fresh measurement state */
			type createCollector = () => Types.PerfCollector;

			/** Where the code runs (by the address of the global object); null without chrome.runtime */
			type detectPerfContext = ( global?: typeof globalThis ) => Enums.PerfContext | null;

			/** Installs the hooks (once per global object) and starts watching the switch; true = installed */
			type installPerfHooks = ( options?: { global?: typeof globalThis; context?: Enums.PerfContext; baseUrl?: string } ) => boolean;

			/** background.js: reports of its own context go straight into the overview */
			type setPerfSink = ( sink: ( ( report: Types.PerfReport ) => void ) | null ) => void;

			/** setTimeout that the hooks do not wrap (the core's work with the measurement) */
			type perfTimeout = ( task: () => void, ms: number ) => unknown;

			/** The module by the call stack (the first frame from <baseUrl>modules/<name>/), otherwise PERF_CORE */
			type perfModuleFromStack = ( stack: unknown, baseUrl: string ) => string;

			/** The stack at the moment the callback is registered */
			type captureOrigin = () => Types.PerfOrigin;

			/** The module the callback belongs to (determined once) */
			type originModule = ( origin: Types.PerfOrigin ) => string;

			/** A name shortened to MAX_NAME_LENGTH */
			type clampName = ( value: unknown ) => string;

			type emptyBucket = () => Types.PerfBucket;
			type emptyLongFrames = () => Types.PerfLongFrames;

			/** Records one measurement (nothing without hooks or with the measurement off) */
			type recordPerf = ( module: string, kind: string, timeMs: number, waitMs?: number, start?: number, end?: number ) => void;

			/** Remembers when a page callback ran (a circular queue) */
			type pushInterval = ( module: string, start: number, end: number ) => void;

			/** Runs fn and measures its self time */
			type runMeasured = ( origin: Types.PerfOrigin, kind: string, fn: Types.AnyFunction, thisArg: unknown, args: unknown[] ) => unknown;

			/** Wrapper of a callback (timer, observer, chrome.* event) */
			type wrapCallback = ( callback: Types.AnyFunction, origin: Types.PerfOrigin, kind: string ) => Types.AnyFunction;

			/** A message of the measurement itself (SDK_PERF_*)? */
			type isPerfMessage = ( value: unknown ) => boolean;

			/** Wraps the methods of a module's API (without api.perf) */
			type instrumentModuleApi = <A extends object>( module: string, api: A ) => A;

			/** Wrapper of one API method (count, duration, errors, continuation after await) */
			type wrapApiMethod = ( module: string, method: string, fn: Types.AnyFunction ) => Types.AnyFunction;

			namespace wrapApiMethod {

				/** Settles the caller's Promise and measures the continuation after await */
				type settle = ( done: ( value: unknown ) => void, value: unknown, failed: boolean ) => void;

			}

			/** Records one api.* call */
			type recordApi = ( module: string, method: string, waitMs: number, failed: boolean ) => void;

			/** Hook on addEventListener/removeEventListener */
			type patchEventTarget = ( global: typeof globalThis ) => void;

			namespace patchEventTarget {

				type addEventListener = ( this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions ) => void;
				type removeEventListener = ( this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions ) => void;

			}

			/** Wrapper of an event listener (a function, or an object with handleEvent()) */
			type wrapEventListener = ( listener: EventListenerOrEventListenerObject, origin: Types.PerfOrigin ) => ( this: unknown, event: Event ) => unknown;

			/** Hooks on timers */
			type patchTimers = ( global: typeof globalThis ) => void;

			/** Hooks on observer constructors */
			type patchObservers = ( global: typeof globalThis ) => void;

			/** Hooks on chrome.* events */
			type patchChromeEvents = ( chromeApi: typeof chrome | undefined ) => void;

			/** Names of the events of a chrome.* namespace */
			type eventKeys = ( api: Record<string, unknown> ) => Set<string>;

			/** Hook on one chrome.* event */
			type patchChromeEvent = ( api: Record<string, unknown>, key: string, kind: string ) => void;

			/** A core listener without a wrapper */
			type rawAddChromeListener = ( event: Types.PerfChromeEvent, listener: ( ...args: never[] ) => void ) => void;

			/** Is the value a valid measurement switch? */
			type isPerfSwitch = ( value: unknown ) => boolean;

			/** Measurement state from the stored switch */
			type perfStateFromSwitch = ( value: unknown ) => Types.PerfState;

			/** Reads the switch and watches its changes */
			type watchSwitch = ( global: typeof globalThis ) => void;

			/** Turns the measurement in this context on/off according to the switch */
			type applySwitch = ( value: unknown ) => void;

			/** Starts watching the web page's long frames */
			type startLongFrames = () => void;

			/** Long frames → page totals and the overlap with module callbacks */
			type onLongFrames = ( entries: PerformanceEntryList ) => void;

			/** Schedules a report (once per FLUSH_DELAY_MS) */
			type scheduleFlush = () => void;

			/** Sends the unreported values */
			type flushPerf = () => void;

			/** The unreported values as a report; nothing = null */
			type takeReport = () => Types.PerfReport | null;

			/** An empty overview */
			type createPerfStats = ( now: number ) => Types.PerfStats;

			/** A stopped mode clock without modes */
			type emptyModeClock = () => Types.PerfModeClock;

			/** Adds the fields an older version did not have to a stored overview */
			type upgradePerfStats = ( stats: Types.PerfStats ) => Types.PerfStats;

			/** Is the value a stored overview? */
			type isPerfStats = ( value: unknown ) => boolean;

			/** A finite positive number, otherwise 0 */
			type nonNegative = ( value: unknown ) => number;

			/** A non-empty string up to MAX_NAME_LENGTH? */
			type validName = ( value: unknown ) => value is string;

			/** A report from a message with only valid fields, otherwise null */
			type sanitizePerfReport = ( raw: unknown ) => Types.PerfReport | null;

			type addBucket = ( target: Types.PerfBucket, source: Types.PerfBucket ) => void;
			type addApiBucket = ( target: Types.PerfApiBucket, source: Types.PerfApiBucket ) => void;
			type addLongFrames = ( target: Types.PerfLongFrames, source: Types.PerfLongFrames ) => void;
			type addModeStats = ( target: Types.PerfModeStats, source: Types.PerfModeStats ) => void;

			/** Totals of a module in a mode (creates them) */
			type modeStats = ( stats: Types.PerfStats, module: string, mode: string ) => Types.PerfModeStats;

			/** Merges a report into the overview (background.js determines context and domain by the sender) */
			type mergePerfReport = (
				stats: Types.PerfStats,
				report: Types.PerfReport,
				options: { context: Enums.PerfContext; domain: string | null; now: number },
			) => Types.PerfStats;

			namespace mergePerfReport {

				/** Totals of a module in its current mode; null without a mode (the core, a module outside the list) */
				type modeOf = ( module: string ) => Types.PerfModeStats | null;

			}

			/** Mode key from a list of modes (without repetition, sorted) */
			type perfModeKey = ( modes: string[] ) => string;

			/** The mode of each module from the module list (not set = PERF_DEFAULT_MODE) */
			type perfModesFromEntries = ( entries: Types.PerfModeEntry[], settings: Types.ModuleSettings, validModes: string[] ) => Record<string, string>;

			/** Adds the elapsed time to the modes and sets new ones (null = measurement off); true = the overview changed */
			type advancePerfModes = ( stats: Types.PerfStats, now: number, modes: Record<string, string> | null, boot?: string ) => boolean;

			/** A clock from another browser run — without the time it was not running; true = the overview changed */
			type resumePerfModes = ( stats: Types.PerfStats, boot: string, now: number ) => boolean;

			/** Totals by modes with the measurement time up to now */
			type snapshotModes = ( stats: Types.PerfStats, now: number ) => Types.PerfSnapshot['modes'];

			/** Overview with the default mode replaced by the real one (according to the module registry) */
			type resolvePerfModes = ( snapshot: Types.PerfSnapshot, defaultModeOf: ( module: string ) => string | null ) => Types.PerfSnapshot;

			namespace resolvePerfModes {

				type resolveKey = ( module: string, key: string ) => string;

			}

			/** Removes domains over PERF_MAX_DOMAINS (the ones seen longest ago) */
			type pruneDomains = ( stats: Types.PerfStats ) => void;

			/** Total time of modules on a domain */
			type domainTimeMs = ( domain: Types.PerfDomainStats ) => number;

			/** Overview for display with one domain in detail */
			type buildPerfSnapshot = ( stats: Types.PerfStats, domain?: string | null, now?: number ) => Types.PerfSnapshot;

			/** Opens the overview database */
			type openPerfDatabase = () => Promise<IDBDatabase>;

			/** The stored overview, or null */
			type loadPerfStats = () => Promise<Types.PerfStats | null>;

			/** Saves the overview */
			type savePerfStats = ( stats: Types.PerfStats ) => Promise<void>;

		}

	}

}

export { };
