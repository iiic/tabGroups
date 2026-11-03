//@ts-check
"use strict";

// base.mjs — Shared base module for all JavaScript in the extension

// Casting the target: otherwise TypeScript 6 would treat the assignment as a new declaration
// (an expando on globalThis) instead of var __extensionModules from base.globals.d.ts.
/** @type {typeof globalThis} */ (globalThis).__extensionModules = globalThis.__extensionModules || [];

import { t, loadI18n, loadModuleI18n, addModuleI18n, getUiLanguage, UI_LANGUAGES, DEFAULT_UI_LANGUAGE } from "./i18n.mjs";
import {
	installPerfHooks,
	detectPerfContext,
	measurePerf,
	instrumentModuleApi,
	flushPerf,
	perfStateFromSwitch,
	resolvePerfModes,
	PERF_STATE_KEY,
	PERF_GET_MESSAGE,
	PERF_RESET_MESSAGE,
} from "./perf.mjs";

// Module load measurement hooks (see perf.mjs) — right when the core loads, before
// module code runs: background.js, extension pages and content scripts
// (through sdk.mjs) load base.mjs first, so every callback a module
// registers already goes through the hooks. Outside the extension (Node in tests, without
// chrome.runtime) nothing is installed.
installPerfHooks();

export const SETTINGS_KEY = "moduleSettings";
export const MODULES_JSON_KEY = "modulesJson";
export const FLOATING_WINDOW_STATE_KEY = "floatingWindowState";
// Open/closed state of the modules' collapsible frames (<details>, see
// OUTPUT_ELEMENTS and mountModuleElement) — { [module list entry key]: { open,
// element, seen } }. Only state the user changed compared to the
// default from the "Output element" setting is stored; records of frames that have not
// been rendered for a long time are deleted (see pruneFrameStates()).
export const FRAME_STATE_KEY = "moduleFrameState";
// A record of a frame that has not been rendered anywhere for this long is deleted at the next
// write — modules appear and disappear according to the page content (activationSpec),
// module instances are created and removed, the state for them should not stay forever.
export const FRAME_STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A safeguard against endless growth: above this count the records not seen
// for the longest time are discarded.
export const FRAME_STATE_MAX_ENTRIES = 500;
// The "last seen" time is refreshed when the frame is rendered, but at most once
// per this period — accuracy to a day does not matter for a 30-day limit, and this way
// it is not written needlessly on every render.
export const FRAME_STATE_SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;
// The module output pinned by the user (the 📌 button, see attachPinButton()) — the key of the
// module list entry under "pinnedModule.<surface>", for each surface of PIN_LOCATIONS
// separately. Only the user's choice: the module list (modules.json, MODULES_JSON_KEY)
// and its order stay unchanged.
export const PINNED_MODULE_KEY_PREFIX = "pinnedModule.";
/** @type {Enums.PinLocation[]} */
export const PIN_LOCATIONS = ["sidebar", "floating"];
// The maximum height of the pinned frame in % of the surface height (Settings, the first tab) — a frame
// taller than that scrolls inside itself. Missing = PINNED_MAX_HEIGHT_DEFAULT; the value applies on all
// PIN_LOCATIONS surfaces as the CSS variable --pinned-max-height (css/module-frame.css).
export const PINNED_MAX_HEIGHT_KEY = "pinnedModuleMaxHeight";
export const PINNED_MAX_HEIGHT_DEFAULT = 80;
export const PINNED_MAX_HEIGHT_MIN = 20;
export const PINNED_MAX_HEIGHT_MAX = 100;
// "Do not use the sidebar" on the Settings page — true = the user does not want the side panel at all.
// Chrome then hides the extension's side panel itself (applySidebarDisabled()), Firefox does not let an
// extension hide the icon of its sidebar in the sidebar launcher (only the user can remove it there,
// Firefox 143+), so sidebar.html shows only a notice instead of the modules. The module output
// locations stay stored ("sidebar" included) for when the user turns the panel on again. An extension
// without a sidebar in its manifest has it on for good (hasManifestSidebar()).
export const SIDEBAR_DISABLED_KEY = "sidebarDisabled";
// The build settings of a module for its standalone extension (modules/<module>/standalone.json) — read by
// scripts/build-module-*.ps1 and shown by buildSettings.get; the same name as STANDALONE_CONFIG in scripts/build.mjs.
export const STANDALONE_CONFIG_FILE = "standalone.json";
// A log of who (which module name, or the Permissions Manager module itself on a
// manual intervention) requested/removed which optional permission when, and with what
// result — see createModuleApi().permissions below and the
// extensionPermissionsManager module, which reads and shows it.
export const PERMISSION_ACTIVITY_KEY = "permissionActivity";
// A general (module-independent) set of rules "if the current page is a
// bookmark in this bookmark folder, color the extension icon with this color" —
// { [module name]: [{ folderId, color, text }, ...] }. The core (background.js)
// does not know the modules that write the rules (see createModuleApi().badge below),
// the same as with PERMISSION_ACTIVITY_KEY/moduleSettings — it just reads them and
// applies them to the active tab's icon with a generic pass over chrome.bookmarks.
export const BADGE_RULES_KEY = "badgeRules";
export const DB_NAME = "ExtensionAnalytics";
// Version 3 added the "documentKey" index (see getDocumentKey()), version 4 the compound
// index [module, domainKey] and a backfill of domainKey (see getDomainKey()),
// version 5 the compound index [module, recordKey] (the record's own key, see
// api.data.findByKey()) — all in BaseStorage._openDatabase.
export const DB_VERSION = 5;
export const DATA_STORE = "data_logs";

// The wire protocol between createModuleApi().data and background.js (see below and
// background.js) — a general data service; the background does not know the names of individual
// modules in advance, it just stores/counts them by the "module" field of the stored message.
export const DATA_LOG_MESSAGE = "SDK_DATA_LOG";
export const DATA_COUNT_MESSAGE = "SDK_DATA_COUNT";
export const DATA_TOTAL_MESSAGE = "SDK_DATA_TOTAL";
// The last N records of one module for one tab (see
// api.data.listForActiveTab() below). Payload: { module, limit, tabId? } —
// tabId is sent only by a sender WITHOUT sender.tab (popup/sidebar), the same
// convention as for PAGE_URL_MESSAGE. Only records of this run of the browser (see
// BROWSER_SESSION_START_KEY).
export const DATA_LIST_MESSAGE = "SDK_DATA_LIST";
// When this run of the browser started (ms since the epoch) — background.js stores it on
// chrome.runtime.onStartup. After a restart the browser numbers tabs from the beginning again, so a tab
// of this run may get the id of a tab from an earlier run, and DATA_LIST_MESSAGE would list that tab's
// old records too (visualHistory in a new window). Not a setting: a backup of chrome.storage.local
// leaves it out and a restore keeps the current one (api.backup). Missing (the extension has not seen
// a browser start yet) = records of all runs.
export const BROWSER_SESSION_START_KEY = "browserSessionStart";
// Records of one module belonging to one document (see
// api.data.findByDocument() and getDocumentKey()). Payload:
// { module, tabId, documentKey }.
export const DATA_FIND_BY_DOCUMENT_MESSAGE = "SDK_DATA_FIND_BY_DOCUMENT";
// Records of one module stored from pages of one domain (see
// api.data.findByDomain() and getDomainKey()). Payload: { module, domain, limit? }.
export const DATA_FIND_BY_DOMAIN_MESSAGE = "SDK_DATA_FIND_BY_DOMAIN";
// Records of one module stored under one own key (see
// api.data.log(payload, { key }) and api.data.findByKey()). Payload:
// { module, key, limit? }.
export const DATA_FIND_BY_KEY_MESSAGE = "SDK_DATA_FIND_BY_KEY";
// The last N records of one module from ALL tabs and domains (see
// api.data.listLatest()) — DATA_LIST_MESSAGE above is restricted to one
// tab. Payload: { module, limit }.
export const DATA_LATEST_MESSAGE = "SDK_DATA_LATEST";
// Completing an already stored module record (see api.data.update()): fields from
// "patch" replace the same-named fields of its payload. The record id is returned by
// api.data.log(). Payload: { module, id, patch }.
export const DATA_UPDATE_MESSAGE = "SDK_DATA_UPDATE";
// Deleting one stored module record (see api.data.remove()). Payload: { module, id }.
export const DATA_REMOVE_MESSAGE = "SDK_DATA_REMOVE";
// background.js to the extension pages after a module record was stored, changed or deleted
// (the write is done — a read right after it sees it), for api.details.onChange(). Payload
// (Types.DataChange): { module, change: "log", domainKey, tabId, documentKey } — where the stored
// record came from —, or { module, change: "update" | "remove", id } — the storage does not read
// the record back, so where it came from is not known. Never the payload of the record.
export const DATA_CHANGED_MESSAGE = "SDK_DATA_CHANGED";
// Backup of one module's records (api.backup.exportModule()/importModule()),
// in batches of BACKUP_DATA_BATCH records — a whole module in one message could
// exceed the message size limit (Chrome 64 MiB), there tend to be many records
// (transferredDataVolume writes every 2 s). EXPORT: { module, afterId }
// → { records, lastId } (records with an id greater than afterId, from the oldest;
// lastId = the id of the last of them); IMPORT: { module, records, replace }
// → { imported } (replace: delete all records of the module first). Only from
// extension pages — an import overwrites the data of any module.
export const DATA_EXPORT_MESSAGE = "SDK_DATA_EXPORT";
export const DATA_IMPORT_MESSAGE = "SDK_DATA_IMPORT";
export const BACKUP_DATA_BATCH = 500;
// Shared rate limits (see api.rateLimit below and background.js): how many
// operations (typically queries to a foreign server) the extension may do per chosen
// time window — for ALL tabs and surfaces together, so they are counted by
// background.js, not by the caller. The state is in chrome.storage.local under
// RATE_LIMITS_KEY ({ "<module>:<key>": { times, blockedUntil?, keepMs? } }),
// so it survives the service worker going to sleep and a browser restart. Payload:
// ACQUIRE { module, bucket, windows }, BLOCK { module, bucket, ms },
// STATE { module, bucket }.
export const RATE_LIMITS_KEY = "rateLimits";
export const RATE_LIMIT_ACQUIRE_MESSAGE = "SDK_RATE_LIMIT_ACQUIRE";
export const RATE_LIMIT_BLOCK_MESSAGE = "SDK_RATE_LIMIT_BLOCK";
export const RATE_LIMIT_STATE_MESSAGE = "SDK_RATE_LIMIT_STATE";
// The longest window for which operation times are remembered (and the longest block).
const RATE_LIMIT_MAX_KEEP_MS = 24 * 60 * 60 * 1000;
// How many operation times are remembered for one key at most.
const RATE_LIMIT_MAX_TIMES = 10000;
// The sender's tab (sender.tab) — for api.tabs.getActive() inside the floating
// window's <iframe>, which has no chrome.tabs, but background.js recognizes from the message
// which tab it is embedded in. Response: { tab: { id, url } | null }.
export const GET_SENDER_TAB_MESSAGE = "SDK_GET_SENDER_TAB";
// An instruction for content-scripts/floating-window.js: toggle the floating window on this
// page (open it, or close it depending on whether it is there right now). Sent by
// api.floatingWindow.toggle() (see createModuleApi() below) directly to the tab,
// from inside the floating window background.js sends it on its behalf (see the next constant).
export const TOGGLE_FLOATING_WINDOW_MESSAGE = "TOGGLE_FLOATING_WINDOW";
// api.floatingWindow.toggle() inside the floating window's <iframe> — that has no
// chrome.tabs, so background.js sends TOGGLE_FLOATING_WINDOW_MESSAGE on its behalf to the tab
// it is embedded in (sender.tab).
export const TOGGLE_SENDER_FLOATING_WINDOW_MESSAGE = "SDK_TOGGLE_SENDER_FLOATING_WINDOW";
// tabs.activate of an uploaded module from inside the floating window's <iframe> (no chrome.tabs there):
// background.js selects the tab and focuses its window ({ tabId } → {} or { error }) — only the tab the
// window is embedded in (sender.tab).
export const ACTIVATE_TAB_MESSAGE = "SDK_ACTIVATE_TAB";
// The floating window's content script — background.js registers it dynamically,
// api.floatingWindow.toggle() injects it directly into the tab after the permission
// is granted for the first time.
export const FLOATING_WINDOW_SCRIPT = "content-scripts/floating-window.js";
// A general notice "this tab is now on this URL", for the badge (see
// BADGE_RULES_KEY and background.js) — chrome.tabs.onActivated/onUpdated in
// background.js (the service worker) would not reliably give tab.url without the "tabs" permission
// (activeTab works only in a direct reaction to an interaction with the extension,
// not ambiently in the background), whereas a content script has window.location.href
// for free and sender.tab.id/api.messages.send() delivers it without needing
// another permission. Payload: { url, tabId?, bookmarkUrls? } — tabId is
// optional and serves only senders WITHOUT sender.tab (a module element in the
// popup/sidebar/floating, not a content script), see bookmarkChecker.mjs.
// bookmarkUrls are other addresses under which the page may be saved as a
// bookmark (bookmarkChecker masks the address of bookmarks with the "Don't suggest" option) —
// the icon rules apply to them too.
export const PAGE_URL_MESSAGE = "SDK_PAGE_URL";
// chrome.permissions is NOT available inside the floating window's <iframe> (the same
// restriction as chrome.tabs/chrome.scripting, see hasTabsApi below) — so only
// api.permissions.contains() (reading, without needing a user gesture) can be
// redirected there to background.js, which always has chrome.permissions.
// api.permissions.request() can NOT be redirected this way (see the comment at
// request() below) — Chrome requires chrome.permissions.request() to run
// directly in a click handler; the "gesture activation" does not propagate through messages to
// background.js, so the call would always fail there, even though
// background.js does have chrome.permissions.
export const PERMISSIONS_CONTAINS_MESSAGE = "SDK_PERMISSIONS_CONTAINS";
// Extension notifications (api.notifications.show()) — they are always shown by
// background.js, from other contexts on this message (see
// showExtensionNotification() below). Payload: { module, title, options };
// response { error? }.
export const NOTIFICATION_SHOW_MESSAGE = "SDK_NOTIFICATION_SHOW";
export const DEFAULT_MODE = "popup";
export const DEFAULT_DISPLAY_LOCATION = "popup";

// Default settings of the entries of the default module list (modules.json) — a file
// in the extension package in the same shape as moduleSettings in storage
// ("<entry>" = activation mode, "<entry>.<field>" = surface, output
// element, custom field, …; the entry is the module name, for an instance
// "<module>#<id>"). Useful mainly for instances of modules with multiple
// instances that the default list already contains: otherwise only the user could give them
// settings (contentDividerSandbox#welcome: the welcome on the welcome
// page). BaseController.seedDefaultSettings() writes it into storage —
// after the extension is installed and updated and after the module list is saved
// in Settings — and only the missing values.
export const DEFAULT_SETTINGS_FILE = "default-settings.json";

// The permission needed for injecting content scripts into any pages
// (the floating window, module content scripts like bookmarkChecker or
// transferredDataVolume) — "scripting" and "<all_urls>" are optional in the manifest
// (optional_permissions/optional_host_permissions), so that the extension
// itself (popup, Settings, module list) works on minimal
// permissions and requests this only when someone really needs it —
// see api.permissions and api.floatingWindow.toggle() below. One shared shape,
// so the same pair is not repeated in background.js, the core and every such
// module separately.
/** @type {Types.PermissionSet} */
export const PAGE_ACCESS_PERMISSIONS = { permissions: ["scripting"], origins: ["<all_urls>"] };

// Access to the browser's real bookmarks (chrome.bookmarks) — used by
// bookmarkChecker so the user can pick a category name right from
// their existing bookmarks instead of typing free text (see
// categoriesEditor.mjs). Like PAGE_ACCESS_PERMISSIONS, this is also optional in the
// manifest (optional_permissions) and requested with a button.
/** @type {Types.PermissionSet} */
export const BOOKMARKS_PERMISSIONS = { permissions: ["bookmarks"] };

// Tracking the IP address a network request was really sent to
// (chrome.webRequest) — the only way JS gets to the IP address of the
// server at all (a content script/fetch() has no access to it). Used by geoipForDomain.
// "webRequest" moreover needs a host permission for the tracked URLs, so
// "<all_urls>" is part of it right here (unlike PAGE_ACCESS_PERMISSIONS
// this module needs no content script/injection, "scripting" would
// be a needless extra permission).
/** @type {Types.PermissionSet} */
export const WEBREQUEST_PERMISSIONS = { permissions: ["webRequest"], origins: ["<all_urls>"] };

// An optional permission for chrome.webNavigation — with it background.js finds out for each
// tab HOW the current document was reached (transitionType: a click on a
// link, typing into the address bar, a bookmark, a form submission, ... and
// transitionQualifiers: client/server redirect, Back/Forward, ...),
// see api.network.getNavigationTransition(). It needs no host permission —
// chrome.webNavigation events come for all tabs with it alone.
/** @type {Types.PermissionSet} */
export const WEBNAVIGATION_PERMISSIONS = { permissions: ["webNavigation"] };

// An optional permission for chrome.debugger (the DevTools protocol) — Chrome only,
// Firefox has no chrome.debugger. See api.debugger in createModuleApi(). On a request
// the browser shows a strong warning for it, and while the debugger is attached
// an infobar "… started debugging this browser".
/** @type {Types.PermissionSet} */
export const DEBUGGER_PERMISSIONS = { permissions: ["debugger"] };

// An optional permission for network request rules
// (chrome.declarativeNetRequest, see api.networkRules in createModuleApi()).
// The "WithHostAccess" variant has no warning on installation, but the rules apply
// only to addresses the extension has a host permission for — the module adds those to its
// own set according to which websites its rules target (customSearch:
// the browser's default search engines), so it does not have to ask for "<all_urls>".
/** @type {Types.PermissionSet} */
export const NETWORK_RULES_PERMISSIONS = { permissions: ["declarativeNetRequestWithHostAccess"] };

// Optional permissions of the core's content filters (contentFilters.* of the catalog for uploaded
// modules, contentFiltersBackground.mjs): the fallback injection — scripting.executeScript() on
// webNavigation.onCommitted — plus the host permissions of the hosts the module filters (it adds
// them to its own set, youtubeAdBlockerSandbox: YouTube). Without them the core injects nothing.
// USER_SCRIPTS_PERMISSIONS — the reliable injection before the page's scripts
// (userScripts.register()); Firefox gives it only as optional and it is requested separately,
// Chrome (138+) additionally lets it through only after the "Allow User Scripts" toggle is turned
// on in the extension's details.
/** @type {Types.PermissionSet} */
export const CONTENT_FILTERS_PERMISSIONS = { permissions: ["scripting", "webNavigation"] };
/** @type {Types.PermissionSet} */
export const USER_SCRIPTS_PERMISSIONS = { permissions: ["userScripts"] };

// Permissions of the core's network filters (networkFilters.* of the catalog for uploaded modules,
// networkFiltersBackground.mjs — adBlockerSandbox): declarativeNetRequest rules (NETWORK_RULES_PERMISSIONS,
// the "WithHostAccess" variant) and the host permission for all addresses — with the "WithHostAccess"
// variant the browser applies a rule only to requests to addresses the extension has the host permission
// for, and blocking should apply everywhere. The host permission also allows downloading lists from
// servers without CORS (pgl.yoyo.org). Chrome accepts both as optional, Firefox
// declarativeNetRequestWithHostAccess only as required (it is in its manifest), <all_urls> as optional.
// A module declares the set in usesPermissions; without it granted the core downloads no lists.
/** @type {Types.PermissionSet} */
export const NETWORK_FILTERS_PERMISSIONS = { permissions: [...(NETWORK_RULES_PERMISSIONS.permissions || [])], origins: ["<all_urls>"] };

// Dynamic declarativeNetRequest rules of modules (api.networkRules): a module
// sends the WHOLE set of its rules (without ids) in the NETWORK_RULES_SET_MESSAGE message,
// background.js stores it under NETWORK_RULES_KEY ({ "<module>": { rules,
// defaultMode } }) and puts into the browser only the rules of modules that are
// in the module list and not turned off (see planNetworkRules()). Rule ids
// are assigned by background.js itself — dynamic rules have one id namespace
// for the whole extension, so no module adds them directly. Response:
// { status } (Types.NetworkRulesStatus).
export const NETWORK_RULES_KEY = "networkRules";
export const NETWORK_RULES_SET_MESSAGE = "SDK_NETWORK_RULES_SET";

// Status of a module's rules in the browser without changing the set (api.networkRules.getStatus())
// — background.js recalculates the rules (without a change it writes nothing) and returns
// the module's { status }. Useful for bulk rules, where how many of them apply
// (dropped) also depends on the rules of other modules.
export const NETWORK_RULES_STATUS_MESSAGE = "SDK_NETWORK_RULES_STATUS";

// Messages for createModuleApi().debugger — background.js responds with the list of targets
// (chrome.debugger.getTargets()), or attaches the debugger, sends the commands and
// detaches it (runDebuggerCommands() below). The attachment is owned by background.js, not by
// the page: so the debugger does not stay attached (with the debugging infobar) even when the
// popup closes in the middle of an action, and it works even from the floating window, which has no
// chrome.debugger.
export const DEBUGGER_TARGETS_MESSAGE = "SDK_DEBUGGER_TARGETS";
export const DEBUGGER_COMMANDS_MESSAGE = "SDK_DEBUGGER_COMMANDS";
const DEBUGGER_PROTOCOL_VERSION = "1.3";

// Attaches the debugger to the target ({ tabId } or { targetId }), sends the commands one after
// another and detaches it again. The result of each command separately ({ result } or
// { error }) — one failed command does not stop the others; an attachment error
// throws an exception. A command that closes the target (Target.closeTarget) detaches the debugger
// by itself — the final detach then just silently fails.
/** @type {Functions.Base.runDebuggerCommands} */
export async function runDebuggerCommands(debuggee, commands) {
	await chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION);
	/** @type {Types.DebuggerCommandResult[]} */
	const results = [];
	try {
		for (const { method, params } of commands) {
			try {
				const result = await chrome.debugger.sendCommand(debuggee, method, params);
				results.push({ result: /** @type {Record<string, unknown>} */ (result || {}) });
			} catch (err) {
				results.push({ error: /** @type {Error} */ (err).message || String(err) });
			}
		}
	} finally {
		await chrome.debugger.detach(debuggee).catch(() => {});
	}
	return results;
}

// A message for createModuleApi().network.getIpForActiveTab() (see below) —
// background.js responds to it with the last detected IP address of the main
// document of the given tab (chrome.webRequest.onResponseStarted, see
// background.js), by sender.tab.id (a message from a content script) or
// message.tabId (a direct call without sender.tab).
export const GET_TAB_IP_MESSAGE = "SDK_GET_TAB_IP";

// A message for createModuleApi().network.getRedirectChain() (see below) —
// background.js responds with the HTTP redirect chain (the Location header) that
// led to the current document of the sender's tab (sender.tab.id), detected
// through chrome.webRequest.onBeforeRedirect (requires WEBREQUEST_PERMISSIONS).
export const GET_TAB_REDIRECTS_MESSAGE = "SDK_GET_TAB_REDIRECTS";

// A message for createModuleApi().network.getNavigationTransition() — background.js
// responds with the last commit of the main frame navigation of the sender's
// tab from chrome.webNavigation.onCommitted (requires
// WEBNAVIGATION_PERMISSIONS).
export const GET_TAB_NAVIGATION_MESSAGE = "SDK_GET_TAB_NAVIGATION";

// "install": the module works after the extension is installed — its background part
// gets api.activation.onInstalled() (see createModuleApi() and
// notifyInstalled() below) and checks the mode through INSTALL_SPEC (onboardingModule
// opens the welcome page).
// The labels are translated only when read (a getter) — see i18n.mjs.
/** @type {Types.ActivationModeOption[]} */
export const ACTIVATION_MODES = [
	{ value: "background", get label() { return t("core_activation_background"); } },
	{ value: "focus", get label() { return t("core_activation_focus"); } },
	{ value: "icon_click", get label() { return t("core_activation_icon_click"); } },
	{ value: "popup", get label() { return t("core_activation_popup"); } },
	{ value: "install", get label() { return t("core_activation_install"); } },
	{ value: "disabled", get label() { return t("core_activation_disabled"); } },
];

// Where the module's custom element (its UI) should be rendered — independently of
// the activation mode above (that controls WHEN the module works; this controls WHERE its output
// is shown). A module can be shown in several places at once —
// the setting is a list of locations (see getModuleDisplayLocations() below), empty =
// nowhere; in Settings the module has a checkbox for each location. Used by
// popup.mjs, sidebar.mjs, floating.mjs, options.mjs and onboarding.mjs (see
// BaseController.renderModulesFor) for the same decision whether a given module
// belongs on that particular surface. "onboarding" is the welcome page
// onboarding.html, which the onboardingModule module opens after the extension is installed.
/** @type {Types.DisplayLocationOption[]} */
export const DISPLAY_LOCATIONS = [
	{ value: "popup", get label() { return t("core_location_popup"); } },
	{ value: "sidebar", get label() { return t("core_location_sidebar"); } },
	{ value: "floating", get label() { return t("core_location_floating"); } },
	{ value: "options", get label() { return t("core_location_options"); } },
	{ value: "onboarding", get label() { return t("core_location_onboarding"); } },
];
// "Show nowhere" written as one string — from the time when only one location
// could be chosen. Today it is an empty list of locations, but the string still applies in
// stored settings (and in backups from importExport) and in a module's defaultDisplayLocation
// (see parseDisplayLocations()).
const NO_DISPLAY_LOCATION = "none";
// The field of the second set of output locations of a client's module — while its service provider shows it too
// (getModuleDelegatedDisplayLocations()); the same values as "displayLocation".
export const DELEGATED_DISPLAY_LOCATION_FIELD = "delegatedDisplayLocation";

// HOW the module output is shown on the chosen surface (DISPLAY_LOCATIONS above) — which
// frame the core wraps the module's custom element in (see
// BaseController.mountModuleElement). An inline/block/indented frame is just
// a <div> with the module-frame--<value> class (the look is in css/module-frame.css),
// a collapsible one is a <details>/<summary> pair, "open" determines
// whether it is expanded after rendering.
/** @type {Types.OutputElementOption[]} */
export const OUTPUT_ELEMENTS = [
	{ value: "inline", get label() { return t("core_output_inline"); } },
	{ value: "block", get label() { return t("core_output_block"); } },
	{ value: "indented", get label() { return t("core_output_indented"); } },
	{ value: "details-closed", get label() { return t("core_output_details_closed"); }, collapsible: true, open: false },
	{ value: "details-open", get label() { return t("core_output_details_open"); }, collapsible: true, open: true },
];
// Global default values — only for a module that does not declare its own suggestion
// (defaultOutputElement/defaultShowHeading in registerModule).
// They correspond to the look before frames were introduced (elements one below another, without a heading).
export const DEFAULT_OUTPUT_ELEMENT = "block";
export const DEFAULT_SHOW_HEADING = false;

// The optional "details" contract (moduleDef.details) — a module can offer its own
// data to other modules at several levels, without the modules having to
// know anything about each other (name, shape of the stored data):
//
//   details: {
//       visit:   async ({ api, url, tabId, documentKey }) => [{ label, value }, ...],
//       domain:  async ({ api, domain }) => [...],
//       browser: async ({ api }) => [...],
//   }
//
// - Levels (DETAILS_CONTEXT_VALIDATORS below): "visit" = one page visit
//   (tabId + documentKey, see getDocumentKey()), "domain" = one domain
//   (hostname, see getDomainKey()), "browser" = the whole browser (without a key).
//   Each is optional. The level keys are ALWAYS determined by the core, not by the module — only this way
//   do the provider and the consumer reliably hit the same data.
// - api: createModuleApi() of the PROVIDER (not of the caller) — the module finds
//   ITS records through api.data.findByDocument()/findByDomain().
// - Returns an array of { label, value } (value as text), or an empty array when it
//   has nothing. The shape of the own data thus stays the module's business.
// - The consumer collects them through api.details.collect(level, context) and renders them
//   generically, without knowing the providers (visualHistory for "visit",
//   domainDetailsSandbox for "domain" — an uploaded module, it asks from its sandbox).
//   The core skips turned-off modules ("disabled"),
//   an error or slowness of one provider (DETAILS_PROVIDER_TIMEOUT_MS)
//   neither breaks nor delays the others.
// - The consumer learns when the details may have changed through api.details.onChange(level,
//   context, handler) — a provider stored, changed or deleted a record (DATA_CHANGED_MESSAGE
//   from background.js); it then collects again itself. A stored record counts only for the
//   context it came from (DETAILS_CHANGE_MATCHERS — the same keys the providers look the records
//   up by), a changed or deleted one for every context.
/** @type {Types.DetailsContextValidators} */
const DETAILS_CONTEXT_VALIDATORS = {
	visit: (ctx) => typeof ctx.tabId === "number" && typeof ctx.documentKey === "number",
	domain: (ctx) => typeof ctx.domain === "string" && ctx.domain !== "",
	browser: () => true,
};
const DETAILS_SCOPES = Object.keys(DETAILS_CONTEXT_VALIDATORS);
const DETAILS_PROVIDER_TIMEOUT_MS = 2000;
// Whether a stored record (DATA_CHANGED_MESSAGE with change "log") concerns the context of the level.
/** @type {Types.DetailsChangeMatchers} */
const DETAILS_CHANGE_MATCHERS = {
	visit: (ctx, change) => change.tabId === ctx.tabId && change.documentKey === ctx.documentKey,
	domain: (ctx, change) => change.domainKey === ctx.domain,
	browser: () => true,
};
// api.details.onChange() calls its handler this long (ms) after the last change in a row — a page
// visit makes several records at once (redirects, the address, its title a moment later), the
// consumer collects them once.
export const DETAILS_CHANGE_DELAY_MS = 300;

// A valid limit window: an integer max >= 1 operations per ms >= 1 milliseconds
// (at most RATE_LIMIT_MAX_KEEP_MS). Invalid windows are ignored.
/** @type {Functions.Base.normalizeRateLimitWindows} */
export function normalizeRateLimitWindows(windows) {
	return (Array.isArray(windows) ? windows : [])
		.filter((w) => w && Number.isInteger(w.max) && w.max >= 1 && Number.isFinite(w.ms) && w.ms >= 1)
		.slice(0, 10)
		.map((w) => ({ max: w.max, ms: Math.min(Math.floor(w.ms), RATE_LIMIT_MAX_KEEP_MS) }));
}

// A shared limit decision for one key (changes the entry state in place) —
// called only by background.js, so operations from different tabs do not overtake each other.
// A blocked key (blockedUntil, see blockRateLimit()) lets nothing through. Otherwise
// it allows the operation and records its time, only if it would not exceed any window;
// otherwise it returns how long until space frees up in the strictest window.
/** @type {Functions.Base.tryAcquireRateLimit} */
export function tryAcquireRateLimit(entry, windows, now) {
	if (entry.blockedUntil && entry.blockedUntil > now) {
		return { granted: false, waitMs: entry.blockedUntil - now, blockedUntil: entry.blockedUntil };
	}
	delete entry.blockedUntil;
	const keepMs = Math.min(Math.max(entry.keepMs || 0, ...windows.map((w) => w.ms)), RATE_LIMIT_MAX_KEEP_MS);
	entry.keepMs = keepMs;
	entry.times = (entry.times || []).filter((t) => now - t < keepMs).slice(-RATE_LIMIT_MAX_TIMES);
	let waitMs = 0;
	for (const { max, ms } of windows) {
		// The times are ascending — space frees up when the operation drops out of the window
		// without which there would be fewer than max of them in it.
		const inWindow = entry.times.filter((t) => now - t < ms);
		if (inWindow.length >= max) {
			waitMs = Math.max(waitMs, inWindow[inWindow.length - max] + ms - now);
		}
	}
	if (waitMs > 0) return { granted: false, waitMs, blockedUntil: null };
	entry.times.push(now);
	return { granted: true, waitMs: 0, blockedUntil: null };
}

// Blocks the key for ms from now (does not shorten a longer existing block); ms <= 0
// cancels the block. Returns the end of the block, or null.
/** @type {Functions.Base.blockRateLimit} */
export function blockRateLimit(entry, ms, now) {
	if (!(ms > 0)) {
		delete entry.blockedUntil;
		return null;
	}
	entry.blockedUntil = Math.max(entry.blockedUntil || 0, now + Math.min(ms, RATE_LIMIT_MAX_KEEP_MS));
	return entry.blockedUntil;
}

// Rules from a module for api.networkRules.set(): only objects with "action" and
// "condition" (and a positive integer "priority"), without the id and anything else — ids
// are assigned by background.js. The content of the action and the condition is checked only by the browser
// (chrome.declarativeNetRequest.updateDynamicRules()).
/** @type {Functions.Base.sanitizeNetworkRules} */
export function sanitizeNetworkRules(rules) {
	return (Array.isArray(rules) ? rules : [])
		.filter((rule) => rule && typeof rule.action === "object" && rule.action && typeof rule.condition === "object" && rule.condition)
		.map((rule) => ({
			...(Number.isInteger(rule.priority) && rule.priority >= 1 ? { priority: rule.priority } : {}),
			action: rule.action,
			condition: rule.condition,
		}));
}

// Which stored rules (NETWORK_RULES_KEY and bulk rules
// from NETWORK_RULES_DB_NAME) should apply in the browser: only modules from the module
// list that are not turned off — the mode from the settings, otherwise the default mode
// stored with the rules (background.js has no module registry). Returns the rules
// per module — first the regular ones (in the storage order), after them the bulk ones — and the status of
// modules whose rules cannot be put into the browser.
//
// Priority layers: bulk rules have priority 1 to
// NETWORK_RULES_BULK_MAX_PRIORITY (higher ones are lowered), regular rules are shifted
// above them (+ NETWORK_RULES_BULK_MAX_PRIORITY, their order among themselves does not change).
// An exception of bulk rules (allow, allowAllRequests) thus cancels only rules
// of the bulk layer — not redirects or header changes of other modules.
// Bulk rules the browser rejected earlier (entry.rejected) are
// skipped; indexes says which module rule each rule in the plan corresponds to.
/** @type {Functions.Base.planNetworkRules} */
export function planNetworkRules(store, settings, moduleNames, bulkStore = {}) {
	/** @type {Types.NetworkRulesPlan} */
	const plan = { groups: [], skipped: {} };
	/** @type {Types.NetworkRulesPlan['groups']} */
	const bulkGroups = [];
	/** @type {Functions.Base.planNetworkRules.accept} */
	const accept = (module, entry) => {
		if (!moduleNames.has(module)) {
			plan.skipped[module] = { active: 0, reason: "notListed" };
			return false;
		}
		const mode = getModuleMode(settings, module, entry && entry.defaultMode);
		if (DISABLED_SPEC.isSatisfiedBy({ mode })) {
			plan.skipped[module] = { active: 0, reason: "disabled" };
			return false;
		}
		return true;
	};
	for (const [module, entry] of Object.entries(store || {})) {
		if (!accept(module, entry)) continue;
		const rules = sanitizeNetworkRules(entry && entry.rules).map((rule) => ({ ...rule, priority: (rule.priority || 1) + NETWORK_RULES_BULK_MAX_PRIORITY }));
		plan.groups.push({ module, rules, bulk: false, indexes: rules.map((_rule, index) => index), dropped: 0, rejected: 0 });
	}
	for (const [module, entry] of Object.entries(bulkStore || {})) {
		if (module in (store || {}) || !accept(module, entry)) continue;
		const rejected = new Set(Array.isArray(entry && entry.rejected) ? entry.rejected : []);
		/** @type {Types.NetworkRule[]} */
		const rules = [];
		/** @type {number[]} */
		const indexes = [];
		sanitizeNetworkRules(entry && entry.rules).forEach((rule, index) => {
			if (rejected.has(index)) return;
			rules.push({ ...rule, priority: Math.min(rule.priority || 1, NETWORK_RULES_BULK_MAX_PRIORITY) });
			indexes.push(index);
		});
		bulkGroups.push({ module, rules, bulk: true, indexes, dropped: 0, rejected: rejected.size });
	}
	plan.groups.push(...bulkGroups);
	return plan;
}

// A module's bulk rules (api.networkRules.set(rules, { bulk: true })):
// a large set derived from lists (an ad blocker), which is put into the browser
// only into the free space. Compared to regular rules:
// - priority at most NETWORK_RULES_BULK_MAX_PRIORITY and regular rules above it
//   (see planNetworkRules()),
// - only as many rules apply as fit into the browser limits after the regular rules
//   (fitNetworkRules()) — rules from the end of the set are skipped
//   (the module orders them from the most important),
// - rules the browser rejects are searched out by background.js and skipped
//   (the rest applies) and remembered with the set,
// - they are stored in IndexedDB (NETWORK_RULES_DB_NAME), not in
//   chrome.storage.local: the set has several MB and every change of
//   chrome.storage.local is broadcast to all pages and content scripts that
//   listen to storage.onChanged. A module backup (api.backup) does not include them —
//   the module derives them again.
export const NETWORK_RULES_BULK_MAX_PRIORITY = 10;
export const NETWORK_RULES_DB_NAME = "networkRules";
const NETWORK_RULES_DB_VERSION = 1;
const NETWORK_RULES_BULK_STORE = "bulk";

// Dynamic rule limits when the browser does not state them (Firefox 157:
// 5000 rules in total, 1000 with a regular expression; Chrome 154 states 30000,
// of which 5000 "unsafe").
export const NETWORK_RULES_DEFAULT_LIMITS = { total: 5000, unsafe: 5000, regex: 1000 };

// The browser's dynamic rule limits (chrome.declarativeNetRequest):
// in total, "unsafe" (redirects, header changes — Chrome counts them separately,
// Firefox does not) and with a regular expression.
/** @type {Functions.Base.networkRulesLimits} */
export function networkRulesLimits(dnr) {
	/** @type {(value: unknown) => number | null} */
	const count = (value) => (typeof value === "number" && value > 0 ? value : null);
	const api = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (dnr || {}));
	const total = count(api.MAX_NUMBER_OF_DYNAMIC_RULES) || count(api.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES) || NETWORK_RULES_DEFAULT_LIMITS.total;
	return {
		total,
		unsafe: count(api.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES) || total,
		regex: count(api.MAX_NUMBER_OF_REGEX_RULES) || NETWORK_RULES_DEFAULT_LIMITS.regex,
	};
}

// A rule Chrome counts toward the "unsafe" limit (everything except block, allow,
// allowAllRequests and upgradeScheme).
/** @type {Functions.Base.isUnsafeNetworkRule} */
export function isUnsafeNetworkRule(rule) {
	return !["block", "allow", "allowAllRequests", "upgradeScheme"].includes(String(rule.action && rule.action.type));
}

// Bulk rules only into the space that remains after the regular rules
// within the browser limits (limits: networkRulesLimits()). From the bulk set,
// rules are taken from the beginning; a rule that would exceed some limit is
// skipped (dropped) and it continues with the next one. Regular rules stay whole —
// when they exceed a limit by themselves, the browser rejects them as before.
/** @type {Functions.Base.fitNetworkRules} */
export function fitNetworkRules(groups, limits) {
	let total = 0;
	let unsafe = 0;
	let regex = 0;
	/** @type {(rule: Types.NetworkRule) => void} */
	const add = (rule) => {
		total += 1;
		if (isUnsafeNetworkRule(rule)) unsafe += 1;
		if (rule.condition && rule.condition.regexFilter) regex += 1;
	};
	for (const group of groups) if (!group.bulk) group.rules.forEach(add);
	return groups.map((group) => {
		if (!group.bulk) return group;
		/** @type {Types.NetworkRule[]} */
		const rules = [];
		/** @type {number[]} */
		const indexes = [];
		let dropped = 0;
		group.rules.forEach((rule, i) => {
			const fits =
				total < limits.total &&
				(!isUnsafeNetworkRule(rule) || unsafe < limits.unsafe) &&
				(!(rule.condition && rule.condition.regexFilter) || regex < limits.regex);
			if (!fits) {
				dropped += 1;
				return;
			}
			add(rule);
			rules.push(rule);
			indexes.push(group.indexes[i]);
		});
		return { ...group, rules, indexes, dropped };
	});
}

/** @type {Promise<IDBDatabase> | null} */
let networkRulesDbPromise = null;

// Database of bulk rules (module name → Types.NetworkRulesBulkEntry).
// Extension pages and background.js have the same origin, and thus the same
// IndexedDB.
/** @type {Functions.Base.openNetworkRulesDb} */
function openNetworkRulesDb() {
	if (!networkRulesDbPromise) {
		networkRulesDbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(NETWORK_RULES_DB_NAME, NETWORK_RULES_DB_VERSION);
			request.onerror = () => {
				networkRulesDbPromise = null;
				reject(request.error);
			};
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(NETWORK_RULES_BULK_STORE)) request.result.createObjectStore(NETWORK_RULES_BULK_STORE);
			};
			request.onsuccess = () => {
				const db = request.result;
				const reset = () => {
					networkRulesDbPromise = null;
				};
				db.onclose = reset;
				db.onversionchange = () => {
					db.close();
					reset();
				};
				resolve(db);
			};
		});
	}
	return networkRulesDbPromise;
}

// One request on the bulk rule storage; resolves when the transaction
// completes.
/** @type {Functions.Base.bulkNetworkRulesRequest} */
async function bulkNetworkRulesRequest(mode, work) {
	const db = await openNetworkRulesDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(NETWORK_RULES_BULK_STORE, mode);
		const request = work(tx.objectStore(NETWORK_RULES_BULK_STORE));
		tx.oncomplete = () => resolve(request.result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
	});
}

// Bulk rules of all modules (module name → record).
/** @type {Functions.Base.readBulkNetworkRules} */
export async function readBulkNetworkRules() {
	const db = await openNetworkRulesDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(NETWORK_RULES_BULK_STORE, "readonly");
		const store = tx.objectStore(NETWORK_RULES_BULK_STORE);
		const keys = store.getAllKeys();
		const values = store.getAll();
		tx.oncomplete = () => {
			/** @type {Types.NetworkRulesBulkStore} */
			const result = {};
			keys.result.forEach((key, i) => {
				if (typeof key === "string" && values.result[i] && typeof values.result[i] === "object") result[key] = values.result[i];
			});
			resolve(result);
		};
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
	});
}

// Bulk rules of one module (null = none).
/** @type {Functions.Base.readBulkNetworkRulesOf} */
export async function readBulkNetworkRulesOf(module) {
	const entry = await bulkNetworkRulesRequest("readonly", (store) => store.get(module));
	return entry && typeof entry === "object" ? /** @type {Types.NetworkRulesBulkEntry} */ (entry) : null;
}

// Writes the module's bulk rules (null = deletes them).
/** @type {Functions.Base.writeBulkNetworkRules} */
export async function writeBulkNetworkRules(module, entry) {
	if (entry) await bulkNetworkRulesRequest("readwrite", (store) => store.put(entry, module));
	else await bulkNetworkRulesRequest("readwrite", (store) => store.delete(module));
}

// Do exactly these rules already apply in the browser (the same ids in the same order)?
// The browser returns rules completed with default values, so only what is in
// the requested rule is compared.
/** @type {Functions.Base.networkRulesMatch} */
export function networkRulesMatch(current, desired) {
	/** @type {(want: unknown, have: unknown) => boolean} */
	const contains = (want, have) => {
		if (Array.isArray(want)) {
			return Array.isArray(have) && want.length === have.length && want.every((item, i) => contains(item, have[i]));
		}
		if (want && typeof want === "object") {
			if (!have || typeof have !== "object") return false;
			const haveRecord = /** @type {Record<string, unknown>} */ (have);
			return Object.entries(want).every(([key, value]) => value === undefined || contains(value, haveRecord[key]));
		}
		return want === have;
	};
	const sorted = [...current].sort((a, b) => a.id - b.id);
	return sorted.length === desired.length && desired.every((rule, i) => contains(rule, sorted[i]));
}

/** @type {Functions.Base.registerModule} */
export function registerModule(moduleDef) {
	const { errors, warnings } = validateModule(moduleDef);
	if (errors.length > 0) {
		console.error(
			`Modul "${moduleDef.name}" selže validaci:\n` +
				errors.map((e) => `  - ${e}`).join("\n")
		);
	}
	if (warnings.length > 0) {
		console.warn(
			`Modul "${moduleDef.name}":\n` + warnings.map((w) => `  - ${w}`).join("\n")
		);
	}
	globalThis.__extensionModules.push(moduleDef);
}

// Names of modules whose background part is already registered (see
// registerBackgroundScript() below) — filled only in background.js.
/** @type {Set<string>} */
const registeredBackgroundScripts = new Set();

// --- Services of background parts (api.services) ---
//
// A module's background part can do a function of the catalog of uploaded modules itself, as its
// service: api.services.provide(name, handler) in setup(). The core then runs the function in
// background.js, with the code and the permissions of the module — for an extension page of this
// extension (callModuleService(), MODULE_SERVICE_MESSAGE: the catalog entry of the function asks for
// it) and, when this extension is a client of a service provider, for the pages of the provider
// (see "Modules from other extensions" below). tabGroups offers the functions of its overview and of
// its settings this way (tabGroups.*). The handler gets the arguments of the module and what the page
// says about itself (Types.ModuleServiceContext) — the background part cannot ask the page.
//
// Service name → the module whose background part does it and its handler. Filled only in background.js.
/** @type {Map<string, Types.BackgroundService>} */
const backgroundServices = new Map();

// Extension page → background.js: run a service of a background part (callModuleService()). Only from
// an extension page of this extension (background.js checks the sender).
export const MODULE_SERVICE_MESSAGE = "MODULE_SERVICE_CALL";

/** @type {Functions.Base.provideBackgroundService} */
function provideBackgroundService(moduleName, name, handler) {
	if (typeof name !== "string" || !SANDBOX_CAPABILITY_NAME_RE.test(name)) throw new Error(`Neplatné jméno služby modulu "${moduleName}": ${String(name)}`);
	const existing = backgroundServices.get(name);
	if (existing && existing.moduleName !== moduleName) throw new Error(`Službu "${name}" už nabízí modul "${existing.moduleName}".`);
	/** @type {Types.BackgroundService} */
	const service = { moduleName, handler };
	backgroundServices.set(name, service);
	return () => {
		if (backgroundServices.get(name) === service) backgroundServices.delete(name);
	};
}

// The services the background parts of this extension offer (their names). Only background.js runs them (a page
// that registered one would never be asked).
/** @type {Functions.Base.listBackgroundServices} */
export function listBackgroundServices() {
	return [...backgroundServices.keys()].sort();
}

// Runs a service of a background part (background.js): its answer, or its error. An unknown name is an error.
/** @type {Functions.Base.runBackgroundService} */
export async function runBackgroundService(name, args, context) {
	const service = typeof name === "string" ? backgroundServices.get(name) : undefined;
	if (!service || !service.handler) throw new Error(t("core_service_unknown", String(name)));
	return service.handler(Array.isArray(args) ? args : [], context);
}

// What a page says about itself to a service (Types.ModuleServiceContext without "from"): its window (null
// where the page cannot tell — the floating window has no chrome.windows), the UI language and the surface.
/** @type {Functions.Base.moduleServiceContext} */
export async function moduleServiceContext(location) {
	/** @type {number | null} */
	let windowId = null;
	try {
		if (typeof chrome.windows?.getCurrent === "function") windowId = (await chrome.windows.getCurrent()).id ?? null;
	} catch {
		// Without a window the service decides itself (the tab of the sender, or nothing).
	}
	return { windowId, language: getUiLanguage(), location: location ?? null };
}

// The context of a service request as it came in a message — only the known fields, each checked.
/** @type {Functions.Base.normalizeServiceContext} */
export function normalizeServiceContext(value, from) {
	const input = isPlainObject(value) ? value : {};
	return {
		windowId: Number.isInteger(input.windowId) ? /** @type {number} */ (input.windowId) : null,
		language: typeof input.language === "string" && input.language.length <= 16 ? input.language : getUiLanguage(),
		location: typeof input.location === "string" && input.location.length <= 32 ? input.location : null,
		from,
	};
}

// A service of a background part of this extension from an extension page: the answer, or the error the
// module gets (the text of the error of the handler).
/** @type {Functions.Base.callModuleService} */
export async function callModuleService(name, args, location) {
	const context = await moduleServiceContext(location);
	const response = /** @type {unknown} */ (await sendToBackground({ type: MODULE_SERVICE_MESSAGE, name, args: Array.isArray(args) ? args : [], context }));
	if (!isPlainObject(response)) throw new Error(t("core_service_no_answer", name));
	if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : t("core_service_no_answer", name));
	return response.value;
}

// --- Services of other modules (api.services.use(), api.services.call()) ---
//
// A module can use a service of the background part of another module (contactsModule asks bookmarkChecker which of its
// categories a web address is in — bookmarkChecker.categories) wherever that module runs: in this extension, in a
// client of this extension that runs the module instead of it, or in the service provider of this extension (and
// through it in another of its clients) — see "Modules from other extensions" below. The module says so in setup() of
// its background part (api.services.use(name, about) — a client tells its provider in its registration, the user allows
// it with the client) and calls the service from its background part or from its pages (api.services.call(name,
// args) — always through background.js, MODULE_SERVICE_ROUTE_MESSAGE, which finds where it runs: routeModuleService()).
// No module offers it anywhere → the call fails (core_service_unavailable) and the module works without it. No file of
// the other module is imported — a standalone extension does not have it.
//
// Service name → why the modules of this extension use it (their texts — read when the client registers). Filled only
// in background.js.
/** @type {Map<string, Types.UsedService>} */
const usedServices = new Map();

// An extension page or a background part of this extension → background.js: a service of another module, wherever it
// runs (callRoutedModuleService()). Only from this extension (background.js checks the sender).
export const MODULE_SERVICE_ROUTE_MESSAGE = "MODULE_SERVICE_ROUTE";

// api.services.use(): the module uses the service (about — why, a text or a function giving it in the UI language);
// returns a function to withdraw it.
/** @type {Functions.Base.useModuleService} */
function useModuleService(moduleName, name, about) {
	if (typeof name !== "string" || !SANDBOX_CAPABILITY_NAME_RE.test(name)) throw new Error(`Neplatné jméno služby, kterou modul "${moduleName}" používá: ${String(name)}`);
	/** @type {Types.UsedService} */
	const used = { moduleName, about };
	usedServices.set(name, used);
	return () => {
		if (usedServices.get(name) === used) usedServices.delete(name);
	};
}

// The services the modules of this extension use (api.services.use()) with why — for the registration of a client.
/** @type {Functions.Base.listUsedServices} */
export function listUsedServices() {
	return [...usedServices]
		.map(([name, used]) => {
			let about = "";
			try {
				about = typeof used.about === "function" ? used.about() : String(used.about ?? "");
			} catch {
				// Without its text — the name says it.
			}
			return { name, about: (about || name).slice(0, EXTENSION_SERVICE_MAX_TEXT) };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

// api.services.call(): a service of another module wherever it runs (routeModuleService() in background.js) — the answer,
// or the error (the module is nowhere, the other extension did not answer, the handler failed).
/** @type {Functions.Base.callRoutedModuleService} */
export async function callRoutedModuleService(name, args, location) {
	const context = await moduleServiceContext(location);
	const response = /** @type {unknown} */ (await sendToBackground({ type: MODULE_SERVICE_ROUTE_MESSAGE, name, args: Array.isArray(args) ? args : [], context }));
	if (!isPlainObject(response)) throw new Error(t("core_service_no_answer", name));
	if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : t("core_service_no_answer", name));
	return response.value;
}

// A module's background part — code that runs in background.js (a service worker in
// Chrome, a background script in Firefox), i.e. even without an open extension
// page: listeners of browser events (chrome.tabs, chrome.alarms, ...)
// the module should react to even when neither the popup nor the side panel is open.
// The file modules/<name>/background-script.mjs registers it by calling
// registerBackgroundScript({ name, setup }) on its import. It is imported by
// the single list modules-background.mjs — statically, because Chrome does not allow
// a dynamic import() in a service worker (see background.js).
//
// The core calls setup({ api }) right away, synchronously and in try/catch: a module error thus
// breaks neither background.js nor the background parts of other modules. setup() must register
// chrome.* listeners synchronously, without waiting for await —
// a service worker woken by an event delivers it only to listeners that exist
// after the first pass through the script. That is why they are always registered, even for a turned-off module:
// whether the module should work right now (it is in the module list and not turned off) it
// checks itself in the event handler through api.activation.isActive().
/** @type {Functions.Base.registerBackgroundScript} */
export function registerBackgroundScript(definition) {
	const name = definition && definition.name;
	if (typeof name !== "string" || !name) {
		console.error("registerBackgroundScript(): chybí jméno modulu (name).");
		return;
	}
	if (typeof definition.setup !== "function") {
		console.error(`Background část modulu "${name}" nemá funkci setup().`);
		return;
	}
	if (registeredBackgroundScripts.has(name)) {
		console.error(`Background část modulu "${name}" je zaregistrovaná dvakrát.`);
		return;
	}
	registeredBackgroundScripts.add(name);
	// Its texts (modules/<module>/_locales) — the background part calls loadI18n() before composing a text.
	addModuleI18n(name);
	try {
		// measurePerf: the duration of setup() goes into the module's load measurement (see perf.mjs).
		Promise.resolve(measurePerf(name, "setup", () => definition.setup({ api: createModuleApi(name) }))).catch((err) =>
			console.error(`Chyba v setup() background části modulu "${name}":`, err)
		);
	} catch (err) {
		console.error(`Chyba v setup() background části modulu "${name}":`, err);
	}
}

// Listeners of api.activation.onInstalled() (see createModuleApi()) — background
// parts of modules that should do something after the extension is installed or
// updated (the "install" activation mode, INSTALL_SPEC). Filled only
// in background.js, when importing the background parts.
/** @type {Types.InstalledListener[]} */
const installedListeners = [];

// Calls the api.activation.onInstalled() listeners of all modules. Called by
// background.js from chrome.runtime.onInstalled — only after its own preparation
// (default settings, see BaseController.seedDefaultSettings()), so that the module
// sees the settings ready. A listener cannot register chrome.runtime.onInstalled
// itself: the browser calls the listeners concurrently and would not wait for the
// core's preparation. An error of one module does not break the others.
/** @type {Functions.Base.notifyInstalled} */
export function notifyInstalled(details) {
	for (const { moduleName, handler } of installedListeners) {
		try {
			Promise.resolve(measurePerf(moduleName, "installed", () => handler(details))).catch((err) =>
				console.error(`Chyba v posluchači instalace modulu "${moduleName}":`, err)
			);
		} catch (err) {
			console.error(`Chyba v posluchači instalace modulu "${moduleName}":`, err);
		}
	}
}

// --- Extension notifications (api.notifications) ---
//
// Notifications (Web Notification) that modules show through
// api.notifications.show() are always shown by background.js — from other
// contexts on NOTIFICATION_SHOW_MESSAGE — in a service worker (Chrome) through
// registration.showNotification() (the Notification constructor does not work there), in
// a background page (Firefox) through new Notification(). The core thus knows which
// module sent the notification, and announces each one including its progress to the
// api.notifications.onEvent() listeners in background.js (notificationsCenter
// records it): "create" (the call), "show"/"error" (the result), "click", "close".
//
// Clicks and closing of service worker notifications come as the
// notificationclick/notificationclose events (listenForNotificationEvents() below),
// possibly only after the service worker went to sleep and woke up again — that is why the core carries
// the notification id and the module name right in it: notification.data is an envelope
// { [NOTIFICATION_DATA_KEY]: { uid, module }, data: module data }. In
// Firefox these are events of the Notification instance, which come only while the
// background page runs (a sleeping one does not get them).
const NOTIFICATION_DATA_KEY = "__extensionNotification";
// Properties of the shown notification (as the browser used them — default
// values, absolute icon addresses, the timestamp), which go with the
// "show" event; only those the browser knows.
const NOTIFICATION_PROPERTIES = [
	"title",
	"dir",
	"lang",
	"body",
	"tag",
	"icon",
	"image",
	"badge",
	"vibrate",
	"timestamp",
	"renotify",
	"silent",
	"requireInteraction",
	"data",
	"actions",
];

// A click on a notification of a module — background.js writes it into chrome.storage.local under the
// key "notificationClick.<module>" ({ uid, data, action, at }, Types.NotificationClick) and removes it
// right away (nothing stays stored); api.notifications.onClick() announces the write on the extension
// pages (and to an uploaded module, notifications.onClick) — also where the messages from background.js
// do not come (the floating window's <iframe> in Firefox), and to a module without a background part.
// Not chrome.storage.session: the floating window's <iframe> in Firefox 157 has none (not even its
// changes). One key per module, so a click never overwrites another module's.
export const NOTIFICATION_CLICK_KEY_PREFIX = "notificationClick.";

// Listeners of api.notifications.onEvent() — filled only in background.js,
// where notifications are shown (see above).
/** @type {Types.NotificationListener[]} */
const notificationListeners = [];

// A copy of a value through JSON (FrozenArray, module data, ... as plain
// values); what JSON cannot handle is null.
/** @type {Functions.Base.toJsonCopy} */
function toJsonCopy(value) {
	try {
		const text = JSON.stringify(value);
		return text === undefined ? null : JSON.parse(text);
	} catch {
		return null;
	}
}

/** @type {Functions.Base.describeError} */
export function describeError(err) {
	return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// Notification id and module name from notification.data (the core's envelope, see above);
// null for a notification that did not go through api.notifications.
/** @type {Functions.Base.readNotificationEnvelope} */
function readNotificationEnvelope(data) {
	const envelope = data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data)[NOTIFICATION_DATA_KEY] : null;
	if (!envelope || typeof envelope !== "object") return null;
	const { uid, module } = /** @type {Record<string, unknown>} */ (envelope);
	if (typeof uid !== "string" || typeof module !== "string") return null;
	return { uid, module, data: /** @type {Record<string, unknown>} */ (data).data };
}

/** @type {Functions.Base.readNotificationProperties} */
function readNotificationProperties(notification) {
	/** @type {Record<string, unknown>} */
	const out = {};
	const source = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (notification));
	for (const name of NOTIFICATION_PROPERTIES) {
		try {
			if (!(name in notification)) continue;
			// Module data without the core's envelope.
			out[name] = name === "data" ? readNotificationEnvelope(source.data)?.data : source[name];
		} catch {
			// An unreadable property is skipped.
		}
	}
	return /** @type {Record<string, unknown>} */ (toJsonCopy(out) || {});
}

// The service worker registration through which the notification is shown (only in a service
// worker — Chrome), otherwise null.
/** @type {Functions.Base.getNotificationRegistration} */
function getNotificationRegistration() {
	const { registration } = /** @type {{ registration?: ServiceWorkerRegistration }} */ (/** @type {unknown} */ (globalThis));
	return registration && typeof registration.showNotification === "function" ? registration : null;
}

// Properties of the notification that showNotification() has just shown — the resolved
// promise does not return them, they are looked up through getNotifications() by the id in the envelope.
// null if closed in the meantime.
/** @type {Functions.Base.readShownNotificationProperties} */
async function readShownNotificationProperties(registration, tag, uid) {
	try {
		const shown = await registration.getNotifications(tag ? { tag } : {});
		const notification = shown.find((item) => readNotificationEnvelope(item.data)?.uid === uid);
		return notification ? readNotificationProperties(notification) : null;
	} catch {
		return null;
	}
}

// Announces a notification event to the api.notifications.onEvent() listeners. An error
// of one listener does not break the others. Resolves once the asynchronous listeners
// finish too — the service worker waits for it (event.waitUntil()), so the
// browser does not put it to sleep in the middle of their work.
// A click is also written for api.notifications.onClick() (NOTIFICATION_CLICK_KEY_PREFIX).
/** @type {Functions.Base.emitNotificationEvent} */
function emitNotificationEvent(event) {
	/** @type {Promise<void>[]} */
	const pending = [];
	if (event.type === "click") pending.push(recordNotificationClick(event));
	for (const { moduleName, handler } of notificationListeners) {
		try {
			pending.push(
				Promise.resolve(measurePerf(moduleName, "notification", () => handler(event))).catch((err) =>
					console.error(`Chyba v posluchači oznámení modulu "${moduleName}":`, err)
				)
			);
		} catch (err) {
			console.error(`Chyba v posluchači oznámení modulu "${moduleName}":`, err);
		}
	}
	return Promise.all(pending).then(() => {});
}

// The click for api.notifications.onClick() of the module that sent the notification (written and
// removed right away — the pages get the write as a change of chrome.storage).
/** @type {Functions.Base.recordNotificationClick} */
async function recordNotificationClick(event) {
	const local = typeof chrome !== "undefined" && chrome.storage ? chrome.storage.local : undefined;
	if (!local) return;
	/** @type {Types.NotificationClick} */
	const click = { uid: event.uid, data: toJsonCopy(event.data), action: event.action, at: event.at };
	const key = `${NOTIFICATION_CLICK_KEY_PREFIX}${event.module}`;
	try {
		await local.set({ [key]: click });
		await local.remove(key);
	} catch (err) {
		console.warn(`Kliknutí na oznámení modulu "${event.module}" nejde zapsat:`, err);
	}
}

// Shows a notification of the moduleName module and announces it including its progress (see above).
// Called only by background.js — api.notifications.show() from anywhere leads here
// through NOTIFICATION_SHOW_MESSAGE. In a service worker it resolves once shown and
// a display error rejects it; the Firefox background page reports the result
// only by an event, it resolves right away.
/** @type {Functions.Base.showExtensionNotification} */
export async function showExtensionNotification(moduleName, title, options) {
	const text = String(title);
	/** @type {NotificationOptions} */
	const moduleOptions = options && typeof options === "object" ? { ...options } : {};
	const ids = { uid: crypto.randomUUID(), module: moduleName };
	/** @type {NotificationOptions} */
	const shownOptions = { ...moduleOptions, data: { [NOTIFICATION_DATA_KEY]: ids, data: moduleOptions.data } };
	const registration = getNotificationRegistration();
	const NotificationApi = typeof Notification === "function" ? Notification : null;
	const maxActions = NotificationApi ? Reflect.get(NotificationApi, "maxActions") : undefined;
	const worker = registration ? registration.active || registration.waiting || registration.installing : null;

	emitNotificationEvent({
		type: "create",
		...ids,
		at: Date.now(),
		title: text,
		options: /** @type {Record<string, unknown>} */ (toJsonCopy(moduleOptions) || {}),
		permission: NotificationApi ? NotificationApi.permission : null,
		maxActions: typeof maxActions === "number" ? maxActions : null,
		serviceWorker: registration ? { scope: registration.scope, scriptURL: worker ? worker.scriptURL : null, state: worker ? worker.state : null } : null,
	});

	if (registration) {
		try {
			await registration.showNotification(text, shownOptions);
		} catch (err) {
			emitNotificationEvent({ type: "error", ...ids, at: Date.now(), message: describeError(err) });
			throw err;
		}
		const at = Date.now();
		emitNotificationEvent({ type: "show", ...ids, at, properties: await readShownNotificationProperties(registration, moduleOptions.tag, ids.uid) });
		return;
	}

	if (!NotificationApi) {
		const err = new Error("Notification API není k dispozici");
		emitNotificationEvent({ type: "error", ...ids, at: Date.now(), message: describeError(err) });
		throw err;
	}
	/** @type {Notification} */
	let notification;
	try {
		notification = new NotificationApi(text, shownOptions);
	} catch (err) {
		emitNotificationEvent({ type: "error", ...ids, at: Date.now(), message: describeError(err) });
		throw err;
	}
	notification.addEventListener("show", () => emitNotificationEvent({ type: "show", ...ids, at: Date.now(), properties: readNotificationProperties(notification) }));
	notification.addEventListener("error", () => {
		console.warn(`Prohlížeč oznámení modulu "${moduleName}" nezobrazil:`, text);
		emitNotificationEvent({ type: "error", ...ids, at: Date.now(), message: null });
	});
	notification.addEventListener("click", () => emitNotificationEvent({ type: "click", ...ids, at: Date.now(), action: null, data: toJsonCopy(moduleOptions.data ?? null) }));
	notification.addEventListener("close", () => emitNotificationEvent({ type: "close", ...ids, at: Date.now() }));
}

// Clicks and closing of service worker notifications (Chrome) — background.js must
// register the listeners synchronously on the first pass through the script,
// otherwise a service worker woken by a click would not get them. A notification that
// did not go through api.notifications is skipped. Outside a service worker (Firefox:
// events of the instance, see showExtensionNotification()) it does nothing and returns
// false.
/** @type {Functions.Base.listenForNotificationEvents} */
export function listenForNotificationEvents(scope = globalThis) {
	const { ServiceWorkerGlobalScope: Sw } = /** @type {{ ServiceWorkerGlobalScope?: Function }} */ (/** @type {unknown} */ (scope));
	if (typeof Sw !== "function" || !(scope instanceof Sw)) return false;
	/** @type {Functions.Base.listenForNotificationEvents.relay} */
	const relay = (event, type) => {
		const envelope = readNotificationEnvelope(event.notification && event.notification.data);
		if (!envelope) return;
		const ids = { uid: envelope.uid, module: envelope.module };
		const done = emitNotificationEvent(
			type === "click" ? { type, ...ids, at: Date.now(), action: event.action || null, data: toJsonCopy(envelope.data ?? null) } : { type, ...ids, at: Date.now() }
		);
		try {
			event.waitUntil(done);
		} catch {
			// The event has already finished — the listeners keep working without extending its life.
		}
	};
	scope.addEventListener("notificationclick", (event) => relay(/** @type {Types.ServiceWorkerNotificationEvent} */ (/** @type {unknown} */ (event)), "click"));
	scope.addEventListener("notificationclose", (event) => relay(/** @type {Types.ServiceWorkerNotificationEvent} */ (/** @type {unknown} */ (event)), "close"));
	return true;
}

// Key of one value of a module's own state (api.state in chrome.storage.local,
// api.sessionState in chrome.storage.session, see createModuleApi()) —
// "moduleState.<module>.<key>". Each value has its own storage key, so writing
// one never overwrites another.
/** @type {Functions.Base.getModuleStateKey} */
function getModuleStateKey(moduleName, key) {
	return `moduleState.${moduleName}.${key}`;
}

// Does the moduleSettings key belong to the moduleName module? The activation mode under the bare
// name, custom fields "<module>.<field>" and the same for instances ("<module>#<id>",
// "<module>#<id>.<field>", see getModuleInstanceKey()) — not another module whose
// name just starts the same ("logger" × "loggerX").
/** @type {Functions.Base.isModuleSettingsKey} */
export function isModuleSettingsKey(moduleName, key) {
	const entryKey = key.split(".")[0];
	return entryKey === moduleName || entryKey.startsWith(moduleName + MODULE_INSTANCE_SEPARATOR);
}

// Key of the document a content script runs in — performance.timeOrigin
// (the start of the navigation to this document, ms since the epoch with a fractional part).
// It is a property of the DOCUMENT, not of the script: all content scripts of all
// modules in the same page (even in the MAIN world) see the same number, a new page
// (even a reload) has a different one. Together with tabId it thus unambiguously pairs records
// of different modules from the same visit, without the modules having to know anything
// about each other (see the details contract at registerModule above). Outside a web page
// (popup, sidebar, the floating window's <iframe>, background — all extension
// pages) it makes no sense and returns null.
/** @type {Functions.Base.getDocumentKey} */
export function getDocumentKey() {
	try {
		if (typeof location === "undefined" || typeof performance === "undefined") return null;
		if (location.href.startsWith(chrome.runtime.getURL(""))) return null;
		return typeof performance.timeOrigin === "number" ? performance.timeOrigin : null;
	} catch {
		return null;
	}
}

// The start of this run of the browser (BROWSER_SESSION_START_KEY), or null when it is not known.
/** @type {Functions.Base.readBrowserSessionStart} */
export async function readBrowserSessionStart() {
	const stored = await chrome.storage.local.get(BROWSER_SESSION_START_KEY);
	const value = stored[BROWSER_SESSION_START_KEY];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Domain key — the hostname of the address (without a trailing dot), so each subdomain
// is a separate domain: "sub.domain.cz", "domain.cz" and "www.domain.cz" are
// three different keys (unlike getDomainStorageKey() below, which for the
// floating window trims to the last 3 parts). The URL parser itself converts upper-case
// letters to lower case and international names to punycode, the same as
// location.hostname in the page. Only for http(s) — elsewhere (chrome://, about:,
// file:, an invalid URL) null. background.js computes it when writing each
// record (see api.data.findByDomain()) and the consumer gets it from
// api.tabs.getActive() — no module composes it itself.
/** @type {Functions.Base.getDomainKey} */
export function getDomainKey(url) {
	try {
		// An invalid/missing address (null, undefined) throws a TypeError, which the
		// catch below turns into null — the same as for any other invalid URL.
		const { protocol, hostname } = new URL(/** @type {string} */ (url));
		if (protocol !== "http:" && protocol !== "https:") return null;
		return hostname.replace(/\.$/, "") || null;
	} catch {
		return null;
	}
}

// An api.data record from a backup file (BaseStorage.importEntries()) in the shape
// in which background.js stores it — only known fields with the right type, without the id
// and the module name. The file may have been created elsewhere or edited by someone: a missing
// time is filled in, the domain can be computed from the address. null for what is not an object.
/** @type {Functions.Base.sanitizeBackupRecord} */
export function sanitizeBackupRecord(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const input = /** @type {Record<string, unknown>} */ (value);
	const url = typeof input.url === "string" ? input.url : null;
	const domainKey = typeof input.domainKey === "string" && input.domainKey !== "" ? input.domainKey : getDomainKey(url);
	return {
		payload: input.payload,
		timestamp: typeof input.timestamp === "number" && Number.isFinite(input.timestamp) ? input.timestamp : Date.now(),
		tabId: typeof input.tabId === "number" ? input.tabId : null,
		url,
		...(typeof input.documentKey === "number" && Number.isFinite(input.documentKey) ? { documentKey: input.documentKey } : {}),
		...(domainKey ? { domainKey } : {}),
		...(typeof input.recordKey === "string" && input.recordKey !== "" ? { recordKey: input.recordKey } : {}),
	};
}

// Address schemes into which the browser injects extension content scripts
// (file: only when the user allows the extension access to files — otherwise the browser
// does not reveal its address at all, see WebPageSpecification).
const WEB_PAGE_PROTOCOLS = ["http:", "https:", "file:"];

// Add-on stores and browser accounts — the browser does not inject extension scripts
// there, even when they have access to all pages (<all_urls>). Host and
// start of the path. Firefox: the default value of the preference
// extensions.webextensions.restrictedDomains (verified in Firefox 156).
/** @type {Types.RestrictedPage[]} */
const CHROMIUM_RESTRICTED_PAGES = [
	{ host: "chromewebstore.google.com", path: "/" },
	{ host: "chrome.google.com", path: "/webstore" },
	{ host: "microsoftedge.microsoft.com", path: "/addons" },
];
/** @type {Types.RestrictedPage[]} */
const FIREFOX_RESTRICTED_PAGES = [
	"accounts-static.cdn.mozilla.net",
	"accounts.firefox.com",
	"addons.cdn.mozilla.net",
	"addons.mozilla.org",
	"api.accounts.firefox.com",
	"content.cdn.mozilla.net",
	"discovery.addons.mozilla.org",
	"oauth.accounts.firefox.com",
	"profile.accounts.firefox.com",
	"support.mozilla.org",
	"sync.services.mozilla.com",
].map((host) => ({ host, path: "/" }));

// Does the extension run in Firefox? By the scheme of its own address (moz-extension://) —
// not by the existence of an API, which differs between contexts (the floating window's
// <iframe> has no chrome.sidebarAction even in Firefox).
// The id of the extension as a watermark in the lower left corner of the page (options, sidebar) — the host of
// the extension's own address: the 32-character id in Chrome, the random UUID of the installation in Firefox
// (there chrome.runtime.id is the add-on id from the manifest, not the one in the address).
/** @type {Functions.Base.mountExtensionIdWatermark} */
export function mountExtensionIdWatermark() {
	const mark = document.createElement("div");
	mark.className = "extension-id-watermark";
	mark.setAttribute("aria-hidden", "true");
	mark.textContent = location.host;
	document.body.append(mark);
}

/** @type {Functions.Base.isFirefox} */
export function isFirefox() {
	try {
		return chrome.runtime.getURL("").startsWith("moz-extension:");
	} catch {
		return false;
	}
}

// The extension itself for a module: its name in the UI language (a standalone extension built from
// a module has its own) and the version from the manifest. An uploaded module gets the same thing
// with its context (the sandbox page has no chrome.runtime, see createSandboxContext()).
/** @type {Functions.Base.getExtensionInfo} */
export function getExtensionInfo() {
	const manifest = globalThis.chrome?.runtime?.getManifest?.();
	const name = t("extension_name");
	return {
		name: name !== "extension_name" ? name : String(manifest?.name ?? ""),
		version: String(manifest?.version ?? ""),
	};
}

// A regular web page that module content scripts can work with — not
// a special browser page (chrome://, about:, new tab, view-source:,
// extension pages, add-on store, ...), where the browser does not inject extension
// scripts. A missing or invalid address = false. The decision whether a module
// is shown at all is WEB_PAGE_SPEC below — this is the address test itself, e.g.
// before chrome.scripting.executeScript().
/** @type {Functions.Base.isWebPageUrl} */
export function isWebPageUrl(url) {
	/** @type {URL} */
	let parsed;
	try {
		// A missing address (undefined, null) throws a TypeError the same as an invalid one.
		parsed = new URL(/** @type {string} */ (url));
	} catch {
		return false;
	}
	if (!WEB_PAGE_PROTOCOLS.includes(parsed.protocol)) return false;
	const restricted = isFirefox() ? FIREFOX_RESTRICTED_PAGES : CHROMIUM_RESTRICTED_PAGES;
	return !restricted.some(({ host, path }) => parsed.hostname === host && parsed.pathname.startsWith(path));
}

// Returns the definitions of all modules registered so far (a shallow copy — the caller
// cannot accidentally damage the shared registry). The only read of "who is
// registered and what they declared about themselves" — used mainly by the
// extensionPermissionsManager module (see its usesPermissions) to find out which modules
// declare an interest in a given optional permission, without (unlike
// options.mjs) having to import the module files through BaseController itself.
// The data in the return value is exactly what each module itself chose to
// publish in registerModule() — it is not a peek into anything hidden.
/** @type {Functions.Base.getRegisteredModules} */
export function getRegisteredModules() {
	return (globalThis.__extensionModules || []).map((m) => ({ ...m }));
}

/** @type {Functions.Base.validateModule} */
function validateModule(moduleDef) {
	/** @type {string[]} */
	const errors = [];
	/** @type {string[]} */
	const warnings = [];

	if (!moduleDef || typeof moduleDef !== "object") {
		errors.push("moduleDef není objekt");
		return { errors, warnings };
	}

	if (!moduleDef.name || typeof moduleDef.name !== "string") {
		errors.push("chybí nebo neplatný 'name'");
	}

	if (!moduleDef.tag || typeof moduleDef.tag !== "string") {
		errors.push("chybí nebo neplatný 'tag'");
	} else {
		if (!moduleDef.tag.includes("-") || moduleDef.tag !== moduleDef.tag.toLowerCase()) {
			errors.push(
				`'tag' (${moduleDef.tag}) není platný custom element tag (musí obsahovat pomlčku a být lowercase)`
			);
		}

		if (typeof customElements !== "undefined") {
			// The class registered under the tag is not verified yet — hence only the shape
			// "has a prototype", whose init() and inheritance are checked below.
			const klass = /** @type {{ prototype: { init?: unknown } } | undefined} */ (customElements.get(moduleDef.tag));
			if (!klass) {
				errors.push(
					`custom element '${moduleDef.tag}' nebyl vytvořen pomocí customElements.define()`
				);
			} else {
				if (typeof klass.prototype.init !== "function") {
					errors.push(
						`třída pro '${moduleDef.tag}' nemá metodu 'init()' — modul musí implementovat init()`
					);
				}
				if (!(klass.prototype instanceof BaseElement)) {
					errors.push(
						`třída pro '${moduleDef.tag}' nevlastní od BaseElement`
					);
				}
			}
		}
	}

	if (
		moduleDef.activationSpec !== undefined &&
		!(moduleDef.activationSpec instanceof Specification)
	) {
		errors.push(
			`'activationSpec' modulu "${moduleDef.name}" musí být instancí Specification`
		);
	}

	if (moduleDef.details !== undefined) {
		if (!moduleDef.details || typeof moduleDef.details !== "object" || Array.isArray(moduleDef.details)) {
			errors.push(`'details' modulu "${moduleDef.name}" musí být objekt { úroveň: funkce }`);
		} else {
			for (const [scope, provider] of Object.entries(moduleDef.details)) {
				if (!DETAILS_SCOPES.includes(scope)) {
					errors.push(
						`'details.${scope}' modulu "${moduleDef.name}" není známá úroveň; povolené: ${DETAILS_SCOPES.join(", ")}`
					);
				} else if (typeof provider !== "function") {
					errors.push(`'details.${scope}' modulu "${moduleDef.name}" musí být funkce`);
				}
			}
		}
	}
	if (moduleDef.urlDetails !== undefined) {
		warnings.push(`'urlDetails' modulu "${moduleDef.name}" se už nepoužívá — patří do details.visit`);
	}

	// settingsSchema (settings of the whole module) and instanceSettingsSchema
	// (settings of each instance, see multiInstance below) have the same shape.
	for (const schemaName of /** @type {const} */ (["settingsSchema", "instanceSettingsSchema"])) {
		const schema = moduleDef[schemaName];
		if (schema === undefined) continue;
		if (!Array.isArray(schema)) {
			errors.push(`'${schemaName}' modulu "${moduleDef.name}" musí být pole`);
			continue;
		}
		schema.forEach((field, i) => {
			if (!field || typeof field.key !== "string" || !field.key) {
				errors.push(`${schemaName}[${i}] modulu "${moduleDef.name}" nemá platný 'key'`);
			}
			if (!SETTING_FIELD_TYPES.includes(field?.type)) {
				errors.push(
					`${schemaName}[${i}] ("${field?.key}") modulu "${moduleDef.name}" má neplatný 'type' (${field?.type}); povolené: ${SETTING_FIELD_TYPES.join(", ")}`
				);
			}
			if (!field || typeof field.label !== "string" || !field.label) {
				errors.push(`${schemaName}[${i}] ("${field?.key}") modulu "${moduleDef.name}" nemá 'label'`);
			}
			if (field?.type === "custom" && typeof field.render !== "function") {
				errors.push(
					`${schemaName}[${i}] ("${field?.key}") modulu "${moduleDef.name}" je typu 'custom', ale nemá funkci 'render'`
				);
			}
			// A shared field (getSharedSettingKey()): the name of a group, only in settingsSchema and only a simple control —
			// Settings keeps the controls of the modules that share it in step.
			if (field?.shared !== undefined) {
				const simple = field.type !== "custom" && field.type !== "checkboxTable";
				if (schemaName !== "settingsSchema" || !simple || typeof field.shared !== "string" || !SHARED_SETTING_GROUP_RE.test(field.shared)) {
					errors.push(
						`${schemaName}[${i}] ("${field.key}") modulu "${moduleDef.name}" má neplatné 'shared' — jméno skupiny (${SHARED_SETTING_GROUP_RE}), jen v settingsSchema a ne u typu 'custom' ani 'checkboxTable'`
					);
				}
			}
			// A table of checkboxes: rows and columns are non-empty lists of { value, label } with
			// different values (the keys of the stored table).
			if (field?.type === "checkboxTable") {
				for (const part of /** @type {const} */ (["rows", "columns"])) {
					const items = /** @type {unknown} */ (field[part]);
					const valid =
						Array.isArray(items) &&
						items.length > 0 &&
						items.every((item) => isPlainObject(item) && typeof item.value === "string" && item.value !== "" && typeof item.label === "string" && item.label !== "") &&
						new Set(items.map((item) => item.value)).size === items.length;
					if (!valid) {
						errors.push(
							`${schemaName}[${i}] ("${field.key}") modulu "${moduleDef.name}" je typu 'checkboxTable', ale '${part}' není neprázdné pole { value, label } s různými 'value'`
						);
					}
				}
			}
		});
	}

	// Multiple instances (see MODULE_INSTANCE_SEPARATOR) — yes/no.
	// Without them instanceSettingsSchema has nowhere to be rendered.
	if (moduleDef.version !== undefined && (typeof moduleDef.version !== "string" || !/^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){0,3}$/.test(moduleDef.version))) {
		errors.push(`'version' modulu "${moduleDef.name}" musí být 1 až 4 čísla oddělená tečkou (např. "1.0.3")`);
	}
	if (moduleDef.settingsView !== undefined && typeof moduleDef.settingsView !== "boolean") {
		errors.push(`'settingsView' modulu "${moduleDef.name}" musí být true/false`);
	}
	// The module whose settings view edits this module's settings (tabGroups ← tabGroupsSandbox) — the reset of its
	// settings block resets them too (resetModule()). A module from the package declares it about itself, an uploaded
	// module cannot (sandbox.js does not pass it) — it would make the reset of its block wipe another module.
	if (moduleDef.settingsEditedBy !== undefined) {
		if (typeof moduleDef.settingsEditedBy !== "string" || !moduleDef.settingsEditedBy) {
			errors.push(`'settingsEditedBy' modulu "${moduleDef.name}" musí být jméno modulu`);
		} else if (moduleDef.settingsEditedBy === moduleDef.name) {
			errors.push(`'settingsEditedBy' modulu "${moduleDef.name}" nemůže odkazovat na modul samotný`);
		}
	}
	if (moduleDef.multiInstance !== undefined && typeof moduleDef.multiInstance !== "boolean") {
		errors.push(`'multiInstance' modulu "${moduleDef.name}" musí být true/false`);
	}
	if (moduleDef.instanceSettingsSchema !== undefined && moduleDef.multiInstance !== true) {
		warnings.push(`'instanceSettingsSchema' modulu "${moduleDef.name}" se použije jen s multiInstance: true`);
	}

	// An optional declaration of which optional permissions (see PAGE_ACCESS_PERMISSIONS,
	// api.permissions) the module may request at runtime — an array of objects in the shape of
	// chrome.permissions.request() ({ permissions, origins }), i.e. typically
	// [PAGE_ACCESS_PERMISSIONS] or [{ permissions: ["scripting"] }]. It is read by
	// the extensionPermissionsManager module (through getRegisteredModules()), which shows for
	// each permission which modules need it by their own declaration —
	// regardless of whether they have really requested it yet (that is reported only by
	// api.permissions.request() into PERMISSION_ACTIVITY_KEY, see below).
	if (moduleDef.usesPermissions !== undefined) {
		if (!Array.isArray(moduleDef.usesPermissions)) {
			errors.push(`'usesPermissions' modulu "${moduleDef.name}" musí být pole`);
		} else {
			moduleDef.usesPermissions.forEach((p, i) => {
				const hasPermissions = Array.isArray(p?.permissions);
				const hasOrigins = Array.isArray(p?.origins);
				if (!p || typeof p !== "object" || (!hasPermissions && !hasOrigins)) {
					errors.push(
						`usesPermissions[${i}] modulu "${moduleDef.name}" musí mít pole 'permissions' a/nebo 'origins' (tvar jako chrome.permissions.request())`
					);
				}
			});
		}
	}

	// An optional declaration of dependencies on other modules — an array of { module, reason }
	// (the module name and a short sentence why it needs it). The core does not turn anything
	// on or enforce anything based on it, the Settings page just shows it for both modules
	// (what the module depends on / who depends on it).
	if (moduleDef.dependsOn !== undefined) {
		if (!Array.isArray(moduleDef.dependsOn)) {
			errors.push(`'dependsOn' modulu "${moduleDef.name}" musí být pole`);
		} else {
			moduleDef.dependsOn.forEach((d, i) => {
				if (!d || typeof d !== "object" || typeof d.module !== "string" || !d.module || typeof d.reason !== "string") {
					errors.push(`dependsOn[${i}] modulu "${moduleDef.name}" musí být { module: "jméno modulu", reason: "proč" }`);
				} else if (d.module === moduleDef.name) {
					errors.push(`dependsOn[${i}] modulu "${moduleDef.name}" nemůže odkazovat na modul samotný`);
				}
			});
		}
	}

	// An optional declaration of a consumer of the details contract — the levels the module
	// collects through api.details.collect(). The Settings page shows for them which
	// modules it takes data from (and for providers, who reads their data).
	if (moduleDef.consumesDetails !== undefined) {
		if (!Array.isArray(moduleDef.consumesDetails)) {
			errors.push(`'consumesDetails' modulu "${moduleDef.name}" musí být pole`);
		} else {
			moduleDef.consumesDetails.forEach((scope, i) => {
				if (typeof scope !== "string" || !DETAILS_SCOPES.includes(scope)) {
					errors.push(
						`consumesDetails[${i}] modulu "${moduleDef.name}" není známá úroveň; povolené: ${DETAILS_SCOPES.join(", ")}`
					);
				}
			});
		}
	}

	// Optional custom CSS of the module element (see BaseController.loadModuleStyles)
	// — an array of ABSOLUTE addresses. A relative path would be resolved against the page
	// the element is currently rendered on (popup.html, ...), not against the module
	// folder, so new URL("./file.css", import.meta.url).href is required.
	if (moduleDef.styles !== undefined) {
		if (!Array.isArray(moduleDef.styles)) {
			errors.push(`'styles' modulu "${moduleDef.name}" musí být pole`);
		} else {
			moduleDef.styles.forEach((href, i) => {
				if (typeof href !== "string" || !URL.canParse(href)) {
					errors.push(
						`styles[${i}] modulu "${moduleDef.name}" musí být absolutní adresa — new URL("./soubor.css", import.meta.url).href`
					);
				}
			});
		}
	}

	// The module's own default values for the activation mode, output locations and
	// output element (see getModuleMode/getModuleDisplayLocations/
	// getModuleOutputElement/getModuleShowHeading) — all of them are optional.
	// Not declaring them is not an error, the module is just warned about it (it keeps working,
	// the global default value is used); an invalid declared value is already
	// an error, because the module evidently tried and just made a mistake.
	if (moduleDef.defaultActivationMode === undefined) {
		warnings.push(
			`nedeklaruje 'defaultActivationMode' — použije se globální výchozí "${DEFAULT_MODE}"`
		);
	} else if (!ACTIVATION_MODES.some((m) => m.value === moduleDef.defaultActivationMode)) {
		errors.push(
			`'defaultActivationMode' (${moduleDef.defaultActivationMode}) modulu "${moduleDef.name}" není platná hodnota; povolené: ${ACTIVATION_MODES.map((m) => m.value).join(", ")}`
		);
	}

	if (moduleDef.defaultDisplayLocation === undefined) {
		warnings.push(
			`nedeklaruje 'defaultDisplayLocation' — použije se globální výchozí "${DEFAULT_DISPLAY_LOCATION}"`
		);
	} else if (
		parseDisplayLocations(moduleDef.defaultDisplayLocation) === null ||
		// Stored settings skip an unknown location in the array (see
		// parseDisplayLocations()), in a module declaration it is a typo.
		(Array.isArray(moduleDef.defaultDisplayLocation) &&
			!moduleDef.defaultDisplayLocation.every((location) => DISPLAY_LOCATIONS.some((l) => l.value === location)))
	) {
		errors.push(
			`'defaultDisplayLocation' (${JSON.stringify(moduleDef.defaultDisplayLocation)}) modulu "${moduleDef.name}" není platná hodnota; povolené: jedno místo (${DISPLAY_LOCATIONS.map((l) => l.value).join(", ")}), pole míst, nebo "${NO_DISPLAY_LOCATION}" (nikde)`
		);
	}

	if (moduleDef.defaultOutputElement === undefined) {
		warnings.push(
			`nedeklaruje 'defaultOutputElement' — použije se globální výchozí "${DEFAULT_OUTPUT_ELEMENT}"`
		);
	} else if (!OUTPUT_ELEMENTS.some((e) => e.value === moduleDef.defaultOutputElement)) {
		errors.push(
			`'defaultOutputElement' (${moduleDef.defaultOutputElement}) modulu "${moduleDef.name}" není platná hodnota; povolené: ${OUTPUT_ELEMENTS.map((e) => e.value).join(", ")}`
		);
	}

	if (moduleDef.defaultShowHeading === undefined) {
		warnings.push(
			`nedeklaruje 'defaultShowHeading' — použije se globální výchozí ${DEFAULT_SHOW_HEADING}`
		);
	} else if (typeof moduleDef.defaultShowHeading !== "boolean") {
		errors.push(`'defaultShowHeading' modulu "${moduleDef.name}" musí být true/false`);
	}

	// An optional function for the whole extension page, not just for the module element
	// — see BaseController.runPageInits().
	if (moduleDef.pageInit !== undefined && typeof moduleDef.pageInit !== "function") {
		errors.push(`'pageInit' modulu "${moduleDef.name}" musí být funkce`);
	}

	// An optional backup of data the module keeps outside api.* (its own IndexedDB) —
	// see api.backup.exportModule()/importModule(); reset() deletes them (resetModule()).
	const backupData = /** @type {{ export?: unknown; import?: unknown; reset?: unknown } | null | undefined} */ (moduleDef.backupData);
	if (backupData !== undefined && (!backupData || typeof backupData.export !== "function" || typeof backupData.import !== "function")) {
		errors.push(`'backupData' modulu "${moduleDef.name}" musí být objekt s funkcemi export() a import()`);
	} else if (backupData && backupData.reset !== undefined && typeof backupData.reset !== "function") {
		errors.push(`'backupData.reset' modulu "${moduleDef.name}" musí být funkce`);
	}

	// Functions outside the sandbox an uploaded module asks for (see SANDBOX_CAPABILITIES) — the names
	// only; whether the core offers them, the upload reports (installSandboxContent()).
	if (moduleDef.capabilities !== undefined) {
		const capabilities = /** @type {unknown} */ (moduleDef.capabilities);
		if (!Array.isArray(capabilities)) {
			errors.push(`'capabilities' modulu "${moduleDef.name}" musí být pole jmen funkcí (např. ["tabs.create"])`);
		} else {
			if (capabilities.length > SANDBOX_MAX_CAPABILITIES) {
				errors.push(`'capabilities' modulu "${moduleDef.name}" má ${capabilities.length} funkcí, nejvýš ${SANDBOX_MAX_CAPABILITIES}`);
			}
			/** @type {Set<string>} */
			const seen = new Set();
			for (const name of capabilities) {
				if (typeof name !== "string" || name.length > SANDBOX_CAPABILITY_MAX_NAME || !SANDBOX_CAPABILITY_NAME_RE.test(name)) {
					errors.push(`'capabilities' modulu "${moduleDef.name}": ${JSON.stringify(name)} není jméno funkce ve tvaru "oblast.metoda" (např. "tabs.create")`);
				} else if (seen.has(name)) {
					errors.push(`'capabilities' modulu "${moduleDef.name}" uvádí "${name}" dvakrát`);
				}
				if (typeof name === "string") seen.add(name);
			}
			if (!moduleDef.sandbox) {
				warnings.push(`'capabilities' má smysl jen u nahraného modulu (sandbox) — modul z balíčku volá API prohlížeče sám`);
			}
		}
	}

	// The configuration of the core's filters an uploaded module declares instead of setting it from its element
	// (DECLARED_FILTERS, getDeclaredFiltersConfig()) — by the rules of the function that sets it, and the module must
	// ask for that function: the core applies the declaration under it (the user's decision about it applies).
	for (const { key, capability, normalize } of DECLARED_FILTERS) {
		const config = moduleDef[key];
		if (config === undefined) continue;
		if (!moduleDef.sandbox) {
			warnings.push(`'${key}' má smysl jen u nahraného modulu (sandbox) — modul z balíčku nastavuje prohlížeč sám`);
			continue;
		}
		const capabilities = Array.isArray(moduleDef.capabilities) ? /** @type {unknown[]} */ (moduleDef.capabilities) : [];
		if (!capabilities.includes(capability)) {
			errors.push(`'${key}' modulu "${moduleDef.name}" jádro použije jen s funkcí "${capability}" v 'capabilities'`);
		}
		try {
			normalize(config, /** @type {Parameters<Types.DeclaredFilters["normalize"]>[1]} */ (moduleDef));
		} catch (err) {
			errors.push(`'${key}' modulu "${moduleDef.name}": ${/** @type {Error} */ (err)?.message || String(err)}`);
		}
	}

	// A short (1–2 sentence) description of what the module does — options.mjs shows it below
	// the module name in the "Advanced module settings" section (see renderModules() and
	// the <small> there). Optional, but recommended for every module — without it
	// this item is just silently not shown, nothing breaks.
	if (moduleDef.description === undefined) {
		warnings.push(`nedeklaruje 'description' — v Nastavení se u modulu nezobrazí popisek`);
	} else if (typeof moduleDef.description !== "string" || !moduleDef.description.trim()) {
		errors.push(`'description' modulu "${moduleDef.name}" musí být neprázdný řetězec`);
	}

	return { errors, warnings };
}

/** @type {Functions.Base.getModuleKey} */
export function getModuleKey(path) {
	// An instance entry ("…/contentDividerSandbox.js#k3j9x2", see parseModuleEntry()
	// below) still belongs to the same module — the instance id does not count toward the name.
	const parts = path.split(MODULE_INSTANCE_SEPARATOR)[0].replace(/\\/g, "/").split("/");
	const filename = parts[parts.length - 1];
	// .m?js covers both classic .js and module .mjs files.
	return filename.replace(/\.m?js$/, "");
}

// The folder of a module from the package ("./modules/tabGroups/tabGroups.mjs" -> "tabGroups") — its texts are in
// modules/<folder>/_locales (see i18n.mjs). null for a file outside modules/.
/** @type {Functions.Base.getModuleFolder} */
export function getModuleFolder(path) {
	return /^(?:\.?\/)?modules\/([^/]+)\//.exec(path.replace(/\\/g, "/"))?.[1] ?? null;
}

// Multiple module instances (registerModule({ multiInstance: true })) —
// a module that can be put into the module list several times, each time in a different place and
// with its own settings (contentDividerSandbox: a divider with a heading and a piece of HTML).
// Each instance is its own entry in the list: the module path + "#" + the instance
// id ("sandbox://contentDividerSandbox/contentDividerSandbox.js#k3j9x2"). The entry without an
// id is for such a module just its "template": it loads the module (without it the Settings page
// would not know that another instance can be added) and shows nothing itself.
// The instance settings (activation mode, surface, frame, instanceSettingsSchema) are
// stored under the "<module>#<id>" key instead of the bare module name, see
// getModuleInstanceKey().
export const MODULE_INSTANCE_SEPARATOR = "#";

// The key under which a module list entry has its settings (moduleSettings):
// for an instance "<module>#<id>", otherwise the bare module name — so it can be passed
// directly everywhere the module name used to be passed (getModuleMode(),
// getModuleSettingKey(), ...).
/** @type {Functions.Base.getModuleInstanceKey} */
export function getModuleInstanceKey(moduleName, instance) {
	return instance ? `${moduleName}${MODULE_INSTANCE_SEPARATOR}${instance}` : moduleName;
}

// Splits a module list entry into the path to the file (without the instance id — that is what
// gets imported), the module name, the instance id (null = a plain entry or a template)
// and the settings key (getModuleInstanceKey()).
/** @type {Functions.Base.parseModuleEntry} */
export function parseModuleEntry(entry) {
	const index = entry.indexOf(MODULE_INSTANCE_SEPARATOR);
	const path = index === -1 ? entry : entry.slice(0, index);
	const instance = index === -1 ? null : entry.slice(index + 1) || null;
	const name = getModuleKey(path);
	return { entry, path, name, instance, key: getModuleInstanceKey(name, instance) };
}

// A new instance id — short, only [a-z0-9], so it can be written without escaping into
// the module list and into the settings key ("<module>#<id>.<field>").
/** @type {Functions.Base.createModuleInstanceId} */
export function createModuleInstanceId() {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

// Module list entries that should be shown, in the order of the list: only modules
// that were loaded successfully (registerModule()), for a module with multiple
// instances only its instances (the template shows nothing, see above) and for
// the others only entries without an instance id. Each key only once. Shared between
// popup.mjs and BaseController.renderModulesFor(), so the output order on all
// surfaces is determined by the module list in the same way, not by the registration order.
/** @type {Functions.Base.resolveModuleEntries} */
export function resolveModuleEntries(paths) {
	const byName = new Map((globalThis.__extensionModules || []).map((mod) => [mod.name, mod]));
	/** @type {Set<string>} */
	const seen = new Set();
	/** @type {Types.ResolvedModuleEntry[]} */
	const entries = [];
	for (const item of paths) {
		if (typeof item !== "string") continue;
		const entry = parseModuleEntry(item);
		const mod = byName.get(entry.name);
		if (!mod || seen.has(entry.key) || !!mod.multiInstance !== !!entry.instance) continue;
		seen.add(entry.key);
		entries.push({ ...entry, mod });
	}
	return entries;
}

// A file is a real JS module only if it contains at least one top-level
// import/export statement — the mere use of a dynamic import() (a regular function,
// available in classic scripts too) does not make it a module yet.
const ES_MODULE_SYNTAX_RE = /^\s*(?:import\s|import\{|import\*|export\s|export\{|export\*)/m;

/** @type {Functions.Base.looksLikeEsModuleSource} */
function looksLikeEsModuleSource(sourceText) {
	return ES_MODULE_SYNTAX_RE.test(sourceText);
}

// A mandatory check of the extension convention: a file using top-level
// import/export (a real JS module) must have the .mjs extension; a file without them
// (a classic script, possibly with a dynamic import()) must have the .js extension. Unlike
// validateModule() above (missing optional metadata -> just a
// warning), this is always an error — a wrong extension can really cause the
// file not to load at all depending on where/how it is used (e.g. as a content script).
// But it blocks nothing — it is just reported, so it is easy to find and
// fix (the same as the other module checks in this file).
/** @type {Functions.Base.validateModuleFileExtension} */
export async function validateModuleFileExtension(path) {
	let sourceText;
	try {
		const res = await fetch(chrome.runtime.getURL(path));
		sourceText = await res.text();
	} catch (err) {
		console.error(`Nelze ověřit příponu souboru "${path}": ${/** @type {Error} */ (err).message}`);
		return false;
	}

	const isModule = looksLikeEsModuleSource(sourceText);
	const hasMjsExt = /\.mjs$/.test(path);
	const hasJsExt = /\.js$/.test(path) && !hasMjsExt;

	if (isModule && !hasMjsExt) {
		console.error(
			`Soubor "${path}" používá import/export (je to JS modul) — musí mít příponu .mjs.`
		);
		return false;
	}

	if (!isModule && !hasJsExt) {
		console.error(
			`Soubor "${path}" nepoužívá import/export (není to JS modul) — musí mít příponu .js.`
		);
		return false;
	}

	return true;
}

/** @type {Functions.Base.getTagName} */
export function getTagName(name) {
	const kebab = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
	return `extension-${kebab}`;
}

// Module name for humans: words from camelCase with a capital initial letter
// ("storageManager" -> "Storage Manager"); an abbreviation written in capitals
// stays as it is ("PWAInfo" -> "PWA Info").
/** @type {Functions.Base.formatModuleName} */
export function formatModuleName(key) {
	const words = key.match(/[A-Z]?[a-z]+|[0-9]+|[A-Z]+(?=[A-Z][a-z])/g);
	if (words && words.length > 1) {
		return words
			.map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
			.join(" ");
	}
	return key.charAt(0).toUpperCase() + key.slice(1);
}

/** @type {Functions.Base.formatBytes} */
export function formatBytes(bytes) {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Text color (black/white) with the higher contrast on the background of the given color ("#rrggbb")
// — according to the relative luminance from WCAG. Returns black for an invalid color.
// For the colored labels of modules (bookmarkChecker, visualHistory).
/** @type {Functions.Base.contrastColor} */
export function contrastColor(hex) {
	if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) {
		return "#000000";
	}

	/** @type {Functions.Base.contrastColor.channel} */
	const channel = (offset) => {
		const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	};
	const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);

	const contrastWithWhite = 1.05 / (luminance + 0.05);
	const contrastWithBlack = (luminance + 0.05) / 0.05;
	return contrastWithWhite > contrastWithBlack ? "#ffffff" : "#000000";
}

// A general (module-independent) utility over chrome.bookmarks: is there in the
// given bookmark folder (even arbitrarily deep in its subfolders) a bookmark with
// exactly this URL (or with any of an array of URLs)? Used by createModuleApi().badge (see background.js) and
// the bookmarkChecker module directly (see sdk.mjs) — both through the same, single
// implementation, so the same recursive walk of the bookmark tree is not written
// twice. Requires the "bookmarks" permission (optional, see BOOKMARKS_PERMISSIONS) —
// without it/with an invalid/deleted folderId it returns false, not an error.
/** @type {Functions.Base.bookmarkFolderContainsUrl} */
export async function bookmarkFolderContainsUrl(folderId, url) {
	const urls = new Set((Array.isArray(url) ? url : [url]).filter((item) => typeof item === "string" && item !== ""));
	if (!folderId || urls.size === 0 || typeof chrome === "undefined" || !chrome.bookmarks) {
		return false;
	}

	let nodes;
	try {
		nodes = await chrome.bookmarks.getSubTree(folderId);
	} catch {
		// The folder has disappeared/been deleted in the meantime, or an invalid id — not an error
		// worth logging, just "this category finds nothing now".
		return false;
	}

	/** @type {Functions.Base.bookmarkFolderContainsUrl.walk} */
	function walk(node) {
		if (node.url && urls.has(node.url)) return true;
		return (node.children || []).some(walk);
	}
	return nodes.some(walk);
}

// moduleDefaultMode: an optional value declared by the module itself (see
// registerModule -> defaultActivationMode). An explicit user setting always takes
// precedence; only then the module's own default value; only
// then the global DEFAULT_MODE.
/** @type {Functions.Base.getModuleMode} */
export function getModuleMode(settings, moduleName, moduleDefaultMode) {
	// The module's activation mode is stored in moduleSettings under its bare name.
	return /** @type {Enums.ActivationMode | undefined} */ (settings[moduleName]) || moduleDefaultMode || DEFAULT_MODE;
}

// Shared between BaseElement (modules) and BaseController (popup/options/sidebar)
// — both call this same implementation to send a message to the content script
// running in the currently active tab.
// chrome.tabs (and chrome.scripting) is not available EVERYWHERE a module element
// can be rendered — specifically not inside the floating window's <iframe>, which
// content-scripts/floating-window.js injects directly into the visited web
// page: it is an extension page too (chrome-extension://...), but
// Chrome gives these APIs only to the extension's "own" surfaces (popup, side
// panel, Settings, background), not to extension pages embedded as a child
// frame of a foreign page. In the popup/side panel/etc. it works unchanged.
/** @type {Functions.Base.hasTabsApi} */
function hasTabsApi() {
	return typeof chrome !== "undefined" && !!chrome.tabs && typeof chrome.tabs.query === "function";
}

// The same restriction as hasTabsApi() above, just for chrome.permissions — inside
// the floating window's <iframe> it is not available at all either (verified by a real error,
// not just theoretically), so api.permissions.contains()/request() (see
// createModuleApi() below) cannot reach it directly.
/** @type {Functions.Base.hasPermissionsApi} */
function hasPermissionsApi() {
	return typeof chrome !== "undefined" && !!chrome.permissions && typeof chrome.permissions.contains === "function";
}

// The "current" tab from the point of view of an extension page that has chrome.tabs
// (popup, side panel, Settings): the active tab of the current window.
// But an extension page opened as a tab (Settings and the welcome page, see
// DISPLAY_LOCATIONS "options" and "onboarding") is ITSELF the active tab and
// has no module data —
// the "current" one there is the tab the user came from: the last used
// other tab of the same window (tab.lastAccessed does not require the "tabs" permission).
// The popup/sidebar are not a tab, getCurrent() returns undefined there. The floating
// window's <iframe> used to have no chrome.tabs at all (see hasTabsApi()), newer
// Chrome (verified in 153) has it — getCurrent() returns the tab the
// window is embedded in there, and that one is "current" even when it is not active (without this
// exception the condition for Settings below would mistake it for another tab). Returns
// the tab object (tab.url only with a host permission for that page), or null.
/** @type {Functions.Base.queryCurrentTab} */
async function queryCurrentTab() {
	try {
		const current = chrome.tabs.getCurrent ? await chrome.tabs.getCurrent() : undefined;
		if (current && typeof window !== "undefined" && window.top !== window) return current;
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tab && current && current.id === tab.id) {
			const others = (await chrome.tabs.query({ currentWindow: true })).filter(
				(t) => t.id !== current.id && typeof t.lastAccessed === "number"
			);
			// filter() above let through only tabs with a numeric lastAccessed.
			others.sort((a, b) => /** @type {number} */ (b.lastAccessed) - /** @type {number} */ (a.lastAccessed));
			return others[0] || null;
		}
		return tab || null;
	} catch {
		return null;
	}
}

// api.tabs.getActive() — the tab the surface relates to as { tabId, url, domain }, or null
// (see there); also for api.tabs.onChange() below, so that its reads do not count as calls of the module.
/** @type {Functions.Base.readActiveTab} */
async function readActiveTab() {
	let tab = null;
	if (hasTabsApi()) {
		tab = await queryCurrentTab();
	} else {
		try {
			const response = await sendToBackground({ type: GET_SENDER_TAB_MESSAGE });
			tab = (response && response.tab) || null;
		} catch (err) {
			console.error("Nelze zjistit záložku (přes background.js):", err);
		}
	}
	if (!tab || typeof tab.id !== "number") return null;
	return { tabId: tab.id, url: tab.url || null, domain: getDomainKey(tab.url) };
}

// How often (ms) api.tabs.onChange() reads the tab where there are no chrome.tabs events (the floating
// window's <iframe> in Firefox, a content script) — only while the page is visible.
const TAB_CHANGE_POLL_MS = 1000;

// api.tabs.onChange() — handler(tab) with the value of readActiveTab() whenever the tab the surface
// relates to changed: another tab became the current one, or the current one has a new address (a
// navigation, also history.pushState() of a web app, which loads no new page). With chrome.tabs (the
// popup, the side panel, Settings, the floating window in newer Chrome) after chrome.tabs.onActivated and
// onUpdated — a navigation right at its start with the new address (changeInfo.url; without a host
// permission for the page the browser does not give it, then after the load); without them every
// TAB_CHANGE_POLL_MS while the page is visible, and at once when it becomes visible. The first read only
// notes the tab (the caller reads it itself), then only a different tab id or address is reported.
// Returns a function to unsubscribe.
/** @type {Functions.Base.watchActiveTab} */
function watchActiveTab(handler) {
	let active = true;
	/** @type {Types.ActiveTabInfo | null | undefined} undefined = not read yet */
	let last;
	let reading = false;
	let again = false;
	/** @type {(() => void)[]} */
	const stops = [];

	// Reads that overlap make one more read after the current one, not a race of answers.
	const check = async () => {
		if (reading) {
			again = true;
			return;
		}
		reading = true;
		try {
			do {
				again = false;
				const tab = await readActiveTab();
				if (!active) return;
				const changed = last !== undefined && (tab?.tabId !== last?.tabId || tab?.url !== last?.url);
				last = tab;
				if (changed) handler(tab);
			} while (again && active);
		} catch (err) {
			console.error("Změnu záložky nejde ohlásit:", err);
		} finally {
			reading = false;
		}
	};

	if (hasTabsApi() && chrome.tabs.onActivated && chrome.tabs.onUpdated) {
		const onActivated = () => {
			check();
		};
		// The tab of the surface — the active one, on the Settings page the last used other tab.
		/** @type {Parameters<typeof chrome.tabs.onUpdated.addListener>[0]} */
		const onUpdated = (tabId, changeInfo, tab) => {
			if ((tab.active || tabId === last?.tabId) && (changeInfo.url !== undefined || changeInfo.status === "complete")) check();
		};
		chrome.tabs.onActivated.addListener(onActivated);
		chrome.tabs.onUpdated.addListener(onUpdated);
		stops.push(() => {
			chrome.tabs.onActivated.removeListener(onActivated);
			chrome.tabs.onUpdated.removeListener(onUpdated);
		});
	} else {
		const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
		const timer = setInterval(() => {
			if (visible()) check();
		}, TAB_CHANGE_POLL_MS);
		stops.push(() => clearInterval(timer));
		if (typeof document !== "undefined") {
			const onVisibility = () => {
				if (visible()) check();
			};
			document.addEventListener("visibilitychange", onVisibility);
			stops.push(() => document.removeEventListener("visibilitychange", onVisibility));
		}
	}
	check();

	return () => {
		active = false;
		for (const stop of stops.splice(0)) stop();
	};
}

// Resolves/rejects as "promise", or rejects with an error after "ms" — for calling
// code of another module (see api.details.collect()), so that one slow
// provider does not delay the others.
/** @type {Functions.Base.withTimeout} */
function withTimeout(promise, ms) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	/** @type {Promise<never>} */
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`nevrátil výsledek do ${ms} ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A general replacement for chrome.tabs.sendMessage() for the floating window: it sends
// the message through window.parent.postMessage() DIRECTLY to the page the
// floating window is embedded in (window.parent from the point of view of floating.html's <iframe> IS
// that page), and waits for a response framed the same way back. The module's content script
// on this side does not deal at all with the message having taken a different path —
// see createModuleApi().messages.on() below, where FLOATING_RELAY_REQUEST is
// listened to transparently alongside the regular chrome.runtime.onMessage.
const FLOATING_RELAY_REQUEST = "SDK_FLOATING_RELAY_REQUEST";
const FLOATING_RELAY_RESPONSE = "SDK_FLOATING_RELAY_RESPONSE";

/** @type {Functions.Base.sendMessageViaParentFrame} */
function sendMessageViaParentFrame(message, timeoutMs = 2000) {
	return new Promise((resolve) => {
		if (typeof window === "undefined" || !window.parent || window.parent === window) {
			// We are not in any frame (or window does not exist at all) — there is nowhere to
			// send the message, not an error worth logging.
			resolve(undefined);
			return;
		}

		const id = `${Date.now()}-${Math.random()}`;
		let done = false;

		/** @type {Functions.Base.sendMessageViaParentFrame.cleanup} */
		function cleanup() {
			window.removeEventListener("message", onMessage);
			clearTimeout(timer);
		}
		/** @type {Functions.Base.sendMessageViaParentFrame.onMessage} */
		function onMessage(event) {
			const data = event.data;
			if (done || !data || data.type !== FLOATING_RELAY_RESPONSE || data.id !== id) return;
			done = true;
			cleanup();
			resolve(data.response);
		}
		const timer = setTimeout(() => {
			if (done) return;
			done = true;
			cleanup();
			resolve(undefined);
		}, timeoutMs);

		window.addEventListener("message", onMessage);
		window.parent.postMessage(/** @satisfies {Types.FloatingRelayRequest} */ ({ type: FLOATING_RELAY_REQUEST, id, message }), "*");
	});
}

// A message to the content script of the tab the surface relates to — the same
// determination as for api.tabs.getActive() (queryCurrentTab()): in the popup and
// side panel the active tab, on the Settings page the last used
// other tab, in the floating window (newer Chrome gives it chrome.tabs) the one it
// is embedded in — even when it is not active right now. Without chrome.tabs through
// window.parent (see sendMessageViaParentFrame()).
/** @type {Functions.Base.sendMessageToActiveTab} */
export async function sendMessageToActiveTab(message) {
	if (!hasTabsApi()) {
		return sendMessageViaParentFrame(message);
	}
	try {
		const tab = await queryCurrentTab();
		if (tab && tab.id) {
			return chrome.tabs.sendMessage(tab.id, message).catch(() => {});
		}
	} catch (err) {
		console.error("sendMessageToActiveTab error:", err);
	}
}

// Queries of the module API to background.js (data service, shared limits, ... —
// messages answered by the core listeners in background.js). From other
// contexts they go through chrome.runtime.sendMessage(). In background.js itself
// (module background parts, registerBackgroundScript()) this path leads
// nowhere: the browser does not deliver a message to its sender (neither Chrome nor Firefox), so
// e.g. api.data.log() from a background part used to silently store nothing. There
// background.js passes it directly to the core listeners (setBackgroundDispatcher()).
// But module background parts are imported before background.js
// registers the listeners — their query waits until then.
const IN_BACKGROUND = detectPerfContext() === "background";
/** @type {Types.BackgroundDispatcher | null} */
let backgroundDispatcher = null;
/** @type {(dispatcher: Types.BackgroundDispatcher) => void} */
let resolveBackgroundDispatcher = () => {};
/** @type {Promise<Types.BackgroundDispatcher>} */
const backgroundDispatcherReady = new Promise((resolve) => {
	resolveBackgroundDispatcher = resolve;
});

// Delivering messages to core listeners in the same context (background.js) —
// the same as through the browser: a copy of the message and the response through JSON (as if they
// went through chrome.runtime), the sender sender, the response = the first sendResponse().
// When no listener responds immediately or returns true, the response is undefined.
// It rejects a message that cannot be converted to JSON.
/** @type {Functions.Base.createLocalDispatcher} */
export function createLocalDispatcher(listeners, sender) {
	return (message) =>
		new Promise((resolve) => {
			/** @type {Types.AnyMessage} */
			const copy = JSON.parse(JSON.stringify(message));
			let answered = false;
			let pending = false;
			/** @type {(response?: Types.AnyMessageResponse) => void} */
			const sendResponse = (response) => {
				if (answered) return;
				answered = true;
				resolve(response === undefined ? undefined : JSON.parse(JSON.stringify(response)));
			};
			for (const listener of listeners) {
				try {
					if (listener(copy, { ...sender }, sendResponse) === true) pending = true;
				} catch (err) {
					console.error("Chyba v posluchači zpráv jádra:", err);
				}
			}
			if (!answered && !pending) resolve(undefined);
		});
}

// The listeners of the module background parts in background.js (api.messages.on()) — api.messages.send() of one
// background part reaches the others directly: the browser does not deliver a message to its sender, and all background
// parts run in the one context of background.js (contactsModule asks domainInfo to load a domain, domainInfo announces the
// result). A background part does not get its own messages (as a page does not).
/** @type {Types.BackgroundPartListener[]} */
const backgroundPartListeners = [];

// Delivers a message of a background part (moduleName) to the listeners of the other background parts — like
// chrome.runtime: each one a copy through JSON, asynchronously, the sender sender; their responses go nowhere (send()
// resolves with the response of the pages). A message that cannot be converted to JSON is not delivered.
/** @type {Functions.Base.deliverToBackgroundParts} */
export function deliverToBackgroundParts(listeners, moduleName, message, sender) {
	let json;
	try {
		json = JSON.stringify(message);
	} catch {
		return;
	}
	if (json === undefined) return;
	for (const { moduleName: owner, listener } of listeners) {
		if (owner === moduleName) continue;
		queueMicrotask(() => {
			try {
				listener(JSON.parse(json), { ...sender }, () => {});
			} catch (err) {
				console.error(`Chyba v posluchači zpráv background části modulu "${owner}":`, err);
			}
		});
	}
}

// Registers delivering messages to core listeners in the same context — called
// only by background.js (and by tests outside it; null cancels the delivery).
/** @type {Functions.Base.setBackgroundDispatcher} */
export function setBackgroundDispatcher(dispatcher) {
	backgroundDispatcher = dispatcher;
	if (dispatcher) resolveBackgroundDispatcher(dispatcher);
}

/**
 * @template {Types.AnyMessage} M
 * @param {M} message
 * @returns {Promise<Types.MessageResponse<M['type']> | undefined>}
 */
export async function sendToBackground(message) {
	const dispatch = backgroundDispatcher || (IN_BACKGROUND ? await backgroundDispatcherReady : null);
	if (dispatch) return /** @type {Types.MessageResponse<M['type']> | undefined} */ (await dispatch(message));
	return chrome.runtime.sendMessage(message);
}

// Builds the domain key for storing the floating window state — the 2nd-level domain
// (e.g. "example.com"), or if a subdomain exists, the 3rd-level domain
// (e.g. "www.example.com"). More deeply nested subdomains (4th level and more) are
// trimmed to the last 3 parts, nothing further is handled (see the specification).
/** @type {Functions.Base.getDomainStorageKey} */
export function getDomainStorageKey(hostname) {
	if (!hostname) return "";
	const labels = hostname.split(".").filter(Boolean);
	return labels.slice(-3).join(".");
}

// Loads the stored floating window state for the given domain (see
// getDomainStorageKey) — the position { top, left } and whether it was last
// open { open }. If there is no own record for it yet, it returns the last
// used state from any other domain (a global fallback); if
// even that does not exist, it returns null and the caller uses built-in default
// values.
/** @type {Functions.Base.loadFloatingWindowState} */
export async function loadFloatingWindowState(hostname) {
	const key = getDomainStorageKey(hostname);
	return new Promise((resolve) => {
		chrome.storage.local.get([FLOATING_WINDOW_STATE_KEY], (/** @type {Types.StorageLocal} */ result) => {
			/** @type {Types.FloatingWindowStateStore} */
			const data = result[FLOATING_WINDOW_STATE_KEY] || {};
			const byDomain = data.byDomain || {};
			resolve(byDomain[key] || data.lastUsed || null);
		});
	});
}

// Saves the floating window state (position and open/closed) for the given domain and
// at the same time sets it as the global "last used" state (a fallback for
// domains without an own record). The data is stored in the extension
// (chrome.storage.local), not on individual pages.
/** @type {Functions.Base.saveFloatingWindowState} */
export async function saveFloatingWindowState(hostname, state) {
	const key = getDomainStorageKey(hostname);
	return new Promise((resolve) => {
		chrome.storage.local.get([FLOATING_WINDOW_STATE_KEY], (/** @type {Types.StorageLocal} */ result) => {
			/** @type {Types.FloatingWindowStateStore} */
			const data = result[FLOATING_WINDOW_STATE_KEY] || {};
			const byDomain = { ...(data.byDomain || {}), [key]: state };
			chrome.storage.local.set(
				{ [FLOATING_WINDOW_STATE_KEY]: { byDomain, lastUsed: state } },
				resolve
			);
		});
	});
}

// Prunes the stored frame states (FRAME_STATE_KEY): discards invalid records
// and records not seen for longer than FRAME_STATE_TTL_MS, and when there are still
// more than FRAME_STATE_MAX_ENTRIES of them, keeps only the most recently seen ones. Returns a new
// object, does not change the input.
/** @type {Functions.Base.pruneFrameStates} */
export function pruneFrameStates(store, now = Date.now()) {
	/** @type {[string, Types.FrameState][]} */
	const entries = [];
	for (const [key, entry] of Object.entries(store && typeof store === "object" ? store : {})) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof entry.open !== "boolean" ||
			typeof entry.element !== "string" ||
			typeof entry.seen !== "number" ||
			now - entry.seen > FRAME_STATE_TTL_MS
		) {
			continue;
		}
		entries.push([key, entry]);
	}
	entries.sort((a, b) => b[1].seen - a[1].seen);
	return Object.fromEntries(entries.slice(0, FRAME_STATE_MAX_ENTRIES));
}

// The last known content of FRAME_STATE_KEY on this page — loaded in advance
// (BaseController.preloadFrameStates()), so mountModuleElement() can
// set the stored state right when creating the frame, without the default
// state flashing. Changes from other surfaces (popup, side panel, floating window)
// come here through chrome.storage.onChanged.
/** @type {Types.FrameStateStore | null} */
let frameStateCache = null;
let frameStateListening = false;
// Changes waiting to be written (key → a new record, or null = delete) and a chain of
// writes — within a page the writes go one after another, each reads the current content of the
// storage, so the changes of other surfaces are not overwritten.
/** @type {Map<string, Types.FrameState | null>} */
const pendingFrameStates = new Map();
/** @type {Promise<void>} */
let frameStateWrite = Promise.resolve();

/** @type {Functions.Base.readFrameStates} */
function readFrameStates() {
	return new Promise((resolve) => {
		chrome.storage.local.get([FRAME_STATE_KEY], (/** @type {Types.StorageLocal} */ result) => {
			resolve(pruneFrameStates(result[FRAME_STATE_KEY] || {}));
		});
	});
}

// Loads the stored frame states into frameStateCache and starts watching their changes.
/** @type {Functions.Base.loadFrameStates} */
export async function loadFrameStates() {
	if (!frameStateListening && chrome.storage?.onChanged) {
		frameStateListening = true;
		chrome.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== "local" || !(FRAME_STATE_KEY in changes)) return;
			frameStateCache = /** @type {Types.FrameStateStore | undefined} */ (changes[FRAME_STATE_KEY].newValue) || {};
		});
	}
	frameStateCache = await readFrameStates();
	return frameStateCache;
}

// Schedules a change of a frame record (null = delete) and writes all pending
// changes in one write; the write also prunes old records. Returns a Promise
// of the write's completion.
/** @type {Functions.Base.queueFrameState} */
export function queueFrameState(key, entry) {
	pendingFrameStates.set(key, entry);
	frameStateWrite = frameStateWrite.then(async () => {
		if (pendingFrameStates.size === 0) return;
		const changes = [...pendingFrameStates];
		pendingFrameStates.clear();
		/** @type {Types.FrameStateStore} */
		const store = await readFrameStates();
		for (const [changedKey, changedEntry] of changes) {
			if (changedEntry) store[changedKey] = changedEntry;
			else delete store[changedKey];
		}
		const pruned = pruneFrameStates(store);
		frameStateCache = pruned;
		await new Promise((resolve) => chrome.storage.local.set({ [FRAME_STATE_KEY]: pruned }, () => resolve(undefined)));
	}).catch((err) => console.error("Nelze uložit stav rámu modulu:", err));
	return frameStateWrite;
}

// Connects a module frame to its stored state: for a collapsible frame it sets the stored
// open/closed state (if the user changed the state and the "Output element" setting
// has not changed since), refreshes the "last seen" time and saves every
// change of the state by the user. A state that returns to the default is
// deleted from storage — only the deviation from the setting is stored. For a frame that is no
// longer collapsible, or has a different default setting, the old record is deleted.
/** @type {Functions.Base.bindFrameState} */
export function bindFrameState(frame, key, outputElement) {
	/** @param {Types.FrameStateStore} store */
	const apply = (store) => {
		const entry = store[key];
		if (!entry) return;
		if (!outputElement.collapsible || entry.element !== outputElement.value) {
			queueFrameState(key, null);
			return;
		}
		/** @type {HTMLDetailsElement} */ (frame).open = entry.open;
		expectedOpen = entry.open;
		if (Date.now() - entry.seen > FRAME_STATE_SEEN_REFRESH_MS) {
			queueFrameState(key, { ...entry, seen: Date.now() });
		}
	};

	// The state the code set for the frame (the default, or the stored one) — the toggle event
	// also comes after a change from code, only a change that differs from it is saved.
	const defaultOpen = outputElement.collapsible ? outputElement.open : false;
	let expectedOpen = defaultOpen;
	let userToggled = false;

	if (frameStateCache) {
		apply(frameStateCache);
	} else {
		readFrameStates().then((store) => {
			if (!userToggled) apply(store);
		});
	}

	if (!outputElement.collapsible) return;
	frame.addEventListener("toggle", () => {
		const open = /** @type {HTMLDetailsElement} */ (frame).open;
		if (open === expectedOpen) return;
		expectedOpen = open;
		userToggled = true;
		queueFrameState(
			key,
			open === defaultOpen ? null : { open, element: outputElement.value, seen: Date.now() }
		);
	});
}

// The pinned module output (PINNED_MODULE_KEY_PREFIX) — only one per surface: pinning
// another module overwrites the key, so the original one is unpinned by that.
/** @type {Functions.Base.getPinnedModuleStorageKey} */
export function getPinnedModuleStorageKey(location) {
	return `${PINNED_MODULE_KEY_PREFIX}${location}`;
}

// The stored value only if it is a key of a list entry (a non-empty string), otherwise null.
/** @type {Functions.Base.parsePinnedModule} */
export function parsePinnedModule(value) {
	return typeof value === "string" && value !== "" ? value : null;
}

/** @type {Functions.Base.loadPinnedModule} */
export async function loadPinnedModule(location) {
	const storageKey = getPinnedModuleStorageKey(location);
	try {
		const result = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(storageKey));
		return parsePinnedModule(result[storageKey]);
	} catch (err) {
		console.error("Nelze načíst připnutý modul:", err);
		return null;
	}
}

// null = unpins (removes the key).
/** @type {Functions.Base.savePinnedModule} */
export async function savePinnedModule(location, key) {
	const storageKey = getPinnedModuleStorageKey(location);
	try {
		if (key) await chrome.storage.local.set({ [storageKey]: key });
		else await chrome.storage.local.remove(storageKey);
	} catch (err) {
		console.error("Nelze uložit připnutý modul:", err);
	}
}

// Calls onChange(key) after every change of the pin of the surface — also one made by
// another page of the same surface (the side panel in another window, the floating window
// on another tab) and by this page itself.
/** @type {Functions.Base.watchPinnedModule} */
export function watchPinnedModule(location, onChange) {
	if (!chrome.storage?.onChanged) return;
	const storageKey = getPinnedModuleStorageKey(location);
	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== "local" || !(storageKey in changes)) return;
		onChange(parsePinnedModule(changes[storageKey].newValue));
	});
}

// The stored maximum height of the pinned frame as a whole number within PINNED_MAX_HEIGHT_MIN..MAX,
// otherwise PINNED_MAX_HEIGHT_DEFAULT.
/** @type {Functions.Base.parsePinnedMaxHeight} */
export function parsePinnedMaxHeight(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return PINNED_MAX_HEIGHT_DEFAULT;
	return Math.min(PINNED_MAX_HEIGHT_MAX, Math.max(PINNED_MAX_HEIGHT_MIN, Math.round(value)));
}

// Sets --pinned-max-height on the page by the stored value and follows its changes (also from Settings
// in another tab).
/** @type {Functions.Base.applyPinnedMaxHeight} */
export async function applyPinnedMaxHeight() {
	const set = (/** @type {unknown} */ value) => document.documentElement.style.setProperty("--pinned-max-height", `${parsePinnedMaxHeight(value)}vh`);
	try {
		const result = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get(PINNED_MAX_HEIGHT_KEY));
		set(result[PINNED_MAX_HEIGHT_KEY]);
	} catch (err) {
		console.error("Nelze načíst výšku připnutého modulu:", err);
	}
	chrome.storage.onChanged?.addListener((changes, areaName) => {
		if (areaName === "local" && PINNED_MAX_HEIGHT_KEY in changes) set(changes[PINNED_MAX_HEIGHT_KEY].newValue);
	});
}

// The 📌 button of a module frame (renderModulesFor() on the PIN_LOCATIONS surfaces) — on the
// line of the module name, at its right edge (float in css/module-frame.css). In a block frame it is
// the first child of the frame, so it stays there even with the heading turned off (then it is
// at the right edge of the first line of the module content); in a collapsible one in the <summary>,
// which is visible even when the frame is closed; in an inline one right after the name. A click
// pins the module, on the pinned one it unpins it (onToggle).
/** @type {Functions.Base.attachPinButton} */
export function attachPinButton(frame, pinned, onToggle) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "module-frame-pin";
	button.textContent = "📌";
	// A toggle button: the name stays the same, the state is told by aria-pressed.
	button.setAttribute("aria-label", t("core_pin_module"));
	button.setAttribute("aria-pressed", String(pinned));
	button.title = t(pinned ? "core_unpin_module" : "core_pin_module");
	button.addEventListener("click", (event) => {
		// In the <summary> the click would also collapse/expand the frame.
		event.preventDefault();
		onToggle();
	});

	const heading = frame.querySelector(":scope > .module-frame-heading");
	if (heading && frame instanceof HTMLDetailsElement) {
		heading.prepend(button);
	} else if (heading && frame.classList.contains("module-frame--inline")) {
		heading.after(button);
	} else {
		frame.prepend(button);
	}
	return button;
}

// Supported field types for a module's custom settings (settingsSchema) —
// the single source of truth for what the generic form in options.mjs can
// render without knowing anything about a specific module.
//
// The "custom" type is for a setting that does not fit into a simple field (e.g.
// a list with any number of items): for the field the module supplies a function
// render(value, settings) that returns an element with a getValue() method. The form
// just inserts it and asks it for the value on save (see bookmarkChecker).
//
// The "checkboxTable" type is a table of checkboxes described as data — a row for every item
// of rows, a column for every item of columns ({ value, label }, a column also with title).
// Its value is { [row]: { [column]: boolean } } — Settings stores the whole table, a missing
// cell takes the default of the field (resolveCheckboxTable()). It needs no code, so an
// uploaded module (the sandbox) can use it too. A column with notifications: true is a choice
// that sends notifications — Settings shows under the table whether they are allowed, with
// a button that asks for them (an uploaded module cannot ask for them itself). A "checkbox" field
// with notifications: true the same — the line is under the checkbox while it is checked.
/** @type {Enums.SettingFieldType[]} */
export const SETTING_FIELD_TYPES = ["text", "textarea", "number", "checkbox", "select", "checkboxTable", "custom"];

// The value of a "checkboxTable" field as a whole table: every row and column of the field,
// a checked cell = true. A stored cell (true/false) wins, otherwise the default of the field,
// otherwise false — a row or a column added later takes its default.
/** @type {Functions.Base.resolveCheckboxTable} */
export function resolveCheckboxTable(field, value) {
	/** @type {(source: unknown, row: string, column: string) => boolean | undefined} */
	const cell = (source, row, column) => {
		const cells = isPlainObject(source) ? source[row] : undefined;
		const checked = isPlainObject(cells) ? cells[column] : undefined;
		return typeof checked === "boolean" ? checked : undefined;
	};
	/** @type {Types.CheckboxTableValue} */
	const table = {};
	for (const row of field.rows) {
		table[row.value] = {};
		for (const column of field.columns) {
			table[row.value][column.value] = cell(value, row.value, column.value) ?? cell(field.default, row.value, column.value) ?? false;
		}
	}
	return table;
}

// Builds the key under which a specific custom setting of a module is kept in storage
// (moduleSettings) — separately from its activation mode (that is
// stored under the bare module name). Shared between the module (reading/writing its
// settings) and options.mjs (generic rendering/saving of the form).
/** @type {Functions.Base.getModuleSettingKey} */
export function getModuleSettingKey(moduleName, fieldKey) {
	return `${moduleName}.${fieldKey}`;
}

// Settings shared by several modules (SettingField.shared — the name of a group): one value under
// getSharedSettingKey(group, fieldKey) instead of a key of each module — every module that declares a field with the
// same group and key shows and sets the same value (Settings keeps their controls in step, a module reads it with
// api.settings.getShared()). Only modules from the package — a field of an uploaded module is always its own (see
// sandboxModuleDefinition()). The prefix has ":", which no module name has, so isModuleSettingsKey() never counts the key
// to a module: the reset, the backup, the rename or the removal of one module leaves the shared value alone.
export const SHARED_SETTINGS_PREFIX = "shared:";
// The name of a group — letters and digits (no "." or "#", the separators of the keys).
export const SHARED_SETTING_GROUP_RE = /^[a-z][A-Za-z0-9]{0,63}$/;

/** @type {Functions.Base.getSharedSettingKey} */
export function getSharedSettingKey(group, fieldKey) {
	return `${SHARED_SETTINGS_PREFIX}${group}.${fieldKey}`;
}

// The key a settings field is stored under: shared (field.shared), or of the module (its instance).
/** @type {Functions.Base.getSettingFieldKey} */
export function getSettingFieldKey(moduleKey, field) {
	return typeof field.shared === "string" ? getSharedSettingKey(field.shared, field.key) : getModuleSettingKey(moduleKey, field.key);
}

// A custom setting of a module with a MAIN-world script restricted to domains
// (modules/<name>/main-world-domain-script.js, see
// discoverAndRegisterMainWorldScripts() in background.js): the list of domains for
// which background.js registers the script (including subdomains) — and into ALL
// frames, including about:blank/srcdoc frames created by a page from such a
// domain. It is an intervention "only on selected websites" (serviceWorkerControl:
// blocking the Service Worker API) that must apply in every document of the given
// domain, otherwise the page would circumvent it through an <iframe>. A missing or empty
// list = the script is registered nowhere (a safe default value — unlike
// main-world-script.js, which runs everywhere). A module usually
// declares the field in settingsSchema (type "textarea", one domain per line), so it
// can be edited in Settings; background.js reacts to its change immediately.
export const MAIN_WORLD_DOMAINS_FIELD = "mainWorldDomains";

// Normalizes one domain entered by the user ("https://www.Example.com:8080/x",
// "*.example.com", "example.com.") to the shape of a hostname ("www.example.com") — lower
// case, international names in punycode, without the scheme, port, path, a leading
// "*." and a trailing dot. IPv6 addresses and nonsense return null (patterns in
// matches cannot write them reliably).
/** @type {Functions.Base.normalizeDomain} */
export function normalizeDomain(raw) {
	const trimmed = String(raw).trim().replace(/^\*\./, "");
	if (!trimmed) return null;
	try {
		const hostname = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`).hostname
			.replace(/\.$/, "");
		return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(hostname) ? hostname : null;
	} catch {
		return null;
	}
}

// The list of domains from a stored value — the textarea from Settings is a string (domains
// separated by lines, commas or spaces), a module may store an array too. Invalid
// items are skipped, duplicates merged; the order stays.
/** @type {Functions.Base.parseDomainList} */
export function parseDomainList(value) {
	/** @type {unknown[]} */
	const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,;]+/) : [];
	/** @type {string[]} */
	const domains = [];
	for (const item of items) {
		const domain = typeof item === "string" ? normalizeDomain(item) : null;
		if (domain && !domains.includes(domain)) domains.push(domain);
	}
	return domains;
}

// Is the page's hostname in one of the domains of the list (the domain itself or its
// subdomain)? The same rule as the patterns from mainWorldMatchPatterns() below.
/** @type {Functions.Base.isHostInDomains} */
export function isHostInDomains(hostname, domains) {
	const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
	return !!host && domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// Work of a content script on the page in the idle time of the browser and in slices — a look through a big page
// (thousands of links, its whole text) must not hold the page (its input, scrolling, animations) for hundreds of
// milliseconds. startIdleWork() waits for an idle period of the browser (requestIdleCallback, at the latest after
// timeout ms) and returns the budget of the work: budget.expired() says the slice is used up — the idle period the
// browser gave, at least IDLE_SLICE_MIN_MS also when it gave none (the timeout ran out); then await budget.next() waits
// for another idle period, at the latest after IDLE_NEXT_TIMEOUT_MS (a page that is never idle still gets looked
// through, only more slowly). The page may change between two slices — the caller checks again what it works with
// (the element is still in the document, the address is the same). Without requestIdleCallback the slices are
// IDLE_SLICE_MIN_MS long with setTimeout(0) between them.
const IDLE_SLICE_MIN_MS = 8;
const IDLE_NEXT_TIMEOUT_MS = 250;

// The end of the next slice (performance.now()).
/** @type {Functions.Base.waitForIdleSlice} */
function waitForIdleSlice(timeout) {
	return new Promise((resolve) => {
		const start = (/** @type {number} */ remaining) => resolve(performance.now() + Math.max(remaining, IDLE_SLICE_MIN_MS));
		if (typeof requestIdleCallback === "function") requestIdleCallback((deadline) => start(deadline.timeRemaining()), { timeout });
		else setTimeout(() => start(0), 0);
	});
}

/** @type {Functions.Base.startIdleWork} */
export async function startIdleWork(timeout = 2000) {
	let end = await waitForIdleSlice(timeout);
	return {
		expired: () => performance.now() >= end,
		next: async () => {
			end = await waitForIdleSlice(IDLE_NEXT_TIMEOUT_MS);
		},
	};
}

// A second source of domains for main-world-domain-script.js beside
// MAIN_WORLD_DOMAINS_FIELD: bookmark folders — an array of { folderId, folderTitle }
// (folderTitle only for showing a folder that has meanwhile disappeared). The domains of all
// http(s) bookmarks in the folders (also in subfolders) apply, not just their exact
// addresses; "www." at the beginning does not count, so a bookmark www.example.com
// covers example.com with all its subdomains. Requires the "bookmarks" permission
// (BOOKMARKS_PERMISSIONS) — without it the folders contribute no domains.
// background.js watches bookmark changes and registers the script again.
export const MAIN_WORLD_BOOKMARK_FOLDERS_FIELD = "mainWorldBookmarkFolders";

// Stored bookmark folders (MAIN_WORLD_BOOKMARK_FOLDERS_FIELD) → an always usable array
// without empty items and duplicates.
/** @type {Functions.Base.parseBookmarkFolderList} */
export function parseBookmarkFolderList(value) {
	/** @type {Types.BookmarkFolderRef[]} */
	const folders = [];
	for (const item of Array.isArray(value) ? value : []) {
		if (!item || typeof item !== "object") continue;
		const row = /** @type {Record<string, unknown>} */ (item);
		const folderId = typeof row.folderId === "string" ? row.folderId : "";
		if (!folderId || folders.some((folder) => folder.folderId === folderId)) continue;
		folders.push({ folderId, folderTitle: typeof row.folderTitle === "string" ? row.folderTitle : "" });
	}
	return folders;
}

// Domains of the bookmarks in the folders (see MAIN_WORLD_BOOKMARK_FOLDERS_FIELD) — without
// chrome.bookmarks/the permission, or for a deleted folder, nothing.
/** @type {Functions.Base.getBookmarkFolderDomains} */
export async function getBookmarkFolderDomains(folderIds) {
	if (folderIds.length === 0 || typeof chrome === "undefined" || !chrome.bookmarks) return [];
	/** @type {string[]} */
	const urls = [];
	/** @type {Functions.Base.getBookmarkFolderDomains.walk} */
	const walk = (node) => {
		if (node.url) urls.push(node.url);
		(node.children || []).forEach(walk);
	};
	for (const folderId of folderIds) {
		try {
			(await chrome.bookmarks.getSubTree(folderId)).forEach(walk);
		} catch {
			// The folder has disappeared, or the permission is missing.
		}
	}
	/** @type {string[]} */
	const hosts = [];
	for (const url of urls) {
		try {
			const { protocol, hostname } = new URL(url);
			if (protocol === "http:" || protocol === "https:") hosts.push(hostname.replace(/^www\./, ""));
		} catch {
			// An invalid bookmark address.
		}
	}
	return parseDomainList(hosts);
}

// All domains for the module's main-world-domain-script.js: the MAIN_WORLD_DOMAINS_FIELD
// list and the domains from MAIN_WORLD_BOOKMARK_FOLDERS_FIELD.
/** @type {Functions.Base.getMainWorldDomains} */
export async function getMainWorldDomains(settings, moduleName) {
	const listed = parseDomainList(settings[getModuleSettingKey(moduleName, MAIN_WORLD_DOMAINS_FIELD)]);
	const folders = parseBookmarkFolderList(settings[getModuleSettingKey(moduleName, MAIN_WORLD_BOOKMARK_FOLDERS_FIELD)]);
	const fromBookmarks = await getBookmarkFolderDomains(folders.map((folder) => folder.folderId));
	return [...listed, ...fromBookmarks.filter((domain) => !listed.includes(domain))];
}

// Patterns for chrome.scripting.registerContentScripts({ matches }) for the module's
// domains (getMainWorldDomains(); an empty array without them).
// "*://*.example.com/*" covers http and https, the domain itself and all
// subdomains and any port; an IPv4 address and a one-word host (localhost) are
// written without "*.", otherwise the pattern would not be valid.
/** @type {Functions.Base.getMainWorldMatches} */
export async function getMainWorldMatches(settings, moduleName) {
	return (await getMainWorldDomains(settings, moduleName)).map((domain) =>
		/^\d+(\.\d+){3}$/.test(domain) || !domain.includes(".") ? `*://${domain}/*` : `*://*.${domain}/*`
	);
}

// A custom setting of a module that turns off its scripts in pages without
// turning off the whole module: with the value false background.js does not register the module's
// content-script.js, main-world-script.js or
// main-world-domain-script.js (previously registered ones are unregistered) — the module then
// injects nothing into pages. A missing value (and anything other than false) =
// the scripts are registered as before, even for modules that do not have the field at all. A module
// declares it in settingsSchema as a "checkbox" with the default value true and
// a label according to what its scripts do (customSearch: "Find and save
// search providers" — keyword redirects keep running).
// background.js reacts to the change immediately, but on pages already loaded the
// script keeps running — so the content script watches the value itself as well
// (api.settings.get() and onChange()).
export const PAGE_SCRIPTS_FIELD = "pageScripts";

// Does background.js register the module's scripts in pages (PAGE_SCRIPTS_FIELD)?
/** @type {Functions.Base.arePageScriptsEnabled} */
export function arePageScriptsEnabled(settings, moduleName) {
	return settings[getModuleSettingKey(moduleName, PAGE_SCRIPTS_FIELD)] !== false;
}

// Output locations from a written value: an array of locations (["options", "onboarding"],
// empty = nowhere), or one string — one location, "none" = nowhere (older
// notation, see NO_DISPLAY_LOCATION). The result is in the order of DISPLAY_LOCATIONS and without
// repetition. Unknown locations in an array are skipped (e.g. a backup from a newer version
// of the extension with a location this version does not know); an unknown string or another type
// is an invalid value → null.
/** @type {Functions.Base.parseDisplayLocations} */
export function parseDisplayLocations(value) {
	if (value === NO_DISPLAY_LOCATION) return [];
	const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
	if (!values) return null;
	const locations = DISPLAY_LOCATIONS.map((item) => item.value).filter((location) => values.includes(location));
	return typeof value === "string" && locations.length === 0 ? null : locations;
}

// Where the module's custom element should be rendered — a list of locations, stored under
// the same convention as settingsSchema fields (getModuleSettingKey), so it
// does not collide with the bare "settings[moduleName]" (that holds the activation mode).
//
// moduleDefaultLocation: an optional value declared by the module itself (see
// registerModule -> defaultDisplayLocation), the same priority as for
// getModuleMode (user > module > global default value). An invalid
// value at any level is skipped (see parseDisplayLocations()).
/** @type {Functions.Base.getModuleDisplayLocations} */
export function getModuleDisplayLocations(settings, moduleName, moduleDefaultLocation) {
	return (
		parseDisplayLocations(settings[getModuleSettingKey(moduleName, "displayLocation")]) ||
		parseDisplayLocations(moduleDefaultLocation) || [DEFAULT_DISPLAY_LOCATION]
	);
}

// The second set of output locations of a client's module (see "Modules from other extensions"): where this extension
// shows it while its service provider shows it too (getServiceDelegation()). Without a valid stored value the same as
// its own locations (displayLocations — getModuleDisplayLocations()): the module does not disappear from the client
// when the provider starts showing it too.
/** @type {Functions.Base.getModuleDelegatedDisplayLocations} */
export function getModuleDelegatedDisplayLocations(settings, moduleName, displayLocations) {
	return parseDisplayLocations(settings[getModuleSettingKey(moduleName, DELEGATED_DISPLAY_LOCATION_FIELD)]) || displayLocations;
}

// The OUTPUT_ELEMENTS item by value — an unknown/missing value (e.g.
// a manually edited storage) falls back to DEFAULT_OUTPUT_ELEMENT, so the frame always
// gets a valid shape.
/** @type {Functions.Base.getOutputElementDef} */
export function getOutputElementDef(value) {
	// The DEFAULT_OUTPUT_ELEMENT item always exists in OUTPUT_ELEMENTS.
	return /** @type {Types.OutputElementOption} */ (
		OUTPUT_ELEMENTS.find((item) => item.value === value) ||
		OUTPUT_ELEMENTS.find((item) => item.value === DEFAULT_OUTPUT_ELEMENT)
	);
}

// "Output element" and "with module heading" — the same key convention and
// priority as displayLocation above (user > module, see registerModule ->
// defaultOutputElement/defaultShowHeading > global default value).
// An invalid value at any level is skipped, not used.
/** @type {Functions.Base.getModuleOutputElement} */
export function getModuleOutputElement(settings, moduleName, moduleDefaultOutputElement) {
	// Casting the function itself: TS cannot do a type predicate through @type on a variable for
	// an arrow function (the variable's type would only be compared with the inferred boolean).
	const isValid = /** @type {Functions.Base.getModuleOutputElement.isValid} */ ((value) => OUTPUT_ELEMENTS.some((item) => item.value === value));
	const userValue = settings[getModuleSettingKey(moduleName, "outputElement")];
	if (isValid(userValue)) return userValue;
	if (isValid(moduleDefaultOutputElement)) return moduleDefaultOutputElement;
	return DEFAULT_OUTPUT_ELEMENT;
}

// A boolean, so without "||" — a stored false is a valid user choice.
/** @type {Functions.Base.getModuleShowHeading} */
export function getModuleShowHeading(settings, moduleName, moduleDefaultShowHeading) {
	const userValue = settings[getModuleSettingKey(moduleName, "showHeading")];
	if (typeof userValue === "boolean") return userValue;
	if (typeof moduleDefaultShowHeading === "boolean") return moduleDefaultShowHeading;
	return DEFAULT_SHOW_HEADING;
}

/** @implements {Classes.Specification} */
export class Specification {
	/** @type {Classes.Specification['isSatisfiedBy']} */
	isSatisfiedBy(_context) {
		return true;
	}

	/** @type {Classes.Specification['and']} */
	and(other) {
		return new AndSpecification(this, other);
	}

	/** @type {Classes.Specification['or']} */
	or(other) {
		return new OrSpecification(this, other);
	}

	/** @type {Classes.Specification['not']} */
	not() {
		return new NotSpecification(this);
	}
}

/** @implements {Classes.AndSpecification} */
export class AndSpecification extends Specification {
	/** @param {...Classes.Specification} specs */
	constructor(...specs) {
		super();
		/** @type {Classes.AndSpecification['_specs']} */
		this._specs = specs;
	}

	/**
	 * @override
	 * @type {Classes.AndSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return this._specs.every((spec) => spec.isSatisfiedBy(context));
	}
}

/** @implements {Classes.OrSpecification} */
export class OrSpecification extends Specification {
	/** @param {...Classes.Specification} specs */
	constructor(...specs) {
		super();
		/** @type {Classes.OrSpecification['_specs']} */
		this._specs = specs;
	}

	/**
	 * @override
	 * @type {Classes.OrSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return this._specs.some((spec) => spec.isSatisfiedBy(context));
	}
}

/** @implements {Classes.NotSpecification} */
export class NotSpecification extends Specification {
	/** @param {Classes.Specification} spec */
	constructor(spec) {
		super();
		/** @type {Classes.NotSpecification['_spec']} */
		this._spec = spec;
	}

	/**
	 * @override
	 * @type {Classes.NotSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return !this._spec.isSatisfiedBy(context);
	}
}

/** @implements {Classes.ModeSpecification} */
export class ModeSpecification extends Specification {
	/** @param {Enums.ActivationMode} mode */
	constructor(mode) {
		super();
		/** @type {Classes.ModeSpecification['_mode']} */
		this._mode = mode;
	}

	/**
	 * @override
	 * @type {Classes.ModeSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return context.mode === this._mode;
	}
}

// A bare domain/origin without a path (e.g. "https://example.com", no slash
// after the host) — the browser always reports a URL with a trailing slash at the root of a website
// (window.location.href === "https://example.com/"), so without
// special handling this pattern would never match anything. Paths with more
// segments (e.g. "https://example.com/page") are not extended this way — "/page"
// and "/page/" may be different resources, this pattern knows nothing about that.
const BARE_ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/]+$/i;

/** @implements {Classes.UrlPatternSpecification} */
export class UrlPatternSpecification extends Specification {
	/** @param {string[] | null} [patterns] */
	constructor(patterns) {
		super();
		/** @type {Classes.UrlPatternSpecification['_patterns']} */
		this._patterns = patterns || [];
	}

	/**
	 * @override
	 * @type {Classes.UrlPatternSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		const url = context.url || "";
		const normalizedUrl = url.toLowerCase().trim();

		return this._patterns.some((item) => {
			const pattern = item.toLowerCase().trim();
			if (pattern.length === 0) return false;
			if (pattern.endsWith("/")) {
				return normalizedUrl.startsWith(pattern);
			}

			const candidates = BARE_ORIGIN_RE.test(pattern) ? [pattern, `${pattern}/`] : [pattern];
			return candidates.some(
				(p) => normalizedUrl === p || normalizedUrl.startsWith(`${p}#`) || normalizedUrl.startsWith(`${p}?`)
			);
		});
	}
}

// A rule for the module's output SURFACE (popup/sidebar/floating/…) — the same
// role as ModeSpecification, but for DISPLAY_LOCATIONS instead of
// ACTIVATION_MODES: the surface currently being rendered (context.location)
// is the given surface, or one of the given ones — the list of locations where the module is sent by
// "Show module output" (getModuleDisplayLocations(), empty = nowhere).
// It replaces a direct comparison of strings in BaseController, so that the decision "does the
// module belong on this surface" is expressed the same way as the decision "is the module active" —
// both through Specification, not differently.
/** @implements {Classes.LocationSpecification} */
export class LocationSpecification extends Specification {
	/** @param {Enums.RenderLocation | Enums.RenderLocation[]} locations */
	constructor(locations) {
		super();
		/** @type {Classes.LocationSpecification['_locations']} */
		this._locations = Array.isArray(locations) ? locations : [locations];
	}

	/**
	 * @override
	 * @type {Classes.LocationSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		// "settings" (the editor of the module's settings) is never among the surfaces.
		return context.location !== undefined && context.location !== "settings" && this._locations.includes(context.location);
	}
}

/** @implements {Classes.DisabledSpecification} */
export class DisabledSpecification extends Specification {
	/**
	 * @override
	 * @type {Classes.DisabledSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return context.mode === "disabled";
	}
}

/** @implements {Classes.IsNotDisabled} */
export class IsNotDisabled extends Specification {
	/**
	 * @override
	 * @type {Classes.IsNotDisabled['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return context.mode !== "disabled";
	}
}

// The active tab is a regular web page (isWebPageUrl() above), not a special
// browser page — a rule for modules that without a content script or the
// web address of the active tab have nothing to work with (page measurement, server
// IP, domain, ...). Such a module is not shown at all on a special page.
//
// But the browser reveals the tab's address only with access to it. With access to
// all web pages (context.hostAccess), a hidden address therefore means
// a page out of its reach — a special one. Without it there is no way to tell: the rule then
// holds, the module is shown and offers granting the permission itself. It also holds in a context
// without any address at all — the floating window (without chrome.tabs, but always inside a web
// page), the element and the content script (they evaluate only { mode }).
/** @implements {Classes.WebPageSpecification} */
export class WebPageSpecification extends Specification {
	/**
	 * @override
	 * @type {Classes.WebPageSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		if (context.url) return isWebPageUrl(context.url);
		return context.hostAccess !== true;
	}
}

// Shared, reusable specification instances — the single source of truth for
// activation rules across controllers, modules and content scripts.
export const NOT_DISABLED_SPEC = new IsNotDisabled();
export const DISABLED_SPEC = new DisabledSpecification();
export const BACKGROUND_OR_FOCUS_SPEC = new ModeSpecification("background").or(
	new ModeSpecification("focus")
);
export const POPUP_OR_ICON_CLICK_SPEC = new ModeSpecification("popup").or(
	new ModeSpecification("icon_click")
);
// The "After the extension is installed" activation mode — for a module's background part that
// checks in api.activation.onInstalled() whether it should work after installation.
export const INSTALL_SPEC = new ModeSpecification("install");
// The active tab is a regular web page — modules working with it add it
// to their activationSpec (e.g. NOT_DISABLED_SPEC.and(WEB_PAGE_SPEC)).
export const WEB_PAGE_SPEC = new WebPageSpecification();

// Names of modules whose pageInit has already run on this page (see
// BaseController.runPageInits) — base.mjs is one instance per page.
/** @type {Set<string>} */
const pageInitDone = new Set();

// Addresses of module CSS files (moduleDef.styles) that already have a <link> in <head>
// on this page (see BaseController.loadModuleStyles) — each is
// inserted only once, even when the module element is rendered several times.
/** @type {Set<string>} */
const loadedModuleStyles = new Set();

/** @implements {Classes.BaseController} */
export class BaseController {
	constructor() {
		/** @type {Classes.BaseController['_settings']} */
		this._settings = {};
	}

	/** @type {Classes.BaseController['loadSettings']} */
	async loadSettings() {
		return new Promise((resolve) => {
			chrome.storage.local.get([SETTINGS_KEY], (/** @type {Types.StorageLocal} */ result) => {
				this._settings = result[SETTINGS_KEY] || {};
				resolve(this._settings);
			});
		});
	}

	/** @type {Classes.BaseController['saveSettings']} */
	async saveSettings(settings) {
		this._settings = settings;
		return new Promise((resolve) => {
			chrome.storage.local.set({ [SETTINGS_KEY]: settings }, resolve);
		});
	}

	/** @type {Classes.BaseController['getModulesJson']} */
	async getModulesJson() {
		return new Promise((resolve, reject) => {
			chrome.storage.local.get([MODULES_JSON_KEY], (/** @type {Types.StorageLocal} */ result) => {
				if (result[MODULES_JSON_KEY]) {
					resolve(result[MODULES_JSON_KEY]);
				} else {
					// The list is in storage only when it differs from modules.json
					// (see saveModulesJson) — otherwise modules.json applies directly.
					this.fetchDefaultModulesJson().then(resolve, reject);
				}
			});
		});
	}

	/** @type {Classes.BaseController['fetchDefaultModulesJson']} */
	async fetchDefaultModulesJson() {
		let res;
		try {
			res = await fetch(chrome.runtime.getURL("modules.json"));
		} catch (err) {
			// A missing file in the package is a network error, not a 404 response.
			throw new Error(t("core_default_modules_load_failed", /** @type {Error} */ (err).message), { cause: err });
		}
		if (!res.ok) {
			throw new Error(t("core_default_modules_load_failed", res.status));
		}
		return (await res.text()).trim();
	}

	// Default settings of the module list entries from the extension package (see
	// DEFAULT_SETTINGS_FILE) — an object in the shape of moduleSettings.
	/** @type {Classes.BaseController['fetchDefaultSettings']} */
	async fetchDefaultSettings() {
		const res = await fetch(chrome.runtime.getURL(DEFAULT_SETTINGS_FILE));
		if (!res.ok) {
			throw new Error(t("core_file_load_failed", DEFAULT_SETTINGS_FILE, res.status));
		}
		const defaults = await res.json();
		if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
			throw new Error(t("core_default_settings_not_object", DEFAULT_SETTINGS_FILE));
		}
		// Texts in the default settings (the heading and HTML of the welcome divider) are
		// written as "__MSG_key__" (the same as in the manifest) and are filled in in the
		// UI language — storage gets the finished text, which the user
		// can edit.
		await loadI18n();
		for (const [key, value] of Object.entries(defaults)) {
			const match = typeof value === "string" ? /^__MSG_(\w+)__$/.exec(value) : null;
			if (match) defaults[key] = t(match[1]);
		}
		return defaults;
	}

	// Fills in the default settings (fetchDefaultSettings()) of the module list entries
	// paths that have no value yet into the stored moduleSettings — it never overwrites
	// a value the user changed. A key belongs to an entry by the part
	// before the first dot ("contentDividerSandbox#welcome.title" -> "contentDividerSandbox#welcome");
	// values of entries that are not in the list are not written (a removed module instance
	// would otherwise come back into storage after every update). Called by
	// background.js after the extension is installed and updated, and by Settings after saving
	// the module list (an entry may have been added). Returns moduleSettings after filling in.
	/** @type {Classes.BaseController['seedDefaultSettings']} */
	async seedDefaultSettings(paths) {
		/** @type {Types.ModuleSettings} */
		let defaults;
		try {
			defaults = await this.fetchDefaultSettings();
		} catch (err) {
			console.error("Výchozí nastavení modulů nejde načíst:", err);
			return this.loadSettings();
		}

		const entryKeys = new Set(
			paths.filter((path) => typeof path === "string").map((path) => parseModuleEntry(path).key)
		);
		const settings = { ...(await this.loadSettings()) };
		let changed = false;
		for (const [storageKey, value] of Object.entries(defaults)) {
			if (!entryKeys.has(storageKey.split(".")[0]) || settings[storageKey] !== undefined) continue;
			settings[storageKey] = value;
			changed = true;
		}
		if (changed) {
			await this.saveSettings(settings);
		}
		return settings;
	}

	// A list identical to the default modules.json is not stored in storage — the key is
	// deleted and modules.json applies directly again, including its later changes (a new
	// module after an extension update). So storage has only a list that
	// differs from the default one; "Restore default list" thus removes the key.
	/** @type {Classes.BaseController['saveModulesJson']} */
	async saveModulesJson(text) {
		let isDefault = false;
		try {
			const defaultText = await this.fetchDefaultModulesJson();
			isDefault = JSON.stringify(JSON.parse(text)) === JSON.stringify(JSON.parse(defaultText));
		} catch {
			// The default list cannot be loaded or compared — what came is saved.
		}

		return new Promise((resolve, reject) => {
			const done = () => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					resolve();
				}
			};
			if (isDefault) {
				chrome.storage.local.remove(MODULES_JSON_KEY, done);
			} else {
				chrome.storage.local.set({ [MODULES_JSON_KEY]: text }, done);
			}
		});
	}

	/** @type {Classes.BaseController['getModuleKey']} */
	getModuleKey(path) {
		return getModuleKey(path);
	}

	/** @type {Classes.BaseController['getTagName']} */
	getTagName(name) {
		return getTagName(name);
	}

	/** @type {Classes.BaseController['formatBytes']} */
	formatBytes(bytes) {
		return formatBytes(bytes);
	}

	/** @type {Classes.BaseController['formatModuleName']} */
	formatModuleName(key) {
		return formatModuleName(key);
	}

	/** @type {Classes.BaseController['getModuleMode']} */
	getModuleMode(settings, moduleName, moduleDefaultMode) {
		return getModuleMode(settings, moduleName, moduleDefaultMode);
	}

	/** @type {Classes.BaseController['getModuleDisplayLocations']} */
	getModuleDisplayLocations(settings, moduleName, moduleDefaultLocation) {
		return getModuleDisplayLocations(settings, moduleName, moduleDefaultLocation);
	}

	/** @type {Classes.BaseController['sendMessageToActiveTab']} */
	sendMessageToActiveTab(message) {
		return sendMessageToActiveTab(message);
	}

	// The only place where the active tab is determined for evaluating a Specification
	// — url is the address of the ACTIVE TAB (chrome.tabs.query), not the address
	// of the page that is building the context. popup.mjs used to build its own
	// context with window.location.href, which is the address of popup.html itself, not of the
	// page the user is on — UrlPatternSpecification as
	// activationSpec would thus never work correctly. Shared for
	// sidebar/floating too (through renderModulesFor), so all surfaces have the same,
	// working source of the URL.
	//
	// The browser reveals the address only with access to the page — when it is missing,
	// hostAccess is added: does the extension have access to all web pages, i.e. would
	// the address of a web page be visible? (See WebPageSpecification.)
	/** @type {Classes.BaseController['buildPageContext']} */
	async buildPageContext() {
		let url = "";
		// chrome.tabs is not available inside the floating window's <iframe> (see the
		// hasTabsApi comment at sendMessageToActiveTab above) — there the
		// URL is simply not found out (an activationSpec based on the URL is not evaluated
		// precisely in the floating window), not an error worth logging on EVERY
		// render of EVERY module.
		if (!hasTabsApi()) {
			return { url };
		}
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			url = (tab && tab.url) || "";
		} catch (err) {
			console.error("Nelze zjistit URL aktivní záložky:", err);
		}

		/** @type {Types.PageContext} */
		const page = { url };
		if (!url && hasPermissionsApi()) {
			try {
				page.hostAccess = await chrome.permissions.contains({ origins: PAGE_ACCESS_PERMISSIONS.origins });
			} catch (err) {
				console.error("Nelze ověřit přístup ke stránkám:", err);
			}
		}
		return page;
	}

	// Context { mode, url, hostAccess } for evaluating a Specification — the module's
	// mode and the active tab (buildPageContext() above).
	/** @type {Classes.BaseController['buildActivationContext']} */
	async buildActivationContext(mode) {
		return { mode, ...(await this.buildPageContext()) };
	}

	// The single source of truth for "should this module be active right now and
	// rendered on this particular surface" — it combines the activationSpec declared by the module
	// (fallback NOT_DISABLED_SPEC, the same as the default value
	// in BaseElement) with a LocationSpecification for the locations the module sends its
	// output to (the target surface must be one of them), so that
	// both "when" and "where" are evaluated uniformly through the Specification Pattern in
	// one place, instead of each controller (popup/sidebar/floating)
	// duplicating its own version of the same two checks. Used by popup.mjs and
	// renderModulesFor() below — that one passes one snapshot of the active tab (page)
	// for all modules at once, otherwise it is found out for each module separately.
	/** @type {Classes.BaseController['isModuleActive']} */
	// key: the settings key of the list entry (see getModuleInstanceKey()) — for a
	// module instance the mode and output locations are read from its own settings.
	async isModuleActive(mod, settings, location, page, key = mod.name) {
		const mode = getModuleMode(settings, key, mod.defaultActivationMode);
		const displayLocations = getModuleDisplayLocations(settings, key, mod.defaultDisplayLocation);
		/** @type {Types.SpecificationContext} */
		const ctx = page ? { mode, ...page } : await this.buildActivationContext(mode);
		ctx.location = location;

		const activationSpec = mod.activationSpec || NOT_DISABLED_SPEC;
		const active = activationSpec.and(new LocationSpecification(displayLocations)).isSatisfiedBy(ctx);
		// Modules from other extensions (see "Modules from other extensions"): while the service provider of this
		// extension (a client) shows the module too, the second set of locations applies here
		// (getModuleDelegatedDisplayLocations()) — where the module is in the first one only, a note says where it is.
		const delegatedLocations = getModuleDelegatedDisplayLocations(settings, key, displayLocations);
		const activeDelegated = activationSpec.and(new LocationSpecification(delegatedLocations)).isSatisfiedBy(ctx);
		if (!active && !activeDelegated) return { active: false, mode, ctx, delegated: null };
		// A module of the package another extension runs instead is not shown here.
		if ((await getReplacedModules()).has(mod.name)) return { active: false, mode, ctx, delegated: null };
		const delegated = await getServiceDelegation(mod.name);
		if (!delegated) return { active, mode, ctx, delegated: null };
		return { active: activeDelegated, mode, ctx, delegated: activeDelegated ? null : delegated };
	}

	// The note in place of a module this extension leaves to its service provider (isModuleActive() — delegated):
	// where the module is shown instead. Returns the frame of the note.
	/** @type {Classes.BaseController['mountDelegatedNote']} */
	mountDelegatedNote(mod, delegated, outputEl, before = null) {
		const frame = document.createElement("div");
		frame.className = "module-frame module-frame--block module-frame--delegated";
		frame.dataset.module = mod.name;
		const note = document.createElement("div");
		note.className = "module-output module-delegated-note";
		note.textContent = t("core_service_delegated", formatModuleName(mod.name), delegated.provider ?? t("core_service_provider_unnamed"));
		frame.appendChild(note);
		outputEl.insertBefore(frame, before);
		return frame;
	}

	// The notice before beforeEl (the module output, the top of Settings) while an extension that offers its modules to this one (a client) waits for
	// the user's decision — until then the modules it runs instead work in both extensions
	// (getPendingExtensionServiceClients()). The button leads to the section of Settings (on Settings it scrolls
	// there). It follows the records of the clients, the module list and the settings — a decision takes it away. The
	// pages do not wait for it, the modules are not held up. Returns the box of the notice (hidden while empty).
	/** @type {Classes.BaseController['mountPendingServiceNotice']} */
	mountPendingServiceNotice(beforeEl, location) {
		const box = document.createElement("div");
		box.className = "service-pending-notice";
		box.setAttribute("role", "status");
		box.hidden = true;
		beforeEl.before(box);
		let run = 0;
		const render = async () => {
			const current = ++run;
			const clients = await getPendingExtensionServiceClients().catch((err) => {
				console.error("Rozšíření, která čekají na rozhodnutí, nejde zjistit:", err);
				return [];
			});
			if (current !== run) return;
			box.replaceChildren(
				...clients.map((client) => {
					const item = document.createElement("p");
					const doubled = client.doubled.map((name) => formatModuleName(name)).join(", ");
					const text = document.createElement("span");
					text.textContent = doubled ? t("core_service_pending_notice", client.name, doubled) : t("core_service_pending_notice_none", client.name);
					const button = document.createElement("button");
					button.type = "button";
					button.textContent = t("core_service_pending_decide");
					button.addEventListener("click", () => {
						if (location === "options") {
							this.scrollToSettingsSection(EXTENSION_SERVICES_SECTION_ID);
							return;
						}
						openExtensionServicesSettings().catch((err) => console.error("Nastavení nejde otevřít:", err));
					});
					item.append(text, " ", button);
					return item;
				})
			);
			box.hidden = clients.length === 0;
		};
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === "local" && (changes[EXTENSION_SERVICE_CLIENTS_KEY] || changes[MODULES_JSON_KEY] || changes[SETTINGS_KEY])) render();
		});
		render();
		return box;
	}

	// Scrolls to a section of Settings on the Settings page — OptionsController first opens its tab.
	/** @type {Classes.BaseController['scrollToSettingsSection']} */
	scrollToSettingsSection(id) {
		document.getElementById(id)?.scrollIntoView({ block: "start" });
	}

	// Dynamically loads the module JS files, which runs their
	// customElements.define()/registerModule() and their metadata (e.g.
	// settingsSchema) appears in window.__extensionModules. Errors of
	// individual modules are non-fatal — they are just logged and it goes on.
	/** @type {Classes.BaseController['importModuleFiles']} */
	async importModuleFiles(paths) {
		// Instances of one module (see parseModuleEntry()) share a file —
		// it is imported once and without the instance id: a different address (even just a different
		// fragment) would be a new module and the second customElements.define() would fail.
		// An uploaded module (sandbox) has no file in the package — see below.
		const files = new Set(
			paths.filter((path) => typeof path === "string" && !isSandboxModuleEntry(path)).map((path) => parseModuleEntry(path).path)
		);
		// The texts of the modules (modules/<module>/_locales, see i18n.mjs) before the import — module.mjs composes
		// its description and settings labels with t() right when it is evaluated.
		await loadModuleI18n(...[...files].map(getModuleFolder).filter((folder) => folder !== null));
		for (const path of files) {
			await validateModuleFileExtension(path);
			try {
				// The load time of the file (download, compilation, evaluation) goes into the
				// module's load measurement (see perf.mjs).
				await measurePerf(getModuleKey(path), "import", () => import(chrome.runtime.getURL(path)));
			} catch (err) {
				console.error(`Chyba při načítání modulu ${path}:`, err);
			}
		}
		// Uploaded modules are registered by the core from storage, without running their code
		// (that runs only in the sandbox of their element) — after the modules from the package,
		// so their custom settings come after the others in Settings.
		await loadSandboxModules(paths);
		return globalThis.__extensionModules || [];
	}

	// Calls pageInit({ api, location }) of all loaded, not turned-off modules
	// that declare it (registerModule), once per page — on EVERY
	// extension page (popup/sidebar/floating/options/onboarding), regardless of
	// where (and whether at all) the module element is rendered. For behavior that
	// concerns the whole page (example: styleSwitch switches the page styles).
	// They are not awaited — rendering of elements is not delayed and an error of one module
	// does not break the others. Called by renderModulesFor() below and by popup.mjs.
	/** @type {Classes.BaseController['runPageInits']} */
	runPageInits(settings, location) {
		for (const mod of globalThis.__extensionModules || []) {
			if (typeof mod.pageInit !== "function" || pageInitDone.has(mod.name)) continue;
			const mode = getModuleMode(settings, mod.name, mod.defaultActivationMode);
			if (DISABLED_SPEC.isSatisfiedBy({ mode })) continue;

			pageInitDone.add(mod.name);
			const pageInit = mod.pageInit;
			try {
				Promise.resolve(measurePerf(mod.name, "pageInit", () => pageInit.call(mod, { api: createModuleApi(mod.name), location }))).catch((err) =>
					console.error(`Chyba v pageInit modulu ${mod.name}:`, err)
				);
			} catch (err) {
				console.error(`Chyba v pageInit modulu ${mod.name}:`, err);
			}
		}
	}

	// The module's own CSS (moduleDef.styles, absolute addresses) as a <link> at the
	// end of <head> — after the page CSS (mvp.css, theme-*.css, module-frame.css),
	// so the module wins with the same specificity. Without a title attribute: the
	// appearance switcher (styleSwitch) thus does not take it as an option and leaves it always on.
	// An invalid declaration is already reported by validateModule(), here it is just skipped.
	/** @type {Classes.BaseController['loadModuleStyles']} */
	loadModuleStyles(mod) {
		if (!Array.isArray(mod.styles)) return;
		for (const href of mod.styles) {
			if (typeof href !== "string" || loadedModuleStyles.has(href)) continue;
			loadedModuleStyles.add(href);
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = href;
			link.dataset.module = mod.name;
			document.head.appendChild(link);
		}
	}

	// Creates the module's custom element wrapped in a frame according to the "Output
	// element" and "with module heading" settings (see OUTPUT_ELEMENTS), attaches it to
	// outputEl (at the end, or before the before node) and returns the element itself (without the
	// frame) for calling init(). Shared between renderModulesFor() below and
	// popup.mjs, so the frame looks the same on all surfaces.
	//
	// The heading is in the frame, not in the module element — modules commonly overwrite their whole
	// content (this.textContent = ...), so the heading would disappear for them. A turned-off heading
	// stays in the frame, just with the hidden attribute. The exception is a collapsible frame:
	// there the heading is the <summary>, the only thing the frame can be expanded by, so it
	// is never hidden (hidden, a closed module could not be opened at all).
	/** @type {Classes.BaseController['mountModuleElement']} */
	//
	// key: the settings key of the list entry (see isModuleActive()) — the frame of a module
	// instance follows its own settings.
	mountModuleElement(mod, settings, outputEl, before = null, key = mod.name) {
		this.loadModuleStyles(mod);

		const outputElement = getOutputElementDef(
			getModuleOutputElement(settings, key, mod.defaultOutputElement)
		);

		const frame = document.createElement(outputElement.collapsible ? "details" : "div");
		frame.className = `module-frame module-frame--${outputElement.value}`;
		frame.dataset.module = mod.name;
		if (key !== mod.name) {
			frame.dataset.moduleKey = key;
		}
		if (outputElement.collapsible) {
			/** @type {HTMLDetailsElement} */ (frame).open = outputElement.open;
		}

		const heading = document.createElement(outputElement.collapsible ? "summary" : "div");
		heading.className = "module-frame-heading";
		heading.textContent = formatModuleName(mod.name);
		heading.hidden =
			!outputElement.collapsible && !getModuleShowHeading(settings, key, mod.defaultShowHeading);
		frame.appendChild(heading);
		bindFrameState(frame, key, outputElement);

		const el = document.createElement(mod.tag);
		frame.appendChild(el);
		outputEl.insertBefore(frame, before);
		return el;
	}

	// Renders into outputEl the custom elements of all (not turned-off) modules
	// for which the given location ("sidebar" | "floating" | "options" | "onboarding")
	// is among the locations from their "Show module output" setting — shared between
	// sidebar.mjs, floating.mjs, options.mjs and onboarding.mjs (popup.mjs has
	// its own loop over the same methods), so the decision "where the module is
	// shown" is in one place, not duplicated on each surface separately.
	/** @type {Classes.BaseController['renderModulesFor']} */
	async renderModulesFor(location, outputEl) {
		let paths;
		try {
			const jsonText = await this.getModulesJson();
			paths = JSON.parse(jsonText);
			if (!Array.isArray(paths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch (err) {
			console.error("Nelze načíst seznam modulů:", err);
			return;
		}

		// let — remount() passes the current settings on.
		let settings = await this.loadSettings();
		await this.importModuleFiles(paths);
		await loadFrameStates();
		await loadSidebarDisabled();
		this.runPageInits(settings, location);

		// The pinned module (the 📌 button, see attachPinButton()) — its frame is inserted before
		// the marker at the very beginning of the output instead of in its place in the module order.
		/** @type {Types.ModulePin | null} */
		let pin = null;
		const pinLocation = PIN_LOCATIONS.find((pinnable) => pinnable === location);
		if (pinLocation) {
			applyPinnedMaxHeight();
			/** @type {Types.ModulePin} */
			const current = {
				key: await loadPinnedModule(pinLocation),
				anchor: outputEl.insertBefore(document.createComment("pinned"), outputEl.firstChild),
				// Pins the module, the pinned one unpins — the change is shown right away, the write
				// to storage then comes back through watchPinnedModule() without a further change.
				toggle(key) {
					current.key = current.key === key ? null : key;
					savePinnedModule(pinLocation, current.key);
					update();
				},
			};
			pin = current;
			watchPinnedModule(pinLocation, (key) => {
				if (key === current.key) return;
				current.key = key;
				update();
			});
		}

		/** @type {Types.ModuleSlot[]} */
		const slots = [];
		// List entries in its order — for a module with multiple instances
		// each instance separately, in its own place (see resolveModuleEntries()).
		for (const { mod, key, instance } of resolveModuleEntries(paths)) {
			// A quick skip without asking for the active tab (see
			// buildActivationContext) for modules that are obviously turned off —
			// purely a performance shortcut, isModuleActive() would reject them even without it
			// (NOT_DISABLED_SPEC and POPUP_OR_ICON_CLICK_SPEC return false by themselves
			// in the "disabled" mode).
			const mode = getModuleMode(settings, key, mod.defaultActivationMode);
			if (DISABLED_SPEC.isSatisfiedBy({ mode })) continue;

			// The module's place in the output in the order of the module list — an invisible marker
			// before which its frame is inserted, even when the module is shown only later
			// (see _followActiveTab()).
			slots.push({ mod, key, instance, mode, anchor: outputEl.appendChild(document.createComment(key)), frame: null, pinned: false });
		}

		// Passes over all modules do not interleave: a change during a pass just requests
		// one more — showing a module (with waiting for its init()) and its
		// detaching thus cannot overtake each other.
		/** @type {Promise<void> | null} */
		let running = null;
		let pending = false;
		/** @type {Functions.Base.BaseController.renderModulesFor.update} */
		const update = () => {
			if (running) {
				pending = true;
				return running;
			}
			running = (async () => {
				try {
					do {
						pending = false;
						// One snapshot of the active tab for the whole pass.
						const page = await this.buildPageContext();
						for (const slot of slots) {
							await this._updateModuleSlot(slot, settings, location, outputEl, page, pin);
						}
					} while (pending);
				} finally {
					running = null;
				}
			})();
			return running;
		};

		if (location === "sidebar") {
			this._followActiveTab(update);
		}
		await update();

		return {
			// Creates the elements of the named modules anew with the current settings (Settings after the reset of
			// a module) — the others stay as they are. A module that was turned off when the surface was rendered has
			// no place in it, it appears with the next rendering.
			remount: async (names) => {
				settings = await this.loadSettings();
				for (const slot of slots) {
					if (!names.includes(slot.mod.name)) continue;
					slot.mode = getModuleMode(settings, slot.key, slot.mod.defaultActivationMode);
					slot.frame?.remove();
					slot.frame = null;
				}
				await update();
			},
		};
	}

	// Shows the module in its place (slot.anchor) when its rules hold for the given surface and the
	// active tab, and detaches it when they stopped holding.
	// The whole frame is detached — the element cleans up its listeners in disconnectedCallback()
	// and the next time it is shown a new one is created (with a new init()). A module
	// whose result did not change stays unchanged, including its state.
	//
	// pin: the surface's pinned module (renderModulesFor()), null = the surface has no pinning.
	// The pinned frame is at the top (before pin.anchor); after pinning/unpinning
	// it is created anew in the other place the same way — just moving it in the DOM would
	// call the element's disconnectedCallback()/connectedCallback() without a new init().
	/** @type {Classes.BaseController['_updateModuleSlot']} */
	async _updateModuleSlot(slot, settings, location, outputEl, page, pin = null) {
		// The single source of truth for "when" (activationSpec) and "where" (displayLocation)
		// — see isModuleActive() above. Formerly only the target
		// surface was checked here, the module's own activationSpec (e.g. WEB_PAGE_SPEC) was not
		// evaluated at all in the side panel or the floating window.
		const { active, delegated } = await this.isModuleActive(slot.mod, settings, location, page, slot.key);

		if (!active) {
			if (slot.frame && !(delegated && slot.frame.classList.contains("module-frame--delegated"))) {
				slot.frame.remove();
				slot.frame = null;
			}
			if (delegated && !slot.frame) slot.frame = this.mountDelegatedNote(slot.mod, delegated, outputEl, slot.anchor);
			return;
		}
		if (slot.frame?.classList.contains("module-frame--delegated")) {
			slot.frame.remove();
			slot.frame = null;
		}
		const pinned = !!pin && pin.key === slot.key;
		// The user moved the module with its 📌 button — focus goes to the button of the new frame.
		let refocus = false;
		if (slot.frame) {
			if (slot.pinned === pinned) return;
			refocus = !!document.activeElement && slot.frame.querySelector(".module-frame-pin") === document.activeElement;
			slot.frame.remove();
			slot.frame = null;
		}

		try {
			// Creating the element (constructor, connectedCallback()) and init() go
			// into the module's load measurement (see perf.mjs).
			const name = slot.mod.name;
			const before = pin && pinned ? pin.anchor : slot.anchor;
			const el = measurePerf(name, "mount", () => this.mountModuleElement(slot.mod, settings, outputEl, before, slot.key));
			slot.frame = el.parentElement;
			slot.pinned = pinned;
			if (pin && slot.frame) {
				// The pinned frame stays at the top of the surface even while scrolling (sticky in
				// css/module-frame.css).
				slot.frame.classList.toggle("module-frame--pinned", pinned);
				const currentPin = pin;
				const button = attachPinButton(slot.frame, pinned, () => currentPin.toggle(slot.key));
				if (refocus) button.focus();
			}

			const init = el.init;
			if (init) {
				await measurePerf(name, "init", () => init.call(el, { outputEl, name, mode: slot.mode, location, instance: slot.instance }));
			}
		} catch (err) {
			console.error(`Chyba při inicializaci modulu ${slot.key}:`, err);
		}
	}

	// The side panel stays open even after switching tabs or navigating in
	// a tab (the popup closes, the floating window belongs to one page, Settings are
	// a tab themselves) — so module rules depending on the active tab (WEB_PAGE_SPEC,
	// UrlPatternSpecification) are re-evaluated there after every such change
	// (update() from renderModulesFor()). For a navigation only after the load
	// completes, not right with the new address: a module shown in the middle of loading would
	// measure the page before its content script runs in it.
	/** @type {Classes.BaseController['_followActiveTab']} */
	_followActiveTab(update) {
		if (!hasTabsApi() || !chrome.tabs.onActivated || !chrome.tabs.onUpdated) return;

		chrome.tabs.onActivated.addListener(() => {
			update();
		});
		chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
			if (tab.active && changeInfo.status === "complete") {
				update();
			}
		});
	}
}

// --------------------------------------------------------------------
// Backup of one module (api.backup.exportModule()/importModule(), the
// importExport module) — everything the module stored through api.*, without knowing
// the module's specific keys:
//   settings      moduleSettings entries of the module and its instances
//                 (isModuleSettingsKey()), instances the ids of its instances
//                 in the module list, badgeRules/networkRules the rules the
//                 module derived from its settings (api.badge, api.networkRules;
//                 null = none),
//   state         api.state (without the "moduleState.<module>." prefix),
//   records       api.data records (shared IndexedDB, through background.js in
//                 batches),
//   custom        data the module keeps elsewhere (its own IndexedDB) — only
//                 for a module with registerModule({ backupData }).
// api.sessionState is not backed up (it lasts only until a browser restart), the same
// as shared limits (api.rateLimit) and the permission history.
// --------------------------------------------------------------------

/** @type {Functions.Base.isPlainObject} */
function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

// Ids of the module's instances in the current module list, in the order of the list.
/** @type {Functions.Base.listModuleInstances} */
async function listModuleInstances(moduleName) {
	try {
		const paths = JSON.parse(await new BaseController().getModulesJson());
		if (!Array.isArray(paths)) return [];
		return paths
			.filter((path) => typeof path === "string")
			.map((path) => parseModuleEntry(path))
			.filter((entry) => entry.name === moduleName && entry.instance)
			.map((entry) => /** @type {string} */ (entry.instance));
	} catch {
		return [];
	}
}

// Adds the module's instances that are missing in the module list — after the last
// entry of the module (the template or another instance). A module that is not in the list at all
// is not added: we do not know the path to its file and the user removed it.
/** @type {Functions.Base.addModuleInstances} */
async function addModuleInstances(moduleName, instances) {
	if (instances.length === 0) return;
	const controller = new BaseController();
	/** @type {unknown} */
	let paths;
	try {
		paths = JSON.parse(await controller.getModulesJson());
	} catch {
		return;
	}
	if (!Array.isArray(paths)) return;
	/** @type {Types.ModuleEntry | null} */
	let last = null;
	let lastIndex = -1;
	/** @type {Set<string | null>} */
	const present = new Set();
	paths.forEach((path, index) => {
		const entry = typeof path === "string" ? parseModuleEntry(path) : null;
		if (!entry || entry.name !== moduleName) return;
		present.add(entry.instance);
		last = entry;
		lastIndex = index;
	});
	if (!last) return;
	const filePath = /** @type {Types.ModuleEntry} */ (last).path;
	const missing = instances.filter((id) => !present.has(id)).map((id) => `${filePath}${MODULE_INSTANCE_SEPARATOR}${id}`);
	if (missing.length === 0) return;
	paths.splice(lastIndex + 1, 0, ...missing);
	await controller.saveModulesJson(JSON.stringify(paths, null, 2));
}

// Instance id from a backup — the same shape as createModuleInstanceId() gives
// (and the hand-written id in the default list, "welcome").
const BACKUP_INSTANCE_ID_RE = /^[a-z0-9]+$/;

/** @type {Functions.Base.exportModuleBackup} */
export async function exportModuleBackup(moduleName) {
	const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(null));

	/** @type {Types.ModuleSettings} */
	const settings = {};
	for (const [key, value] of Object.entries(stored[SETTINGS_KEY] || {})) {
		if (isModuleSettingsKey(moduleName, key)) settings[key] = value;
	}

	const statePrefix = getModuleStateKey(moduleName, "");
	/** @type {Record<string, unknown>} */
	const state = {};
	for (const [key, value] of Object.entries(stored)) {
		if (key.startsWith(statePrefix)) state[key.slice(statePrefix.length)] = value;
	}

	/** @type {Types.DataBackupRecord[]} */
	const records = [];
	/** @type {number | null} */
	let afterId = null;
	for (;;) {
		/** @type {Types.MessageResponse<'SDK_DATA_EXPORT'> | undefined} */
		const response = await sendToBackground({ type: DATA_EXPORT_MESSAGE, module: moduleName, afterId });
		if (!response || response.error) {
			throw new Error(t("core_backup_records_failed", moduleName, (response && response.error) || t("core_background_no_response")));
		}
		records.push(...response.records);
		if (response.records.length < BACKUP_DATA_BATCH || response.lastId === null) break;
		afterId = response.lastId;
	}

	/** @type {Types.ModuleBackup} */
	const backup = {
		settings,
		instances: await listModuleInstances(moduleName),
		badgeRules: (stored[BADGE_RULES_KEY] || {})[moduleName] || null,
		networkRules: (stored[NETWORK_RULES_KEY] || {})[moduleName] || null,
		state,
		records,
	};

	const mod = (globalThis.__extensionModules || []).find((m) => m.name === moduleName);
	if (mod && mod.backupData) {
		backup.custom = await mod.backupData.export({ api: createModuleApi(moduleName) });
	}
	return backup;
}

// Replaces the module's stored data with the backup content (exportModuleBackup()) — in
// parts: options.settings (default true) the settings of the module, of its instances
// from the backup and the rules, options.data (default true) api.state, api.data
// records and the module's own data. Only a part the backup has is replaced
// (someone may have truncated the file); module instances the backup does not know stay
// unchanged. Only keys that belong to this module are taken from the backup —
// the file cannot overwrite the settings of another module.
/** @type {Functions.Base.importModuleBackup} */
export async function importModuleBackup(moduleName, backup, options = {}) {
	if (!isPlainObject(backup)) {
		throw new Error(t("core_backup_invalid", moduleName));
	}
	const input = /** @type {Record<string, unknown>} */ (backup);
	const withSettings = options.settings !== false && isPlainObject(input.settings);
	const withData = options.data !== false;

	const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(null));
	/** @type {Record<string, unknown>} */
	const items = {};
	/** @type {string[]} */
	const removed = [];
	/** @type {string[]} */
	let instances = [];

	// Instance id from a module settings key ("<module>#<id>.<field>"), null for the key
	// of the module itself.
	/** @type {Functions.Base.importModuleBackup.instanceOf} */
	const instanceOf = (key) => {
		const entryKey = key.split(".")[0];
		return entryKey === moduleName ? null : entryKey.slice(moduleName.length + MODULE_INSTANCE_SEPARATOR.length);
	};

	if (withSettings) {
		// Instances from the backup: from the list of instances and from the keys of their settings.
		/** @type {Set<string>} */
		const instanceIds = new Set();
		for (const id of Array.isArray(input.instances) ? input.instances : []) {
			if (typeof id === "string" && BACKUP_INSTANCE_ID_RE.test(id)) instanceIds.add(id);
		}
		/** @type {Types.ModuleSettings} */
		const incoming = {};
		for (const [key, value] of Object.entries(/** @type {Types.ModuleSettings} */ (input.settings))) {
			if (!isModuleSettingsKey(moduleName, key)) continue;
			const instance = instanceOf(key);
			if (instance !== null) {
				if (!BACKUP_INSTANCE_ID_RE.test(instance)) continue;
				instanceIds.add(instance);
			}
			incoming[key] = value;
		}
		instances = [...instanceIds];

		/** @type {Types.ModuleSettings} */
		const settings = {};
		for (const [key, value] of Object.entries(stored[SETTINGS_KEY] || {})) {
			if (isModuleSettingsKey(moduleName, key)) {
				const instance = instanceOf(key);
				if (instance === null || instanceIds.has(instance)) continue;
			}
			settings[key] = value;
		}
		items[SETTINGS_KEY] = { ...settings, ...incoming };

		const badgeRules = Array.isArray(input.badgeRules) ? input.badgeRules : null;
		/** @type {Types.BadgeRulesStore} */
		const badgeStore = { ...(stored[BADGE_RULES_KEY] || {}) };
		if (badgeRules || moduleName in badgeStore) {
			if (badgeRules) badgeStore[moduleName] = /** @type {Types.BadgeRule[]} */ (badgeRules);
			else delete badgeStore[moduleName];
			items[BADGE_RULES_KEY] = badgeStore;
		}

		const networkRules = isPlainObject(input.networkRules) && Array.isArray(/** @type {Record<string, unknown>} */ (input.networkRules).rules) ? input.networkRules : null;
		/** @type {Types.NetworkRulesStore} */
		const networkStore = { ...(stored[NETWORK_RULES_KEY] || {}) };
		if (networkRules || moduleName in networkStore) {
			if (networkRules) networkStore[moduleName] = /** @type {Types.NetworkRulesEntry} */ (networkRules);
			else delete networkStore[moduleName];
			items[NETWORK_RULES_KEY] = networkStore;
		}
	}

	if (withData && isPlainObject(input.state)) {
		const statePrefix = getModuleStateKey(moduleName, "");
		for (const key of Object.keys(stored)) {
			if (key.startsWith(statePrefix)) removed.push(key);
		}
		for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (input.state))) {
			items[getModuleStateKey(moduleName, key)] = value;
		}
	}

	const toRemove = removed.filter((key) => !(key in items));
	if (toRemove.length > 0) await chrome.storage.local.remove(toRemove);
	if (Object.keys(items).length > 0) await chrome.storage.local.set(items);
	if (withSettings) await addModuleInstances(moduleName, instances);

	if (withData && Array.isArray(input.records)) {
		const records = input.records;
		// Even an empty backup in one message — it deletes the existing records (replace).
		for (let start = 0; start === 0 || start < records.length; start += BACKUP_DATA_BATCH) {
			const response = await sendToBackground({
				type: DATA_IMPORT_MESSAGE,
				module: moduleName,
				records: records.slice(start, start + BACKUP_DATA_BATCH),
				replace: start === 0,
			});
			if (!response || response.error) {
				throw new Error(t("core_backup_records_failed", moduleName, (response && response.error) || t("core_background_no_response")));
			}
		}
	}

	const mod = (globalThis.__extensionModules || []).find((m) => m.name === moduleName);
	if (withData && mod && mod.backupData && "custom" in input) {
		await mod.backupData.import({ api: createModuleApi(moduleName), data: input.custom });
	}
}

// The fields of moduleSettings the core keeps for a list entry (the output on the surfaces, see _createModuleRow() of
// options.mjs) — not the module's own settings.
const OUTPUT_SETTING_FIELDS = Object.freeze(["displayLocation", DELEGATED_DISPLAY_LOCATION_FIELD, "outputElement", "showHeading"]);

// The reset of a module in Settings ("Reset to defaults (including module data deletion)") — the state after the
// installation: its settings go away (the activation mode, the output, custom fields, the same of its instances) and
// default-settings.json fills in its entries again, the rules it set (badge, network), api.state, api.sessionState,
// the api.data records and its own data (registerModule({ backupData: { reset } })) are deleted. A module whose
// settings its settings view edits (registerModule({ settingsEditedBy })) gets its own fields back to the defaults —
// not its mode, output or data, those belong to its own block. The module's instances stay in the module list.
/** @type {Functions.Base.resetModule} */
export async function resetModule(moduleName) {
	const mods = globalThis.__extensionModules || [];
	const edited = mods.filter((m) => m.settingsEditedBy === moduleName).map((m) => m.name);
	/** @type {Types.ModuleSettings} */
	let defaults = {};
	try {
		defaults = await new BaseController().fetchDefaultSettings();
	} catch (err) {
		console.error("Výchozí nastavení modulů nejde načíst:", err);
	}

	const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(null));
	/** @type {Types.ModuleSettings} */
	const settings = {};
	for (const [key, value] of Object.entries(stored[SETTINGS_KEY] || {})) {
		if (isModuleSettingsKey(moduleName, key)) continue;
		const [entryKey, field] = key.split(".", 2);
		if (edited.includes(entryKey) && field !== undefined && !OUTPUT_SETTING_FIELDS.includes(field)) continue;
		settings[key] = value;
	}
	for (const [key, value] of Object.entries(defaults)) {
		if (!(key in settings) && (isModuleSettingsKey(moduleName, key) || edited.includes(key.split(".")[0]))) settings[key] = value;
	}
	/** @type {Record<string, unknown>} */
	const items = { [SETTINGS_KEY]: settings };
	for (const rulesKey of [BADGE_RULES_KEY, NETWORK_RULES_KEY]) {
		const store = /** @type {Record<string, unknown> | undefined} */ (stored[rulesKey]);
		if (!store || !(moduleName in store)) continue;
		const { [moduleName]: _removed, ...rest } = store;
		items[rulesKey] = rest;
	}
	await chrome.storage.local.set(items);

	const statePrefix = getModuleStateKey(moduleName, "");
	const state = Object.keys(stored).filter((key) => key.startsWith(statePrefix));
	if (state.length > 0) await chrome.storage.local.remove(state);
	if (chrome.storage.session) {
		const sessionState = Object.keys(await chrome.storage.session.get(null)).filter((key) => key.startsWith(statePrefix));
		if (sessionState.length > 0) await chrome.storage.session.remove(sessionState);
	}

	// An empty replace deletes the records (the same as the import of a backup without records).
	/** @type {Types.MessageResponse<'SDK_DATA_IMPORT'> | undefined} */
	const response = await sendToBackground({ type: DATA_IMPORT_MESSAGE, module: moduleName, records: [], replace: true });
	if (!response || response.error) {
		throw new Error(t("core_backup_records_failed", moduleName, (response && response.error) || t("core_background_no_response")));
	}

	const mod = mods.find((m) => m.name === moduleName);
	if (mod?.backupData?.reset) await mod.backupData.reset({ api: createModuleApi(moduleName) });
}

// --------------------------------------------------------------------
// createModuleApi — the public API through which a module (the element and its content
// script) communicates with the extension core, without having to know the storage shape
// (moduleSettings, floatingWindowState) or the wire message protocol with
// background.js. It is the only way out of sdk.mjs that modules should
// use for settings/data/the floating window — base.mjs stays internal.
//
// BaseElement.init() creates the instance automatically (this.api); a content script
// (it runs outside BaseElement, outside the extension DOM) creates it itself by importing
// sdk.mjs — see modules/transferredDataVolume/content-script.js or
// modules/bookmarkChecker/content-script.js.
// --------------------------------------------------------------------

// Pages of the extension a module may open with api.tabs.openExtensionPage().
const OPENABLE_EXTENSION_PAGES = Object.freeze(["options.html", "onboarding.html"]);

// instance: instance id of a module with multiple instances (see
// MODULE_INSTANCE_SEPARATOR) — api.settings then reads and writes the settings of THAT
// instance (the "<module>#<id>" key), not of the whole module. Everything else (data,
// state, permissions, ...) still belongs to the module as a whole.
/** @type {Functions.Base.createModuleApi} */
export function createModuleApi(moduleName, instance = null) {
	// Under what the settings (the mode and custom fields) are in moduleSettings — see
	// getModuleInstanceKey().
	const settingsKey = getModuleInstanceKey(moduleName, instance);

	/** @type {Functions.Base.createModuleApi.readAllSettings} */
	async function readAllSettings() {
		return new Promise((resolve) => {
			chrome.storage.local.get([SETTINGS_KEY], (/** @type {Types.StorageLocal} */ result) => {
				resolve(result[SETTINGS_KEY] || {});
			});
		});
	}

	/** @type {Functions.Base.createModuleApi.writeAllSettings} */
	async function writeAllSettings(settings) {
		return new Promise((resolve) => {
			chrome.storage.local.set({ [SETTINGS_KEY]: settings }, resolve);
		});
	}

	/** @type {Functions.Base.createModuleApi.readAllFloatingWindowStates} */
	async function readAllFloatingWindowStates() {
		return new Promise((resolve) => {
			chrome.storage.local.get([FLOATING_WINDOW_STATE_KEY], (/** @type {Types.StorageLocal} */ result) => {
				resolve(result[FLOATING_WINDOW_STATE_KEY] || {});
			});
		});
	}

	/** @type {Functions.Base.createModuleApi.writeAllFloatingWindowStates} */
	async function writeAllFloatingWindowStates(data) {
		return new Promise((resolve) => {
			chrome.storage.local.set({ [FLOATING_WINDOW_STATE_KEY]: data }, resolve);
		});
	}

	// Writes one record ({ module, action, outcome, at }) for EACH
	// individual permission/origin from the set passed to request()/remove() —
	// PERMISSION_ACTIVITY_KEY is an object { "<permission or origin>": [record, ...] },
	// because one set (e.g. PAGE_ACCESS_PERMISSIONS) covers two
	// separately listable items ("scripting" and "<all_urls>") and the
	// extensionPermissionsManager module shows them one by one.
	/** @type {Functions.Base.createModuleApi.logPermissionActivity} */
	async function logPermissionActivity(action, outcome, permissions) {
		const items = [...(permissions?.permissions || []), ...(permissions?.origins || [])];
		if (items.length === 0) return;

		/** @type {Types.PermissionActivityEntry} */
		const entry = { module: moduleName, action, outcome, at: Date.now() };
		return new Promise((resolve) => {
			chrome.storage.local.get([PERMISSION_ACTIVITY_KEY], (/** @type {Types.StorageLocal} */ result) => {
				/** @type {Types.PermissionActivityLog} */
				const log = { ...(result[PERMISSION_ACTIVITY_KEY] || {}) };
				for (const item of items) {
					log[item] = [...(log[item] || []), entry];
				}
				chrome.storage.local.set({ [PERMISSION_ACTIVITY_KEY]: log }, resolve);
			});
		});
	}

	// api.state (chrome.storage.local) and api.sessionState (chrome.storage.session):
	// each value under its own storage key (getModuleStateKey()), so
	// writing one value cannot overwrite another (no read-modify-write of a
	// shared object). Content scripts do not have chrome.storage.session by default —
	// a call there ends with an understandable error.
	/** @type {Functions.Base.createModuleApi.createStateArea} */
	function createStateArea(areaName) {
		/** @type {Functions.Base.createModuleApi.createStateArea.storageArea} */
		const storageArea = () => {
			const area = typeof chrome !== "undefined" && chrome.storage ? chrome.storage[areaName] : undefined;
			if (!area) {
				throw new Error(t("core_storage_unavailable", areaName));
			}
			return area;
		};
		return {
			async get(key, defaultValue) {
				const storageKey = getModuleStateKey(moduleName, key);
				const result = /** @type {Record<string, unknown>} */ (await storageArea().get(storageKey));
				return result[storageKey] !== undefined ? result[storageKey] : defaultValue;
			},
			async set(key, value) {
				await storageArea().set({ [getModuleStateKey(moduleName, key)]: value });
			},
			// Calls handler(newValue) on every change of the value key of this
			// module from anywhere in the extension — even on a page that messages
			// from background.js do not reach (the floating window's <iframe> in Firefox).
			// Returns a function to unsubscribe.
			onChange(key, handler) {
				const storageKey = getModuleStateKey(moduleName, key);
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					if (area === areaName && changes[storageKey]) handler(changes[storageKey].newValue);
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},
		};
	}

	// Is the module in the current module list (modules.json, or a list edited in
	// Settings, see BaseController.getModulesJson())? An unreadable list = no.
	/** @type {Functions.Base.createModuleApi.isListed} */
	async function isListed() {
		try {
			const paths = JSON.parse(await new BaseController().getModulesJson());
			return Array.isArray(paths) && paths.some((path) => typeof path === "string" && getModuleKey(path) === moduleName);
		} catch {
			return false;
		}
	}

	// Providers of the details contract for the given level (see registerModule),
	// except turned-off modules and the caller itself.
	/** @type {Functions.Base.createModuleApi.getEnabledDetailsProviders} */
	async function getEnabledDetailsProviders(scope) {
		if (!DETAILS_SCOPES.includes(scope)) return [];
		const providers = (globalThis.__extensionModules || []).filter(
			(m) => m.name !== moduleName && m.details && typeof m.details[scope] === "function"
		);
		if (providers.length === 0) return [];
		const settings = await readAllSettings();
		return providers.filter(
			(m) => !DISABLED_SPEC.isSatisfiedBy({ mode: getModuleMode(settings, m.name, m.defaultActivationMode) })
		);
	}

	// Every api.* call goes into the module's load measurement (count, time to the result,
	// errors — see instrumentModuleApi() in perf.mjs, wrapped at the end); api.perf
	// is the measurement itself and is not wrapped.
	/** @type {Types.ModuleApi} */
	const api = {
		settings: {
			// The whole moduleSettings blob — for modules that keep several own
			// keys at once and need to see them together (e.g. bookmarkChecker:
			// categories and the older two URL lists, see categories.mjs). Writing is
			// always up to the caller (read-modify-write), so that two concurrent saves
			// do not overwrite each other's foreign keys.
			getAll: readAllSettings,
			setAll: writeAllSettings,

			// One custom value of the module under getModuleSettingKey(settingsKey, key)
			// — the same convention as settingsSchema fields in Settings (for a module instance
			// the instanceSettingsSchema fields).
			// The value type is determined by the caller with the default value (see Types.ModuleSettingsApi.get)
			// — only its own key, under which it stores a value of this type itself.
			/**
			 * @template T
			 * @param {string} key
			 * @param {T} [defaultValue]
			 * @returns {Promise<T>}
			 */
			async get(key, defaultValue) {
				const settings = await readAllSettings();
				const value = settings[getModuleSettingKey(settingsKey, key)];
				return /** @type {T} */ (value !== undefined ? value : defaultValue);
			},
			async set(key, value) {
				const settings = await readAllSettings();
				settings[getModuleSettingKey(settingsKey, key)] = value;
				await writeAllSettings(settings);
			},

			// A value of a group of settings shared by several modules (SettingField.shared) — under
			// getSharedSettingKey(group, key), the same for every module that declares the field.
			/**
			 * @template T
			 * @param {string} group
			 * @param {string} key
			 * @param {T} [defaultValue]
			 * @returns {Promise<T>}
			 */
			async getShared(group, key, defaultValue) {
				const settings = await readAllSettings();
				const value = settings[getSharedSettingKey(group, key)];
				return /** @type {T} */ (value !== undefined ? value : defaultValue);
			},
			async setShared(group, key, value) {
				const settings = await readAllSettings();
				settings[getSharedSettingKey(group, key)] = value;
				await writeAllSettings(settings);
			},

			// The module's current activation mode (user > module > global
			// default) — the same priority as getModuleMode() in the controllers.
			// A content script thus reads the mode the same way as the popup, see
			// transferredDataVolume.
			async getMode(moduleDefaultMode) {
				const settings = await readAllSettings();
				return getModuleMode(settings, settingsKey, moduleDefaultMode);
			},

			// Calls handler(settings) on every change of moduleSettings from anywhere
			// in the extension — so a content script does not have to know SETTINGS_KEY or
			// chrome.storage.onChanged. Returns a function to unsubscribe.
			onChange(handler) {
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					if (area === "local" && changes[SETTINGS_KEY]) {
						handler(/** @type {Types.ModuleSettings} */ (changes[SETTINGS_KEY].newValue || {}));
					}
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},
		},

		// The module's own state outside its settings — values the module
		// computes and remembers itself and the user does not edit in Settings (tabGroups:
		// the day tabs were last sorted). The settings (api.settings) are one
		// shared moduleSettings object, which the Settings page saves whole
		// at once, and frequent writes from elsewhere could fight with it. Here
		// each value has its own key in chrome.storage.local
		// ("moduleState.<module>.<key>"), the backup (api.backup) contains it.
		state: createStateArea("local"),

		// The same in chrome.storage.session — it lasts only until the browser restarts or
		// the extension is reloaded (then it is empty) and survives the service
		// worker going to sleep. For data tied to the browser run, e.g. tab numbers, which
		// stop being valid after a browser restart (tabGroups: the days tabs were
		// opened). Only extension pages and background.js, a content script does not have it.
		sessionState: createStateArea("session"),

		// Should the module work right now? For code that does not run as an element (that one
		// the controller does not render at all when the module should not work) — mainly
		// a module's background part (registerBackgroundScript()), whose listeners
		// are always registered.
		activation: {
			// The module is in the module list and its activationSpec (default
			// NOT_DISABLED_SPEC) holds for the current activation mode (user >
			// moduleDefaultMode > global default). Nothing here evaluates the surface (LocationSpecification)
			// or the active tab — the context is just { mode }.
			async isActive(moduleDefaultMode, activationSpec = NOT_DISABLED_SPEC) {
				const [settings, listed, replaced] = await Promise.all([readAllSettings(), isListed(), getReplacedModules()]);
				// A module another extension runs instead (an allowed client that is there, see "Modules from other
				// extensions") does not work here — tabGroups would sort the tabs twice.
				if (replaced.has(moduleName)) return false;
				return listed && activationSpec.isSatisfiedBy({ mode: getModuleMode(settings, moduleName, moduleDefaultMode) });
			},
			// Why the module does not work right now: "notListed" (not in the module list), "disabled" (its
			// activationSpec does not hold for the mode — typically turned off); null = it works (isActive()).
			// For the answers of a service (api.services), which say why they did nothing.
			async reason(moduleDefaultMode, activationSpec = NOT_DISABLED_SPEC) {
				const [settings, listed, replaced] = await Promise.all([readAllSettings(), isListed(), getReplacedModules()]);
				if (!listed) return "notListed";
				if (replaced.has(moduleName)) return "disabled";
				return activationSpec.isSatisfiedBy({ mode: getModuleMode(settings, moduleName, moduleDefaultMode) }) ? null : "disabled";
			},
			// Calls handler() on a change of the module list or moduleSettings (and thus
			// of the activation mode too) — the result of isActive() may have changed. Returns
			// a function to unsubscribe.
			onChange(handler) {
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					if (area === "local" && (changes[SETTINGS_KEY] || changes[MODULES_JSON_KEY] || changes[EXTENSION_SERVICE_CLIENTS_KEY])) {
						handler();
					}
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},
			// Calls handler(details) from chrome.runtime.onInstalled — after installation
			// (details.reason "install"), an update or a reload of the
			// extension ("update") —, once the core has filled in the default settings (see
			// notifyInstalled()). Only in a module's background part: register the listener
			// synchronously in setup(), on pages it is never called.
			// Whether the module should work (the "install" activation mode) it checks itself:
			// isActive(defaultMode, INSTALL_SPEC). Returns a function to unsubscribe.
			onInstalled(handler) {
				/** @type {Types.InstalledListener} */
				const listener = { moduleName, handler };
				installedListeners.push(listener);
				return () => {
					const index = installedListeners.indexOf(listener);
					if (index !== -1) installedListeners.splice(index, 1);
				};
			},
		},

		messages: {
			// Listens to messages with the given "type" from chrome.runtime.onMessage — outside
			// a custom element (a content script) the counterpart of
			// BaseElement.registerMessageHandler(). Returns a function to unsubscribe;
			// the handler may return true for an asynchronous sendResponse the same as with
			// a raw chrome.runtime.onMessage.addListener.
			on(type, handler) {
				// A cast instead of @type: the listener may return true (asynchronous
				// sendResponse), but the shape from @types/chrome declares a void return.
				const listener = /** @type {Types.RuntimeMessageListener} */ ((message, sender, sendResponse) => {
					if (message && message.type === type) {
						return handler(message, sender, sendResponse);
					}
				});
				chrome.runtime.onMessage.addListener(listener);
				// In background.js also for the messages of the other background parts (see deliverToBackgroundParts()).
				/** @type {Types.BackgroundPartListener | null} */
				const local = IN_BACKGROUND ? { moduleName, listener } : null;
				if (local) backgroundPartListeners.push(local);

				// A module element rendered inside the floating window's <iframe> has no
				// chrome.tabs, so sendMessageToActiveTab() sends the message through
				// window.parent.postMessage() (see FLOATING_RELAY_REQUEST above)
				// instead of chrome.tabs.sendMessage() — the content script on the real
				// page runs in the SAME realm as the <iframe>'s parent window
				// (both are injected by this extension), so the "message" event from
				// postMessage() arrives here normally. This listener catches such a
				// message and passes it to the same handler as the regular path —
				// the module (see analyticalTool) does not have to deal with the floating window at all,
				// and does not even notice the message took a different route. window.addEventListener
				// is always available in every real content script —
				// the check is just a defensive fallback for unusual/test environments.
				const hasWindowMessaging = typeof window !== "undefined" && typeof window.addEventListener === "function";
				/** @type {Functions.Base.createModuleApi.relayListener} */
				let relayListener;
				if (hasWindowMessaging) {
					relayListener = (event) => {
						const data = event.data;
						if (!data || data.type !== FLOATING_RELAY_REQUEST || !data.message || data.message.type !== type) {
							return;
						}
						/** @type {Functions.Base.createModuleApi.relaySendResponse} */
						const sendResponse = (response) => {
							// The source of the request is always a window (the floating window's <iframe>).
							/** @type {Window} */ (event.source).postMessage(
								/** @satisfies {Types.FloatingRelayResponse} */ ({ type: FLOATING_RELAY_RESPONSE, id: data.id, response }),
								event.origin || "*"
							);
						};
						handler(data.message, {}, sendResponse);
					};
					window.addEventListener("message", relayListener);
				}

				return () => {
					chrome.runtime.onMessage.removeListener(listener);
					if (local && backgroundPartListeners.includes(local)) backgroundPartListeners.splice(backgroundPartListeners.indexOf(local), 1);
					if (hasWindowMessaging) {
						window.removeEventListener("message", relayListener);
					}
				};
			},
			// Sends a message to the content script of the tab the surface relates to (see sendMessageToActiveTab()).
			toActiveTab(message) {
				return sendMessageToActiveTab(message);
			},
			// Broadcasts a message to all listeners in the extension (modules, background) —
			// typically from a module's content script "inward".
			// From a background part also to the listeners of the other background parts (deliverToBackgroundParts()).
			send(message) {
				if (IN_BACKGROUND) deliverToBackgroundParts(backgroundPartListeners, moduleName, message, { id: chrome.runtime.id, url: location.href });
				return chrome.runtime.sendMessage(message).catch(() => {});
			},
		},

		// Extension notifications (Web Notification) — see showExtensionNotification()
		// above. The module watches the permission for notifications itself (Chrome grants it by the
		// "notifications" permission in the manifest, Firefox by the standard
		// browser prompt, Notification.permission).
		notifications: {
			// Shows a notification of THIS module from anywhere (it is always shown by
			// background.js). options as for new Notification(), the data in them
			// must be convertible to JSON. In Chrome it resolves once shown and a display
			// error rejects it; in Firefox it resolves right away (the result is reported
			// only by the onEvent() events).
			async show(title, options = {}) {
				const response = await sendToBackground({ type: NOTIFICATION_SHOW_MESSAGE, module: moduleName, title: String(title), options });
				if (!response) throw new Error(t("core_background_no_response"));
				if (response.error) throw new Error(response.error);
			},
			// Calls handler(click) after every click on a notification of THIS module
			// ({ uid, data — the data of show(), action, at }) on any extension page —
			// also in the floating window and for a module without a background part
			// (a change of chrome.storage.local, see NOTIFICATION_CLICK_KEY_PREFIX). Only
			// clicks from now on, not an earlier one. Returns a function to unsubscribe.
			onClick(handler) {
				const storageKey = `${NOTIFICATION_CLICK_KEY_PREFIX}${moduleName}`;
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					const change = area === "local" ? changes[storageKey] : undefined;
					if (change && isPlainObject(change.newValue)) handler(/** @type {Types.NotificationClick} */ (change.newValue));
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},
			// Calls handler(event) about every notification the extension showed
			// through show() (any module), and about its progress: "create",
			// "show", "error", "click", "close" (event.module = who sent it,
			// event.uid = notification id). Only in a module's background part —
			// register the listener synchronously in setup(), a service worker
			// woken by a click on the notification would not call it otherwise. The service worker keeps
			// a promise returned by the listener alive until it settles. Returns
			// a function to unsubscribe.
			onEvent(handler) {
				/** @type {Types.NotificationListener} */
				const listener = { moduleName, handler };
				notificationListeners.push(listener);
				return () => {
					const index = notificationListeners.indexOf(listener);
					if (index !== -1) notificationListeners.splice(index, 1);
				};
			},
		},

		data: {
			// Stores any structured data of the module in the shared IndexedDB (through
			// background.js, see DATA_LOG_MESSAGE) — the background knows only
			// { module, payload }, the payload content is the module's business. The returned promise
			// resolves only after the write to IndexedDB (background.js responds after
			// completion), so a caller that waits for it can read the record right
			// afterwards through listForActiveTab() below (see visualHistory). Whoever
			// does not wait loses nothing — errors are just silently swallowed as before.
			// It resolves with an object { id } with the primary key of the new record, through
			// which it can be completed later (update() below); when the write
			// fails, the id is missing in it.
			// From a content script, documentKey is added to the record automatically (see
			// getDocumentKey()) — by it the record can later be paired with
			// records of OTHER modules from the same page visit (findByDocument()).
			// The optional options.key is the record's own key, by which the
			// module later finds its records through findByKey() — for data that do not
			// concern the page they are stored from (domainInfo: data about the domain of
			// an image or a script embedded in a foreign page).
			// From a module's background part the record is stored without a tab, an address and
			// a domain (tabId and url null) — listLatest() or findByKey() finds it.
			log(payload, options = {}) {
				const key = typeof options.key === "string" && options.key !== "" ? options.key : undefined;
				return sendToBackground({ type: DATA_LOG_MESSAGE, module: moduleName, payload, documentKey: getDocumentKey(), key }).catch(() => {});
			},
			// Records of THIS module stored from a specific document (tabId +
			// documentKey, typically taken from a record of another module — see
			// the details contract, level "visit"), newest first: [{ payload, tabId, url,
			// timestamp, documentKey }]. An empty array when the module stored nothing from that
			// document or documentKey is missing.
			async findByDocument({ tabId, documentKey }) {
				if (typeof tabId !== "number" || typeof documentKey !== "number") return [];
				try {
					const response = await sendToBackground({
						type: DATA_FIND_BY_DOCUMENT_MESSAGE,
						module: moduleName,
						tabId,
						documentKey,
					});
					return (response && response.entries) || [];
				} catch (err) {
					console.error("Nelze načíst záznamy modulu pro dokument:", err);
					return [];
				}
			},
			// Records of THIS module stored from pages of one domain (the key from
			// getDomainKey() — typically from the context of the details contract, level
			// "domain", or from api.tabs.getActive()), newest first:
			// [{ payload, tabId, url, timestamp, documentKey }]. The domain of a record
			// is the domain of the PAGE the content script stored it from. limit > 0
			// limits the count, without it all are returned.
			async findByDomain({ domain, limit } = {}) {
				if (typeof domain !== "string" || !domain) return [];
				try {
					const response = await sendToBackground({
						type: DATA_FIND_BY_DOMAIN_MESSAGE,
						module: moduleName,
						domain,
						limit,
					});
					return (response && response.entries) || [];
				} catch (err) {
					console.error("Nelze načíst záznamy modulu pro doménu:", err);
					return [];
				}
			},
			// Records of THIS module stored under its own key (options.key of
			// log() above), newest first: [{ payload, tabId, url, timestamp,
			// documentKey }]. Unlike findByDomain() the page the record was stored from
			// does not matter — the module chooses the key. limit > 0 limits the
			// count, without it all are returned.
			async findByKey({ key, limit } = {}) {
				if (typeof key !== "string" || !key) return [];
				try {
					const response = await sendToBackground({
						type: DATA_FIND_BY_KEY_MESSAGE,
						module: moduleName,
						key,
						limit,
					});
					return (response && response.entries) || [];
				} catch (err) {
					console.error("Nelze načíst záznamy modulu podle klíče:", err);
					return [];
				}
			},
			// Number of records this module stored through data.log().
			async count() {
				const response = await sendToBackground({
					type: DATA_COUNT_MESSAGE,
					module: moduleName,
				});
				return /** @type {Types.MessageResponse<'SDK_DATA_COUNT'>} */ (response).count;
			},
			// Number of records of absolutely all modules together (overall statistics, not
			// just this module) — see logger.
			async total() {
				const response = await sendToBackground({ type: DATA_TOTAL_MESSAGE });
				return /** @type {Types.MessageResponse<'SDK_DATA_TOTAL'>} */ (response).count;
			},
			// The last "limit" records of THIS module stored from the active
			// tab (by the tabId that background.js fills in for data.log() from
			// sender.tab), newest first: an array of { payload, tabId, url, timestamp }.
			// In the popup/sidebar/Settings the tabId is found out through chrome.tabs.query(); inside
			// the floating window's <iframe> there is no chrome.tabs (see hasTabsApi()), so there
			// the tabId is not sent at all and background.js uses sender.tab — the extension
			// iframe embedded in the page has it, and it is exactly the tab the
			// floating window is embedded in. A tab that cannot be determined = an empty array.
			// Only records of this run of the browser — tab ids start again after a restart (see
			// BROWSER_SESSION_START_KEY).
			async listForActiveTab(limit) {
				let tabId;
				if (hasTabsApi()) {
					// On the Settings page the last used OTHER tab, see
					// queryCurrentTab().
					const tab = await queryCurrentTab();
					tabId = tab && tab.id;
					if (typeof tabId !== "number") return [];
				}
				try {
					const response = await sendToBackground({
						type: DATA_LIST_MESSAGE,
						module: moduleName,
						tabId,
						limit,
					});
					return (response && response.entries) || [];
				} catch (err) {
					console.error("Nelze načíst záznamy modulu pro aktivní záložku:", err);
					return [];
				}
			},
			// The last "limit" records of THIS module regardless of the tab and
			// domain, newest first: [{ payload, tabId, url, timestamp,
			// documentKey }] — for an overview of everything the module has recorded (see
			// notificationsCenter). Works the same on every surface (the query does not depend
			// on the tab, and thus not on chrome.tabs either).
			async listLatest(limit) {
				try {
					const response = await sendToBackground({
						type: DATA_LATEST_MESSAGE,
						module: moduleName,
						limit,
					});
					return (response && response.entries) || [];
				} catch (err) {
					console.error("Nelze načíst poslední záznamy modulu:", err);
					return [];
				}
			},
			// Completes an already stored record of THIS module (the id from the response of log() above):
			// fields from "patch" replace the same-named fields of its payload, the others
			// stay. For a record whose further progress the module learns only after the
			// write (notificationsCenter: the notification was shown, the user clicked
			// it). It does not change a record of another module. Returns true when the
			// record was found and changed. Concurrent edits of the same record should be
			// ordered by the caller (wait for the previous one), otherwise an older
			// "patch" may overwrite a newer one.
			async update(id, patch) {
				if (typeof id !== "number" || !patch || typeof patch !== "object" || Array.isArray(patch)) return false;
				try {
					const response = await sendToBackground({
						type: DATA_UPDATE_MESSAGE,
						module: moduleName,
						id,
						patch,
					});
					return !!(response && response.updated);
				} catch (err) {
					console.error("Nelze doplnit záznam modulu:", err);
					return false;
				}
			},
			// Deletes one stored record of THIS module (the id from the record or from log()).
			// It does not delete a record of another module. Returns true when the record
			// was found and deleted.
			async remove(id) {
				if (typeof id !== "number") return false;
				try {
					const response = await sendToBackground({ type: DATA_REMOVE_MESSAGE, module: moduleName, id });
					return !!(response && response.removed);
				} catch (err) {
					console.error("Nelze smazat záznam modulu:", err);
					return false;
				}
			},
		},

		// A shared rate limit (see RATE_LIMITS_KEY above) — for a module that
		// queries a foreign server and must not flood it from all tabs at once.
		// The key (bucket, typically the server name) is chosen by the module, the core keeps it
		// separately for each module. It is counted by background.js, so the limit applies to
		// the whole extension — content scripts of all tabs, the popup, the side panel.
		rateLimit: {
			// May one operation run now? windows = [{ max, ms }] — at most
			// max operations per ms milliseconds (possibly several windows at once, e.g. per
			// second and per minute). { granted: true } counts the operation right away;
			// otherwise waitMs says how long until it should be tried again, and
			// blockedUntil that the key is blocked (block() below). When
			// background.js cannot be asked, it rather does not allow it (waitMs 10 s).
			async acquire(bucket, windows) {
				try {
					const response = await sendToBackground({
						type: RATE_LIMIT_ACQUIRE_MESSAGE,
						module: moduleName,
						bucket,
						windows: normalizeRateLimitWindows(windows),
					});
					if (response && typeof response.granted === "boolean") return response;
				} catch (err) {
					console.error("Nelze zjistit sdílený limit:", err);
				}
				return { granted: false, waitMs: 10000, blockedUntil: null };
			},
			// Blocks the key for ms (e.g. the server does not respond) — acquire() allows
			// nothing until then, anywhere in the extension. ms <= 0 cancels the block.
			// Returns the end of the block, or null.
			async block(bucket, ms) {
				try {
					const response = await sendToBackground({ type: RATE_LIMIT_BLOCK_MESSAGE, module: moduleName, bucket, ms });
					return (response && response.blockedUntil) || null;
				} catch (err) {
					console.error("Nelze nastavit blokaci sdíleného limitu:", err);
					return null;
				}
			},
			// Key state for display: { blockedUntil, times } (times of operations that
			// still count toward some window, ascending).
			async getState(bucket) {
				try {
					const response = await sendToBackground({ type: RATE_LIMIT_STATE_MESSAGE, module: moduleName, bucket });
					if (response && Array.isArray(response.times)) return response;
				} catch (err) {
					console.error("Nelze zjistit stav sdíleného limitu:", err);
				}
				return { blockedUntil: null, times: [] };
			},
		},

		tabs: {
			// The tab the surface the element runs on relates to —
			// { tabId, url, domain }, or null. In the popup/sidebar the active
			// tab, on the Settings page the last used other tab (see
			// queryCurrentTab()), inside the floating window's <iframe> (without
			// chrome.tabs) the tab the window is embedded in — that one is known to
			// background.js from sender.tab (GET_SENDER_TAB_MESSAGE). "domain" is
			// the key from getDomainKey(), the same one the core stores with records; null
			// for non-web pages or without access to the tab's URL (a host
			// permission).
			getActive() {
				return readActiveTab();
			},
			// handler(tab) — the same value as getActive() — after another tab became the one the
			// surface relates to, or that one got a new address (watchActiveTab()): for a surface that
			// outlives a switch of tabs (the side panel, Settings) and for web apps that change the
			// address without loading a page. Returns a function to unsubscribe.
			onChange(handler) {
				return watchActiveTab(handler);
			},
			// A page of the extension itself in a new tab — only one of
			// OPENABLE_EXTENSION_PAGES (Settings, the welcome page), e.g. for a link in an
			// uploaded module: its sandbox page has an opaque origin and the browser does not
			// let it open the extension pages. Without chrome.tabs (the floating window's
			// <iframe> in Firefox) via window.open().
			async openExtensionPage(page) {
				if (!OPENABLE_EXTENSION_PAGES.includes(page)) {
					throw new Error(t("core_extension_page_not_allowed", String(page)));
				}
				const url = chrome.runtime.getURL(page);
				if (typeof chrome.tabs?.create === "function") {
					await chrome.tabs.create({ url });
				} else {
					window.open(url);
				}
			},
		},

		floatingWindow: {
			// The whole stored floating window state for all domains — for
			// administrative/overview modules; the overview table
			// floatingWindowOverviewSandbox (an uploaded module) gets it through the
			// functions of the catalog floatingWindow.getAllStates/onChange and
			// changes it record by record (floatingWindow.updateStates), never
			// with setAllStates(). For the floating window on a page itself (one specific domain) there are
			// loadFloatingWindowState/saveFloatingWindowState above in this
			// file — those are used only by the core content script
			// (content-scripts/floating-window.js), not by modules.
			getAllStates: readAllFloatingWindowStates,
			setAllStates: writeAllFloatingWindowStates,
			onChange(handler) {
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					if (area === "local" && changes[FLOATING_WINDOW_STATE_KEY]) {
						handler(changes[FLOATING_WINDOW_STATE_KEY].newValue || {});
					}
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},

			// Opens or closes the floating window on the tab the surface relates
			// to (the same as for tabs.getActive() below: in the popup/sidebar
			// the active tab, on the Settings page the last used other one) —
			// depending on whether it is there right now; the content script
			// of the floating window decides that, not the caller. The window needs PAGE_ACCESS_PERMISSIONS
			// and this requests them by itself on first use, so it must be
			// called directly from a click handler (an uploaded module: the function floatingWindow.toggle
			// on a button the core draws, see mainButtonsSandbox).
			//
			// contains() and request() are both started right away, before the first await:
			// the browser accepts request() only as a direct reaction to a user
			// gesture (Firefox no longer recognizes the gesture after await) and contains()
			// started right before it returns the state BEFORE a possible grant. For an already
			// granted permission request() just returns true right away, without asking the
			// user — so only a real request is written into the permission history
			// (permissions.getActivity()), not every click.
			//
			// Depending on whether the permission already existed, or is being granted only by this
			// click, the window is toggled in one of two ways (formerly the
			// instruction was always sent, which on the very first grant of the permission closed the window
			// again right away and saved it as closed — a reported bug):
			//   1. The permission already existed — the content script runs on the page and knows
			//      the current window state, it is enough to send it TOGGLE_FLOATING_WINDOW_MESSAGE.
			//   2. The permission was granted just now — a dynamically registered content
			//      script is injected only into pages loaded AFTER the grant, so it is
			//      injected into the tab directly. It then shows itself according to the stored state
			//      (for a new domain it does); an extra instruction would immediately toggle it
			//      back.
			//
			// Inside the floating window's <iframe> (without chrome.tabs and
			// chrome.permissions, see hasTabsApi()) the window obviously exists,
			// so toggling closes it — background.js sends the instruction to the tab it is embedded in
			// on its behalf (TOGGLE_SENDER_FLOATING_WINDOW_MESSAGE).
			async toggle() {
				if (!hasTabsApi() || !hasPermissionsApi()) {
					try {
						await sendToBackground({ type: TOGGLE_SENDER_FLOATING_WINDOW_MESSAGE });
					} catch (err) {
						console.error("Nelze přepnout plovoucí okno (přes background.js):", err);
					}
					return;
				}

				const hadAccessPromise = chrome.permissions.contains(PAGE_ACCESS_PERMISSIONS).catch(() => false);
				const grantedPromise = chrome.permissions.request(PAGE_ACCESS_PERMISSIONS).catch((err) => {
					console.error("Nelze vyžádat oprávnění pro plovoucí okno:", err);
					return false;
				});
				const hadAccessAlready = await hadAccessPromise;
				const granted = await grantedPromise;
				if (!hadAccessAlready) {
					await logPermissionActivity("request", granted ? "granted" : "denied", PAGE_ACCESS_PERMISSIONS);
					if (!granted) return;
				}

				const tab = await queryCurrentTab();
				if (!tab || typeof tab.id !== "number") return;

				if (hadAccessAlready) {
					await chrome.tabs.sendMessage(tab.id, { type: TOGGLE_FLOATING_WINDOW_MESSAGE }).catch(() => {});
					return;
				}
				try {
					await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [FLOATING_WINDOW_SCRIPT] });
				} catch (err) {
					// Most often because the page does not allow injection (chrome://,
					// Web Store, an empty new tab, ...) — harmless, just logged.
					console.error("Vložení plovoucího okna do záložky selhalo:", err);
				}
			},
		},

		permissions: {
			// Finds out whether the given set of permissions (a shape like
			// chrome.permissions.contains — { permissions, origins }) is already
			// granted, without the module having to deal with chrome.permissions directly.
			// Typically PAGE_ACCESS_PERMISSIONS above, but a module may ask for
			// another permission too (see testInjection — only "scripting", without
			// <all_urls>, because activeTab already covers the active tab).
			async contains(permissions) {
				// chrome.permissions is not available inside the floating window's <iframe>
				// (see hasPermissionsApi above) — reading (unlike request() below)
				// does not need a user gesture, so it can be safely redirected to
				// background.js, which always has chrome.permissions.
				if (!hasPermissionsApi()) {
					try {
						const response = await sendToBackground({
							type: PERMISSIONS_CONTAINS_MESSAGE,
							permissions,
						});
						return !!(response && response.contains);
					} catch (err) {
						console.error("Nelze zjistit oprávnění (přes background.js):", err);
						return false;
					}
				}
				try {
					return await chrome.permissions.contains(permissions);
				} catch (err) {
					console.error("Nelze zjistit oprávnění:", err);
					return false;
				}
			},
			// Must be called in a direct reaction to a user gesture (a click) —
			// Chrome and Firefox would otherwise silently reject the request. Returns true only
			// when the user really granted the permission. The result is also
			// logged (see getActivity() below) under the name of THIS module — the
			// extensionPermissionsManager module can thus show for each permission who
			// requested it when.
			//
			// Unlike contains() above this can NOT be redirected to background.js
			// when chrome.permissions is missing (typically the floating window's <iframe>):
			// "user gesture activation" is tied to the SPECIFIC frame in which it
			// happened, and is not carried over chrome.runtime.sendMessage() to the
			// service worker — even if background.js called chrome.permissions.
			// request() there, Chrome would reject it the same as if it
			// ran entirely outside a gesture. So a module (see analyticalTool) must
			// recognize such a situation itself (window.chrome.permissions is missing) and
			// direct the user to grant the permission from the popup/side
			// panel, not offer a button that always fails anyway.
			async request(permissions) {
				if (!hasPermissionsApi()) {
					console.warn(
						"chrome.permissions není v tomhle kontextu dostupné (typicky plovoucí okno) — oprávnění tu nejde vyžádat, otevři popup nebo postranní panel."
					);
					await logPermissionActivity("request", "unavailable", permissions);
					return false;
				}
				let granted = false;
				try {
					granted = await chrome.permissions.request(permissions);
				} catch (err) {
					console.error("Nelze vyžádat oprávnění:", err);
				}
				await logPermissionActivity("request", granted ? "granted" : "denied", permissions);
				return granted;
			},
			// Revokes a previously granted permission — for modules this usually makes no sense
			// (they would not request their own permission just to revoke it right away),
			// it serves mainly the extensionPermissionsManager module for the "Revoke" button of
			// any permission. This intervention is logged too.
			async remove(permissions) {
				let removed = false;
				try {
					removed = await chrome.permissions.remove(permissions);
				} catch (err) {
					console.error("Nelze zrušit oprávnění:", err);
				}
				await logPermissionActivity("remove", removed ? "removed" : "failed", permissions);
				return removed;
			},
			// A log of who (a module name, or the name of extensionPermissionsManager itself
			// on a manual intervention from its UI) requested or revoked the given permission/origin
			// when, and with what result — an array of { module, action, outcome, at }
			// sorted from the oldest. An empty array when nobody has requested it yet
			// through api.permissions.request()/remove().
			async getActivity(permissionOrOrigin) {
				return new Promise((resolve) => {
					chrome.storage.local.get([PERMISSION_ACTIVITY_KEY], (/** @type {Types.StorageLocal} */ result) => {
						resolve(/** @type {Types.PermissionActivityLog} */ (result[PERMISSION_ACTIVITY_KEY] || {})[permissionOrOrigin] || []);
					});
				});
			},
			// Calls handler() on any change of the granted permissions OR of the
			// activity (see getActivity() above), whether caused by this module,
			// another module, or the user removing the permission directly in the browser
			// settings. Returns a function to unsubscribe.
			//
			// It deliberately listens to both (chrome.permissions.onAdded/onRemoved
			// and chrome.storage.onChanged on PERMISSION_ACTIVITY_KEY), not just to the
			// first of them: request()/remove() first calls
			// chrome.permissions.request()/remove() (which triggers onAdded/onRemoved)
			// and only THEN writes the activity log — the order in which a
			// module watching only onAdded/onRemoved would see "who asked for it" in
			// getActivity() would thus not be guaranteed. The extensionPermissionsManager module
			// re-renders reliably in both cases this way.
			//
			// Older browsers may not have chrome.permissions.onAdded/onRemoved
			// (the same defense as in background.js) — without them only the
			// storage change is used; requesting/revoking the permission itself (see request()/
			// remove() above) does not depend on it.
			onChange(handler) {
				/** @type {Types.PermissionsChangeListener} */
				const listener = () => handler();
				/** @type {Types.StorageChangeListener} */
				const storageListener = (changes, area) => {
					if (area === "local" && changes[PERMISSION_ACTIVITY_KEY]) {
						handler();
					}
				};

				const hasPermissionEvents = chrome.permissions?.onAdded && chrome.permissions?.onRemoved;
				if (hasPermissionEvents) {
					chrome.permissions.onAdded.addListener(listener);
					chrome.permissions.onRemoved.addListener(listener);
				}
				chrome.storage.onChanged.addListener(storageListener);

				return () => {
					if (hasPermissionEvents) {
						chrome.permissions.onAdded.removeListener(listener);
						chrome.permissions.onRemoved.removeListener(listener);
					}
					chrome.storage.onChanged.removeListener(storageListener);
				};
			},
		},

		// Coloring the extension icon according to whether the current page is a
		// bookmark in a specific bookmark folder (see BADGE_RULES_KEY and
		// bookmarkFolderContainsUrl above) — background.js applies them with a generic
		// pass over chrome.bookmarks, without knowing the name of THIS module.
		badge: {
			// Replaces the WHOLE rule set of this module (not adding/merging),
			// the same pattern as settings.setAll() — an empty array turns the icon off for this
			// module. rules: [{ folderId, color, text }, ...].
			async setRules(rules) {
				return new Promise((resolve) => {
					chrome.storage.local.get([BADGE_RULES_KEY], (/** @type {Types.StorageLocal} */ result) => {
						/** @type {Types.BadgeRulesStore} */
						const all = { ...(result[BADGE_RULES_KEY] || {}) };
						all[moduleName] = Array.isArray(rules) ? rules : [];
						chrome.storage.local.set({ [BADGE_RULES_KEY]: all }, resolve);
					});
				});
			},
			async getRules() {
				return new Promise((resolve) => {
					chrome.storage.local.get([BADGE_RULES_KEY], (/** @type {Types.StorageLocal} */ result) => {
						resolve(/** @type {Types.BadgeRulesStore} */ (result[BADGE_RULES_KEY] || {})[moduleName] || []);
					});
				});
			},
		},

		// Dynamic network request rules (chrome.declarativeNetRequest)
		// — see NETWORK_RULES_KEY above. set() replaces the WHOLE rule set of this
		// module (rules without ids; an empty array cancels all of them) and returns how they
		// ended up in the browser. The rules apply while the module is in the module list
		// and not turned off — background.js watches that itself, even when no
		// extension page is open. background.js gets to the module's default mode
		// only from here (from the page's module registry), so it is sent with them.
		// With options.bulk these are bulk rules (see
		// NETWORK_RULES_BULK_MAX_PRIORITY): the lowest priority layer, only into the
		// free space, rejected ones are skipped; the status then also states dropped
		// and rejected.
		networkRules: {
			async set(rules, options) {
				const moduleDef = (globalThis.__extensionModules || []).find((m) => m.name === moduleName);
				try {
					const response = await sendToBackground({
						type: NETWORK_RULES_SET_MESSAGE,
						module: moduleName,
						rules: sanitizeNetworkRules(rules),
						...(options && options.bulk ? { bulk: true } : {}),
						...(moduleDef && moduleDef.defaultActivationMode ? { defaultMode: moduleDef.defaultActivationMode } : {}),
					});
					if (response && response.status) return response.status;
					return { active: 0, reason: "error", error: t("core_background_no_response") };
				} catch (err) {
					console.error("Nelze nastavit pravidla síťových požadavků:", err);
					return { active: 0, reason: "error", error: /** @type {Error} */ (err).message || String(err) };
				}
			},
			async getStatus() {
				try {
					const response = await sendToBackground({ type: NETWORK_RULES_STATUS_MESSAGE, module: moduleName });
					if (response && response.status) return response.status;
					return { active: 0, reason: "error", error: t("core_background_no_response") };
				} catch (err) {
					return { active: 0, reason: "error", error: /** @type {Error} */ (err).message || String(err) };
				}
			},
		},

		// The consumer side of the details contract (see registerModule above):
		// collects details at one level from ALL registered modules
		// that offer them (except turned-off ones and the caller itself). The module registry
		// is filled in extension pages (popup, sidebar, floating
		// window, Settings — all of them import the module files), in a content
		// script it is empty.
		details: {
			// Whether any enabled module at all (except the caller) offers details at the
			// given level — the consumer can omit the block based on that.
			async hasProviders(scope) {
				return (await getEnabledDetailsProviders(scope)).length > 0;
			},
			// scope: "visit" | "domain" | "browser"; context according to the level
			// (see DETAILS_CONTEXT_VALIDATORS). Returns [{ module, title, items:
			// [{ label, value }] }] only with non-empty results, in the order of
			// module registration; title is the module name as shown by
			// the Settings page (formatModuleName()). An invalid level or
			// context = an empty array.
			// One implementation for all overloads of Types.ModuleDetailsApi.collect —
			// DETAILS_CONTEXT_VALIDATORS verifies the validity of the context for the level.
			/**
			 * @param {Enums.DetailsScope} scope
			 * @param {Types.DetailsContextInput} [context]
			 * @returns {Promise<Types.CollectedDetails[]>}
			 */
			async collect(scope, context = {}) {
				if (!DETAILS_SCOPES.includes(scope) || !DETAILS_CONTEXT_VALIDATORS[scope](context)) return [];
				const providers = await getEnabledDetailsProviders(scope);
				const results = await Promise.all(
					providers.map(async (m) => {
						try {
							const items = await withTimeout(
								// The level's provider is guaranteed by getEnabledDetailsProviders(), the context
								// was verified by DETAILS_CONTEXT_VALIDATORS above. The provider's time goes into the
								// load measurement of ITS module (see perf.mjs).
								Promise.resolve().then(() =>
									measurePerf(m.name, `details:${scope}`, () =>
										/** @type {Types.DetailsProvider} */ (/** @type {Types.DetailsProviders} */ (m.details)[scope])({ ...context, api: createModuleApi(m.name) })
									)
								),
								DETAILS_PROVIDER_TIMEOUT_MS
							);
							const valid = (Array.isArray(items) ? items : []).filter(
								(i) => i && typeof i.label === "string" && i.value !== undefined && i.value !== null
							);
							return valid.length > 0
								? {
										module: m.name,
										title: formatModuleName(m.name),
										items: valid.map((i) => ({ label: i.label, value: String(i.value) })),
									}
								: null;
						} catch (err) {
							console.error(`details.${scope} modulu "${m.name}" selhalo:`, err);
							return null;
						}
					})
				);
				return /** @type {Types.CollectedDetails[]} */ (results.filter(Boolean));
			},
			// handler() after a provider of the level (a registered module offering details at the
			// level, except the caller) stored, changed or deleted its record that can concern the
			// context — the consumer collects again (collect()), e.g. after the providers recorded the
			// page that just loaded, or a later change of it (a title, a manifest, a WebAuthn
			// ceremony). background.js reports every finished write (DATA_CHANGED_MESSAGE): a stored
			// record counts only for its own context (DETAILS_CHANGE_MATCHERS), a changed or deleted one
			// for every context (where it came from is not known). Changes in a row make one call
			// (DETAILS_CHANGE_DELAY_MS). Only on extension pages (a content script gets no runtime
			// message of background.js). An invalid level or context = no calls. Returns a function
			// to unsubscribe.
			// One implementation for all overloads of Types.ModuleDetailsApi.onChange.
			/**
			 * @param {Enums.DetailsScope} scope
			 * @param {Types.DetailsContextInput} context
			 * @param {() => void} handler
			 * @returns {() => void}
			 */
			onChange(scope, context, handler) {
				if (!DETAILS_SCOPES.includes(scope) || !isPlainObject(context) || !DETAILS_CONTEXT_VALIDATORS[scope](context)) return () => {};
				/** @type {ReturnType<typeof setTimeout> | null} */
				let timer = null;
				/** @type {Types.RuntimeMessageListener} */
				const listener = (message) => {
					const change = /** @type {Types.DataChange | null | undefined} */ (message && message.type === DATA_CHANGED_MESSAGE ? message : null);
					if (!change || typeof change.module !== "string" || change.module === moduleName) return;
					if (change.change === "log" && !DETAILS_CHANGE_MATCHERS[scope](context, change)) return;
					const provider = (globalThis.__extensionModules || []).some(
						(m) => m.name === change.module && m.details && typeof m.details[scope] === "function"
					);
					if (!provider) return;
					if (timer !== null) clearTimeout(timer);
					timer = setTimeout(() => {
						timer = null;
						handler();
					}, DETAILS_CHANGE_DELAY_MS);
				};
				chrome.runtime.onMessage.addListener(listener);
				return () => {
					chrome.runtime.onMessage.removeListener(listener);
					if (timer !== null) clearTimeout(timer);
					timer = null;
				};
			},
		},

		// Export/import of the WHOLE chrome.storage.local at once — the only generic
		// capability of the core that the importExport module needs for backup/restore
		// of the whole extension (all modules, not just its own). The core here intentionally
		// does not know the name/shape of any specific key (SETTINGS_KEY,
		// MODULES_JSON_KEY, FLOATING_WINDOW_STATE_KEY, ...) — it just reads/writes
		// "everything that is there", so it stays generic and does not need changes when
		// another key is added anywhere else in the core. The only exception is
		// BROWSER_SESSION_START_KEY — it describes this run of the browser, not a setting.
		backup: {
			async exportAll() {
				/** @type {Types.StorageLocal} */
				const all = await new Promise((resolve) => {
					chrome.storage.local.get(null, (result) => resolve(result));
				});
				delete all[BROWSER_SESSION_START_KEY];
				return all;
			},
			// Replaces the WHOLE content of chrome.storage.local (first clear(), then
			// set()) — not a merge. For "restore the whole extension from a backup" this is
			// the right meaning: keys the backup does not have (e.g. from an extension version
			// BEFORE some key was added) should not keep hanging around after the restore.
			// The start of this run of the browser stays (an older backup may still carry one).
			async importAll(data) {
				const sessionStart = await readBrowserSessionStart();
				/** @type {Types.StorageLocal} */
				const restored = { ...(data || {}) };
				delete restored[BROWSER_SESSION_START_KEY];
				if (sessionStart !== null) restored[BROWSER_SESSION_START_KEY] = sessionStart;
				await new Promise((resolve) => {
					chrome.storage.local.clear(() => {
						chrome.storage.local.set(restored, () => resolve(undefined));
					});
				});
				// A backup from an older version may still have modules the extension
				// replaced since — their entries and settings move over (the same as after an update).
				try {
					await migrateRenamedModules();
					await migrateSharedSettings();
				} catch (err) {
					console.error("Přejmenované moduly v obnovené záloze nejde převést:", err);
				}
				// The record of a module the extension brings itself may be another one now — the
				// next page checks its files again (see ensureBundledSandboxModules()).
				try {
					await chrome.storage.session?.remove(BUNDLED_SANDBOX_CHECKED_KEY);
				} catch {
					// Without chrome.storage.session nothing is remembered.
				}
			},
			// Backup of ONE module (by name, not only the caller) — settings,
			// api.state, api.data records and the module's own data (backupData), see
			// exportModuleBackup()/importModuleBackup() above. Only from an extension
			// page: only background.js gives out and overwrites records, and only to it.
			// A module whose data a client keeps (another extension runs it instead of this
			// one) is backed up and restored in the client — see "Modules from other extensions".
			exportModule: exportModuleBackupWithClients,
			importModule: importModuleBackupWithClients,
			listClientModules: listClientBackupModules,
		},

		// The server IP address for the CURRENT page — JS otherwise (a content
		// script, fetch()) has no access to it at all. background.js finds it out
		// by generically listening to chrome.webRequest.onResponseStarted (see there),
		// without knowing the name of the module that asks — the core here just relays
		// the query for "the IP of this tab", the same as for the other generic
		// api.* capabilities. Without WEBREQUEST_PERMISSIONS granted, background.js
		// never records any IP and null is returned, not an error.
		network: {
			// For a content script: the HTTP redirect chain (the Location header)
			// by which the tab got to its CURRENT document —
			// { finalUrl, redirects: [{ url, redirectUrl, statusCode, internal,
			// timeStamp }] } from the first redirect, or null (without
			// WEBREQUEST_PERMISSIONS, a page loaded before it was granted, ...).
			// internal = the redirect was done by the browser itself (an upgrade to HTTPS,
			// an extension, ...), not by the server — statusCode then says nothing (Firefox 0,
			// for a redirect by an extension even 200). finalUrl is the address of the document
			// the chain belongs to, timeStamp the start of its response.
			// For a content script: HOW the tab got to its CURRENT document
			// — { url, transitionType, transitionQualifiers, timeStamp } from
			// chrome.webNavigation.onCommitted of the main frame, or null (without
			// WEBNAVIGATION_PERMISSIONS, a page loaded before it was granted,
			// ...).
			// background.js keeps only the tab's last data, and the tab may have meanwhile
			// started loading another page — or (Firefox) has not yet delivered the event of THIS
			// navigation. So the caller passes its document
			// { url: the address from Navigation Timing, timeOrigin: performance.timeOrigin }:
			// it gets only the data for it, for which background.js may wait a while
			// (see answerForDocument() there), otherwise null (see
			// visualHistory/content-script.js). Without forDocument the last data.
			async getNavigationTransition(forDocument) {
				try {
					const response = await sendToBackground({ type: GET_TAB_NAVIGATION_MESSAGE, ...forDocument });
					return (response && response.navigation) || null;
				} catch (err) {
					console.error("Nelze zjistit typ navigace:", err);
					return null;
				}
			},
			async getRedirectChain(forDocument) {
				try {
					const response = await sendToBackground({ type: GET_TAB_REDIRECTS_MESSAGE, ...forDocument });
					return (response && response.chain) || null;
				} catch (err) {
					console.error("Nelze zjistit řetězec přesměrování:", err);
					return null;
				}
			},
			async getIpForActiveTab() {
				if (!hasTabsApi()) return null;
				let tab;
				try {
					[tab] = await chrome.tabs.query({ active: true, currentWindow: true });
				} catch {
					return null;
				}
				if (!tab || !tab.id) return null;
				try {
					const response = await sendToBackground({ type: GET_TAB_IP_MESSAGE, tabId: tab.id });
					return (response && response.ip) || null;
				} catch (err) {
					console.error("Nelze zjistit IP adresu aktivní záložky:", err);
					return null;
				}
			},
		},

		// The DevTools protocol through chrome.debugger — Chrome only, with the optional
		// DEBUGGER_PERMISSIONS permission. Chrome does not allow extensions all protocol
		// domains (e.g. it rejects ServiceWorker.* as "wasn't found"),
		// what passes has to be verified in a real browser.
		// Functions of the catalog of uploaded modules the module's background part does itself (see
		// "Services of background parts" above): provide() in setup() of the background part, changed()
		// says that what a listener of the service follows has changed (for a service provider that shows
		// the module — see "Modules from other extensions"; without one it does nothing). use() and call() — a service
		// of another module, wherever it runs (see "Services of other modules" above).
		services: {
			use(name, about) {
				return useModuleService(moduleName, name, about);
			},
			call(name, args = []) {
				return callRoutedModuleService(name, args, null);
			},
			provide(name, handler) {
				if (typeof handler !== "function") throw new Error(`Služba "${String(name)}" modulu "${moduleName}" nemá funkci.`);
				return provideBackgroundService(moduleName, name, handler);
			},
			// A listener the background part feeds with changed() — a service provider subscribes to it.
			provideListener(name) {
				return provideBackgroundService(moduleName, name, null);
			},
			changed(name, value) {
				notifyServiceChange(name, value);
			},
		},

		debugger: {
			// Protocol targets (tabs, running workers, ...) without attaching the
			// debugger, i.e. without the debugging infobar — it can be called often. An extension
			// page calls it directly, the floating window (without chrome.debugger) through
			// background.js.
			async getTargets() {
				if (typeof chrome.debugger !== "undefined" && typeof chrome.debugger.getTargets === "function") {
					return chrome.debugger.getTargets();
				}
				const response = await sendToBackground({ type: DEBUGGER_TARGETS_MESSAGE });
				if (!response || !response.targets) {
					throw new Error((response && response.error) || t("core_debugger_targets_failed"));
				}
				return response.targets;
			},
			// Attaches the debugger to the target ({ tabId } or { targetId }), sends the commands
			// ({ method, params }) one after another and detaches it — always in background.js
			// (see DEBUGGER_COMMANDS_MESSAGE). Returns the result of each command
			// separately ({ result } or { error }); an attachment error throws an exception.
			async sendCommands(debuggee, commands) {
				const response = await sendToBackground({ type: DEBUGGER_COMMANDS_MESSAGE, debuggee, commands });
				if (!response || !response.results) {
					throw new Error((response && response.error) || t("core_debugger_commands_failed"));
				}
				return response.results;
			},
		},

		// Module load measurement (see perf.mjs): the switch for the whole extension and
		// the overview of measured values. Any module may turn the measurement on and
		// becomes its owner — when it disappears from the module list or is turned off,
		// background.js turns the measurement off (nobody would see the results, and it would keep
		// measuring). background.js gives the overview only to extension pages (it contains
		// visited domains), so it cannot be read from a module's background part.
		perf: {
			async getState() {
				try {
					const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(PERF_STATE_KEY));
					return perfStateFromSwitch(stored[PERF_STATE_KEY]);
				} catch (err) {
					console.error("Nelze zjistit stav měření zátěže:", err);
					return perfStateFromSwitch(null);
				}
			},
			// Turns the measurement on (an already running one keeps its start, only the
			// owner changes), or turns it off. Turning it off does not delete the measured values.
			async setEnabled(enabled) {
				if (!enabled) {
					await chrome.storage.local.remove(PERF_STATE_KEY);
					return;
				}
				const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(PERF_STATE_KEY));
				const current = perfStateFromSwitch(stored[PERF_STATE_KEY]);
				const moduleDef = (globalThis.__extensionModules || []).find((m) => m.name === moduleName);
				/** @type {Types.PerfSwitch} */
				const entry = {
					owner: moduleName,
					since: current.since ?? Date.now(),
					...(moduleDef && moduleDef.defaultActivationMode ? { defaultMode: moduleDef.defaultActivationMode } : {}),
				};
				await chrome.storage.local.set({ [PERF_STATE_KEY]: entry });
			},
			// Calls handler(state) when the measurement is turned on/off from anywhere. Returns
			// a function to unsubscribe.
			onChange(handler) {
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					if (area === "local" && changes[PERF_STATE_KEY]) handler(perfStateFromSwitch(changes[PERF_STATE_KEY].newValue));
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},
			// Overview of the measured values — overall totals, one domain in detail
			// (domain, typically from api.tabs.getActive()), the domains with the highest
			// load and module totals by activation modes. First
			// what this page itself measured is sent. The module's default mode
			// (background.js does not know it) is replaced by the real one according to the module
			// registry — the same priority as getModuleMode().
			async getStats(domain = null) {
				flushPerf();
				try {
					const response = await sendToBackground({ type: PERF_GET_MESSAGE, domain });
					const snapshot = (response && response.snapshot) || null;
					if (!snapshot) return null;
					const registry = globalThis.__extensionModules || [];
					return resolvePerfModes(snapshot, (module) => {
						const moduleDef = registry.find((m) => m.name === module);
						return moduleDef ? moduleDef.defaultActivationMode || DEFAULT_MODE : null;
					});
				} catch (err) {
					console.error("Nelze načíst přehled měření zátěže:", err);
					return null;
				}
			},
			async reset() {
				try {
					const response = await sendToBackground({ type: PERF_RESET_MESSAGE });
					return !!(response && response.ok);
				} catch (err) {
					console.error("Nelze vynulovat přehled měření zátěže:", err);
					return false;
				}
			},
			// A custom code section of the module that the hooks do not catch (typically work after
			// await on fetch() or chrome.* directly) — the kind "measure:<label>".
			measure(label, fn) {
				return measurePerf(moduleName, `measure:${String(label)}`, fn);
			},
		},
	};
	return instrumentModuleApi(moduleName, api);
}

// base.mjs is also imported in background.js, which in Chrome runs as a real
// Service Worker without DOM — HTMLElement does not exist there and "class X extends
// HTMLElement" would throw a ReferenceError right when defining the class (even before
// the message listeners in background.js manage to register). A safe
// fallback base makes sure base.mjs can always be imported everywhere, even though
// the custom elements themselves are usable only in a realm with a real DOM.
// Typed always as HTMLElement — BaseElement is instantiated only in a realm with a real DOM.
const HTMLElementOrFallback = /** @type {typeof HTMLElement} */ (typeof HTMLElement !== "undefined" ? HTMLElement : class {});

/** @implements {Classes.BaseElement} */
export class BaseElement extends /** @type {Types.WithFields<typeof HTMLElement, Classes.BaseElement.Fields>} */ (HTMLElementOrFallback) {
	// No HTML attributes are observed by default — modules are configured
	// through init(), not through attributes. Specific modules can still declare their own
	// observedAttributes if they need them.
	/** @type {typeof Classes.BaseElement.observedAttributes} */
	static get observedAttributes() {
		return [];
	}

	constructor() {
		super();
		/** @type {Classes.BaseElement['_name']} */
		this._name = "";
		/** @type {Classes.BaseElement['_mode']} */
		this._mode = "popup";
		/** @type {Classes.BaseElement['_instance']} */
		this._instance = null;
		// Left unset on purpose — init() computes it itself from the registry
		// (globalThis.__extensionModules), according to what the module declared in
		// registerModule({ activationSpec }). A module can still set activationSpec
		// here in the constructor too (an older style, see bookmarkChecker before
		// module.mjs was introduced) — then this explicit value takes precedence and
		// init() does not ask the registry at all.
		/** @type {Classes.BaseElement['activationSpec']} */
		this.activationSpec = undefined;
		// References to listeners registered through registerMessageHandler(),
		// so they can be properly unsubscribed in disconnectedCallback().
		/** @type {Classes.BaseElement['_messageListeners']} */
		this._messageListeners = [];
	}

	// --- Custom Elements lifecycle: the common base ---
	// Specific modules have their own (even if empty) overrides for the sake of
	// a uniform API across modules; they call super.*() so the cleanup registered
	// here is not broken.

	/** @type {Classes.BaseElement['connectedCallback']} */
	connectedCallback() {
		// Default behavior: nothing. Modules build their own content/UI
		// in their own connectedCallback() after being connected to the DOM.
	}

	/** @type {Classes.BaseElement['disconnectedCallback']} */
	disconnectedCallback() {
		// Unsubscribe all message listeners registered through
		// registerMessageHandler() — otherwise after the element is disconnected (e.g. on
		// "Save"/"Restore defaults" in popup.mjs) they would keep hanging forever.
		this._messageListeners.forEach((listener) => {
			chrome.runtime.onMessage.removeListener(listener);
		});
		this._messageListeners = [];
	}

	/** @type {Classes.BaseElement['connectedMoveCallback']} */
	connectedMoveCallback() {
		// Called instead of disconnectedCallback+connectedCallback when the element is
		// moved with moveBefore() (a state-preserving move). The DOM subtree
		// and the internal state stay unchanged — no action is needed.
	}

	/** @type {Classes.BaseElement['adoptedCallback']} */
	adoptedCallback() {
		// Modules hold no state tied to a specific document/realm, so a move
		// with document.adoptNode() requires no action.
	}

	/** @type {Classes.BaseElement['attributeChangedCallback']} */
	attributeChangedCallback(_name, _oldValue, _newValue) {
		// The default observedAttributes is an empty array, so in its basic form this method
		// is never called — it is here only for the completeness of the API.
	}

	/** @type {Classes.BaseElement['init']} */
	async init({ name, mode, location, instance }) {
		this._name = name;
		this._mode = mode || "popup";
		// Instance id of a module with multiple instances (see
		// MODULE_INSTANCE_SEPARATOR), otherwise null. this.api.settings then works
		// with the settings of this instance.
		/** @type {Classes.BaseElement['_instance']} */
		this._instance = instance || null;
		// The surface on which the element is rendered ("popup"/"sidebar"/"floating")
		// — unlike "mode" (WHEN the module works) this is WHERE. Most modules do not
		// need it, but it exists for those that must behave differently depending on
		// whether they run in the short-lived popup, the long-open side
		// panel, or in the floating window embedded right in the page (see
		// analyticalTool — live refresh on tab switch only in the sidebar).
		/** @type {Classes.BaseElement['_location']} */
		this._location = location || "popup";
		// The public API for communication with the core (settings, messages, data, floating
		// window) — see createModuleApi() above. Modules use it as
		// this.api.*, their content scripts (outside BaseElement) create the same thing
		// themselves by importing sdk.mjs.
		/** @type {Classes.BaseElement['api']} */
		this.api = createModuleApi(name, this._instance);

		// If the constructor did not set activationSpec itself, it is looked up in the
		// registry by the module name — the same value the module passed to
		// registerModule({ activationSpec }) (typically ACTIVATION_SPEC from its
		// module.mjs). A single source of truth instead of the former "keep the same rule
		// in two places" (see README): the module declares the spec only once,
		// in registerModule(), and the element takes it over from there by itself.
		if (this.activationSpec === undefined) {
			const moduleDef = (globalThis.__extensionModules || []).find((m) => m.name === name);
			this.activationSpec = (moduleDef && moduleDef.activationSpec) || NOT_DISABLED_SPEC;
		}
	}

	// Encapsulates evaluating the activation specification declared by the module,
	// so modules do not have to check it manually and independently of the calling context.
	/** @type {Classes.BaseElement['isActivationSatisfied']} */
	isActivationSatisfied(mode = this._mode) {
		return (this.activationSpec || NOT_DISABLED_SPEC).isSatisfiedBy({ mode });
	}

	/** @type {Classes.BaseElement['getModuleSetting']} */
	async getModuleSetting(moduleName, defaultValue = "popup") {
		try {
			const result = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get([SETTINGS_KEY]));
			/** @type {Types.ModuleSettings} */
			const settings = result[SETTINGS_KEY] || {};
			return settings[moduleName] || defaultValue;
		} catch {
			return defaultValue;
		}
	}

	/** @type {Classes.BaseElement['sendMessageToActiveTab']} */
	sendMessageToActiveTab(message) {
		return sendMessageToActiveTab(message);
	}

	/** @type {Classes.BaseElement['registerMessageHandler']} */
	registerMessageHandler(type, handler) {
		/** @type {Types.RuntimeMessageListener} */
		const listener = (message, sender) => {
			if (message && message.type === type) {
				handler(message, sender);
			}
		};
		chrome.runtime.onMessage.addListener(listener);
		this._messageListeners.push(listener);
	}
}

// --------------------------------------------------------------------
// Uploaded modules (sandbox) — a module the user uploads on the Settings page (the
// "Uploaded modules (sandbox)" section, see options.mjs), not one from the extension
// package. Its code never runs in an extension page: it runs in the sandboxed page
// sandbox.html (an opaque origin, no chrome.* API, see sandbox.js), and whatever it
// needs from the extension it asks the core for — the element below
// (SandboxModuleElement) runs the request through the module's own api
// (createModuleApi(), i.e. under the module's name, the same as for any other
// module) and sends back the result. Only requests from an allowlist (SANDBOX_API), and the
// functions outside the sandbox the module declared and the user allowed it (see "Functions
// outside the sandbox" below — also what can never be allowed).
//
// What can be uploaded (unpackSandboxUpload()):
//   - one script named after the module: <name>.js — a classic script, the SDK comes as
//     the global sandboxSdk; or <name>.mjs — a JS module, it imports the SDK the same
//     way as a module from the package: import { BaseElement, … } from "../../sdk.mjs";
//   - a .zip with the module folder, the same as modules/<name>/ in the package: the entry
//     <name>.mjs (or <name>.js) and other files — more JS modules (a relative import),
//     its CSS (registerModule({ styles })), images, fonts, JSON and its texts
//     (SANDBOX_MESSAGES_FILE).
// In the sandbox the package is where modules/<name>/ would be: a relative import of a file
// of the package and "../../sdk.mjs" work, anything else is refused already when uploading.
// The sandbox has no folder these paths could point to — the core finds them in the sources
// (planSandboxPackage(), scanModuleSource() in sandbox-package.mjs) and the sandbox rewrites
// them to the addresses (blob:) of the files it creates from the package.
//
// Otherwise the same rules apply as for modules from the package: the entry file is named
// after the module (camelCase), it defines its element with customElements.define(
// getTagName(name), …) and registers itself with registerModule() — the core checks it with
// the same validateModule(). It has its own entry in the module list (see
// SANDBOX_ENTRY_PREFIX); its activation mode, output locations, output element, custom
// settings (settingsSchema) and instances are handled by Settings and the controllers
// exactly as for the other modules.
//
// Uploading (installSandboxModule()): the package is checked and evaluated in a hidden
// sandbox for every UI language (inspectSandboxModule()) — the sandbox returns what the
// module declared in registerModule() as data (the activation rule as a descriptor, see
// specFromDescriptor()). These registrations are stored in chrome.storage.local
// (SANDBOX_MODULES_KEY), the files of the package in the extension's IndexedDB
// (SANDBOX_PACKAGES_DB — up to a MB, and chrome.storage.local would broadcast them with
// every change to all pages and content scripts listening to storage.onChanged), and the
// module is added to the module list. On extension pages the core registers the module from
// the stored data (loadSandboxModules(), called by importModuleFiles() and popup.mjs instead
// of import()) without running its code — the code runs only when its element is rendered.
//
// The extension can also bring such a module itself (BUNDLED_SANDBOX_MODULES — the divider
// contentDividerSandbox, which replaced modules/contentDivider, the main buttons
// mainButtonsSandbox, which replaced modules/mainButtons, and the overview of the floating window
// floatingWindowOverviewSandbox, which replaced modules/floatingWindowOverview, the tools for the
// address of the current tab URLToolsSandbox, the overview of PWA apps PWAInfoSandbox, which took
// the overview over from modules/PWAInfo — that one keeps recording —, the listing of the page
// domains domainInfoSandbox, which took the listing over from modules/domainInfo — that one keeps
// collecting the RDAP data —, the ad blocker adBlockerSandbox, which replaced modules/adBlocker — the
// core's network filters do its work outside the sandbox, networkFilters.* —, the YouTube ad blocker
// youtubeAdBlockerSandbox, which replaced modules/youtubeAdBlocker — the core's content filters do its
// work outside the sandbox, contentFilters.* —, the details of the page's domain domainDetailsSandbox, which replaced
// modules/domainDetails, and the usage of the extension's storages storageInfoSandbox, which replaced
// modules/storageInfo — the core measures the storages for it, storageUsage.get —, the listing of the
// images of the page imageInfoSandbox — modules/imageInfo records their headers while they load and lists
// the frames for it, imageInfo.* —, and the manager of the scientific studies studiesManagerSandbox —
// modules/studiesManager records the studies of the pages the user browses, studiesManager.* —, the manager of the
// contacts contactsModuleSandbox — modules/contactsModule records the business cards of the pages the user browses,
// contactsModule.* —, and the overview of the service
// workers serviceWorkerControlSandbox — the code of modules/serviceWorkerControl reads and controls them for it and blocks the
// domains, serviceWorkerControl.* —, and the overview of the tab groups tabGroupsSandbox — modules/tabGroups sorts the tabs
// and reads the groups for it, tabGroups.* —, and the scheduled addresses scheduledUrlsSandbox — the core keeps them for the user's devices
// in chrome.storage.sync and opens them on the target device, scheduledUrls.* —, and the DNS overview of the pages DNSOverviewSandbox —
// the core follows the requests of the pages and asks browser.dns for it, dnsOverview.* —, and the overview and the editor of the
// network rules declarativeNetRequestSandbox — modules/declarativeNetRequest converts the rules into the browser and keeps them
// for it, declarativeNetRequest.*): its package is part of the extension
// and the core installs it the same way as an uploaded one, from the files of the extension, the
// first time a page needs it (ensureBundledSandboxModules()) — on a new installation that is the
// welcome page. The user cannot remove it or upload another module under its name.
// --------------------------------------------------------------------

// Uploaded modules — { [module name]: Types.SandboxModuleRecord }: data about the uploaded
// file and what the module declared in registerModule() in each UI language (the files of
// the package are in SANDBOX_PACKAGES_DB).
export const SANDBOX_MODULES_KEY = "sandboxModules";

// The module list entry of an uploaded module: "sandbox://<name>/<name>.js" (also for a module
// from a .mjs or a .zip — the entry names the module, not its file). It has the shape of a path
// (the folder = the file name = the module name), so everything that reads the list —
// getModuleKey(), parseModuleEntry(), instances ("…#id"), the folder check in popup.mjs, the
// content script registration in background.js (it finds no
// modules/<name>/content-script.js) — works with it unchanged.
export const SANDBOX_ENTRY_PREFIX = "sandbox://";

// Uploaded modules the extension brings itself: module name → the files of its package. The
// package is in the extension (BUNDLED_SANDBOX_DIR/<name>/ — scripts/build.mjs puts the folders
// of the sandbox:// entries of modules.json into the package, every such module is in the default
// list), the core installs it from there (ensureBundledSandboxModules()).
/** @type {Readonly<Record<string, readonly string[]>>} */
export const BUNDLED_SANDBOX_MODULES = Object.freeze({
	// #region standalone: tabGroupsSandbox
	tabGroupsSandbox: Object.freeze(["tabGroupsSandbox.mjs", "module.mjs", "settingsView.mjs", "tabGroupsSandbox.css", "messages.json"]),
	// #endregion standalone: tabGroupsSandbox
});
export const BUNDLED_SANDBOX_DIR = "sandbox-modules";

// The modules of BUNDLED_SANDBOX_MODULES checked in this browser session (chrome.storage.session —
// the browser clears it on a restart and when the extension is updated or reloaded): the next
// pages do not read and hash their files again (about 10 ms for every popup). A restored backup
// clears it (api.backup.importAll()) — the backup may have another record.
export const BUNDLED_SANDBOX_CHECKED_KEY = "bundledSandboxModulesChecked";

// Modules the extension replaced by another one under a new name — their module list entries
// (instances too) and their settings move over to it (migrateRenamedModules()). Old name → the
// list entry of the new module.
/** @type {Readonly<Record<string, string>>} */
const RENAMED_MODULES = Object.freeze({
	// modules/contentDivider, modules/mainButtons, modules/floatingWindowOverview, modules/adBlocker,
	// modules/youtubeAdBlocker, modules/domainDetails and modules/storageInfo became uploaded modules
	// the extension brings itself.
	contentDivider: getSandboxModuleEntry("contentDividerSandbox"),
	mainButtons: getSandboxModuleEntry("mainButtonsSandbox"),
	floatingWindowOverview: getSandboxModuleEntry("floatingWindowOverviewSandbox"),
	adBlocker: getSandboxModuleEntry("adBlockerSandbox"),
	youtubeAdBlocker: getSandboxModuleEntry("youtubeAdBlockerSandbox"),
	domainDetails: getSandboxModuleEntry("domainDetailsSandbox"),
	storageInfo: getSandboxModuleEntry("storageInfoSandbox"),
});

// The page the module runs in — declared as sandboxed in the manifest ("sandbox.pages")
// with its own CSP (content_security_policy.sandbox): it may evaluate code and run the
// scripts it creates itself (blob:), but it loads nothing from the network and embeds no
// other pages.
export const SANDBOX_PAGE = "sandbox.html";

// The largest uploaded script (.js/.mjs, bytes).
export const SANDBOX_MAX_SOURCE_BYTES = 256 * 1024;

// The largest uploaded package: the .zip itself and all its files after unpacking.
export const SANDBOX_MAX_PACKAGE_BYTES = 1024 * 1024;

// The most entries of a .zip (files, folders and the ignored files).
export const SANDBOX_MAX_PACKAGE_FILES = 200;

// The texts of a module in its package (instead of defineMessages(), sandbox.js defines them
// before it evaluates the module): { "<language>": { "<key>": "text" } }.
export const SANDBOX_MESSAGES_FILE = "messages.json";

// The files of the uploaded modules (Types.SandboxPackage under the module name) — an IndexedDB
// database of the extension, read by the extension pages that render the modules.
const SANDBOX_PACKAGES_DB = "sandboxModules";
const SANDBOX_PACKAGES_DB_VERSION = 1;
const SANDBOX_PACKAGES_STORE = "packages";

// How long the core waits for the sandbox to evaluate an uploaded module.
const SANDBOX_INSPECT_TIMEOUT_MS = 10000;

// The highest <iframe> of a module (the content height reported by the sandbox).
const SANDBOX_MAX_FRAME_HEIGHT = 20000;

// The widest content of a module's <iframe> a page takes into account (the min-content width reported by the sandbox).
const SANDBOX_MAX_FRAME_WIDTH = 20000;

// The sandbox attribute of the <iframe> — the same flags as the sandbox directive of the manifest CSP.
// It gives the frame an opaque origin even in a browser that does not know the manifest's
// "sandbox" key (then the extension CSP applies to the page and forbids evaluating
// the code — the module does not run, see "evalBlocked" in sandbox.js).
const SANDBOX_FRAME_FLAGS = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals";

// The name of an uploaded script and of the entry file of a package: "<name>.js" or
// "<name>.mjs", the name in camelCase like other modules (it may start with an abbreviation
// in capitals, "PWAInfo").
const SANDBOX_SCRIPT_NAME_RE = /^([A-Za-z][A-Za-z0-9]*)\.(m?js)$/;

// A file or folder name in a package: letters, digits, ".", "_" and "-", not starting with
// "." — the sandbox writes the paths into addresses and CSS without escaping.
const SANDBOX_PATH_SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const SANDBOX_MAX_PATH_LENGTH = 200;

// The SDK as a module specifier of a JS module of the package resolves to — "../../sdk.mjs"
// from the module folder (modules/<name>/), the same as for a module from the package.
const SANDBOX_SDK_PATH = "sdk.mjs";

// What a package may contain, by the extension — the type is set by the core, never taken from
// the archive. text: it must be valid UTF-8 (the core and the sandbox read it as text).
/** @type {Readonly<Record<string, Types.SandboxFileType>>} */
const SANDBOX_FILE_TYPES = Object.freeze({
	js: { type: "text/javascript", text: true },
	mjs: { type: "text/javascript", text: true },
	json: { type: "application/json", text: true },
	css: { type: "text/css", text: true },
	txt: { type: "text/plain", text: true },
	svg: { type: "image/svg+xml", text: false },
	png: { type: "image/png", text: false },
	jpg: { type: "image/jpeg", text: false },
	jpeg: { type: "image/jpeg", text: false },
	gif: { type: "image/gif", text: false },
	webp: { type: "image/webp", text: false },
	avif: { type: "image/avif", text: false },
	ico: { type: "image/x-icon", text: false },
	woff: { type: "font/woff", text: false },
	woff2: { type: "font/woff2", text: false },
	ttf: { type: "font/ttf", text: false },
	otf: { type: "font/otf", text: false },
});

// The deepest nesting of an activation rule written as data (and/or/not).
const SPEC_DESCRIPTOR_MAX_DEPTH = 32;

// What an uploaded module may ask the core for — the methods of its this.api in the sandbox
// (Types.SandboxModuleApi); everything else is a function outside the sandbox (the catalog
// SANDBOX_CAPABILITIES below — declared, allowed by the user, recorded). Only parts that work with the
// module's own data (settings and state under its name, its records, limits,
// notifications) or only read (the current tab, details of other modules, whether a permission
// is granted). Not: the whole moduleSettings (getAll/setAll), messages (background.js trusts
// the "module" field of a message from an extension page), the floating window (its stored
// states only as functions of the catalog), backups, network rules, the debugger, requesting and
// removing permissions (the user grants them in the permission manager, the module declares them
// in usesPermissions) and measurement.
// "call" = one request, one response; "subscribe" = a listener (onChange) whose events the
// core sends until the module unsubscribes or its element is detached. A handler gets the
// element that embeds the module as host (the surface, the buttons it draws) — null without one.
/** @type {Readonly<Record<Types.SandboxApiMethod, Types.SandboxApiHandler>>} */
const SANDBOX_API = Object.freeze({
	"settings.get": { kind: "call", run: (api, [key, defaultValue]) => api.settings.get(String(key), defaultValue) },
	"settings.set": { kind: "call", run: (api, [key, value]) => api.settings.set(String(key), value) },
	// The module's own default mode, the same as getMode(DEFAULT_ACTIVATION_MODE) of a module from the package.
	"settings.getMode": { kind: "call", run: (api, _args, mod) => api.settings.getMode(mod.defaultActivationMode) },
	// Only the module's own keys (its mode, fields, instances), not the settings of the others.
	"settings.onChange": {
		kind: "subscribe",
		run: (api, _args, mod, emit) => api.settings.onChange((settings) => emit(ownModuleSettings(settings, mod.name))),
	},
	"state.get": { kind: "call", run: (api, [key, defaultValue]) => api.state.get(String(key), defaultValue) },
	"state.set": { kind: "call", run: (api, [key, value]) => api.state.set(String(key), value) },
	"state.onChange": { kind: "subscribe", run: (api, [key], _mod, emit) => api.state.onChange(String(key), emit) },
	"sessionState.get": { kind: "call", run: (api, [key, defaultValue]) => api.sessionState.get(String(key), defaultValue) },
	"sessionState.set": { kind: "call", run: (api, [key, value]) => api.sessionState.set(String(key), value) },
	"sessionState.onChange": { kind: "subscribe", run: (api, [key], _mod, emit) => api.sessionState.onChange(String(key), emit) },
	// The rule and the default mode the module registered — a Specification cannot cross the boundary.
	"activation.isActive": { kind: "call", run: (api, _args, mod) => api.activation.isActive(mod.defaultActivationMode, mod.activationSpec) },
	"activation.onChange": { kind: "subscribe", run: (api, _args, _mod, emit) => api.activation.onChange(() => emit(null)) },
	"notifications.show": {
		kind: "call",
		run: (api, [title, options]) =>
			api.notifications.show(String(title), isPlainObject(options) ? /** @type {NotificationOptions} */ (options) : undefined),
	},
	// Clicks on the module's own notifications (with the data it gave show()) — never another module's.
	"notifications.onClick": { kind: "subscribe", run: (api, _args, _mod, emit) => api.notifications.onClick(emit) },
	"data.log": {
		kind: "call",
		run: (api, [payload, options]) => api.data.log(payload, isPlainObject(options) ? /** @type {Types.DataLogOptions} */ (options) : undefined),
	},
	// The api checks the values itself (a foreign record, a wrong id, …).
	"data.update": {
		kind: "call",
		run: (api, [id, patch]) => api.data.update(/** @type {number} */ (id), /** @type {Record<string, unknown>} */ (patch)),
	},
	"data.remove": { kind: "call", run: (api, [id]) => api.data.remove(/** @type {number} */ (id)) },
	"data.findByDocument": {
		kind: "call",
		run: (api, [query]) =>
			api.data.findByDocument(isPlainObject(query) ? /** @type {{ tabId?: number; documentKey?: number }} */ (query) : {}),
	},
	"data.findByDomain": {
		kind: "call",
		run: (api, [query]) => api.data.findByDomain(isPlainObject(query) ? /** @type {{ domain?: string; limit?: number }} */ (query) : {}),
	},
	"data.findByKey": {
		kind: "call",
		run: (api, [query]) => api.data.findByKey(isPlainObject(query) ? /** @type {{ key?: string; limit?: number }} */ (query) : {}),
	},
	"data.count": { kind: "call", run: (api) => api.data.count() },
	"data.total": { kind: "call", run: (api) => api.data.total() },
	"data.listForActiveTab": { kind: "call", run: (api, [limit]) => api.data.listForActiveTab(Number(limit)) },
	"data.listLatest": { kind: "call", run: (api, [limit]) => api.data.listLatest(Number(limit)) },
	"rateLimit.acquire": {
		kind: "call",
		run: (api, [bucket, windows]) => api.rateLimit.acquire(String(bucket), /** @type {Types.RateLimitWindow[]} */ (windows)),
	},
	"rateLimit.block": { kind: "call", run: (api, [bucket, ms]) => api.rateLimit.block(String(bucket), Number(ms)) },
	"rateLimit.getState": { kind: "call", run: (api, [bucket]) => api.rateLimit.getState(String(bucket)) },
	"tabs.getActive": { kind: "call", run: (api) => api.tabs.getActive() },
	// The same value as getActive() after a switch of tabs or a new address — no more than getActive() reveals.
	"tabs.onChange": { kind: "subscribe", run: (api, _args, _mod, emit) => api.tabs.onChange(emit) },
	// Only the pages of OPENABLE_EXTENSION_PAGES — the sandbox page cannot open them itself (an opaque origin).
	"tabs.openExtensionPage": { kind: "call", run: (api, [page]) => api.tabs.openExtensionPage(String(page)) },
	"permissions.contains": {
		kind: "call",
		run: (api, [permissions]) =>
			api.permissions.contains(isPlainObject(permissions) ? /** @type {Types.PermissionSet} */ (permissions) : {}),
	},
	"permissions.onChange": { kind: "subscribe", run: (api, _args, _mod, emit) => api.permissions.onChange(() => emit(null)) },
	"details.hasProviders": { kind: "call", run: (api, [scope]) => api.details.hasProviders(/** @type {Enums.DetailsScope} */ (scope)) },
	// One implementation behind the overloads of collect() — it checks the level and the context itself.
	"details.collect": {
		kind: "call",
		run: (api, [scope, context]) =>
			/** @type {(scope: unknown, context: unknown) => Promise<Types.CollectedDetails[]>} */ (api.details.collect).call(
				api.details,
				scope,
				isPlainObject(context) ? context : {}
			),
	},
	// Only that the details the module can collect may have changed — no data; it collects again itself.
	"details.onChange": {
		kind: "subscribe",
		run: (api, [scope, context], _mod, emit) =>
			/** @type {(scope: unknown, context: unknown, handler: () => void) => () => void} */ (api.details.onChange).call(
				api.details,
				scope,
				isPlainObject(context) ? context : {},
				() => emit(null)
			),
	},
	"network.getIpForActiveTab": { kind: "call", run: (api) => api.network.getIpForActiveTab() },
	// The state of the functions outside the sandbox the module declared (see below) — so that it can
	// tell the user what is not allowed yet, or does not work on this surface, instead of trying.
	"capabilities.state": {
		kind: "call",
		run: (api, _args, mod, host) => getSandboxCapabilityStates(mod, sandboxCapabilityContext(api, host, mod)),
	},
	"capabilities.onChange": {
		kind: "subscribe",
		run: (api, _args, mod, emit, host) => onSandboxCapabilityStatesChange(mod, emit, sandboxCapabilityContext(api, host, mod)),
	},
	// Buttons the core draws for the module in the extension page — a click runs a declared function
	// outside the sandbox within the click (see below). Only with the element that embeds the module.
	"buttons.set": {
		kind: "call",
		run: (_api, [buttons, options], _mod, host) => {
			if (!host) throw new Error(t("core_sandbox_capability_unavailable", "buttons.set"));
			host.setButtons(buttons, options);
		},
	},
	"buttons.onClick": {
		kind: "subscribe",
		run: (_api, _args, _mod, emit, host) => {
			if (!host) throw new Error(t("core_sandbox_capability_unavailable", "buttons.onClick"));
			return host.onButtonClick(emit);
		},
	},
	// Content the core draws for the module in the extension page instead of its frame — the module
	// describes it as data (normalizeSandboxUi()), the core draws it without HTML (renderSandboxUi());
	// its controls report clicks and changes back, a button with a declared function runs it within the click (as
	// api.buttons). null shows the frame again.
	"ui.render": {
		kind: "call",
		run: (_api, [content], _mod, host) => {
			if (!host) throw new Error(t("core_sandbox_capability_unavailable", "ui.render"));
			host.renderUi(content);
		},
	},
	"ui.onEvent": {
		kind: "subscribe",
		run: (_api, _args, _mod, emit, host) => {
			if (!host) throw new Error(t("core_sandbox_capability_unavailable", "ui.onEvent"));
			return host.onUiEvent(emit);
		},
	},
	// Scrolls the extension page to the module's own output — only that page, never a web page around it; { offset } = px
	// from the top of the module's frame (a place inside its output, e.g. a line of a list).
	"ui.scrollIntoView": {
		kind: "call",
		run: (_api, [options], _mod, host) => {
			if (!host) throw new Error(t("core_sandbox_capability_unavailable", "ui.scrollIntoView"));
			const offset = isPlainObject(options) ? options.offset : undefined;
			host.scrollIntoView(typeof offset === "number" && Number.isFinite(offset) && offset >= 0 ? Math.min(offset, SANDBOX_SCROLL_MAX_OFFSET) : null);
		},
	},
});

// --------------------------------------------------------------------
// Functions outside the sandbox (capabilities). SANDBOX_API above is what every uploaded module
// gets. Anything else it needs it declares in registerModule({ capabilities: ["tabs.create", …] })
// and asks for with this.api.capabilities.call("tabs.create", { url }) — the same request to the
// core as the other api methods, under the name of the function. The core runs it only when
//   1. the core offers the function — it is in the catalog SANDBOX_CAPABILITIES: each one is a
//      narrow operation of the core with its arguments checked (tabs.create opens only web
//      addresses), never a chrome.* method passed through as it is;
//   2. the module declared it — Settings shows the declared functions with the module, a new
//      version that declares more gets the new ones undecided;
//   3. the user allowed it to the module in Settings → "Uploaded modules (sandbox)"
//      (SANDBOX_CAPABILITY_GRANTS_KEY). Undecided = refused; a module the extension brings itself
//      (BUNDLED_SANDBOX_MODULES) has its declared functions allowed until the user denies them.
// Otherwise the request is refused with the reason (Enums.SandboxCapabilityState) as the error the
// module gets — also an allowed function that cannot work on this page ("unavailable": the side
// panel in the floating window's <iframe>, closing the popup outside the popup, …). Every request
// for something outside SANDBOX_API — run, failed, refused, or a function the core does not know at
// all — and every decision of the user is recorded (SANDBOX_CAPABILITY_LOG_KEY: module, function,
// outcome, count, the first and the last time; never the arguments, they can be the user's data).
// Settings shows the record with the module; the functions the core does not know show what the
// modules need — candidates for the catalog.
//
// Buttons the core draws (api.buttons). What the browser allows only directly in the handler of the
// user's click — opening the popup or the side panel, asking for a permission (Firefox: "may only be
// called from a user input handler") — cannot come as a request: a click in the sandbox frame reaches
// the core as a message, and Firefox refuses it then (verified in Firefox 157, although the page has
// the user's activation). Such functions of the catalog (clickOnly: popup.open, sidebar.toggle,
// floatingWindow.toggle) run only from a button the core draws for the module above its frame, in
// the extension page itself (api.buttons.set([{ id, label, title, disabled, capability, args }])):
// the click is then a click in the page and the core calls the browser right in its handler. The
// module chooses the label, the tooltip, whether the button is enabled and which declared function it
// runs with which arguments; it learns the result from api.buttons.onClick(). The same three rules
// apply to the click as to a request, and it is recorded the same way; a call of a clickOnly function
// is refused ("clickOnly"). mainButtons became an uploaded module this way (mainButtonsSandbox).
//
// Listeners (capabilities.listen()). A function of the catalog can also be a listener — listen
// instead of run (floatingWindow.onChange): the module subscribes with
// this.api.capabilities.listen("floatingWindow.onChange", handler), which returns a function to
// unsubscribe. The same three rules apply when it subscribes (a refused listener gets no events,
// the sandbox writes the reason to the console), the subscription is recorded once (not every
// event), and while the user denies the function afterwards the core delivers none of its events.
// A call of a listener, a listener of a function that is not one, and a button with a listener are
// refused. floatingWindowOverview became an uploaded module this way (floatingWindowOverviewSandbox:
// floatingWindow.getAllStates, floatingWindow.updateStates, floatingWindow.onChange).
//
// The data of a module from the package. A module whose part runs outside its element (a content
// script, a background part) cannot move into the sandbox as a whole — but its element can, when the
// catalog gives the sandbox the module's data, read-only and narrowed to what the element showed:
// PWAInfo keeps recording websites with a PWA app (content script, MAIN-world script, background
// part, the details for domainDetailsSandbox, its settings and the permission button), and its overview
// became PWAInfoSandbox — it renders what websites wrote into their manifests, in the sandbox
// (pwaInfo.listRecords, pwaInfo.getStatus, the listener pwaInfo.onChange). The same way domainInfo
// keeps collecting the RDAP data of the domains of visited pages (content script, pageInit, the
// details, the RDAP server editor and the permission button), and its listing of the page domains
// became domainInfoSandbox — it renders what the registries answered (names, addresses, e-mails of
// the holders), in the sandbox (domainInfo.getPage, domainInfo.collect, domainInfo.resumeServer,
// domainInfo.setDataSaver, the listener domainInfo.onChange). imageInfo records the HTTP headers of images while pages load them (its
// background part, webRequest) and lists the images of the frames of a tab with the metadata of their files,
// and its listing is imageInfoSandbox — it renders what the images and their servers carry (the text of
// EXIF, XMP, IPTC: cameras, places, authors), in the sandbox (imageInfo.getPage, the listeners
// imageInfo.onChange and imageInfo.onView — which of them the user sees and points at); its marks over the images
// on the page itself are only text the core checks and passes to the frames of the page (imageInfo.markImages). Its button "Block
// the image permanently" hands one address over to another module of the package through the core
// (imageInfo.blockImage): the core checks it against the listing and sends it to the background part of
// declarativeNetRequest, which keeps it in its rule of the blocked images — the modules know nothing of each
// other's data, the core passes only the address and the result. studiesManager records the scientific studies of
// the pages the user browses (content script, background part — the metadata from doi.org), and its manager is
// studiesManagerSandbox — it renders what pages and DOI registries say about the studies (titles, abstracts,
// authors) and the pages they were seen on, in the sandbox (studiesManager.listRecords, studiesManager.getStatus,
// the listener studiesManager.onChange); it removes records (studiesManager.removeRecords) and has the metadata of
// DOIs loaded (studiesManager.enrich) only through the core, by the ids and DOIs it got. contactsModule records the
// contacts (business cards — hCard, vCard, schema.org Organization, LocalBusiness and Person, the citation_* meta tags) of
// the pages the user browses (content script, background part — the linked .vcf files, security.txt of the sites), and its manager is contactsModuleSandbox — it renders what
// pages say about people and organizations (names, e-mails, phones, addresses), in the sandbox (contactsModule.listRecords,
// contactsModule.getStatus, the listener contactsModule.onChange); it removes records (contactsModule.removeRecords) only
// through the core, by the ids it got, and adds the contacts of a file the user imported (contactsModule.importContacts —
// the background part of contactsModule checks them). serviceWorkerControl keeps
// blocking service workers on the domains of its list (main-world-domain-script.js, its settings, the permission buttons),
// and its listing became serviceWorkerControlSandbox — it renders the websites with their service workers and icons, in
// the sandbox: the code of serviceWorkerControl runs in the page that embeds it (serviceWorkerControl.getOverview — the
// registrations of the open pages, the running workers, the remembered websites —, the listener serviceWorkerControl.onChange)
// and does the actions only on the items the overview listed, by their keys (serviceWorkerControl.stopWorker, startWorker,
// unregister, blockDomain, forgetSite). tabGroups keeps sorting tabs into groups (its background part, its settings, the
// permission buttons), and its overview of the groups of the window and the editor of its settings became tabGroupsSandbox:
// the background part of tabGroups does the work for it as its services (api.services — tabGroups.getOverview, regroup,
// identify, getSettings, setSettings, openPermissions); the listener tabGroups.onChange follows the events of the page.
// declarativeNetRequest keeps converting its rules of header and GET parameter edits and blocking into the browser (its
// background part, the notifications and the own log of applied rules, the rule of the blocked images, the permission
// buttons), and the overview of the rules for the page and the editor of the rules became declarativeNetRequestSandbox — the
// editor renders what the user and imageInfo.blockImage wrote into the rules, in the sandbox; the background part of
// declarativeNetRequest does the work for it as its services (api.services — declarativeNetRequest.getStatus, getRules,
// setRules — checked the same way the editor in Settings did —, suspendRule, restoreRule, reloadTab, getLog, clearLog); the
// listener declarativeNetRequest.onChange follows the settings, the state, the permissions and the bookmarks in the page.
//
// A service of the core. What a module did outside its element can also become a general function of
// the core that any uploaded module asks for with data, and the core does the work itself — also in
// background.js, while the module is not shown. youtubeAdBlocker became youtubeAdBlockerSandbox this way,
// without a module left in the package: the content filters of the core (contentFilters.mjs,
// contentFiltersBackground.mjs, the library of scriptlets scriptlets.mjs) download the filter lists
// the module names, build the uBO scriptlets and cosmetic filters for the hosts it names and inject
// them into their pages (userScripts, as a fallback scripting.executeScript) — the module only declares
// the configuration in registerModule({ contentFilters }) (DECLARED_FILTERS — the core applies it from the
// module's installation, under contentFilters.set: hosts it declared the access to, https lists, its
// settings for the lists and the method), shows the status (contentFilters.getStatus, the listener
// contentFilters.onChange) and has the lists downloaded (contentFilters.update). It never brings code
// for the page — scripting and userScripts stay forbidden below. adBlocker became adBlockerSandbox the
// same way: the network filters of the core (networkFilters.mjs, networkFiltersBackground.mjs) download
// the filter lists the module names, convert their network rules into declarativeNetRequest blocking
// rules and put them into the browser as the module's bulk rules (the same layer as api.networkRules.set(…,
// { bulk: true })) — the module only declares the configuration in registerModule({ networkFilters })
// (under networkFilters.set: https lists, its settings for the lists, for more lists and for the domains on
// which nothing is blocked; it must declare NETWORK_FILTERS_PERMISSIONS), shows the status (networkFilters.getStatus, the listener
// networkFilters.onChange) and has the lists downloaded (networkFilters.update). It never gives a rule —
// declarativeNetRequest stays forbidden below.
//
// What the frame cannot measure itself. The sandbox page has an opaque origin — its localStorage,
// IndexedDB and navigator.storage are not the extension's — and no chrome.storage. The catalog measures
// the extension's own storages for it, read-only and only counts of items and sizes, never a key or a
// value, and reports which of them changed: storageInfo became storageInfoSandbox this way
// (storageUsage.get, the listener storageUsage.onChange).
//
// What cannot be allowed this way — no catalog entry can offer it, and a request for it is refused
// with the reason (SANDBOX_FORBIDDEN_CAPABILITIES, the texts core_sandbox_capability_block_*; the
// same list is in README, "Uploaded modules (sandbox)"):
//   - the DOM and the window of the extension page (document.querySelectorAll(), the <link> styles
//     of the page, …): the module runs in another document; a DOM node cannot be passed in a
//     message, a request is never synchronous and the module would see the outputs and data of the
//     other modules. A module that works with the page itself cannot become an uploaded module —
//     styleSwitch switches the styles of every extension page (pageInit);
//   - synchronous calls: every request is a message and its answer a Promise — code (a library)
//     that needs the answer right away has to be rewritten;
//   - code outside the module's element: pageInit, a background part (background-script.mjs),
//     content scripts and MAIN-world scripts, details providers, backupData — the sandbox runs only
//     while the element is shown (registerModule() refuses them as "unsupported"); work in the
//     background only as a service of the core (above);
//   - what would give the module the whole extension: chrome.storage (the data and settings of all
//     modules, the records of the uploaded modules), runtime messages (background.js trusts the
//     "module" field of a message from an extension page), requesting and removing permissions (the
//     user grants them in extensionPermissionsManager, the module declares them in usesPermissions;
//     floatingWindow.toggle asks the browser only for the page access of the floating window, the
//     browser asks the user), management, alarms and the core api left out of SANDBOX_API (backups,
//     network rules, measurement; the stored states of the floating window only record by record
//     through the catalog — floatingWindow.updateStates checks every change, the whole value
//     cannot be replaced: floatingWindow.setAllStates);
//   - code and content of web pages: scripting, tabs.executeScript, userScripts, debugger — the
//     scriptlets of the content filters are the core's own code, the module names them as data;
//   - private browser data: cookies of all sites, history, browsingData, sessions, topSites,
//     webNavigation;
//   - network rules and intercepting requests: webRequest, declarativeNetRequest, proxy (imageInfo.blockImage
//     is no way to them — declarativeNetRequest itself turns one checked address into its own rule; the
//     network filters convert lists, the rules are the core's own; declarativeNetRequest.* of the catalog are
//     the services of the module declarativeNetRequest on its own rules, which it checks itself — the names of
//     the API stay forbidden);
//   - what the browser allows only directly in the handler of a user action, from the module's own
//     button in its frame — the click there reaches the core as a message, and Firefox refuses it
//     ("may only be called from a user input handler"). Only a button the core draws (above) can run
//     popup.open, sidebar.toggle and floatingWindow.toggle; the chrome.* names themselves
//     (action.openPopup, sidePanel.open, sidebarAction.*) are never passed through;
//   - values that cannot be copied into a message (functions, DOM nodes, ports): the arguments and
//     the results are data only, events only through a listener (a "subscribe" method of
//     SANDBOX_API, a listener of the catalog).
// --------------------------------------------------------------------

// The user's decisions — { [module name]: { [function]: true (allowed) | false (denied) } }; a function
// without a value is undecided. Written only by setSandboxCapabilityGrant() (Settings), never by the
// module — its api.settings and api.state are keys of their own.
export const SANDBOX_CAPABILITY_GRANTS_KEY = "sandboxCapabilityGrants";

// The record of the requests and decisions — Types.SandboxCapabilityLogEntry[]: one entry for a module,
// a function and an outcome, with a count. Above SANDBOX_CAPABILITY_LOG_MAX entries the ones used
// longest ago go away (a module asking for thousands of made-up names cannot fill the storage).
export const SANDBOX_CAPABILITY_LOG_KEY = "sandboxCapabilityLog";
export const SANDBOX_CAPABILITY_LOG_MAX = 500;

// A page collects its new entries and writes them at most this often (a module calling a function in
// a loop does not write the storage on every call).
const SANDBOX_CAPABILITY_LOG_FLUSH_MS = 1000;

// The name of a function: "<area>.<method>" like the chrome.* API ("tabs.create",
// "clipboard.writeText"); longer names are cut to SANDBOX_CAPABILITY_MAX_NAME in the record.
const SANDBOX_CAPABILITY_NAME_RE = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;
const SANDBOX_CAPABILITY_MAX_NAME = 100;

// The most functions one module may declare.
export const SANDBOX_MAX_CAPABILITIES = 32;

// Limits of the arguments of the catalog functions.
const SANDBOX_CAPABILITY_MAX_URL = 8192;
const SANDBOX_CAPABILITY_MAX_TEXT_BYTES = 1024 * 1024;
const SANDBOX_CAPABILITY_MAX_FILE_BYTES = 10 * 1024 * 1024;
const SANDBOX_CAPABILITY_MAX_FILE_NAME = 200;

// The type of a downloaded file: "type/subtype", optionally with a charset.
const SANDBOX_DOWNLOAD_TYPE_RE = /^[a-z]+\/[a-z0-9.+-]+(?:;\s*charset=[a-z0-9_-]+)?$/i;

// The buttons the core draws for one module (api.buttons.set()): how many, the id, the longest label
// and tooltip.
export const SANDBOX_MAX_BUTTONS = 16;
const SANDBOX_BUTTON_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SANDBOX_BUTTON_MAX_LABEL = 100;
const SANDBOX_BUTTON_MAX_TITLE = 300;

// The content the core draws for one module instead of its frame (api.ui.render()): the most nodes
// (every string, element, list item, row and cell), the deepest nesting of groups and details, the
// longest text of one node and of all of them, the longest label of a checkbox and address of a link.
export const SANDBOX_UI_MAX_NODES = 2000;
export const SANDBOX_UI_MAX_DEPTH = 8;
export const SANDBOX_UI_MAX_TOTAL_TEXT = 200 * 1000;
const SANDBOX_UI_MAX_TEXT = 10 * 1000;
const SANDBOX_UI_MAX_CHECKBOX_LABEL = 300;
const SANDBOX_UI_MAX_URL = 2048;
// The nodes that go into a line of text (a paragraph, a heading, a cell, …); the others are blocks.
const SANDBOX_UI_INLINE_TYPES = ["strong", "em", "code", "text", "link", "button", "checkbox", "item"];
// Microdata of the drawn content (schema.org only): the type of an item, the name of a property (lowerCamelCase, as the
// properties of schema.org are written), the most <meta> properties of one item.
const SANDBOX_UI_ITEMTYPE_RE = /^https:\/\/schema\.org\/[A-Z][A-Za-z0-9]{0,63}$/;
const SANDBOX_UI_ITEMPROP_RE = /^[a-z][A-Za-z0-9]{0,63}$/;
const SANDBOX_UI_MAX_META = 8;

// The changes of the stored floating window state (floatingWindow.updateStates): how many records one
// call may change; a domain key as the floating window stores it (getDomainStorageKey() of a host name —
// letters, digits, ".", "-", "_", an IPv6 address in [ ]; never "__proto__"); the values it stores (a
// position may be negative or a fraction — dragged out of the view, a zoomed page —, a size not negative).
const SANDBOX_FLOATING_WINDOW_MAX_CHANGES = 1000;
const SANDBOX_FLOATING_WINDOW_DOMAIN_RE = /^[a-z0-9[][a-z0-9._:[\]-]{0,252}$/i;
const SANDBOX_FLOATING_WINDOW_POSITION_RE = /^-?\d{1,7}(?:\.\d{1,6})?px$/;
const SANDBOX_FLOATING_WINDOW_SIZE_RE = /^\d{1,7}(?:\.\d{1,6})?px$/;








// #region standalone: tabGroups
// The tab groups of tabGroups for its overview in the sandbox (tabGroups.*, tabGroupsSandbox): the module whose
// background part does the functions (its services, api.services — background-script.mjs of tabGroups) and whose code
// the listener tabGroups.onChange uses in the page (watchWindowGroups() of overview.mjs, imported only then,
// importSandboxTabGroups()) — MODULE_NAME of modules/tabGroups/module.mjs (tests/sandbox.test.mjs checks it is the same).
export const SANDBOX_TAB_GROUPS_MODULE = "tabGroups";
// #endregion standalone: tabGroups







// The catalog — the functions outside the sandbox the core offers to uploaded modules. Each one runs
// in the extension page that embeds the module (its SandboxModuleElement) and checks its arguments
// itself; about() is the text Settings shows next to the user's choice. clickOnly: only from a button
// the core draws (the browser wants the click — run() calls it before its first await); available():
// whether it can work on this page at all (the browser, the surface). A listener has listen() instead
// of run() (capabilities.listen(), see above).
/** @type {Readonly<Record<string, Types.SandboxCapability>>} */
const SANDBOX_CAPABILITIES = Object.freeze({
	// A new tab with a web address (http, https). The sandbox page may open a link itself
	// (allow-popups), but only from a click, never in the background (active: false).
	"tabs.create": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_tabs_create"),
		run: ([options]) => openSandboxWebTab(options),
	},
	// Text into the clipboard (it replaces what is there). The sandbox frame cannot write it (Chrome
	// wants the clipboard-write permission policy for a frame); the page that embeds it writes it,
	// within the user's click in the frame — the browser passes the activation to the parent page.
	"clipboard.writeText": {
		risk: "medium",
		about: () => t("core_sandbox_capability_about_clipboard_write_text"),
		run: ([text]) => writeSandboxClipboardText(text),
	},
	// A file the module created (text or bytes), saved as a download — the sandbox frame may not
	// download (no allow-downloads).
	"downloads.download": {
		risk: "medium",
		about: () => t("core_sandbox_capability_about_downloads_download", formatBytes(SANDBOX_CAPABILITY_MAX_FILE_BYTES)),
		run: ([options]) => downloadSandboxFile(options),
	},
	// The extension's floating window on the tab the surface relates to — opens it, or closes it
	// (api.floatingWindow.toggle()). On first use the browser asks the user for the page access of the
	// floating window (PAGE_ACCESS_PERMISSIONS) — the only permission a module can get asked this way.
	"floatingWindow.toggle": {
		risk: "medium",
		clickOnly: true,
		about: () => t("core_sandbox_capability_about_floating_window_toggle"),
		run: (_args, context) => context.api.floatingWindow.toggle(),
	},
	// The sidebar — Firefox opens or closes it, Chrome opens its side panel (from the panel itself it
	// closes it — Chrome cannot tell whether the panel is open).
	"sidebar.toggle": {
		risk: "low",
		clickOnly: true,
		about: () => t("core_sandbox_capability_about_sidebar_toggle"),
		available: () => !sidebarDisabledCache && hasSidebarControl(),
		run: (_args, context) => toggleSandboxSidebar(context),
	},
	// The popup of the extension's icon — not from the popup itself.
	"popup.open": {
		risk: "low",
		clickOnly: true,
		about: () => t("core_sandbox_capability_about_popup_open"),
		available: (context) => context.location !== "popup" && typeof chrome.action?.openPopup === "function",
		run: () => chrome.action.openPopup(),
	},
	// Closes the popup the module is shown in — only there (the sandbox frame cannot close the page).
	"popup.close": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_popup_close"),
		available: (context) => context.location === "popup",
		run: async () => {
			window.close();
		},
	},
	// This extension in the browser's add-on management — or its address for the user, where the browser
	// does not let an extension open it ({ opened, url }).
	"addons.open": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_addons_open"),
		run: () => openSandboxAddonsPage(),
	},
	// Brings a tab to the front: selects it in its window and focuses the window ({ tabId } — a tab number the module got
	// from the core, e.g. the page of imageInfo.getPage). Nothing about the tab is returned; from the floating window only
	// its own tab.
	"tabs.activate": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_tabs_activate"),
		run: ([options]) => activateSandboxTab(options),
	},
	// The Settings page of the extension — an open one comes to the front; with { hash } (the id of an element of
	// the page, e.g. a module's card) a new tab opens at options.html#<hash>.
	"options.open": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_options_open"),
		run: ([options]) => openSandboxOptionsPage(options),
	},
	// How much the extension's own storages take up, as the page that embeds the module sees them
	// (Types.SandboxStorageUsage): localStorage, the IndexedDB database of the records (DB_NAME),
	// navigator.storage.estimate() and chrome.storage.local — only counts of items and sizes, never a key
	// or a value. The sandbox frame cannot measure them itself: its origin is opaque (its localStorage,
	// IndexedDB and navigator.storage are not the extension's) and it has no chrome.storage.
	"storageUsage.get": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_storage_usage_get"),
		run: () => getSandboxStorageUsage(),
	},
	// A listener: which of those storages changed — "chromeStorage", "indexedDb" (a module stored, changed or
	// removed a record) or "localStorage" (another page of the extension) —, never which key or record.
	"storageUsage.onChange": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_storage_usage_on_change"),
		listen: (_args, _context, emit) => listenSandboxStorageUsageChanges(emit),
	},
	// The build settings of the modules for their standalone extensions (Types.SandboxBuildSettings): the content of
	// modules/<module>/standalone.json of every module that has one, and whether the extension runs unpacked from the
	// project — only then are the files there. The extension's own files, nothing of the user's.
	"buildSettings.get": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_build_settings_get"),
		run: () => getSandboxBuildSettings(),
	},
	// The stored states of the floating window for all domains ({ byDomain: { "<domain>": { top, left,
	// width, height, open } }, lastUsed }) — the domains are the pages the user opened it on.
	"floatingWindow.getAllStates": {
		risk: "medium",
		about: () => t("core_sandbox_capability_about_floating_window_get_all_states"),
		run: (_args, context) => context.api.floatingWindow.getAllStates(),
	},
	// Changes single records of them, each one checked (updateSandboxFloatingWindowStates()) — the
	// floating window then opens on that domain at that position and size, or stays closed.
	"floatingWindow.updateStates": {
		risk: "medium",
		about: () => t("core_sandbox_capability_about_floating_window_update_states"),
		run: ([changes]) => updateSandboxFloatingWindowStates(changes),
	},
	// A listener: the whole stored value again after every change (e.g. the window moved on another tab).
	"floatingWindow.onChange": {
		risk: "medium",
		about: () => t("core_sandbox_capability_about_floating_window_on_change"),
		listen: (_args, context, emit) => context.api.floatingWindow.onChange(emit),
	},
	// #region standalone: tabGroups
	// The automatic tab groups of the current window tabGroups manages (Types.SandboxTabGroupsOverview): the chips — the
	// name, the color, the number of tabs and what period or folder of bookmarks the group is for —, the number of the
	// user's own groups and of the tabs not sorted yet, how the tabs are sorted (the settings of tabGroups) and which of
	// its permissions are missing. Only the window of the page that embeds the module, never the tabs themselves (their
	// addresses or titles). Nothing while tabGroups is not in the module list or is turned off. The functions tabGroups.*
	// are services of the background part of tabGroups (callModuleService()).
	"tabGroups.getOverview": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_tab_groups_get_overview"),
		run: (_args, context) => callModuleService("tabGroups.getOverview", [], context.location),
	},
	// The background part of tabGroups sorts the tabs of all windows into its groups right now (the "Regroup now" button),
	// the result after the pass (Types.TabGroups.RegroupResult).
	"tabGroups.regroup": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_tab_groups_regroup"),
		run: (_args, context) => callModuleService("tabGroups.regroup", [], context.location),
	},
	// The groups tabGroups manages briefly blink in all windows (the "Identify managed groups" button) — their colors
	// change for a moment; the result after blinking (Types.TabGroups.IdentifyResult).
	"tabGroups.identify": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_tab_groups_identify"),
		run: (_args, context) => callModuleService("tabGroups.identify", [], context.location),
	},
	// The settings of tabGroups with what their editor needs (Types.TabGroups.SettingsView): how the tabs are sorted, the
	// names and colors of the groups, the groups from bookmarks with the folders of the bookmarks (their names — only with
	// the permission to bookmarks) and whether that permission is granted.
	"tabGroups.getSettings": {
		risk: "medium",
		about: () => t("core_sandbox_capability_about_tab_groups_get_settings"),
		run: (_args, context) => callModuleService("tabGroups.getSettings", [], context.location),
	},
	// Changes one setting of tabGroups ({ key, value }, or { reset: true } — all back to the defaults); the background part
	// checks the value and stores it the same way the editor in Settings did.
	"tabGroups.setSettings": {
		risk: "medium",
		about: () => t("core_sandbox_capability_about_tab_groups_set_settings"),
		run: ([change], context) => callModuleService("tabGroups.setSettings", [change], context.location),
	},
	// Opens the page where tabGroups asks for its permissions (Settings with its element) — a module in the sandbox cannot
	// ask for a permission.
	"tabGroups.openPermissions": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_tab_groups_open_permissions"),
		run: (_args, context) => callModuleService("tabGroups.openPermissions", [], context.location),
	},
	// A listener: "groups" after a group or a tab of the page's windows changed (created, moved, renamed, closed), "status"
	// after a change of the settings of tabGroups, of the module list or of the permissions.
	"tabGroups.onChange": {
		risk: "low",
		about: () => t("core_sandbox_capability_about_tab_groups_on_change"),
		listen: (_args, _context, emit) => listenSandboxTabGroupsChanges(emit),
	},
	// #endregion standalone: tabGroups
});

// What cannot be allowed (see the list above) — a name equal to one of names, or below it
// ("storage" covers "storage.local.get"); the first rule that matches gives the reason.
/** @type {ReadonlyArray<Types.SandboxCapabilityRule>} */
const SANDBOX_FORBIDDEN_CAPABILITIES = Object.freeze([
	{ reason: "page", names: ["document", "window", "dom", "element", "node", "location", "pageInit"] },
	{
		reason: "gesture",
		names: ["action.openPopup", "browserAction.openPopup", "sidebarAction.open", "sidebarAction.toggle", "sidebarAction.close", "sidePanel.open", "sidePanel.close"],
	},
	{
		reason: "extension",
		names: [
			"storage",
			"runtime",
			"extension",
			"management",
			"permissions",
			"alarms",
			"contextMenus",
			"menus",
			"commands",
			"offscreen",
			"identity",
			"settings.getAll",
			"settings.setAll",
			"messages",
			"backup",
			"floatingWindow",
			"networkRules",
			"perf",
		],
	},
	{ reason: "pageCode", names: ["scripting", "tabs.executeScript", "tabs.insertCSS", "tabs.removeCSS", "tabs.sendMessage", "userScripts", "contentScripts", "debugger"] },
	{ reason: "browserData", names: ["cookies", "history", "browsingData", "sessions", "topSites", "webNavigation"] },
	{ reason: "network", names: ["webRequest", "declarativeNetRequest", "proxy"] },
]);

// The reasons as texts — the error the module gets and Settings.
/** @type {Readonly<Record<Enums.SandboxCapabilityBlock, () => string>>} */
const SANDBOX_CAPABILITY_BLOCK_TEXTS = Object.freeze({
	page: () => t("core_sandbox_capability_block_page"),
	gesture: () => t("core_sandbox_capability_block_gesture"),
	extension: () => t("core_sandbox_capability_block_extension"),
	pageCode: () => t("core_sandbox_capability_block_page_code"),
	browserData: () => t("core_sandbox_capability_block_browser_data"),
	network: () => t("core_sandbox_capability_block_network"),
});

// Texts of the errors of a refused request (the state of the function for the module).
/** @type {Readonly<Record<Exclude<Enums.SandboxCapabilityState, "allowed">, (name: string) => string>>} */
const SANDBOX_CAPABILITY_REFUSALS = Object.freeze({
	unavailable: (name) => t("core_sandbox_capability_unavailable", name),
	denied: (name) => t("core_sandbox_capability_denied", name),
	pending: (name) => t("core_sandbox_capability_pending", name),
	undeclared: (name) => t("core_sandbox_capability_undeclared", name),
	forbidden: (name) => t("core_sandbox_capability_forbidden", name, describeSandboxCapability(name).blocked ?? ""),
	unknown: (name) => t("core_sandbox_capability_unknown", name),
});

// Texts of the problems the sandbox reports (codes, see Enums.SandboxProblemCode) — the
// sandbox has no access to the extension texts, so the core translates them.
/** @type {Record<Enums.SandboxProblemCode, (args: string[]) => string>} */
const SANDBOX_PROBLEM_TEXTS = {
	notSandboxed: () => t("core_sandbox_problem_not_sandboxed"),
	evalBlocked: () => t("core_sandbox_problem_eval_blocked"),
	evaluation: ([message]) => t("core_sandbox_problem_evaluation", message),
	noRegistration: () => t("core_sandbox_problem_no_registration"),
	multipleRegistrations: () => t("core_sandbox_problem_multiple_registrations"),
	notObject: () => t("core_sandbox_problem_not_object"),
	nameMismatch: ([actual, expected]) => t("core_sandbox_problem_name_mismatch", actual, expected),
	tagMismatch: ([actual, expected]) => t("core_sandbox_problem_tag_mismatch", actual, expected),
	notDefined: ([tag]) => t("core_sandbox_problem_not_defined", tag),
	notBaseElement: ([tag]) => t("core_sandbox_problem_not_base_element", tag),
	unsupported: ([key]) => t("core_sandbox_problem_unsupported", key),
	customField: ([key]) => t("core_sandbox_problem_custom_field", key),
	notData: ([key]) => t("core_sandbox_problem_not_data", key),
	badSpec: () => t("core_sandbox_problem_bad_spec"),
	badStyle: ([value]) => t("core_sandbox_problem_bad_style", value),
	initFailed: ([message]) => t("core_sandbox_problem_init_failed", message),
};

// Texts of what is wrong with an uploaded .zip (codes from sandbox-package.mjs).
/** @type {Record<Enums.ZipProblemCode, (args: string[]) => string>} */
const ZIP_PROBLEM_TEXTS = {
	notZip: () => t("core_sandbox_zip_invalid"),
	zip64: () => t("core_sandbox_zip_unsupported"),
	multiDisk: () => t("core_sandbox_zip_unsupported"),
	corrupt: ([path]) => (path ? t("core_sandbox_zip_corrupt", path) : t("core_sandbox_zip_invalid")),
	checksum: ([path]) => t("core_sandbox_zip_corrupt", path),
	encrypted: ([path]) => t("core_sandbox_zip_encrypted", path),
	compression: ([path]) => t("core_sandbox_zip_compression", path),
};

// Is the module list entry an uploaded module (see SANDBOX_ENTRY_PREFIX)?
/** @type {Functions.Base.isSandboxModuleEntry} */
export function isSandboxModuleEntry(entry) {
	return typeof entry === "string" && entry.startsWith(SANDBOX_ENTRY_PREFIX);
}

/** @type {Functions.Base.getSandboxModuleEntry} */
export function getSandboxModuleEntry(name) {
	return /** @type {Types.SandboxModuleEntry} */ (`${SANDBOX_ENTRY_PREFIX}${name}/${name}.js`);
}

// An activation rule written as data (Types.SpecificationDescriptor — the sandbox writes it
// with toDescriptor() of its specifications) turned into the core's Specification
// classes, so that BaseController.isModuleActive() decides about an uploaded module the
// same way as about the others. An invalid descriptor (an unknown kind, mode or
// location, too deep nesting) = null.
/** @type {Functions.Base.specFromDescriptor} */
export function specFromDescriptor(descriptor, depth = 0) {
	if (!isPlainObject(descriptor) || depth > SPEC_DESCRIPTOR_MAX_DEPTH) return null;
	/** @type {(list: unknown) => Classes.Specification[] | null} */
	const children = (list) => {
		if (!Array.isArray(list) || list.length === 0) return null;
		const specs = list.map((item) => specFromDescriptor(item, depth + 1));
		return specs.every((spec) => spec !== null) ? /** @type {Classes.Specification[]} */ (specs) : null;
	};
	switch (descriptor.type) {
		case "all":
			return new Specification();
		case "and": {
			const specs = children(descriptor.specs);
			return specs ? new AndSpecification(...specs) : null;
		}
		case "or": {
			const specs = children(descriptor.specs);
			return specs ? new OrSpecification(...specs) : null;
		}
		case "not": {
			const spec = specFromDescriptor(descriptor.spec, depth + 1);
			return spec ? new NotSpecification(spec) : null;
		}
		case "mode":
			return ACTIVATION_MODES.some((m) => m.value === descriptor.mode)
				? new ModeSpecification(/** @type {Enums.ActivationMode} */ (descriptor.mode))
				: null;
		case "notDisabled":
			return NOT_DISABLED_SPEC;
		case "disabled":
			return DISABLED_SPEC;
		case "webPage":
			return WEB_PAGE_SPEC;
		case "url": {
			const patterns = descriptor.patterns;
			return Array.isArray(patterns) && patterns.every((p) => typeof p === "string") ? new UrlPatternSpecification(patterns) : null;
		}
		case "location": {
			const locations = descriptor.locations;
			return Array.isArray(locations) && locations.every((l) => DISPLAY_LOCATIONS.some((d) => d.value === l))
				? new LocationSpecification(/** @type {Enums.RenderLocation[]} */ (locations))
				: null;
		}
		default:
			return null;
	}
}

// The ZIP reader and the import scanner (sandbox-package.mjs) — only when a module is uploaded,
// so that the pages and content scripts that import base.mjs do not load them.
/** @type {Functions.Base.loadSandboxPackageTools} */
function loadSandboxPackageTools() {
	return import("./sandbox-package.mjs");
}

// The type of a file of a package by its extension; null = not allowed.
/** @type {Functions.Base.getSandboxFileType} */
function getSandboxFileType(path) {
	const match = /\.([A-Za-z0-9]+)$/.exec(path);
	const extension = match ? match[1].toLowerCase() : "";
	return Object.hasOwn(SANDBOX_FILE_TYPES, extension) ? SANDBOX_FILE_TYPES[extension] : null;
}

// Files of an archive that are left out without a word: hidden ones (.DS_Store, .git/…), what
// macOS adds to an archive (__MACOSX/) and what only the editor or a reader needs — type
// declarations (every module has its .globals.d.ts), documentation and source maps.
/** @type {Functions.Base.isIgnoredSandboxPath} */
function isIgnoredSandboxPath(path) {
	const segments = path.split("/");
	return (
		segments[0] === "__MACOSX" ||
		segments.some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..") ||
		/\.(?:d\.ts|md|map)$/i.test(path)
	);
}

/** @type {Functions.Base.isValidSandboxPath} */
function isValidSandboxPath(path) {
	return path.length <= SANDBOX_MAX_PATH_LENGTH && path.split("/").every((segment) => SANDBOX_PATH_SEGMENT_RE.test(segment));
}

// Text in UTF-8 (a BOM at the start is dropped — the sandbox decodes it the same way); null = not UTF-8.
/** @type {Functions.Base.decodeSandboxText} */
export function decodeSandboxText(data) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(data);
	} catch {
		return null;
	}
}

/** @type {Functions.Base.describeZipProblem} */
function describeZipProblem(problem) {
	return ZIP_PROBLEM_TEXTS[problem.code](problem.args);
}

// The entry file of a package: "<name>.mjs" or "<name>.js" in its root, where the name is the
// folder the archive wraps everything in, otherwise the name of the archive; without such a
// file the only script in the root. Several = both <name>.js and <name>.mjs.
/** @type {Functions.Base.findSandboxEntry} */
function findSandboxEntry(paths, hints) {
	const scripts = paths.filter((path) => SANDBOX_SCRIPT_NAME_RE.test(path));
	for (const hint of hints) {
		const matches = scripts.filter((path) => path.replace(/\.m?js$/, "") === hint);
		if (matches.length > 0) return matches;
	}
	return scripts.length === 1 ? scripts : [];
}

// SANDBOX_MESSAGES_FILE of a package: { language: { key: text } } — null when it is fine (or
// missing), otherwise the text of the error.
/** @type {Functions.Base.checkSandboxMessages} */
function checkSandboxMessages(files) {
	const file = files[SANDBOX_MESSAGES_FILE];
	if (!file) return null;
	try {
		const tables = JSON.parse(decodeSandboxText(file.data) ?? "");
		if (
			isPlainObject(tables) &&
			Object.values(tables).every((table) => isPlainObject(table) && Object.values(table).every((text) => typeof text === "string"))
		) {
			return null;
		}
	} catch {
		// Not JSON — the same error as a wrong shape.
	}
	return t("core_sandbox_bad_messages", SANDBOX_MESSAGES_FILE);
}

// The uploaded file as the content of a package (without the plan and the fingerprint): one
// script, or the files of a .zip checked by the rules above. A .zip whose files are all in one
// folder (an archive of the module folder) has the content of that folder as the package.
// installSandboxModule() has already checked the size of the file.
/** @type {Functions.Base.unpackSandboxUpload} */
export async function unpackSandboxUpload(fileName, bytes) {
	/** @type {Types.SandboxUnpacked} */
	const result = { content: null, errors: [], warnings: [] };
	const script = SANDBOX_SCRIPT_NAME_RE.exec(fileName);
	if (script) {
		if (bytes.byteLength > SANDBOX_MAX_SOURCE_BYTES) {
			result.errors.push(t("core_sandbox_too_large", formatBytes(bytes.byteLength), formatBytes(SANDBOX_MAX_SOURCE_BYTES)));
			return result;
		}
		const source = decodeSandboxText(bytes);
		if (source === null) {
			result.errors.push(t("core_sandbox_not_utf8", fileName));
		} else if (!source.trim()) {
			result.errors.push(t("core_sandbox_empty"));
		} else {
			result.content = {
				name: script[1],
				entry: fileName,
				format: script[2] === "mjs" ? "module" : "script",
				files: { [fileName]: { type: "text/javascript", data: bytes } },
			};
		}
		return result;
	}
	if (!/\.zip$/i.test(fileName)) {
		result.errors.push(t("core_sandbox_bad_file_name", fileName));
		return result;
	}
	if (bytes.byteLength > SANDBOX_MAX_PACKAGE_BYTES) {
		result.errors.push(t("core_sandbox_too_large", formatBytes(bytes.byteLength), formatBytes(SANDBOX_MAX_PACKAGE_BYTES)));
		return result;
	}

	const { listZip, extractZipEntry } = await loadSandboxPackageTools();
	const listing = listZip(bytes);
	if (!listing.ok) {
		result.errors.push(describeZipProblem(listing.problem));
		return result;
	}
	if (listing.entries.length > SANDBOX_MAX_PACKAGE_FILES) {
		result.errors.push(t("core_sandbox_zip_too_many_files", listing.entries.length, SANDBOX_MAX_PACKAGE_FILES));
		return result;
	}
	let items = listing.entries
		.filter((entry) => !entry.directory)
		.map((entry) => ({ entry, path: entry.path.replace(/^(?:\.\/)+/, "") }))
		.filter((item) => !isIgnoredSandboxPath(item.path));
	const top = items.length > 0 && items[0].path.includes("/") ? items[0].path.slice(0, items[0].path.indexOf("/")) : "";
	const folder = SANDBOX_PATH_SEGMENT_RE.test(top) && items.every((item) => item.path.startsWith(`${top}/`)) ? top : "";
	if (folder) items = items.map((item) => ({ ...item, path: item.path.slice(folder.length + 1) }));

	/** @type {typeof items} */
	const kept = [];
	/** @type {string[]} */
	const skipped = [];
	/** @type {Set<string>} */
	const seen = new Set();
	let total = 0;
	for (const item of items) {
		if (!isValidSandboxPath(item.path)) {
			result.errors.push(t("core_sandbox_bad_path", item.path));
			continue;
		}
		// Different only in letter case = the same file on Windows and macOS.
		const key = item.path.toLowerCase();
		if (seen.has(key)) {
			result.errors.push(t("core_sandbox_duplicate_path", item.path));
			continue;
		}
		seen.add(key);
		if (!getSandboxFileType(item.path)) {
			skipped.push(item.path);
			continue;
		}
		total += item.entry.size;
		kept.push(item);
	}
	if (total > SANDBOX_MAX_PACKAGE_BYTES) {
		result.errors.push(t("core_sandbox_too_large", formatBytes(total), formatBytes(SANDBOX_MAX_PACKAGE_BYTES)));
	}
	if (result.errors.length > 0) return result;

	const archiveName = fileName.replace(/\.zip$/i, "");
	const hints = [folder, archiveName].filter((hint) => /^[A-Za-z][A-Za-z0-9]*$/.test(hint));
	const entries = findSandboxEntry(
		kept.map((item) => item.path),
		hints
	);
	if (entries.length !== 1) {
		result.errors.push(
			entries.length > 1 ? t("core_sandbox_ambiguous_entry", entries[0], entries[1]) : t("core_sandbox_no_entry", hints[0] || "<name>")
		);
		return result;
	}
	const entry = entries[0];
	const match = /** @type {RegExpExecArray} */ (SANDBOX_SCRIPT_NAME_RE.exec(entry));

	/** @type {Types.SandboxPackageFiles} */
	const files = {};
	for (const item of kept) {
		const extraction = await extractZipEntry(bytes, item.entry);
		if (!extraction.ok) {
			result.errors.push(describeZipProblem(extraction.problem));
			return result;
		}
		const fileType = /** @type {Types.SandboxFileType} */ (getSandboxFileType(item.path));
		if (fileType.text && decodeSandboxText(extraction.data) === null) {
			result.errors.push(t("core_sandbox_not_utf8", item.path));
			continue;
		}
		files[item.path] = { type: fileType.type, data: extraction.data };
	}
	const messagesError = checkSandboxMessages(files);
	if (messagesError) result.errors.push(messagesError);
	if (result.errors.length > 0) return result;

	if (skipped.length > 0) result.warnings.push(t("core_sandbox_skipped_files", skipped.join(", ")));
	result.content = { name: match[1], entry, format: match[2] === "mjs" ? "module" : "script", files };
	return result;
}

// A module specifier of a JS module of the package (from = its path in the package) → a file of
// the package, or the SDK; null = outside the package (a bare name, an address, a path out of
// the module folder). It is resolved as if the package were modules/<name>/ of the extension,
// so "../../sdk.mjs" from the module folder is the SDK — the same import as in a module from
// the package.
/** @type {Functions.Base.resolveSandboxImport} */
export function resolveSandboxImport(name, from, specifier) {
	if (!/^\.{1,2}\//.test(specifier) || /[?#\\]/.test(specifier)) return null;
	const segments = ["modules", name, ...from.split("/").slice(0, -1)];
	for (const segment of specifier.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment !== "..") {
			segments.push(segment);
		} else if (segments.pop() === undefined) {
			return null;
		}
	}
	const resolved = segments.join("/");
	if (resolved === SANDBOX_SDK_PATH) return { kind: "sdk" };
	const prefix = `modules/${name}/`;
	return resolved.startsWith(prefix) ? { kind: "file", path: resolved.slice(prefix.length) } : null;
}

// What the sandbox needs to load the package: for a JS module (.mjs entry) the files of its module
// graph, dependencies first, and in each the places to rewrite — module specifiers (a file of
// the package, the SDK) and import.meta (the virtual address of the file). The sandbox creates
// the address of a file only when the files it imports have theirs, so a cycle of imports is an
// error, as well as an import outside the package, of a missing file or of a file that is not a
// JS module or JSON (CSS belongs into registerModule({ styles })). A classic script (.js
// entry) must not use import/export. Warnings: the convention of the extensions (a file with
// import/export is .mjs, without them .js — the same as validateModuleFileExtension()),
// import() with a computed address and scripts nothing imports.
/** @type {Functions.Base.planSandboxPackage} */
export async function planSandboxPackage(content) {
	/** @type {Types.SandboxPlanned} */
	const result = { plan: null, errors: [], warnings: [] };
	/** @type {(path: string) => string} */
	const text = (path) => decodeSandboxText(content.files[path].data) ?? "";
	const scripts = Object.keys(content.files).filter((path) => /\.m?js$/.test(path));

	if (content.format === "script") {
		if (looksLikeEsModuleSource(text(content.entry))) result.errors.push(t("core_sandbox_es_module", content.entry));
		const unused = scripts.filter((path) => path !== content.entry);
		if (unused.length > 0) result.warnings.push(t("core_sandbox_unused_scripts", unused.join(", ")));
		return result;
	}

	const { scanModuleSource } = await loadSandboxPackageTools();
	/** @type {Types.SandboxModulePlan} */
	const plan = { order: [], rewrites: {} };
	/** @type {Map<string, "visiting" | "done">} */
	const state = new Map();
	/** @type {Set<string>} */
	const errors = new Set();
	/** @type {Functions.Base.planSandboxPackage.visit} */
	const visit = (path, chain) => {
		if (state.get(path) === "done") return;
		if (state.get(path) === "visiting") {
			errors.add(t("core_sandbox_import_cycle", [...chain.slice(chain.indexOf(path)), path].join(" → ")));
			return;
		}
		state.set(path, "visiting");
		const source = text(path);
		const scan = scanModuleSource(source);
		/** @type {Types.SandboxRewrite[]} */
		const rewrites = scan.metas.map(({ start, end }) => ({ start, end, target: { kind: "meta" } }));
		for (const { start, end, specifier } of scan.imports) {
			const target = resolveSandboxImport(content.name, path, specifier);
			if (!target) {
				errors.add(t("core_sandbox_import_outside", path, specifier));
				continue;
			}
			if (target.kind === "file") {
				if (!Object.hasOwn(content.files, target.path)) {
					errors.add(t("core_sandbox_import_missing", path, specifier));
					continue;
				}
				if (/\.m?js$/.test(target.path)) {
					visit(target.path, [...chain, path]);
				} else if (!target.path.endsWith(".json")) {
					errors.add(t("core_sandbox_import_type", path, specifier));
					continue;
				}
			}
			rewrites.push({ start, end, target });
		}
		if (scan.dynamic > 0) result.warnings.push(t("core_sandbox_dynamic_import", path));
		const moduleSyntax = looksLikeEsModuleSource(source);
		if (moduleSyntax && path.endsWith(".js")) result.warnings.push(t("core_sandbox_js_with_module", path));
		if (!moduleSyntax && path.endsWith(".mjs")) result.warnings.push(t("core_sandbox_mjs_without_module", path));
		plan.rewrites[path] = rewrites.sort((a, b) => a.start - b.start);
		plan.order.push(path);
		state.set(path, "done");
	};
	visit(content.entry, []);

	const unused = scripts.filter((path) => !state.has(path));
	if (unused.length > 0) result.warnings.push(t("core_sandbox_unused_scripts", unused.join(", ")));
	result.errors.push(...errors);
	if (result.errors.length === 0) result.plan = plan;
	return result;
}

// Texts of the problems reported by the sandbox; an unknown code has a general text.
/** @type {Functions.Base.describeSandboxProblems} */
export function describeSandboxProblems(problems) {
	if (!Array.isArray(problems)) return [];
	return problems.map((problem) => {
		const code = isPlainObject(problem) ? problem.code : null;
		const args = isPlainObject(problem) && Array.isArray(problem.args) ? problem.args.map(String) : [];
		return typeof code === "string" && Object.hasOwn(SANDBOX_PROBLEM_TEXTS, code)
			? SANDBOX_PROBLEM_TEXTS[/** @type {Enums.SandboxProblemCode} */ (code)](args)
			: t("core_sandbox_problem_unknown");
	});
}

// The api methods of an uploaded module and their kind — the sandbox builds this.api from them.
/** @type {Functions.Base.getSandboxApiMethods} */
export function getSandboxApiMethods() {
	return /** @type {Record<Types.SandboxApiMethod, Enums.SandboxApiKind>} */ (
		Object.fromEntries(Object.entries(SANDBOX_API).map(([method, handler]) => [method, handler.kind]))
	);
}

/** @type {Functions.Base.getSandboxApiHandler} */
function getSandboxApiHandler(method) {
	return typeof method === "string" && Object.hasOwn(SANDBOX_API, method) ? SANDBOX_API[/** @type {Types.SandboxApiMethod} */ (method)] : null;
}

// A request of an uploaded module ("call") — a method from SANDBOX_API is run through ITS api
// (createModuleApi(name)); the arguments come from foreign code, the handler normalizes them and
// the api checks them further. Anything else is a function outside the sandbox
// (requestSandboxCapability()) — run, or refused, and recorded either way.
/** @type {Functions.Base.callSandboxApi} */
export async function callSandboxApi(api, mod, method, args, host = null) {
	const handler = getSandboxApiHandler(method);
	if (handler && handler.kind !== "call") {
		throw new Error(t("core_sandbox_api_denied", String(method)));
	}
	if (!handler) return requestSandboxCapability(mod, method, args, sandboxCapabilityContext(api, host, mod));
	return handler.run(api, Array.isArray(args) ? [...args] : [], mod, host);
}

// A listener of an uploaded module ("subscribe"); returns a function to unsubscribe. Any other name
// is a listener of the catalog (capabilities.listen()) — the core decides about it after it reads the
// user's decisions, so the function to unsubscribe comes as a Promise (listenSandboxCapability()).
/** @type {Functions.Base.subscribeSandboxApi} */
export function subscribeSandboxApi(api, mod, method, args, emit, host = null) {
	const handler = getSandboxApiHandler(method);
	if (!handler) return listenSandboxCapability(mod, method, Array.isArray(args) ? [...args] : [], emit, sandboxCapabilityContext(api, host, mod));
	if (handler.kind !== "subscribe") throw new Error(t("core_sandbox_api_denied", String(method)));
	return handler.run(api, Array.isArray(args) ? [...args] : [], mod, emit, host);
}

// What the core knows about the name of a function outside the sandbox: part of SANDBOX_API (no need
// to declare it), a function of the catalog, one that cannot be allowed (and why), or unknown.
/** @type {Functions.Base.describeSandboxCapability} */
export function describeSandboxCapability(name) {
	if (getSandboxApiHandler(name)) return { name, kind: "base", risk: null, about: null, blocked: null, reason: null };
	if (Object.hasOwn(SANDBOX_CAPABILITIES, name)) {
		const capability = SANDBOX_CAPABILITIES[name];
		return { name, kind: "catalog", risk: capability.risk, about: capability.about(), blocked: null, reason: null };
	}
	if (SANDBOX_CAPABILITY_NAME_RE.test(name)) {
		const rule = SANDBOX_FORBIDDEN_CAPABILITIES.find((item) => item.names.some((prefix) => name === prefix || name.startsWith(`${prefix}.`)));
		if (rule) return { name, kind: "forbidden", risk: null, about: null, blocked: SANDBOX_CAPABILITY_BLOCK_TEXTS[rule.reason](), reason: rule.reason };
	}
	return { name, kind: "unknown", risk: null, about: null, blocked: null, reason: null };
}

// The functions a module declared in registerModule({ capabilities }) — only valid names (validateModule()
// reports the others when uploading).
/** @type {Functions.Base.getDeclaredSandboxCapabilities} */
function getDeclaredSandboxCapabilities(capabilities) {
	return Array.isArray(capabilities) ? capabilities.filter((name) => typeof name === "string" && SANDBOX_CAPABILITY_NAME_RE.test(name)) : [];
}

// Who asks: the module, what it declared and whether the extension brings it itself — from its
// definition on the page (moduleDef.sandbox) or from its stored record (Settings).
// A module of another extension (an allowed client, see "Modules from other extensions") counts as one the extension
// brings itself — the user allowed the client with what its modules declare — and the functions its client serves
// are its client's (services).
/** @type {Functions.Base.sandboxCapabilityHolder} */
function sandboxCapabilityHolder(mod) {
	return {
		name: mod.name,
		capabilities: getDeclaredSandboxCapabilities(mod.capabilities),
		bundled: mod.sandbox?.bundled === true || typeof mod.sandbox?.client === "string",
		services: mod.sandbox?.client ? (mod.sandbox.services ?? []).map((service) => service.name) : [],
	};
}

// The state of one function for a module by the rules above (the user's decisions are grants). With
// the context of the element an allowed function that cannot work there is "unavailable".
/** @type {Functions.Base.sandboxCapabilityState} */
function sandboxCapabilityState(holder, name, grants, context = null) {
	const info = describeSandboxCapability(name);
	if (info.kind === "base") return "allowed";
	// A function the client of the module serves — the client decides what it can do; the user can deny it.
	if (holder.services?.includes(name)) {
		if (!holder.capabilities.includes(name)) return "undeclared";
		const own = Object.hasOwn(grants, holder.name) && isPlainObject(grants[holder.name]) ? grants[holder.name] : {};
		return own[name] === false ? "denied" : "allowed";
	}
	if (info.kind !== "catalog") return info.kind;
	if (!holder.capabilities.includes(name)) return "undeclared";
	const own = Object.hasOwn(grants, holder.name) && isPlainObject(grants[holder.name]) ? grants[holder.name] : {};
	const decision = Object.hasOwn(own, name) ? own[name] : undefined;
	if (decision === false) return "denied";
	if (decision !== true && !holder.bundled) return "pending";
	const available = SANDBOX_CAPABILITIES[name].available;
	return context && available && !available(context) ? "unavailable" : "allowed";
}

/** @type {Functions.Base.sandboxCapabilityContext} */
function sandboxCapabilityContext(api, host, mod) {
	return { api, location: host ? host.location : null, module: mod };
}

// The state of one function for a stored uploaded module (Types.SandboxModuleRecord) by the given decisions —
// without an element and its page: background.js asks so whether the core may still do for the module what it
// set earlier or declared (contentFilters.set, networkFilters.set — the user may have denied it since, a new
// version may not declare it).
/** @type {Functions.Base.getStoredSandboxCapabilityState} */
export function getStoredSandboxCapabilityState(record, name, grants) {
	const registration = pickSandboxRegistration(record);
	const holder = {
		name: record.name,
		capabilities: getDeclaredSandboxCapabilities(registration?.capabilities),
		bundled: record.bundled === true || typeof record.client === "string",
		services: typeof record.client === "string" ? (record.services ?? []).map((service) => service.name) : [],
	};
	return sandboxCapabilityState(holder, name, grants);
}

// The user's decisions (SANDBOX_CAPABILITY_GRANTS_KEY); an unreadable value = no decisions.
/** @type {Functions.Base.readSandboxCapabilityGrants} */
export async function readSandboxCapabilityGrants() {
	try {
		const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(SANDBOX_CAPABILITY_GRANTS_KEY))[SANDBOX_CAPABILITY_GRANTS_KEY];
		return isPlainObject(stored) ? /** @type {Types.SandboxCapabilityGrants} */ (stored) : {};
	} catch (err) {
		console.error("Rozhodnutí o funkcích nahraných modulů nejde načíst:", err);
		return {};
	}
}

// The states of the functions the module declared — capabilities.state() of its api.
/** @type {Functions.Base.getSandboxCapabilityStates} */
export async function getSandboxCapabilityStates(mod, context = null) {
	const holder = sandboxCapabilityHolder(mod);
	const grants = await readSandboxCapabilityGrants();
	return Object.fromEntries(holder.capabilities.map((name) => [name, sandboxCapabilityState(holder, name, grants, context)]));
}

// capabilities.onChange() of the module's api: the states again after every change of the decisions
// that changes one of them. Returns a function to unsubscribe.
/** @type {Functions.Base.onSandboxCapabilityStatesChange} */
function onSandboxCapabilityStatesChange(mod, emit, context = null) {
	let last = "";
	let active = true;
	const ready = getSandboxCapabilityStates(mod, context).then((states) => {
		last = JSON.stringify(states);
	});
	/** @type {Types.StorageChangeListener} */
	const listener = (changes, area) => {
		if (area !== "local" || !changes[SANDBOX_CAPABILITY_GRANTS_KEY]) return;
		ready
			.then(() => getSandboxCapabilityStates(mod, context))
			.then((states) => {
				const value = JSON.stringify(states);
				if (!active || value === last) return;
				last = value;
				emit(states);
			})
			.catch((err) => console.error(err));
	};
	chrome.storage.onChanged.addListener(listener);
	return () => {
		active = false;
		chrome.storage.onChanged.removeListener(listener);
	};
}

// The user decides in Settings: true = allow, false = deny, null = undecided again. Only a function of
// the catalog — the others cannot be allowed. Recorded like the requests.
/** @type {Functions.Base.setSandboxCapabilityGrant} */
export async function setSandboxCapabilityGrant(moduleName, name, decision) {
	if (!Object.hasOwn(SANDBOX_CAPABILITIES, name)) return false;
	await withSandboxLock("sandboxCapabilityGrants", async () => {
		const grants = await readSandboxCapabilityGrants();
		/** @type {Record<string, boolean>} */
		const own = { ...(Object.hasOwn(grants, moduleName) && isPlainObject(grants[moduleName]) ? grants[moduleName] : {}) };
		if (decision === null) {
			delete own[name];
		} else {
			own[name] = decision === true;
		}
		const next = { ...grants };
		if (Object.keys(own).length > 0) {
			next[moduleName] = own;
		} else {
			delete next[moduleName];
		}
		await chrome.storage.local.set({ [SANDBOX_CAPABILITY_GRANTS_KEY]: next });
	});
	recordSandboxCapabilityUse(moduleName, name, decision === null ? "userReset" : decision ? "userAllowed" : "userDenied");
	return true;
}

// Removes the decisions about functions the module no longer declares (a new version of it, see
// installSandboxContent()), or all of them (null — the module was removed).
/** @type {Functions.Base.pruneSandboxCapabilityGrants} */
async function pruneSandboxCapabilityGrants(moduleName, declared) {
	await withSandboxLock("sandboxCapabilityGrants", async () => {
		const grants = await readSandboxCapabilityGrants();
		if (!Object.hasOwn(grants, moduleName)) return;
		const own = isPlainObject(grants[moduleName]) ? grants[moduleName] : {};
		const kept = Object.fromEntries(Object.entries(own).filter(([name]) => declared !== null && declared.includes(name)));
		if (Object.keys(kept).length === Object.keys(own).length && isPlainObject(grants[moduleName])) return;
		const next = { ...grants };
		if (Object.keys(kept).length > 0) {
			next[moduleName] = kept;
		} else {
			delete next[moduleName];
		}
		await chrome.storage.local.set({ [SANDBOX_CAPABILITY_GRANTS_KEY]: next });
	});
}

// Read-modify-write of a shared key: extension pages opened at the same time take turns (Web Locks);
// without them (a test without navigator.locks) right away.
/** @type {Functions.Base.withSandboxLock} */
async function withSandboxLock(name, work) {
	const locks = globalThis.navigator?.locks;
	return locks ? locks.request(name, work) : work();
}

// The name of a requested function as it goes into the record — a module may send anything.
/** @type {Functions.Base.sandboxCapabilityLogName} */
function sandboxCapabilityLogName(method) {
	const name = typeof method === "string" ? method : `(${typeof method})`;
	return name.slice(0, SANDBOX_CAPABILITY_MAX_NAME);
}

// A function outside the sandbox (see the section above): its state for the module decides; an
// allowed one runs its catalog entry — unless the browser wants a click for it (clickOnly: only from a
// button the core draws, SandboxModuleElement._clickButton()) or it is a listener (only
// capabilities.listen(), listenSandboxCapability()). Recorded either way.
/** @type {Functions.Base.requestSandboxCapability} */
async function requestSandboxCapability(mod, method, args, context) {
	const name = sandboxCapabilityLogName(method);
	const state = sandboxCapabilityState(sandboxCapabilityHolder(mod), name, await readSandboxCapabilityGrants(), context);
	if (state !== "allowed") throw refuseSandboxCapability(mod.name, name, state);
	const served = clientServiceKind(mod, name);
	if (served === "listen") {
		recordSandboxCapabilityUse(mod.name, name, "failed");
		throw new Error(t("core_sandbox_capability_listener", name));
	}
	if (served === "call") return runSandboxCapability(mod.name, name, Array.isArray(args) ? [...args] : [], context);
	if (SANDBOX_CAPABILITIES[name].clickOnly) {
		recordSandboxCapabilityUse(mod.name, name, "clickOnly");
		throw new Error(t("core_sandbox_capability_click_only", name));
	}
	if (SANDBOX_CAPABILITIES[name].listen) {
		recordSandboxCapabilityUse(mod.name, name, "failed");
		throw new Error(t("core_sandbox_capability_listener", name));
	}
	return runSandboxCapability(mod.name, name, Array.isArray(args) ? [...args] : [], context);
}

// A listener of the catalog (capabilities.listen()): the same rules as for a request — refused (the
// Promise rejects with the reason), or started and recorded once. While it runs it follows the user's
// decisions: a function denied in the meantime delivers no events until it is allowed again.
/** @type {Functions.Base.listenSandboxCapability} */
async function listenSandboxCapability(mod, method, args, emit, context) {
	const name = sandboxCapabilityLogName(method);
	const holder = sandboxCapabilityHolder(mod);
	// The decisions are watched before they are read — no change in between is lost.
	/** @type {Types.SandboxCapabilityGrants | null} */
	let grants = null;
	/** @type {Types.StorageChangeListener} */
	const watch = (changes, area) => {
		if (area !== "local" || !changes[SANDBOX_CAPABILITY_GRANTS_KEY]) return;
		const value = changes[SANDBOX_CAPABILITY_GRANTS_KEY].newValue;
		grants = isPlainObject(value) ? /** @type {Types.SandboxCapabilityGrants} */ (value) : {};
	};
	chrome.storage.onChanged.addListener(watch);
	try {
		const stored = await readSandboxCapabilityGrants();
		grants ??= stored;
		const state = sandboxCapabilityState(holder, name, grants, context);
		if (state !== "allowed") throw refuseSandboxCapability(mod.name, name, state);
		// A listener the client of the module serves (its changes come from the client), or one of the catalog.
		const served = clientServiceKind(mod, name);
		const client = mod.sandbox?.client;
		const listen =
			served === "listen" && client
				? /** @type {Types.SandboxCapabilityListen} */ ((_args, _context, emitValue) => listenExtensionService(client, name, emitValue))
				: served
					? undefined
					: SANDBOX_CAPABILITIES[name].listen;
		if (!listen) {
			recordSandboxCapabilityUse(mod.name, name, "failed");
			throw new Error(t("core_sandbox_capability_not_listener", name));
		}
		/** @type {() => void} */
		let stop;
		try {
			stop = listen(args, context, (value) => {
				if (sandboxCapabilityState(holder, name, grants ?? {}, context) === "allowed") emit(value);
			});
		} catch (err) {
			recordSandboxCapabilityUse(mod.name, name, "failed");
			throw err;
		}
		recordSandboxCapabilityUse(mod.name, name, "allowed");
		return () => {
			chrome.storage.onChanged.removeListener(watch);
			stop();
		};
	} catch (err) {
		chrome.storage.onChanged.removeListener(watch);
		throw err;
	}
}

/** @type {Functions.Base.refuseSandboxCapability} */
function refuseSandboxCapability(moduleName, name, state) {
	recordSandboxCapabilityUse(moduleName, name, state);
	return new Error(SANDBOX_CAPABILITY_REFUSALS[state](name));
}

// An async function runs synchronously up to its first await — run() of the function is called right
// away, within the click of a button the core drew.
/** @type {Functions.Base.runSandboxCapability} */
async function runSandboxCapability(moduleName, name, args, context) {
	try {
		// A function the client of the module serves goes to the client (its code, its permissions).
		const client = context.module?.sandbox?.client;
		if (client && clientServiceKind(context.module, name) === "call") {
			const value = await callExtensionService(client, name, args, context.location);
			recordSandboxCapabilityUse(moduleName, name, "allowed");
			return value;
		}
		const { run } = SANDBOX_CAPABILITIES[name];
		// A listener has no run() — requestSandboxCapability() and normalizeSandboxButtons() refuse it first.
		if (!run) throw new Error(t("core_sandbox_capability_listener", name));
		const value = await run(args, context);
		recordSandboxCapabilityUse(moduleName, name, "allowed");
		return value;
	} catch (err) {
		recordSandboxCapabilityUse(moduleName, name, "failed");
		throw err;
	}
}

// api.buttons.set(): the buttons as data the core can draw — every function one the module declared
// (whether it may run is decided by the click, the same as for a request).
/** @type {Functions.Base.normalizeSandboxButtons} */
function normalizeSandboxButtons(buttons, declared) {
	/** @type {(path: string) => Error} */
	const invalid = (path) => new Error(t("core_sandbox_buttons_invalid", path));
	if (!Array.isArray(buttons)) throw invalid("buttons");
	if (buttons.length > SANDBOX_MAX_BUTTONS) throw new Error(t("core_sandbox_buttons_too_many", String(buttons.length), String(SANDBOX_MAX_BUTTONS)));
	/** @type {Set<string>} */
	const ids = new Set();
	return buttons.map((item, index) => {
		const path = `buttons[${index}]`;
		if (!isPlainObject(item)) throw invalid(path);
		const { id, label, title, disabled, capability, args } = item;
		if (typeof id !== "string" || !SANDBOX_BUTTON_ID_RE.test(id) || ids.has(id)) throw invalid(`${path}.id`);
		ids.add(id);
		if (typeof label !== "string" || label.trim() === "" || label.length > SANDBOX_BUTTON_MAX_LABEL) throw invalid(`${path}.label`);
		if (title !== undefined && (typeof title !== "string" || title.length > SANDBOX_BUTTON_MAX_TITLE)) throw invalid(`${path}.title`);
		if (disabled !== undefined && typeof disabled !== "boolean") throw invalid(`${path}.disabled`);
		if (typeof capability !== "string") throw invalid(`${path}.capability`);
		if (!declared.includes(capability)) throw new Error(t("core_sandbox_capability_undeclared", capability.slice(0, SANDBOX_CAPABILITY_MAX_NAME)));
		// A listener cannot be clicked (capabilities.listen()).
		if (Object.hasOwn(SANDBOX_CAPABILITIES, capability) && SANDBOX_CAPABILITIES[capability].listen) throw invalid(`${path}.capability`);
		if (args !== undefined && !Array.isArray(args)) throw invalid(`${path}.args`);
		return { id, label, title: title || null, disabled: disabled === true, capability, args: args ? [...args] : [] };
	});
}

// --- The content the core draws (api.ui.render()) ---

// Checks the content an uploaded module asks the core to draw in the extension page and returns it
// in one shape (Types.SandboxUiNode[]), or null — the module shows its frame again. Data only: the
// known node types with their fields, texts as text (never HTML), links only to http:/https:, the ids
// of the controls unique; a string or a list of inline nodes wherever text goes; a button runs only a
// function the module declared (declared — the same as api.buttons.set()); microdata only of schema.org (an
// item — a block with "item" or an inline "item" with its <meta> properties —, "itemprop" of a text). Anything
// else, or more than the limits (SANDBOX_UI_MAX_*), rejects the whole content.
/** @type {Functions.Base.normalizeSandboxUi} */
export function normalizeSandboxUi(content, declared = []) {
	if (content === null) return null;
	/** @type {(path: string) => Error} */
	const invalid = (path) => new Error(t("core_sandbox_ui_invalid", path));
	const tooLarge = () =>
		new Error(t("core_sandbox_ui_too_large", String(SANDBOX_UI_MAX_NODES), String(SANDBOX_UI_MAX_DEPTH), String(SANDBOX_UI_MAX_TOTAL_TEXT)));
	let nodes = 0;
	let textLength = 0;
	/** @type {Set<string>} */
	const ids = new Set();
	const count = () => {
		if (++nodes > SANDBOX_UI_MAX_NODES) throw tooLarge();
	};
	/** @type {(value: unknown, path: string, max?: number) => string} */
	const text = (value, path, max = SANDBOX_UI_MAX_TEXT) => {
		if (typeof value !== "string" || value.length > max) throw invalid(path);
		textLength += value.length;
		if (textLength > SANDBOX_UI_MAX_TOTAL_TEXT) throw tooLarge();
		return value;
	};
	/** @type {(value: unknown, path: string) => string | null} */
	const title = (value, path) => (value === undefined || value === null ? null : text(value, path, SANDBOX_BUTTON_MAX_TITLE));
	/** @type {(value: unknown, path: string) => boolean} */
	const flag = (value, path) => {
		if (value !== undefined && typeof value !== "boolean") throw invalid(path);
		return value === true;
	};
	/** @type {(value: unknown, path: string) => string} */
	const controlId = (value, path) => {
		if (typeof value !== "string" || !SANDBOX_BUTTON_ID_RE.test(value) || ids.has(value)) throw invalid(path);
		ids.add(value);
		return value;
	};
	/** @type {(value: unknown, path: string) => Record<string, unknown>[]} */
	const list = (value, path) => {
		if (!Array.isArray(value)) throw invalid(path);
		return value;
	};
	// The property of the nearest item a node is (only when it has one — the other nodes keep their shape).
	/** @type {(value: unknown, path: string) => { itemprop?: string }} */
	const itemprop = (value, path) => {
		if (value === undefined || value === null) return {};
		if (typeof value !== "string" || !SANDBOX_UI_ITEMPROP_RE.test(value)) throw invalid(path);
		return { itemprop: value };
	};
	// An item of microdata: its schema.org type, and the property of the parent item it is.
	/** @type {(value: Record<string, unknown>, path: string) => Types.SandboxUiItem} */
	const item = (value, path) => {
		const { itemtype } = value;
		if (typeof itemtype !== "string" || !SANDBOX_UI_ITEMTYPE_RE.test(itemtype)) throw invalid(`${path}.itemtype`);
		return { itemtype, ...itemprop(value.itemprop, `${path}.itemprop`) };
	};

	/** @type {(node: unknown, path: string, depth?: number) => Types.SandboxUiInline} */
	const inline = (node, path, depth = 1) => {
		count();
		if (typeof node === "string") return text(node, path);
		if (!isPlainObject(node)) throw invalid(path);
		switch (node.type) {
			case "strong":
			case "em":
			case "code":
				return { type: node.type, text: text(node.text, `${path}.text`), ...itemprop(node.itemprop, `${path}.itemprop`) };
			case "text":
				return { type: "text", text: text(node.text, `${path}.text`), ...itemprop(node.itemprop, `${path}.itemprop`) };
			case "item": {
				if (depth > SANDBOX_UI_MAX_DEPTH) throw tooLarge();
				const meta = node.meta === undefined ? [] : list(node.meta, `${path}.meta`);
				if (meta.length > SANDBOX_UI_MAX_META) throw invalid(`${path}.meta`);
				return {
					type: "item",
					...item(node, path),
					meta: meta.map((entry, index) => {
						const metaPath = `${path}.meta[${index}]`;
						if (!isPlainObject(entry) || typeof entry.itemprop !== "string") throw invalid(metaPath);
						count();
						return { itemprop: /** @type {string} */ (itemprop(entry.itemprop, `${metaPath}.itemprop`).itemprop), content: text(entry.content, `${metaPath}.content`) };
					}),
					content: typeof node.content === "string" ? [inline(node.content, `${path}.content`, depth + 1)] : list(node.content, `${path}.content`).map((child, index) => inline(child, `${path}.content[${index}]`, depth + 1)),
				};
			}
			case "link": {
				const href = text(node.href, `${path}.href`, SANDBOX_UI_MAX_URL);
				/** @type {URL} */
				let url;
				try {
					url = new URL(href);
				} catch {
					throw invalid(`${path}.href`);
				}
				if (url.protocol !== "http:" && url.protocol !== "https:") throw invalid(`${path}.href`);
				return {
					type: "link",
					text: text(node.text, `${path}.text`),
					href: url.href,
					title: title(node.title, `${path}.title`),
					muted: flag(node.muted, `${path}.muted`),
				};
			}
			case "button": {
				const label = text(node.label, `${path}.label`, SANDBOX_BUTTON_MAX_LABEL);
				if (label.trim() === "") throw invalid(`${path}.label`);
				const id = controlId(node.id, `${path}.id`);
				const look = node.look === undefined ? "button" : node.look;
				if (look !== "button" && look !== "link") throw invalid(`${path}.look`);
				// A function outside the sandbox the click runs within the click (as a button of api.buttons) — instead of
				// reporting the click to the module.
				const { capability, args } = node;
				if (capability !== undefined) {
					if (typeof capability !== "string") throw invalid(`${path}.capability`);
					if (!declared.includes(capability)) throw new Error(t("core_sandbox_capability_undeclared", capability.slice(0, SANDBOX_CAPABILITY_MAX_NAME)));
					// A listener cannot be clicked (capabilities.listen()).
					if (Object.hasOwn(SANDBOX_CAPABILITIES, capability) && SANDBOX_CAPABILITIES[capability].listen) throw invalid(`${path}.capability`);
				}
				if (args !== undefined && (capability === undefined || !Array.isArray(args))) throw invalid(`${path}.args`);
				return {
					type: "button",
					id,
					label,
					title: title(node.title, `${path}.title`),
					disabled: flag(node.disabled, `${path}.disabled`),
					look,
					capability: capability ?? null,
					args: Array.isArray(args) ? [...args] : [],
				};
			}
			case "checkbox": {
				const label = text(node.label, `${path}.label`, SANDBOX_UI_MAX_CHECKBOX_LABEL);
				if (label.trim() === "") throw invalid(`${path}.label`);
				return {
					type: "checkbox",
					id: controlId(node.id, `${path}.id`),
					label,
					title: title(node.title, `${path}.title`),
					checked: flag(node.checked, `${path}.checked`),
					disabled: flag(node.disabled, `${path}.disabled`),
				};
			}
			default:
				throw invalid(`${path}.type`);
		}
	};
	// Text: one string, or a list of inline nodes.
	/** @type {(value: unknown, path: string) => Types.SandboxUiInline[]} */
	const line = (value, path) => {
		if (typeof value === "string") return [inline(value, path)];
		return list(value, path).map((node, index) => inline(node, `${path}[${index}]`));
	};
	/** @type {(value: unknown, path: string, depth: number) => Types.SandboxUiNode[]} */
	const blocks = (value, path, depth) => {
		if (depth > SANDBOX_UI_MAX_DEPTH) throw tooLarge();
		return list(value, path).map((node, index) => block(node, `${path}[${index}]`, depth));
	};
	/** @type {(node: unknown, path: string, depth: number) => Types.SandboxUiNode} */
	const block = (node, path, depth) => {
		if (typeof node === "string" || (isPlainObject(node) && SANDBOX_UI_INLINE_TYPES.includes(/** @type {string} */ (node.type)))) {
			return inline(node, path, depth);
		}
		if (!isPlainObject(node)) throw invalid(path);
		count();
		// A block can start an item of microdata (the nodes inside are its properties).
		/** @type {Types.SandboxUiItem | null} */
		let scope = null;
		if (node.item !== undefined && node.item !== null) {
			if (!isPlainObject(node.item)) throw invalid(`${path}.item`);
			scope = item(node.item, `${path}.item`);
		}
		const normalized = blockBody(node, path, depth);
		return scope ? { ...normalized, item: scope } : normalized;
	};
	/** @type {(node: Record<string, unknown>, path: string, depth: number) => Types.SandboxUiBlock} */
	const blockBody = (node, path, depth) => {
		switch (node.type) {
			case "paragraph":
			case "heading":
				return { type: node.type, content: line(node.content, `${path}.content`) };
			case "list":
				return {
					type: "list",
					ordered: flag(node.ordered, `${path}.ordered`),
					items: list(node.items, `${path}.items`).map((item, index) => {
						count();
						return line(item, `${path}.items[${index}]`);
					}),
				};
			case "definitions":
				return {
					type: "definitions",
					items: list(node.items, `${path}.items`).map((item, index) => {
						const itemPath = `${path}.items[${index}]`;
						if (!isPlainObject(item)) throw invalid(itemPath);
						count();
						return { term: line(item.term, `${itemPath}.term`), details: line(item.details, `${itemPath}.details`) };
					}),
				};
			case "table": {
				/** @type {(row: unknown, rowPath: string) => Types.SandboxUiInline[][]} */
				const cells = (row, rowPath) => {
					count();
					return list(row, rowPath).map((cell, index) => {
						count();
						return line(cell, `${rowPath}[${index}]`);
					});
				};
				return {
					type: "table",
					caption: node.caption === undefined || node.caption === null ? null : line(node.caption, `${path}.caption`),
					head: node.head === undefined || node.head === null ? null : cells(node.head, `${path}.head`),
					rows: list(node.rows, `${path}.rows`).map((row, index) => cells(row, `${path}.rows[${index}]`)),
				};
			}
			case "details":
				return {
					type: "details",
					id: node.id === undefined || node.id === null ? null : controlId(node.id, `${path}.id`),
					open: node.open === undefined || node.open === null ? null : flag(node.open, `${path}.open`),
					summary: line(node.summary, `${path}.summary`),
					content: blocks(node.content, `${path}.content`, depth + 1),
				};
			case "group":
				return { type: "group", content: blocks(node.content, `${path}.content`, depth + 1) };
			default:
				throw invalid(`${path}.type`);
		}
	};
	return blocks(content, "content", 1);
}

// Draws the checked content (normalizeSandboxUi()) as elements of the page doc — only through
// createElement() and text, never as HTML; no class, style or id of the module (an id would clash
// with the page — the controls carry theirs in data-ui-id). The controls report to emit (a click, a
// change of a checkbox, a details opened or closed by the user); a button with a function goes to run
// instead, synchronously within the click; a details without its own "open" takes wasOpen() — what the
// user had open before. Returns the nodes and the controls by their id.
/** @type {Functions.Base.renderSandboxUi} */
export function renderSandboxUi(doc, nodes, { emit, wasOpen, run }) {
	/** @type {Map<string, HTMLElement>} */
	const controls = new Map();
	/** @type {<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) => HTMLElementTagNameMap[K]} */
	const element = (tag, className) => {
		const created = doc.createElement(tag);
		if (className) created.className = className;
		return created;
	};
	// An element that starts an item of microdata (itemscope, itemtype of schema.org, itemprop of the parent item).
	/** @type {<E extends HTMLElement>(created: E, scope: Types.SandboxUiItem | undefined) => E} */
	const scoped = (created, scope) => {
		if (!scope) return created;
		created.setAttribute("itemscope", "");
		created.setAttribute("itemtype", scope.itemtype);
		if (scope.itemprop) created.setAttribute("itemprop", scope.itemprop);
		return created;
	};
	/** @type {(parent: HTMLElement | DocumentFragment, node: Types.SandboxUiInline) => void} */
	const appendInline = (parent, node) => {
		if (typeof node === "string") {
			parent.append(node);
			return;
		}
		switch (node.type) {
			case "strong":
			case "em":
			case "code":
			case "text": {
				const created = element(node.type === "text" ? "span" : node.type);
				created.textContent = node.text;
				if (node.itemprop) created.setAttribute("itemprop", node.itemprop);
				parent.append(created);
				return;
			}
			case "item": {
				const span = scoped(element("span"), node);
				for (const { itemprop, content } of node.meta) {
					const meta = element("meta");
					meta.setAttribute("itemprop", itemprop);
					meta.setAttribute("content", content);
					span.append(meta);
				}
				parent.append(appendLine(span, node.content));
				return;
			}
			case "link": {
				const link = element("a", node.muted ? "sandbox-ui-link sandbox-ui-link--muted" : "sandbox-ui-link");
				link.href = node.href;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				link.textContent = node.text;
				if (node.title) link.title = node.title;
				parent.append(link);
				return;
			}
			case "button": {
				const button = element("button", node.look === "link" ? "sandbox-ui-button sandbox-ui-button--link" : "sandbox-ui-button");
				button.type = "button";
				button.textContent = node.label;
				if (node.title) button.title = node.title;
				button.disabled = node.disabled;
				button.dataset.uiId = node.id;
				const { id, capability, args } = node;
				button.addEventListener("click", () => {
					if (capability === null) emit({ id, type: "click" });
					else run?.(id, capability, args);
				});
				controls.set(id, button);
				parent.append(button);
				return;
			}
			case "checkbox": {
				const label = element("label", "sandbox-ui-checkbox");
				if (node.title) label.title = node.title;
				const input = element("input");
				input.type = "checkbox";
				input.checked = node.checked;
				input.disabled = node.disabled;
				input.dataset.uiId = node.id;
				const id = node.id;
				input.addEventListener("change", () => emit({ id, type: "change", checked: input.checked }));
				controls.set(id, input);
				label.append(input, ` ${node.label}`);
				parent.append(label);
				return;
			}
		}
	};
	/** @type {<P extends HTMLElement>(parent: P, nodes: Types.SandboxUiInline[]) => P} */
	const appendLine = (parent, line) => {
		for (const node of line) appendInline(parent, node);
		return parent;
	};
	/** @type {(parent: HTMLElement | DocumentFragment, node: Types.SandboxUiNode) => void} */
	const appendNode = (parent, node) => {
		if (typeof node === "string" || SANDBOX_UI_INLINE_TYPES.includes(node.type)) {
			appendInline(parent, /** @type {Types.SandboxUiInline} */ (node));
			return;
		}
		const block = /** @type {Types.SandboxUiBlock} */ (node);
		switch (block.type) {
			case "paragraph":
				parent.append(appendLine(scoped(element("p", "sandbox-ui-paragraph"), block.item), block.content));
				return;
			case "heading":
				parent.append(appendLine(scoped(element("h3", "sandbox-ui-heading"), block.item), block.content));
				return;
			case "list": {
				const created = scoped(element(block.ordered ? "ol" : "ul", "sandbox-ui-list"), block.item);
				for (const item of block.items) created.append(appendLine(element("li"), item));
				parent.append(created);
				return;
			}
			case "definitions": {
				const created = scoped(element("dl", "sandbox-ui-definitions"), block.item);
				for (const { term, details } of block.items) created.append(appendLine(element("dt"), term), appendLine(element("dd"), details));
				parent.append(created);
				return;
			}
			case "table": {
				const table = scoped(element("table", "sandbox-ui-table"), block.item);
				if (block.caption) table.append(appendLine(element("caption"), block.caption));
				if (block.head) {
					const row = element("tr");
					for (const cell of block.head) row.append(appendLine(element("th"), cell));
					const head = element("thead");
					head.append(row);
					table.append(head);
				}
				const body = element("tbody");
				for (const cells of block.rows) {
					const row = element("tr");
					for (const cell of cells) row.append(appendLine(element("td"), cell));
					body.append(row);
				}
				table.append(body);
				parent.append(table);
				return;
			}
			case "details": {
				const details = scoped(element("details", "sandbox-ui-details"), block.item);
				details.append(appendLine(element("summary"), block.summary));
				for (const child of block.content) appendNode(details, child);
				details.open = block.open ?? (block.id !== null && wasOpen(block.id) === true);
				if (block.id !== null) {
					const id = block.id;
					details.dataset.uiId = id;
					// "toggle" comes also after open is set above (asynchronously) — only a change the user made is reported.
					let reported = details.open;
					details.addEventListener("toggle", () => {
						if (details.open === reported) return;
						reported = details.open;
						emit({ id, type: "toggle", open: details.open });
					});
					controls.set(id, details);
				}
				parent.append(details);
				return;
			}
			case "group": {
				const group = scoped(element("div", "sandbox-ui-group"), block.item);
				for (const child of block.content) appendNode(group, child);
				parent.append(group);
				return;
			}
		}
	};
	const fragment = doc.createDocumentFragment();
	for (const node of nodes) appendNode(fragment, node);
	return { fragment, controls };
}

// --- The record (SANDBOX_CAPABILITY_LOG_KEY) ---

// Entries of this page not written yet (module, function and outcome → entry) and the timer of the
// next write (SANDBOX_CAPABILITY_LOG_FLUSH_MS after the previous one).
/** @type {Map<string, Types.SandboxCapabilityLogEntry>} */
const pendingSandboxCapabilityLog = new Map();
/** @type {ReturnType<typeof setTimeout> | null} */
let sandboxCapabilityLogTimer = null;
let lastSandboxCapabilityLogFlush = 0;
let sandboxCapabilityLogHooked = false;

// Records one request or decision: the counts are added up, the first and the last time kept.
/** @type {Functions.Base.recordSandboxCapabilityUse} */
export function recordSandboxCapabilityUse(moduleName, capability, outcome) {
	const now = Date.now();
	const key = JSON.stringify([moduleName, capability, outcome]);
	const entry = pendingSandboxCapabilityLog.get(key);
	if (entry) {
		entry.count++;
		entry.last = now;
	} else {
		pendingSandboxCapabilityLog.set(key, { module: moduleName, capability, outcome, count: 1, first: now, last: now });
	}
	// What is not written yet when the page goes away is written then (as far as the browser lets it).
	if (!sandboxCapabilityLogHooked && typeof globalThis.addEventListener === "function") {
		sandboxCapabilityLogHooked = true;
		globalThis.addEventListener("pagehide", () => {
			flushSandboxCapabilityLog().catch(() => {});
		});
	}
	if (sandboxCapabilityLogTimer !== null) return;
	const delay = Math.max(0, lastSandboxCapabilityLogFlush + SANDBOX_CAPABILITY_LOG_FLUSH_MS - now);
	sandboxCapabilityLogTimer = setTimeout(() => {
		sandboxCapabilityLogTimer = null;
		flushSandboxCapabilityLog().catch((err) => console.error("Záznam funkcí nahraných modulů nejde uložit:", err));
	}, delay);
}

/** @type {Functions.Base.isSandboxCapabilityLogEntry} */
function isSandboxCapabilityLogEntry(value) {
	return (
		isPlainObject(value) &&
		typeof value.module === "string" &&
		typeof value.capability === "string" &&
		typeof value.outcome === "string" &&
		typeof value.count === "number" &&
		typeof value.first === "number" &&
		typeof value.last === "number"
	);
}

// The stored record (only valid entries), the most recent first.
/** @type {Functions.Base.readSandboxCapabilityLog} */
export async function readSandboxCapabilityLog() {
	try {
		const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(SANDBOX_CAPABILITY_LOG_KEY))[SANDBOX_CAPABILITY_LOG_KEY];
		return Array.isArray(stored) ? stored.filter(isSandboxCapabilityLogEntry).sort((a, b) => b.last - a.last) : [];
	} catch (err) {
		console.error("Záznam funkcí nahraných modulů nejde načíst:", err);
		return [];
	}
}

// Writes the entries collected on this page into the stored record (added to the same module,
// function and outcome) and cuts it to SANDBOX_CAPABILITY_LOG_MAX entries.
/** @type {Functions.Base.flushSandboxCapabilityLog} */
export async function flushSandboxCapabilityLog() {
	if (sandboxCapabilityLogTimer !== null) {
		clearTimeout(sandboxCapabilityLogTimer);
		sandboxCapabilityLogTimer = null;
	}
	if (pendingSandboxCapabilityLog.size === 0) return;
	const batch = [...pendingSandboxCapabilityLog.values()];
	pendingSandboxCapabilityLog.clear();
	lastSandboxCapabilityLogFlush = Date.now();
	await withSandboxLock("sandboxCapabilityLog", async () => {
		const entries = await readSandboxCapabilityLog();
		/** @type {Map<string, Types.SandboxCapabilityLogEntry>} */
		const merged = new Map(entries.map((entry) => [JSON.stringify([entry.module, entry.capability, entry.outcome]), { ...entry }]));
		for (const entry of batch) {
			const key = JSON.stringify([entry.module, entry.capability, entry.outcome]);
			const stored = merged.get(key);
			if (stored) {
				stored.count += entry.count;
				stored.first = Math.min(stored.first, entry.first);
				stored.last = Math.max(stored.last, entry.last);
			} else {
				merged.set(key, entry);
			}
		}
		const next = [...merged.values()].sort((a, b) => b.last - a.last).slice(0, SANDBOX_CAPABILITY_LOG_MAX);
		await chrome.storage.local.set({ [SANDBOX_CAPABILITY_LOG_KEY]: next });
	});
}

// Clears the record of one module (Settings), or the whole record (null).
/** @type {Functions.Base.clearSandboxCapabilityLog} */
export async function clearSandboxCapabilityLog(moduleName) {
	await flushSandboxCapabilityLog();
	await withSandboxLock("sandboxCapabilityLog", async () => {
		const entries = await readSandboxCapabilityLog();
		const kept = moduleName === null ? [] : entries.filter((entry) => entry.module !== moduleName);
		if (kept.length !== entries.length) await chrome.storage.local.set({ [SANDBOX_CAPABILITY_LOG_KEY]: kept });
	});
}

// What Settings shows with a module: the functions it declared (in the UI language of the page) with
// their state for it.
/** @type {Functions.Base.getSandboxCapabilityOverview} */
export function getSandboxCapabilityOverview(record, grants) {
	const registration = pickSandboxRegistration(record);
	const holder = { name: record.name, capabilities: getDeclaredSandboxCapabilities(registration?.capabilities), bundled: record.bundled === true };
	return holder.capabilities.map((name) => ({ ...describeSandboxCapability(name), state: sandboxCapabilityState(holder, name, grants) }));
}

// --- The functions of the catalog ---

// tabs.create({ url, active }) — a web address only. Without chrome.tabs (the floating window's
// <iframe> in Firefox) via window.open(), always in the foreground.
/** @type {Functions.Base.openSandboxWebTab} */
async function openSandboxWebTab(options) {
	const input = isPlainObject(options) ? options : {};
	const url = typeof input.url === "string" ? input.url : "";
	/** @type {URL | null} */
	let parsed = null;
	try {
		parsed = url.length <= SANDBOX_CAPABILITY_MAX_URL ? new URL(url) : null;
	} catch {
		// Not an address — the same error as another scheme.
	}
	if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
		throw new Error(t("core_sandbox_capability_bad_url", url.slice(0, 200)));
	}
	if (typeof chrome.tabs?.create === "function") {
		await chrome.tabs.create({ url: parsed.href, active: input.active !== false });
	} else {
		window.open(parsed.href, "_blank", "noopener");
	}
}


// tabs.activate({ tabId }) — the page that embeds the module, from the floating window's <iframe> background.js
// (ACTIVATE_TAB_MESSAGE).
/** @type {Functions.Base.activateSandboxTab} */
async function activateSandboxTab(options) {
	const tabId = isPlainObject(options) ? options.tabId : undefined;
	if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) throw new Error(t("core_sandbox_capability_bad_tab", String(tabId)));
	if (!hasTabsApi()) {
		const response = await sendToBackground({ type: ACTIVATE_TAB_MESSAGE, tabId });
		if (!response) throw new Error(t("core_background_no_response"));
		if (response.error) throw new Error(response.error);
		return;
	}
	await activateTab(tabId);
}

// Selects the tab in its window and focuses the window (an error of the focus is only logged — the tab is selected).
/** @type {Functions.Base.activateTab} */
export async function activateTab(tabId) {
	const tab = await chrome.tabs.update(tabId, { active: true });
	if (tab && typeof tab.windowId === "number" && typeof chrome.windows?.update === "function") {
		await chrome.windows.update(tab.windowId, { focused: true }).catch((err) => console.warn("Okno záložky nejde přepnout do popředí:", err));
	}
}

// clipboard.writeText(text) — the page that embeds the module writes it.
/** @type {Functions.Base.writeSandboxClipboardText} */
async function writeSandboxClipboardText(text) {
	if (typeof text !== "string") throw new Error(t("core_sandbox_capability_bad_text"));
	const size = new Blob([text]).size;
	if (size > SANDBOX_CAPABILITY_MAX_TEXT_BYTES) {
		throw new Error(t("core_sandbox_capability_too_large", formatBytes(size), formatBytes(SANDBOX_CAPABILITY_MAX_TEXT_BYTES)));
	}
	const clipboard = globalThis.navigator?.clipboard;
	if (!clipboard || typeof clipboard.writeText !== "function") throw new Error(t("core_sandbox_capability_unavailable", "clipboard.writeText"));
	await clipboard.writeText(text);
}

// Is the name of a downloaded file only a name: no folders, no characters Windows does not allow,
// no control characters, not hidden (a dot first)?
/** @type {Functions.Base.isSandboxDownloadName} */
function isSandboxDownloadName(name) {
	if (name.length === 0 || name.length > SANDBOX_CAPABILITY_MAX_FILE_NAME || name.startsWith(".") || name !== name.trim()) return false;
	return [...name].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && !'\\/:*?"<>|'.includes(char));
}

// downloads.download({ filename, content, type }) — content is text or bytes (Uint8Array,
// ArrayBuffer); the page that embeds the module saves it as a download (<a download>, no "downloads"
// permission needed).
/** @type {Functions.Base.downloadSandboxFile} */
async function downloadSandboxFile(options) {
	const input = isPlainObject(options) ? options : {};
	const filename = typeof input.filename === "string" ? input.filename : "";
	if (!isSandboxDownloadName(filename)) throw new Error(t("core_sandbox_capability_bad_file_name", filename.slice(0, SANDBOX_CAPABILITY_MAX_FILE_NAME)));
	const content = input.content;
	if (typeof content !== "string" && !(content instanceof Uint8Array) && !(content instanceof ArrayBuffer)) {
		throw new Error(t("core_sandbox_capability_bad_content"));
	}
	const type = input.type === undefined ? "text/plain;charset=utf-8" : String(input.type);
	if (!SANDBOX_DOWNLOAD_TYPE_RE.test(type)) throw new Error(t("core_sandbox_capability_bad_type", type.slice(0, 100)));
	const blob = new Blob([/** @type {BlobPart} */ (content)], { type });
	if (blob.size > SANDBOX_CAPABILITY_MAX_FILE_BYTES) {
		throw new Error(t("core_sandbox_capability_too_large", formatBytes(blob.size), formatBytes(SANDBOX_CAPABILITY_MAX_FILE_BYTES)));
	}
	saveSandboxBlob(blob, filename, "downloads.download");
}

// A file as a download of the page that embeds the module (<a download>).
/** @type {Functions.Base.saveSandboxBlob} */
function saveSandboxBlob(blob, filename, name) {
	if (typeof document === "undefined" || !document.body) throw new Error(t("core_sandbox_capability_unavailable", name));
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.hidden = true;
	document.body.appendChild(link);
	link.click();
	link.remove();
	// The browser reads the file only after the click — not revoked right away.
	setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// "Do not use the sidebar" (SIDEBAR_DISABLED_KEY) in the page's memory — available() of sidebar.toggle
// is synchronous. Filled by loadSidebarDisabled() (renderModulesFor(), the popup), then its listener
// keeps it up to date.
let sidebarDisabledCache = false;
let sidebarDisabledListening = false;

// A standalone extension from a module can be built without a sidebar ("sidebar": false in the module's
// standalone.json, see scripts/build-module-*.ps1): its manifest has neither side_panel (Chrome) nor
// sidebar_action (Firefox). Then "Do not use the sidebar" is on for good, whatever is stored.
/** @type {Functions.Base.hasManifestSidebar} */
export function hasManifestSidebar() {
	// Every extension context has getManifest() — without it (the tests' chrome mock) the whole extension, which has one.
	if (typeof chrome.runtime?.getManifest !== "function") return true;
	const manifest = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (chrome.runtime.getManifest()));
	return !!(manifest.side_panel || manifest.sidebar_action);
}

/** @type {Functions.Base.readSidebarDisabled} */
export async function readSidebarDisabled() {
	if (!hasManifestSidebar()) return true;
	const stored = await chrome.storage.local.get(SIDEBAR_DISABLED_KEY);
	return stored[SIDEBAR_DISABLED_KEY] === true;
}

/** @type {Functions.Base.loadSidebarDisabled} */
export async function loadSidebarDisabled() {
	if (!sidebarDisabledListening && chrome.storage?.onChanged) {
		sidebarDisabledListening = true;
		chrome.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== "local" || !(SIDEBAR_DISABLED_KEY in changes)) return;
			sidebarDisabledCache = !hasManifestSidebar() || changes[SIDEBAR_DISABLED_KEY].newValue === true;
		});
	}
	sidebarDisabledCache = await readSidebarDisabled();
	return sidebarDisabledCache;
}

// Chrome: the extension's side panel on or off for all tabs (sidePanel.setOptions() without tabId) —
// switched off it disappears from the browser's side panel menu and an open one closes. Called by
// background.js on every start of the service worker and after a change of SIDEBAR_DISABLED_KEY (a
// restored backup too), and by the Settings page right on the change. Firefox has no such API.
/** @type {Functions.Base.applySidebarDisabled} */
export async function applySidebarDisabled(disabled) {
	if (typeof chrome.sidePanel?.setOptions !== "function") return;
	await chrome.sidePanel.setOptions({ enabled: !disabled });
}

// Firefox: chrome.sidebarAction (missing in the floating window's <iframe>); Chrome: chrome.sidePanel.
/** @type {Functions.Base.hasSidebarControl} */
function hasSidebarControl() {
	const firefox = chrome.sidebarAction;
	return (!!firefox && !!(firefox.toggle || firefox.open)) || typeof chrome.sidePanel?.open === "function";
}

// sidebar.toggle — Firefox: toggle() decides by the current state itself (from the sidebar it closes
// it), an older Firefox without it at least opens; called synchronously first, within the click.
// Chrome cannot tell whether its side panel is open: from the panel itself it closes it
// (sidePanel.close() since Chrome 141, otherwise window.close()), from elsewhere it opens the global
// panel in the window of the tab the surface relates to (on the Settings page the last used other one).
/** @type {Functions.Base.toggleSandboxSidebar} */
async function toggleSandboxSidebar(context) {
	const firefox = chrome.sidebarAction;
	if (firefox?.toggle) return firefox.toggle();
	if (firefox?.open) return firefox.open();
	if (context.location === "sidebar") {
		if (typeof chrome.sidePanel.close !== "function") {
			window.close();
			return;
		}
		const { id } = await chrome.windows.getCurrent();
		// The window the panel runs in always has an id.
		await chrome.sidePanel.close({ windowId: /** @type {number} */ (id) });
		return;
	}
	const tab = await context.api.tabs.getActive();
	if (!tab) throw new Error(t("core_sandbox_capability_no_tab"));
	await chrome.sidePanel.open({ tabId: tab.tabId });
}

// addons.open — the add-on management has the address chrome://extensions/?id=<id> in Chrome (it
// opens right at this extension), about:addons in Firefox. Firefox does not let an extension open
// about:addons at all (chrome.tabs.create() refuses it as "Illegal URL", with the id in the hash and
// without it, verified in a real browser), and without chrome.tabs (the floating window's <iframe>)
// nothing can be opened — then the result carries the address for the user to open.
/** @type {Functions.Base.openSandboxAddonsPage} */
async function openSandboxAddonsPage() {
	const url = isFirefox() ? "about:addons" : `chrome://extensions/?id=${encodeURIComponent(chrome.runtime.id)}`;
	if (isFirefox() || typeof chrome.tabs?.create !== "function") return { opened: false, url };
	await chrome.tabs.create({ url });
	return { opened: true, url };
}

// options.open — runtime.openOptionsPage() brings an open Settings page to the front (unlike
// api.tabs.openExtensionPage("options.html"), which opens another tab); without it a new tab.
/** @type {Functions.Base.openSandboxOptionsPage} */
async function openSandboxOptionsPage(options) {
	// Only a plain id — anything else opens Settings without the fragment.
	const hash = isPlainObject(options) && typeof options.hash === "string" && /^[A-Za-z][\w-]*$/.test(options.hash) ? options.hash : "";
	if (hash) {
		// runtime.openOptionsPage() cannot open at a fragment — without chrome.tabs (the floating window's <iframe> in
		// Firefox) via window.open().
		const url = chrome.runtime.getURL(`options.html#${hash}`);
		if (typeof chrome.tabs?.create === "function") {
			await chrome.tabs.create({ url });
		} else {
			window.open(url);
		}
		return;
	}
	if (typeof chrome.runtime.openOptionsPage === "function") {
		await chrome.runtime.openOptionsPage();
		return;
	}
	window.open(chrome.runtime.getURL("options.html"));
}

// storageUsage.get — every part on its own: a storage this browser does not have is null, one that
// failed carries the reason ({ error }) and the others are measured anyway.
/** @type {Functions.Base.getSandboxStorageUsage} */
async function getSandboxStorageUsage() {
	/** @type {Functions.Base.getSandboxStorageUsage.settle} */
	const settle = async (measure) => {
		try {
			return await measure();
		} catch (err) {
			return { error: err instanceof Error ? err.message : String(err) };
		}
	};
	const [localStorageUsage, indexedDb, estimate, chromeStorage] = await Promise.all([
		settle(async () => measureSandboxLocalStorage()),
		settle(async () => ({ database: DB_NAME, items: await countSandboxDatabaseItems(DB_NAME) })),
		settle(async () => {
			if (typeof navigator.storage?.estimate !== "function") return null;
			const { quota = 0, usage = 0 } = await navigator.storage.estimate();
			return { quota, usage };
		}),
		settle(async () => (typeof chrome.storage.local.getBytesInUse === "function" ? { bytes: await chrome.storage.local.getBytesInUse(null) } : null)),
	]);
	return { localStorage: localStorageUsage, indexedDb, estimate, chromeStorage };
}

// buildSettings.get — modules/<module>/standalone.json of the modules of the default list in the package (modules.json:
// every folder of modules/ is in it, tests/manifests.test.mjs). Only the build scripts use the files and scripts/build.mjs
// leaves them out of every package, so they are there only in an extension run unpacked from the project (installType
// "development"; in another one nothing is looked for — every module would be a missing file). A file that is not
// valid JSON carries the reason ({ error }), the module checks the content itself.
/** @type {Functions.Base.getSandboxBuildSettings} */
async function getSandboxBuildSettings() {
	const self = typeof chrome.management?.getSelf === "function" ? await chrome.management.getSelf().catch(() => null) : null;
	const unpacked = self ? self.installType === "development" : null;
	if (unpacked === false) return { unpacked, modules: [] };
	const res = await fetch(chrome.runtime.getURL("modules.json"));
	if (!res.ok) throw new Error(t("core_file_load_failed", "modules.json", res.status));
	const entries = /** @type {unknown} */ (await res.json());
	const folders = [...new Set((Array.isArray(entries) ? entries : []).map((entry) => (typeof entry === "string" ? /^\.\/modules\/([^/]+)\//.exec(entry)?.[1] : undefined)))].filter(
		(folder) => folder !== undefined
	);
	const found = await Promise.all(
		folders.map(async (module) => {
			let text;
			try {
				const file = await fetch(chrome.runtime.getURL(`modules/${module}/${STANDALONE_CONFIG_FILE}`));
				if (!file.ok) return null;
				text = await file.text();
			} catch {
				// A missing file in the package is a network error, not a 404 response.
				return null;
			}
			try {
				return { module, settings: /** @type {unknown} */ (JSON.parse(text)) };
			} catch (err) {
				return { module, error: err instanceof Error ? err.message : String(err) };
			}
		})
	);
	return { unpacked, modules: found.filter((item) => item !== null) };
}

// storageUsage.onChange — "chromeStorage" after a change of chrome.storage.local, "indexedDb" after a module
// stored, changed or removed a record (DATA_CHANGED_MESSAGE of background.js — the pages a tab loads are
// recorded this way), "localStorage" after another page of the extension changed it (the "storage" event).
// Not the record of the requests of the uploaded modules (SANDBOX_CAPABILITY_LOG_KEY): every storageUsage.get
// writes it, a module measuring after every change would report itself again and again. Returns a function to
// unsubscribe.
/** @type {Functions.Base.listenSandboxStorageUsageChanges} */
function listenSandboxStorageUsageChanges(emit) {
	/** @type {Types.StorageChangeListener} */
	const onStorage = (changes, area) => {
		if (area === "local" && Object.keys(changes).some((key) => key !== SANDBOX_CAPABILITY_LOG_KEY)) emit("chromeStorage");
	};
	/** @type {(message: unknown) => void} */
	const onMessage = (message) => {
		if (isPlainObject(message) && message.type === DATA_CHANGED_MESSAGE) emit("indexedDb");
	};
	/** @type {(event: StorageEvent) => void} */
	const onLocalStorage = (event) => {
		if (event.storageArea === localStorage) emit("localStorage");
	};
	chrome.storage.onChanged.addListener(onStorage);
	chrome.runtime.onMessage.addListener(onMessage);
	window.addEventListener("storage", onLocalStorage);
	return () => {
		chrome.storage.onChanged.removeListener(onStorage);
		chrome.runtime.onMessage.removeListener(onMessage);
		window.removeEventListener("storage", onLocalStorage);
	};
}

// The items of the page's localStorage and an estimate of its size — UTF-16, 2 bytes for every character
// of a key and of its value.
/** @type {Functions.Base.measureSandboxLocalStorage} */
function measureSandboxLocalStorage() {
	const items = localStorage.length;
	let bytes = 0;
	for (let index = 0; index < items; index++) {
		const key = localStorage.key(index);
		if (key !== null) bytes += (key.length + (localStorage.getItem(key) ?? "").length) * 2;
	}
	return { items, bytes };
}

// The records in all stores of an IndexedDB database of the extension. A database that does not exist
// yet has none — opening it without a version would create it empty, so its creation is aborted.
/** @type {Functions.Base.countSandboxDatabaseItems} */
function countSandboxDatabaseItems(name) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name);
		let created = false;
		request.onupgradeneeded = () => {
			created = true;
			// The open request of a new database always has its versionchange transaction.
			/** @type {IDBTransaction} */ (request.transaction).abort();
		};
		request.onerror = () => {
			if (created) {
				resolve(0);
			} else {
				reject(request.error);
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			const stores = [...db.objectStoreNames];
			if (stores.length === 0) {
				db.close();
				resolve(0);
				return;
			}
			const transaction = db.transaction(stores, "readonly");
			let total = 0;
			for (const store of stores) {
				const count = transaction.objectStore(store).count();
				count.onsuccess = () => {
					total += count.result;
				};
			}
			transaction.oncomplete = () => {
				db.close();
				resolve(total);
			};
			transaction.onabort = () => {
				db.close();
				reject(transaction.error);
			};
		};
	});
}

// floatingWindow.updateStates({ byDomain: { "<domain>": state | null }, lastUsed: state | null }) —
// single records of the stored floating window state: a state replaces the record of the domain (or
// the fallback lastUsed for the domains without one), null removes it, a missing one stays. Every change
// is checked (a domain key, only top/left/width/height in px and open — the content script passes
// them to the window's style as they are), the rest of the stored value is read right before the write.
// Never the whole value at once (api.floatingWindow.setAllStates()): a module would overwrite what the
// floating window stored on another tab in the meantime.
/** @type {Functions.Base.updateSandboxFloatingWindowStates} */
async function updateSandboxFloatingWindowStates(changes) {
	/** @type {(path: string) => Error} */
	const invalid = (path) => new Error(t("core_sandbox_floating_window_invalid", path));
	if (!isPlainObject(changes)) throw invalid("changes");
	const unknown = Object.keys(changes).find((key) => key !== "byDomain" && key !== "lastUsed");
	if (unknown !== undefined) throw invalid(unknown.slice(0, 100));
	const byDomain = changes.byDomain === undefined ? {} : changes.byDomain;
	if (!isPlainObject(byDomain)) throw invalid("byDomain");
	const entries = Object.entries(byDomain);
	if (entries.length > SANDBOX_FLOATING_WINDOW_MAX_CHANGES) {
		throw new Error(t("core_sandbox_floating_window_too_many", String(entries.length), String(SANDBOX_FLOATING_WINDOW_MAX_CHANGES)));
	}
	/** @type {[string, Types.FloatingWindowState | null][]} */
	const records = entries.map(([domain, state]) => {
		if (!SANDBOX_FLOATING_WINDOW_DOMAIN_RE.test(domain)) throw invalid(`byDomain["${domain.slice(0, 100)}"]`);
		return [domain, state === null ? null : normalizeSandboxFloatingWindowState(state, `byDomain["${domain}"]`)];
	});
	const lastUsed = changes.lastUsed === undefined || changes.lastUsed === null ? changes.lastUsed : normalizeSandboxFloatingWindowState(changes.lastUsed, "lastUsed");
	await withSandboxLock(FLOATING_WINDOW_STATE_KEY, async () => {
		const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(FLOATING_WINDOW_STATE_KEY))[FLOATING_WINDOW_STATE_KEY];
		const current = /** @type {Types.FloatingWindowStateStore} */ (isPlainObject(stored) ? stored : {});
		/** @type {Record<string, Types.FloatingWindowState>} */
		const nextByDomain = { ...(isPlainObject(current.byDomain) ? current.byDomain : {}) };
		for (const [domain, state] of records) {
			if (state === null) {
				delete nextByDomain[domain];
			} else {
				nextByDomain[domain] = state;
			}
		}
		/** @type {Types.FloatingWindowStateStore} */
		const next = { byDomain: nextByDomain };
		const nextLastUsed = lastUsed === undefined ? current.lastUsed : lastUsed;
		if (nextLastUsed) next.lastUsed = nextLastUsed;
		await chrome.storage.local.set({ [FLOATING_WINDOW_STATE_KEY]: next });
	});
}

// One state of the floating window from a module: only the keys it stores, each one checked.
/** @type {Functions.Base.normalizeSandboxFloatingWindowState} */
function normalizeSandboxFloatingWindowState(state, path) {
	if (!isPlainObject(state)) throw new Error(t("core_sandbox_floating_window_invalid", path.slice(0, 120)));
	/** @type {Types.FloatingWindowState} */
	const result = {};
	for (const [key, value] of Object.entries(state)) {
		const valid =
			key === "open"
				? typeof value === "boolean"
				: key === "top" || key === "left"
					? typeof value === "string" && SANDBOX_FLOATING_WINDOW_POSITION_RE.test(value)
					: (key === "width" || key === "height") && typeof value === "string" && SANDBOX_FLOATING_WINDOW_SIZE_RE.test(value);
		if (!valid) throw new Error(t("core_sandbox_floating_window_invalid", `${path}.${key}`.slice(0, 120)));
		/** @type {Record<string, unknown>} */ (result)[key] = value;
	}
	return result;
}











// #region standalone: tabGroups
// overview.mjs of tabGroups — for the listener tabGroups.onChange (watchWindowGroups()); imported only when it runs — the
// pages and content scripts that import base.mjs do not load it (in a standalone extension without tabGroups the
// listener fails). The other functions tabGroups.* are services of its background part.
/** @type {Functions.Base.importSandboxTabGroups} */
async function importSandboxTabGroups() {
	return import("./modules/tabGroups/overview.mjs");
}

// tabGroups.onChange — "groups" after the tab and group events of this page (watchWindowGroups() of overview.mjs;
// without chrome.tabGroups — no permission yet, the floating window — none; after the permission is granted the
// listener starts watching them), "status" after a change of the settings of tabGroups (its own keys), of the module
// list or of the permissions. Returns a function to unsubscribe.
/** @type {Functions.Base.listenSandboxTabGroupsChanges} */
function listenSandboxTabGroupsChanges(emit) {
	let active = true;
	/** @type {(() => void) | null} */
	let stopGroups = null;
	const watchGroups = () => {
		if (stopGroups) return;
		importSandboxTabGroups()
			.then(({ watchWindowGroups }) => {
				if (!active || stopGroups) return;
				if (chrome.tabGroups) stopGroups = watchWindowGroups(() => emit("groups"));
			})
			.catch((err) => console.error("Skupiny karet tabGroups z této stránky nejde sledovat:", err));
	};
	/** @type {Types.StorageChangeListener} */
	const onStorage = (changes, area) => {
		if (area !== "local") return;
		const settings = changes[SETTINGS_KEY];
		const own = (/** @type {unknown} */ value) => JSON.stringify(ownModuleSettings(isPlainObject(value) ? value : {}, SANDBOX_TAB_GROUPS_MODULE));
		if (changes[MODULES_JSON_KEY] || (settings && own(settings.oldValue) !== own(settings.newValue))) emit("status");
	};
	chrome.storage.onChanged.addListener(onStorage);
	/** @type {(() => void)[]} */
	const stops = [() => chrome.storage.onChanged.removeListener(onStorage)];
	// There are no permission events in the floating window's <iframe> (no chrome.permissions there).
	const onPermissions = () => {
		watchGroups();
		emit("status");
	};
	for (const event of [chrome.permissions?.onAdded, chrome.permissions?.onRemoved]) {
		if (!event) continue;
		event.addListener(onPermissions);
		stops.push(() => event.removeListener(onPermissions));
	}
	watchGroups();
	return () => {
		active = false;
		if (stopGroups) stopGroups();
		stopGroups = null;
		for (const stop of stops.splice(0)) stop();
	};
}
// #endregion standalone: tabGroups





// Is the host covered by one of the origins (match patterns from usesPermissions: "*://*.example.com/*" also
// covers example.com itself, "<all_urls>" and "*://*/*" everything)? The scheme and the path do not matter —
// the content filters inject into the pages of the host.
/** @type {Functions.Base.isHostCoveredByOrigins} */
export function isHostCoveredByOrigins(host, origins) {
	return origins.some((origin) => {
		if (origin === "<all_urls>") return true;
		const match = /^(?:\*|https?):\/\/([^/]+)\//.exec(origin);
		if (!match) return false;
		const pattern = match[1].toLowerCase();
		if (pattern === "*") return true;
		if (pattern.startsWith("*.")) {
			const domain = pattern.slice(2);
			return host === domain || host.endsWith(`.${domain}`);
		}
		return host === pattern;
	});
}





// Configurations of the core's filters an uploaded module may declare in registerModule() instead of setting them
// from its element (networkFilters.set, contentFilters.set): the core applies a declared one from the module's
// installation, without waiting for its element to run — the welcome page installs the modules the extension
// brings itself right after the extension is installed, background.js starts on that change of
// SANDBOX_MODULES_KEY — and after an update of the module the new one. It counts as a call of the function that
// sets it: the module asks for it in capabilities, the user can deny it, the same rules check it
// (validateModule() when the module is installed, background.js before it applies it). Such a module has one
// configuration — the declared one; the function itself then refuses it (background.js).
/** @type {readonly Types.DeclaredFilters[]} */
const DECLARED_FILTERS = Object.freeze([
]);

// The configuration of the core's filters the module declared (DECLARED_FILTERS) in its stored registration in the
// UI language — not checked yet (background.js normalizes it); undefined = it declares none (it sets it itself).
/** @type {Functions.Base.getDeclaredFiltersConfig} */
export function getDeclaredFiltersConfig(record, key) {
	const registration = isPlainObject(record) ? pickSandboxRegistration(record) : null;
	return registration && registration[key] !== undefined ? registration[key] : undefined;
}


// Only the moduleSettings entries of one module (its mode, fields and instances) — and of the shared groups given
// (SettingField.shared).
/** @type {Functions.Base.ownModuleSettings} */
function ownModuleSettings(settings, moduleName, sharedGroups = []) {
	const shared = sharedGroups.map((group) => getSharedSettingKey(group, ""));
	return Object.fromEntries(
		Object.entries(settings || {}).filter(([key]) => isModuleSettingsKey(moduleName, key) || shared.some((prefix) => key.startsWith(prefix)))
	);
}



// --------------------------------------------------------------------
// Modules from other extensions ("code as a service")
//
// A module released as a standalone extension (scripts/build-module-*.ps1) works on its own — the core is
// inside it. When the extension it came from (the service provider — Tab Groups) is installed too, the
// standalone one becomes its client: it offers the provider its uploaded modules (their packages —
// tabGroupsSandbox) and the services of its background parts (api.services — tabGroups.*). The provider shows
// those modules on its own surfaces (popup, side panel, floating window, Settings) in its sandbox, as if they
// were its own uploaded modules, and sends their requests for the functions the client serves to the client
// (chrome.runtime.sendMessage(clientId, …)); the client runs them with its own code, permissions and storage —
// so the settings stay with the client, whichever editor changes them. While the provider shows its modules,
// the client shows them where the second set of output locations of the module in its Settings says (by default the
// same as the first set, getModuleDelegatedDisplayLocations(); elsewhere of the first set a note says where the module
// is), and the provider does not run its own copies of the client's modules from the package
// (replaces — tabGroups would sort the tabs twice).
//
// Who is a client: an extension whose package has SERVICE_PROVIDER_FILE with the id of the provider (the
// build scripts write it; the full extension has { "id": null }). The provider's id must be stable (Firefox:
// the add-on id; Chrome: the id of the published extension, or of an unpacked one with "key" in its
// manifest). The provider knows a client by the sender of its messages (sender.id).
//
// Who is a provider: only the full extension. A standalone extension ("standalone": true in its SERVICE_PROVIDER_FILE —
// the build scripts write it, with or without a provider) only exports its modules: it refuses the registration, the
// status questions and the service requests of other extensions (core_service_standalone) and ignores the records of
// clients an older version of it stored (readExtensionServiceClients()) — modules of other extensions never get into it.
//
// The protocol (chrome.runtime.sendMessage(otherId, message) → runtime.onMessageExternal of the other one),
// every message with the version EXTENSION_SERVICE_PROTOCOL (another version is refused):
//   client → provider
//     EXTENSION_SERVICE_REGISTER — after every start of the client's background part (installation, update,
//        browser start): its name, version, the packages of its uploaded modules (the files as base64), the
//        services it serves (what they allow, their risk, a call or a listener), the services of other modules
//        its modules use (uses — with why), its modules from the package (replaces) and of them those whose data
//        the provider may back up and restore (backup). The answer: its status — pending (the user has not
//        decided), approved, denied.
//     EXTENSION_SERVICE_STATUS — the client's pages ask which of its modules the provider shows (the answer
//        also says the provider is there).
//     EXTENSION_SERVICE_CHANGED — what a listener of a service follows has changed (api.services.changed()),
//        only while the provider holds a lease on it.
//     EXTENSION_SERVICE_REQUEST — run a service of another module { name, args, context } (api.services.call() of a
//        module of the client — see "Services of other modules"): the provider does it itself, or asks another of
//        its clients that runs the module (routeModuleService()); only for an allowed client and only a service of
//        its uses. The answer as Types.ModuleServiceAnswer.
//   provider → client
//     EXTENSION_SERVICE_PING — is the client there (the provider's pages check before they show its modules).
//     EXTENSION_SERVICE_CALL — run a service { name, args, context }; the answer as Types.ModuleServiceAnswer.
//     EXTENSION_SERVICE_SUBSCRIBE — a lease on the changes of a listener service for EXTENSION_SERVICE_LEASE_MS
//        (renewed while a page of the provider listens).
//     EXTENSION_SERVICE_OPEN — open the client's Settings (it asks for its permissions there).
//     EXTENSION_SERVICE_DECIDED — the user decided about the client (its pages ask the status again).
//     EXTENSION_SERVICE_BACKUP_EXPORT — the backup of a module of its backup { module } (exportModuleBackup() of the
//        client); the answer { ok, value } or { ok: false, error }.
//     EXTENSION_SERVICE_BACKUP_IMPORT — replace the data of a module of its backup { module, backup, options }
//        (importModuleBackup() of the client).
//
// Backup: the data of a module the client runs instead of the provider are in the client — the provider's own
// copy of them (from the time it ran the module itself) does not work. api.backup.exportModule()/importModule()
// of the provider (the importExport module) therefore go to the allowed client that is there and offers the module
// in its backup, and api.backup.listClientModules() says which modules those are. The client does them in its
// background part — a module's backupData (registerModule() of its element) is not there, only what the module
// stores through api.*. Offering a backup does not make a client pending again: it risks only the client's own
// data, the provider only gets them for a file or hands a file over.
//
// The user decides in the provider's Settings ("Modules from other extensions"): a client stays pending until
// it is allowed — nothing of it is installed or shown, and the provider does not call it; the provider's pages say
// so above the modules (mountPendingServiceNotice() — meanwhile the modules the client replaces work in both
// extensions). Allowed, its packages go through the same rules as an uploaded module
// (installClientSandboxModules()), the modules it replaces leave the provider's module list (they do not turn on
// by themselves when the client is gone), a new version of the client is installed again by the next page, and a
// client that adds services or modules is pending again. Denied or removed, nothing of it runs (it may register
// again — pending). onboardingModule is never replaced (EXTENSION_SERVICE_OWN_MODULES). A client that starts using
// another service of the provider (uses) is pending again too.
// --------------------------------------------------------------------

export const EXTENSION_SERVICE_PROTOCOL = 1;
// In the package root: { "id": "<the id of the service provider>", "standalone": true } — { "id": null } in the full
// extension (standalone: see "Who is a provider" above).
export const SERVICE_PROVIDER_FILE = "service-provider.json";

export const EXTENSION_SERVICE_REGISTER_MESSAGE = "EXTENSION_SERVICE_REGISTER";
export const EXTENSION_SERVICE_STATUS_MESSAGE = "EXTENSION_SERVICE_STATUS";
export const EXTENSION_SERVICE_CHANGED_MESSAGE = "EXTENSION_SERVICE_CHANGED";
export const EXTENSION_SERVICE_PING_MESSAGE = "EXTENSION_SERVICE_PING";
export const EXTENSION_SERVICE_CALL_MESSAGE = "EXTENSION_SERVICE_CALL";
export const EXTENSION_SERVICE_REQUEST_MESSAGE = "EXTENSION_SERVICE_REQUEST";
export const EXTENSION_SERVICE_SUBSCRIBE_MESSAGE = "EXTENSION_SERVICE_SUBSCRIBE";
export const EXTENSION_SERVICE_OPEN_MESSAGE = "EXTENSION_SERVICE_OPEN";
export const EXTENSION_SERVICE_DECIDED_MESSAGE = "EXTENSION_SERVICE_DECIDED";
export const EXTENSION_SERVICE_BACKUP_EXPORT_MESSAGE = "EXTENSION_SERVICE_BACKUP_EXPORT";
export const EXTENSION_SERVICE_BACKUP_IMPORT_MESSAGE = "EXTENSION_SERVICE_BACKUP_IMPORT";
// The section of Settings (options.html) with the clients and the provider — the target of the notice of a pending client.
export const EXTENSION_SERVICES_SECTION_ID = "extension-services";
// A page of a client → its background.js: register with the provider right now (the button of Settings — the
// registration needs the services of the background parts).
export const EXTENSION_SERVICE_REGISTER_NOW_MESSAGE = "EXTENSION_SERVICE_REGISTER_NOW";

// The provider: its clients { [extension id]: Types.ExtensionServiceClient } (chrome.storage.local).
export const EXTENSION_SERVICE_CLIENTS_KEY = "extensionServiceClients";
// The provider: when its pages last found each client alive { [id]: { alive, at } } (chrome.storage.session).
export const EXTENSION_SERVICE_ALIVE_KEY = "extensionServiceAlive";
// The client: what its provider said last (Types.ExtensionServiceProviderState, chrome.storage.local).
export const EXTENSION_SERVICE_PROVIDER_KEY = "extensionServiceProvider";
// The client: the leases of the provider on its listener services { [name]: until } (chrome.storage.session).
export const EXTENSION_SERVICE_LEASES_KEY = "extensionServiceLeases";

// How long a ping or a status question waits — a sleeping service worker of the other extension starts first.
export const EXTENSION_SERVICE_PING_TIMEOUT_MS = 2000;
// How long an answer about the other extension holds before a page asks again.
export const EXTENSION_SERVICE_ALIVE_MS = 30 * 1000;
// A client registers with its provider after its installation and update, at a browser start and otherwise at
// most once in this time when its background part wakes up (a provider installed later learns about it so).
export const EXTENSION_SERVICE_REGISTER_EVERY_MS = 10 * 60 * 1000;
// How long a call of a service waits (blinking the groups takes a few seconds).
export const EXTENSION_SERVICE_CALL_TIMEOUT_MS = 30 * 1000;
// A lease on the changes of a listener service and how often a listening page renews it.
export const EXTENSION_SERVICE_LEASE_MS = 60 * 1000;
export const EXTENSION_SERVICE_LEASE_RENEW_MS = 20 * 1000;
// Changes of a listener sent at most this often (a series of tab events = one message).
const EXTENSION_SERVICE_CHANGED_DELAY_MS = 150;
// The limits of a registration: modules, services, modules from the package, the length of the texts.
export const EXTENSION_SERVICE_MAX_MODULES = 8;
export const EXTENSION_SERVICE_MAX_SERVICES = 64;
export const EXTENSION_SERVICE_MAX_REPLACES = 32;
const EXTENSION_SERVICE_MAX_TEXT = 500;
const EXTENSION_SERVICE_MAX_NAME = 100;

// Modules from the package that belong to the extension itself, not to the work of its modules — a client never
// runs them instead of the provider (onboardingModule opens the welcome page of its own extension; the build
// scripts add it to a standalone extension with its own onboarding.html).
const EXTENSION_SERVICE_OWN_MODULES = Object.freeze(["onboardingModule"]);

const EXTENSION_SERVICE_STATUSES = Object.freeze(["pending", "approved", "denied"]);
const EXTENSION_SERVICE_RISKS = Object.freeze(["low", "medium", "high"]);
// A module name (the same as of an uploaded module's file, SANDBOX_SCRIPT_NAME_RE).
const EXTENSION_SERVICE_MODULE_NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;

/** @type {Promise<Types.ServiceProviderConfig> | null} */
let serviceProviderConfig = null;
/** @type {unknown} */
let serviceProviderConfigSource = null;

// SERVICE_PROVIDER_FILE of this extension's package, read once (again for another chrome.runtime — tests replace chrome
// between tests): the id of its provider and whether it is a standalone extension.
/** @type {Functions.Base.readServiceProviderConfig} */
function readServiceProviderConfig() {
	const runtime = globalThis.chrome?.runtime;
	// Without chrome.runtime (a test without chrome.*) neither a client nor standalone — and not remembered.
	if (typeof runtime?.getURL !== "function") return Promise.resolve({ id: null, standalone: false });
	if (serviceProviderConfig && serviceProviderConfigSource === runtime) return serviceProviderConfig;
	serviceProviderConfigSource = runtime;
	serviceProviderConfig = (async () => {
		try {
			const res = await fetch(runtime.getURL(SERVICE_PROVIDER_FILE));
			if (!res.ok) return { id: null, standalone: false };
			const data = await res.json();
			if (!isPlainObject(data)) return { id: null, standalone: false };
			return { id: typeof data.id === "string" && data.id !== "" && data.id !== runtime.id ? data.id : null, standalone: data.standalone === true };
		} catch {
			return { id: null, standalone: false };
		}
	})();
	return serviceProviderConfig;
}

// The id of this extension's service provider (SERVICE_PROVIDER_FILE); null = this extension is not a client.
/** @type {Functions.Base.readServiceProviderId} */
export async function readServiceProviderId() {
	return (await readServiceProviderConfig()).id;
}

// Is this a standalone extension (SERVICE_PROVIDER_FILE, see "Who is a provider" above) — it only exports its modules
// and is never the provider of other extensions?
/** @type {Functions.Base.isStandaloneExtension} */
export async function isStandaloneExtension() {
	return (await readServiceProviderConfig()).standalone;
}

// The modules of a client's replaces it can run instead of the provider (without EXTENSION_SERVICE_OWN_MODULES —
// an older client still offers them).
/** @type {Functions.Base.replaceableModules} */
function replaceableModules(names) {
	return names.filter((name) => !EXTENSION_SERVICE_OWN_MODULES.includes(name));
}

/** @type {Functions.Base.bytesToBase64} */
export function bytesToBase64(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** @type {Functions.Base.base64ToBytes} */
export function base64ToBytes(text) {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// A message to another extension with a time limit: its answer, or an error (it is not installed, it did not
// answer in time, it answered nothing).
/** @type {Functions.Base.sendToExtension} */
async function sendToExtension(id, message, timeoutMs) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	try {
		return await Promise.race([
			chrome.runtime.sendMessage(id, { ...message, protocol: EXTENSION_SERVICE_PROTOCOL }),
			new Promise((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(t("core_service_timeout", id))), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

// --- The provider: the clients ---

/** @type {Functions.Base.readExtensionServiceClients} */
export async function readExtensionServiceClients() {
	// A standalone extension has no clients — not even those an older version of it stored.
	if (await isStandaloneExtension()) return {};
	try {
		const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(EXTENSION_SERVICE_CLIENTS_KEY))[EXTENSION_SERVICE_CLIENTS_KEY];
		return isPlainObject(stored) ? /** @type {Record<string, Types.ExtensionServiceClient>} */ (stored) : {};
	} catch (err) {
		console.error("Klienty služeb nejde načíst:", err);
		return {};
	}
}

// Changes the record of one client under the lock (update returns the new record; null removes it).
/** @type {Functions.Base.updateExtensionServiceClient} */
async function updateExtensionServiceClient(id, update) {
	return withSandboxLock(EXTENSION_SERVICE_CLIENTS_KEY, async () => {
		const clients = await readExtensionServiceClients();
		const current = Object.hasOwn(clients, id) ? clients[id] : null;
		const next = update(current);
		if (next === current) return current;
		const rest = { ...clients };
		if (next) {
			rest[id] = next;
		} else {
			delete rest[id];
		}
		await chrome.storage.local.set({ [EXTENSION_SERVICE_CLIENTS_KEY]: rest });
		return next;
	});
}

// The keys of a client's packages in the database of the packages (SANDBOX_PACKAGES_DB): the files as the client
// sent them, and the package evaluated and checked (Types.SandboxPackage).
/** @type {Functions.Base.clientPackageKey} */
function clientPackageKey(id, name, kind) {
	return `client:${id}:${name}:${kind}`;
}

// A registration of a client, checked — or the reason it is refused (the text the client gets).
/** @type {Functions.Base.normalizeServiceRegistration} */
export function normalizeServiceRegistration(message) {
	/** @type {(path: string) => Types.ExtensionServiceRegistrationCheck} */
	const invalid = (path) => ({ registration: null, error: t("core_service_registration_invalid", path) });
	if (!isPlainObject(message)) return invalid("message");
	const { name, version, modules, services, replaces, backup = [], uses = [] } = message;
	if (typeof name !== "string" || name.trim() === "" || name.length > EXTENSION_SERVICE_MAX_NAME) return invalid("name");
	if (typeof version !== "string" || version.length > 32) return invalid("version");
	if (!Array.isArray(modules) || modules.length > EXTENSION_SERVICE_MAX_MODULES) return invalid("modules");
	/** @type {Types.ExtensionServiceModulePackage[]} */
	const packages = [];
	for (const [index, item] of modules.entries()) {
		if (!isPlainObject(item) || typeof item.name !== "string" || !EXTENSION_SERVICE_MODULE_NAME_RE.test(item.name)) return invalid(`modules[${index}].name`);
		if (packages.some((other) => other.name === item.name)) return invalid(`modules[${index}].name`);
		if (typeof item.hash !== "string" || !/^[0-9a-f]{64}$/.test(item.hash)) return invalid(`modules[${index}].hash`);
		if (!isPlainObject(item.files)) return invalid(`modules[${index}].files`);
		const entries = Object.entries(item.files);
		if (entries.length === 0 || entries.length > SANDBOX_MAX_PACKAGE_FILES) return invalid(`modules[${index}].files`);
		let size = 0;
		for (const [path, data] of entries) {
			if (!isValidSandboxPath(path) || !getSandboxFileType(path) || typeof data !== "string") return invalid(`modules[${index}].files`);
			size += Math.floor((data.length * 3) / 4);
		}
		if (size > SANDBOX_MAX_PACKAGE_BYTES) return invalid(`modules[${index}].files`);
		packages.push({ name: item.name, hash: item.hash, files: /** @type {Record<string, string>} */ (item.files) });
	}
	if (!Array.isArray(services) || services.length > EXTENSION_SERVICE_MAX_SERVICES) return invalid("services");
	/** @type {Types.ExtensionServiceInfo[]} */
	const offered = [];
	for (const [index, item] of services.entries()) {
		if (!isPlainObject(item) || typeof item.name !== "string" || !SANDBOX_CAPABILITY_NAME_RE.test(item.name)) return invalid(`services[${index}].name`);
		if (offered.some((other) => other.name === item.name)) return invalid(`services[${index}].name`);
		if (item.kind !== "call" && item.kind !== "listen") return invalid(`services[${index}].kind`);
		const risk = /** @type {Types.ExtensionServiceInfo['risk']} */ (item.risk);
		if (!EXTENSION_SERVICE_RISKS.includes(risk)) return invalid(`services[${index}].risk`);
		if (typeof item.about !== "string" || item.about.length > EXTENSION_SERVICE_MAX_TEXT) return invalid(`services[${index}].about`);
		offered.push({ name: item.name, kind: item.kind, risk, about: item.about });
	}
	// The services of other modules its modules use (an older client does not send it — none).
	if (!Array.isArray(uses) || uses.length > EXTENSION_SERVICE_MAX_SERVICES) return invalid("uses");
	/** @type {Types.ExtensionServiceUse[]} */
	const used = [];
	for (const [index, item] of uses.entries()) {
		if (!isPlainObject(item) || typeof item.name !== "string" || !SANDBOX_CAPABILITY_NAME_RE.test(item.name)) return invalid(`uses[${index}].name`);
		if (used.some((other) => other.name === item.name)) return invalid(`uses[${index}].name`);
		if (typeof item.about !== "string" || item.about.length > EXTENSION_SERVICE_MAX_TEXT) return invalid(`uses[${index}].about`);
		used.push({ name: item.name, about: item.about });
	}
	if (!Array.isArray(replaces) || replaces.length > EXTENSION_SERVICE_MAX_REPLACES) return invalid("replaces");
	if (!replaces.every((item) => typeof item === "string" && EXTENSION_SERVICE_MODULE_NAME_RE.test(item))) return invalid("replaces");
	// Only the modules it runs instead of the provider (an older client does not send it — none).
	if (!Array.isArray(backup) || backup.length > EXTENSION_SERVICE_MAX_REPLACES || !backup.every((item) => replaces.includes(item))) return invalid("backup");
	return {
		registration: {
			name: name.trim(),
			version,
			modules: packages,
			services: offered,
			uses: used,
			replaces: replaceableModules([...new Set(/** @type {string[]} */ (replaces))]),
			backup: replaceableModules([...new Set(/** @type {string[]} */ (backup))]),
		},
		error: null,
	};
}

// The provider stores a registration (background.js, EXTENSION_SERVICE_REGISTER): the files of the packages into
// the database, the rest into the client's record. A client the user allowed stays allowed — unless it offers
// other modules or services now, or uses other services of the provider (pending again: the user decides about what
// it does); the modules of its backup do not count (see "Backup" above).
/** @type {Functions.Base.registerExtensionServiceClient} */
export async function registerExtensionServiceClient(id, message) {
	const { registration, error } = normalizeServiceRegistration(message);
	if (!registration) throw new Error(error ?? "");
	for (const pkg of registration.modules) {
		await sandboxPackagesRequest("readwrite", (store) => store.put({ hash: pkg.hash, files: pkg.files }, clientPackageKey(id, pkg.name, "files")));
	}
	const now = Date.now();
	/** @type {(items: string[]) => string} */
	const signature = (items) => JSON.stringify([...items].sort());
	const record = await updateExtensionServiceClient(id, (current) => {
		const same =
			!!current &&
			signature(current.services.map((service) => `${service.kind}:${service.name}`)) === signature(registration.services.map((service) => `${service.kind}:${service.name}`)) &&
			signature((current.uses ?? []).map((use) => use.name)) === signature(registration.uses.map((use) => use.name)) &&
			signature(Object.keys(current.modules)) === signature(registration.modules.map((pkg) => pkg.name)) &&
			signature(replaceableModules(current.replaces)) === signature(registration.replaces);
		/** @type {Types.ExtensionServiceClient['status']} */
		const status = current && (current.status === "denied" || (current.status === "approved" && same)) ? current.status : "pending";
		return {
			id,
			name: registration.name,
			version: registration.version,
			status,
			services: registration.services,
			uses: registration.uses,
			replaces: registration.replaces,
			backup: registration.backup,
			modules: Object.fromEntries(registration.modules.map((pkg) => [pkg.name, { hash: pkg.hash }])),
			installed: current ? current.installed : {},
			registeredAt: current ? current.registeredAt : now,
			updatedAt: now,
			alive: true,
			seenAt: now,
		};
	});
	return { status: record ? record.status : "pending" };
}

// The answer to a client's EXTENSION_SERVICE_STATUS (background.js of the provider): its status and which of its
// modules the provider shows (in the module list and not turned off) — only for an allowed client.
/** @type {Functions.Base.describeExtensionServiceStatus} */
export async function describeExtensionServiceStatus(id) {
	const client = (await readExtensionServiceClients())[id];
	const name = chrome.i18n?.getMessage?.("extension_name") || chrome.runtime.getManifest().name;
	if (!client) return { status: "unknown", shown: [], provider: name };
	await noteExtensionServiceClientAlive(id, true);
	if (client.status !== "approved") return { status: client.status, shown: [], provider: name };
	const controller = new BaseController();
	const [jsonText, settings] = await Promise.all([controller.getModulesJson(), controller.loadSettings()]);
	/** @type {unknown} */
	let paths = [];
	try {
		paths = JSON.parse(jsonText);
	} catch {
		// An unreadable list — nothing is shown.
	}
	const listed = new Set(Array.isArray(paths) ? paths.filter((path) => typeof path === "string").map((path) => getModuleKey(path)) : []);
	const shown = Object.keys(client.installed).filter(
		(module) => listed.has(module) && !DISABLED_SPEC.isSatisfiedBy({ mode: getModuleMode(settings, module) })
	);
	return { status: "approved", shown, provider: name };
}

// Remembers whether a client answered (its record: alive and seenAt) — written only when it changes or once a
// minute, the record is in chrome.storage.local.
/** @type {Functions.Base.noteExtensionServiceClientAlive} */
async function noteExtensionServiceClientAlive(id, alive) {
	const now = Date.now();
	await updateExtensionServiceClient(id, (current) => {
		if (!current) return current;
		if (current.alive === alive && (!alive || now - current.seenAt < 60 * 1000)) return current;
		return { ...current, alive, seenAt: alive ? now : current.seenAt };
	});
}

// Is the client there? The provider's pages ask once in EXTENSION_SERVICE_ALIVE_MS (chrome.storage.session); the
// answer also goes into its record (the background part of the provider decides by it which modules it replaces).
/** @type {Functions.Base.isExtensionServiceClientAlive} */
export async function isExtensionServiceClientAlive(id) {
	const session = chrome.storage.session;
	/** @type {Record<string, { alive: boolean, at: number }>} */
	let cache = {};
	try {
		const stored = session ? (await session.get(EXTENSION_SERVICE_ALIVE_KEY))[EXTENSION_SERVICE_ALIVE_KEY] : null;
		if (isPlainObject(stored)) cache = /** @type {Record<string, { alive: boolean, at: number }>} */ (stored);
	} catch {
		// Without chrome.storage.session every page asks.
	}
	const known = cache[id];
	if (known && Date.now() - known.at < EXTENSION_SERVICE_ALIVE_MS) return known.alive;
	let alive = false;
	try {
		const answer = await sendToExtension(id, { type: EXTENSION_SERVICE_PING_MESSAGE }, EXTENSION_SERVICE_PING_TIMEOUT_MS);
		alive = isPlainObject(answer) && answer.ok === true;
	} catch {
		// Not installed, turned off, or it did not answer — the provider shows its own modules.
	}
	try {
		await session?.set({ [EXTENSION_SERVICE_ALIVE_KEY]: { ...cache, [id]: { alive, at: Date.now() } } });
	} catch {
		// Only the next page asks again.
	}
	await noteExtensionServiceClientAlive(id, alive);
	return alive;
}

// The allowed clients that are there right now (isExtensionServiceClientAlive()).
/** @type {Functions.Base.getLiveExtensionServiceClients} */
export async function getLiveExtensionServiceClients() {
	const approved = Object.values(await readExtensionServiceClients()).filter((client) => client.status === "approved");
	const alive = await Promise.all(approved.map((client) => isExtensionServiceClientAlive(client.id)));
	return approved.filter((_client, index) => alive[index]);
}

// The clients waiting for the user's decision that are there (they answer a ping) and the modules of this
// extension that work in both extensions meanwhile: the client runs them itself and this extension too (its
// replaces in the module list here, not turned off) — tabGroups sorts the tabs twice. For the notice on the
// provider's pages (BaseController.mountPendingServiceNotice()).
/** @type {Functions.Base.getPendingExtensionServiceClients} */
export async function getPendingExtensionServiceClients() {
	const pending = Object.values(await readExtensionServiceClients()).filter((client) => client.status === "pending");
	if (pending.length === 0) return [];
	const alive = await Promise.all(pending.map((client) => isExtensionServiceClientAlive(client.id)));
	const present = pending.filter((_client, index) => alive[index]);
	if (present.length === 0) return [];
	const controller = new BaseController();
	const [jsonText, settings] = await Promise.all([controller.getModulesJson(), controller.loadSettings()]);
	/** @type {unknown} */
	let paths = [];
	try {
		paths = JSON.parse(jsonText);
	} catch {
		// An unreadable list — nothing of this extension works.
	}
	const listed = new Set(
		Array.isArray(paths) ? paths.filter((path) => typeof path === "string" && !isSandboxModuleEntry(path)).map((path) => getModuleKey(path)) : []
	);
	return present
		.map((client) => ({
			id: client.id,
			name: client.name,
			doubled: replaceableModules(client.replaces).filter(
				(module) => listed.has(module) && !DISABLED_SPEC.isSatisfiedBy({ mode: getModuleMode(settings, module) })
			),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

// Opens the section "Modules from other extensions" of Settings in a new tab (the notice of a pending client) —
// without chrome.tabs (the floating window's <iframe> in Firefox) via window.open().
/** @type {Functions.Base.openExtensionServicesSettings} */
async function openExtensionServicesSettings() {
	const url = chrome.runtime.getURL(`options.html#${EXTENSION_SERVICES_SECTION_ID}`);
	if (typeof chrome.tabs?.create === "function") {
		await chrome.tabs.create({ url });
	} else {
		window.open(url);
	}
}

// The modules from the package of this extension a client runs instead (replaces) — an allowed client that
// answered last time. Without a decision of a page (alive is from the last ping or status question) — also in
// the background part (api.activation).
// Rendering a page asks for every module — one read of the records serves them until the records change (the
// storage it was read from — tests replace chrome between tests).
/** @type {Promise<Map<string, Types.ExtensionServiceClient>> | null} */
let replacedModules = null;
/** @type {unknown} */
let replacedModulesSource = null;

/** @type {Functions.Base.getReplacedModules} */
export function getReplacedModules() {
	const source = globalThis.chrome?.storage?.local;
	// Without the storage (a test without chrome.*) nothing is replaced.
	if (!source) return Promise.resolve(new Map());
	if (replacedModules && replacedModulesSource === source) return replacedModules;
	if (replacedModulesSource !== source) {
		replacedModulesSource = source;
		chrome.storage?.onChanged?.addListener((changes, area) => {
			if (area === "local" && changes[EXTENSION_SERVICE_CLIENTS_KEY]) replacedModules = null;
		});
	}
	replacedModules = readExtensionServiceClients().then((clients) => {
		/** @type {Map<string, Types.ExtensionServiceClient>} */
		const replaced = new Map();
		for (const client of Object.values(clients)) {
			if (client.status !== "approved" || client.alive === false) continue;
			for (const name of replaceableModules(client.replaces)) if (!replaced.has(name)) replaced.set(name, client);
		}
		return replaced;
	});
	return replacedModules;
}

// Installs the packages of an allowed client its record does not have installed in their registered version —
// the same rules as for an uploaded module (evaluateSandboxContent()). Needs a page (the module is evaluated in a
// hidden sandbox). Returns the problems (the module, the text); a module that failed stays uninstalled.
/** @type {Functions.Base.installClientSandboxModules} */
export async function installClientSandboxModules(id, { inspect = inspectSandboxModule } = {}) {
	/** @type {string[]} */
	const problems = [];
	const client = (await readExtensionServiceClients())[id];
	if (!client || client.status !== "approved") return problems;
	for (const [name, { hash }] of Object.entries(client.modules)) {
		if (client.installed[name]?.hash === hash) continue;
		try {
			const raw = await sandboxPackagesRequest("readonly", (store) => store.get(clientPackageKey(id, name, "files")));
			if (!isPlainObject(raw) || raw.hash !== hash || !isPlainObject(raw.files)) throw new Error(t("core_service_package_missing", name));
			/** @type {Types.SandboxPackageFiles} */
			const files = {};
			for (const [path, data] of Object.entries(/** @type {Record<string, string>} */ (raw.files))) {
				const fileType = getSandboxFileType(path);
				if (!fileType || typeof data !== "string") throw new Error(t("core_service_registration_invalid", path));
				files[path] = { type: fileType.type, data: base64ToBytes(data) };
			}
			const content = sandboxContentFromFiles(name, files);
			/** @type {Types.SandboxInstallResult} */
			const result = { ok: false, name, errors: [], warnings: [], updated: false, added: false };
			const size = Object.values(files).reduce((sum, file) => sum + file.data.byteLength, 0);
			const previous = client.installed[name] ?? null;
			const evaluated = await evaluateSandboxContent(content, { fileName: client.name, size, hash, bundled: false }, previous, inspect, result);
			if (!evaluated) throw new Error(result.errors.join("\n"));
			/** @type {Types.SandboxModuleRecord} */
			const record = { ...evaluated.record, client: id, services: client.services.map((service) => ({ name: service.name, kind: service.kind })) };
			await sandboxPackagesRequest("readwrite", (store) => store.put(evaluated.pkg, clientPackageKey(id, name, "package")));
			await updateExtensionServiceClient(id, (current) =>
				current && current.modules[name]?.hash === hash ? { ...current, installed: { ...current.installed, [name]: record } } : current
			);
		} catch (err) {
			problems.push(`${formatModuleName(name)}: ${describeError(err)}`);
			console.error(`Modul "${name}" rozšíření "${client.name}" nejde nainstalovat:`, err);
		}
	}
	return problems;
}

// The stored package of an installed module of a client (null — it is not there).
/** @type {Functions.Base.readClientSandboxPackage} */
async function readClientSandboxPackage(id, name) {
	try {
		const value = await sandboxPackagesRequest("readonly", (store) => store.get(clientPackageKey(id, name, "package")));
		return isPlainObject(value) && isPlainObject(value.files) ? /** @type {Types.SandboxPackage} */ (value) : null;
	} catch (err) {
		console.error(`Soubory modulu "${name}" jiného rozšíření nejde načíst:`, err);
		return null;
	}
}

// The user allows a client in the provider's Settings: its packages are installed, its modules not in the module
// list yet are added to its end, the modules from the package it runs instead (replaces) leave the module list —
// they do not come back by themselves when the client is gone (uninstalled, turned off, removed here); the user
// puts them back into the list. The client learns the decision. Returns the problems of the installation and the
// modules taken out of the list.
/** @type {Functions.Base.approveExtensionServiceClient} */
export async function approveExtensionServiceClient(id, { inspect = inspectSandboxModule } = {}) {
	const record = await updateExtensionServiceClient(id, (current) => (current ? { ...current, status: "approved" } : current));
	if (!record) return { problems: [], removed: [] };
	const problems = await installClientSandboxModules(id, { inspect });
	const installed = (await readExtensionServiceClients())[id]?.installed ?? {};
	for (const name of Object.keys(installed)) await addSandboxModuleToList(name);
	const removed = await removeModulesFromList(replaceableModules(record.replaces));
	await sendToExtension(id, { type: EXTENSION_SERVICE_DECIDED_MESSAGE }, EXTENSION_SERVICE_PING_TIMEOUT_MS).catch(() => {});
	return { problems, removed };
}

// Takes modules from the package out of the module list (all their entries, the instances too; the settings stay
// — put back into the list, a module continues with them). An uploaded module of the same name stays. Returns the
// modules that were in the list; an unreadable list is left alone.
/** @type {Functions.Base.removeModulesFromList} */
export async function removeModulesFromList(names) {
	if (names.length === 0) return [];
	const controller = new BaseController();
	/** @type {unknown} */
	let paths;
	try {
		paths = JSON.parse(await controller.getModulesJson());
	} catch (err) {
		console.error("Seznam modulů nejde načíst, moduly se z něj neodeberou:", err);
		return [];
	}
	if (!Array.isArray(paths)) return [];
	/** @type {string[]} */
	const removed = [];
	const kept = paths.filter((path) => {
		if (typeof path !== "string" || isSandboxModuleEntry(path)) return true;
		const name = getModuleKey(path);
		if (!names.includes(name)) return true;
		if (!removed.includes(name)) removed.push(name);
		return false;
	});
	if (removed.length > 0) await controller.saveModulesJson(JSON.stringify(kept, null, 2));
	return removed;
}

// The user denies a client: nothing of it is shown or called; its record stays (it would only register again).
/** @type {Functions.Base.denyExtensionServiceClient} */
export async function denyExtensionServiceClient(id) {
	await updateExtensionServiceClient(id, (current) => (current ? { ...current, status: "denied" } : current));
	await sendToExtension(id, { type: EXTENSION_SERVICE_DECIDED_MESSAGE }, EXTENSION_SERVICE_PING_TIMEOUT_MS).catch(() => {});
}

// The user removes a client: its record, its packages and the decisions about the functions of its modules. Its
// module list entries stay — the provider's own module of the same name (tabGroupsSandbox) takes over again.
/** @type {Functions.Base.removeExtensionServiceClient} */
export async function removeExtensionServiceClient(id) {
	const client = (await readExtensionServiceClients())[id];
	if (!client) return false;
	await updateExtensionServiceClient(id, () => null);
	for (const name of new Set([...Object.keys(client.modules), ...Object.keys(client.installed)])) {
		for (const kind of /** @type {const} */ (["files", "package"])) {
			await sandboxPackagesRequest("readwrite", (store) => store.delete(clientPackageKey(id, name, kind))).catch(() => {});
		}
	}
	await sendToExtension(id, { type: EXTENSION_SERVICE_DECIDED_MESSAGE }, EXTENSION_SERVICE_PING_TIMEOUT_MS).catch(() => {});
	return true;
}

// The installed modules of the allowed clients that are there (refreshed first: a new version of a client is
// installed by this page) — module name → its record. Called by loadSandboxModules() for the names of the list.
/** @type {Functions.Base.loadClientSandboxModules} */
async function loadClientSandboxModules(names) {
	/** @type {Map<string, Types.SandboxModuleRecord>} */
	const records = new Map();
	const wanted = new Set(names);
	const clients = Object.values(await readExtensionServiceClients()).filter(
		(client) => client.status === "approved" && Object.keys(client.modules).some((name) => wanted.has(name))
	);
	for (const client of clients) {
		if (!(await isExtensionServiceClientAlive(client.id))) continue;
		if (Object.entries(client.modules).some(([name, { hash }]) => wanted.has(name) && client.installed[name]?.hash !== hash)) {
			await withSandboxLock(`extensionServiceInstall:${client.id}`, () => installClientSandboxModules(client.id));
		}
		const installed = (await readExtensionServiceClients())[client.id]?.installed ?? {};
		for (const [name, record] of Object.entries(installed)) {
			if (wanted.has(name) && !records.has(name)) records.set(name, record);
		}
	}
	return records;
}

// A function a client serves for its module (the module comes from the client and the client offers the function):
// the kind of the service, otherwise null.
/** @type {Functions.Base.clientServiceKind} */
function clientServiceKind(mod, name) {
	const services = mod.sandbox?.client ? mod.sandbox.services ?? [] : [];
	return services.find((service) => service.name === name)?.kind ?? null;
}

// A call of a function a client serves (EXTENSION_SERVICE_CALL): the value, or the error of the client.
/** @type {Functions.Base.callExtensionService} */
export async function callExtensionService(id, name, args, location) {
	return askExtensionService(id, EXTENSION_SERVICE_CALL_MESSAGE, name, args, await moduleServiceContext(location));
}

// A request of a service to another extension (EXTENSION_SERVICE_CALL to a client, EXTENSION_SERVICE_REQUEST to the
// provider) with the context of the page that asks: the value, or the error of the other extension.
/** @type {Functions.Base.askExtensionService} */
async function askExtensionService(id, type, name, args, context) {
	const { windowId, language, location } = context;
	const answer = /** @type {unknown} */ (
		await sendToExtension(id, { type, name, args: Array.isArray(args) ? args : [], context: { windowId, language, location } }, EXTENSION_SERVICE_CALL_TIMEOUT_MS)
	);
	if (!isPlainObject(answer)) throw new Error(t("core_service_no_answer", name));
	if (answer.ok !== true) throw new Error(typeof answer.error === "string" ? answer.error : t("core_service_no_answer", name));
	return answer.value;
}

// Where a service of another module runs (api.services.call(), background.js — see "Services of other modules"), and its
// answer: (1) an allowed client of this extension that is there and runs the module of the service instead of this
// extension (replaces — the data of the module are there), or offers a service this extension does not have; (2) the
// background part of this extension; (3) the service provider of this extension (EXTENSION_SERVICE_REQUEST — it asks
// its other clients itself). from — the extension that asked (a client, or the provider): never asked back. None of
// them → core_service_unavailable.
/** @type {Functions.Base.routeModuleService} */
export async function routeModuleService(name, args, context, from = null) {
	if (typeof name !== "string" || !SANDBOX_CAPABILITY_NAME_RE.test(name)) throw new Error(t("core_service_unknown", String(name)));
	const local = backgroundServices.get(name);
	/** @type {(client: Types.ExtensionServiceClient) => boolean} */
	const offers = (client) => client.id !== from && client.services.some((service) => service.name === name && service.kind === "call");
	// Only the clients that offer it are asked whether they are there.
	const offering = Object.values(await readExtensionServiceClients()).some((client) => client.status === "approved" && offers(client));
	const clients = offering ? (await getLiveExtensionServiceClients()).filter(offers) : [];
	const client = local ? clients.find((item) => replaceableModules(item.replaces).includes(local.moduleName)) : clients[0];
	if (client) return askExtensionService(client.id, EXTENSION_SERVICE_CALL_MESSAGE, name, args, context);
	if (local?.handler) return runBackgroundService(name, args, context);
	const providerId = await readServiceProviderId();
	if (providerId && providerId !== from) return askExtensionService(providerId, EXTENSION_SERVICE_REQUEST_MESSAGE, name, args, context);
	throw new Error(t("core_service_unavailable", name));
}

// A request of a client for a service of another module (EXTENSION_SERVICE_REQUEST): only an allowed client, only a
// service of its uses (the user allowed the client with them); done where the module runs (routeModuleService(), never
// by the client that asks).
/** @type {Functions.Base.handleClientServiceRequest} */
async function handleClientServiceRequest(id, message) {
	const name = typeof message.name === "string" ? message.name : "";
	const client = (await readExtensionServiceClients())[id];
	if (!client || client.status !== "approved") return { ok: false, error: t("core_service_client_not_allowed", id) };
	if (!(client.uses ?? []).some((use) => use.name === name)) return { ok: false, error: t("core_service_not_declared", name) };
	await noteExtensionServiceClientAlive(id, true);
	try {
		return { ok: true, value: await routeModuleService(name, message.args, normalizeServiceContext(message.context, "client"), id) };
	} catch (err) {
		return { ok: false, error: describeError(err) };
	}
}

// A listener of a function a client serves: a lease on its changes (renewed while it runs) and its
// EXTENSION_SERVICE_CHANGED messages for this page. Returns a function to unsubscribe.
/** @type {Functions.Base.listenExtensionService} */
export function listenExtensionService(id, name, emit) {
	const subscribe = () => {
		sendToExtension(id, { type: EXTENSION_SERVICE_SUBSCRIBE_MESSAGE, name, ms: EXTENSION_SERVICE_LEASE_MS }, EXTENSION_SERVICE_PING_TIMEOUT_MS).catch(() => {
			// The client is gone — no changes; the page shows the provider's own module next time.
		});
	};
	/** @type {(message: unknown, sender: chrome.runtime.MessageSender) => void} */
	const listener = (message, sender) => {
		if (sender.id !== id || !isPlainObject(message) || message.protocol !== EXTENSION_SERVICE_PROTOCOL) return;
		if (message.type === EXTENSION_SERVICE_CHANGED_MESSAGE && message.name === name) emit(message.value);
	};
	chrome.runtime.onMessageExternal.addListener(listener);
	subscribe();
	const timer = setInterval(subscribe, EXTENSION_SERVICE_LEASE_RENEW_MS);
	return () => {
		clearInterval(timer);
		chrome.runtime.onMessageExternal.removeListener(listener);
	};
}

// The client that keeps the data of a module for this extension (see "Backup" above): an allowed client that is
// there and offers the module in its backup — null, the data are here.
/** @type {Functions.Base.findBackupClient} */
async function findBackupClient(moduleName) {
	const clients = await getLiveExtensionServiceClients();
	return clients.find((client) => (client.backup ?? []).includes(moduleName)) ?? null;
}

// The modules whose data the clients keep (api.backup.listClientModules()) — with the name of the client, sorted by
// the module.
/** @type {Functions.Base.listClientBackupModules} */
export async function listClientBackupModules() {
	/** @type {Types.ClientBackupModule[]} */
	const modules = [];
	for (const client of await getLiveExtensionServiceClients()) {
		for (const name of client.backup ?? []) {
			if (!modules.some((module) => module.name === name)) modules.push({ name, extension: client.name });
		}
	}
	return modules.sort((a, b) => a.name.localeCompare(b.name));
}

// A request of the backup to the client that keeps the data of the module: its value, or its error.
/** @type {Functions.Base.requestClientBackup} */
async function requestClientBackup(client, message) {
	const answer = /** @type {unknown} */ (await sendToExtension(client.id, message, EXTENSION_SERVICE_CALL_TIMEOUT_MS));
	if (!isPlainObject(answer)) throw new Error(t("core_service_backup_no_answer", client.name, String(message.module)));
	if (answer.ok !== true) throw new Error(typeof answer.error === "string" ? answer.error : t("core_service_backup_no_answer", client.name, String(message.module)));
	return answer.value;
}

// api.backup.exportModule(): the backup of a module from the client that keeps its data, otherwise from here.
/** @type {Functions.Base.exportModuleBackupWithClients} */
export async function exportModuleBackupWithClients(moduleName) {
	const client = await findBackupClient(moduleName);
	if (!client) return exportModuleBackup(moduleName);
	const backup = await requestClientBackup(client, { type: EXTENSION_SERVICE_BACKUP_EXPORT_MESSAGE, module: moduleName });
	if (!isPlainObject(backup)) throw new Error(t("core_service_backup_no_answer", client.name, moduleName));
	return /** @type {Types.ModuleBackup} */ (backup);
}

// api.backup.importModule(): the data of a module replaced in the client that keeps them, otherwise here.
/** @type {Functions.Base.importModuleBackupWithClients} */
export async function importModuleBackupWithClients(moduleName, backup, options = {}) {
	const client = await findBackupClient(moduleName);
	if (!client) return importModuleBackup(moduleName, backup, options);
	await requestClientBackup(client, {
		type: EXTENSION_SERVICE_BACKUP_IMPORT_MESSAGE,
		module: moduleName,
		backup,
		options: { settings: options.settings !== false, data: options.data !== false },
	});
}

// --- The client ---

// What this extension tells its provider about itself (EXTENSION_SERVICE_REGISTER): its uploaded modules the
// extension brings itself in its module list (their packages), the services of its background parts (with what
// the catalog says about them — a function of the catalog with a listener is a listener), the services of other
// modules its background parts use (with why) and its modules from the package.
/** @type {Functions.Base.buildServiceRegistration} */
export async function buildServiceRegistration() {
	const controller = new BaseController();
	/** @type {unknown} */
	let paths = [];
	try {
		paths = JSON.parse(await controller.getModulesJson());
	} catch {
		// An unreadable list — nothing to offer.
	}
	const entries = Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : [];
	const sandboxNames = [...new Set(entries.filter(isSandboxModuleEntry).map((path) => getModuleKey(path)))].filter((name) =>
		Object.hasOwn(BUNDLED_SANDBOX_MODULES, name)
	);
	/** @type {Types.ExtensionServiceModulePackage[]} */
	const modules = [];
	for (const name of sandboxNames) {
		const content = await readBundledSandboxPackage(name);
		modules.push({
			name,
			hash: await hashSandboxFiles(content.files),
			files: Object.fromEntries(Object.entries(content.files).map(([path, file]) => [path, bytesToBase64(file.data)])),
		});
	}
	/** @type {Types.ExtensionServiceInfo[]} */
	const services = [...backgroundServices].map(([name, service]) => {
		const info = describeSandboxCapability(name);
		return {
			name,
			kind: service.handler ? "call" : "listen",
			risk: info.risk ?? "medium",
			about: (info.about ?? name).slice(0, EXTENSION_SERVICE_MAX_TEXT),
		};
	});
	const replaces = packageModulesInList(entries);
	const manifest = chrome.runtime.getManifest();
	// Why the modules use the services are their own texts — background.js loads them only when a module needs them.
	if (usedServices.size > 0) await loadI18n();
	return {
		name: (chrome.i18n?.getMessage?.("extension_name") || manifest.name).slice(0, EXTENSION_SERVICE_MAX_NAME),
		version: manifest.version,
		modules,
		services: services.sort((a, b) => a.name.localeCompare(b.name)),
		uses: listUsedServices(),
		replaces,
		backup: replaces,
	};
}

// The modules from the package in the module list of this client: it runs them instead of its provider (replaces)
// and keeps their data for it (backup).
/** @type {Functions.Base.packageModulesInList} */
function packageModulesInList(entries) {
	return replaceableModules([...new Set(entries.filter((path) => !isSandboxModuleEntry(path)).map((path) => getModuleKey(path)))]);
}

// The modules whose data this client backs up and restores for its provider (EXTENSION_SERVICE_BACKUP_*) — read
// from the module list at every request (the registration may be older).
/** @type {Functions.Base.readClientBackupModules} */
async function readClientBackupModules() {
	try {
		const paths = /** @type {unknown} */ (JSON.parse(await new BaseController().getModulesJson()));
		return Array.isArray(paths) ? packageModulesInList(paths.filter((path) => typeof path === "string")) : [];
	} catch {
		return [];
	}
}

// Stores what the provider said (EXTENSION_SERVICE_PROVIDER_KEY) — the pages of the client decide by it.
/** @type {Functions.Base.storeServiceProviderState} */
async function storeServiceProviderState(state) {
	try {
		await chrome.storage.local.set({ [EXTENSION_SERVICE_PROVIDER_KEY]: state });
	} catch (err) {
		console.error("Stav poskytovatele služeb nejde uložit:", err);
	}
}

// The client tells its provider about itself and asks what it shows (background.js: after the installation and an
// update, at a browser start — force —, otherwise once in EXTENSION_SERVICE_REGISTER_EVERY_MS). Without a provider
// (not installed) it only remembers that.
/** @type {Functions.Base.registerWithServiceProvider} */
export async function registerWithServiceProvider(force = false) {
	const providerId = await readServiceProviderId();
	if (!providerId) return null;
	const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(EXTENSION_SERVICE_PROVIDER_KEY))[EXTENSION_SERVICE_PROVIDER_KEY];
	const last = isPlainObject(stored) && stored.id === providerId ? Number(stored.registeredAt) || 0 : 0;
	if (!force && Date.now() - last < EXTENSION_SERVICE_REGISTER_EVERY_MS) return /** @type {Types.ExtensionServiceProviderState} */ (stored);
	const registeredAt = Date.now();
	try {
		await sendToExtension(providerId, { type: EXTENSION_SERVICE_REGISTER_MESSAGE, ...(await buildServiceRegistration()) }, EXTENSION_SERVICE_CALL_TIMEOUT_MS);
	} catch (err) {
		console.info("Poskytovatel služeb není k dispozici:", describeError(err));
	}
	return askServiceProviderStatus(providerId, registeredAt);
}

// The client asks its provider which of its modules it shows (EXTENSION_SERVICE_STATUS) and remembers the answer;
// no answer = the provider is not there (nothing is shown there).
/** @type {Functions.Base.askServiceProviderStatus} */
async function askServiceProviderStatus(providerId, registeredAt = null) {
	const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(EXTENSION_SERVICE_PROVIDER_KEY))[EXTENSION_SERVICE_PROVIDER_KEY];
	const lastRegistration = registeredAt ?? (isPlainObject(stored) && stored.id === providerId ? Number(stored.registeredAt) || null : null);
	/** @type {Types.ExtensionServiceProviderState} */
	let state = { id: providerId, status: "unknown", shown: [], provider: null, checkedAt: Date.now(), registeredAt: lastRegistration };
	try {
		const answer = /** @type {unknown} */ (await sendToExtension(providerId, { type: EXTENSION_SERVICE_STATUS_MESSAGE }, EXTENSION_SERVICE_PING_TIMEOUT_MS));
		if (isPlainObject(answer)) {
			const status = /** @type {Types.ExtensionServiceProviderState['status']} */ (answer.status);
			state = {
				id: providerId,
				status: [...EXTENSION_SERVICE_STATUSES, "unknown"].includes(status) ? status : "unknown",
				shown: Array.isArray(answer.shown) ? answer.shown.filter((name) => typeof name === "string") : [],
				provider: typeof answer.provider === "string" ? answer.provider.slice(0, EXTENSION_SERVICE_MAX_NAME) : null,
				checkedAt: Date.now(),
				registeredAt: lastRegistration,
			};
		}
	} catch {
		// The provider is not installed or turned off.
	}
	await storeServiceProviderState(state);
	return state;
}

// What the provider of this client shows, for the client's pages: asked again once in EXTENSION_SERVICE_ALIVE_MS
// (null — this extension is not a client).
/** @type {Functions.Base.getServiceProviderState} */
export async function getServiceProviderState() {
	const providerId = await readServiceProviderId();
	if (!providerId) return null;
	const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(EXTENSION_SERVICE_PROVIDER_KEY))[EXTENSION_SERVICE_PROVIDER_KEY];
	if (isPlainObject(stored) && stored.id === providerId && Date.now() - Number(stored.checkedAt) < EXTENSION_SERVICE_ALIVE_MS) {
		return /** @type {Types.ExtensionServiceProviderState} */ (stored);
	}
	return askServiceProviderStatus(providerId);
}

// Is the service provider of this client installed and turned on — it answered right now (not from the
// remembered state)? false also when this extension is not a client (the full extension). onboardingModule of a
// standalone extension does not open its welcome page next to the full extension.
/** @type {Functions.Base.isServiceProviderPresent} */
export async function isServiceProviderPresent() {
	const providerId = await readServiceProviderId();
	if (!providerId) return false;
	return (await askServiceProviderStatus(providerId)).provider !== null;
}

/** @type {Map<string, number> | null} */
let serviceLeases = null;

// The leases of the provider (memory, after a restart of the service worker from chrome.storage.session).
/** @type {Functions.Base.readServiceLeases} */
async function readServiceLeases() {
	if (serviceLeases) return serviceLeases;
	/** @type {Map<string, number>} */
	const leases = new Map();
	try {
		const stored = (await chrome.storage.session?.get(EXTENSION_SERVICE_LEASES_KEY))?.[EXTENSION_SERVICE_LEASES_KEY];
		if (isPlainObject(stored)) for (const [name, until] of Object.entries(stored)) if (typeof until === "number") leases.set(name, until);
	} catch {
		// Without chrome.storage.session only in memory.
	}
	serviceLeases ??= leases;
	return serviceLeases;
}

/** @type {Map<string, { values: unknown[], timer: ReturnType<typeof setTimeout> }>} */
const pendingServiceChanges = new Map();

// api.services.changed() of a background part: to the provider, while it holds a lease on the listener — a series
// of the same values in EXTENSION_SERVICE_CHANGED_DELAY_MS as one message. In an extension that is not a client it
// does nothing.
/** @type {Functions.Base.notifyServiceChange} */
function notifyServiceChange(name, value) {
	Promise.all([readServiceProviderId(), readServiceLeases()])
		.then(([providerId, leases]) => {
			if (!providerId || (leases.get(name) ?? 0) < Date.now()) return;
			const pending = pendingServiceChanges.get(name);
			if (pending) {
				if (!pending.values.some((known) => JSON.stringify(known) === JSON.stringify(value))) pending.values.push(value);
				return;
			}
			const timer = setTimeout(() => {
				const entry = pendingServiceChanges.get(name);
				pendingServiceChanges.delete(name);
				for (const item of entry?.values ?? []) {
					sendToExtension(providerId, { type: EXTENSION_SERVICE_CHANGED_MESSAGE, name, value: item }, EXTENSION_SERVICE_PING_TIMEOUT_MS).catch(() => {
						// The provider is gone — its lease runs out.
					});
				}
			}, EXTENSION_SERVICE_CHANGED_DELAY_MS);
			pendingServiceChanges.set(name, { values: [value], timer });
		})
		.catch((err) => console.error("Změnu služby nejde poslat:", err));
}

// A message of another extension (chrome.runtime.onMessageExternal of background.js): as the provider the
// registration, the status question and the service requests of a client (a standalone extension refuses them — it
// is never a provider); as a client the requests of its provider (only from it).
// The answer through sendResponse — true = it comes later.
/** @type {Functions.Base.handleExtensionServiceMessage} */
export function handleExtensionServiceMessage(message, sender, sendResponse) {
	const id = sender.id;
	if (!isPlainObject(message) || message.protocol !== EXTENSION_SERVICE_PROTOCOL || typeof id !== "string" || id === chrome.runtime.id) return false;
	/** @type {(work: () => Promise<unknown>) => true} */
	const answer = (work) => {
		work().then(
			(value) => sendResponse(value),
			(err) => sendResponse({ ok: false, error: describeError(err) })
		);
		return true;
	};
	/** @type {(work: () => Promise<unknown>) => true} */
	const asProvider = (work) =>
		answer(async () => {
			if (await isStandaloneExtension()) {
				throw new Error(t("core_service_standalone", chrome.i18n?.getMessage?.("extension_name") || chrome.runtime.getManifest().name));
			}
			return work();
		});
	switch (message.type) {
		case EXTENSION_SERVICE_REGISTER_MESSAGE:
			return asProvider(() => registerExtensionServiceClient(id, message));
		case EXTENSION_SERVICE_STATUS_MESSAGE:
			return asProvider(() => describeExtensionServiceStatus(id));
		case EXTENSION_SERVICE_REQUEST_MESSAGE:
			return asProvider(() => handleClientServiceRequest(id, message));
		case EXTENSION_SERVICE_PING_MESSAGE:
		case EXTENSION_SERVICE_CALL_MESSAGE:
		case EXTENSION_SERVICE_SUBSCRIBE_MESSAGE:
		case EXTENSION_SERVICE_OPEN_MESSAGE:
		case EXTENSION_SERVICE_DECIDED_MESSAGE:
		case EXTENSION_SERVICE_BACKUP_EXPORT_MESSAGE:
		case EXTENSION_SERVICE_BACKUP_IMPORT_MESSAGE:
			return answer(async () => {
				if ((await readServiceProviderId()) !== id) throw new Error(t("core_service_not_provider", id));
				return handleProviderRequest(message);
			});
	}
	return false;
}

// A request of this client's provider (handleExtensionServiceMessage() checked the sender).
/** @type {Functions.Base.handleProviderRequest} */
async function handleProviderRequest(message) {
	switch (message.type) {
		case EXTENSION_SERVICE_PING_MESSAGE:
			return { ok: true };
		case EXTENSION_SERVICE_CALL_MESSAGE: {
			const name = typeof message.name === "string" ? message.name : "";
			if (!backgroundServices.get(name)?.handler) return { ok: false, error: t("core_service_unknown", name) };
			try {
				return { ok: true, value: await runBackgroundService(name, message.args, normalizeServiceContext(message.context, "provider")) };
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) };
			}
		}
		case EXTENSION_SERVICE_SUBSCRIBE_MESSAGE: {
			const name = typeof message.name === "string" ? message.name : "";
			if (!backgroundServices.has(name)) return { ok: false, error: t("core_service_unknown", name) };
			const ms = typeof message.ms === "number" ? Math.min(Math.max(message.ms, 0), EXTENSION_SERVICE_LEASE_MS) : EXTENSION_SERVICE_LEASE_MS;
			const leases = await readServiceLeases();
			leases.set(name, Date.now() + ms);
			await chrome.storage.session?.set({ [EXTENSION_SERVICE_LEASES_KEY]: Object.fromEntries(leases) }).catch(() => {});
			return { ok: true };
		}
		case EXTENSION_SERVICE_OPEN_MESSAGE:
			await chrome.runtime.openOptionsPage();
			return { ok: true };
		case EXTENSION_SERVICE_DECIDED_MESSAGE: {
			const providerId = await readServiceProviderId();
			if (providerId) await askServiceProviderStatus(providerId);
			return { ok: true };
		}
		// Only a module of its backup — the provider cannot read or overwrite the data of another one.
		case EXTENSION_SERVICE_BACKUP_EXPORT_MESSAGE:
		case EXTENSION_SERVICE_BACKUP_IMPORT_MESSAGE: {
			const name = typeof message.module === "string" ? message.module : "";
			if (!(await readClientBackupModules()).includes(name)) return { ok: false, error: t("core_service_backup_refused", name) };
			if (message.type === EXTENSION_SERVICE_BACKUP_EXPORT_MESSAGE) return { ok: true, value: await exportModuleBackup(name) };
			const options = isPlainObject(message.options) ? message.options : {};
			await importModuleBackup(name, message.backup, { settings: options.settings !== false, data: options.data !== false });
			return { ok: true };
		}
	}
	return { ok: false, error: t("core_service_unknown", String(message.type)) };
}

// The roles of background.js: the listener of the messages of other extensions (registered right away — a
// woken service worker delivers the message only to listeners of its first pass), and the registration of a
// client with its provider (at most once in EXTENSION_SERVICE_REGISTER_EVERY_MS — background.js forces it after
// the installation and at a browser start), after its background parts registered their services.
/** @type {Functions.Base.startExtensionServices} */
export function startExtensionServices() {
	chrome.runtime.onMessageExternal?.addListener(handleExtensionServiceMessage);
	queueMicrotask(() => {
		registerWithServiceProvider().catch((err) => console.error("Registrace u poskytovatele služeb selhala:", err));
	});
}

// Opens the Settings of a client (EXTENSION_SERVICE_OPEN) — the button of the provider's Settings.
/** @type {Functions.Base.openExtensionServiceClient} */
export async function openExtensionServiceClient(id) {
	await sendToExtension(id, { type: EXTENSION_SERVICE_OPEN_MESSAGE }, EXTENSION_SERVICE_PING_TIMEOUT_MS);
}

// A module of this client its provider shows too: what the provider said (null — only the client shows it, or this
// extension is not a client). Where the client shows it meanwhile is the module's second set of output locations
// (getModuleDelegatedDisplayLocations(), BaseController.isModuleActive()).
/** @type {Functions.Base.getServiceDelegation} */
export async function getServiceDelegation(name) {
	const state = await getServiceProviderState();
	return state && state.status === "approved" && state.shown.includes(name) ? state : null;
}

/** @type {Functions.Base.readSandboxModules} */
export async function readSandboxModules() {
	try {
		const result = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(SANDBOX_MODULES_KEY));
		const store = result[SANDBOX_MODULES_KEY];
		return isPlainObject(store) ? store : {};
	} catch (err) {
		console.error("Nelze načíst nahrané moduly:", err);
		return {};
	}
}

/** @type {Functions.Base.sha256Hex} */
async function sha256Hex(data) {
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @type {Promise<IDBDatabase> | null} */
let sandboxPackagesDb = null;

/** @type {Functions.Base.openSandboxPackagesDb} */
function openSandboxPackagesDb() {
	if (!sandboxPackagesDb) {
		sandboxPackagesDb = new Promise((resolve, reject) => {
			const request = indexedDB.open(SANDBOX_PACKAGES_DB, SANDBOX_PACKAGES_DB_VERSION);
			request.onerror = () => {
				sandboxPackagesDb = null;
				reject(request.error);
			};
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(SANDBOX_PACKAGES_STORE)) request.result.createObjectStore(SANDBOX_PACKAGES_STORE);
			};
			request.onsuccess = () => {
				const db = request.result;
				db.onclose = () => {
					sandboxPackagesDb = null;
				};
				db.onversionchange = () => {
					db.close();
					sandboxPackagesDb = null;
				};
				resolve(db);
			};
		});
	}
	return sandboxPackagesDb;
}

// One request on the store of the packages; resolves when the transaction completes.
/** @type {Functions.Base.sandboxPackagesRequest} */
async function sandboxPackagesRequest(mode, work) {
	const db = await openSandboxPackagesDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SANDBOX_PACKAGES_STORE, mode);
		const request = work(tx.objectStore(SANDBOX_PACKAGES_STORE));
		tx.oncomplete = () => resolve(request.result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
	});
}

// The stored package of an uploaded module; null = it is not there (or it cannot be read).
/** @type {Functions.Base.readSandboxPackage} */
export async function readSandboxPackage(name) {
	try {
		const value = await sandboxPackagesRequest("readonly", (store) => store.get(name));
		return isPlainObject(value) && isPlainObject(value.files) ? /** @type {Types.SandboxPackage} */ (value) : null;
	} catch (err) {
		console.error(`Soubory nahraného modulu "${name}" nejde načíst:`, err);
		return null;
	}
}

/** @type {Functions.Base.writeSandboxPackage} */
async function writeSandboxPackage(pkg) {
	await sandboxPackagesRequest("readwrite", (store) => store.put(pkg, pkg.name));
}

/** @type {Functions.Base.deleteSandboxPackage} */
async function deleteSandboxPackage(name) {
	try {
		await sandboxPackagesRequest("readwrite", (store) => store.delete(name));
	} catch (err) {
		console.error(`Soubory nahraného modulu "${name}" nejde smazat:`, err);
	}
}

// Is the name (or the element tag derived from it) already used by a module from the package,
// by a module the extension brings itself (BUNDLED_SANDBOX_MODULES — an upload would replace
// it) or by another uploaded module? Modules from the package are recognized by the default list
// (every folder in modules/ is in it, tests/manifests.test.mjs checks that) and by the registry
// of the page; a tag is compared because "myModule" and "MyModule" would have the same one.
/** @type {Functions.Base.isModuleNameTaken} */
async function isModuleNameTaken(name, store) {
	const tag = getTagName(name);
	if (Object.keys(BUNDLED_SANDBOX_MODULES).some((bundled) => getTagName(bundled) === tag)) return true;
	if ((globalThis.__extensionModules || []).some((m) => m.tag === tag && !(m.sandbox && m.name === name))) return true;
	if (Object.keys(store).some((other) => other !== name && getTagName(other) === tag)) return true;
	try {
		const defaults = JSON.parse(await new BaseController().fetchDefaultModulesJson());
		return Array.isArray(defaults) && defaults.some((path) => typeof path === "string" && getTagName(getModuleKey(path)) === tag);
	} catch (err) {
		console.error("Výchozí seznam modulů nejde načíst, jméno nahraného modulu nejde ověřit:", err);
		return true;
	}
}

// A one-time key of one sandbox page — it is in the address of the page (#…) and the
// sandbox sends it with every message. When the frame is navigated elsewhere, the new
// page does not know it and the core does not answer it (event.source stays the same).
// 128 random bits as hex from crypto.getRandomValues(), not crypto.randomUUID(): that one
// exists only in a secure context, and the floating window's <iframe> on an http:// page is
// not one (verified in Firefox 157 — no uploaded module started there).
/** @type {Functions.Base.createSandboxToken} */
export function createSandboxToken() {
	return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @type {Functions.Base.createSandboxFrame} */
function createSandboxFrame(token) {
	const frame = document.createElement("iframe");
	frame.setAttribute("sandbox", SANDBOX_FRAME_FLAGS);
	frame.src = `${chrome.runtime.getURL(SANDBOX_PAGE)}#${token}`;
	return frame;
}

// What the sandbox gets with the module for evaluation (Types.Sandbox.Context).
/** @type {Functions.Base.createSandboxContext} */
function createSandboxContext(pkg, language) {
	return {
		name: pkg.name,
		language,
		pkg,
		apiMethods: getSandboxApiMethods(),
		extension: getExtensionInfo(),
		constants: {
			PAGE_ACCESS_PERMISSIONS,
			BOOKMARKS_PERMISSIONS,
			WEBREQUEST_PERMISSIONS,
			WEBNAVIGATION_PERMISSIONS,
			NETWORK_RULES_PERMISSIONS,
			CONTENT_FILTERS_PERMISSIONS,
			USER_SCRIPTS_PERMISSIONS,
			NETWORK_FILTERS_PERMISSIONS,
		},
	};
}

// A message from the sandbox page of this frame with the right token, otherwise null.
/** @type {Functions.Base.readSandboxMessage} */
function readSandboxMessage(event, frame, token) {
	if (!frame.contentWindow || event.source !== frame.contentWindow) return null;
	const data = event.data;
	if (!isPlainObject(data) || data.token !== token || typeof data.kind !== "string") return null;
	return /** @type {Types.Sandbox.Envelope} */ (data);
}

// The sandbox has an opaque origin, so the message cannot be addressed to it by origin — its
// frame is the address (and its own token is the protection the other way). false = it was not sent
// (no frame, or a value that cannot be copied into another window).
/** @type {Functions.Base.postToSandbox} */
function postToSandbox(frame, message) {
	if (!frame || !frame.contentWindow) return false;
	try {
		frame.contentWindow.postMessage(message, "*");
		return true;
	} catch (err) {
		console.error("Zprávu do sandboxu nejde poslat:", err);
		return false;
	}
}

// Evaluates the module in a hidden sandbox page (in the given UI language — its
// description and settings labels come from its own texts) and returns what it declared
// in registerModule() as data, or the problems found. It is called when uploading by
// installSandboxModule(), on the Settings page.
/** @type {Functions.Base.inspectSandboxModule} */
export function inspectSandboxModule({ pkg, language }) {
	return new Promise((resolve, reject) => {
		const token = createSandboxToken();
		const frame = createSandboxFrame(token);
		frame.hidden = true;
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let timer;
		/** @type {(event: MessageEvent) => void} */
		const onMessage = (event) => {
			const message = readSandboxMessage(event, frame, token);
			if (!message) return;
			if (message.kind === "ready") {
				postToSandbox(frame, { kind: "inspect", ...createSandboxContext(pkg, language) });
			} else if (message.kind === "inspected" || message.kind === "problems") {
				const registration = message.kind === "inspected" ? message.registration : null;
				finish(() => resolve({ registration, problems: describeSandboxProblems(message.problems) }));
			}
		};
		/** @type {Functions.Base.inspectSandboxModule.finish} */
		const finish = (settle) => {
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			frame.remove();
			settle();
		};
		timer = setTimeout(
			() => finish(() => reject(new Error(t("core_sandbox_timeout", SANDBOX_INSPECT_TIMEOUT_MS / 1000)))),
			SANDBOX_INSPECT_TIMEOUT_MS
		);
		window.addEventListener("message", onMessage);
		document.body.appendChild(frame);
	});
}

// The stored registration in the UI language of the page (otherwise English, otherwise any).
/** @type {Functions.Base.pickSandboxRegistration} */
export function pickSandboxRegistration(record) {
	const registrations = isPlainObject(record.registrations) ? record.registrations : {};
	return registrations[getUiLanguage()] || registrations[DEFAULT_UI_LANGUAGE] || Object.values(registrations)[0] || null;
}

// The module definition for registerModule() from the stored data: the name and the tag
// are always derived from the file name, the activation rule from its descriptor. An invalid
// descriptor = null (the module is not registered).
/** @type {Functions.Base.sandboxModuleDefinition} */
export function sandboxModuleDefinition(record, registration) {
	const { activationSpec, ...data } = registration;
	/** @type {Types.ModuleDefinition} */
	const moduleDef = {
		...data,
		name: record.name,
		tag: getTagName(record.name),
		sandbox: {
			fileName: record.fileName,
			entry: record.entry,
			files: record.files,
			size: record.size,
			hash: record.hash,
			installedAt: record.installedAt,
			updatedAt: record.updatedAt,
			...(record.bundled === true ? { bundled: true } : {}),
			// A module of another extension (installClientSandboxModules()): the extension and the functions it serves.
			...(typeof record.client === "string" ? { client: record.client, services: record.services ?? [] } : {}),
		},
	};
	if (activationSpec !== undefined) {
		const spec = specFromDescriptor(activationSpec);
		if (!spec) return null;
		moduleDef.activationSpec = spec;
	}
	// A field of an uploaded module is always its own — it cannot share (and so set) a setting of the modules of the
	// package (SettingField.shared).
	for (const schemaName of /** @type {const} */ (["settingsSchema", "instanceSettingsSchema"])) {
		const schema = moduleDef[schemaName];
		if (!Array.isArray(schema)) continue;
		moduleDef[schemaName] = schema.map((field) => {
			if (!isPlainObject(field) || !Object.hasOwn(field, "shared")) return field;
			const { shared: _shared, ...own } = field;
			return own;
		});
	}
	return moduleDef;
}

// The element of an uploaded module in an extension page — every module has its own
// class (the browser registers one constructor under one tag only), all of them are
// SandboxModuleElement. false = the tag is already taken by a foreign element.
/** @type {Functions.Base.defineSandboxElement} */
function defineSandboxElement(tag) {
	if (typeof customElements === "undefined") return true;
	const existing = customElements.get(tag);
	if (existing) return existing.prototype instanceof SandboxModuleElement;
	customElements.define(tag, class extends SandboxModuleElement {});
	return true;
}

// Registers an uploaded module on this page (registerModule() with its validation) —
// the same module only once; a newer version of it (uploaded again) replaces the
// definition in the registry. A module from the package with the same name wins.
/** @type {Functions.Base.registerSandboxModule} */
function registerSandboxModule(record) {
	const registration = pickSandboxRegistration(record);
	const moduleDef = registration ? sandboxModuleDefinition(record, registration) : null;
	if (!moduleDef) {
		console.error(`Nahraný modul "${record.name}" má neplatná uložená data — nahraj ho znovu v Nastavení.`);
		return false;
	}
	const registry = globalThis.__extensionModules;
	const index = registry.findIndex((m) => m.name === record.name);
	if (index !== -1) {
		const current = registry[index];
		if (!current.sandbox) {
			console.error(`Nahraný modul "${record.name}" má stejné jméno jako modul z balíčku — nenačte se.`);
			return false;
		}
		if (current.sandbox.hash === record.hash && current.sandbox.updatedAt === record.updatedAt) return true;
		registry.splice(index, 1);
	}
	if (!defineSandboxElement(moduleDef.tag)) {
		console.error(`Nahraný modul "${record.name}": element <${moduleDef.tag}> už patří jinému modulu — nenačte se.`);
		return false;
	}
	registerModule(moduleDef);
	return true;
}

// Registers the uploaded modules of the module list entries on this page — instead of
// import() of the module file (importModuleFiles(), popup.mjs). Their code does not run here.
/** @type {Functions.Base.loadSandboxModules} */
export async function loadSandboxModules(paths) {
	const names = [...new Set(paths.filter(isSandboxModuleEntry).map((path) => getModuleKey(path)))];
	if (names.length === 0) return;
	// The modules the extension brings itself first — on a new installation (or after an update)
	// this page is the first one that needs them.
	await ensureBundledSandboxModules(paths);
	const store = await readSandboxModules();
	// The module of another extension (an allowed client that is there) instead of the provider's own of the same name.
	const clientRecords = await loadClientSandboxModules(names).catch((err) => {
		console.error("Moduly jiných rozšíření nejde načíst:", err);
		return /** @type {Map<string, Types.SandboxModuleRecord>} */ (new Map());
	});
	for (const name of names) {
		const record = clientRecords.get(name) ?? store[name];
		if (!isPlainObject(record) || typeof record.hash !== "string") {
			console.error(`Nahraný modul "${name}" není uložený — nahraj ho znovu v Nastavení (Nahrané moduly).`);
			continue;
		}
		// The registration goes into the module's load measurement like an import (see perf.mjs).
		measurePerf(name, "import", () => registerSandboxModule(record));
	}
}

// Adds an uploaded module at the end of the module list (unless it is there already). An
// unreadable list is left alone — false, the same as for a module that is already there.
/** @type {Functions.Base.addSandboxModuleToList} */
export async function addSandboxModuleToList(name) {
	const controller = new BaseController();
	/** @type {unknown} */
	let paths;
	try {
		paths = JSON.parse(await controller.getModulesJson());
	} catch (err) {
		console.error("Seznam modulů nejde načíst, nahraný modul se do něj nepřidá:", err);
		return false;
	}
	if (!Array.isArray(paths) || paths.some((path) => typeof path === "string" && getModuleKey(path) === name)) return false;
	await controller.saveModulesJson(JSON.stringify([...paths, getSandboxModuleEntry(name)], null, 2));
	return true;
}

// The core's function for loading a module from the user (the file input on the
// Settings page): it unpacks and checks the file (unpackSandboxUpload(),
// planSandboxPackage()), evaluates the module in the sandbox, applies the same rules as for
// a module from the package (validateModule()), stores the module and adds it to the module
// list. A module with the same name uploaded again is an update (the settings and the data
// stay). options.inspect replaces the evaluation in the sandbox (tests in Node without <iframe>).
/** @type {Functions.Base.installSandboxModule} */
export async function installSandboxModule(file, { inspect = inspectSandboxModule } = {}) {
	/** @type {Types.SandboxInstallResult} */
	const result = { ok: false, name: null, errors: [], warnings: [], updated: false, added: false };
	const fileName = String(file.name ?? "");
	const script = SANDBOX_SCRIPT_NAME_RE.exec(fileName);
	const isZip = /\.zip$/i.test(fileName);
	if (!script && !isZip) {
		result.errors.push(t("core_sandbox_bad_file_name", fileName));
		return result;
	}
	result.name = script ? script[1] : null;
	// The size before reading — a huge file is not read into memory at all.
	const limit = isZip ? SANDBOX_MAX_PACKAGE_BYTES : SANDBOX_MAX_SOURCE_BYTES;
	if (typeof file.size === "number" && file.size > limit) {
		result.errors.push(t("core_sandbox_too_large", formatBytes(file.size), formatBytes(limit)));
		return result;
	}
	/** @type {Uint8Array<ArrayBuffer>} */
	let bytes;
	try {
		bytes = new Uint8Array(await file.arrayBuffer());
	} catch (err) {
		result.errors.push(t("core_sandbox_read_failed", describeError(err)));
		return result;
	}

	const unpacked = await unpackSandboxUpload(fileName, bytes);
	result.warnings.push(...unpacked.warnings);
	if (!unpacked.content || unpacked.errors.length > 0) {
		result.errors.push(...unpacked.errors);
		return result;
	}
	const content = unpacked.content;
	const name = content.name;
	result.name = name;
	const store = await readSandboxModules();
	if (await isModuleNameTaken(name, store)) {
		result.errors.push(t("core_sandbox_name_taken", name, getTagName(name)));
		return result;
	}
	return installSandboxContent(content, { fileName, size: bytes.byteLength, hash: await sha256Hex(bytes), bundled: false }, store, inspect, result);
}

// What uploading a module and installing a module the extension brings itself have in common:
// the plan of the imports, the evaluation in the sandbox in every UI language, the same rules as
// for a module from the package (validateModule()), storing its package and its record and
// registering it on this page. An uploaded module is also added to the module list; one the
// extension brings itself is already there (it is installed because the list refers to it).
/** @type {Functions.Base.installSandboxContent} */
async function installSandboxContent(content, source, store, inspect, result) {
	const name = content.name;
	const previous = isPlainObject(store[name]) ? store[name] : null;
	const evaluated = await evaluateSandboxContent(content, source, previous, inspect, result);
	if (!evaluated) return result;
	const { pkg, record, declared } = evaluated;

	// The files first: a stored record always has its package (its fingerprint is in both). The records are
	// read again under the lock — another page may have stored another module during the evaluation (the
	// welcome page installs a module the extension brings itself while the user uploads one in Settings).
	await writeSandboxPackage(pkg);
	await withSandboxLock("sandboxModules", async () => {
		await chrome.storage.local.set({ [SANDBOX_MODULES_KEY]: { ...(await readSandboxModules()), [name]: record } });
	});
	// The user's decisions about functions this version no longer declares go away.
	await pruneSandboxCapabilityGrants(name, declared);
	result.updated = previous !== null;
	result.added = source.bundled ? false : await addSandboxModuleToList(name);
	registerSandboxModule(record);
	result.ok = true;
	return result;
}

// The checks and the evaluation of a package — the plan of the imports, the evaluation in the sandbox in every UI
// language, the same rules as for a module from the package (validateModule()): the package and the record to
// store, or null (the errors and warnings are in result). Shared by installing an uploaded module, one the
// extension brings itself and a module of another extension (installClientSandboxModules()).
/** @type {Functions.Base.evaluateSandboxContent} */
async function evaluateSandboxContent(content, source, previous, inspect, result) {
	const name = content.name;
	const planned = await planSandboxPackage(content);
	result.warnings.push(...planned.warnings);
	if (planned.errors.length > 0) {
		result.errors.push(...planned.errors);
		return null;
	}
	/** @type {Types.SandboxPackage} */
	const pkg = { ...content, hash: source.hash, plan: planned.plan };

	// Each UI language in its own sandbox — the module puts its texts (description, settings labels)
	// together with t() right when it is evaluated, the same as a module from the package.
	const languages = UI_LANGUAGES.map((option) => option.value);
	const inspections = await Promise.all(
		languages.map((language) => inspect({ pkg, language }).catch((err) => ({ registration: null, problems: [describeError(err)] })))
	);
	/** @type {Types.SandboxModuleRecord['registrations']} */
	const registrations = {};
	inspections.forEach((inspection, index) => {
		for (const problem of inspection.problems) {
			if (!result.errors.includes(problem)) result.errors.push(problem);
		}
		if (inspection.registration) registrations[languages[index]] = inspection.registration;
	});
	// The functions outside the sandbox are one list, whatever the language — the user decides about them once.
	const declaredLists = new Set(Object.values(registrations).map((registration) => JSON.stringify(registration.capabilities ?? [])));
	if (declaredLists.size > 1) result.errors.push(t("core_sandbox_capabilities_differ"));
	if (result.errors.length > 0) return null;

	const now = Date.now();
	/** @type {Types.SandboxModuleRecord} */
	const record = {
		name,
		fileName: source.fileName,
		entry: pkg.entry,
		files: Object.keys(pkg.files).length,
		size: source.size,
		hash: pkg.hash,
		installedAt: previous ? previous.installedAt : now,
		updatedAt: now,
		registrations,
		...(source.bundled ? { bundled: true } : {}),
	};

	// The same rules as for a module from the package — validateModule() over the definition
	// in every language; the element must exist first (the validation checks it).
	if (!defineSandboxElement(getTagName(name))) {
		result.errors.push(t("core_sandbox_name_taken", name, getTagName(name)));
		return null;
	}
	for (const registration of Object.values(registrations)) {
		const moduleDef = sandboxModuleDefinition(record, registration);
		const validation = moduleDef ? validateModule(moduleDef) : { errors: [t("core_sandbox_problem_bad_spec")], warnings: [] };
		for (const error of validation.errors) if (!result.errors.includes(error)) result.errors.push(error);
		for (const warning of validation.warnings) if (!result.warnings.includes(warning)) result.warnings.push(warning);
	}
	if (result.errors.length > 0) return null;
	// Declared functions the user could not allow — the module may still work without them.
	const declared = getDeclaredSandboxCapabilities(Object.values(registrations)[0]?.capabilities);
	for (const capability of declared.map((item) => describeSandboxCapability(item))) {
		if (capability.kind === "base") result.warnings.push(t("core_sandbox_capability_declared_base", capability.name));
		if (capability.kind === "forbidden") result.warnings.push(t("core_sandbox_capability_declared_forbidden", capability.name, capability.blocked ?? ""));
		if (capability.kind === "unknown") result.warnings.push(t("core_sandbox_capability_declared_unknown", capability.name));
	}
	return { pkg, record, declared };
}

// The package of a module the extension brings itself (BUNDLED_SANDBOX_MODULES), read from
// the extension — the same content as the .zip of its folder gives (unpackSandboxUpload();
// tests/sandbox.test.mjs checks the package by those rules).
/** @type {Functions.Base.readBundledSandboxPackage} */
async function readBundledSandboxPackage(name) {
	const paths = BUNDLED_SANDBOX_MODULES[name];
	const datas = await Promise.all(
		paths.map(async (path) => {
			const file = `${BUNDLED_SANDBOX_DIR}/${name}/${path}`;
			const res = await fetch(chrome.runtime.getURL(file));
			if (!res.ok) throw new Error(t("core_file_load_failed", file, res.status));
			return new Uint8Array(await res.arrayBuffer());
		})
	);
	/** @type {Types.SandboxPackageFiles} */
	const files = {};
	paths.forEach((path, index) => {
		const fileType = getSandboxFileType(path);
		if (!fileType) throw new Error(`Soubor "${path}" modulu "${name}" nemá povolený typ`);
		files[path] = { type: fileType.type, data: datas[index] };
	});
	return sandboxContentFromFiles(name, files);
}

// The content of a package from its files (the folder of a module the extension brings itself, the package of
// another extension): the entry file <name>.mjs or <name>.js and its texts checked. Throws when it is not usable.
/** @type {Functions.Base.sandboxContentFromFiles} */
function sandboxContentFromFiles(name, files) {
	const entry = [`${name}.mjs`, `${name}.js`].find((path) => Object.hasOwn(files, path));
	if (!entry) throw new Error(t("core_sandbox_no_entry", name));
	const messagesError = checkSandboxMessages(files);
	if (messagesError) throw new Error(messagesError);
	return { name, entry, format: entry.endsWith(".mjs") ? "module" : "script", files };
}

// The fingerprint of a package by its files (the path, the length and the content, in the order
// of the paths) — a module the extension brings itself has no uploaded file to take it from.
/** @type {Functions.Base.hashSandboxFiles} */
async function hashSandboxFiles(files) {
	const encoder = new TextEncoder();
	/** @type {Uint8Array<ArrayBuffer>[]} */
	const parts = [];
	for (const path of Object.keys(files).sort()) {
		parts.push(encoder.encode(`${path}\n${files[path].data.byteLength}\n`), files[path].data);
	}
	return sha256Hex(new Uint8Array(await new Blob(parts).arrayBuffer()));
}

// Installs one module the extension brings itself, unless its package from this version of the
// extension is already stored (the fingerprint of the record and of the stored files) — so also
// after an update, after a restored backup (it has only chrome.storage.local, not the files) and
// over an older upload of a module with the same name. Throws when it cannot be installed.
/** @type {Functions.Base.ensureBundledSandboxModule} */
async function ensureBundledSandboxModule(name, inspect) {
	const content = await readBundledSandboxPackage(name);
	const hash = await hashSandboxFiles(content.files);
	const store = await readSandboxModules();
	const record = store[name];
	if (isPlainObject(record) && record.bundled === true && record.hash === hash && (await readSandboxPackage(name))?.hash === hash) return;
	/** @type {Types.SandboxInstallResult} */
	const result = { ok: false, name, errors: [], warnings: [], updated: false, added: false };
	const size = Object.values(content.files).reduce((sum, file) => sum + file.data.byteLength, 0);
	await installSandboxContent(content, { fileName: `${BUNDLED_SANDBOX_DIR}/${name}/`, size, hash, bundled: true }, store, inspect, result);
	if (!result.ok) throw new Error(result.errors.join("\n"));
}

// Installs the modules the extension brings itself (BUNDLED_SANDBOX_MODULES) the module list
// paths refers to, where needed (ensureBundledSandboxModule()) — once per browser session
// (BUNDLED_SANDBOX_CHECKED_KEY). Called by loadSandboxModules() before the uploaded modules are
// registered — it needs a page with a document (the module is evaluated in a hidden sandbox).
// Pages opened at the same time take turns (Web Locks), so the module is installed once. An
// error is only logged: the module then reports that it is not stored, the others are not
// affected, and the next page tries again. options.inspect as for installSandboxModule().
/** @type {Functions.Base.ensureBundledSandboxModules} */
export async function ensureBundledSandboxModules(paths, { inspect = inspectSandboxModule } = {}) {
	const session = chrome.storage.session;
	/** @type {Record<string, boolean>} */
	let checked = {};
	try {
		const stored = session ? (await session.get(BUNDLED_SANDBOX_CHECKED_KEY))[BUNDLED_SANDBOX_CHECKED_KEY] : null;
		if (isPlainObject(stored)) checked = /** @type {Record<string, boolean>} */ (stored);
	} catch {
		// Without chrome.storage.session every page checks the files.
	}
	const names = [...new Set(paths.filter(isSandboxModuleEntry).map((path) => getModuleKey(path)))].filter(
		(name) => Object.hasOwn(BUNDLED_SANDBOX_MODULES, name) && checked[name] !== true
	);
	if (names.length === 0) return;
	const run = async () => {
		for (const name of names) {
			try {
				await ensureBundledSandboxModule(name, inspect);
				checked = { ...checked, [name]: true };
			} catch (err) {
				console.error(`Modul "${name}", který přináší rozšíření, nejde nainstalovat:`, err);
			}
		}
		try {
			await session?.set({ [BUNDLED_SANDBOX_CHECKED_KEY]: checked });
		} catch {
			// Only the next page checks the files again.
		}
	};
	const locks = globalThis.navigator?.locks;
	if (locks) {
		await locks.request("bundledSandboxModules", run);
	} else {
		await run();
	}
}

// The module list entry of a renamed module (RENAMED_MODULES) as the entry of the module that
// replaced it — the instance id stays; other entries as they are.
/** @type {Functions.Base.renamedModuleEntry} */
function renamedModuleEntry(entry) {
	if (typeof entry !== "string" || isSandboxModuleEntry(entry)) return entry;
	const { name, instance } = parseModuleEntry(entry);
	if (!Object.hasOwn(RENAMED_MODULES, name)) return entry;
	return instance ? `${RENAMED_MODULES[name]}${MODULE_INSTANCE_SEPARATOR}${instance}` : RENAMED_MODULES[name];
}

// Moves the stored module list and the settings of renamed modules (RENAMED_MODULES) over to the
// modules that replaced them: the dividers of contentDivider keep their place in the list, their
// heading, their HTML and their output settings as contentDividerSandbox, the main buttons theirs as
// mainButtonsSandbox, the overview of the floating window as floatingWindowOverviewSandbox, the ad
// blocker its lists and the domains on which it does not block as adBlockerSandbox, the YouTube
// ad blocker its lists and injection method as youtubeAdBlockerSandbox, the details of the page's
// domain their place and output settings as domainDetailsSandbox, the usage of the storages theirs as
// storageInfoSandbox. A value the new module
// already has stays; an entry that would be there twice is there once. Only a list that differs
// from modules.json is stored (see saveModulesJson()) — modules.json already has the new entries.
// Called by background.js after the extension is installed and updated and by
// api.backup.importAll() after a restore (a backup from an older version).
/** @type {Functions.Base.migrateRenamedModules} */
export async function migrateRenamedModules() {
	const controller = new BaseController();
	const stored = /** @type {Types.StorageLocal} */ (await chrome.storage.local.get(MODULES_JSON_KEY))[MODULES_JSON_KEY];
	if (typeof stored === "string") {
		/** @type {unknown} */
		let paths = null;
		try {
			paths = JSON.parse(stored);
		} catch {
			// An unreadable list stays as it is — Settings shows the error.
		}
		if (Array.isArray(paths)) {
			const migrated = [...new Set(paths.map((path) => renamedModuleEntry(path)))];
			if (migrated.length !== paths.length || migrated.some((entry, index) => entry !== paths[index])) {
				await controller.saveModulesJson(JSON.stringify(migrated, null, 2));
			}
		}
	}

	const settings = await controller.loadSettings();
	const next = { ...settings };
	let changed = false;
	for (const [oldName, entry] of Object.entries(RENAMED_MODULES)) {
		const newName = getModuleKey(entry);
		for (const key of Object.keys(settings)) {
			if (!isModuleSettingsKey(oldName, key)) continue;
			const target = newName + key.slice(oldName.length);
			if (next[target] === undefined) next[target] = settings[key];
			delete next[key];
			changed = true;
		}
	}
	if (changed) await controller.saveSettings(next);
}

// Settings that became shared (SettingField.shared): a value a module stored under its own key moves to the shared key,
// unless that one has a value already (the first in the order below wins). Called after migrateRenamedModules() — by
// background.js after the extension is installed and updated and by api.backup.importAll() after a restore.
/** @type {Readonly<Record<string, string>>} */
const MOVED_SHARED_SETTINGS = Object.freeze(
	Object.fromEntries([
	])
);

/** @type {Functions.Base.migrateSharedSettings} */
export async function migrateSharedSettings() {
	const controller = new BaseController();
	const settings = await controller.loadSettings();
	const next = { ...settings };
	let changed = false;
	for (const [from, to] of Object.entries(MOVED_SHARED_SETTINGS)) {
		if (!Object.hasOwn(settings, from)) continue;
		if (next[to] === undefined) next[to] = settings[from];
		delete next[from];
		changed = true;
	}
	if (changed) await controller.saveSettings(next);
}

// Removes an uploaded module: its files, its entries in the module list (including
// instances), its settings, the user's decisions about its functions outside the sandbox and
// their record. Its api.state and api.data records stay — the same as for a module removed from
// the list; uploading it again continues with them. A module the extension brings itself is not
// removed (the next page would install it again).
/** @type {Functions.Base.removeSandboxModule} */
export async function removeSandboxModule(name) {
	if (Object.hasOwn(BUNDLED_SANDBOX_MODULES, name)) return false;
	if (!Object.hasOwn(await readSandboxModules(), name)) return false;
	await withSandboxLock("sandboxModules", async () => {
		const { [name]: _removed, ...rest } = await readSandboxModules();
		await chrome.storage.local.set({ [SANDBOX_MODULES_KEY]: rest });
	});
	await deleteSandboxPackage(name);
	await pruneSandboxCapabilityGrants(name, null);
	await clearSandboxCapabilityLog(name);

	const controller = new BaseController();
	try {
		const paths = JSON.parse(await controller.getModulesJson());
		if (Array.isArray(paths)) {
			const kept = paths.filter((path) => !(isSandboxModuleEntry(path) && getModuleKey(path) === name));
			if (kept.length !== paths.length) await controller.saveModulesJson(JSON.stringify(kept, null, 2));
		}
	} catch (err) {
		console.error("Nahraný modul nejde odebrat ze seznamu modulů:", err);
	}

	const settings = await controller.loadSettings();
	const ownKeys = Object.keys(settings).filter((key) => isModuleSettingsKey(name, key));
	if (ownKeys.length > 0) {
		const next = { ...settings };
		for (const key of ownKeys) delete next[key];
		await controller.saveSettings(next);
	}

	const registry = globalThis.__extensionModules || [];
	const index = registry.findIndex((m) => m.name === name && m.sandbox);
	if (index !== -1) registry.splice(index, 1);
	return true;
}

// The look of the page for the sandbox: color-scheme and the values of all CSS variables
// defined for :root in the page's styles (theme-light/dark.css, mvp.css) — computed,
// so they reflect the look chosen in styleSwitch as well as the system one.
/** @type {Functions.Base.collectSandboxTheme} */
export function collectSandboxTheme(doc = document) {
	/** @type {Set<string>} */
	const names = new Set();
	/** @type {Functions.Base.collectSandboxTheme.walk} */
	const walk = (rules) => {
		for (const rule of rules) {
			if (rule instanceof CSSStyleRule) {
				if (!/:root\b/.test(rule.selectorText)) continue;
				for (let i = 0; i < rule.style.length; i++) {
					const property = rule.style[i];
					if (property.startsWith("--")) names.add(property);
				}
			} else if (rule instanceof CSSGroupingRule) {
				// @media (the dark look), @supports, @layer
				walk(rule.cssRules);
			}
		}
	};
	for (const sheet of doc.styleSheets) {
		try {
			walk(sheet.cssRules);
		} catch {
			// A stylesheet whose rules cannot be read — the extension pages have none.
		}
	}
	const computed = getComputedStyle(doc.documentElement);
	/** @type {Record<string, string>} */
	const variables = {};
	for (const name of names) {
		const value = computed.getPropertyValue(name).trim();
		if (value) variables[name] = value;
	}
	return { colorScheme: computed.getPropertyValue("color-scheme").trim() || "normal", variables };
}

// How long api.ui.scrollIntoView() keeps scrolling to the output of the module while the page is not long enough yet (the
// frame of the module gets its height a moment after its content, the other modules load too).
export const SANDBOX_SCROLL_FOLLOW_MS = 3000;
// The largest offset of api.ui.scrollIntoView({ offset }) — px from the top of the module's frame.
const SANDBOX_SCROLL_MAX_OFFSET = 10000000;

// The element of an uploaded module on an extension page — it has the place, the frame and the
// settings of a module (BaseController renders it like any other), its content is the
// <iframe> with the sandbox page in which the module code runs. It serves the module's
// requests through its own this.api (BaseElement.init() — createModuleApi() under the module
// name), sends it the look of the page and draws the buttons the module asks for (api.buttons)
// in a bar before the frame — a click on one runs its function outside the sandbox right in the
// handler of the click —, and the content it describes as data (api.ui) instead of the frame.
/** @implements {Classes.SandboxModuleElement} */
export class SandboxModuleElement extends /** @type {Types.WithFields<typeof BaseElement, Classes.SandboxModuleElement.Fields>} */ (BaseElement) {
	constructor() {
		super();
		/** @type {Classes.SandboxModuleElement['_frame']} */
		this._frame = null;
		/** @type {Classes.SandboxModuleElement['_token']} */
		this._token = "";
		/** @type {Classes.SandboxModuleElement['_package']} */
		this._package = null;
		/** @type {Classes.SandboxModuleElement['_moduleDef']} */
		this._moduleDef = null;
		/** @type {Classes.SandboxModuleElement['_started']} */
		this._started = false;
		/** @type {Classes.SandboxModuleElement['_subscriptions']} */
		this._subscriptions = new Map();
		/** @type {Classes.SandboxModuleElement['_cleanups']} */
		this._cleanups = [];
		/** @type {Classes.SandboxModuleElement['_onMessage']} */
		this._onMessage = (event) => this._handleMessage(event);
		/** @type {Classes.SandboxModuleElement['_host']} */
		this._host = null;
		/** @type {Classes.SandboxModuleElement['_grants']} */
		this._grants = {};
		/** @type {Classes.SandboxModuleElement['_buttonBar']} */
		this._buttonBar = null;
		/** @type {Classes.SandboxModuleElement['_buttons']} */
		this._buttons = new Map();
		/** @type {Classes.SandboxModuleElement['_buttonListeners']} */
		this._buttonListeners = new Set();
		/** @type {Classes.SandboxModuleElement['_ui']} */
		this._ui = null;
		/** @type {Classes.SandboxModuleElement['_uiKey']} */
		this._uiKey = null;
		/** @type {Classes.SandboxModuleElement['_uiControls']} */
		this._uiControls = new Map();
		/** @type {Classes.SandboxModuleElement['_uiListeners']} */
		this._uiListeners = new Set();
		/** @type {Classes.SandboxModuleElement['_stopScrollFollow']} */
		this._stopScrollFollow = null;
	}

	/**
	 * @override
	 * @type {Classes.SandboxModuleElement['connectedCallback']}
	 */
	connectedCallback() {
		this.classList.add("sandbox-module");
	}

	/**
	 * @override
	 * @type {Classes.SandboxModuleElement['disconnectedCallback']}
	 */
	disconnectedCallback() {
		super.disconnectedCallback();
		this._stop();
	}

	/**
	 * @override
	 * @type {Classes.SandboxModuleElement['init']}
	 */
	async init(options) {
		await super.init(options);
		const name = options.name;
		this._moduleDef = (globalThis.__extensionModules || []).find((m) => m.name === name && m.sandbox) || null;
		const client = this._moduleDef?.sandbox?.client ?? null;
		const record = client ? (await readExtensionServiceClients())[client]?.installed?.[name] : (await readSandboxModules())[name];
		const pkg = isPlainObject(record) ? (client ? await readClientSandboxPackage(client, name) : await readSandboxPackage(name)) : null;
		// The package of another version than the registered one (uploaded again in the meantime,
		// or its files are gone) — the module is not run with the wrong files.
		if (!this._moduleDef || !pkg || pkg.hash !== record.hash || pkg.hash !== this._moduleDef.sandbox?.hash) {
			this._showProblems([t("core_sandbox_missing", name)]);
			return;
		}
		// Detached in the meantime (the side panel re-evaluates the modules after a tab change).
		if (!this.isConnected) return;

		this._package = pkg;
		this._token = createSandboxToken();
		const location = this._location;
		this._host = {
			location,
			setButtons: (buttons, options) => this._setButtons(buttons, options),
			onButtonClick: (emit) => this._onButtonClick(emit),
			renderUi: (content) => this._renderUi(content),
			onUiEvent: (emit) => this._onUiEvent(emit),
			scrollIntoView: (offset) => this._scrollIntoView(offset),
		};
		const frame = createSandboxFrame(this._token);
		frame.className = "sandbox-module-frame";
		frame.title = formatModuleName(name);
		let loads = 0;
		frame.addEventListener("load", () => {
			// A second page in the frame = the frame was navigated elsewhere — the new page
			// gets no answers (the token protects them too), the module stops.
			if (++loads > 1) this._showProblems([t("core_sandbox_left_page")]);
		});
		this._frame = frame;
		const bar = document.createElement("div");
		bar.className = "sandbox-module-controls";
		bar.hidden = true;
		this._buttonBar = bar;
		// module-output: the box of a module output on every surface (popup.css, sidebar.css, …) — the
		// same as the module's own element has in its frame.
		const ui = document.createElement("div");
		ui.className = "sandbox-ui module-output";
		ui.hidden = true;
		// The pointer or the focus came to the drawn content — the module may bring it up to date before a click (the
		// frame, hidden, gets no such events).
		const enter = () => {
			for (const emit of [...this._uiListeners]) emit({ type: "enter" });
		};
		ui.addEventListener("pointerenter", enter);
		ui.addEventListener("focusin", (event) => {
			if (!(event.relatedTarget instanceof Node && ui.contains(event.relatedTarget))) enter();
		});
		this._ui = ui;
		window.addEventListener("message", this._onMessage);
		this._watchTheme();
		this._watchGrants();
		this.replaceChildren(bar, ui, frame);
	}

	// A click on a drawn button decides synchronously (an await would lose the click in Firefox) —
	// with the user's decisions read ahead and kept current.
	/** @type {Classes.SandboxModuleElement['_watchGrants']} */
	_watchGrants() {
		let changed = false;
		/** @type {Types.StorageChangeListener} */
		const listener = (changes, area) => {
			if (area !== "local" || !changes[SANDBOX_CAPABILITY_GRANTS_KEY]) return;
			changed = true;
			const value = changes[SANDBOX_CAPABILITY_GRANTS_KEY].newValue;
			this._grants = isPlainObject(value) ? /** @type {Types.SandboxCapabilityGrants} */ (value) : {};
		};
		chrome.storage.onChanged.addListener(listener);
		this._cleanups.push(() => chrome.storage.onChanged.removeListener(listener));
		readSandboxCapabilityGrants().then((grants) => {
			if (!changed) this._grants = grants;
		});
	}

	// The buttons of the module (api.buttons.set()) — a button with the same id stays the same element,
	// so a new label (a message after a click) keeps the focus on it.
	/** @type {Classes.SandboxModuleElement['_setButtons']} */
	_setButtons(input, options) {
		const bar = this._buttonBar;
		const moduleDef = this._moduleDef;
		if (!bar || !moduleDef) return;
		if (options !== undefined && options !== null && !isPlainObject(options)) throw new Error(t("core_sandbox_buttons_invalid", "options"));
		const align = isPlainObject(options) && options.align !== undefined ? options.align : "start";
		if (align !== "start" && align !== "end") throw new Error(t("core_sandbox_buttons_invalid", "options.align"));
		const buttons = normalizeSandboxButtons(input, sandboxCapabilityHolder(moduleDef).capabilities);
		/** @type {Classes.SandboxModuleElement['_buttons']} */
		const next = new Map();
		for (const button of buttons) {
			let element = this._buttons.get(button.id)?.element;
			if (!element) {
				element = document.createElement("button");
				element.type = "button";
				element.className = "sandbox-module-button";
				const id = button.id;
				element.addEventListener("click", () => this._clickButton(id));
			}
			element.textContent = button.label;
			if (button.title) {
				element.title = button.title;
			} else {
				element.removeAttribute("title");
			}
			element.disabled = button.disabled;
			next.set(button.id, { element, button });
		}
		this._buttons = next;
		const elements = [...next.values()].map((entry) => entry.element);
		if (elements.length !== bar.children.length || elements.some((element, index) => bar.children[index] !== element)) {
			bar.replaceChildren(...elements);
		}
		bar.classList.toggle("sandbox-module-controls--end", align === "end");
		bar.hidden = elements.length === 0;
	}

	/** @type {Classes.SandboxModuleElement['_onButtonClick']} */
	_onButtonClick(emit) {
		this._buttonListeners.add(emit);
		return () => {
			this._buttonListeners.delete(emit);
		};
	}

	/** @type {Classes.SandboxModuleElement['_clickButton']} */
	_clickButton(id) {
		const entry = this._buttons.get(id);
		if (!entry || entry.button.disabled) return;
		this._runClick(id, entry.button.capability, entry.button.args);
	}

	// A click on a button of the core (api.buttons, or a button of the drawn content with a function): the same three
	// rules as for a request (the catalog, the declaration, the user's decision), checked synchronously; the function
	// then runs within this click (runSandboxCapability()). The module learns the result from its onClick listeners.
	/** @type {Classes.SandboxModuleElement['_runClick']} */
	_runClick(id, capability, args) {
		const moduleDef = this._moduleDef;
		if (!moduleDef) return;
		/** @type {(click: Types.SandboxButtonClick) => void} */
		const report = (click) => {
			for (const emit of [...this._buttonListeners]) emit(click);
		};
		const context = sandboxCapabilityContext(this.api, this._host, moduleDef);
		const state = sandboxCapabilityState(sandboxCapabilityHolder(moduleDef), capability, this._grants, context);
		if (state !== "allowed") {
			report({ id, capability, ok: false, error: refuseSandboxCapability(moduleDef.name, capability, state).message });
			return;
		}
		runSandboxCapability(moduleDef.name, capability, [...args], context).then(
			(value) => report({ id, capability, ok: true, value }),
			(err) => report({ id, capability, ok: false, error: err instanceof Error && err.name === "Error" ? err.message : describeError(err) })
		);
	}

	// The content the module asks the core to draw (api.ui.render()) — in the page itself, in its look,
	// instead of the frame: the frame stays running (the module code, its listeners), only hidden. The
	// same content does nothing; a new one is drawn again — the user's open details and the focused
	// control stay with the same id. null removes it and shows the frame again.
	/** @type {Classes.SandboxModuleElement['_renderUi']} */
	_renderUi(input) {
		const container = this._ui;
		const frame = this._frame;
		if (!container || !frame) return;
		const nodes = normalizeSandboxUi(input, this._moduleDef ? sandboxCapabilityHolder(this._moduleDef).capabilities : []);
		const key = nodes === null ? null : JSON.stringify(nodes);
		if (key === this._uiKey) return;
		this._uiKey = key;
		const previous = this._uiControls;
		const active = typeof document !== "undefined" ? document.activeElement : null;
		const focused = [...previous].find(([, control]) => control === active)?.[0];
		if (nodes === null) {
			this._uiControls = new Map();
			container.replaceChildren();
			container.hidden = true;
			frame.classList.remove("sandbox-module-frame--hidden");
			return;
		}
		const { fragment, controls } = renderSandboxUi(document, nodes, {
			emit: (event) => {
				for (const emit of [...this._uiListeners]) emit(event);
			},
			wasOpen: (id) => {
				const control = /** @type {HTMLDetailsElement | undefined} */ (previous.get(id));
				return control && control.localName === "details" ? control.open : undefined;
			},
			run: (id, capability, args) => this._runClick(id, capability, args),
		});
		this._uiControls = controls;
		container.replaceChildren(fragment);
		container.hidden = false;
		frame.classList.add("sandbox-module-frame--hidden");
		if (focused !== undefined) controls.get(focused)?.focus();
	}

	/** @type {Classes.SandboxModuleElement['_onUiEvent']} */
	_onUiEvent(emit) {
		this._uiListeners.add(emit);
		return () => {
			this._uiListeners.delete(emit);
		};
	}

	// api.ui.scrollIntoView(): the output of the module (its frame with the heading) at the top of the extension page — the
	// nearest scrolling box, otherwise the page itself with window.scrollTo(); with offset the place that many px below the top
	// of the module's frame instead (a line of its list). Not Element.scrollIntoView(): the floating window
	// is a frame in a web page, and that would scroll the web page too. The page keeps changing a moment after (the frame of the
	// module gets its height after its content, the modules above load and grow — the browser's scroll anchoring did not hold the
	// output in Firefox 157), so it scrolls again whenever the page or the output changes size — for SANDBOX_SCROLL_FOLLOW_MS,
	// until the user scrolls, presses a key or clicks.
	/** @type {Classes.SandboxModuleElement['_scrollIntoView']} */
	_scrollIntoView(offset = null) {
		this._stopScrollFollow?.();
		if (!this.isConnected) return;
		const target = this.closest(".module-frame") ?? this;
		const frame = this._frame;
		const top = () => (offset !== null && frame ? frame.getBoundingClientRect().top + offset : target.getBoundingClientRect().top);
		/** @type {Element | null} */
		let box = null;
		for (let parent = target.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
			const overflow = getComputedStyle(parent).overflowY;
			if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) {
				box = parent;
				break;
			}
		}
		const scroller = box;
		const scroll = () => {
			if (scroller) scroller.scrollTo({ top: scroller.scrollTop + top() - scroller.getBoundingClientRect().top, behavior: "instant" });
			else window.scrollTo({ top: window.scrollY + top(), behavior: "instant" });
		};
		scroll();
		const events = ["wheel", "touchstart", "keydown", "pointerdown"];
		const observer = new ResizeObserver(scroll);
		const stop = () => {
			observer.disconnect();
			clearTimeout(timer);
			for (const type of events) window.removeEventListener(type, stop, true);
			this._stopScrollFollow = null;
		};
		const timer = setTimeout(stop, SANDBOX_SCROLL_FOLLOW_MS);
		for (const type of events) window.addEventListener(type, stop, { capture: true, passive: true });
		observer.observe(target);
		observer.observe(document.body);
		this._stopScrollFollow = stop;
	}

	/** @type {Classes.SandboxModuleElement['_handleMessage']} */
	_handleMessage(event) {
		if (!this._frame) return;
		const message = readSandboxMessage(event, this._frame, this._token);
		if (!message) return;
		switch (message.kind) {
			case "ready":
				if (this._started || !this._package) return;
				this._started = true;
				this._post({
					kind: "init",
					...createSandboxContext(this._package, getUiLanguage()),
					mode: this._mode,
					location: this._location,
					instance: this._instance,
					theme: collectSandboxTheme(),
				});
				break;
			case "resize":
				if (typeof message.height === "number" && Number.isFinite(message.height)) {
					const height = Math.min(Math.max(Math.ceil(message.height), 0), SANDBOX_MAX_FRAME_HEIGHT);
					this._frame.style.height = `${height}px`;
				}
				// The width the content fits in — only a page that wants to give the frame that room uses it (css/options.css
				// for the settings editors); elsewhere the frame stays as wide as its place.
				if (typeof message.width === "number" && Number.isFinite(message.width)) {
					const width = Math.min(Math.max(Math.ceil(message.width), 0), SANDBOX_MAX_FRAME_WIDTH);
					this._frame.style.setProperty("--sandbox-content-width", `${width}px`);
				}
				break;
			case "call":
				this._call(message.id, message.method, message.args);
				break;
			case "subscribe":
				this._subscribe(message.id, message.method, message.args);
				break;
			case "unsubscribe": {
				const unsubscribe = this._subscriptions.get(message.id);
				this._subscriptions.delete(message.id);
				unsubscribe?.();
				break;
			}
			case "problems":
				this._showProblems(describeSandboxProblems(message.problems));
				break;
		}
	}

	/** @type {Classes.SandboxModuleElement['_call']} */
	_call(id, method, args) {
		const moduleDef = this._moduleDef;
		if (typeof id !== "number" || !moduleDef) return;
		Promise.resolve()
			.then(() => callSandboxApi(this.api, moduleDef, method, args, this._host))
			.then(
				(value) => {
					// A result the browser cannot copy into the sandbox (a function, a DOM node, …).
					if (!this._post({ kind: "result", id, ok: true, value })) {
						this._post({ kind: "result", id, ok: false, error: t("core_sandbox_result_not_cloneable", String(method)) });
					}
				},
				(err) => {
					// A plain Error (a refused function outside the sandbox, a checked argument) as its text
					// only — the module shows it to the user; other errors with their name (TypeError: …).
					const error = err instanceof Error && err.name === "Error" ? err.message : describeError(err);
					this._post({ kind: "result", id, ok: false, error });
				}
			);
	}

	/** @type {Classes.SandboxModuleElement['_subscribe']} */
	_subscribe(id, method, args) {
		const moduleDef = this._moduleDef;
		if (typeof id !== "number" || this._subscriptions.has(id) || !moduleDef) return;
		/** @type {(err: unknown) => void} */
		const deny = (err) => {
			// As for a call: a refused function outside the sandbox as its text only.
			this._post({ kind: "denied", id, error: err instanceof Error && err.name === "Error" ? err.message : describeError(err) });
		};
		/** @type {ReturnType<Functions.Base.subscribeSandboxApi>} */
		let subscribed;
		try {
			subscribed = subscribeSandboxApi(
				this.api,
				moduleDef,
				method,
				args,
				(value) => {
					this._post({ kind: "event", id, value });
				},
				this._host
			);
		} catch (err) {
			deny(err);
			return;
		}
		if (typeof subscribed === "function") {
			this._subscriptions.set(id, subscribed);
			return;
		}
		// A listener of the catalog — the core decides after it reads the user's decisions. Unsubscribed
		// in the meantime (or the element detached): it stops as soon as it starts.
		let cancelled = false;
		this._subscriptions.set(id, () => {
			cancelled = true;
		});
		subscribed.then(
			(unsubscribe) => {
				if (cancelled) {
					unsubscribe();
				} else {
					this._subscriptions.set(id, unsubscribe);
				}
			},
			(err) => {
				if (cancelled) return;
				this._subscriptions.delete(id);
				deny(err);
			}
		);
	}

	/** @type {Classes.SandboxModuleElement['_post']} */
	_post(message) {
		return postToSandbox(this._frame, message);
	}

	// The page look in the sandbox follows the page: a change of the styles (styleSwitch
	// switches the <link> elements in <head>, a module adds its own) and of the system look.
	/** @type {Classes.SandboxModuleElement['_watchTheme']} */
	_watchTheme() {
		/** @type {number | null} */
		let scheduled = null;
		const send = () => {
			if (scheduled !== null) return;
			scheduled = requestAnimationFrame(() => {
				scheduled = null;
				if (this._started) this._post({ kind: "theme", theme: collectSandboxTheme() });
			});
		};
		const observer = new MutationObserver(send);
		observer.observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "media", "rel", "href"] });
		const media = matchMedia("(prefers-color-scheme: dark)");
		media.addEventListener("change", send);
		// A stylesheet applies only after it loads (load does not bubble — capture).
		document.head.addEventListener("load", send, true);
		this._cleanups.push(
			() => observer.disconnect(),
			() => media.removeEventListener("change", send),
			() => document.head.removeEventListener("load", send, true),
			() => {
				if (scheduled !== null) cancelAnimationFrame(scheduled);
			}
		);
	}

	// Stops serving the sandbox: the listeners of the module's api, the message listener, the
	// look and decision watching, the drawn buttons and content. Called when the element is detached
	// and when the module fails.
	/** @type {Classes.SandboxModuleElement['_stop']} */
	_stop() {
		window.removeEventListener("message", this._onMessage);
		for (const unsubscribe of this._subscriptions.values()) {
			try {
				unsubscribe();
			} catch (err) {
				console.error(err);
			}
		}
		this._subscriptions.clear();
		for (const cleanup of this._cleanups.splice(0)) cleanup();
		this._frame = null;
		this._buttonBar = null;
		this._buttons.clear();
		this._buttonListeners.clear();
		this._ui = null;
		this._uiKey = null;
		this._uiControls = new Map();
		this._uiListeners.clear();
		this._stopScrollFollow?.();
	}

	// The module cannot run (or stopped) — the text instead of its frame, details in the console.
	/** @type {Classes.SandboxModuleElement['_showProblems']} */
	_showProblems(texts) {
		this._stop();
		const box = document.createElement("div");
		box.className = "error sandbox-module-error";
		box.textContent = [t("core_sandbox_module_failed", formatModuleName(this._name)), ...texts].join("\n");
		this.replaceChildren(box);
		console.error(`Nahraný modul "${this._name}":\n${texts.join("\n")}`);
	}
}

// --------------------------------------------------------------------
// createFloatingWindow — a reusable factory for a floating panel
// injectable into any page (see content-scripts/floating-window.js).
//
// Intentionally NOT a custom element (unlike BaseElement and the modules, which
// build it through customElements.define). In Firefox, document.createElement()
// for a tag registered by a custom element whose constructor lives in a module
// dynamically imported INSIDE a content script (exactly our case —
// import(chrome.runtime.getURL("base.mjs"))) fails with:
//   "NotSupportedError: Refusing to execute function from global in which
//   script is disabled"
// Firefox sees such a constructor as belonging to a different/restricted realm
// than the one document.createElement() expects for custom tags — it is a known
// limitation of dynamic import in content scripts, not a bug in the code.
// A plain factory function returning a plain <div> (with its own Shadow DOM —
// attachShadow() works on a <div> exactly the same as on a custom element)
// does not go through this limitation at all, because it needs no registration or upgrade
// through CustomElementRegistry.
//
// No <style> element: pages with a CSP like "style-src 'self'" (without
// 'unsafe-inline') also block <style> tags inserted by a content script into the
// Shadow DOM — style-src-elem applies to them regardless of them being
// extension content, not page content. Setting CSSOM properties directly
// (element.style.property = ...), on the other hand, is not subject to CSP — it is not
// parsed CSS text, so it does not fall under style-src-elem/attr. That is why
// every style here is set this way, not through <style>/class selectors.
// --------------------------------------------------------------------
/** @type {Functions.Base.createFloatingWindow} */
export function createFloatingWindow({
	title = "",
	top = "80px",
	left = "80px",
	width = "280px",
	height = "auto",
	onMove,
	onResize,
	onClose,
} = {}) {
	// It gets the close() method below (win.close = close).
	const win = /** @type {Types.FloatingWindowElement} */ (document.createElement("div"));
	const shadow = win.attachShadow({ mode: "open" });

	Object.assign(win.style, {
		position: "fixed",
		zIndex: "2147483647",
		top,
		left,
		width,
		height,
		display: "flex",
		flexDirection: "column",
		background: "#ffffff",
		border: "1px solid #ccc",
		borderRadius: "6px",
		boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
		fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		fontSize: "13px",
		color: "#202124",
		overflow: "hidden",
	});

	const headerEl = document.createElement("div");
	headerEl.setAttribute("part", "header");
	Object.assign(headerEl.style, {
		display: "flex",
		flexShrink: "0",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "8px",
		padding: "8px 10px",
		background: "#4285f4",
		color: "#ffffff",
		cursor: "move",
		userSelect: "none",
	});

	const titleEl = document.createElement("span");
	titleEl.setAttribute("part", "title");
	titleEl.textContent = title;
	Object.assign(titleEl.style, {
		flex: "1",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
	});

	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.setAttribute("part", "close");
	closeBtn.setAttribute("aria-label", t("core_close"));
	closeBtn.title = t("core_close");
	closeBtn.textContent = "×";
	Object.assign(closeBtn.style, {
		flex: "none",
		background: "transparent",
		border: "none",
		color: "#ffffff",
		fontSize: "16px",
		lineHeight: "1",
		cursor: "pointer",
		padding: "2px 6px",
		borderRadius: "3px",
	});
	// :hover can be expressed only through <style>, which we do not use — replaced by
	// mouseenter/mouseleave setting the same CSSOM property.
	closeBtn.addEventListener("mouseenter", () => {
		closeBtn.style.background = "rgba(255, 255, 255, 0.2)";
	});
	closeBtn.addEventListener("mouseleave", () => {
		closeBtn.style.background = "transparent";
	});

	headerEl.appendChild(titleEl);
	headerEl.appendChild(closeBtn);

	const bodyEl = document.createElement("div");
	bodyEl.setAttribute("part", "body");
	Object.assign(bodyEl.style, {
		flex: "1 1 auto",
		overflow: "auto",
		padding: "10px",
	});
	bodyEl.appendChild(document.createElement("slot"));

	// A resize handle in the bottom right corner. position: absolute takes it
	// out of the flex layout (it takes no space in the header/body), it is anchored to
	// the nearest positioned ancestor, which is win (position: fixed) — the same
	// rule works across the Shadow DOM boundary the same as for ordinary
	// descendants.
	const resizeHandle = document.createElement("div");
	resizeHandle.setAttribute("part", "resize-handle");
	resizeHandle.title = t("core_resize_handle");
	Object.assign(resizeHandle.style, {
		position: "absolute",
		right: "0",
		bottom: "0",
		width: "14px",
		height: "14px",
		display: "flex",
		alignItems: "flex-end",
		justifyContent: "flex-end",
		lineHeight: "1",
		fontSize: "11px",
		color: "#999",
		cursor: "nwse-resize",
		userSelect: "none",
	});
	resizeHandle.textContent = "⇲";

	shadow.appendChild(headerEl);
	shadow.appendChild(bodyEl);
	shadow.appendChild(resizeHandle);

	let dragOffsetX = 0;
	let dragOffsetY = 0;

	/** @type {Functions.Base.createFloatingWindow.onDrag} */
	function onDrag(e) {
		win.style.left = `${e.clientX - dragOffsetX}px`;
		win.style.top = `${e.clientY - dragOffsetY}px`;
	}

	/** @type {Functions.Base.createFloatingWindow.detachDragListeners} */
	function detachDragListeners() {
		document.removeEventListener("mousemove", onDrag);
		document.removeEventListener("mouseup", stopDrag);
	}

	/** @type {Functions.Base.createFloatingWindow.stopDrag} */
	function stopDrag() {
		detachDragListeners();
		// The drag has really ended (mouseup after dragging) — reports the new
		// position, so the caller can save it (see content-scripts/floating-window.js).
		if (onMove) {
			onMove({ top: win.style.top, left: win.style.left });
		}
	}

	/** @type {Functions.Base.createFloatingWindow.startDrag} */
	function startDrag(e) {
		e.preventDefault();
		const rect = win.getBoundingClientRect();
		dragOffsetX = e.clientX - rect.left;
		dragOffsetY = e.clientY - rect.top;

		// Attached to document (not just to the header), so dragging continues
		// correctly even when the cursor leaves the panel bounds during a fast move.
		document.addEventListener("mousemove", onDrag);
		document.addEventListener("mouseup", stopDrag);
	}

	const MIN_WIDTH = 200;
	const MIN_HEIGHT = 120;

	let resizeStartX = 0;
	let resizeStartY = 0;
	let resizeStartWidth = 0;
	let resizeStartHeight = 0;

	/** @type {Functions.Base.createFloatingWindow.onResizeDrag} */
	function onResizeDrag(e) {
		const newWidth = Math.max(MIN_WIDTH, resizeStartWidth + (e.clientX - resizeStartX));
		const newHeight = Math.max(MIN_HEIGHT, resizeStartHeight + (e.clientY - resizeStartY));
		win.style.width = `${newWidth}px`;
		win.style.height = `${newHeight}px`;
	}

	/** @type {Functions.Base.createFloatingWindow.detachResizeListeners} */
	function detachResizeListeners() {
		document.removeEventListener("mousemove", onResizeDrag);
		document.removeEventListener("mouseup", stopResize);
	}

	/** @type {Functions.Base.createFloatingWindow.stopResize} */
	function stopResize() {
		detachResizeListeners();
		// The same as for stopDrag/onMove: the drag has really ended, the new
		// size is reported, so the caller can save it (see
		// content-scripts/floating-window.js).
		if (onResize) {
			onResize({ width: win.style.width, height: win.style.height });
		}
	}

	/** @type {Functions.Base.createFloatingWindow.startResize} */
	function startResize(e) {
		e.preventDefault();
		const rect = win.getBoundingClientRect();
		resizeStartX = e.clientX;
		resizeStartY = e.clientY;
		resizeStartWidth = rect.width;
		resizeStartHeight = rect.height;

		// The same as for startDrag: attached to document, so dragging continues
		// correctly even after leaving the handle bounds during a fast mouse move.
		document.addEventListener("mousemove", onResizeDrag);
		document.addEventListener("mouseup", stopResize);
	}

	/** @type {Functions.Base.createFloatingWindow.close} */
	function close() {
		// If it were closed in the middle of dragging, the listeners on document need
		// to be unregistered too — but without calling onMove/onResize (the window is
		// closing, it is not a completed drag).
		detachDragListeners();
		detachResizeListeners();
		win.remove();
		if (onClose) {
			onClose();
		}
	}

	headerEl.addEventListener("mousedown", startDrag);
	resizeHandle.addEventListener("mousedown", startResize);
	closeBtn.addEventListener("click", close);

	// Exposed outward so the window can be closed from elsewhere than by clicking the
	// cross (e.g. by the floating window button of mainButtonsSandbox) with the same cleanup.
	win.close = close;

	return win;
}

/** @implements {Classes.BaseStorage} */
export class BaseStorage {
	constructor(dbName = DB_NAME, version = DB_VERSION, storeName = DATA_STORE) {
		this._dbName = dbName;
		this._version = version;
		this._storeName = storeName;
		this._dbPromise = this._openDatabase();
	}

	/** @type {Classes.BaseStorage['_openDatabase']} */
	_openDatabase() {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this._dbName, this._version);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = (event) => {
				// The target of the upgradeneeded event is always this database open request.
				const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
				let store;

				if (!db.objectStoreNames.contains(this._storeName)) {
					store = db.createObjectStore(this._storeName, {
						keyPath: "id",
						autoIncrement: true,
					});
					store.createIndex("type", "type", { unique: false });
					store.createIndex("timestamp", "timestamp", { unique: false });
					store.createIndex("tabId", "tabId", { unique: false });
				} else {
					// An existing store from version 1 (DB_VERSION) — it only needs the
					// "module" index added (see below), it already has the rest. event.target.transaction
					// is the same "versionchange" transaction we are running in right now, so
					// it can be used even for a store that createObjectStore did not create in this
					// run.
					store = /** @type {IDBTransaction} */ (/** @type {IDBOpenDBRequest} */ (event.target).transaction).objectStore(this._storeName);
				}

				// The general data service (see createModuleApi().data in this file)
				// stores records as { module, payload, ... } instead of the former
				// fixed { type: "DATA_VOLUME_UPDATE", totalBytes }. countEntries(module)
				// counts the records of one module by this index; older
				// records without the "module" field (from version 1) are logically missing
				// from such a count, but are still counted in the overall countEntries() without
				// an argument.
				if (!store.indexNames.contains("module")) {
					store.createIndex("module", "module", { unique: false });
				}

				// Version 3: pairing records of different modules from the same page visit
				// (see getDocumentKey() and findByDocument below). Older records do not have the field,
				// so they do not get into the index at all (IndexedDB skips records
				// without the indexed property) — nothing is recalculated.
				if (!store.indexNames.contains("documentKey")) {
					store.createIndex("documentKey", "documentKey", { unique: false });
				}

				// Version 4: a module's records from pages of one domain (see
				// getDomainKey() and findByDomain below). A compound index — one module
				// (e.g. transferredDataVolume, which writes every 2 s) can have
				// many records, the index narrows the read right to its records from the domain.
				if (!store.indexNames.contains("moduleDomain")) {
					store.createIndex("moduleDomain", ["module", "domainKey"], { unique: false });
				}
				// Version 5: a module's records under its own key (see findByKey below).
				// The module chooses the key when writing, it cannot be filled in retroactively — older
				// records do not have it and do not get into the index.
				if (!store.indexNames.contains("moduleRecordKey")) {
					store.createIndex("moduleRecordKey", ["module", "recordKey"], { unique: false });
				}
				// Unlike documentKey, domainKey can be filled in retroactively: older
				// records have the stored url of the page they came from (sender.tab.url,
				// see background.js), and the key is computed from it the same way as for new ones.
				if (event.oldVersion > 0 && event.oldVersion < 4) {
					const cursorRequest = store.openCursor();
					cursorRequest.onsuccess = () => {
						const cursor = cursorRequest.result;
						if (!cursor) return;
						const record = cursor.value;
						if (record.domainKey === undefined) {
							const domainKey = getDomainKey(record.url);
							if (domainKey) cursor.update({ ...record, domainKey });
						}
						cursor.continue();
					};
				}
			};
		});
	}

	/** @type {Classes.BaseStorage['logData']} */
	async logData(data) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readwrite");
		const store = tx.objectStore(this._storeName);
		return new Promise((resolve, reject) => {
			const request = store.add({ ...data, timestamp: Date.now() });
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	// The last "limit" records of one module from one tab (without tabId from
	// all tabs), newest first. A cursor of the "module" index in the "prev" direction
	// goes, for an equal key, by the primary key (the auto-increment id) descending,
	// i.e. from the newest write — it is enough to filter tabId and stop after
	// "limit" matches, without reading the whole module into memory. With "since" only records
	// written from that time on (see BROWSER_SESSION_START_KEY) — the cursor still goes on past older
	// ones: a record restored from a backup has a new id but its original time.
	/** @type {Classes.BaseStorage['listEntries']} */
	async listEntries({ module, tabId, limit, since }) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readonly");
		const store = tx.objectStore(this._storeName);
		/** @type {Types.DataEntry[]} */
		const entries = [];
		return new Promise((resolve, reject) => {
			if (!(limit > 0)) {
				resolve(entries);
				return;
			}
			const request = store.index("module").openCursor(IDBKeyRange.only(module), "prev");
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) {
					resolve(entries);
					return;
				}
				const { id, payload, url, timestamp, documentKey } = cursor.value;
				if ((tabId === undefined || cursor.value.tabId === tabId) && (since === undefined || timestamp >= since)) {
					entries.push({ id, payload, tabId: cursor.value.tabId, url, timestamp, documentKey: documentKey ?? null });
					if (entries.length >= limit) {
						resolve(entries);
						return;
					}
				}
				cursor.continue();
			};
			request.onerror = () => reject(request.error);
		});
	}

	// A shallow merge of "patch" into the payload of one record (see
	// api.data.update()) — only when the record belongs to the given module and its payload
	// is an object (otherwise the merge would destroy the original data). The read and the write
	// happen in one transaction, a concurrent edit of another field cannot squeeze in
	// between them. Returns true when the record changed.
	/** @type {Classes.BaseStorage['updatePayload']} */
	async updatePayload({ module, id, patch }) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readwrite");
		const store = tx.objectStore(this._storeName);
		return new Promise((resolve, reject) => {
			const getRequest = store.get(id);
			getRequest.onsuccess = () => {
				/** @type {Types.DataRecord | undefined} */
				const record = getRequest.result;
				const payload = record && record.payload;
				if (!record || record.module !== module || !payload || typeof payload !== "object" || Array.isArray(payload)) {
					resolve(false);
					return;
				}
				const putRequest = store.put({ ...record, payload: { ...payload, ...patch } });
				putRequest.onsuccess = () => resolve(true);
				putRequest.onerror = () => reject(putRequest.error);
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	// Deletes one record (see api.data.remove()) — only when it belongs to the given
	// module. The read and the delete happen in one transaction. Returns true when
	// the record was deleted.
	/** @type {Classes.BaseStorage['removeEntry']} */
	async removeEntry({ module, id }) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readwrite");
		const store = tx.objectStore(this._storeName);
		return new Promise((resolve, reject) => {
			const getRequest = store.get(id);
			getRequest.onsuccess = () => {
				/** @type {Types.DataRecord | undefined} */
				const record = getRequest.result;
				if (!record || record.module !== module) {
					resolve(false);
					return;
				}
				const deleteRequest = store.delete(id);
				deleteRequest.onsuccess = () => resolve(true);
				deleteRequest.onerror = () => reject(deleteRequest.error);
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	// Records of one module from one document (documentKey + tabId, see
	// getDocumentKey()), newest first. Only a few records fall on one documentKey
	// (one page visit), so it is enough to go through the whole index.
	/** @type {Classes.BaseStorage['findByDocument']} */
	async findByDocument({ module, tabId, documentKey }) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readonly");
		const store = tx.objectStore(this._storeName);
		return new Promise((resolve, reject) => {
			const request = store.index("documentKey").getAll(IDBKeyRange.only(documentKey));
			request.onsuccess = () => {
				const entries = request.result
					.filter((r) => r.module === module && r.tabId === tabId)
					.sort((a, b) => b.id - a.id)
					.map(({ id, payload, url, timestamp }) => ({ id, payload, tabId, url, timestamp, documentKey }));
				resolve(entries);
			};
			request.onerror = () => reject(request.error);
		});
	}

	// Records of one module stored from pages of one domain (see
	// getDomainKey()), newest first; limit > 0 limits the count.
	/** @type {Classes.BaseStorage['findByDomain']} */
	async findByDomain({ module, domainKey, limit }) {
		return this._listByIndex("moduleDomain", [module, domainKey], limit);
	}

	// Records of one module stored under its own key (see
	// api.data.findByKey()), newest first; limit > 0 limits the count. The same
	// read as findByDomain() above, just through the "moduleRecordKey" index.
	/** @type {Classes.BaseStorage['findByKey']} */
	async findByKey({ module, recordKey, limit }) {
		return this._listByIndex("moduleRecordKey", [module, recordKey], limit);
	}

	// Records with an equal key of a compound index, newest first. For an equal
	// key the cursor goes by the primary key (the auto-increment id), so the "prev" direction
	// is from the newest write; limit > 0 limits the count.
	/** @type {Classes.BaseStorage['_listByIndex']} */
	async _listByIndex(indexName, indexKey, limit) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readonly");
		const store = tx.objectStore(this._storeName);
		const max = limit > 0 ? limit : Infinity;
		/** @type {Types.DataEntry[]} */
		const entries = [];
		return new Promise((resolve, reject) => {
			const request = store.index(indexName).openCursor(IDBKeyRange.only(indexKey), "prev");
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) {
					resolve(entries);
					return;
				}
				const { id, payload, tabId, url, timestamp, documentKey } = cursor.value;
				entries.push({ id, payload, tabId, url, timestamp, documentKey: documentKey ?? null });
				if (entries.length >= max) {
					resolve(entries);
					return;
				}
				cursor.continue();
			};
			request.onerror = () => reject(request.error);
		});
	}

	// A batch of one module's records for a backup (api.backup.exportModule()):
	// at most limit records with an id greater than afterId, from the oldest — the next
	// batch starts after lastId. A cursor of the "module" index goes, for an equal key, by the
	// primary key ascending, continuePrimaryKey() jumps to the start of the batch
	// without going through older records. A record in the backup has no id (on
	// import it gets a new one) nor a module name (the backup carries that).
	/** @type {Classes.BaseStorage['exportEntries']} */
	async exportEntries({ module, afterId, limit }) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readonly");
		const store = tx.objectStore(this._storeName);
		/** @type {Types.DataBackupRecord[]} */
		const records = [];
		/** @type {number | null} */
		let lastId = null;
		return new Promise((resolve, reject) => {
			const request = store.index("module").openCursor(IDBKeyRange.only(module));
			let positioned = typeof afterId !== "number";
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) {
					resolve({ records, lastId });
					return;
				}
				if (!positioned) {
					positioned = true;
					if (/** @type {number} */ (cursor.primaryKey) <= /** @type {number} */ (afterId)) {
						cursor.continuePrimaryKey(module, /** @type {number} */ (afterId) + 1);
						return;
					}
				}
				const { id, module: _module, ...record } = /** @type {Types.DataRecord} */ (cursor.value);
				records.push(record);
				lastId = id;
				if (records.length >= limit) {
					resolve({ records, lastId });
					return;
				}
				cursor.continue();
			};
			request.onerror = () => reject(request.error);
		});
	}

	// Writing a module's records from a backup (api.backup.importModule()) in one
	// transaction: with replace it first deletes all existing records of the module.
	// The records get new ids (the old ones could collide with records of other
	// modules) and keep their time and the other fields from the backup; what does not
	// match the shape is skipped (see sanitizeBackupRecord()). Returns the number of
	// written records.
	/** @type {Classes.BaseStorage['importEntries']} */
	async importEntries({ module, records, replace }) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readwrite");
		const store = tx.objectStore(this._storeName);
		const valid = (Array.isArray(records) ? records : []).map(sanitizeBackupRecord).filter((record) => record !== null);
		return new Promise((resolve, reject) => {
			const addAll = () => {
				for (const record of valid) store.add({ ...record, module });
			};
			if (replace) {
				// The keys are read in full before new records are added — a cursor
				// walked concurrently with the writes could delete the new ones too.
				const keysRequest = store.index("module").getAllKeys(IDBKeyRange.only(module));
				keysRequest.onsuccess = () => {
					for (const key of keysRequest.result) store.delete(key);
					addAll();
				};
			} else {
				addAll();
			}
			tx.oncomplete = () => resolve(valid.length);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
		});
	}

	// Without an argument it counts absolutely all records (of any module and older
	// records from before the general data service); with an argument only records
	// of the given module (by the "module" index, see _openDatabase).
	/** @type {Classes.BaseStorage['countEntries']} */
	async countEntries(module) {
		const db = await this._dbPromise;
		const tx = db.transaction(this._storeName, "readonly");
		const store = tx.objectStore(this._storeName);
		return new Promise((resolve, reject) => {
			const request = module !== undefined ? store.index("module").count(module) : store.count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
}
