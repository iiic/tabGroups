//@ts-check
"use strict";

// modules/tabGroups/background-script.mjs
// The background part of the tabGroups module (see registerBackgroundScript() in sdk.mjs)
// — runs in background.js, so it sorts tabs even without an open extension page.
//
// One pass (reconcile()) in every window:
//   1. For every tab that is neither pinned nor in a user's group, it determines the day
//      it was opened: the remembered one (a tab opened while the module was running), otherwise an estimate
//      (estimateOpenedDay() in buckets.mjs), and the day of last use
//      (estimateUsedDay() — the window's active tab is in use today).
//   2. Puts it into a group from bookmarks when its address is a bookmark in the
//      folder of one of them (bookmarkGroups.mjs), otherwise into a period group
//      by the day it was opened, or (the GROUP_BY_KEY setting) the day of last
//      use (planWindow() in planner.mjs). With the tab dragging option
//      (MANUAL_MOVES_KEY) the manual day of a tab the user
//      dragged into another period's group takes precedence. A group whose tabs moved into the
//      next period (at midnight the whole "today" → "yesterday") is only renamed
//      and recolored.
//   3. Sorts the module's groups to the right after all other tabs: groups from
//      bookmarks, then periods from the oldest to the newest (planOrder()).
// The module's groups are recognized by the number from the registry (GROUP_IDS_KEY), otherwise
// by the name from Settings (with the prefix, TITLE_PREFIX_KEY) or any
// previously used one (KNOWN_TITLES_KEY), see groupIdentity.mjs. The module does not change
// the user's groups, pinned and hidden tabs.
//
// When: after a tab is opened, after a tab's group changes or it is pinned, when sorting
// by last use also after switching tabs, with groups from bookmarks also after
// a tab's address changes and after bookmarks change, after groups change (creation, name,
// color, move), after the settings or the module list change, at browser
// startup and after a permission is granted — always with a short delay, so that a series of
// events (including those caused by the module's own changes) comes together into a single
// pass. At midnight the pass is started by an alarm (chrome.alarms). Without the
// "alarms" permission the new day shows up with the next work with tabs (switching a tab
// or window). At the request of tabGroupsSandbox the module's groups blink (identifyGroups()) — its
// overview and the editor of the settings ask for the services of this part (api.services).
//
// The tabs' opened and last-used days are kept in api.sessionState — tab ids
// are valid only until the browser restarts, then the storage empties itself and restored
// tabs get their days estimated by the period of the group they are in (that is why api.state
// remembers the day of the last assignment, the group registry and the used names).
//
// A tab dragged by the user (the MANUAL_MOVES_KEY option): the pass records
// each tab's group as it left it (LAST_GROUPS_KEY). A tab that is
// elsewhere on the next pass was moved without the module — in a period group
// it gets a manual day (MANUAL_DAYS_KEY, see planWindow()). When sorting by
// last use the manual day ends as soon as the user switches to the tab
// again (the drag itself selects the tab even before it is moved into the group).
import { UI_LANGUAGES, loadI18n, onUiLanguageChange, registerBackgroundScript } from "../../sdk.mjs";
import {
	MODULE_NAME,
	ACTIVATION_SPEC,
	DEFAULT_ACTIVATION_MODE,
	GROUPS_KEY,
	GROUP_BY_KEY,
	BOOKMARK_GROUPS_KEY,
	OVERVIEW_SERVICE,
	REGROUP_SERVICE,
	IDENTIFY_SERVICE,
	GET_SETTINGS_SERVICE,
	SET_SETTINGS_SERVICE,
	OPEN_PERMISSIONS_SERVICE,
	CHANGES_SERVICE,
	REFERENCE_DAY_KEY,
	APPLIED_TITLES_KEY,
	APPLIED_BOOKMARK_TITLES_KEY,
	GROUP_IDS_KEY,
	KNOWN_TITLES_KEY,
	OPENED_DAYS_KEY,
	USED_DAYS_KEY,
	MANUAL_MOVES_KEY,
	DEFAULT_MANUAL_MOVES,
	TITLE_PREFIX_KEY,
	LAST_GROUPS_KEY,
	MANUAL_DAYS_KEY,
} from "./module.mjs";
import {
	BUCKETS,
	DEFAULT_GROUPS,
	DEFAULT_GROUP_BY,
	DEFAULT_TITLE_PREFIX,
	GROUP_BY_LAST_USED,
	defaultTitlesIn,
	isRealisticTime,
	localDay,
	nextLocalMidnight,
	normalizeGroupBy,
	normalizeGroupsConfig,
	normalizeTitlePrefix,
	withTitlePrefix,
} from "./buckets.mjs";
import { collectBookmarkUrls, createBookmarkMatcher, normalizeBookmarkGroups, resolveBookmarkGroups } from "./bookmarkGroups.mjs";
import { TAB_GROUP_ID_NONE, planOrder, planWindow } from "./planner.mjs";
import {
	describeTargets,
	earlierTitles,
	findOurGroups,
	readGroupIds,
	readKnownTitles,
	rememberGroups,
	rememberTitles,
	sameGroupIds,
	toTargets,
} from "./groupIdentity.mjs";
import { readOverview } from "./overview.mjs";
import { applySettingsChange, readSettingsView } from "./settings.mjs";

