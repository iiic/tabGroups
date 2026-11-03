//@ts-check
"use strict";

// modules/tabGroups/settings.mjs
// The settings of tabGroups for their editor in tabGroupsSandbox — no DOM. The editor runs in the
// sandbox (in Settings, in the settings block of tabGroupsSandbox), so it gets the settings as data and
// changes them one by one: the background part offers both as its services (tabGroups.getSettings and
// tabGroups.setSettings in background-script.mjs) — for a page of this extension and for the pages of a
// service provider the extension is a client of. Here the data the editor needs (the periods with their
// default names and colors, the colors, the folders of the bookmarks) and the checks of a change — the
// same normalization as the editors in Settings did (normalizeGroupsConfig(), normalizeBookmarkGroups()).
import {
	GROUPS_KEY,
	GROUP_BY_KEY,
	MANUAL_MOVES_KEY,
	DEFAULT_MANUAL_MOVES,
	TITLE_PREFIX_KEY,
	BOOKMARK_GROUPS_KEY,
	BOOKMARK_GROUPS_PERMISSIONS,
} from "./module.mjs";
import {
	BUCKETS,
	GROUP_COLORS,
	DEFAULT_GROUPS,
	DEFAULT_GROUP_BY,
	DEFAULT_TITLE_PREFIX,
	normalizeGroupBy,
	normalizeGroupsConfig,
	toStoredGroupsConfig,
} from "./buckets.mjs";
import { listBookmarkFolders, normalizeBookmarkGroups } from "./bookmarkGroups.mjs";
import { t } from "../../sdk.mjs";

// The longest prefix of the group names — the browser shows a group name in a narrow chip anyway.
export const MAX_TITLE_PREFIX_LENGTH = 32;
// The most groups from bookmarks one change stores.
export const MAX_BOOKMARK_GROUPS = 50;

// The default of each setting — { reset: true } of tabGroups.setSettings (the editor itself no longer offers it, the
// settings block in Settings resets tabGroups with tabGroupsSandbox; the service keeps it for its callers).
/** @type {Readonly<Record<Enums.TabGroups.SettingKey, unknown>>} */
const DEFAULTS = Object.freeze({
	[GROUP_BY_KEY]: DEFAULT_GROUP_BY,
	[MANUAL_MOVES_KEY]: DEFAULT_MANUAL_MOVES,
	[TITLE_PREFIX_KEY]: DEFAULT_TITLE_PREFIX,
	[GROUPS_KEY]: DEFAULT_GROUPS,
	[BOOKMARK_GROUPS_KEY]: [],
});

/** @type {Functions.TabGroups.Settings.isSettingKey} */
function isSettingKey(key) {
	return typeof key === "string" && Object.hasOwn(DEFAULTS, key);
}

// The names of the periods for the editor: a default name stays empty — it is stored as "" and thus follows
// the UI language (the editor shows it as the placeholder).
/** @type {Functions.TabGroups.Settings.groupsForEditor} */
function groupsForEditor(value) {
	const stored = toStoredGroupsConfig(normalizeGroupsConfig(value));
	for (const bucket of BUCKETS) {
		if (stored[bucket.key].title === bucket.title) stored[bucket.key].title = "";
	}
	return stored;
}

// The settings with what their editor needs (Types.TabGroups.SettingsView). The folders of the bookmarks only
// with the permission to bookmarks (null without it — the editor keeps the stored folders then).
/** @type {Functions.TabGroups.Settings.readSettingsView} */
export async function readSettingsView(api) {
	const hasBookmarks = await api.permissions.contains(BOOKMARK_GROUPS_PERMISSIONS);
	/** @type {Types.TabGroups.BookmarkFolder[] | null} */
	let folders = null;
	if (typeof chrome.bookmarks !== "undefined" && (await api.permissions.contains({ permissions: ["bookmarks"] }))) {
		try {
			folders = listBookmarkFolders(await chrome.bookmarks.getTree());
		} catch (err) {
			console.error("tabGroups: záložky nejde načíst:", err);
			folders = [];
		}
	}
	const titlePrefix = await api.settings.get(TITLE_PREFIX_KEY, DEFAULT_TITLE_PREFIX);
	return {
		values: {
			groupBy: normalizeGroupBy(await api.settings.get(GROUP_BY_KEY, DEFAULT_GROUP_BY)),
			manualMoves: (await api.settings.get(MANUAL_MOVES_KEY, DEFAULT_MANUAL_MOVES)) === true,
			titlePrefix: typeof titlePrefix === "string" ? titlePrefix : DEFAULT_TITLE_PREFIX,
			groups: groupsForEditor(await api.settings.get(GROUPS_KEY, DEFAULT_GROUPS)),
			bookmarkGroups: normalizeBookmarkGroups(await api.settings.get(BOOKMARK_GROUPS_KEY, [])),
		},
		periods: BUCKETS.map((bucket) => ({ key: bucket.key, title: bucket.title, color: bucket.color, range: bucket.range })),
		colors: GROUP_COLORS.map((color) => ({ value: color.value, label: color.label })),
		defaultTitlePrefix: DEFAULT_TITLE_PREFIX,
		folders,
		hasBookmarks,
	};
}

// The value of one setting as it is stored — the same normalization as the editors in Settings did; an
// invalid value is an error (its text goes to the editor).
/** @type {Functions.TabGroups.Settings.normalizeSetting} */
export function normalizeSetting(key, value) {
	/** @type {(ok: boolean) => void} */
	const check = (ok) => {
		if (!ok) throw new Error(t("tabGroups_settings_invalid", key));
	};
	switch (key) {
		case GROUP_BY_KEY:
			check(typeof value === "string");
			return normalizeGroupBy(value);
		case MANUAL_MOVES_KEY:
			check(typeof value === "boolean");
			return value;
		case TITLE_PREFIX_KEY:
			check(typeof value === "string" && value.trim().length <= MAX_TITLE_PREFIX_LENGTH);
			return /** @type {string} */ (value).trim();
		case GROUPS_KEY:
			check(!!value && typeof value === "object" && !Array.isArray(value));
			return groupsForEditor(value);
		case BOOKMARK_GROUPS_KEY:
			check(Array.isArray(value) && value.length <= MAX_BOOKMARK_GROUPS);
			// Empty rows (no folder and no name) are not stored — the same as the editor in Settings.
			return normalizeBookmarkGroups(value).filter((setting) => setting.folderId || setting.title);
	}
	throw new Error(t("tabGroups_settings_invalid", String(key)));
}

// One change of the editor: { key, value } — the setting stored after normalizeSetting() —, or { reset: true } —
// every setting back to its default. Returns the stored value(s).
/** @type {Functions.TabGroups.Settings.applySettingsChange} */
export async function applySettingsChange(api, change) {
	const input = change && typeof change === "object" && !Array.isArray(change) ? /** @type {Record<string, unknown>} */ (change) : null;
	if (input && input.reset === true) {
		for (const [key, value] of Object.entries(DEFAULTS)) await api.settings.set(key, value);
		return { ...DEFAULTS };
	}
	if (!input || !isSettingKey(input.key)) throw new Error(t("tabGroups_settings_invalid", String(input?.key)));
	const key = /** @type {Enums.TabGroups.SettingKey} */ (input.key);
	const value = normalizeSetting(key, input.value);
	await api.settings.set(key, value);
	return { [key]: value };
}
