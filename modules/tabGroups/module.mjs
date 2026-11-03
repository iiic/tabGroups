//@ts-check
"use strict";

// modules/tabGroups/module.mjs
// The module description without DOM (see halloWorld/module.mjs) — shared by the element
// (tabGroups.mjs), the background part (background-script.mjs) and the overview for
// tabGroupsSandbox (overview.mjs). Periods and calculations
// over days are in buckets.mjs, groups from bookmarks in bookmarkGroups.mjs,
// planning group changes in planner.mjs.
import { getTagName, NOT_DISABLED_SPEC, t } from "../../sdk.mjs";
import { BOOKMARK_GROUPS_PERMISSIONS } from "./bookmarkGroups.mjs";

export const MODULE_NAME = "tabGroups";
export const TAG = getTagName(MODULE_NAME); // "extension-tab-groups"
export const DESCRIPTION = t("tabGroups_description");

// The version of the module (registerModule({ version })) — a standalone extension built from it gets it as its
// version (scripts/build-module-*.ps1 read this line, keep its form). Raise it with a change of the module.
/** @type {Types.ModuleDescriptor['VERSION']} */
export const VERSION = "1.0.4";

// The background part keeps sorting tabs as long as the module is not disabled — no
// background/focus/popup nuance (the same as backByBackspace). The element
// (the sorting and the permissions) does not depend on the active tab.
export const ACTIVATION_SPEC = NOT_DISABLED_SPEC;
/** @type {Types.ModuleDescriptor['DEFAULT_ACTIVATION_MODE']} */
export const DEFAULT_ACTIVATION_MODE = "background";
// The element only asks for the permissions — that belongs next to the settings of the groups. The
// overview of the window's groups (tabGroupsSandbox) is in the popup.
/** @type {Types.ModuleDescriptor['DEFAULT_DISPLAY_LOCATION']} */
export const DEFAULT_DISPLAY_LOCATION = "options";

// A short status (a few lines, a button for a missing permission), it should be visible
// whole right away — a block element. No heading, the output starts with the module name.
/** @type {Types.ModuleDescriptor['DEFAULT_OUTPUT_ELEMENT']} */
export const DEFAULT_OUTPUT_ELEMENT = "block";
/** @type {Types.ModuleDescriptor['DEFAULT_SHOW_HEADING']} */
export const DEFAULT_SHOW_HEADING = false;

// The settings are edited by the element of tabGroupsSandbox in its settings block (registerModule({ settingsEditedBy }))
// — the reset of that block in Settings also puts these settings back to the defaults.
/** @type {Types.ModuleDescriptor['SETTINGS_EDITED_BY']} */
export const SETTINGS_EDITED_BY = "tabGroupsSandbox";

// The look of the overview and the settings editor (colored group chips).
/** @type {string[]} */
export const STYLES = [new URL("./tabGroups.css", import.meta.url).href];

// chrome.tabGroups (names, colors and order of groups) — without it the module does nothing.
// In Firefox it is granted without a prompt, in Chrome without a warning.
/** @type {Types.PermissionSet} */
export const TAB_GROUPS_PERMISSIONS = { permissions: ["tabGroups"] };
// chrome.alarms — moving groups exactly at midnight. Without it the new day
// shows up only with the next work with tabs. Firefox does not accept it as an optional
// permission (verified in version 156), so it is required in its manifest.
/** @type {Types.PermissionSet} */
export const ALARMS_PERMISSIONS = { permissions: ["alarms"] };
// "bookmarks" and "tabs" — groups from bookmarks (folder contents and tab addresses), see
// BOOKMARK_GROUPS_PERMISSIONS in bookmarkGroups.mjs.
export { BOOKMARK_GROUPS_PERMISSIONS };
/** @type {Types.PermissionSet[]} */
export const USES_PERMISSIONS = [TAB_GROUPS_PERMISSIONS, ALARMS_PERMISSIONS, BOOKMARK_GROUPS_PERMISSIONS];

