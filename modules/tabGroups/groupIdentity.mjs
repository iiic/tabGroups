//@ts-check
"use strict";

// modules/tabGroups/groupIdentity.mjs
// How the module recognizes its groups in the browser — pure functions without DOM and without
// chrome.*, shared by the background part (background-script.mjs), the planner
// (planner.mjs) and the element (tabGroups.mjs).
//
// A group target has a permanent key, independent of the name and the order: "period:<period
// key>" (BUCKETS) and "bookmarks:<row id>" (groups from bookmarks). A module
// group is recognized (findOurGroups()):
//   1. by the group number — the GROUP_IDS_KEY registry { [group id]: { key,
//      title, day } }, which every pass writes (rememberGroups()).
//      It applies only as long as the group has the name the module gave it: a group the
//      user renames in the tab strip thereby becomes the user's own. Firefox keeps
//      the group's number even after a browser restart (it derives it from an internal id
//      that it stores in the session — verified in version 157), Chrome gives restored
//      groups new numbers,
//   2. by the name from Settings (periods, then groups from bookmarks),
//   3. by any name the module has ever given to groups
//      (KNOWN_TITLES_KEY, rememberTitles()) — in Chrome after a restart and after a change
//      of the prefix, the names or the UI language, even when several of them came together at once.
//      The first time the list is also filled with names the groups may have had before it was
//      introduced (earlierTitles()).
// A user's group named like a module group (even with an earlier
// name) is thus recognized as a module group.
import { BUCKETS, DEFAULT_TITLE_PREFIX } from "./buckets.mjs";

const PERIOD_KEY_PREFIX = "period:";
const BOOKMARKS_KEY_PREFIX = "bookmarks:";
// A record of a group the pass does not see (a closed window, in Firefox a saved and
// closed group) stays in the registry this many days since the last pass that
// saw it.
const GROUP_IDS_MAX_AGE_DAYS = 60;
// How many recently used names the module remembers.
const KNOWN_TITLES_MAX = 500;
// Prefixes with which groups may have been created before the list of names: none
// (the version without a prefix) and "𓃭" (the first default prefix). The current
// default one and the prefix from Settings are added to them.
const EARLIER_TITLE_PREFIXES = ["", "𓃭"];

// Target keys in the planner's order (periods, then groups from bookmarks) and their
// names from Settings (with the prefix, as the groups have them in the browser).
/** @type {Functions.TabGroups.GroupIdentity.describeTargets} */
export function describeTargets(config, bookmarkGroups) {
	return {
		keys: [...BUCKETS.map((bucket) => PERIOD_KEY_PREFIX + bucket.key), ...bookmarkGroups.map((group) => BOOKMARKS_KEY_PREFIX + group.id)],
		titles: [...config.map((item) => item.title), ...bookmarkGroups.map((group) => group.title)],
	};
}

// The module's groups → the key of their target (the order of precedence, see the introductory comment).
// The key may belong to a target that is no longer in Settings (a removed row of groups from
// bookmarks) — the group is still a module group and the tabs from it disperse elsewhere.
// Shared groups (Chrome) are always the user's groups.
/** @type {Functions.TabGroups.GroupIdentity.findOurGroups} */
export function findOurGroups(groups, { keys, titles, groupIds, knownTitles }) {
	/** @type {Map<string, string>} */
	const byCurrentTitle = new Map();
	titles.forEach((title, i) => {
		if (title && !byCurrentTitle.has(title)) byCurrentTitle.set(title, keys[i]);
	});
	const byKnownTitle = new Map(knownTitles);
	/** @type {Map<number, string>} */
	const ours = new Map();
	for (const group of groups) {
		if (group.shared) continue;
		const title = group.title || "";
		const entry = Object.hasOwn(groupIds, group.id) ? groupIds[group.id] : undefined;
		const key = entry && entry.title === title ? entry.key : title ? (byCurrentTitle.get(title) ?? byKnownTitle.get(title)) : undefined;
		if (key !== undefined) ours.set(group.id, key);
	}
	return ours;
}

// Target keys → target positions in the planner (index in keys). A target that is no longer
// in Settings gets keys.length — after all targets.
/** @type {Functions.TabGroups.GroupIdentity.toTargets} */
export function toTargets(ours, keys) {
	const indexOf = new Map(keys.map((key, i) => [key, i]));
	return new Map([...ours].map(([groupId, key]) => [groupId, indexOf.get(key) ?? keys.length]));
}