// When this extension instance started (api.sessionState — a browser start,
// an extension reload or update empties it).
const INSTANCE_KEY = "instanceStartedAt";
// An alarm for the nearest midnight (chrome.alarms).
const ALARM_NAME = "tabGroups.midnight";
// The delay of a pass after the last event.
const DEBOUNCE_MS = 400;
// During the first STARTUP_GRACE_MS after the browser or extension starts, the browser
// restores the tabs of the previous session: they are not newly opened (their opened day
// is estimated) and the pass waits longer, so the restore has time to finish.
const STARTUP_GRACE_MS = 60 * 1000;
const STARTUP_DEBOUNCE_MS = 3000;
// A tab the browser reports as new, but which was last active more than
// NEW_TAB_MAX_AGE_MS ago (a restored session, a reopened closed tab),
// was not opened now.
const NEW_TAB_MAX_AGE_MS = 2 * 60 * 1000;
// A safeguard against looping: when exactly the same changes repeat LOOP_REPEATS× in a row (with gaps under
// LOOP_WINDOW_MS), the browser most likely does not accept them
// (or the user keeps reverting them) — for LOOP_PAUSE_MS it stops reacting to
// changes of tabs and groups.
const LOOP_REPEATS = 3;
const LOOP_WINDOW_MS = 10 * 1000;
const LOOP_PAUSE_MS = 60 * 1000;
// Blinking the module's groups (the "Identify managed groups" button): how many times
// and how long one color lasts.
const BLINK_TIMES = 3;
const BLINK_STEP_MS = 500;
// No group from bookmarks (without groups, without the permission).
/** @type {Types.TabGroups.BookmarkMatcher} */
const NO_BOOKMARK_GROUP = () => -1;

// The color a group alternates with its own when blinking: grey, for a grey group
// cyan.
/** @type {Functions.TabGroups.BackgroundScript.blinkColor} */
function blinkColor(color) {
	return color === "grey" ? "cyan" : "grey";
}

/** @type {Functions.TabGroups.BackgroundScript.readDay} */
function readDay(value) {
	return Number.isInteger(value) ? /** @type {number} */ (value) : null;
}

/** @type {Functions.TabGroups.BackgroundScript.readTitles} */
function readTitles(value) {
	return Array.isArray(value) && value.length === BUCKETS.length && value.every((title) => typeof title === "string" && title !== "")
		? /** @type {string[]} */ (value)
		: [];
}

/** @type {Functions.TabGroups.BackgroundScript.readBookmarkTitles} */
function readBookmarkTitles(value) {
	/** @type {Record<string, string>} */
	const titles = {};
	if (value && typeof value === "object" && !Array.isArray(value)) {
		for (const [id, title] of Object.entries(value)) {
			if (typeof title === "string" && title !== "") titles[id] = title;
		}
	}
	return titles;
}

/** @type {Functions.TabGroups.BackgroundScript.readDays} */
function readDays(value) {
	/** @type {Record<string, number>} */
	const days = {};
	if (value && typeof value === "object" && !Array.isArray(value)) {
		for (const [tabId, day] of Object.entries(value)) {
			if (Number.isInteger(day)) days[tabId] = /** @type {number} */ (day);
		}
	}
	return days;
}

