//@ts-check
"use strict";

// sdk.mjs — the public API for modules (modules/<name>/*) and their content
// scripts. This is the only core file they should import — base.mjs is the
// internal implementation (controllers, IndexedDB, floating window, ...) and a
// module that imports anything from it other than through sdk.mjs bypasses the
// API and ties itself to internal details that may change at any time without
// any mention in this public layer.
//
// A module uploaded by the user in Settings never loads this file — it runs in the
// sandbox (sandbox.html) and gets its SDK there: a classic script as sandboxSdk, a JS
// module of an uploaded package imports "../../sdk.mjs" too, but the sandbox gives it
// its own SDK under that name (see sandbox.js and the section about uploaded modules in
// base.mjs).
//
// A module element (BaseElement) gets its own "api" object automatically as
// this.api (see BaseElement.init() in base.mjs). A content script runs outside
// BaseElement (outside the extension DOM), so it creates the same thing itself:
//
//   const { createModuleApi } = await import(chrome.runtime.getURL("sdk.mjs"));
//   const api = createModuleApi("myModule");
//
// A module's background part (modules/<name>/background-script.mjs) runs in
// background.js, i.e. even without an open extension page. It registers itself
// by calling registerBackgroundScript({ name, setup }) and gets api as the
// argument of setup({ api }); it is loaded by the modules-background.mjs list
// (see there and registerBackgroundScript() in base.mjs):
//
//   registerBackgroundScript({
//       name: MODULE_NAME,
//       setup: ({ api }) => {
//           chrome.tabs.onCreated.addListener(async () => {
//               if (!(await api.activation.isActive(DEFAULT_ACTIVATION_MODE))) return;
//               // ...
//           });
//       },
//   });
//
// api.settings — the module's own settings (moduleSettings), without having to know
//   SETTINGS_KEY or call chrome.storage directly. For a module with multiple
//   instances (registerModule({ multiInstance: true })) the element's api.settings
//   works with the settings of its instance — createModuleApi(name, instanceId).
// api.state / api.sessionState — the module's own state outside the settings: get(key,
//   default)/set(key, value), each value under its own storage key
//   (chrome.storage.local, or chrome.storage.session — that one lasts only until
//   the browser restarts or the extension is reloaded, and a content script does not have it).
//   onChange(key, handler) reports a value change from anywhere in the extension — even
//   on a page that messages from background.js do not reach (the floating window in
//   Firefox, but there only api.state: Firefox does not provide chrome.storage.session there).
//   See tabGroups, bookmarkChecker (linkTags.mjs).
// api.activation — isActive(defaultMode, activationSpec?): is the module in the module
//   list and does its activationSpec hold for the current activation mode?
//   onChange(handler): the module list or the settings changed. For a module's
//   background part, whose listeners are always registered.
//   onInstalled(handler): after the extension is installed/updated (details.reason),
//   once the core has filled in the default settings — for the "After the extension
//   is installed" activation mode (isActive(defaultMode, INSTALL_SPEC)), only in a background part.
//   See onboardingModule.
// api.messages — chrome.runtime messages, with the listener unsubscribed automatically
//   (only outside BaseElement — that has the same thing through registerMessageHandler()).
// api.notifications — show(title, options): an extension notification (Web
//   Notification) from anywhere; it is always shown by background.js (the Chrome service
//   worker and the Firefox background page alike). onEvent(handler): every notification
//   the extension showed this way and its progress (create, show, error,
//   click, close) including the module that sent it — only in a background part. See
//   customSearch and PWAInfo (show them), notificationsCenter (records them).
// api.data     — shared IndexedDB through background.js: a module stores its own
//   structured data without background knowing its name in advance. log()
//   returns the id of the new record, which can be completed later with update(id, patch)
//   (progress the module finds out only after the write) and deleted with remove(id);
//   listLatest(limit) returns
//   the module's last N records from all tabs, listForActiveTab(limit)
//   only from the current tab. log(payload, { key }) stores the module's own key
//   with the record, findByKey({ key }) finds records by it. Returned records also carry
//   their id. Works in a module's background part too (a record without a tab).
// api.rateLimit — a shared rate limit for the whole extension (all tabs
//   and surfaces together, counted by background.js): acquire(key, [{ max, ms }])
//   allows and counts one operation, or says how long to wait before trying
//   again; block(key, ms) blocks the key for a while (e.g. a server does not respond),
//   getState(key) returns the block and the operation times. See domainInfo (limits of RDAP
//   servers).
// api.floatingWindow — the whole stored state of the floating window for all domains,
//   for overview/administrative modules (an uploaded module gets it through the functions
//   floatingWindow.getAllStates/updateStates/onChange, see floatingWindowOverviewSandbox), and
//   toggle(): opens/closes the floating window on the tab the surface relates
//   to (call it directly from a click handler; an uploaded module gets it as the function
//   floatingWindow.toggle on a button the core draws, see mainButtonsSandbox).
// api.badge    — setRules()/getRules(): "if the current page is a bookmark
//   in this bookmark folder (folderId), color the extension icon with this color"
//   ({ folderId, color, text }). The core (background.js) applies the rules with a generic
//   pass over chrome.bookmarks + chrome.action.setBadge*() to the icon of
//   A SPECIFIC TAB, without knowing the name of the module that wrote them (see
//   bookmarkChecker). Requires the optional "bookmarks" permission (see
//   BOOKMARKS_PERMISSIONS). Applying the rules is triggered by the
//   PAGE_URL_MESSAGE message ({ url, tabId? }) — not by listening to chrome.tabs.on*
//   from background.js, because without the "tabs" permission (which this
//   project intentionally does not take) it would not have reliable access to the URL
//   of the active tab outside a direct reaction to an interaction with the extension. So a module
//   that wants to use the icon sends, from its own content-script.js (it has
//   window.location.href for free and sender.tab.id is delivered automatically) when the page loads,
//   `api.messages.send({ type: PAGE_URL_MESSAGE, url: location.href })`;
//   the module element (it runs in the popup/sidebar/floating, without sender.tab) does the same
//   with an explicit `tabId` from its own chrome.tabs.query().
// api.permissions — chrome.permissions.contains()/request()/remove() without
//   a direct dependency on chrome.*, plus getActivity()/onChange(). "scripting"
//   and "<all_urls>" (see PAGE_ACCESS_PERMISSIONS) are optional — a module whose
//   content script should run on any page has to request them itself
//   with a button (a click is a prerequisite for
//   chrome.permissions.request()), see bookmarkChecker or
//   transferredDataVolume. The extensionPermissionsManager module then uses getActivity()
//   to show who asked for what and when.
// api.backup — exportAll()/importAll(data): the WHOLE content of chrome.storage.local
//   at once, without knowing the names of specific keys (moduleSettings, modulesJson,
//   ...). importAll() replaces (clear()+set()) absolutely everything, it does not merge —
//   it is used by the importExport module for backup/restore of the whole extension to/from
//   a file. exportModule(name)/importModule(name, backup, { settings,
//   data }): a backup of ONE module — its settings (including instances) and rules,
//   api.state, api.data records (through background.js, only from an extension
//   page) and data the module keeps elsewhere (registerModule({ backupData:
//   { export({ api }), import({ api, data }) } }), see redirectCacheManager).
//   An import replaces only the parts the backup has and does not touch other modules.
//   listClientModules(): the modules whose data another extension keeps (an allowed
//   client that runs them instead of this one, see "Modules from other extensions" in
//   base.mjs) — exportModule()/importModule() of such a module go to that extension.
// api.debugger — the DevTools protocol through chrome.debugger (Chrome only, the optional
//   DEBUGGER_PERMISSIONS permission): getTargets() without attaching the debugger (no
//   debugging infobar, can be called often) and sendCommands(target, commands), which
//   attaches the debugger, sends the commands and detaches — always in background.js, so
//   it does not stay attached even when the popup closes in the middle of an action, and it works
//   from the floating window too. Chrome does not allow extensions all protocol domains
//   (it rejects ServiceWorker.*), so whether a command is usable has to be verified (see
//   serviceWorkerControl/sources.mjs).
// api.networkRules — set(rules): the module's dynamic declarativeNetRequest rules
//   (redirects, blocking, … — rules without an id), the WHOLE set at once.
//   They are put into the browser only by background.js (the sole owner of dynamic rule
//   ids) and only for modules that are in the module list and not turned off —
//   turning a module off or removing it cancels its rules immediately, without an open
//   extension page. Returns the status ({ active, reason, error? }). Requires
//   NETWORK_RULES_PERMISSIONS and host permissions for the addresses the rules
//   target (see customSearch). set(rules, { bulk: true }) — bulk
//   rules (a large set from lists, the core's network filters): a priority layer below
//   the other modules (their exceptions do not cancel other modules' rules), only
//   as many rules from the beginning of the set as fit into the browser limits
//   (status: dropped); those rejected by the browser are skipped (rejected); they are stored
//   outside chrome.storage and are not backed up. getStatus() — the status without changing
//   the set.
// CONTENT_FILTERS_PERMISSIONS, USER_SCRIPTS_PERMISSIONS — the permissions of the core's content
//   filters (uBO scriptlets and cosmetic filters injected into the pages of a module's hosts,
//   contentFiltersBackground.mjs): an uploaded module asks for them with contentFilters.* of the
//   catalog in base.mjs (its configuration it can declare in registerModule({ contentFilters }) — the
//   core applies it from the installation) and declares these sets (with the host permissions of its
//   hosts) in usesPermissions — see youtubeAdBlockerSandbox.
// NETWORK_FILTERS_PERMISSIONS — the permissions of the core's network filters (the network rules of
//   filter lists converted into declarativeNetRequest blocking rules on all pages,
//   networkFiltersBackground.mjs): an uploaded module asks for them with networkFilters.* of the
//   catalog in base.mjs (its configuration it can declare in registerModule({ networkFilters }) — the
//   core applies it from the installation) and declares the set in usesPermissions — see adBlockerSandbox.
// uBlock Origin / Adblock Plus filter lists (filterLists.mjs) —
//   downloadFilterList() with mirrors, expandIncludes() (!#include),
//   preprocess() (!#if), parseFilter(), normalizeHost(), isRe2Compatible(),
//   list validity (filterListExpiresHours(), isFilterListStale()); see
//   trackingParamsCleaner (the core's network filters too, networkFilters.mjs).
// api.perf — module load measurement (see perf.mjs): getState()/setEnabled()/
//   onChange() — the measurement switch for the whole extension (whoever turns it on is its
//   owner: when it disappears from the module list or is turned off, background.js turns
//   the measurement off); getStats(domain) — an overview of the measured values (only from
//   extension pages); reset(); measure(label, fn) — a custom code section the core
//   hooks do not catch. The core measures by itself (callbacks, module phases, api.* calls),
//   a module does not have to add anything; module values are also split by activation mode
//   (snapshot.modes, key = a value from ACTIVATION_MODES, for a module
//   with instances several separated by PERF_MODE_SEPARATOR). See performanceMonitor.
//
// ACTIVATION_MODES — the module activation modes ({ value, label }) in the order
//   of the choice in Settings.
//
// getRegisteredModules() — definitions of all modules registered so far
//   (a shallow copy), including the optional usesPermissions from registerModule() —
//   extensionPermissionsManager reads it to find out, for each optional permission,
//   which modules themselves declare an interest in it.
//
// isServiceProviderPresent() — whether the full extension a standalone extension was
//   built from (its service provider, "Modules from other extensions" in base.mjs) is
//   installed and turned on; false in the full extension itself. onboardingModule does
//   not open the welcome page of a standalone extension next to the full one.
//
// getExtensionInfo() — { name, version }: the name of the extension in the UI language (a standalone
//   extension has its own) and its version; an uploaded module gets the same from its SDK (the
//   sandbox page has no chrome.runtime). See contentDividerSandbox ({name}, {version} in the text).
//
// Specifications (Specification Pattern) — the rule for WHEN a module is active
// (activationSpec in registerModule() and this.activationSpec in the element's
// constructor, see README, section "Developing a new module"). Ready-made instances cover
// the common cases; Specification/AndSpecification/... are here for modules that
// need to compose their own rule (`.and()/.or()/.not()`, or their own subclass).
// WEB_PAGE_SPEC is added to activationSpec by a module that works with the active
// page (a content script, its address) — then it is not shown on special browser
// pages (chrome://, about:, new tab, add-on store, ...); isWebPageUrl() is the same
// test for a single address, e.g. before chrome.scripting.executeScript().
//
// startIdleWork(timeout) — a content script's look through a big page in slices of the browser's
//   idle time (requestIdleCallback): `const budget = await startIdleWork();` and in the loop
//   `if (budget.expired()) await budget.next();` — the page is not held for hundreds of
//   milliseconds; between two slices the page may change (see studiesManager, contactsModule).
//
// MAIN_WORLD_DOMAINS_FIELD — key of the custom setting with a list of domains for
//   which background.js registers modules/<name>/main-world-domain-script.js
//   (MAIN world, document_start, all frames; nowhere without the list). A module
//   typically puts it into settingsSchema as a "textarea" and fills it in through
//   api.settings.get()/set(). parseDomainList()/normalizeDomain() read and
//   normalize domains the same way as the core; isHostInDomains() is the same test
//   by which the script gets onto a page (the domain and its subdomains).
//
// MAIN_WORLD_BOOKMARK_FOLDERS_FIELD — a second source of those domains: an array of
//   bookmark folders { folderId, folderTitle }; the domains of the bookmarks in them
//   apply (with the "bookmarks" permission). getMainWorldDomains() returns all domains
//   the core registers the script for, getBookmarkFolderDomains() those of the folders.
//
// PAGE_SCRIPTS_FIELD — key of the custom setting that turns off the module's scripts
//   in pages without turning off the whole module: with the value false,
//   background.js registers neither the module's content-script.js nor main-world-*.js.
//   A module puts it into settingsSchema as a "checkbox" (default true)
//   with its own label; pages already loaded keep the script, so the content script
//   watches the value itself as well. See customSearch (collecting search
//   providers).
export {
	// --- Module base ---
	BaseElement,
	registerModule,
	registerBackgroundScript,
	getTagName,
	formatModuleName,
	getModuleSettingKey,
	formatBytes,
	contrastColor,
	PAGE_ACCESS_PERMISSIONS,
	BOOKMARKS_PERMISSIONS,
	WEBREQUEST_PERMISSIONS,
	WEBNAVIGATION_PERMISSIONS,
	DEBUGGER_PERMISSIONS,
	NETWORK_RULES_PERMISSIONS,
	CONTENT_FILTERS_PERMISSIONS,
	USER_SCRIPTS_PERMISSIONS,
	NETWORK_FILTERS_PERMISSIONS,
	PAGE_URL_MESSAGE,
	isServiceProviderPresent,
	getExtensionInfo,
	bookmarkFolderContainsUrl,
	getRegisteredModules,
	isWebPageUrl,
	MAIN_WORLD_DOMAINS_FIELD,
	MAIN_WORLD_BOOKMARK_FOLDERS_FIELD,
	PAGE_SCRIPTS_FIELD,
	normalizeDomain,
	parseDomainList,
	isHostInDomains,
	startIdleWork,
	parseBookmarkFolderList,
	getBookmarkFolderDomains,
	getMainWorldDomains,
	ACTIVATION_MODES,

	// --- API for communication with the core (settings, messages, data, floating window) ---
	createModuleApi,

	// --- Specification Pattern (pravidla aktivace) ---
	Specification,
	AndSpecification,
	OrSpecification,
	NotSpecification,
	ModeSpecification,
	UrlPatternSpecification,
	LocationSpecification,
	WebPageSpecification,
	NOT_DISABLED_SPEC,
	DISABLED_SPEC,
	BACKGROUND_OR_FOCUS_SPEC,
	POPUP_OR_ICON_CLICK_SPEC,
	INSTALL_SPEC,
	WEB_PAGE_SPEC,
} from "./base.mjs";

// --- Module load measurement (see perf.mjs, api.perf) ---
export {
	PERF_CORE,
	PERF_DEFAULT_MODE,
	PERF_MODE_SEPARATOR,
	PERF_CONTEXTS,
	PERF_FRAME_MS,
	PERF_LONG_MS,
	PERF_OTHER_KIND,
} from "./perf.mjs";


// --- User interface translations (see i18n.mjs) ---
export {
	t,
	tp,
	tIn,
	UI_LANGUAGES,
	loadI18n,
	loadModuleI18n,
	applyI18n,
	getUiLanguage,
	getUiLocale,
	onUiLanguageChange,
} from "./i18n.mjs";
