//@ts-check
"use strict";

// modules/tabGroups/overview.mjs
// The overview of the automatic groups of a window for tabGroupsSandbox — no DOM. The background part
// runs readOverview() as its service tabGroups.getOverview (background-script.mjs) for the window of the
// page that shows the overview — the sandbox has no chrome.* —, also for the pages of a service provider.
// The texts (the ranges of the periods, the descriptions of the groups from bookmarks) are in the UI
// language of the background part. Which groups are the module's is decided the same way as in the
// background part (groupIdentity.mjs). watchWindowGroups() follows the tab and group events in the page
// itself (the listener tabGroups.onChange of base.mjs).
import { TAB_GROUPS_PERMISSIONS, ALARMS_PERMISSIONS, BOOKMARK_GROUPS_PERMISSIONS, GROUPS_KEY, GROUP_BY_KEY, TITLE_PREFIX_KEY, BOOKMARK_GROUPS_KEY, GROUP_IDS_KEY, KNOWN_TITLES_KEY } from "./module.mjs";
import { BUCKETS, DEFAULT_GROUPS, DEFAULT_GROUP_BY, DEFAULT_TITLE_PREFIX, normalizeGroupBy, normalizeGroupsConfig, normalizeTitlePrefix, withTitlePrefix } from "./buckets.mjs";
import { describeBookmarkGroup, normalizeBookmarkGroups, resolveBookmarkGroups } from "./bookmarkGroups.mjs";
import { TAB_GROUP_ID_NONE } from "./planner.mjs";
import { describeTargets, findOurGroups, readGroupIds, readKnownTitles, toTargets } from "./groupIdentity.mjs";

// The groups of the window (windowId; null — the page could not tell its window: no chips) with the
// state of the module: support in the browser, the permissions, the sorting and the chips. The sandbox
// cannot ask for a permission — what is missing it only lists, the element of tabGroups asks for it.
/** @type {Functions.TabGroups.Overview.readOverview} */
export async function readOverview(api, windowId) {
	const supported = !!chrome.tabs && typeof chrome.tabs.group === "function";
	const hasGroups = await api.permissions.contains(TAB_GROUPS_PERMISSIONS);
	// Only what the manifest offers as optional is missing — Firefox has "alarms" required.
	const optional = new Set(chrome.runtime.getManifest().optional_permissions || []);
	const hasAlarms = !(ALARMS_PERMISSIONS.permissions || []).some((p) => optional.has(p)) || (await api.permissions.contains(ALARMS_PERMISSIONS));
	// Names with the prefix, as the groups have them in the browser (see reconcile() in
	// background-script.mjs).
	const periods = normalizeGroupsConfig(await api.settings.get(GROUPS_KEY, DEFAULT_GROUPS));
	const titlePrefix = normalizeTitlePrefix(await api.settings.get(TITLE_PREFIX_KEY, DEFAULT_TITLE_PREFIX));
	const config = withTitlePrefix(periods, titlePrefix);
	const groupBy = normalizeGroupBy(await api.settings.get(GROUP_BY_KEY, DEFAULT_GROUP_BY));
	const bookmarkGroups = withTitlePrefix(
		resolveBookmarkGroups(
			normalizeBookmarkGroups(await api.settings.get(BOOKMARK_GROUPS_KEY, [])),
			periods.map((item) => item.title)
		),
		titlePrefix
	);
	const hasBookmarks = bookmarkGroups.length === 0 || (await api.permissions.contains(BOOKMARK_GROUPS_PERMISSIONS));
	const groups = supported && hasGroups && windowId !== null ? await readWindowGroups(api, windowId, config, bookmarkGroups) : null;
	return { supported, hasGroups, hasAlarms, hasBookmarks, groupBy, bookmarkGroups: bookmarkGroups.length, groups };
}

// Groups of the window: the automatic ones (chips in the tab strip order) and the number of the others.
// null without chrome.tabGroups or when the window is gone.
/** @type {Functions.TabGroups.Overview.readWindowGroups} */
async function readWindowGroups(api, windowId, config, bookmarkGroups) {
	if (!chrome.tabGroups) return null;
	try {
		const [tabs, groups] = await Promise.all([chrome.tabs.query({ windowId }), chrome.tabGroups.query({ windowId })]);
		// The module's groups the same as in the background part (groupIdentity.mjs).
		const targets = describeTargets(config, bookmarkGroups);
		const ours = toTargets(
			findOurGroups(
				groups.map((group) => ({ id: group.id, windowId: group.windowId, title: group.title, color: group.color, shared: group.shared === true })),
				{
					...targets,
					groupIds: readGroupIds(await api.state.get(GROUP_IDS_KEY, null)),
					knownTitles: readKnownTitles(await api.state.get(KNOWN_TITLES_KEY, null)) || [],
				}
			),
			targets.keys
		);
		/** @type {Map<number, { count: number, first: number }>} */
		const stats = new Map();
		for (const tab of tabs) {
			if (tab.groupId === TAB_GROUP_ID_NONE) continue;
			const entry = stats.get(tab.groupId) || { count: 0, first: tab.index };
			stats.set(tab.groupId, { count: entry.count + 1, first: Math.min(entry.first, tab.index) });
		}
		/** @type {Types.TabGroups.OverviewChip[]} */
		const chips = [];
		for (const group of groups) {
			const target = ours.get(group.id);
			const entry = stats.get(group.id);
			// The group of a removed row of groups from bookmarks is just being emptied by
			// the background part.
			if (target === undefined || !entry || target >= BUCKETS.length + bookmarkGroups.length) continue;
			const chip = { title: group.title || "", color: group.color, count: entry.count, first: entry.first };
			chips.push(
				target < BUCKETS.length
					? { ...chip, kind: "period", range: BUCKETS[target].range }
					: { ...chip, kind: "bookmarks", range: describeBookmarkGroup(bookmarkGroups[target - BUCKETS.length]) }
			);
		}
		chips.sort((a, b) => a.first - b.first);
		return {
			chips,
			userGroups: groups.filter((group) => !ours.has(group.id)).length,
			ungrouped: tabs.filter((tab) => !tab.pinned && tab.groupId === TAB_GROUP_ID_NONE).length,
		};
	} catch (err) {
		console.error("tabGroups: skupiny okna nejde zjistit:", err);
		return null;
	}
}

// Tab and group events of the page that change the overview (tabGroups.onChange): onChange is called
// after each of them; without chrome.tabGroups (no permission yet, the floating window) nothing is
// watched. Returns a function to unsubscribe.
/** @type {Functions.TabGroups.Overview.watchWindowGroups} */
export function watchWindowGroups(onChange) {
	if (!chrome.tabGroups || !chrome.tabs) return () => {};
	const changed = () => onChange();
	/** @type {Functions.TabGroups.Overview.onTabUpdated} */
	const onTabUpdated = (_tabId, changeInfo) => {
		if ("groupId" in changeInfo || "pinned" in changeInfo) onChange();
	};
	const groupEvents = [chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved, chrome.tabGroups.onRemoved];
	groupEvents.forEach((event) => event.addListener(changed));
	chrome.tabs.onCreated.addListener(changed);
	chrome.tabs.onRemoved.addListener(changed);
	chrome.tabs.onUpdated.addListener(onTabUpdated);
	return () => {
		groupEvents.forEach((event) => event.removeListener(changed));
		chrome.tabs.onCreated.removeListener(changed);
		chrome.tabs.onRemoved.removeListener(changed);
		chrome.tabs.onUpdated.removeListener(onTabUpdated);
	};
}
