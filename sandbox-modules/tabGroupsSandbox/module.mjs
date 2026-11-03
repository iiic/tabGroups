//@ts-check
"use strict";

// sandbox-modules/tabGroupsSandbox/module.mjs
// The module description without DOM (see tabGroupsSandbox.mjs).
import { getTagName, NOT_DISABLED_SPEC, t } from "../../sdk.mjs";

export const MODULE_NAME = "tabGroupsSandbox";
export const TAG = getTagName(MODULE_NAME); // "extension-tab-groups-sandbox"

// t() reads the module's own texts — messages.json of the package (an uploaded module
// cannot add them to _locales).
export const DESCRIPTION = t("tabGroupsSandbox_description");

// The version of the module (registerModule({ version })) — a standalone extension built from it gets it as its
// version (scripts/build-module-*.ps1 read this line, keep its form). Raise it with a change of the module.
/** @type {Types.ModuleDescriptor['VERSION']} */
export const VERSION = "1.0.4";

// The overview concerns the window, not the active page — hence without WEB_PAGE_SPEC, it is
// shown even over a chrome:// page.
export const ACTIVATION_SPEC = NOT_DISABLED_SPEC;

// The overview loads when its surface opens and follows the groups while it is open. It is a
// short look at the window while browsing — the popup, where the element of tabGroups used to be.
/** @type {Types.ModuleDescriptor['DEFAULT_ACTIVATION_MODE']} */
export const DEFAULT_ACTIVATION_MODE = "popup";
/** @type {Types.ModuleDescriptor['DEFAULT_DISPLAY_LOCATION']} */
export const DEFAULT_DISPLAY_LOCATION = "popup";

// A short overview (a row of colored chips and three buttons), it should be visible whole right
// away — a block element. No heading, the output starts with the module name.
/** @type {Types.ModuleDescriptor['DEFAULT_OUTPUT_ELEMENT']} */
export const DEFAULT_OUTPUT_ELEMENT = "block";
/** @type {Types.ModuleDescriptor['DEFAULT_SHOW_HEADING']} */
export const DEFAULT_SHOW_HEADING = false;

// The colors of the groups and the chips — a file of the package, the sandbox applies it to its own
// page after mvp.css.
/** @type {string[]} */
export const STYLES = [new URL("./tabGroupsSandbox.css", import.meta.url).href];

// Without tabGroups nothing is listed — its background part sorts the tabs and its code reads the
// groups of the window (Settings shows it with both modules).
/** @type {Types.ModuleDependency[]} */
export const DEPENDS_ON = [{ module: "tabGroups", reason: t("tabGroupsSandbox_depends_tab_groups") }];

// The element also edits the settings of tabGroups — Settings renders it in the settings block of this module
// (init({ location: "settings" }), settingsView.mjs): the editors of the names, colors and groups from bookmarks
// would be code outside the sandbox as custom fields.
/** @type {Types.ModuleDescriptor['SETTINGS_VIEW']} */
export const SETTINGS_VIEW = true;

// The functions outside the sandbox the module works with (registerModule({ capabilities })) — the services of the
// background part of tabGroups (api.services): the groups of the window (tabGroups.getOverview), regrouping the tabs
// and blinking its groups (tabGroups.regroup, tabGroups.identify), its settings for the editor (tabGroups.getSettings,
// tabGroups.setSettings), opening the page where tabGroups asks for the permissions (tabGroups.openPermissions — a
// sandboxed module cannot ask for a permission) and the listener of the changes of the groups, the settings and the
// permissions (tabGroups.onChange); options.open opens Settings, where the editor of the settings is. The extension
// brings the module itself, so they are allowed until the user denies them in Settings → "Uploaded modules (sandbox)".
// When a service provider shows the module of the standalone Tab Groups extension, the functions tabGroups.* go to
// that extension.
/** @type {Types.ModuleDescriptor['CAPABILITIES']} */
export const CAPABILITIES = [
	"tabGroups.getOverview",
	"tabGroups.regroup",
	"tabGroups.identify",
	"tabGroups.getSettings",
	"tabGroups.setSettings",
	"tabGroups.openPermissions",
	"tabGroups.onChange",
	"options.open",
];