// The group registry after a pass: the module's groups (ours, from the snapshot after the changes)
// with the name they really have, and the day today. A group the pass does not see
// stays in the registry for GROUP_IDS_MAX_AGE_DAYS days; a group that is visible but
// does not belong to the module (the user renamed it) drops out.
/** @type {Functions.TabGroups.GroupIdentity.rememberGroups} */
export function rememberGroups(groupIds, groups, ours, today) {
	const present = new Set(groups.map((group) => String(group.id)));
	/** @type {Record<string, Types.TabGroups.GroupIdEntry>} */
	const next = {};
	for (const [id, entry] of Object.entries(groupIds)) {
		if (!present.has(id) && today - entry.day <= GROUP_IDS_MAX_AGE_DAYS) next[id] = entry;
	}
	for (const group of groups) {
		const key = ours.get(group.id);
		if (key !== undefined) next[group.id] = { key, title: group.title || "", day: today };
	}
	return next;
}

// The stored group registry → only valid records.
/** @type {Functions.TabGroups.GroupIdentity.readGroupIds} */
export function readGroupIds(value) {
	/** @type {Record<string, Types.TabGroups.GroupIdEntry>} */
	const groupIds = {};
	if (value && typeof value === "object" && !Array.isArray(value)) {
		for (const [id, item] of Object.entries(value)) {
			const entry = /** @type {Record<string, unknown> | null} */ (item);
			if (entry && typeof entry.key === "string" && typeof entry.title === "string" && Number.isInteger(entry.day)) {
				groupIds[id] = { key: entry.key, title: entry.title, day: /** @type {number} */ (entry.day) };
			}
		}
	}
	return groupIds;
}

/** @type {Functions.TabGroups.GroupIdentity.sameGroupIds} */
export function sameGroupIds(a, b) {
	const ids = Object.keys(a);
	return (
		ids.length === Object.keys(b).length &&
		ids.every((id) => Object.hasOwn(b, id) && a[id].key === b[id].key && a[id].title === b[id].title && a[id].day === b[id].day)
	);
}

// The stored list of names ([name, target key], the newest at the end) → valid
// pairs, or null when it is not stored yet (then earlierTitles() fills it).
/** @type {Functions.TabGroups.GroupIdentity.readKnownTitles} */
export function readKnownTitles(value) {
	if (!Array.isArray(value)) return null;
	return value.filter(
		/** @returns {item is [string, string]} */
		(item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && item[0] !== "" && typeof item[1] === "string"
	);
}

// The list of names extended with entries ([name, target key]): a new name, or
// a name that now belongs to another target, moves to the end; the oldest ones over
// KNOWN_TITLES_MAX drop out. Unchanged it returns the same list.
/** @type {Functions.TabGroups.GroupIdentity.rememberTitles} */
export function rememberTitles(knownTitles, entries) {
	let list = knownTitles;
	for (const [title, key] of entries) {
		if (!title || list.some(([known, knownKey]) => known === title && knownKey === key)) continue;
		list = [...list.filter(([known]) => known !== title), [title, key]];
	}
	return list.length > KNOWN_TITLES_MAX ? list.slice(-KNOWN_TITLES_MAX) : list;
}

// Names the module's groups may have from the time before the list of names: each
// base name of a target (baseTitles: the default period names in all UI
// languages and the name from Settings — without the prefix) without the prefix, with the earlier,
// the default and the current prefix (prefix), and the names from the last assignment by
// an older version (appliedTitles by period, appliedBookmarkTitles by row
// id — those take precedence).
/** @type {Functions.TabGroups.GroupIdentity.earlierTitles} */
export function earlierTitles({ keys, baseTitles, prefix, appliedTitles, appliedBookmarkTitles }) {
	const prefixes = [...new Set([...EARLIER_TITLE_PREFIXES, DEFAULT_TITLE_PREFIX, prefix])];
	/** @type {[string, string][]} */
	const entries = [];
	keys.forEach((key, i) => {
		for (const base of baseTitles[i] || []) {
			for (const item of prefixes) entries.push([item ? `${item} ${base}` : base, key]);
		}
	});
	appliedTitles.forEach((title, i) => {
		if (i < BUCKETS.length) entries.push([title, PERIOD_KEY_PREFIX + BUCKETS[i].key]);
	});
	for (const [id, title] of Object.entries(appliedBookmarkTitles)) {
		entries.push([title, BOOKMARKS_KEY_PREFIX + id]);
	}
	return rememberTitles([], entries);
}