/** @type {Functions.TabGroups.BackgroundScript.sameDays} */
function sameDays(a, b) {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

// The list of group names the first time (KNOWN_TITLES_KEY is not stored yet) — names
// the module's groups may have from earlier (earlierTitles()): the default period names
// in all UI languages and the names from Settings, with earlier
// prefixes, and the names from the last assignment by an older version.
/** @type {Functions.TabGroups.BackgroundScript.initialKnownTitles} */
async function initialKnownTitles({ keys, periods, bookmarkGroups, prefix, appliedTitles, appliedBookmarkTitles }) {
	const defaults = await Promise.all(UI_LANGUAGES.map(({ value }) => defaultTitlesIn(value)));
	const baseTitles = keys.map((_, i) =>
		i < BUCKETS.length ? [...defaults.map((titles) => titles[i]), periods[i].title] : [bookmarkGroups[i - BUCKETS.length].title]
	);
	return earlierTitles({ keys, baseTitles, prefix, appliedTitles, appliedBookmarkTitles });
}

/** @type {Functions.TabGroups.BackgroundScript.toTabInfo} */
function toTabInfo(tab) {
	return {
		id: /** @type {number} */ (tab.id),
		windowId: tab.windowId,
		index: tab.index,
		pinned: tab.pinned,
		active: tab.active,
		groupId: typeof tab.groupId === "number" ? tab.groupId : TAB_GROUP_ID_NONE,
		lastAccessed: tab.lastAccessed,
		// Firefox only (tabs.hide()) — the module leaves hidden tabs alone.
		hidden: /** @type {{ hidden?: boolean }} */ (tab).hidden === true,
		// Without the "tabs" permission the browser does not reveal the address. A tab that is
		// still loading has its target address in pendingUrl in Chrome.
		url: tab.url || tab.pendingUrl || undefined,
	};
}

/** @type {Functions.TabGroups.BackgroundScript.toGroupInfo} */
function toGroupInfo(group) {
	return { id: group.id, windowId: group.windowId, title: group.title, color: group.color, shared: group.shared === true };
}

/** @type {Functions.TabGroups.BackgroundScript.byWindow} */
function byWindow(tabs) {
	/** @type {Map<number, Types.TabGroups.TabInfo[]>} */
	const windows = new Map();
	for (const tab of tabs) {
		windows.set(tab.windowId, [...(windows.get(tab.windowId) || []), tab]);
	}
	return windows;
}

// Tries one change in the browser; an error (the tab or group has disappeared in the meantime,
// ...) is only logged and the pass continues.
/** @type {Functions.TabGroups.BackgroundScript.attempt} */
async function attempt(label, change) {
	try {
		await change();
		return true;
	} catch (err) {
		console.warn(`tabGroups: nepovedlo se — ${label}:`, err);
		return false;
	}
}

// Tabs into the groupId group, or (without groupId) into a new group in the
// windowId window. When the browser rejects the whole batch (one tab has disappeared in the meantime),
// the tabs are tried one by one. Returns the group id, or null.
/** @type {Functions.TabGroups.BackgroundScript.groupTabs} */
async function groupTabs(tabIds, groupId, windowId) {
	/** @type {Functions.TabGroups.BackgroundScript.groupTabs.group} */
	const group = (ids, target) => {
		// The planner sends only non-empty lists of tabs.
		const nonEmpty = /** @type {[number, ...number[]]} */ (ids);
		return chrome.tabs.group(target === undefined ? { tabIds: nonEmpty, createProperties: { windowId } } : { tabIds: nonEmpty, groupId: target });
	};
	try {
		return await group(tabIds, groupId);
	} catch (err) {
		if (tabIds.length === 1) {
			console.warn(`tabGroups: kartu ${tabIds[0]} nejde zařadit do skupiny:`, err);
			return null;
		}
	}
	let target = groupId;
	for (const tabId of tabIds) {
		try {
			target = await group([tabId], target);
		} catch (err) {
			console.warn(`tabGroups: kartu ${tabId} nejde zařadit do skupiny:`, err);
		}
	}
	return target ?? null;
}

// Carries out the plan of one window (planWindow()). Returns a description of all change attempts
// (for the safeguard against looping; an empty array = nothing to change) and new
// groups with their target — they belong to the group registry even if the browser
// refused to name them.
/** @type {Functions.TabGroups.BackgroundScript.applyPlan} */
async function applyPlan(windowId, plan) {
	/** @type {string[]} */
	const operations = [];
	/** @type {Map<number, number>} */
	const created = new Map();
	for (const { groupId, ...changes } of plan.updates) {
		operations.push(`update ${groupId} ${JSON.stringify(changes)}`);
		await attempt(`úprava skupiny ${groupId}`, () => chrome.tabGroups.update(groupId, changes));
	}
	for (const { groupId, tabIds } of plan.moves) {
		operations.push(`group ${groupId} ${tabIds.join(",")}`);
		await groupTabs(tabIds, groupId, windowId);
	}
	for (const { bucket, title, color, collapsed, tabIds } of plan.creates) {
		operations.push(`create ${JSON.stringify(title)} ${tabIds.join(",")}`);
		const groupId = await groupTabs(tabIds, undefined, windowId);
		if (groupId !== null) {
			created.set(groupId, bucket);
			await attempt(`pojmenování nové skupiny ${groupId}`, () => chrome.tabGroups.update(groupId, { title, color, ...(collapsed ? { collapsed } : {}) }));
		}
	}
	return { operations, created };
}

// Tabs from all normal windows and all groups.
/** @type {Functions.TabGroups.BackgroundScript.snapshot} */
async function snapshot() {
	const [tabs, groups] = await Promise.all([chrome.tabs.query({ windowType: "normal" }), chrome.tabGroups.query({})]);
	return { tabs: tabs.filter((tab) => typeof tab.id === "number").map(toTabInfo), groups: groups.map(toGroupInfo) };
}

// An alarm for the nearest local midnight (a second later, so that the new day is surely
// here). The browser postpones it when the computer sleeps at midnight.
/** @type {Functions.TabGroups.BackgroundScript.scheduleMidnight} */
async function scheduleMidnight(now) {
	if (!chrome.alarms) return;
	const when = nextLocalMidnight(now) + 1000;
	try {
		const existing = await chrome.alarms.get(ALARM_NAME);
		if (!existing || existing.scheduledTime !== when) {
			await chrome.alarms.create(ALARM_NAME, { when });
		}
	} catch (err) {
		console.warn("tabGroups: budík na půlnoc nejde nastavit:", err);
	}
}

registerBackgroundScript({
	name: MODULE_NAME,
	setup: ({ api }) => {
		// Passes and writes of opened days go one after another.
		/** @type {Promise<unknown>} */
		let chain = Promise.resolve();
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let timer;
		// The day of the last pass (only in memory — after the service worker wakes up
		// the pass runs anyway).
		/** @type {number | null} */
		let lastDay = null;
		// Should switching tabs start a pass? Only with the module enabled and sorting
		// by last use (set by every pass); null until none has run after
		// the service worker started.
		/** @type {boolean | null} */
		let passOnActivation = null;
		// Should a change of a tab's address or bookmarks start a pass? Only with the module
		// enabled with groups from bookmarks; null as with passOnActivation.
		/** @type {boolean | null} */
		let passOnUrlChange = null;
		// Matching addresses against bookmarks for the last groups from bookmarks —
		// rebuilt after the groups in Settings, the bookmarks or permissions change.
		// generation prevents storing a matching built from old bookmarks.
		/** @type {{ key: string, match: Types.TabGroups.BookmarkMatcher } | null} */
		let bookmarkCache = null;
		let bookmarkGeneration = 0;
		// Tabs opened since the last pass: id → opened day.
		/** @type {Map<number, number>} */
		const pendingOpened = new Map();
		// Tabs the user switched to since the last pass (only when
		// sorting by last use) — their manual day ends.
		/** @type {Set<number>} */
		const pendingActivated = new Set();
		let lastSignature = "";
		let lastSignatureAt = 0;
		let repeats = 0;
		let pausedUntil = 0;

		const instanceStartedAt = api.sessionState
			.get(INSTANCE_KEY, null)
			.then(async (value) => {
				if (typeof value === "number") return value;
				const now = Date.now();
				await api.sessionState.set(INSTANCE_KEY, now);
				return now;
			})
			.catch(() => Date.now());

		/** @type {Functions.TabGroups.BackgroundScript.enqueue} */
		function enqueue(task) {
			const run = chain.then(task);
			chain = run.catch(() => {});
			return run;
		}

		/** @type {Functions.TabGroups.BackgroundScript.schedule} */
		function schedule(delayMs) {
			instanceStartedAt.then((started) => {
				const delay = delayMs ?? (Date.now() - started < STARTUP_GRACE_MS ? STARTUP_DEBOUNCE_MS : DEBOUNCE_MS);
				clearTimeout(timer);
				timer = setTimeout(() => {
					timer = undefined;
					enqueue(reconcile).catch((err) => console.error("tabGroups: přeskupení karet selhalo:", err));
				}, delay);
			});
		}

		// A change of tabs or groups — a pass, unless the safeguard against
		// looping paused reacting (noteRun()).
		/** @type {Functions.TabGroups.BackgroundScript.onTabsChanged} */
		function onTabsChanged() {
			// A service provider showing the overview learns that the groups may have changed.
			api.services.changed(CHANGES_SERVICE, "groups");
			if (Date.now() >= pausedUntil) schedule();
		}

		/** @type {Functions.TabGroups.BackgroundScript.noteRun} */
		function noteRun(operations) {
			if (operations.length === 0) {
				repeats = 0;
				lastSignature = "";
				return;
			}
			const signature = operations.join(" | ");
			const now = Date.now();
			repeats = signature === lastSignature && now - lastSignatureAt < LOOP_WINDOW_MS ? repeats + 1 : 0;
			lastSignature = signature;
			lastSignatureAt = now;
			if (repeats >= LOOP_REPEATS - 1) {
				repeats = 0;
				pausedUntil = now + LOOP_PAUSE_MS;
				console.warn(
					`tabGroups: stejné změny skupin se ${LOOP_REPEATS}× po sobě opakují — na ${LOOP_PAUSE_MS / 1000} s přestávám reagovat na změny karet:`,
					signature
				);
			}
		}

		// Matching tab addresses against the bookmarks of groups from bookmarks. Without the
		// "bookmarks" permission (chrome.bookmarks is missing) no tab belongs to a group from
		// bookmarks; a folder that has disappeared contains nothing.
		/** @type {Functions.TabGroups.BackgroundScript.bookmarkMatcher} */
		async function bookmarkMatcher(bookmarkGroups) {
			if (bookmarkGroups.length === 0 || !chrome.bookmarks) return NO_BOOKMARK_GROUP;
			const key = JSON.stringify(bookmarkGroups.map((group) => [group.folderId, group.wholeDomain]));
			if (bookmarkCache && bookmarkCache.key === key) return bookmarkCache.match;
			const generation = bookmarkGeneration;
			const urls = await Promise.all(
				bookmarkGroups.map((group) => chrome.bookmarks.getSubTree(group.folderId).then(collectBookmarkUrls, () => []))
			);
			const match = createBookmarkMatcher(bookmarkGroups, urls);
			if (generation === bookmarkGeneration) bookmarkCache = { key, match };
			return match;
		}

		// Bookmarks or permissions changed — the matching is rebuilt.
		/** @type {Functions.TabGroups.BackgroundScript.forgetBookmarks} */
		function forgetBookmarks() {
			bookmarkGeneration++;
			bookmarkCache = null;
		}

		// Group targets from Settings and what the module's groups are recognized by
		// (groupIdentity.mjs): the registry of group numbers and all used names —
		// extended with the current names from Settings, the first time also with names from earlier.
		// The default names are in the UI language (loadI18n() beforehand).
		/** @type {Functions.TabGroups.BackgroundScript.readTargets} */
		async function readTargets() {
			// Groups in the browser have the names from Settings with the prefix.
			const periods = normalizeGroupsConfig(await api.settings.get(GROUPS_KEY, DEFAULT_GROUPS));
			const titlePrefix = normalizeTitlePrefix(await api.settings.get(TITLE_PREFIX_KEY, DEFAULT_TITLE_PREFIX));
			const config = withTitlePrefix(periods, titlePrefix);
			const plainBookmarkGroups = resolveBookmarkGroups(
				normalizeBookmarkGroups(await api.settings.get(BOOKMARK_GROUPS_KEY, [])),
				periods.map((item) => item.title)
			);
			const bookmarkGroups = withTitlePrefix(plainBookmarkGroups, titlePrefix);
			const targets = describeTargets(config, bookmarkGroups);
			const groupIds = readGroupIds(await api.state.get(GROUP_IDS_KEY, null));
			const storedKnownTitles = readKnownTitles(await api.state.get(KNOWN_TITLES_KEY, null));
			const knownTitles = rememberTitles(
				storedKnownTitles ??
					(await initialKnownTitles({
						keys: targets.keys,
						periods,
						bookmarkGroups: plainBookmarkGroups,
						prefix: titlePrefix,
						appliedTitles: readTitles(await api.state.get(APPLIED_TITLES_KEY, null)),
						appliedBookmarkTitles: readBookmarkTitles(await api.state.get(APPLIED_BOOKMARK_TITLES_KEY, null)),
					})),
				targets.titles.map((title, i) => /** @type {[string, string]} */ ([title, targets.keys[i]]))
			);
			return { config, bookmarkGroups, targets, groupIds, storedKnownTitles, knownTitles };
		}

		/** @type {Functions.TabGroups.BackgroundScript.reconcile} */
		async function reconcile() {
			if (!(await api.activation.isActive(DEFAULT_ACTIVATION_MODE, ACTIVATION_SPEC))) {
				pendingOpened.clear();
				pendingActivated.clear();
				passOnActivation = false;
				passOnUrlChange = false;
				if (chrome.alarms) await chrome.alarms.clear(ALARM_NAME).catch(() => false);
				return { ok: false, reason: "disabled" };
			}
			if (!chrome.tabGroups || typeof chrome.tabs.group !== "function") {
				passOnActivation = false;
				passOnUrlChange = false;
				return { ok: false, reason: "unavailable" };
			}

			// The default group names are in the UI language.
			await loadI18n();
			const now = Date.now();
			const today = localDay(now);
			const { config, bookmarkGroups, targets, groupIds, storedKnownTitles, knownTitles } = await readTargets();
			const groupBy = normalizeGroupBy(await api.settings.get(GROUP_BY_KEY, DEFAULT_GROUP_BY));
			passOnActivation = groupBy === GROUP_BY_LAST_USED;
			const manualMoves = (await api.settings.get(MANUAL_MOVES_KEY, DEFAULT_MANUAL_MOVES)) === true;
			passOnUrlChange = bookmarkGroups.length > 0;
			const bookmarkOf = await bookmarkMatcher(bookmarkGroups);
			const referenceDay = readDay(await api.state.get(REFERENCE_DAY_KEY, null));
			const storedDays = readDays(await api.sessionState.get(OPENED_DAYS_KEY, null).catch(() => null));
			const storedUsedDays = readDays(await api.sessionState.get(USED_DAYS_KEY, null).catch(() => null));
			/** @type {Record<string, number>} */
			const openedDays = { ...storedDays };
			for (const [tabId, day] of pendingOpened) {
				openedDays[tabId] = day;
			}
			pendingOpened.clear();
			/** @type {Record<string, number>} */
			const usedDays = { ...storedUsedDays };
			const storedLastGroups = readDays(await api.sessionState.get(LAST_GROUPS_KEY, null).catch(() => null));
			const storedManualDays = readDays(await api.sessionState.get(MANUAL_DAYS_KEY, null).catch(() => null));
			/** @type {Record<string, number>} */
			const manualDays = { ...storedManualDays };
			if (groupBy === GROUP_BY_LAST_USED) {
				for (const tabId of pendingActivated) {
					delete manualDays[tabId];
				}
			}
			pendingActivated.clear();
			/** @type {Record<string, number>} */
			const plannedManualDays = {};

			/** @type {string[]} */
			const operations = [];
			// New groups → target key.
			/** @type {Map<number, string>} */
			const created = new Map();
			let current = await snapshot();
			// The tabs' groups before the pass and the tabs the pass moved
			// (for LAST_GROUPS_KEY).
			const groupsBefore = new Map(current.tabs.map((tab) => [tab.id, tab.groupId]));
			/** @type {Set<number>} */
			const touched = new Set();
			for (const [windowId, tabs] of byWindow(current.tabs)) {
				const plan = planWindow({
					tabs,
					groups: current.groups.filter((group) => group.windowId === windowId),
					config,
					bookmarkGroups,
					groupIds,
					knownTitles,
					openedDays,
					usedDays,
					referenceDay,
					today,
					dayOf: localDay,
					groupBy,
					bookmarkOf,
					manualMoves,
					lastGroups: storedLastGroups,
					manualDays,
				});
				Object.assign(openedDays, plan.openedDays);
				Object.assign(usedDays, plan.usedDays);
				Object.assign(plannedManualDays, plan.manualDays);
				for (const { tabIds } of [...plan.moves, ...plan.creates]) {
					tabIds.forEach((tabId) => touched.add(tabId));
				}
				const applied = await applyPlan(windowId, plan);
				operations.push(...applied.operations);
				for (const [groupId, bucket] of applied.created) {
					created.set(groupId, targets.keys[bucket]);
				}
			}

			if (operations.length > 0) {
				current = await snapshot();
			}
			// The module's groups after the changes: renamed ones are recognized by the name
			// from Settings, new ones also by the number (should naming them fail).
			const ours = findOurGroups(current.groups, { ...targets, groupIds, knownTitles });
			for (const [groupId, key] of created) {
				if (!ours.has(groupId)) ours.set(groupId, key);
			}
			const targetOfGroup = toTargets(ours, targets.keys);
			for (const tabs of byWindow(current.tabs).values()) {
				for (const groupId of planOrder(tabs, targetOfGroup, bookmarkGroups.length)) {
					operations.push(`move ${groupId}`);
					await attempt(`přesun skupiny ${groupId}`, () => chrome.tabGroups.move(groupId, { index: -1 }));
				}
			}

			// Opened and used days only of tabs that still exist — including those in
			// the user's groups (should the user take them out of the group again).
			/** @type {Record<string, number>} */
			const nextDays = {};
			/** @type {Record<string, number>} */
			const nextUsedDays = {};
			/** @type {Record<string, number>} */
			const nextManualDays = {};
			// The group the pass left the tab in: for tabs it moved,
			// by the last snapshot, for the others by the first one — should the
			// user move them during the pass, it is recognized on the next one.
			// Tabs opened during the pass are recorded only next time.
			/** @type {Record<string, number>} */
			const nextLastGroups = {};
			for (const tab of current.tabs) {
				if (Number.isInteger(openedDays[tab.id])) nextDays[tab.id] = openedDays[tab.id];
				if (Number.isInteger(usedDays[tab.id])) nextUsedDays[tab.id] = usedDays[tab.id];
				if (Number.isInteger(plannedManualDays[tab.id])) nextManualDays[tab.id] = plannedManualDays[tab.id];
				const before = groupsBefore.get(tab.id);
				if (manualMoves && before !== undefined) nextLastGroups[tab.id] = touched.has(tab.id) ? tab.groupId : before;
			}
			if (!sameDays(storedDays, nextDays)) {
				await api.sessionState.set(OPENED_DAYS_KEY, nextDays).catch((err) => console.warn("tabGroups: dny otevření karet nejde uložit:", err));
			}
			if (!sameDays(storedUsedDays, nextUsedDays)) {
				await api.sessionState.set(USED_DAYS_KEY, nextUsedDays).catch((err) => console.warn("tabGroups: dny použití karet nejde uložit:", err));
			}
			// Without the dragging option both records stay empty — after it is
			// turned on, drags are counted only from the first pass.
			if (!sameDays(storedLastGroups, nextLastGroups)) {
				await api.sessionState.set(LAST_GROUPS_KEY, nextLastGroups).catch((err) => console.warn("tabGroups: skupiny karet nejde uložit:", err));
			}
			if (!sameDays(storedManualDays, nextManualDays)) {
				await api.sessionState.set(MANUAL_DAYS_KEY, nextManualDays).catch((err) => console.warn("tabGroups: ruční dny karet nejde uložit:", err));
			}
			if (referenceDay !== today) {
				await api.state.set(REFERENCE_DAY_KEY, today);
			}
			// The group registry with the names the groups really have after the pass
			// (the pass day changes once a day — it is not written more often).
			const nextGroupIds = rememberGroups(groupIds, current.groups, ours, today);
			if (!sameGroupIds(groupIds, nextGroupIds)) {
				await api.state.set(GROUP_IDS_KEY, nextGroupIds);
			}
			if (knownTitles !== storedKnownTitles) {
				await api.state.set(KNOWN_TITLES_KEY, knownTitles);
			}
			lastDay = today;
			await scheduleMidnight(now);
			noteRun(operations);
			return { ok: true, changed: operations.length > 0 };
		}

		// The "Identify managed groups" button: the groups the module manages
		// (in all windows) alternate their color with blinkColor() BLINK_TIMES×
		// and finally get it back. It runs in the queue like a pass — a pass
		// triggered by the color changes waits until the blinking ends, and does not "fix"
		// the colors in the meantime.
		/** @type {Functions.TabGroups.BackgroundScript.identifyGroups} */
		async function identifyGroups() {
			if (!(await api.activation.isActive(DEFAULT_ACTIVATION_MODE, ACTIVATION_SPEC))) return { ok: false, reason: "disabled" };
			if (!chrome.tabGroups) return { ok: false, reason: "unavailable" };
			await loadI18n();
			const { targets, groupIds, knownTitles } = await readTargets();
			const groups = (await chrome.tabGroups.query({})).map(toGroupInfo);
			const ours = findOurGroups(groups, { ...targets, groupIds, knownTitles });
			const blinking = groups.filter((group) => ours.has(group.id));
			for (let step = 0; step < BLINK_TIMES * 2; step++) {
				if (step > 0) await new Promise((resolve) => setTimeout(resolve, BLINK_STEP_MS));
				const flash = step % 2 === 0;
				// The group may have disappeared in the meantime — the others keep blinking.
				await Promise.all(
					blinking.map((group) => chrome.tabGroups.update(group.id, { color: flash ? blinkColor(group.color) : group.color }).catch(() => undefined))
				);
			}
			return { ok: true, count: blinking.length };
		}

		// --- Listeners: synchronously, so the browser delivers them even to a woken-up service worker ---

		chrome.tabs.onCreated.addListener((tab) => {
			const now = Date.now();
			const { id, lastAccessed } = tab;
			enqueue(async () => {
				const started = await instanceStartedAt;
				const justOpened = !isRealisticTime(lastAccessed) || now - lastAccessed < NEW_TAB_MAX_AGE_MS;
				if (typeof id === "number" && justOpened && now - started >= STARTUP_GRACE_MS) {
					pendingOpened.set(id, localDay(now));
				}
			});
			onTabsChanged();
		});
		chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
			// A tab's new address may belong to another group from bookmarks (or to none
			// anymore).
			if ("groupId" in changeInfo || "pinned" in changeInfo || ("url" in changeInfo && passOnUrlChange !== false)) onTabsChanged();
		});
		chrome.tabs.onAttached.addListener(() => onTabsChanged());
		// The tab the user switches to is, when sorting by last
		// use, in use today — the pass moves it into "today" (even one dragged
		// into another group, see pendingActivated).
		chrome.tabs.onActivated.addListener(({ tabId }) => {
			if (passOnActivation !== false) {
				pendingActivated.add(tabId);
				onTabsChanged();
			}
		});

		// Without an alarm (the "alarms" permission) the new day is recognized when working with tabs.
		if (!chrome.alarms) {
			const checkDay = () => {
				if (lastDay !== null && localDay(Date.now()) !== lastDay) onTabsChanged();
			};
			chrome.tabs.onActivated.addListener(checkDay);
			if (chrome.windows && chrome.windows.onFocusChanged) chrome.windows.onFocusChanged.addListener(checkDay);
		}

		// chrome.tabGroups, chrome.bookmarks and chrome.alarms exist only
		// with the (optional) permission — their listeners are registered right away,
		// or only after it is granted.
		let groupEventsAttached = false;
		let alarmAttached = false;
		let bookmarkEventsAttached = false;
		/** @type {Functions.TabGroups.BackgroundScript.attachOptionalListeners} */
		function attachOptionalListeners() {
			if (!groupEventsAttached && chrome.tabGroups) {
				chrome.tabGroups.onCreated.addListener(() => onTabsChanged());
				chrome.tabGroups.onUpdated.addListener(() => onTabsChanged());
				chrome.tabGroups.onMoved.addListener(() => onTabsChanged());
				// A closed group changes only the overview, not the sorting.
				chrome.tabGroups.onRemoved.addListener(() => api.services.changed(CHANGES_SERVICE, "groups"));
				groupEventsAttached = true;
			}
			if (!bookmarkEventsAttached && chrome.bookmarks) {
				const onBookmarksChanged = () => {
					forgetBookmarks();
					if (passOnUrlChange !== false) onTabsChanged();
				};
				// Firefox does not have onChildrenReordered and onImportEnded.
				for (const event of [
					chrome.bookmarks.onCreated,
					chrome.bookmarks.onRemoved,
					chrome.bookmarks.onChanged,
					chrome.bookmarks.onMoved,
					chrome.bookmarks.onChildrenReordered,
					chrome.bookmarks.onImportEnded,
				]) {
					if (event) event.addListener(onBookmarksChanged);
				}
				bookmarkEventsAttached = true;
			}
			if (!alarmAttached && chrome.alarms) {
				chrome.alarms.onAlarm.addListener((alarm) => {
					if (alarm.name === ALARM_NAME) schedule(0);
				});
				alarmAttached = true;
			}
		}
		attachOptionalListeners();

		if (chrome.permissions && chrome.permissions.onAdded) {
			chrome.permissions.onAdded.addListener(() => {
				forgetBookmarks();
				attachOptionalListeners();
				api.services.changed(CHANGES_SERVICE, "status");
				schedule();
			});
		}
		if (chrome.permissions && chrome.permissions.onRemoved) {
			chrome.permissions.onRemoved.addListener(() => {
				forgetBookmarks();
				api.services.changed(CHANGES_SERVICE, "status");
				schedule();
			});
		}
		chrome.runtime.onStartup.addListener(() => schedule());
		chrome.runtime.onInstalled.addListener(() => schedule());
		// Sorting, names and colors in Settings, disabling/enabling the module, the module list.
		api.activation.onChange(() => {
			api.services.changed(CHANGES_SERVICE, "status");
			schedule();
		});
		// A different UI language — groups with default names are renamed.
		onUiLanguageChange(() => schedule());

		// The services of tabGroupsSandbox (api.services) — the functions of the catalog the overview and the
		// editor of the settings in the sandbox ask for; the core runs them here for a page of this extension
		// and for the pages of a service provider this extension is a client of.
		// The overview of the window of the page (context.windowId), or why there is none.
		api.services.provide(OVERVIEW_SERVICE, async (_args, context) => {
			const reason = await api.activation.reason(DEFAULT_ACTIVATION_MODE, ACTIVATION_SPEC);
			if (reason) return { reason, overview: null };
			// The ranges of the periods and the descriptions of the groups from bookmarks are texts.
			await loadI18n();
			return { reason: null, overview: await readOverview(api, context.windowId) };
		});
		// "Regroup now" — a pass right away, the answer after it.
		api.services.provide(REGROUP_SERVICE, async () => {
			clearTimeout(timer);
			timer = undefined;
			return enqueue(reconcile).catch((err) => ({ ok: false, reason: "error", error: /** @type {Error} */ (err).message || String(err) }));
		});
		// "Identify managed groups" — the answer after blinking.
		api.services.provide(IDENTIFY_SERVICE, async () =>
			enqueue(identifyGroups).catch((err) => ({ ok: false, reason: "error", error: /** @type {Error} */ (err).message || String(err) }))
		);
		// The settings for their editor and one change of it (settings.mjs) — also while the module is turned off.
		api.services.provide(GET_SETTINGS_SERVICE, async () => {
			await loadI18n();
			return readSettingsView(api);
		});
		api.services.provide(SET_SETTINGS_SERVICE, async ([change]) => {
			await loadI18n();
			return applySettingsChange(api, change);
		});
		// The listener of the overview for a service provider (its pages follow the tabs of their window themselves only
		// on a page of this extension) — fed by changed() after the tab, group, settings and permission events.
		api.services.provideListener(CHANGES_SERVICE);
		// A closed tab changes only the overview, not the sorting.
		chrome.tabs.onRemoved.addListener(() => api.services.changed(CHANGES_SERVICE, "groups"));
		// The page where the element of this module asks for the permissions — Settings of this extension.
		api.services.provide(OPEN_PERMISSIONS_SERVICE, async () => {
			await chrome.runtime.openOptionsPage();
			return { opened: true };
		});

		// A pass after every service worker start — catches up on what changed while it
		// slept (for example a missed midnight).
		schedule();
	},
});