// Group names and colors — { [period key]: { title, color, collapsed } } under
// getModuleSettingKey(MODULE_NAME, "groups"), see normalizeGroupsConfig().
export const GROUPS_KEY = "groups";
// Which day tabs are sorted into groups by: GROUP_BY_OPENED ("opened", the day
// they were opened — the default) or GROUP_BY_LAST_USED ("lastUsed", the day of last
// use), see normalizeGroupBy() in buckets.mjs.
export const GROUP_BY_KEY = "groupBy";
// May the user drag tabs between period groups (a checkbox, the default
// no)? A tab dragged into another day's group stays in it — it gets a manual
// day (MANUAL_DAYS_KEY), with which it moves on at midnight. Without the option the
// module returns it to its day's group.
export const MANUAL_MOVES_KEY = "manualMoves";
export const DEFAULT_MANUAL_MOVES = false;
// The prefix before the names of all automatic groups (text, the default
// DEFAULT_TITLE_PREFIX in buckets.mjs, empty = without a prefix). Changing the
// prefix only renames the groups — they are recognized by APPLIED_TITLES_KEY.
export const TITLE_PREFIX_KEY = "titlePrefix";
// Groups from bookmarks — an array of rows { id, title, folderId, folderTitle,
// wholeDomain, color, collapsed }, see normalizeBookmarkGroups() in bookmarkGroups.mjs.
export const BOOKMARK_GROUPS_KEY = "bookmarkGroups";

// The services of the background part (api.services, background-script.mjs) — the functions of the
// catalog of uploaded modules tabGroupsSandbox asks for: the overview of a window, "Regroup now",
// "Identify managed groups", the settings for their editor, opening the page that asks for the
// permissions, and the listener of the changes (only for a service provider — on a page of this
// extension the listener follows the events of the page itself, see base.mjs).
export const OVERVIEW_SERVICE = "tabGroups.getOverview";
export const REGROUP_SERVICE = "tabGroups.regroup";
export const IDENTIFY_SERVICE = "tabGroups.identify";
export const GET_SETTINGS_SERVICE = "tabGroups.getSettings";
export const SET_SETTINGS_SERVICE = "tabGroups.setSettings";
export const OPEN_PERMISSIONS_SERVICE = "tabGroups.openPermissions";
export const CHANGES_SERVICE = "tabGroups.onChange";

// Keys of the module's own state (api.state/api.sessionState) — written by the
// background part, the overview (overview.mjs) only reads them.
// The day of the last assignment of tabs (api.state): groups in the browser have
// periods valid as of this day — by it the opened days of restored tabs are estimated
// after a browser restart (estimateOpenedDay() in buckets.mjs).
export const REFERENCE_DAY_KEY = "referenceDay";
// The registry of the module's groups { [group id]: { key, title, day } } (api.state) —
// a group is recognized by its number as long as it has the name the module gave it (see
// groupIdentity.mjs).
export const GROUP_IDS_KEY = "groupIds";
// All names the module gave to groups [[name, target key], …] (api.state)
// — by them a group whose number the module does not know (Chrome after a browser
// restart) is recognized, even after the names, the prefix or the UI language change.
export const KNOWN_TITLES_KEY = "knownTitles";
// Names of the period groups and groups from bookmarks ({ [row id]: name }) from
// the last assignment by an older version (api.state) — read only once, when
// KNOWN_TITLES_KEY is first filled.
export const APPLIED_TITLES_KEY = "appliedTitles";
export const APPLIED_BOOKMARK_TITLES_KEY = "appliedBookmarkTitles";
// Opened days of tabs { [tab id]: day } (api.sessionState — tab ids are valid
// only until the browser restarts).
export const OPENED_DAYS_KEY = "openedDays";
// Days of last use of tabs { [tab id]: day } (api.sessionState) —
// the background part computes them in both sorting modes.
export const USED_DAYS_KEY = "usedDays";
// The group of each tab as the last pass left it { [tab id]: group
// id } (api.sessionState, only with the MANUAL_MOVES_KEY option) — a tab that
// is elsewhere on the next pass was moved without the module.
export const LAST_GROUPS_KEY = "lastGroups";
// Manual days of tabs the user dragged into another period's group { [tab
// id]: day } (api.sessionState) — they take precedence over the opened day and
// the day of last use; when sorting by last use they apply until the
// user switches to the tab again.
export const MANUAL_DAYS_KEY = "manualDays";
