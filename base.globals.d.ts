/**
 * @file base.globals.d.ts
 * @description Global TypeScript declarations for base.mjs — the shared extension core: module registry,
 * settings, Specification Pattern, page controllers, BaseElement, the module API (createModuleApi),
 * the message protocol with background.js and the storage in IndexedDB.
 */

declare global {

	/** Module registry filled through registerModule() — one shared for all module files on the page. */
	var __extensionModules: Types.ModuleDefinition[];

	/**
	 * Firefox's sidebar API (browser.sidebarAction, in an extension also under chrome.*) — sidebar.toggle of the functions
	 * outside the sandbox. @types/chrome does not know it — in Chrome it is missing entirely (there chrome.sidePanel), hence
	 * optional; the code checks it at run time.
	 */
	namespace chrome {
		const sidebarAction: {

			/** Opens or closes the sidebar according to the current state (Firefox 57+ only open) */
			toggle?(): Promise<void>;

			/** Opens the sidebar */
			open?(): Promise<void>;

			/** Closes the sidebar (only from a handler of the user's action) */
			close?(): Promise<void>;

		} | undefined;
	}

	namespace Enums {

		/** Module activation mode — WHEN the module works (see ACTIVATION_MODES). */
		type ActivationMode = 'background' | 'focus' | 'icon_click' | 'popup' | 'install' | 'disabled';

		/**
		 * The surface on which the module's custom element is rendered — WHERE (see DISPLAY_LOCATIONS), written as one
		 * string; "none" = nowhere. For several locations at once see Types.DisplayLocationValue.
		 */
		type DisplayLocation = 'popup' | 'sidebar' | 'floating' | 'options' | 'onboarding' | 'none';

		/** A surface that really renders module elements (DisplayLocation except "none"). */
		type RenderLocation = Exclude<DisplayLocation, 'none'>;

		/** Where an element is rendered: a surface, or the settings block of its module in Settings (registerModule({ settingsView })). */
		type ElementLocation = RenderLocation | 'settings';

		/** A surface where the user can pin one module output to the top (see PIN_LOCATIONS). */
		type PinLocation = Extract<RenderLocation, 'sidebar' | 'floating'>;

		/** HOW the module output is framed on a surface (see OUTPUT_ELEMENTS). */
		type OutputElement = 'inline' | 'block' | 'indented' | 'details-closed' | 'details-open';

		/** Field types of a module's custom settings (see SETTING_FIELD_TYPES). */
		type SettingFieldType = 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'checkboxTable' | 'custom';

		/** Levels of the details contract — a page visit, a domain, the whole browser. */
		type DetailsScope = 'visit' | 'domain' | 'browser';

		/** An intervention in an optional permission written into the permission history. */
		type PermissionAction = 'request' | 'remove';

		/** Result of an intervention in an optional permission. */
		type PermissionOutcome = 'granted' | 'denied' | 'unavailable' | 'removed' | 'failed';

		/** What the name of a function outside the sandbox is for the core (describeSandboxCapability()). */
		type SandboxCapabilityKind = 'base' | 'catalog' | 'forbidden' | 'unknown';

		/** How much a function of the catalog can harm when a module misuses it — shown in Settings. */
		type SandboxCapabilityRisk = 'low' | 'medium' | 'high';

		/** Why a function cannot be allowed to an uploaded module (SANDBOX_FORBIDDEN_CAPABILITIES). */
		type SandboxCapabilityBlock = 'page' | 'gesture' | 'extension' | 'pageCode' | 'browserData' | 'network';









		/** An event of the listener storageUsage.onChange: which of the extension's storages changed */
		type SandboxStorageUsageChange = 'chromeStorage' | 'indexedDb' | 'localStorage';





		// #region standalone: tabGroups
		/** An event of the listener tabGroups.onChange: a group or a tab of the page's windows changed / the settings of tabGroups, the module list or the permissions changed */
		type SandboxTabGroupsChange = 'groups' | 'status';
		// #endregion standalone: tabGroups

		// #region standalone: tabGroups, tabGroupsSandbox
		/** Why the functions tabGroups.* do not work: tabGroups is not in the module list / is turned off */
		type SandboxTabGroupsReason = 'notListed' | 'disabled';
		// #endregion standalone: tabGroups, tabGroupsSandbox

		/**
		 * An entry of the record of the functions outside the sandbox: a request (its state, "clickOnly" — a function the
		 * core runs only from a button it draws, asked for by a call, or "failed" — allowed, but the function failed) or the
		 * user's decision in Settings.
		 */
		type SandboxCapabilityOutcome = SandboxCapabilityState | 'clickOnly' | 'failed' | 'userAllowed' | 'userDenied' | 'userReset';

	}

	namespace Types {

		/** Namespace of the base.mjs core — for a dynamic import (see content-scripts/floating-window.js). */
		type BaseModule = typeof import( './base.mjs' );

		/** Tag of a module's custom element, always from getTagName(). */
		type ModuleTag = `extension-${ string }`;

		/** Key of a module's custom setting in moduleSettings — "<module>.<field>" (see getModuleSettingKey()). */
		type ModuleSettingKey = `${ string }.${ string }`;

		/**
		 * Stored moduleSettings: the bare module name = its activation mode, "<module>.<field>" = the module's custom
		 * setting. The content comes from storage (editable by hand too), hence unknown — whoever reads a value knows
		 * what to expect under the key.
		 */
		type ModuleSettings = Record<string, unknown>;

		/** An item of the activation mode choice. */
		type ActivationModeOption = { value: Enums.ActivationMode; label: string };

		/** An item of the output surface choice (the "Show module output" checkbox in Settings). */
		type DisplayLocationOption = { value: Enums.RenderLocation; label: string };

		/**
		 * A module's output locations as they are written (the stored "<module>.displayLocation" setting,
		 * defaultDisplayLocation, default-settings.json): an array of locations (empty = nowhere), or one location or "none"
		 * as one string (older notation). Read by parseDisplayLocations().
		 */
		type DisplayLocationValue = Enums.DisplayLocation | Enums.RenderLocation[];

		/** An item of the output frame choice — a discriminated union: a collapsible frame (<details>) always has a default open. */
		type OutputElementOption =
			| { value: Enums.OutputElement; label: string; collapsible?: false }
			| { value: Enums.OutputElement; label: string; collapsible: true; open: boolean };

		/** The context in which a Specification is evaluated — each specification reads only its own key. */
		type SpecificationContext = {

			/** The module's activation mode (ModeSpecification, DisabledSpecification, IsNotDisabled) */
			mode?: Enums.ActivationMode;

			/** Address of the active tab (UrlPatternSpecification, WebPageSpecification); empty when the browser does not reveal it */
			url?: string;

			/**
			 * The extension has access to all web pages (<all_urls>), so the address of a web page would be visible
			 * (WebPageSpecification). Only when url is missing.
			 */
			hostAccess?: boolean;

			/** The surface on which the element is being rendered (LocationSpecification) */
			location?: Enums.ElementLocation;

		};

		/** A snapshot of the active tab for Specification (see BaseController.buildPageContext()). */
		type PageContext = Required<Pick<SpecificationContext, 'url'>> & Pick<SpecificationContext, 'hostAccess'>;

		/** A page where the browser does not inject extension scripts (add-on store, …): host and start of the path. */
		type RestrictedPage = { host: string; path: string };

		/** A set of optional permissions in the shape of chrome.permissions.contains()/request(). */
		type PermissionSet = chrome.permissions.Permissions;

		/** One entry of the permission history (see api.permissions.getActivity()). */
		type PermissionActivityEntry = {

			/** Name of the module that requested/removed the permission */
			module: string;
			action: Enums.PermissionAction;
			outcome: Enums.PermissionOutcome;

			/** Time of the intervention (Date.now()) */
			at: number;

		};

		/** Permission history: permission or origin → entries from the oldest. */
		type PermissionActivityLog = Record<string, PermissionActivityEntry[]>;

		/** An icon coloring rule: the page is a bookmark in the folderId folder → badge color and text. */
		type BadgeRule = { folderId: string; color?: string; text?: string };

		/** Icon rules of all modules: module name → its rules. */
		type BadgeRulesStore = Record<string, BadgeRule[]>;

		/** The stored floating window state of one domain (position, size, open/closed). */
		type FloatingWindowState = { top?: string; left?: string; width?: string; height?: string; open?: boolean };

		/** The whole stored floating window state: by domain + the last used one (a fallback for new domains). */
		type FloatingWindowStateStore = { byDomain?: Record<string, FloatingWindowState>; lastUsed?: FloatingWindowState };

		/** The user-changed state of a module's collapsible frame: open, for which frame setting, when last rendered (ms). */
		type FrameState = { open: boolean; element: Enums.OutputElement; seen: number };

		/** Stored frame states by the key of the module list entry. */
		type FrameStateStore = Record<string, FrameState>;

		/** Layout of chrome.storage.local — the core keys; other content (e.g. from a backup) is unknown. */
		interface StorageLocal {
			moduleSettings?: ModuleSettings;
			modulesJson?: string;
			floatingWindowState?: FloatingWindowStateStore;
			moduleFrameState?: FrameStateStore;
			permissionActivity?: PermissionActivityLog;
			badgeRules?: BadgeRulesStore;
			rateLimits?: RateLimitStore;
			networkRules?: NetworkRulesStore;
			sandboxModules?: SandboxModuleStore;
			sandboxCapabilityGrants?: SandboxCapabilityGrants;
			sandboxCapabilityLog?: SandboxCapabilityLogEntry[];
			browserSessionStart?: number;
			[key: string]: unknown;
		}

		/** A chrome.runtime.onMessage listener (the shape from @types/chrome). */
		type RuntimeMessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

		/** A chrome.storage.onChanged listener (the shape from @types/chrome). */
		type StorageChangeListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];

		/** A chrome.permissions.onAdded/onRemoved listener (the shape from @types/chrome). */
		type PermissionsChangeListener = Parameters<typeof chrome.permissions.onAdded.addListener>[0];

		// --- IndexedDB (BaseStorage) ---

		/** A record in IndexedDB (DATA_STORE). A field without "module" comes from version 1 (the fixed DATA_VOLUME_UPDATE). */
		type DataRecord = {

			/** Auto-increment primary key */
			id: number;
			module?: string;
			payload?: unknown;

			/** The sender's tab; missing when the browser did not determine it */
			tabId?: number | null;

			/** Address of the sender's page; missing without a host permission for it */
			url?: string | null;

			/** Only from content script records (see getDocumentKey()) */
			documentKey?: number;

			/** Only for http(s) pages (see getDomainKey()) */
			domainKey?: string;

			/** The record's own key chosen by the module (api.data.log(payload, { key })), since version 5 */
			recordKey?: string;
			timestamp: number;

			/** Version 1 records */
			type?: string;

		};

		/** Input of BaseStorage.logData() — the storage fills in timestamp and id. */
		type DataRecordInput = {
			module: string;
			payload: unknown;
			tabId: number | null | undefined;
			url: string | null | undefined;
			documentKey?: number;
			domainKey?: string;
			recordKey?: string;
		};

		/** A module record as the module gets it back (api.data.*); P = the shape of the module's own payload. */
		type DataEntry<P = unknown> = {

			/** Primary key of the record (for api.data.update()) */
			id: number;
			payload: P;
			tabId: number | null | undefined;
			url: string | null | undefined;
			timestamp: number;
			documentKey: number | null;
		};

		/** Query of BaseStorage.listEntries(); without tabId from all tabs, since = only records written from that time on (ms) */
		type ListEntriesQuery = { module: string; tabId?: number; limit: number; since?: number };

		/** Query of BaseStorage.updatePayload(): fields from patch replace the same-named payload fields of record id */
		type UpdatePayloadQuery = { module: string; id: number; patch: Record<string, unknown> };

		/** Query of BaseStorage.removeEntry(): record id of the module */
		type RemoveEntryQuery = { module: string; id: number };

		/** Dotaz BaseStorage.findByDocument() */
		type FindByDocumentQuery = { module: string; tabId: number; documentKey: number };

		/** Dotaz BaseStorage.findByDomain() */
		type FindByDomainQuery = { module: string; domainKey: string; limit: number };

		/** Dotaz BaseStorage.findByKey() */
		type FindByKeyQuery = { module: string; recordKey: string; limit: number };

		/** An api.data record in a module backup — a stored record without the id (new on import) and the module name (the backup carries it). */
		type DataBackupRecord = Omit<DataRecord, 'id' | 'module'>;

		/** Query of BaseStorage.exportEntries(): at most limit records of the module with an id greater than afterId (null = from the start) */
		type ExportEntriesQuery = { module: string; afterId: number | null; limit: number };

		/** A batch of backup records and the id of the last of them (the next batch starts after it; null for an empty batch) */
		type ExportEntriesResult = { records: DataBackupRecord[]; lastId: number | null };

		/** Query of BaseStorage.importEntries(): records from a backup (unverified); replace = delete the module's records first */
		type ImportEntriesQuery = { module: string; records: unknown[]; replace: boolean };

		/** Backup of one module (api.backup.exportModule()). */
		type ModuleBackup = {

			/** moduleSettings entries of the module and its instances ("<module>", "<module>.<field>", "<module>#<id>…") */
			settings: ModuleSettings;

			/** Ids of the module's instances in the module list, in its order */
			instances: string[];

			/** Rules of the extension icon (api.badge), null = none */
			badgeRules: BadgeRule[] | null;

			/** declarativeNetRequest rules (api.networkRules), null = none */
			networkRules: NetworkRulesEntry | null;

			/** api.state: module key → value */
			state: Record<string, unknown>;

			/** api.data records, from the oldest */
			records: DataBackupRecord[];

			/** The module's own data (registerModule({ backupData })) — only for a module that declares them */
			custom?: unknown;

		};

		/** Which parts of a module backup to import (both by default). */
		type ModuleBackupImportOptions = {

			/** Settings of the module and its instances, icon rules and declarativeNetRequest */
			settings?: boolean;

			/** api.state, api.data records and the module's own data */
			data?: boolean;

		};

		/** Argument export() u registerModule({ backupData }). */
		type ModuleBackupExportContext = { api: ModuleApi };

		/** Argument of import() in registerModule({ backupData }); data = what export() returned (from a file, unverified). */
		type ModuleBackupImportContext = { api: ModuleApi; data: unknown };

		/** Backup of data the module keeps outside api.* (its own IndexedDB) — part of api.backup.exportModule()/importModule(). */
		type ModuleBackupData = {

			/** The module's data for the backup file — must be convertible to JSON */
			export( context: ModuleBackupExportContext ): unknown;

			/** Replaces the module's data with the backup content */
			import( context: ModuleBackupImportContext ): void | Promise<void>;

			/** Deletes the module's data — the reset of the module in Settings (resetModule() of base.mjs) */
			reset?( context: ModuleBackupExportContext ): void | Promise<void>;

		};

		/** Options of api.data.log(): key = the record's own key for api.data.findByKey() */
		type DataLogOptions = { key?: string };

		/** The budget of a work of a content script in the idle time of the browser (startIdleWork() of base.mjs) */
		type IdleBudget = {

			/** Is the slice used up (time to wait for another idle period)? */
			expired: () => boolean;

			/** Waits for another idle period of the browser */
			next: () => Promise<void>;
		};

		// --- Shared rate limits (api.rateLimit, background.js) ---

		/** A limit window: at most max operations per ms milliseconds. */
		type RateLimitWindow = { max: number; ms: number };

		/** A limit decision: granted = the operation is allowed and counted; otherwise try again after waitMs. */
		type RateLimitDecision = {
			granted: boolean;
			waitMs: number;

			/** End of the key's block (api.rateLimit.block()), otherwise null */
			blockedUntil: number | null;
		};

		/** Key state for display: the block and the times of operations that still count (ascending). */
		type RateLimitStatus = { blockedUntil: number | null; times: number[] };

		/** The stored state of one key. */
		type RateLimitEntry = {

			/** Times of allowed operations (ms since the epoch), ascending */
			times: number[];

			/** Until when the key is blocked */
			blockedUntil?: number;

			/** How long the times are remembered (the longest window used with the key) */
			keepMs?: number;
		};

		/** State of all keys: "<module>:<key>" → state (chrome.storage.local, RATE_LIMITS_KEY). */
		type RateLimitStore = Record<string, RateLimitEntry>;

		// --- Dynamic network request rules (api.networkRules, background.js) ---

		/** A declarativeNetRequest rule without an id — ids are assigned by background.js. */
		type NetworkRule = Omit<chrome.declarativeNetRequest.Rule, 'id'>;

		/** Stored rules of one module and its default activation mode (background.js has no module registry). */
		type NetworkRulesEntry = { rules: NetworkRule[]; defaultMode?: Enums.ActivationMode };

		/** Rules of all modules: module name → its rules (chrome.storage.local, NETWORK_RULES_KEY). */
		type NetworkRulesStore = Record<string, NetworkRulesEntry>;

		/** A module's bulk rules (IndexedDB NETWORK_RULES_DB_NAME): rules, the default mode and indexes of rules the browser rejected. */
		type NetworkRulesBulkEntry = NetworkRulesEntry & { rejected: number[] };

		/** Bulk rules of all modules: module name → record. */
		type NetworkRulesBulkStore = Record<string, NetworkRulesBulkEntry>;

		/** The browser's dynamic rule limits: in total, "unsafe" (redirects, headers), with a regular expression. */
		type NetworkRulesLimits = { total: number; unsafe: number; regex: number };

		/** Volby api.networkRules.set(). */
		type NetworkRulesSetOptions = {

			/** Bulk rules: the lowest priority layer, only into the free space, rejected ones are skipped (see NETWORK_RULES_BULK_MAX_PRIORITY) */
			bulk?: boolean;
		};

		/** A group of rules of one module in the plan (planNetworkRules(), fitNetworkRules()). */
		type NetworkRulesGroup = {
			module: string;
			rules: NetworkRule[];

			/** Bulk rules */
			bulk: boolean;

			/** Index of the rule in the module's set for each rule of the group */
			indexes: number[];

			/** How many bulk rules did not fit into the browser limits */
			dropped: number;

			/** How many bulk rules the browser rejected (earlier) */
			rejected: number;
		};

		/**
		 * Why a module's rules do not apply in the browser: a turned-off module, a module outside the module list, the browser does
		 * not provide the API (the declarativeNetRequest* permission is missing), the browser rejected the rules.
		 */
		type NetworkRulesProblem = 'disabled' | 'notListed' | 'unavailable' | 'error';

		/** Status of a module's rules in the browser (api.networkRules.set()). */
		type NetworkRulesStatus = {

			/** How many of the module's rules apply in the browser */
			active: number;

			/** Why they do not apply, otherwise null */
			reason: NetworkRulesProblem | null;

			/** Text of the browser error (reason "error") */
			error?: string;

			/** Bulk rules: how many did not fit into the browser limits */
			dropped?: number;

			/** Bulk rules: how many the browser rejected (skipped) */
			rejected?: number;
		};

		/** Result of planNetworkRules(): rules that should apply (per module) and the status of skipped modules. */
		type NetworkRulesPlan = {
			groups: NetworkRulesGroup[];
			skipped: Record<string, NetworkRulesStatus>;
		};

		// --- Network (background.js, api.network) ---

		/** One HTTP redirect of the main document (chrome.webRequest.onBeforeRedirect). */
		type RedirectEntry = {
			url: string;
			redirectUrl: string;

			/** Response status code; meaningless for an internal redirect (Firefox 0, for a redirect by an extension even 200) */
			statusCode: number;

			/** An internal redirect by the browser, not by the server (upgrade to HTTPS, an extension, …): a code outside 3xx, or Chrome's "307 Internal Redirect" */
			internal: boolean;

			/** ms since the epoch, in Chrome with a fractional part too */
			timeStamp: number;
		};

		/** The redirect chain that led to the tab's current document. */
		type RedirectChain = {
			finalUrl: string;
			redirects: RedirectEntry[];

			/** When the response of the document (finalUrl) started, ms since the epoch — tells the chain of a previous navigation */
			timeStamp: number;
		};

		/** The document for which a content script wants data from background.js: its address (Navigation Timing) and performance.timeOrigin */
		type DocumentRef = { url: string; timeOrigin: number };

		/** HOW the tab got to the current document (chrome.webNavigation.onCommitted of the main frame). */
		type NavigationTransition = {
			url: string;
			transitionType: string | null;
			transitionQualifiers: string[];
			timeStamp: number;
		};

		/** The tab the element's surface relates to (api.tabs.getActive()). */
		type ActiveTabInfo = {
			tabId: number;
			url: string | null;

			/** Key from getDomainKey(); null for non-web pages or without a host permission */
			domain: string | null;
		};

		/** The sender's tab (response to GET_SENDER_TAB_MESSAGE). */
		type SenderTab = { id: number | undefined; url: string | null };

		// --- Message protocol ---

		/**
		 * The chrome.runtime/chrome.tabs message protocol: message type → { request, response }. request is the content of
		 * the message WITHOUT the type field (Message<K> adds it), response is the response through sendResponse (undefined = none).
		 * Every file that sends or handles its own message type adds it here in its .globals.d.ts
		 * (interface merging) — so the sender and the receiver are checked against the same shape.
		 */
		interface Messages {

			/** A page of a client → background.js: register with the service provider right now; what the provider said */
			EXTENSION_SERVICE_REGISTER_NOW: { request: {}; response: { state: ExtensionServiceProviderState | null; error?: string } };

			/** Extension page → background.js: run a service of a background part (callModuleService()); its answer or its error */
			MODULE_SERVICE_CALL: { request: { name: string; args: unknown[]; context: ModuleServiceContextInput }; response: ModuleServiceAnswer };

			/** Extension page or background part → background.js: a service of another module wherever it runs (callRoutedModuleService()) */
			MODULE_SERVICE_ROUTE: { request: { name: string; args: unknown[]; context: ModuleServiceContextInput }; response: ModuleServiceAnswer };

			/** Storing a module record in IndexedDB (api.data.log()); the id of the new record is missing when the write failed */
			SDK_DATA_LOG: { request: { module: string; payload: unknown; documentKey: number | null; key?: string }; response: { id?: number } };

			/** Completing the payload of an already stored module record (api.data.update()) */
			SDK_DATA_UPDATE: { request: { module: string; id: number; patch: Record<string, unknown> }; response: { updated: boolean } };

			/** Deleting a stored module record (api.data.remove()) */
			SDK_DATA_REMOVE: { request: { module: string; id: number }; response: { removed: boolean } };

			/** background.js to the extension pages: a module record was stored, changed or deleted (api.details.onChange()) */
			SDK_DATA_CHANGED: { request: DataChange; response: undefined };

			/** The module's last N records from all tabs (api.data.listLatest()) */
			SDK_DATA_LATEST: { request: { module: string; limit: number }; response: { entries: DataEntry[] } };

			/** Number of the module's records (api.data.count()) */
			SDK_DATA_COUNT: { request: { module: string }; response: { count: number } };

			/** Number of records of all modules (api.data.total()) */
			SDK_DATA_TOTAL: { request: {}; response: { count: number } };

			/** The module's last N records from one tab; tabId only from a sender without sender.tab */
			SDK_DATA_LIST: { request: { module: string; tabId?: number; limit: number }; response: { entries: DataEntry[] } };

			/** The module's records from one document */
			SDK_DATA_FIND_BY_DOCUMENT: { request: { module: string; tabId: number; documentKey: number }; response: { entries: DataEntry[] } };

			/** The module's records from pages of one domain */
			SDK_DATA_FIND_BY_DOMAIN: { request: { module: string; domain: string; limit?: number }; response: { entries: DataEntry[] } };

			/** The module's records under one own key */
			SDK_DATA_FIND_BY_KEY: { request: { module: string; key: string; limit?: number }; response: { entries: DataEntry[] } };

			/** A batch of the module's records for a backup (api.backup.exportModule()); only from extension pages */
			SDK_DATA_EXPORT: { request: { module: string; afterId: number | null }; response: ExportEntriesResult & { error?: string } };

			/** A batch of the module's records from a backup (api.backup.importModule()); only from extension pages */
			SDK_DATA_IMPORT: { request: { module: string; records: unknown[]; replace: boolean }; response: { imported: number; error?: string } };

			/** Shared limit: may the operation run now? (api.rateLimit.acquire()) */
			SDK_RATE_LIMIT_ACQUIRE: { request: { module: string; bucket: string; windows: RateLimitWindow[] }; response: RateLimitDecision };

			/** Shared limit: blocks the key for ms, ms <= 0 cancels the block (api.rateLimit.block()) */
			SDK_RATE_LIMIT_BLOCK: { request: { module: string; bucket: string; ms: number }; response: { blockedUntil: number | null } };

			/** Shared limit: key state (api.rateLimit.getState()) */
			SDK_RATE_LIMIT_STATE: { request: { module: string; bucket: string }; response: RateLimitStatus };

			/** A new set of the module's dynamic rules (api.networkRules.set()) — background.js saves it and recalculates */
			SDK_NETWORK_RULES_SET: {
				request: { module: string; rules: NetworkRule[]; bulk?: boolean; defaultMode?: Enums.ActivationMode };
				response: { status: NetworkRulesStatus };
			};

			/** Status of the module's rules in the browser without changing the set (api.networkRules.getStatus()) */
			SDK_NETWORK_RULES_STATUS: {
				request: { module: string };
				response: { status: NetworkRulesStatus };
			};

			/** The sender's tab (for the floating window's <iframe> without chrome.tabs) */
			SDK_GET_SENDER_TAB: { request: {}; response: { tab: SenderTab | null } };

			/** An instruction for the floating window's content script: toggle the window on this page */
			TOGGLE_FLOATING_WINDOW: { request: {}; response: undefined };

			/** The same from inside the floating window's <iframe> — background.js sends it on its behalf */
			SDK_TOGGLE_SENDER_FLOATING_WINDOW: { request: {}; response: Record<string, never> };

			/** tabs.activate of an uploaded module from inside the floating window's <iframe> — background.js selects the sender's tab */
			SDK_ACTIVATE_TAB: { request: { tabId: number }; response: { error?: string } };


			/** "This tab is now on this URL" (for the badge); tabId only from a sender without sender.tab, bookmarkUrls = other addresses of the same page as bookmarks */
			SDK_PAGE_URL: { request: { url: string; tabId?: number; bookmarkUrls?: string[] }; response: undefined };

			/** chrome.permissions.contains() through background.js (a context without chrome.permissions) */
			SDK_PERMISSIONS_CONTAINS: { request: { permissions: PermissionSet }; response: { contains: boolean } };

			/** A module notification (api.notifications.show()) — background.js shows it; error = it was not shown */
			SDK_NOTIFICATION_SHOW: { request: { module: string; title: string; options: NotificationOptions }; response: { error?: string } };

			/** IP address of the tab's main document */
			SDK_GET_TAB_IP: { request: { tabId?: number }; response: { ip: string | null } };

			/** HTTP redirect chain of the tab's current document */
			SDK_GET_TAB_REDIRECTS: { request: { tabId?: number } & Partial<DocumentRef>; response: { chain: RedirectChain | null } };

			/** Navigation type to the tab's current document */
			SDK_GET_TAB_NAVIGATION: { request: { tabId?: number } & Partial<DocumentRef>; response: { navigation: NavigationTransition | null } };

			/** chrome.debugger.getTargets() through background.js (the floating window without chrome.debugger) */
			SDK_DEBUGGER_TARGETS: { request: {}; response: { targets?: chrome.debugger.TargetInfo[]; error?: string } };

			/** Attaching the debugger, commands and detaching in background.js (see runDebuggerCommands()) */
			SDK_DEBUGGER_COMMANDS: {
				request: { debuggee: chrome.debugger.Debuggee; commands: DebuggerCommand[] };
				response: { results?: DebuggerCommandResult[]; error?: string };
			};

		}

		/** All known message types. */
		type MessageType = keyof Messages;

		/** A message of the given type (including the type field). */
		type Message<K extends MessageType> = { type: K } & Messages[K]['request'];

		/** Any known message — a discriminated union by the type field. */
		type AnyMessage = { [K in MessageType]: Message<K> }[MessageType];

		/** Response to a message of the given type. */
		type MessageResponse<K extends MessageType> = Messages[K]['response'];

		/** Any known response. */
		type AnyMessageResponse = { [K in MessageType]: MessageResponse<K> }[MessageType];

		/** Handler of a message of one type; returning true keeps the channel open for a later sendResponse(). */
		type MessageHandler<K extends MessageType> = (
			message: Message<K>,
			sender: chrome.runtime.MessageSender,
			sendResponse: ( response: MessageResponse<K> ) => void,
		) => boolean | void;

		/** A message handler registered through BaseElement.registerMessageHandler() (without a response). */
		type ElementMessageHandler<K extends MessageType> = ( message: Message<K>, sender: chrome.runtime.MessageSender ) => void;

		/** A message from the floating window's <iframe> to the page through window.postMessage() (a replacement for chrome.tabs.sendMessage()). */
		type FloatingRelayRequest = { type: 'SDK_FLOATING_RELAY_REQUEST'; id: string; message: AnyMessage };

		/** The page's response back to the floating window's <iframe>. */
		type FloatingRelayResponse = { type: 'SDK_FLOATING_RELAY_RESPONSE'; id: string; response: unknown };

		// --- A module's custom settings (settingsSchema) ---

		/** An item of a field of type "select". */
		type SettingFieldOption = { value: string; label: string };

		/** Common properties of all custom setting fields. */
		interface SettingFieldBase {

			/** Field key — stored under getModuleSettingKey(module, key), a shared field under getSharedSettingKey(shared, key) */
			key: string;
			label: string;
			default?: unknown;
			placeholder?: string;

			/**
			 * A group of settings shared by several modules (only settingsSchema of a module from the package, not "custom" and
			 * "checkboxTable"): the value is one for every module that declares a field with the same group and key — Settings
			 * keeps their controls in step, the module reads it with api.settings.getShared(group, key)
			 */
			shared?: string;

		}

		/** A simple field that options.mjs can render by itself. */
		interface SimpleSettingField extends SettingFieldBase {
			type: 'text' | 'textarea' | 'number' | 'checkbox';

			/** Only "checkbox": checking it sends notifications — Settings shows under it whether they are allowed, with a button that asks for them */
			notifications?: boolean;

			/** Only "number": the step of the input ("any" = also decimals; the default of the browser is 1) */
			step?: string;
		}

		/** A choice from fixed options. */
		interface SelectSettingField extends SettingFieldBase {
			type: 'select';
			options?: SettingFieldOption[];
		}

		/** A column of a field of type "checkboxTable" (title = its tooltip). */
		type CheckboxTableColumn = SettingFieldOption & {
			title?: string;

			/** Checking it sends notifications — Settings shows under the table whether they are allowed, with a button that asks for them */
			notifications?: boolean;
		};

		/** The value of a field of type "checkboxTable": row → column → checked. */
		type CheckboxTableValue = Record<string, Record<string, boolean>>;

		/** A table of checkboxes — a row for every item of rows, a column for every item of columns (data only, also for an uploaded module). */
		interface CheckboxTableSettingField extends SettingFieldBase {
			type: 'checkboxTable';
			rows: SettingFieldOption[];
			columns: CheckboxTableColumn[];

			/** The checked cells without a stored value (a missing cell = not checked) */
			default?: CheckboxTableValue;
		}

		/** A field with a custom editor supplied by the module. */
		interface CustomSettingField extends SettingFieldBase {
			type: 'custom';

			/** Returns the editor element; its getValue() yields the new value on save */
			render: ( value: unknown, settings: ModuleSettings ) => CustomSettingControl;
		}

		/** A field of a module's custom settings — a discriminated union by type. */
		type SettingField = SimpleSettingField | SelectSettingField | CheckboxTableSettingField | CustomSettingField;

		/** A bookmark folder in module settings (MAIN_WORLD_BOOKMARK_FOLDERS_FIELD); the name only for a folder that has disappeared. */
		type BookmarkFolderRef = { folderId: string; folderTitle: string };

		/** Element of a custom settings editor (type "custom"). */
		type CustomSettingControl = HTMLElement & { getValue(): unknown };

		// --- Kontrakt details ---

		/** One details item — value is shown as text. */
		type DetailsItem = { label: string; value: unknown };

		/** Context of each details level; the keys are always computed by the core, not by the module. */
		interface DetailsContextMap {
			visit: { url?: string | null; tabId: number; documentKey: number };
			domain: { domain: string };
			browser: {};
		}

		/** Context of any level (input of DETAILS_CONTEXT_VALIDATORS). */
		type DetailsContextInput = { url?: string | null; tabId?: number | null; documentKey?: number | null; domain?: string | null };

		/** A details provider of one level — gets the context and the api of the PROVIDER (not of the caller). */
		type DetailsProvider<S extends Enums.DetailsScope = Enums.DetailsScope> = (
			context: DetailsContextMap[S] & { api: ModuleApi },
		) => DetailsItem[] | Promise<DetailsItem[]>;

		/** details in registerModule(): level → provider (each level optional). */
		type DetailsProviders = { [S in Enums.DetailsScope]?: DetailsProvider<S> };

		/** Validity check of the context of each level. */
		type DetailsContextValidators = { [S in Enums.DetailsScope]: ( ctx: DetailsContextInput ) => boolean };

		/**
		 * A changed module record (DATA_CHANGED_MESSAGE from background.js, for api.details.onChange()): a stored record with
		 * where it came from (its domain key, tab and document — null when it has none), or a changed / deleted one with
		 * only its id (the storage does not read it back). Never the payload.
		 */
		type DataChange =
			| { module: string; change: 'log'; domainKey: string | null; tabId: number | null; documentKey: number | null }
			| { module: string; change: 'update' | 'remove'; id: number };

		/** Whether a stored record concerns the context of each level (api.details.onChange()). */
		type DetailsChangeMatchers = {
			[S in Enums.DetailsScope]: ( ctx: DetailsContextInput, change: Extract<DataChange, { change: 'log' }> ) => boolean;
		};

		/** Non-empty details of one module collected through api.details.collect(). */
		type CollectedDetails = {
			module: string;

			/** Module name as on the Settings page (formatModuleName()) */
			title: string;
			items: Array<{ label: string; value: string }>;
		};

		// --- Module definition ---

		/** Argument of pageInit() — module behavior for the whole extension page. */
		type PageInitContext = { api: ModuleApi; location: Enums.RenderLocation };

		/** Module definition passed to registerModule(). */
		interface ModuleDefinition {

			/** Module name == the name of its folder and file */
			name: string;
			tag: ModuleTag;

			/** A short description for the Settings page */
			description?: string;

			/** WHEN the module is active (default NOT_DISABLED_SPEC) */
			activationSpec?: Classes.Specification;
			defaultActivationMode?: Enums.ActivationMode;
			defaultDisplayLocation?: DisplayLocationValue;
			defaultOutputElement?: Enums.OutputElement;
			defaultShowHeading?: boolean;
			settingsSchema?: SettingField[];

			/** The module can be put into the module list several times — each instance has its own place and settings */
			multiInstance?: boolean;

			/** Custom settings of each instance (only with multiInstance), rendered in its row in Settings */
			instanceSettingsSchema?: SettingField[];

			/** Optional permissions the module may request at runtime (read by extensionPermissionsManager) */
			usesPermissions?: PermissionSet[];

			/** Absolute addresses of its own CSS (new URL("./x.css", import.meta.url).href) */
			styles?: string[];
			details?: DetailsProviders;

			/** Other modules without which the module does not work (entirely or partly) — shown on the Settings page */
			dependsOn?: ModuleDependency[];

			/** Levels of the details contract the module collects (api.details.collect()) — the Settings page shows their providers */
			consumesDetails?: Enums.DetailsScope[];

			/**
			 * Functions outside the sandbox an uploaded module asks for ("tabs.create", …) — the core runs them only when the user
			 * allows them (see SANDBOX_CAPABILITIES in base.mjs); a module from the package calls the browser API itself
			 */
			capabilities?: string[];

			/** The version of the module ("1.0.3") — a standalone extension built from it gets it (scripts/build-module-*.ps1) */
			version?: string;

			/**
			 * The element edits the module's settings itself: Settings renders it in the module's settings block with
			 * init({ location: "settings" }) — an uploaded module's editor (custom fields would be code outside the sandbox)
			 */
			settingsView?: boolean;

			/**
			 * The module whose settings view edits this module's settings (tabGroups ← tabGroupsSandbox) — the reset of its
			 * block resets this module's own fields too. Only a module from the package (not passed from the sandbox)
			 */
			settingsEditedBy?: string;

			/**
			 * The configuration of the core's network filters an uploaded module declares instead of networkFilters.set from its
			 * element — the core applies it from the module's installation, under networkFilters.set (see DECLARED_FILTERS in base.mjs)
			 */
			networkFilters?: NetworkFilters.Config;

			/** The same for the core's content filters (contentFilters.set) */
			contentFilters?: ContentFilters.Config;

			/** Once on every extension page where the module is not turned off */
			pageInit?: ( context: PageInitContext ) => void | Promise<void>;

			/** Backup of data the module keeps outside api.* (its own IndexedDB) — see api.backup.exportModule() */
			backupData?: ModuleBackupData;

			/** Filled in by the core for a module uploaded by the user (it runs in the sandbox) — never by the module itself */
			sandbox?: SandboxModuleInfo;

		}

		/**
		 * Module description without DOM (modules/<name>/module.mjs) — constants that the module element,
		 * registerModule() and the content script draw on. Each module checks in the .globals.d.ts of its module.mjs that
		 * it exports the whole of it (Types.Satisfies).
		 */
		interface ModuleDescriptor {
			MODULE_NAME: string;
			TAG: ModuleTag;
			DESCRIPTION: string;
			ACTIVATION_SPEC: Classes.Specification;
			DEFAULT_ACTIVATION_MODE: Enums.ActivationMode;
			DEFAULT_DISPLAY_LOCATION: DisplayLocationValue;
			DEFAULT_OUTPUT_ELEMENT: Enums.OutputElement;
			DEFAULT_SHOW_HEADING: boolean;

			/** Optional permissions the module may request (registerModule({ usesPermissions })) */
			USES_PERMISSIONS?: PermissionSet[];

			/** The module's custom settings (registerModule({ settingsSchema })) */
			SETTINGS_SCHEMA?: SettingField[];

			/** Multiple instances (registerModule({ multiInstance })) */
			MULTI_INSTANCE?: boolean;

			/** Custom settings of each instance (registerModule({ instanceSettingsSchema })) */
			INSTANCE_SETTINGS_SCHEMA?: SettingField[];

			/** The module's own CSS (registerModule({ styles })) */
			STYLES?: string[];

			/** Dependencies on other modules (registerModule({ dependsOn })) */
			DEPENDS_ON?: ModuleDependency[];

			/** Collected levels of the details contract (registerModule({ consumesDetails })) */
			CONSUMES_DETAILS?: Enums.DetailsScope[];

			/** Functions outside the sandbox an uploaded module asks for (registerModule({ capabilities })) */
			CAPABILITIES?: string[];

			/** The element edits the module's settings in Settings (registerModule({ settingsView })) */
			SETTINGS_VIEW?: boolean;

			/** The module whose settings view edits this module's settings (registerModule({ settingsEditedBy })) */
			SETTINGS_EDITED_BY?: string;

			/** The version of the module (registerModule({ version })), the version of a standalone extension built from it */
			VERSION?: string;
		}

		/** A module's dependency on another module (registerModule({ dependsOn })). */
		type ModuleDependency = {

			/** Name of the module the module depends on (MODULE_NAME) */
			module: string;

			/** Why it needs it — a short sentence for the Settings page */
			reason: string;
		};

		/** A type check "U satisfies T" — returns U, otherwise a compile error (TS2344). */
		type Satisfies<T, U extends T> = U;

		/**
		 * A constructor of the base class B whose instances additionally have the properties F (Classes.X.Fields).
		 * The base of a class that sets its properties only outside the constructor
		 * (init(), connectedCallback(), …) is cast to it in JS: otherwise TypeScript 6 (in VS Code) treats them in JS as
		 * `T | undefined` even with an @type annotation. Methods are not in F, so that noImplicitOverride
		 * does not require marking them as @override.
		 */
		type WithFields<B extends abstract new () => object, F> = Omit<B, 'prototype'> & ( new () => InstanceType<B> & F );

		/** Input of validateModule() — nothing in it is verified yet (urlDetails is an old, no longer supported key). */
		type UnvalidatedModuleDefinition = { [K in keyof ModuleDefinition]?: unknown } & { urlDetails?: unknown };

		/** Result of validateModule(). */
		type ModuleValidationResult = { errors: string[]; warnings: string[] };

		/** A configuration of the core's filters a module may declare in registerModule(): its key, the function it applies under, its check. */
		type DeclaredFilters = {
			key: 'networkFilters' | 'contentFilters';
			capability: string;
			normalize: ( config: unknown, mod: { usesPermissions?: PermissionSet[]; settingsSchema?: SettingField[] } ) => unknown;
		};

		/** Argument BaseElement.init(). */
		type ModuleInitOptions = {
			outputEl: HTMLElement;
			name: string;
			mode: Enums.ActivationMode;

			/** The surface on which the element is rendered ("settings" — the editor of its settings); without it BaseElement.init() uses "popup" */
			location?: Enums.ElementLocation;

			/** Instance id of a module with multiple instances; otherwise missing (null) */
			instance?: string | null;
		};

		/** A module list entry parsed by parseModuleEntry(). */
		type ModuleEntry = {

			/** The entry as it is in the list (including "#id") */
			entry: string;

			/** Path to the module file without the instance id */
			path: string;

			/** Module name */
			name: string;

			/** Instance id; null = a plain entry, for a module with multiInstance its template */
			instance: string | null;

			/** Settings key of the entry: "<module>#<id>", otherwise the module name */
			key: string;
		};

		/** A module list entry to show (resolveModuleEntries()) — including the module definition. */
		type ResolvedModuleEntry = ModuleEntry & { mod: ModuleDefinition };

		/** Result of BaseController.isModuleActive(); delegated — the module is shown by the service provider of this extension instead. */
		type ModuleActivity = { active: boolean; mode: Enums.ActivationMode; ctx: SpecificationContext; delegated: ExtensionServiceProviderState | null };

		/** The extension itself for a module (getExtensionInfo() of sdk.mjs, of the sandbox SDK too). */
		type ExtensionInfo = { name: string; version: string };

		/** A function a client serves: its name and whether it is a call or a listener. */
		type ExtensionServiceRef = { name: string; kind: 'call' | 'listen' };

		/** A function a client serves as it tells its provider: what it allows and its risk (from the client's catalog). */
		type ExtensionServiceInfo = ExtensionServiceRef & { risk: Enums.SandboxCapabilityRisk; about: string };

		/** A service of another module the modules of a client use (api.services.use()) and why — the provider does it for the client. */
		type ExtensionServiceUse = { name: string; about: string };

		/** A service of another module a module of this extension uses (api.services.use()): the module and why (a text, or a function giving it). */
		type UsedService = { moduleName: string; about: string | ( () => string ) };

		/** The package of an uploaded module of a client: its files as base64 and their fingerprint (hashSandboxFiles()). */
		type ExtensionServiceModulePackage = { name: string; hash: string; files: Record<string, string> };

		/** What a client tells its provider about itself (EXTENSION_SERVICE_REGISTER). */
		type ExtensionServiceRegistration = {
			name: string;
			version: string;
			modules: ExtensionServiceModulePackage[];
			services: ExtensionServiceInfo[];

			/** The services of other modules its modules use — the provider does them for it (EXTENSION_SERVICE_REQUEST); an older client sends none */
			uses: ExtensionServiceUse[];

			/** Its modules from the package — the provider does not run its own copies of them */
			replaces: string[];

			/** Of replaces the modules whose data the provider may back up and restore in the client (an older client sends none) */
			backup: string[];
		};

		/** A registration checked by the provider, or why it is refused. */
		type ExtensionServiceRegistrationCheck = { registration: ExtensionServiceRegistration | null; error: string | null };

		/** The provider's record of a client (EXTENSION_SERVICE_CLIENTS_KEY). */
		type ExtensionServiceClient = {
			id: string;
			name: string;
			version: string;

			/** The user's decision: pending until allowed or denied in Settings */
			status: 'pending' | 'approved' | 'denied';
			services: ExtensionServiceInfo[];

			/** The services of other modules its modules use (missing in a record from before it) */
			uses?: ExtensionServiceUse[];
			replaces: string[];

			/** The modules whose data the client keeps for the provider's backup (missing in a record from before it) */
			backup?: string[];

			/** The packages the client registered: module name → their fingerprint (the files are in SANDBOX_PACKAGES_DB) */
			modules: Record<string, { hash: string }>;

			/** The modules installed (evaluated and checked) — their records */
			installed: Record<string, SandboxModuleRecord>;
			registeredAt: number;
			updatedAt: number;

			/** Did the client answer the last time it was asked, and when it answered last */
			alive: boolean;
			seenAt: number;
		};

		/** A module whose data a client keeps (api.backup.listClientModules()): its name and the name of the client. */
		type ClientBackupModule = { name: string; extension: string };

		/** A client waiting for the user's decision that is there, and the modules of this extension that work in both extensions meanwhile. */
		type PendingExtensionServiceClient = { id: string; name: string; doubled: string[] };

		/** What the user's approval of a client did: the problems of the installation and the modules taken out of the module list. */
		type ExtensionServiceApproval = { problems: string[]; removed: string[] };

		/** The provider's answer to EXTENSION_SERVICE_STATUS: the status of the client and which of its modules it shows. */
		type ExtensionServiceStatusAnswer = { status: ExtensionServiceClient['status'] | 'unknown'; shown: string[]; provider: string };

		/** service-provider.json of the package: the id of the provider (null — not a client) and whether it is a standalone extension (never a provider). */
		type ServiceProviderConfig = { id: string | null; standalone: boolean };

		/** What a client remembers about its provider (EXTENSION_SERVICE_PROVIDER_KEY). */
		type ExtensionServiceProviderState = {
			id: string;

			/** unknown — the provider does not know the client or did not answer */
			status: ExtensionServiceClient['status'] | 'unknown';

			/** The modules of the client the provider shows */
			shown: string[];

			/** The name of the provider (its pages say where the module is) */
			provider: string | null;
			checkedAt: number;

			/** When the client registered last (EXTENSION_SERVICE_REGISTER_EVERY_MS) */
			registeredAt: number | null;
		};

		/** A module element created from its tag (see BaseController.mountModuleElement()). */
		type MountedModuleElement = HTMLElement & Partial<Pick<Classes.BaseElement, 'init'>>;

		/** A module's place in a surface's output (see BaseController.renderModulesFor()). */
		type ModuleSlot = {
			mod: ModuleDefinition;

			/** Settings key of the list entry (see Types.ModuleEntry) */
			key: string;

			/** Instance id of the module, otherwise null */
			instance: string | null;
			mode: Enums.ActivationMode;

			/** An invisible marker in the order of the module list — the frame is inserted before it */
			anchor: Comment;

			/** Frame of the shown module; null = the module is not shown now */
			frame: HTMLElement | null;

			/** The frame is shown at the top as the pinned one (see Types.ModulePin) */
			pinned: boolean;
		};

		/** A rendered surface (BaseController.renderModulesFor()). */
		type ModuleSurface = {

			/** Creates the elements of the named modules anew with the current settings */
			remount( names: string[] ): Promise<void>;
		};

		/** The pinned module of a surface (see BaseController.renderModulesFor()). */
		type ModulePin = {
			/** Settings key of the pinned list entry; null = nothing is pinned */
			key: string | null;

			/** An invisible marker at the very beginning of the output — the pinned frame is inserted before it */
			anchor: Comment;

			/** Pins the entry with the key, the pinned one unpins (saves it and shows the change) */
			toggle( key: string ): void;
		};

		// --- Floating window ---

		/** Options of createFloatingWindow() */
		type FloatingWindowOptions = {
			title?: string;
			top?: string;
			left?: string;
			width?: string;
			height?: string;

			/** After the window has been dragged */
			onMove?: ( position: { top: string; left: string } ) => void;

			/** After the window has been resized */
			onResize?: ( size: { width: string; height: string } ) => void;

			/** After the window is closed (with the cross or close()) */
			onClose?: () => void;
		};

		/** Floating window: a <div> with Shadow DOM and a close() method with the same cleanup as the cross. */
		type FloatingWindowElement = HTMLDivElement & { close(): void };

		// --- Uploaded modules (sandbox) ---

		/**
		 * An activation rule written as data — the sandbox writes it (toDescriptor() of its specifications), the core
		 * turns it into its own Specification classes (specFromDescriptor()).
		 */
		type SpecificationDescriptor =
			| { type: 'all' }
			| { type: 'and' | 'or'; specs: SpecificationDescriptor[] }
			| { type: 'not'; spec: SpecificationDescriptor }
			| { type: 'mode'; mode: Enums.ActivationMode }
			| { type: 'url'; patterns: string[] }
			| { type: 'location'; locations: Enums.RenderLocation[] }
			| { type: 'disabled' }
			| { type: 'notDisabled' }
			| { type: 'webPage' };

		/** The module list entry of an uploaded module (SANDBOX_ENTRY_PREFIX) — "sandbox://<name>/<name>.js". */
		type SandboxModuleEntry = `sandbox://${ string }`;

		/** Data about the uploaded file of a module (ModuleDefinition.sandbox) — Settings shows them. */
		type SandboxModuleInfo = {

			/** The uploaded file: <name>.js, <name>.mjs or a .zip */
			fileName: string;

			/** The entry file in the package (<name>.js or <name>.mjs) */
			entry: string;

			/** Number of files in the package */
			files: number;

			/** Bytes of the uploaded file */
			size: number;

			/** SHA-256 of the uploaded file (hex) — the same as in its stored package */
			hash: string;

			/** First upload and the last one (ms since the epoch) */
			installedAt: number;
			updatedAt: number;

			/** A module the extension brings itself (BUNDLED_SANDBOX_MODULES) — the core installs it, it cannot be removed */
			bundled?: boolean;

			/** A module of another extension (a client of this service provider): its id */
			client?: string;

			/** The functions the client of the module serves (only with client) */
			services?: ExtensionServiceRef[];
		};

		/** A stored uploaded module (chrome.storage.local, SANDBOX_MODULES_KEY); its files are in SANDBOX_PACKAGES_DB. */
		type SandboxModuleRecord = SandboxModuleInfo & {

			/** Module name == the name of the entry file without .js/.mjs */
			name: string;

			/** What the module declared in registerModule(), evaluated in each UI language (texts) */
			registrations: Partial<Record<Enums.UiLanguage, SandboxRegistration>>;
		};

		/** Uploaded modules: module name → record. */
		type SandboxModuleStore = Record<string, SandboxModuleRecord>;

		/** The uploaded file (a File from <input type="file">, in tests a substitute). */
		type SandboxFile = { name: string; size?: number; arrayBuffer(): Promise<ArrayBuffer> };

		/** A type of file a package may contain (SANDBOX_FILE_TYPES): its MIME type and whether it must be UTF-8 text. */
		type SandboxFileType = { type: string; text: boolean };

		/** unpackSandboxUpload(): the content of the package (null = it cannot be uploaded), errors and warnings. */
		type SandboxUnpacked = { content: SandboxPackageContent | null; errors: string[]; warnings: string[] };

		/** A module specifier resolved in the package: a file of the package or the SDK (resolveSandboxImport()). */
		type SandboxImportTarget = Exclude<SandboxRewriteTarget, { kind: 'meta' }>;

		/** planSandboxPackage(): what the sandbox needs to load a JS module (null for a classic script or when there are errors). */
		type SandboxPlanned = { plan: SandboxModulePlan | null; errors: string[]; warnings: string[] };

		/** Evaluating an uploaded module in one UI language (inspectSandboxModule()). */
		type SandboxInspectRequest = { pkg: SandboxPackage; language: Enums.UiLanguage };

		/** What the module declared in registerModule() as data, or the texts of the problems found. */
		type SandboxInspection = { registration: SandboxRegistration | null; problems: string[] };

		/** Where the content of a package comes from (installSandboxContent()): the uploaded file, or the extension itself. */
		type SandboxContentSource = {

			/** The uploaded file, or the folder of a module the extension brings itself */
			fileName: string;

			/** Bytes of the uploaded file (of all the files of a package the extension brings) */
			size: number;

			/** SHA-256 of the uploaded file (hashSandboxFiles() of a package the extension brings) */
			hash: string;

			/** A module the extension brings itself (BUNDLED_SANDBOX_MODULES) */
			bundled: boolean;
		};

		/** Options of installSandboxModule(). */
		type SandboxInstallOptions = {

			/** Replaces evaluating the module in a sandbox page (tests without <iframe>) */
			inspect?: ( request: SandboxInspectRequest ) => Promise<SandboxInspection>;
		};

		/** Result of uploading a module (installSandboxModule()). */
		type SandboxInstallResult = {
			ok: boolean;

			/** Module name from the file name; null = invalid name */
			name: string | null;
			errors: string[];
			warnings: string[];

			/** The module was already uploaded — this is its new version */
			updated: boolean;

			/** The module was added to the module list (it was not there) */
			added: boolean;
		};

		/**
		 * An api method of an uploaded module with one response — run through the module's own api; host = the element that
		 * embeds the module (null when the core is called without one, e.g. in a test).
		 */
		type SandboxApiCall = {
			kind: 'call';
			run: ( api: ModuleApi, args: unknown[], mod: ModuleDefinition, host: SandboxHost | null ) => unknown;
		};

		/** An api listener of an uploaded module — emit() sends the event to the sandbox; returns a function to unsubscribe. */
		type SandboxApiSubscription = {
			kind: 'subscribe';
			run: ( api: ModuleApi, args: unknown[], mod: ModuleDefinition, emit: ( value: unknown ) => void, host: SandboxHost | null ) => () => void;
		};

		/** How the core runs an api method of an uploaded module (SANDBOX_API). */
		type SandboxApiHandler = SandboxApiCall | SandboxApiSubscription;

		/**
		 * The element that embeds an uploaded module (SandboxModuleElement), for the api methods that need it: the surface it
		 * is rendered on and the buttons the core draws for the module (api.buttons).
		 */
		type SandboxHost = {

			/** The surface of the element */
			location: Enums.ElementLocation;

			/** Draws the module's buttons (api.buttons.set()); throws on an invalid one */
			setButtons( buttons: unknown, options: unknown ): void;

			/** A listener of the clicks on the buttons (api.buttons.onClick()); returns a function to unsubscribe */
			onButtonClick( emit: ( click: SandboxButtonClick ) => void ): () => void;

			/** Draws the module's content instead of its frame (api.ui.render()), null shows the frame; throws on an invalid one */
			renderUi( content: unknown ): void;

			/** A listener of the controls of the drawn content (api.ui.onEvent()); returns a function to unsubscribe */
			onUiEvent( emit: ( event: SandboxUiEvent ) => void ): () => void;

			/** Scrolls the extension page to the module's output (api.ui.scrollIntoView()); offset = px from the top of its frame, null = the output */
			scrollIntoView( offset: number | null ): void;
		};

		/** Microdata of the drawn content: the item a node starts (a schema.org type) and the property of the parent item it is. */
		type SandboxUiItem = { itemtype: string; itemprop?: string };

		/** A node of a line of text the core draws for an uploaded module (api.ui.render() after the checks). */
		type SandboxUiInline =
			| string
			| { type: 'strong' | 'em' | 'code' | 'text'; text: string; itemprop?: string }
			| ( SandboxUiItem & { type: 'item'; meta: Array<{ itemprop: string; content: string }>; content: SandboxUiInline[] } )
			| { type: 'link'; text: string; href: string; title: string | null; muted: boolean }
			| {
				type: 'button';
				id: string;
				label: string;
				title: string | null;
				disabled: boolean;
				look: 'button' | 'link';

				/** The declared function outside the sandbox a click runs within the click (null = the click goes to the module) */
				capability: string | null;
				args: unknown[];
			}
			| { type: 'checkbox'; id: string; label: string; title: string | null; checked: boolean; disabled: boolean };

		/** A block of the content the core draws for an uploaded module (api.ui.render() after the checks). */
		type SandboxUiBlock = (
			| { type: 'paragraph' | 'heading'; content: SandboxUiInline[] }
			| { type: 'list'; ordered: boolean; items: SandboxUiInline[][] }
			| { type: 'definitions'; items: Array<{ term: SandboxUiInline[]; details: SandboxUiInline[] }> }
			| { type: 'table'; caption: SandboxUiInline[] | null; head: SandboxUiInline[][] | null; rows: SandboxUiInline[][][] }
			| { type: 'details'; id: string | null; open: boolean | null; summary: SandboxUiInline[]; content: SandboxUiNode[] }
			| { type: 'group'; content: SandboxUiNode[] }
		) & {

			/** The block starts an item of microdata (its nodes are the properties) */
			item?: SandboxUiItem;
		};

		/** A node of the content the core draws — a block, or inline content directly among the blocks. */
		type SandboxUiNode = SandboxUiBlock | SandboxUiInline;

		/** What the controls of the drawn content report to the module (api.ui.onEvent()). */
		type SandboxUiEvent =
			| { id: string; type: 'click' }
			| { id: string; type: 'change'; checked: boolean }
			| { id: string; type: 'toggle'; open: boolean }
			| { type: 'enter' };

		/** A button the core draws for an uploaded module — api.buttons.set() after the checks. */
		type SandboxButton = {
			id: string;
			label: string;
			title: string | null;
			disabled: boolean;

			/** The function outside the sandbox a click runs, with its arguments */
			capability: string;
			args: unknown[];
		};

		/**
		 * Where a function outside the sandbox runs: the module's api, the surface of its element (null = no element) and what
		 * the module declared (its definition on the page).
		 */
		type SandboxCapabilityContext = { api: ModuleApi; location: Enums.ElementLocation | null; module: ModuleDefinition };

		/**
		 * A function outside the sandbox the core offers (SANDBOX_CAPABILITIES) — it checks its arguments itself. Either
		 * one with a result (run, capabilities.call() or a button the core draws), or a listener (listen,
		 * capabilities.listen()).
		 */
		type SandboxCapability = {
			risk: Enums.SandboxCapabilityRisk;

			/** What it allows, for the user's choice in Settings */
			about: () => string;

			/**
			 * Only from a button the core draws for the module (api.buttons) — the browser allows it only in the handler of a
			 * click, and a request from the sandbox reaches the core as a message
			 */
			clickOnly?: true;

			/** Can it work here (the browser, the surface)? Missing = always */
			available?: ( context: SandboxCapabilityContext ) => boolean;
		} & (
			| {
				/** Runs it — a browser API that wants a click is called before the first await */
				run: ( args: unknown[], context: SandboxCapabilityContext ) => Promise<unknown>;
				listen?: undefined;
			}
			| {
				/** Starts the listener — emit() sends an event to the module; returns a function to stop it */
				listen: ( args: unknown[], context: SandboxCapabilityContext, emit: ( value: unknown ) => void ) => () => void;
				run?: undefined;
			}
		);

		/** What cannot be allowed (SANDBOX_FORBIDDEN_CAPABILITIES): names (and the names below them) and the reason. */
		type SandboxCapabilityRule = { reason: Enums.SandboxCapabilityBlock; names: readonly string[] };


		/** One part of storageUsage.get: its values, null = this browser does not have the storage, or why measuring it failed. */
		type SandboxStorageUsagePart<T> = T | { error: string } | null;

		/**
		 * The result of storageUsage.get (the catalog): how much the extension's own storages take up, as the page that embeds
		 * the module sees them — only counts of items and sizes in bytes, never a key or a value.
		 */
		type SandboxStorageUsage = {

			/** localStorage of the extension: the items and their estimated size (UTF-16, 2 B per character of a key and a value) */
			localStorage: SandboxStorageUsagePart<{ items: number; bytes: number }>;

			/** The IndexedDB database of the records (DB_NAME): the records in all its stores (0 when it does not exist yet) */
			indexedDb: SandboxStorageUsagePart<{ database: string; items: number }>;

			/** navigator.storage.estimate() of the extension's origin */
			estimate: SandboxStorageUsagePart<{ quota: number; usage: number }>;

			/** chrome.storage.local.getBytesInUse() — null where the browser does not have it */
			chromeStorage: SandboxStorageUsagePart<{ bytes: number }>;

		};

		/**
		 * The result of buildSettings.get (the catalog): the build settings of the modules for their standalone extensions
		 * (modules/<module>/standalone.json) — the files are only in an extension run unpacked from the project.
		 */
		type SandboxBuildSettings = {

			/** Does the extension run unpacked from the project (installType "development"); null = the browser does not say */
			unpacked: boolean | null;

			/** The modules of the default list with standalone.json: its content, or why it is not valid JSON */
			modules: Array<{ module: string; settings: unknown } | { module: string; error: string }>;

		};







		// #region standalone: tabGroups, tabGroupsSandbox
		/** The result of tabGroups.getOverview (the catalog): the overview of the window, or why tabGroups does not work */
		type SandboxTabGroupsOverview = {
			reason: Enums.SandboxTabGroupsReason | null;
			overview: Types.TabGroups.Overview | null;
		};
		// #endregion standalone: tabGroups, tabGroupsSandbox

		/** The user's decisions: module name → function → true (allowed) / false (denied); missing = undecided. */
		type SandboxCapabilityGrants = Record<string, Record<string, boolean>>;

		/** One entry of the record of the functions outside the sandbox (SANDBOX_CAPABILITY_LOG_KEY). */
		type SandboxCapabilityLogEntry = {
			module: string;

			/** The requested function, as the module sent it (cut to 100 characters) */
			capability: string;
			outcome: Enums.SandboxCapabilityOutcome;
			count: number;

			/** The first and the last time (ms since the epoch) */
			first: number;
			last: number;
		};

		/** The module that asks: its name, the valid names it declared, and whether the extension brings it. */
		type SandboxCapabilityHolder = { name: string; capabilities: string[]; bundled: boolean; services?: string[] };

		/** A listener of a function outside the sandbox (a catalog entry, or one a client serves). */
		type SandboxCapabilityListen = ( args: unknown[], context: SandboxCapabilityContext, emit: ( value: unknown ) => void ) => () => void;

		/** What the core knows about the name of a function outside the sandbox (describeSandboxCapability()). */
		type SandboxCapabilityInfo = {
			name: string;
			kind: Enums.SandboxCapabilityKind;

			/** A function of the catalog: its risk and what it allows */
			risk: Enums.SandboxCapabilityRisk | null;
			about: string | null;

			/** One that cannot be allowed: the reason as a text and its code */
			blocked: string | null;
			reason: Enums.SandboxCapabilityBlock | null;
		};

		/** A declared function with its state for the module (Settings). */
		type SandboxCapabilityOverviewItem = SandboxCapabilityInfo & { state: Enums.SandboxCapabilityState };

		// --- Module API (createModuleApi()) ---

		/** api.settings — the module's own settings without knowing SETTINGS_KEY. */
		interface ModuleSettingsApi {

			/** The whole moduleSettings blob */
			getAll(): Promise<ModuleSettings>;

			/** Writes the whole moduleSettings blob (read-modify-write is up to the caller) */
			setAll( settings: ModuleSettings ): Promise<void>;

			/**
			 * One custom value of the module; defaultValue without a stored value. The result type is determined by the default value
			 * (number, text, yes/no) — the module stores a value of the same type under its key. Otherwise unknown.
			 */
			get( key: string, defaultValue: number ): Promise<number>;
			get( key: string, defaultValue: string ): Promise<string>;
			get( key: string, defaultValue: boolean ): Promise<boolean>;
			get( key: string, defaultValue?: unknown ): Promise<unknown>;

			/** Writes one custom value of the module */
			set( key: string, value: unknown ): Promise<void>;

			/** A value of a group of settings shared by several modules (SettingField.shared); the result type as for get() */
			getShared( group: string, key: string, defaultValue: number ): Promise<number>;
			getShared( group: string, key: string, defaultValue: string ): Promise<string>;
			getShared( group: string, key: string, defaultValue: boolean ): Promise<boolean>;
			getShared( group: string, key: string, defaultValue?: unknown ): Promise<unknown>;

			/** Writes a value of a group of shared settings (the same for every module that declares the field) */
			setShared( group: string, key: string, value: unknown ): Promise<void>;

			/** The module's activation mode (user > module > global default) */
			getMode( moduleDefaultMode?: Enums.ActivationMode ): Promise<Enums.ActivationMode>;

			/** On every change of moduleSettings; returns a function to unsubscribe */
			onChange( handler: ( settings: ModuleSettings ) => void ): () => void;

		}

		/**
		 * api.state (chrome.storage.local) / api.sessionState (chrome.storage.session) — the module's own state outside
		 * the settings, each value under its own storage key ("moduleState.<module>.<key>").
		 */
		interface ModuleStateApi {

			/** The stored value, otherwise defaultValue — the content comes from storage, the module verifies it itself */
			get( key: string, defaultValue?: unknown ): Promise<unknown>;

			/** Writes one value (does not change the module's other values) */
			set( key: string, value: unknown ): Promise<void>;

			/** On every change of the value key of this module from anywhere in the extension; returns a function to unsubscribe */
			onChange( key: string, handler: ( value: unknown ) => void ): () => void;

		}

		/** api.activation — should the module work right now? (module list + activation mode, without a surface) */
		interface ModuleActivationApi {

			/** The module is in the module list and its activationSpec (default NOT_DISABLED_SPEC) holds for the current mode */
			isActive( moduleDefaultMode?: Enums.ActivationMode, activationSpec?: Classes.Specification ): Promise<boolean>;

			/** Why the module does not work: not in the module list / its activationSpec does not hold; null = it works */
			reason( moduleDefaultMode?: Enums.ActivationMode, activationSpec?: Classes.Specification ): Promise<'notListed' | 'disabled' | null>;

			/** On a change of the module list or moduleSettings; returns a function to unsubscribe */
			onChange( handler: () => void ): () => void;

			/**
			 * After the extension is installed/updated, once the core has filled in the default settings — only in a module's background part;
			 * returns a function to unsubscribe
			 */
			onInstalled( handler: InstalledHandler ): () => void;

		}

		/** Listener of api.activation.onInstalled() — details from chrome.runtime.onInstalled. */
		type InstalledHandler = ( details: chrome.runtime.InstalledDetails ) => void | Promise<void>;

		/** Listener of api.activation.onInstalled() in the core registry, including the module name (for error reports). */
		type InstalledListener = { moduleName: string; handler: InstalledHandler };

		/** Argument of setup() of a module's background part. */
		type BackgroundScriptContext = { api: ModuleApi };

		/** A module's background part passed to registerBackgroundScript() (modules/<name>/background-script.mjs). */
		interface BackgroundScriptDefinition {

			/** Module name == the name of its folder (the same as in registerModule()) */
			name: string;

			/** Called right on import in background.js; chrome.* listeners must be registered synchronously */
			setup: ( context: BackgroundScriptContext ) => void | Promise<void>;

		}

		/** api.messages — chrome.runtime messages with automatic unsubscription. */
		interface ModuleMessagesApi {

			/** Listener of messages of one type (including those relayed from the floating window); returns a function to unsubscribe */
			on<K extends MessageType>( type: K, handler: MessageHandler<K> ): () => void;

			/** A message to the content script of the tab the surface relates to (like tabs.getActive()) */
			toActiveTab<M extends AnyMessage>( message: M ): Promise<MessageResponse<M['type']> | undefined>;

			/** A message to all listeners in the extension (modules, background; from a background part also the other background parts) */
			send<M extends AnyMessage>( message: M ): Promise<MessageResponse<M['type']> | void>;

		}

		/** A listener of a module background part (api.messages.on() in background.js) — the messages of the other background parts reach it */
		type BackgroundPartListener = { moduleName: string; listener: RuntimeMessageListener };

		/** Delivers a message to the core listeners in background.js without chrome.runtime (see sendToBackground()). */
		type BackgroundDispatcher = ( message: AnyMessage ) => Promise<AnyMessageResponse | undefined>;

		/** The core's envelope in notification.data: who sent the notification, the module data inside. */
		type NotificationEnvelope = { uid: string; module: string; data: unknown };

		/** Common fields of extension notification events. */
		type ExtensionNotificationEventBase = {

			/** Notification id (the core assigns it in show()) */
			uid: string;

			/** The module that sent the notification */
			module: string;

			/** ms since the epoch */
			at: number;
		};

		/** An extension notification event for api.notifications.onEvent(). */
		type ExtensionNotificationEvent =
			| ( ExtensionNotificationEventBase & {
				type: 'create';
				title: string;

				/** options as the module passed them (a copy through JSON) */
				options: Record<string, unknown>;
				permission: NotificationPermission | null;

				/** How many buttons the browser shows (Chrome only) */
				maxActions: number | null;

				/** The extension's service worker through which the notification is shown (Chrome); null for a background page */
				serviceWorker: { scope: string; scriptURL: string | null; state: string | null } | null;
			} )
			| ( ExtensionNotificationEventBase & {
				type: 'show';

				/** Properties as the browser used them; null for those not found */
				properties: Record<string, unknown> | null;
			} )
			| ( ExtensionNotificationEventBase & { type: 'error'; message: string | null } )
			| ( ExtensionNotificationEventBase & {
				type: 'click';

				/** A notification button (action), null for a click on the notification itself */
				action: string | null;

				/** The data the module gave show() (a copy through JSON) */
				data: unknown;
			} )
			| ( ExtensionNotificationEventBase & { type: 'close' } );

		/** A click on a notification of a module (api.notifications.onClick(), a change of chrome.storage.local). */
		type NotificationClick = { uid: string; data: unknown; action: string | null; at: number };

		/** Listener of api.notifications.onEvent(); the service worker keeps a returned promise alive. */
		type NotificationEventHandler = ( event: ExtensionNotificationEvent ) => void | Promise<void>;

		/** Listener of api.notifications.onEvent() in the core registry, including the module name (for error reports). */
		type NotificationListener = { moduleName: string; handler: NotificationEventHandler };

		/** notificationclick/notificationclose of the service worker (NotificationEvent — the "dom" lib does not have it). */
		type ServiceWorkerNotificationEvent = Event & {
			notification: Notification;
			action?: string;
			waitUntil( promise: Promise<unknown> ): void;
		};

		/** api.notifications — extension notifications through the core (shown by background.js). */
		interface ModuleNotificationsApi {

			/** Shows a notification of THIS module; in Chrome it resolves once shown, a display error rejects it */
			show( title: string, options?: NotificationOptions ): Promise<void>;

			/** Every extension notification and its progress — only in a module's background part; returns a function to unsubscribe */
			onEvent( handler: NotificationEventHandler ): () => void;

			/** Clicks on the notifications of THIS module from now on, on any extension page; returns a function to unsubscribe */
			onClick( handler: ( click: NotificationClick ) => void ): () => void;

		}

		/** api.data — shared IndexedDB through background.js. */
		interface ModuleDataApi {

			/** Stores a module record (with an optional own key); the promise resolves only after the write */
			log( payload: unknown, options?: DataLogOptions ): Promise<MessageResponse<'SDK_DATA_LOG'> | void>;

			/** Records of THIS module from one document, newest first */
			findByDocument( query: { tabId?: number | null; documentKey?: number | null } ): Promise<DataEntry[]>;

			/** Records of THIS module from pages of one domain, newest first */
			findByDomain( query?: { domain?: string | null; limit?: number } ): Promise<DataEntry[]>;

			/** Records of THIS module under its own key (options.key of log()), newest first */
			findByKey( query?: { key?: string | null; limit?: number } ): Promise<DataEntry[]>;

			/** Number of records of THIS module */
			count(): Promise<number>;

			/** Number of records of all modules */
			total(): Promise<number>;

			/** The last limit records of THIS module from the active tab, newest first */
			listForActiveTab( limit: number ): Promise<DataEntry[]>;

			/** The last limit records of THIS module from all tabs and domains, newest first */
			listLatest( limit: number ): Promise<DataEntry[]>;

			/** Fields from patch replace the same-named payload fields of record id (only a record of THIS module); true = changed */
			update( id: number, patch: Record<string, unknown> ): Promise<boolean>;

			/** Deletes record id (only a record of THIS module); true = deleted */
			remove( id: number ): Promise<boolean>;

		}

		/** api.rateLimit — a shared rate limit for the whole extension (counted by background.js). */
		interface ModuleRateLimitApi {

			/** May the operation run now? An allowed one is counted right away; otherwise try again after waitMs */
			acquire( bucket: string, windows: RateLimitWindow[] ): Promise<RateLimitDecision>;

			/** Blocks the key for ms (nothing is allowed anywhere in the extension); ms <= 0 cancels the block */
			block( bucket: string, ms: number ): Promise<number | null>;

			/** Block and operation times of the key */
			getState( bucket: string ): Promise<RateLimitStatus>;

		}

		/** api.networkRules — the module's dynamic declarativeNetRequest rules (managed by background.js). */
		interface ModuleNetworkRulesApi {

			/** Replaces the whole rule set of THIS module (empty array = none); returns the status in the browser. options.bulk = bulk rules */
			set( rules: NetworkRule[], options?: NetworkRulesSetOptions ): Promise<NetworkRulesStatus>;

			/** Status of THIS module's rules in the browser without changing the set */
			getStatus(): Promise<NetworkRulesStatus>;

		}

		/** api.tabs */
		interface ModuleTabsApi {

			/** The tab the element's surface relates to, or null */
			getActive(): Promise<ActiveTabInfo | null>;

			/**
			 * After another tab became the one the surface relates to, or that one got a new address (also history.pushState())
			 * — the handler gets the same value as getActive(); only a real change is reported. Returns a function to unsubscribe.
			 */
			onChange( handler: ( tab: ActiveTabInfo | null ) => void ): () => void;

			/** Opens a page of the extension (only OPENABLE_EXTENSION_PAGES: "options.html", "onboarding.html") in a new tab */
			openExtensionPage( page: string ): Promise<void>;

		}

		/** api.floatingWindow */
		interface ModuleFloatingWindowApi {

			/** The whole stored floating window state for all domains */
			getAllStates(): Promise<FloatingWindowStateStore>;
			setAllStates( data: FloatingWindowStateStore ): Promise<void>;

			/** On every change of the stored state; returns a function to unsubscribe */
			onChange( handler: ( data: FloatingWindowStateStore ) => void ): () => void;

			/** Opens/closes the floating window on the surface's tab — call it directly from a click handler */
			toggle(): Promise<void>;

		}

		/** api.permissions — optional permissions including the request history. */
		interface ModulePermissionsApi {
			contains( permissions: PermissionSet ): Promise<boolean>;

			/** Only in a direct reaction to a user gesture; true = the user granted the permission */
			request( permissions: PermissionSet ): Promise<boolean>;
			remove( permissions: PermissionSet ): Promise<boolean>;

			/** History of requests/removals of one permission or origin, from the oldest */
			getActivity( permissionOrOrigin: string ): Promise<PermissionActivityEntry[]>;

			/** On a change of granted permissions or of the history; returns a function to unsubscribe */
			onChange( handler: () => void ): () => void;
		}

		/** api.badge — coloring the extension icon by bookmark folders. */
		interface ModuleBadgeApi {

			/** Replaces the whole rule set of THIS module */
			setRules( rules: BadgeRule[] ): Promise<void>;
			getRules(): Promise<BadgeRule[]>;

		}

		/** api.details — the consumer side of the details contract. */
		interface ModuleDetailsApi {

			/** Does at least one enabled module (except the caller) offer details at the given level? */
			hasProviders( scope: Enums.DetailsScope ): Promise<boolean>;

			/** Collects non-empty details of the given level from all enabled providers */
			collect( scope: 'visit', context: DetailsContextMap['visit'] ): Promise<CollectedDetails[]>;
			collect( scope: 'domain', context: DetailsContextMap['domain'] ): Promise<CollectedDetails[]>;
			collect( scope: 'browser', context?: DetailsContextMap['browser'] ): Promise<CollectedDetails[]>;

			/**
			 * Calls handler after a provider of the level stored, changed or deleted a record that can concern the context
			 * (changes in a row once) — the consumer collects again; returns a function to unsubscribe. Only on extension pages.
			 */
			onChange( scope: 'visit', context: DetailsContextMap['visit'], handler: () => void ): () => void;
			onChange( scope: 'domain', context: DetailsContextMap['domain'], handler: () => void ): () => void;
			onChange( scope: 'browser', context: DetailsContextMap['browser'], handler: () => void ): () => void;

		}

		/** api.backup — the WHOLE chrome.storage.local at once (the importExport module). */
		interface ModuleBackupApi {
			exportAll(): Promise<StorageLocal>;

			/** Replaces the whole storage content (clear() + set()), does not merge */
			importAll( data: StorageLocal | null | undefined ): Promise<void>;

			/** Backup of one module by name: settings, api.state, api.data records, its own data (backupData) */
			exportModule( moduleName: string ): Promise<ModuleBackup>;

			/** Replaces the module's data with the backup content (only the parts the backup has); backup from a file, unverified */
			importModule( moduleName: string, backup: unknown, options?: ModuleBackupImportOptions ): Promise<void>;

			/** The modules whose data another extension keeps (an allowed client that is there) — exportModule()/importModule() go to it */
			listClientModules(): Promise<ClientBackupModule[]>;
		}

		/** api.network — data the page's JS cannot get to (chrome.webRequest/webNavigation in background.js). */
		interface ModuleNetworkApi {

			/** For a content script: how the tab got to the current document (with forDocument only to THIS document, possibly waiting a while) */
			getNavigationTransition( forDocument?: DocumentRef ): Promise<NavigationTransition | null>;

			/** For a content script: the HTTP redirect chain of the current document (with forDocument only of THIS document, possibly waiting a while) */
			getRedirectChain( forDocument?: DocumentRef ): Promise<RedirectChain | null>;

			/** IP address of the active tab's main document */
			getIpForActiveTab(): Promise<string | null>;

		}

		/** A DevTools protocol command for api.debugger.sendCommands(). */
		type DebuggerCommand = { method: string; params?: Record<string, unknown> };

		/** Result of one command — the protocol response, or the error text. */
		type DebuggerCommandResult = { result?: Record<string, unknown>; error?: string };

		/** api.debugger — the DevTools protocol through chrome.debugger (Chrome only, DEBUGGER_PERMISSIONS). */
		interface ModuleDebuggerApi {

			/** Protocol targets without attaching the debugger (no debugging infobar) */
			getTargets(): Promise<chrome.debugger.TargetInfo[]>;

			/** Attaches the debugger to the target, sends the commands one after another and detaches it (in background.js) */
			sendCommands( debuggee: chrome.debugger.Debuggee, commands: DebuggerCommand[] ): Promise<DebuggerCommandResult[]>;

		}

		/** What a page says about itself to a service of a background part (moduleServiceContext()). */
		type ModuleServiceContextInput = {

			/** The window of the page; null where it cannot tell (the floating window) */
			windowId: number | null;

			/** The UI language of the page */
			language: string;

			/** The surface the module is rendered on (popup, sidebar, settings, …) */
			location: string | null;
		};

		/** The context a service handler gets: what the page said, and who asks — this extension (a page or a background part), the service provider, or a client of this extension (api.services.call() of its module). */
		type ModuleServiceContext = ModuleServiceContextInput & { from: 'page' | 'provider' | 'client' };

		/** A function of a background part offered as a service (api.services.provide()). */
		type ModuleServiceHandler = ( args: unknown[], context: ModuleServiceContext ) => unknown;

		/** One registered service: the module whose background part does it and its handler (null — a listener fed by changed()). */
		type BackgroundService = { moduleName: string; handler: ModuleServiceHandler | null };

		/** The answer to a service request (MODULE_SERVICE_CALL, EXTENSION_SERVICE_CALL). */
		type ModuleServiceAnswer = { ok: true; value: unknown } | { ok: false; error: string };

		/** api.services — functions of the catalog of uploaded modules the module's background part does itself. */
		interface ModuleServicesApi {

			/** Offers a function as a service (only in a background part, in setup()); returns a function to withdraw it */
			provide( name: string, handler: ModuleServiceHandler ): () => void;

			/** Offers a listener the background part feeds with changed() — for a service provider; returns a function to withdraw it */
			provideListener( name: string ): () => void;

			/** What a listener of the service follows has changed — sent to a service provider that holds a lease on it */
			changed( name: string, value: unknown ): void;

			/** The module uses a service of another module (in setup() of its background part; about — why, for the user of a service provider); returns a function to withdraw it */
			use( name: string, about: string | ( () => string ) ): () => void;

			/** A service of another module wherever it runs (this extension, its client, its service provider): its answer, or an error (nowhere, no answer) */
			call( name: string, args?: unknown[] ): Promise<unknown>;

		}

		/** The module's public API (createModuleApi()) — the module's only way to the core. */
		interface ModuleApi {
			settings: ModuleSettingsApi;
			state: ModuleStateApi;
			sessionState: ModuleStateApi;
			activation: ModuleActivationApi;
			messages: ModuleMessagesApi;
			notifications: ModuleNotificationsApi;
			data: ModuleDataApi;
			rateLimit: ModuleRateLimitApi;
			networkRules: ModuleNetworkRulesApi;
			tabs: ModuleTabsApi;
			floatingWindow: ModuleFloatingWindowApi;
			permissions: ModulePermissionsApi;
			badge: ModuleBadgeApi;
			details: ModuleDetailsApi;
			backup: ModuleBackupApi;
			network: ModuleNetworkApi;
			services: ModuleServicesApi;
			debugger: ModuleDebuggerApi;

			/** Module load measurement (perf.mjs) — see Types.ModulePerfApi in perf.globals.d.ts */
			perf: ModulePerfApi;
		}

	}

	namespace Functions {

		namespace Base {

			/** Registers the module (after validation) into globalThis.__extensionModules */
			type registerModule = ( moduleDef: Types.ModuleDefinition ) => void;

			/** Registers a module's background part and right away (synchronously, in try/catch) calls its setup() */
			type registerBackgroundScript = ( definition: Types.BackgroundScriptDefinition ) => void;

			/** api.services.provide(): registers a service of a background part (background.js only); returns a function to withdraw it */
			type provideBackgroundService = ( moduleName: string, name: string, handler: Types.ModuleServiceHandler | null ) => () => void;

			/** The names of the services the background parts of this extension offer */
			type listBackgroundServices = () => string[];

			/** Runs a service of a background part: its answer, or its error */
			type runBackgroundService = ( name: unknown, args: unknown, context: Types.ModuleServiceContext ) => Promise<unknown>;

			/** What a page says about itself to a service: its window, the UI language, the surface */
			type moduleServiceContext = ( location: string | null | undefined ) => Promise<Types.ModuleServiceContextInput>;

			/** The context of a service request from a message, checked */
			type normalizeServiceContext = ( value: unknown, from: Types.ModuleServiceContext['from'] ) => Types.ModuleServiceContext;

			/** A service of a background part of this extension from an extension page */
			type callModuleService = ( name: string, args: unknown[], location: string | null | undefined ) => Promise<unknown>;

			/** api.services.use(): the module uses a service of another module */
			type useModuleService = ( moduleName: string, name: unknown, about: Types.UsedService['about'] ) => () => void;

			/** The services the modules of this extension use, with why (for the registration of a client) */
			type listUsedServices = () => Types.ExtensionServiceUse[];

			/** api.services.call(): a service of another module wherever it runs, through background.js */
			type callRoutedModuleService = ( name: string, args: unknown[], location: string | null | undefined ) => Promise<unknown>;

			/** Where a service of another module runs (a client, this extension, the provider) and its answer; from — the extension that asked */
			type routeModuleService = ( name: unknown, args: unknown, context: Types.ModuleServiceContext, from?: string | null ) => Promise<unknown>;

			/** A request of a service to another extension (a call of a client, a request to the provider) with the context of the page */
			type askExtensionService = ( id: string, type: string, name: string, args: unknown, context: Types.ModuleServiceContextInput ) => Promise<unknown>;

			/** A request of a client for a service of another module (EXTENSION_SERVICE_REQUEST) */
			type handleClientServiceRequest = ( id: string, message: Record<string, unknown> ) => Promise<Types.ModuleServiceAnswer>;

			/** Calls the api.activation.onInstalled() listeners of all modules (background.js after preparing the installation) */
			type notifyInstalled = ( details: chrome.runtime.InstalledDetails ) => void;

			/** Delivering messages to core listeners in the same context — like chrome.runtime (a copy through JSON, the first response) */
			type createLocalDispatcher = (
				listeners: Types.BackgroundMessageListener[],
				sender: chrome.runtime.MessageSender,
			) => Types.BackgroundDispatcher;

			/** A message of a background part to the listeners of the other background parts (a copy through JSON, asynchronously) */
			type deliverToBackgroundParts = (
				listeners: Types.BackgroundPartListener[],
				moduleName: string,
				message: Types.AnyMessage,
				sender: chrome.runtime.MessageSender,
			) => void;

			/** Delivering messages to core listeners in the same context (background.js); null cancels it */
			type setBackgroundDispatcher = ( dispatcher: Types.BackgroundDispatcher | null ) => void;

			/** A copy of the value through JSON; null for what JSON cannot handle */
			type toJsonCopy = ( value: unknown ) => unknown;

			/** Error text ("Name: message") */
			type describeError = ( err: unknown ) => string;

			/** Notification id and module name from the core's envelope in notification.data; null for a foreign notification */
			type readNotificationEnvelope = ( data: unknown ) => Types.NotificationEnvelope | null;

			/** Properties of the notification as the browser used them (module data without the core's envelope), as JSON */
			type readNotificationProperties = ( notification: Notification ) => Record<string, unknown>;

			/** The service worker registration for showNotification() (only in a service worker), otherwise null */
			type getNotificationRegistration = () => ServiceWorkerRegistration | null;

			/** Properties of a currently shown service worker notification by the id in the envelope; null for a closed one */
			type readShownNotificationProperties = ( registration: ServiceWorkerRegistration, tag: string | undefined, uid: string ) => Promise<Record<string, unknown> | null>;

			/** Announces a notification event to the api.notifications.onEvent() listeners; resolves once they finish */
			type emitNotificationEvent = ( event: Types.ExtensionNotificationEvent ) => Promise<void>;

			/** Writes a click for api.notifications.onClick() of the module (chrome.storage.local, removed right away) */
			type recordNotificationClick = ( event: Extract<Types.ExtensionNotificationEvent, { type: "click" }> ) => Promise<void>;

			/** Shows a module's notification and announces it including its progress (background.js only) */
			type showExtensionNotification = ( moduleName: string, title: unknown, options: NotificationOptions | null | undefined ) => Promise<void>;

			/** Listeners of notification clicks and closing in the service worker; false outside a service worker */
			type listenForNotificationEvents = ( scope?: typeof globalThis ) => boolean;

			namespace listenForNotificationEvents {

				/** A service worker notification event → the api.notifications.onEvent() listeners */
				type relay = ( event: Types.ServiceWorkerNotificationEvent, type: 'click' | 'close' ) => void;

			}

			/** Key of one module state value in chrome.storage ("moduleState.<module>.<key>") */
			type getModuleStateKey = ( moduleName: string, key: string ) => string;

			/** Does the moduleSettings key belong to the module (its mode, fields, instances)? */
			type isModuleSettingsKey = ( moduleName: string, key: string ) => boolean;

			/** An api.data record from a backup file with only known fields of the right type; null for what is not an object */
			type sanitizeBackupRecord = ( value: unknown ) => Types.DataBackupRecord | null;

			/** An object, not an array nor null? */
			type isPlainObject = ( value: unknown ) => value is Record<string, unknown>;

			/** Ids of the module's instances in the current module list */
			type listModuleInstances = ( moduleName: string ) => Promise<string[]>;

			/** Adds the module's missing instances to the module list (after its last entry) */
			type addModuleInstances = ( moduleName: string, instances: string[] ) => Promise<void>;

			/** Backup of one module (api.backup.exportModule()) */
			type exportModuleBackup = ( moduleName: string ) => Promise<Types.ModuleBackup>;

			/** Replaces the module's data with the backup content (api.backup.importModule()) */
			type importModuleBackup = ( moduleName: string, backup: unknown, options?: Types.ModuleBackupImportOptions ) => Promise<void>;

			namespace importModuleBackup {

				/** Instance id from a module settings key; null for the key of the module itself */
				type instanceOf = ( key: string ) => string | null;

			}

			/** The reset of a module in Settings: its settings to the defaults, its data deleted */
			type resetModule = ( moduleName: string ) => Promise<void>;

			/** Only valid shared limit windows (integer max >= 1, ms >= 1), at most 10 */
			type normalizeRateLimitWindows = ( windows: unknown ) => Types.RateLimitWindow[];

			/** A shared limit decision for one key; writes an allowed operation into entry */
			type tryAcquireRateLimit = ( entry: Types.RateLimitEntry, windows: Types.RateLimitWindow[], now: number ) => Types.RateLimitDecision;

			/** Blocks the key for ms from now (ms <= 0 cancels the block); returns the end of the block, or null */
			type blockRateLimit = ( entry: Types.RateLimitEntry, ms: number, now: number ) => number | null;

			/** Only rules with action and condition (and a positive integer priority), without the id and other fields */
			type sanitizeNetworkRules = ( rules: unknown ) => Types.NetworkRule[];

			/** Module rules that should apply in the browser (in the module list, not turned off; regular, then bulk), and the status of the others */
			type planNetworkRules = (
				store: Types.NetworkRulesStore,
				settings: Types.ModuleSettings,
				moduleNames: Set<string>,
				bulkStore?: Types.NetworkRulesBulkStore,
			) => Types.NetworkRulesPlan;

			namespace planNetworkRules {

				/** Do the module's rules apply (in the module list, not turned off)? Otherwise writes the reason into plan.skipped */
				type accept = ( module: string, entry: Types.NetworkRulesEntry | undefined ) => boolean;

			}

			/** The browser's dynamic rule limits (the default without the data) */
			type networkRulesLimits = ( dnr: typeof chrome.declarativeNetRequest | undefined ) => Types.NetworkRulesLimits;

			/** Does Chrome count the rule toward the "unsafe" limit? */
			type isUnsafeNetworkRule = ( rule: Types.NetworkRule ) => boolean;

			/** Bulk rules only into the space left after the regular ones (dropped = did not fit) */
			type fitNetworkRules = ( groups: Types.NetworkRulesGroup[], limits: Types.NetworkRulesLimits ) => Types.NetworkRulesGroup[];

			/** Database of bulk rules */
			type openNetworkRulesDb = () => Promise<IDBDatabase>;

			/** One request on the bulk rule storage (resolves when the transaction completes) */
			type bulkNetworkRulesRequest = <T>( mode: IDBTransactionMode, work: ( store: IDBObjectStore ) => IDBRequest<T> ) => Promise<T>;

			/** Bulk rules of all modules */
			type readBulkNetworkRules = () => Promise<Types.NetworkRulesBulkStore>;

			/** Bulk rules of one module (null = none) */
			type readBulkNetworkRulesOf = ( module: string ) => Promise<Types.NetworkRulesBulkEntry | null>;

			/** Writes the module's bulk rules (null = deletes them) */
			type writeBulkNetworkRules = ( module: string, entry: Types.NetworkRulesBulkEntry | null ) => Promise<void>;

			/** Do exactly the requested rules apply in the browser (the same ids, only the content of the requested ones is compared)? */
			type networkRulesMatch = ( current: chrome.declarativeNetRequest.Rule[], desired: chrome.declarativeNetRequest.Rule[] ) => boolean;

			/** Document key of a content script (performance.timeOrigin); null outside a web page */
			type getDocumentKey = () => number | null;

			/** The start of this run of the browser (BROWSER_SESSION_START_KEY); null = not known */
			type readBrowserSessionStart = () => Promise<number | null>;

			/** Domain key (hostname without a trailing dot); only for http(s), otherwise null */
			type getDomainKey = ( url: string | null | undefined ) => string | null;

			/** The extension id (the host of its address) as a watermark in the lower left corner of the page */
			type mountExtensionIdWatermark = () => void;

			/** Does the extension run in Firefox (a moz-extension:// address)? */
			type isFirefox = () => boolean;

			/** The name of the extension in the UI language and its version (from the manifest) */
			type getExtensionInfo = () => Types.ExtensionInfo;

			/** A regular web page (http/https/file outside add-on stores), not a special browser page? */
			type isWebPageUrl = ( url: string | null | undefined ) => boolean;

			/** Shallow copies of the definitions of all registered modules */
			type getRegisteredModules = () => Types.ModuleDefinition[];

			/** Errors (the module is broken) and warnings (optional metadata is missing) of a module definition */
			type validateModule = ( moduleDef: Types.UnvalidatedModuleDefinition ) => Types.ModuleValidationResult;

			/** Module name from the path to its file */
			type getModuleKey = ( path: string ) => string;

			/** The folder of a module from the package (modules/<folder>/…), null for a file outside modules/. */
			type getModuleFolder = ( path: string ) => string | null;

			/** Settings key of a list entry: "<module>#<id>" for an instance, otherwise the module name */
			type getModuleInstanceKey = ( moduleName: string, instance?: string | null ) => string;

			/** Splits a module list entry into the path, name, instance id and settings key */
			type parseModuleEntry = ( entry: string ) => Types.ModuleEntry;

			/** A new instance id ([a-z0-9]) */
			type createModuleInstanceId = () => string;

			/** Module list entries to show, in the order of the list (only loaded modules, without templates) */
			type resolveModuleEntries = ( paths: unknown[] ) => Types.ResolvedModuleEntry[];

			/** Does the source contain top-level import/export (is it a real JS module)? */
			type looksLikeEsModuleSource = ( sourceText: string ) => boolean;

			/** Checks the extension convention .mjs (module) / .js (classic script) */
			type validateModuleFileExtension = ( path: string ) => Promise<boolean>;

			/** Custom element tag from the module name ("myModule" → "extension-my-module") */
			type getTagName = ( name: string ) => Types.ModuleTag;

			/** A readable module title from its name */
			type formatModuleName = ( key: string ) => string;

			/** Size in bytes as text ("1.5 KB") */
			type formatBytes = ( bytes: number ) => string;

			/** Black/white text color with the higher contrast on the "#rrggbb" background; an invalid color → black */
			type contrastColor = ( hex: unknown ) => '#000000' | '#ffffff';

			namespace contrastColor {

				/** Linear value of one color channel from position offset in "#rrggbb" */
				type channel = ( offset: number ) => number;

			}

			/** Is there a bookmark with exactly this URL (or any of an array of URLs) in the bookmark folder (including subfolders)? */
			type bookmarkFolderContainsUrl = ( folderId: string | null | undefined, url: string | null | undefined | ( string | null | undefined )[] ) => Promise<boolean>;

			namespace bookmarkFolderContainsUrl {

				/** Recursive walk of the bookmark tree */
				type walk = ( node: chrome.bookmarks.BookmarkTreeNode ) => boolean;

			}

			/** The module's activation mode: user > module > global default */
			type getModuleMode = ( settings: Types.ModuleSettings, moduleName: string, moduleDefaultMode?: Enums.ActivationMode ) => Enums.ActivationMode;

			/** Is chrome.tabs available in this context? (not inside the floating window's <iframe>) */
			type hasTabsApi = () => boolean;

			/** Is chrome.permissions available in this context? (not inside the floating window's <iframe>) */
			type hasPermissionsApi = () => boolean;

			/** The "current" tab from the point of view of an extension page with chrome.tabs, or null */
			type queryCurrentTab = () => Promise<chrome.tabs.Tab | null>;

			/** The tab the surface relates to (api.tabs.getActive()), or null */
			type readActiveTab = () => Promise<Types.ActiveTabInfo | null>;

			/** api.tabs.onChange() — the handler after another tab or a new address of it; returns a function to unsubscribe */
			type watchActiveTab = ( handler: ( tab: Types.ActiveTabInfo | null ) => void ) => () => void;

			/** The promise, or a rejection with an error after ms */
			type withTimeout = <T>( promise: Promise<T>, ms: number ) => Promise<T>;

			/** A message to the page through window.parent.postMessage() (from the floating window's <iframe>) and waiting for the response */
			type sendMessageViaParentFrame = <M extends Types.AnyMessage>( message: M, timeoutMs?: number ) => Promise<Types.MessageResponse<M['type']> | undefined>;

			namespace sendMessageViaParentFrame {

				/** Unsubscribes the response listener and cancels the timer */
				type cleanup = () => void;

				/** Listener of the page's response */
				type onMessage = ( event: MessageEvent ) => void;

			}

			/** A message to the content script of the tab the surface relates to (without chrome.tabs through the parent page) */
			type sendMessageToActiveTab = <M extends Types.AnyMessage>( message: M ) => Promise<Types.MessageResponse<M['type']> | undefined>;

			/** Domain key for the floating window state (the last 3 parts of the hostname) */
			type getDomainStorageKey = ( hostname: string ) => string;

			/** The stored floating window state of the domain, otherwise the last used one, otherwise null */
			type loadFloatingWindowState = ( hostname: string ) => Promise<Types.FloatingWindowState | null>;

			/** Saves the floating window state of the domain and sets it as the last used one */
			type saveFloatingWindowState = ( hostname: string, state: Types.FloatingWindowState ) => Promise<void>;

			/** Stored frame states without invalid ones, those older than FRAME_STATE_TTL_MS and those over FRAME_STATE_MAX_ENTRIES */
			type pruneFrameStates = ( store: unknown, now?: number ) => Types.FrameStateStore;

			/** Reads and prunes the stored frame states */
			type readFrameStates = () => Promise<Types.FrameStateStore>;

			/** Loads the stored frame states into the page's memory and watches their changes */
			type loadFrameStates = () => Promise<Types.FrameStateStore>;

			/** Changes (null = deletes) the stored state of a frame; returns the completion of the write */
			type queueFrameState = ( key: string, entry: Types.FrameState | null ) => Promise<void>;

			/** Gives the frame its stored state and saves its changes by the user */
			type bindFrameState = ( frame: HTMLElement, key: string, outputElement: Types.OutputElementOption ) => void;

			/** The chrome.storage.local key of the surface's pinned module */
			type getPinnedModuleStorageKey = ( location: Enums.PinLocation ) => string;

			/** The stored pinned module if it is a non-empty key, otherwise null */
			type parsePinnedModule = ( value: unknown ) => string | null;

			/** Key of the surface's pinned module, null = nothing is pinned */
			type loadPinnedModule = ( location: Enums.PinLocation ) => Promise<string | null>;

			/** Saves the surface's pinned module (null = unpins) */
			type savePinnedModule = ( location: Enums.PinLocation, key: string | null ) => Promise<void>;

			/** Calls onChange after every change of the surface's pinned module */
			type watchPinnedModule = ( location: Enums.PinLocation, onChange: ( key: string | null ) => void ) => void;

			/** The stored maximum height of the pinned frame (% of the surface) within the allowed range, otherwise the default */
			type parsePinnedMaxHeight = ( value: unknown ) => number;

			/** Sets --pinned-max-height on the page by the stored value and follows its changes */
			type applyPinnedMaxHeight = () => Promise<void>;

			/** Adds the 📌 button to the module frame on the line of its name; returns the button */
			type attachPinButton = ( frame: HTMLElement, pinned: boolean, onToggle: () => void ) => HTMLButtonElement;

			/** The value of a "checkboxTable" field as a whole table (a stored cell, otherwise the default of the field, otherwise false) */
			type resolveCheckboxTable = ( field: Pick<Types.CheckboxTableSettingField, 'rows' | 'columns' | 'default'>, value: unknown ) => Types.CheckboxTableValue;

			/** Key of a module's custom setting in moduleSettings */
			type getModuleSettingKey = ( moduleName: string, fieldKey: string ) => Types.ModuleSettingKey;

			/** Key of a setting shared by several modules (a group of SettingField.shared) in moduleSettings */
			type getSharedSettingKey = ( group: string, fieldKey: string ) => Types.ModuleSettingKey;

			/** The key a settings field is stored under: shared (field.shared), or of the module (its instance) */
			type getSettingFieldKey = ( moduleKey: string, field: Pick<Types.SettingField, 'key' | 'shared'> ) => Types.ModuleSettingKey;

			/** Attaches the debugger to the target, sends the commands one after another and detaches it; the result of each command separately */
			type runDebuggerCommands = (
				debuggee: chrome.debugger.Debuggee,
				commands: Types.DebuggerCommand[]
			) => Promise<Types.DebuggerCommandResult[]>;

			/** A domain entered by the user as a hostname (lower case, punycode, without scheme/port/path); null for an invalid one */
			type normalizeDomain = ( raw: string ) => string | null;

			/** Valid domains from the stored value (a string from a textarea, or an array), without duplicates */
			type parseDomainList = ( value: unknown ) => string[];

			/** Is the hostname one of the domains, or a subdomain of one? */
			type isHostInDomains = ( hostname: string | null | undefined, domains: string[] ) => boolean;

			/** Waits for an idle period of the browser (at the latest after timeout ms); the end of the slice of work (performance.now()) */
			type waitForIdleSlice = ( timeout: number ) => Promise<number>;

			/** Waits for an idle period of the browser and returns the budget of a work in slices (a content script on a big page) */
			type startIdleWork = ( timeout?: number ) => Promise<Types.IdleBudget>;

			/** Bookmark folders from the stored value (MAIN_WORLD_BOOKMARK_FOLDERS_FIELD), without empty items and duplicates */
			type parseBookmarkFolderList = ( value: unknown ) => Types.BookmarkFolderRef[];

			/** Domains of the http(s) bookmarks in the folders (also subfolders), without a leading "www."; [] without chrome.bookmarks */
			type getBookmarkFolderDomains = ( folderIds: string[] ) => Promise<string[]>;

			namespace getBookmarkFolderDomains {

				/** Recursive walk of the bookmark tree */
				type walk = ( node: chrome.bookmarks.BookmarkTreeNode ) => void;

			}

			/** All domains of the module's main-world-domain-script.js: the domain list and the domains from bookmark folders */
			type getMainWorldDomains = ( settings: Types.ModuleSettings, moduleName: string ) => Promise<string[]>;

			/** matches patterns for the module's main-world-domain-script.js according to its domains; [] without them */
			type getMainWorldMatches = ( settings: Types.ModuleSettings, moduleName: string ) => Promise<string[]>;

			/** Does background.js register the module's scripts in pages? (PAGE_SCRIPTS_FIELD is not false) */
			type arePageScriptsEnabled = ( settings: Types.ModuleSettings, moduleName: string ) => boolean;

			/** Locations from a written value (an array, one location, "none"), in the order of DISPLAY_LOCATIONS; an invalid value → null */
			type parseDisplayLocations = ( value: unknown ) => Enums.RenderLocation[] | null;

			/** The module's output locations: user > module > global default (invalid values are skipped); [] = nowhere */
			type getModuleDisplayLocations = ( settings: Types.ModuleSettings, moduleName: string, moduleDefaultLocation?: Types.DisplayLocationValue ) => Enums.RenderLocation[];

			/** Where a client shows its module while its provider shows it too: the stored second set, otherwise displayLocations (the same as the first set) */
			type getModuleDelegatedDisplayLocations = ( settings: Types.ModuleSettings, moduleName: string, displayLocations: Enums.RenderLocation[] ) => Enums.RenderLocation[];

			/** The OUTPUT_ELEMENTS item by value; an unknown value → DEFAULT_OUTPUT_ELEMENT */
			type getOutputElementDef = ( value: unknown ) => Types.OutputElementOption;

			/** The module's output frame: user > module > global default (invalid values are skipped) */
			type getModuleOutputElement = ( settings: Types.ModuleSettings, moduleName: string, moduleDefaultOutputElement?: Enums.OutputElement ) => Enums.OutputElement;

			namespace getModuleOutputElement {

				/** Is the value a valid output frame? */
				type isValid = ( value: unknown ) => value is Enums.OutputElement;

			}

			/** The module heading in the frame: user > module > global default */
			type getModuleShowHeading = ( settings: Types.ModuleSettings, moduleName: string, moduleDefaultShowHeading?: boolean ) => boolean;

			/** The module's API for communication with the core */
			type createModuleApi = ( moduleName: string, instance?: string | null ) => Types.ModuleApi;

			namespace createModuleApi {

				/** The whole moduleSettings blob */
				type readAllSettings = () => Promise<Types.ModuleSettings>;

				/** Writes the whole moduleSettings blob */
				type writeAllSettings = ( settings: Types.ModuleSettings ) => Promise<void>;

				/** The whole stored floating window state */
				type readAllFloatingWindowStates = () => Promise<Types.FloatingWindowStateStore>;

				/** Writes the whole floating window state */
				type writeAllFloatingWindowStates = ( data: Types.FloatingWindowStateStore ) => Promise<void>;

				/** Writes the intervention into the history for each permission/origin from the set */
				type logPermissionActivity = ( action: Enums.PermissionAction, outcome: Enums.PermissionOutcome, permissions: Types.PermissionSet | undefined ) => Promise<void>;

				/** api.state/api.sessionState nad chrome.storage.local/session */
				type createStateArea = ( areaName: 'local' | 'session' ) => Types.ModuleStateApi;

				namespace createStateArea {

					/** The storage area; throws an error when the context does not have it (content script and session) */
					type storageArea = () => chrome.storage.StorageArea;

				}

				/** Is the module in the current module list? */
				type isListed = () => Promise<boolean>;

				/** Enabled details providers of the given level (except the caller) */
				type getEnabledDetailsProviders = ( scope: Enums.DetailsScope ) => Promise<Types.ModuleDefinition[]>;

				/** api.messages.on(): listener of messages relayed from the floating window's <iframe> (window.postMessage()) */
				type relayListener = ( event: MessageEvent ) => void;

				/** api.messages.on(): the response to a relayed message back to the floating window's <iframe> */
				type relaySendResponse = ( response: unknown ) => void;

			}

			/** A floating window into any page (a plain <div> with Shadow DOM, not a custom element) */
			type createFloatingWindow = ( options?: Types.FloatingWindowOptions ) => Types.FloatingWindowElement;

			namespace createFloatingWindow {

				/** Moves the window with the cursor while dragging by the header */
				type onDrag = ( e: MouseEvent ) => void;

				/** Unsubscribes the drag listeners from document */
				type detachDragListeners = () => void;

				/** End of dragging — reports the new position (onMove) */
				type stopDrag = () => void;

				/** Start of dragging by the header */
				type startDrag = ( e: MouseEvent ) => void;

				/** Resizing the window by the handle */
				type onResizeDrag = ( e: MouseEvent ) => void;

				/** Unsubscribes the resize listeners from document */
				type detachResizeListeners = () => void;

				/** End of resizing — reports the new size (onResize) */
				type stopResize = () => void;

				/** Start of resizing by the handle */
				type startResize = ( e: MouseEvent ) => void;

				/** Closes the window with the same cleanup as the cross */
				type close = () => void;

			}

			/** Is the module list entry an uploaded module ("sandbox://<name>/<name>.js")? */
			type isSandboxModuleEntry = ( entry: unknown ) => entry is Types.SandboxModuleEntry;

			/** The module list entry of an uploaded module */
			type getSandboxModuleEntry = ( name: string ) => Types.SandboxModuleEntry;

			/** An activation rule written as data → Specification; null for an invalid descriptor */
			type specFromDescriptor = ( descriptor: unknown, depth?: number ) => Classes.Specification | null;

			/** sandbox-package.mjs (the ZIP reader, the import scanner) loaded only when it is needed */
			type loadSandboxPackageTools = () => Promise<typeof import( './sandbox-package.mjs' )>;

			/** The type of a file of a package by its extension; null = not allowed */
			type getSandboxFileType = ( path: string ) => Types.SandboxFileType | null;

			/** A file of an archive left out without a warning (hidden, __MACOSX/, *.d.ts, *.md, *.map)? */
			type isIgnoredSandboxPath = ( path: string ) => boolean;

			/** A valid path in a package (letters, digits, ".", "_", "-", folders)? */
			type isValidSandboxPath = ( path: string ) => boolean;

			/** Text in UTF-8; null = not UTF-8 */
			type decodeSandboxText = ( data: Uint8Array ) => string | null;

			/** The text of a problem of a ZIP archive */
			type describeZipProblem = ( problem: Types.ZipProblem ) => string;

			/** The entry file(s) of a package by the folder name / the archive name, or the only script in its root */
			type findSandboxEntry = ( paths: string[], hints: string[] ) => string[];

			/** The texts of a package (SANDBOX_MESSAGES_FILE): null = fine or missing, otherwise the error */
			type checkSandboxMessages = ( files: Types.SandboxPackageFiles ) => string | null;

			/** The uploaded file (a script or a .zip) as the content of a package, checked */
			type unpackSandboxUpload = ( fileName: string, bytes: Uint8Array<ArrayBuffer> ) => Promise<Types.SandboxUnpacked>;

			/** A module specifier of a JS module of a package → a file of the package or the SDK; null = outside the package */
			type resolveSandboxImport = ( name: string, from: string, specifier: string ) => Types.SandboxImportTarget | null;

			/** What the sandbox needs to load the package (the module graph and the places to rewrite), errors and warnings */
			type planSandboxPackage = ( content: Types.SandboxPackageContent ) => Promise<Types.SandboxPlanned>;

			namespace planSandboxPackage {

				/** Plans one JS module of the package and (first) the modules it imports */
				type visit = ( path: string, chain: string[] ) => void;

			}

			/** Texts of the problems reported by the sandbox */
			type describeSandboxProblems = ( problems: unknown ) => string[];

			/** The api methods of an uploaded module and their kind */
			type getSandboxApiMethods = () => Record<Types.SandboxApiMethod, Enums.SandboxApiKind>;

			/** How to run the api method of an uploaded module; null = not allowed */
			type getSandboxApiHandler = ( method: unknown ) => Types.SandboxApiHandler | null;

			/**
			 * A request of an uploaded module through its api ("call" methods of SANDBOX_API), otherwise a function outside the
			 * sandbox; host = the element that embeds the module
			 */
			type callSandboxApi = (
				api: Types.ModuleApi,
				mod: Types.ModuleDefinition,
				method: unknown,
				args: unknown,
				host?: Types.SandboxHost | null,
			) => Promise<unknown>;

			/**
			 * A listener of an uploaded module through its api (only a "subscribe" method), otherwise a listener of the catalog
			 * (decided after the user's decisions are read — a Promise); returns a function to unsubscribe
			 */
			type subscribeSandboxApi = (
				api: Types.ModuleApi,
				mod: Types.ModuleDefinition,
				method: unknown,
				args: unknown,
				emit: ( value: unknown ) => void,
				host?: Types.SandboxHost | null,
			) => ( () => void ) | Promise<() => void>;

			/** What the core knows about the name of a function outside the sandbox */
			type describeSandboxCapability = ( name: string ) => Types.SandboxCapabilityInfo;

			/** The valid names of registerModule({ capabilities }) */
			type getDeclaredSandboxCapabilities = ( capabilities: unknown ) => string[];

			/** The module that asks for functions outside the sandbox (from its definition) */
			type sandboxCapabilityHolder = ( mod: Types.ModuleDefinition ) => Types.SandboxCapabilityHolder;

			/**
			 * The state of one function outside the sandbox for a module; with a context also "unavailable" (allowed, but it
			 * cannot work there)
			 */
			type sandboxCapabilityState = (
				holder: Types.SandboxCapabilityHolder,
				name: string,
				grants: Types.SandboxCapabilityGrants,
				context?: Types.SandboxCapabilityContext | null,
			) => Enums.SandboxCapabilityState;

			/** Where the functions of a module run: its api and the surface of the element (no element = no surface) */
			type sandboxCapabilityContext = ( api: Types.ModuleApi, host: Types.SandboxHost | null | undefined, mod: Types.ModuleDefinition ) => Types.SandboxCapabilityContext;

			/** The state of one function for a stored uploaded module by the given decisions (background.js — contentFilters.set, networkFilters.set) */
			type getStoredSandboxCapabilityState = ( record: Types.SandboxModuleRecord, name: string, grants: Types.SandboxCapabilityGrants ) => Enums.SandboxCapabilityState;

			/** The user's decisions about the functions outside the sandbox */
			type readSandboxCapabilityGrants = () => Promise<Types.SandboxCapabilityGrants>;

			/** The states of the declared functions of a module (capabilities.state()) */
			type getSandboxCapabilityStates = (
				mod: Types.ModuleDefinition,
				context?: Types.SandboxCapabilityContext | null,
			) => Promise<Record<string, Enums.SandboxCapabilityState>>;

			/** capabilities.onChange(): emit() gets the states after a change; returns a function to unsubscribe */
			type onSandboxCapabilityStatesChange = (
				mod: Types.ModuleDefinition,
				emit: ( states: Record<string, Enums.SandboxCapabilityState> ) => void,
				context?: Types.SandboxCapabilityContext | null,
			) => () => void;

			/** The user's decision (true = allow, false = deny, null = undecided); false = not a function of the catalog */
			type setSandboxCapabilityGrant = ( moduleName: string, name: string, decision: boolean | null ) => Promise<boolean>;

			/** Keeps only the decisions about the declared functions (null = removes all of the module's decisions) */
			type pruneSandboxCapabilityGrants = ( moduleName: string, declared: string[] | null ) => Promise<void>;

			/** Runs the work under a Web Lock of the name (without Web Locks right away) */
			type withSandboxLock = <T>( name: string, work: () => Promise<T> ) => Promise<T>;

			/** The name of a requested function for the record (cut, a non-text as its type) */
			type sandboxCapabilityLogName = ( method: unknown ) => string;

			/** A function outside the sandbox: runs an allowed one, refuses the others (and the ones only for a button); recorded */
			type requestSandboxCapability = (
				mod: Types.ModuleDefinition,
				method: unknown,
				args: unknown,
				context: Types.SandboxCapabilityContext,
			) => Promise<unknown>;

			/**
			 * A listener of the catalog (capabilities.listen()): refused (rejects with the reason) or started and recorded; no
			 * events while the user denies the function
			 */
			type listenSandboxCapability = (
				mod: Types.ModuleDefinition,
				method: unknown,
				args: unknown[],
				emit: ( value: unknown ) => void,
				context: Types.SandboxCapabilityContext,
			) => Promise<() => void>;

			/** Refuses a function for the module (the state is the reason): records it and returns the error */
			type refuseSandboxCapability = ( moduleName: string, name: string, state: Exclude<Enums.SandboxCapabilityState, 'allowed'> ) => Error;

			/** Runs a function of the catalog for the module and records the outcome — run() of the function starts synchronously */
			type runSandboxCapability = ( moduleName: string, name: string, args: unknown[], context: Types.SandboxCapabilityContext ) => Promise<unknown>;

			/** api.buttons.set(): the checked buttons of a module (only the functions it declared) — throws on an invalid one */
			type normalizeSandboxButtons = ( buttons: unknown, declared: string[] ) => Types.SandboxButton[];

			/**
			 * api.ui.render(): the checked content in one shape (null = the frame again), its buttons only with the declared
			 * functions — throws on an invalid or too large one
			 */
			type normalizeSandboxUi = ( content: unknown, declared?: string[] ) => Types.SandboxUiNode[] | null;

			/**
			 * Draws checked content as elements of the page (no HTML); the controls report to emit, a button with a function
			 * calls run within the click, details reopen by wasOpen
			 */
			type renderSandboxUi = (
				doc: Document,
				nodes: Types.SandboxUiNode[],
				options: {
					emit: ( event: Types.SandboxUiEvent ) => void;
					wasOpen: ( id: string ) => boolean | undefined;
					run?: ( id: string, capability: string, args: unknown[] ) => void;
				},
			) => { fragment: DocumentFragment; controls: Map<string, HTMLElement> };

			/** Adds one request or decision to the record (written within SANDBOX_CAPABILITY_LOG_FLUSH_MS) */
			type recordSandboxCapabilityUse = ( moduleName: string, capability: string, outcome: Enums.SandboxCapabilityOutcome ) => void;

			/** A valid entry of the stored record? */
			type isSandboxCapabilityLogEntry = ( value: unknown ) => value is Types.SandboxCapabilityLogEntry;

			/** The stored record, the most recent first */
			type readSandboxCapabilityLog = () => Promise<Types.SandboxCapabilityLogEntry[]>;

			/** Writes the entries collected on this page into the stored record */
			type flushSandboxCapabilityLog = () => Promise<void>;

			/** Clears the record of one module (null = the whole record) */
			type clearSandboxCapabilityLog = ( moduleName: string | null ) => Promise<void>;

			/** The functions a stored module declared, with their state for it (Settings) */
			type getSandboxCapabilityOverview = ( record: Types.SandboxModuleRecord, grants: Types.SandboxCapabilityGrants ) => Types.SandboxCapabilityOverviewItem[];

			/** tabs.create of the catalog */
			type openSandboxWebTab = ( options: unknown ) => Promise<void>;

			/** clipboard.writeText of the catalog */
			/** tabs.activate({ tabId }) of an uploaded module (from the floating window through background.js) */
			type activateSandboxTab = ( options: unknown ) => Promise<void>;


			/** Selects the tab in its window and focuses the window */
			type activateTab = ( tabId: number ) => Promise<void>;

			type writeSandboxClipboardText = ( text: unknown ) => Promise<void>;

			/** Is it the name of a file only (no folders, no forbidden or control characters)? */
			type isSandboxDownloadName = ( name: string ) => boolean;

			/** downloads.download of the catalog */
			type downloadSandboxFile = ( options: unknown ) => Promise<void>;

			/** Does the extension have a sidebar at all (side_panel / sidebar_action in its manifest)? */
			type hasManifestSidebar = () => boolean;

			/** Is "Do not use the sidebar" (SIDEBAR_DISABLED_KEY) on — always without a sidebar in the manifest? */
			type readSidebarDisabled = () => Promise<boolean>;

			/** Loads "Do not use the sidebar" into the page's memory (sidebar.toggle) and watches its changes */
			type loadSidebarDisabled = () => Promise<boolean>;

			/** Chrome: turns the extension's side panel off or on for all tabs; Firefox: nothing */
			type applySidebarDisabled = ( disabled: boolean ) => Promise<void>;

			/** Can the page control the sidebar (Firefox sidebarAction, Chrome sidePanel)? */
			type hasSidebarControl = () => boolean;

			/** sidebar.toggle of the catalog */
			type toggleSandboxSidebar = ( context: Types.SandboxCapabilityContext ) => Promise<void>;

			/** addons.open of the catalog: opened, or the address the user opens by hand */
			type openSandboxAddonsPage = () => Promise<{ opened: boolean; url: string }>;

			/** options.open of the catalog: { hash } — the id of an element of Settings to open at */
			type openSandboxOptionsPage = (options?: unknown) => Promise<void>;

			/** buildSettings.get of the catalog: standalone.json of the modules of the default list, only in an unpacked extension */
			type getSandboxBuildSettings = () => Promise<Types.SandboxBuildSettings>;

			/** storageUsage.get of the catalog: counts of items and sizes of the extension's storages, every part on its own */
			type getSandboxStorageUsage = () => Promise<Types.SandboxStorageUsage>;

			namespace getSandboxStorageUsage {

				/** Measures one part; an error becomes its reason ({ error }) */
				type settle = <T>( measure: () => Promise<T> ) => Promise<T | { error: string }>;

			}

			/** The items of the page's localStorage and their estimated size in bytes (UTF-16) */
			type measureSandboxLocalStorage = () => { items: number; bytes: number };

			/** storageUsage.onChange of the catalog: which storage changed (never what); returns a function to unsubscribe */
			type listenSandboxStorageUsageChanges = ( emit: ( change: Enums.SandboxStorageUsageChange ) => void ) => () => void;

			/** The records in all stores of an IndexedDB database (0 when it does not exist — it is not created) */
			type countSandboxDatabaseItems = ( name: string ) => Promise<number>;

			/** floatingWindow.updateStates of the catalog: checked changes of single records (null removes one) */
			type updateSandboxFloatingWindowStates = ( changes: unknown ) => Promise<void>;

			/** One state of the floating window from a module, checked (path = where it is, for the error) */
			type normalizeSandboxFloatingWindowState = ( state: unknown, path: string ) => Types.FloatingWindowState;










			// #region standalone: tabGroups
			/** overview.mjs of tabGroups (watchWindowGroups() for the listener tabGroups.onChange) loaded only when it is needed */
			type importSandboxTabGroups = () => Promise<typeof import( './modules/tabGroups/overview.mjs' )>;

			/** tabGroups.onChange of the catalog: "groups" / "status" after a change; returns a function to unsubscribe */
			type listenSandboxTabGroupsChanges = ( emit: ( change: Enums.SandboxTabGroupsChange ) => void ) => () => void;
			// #endregion standalone: tabGroups




			/** A file as a download of the page (<a download>); name = the function for the error without a document */
			type saveSandboxBlob = ( blob: Blob, filename: string, name: string ) => void;


			/** Is the host covered by one of the origins (match patterns of usesPermissions)? */
			type isHostCoveredByOrigins = ( host: string, origins: string[] ) => boolean;




			/** The configuration of the core's filters the module declared in its stored registration (not checked yet); undefined = none */
			type getDeclaredFiltersConfig = ( record: Types.SandboxModuleRecord, key: Types.DeclaredFilters['key'] ) => unknown;




			/** Only the moduleSettings entries of one module (and of the shared groups given) */
			type ownModuleSettings = ( settings: Types.ModuleSettings | null | undefined, moduleName: string, sharedGroups?: string[] ) => Types.ModuleSettings;

			/** The stored uploaded modules */
			type readSandboxModules = () => Promise<Types.SandboxModuleStore>;

			/** SHA-256 of bytes in hex */
			type sha256Hex = ( data: Uint8Array<ArrayBuffer> ) => Promise<string>;

			/** The IndexedDB database of the packages of the uploaded modules */
			type openSandboxPackagesDb = () => Promise<IDBDatabase>;

			/** One request on the store of the packages; resolves when the transaction completes */
			type sandboxPackagesRequest = <T>( mode: IDBTransactionMode, work: ( store: IDBObjectStore ) => IDBRequest<T> ) => Promise<T>;

			/** The stored package of an uploaded module; null = not there */
			type readSandboxPackage = ( name: string ) => Promise<Types.SandboxPackage | null>;

			/** Stores the package of an uploaded module (under its name) */
			type writeSandboxPackage = ( pkg: Types.SandboxPackage ) => Promise<void>;

			/** Deletes the package of an uploaded module */
			type deleteSandboxPackage = ( name: string ) => Promise<void>;

			/** Is the name (or its tag) already used by a module from the package or by another uploaded module? */
			type isModuleNameTaken = ( name: string, store: Types.SandboxModuleStore ) => Promise<boolean>;

			/** A one-time key of one sandbox page */
			type createSandboxToken = () => string;

			/** <iframe> with the sandbox page (the sandbox attribute, the token in the address) */
			type createSandboxFrame = ( token: string ) => HTMLIFrameElement;

			/** What the sandbox gets with the module for evaluation */
			type createSandboxContext = ( pkg: Types.SandboxPackage, language: Enums.UiLanguage ) => Types.Sandbox.Context;

			/** A message from the sandbox page of this frame with the right token, otherwise null */
			type readSandboxMessage = ( event: MessageEvent, frame: HTMLIFrameElement, token: string ) => Types.Sandbox.Envelope | null;

			/** A message to the sandbox page; false = not sent */
			type postToSandbox = ( frame: HTMLIFrameElement | null, message: Types.Sandbox.FromHost ) => boolean;

			/** Evaluates the module in a hidden sandbox page in one UI language */
			type inspectSandboxModule = ( request: Types.SandboxInspectRequest ) => Promise<Types.SandboxInspection>;

			namespace inspectSandboxModule {

				/** Cleans up (the timer, the listener, the frame) and settles the promise */
				type finish = ( settle: () => void ) => void;

			}

			/** The stored registration in the UI language of the page (otherwise English, otherwise any) */
			type pickSandboxRegistration = ( record: Types.SandboxModuleRecord ) => Types.SandboxRegistration | null;

			/** Module definition for registerModule() from the stored data; null for an invalid activation rule */
			type sandboxModuleDefinition = ( record: Types.SandboxModuleRecord, registration: Types.SandboxRegistration ) => Types.ModuleDefinition | null;

			/** Defines the element of an uploaded module; false = the tag belongs to a foreign element */
			type defineSandboxElement = ( tag: Types.ModuleTag ) => boolean;

			/** Registers an uploaded module on this page (a newer version replaces the older one) */
			type registerSandboxModule = ( record: Types.SandboxModuleRecord ) => boolean;

			/** Registers the uploaded modules of the module list entries on this page */
			type loadSandboxModules = ( paths: unknown[] ) => Promise<void>;

			/** Adds an uploaded module to the end of the module list; false = it is there already (or the list is unreadable) */
			type addSandboxModuleToList = ( name: string ) => Promise<boolean>;

			/** Uploads a module from the user: checks, evaluates in the sandbox, validates, stores and adds it to the list */
			type installSandboxModule = ( file: Types.SandboxFile, options?: Types.SandboxInstallOptions ) => Promise<Types.SandboxInstallResult>;

			/** Plans, evaluates, validates, stores and registers the content of a package (an upload or a module the extension brings); fills in result */
			type installSandboxContent = (
				content: Types.SandboxPackageContent,
				source: Types.SandboxContentSource,
				store: Types.SandboxModuleStore,
				inspect: ( request: Types.SandboxInspectRequest ) => Promise<Types.SandboxInspection>,
				result: Types.SandboxInstallResult,
			) => Promise<Types.SandboxInstallResult>;

			/** The package of a module the extension brings itself, read from the extension */
			type readBundledSandboxPackage = ( name: string ) => Promise<Types.SandboxPackageContent>;

			/** Plans, evaluates and validates the content of a package: the package and the record to store, or null (errors in result) */
			type evaluateSandboxContent = (
				content: Types.SandboxPackageContent,
				source: Types.SandboxContentSource,
				previous: Types.SandboxModuleRecord | null,
				inspect: ( request: Types.SandboxInspectRequest ) => Promise<Types.SandboxInspection>,
				result: Types.SandboxInstallResult,
			) => Promise<{ pkg: Types.SandboxPackage; record: Types.SandboxModuleRecord; declared: string[] } | null>;

			/** The content of a package from its files (the entry file, the texts checked); throws when it is not usable */
			type sandboxContentFromFiles = ( name: string, files: Types.SandboxPackageFiles ) => Types.SandboxPackageContent;

			/** service-provider.json of this extension's package, read once per chrome.runtime */
			type readServiceProviderConfig = () => Promise<Types.ServiceProviderConfig>;

			/** The id of the service provider of this extension (service-provider.json); null — it is not a client */
			type readServiceProviderId = () => Promise<string | null>;

			/** Is this a standalone extension (service-provider.json) — it only exports its modules, never a provider */
			type isStandaloneExtension = () => Promise<boolean>;

			type bytesToBase64 = ( bytes: Uint8Array ) => string;

			/** The modules of a client's replaces it can run instead of the provider (without the extension's own ones) */
			type replaceableModules = ( names: string[] ) => string[];
			type base64ToBytes = ( text: string ) => Uint8Array<ArrayBuffer>;

			/** A message to another extension with a time limit */
			type sendToExtension = ( id: string, message: Record<string, unknown>, timeoutMs: number ) => Promise<unknown>;

			/** The provider's records of its clients */
			type readExtensionServiceClients = () => Promise<Record<string, Types.ExtensionServiceClient>>;

			/** Changes the record of one client under the lock (null removes it) */
			type updateExtensionServiceClient = (
				id: string,
				update: ( current: Types.ExtensionServiceClient | null ) => Types.ExtensionServiceClient | null,
			) => Promise<Types.ExtensionServiceClient | null>;

			/** The key of a client's package in the database of the packages */
			type clientPackageKey = ( id: string, name: string, kind: 'files' | 'package' ) => string;

			/** A registration of a client checked, or why it is refused */
			type normalizeServiceRegistration = ( message: unknown ) => Types.ExtensionServiceRegistrationCheck;

			/** The provider stores a registration; returns the client's status */
			type registerExtensionServiceClient = ( id: string, message: unknown ) => Promise<{ status: Types.ExtensionServiceClient['status'] }>;

			/** The provider's answer to the status question of a client */
			type describeExtensionServiceStatus = ( id: string ) => Promise<Types.ExtensionServiceStatusAnswer>;

			/** Remembers whether a client answered */
			type noteExtensionServiceClientAlive = ( id: string, alive: boolean ) => Promise<void>;

			/** Is the client there (asked once in EXTENSION_SERVICE_ALIVE_MS)? */
			type isExtensionServiceClientAlive = ( id: string ) => Promise<boolean>;

			/** The allowed clients that are there */
			type getLiveExtensionServiceClients = () => Promise<Types.ExtensionServiceClient[]>;

			/** The modules from the package a client runs instead: module name → the client */
			type getReplacedModules = () => Promise<Map<string, Types.ExtensionServiceClient>>;

			/** Installs the packages of an allowed client that are not installed in their version; returns the problems */
			type installClientSandboxModules = ( id: string, options?: Types.SandboxInstallOptions ) => Promise<string[]>;

			/** The stored package of an installed module of a client */
			type readClientSandboxPackage = ( id: string, name: string ) => Promise<Types.SandboxPackage | null>;

			/** The user allows a client: its modules are installed and added to the list, the modules it runs instead leave it */
			type approveExtensionServiceClient = ( id: string, options?: Types.SandboxInstallOptions ) => Promise<Types.ExtensionServiceApproval>;

			/** Takes modules from the package out of the module list (all their entries); returns those that were there */
			type removeModulesFromList = ( names: string[] ) => Promise<string[]>;

			/** The clients waiting for the decision that are there, with the modules that work twice meanwhile */
			type getPendingExtensionServiceClients = () => Promise<Types.PendingExtensionServiceClient[]>;

			/** Opens the section "Modules from other extensions" of Settings in a new tab */
			type openExtensionServicesSettings = () => Promise<void>;

			/** The user denies a client */
			type denyExtensionServiceClient = ( id: string ) => Promise<void>;

			/** The user removes a client (its record and packages) */
			type removeExtensionServiceClient = ( id: string ) => Promise<boolean>;

			/** The installed modules of the allowed clients that are there, for the names of the module list */
			type loadClientSandboxModules = ( names: string[] ) => Promise<Map<string, Types.SandboxModuleRecord>>;

			/** A function the client of the module serves: its kind, otherwise null */
			type clientServiceKind = ( mod: Types.ModuleDefinition, name: string ) => Types.ExtensionServiceRef['kind'] | null;

			/** A call of a function a client serves */
			type callExtensionService = ( id: string, name: string, args: unknown[], location: string | null | undefined ) => Promise<unknown>;

			/** A listener of a function a client serves (a lease and its changes); returns a function to unsubscribe */
			type listenExtensionService = ( id: string, name: string, emit: ( value: unknown ) => void ) => () => void;

			/** The allowed client that is there and keeps the data of the module (its backup), otherwise null */
			type findBackupClient = ( moduleName: string ) => Promise<Types.ExtensionServiceClient | null>;

			/** The modules whose data the clients keep, with the name of the client (api.backup.listClientModules()) */
			type listClientBackupModules = () => Promise<Types.ClientBackupModule[]>;

			/** EXTENSION_SERVICE_BACKUP_* to the client: the value of its answer, or its error */
			type requestClientBackup = ( client: Types.ExtensionServiceClient, message: Record<string, unknown> & { module: string } ) => Promise<unknown>;

			/** api.backup.exportModule(): from the client that keeps the module's data, otherwise from here */
			type exportModuleBackupWithClients = ( moduleName: string ) => Promise<Types.ModuleBackup>;

			/** api.backup.importModule(): into the client that keeps the module's data, otherwise here */
			type importModuleBackupWithClients = ( moduleName: string, backup: unknown, options?: Types.ModuleBackupImportOptions ) => Promise<void>;

			/** What this extension tells its provider about itself */
			type buildServiceRegistration = () => Promise<Types.ExtensionServiceRegistration>;

			/** The modules from the package in the module list (without the extension's own modules) — replaces and backup of a client */
			type packageModulesInList = ( entries: string[] ) => string[];

			/** The modules whose data this client backs up and restores for its provider */
			type readClientBackupModules = () => Promise<string[]>;

			/** Stores what the provider said */
			type storeServiceProviderState = ( state: Types.ExtensionServiceProviderState ) => Promise<void>;

			/** The client registers with its provider (force — regardless of the last registration) and asks what it shows */
			type registerWithServiceProvider = ( force?: boolean ) => Promise<Types.ExtensionServiceProviderState | null>;

			/** The client asks its provider which of its modules it shows and remembers it */
			type askServiceProviderStatus = ( providerId: string, registeredAt?: number | null ) => Promise<Types.ExtensionServiceProviderState>;

			/** What the provider of this client shows (null — not a client) */
			type getServiceProviderState = () => Promise<Types.ExtensionServiceProviderState | null>;

			/** Is the provider of this client installed and turned on — it answers now (false — not a client) */
			type isServiceProviderPresent = () => Promise<boolean>;

			/** The leases of the provider on the listener services of this client */
			type readServiceLeases = () => Promise<Map<string, number>>;

			/** api.services.changed(): to the provider while it holds a lease */
			type notifyServiceChange = ( name: string, value: unknown ) => void;

			/** A message of another extension (runtime.onMessageExternal); true — the answer comes later */
			type handleExtensionServiceMessage = (
				message: unknown,
				sender: chrome.runtime.MessageSender,
				sendResponse: ( response?: unknown ) => void,
			) => boolean;

			/** A request of this client's provider */
			type handleProviderRequest = ( message: Record<string, unknown> ) => Promise<unknown>;

			/** The roles of background.js in the modules from other extensions */
			type startExtensionServices = () => void;

			/** Opens the Settings of a client */
			type openExtensionServiceClient = ( id: string ) => Promise<void>;

			/** A module of this client its provider shows too: what the provider said, otherwise null */
			type getServiceDelegation = ( name: string ) => Promise<Types.ExtensionServiceProviderState | null>;

			/** SHA-256 (hex) of a package by its files: the paths, the lengths and the contents */
			type hashSandboxFiles = ( files: Types.SandboxPackageFiles ) => Promise<string>;

			/** Installs one module the extension brings itself unless its current package is stored; throws when it cannot */
			type ensureBundledSandboxModule = ( name: string, inspect: ( request: Types.SandboxInspectRequest ) => Promise<Types.SandboxInspection> ) => Promise<void>;

			/** Installs the modules the extension brings itself that the module list refers to, where needed */
			type ensureBundledSandboxModules = ( paths: unknown[], options?: Types.SandboxInstallOptions ) => Promise<void>;

			/** The module list entry of a renamed module as the entry of its successor (the instance id stays) */
			type renamedModuleEntry = ( entry: unknown ) => unknown;

			/** Moves the stored module list and the settings of renamed modules over to their successors */
			type migrateRenamedModules = () => Promise<void>;

			/** Moves the values of settings that became shared from the keys of the modules to the shared keys */
			type migrateSharedSettings = () => Promise<void>;

			/** Removes an uploaded module (its files, the list entries, the settings); false = it was not uploaded */
			type removeSandboxModule = ( name: string ) => Promise<boolean>;

			/** The page look for the sandbox: color-scheme and the values of the CSS variables of :root */
			type collectSandboxTheme = ( doc?: Document ) => Types.SandboxTheme;

			namespace collectSandboxTheme {

				/** Collects the names of the variables of :root from the rules (also in @media and other groups) */
				type walk = ( rules: CSSRuleList ) => void;

			}

			namespace BaseController {

				namespace renderModulesFor {

					/** A pass over all modules of the surface; if one is already running, it requests one more and returns the running one */
					type update = () => Promise<void>;

				}

			}

		}

	}

	namespace Classes {

		/** A rule over a context (Specification Pattern) — the base always holds. */
		class Specification {

			/** Does the rule hold in the given context? */
			isSatisfiedBy( context: Types.SpecificationContext ): boolean;

			/** Both rules at once */
			and( other: Specification ): AndSpecification;

			/** At least one of the rules */
			or( other: Specification ): OrSpecification;

			/** Opak pravidla */
			not(): NotSpecification;

		}

		/** All rules at once */
		class AndSpecification extends Specification {
			_specs: Specification[];
			constructor ( ...specs: Specification[] );
		}

		/** At least one of the rules */
		class OrSpecification extends Specification {
			_specs: Specification[];
			constructor ( ...specs: Specification[] );
		}

		/** Opak pravidla */
		class NotSpecification extends Specification {
			_spec: Specification;
			constructor ( spec: Specification );
		}

		/** The activation mode equals the given one */
		class ModeSpecification extends Specification {
			_mode: Enums.ActivationMode;
			constructor ( mode: Enums.ActivationMode );
		}

		/** The active tab's address matches one of the patterns (a prefix with a trailing "/", otherwise an exact match) */
		class UrlPatternSpecification extends Specification {
			_patterns: string[];
			constructor ( patterns?: string[] | null );
		}

		/** The surface currently being rendered is the given surface, or one of the given ones (an empty list = nowhere) */
		class LocationSpecification extends Specification {
			_locations: Enums.RenderLocation[];
			constructor ( locations: Enums.RenderLocation | Enums.RenderLocation[] );
		}

		/** The module is turned off */
		class DisabledSpecification extends Specification { }

		/** The module is not turned off */
		class IsNotDisabled extends Specification { }

		/** The active tab is a regular web page, not a special browser page (holds without an address and access too) */
		class WebPageSpecification extends Specification { }

		/** The common base of the extension page controllers (popup, sidebar, floating window, Settings). */
		class BaseController {

			/** The last loaded/saved moduleSettings */
			_settings: Types.ModuleSettings;

			constructor ();

			/** Loads moduleSettings (and remembers them) */
			loadSettings(): Promise<Types.ModuleSettings>;

			/** Saves the whole moduleSettings */
			saveSettings( settings: Types.ModuleSettings ): Promise<void>;

			/** The module list as JSON text: the stored one, otherwise modules.json */
			getModulesJson(): Promise<string>;

			/** The default modules.json from the extension package */
			fetchDefaultModulesJson(): Promise<string>;

			/** Default settings of the module list entries from the extension package (default-settings.json) */
			fetchDefaultSettings(): Promise<Types.ModuleSettings>;

			/** Fills in the missing default settings of the list entries paths in storage; returns moduleSettings after filling in */
			seedDefaultSettings( paths: unknown[] ): Promise<Types.ModuleSettings>;

			/** Saves the module list (JSON text); removes a list identical to modules.json from storage */
			saveModulesJson( text: string ): Promise<void>;

			getModuleKey( path: string ): string;
			getTagName( name: string ): Types.ModuleTag;
			formatBytes( bytes: number ): string;
			formatModuleName( key: string ): string;
			getModuleMode( settings: Types.ModuleSettings, moduleName: string, moduleDefaultMode?: Enums.ActivationMode ): Enums.ActivationMode;
			getModuleDisplayLocations( settings: Types.ModuleSettings, moduleName: string, moduleDefaultLocation?: Types.DisplayLocationValue ): Enums.RenderLocation[];
			sendMessageToActiveTab<M extends Types.AnyMessage>( message: M ): Promise<Types.MessageResponse<M['type']> | undefined>;

			/** A snapshot of the ACTIVE TAB: the address, and when the browser does not reveal it, also the access to pages */
			buildPageContext(): Promise<Types.PageContext>;

			/** Context { mode, url, hostAccess } for Specification — url is the address of the ACTIVE TAB */
			buildActivationContext( mode: Enums.ActivationMode ): Promise<Types.SpecificationContext>;

			/** Should the module be active and rendered on the given surface right now? (page = a snapshot of the tab, otherwise it is found out) */
			isModuleActive( mod: Types.ModuleDefinition, settings: Types.ModuleSettings, location: Enums.RenderLocation, page?: Types.PageContext, key?: string ): Promise<Types.ModuleActivity>;

			/** The note in place of a module the service provider of this extension shows instead; returns its frame */
			mountDelegatedNote( mod: Types.ModuleDefinition, delegated: Types.ExtensionServiceProviderState, outputEl: HTMLElement, before?: Node | null ): HTMLElement;

			/** The notice before beforeEl while a client waits for the user's decision (hidden while there is none); returns its box */
			mountPendingServiceNotice( beforeEl: HTMLElement, location: Enums.RenderLocation ): HTMLElement;

			/** On the Settings page scrolls to its section (element id) — OptionsController first opens its tab */
			scrollToSettingsSection( id: string ): void;

			/** Dynamically loads module files (which runs their registration) */
			importModuleFiles( paths: string[] ): Promise<Types.ModuleDefinition[]>;

			/** Calls pageInit() of enabled modules, once per page */
			runPageInits( settings: Types.ModuleSettings, location: Enums.RenderLocation ): void;

			/** Attaches the module's own CSS into <head> (each only once) */
			loadModuleStyles( mod: Types.ModuleDefinition ): void;

			/** Creates the module element in a frame according to the settings and attaches it to outputEl (at the end, or before before) */
			mountModuleElement( mod: Types.ModuleDefinition, settings: Types.ModuleSettings, outputEl: HTMLElement, before?: Node | null, key?: string ): Types.MountedModuleElement;

			/** Renders the elements of all modules belonging to the given surface (in the side panel also after a tab change) */
			renderModulesFor( location: Enums.RenderLocation, outputEl: HTMLElement ): Promise<Types.ModuleSurface | undefined>;

			/** Shows the module in its place (the pinned one at the top) when its rules hold, and detaches it when they stopped */
			_updateModuleSlot( slot: Types.ModuleSlot, settings: Types.ModuleSettings, location: Enums.RenderLocation, outputEl: HTMLElement, page: Types.PageContext, pin?: Types.ModulePin | null ): Promise<void>;

			/** After switching tabs or navigating in a tab, re-evaluates the surface's modules (update from renderModulesFor()) */
			_followActiveTab( update: Functions.Base.BaseController.renderModulesFor.update ): void;

		}

		/** The common base of the modules' own elements (custom elements). */
		class BaseElement extends HTMLElement {

			/** Observed HTML attributes — none by default */
			static get observedAttributes(): string[];

			/** Module name (set by init()) */
			_name: string;

			/** The module's activation mode (set by init()) */
			_mode: Enums.ActivationMode;

			/** The surface on which the element is rendered (set by init()) */
			_location: Enums.ElementLocation;

			/** Instance id of a module with multiple instances, otherwise null (set by init()) */
			_instance: string | null;

			/** The module's activation rule; without it init() looks it up in the registry */
			activationSpec: Specification | undefined;

			/** Listeners from registerMessageHandler() to unsubscribe in disconnectedCallback() */
			_messageListeners: Types.RuntimeMessageListener[];

			/** The module's API for communication with the core (created by init()) */
			api: Types.ModuleApi;

			constructor ();
			connectedCallback(): void;
			disconnectedCallback(): void;
			connectedMoveCallback(): void;
			adoptedCallback(): void;
			attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void;

			/** Initialization of the element after it is inserted into a surface */
			init( options: Types.ModuleInitOptions ): Promise<void>;

			/** Does the module's activation rule hold for the given mode? */
			isActivationSatisfied( mode?: Enums.ActivationMode ): boolean;

			/** The stored activation mode of the module, otherwise defaultValue */
			getModuleSetting( moduleName: string, defaultValue?: string ): Promise<unknown>;

			sendMessageToActiveTab<M extends Types.AnyMessage>( message: M ): Promise<Types.MessageResponse<M['type']> | undefined>;

			/** Listener of messages of one type, unsubscribed automatically when the element is disconnected */
			registerMessageHandler<K extends Types.MessageType>( type: K, handler: Types.ElementMessageHandler<K> ): void;

		}

		namespace BaseElement {

			/** Instance properties (without methods); the base of the class is cast to them in JS — see Types.WithFields */
			type Fields = Pick<BaseElement, '_name' | '_mode' | '_location' | '_instance' | 'activationSpec' | '_messageListeners' | 'api'>;

		}

		/**
		 * The element of an uploaded module on an extension page: an <iframe> with the sandbox page in which the module
		 * code runs; it serves the module's api requests through its own this.api.
		 */
		class SandboxModuleElement extends BaseElement {

			/** The sandbox page; null before init() and after a stop */
			_frame: HTMLIFrameElement | null;

			/** The token of the sandbox page (in its address) */
			_token: string;

			/** The stored package of the module (it goes to the sandbox) */
			_package: Types.SandboxPackage | null;

			/** The registered module definition (the rule and the default mode for the api) */
			_moduleDef: Types.ModuleDefinition | null;

			/** The module has been sent to the sandbox ("init") */
			_started: boolean;

			/** The module's api listeners: id from the sandbox → unsubscribe */
			_subscriptions: Map<number, () => void>;

			/** What to clean up when the element stops (look watching) */
			_cleanups: Array<() => void>;

			/** window "message" listener */
			_onMessage: ( event: MessageEvent ) => void;

			/** What the api methods of the module get from the element (the surface, the buttons); null before init() */
			_host: Types.SandboxHost | null;

			/** The user's decisions about the functions outside the sandbox — kept current, a click checks them synchronously */
			_grants: Types.SandboxCapabilityGrants;

			/** The bar of the buttons the core draws for the module (api.buttons), before the frame */
			_buttonBar: HTMLElement | null;

			/** The drawn buttons by their id */
			_buttons: Map<string, { element: HTMLButtonElement; button: Types.SandboxButton }>;

			/** The module's listeners of the clicks (api.buttons.onClick()) */
			_buttonListeners: Set<( click: Types.SandboxButtonClick ) => void>;

			/** The content the core draws for the module (api.ui), between the button bar and the frame */
			_ui: HTMLElement | null;

			/** The drawn content as JSON (null = none, the frame is shown) — the same content is not drawn again */
			_uiKey: string | null;

			/** The controls of the drawn content by their id (the focus and open details stay with the id) */
			_uiControls: Map<string, HTMLElement>;

			/** The module's listeners of the controls (api.ui.onEvent()) */
			_uiListeners: Set<( event: Types.SandboxUiEvent ) => void>;

			constructor ();
			override connectedCallback(): void;
			override disconnectedCallback(): void;
			override init( options: Types.ModuleInitOptions ): Promise<void>;

			/** Keeps _grants current (chrome.storage.onChanged) until the element stops */
			_watchGrants(): void;

			/** api.buttons.set(): draws the buttons (the same id keeps its button and its focus) */
			_setButtons( buttons: unknown, options: unknown ): void;

			/** api.buttons.onClick(); returns a function to unsubscribe */
			_onButtonClick( emit: ( click: Types.SandboxButtonClick ) => void ): () => void;

			/** A click on a drawn button: runs its function within the click (_runClick()) */
			_clickButton( id: string ): void;

			/** Runs a function of a clicked button within the click (api.buttons, api.ui) and tells the module the result (api.buttons.onClick()) */
			_runClick( id: string, capability: string, args: unknown[] ): void;

			/** api.ui.render(): draws the content instead of the frame (null shows the frame) — throws on an invalid one */
			_renderUi( content: unknown ): void;

			/** api.ui.onEvent(); returns a function to unsubscribe */
			_onUiEvent( emit: ( event: Types.SandboxUiEvent ) => void ): () => void;

			/** api.ui.scrollIntoView(): the output of the module (or the place offset px below the top of its frame) at the top of the extension page (only that page) */
			_scrollIntoView( offset?: number | null ): void;

			/** Stops scrolling again as the page grows after api.ui.scrollIntoView() (null = not scrolling) */
			_stopScrollFollow: ( () => void ) | null;

			/** A message from the sandbox page */
			_handleMessage( event: MessageEvent ): void;

			/** An api request of the module → "result" */
			_call( id: unknown, method: unknown, args: unknown ): void;

			/** An api listener of the module → "event" (or "denied") */
			_subscribe( id: unknown, method: unknown, args: unknown ): void;

			/** A message to the sandbox page; false = not sent */
			_post( message: Types.Sandbox.FromHost ): boolean;

			/** Sends the sandbox the page look whenever it changes */
			_watchTheme(): void;

			/** Stops serving the sandbox (listeners, look watching) */
			_stop(): void;

			/** The module cannot run — the texts instead of its frame */
			_showProblems( texts: string[] ): void;

		}

		namespace SandboxModuleElement {

			/** Instance properties (without methods) — see Types.WithFields */
			type Fields = Pick<
				SandboxModuleElement,
				| '_frame'
				| '_token'
				| '_package'
				| '_moduleDef'
				| '_started'
				| '_subscriptions'
				| '_cleanups'
				| '_onMessage'
				| '_host'
				| '_grants'
				| '_buttonBar'
				| '_buttons'
				| '_buttonListeners'
				| '_ui'
				| '_uiKey'
				| '_uiControls'
				| '_uiListeners'
				| '_stopScrollFollow'
			>;

		}

		/** The extension's shared IndexedDB (used only by background.js). */
		class BaseStorage {
			_dbName: string;
			_version: number;
			_storeName: string;
			_dbPromise: Promise<IDBDatabase>;
			constructor ( dbName?: string, version?: number, storeName?: string );

			/** Opens the database and upgrades it to the current version if needed */
			_openDatabase(): Promise<IDBDatabase>;

			/** Stores a record (with timestamp), returns its id */
			logData( data: Types.DataRecordInput ): Promise<IDBValidKey>;

			/** The module's last limit records from one tab (without tabId from all), newest first */
			listEntries( query: Types.ListEntriesQuery ): Promise<Types.DataEntry[]>;

			/** A shallow merge of patch into the payload of a module record; true = changed */
			updatePayload( query: Types.UpdatePayloadQuery ): Promise<boolean>;

			/** Deletes a module record; true = deleted */
			removeEntry( query: Types.RemoveEntryQuery ): Promise<boolean>;

			/** The module's records from one document, newest first */
			findByDocument( query: Types.FindByDocumentQuery ): Promise<Types.DataEntry[]>;

			/** The module's records from one domain, newest first; limit > 0 limits the count */
			findByDomain( query: Types.FindByDomainQuery ): Promise<Types.DataEntry[]>;

			/** The module's records under its own key, newest first; limit > 0 limits the count */
			findByKey( query: Types.FindByKeyQuery ): Promise<Types.DataEntry[]>;

			/** Records with a matching key of a compound index, newest first; limit > 0 limits the count */
			_listByIndex( indexName: string, indexKey: IDBValidKey, limit: number ): Promise<Types.DataEntry[]>;

			/** A batch of the module's records for a backup, from the oldest (id greater than afterId) */
			exportEntries( query: Types.ExportEntriesQuery ): Promise<Types.ExportEntriesResult>;

			/** Writes the module's records from a backup (with replace deletes the existing ones first); returns the number written */
			importEntries( query: Types.ImportEntriesQuery ): Promise<number>;

			/** Number of the module's records, without an argument of all records */
			countEntries( module?: string ): Promise<number>;
		}

	}

}

export { };
