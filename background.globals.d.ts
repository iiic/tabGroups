/**
 * @file background.globals.d.ts
 * @description Global TypeScript declarations for background.js — the service worker (Chrome) / background script
 * (Firefox): data service in IndexedDB, network monitoring by tab, dynamic registration of content scripts,
 * the extension icon (running indicator and coloring by bookmarks), default module settings after installation.
 */

declare global {

	namespace Types {

		/**
		 * Listener of core messages — the message and the response according to the Types.Messages protocol; branches on
		 * message.type narrow the message type (a discriminated union).
		 */
		type BackgroundMessageListener = (
			message: AnyMessage,
			sender: chrome.runtime.MessageSender,
			sendResponse: ( response?: AnyMessageResponse ) => void,
		) => boolean | void;

		/** A running (merged) discovery and registration of content scripts, see scheduleDiscovery(). */
		type DiscoveryRun = Promise<[void, void, void]>;

		/** A content script query waiting for data about its document (see answerForDocument()). */
		type DocumentWaiter<T> = {
			fits: ( entry: T ) => boolean;
			respond: ( entry: T | null ) => void;
			timer: ReturnType<typeof setTimeout>;
		};

		/** Id of a module's MAIN-world script in chrome.scripting (see mainWorldScriptId()). */
		type MainWorldScriptId = `${ string }-main` | `${ string }-main-domain`;

		/**
		 * Variant of a module's MAIN-world script: main-world-script.js (all pages, main frame) or
		 * main-world-domain-script.js (only domains from the module settings, all frames).
		 */
		type MainWorldScriptVariant = {
			file: string;
			idSuffix: '-main' | '-main-domain';
			domainRestricted: boolean;
		};

	}

	namespace Functions {

		namespace Background {

			/** Is the message sent by an extension page (not a content script in a web page)? */
			type isExtensionPageSender = ( sender: chrome.runtime.MessageSender ) => boolean;

			/** Listener of core messages — from other contexts through chrome.runtime, from background.js through dispatchLocally() */
			type addCoreMessageListener = ( listener: Types.BackgroundMessageListener ) => void;

			/** Tells the extension pages a module record was stored, changed or deleted (DATA_CHANGED_MESSAGE, api.details.onChange()) */
			type notifyDataChanged = ( change: Types.DataChange ) => void;

			/** The next step of the HTTP redirect chain of the tab's main document */
			type onMainFrameRedirect = ( details: chrome.webRequest.OnBeforeRedirectDetails ) => void;

			/** Response of the main document: IP address and closing the redirect chain */
			type onMainFrameResponseStarted = ( details: chrome.webRequest.OnResponseStartedDetails ) => void;

			/** Address without the part after # */
			type stripHash = ( url: unknown ) => string;

			/**
			 * Answers a content script query with the tab's latest data — with an address and a document start in the query only
			 * with data of THAT document, for which it may wait a while (otherwise null)
			 */
			type answerForDocument = <T extends { timeStamp: number }>( options: {
				store: Map<number, T>;
				waiters: Map<number, Set<Types.DocumentWaiter<T>>>;
				tabId: number | undefined;
				query: Partial<Types.DocumentRef>;
				urlOf: ( entry: T ) => string;
				tracking: boolean;
				respond: ( entry: T | null ) => void;
			} ) => void;

			/** New tab data (null = the tab was closed): answers the waiting queries it belongs to */
			type resolveDocumentWaiters = <T>( waiters: Map<number, Set<Types.DocumentWaiter<T>>>, tabId: number, entry: T | null ) => void;

			/** A committed main frame navigation: how the tab got to the document */
			type onMainFrameCommitted = ( details: chrome.webNavigation.WebNavigationTransitionCallbackDetails ) => void;

			/** Registers the chrome.webNavigation listener (only once, only with the permission) */
			type registerWebNavigationListeners = () => void;

			/** Registers the chrome.webRequest listeners (only once, only with the permission) */
			type registerWebRequestListeners = () => void;

			/** Are scripting + <all_urls> (PAGE_ACCESS_PERMISSIONS) granted? */
			type hasPageInjectionAccess = () => Promise<boolean>;

			/** Does a file exist in the extension package? (Firefox fails only when reading the body) */
			type resourceExists = ( path: string ) => Promise<boolean>;

			/** Registers content-script.js of modules from the list, fixes paths, unregisters orphaned ones */
			type discoverAndRegisterModuleContentScripts = () => Promise<void>;

			/** Id of the module's MAIN-world script */
			type mainWorldScriptId = ( folderName: string, variant?: Types.MainWorldScriptVariant ) => Types.MainWorldScriptId;

			/** Does the registration belong to a variant of a module's MAIN-world script (by the file path)? */
			type isMainWorldScriptRegistration = ( registration: chrome.scripting.RegisteredContentScript ) => boolean;

			/** Does the registered script match the requested one (files, matches, allFrames)? */
			type isSameRegistration = (
				registered: chrome.scripting.RegisteredContentScript,
				desired: chrome.scripting.RegisteredContentScript
			) => boolean;

			/** Calls the registration/update; if the browser rejects matchOriginAsFallback, it tries again without it */
			type withMatchOriginFallback = (
				call: ( scripts: chrome.scripting.RegisteredContentScript[] ) => Promise<void>,
				scripts: chrome.scripting.RegisteredContentScript[]
			) => Promise<void>;

			/** The same for the modules' main-world-script.js (MAIN world, document_start, not for turned-off modules) */
			type discoverAndRegisterMainWorldScripts = () => Promise<void>;

			/** Registers the content script of the floating window */
			type registerFloatingWindowContentScript = () => Promise<void>;

			/** Redraws the icon (in the order of requests, see iconDrawPromise) */
			type updateExtensionIcon = ( active: boolean ) => Promise<void>;

			/** The extension icon, with a green dot in the active state */
			type drawExtensionIcon = ( active: boolean ) => Promise<void>;

			/** Is the bookmarks permission granted? */
			type hasBookmarksAccess = () => Promise<boolean>;

			/** Clears the badge of the tab's icon */
			type clearBadge = ( tabId: number | undefined ) => Promise<void>;

			/** Colors the tab's icon by the first matching bookmark folder from the rules of all modules (url and other page addresses as bookmarks) */
			type updateBadgeForTab = ( tabId: number, url: string | undefined, bookmarkUrls?: string[] ) => Promise<void>;

			/** Key of the shared limit state "<module>:<key>", or null for an invalid message */
			type rateLimitKey = ( message: { module: unknown; bucket: unknown } ) => string | null;

			/**
			 * An operation on the state of one shared limit key — one after another (rateLimitQueue), the state loaded from
			 * storage; changed = save the state after the operation.
			 */
			type withRateLimitEntry = <R>(
				key: string,
				fn: ( entry: Types.RateLimitEntry, now: number ) => { result: R; changed: boolean },
			) => Promise<R>;

			/** Starts the discovery and registration of content scripts; overlapping calls are merged into one */
			type scheduleDiscovery = () => Types.DiscoveryRun;

			/** Bookmark changes register main-world-domain-script.js again (domains from bookmark folders); once, as soon as chrome.bookmarks exists */
			type attachBookmarkDiscoveryListeners = () => void;

			/** After installation/update: default module settings, then the api.activation.onInstalled() listeners */
			type handleInstalled = ( details: chrome.runtime.InstalledDetails ) => Promise<void>;

			/** Queues work with network request rules after the previous one (networkRulesQueue) */
			type queueNetworkRules = <R>( task: () => Promise<R> ) => Promise<R>;

			/** Puts the rules of enabled modules from the list into the browser; returns the rule status per module */
			type applyNetworkRules = () => Promise<Record<string, Types.NetworkRulesStatus>>;

			/** The module's rule status from the last recalculation (null = some recalculation is pending, or there is no status) */
			type cachedNetworkRulesStatus = ( module: string ) => Promise<Types.NetworkRulesStatus | null>;

			/** Adds bulk rules (with ids) in batches; skips and returns the rejected ones */
			type addBulkNetworkRules = (
				dnr: typeof chrome.declarativeNetRequest,
				rules: chrome.declarativeNetRequest.Rule[],
			) => Promise<chrome.declarativeNetRequest.Rule[]>;

			/** Saves the module's rule set (api.networkRules.set()) and recalculates the rules; returns the module status */
			type setModuleNetworkRules = ( message: Types.Message<'SDK_NETWORK_RULES_SET'> ) => Promise<Types.NetworkRulesStatus>;


			/** The module's rule status: from the last recalculation, otherwise after a new one */
			type moduleNetworkRulesStatus = ( module: string ) => Promise<Types.NetworkRulesStatus>;

			/** Recalculating the rules in the background (a change of settings, the module list, permissions, installation) */
			type scheduleNetworkRules = () => void;

			/** "Do not use the sidebar" from storage applied to the browser (Chrome sidePanel), in the background */
			type applyStoredSidebarDisabled = () => void;

			/** An operation on the load measurement overview — one after another (perfQueue), the overview loaded from IndexedDB */
			type withPerfStats = <R>( fn: ( stats: Types.PerfStats ) => R | Promise<R> ) => Promise<R>;

			/** Saves the load measurement overview right away */
			type savePerfStatsNow = () => Promise<void>;

			/** Saves the load measurement overview at most once per PERF_SAVE_DELAY_MS */
			type schedulePerfSave = () => void;

			/** Merges a load measurement report into the overview (the context and the domain were determined by the sender) */
			type mergePerf = ( report: Types.PerfReport, context: Enums.PerfContext, domain: string | null ) => void;

			/** Id of the browser run (chrome.storage.session), "" without it */
			type getPerfBootId = () => Promise<string>;

			/** Advances the clock of the activation modes in the measurement overview (null = not measuring) */
			type updatePerfModes = ( modes: Record<string, string> | null ) => Promise<void>;

			/**
			 * Turns the load measurement off when its owner is not in the module list or is turned off; otherwise passes the
			 * modules' current activation modes to the overview (switchChanged = triggered by a switch change)
			 */
			type checkPerfSwitch = ( switchChanged?: boolean ) => Promise<void>;

		}

	}

}

export { };
