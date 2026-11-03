//@ts-check
"use strict";

// modules/tabGroups/planner.mjs
// Planning tab group changes in one window — pure functions over a description of tabs
// and groups (without chrome.*), the result is carried out by background-script.mjs. Thanks to that
// the whole decision-making can be verified even outside the browser.
//
// The module's groups are "targets" with an ordinal number: 0–8 periods (index
// in BUCKETS), from BUCKETS.length groups from bookmarks in the order from Settings
// (bookmarkGroups.mjs). Which groups in the browser belong to the module is decided by
// groupIdentity.mjs.
import { BUCKETS, GROUP_BY_LAST_USED, classifyDay, estimateOpenedDay, estimateUsedDay, isRealisticTime, latestDayOfBucket } from "./buckets.mjs";
import { describeTargets, findOurGroups, toTargets } from "./groupIdentity.mjs";

// The groupId of a tab that is not in any group (tabGroups.TAB_GROUP_ID_NONE).
export const TAB_GROUP_ID_NONE = -1;

// Changes in one window so that every tab that is neither pinned nor in a user's
// group is in the group of its target — the group from bookmarks its
// address belongs to (bookmarkOf(), the first one takes precedence), otherwise the period of its day — the day
// it was opened, or (groupBy "lastUsed") the day of last use:
//   - the opened day: the remembered one (openedDays), otherwise an estimate (estimateOpenedDay()),
//   - the day of last use: estimateUsedDay() — the window's active tab today,
//     otherwise the latest known day (usedDays, the opened day, the last activity),
//   - with the tab dragging option (manualMoves) the tab's manual day takes precedence
//     (manualDays): a tab that is in a different group than after the previous pass
//     (lastGroups) — the user dragged it there, the module would have recorded it —, gets
//     the newest day of that period in a period group (latestDayOfBucket()),
//     so it stays in it and moves on with the others at midnight. A tab dragged
//     back into its day's group, out of the period groups, or belonging to a
//     group from bookmarks loses its manual day,
//   - each target gets one group — preferably the one that already has most
//     of its tabs. A group whose tabs moved into the next period (at midnight
//     the whole "today" → "yesterday") is thus only renamed and recolored and the tabs
//     do not move. A group left without a target is emptied and the browser
//     removes it by itself,
//   - a target without a group gets a new one — with "collapsed group" checked
//     collapsed (when the window's active tab is not in it). The module neither collapses
//     nor expands existing groups, it leaves that to the user.
// It also returns the opened days and days of last use of all tabs the module manages
// (for storing) — both in both modes and also for tabs in groups from bookmarks, so that
// switching in Settings and leaving a bookmark are right immediately —, and the manual days of the window's
// tabs (none without the dragging option).
/** @type {Functions.TabGroups.Planner.planWindow} */
export function planWindow({
	tabs,
	groups,
	config,
	bookmarkGroups,
	groupIds,
	knownTitles,
	openedDays,
	usedDays,
	referenceDay,
	today,
	dayOf,
	groupBy,
	bookmarkOf,
	manualMoves,
	lastGroups,
	manualDays,
}) {
	const described = describeTargets(config, bookmarkGroups);
	const ourGroups = toTargets(findOurGroups(groups, { ...described, groupIds, knownTitles }), described.keys);
	// The period of the group the tab is in, or -1 (without a group, a user's group
	// or one from bookmarks).
	/** @type {Functions.TabGroups.Planner.planWindow.periodOf} */
	const periodOf = (tab) => {
		const target = ourGroups.get(tab.groupId) ?? -1;
		return target < BUCKETS.length ? target : -1;
	};
	// Did someone other than the module move the tab since the previous pass?
	/** @type {Functions.TabGroups.Planner.planWindow.movedByUser} */
	const movedByUser = (tab) => manualMoves && Number.isInteger(lastGroups[tab.id]) && lastGroups[tab.id] !== tab.groupId;
	// Manual days stay even for tabs the module does not manage (pinned, hidden,
	// in a user's group) — except those the user moved out of the
	// period groups.
	/** @type {Record<number, number>} */
	const nextManualDays = {};
	if (manualMoves) {
		for (const tab of tabs) {
			if (Number.isFinite(manualDays[tab.id]) && !(movedByUser(tab) && periodOf(tab) < 0)) {
				nextManualDays[tab.id] = manualDays[tab.id];
			}
		}
	}
	/** @type {Types.TabGroups.GroupConfig[]} */
	const targets = [...config, ...bookmarkGroups.map(({ title, color, collapsed }) => ({ title, color, collapsed }))];
	const groupsById = new Map(groups.map((group) => [group.id, group]));
	const managed = tabs.filter(
		(tab) => !tab.pinned && !tab.hidden && (tab.groupId === TAB_GROUP_ID_NONE || ourGroups.has(tab.groupId))
	);

	/** @type {Record<number, number>} */
	const resolvedOpened = {};
	/** @type {Record<number, number>} */
	const resolvedUsed = {};
	/** @type {Map<number, number>} */
	const targetOf = new Map();
	for (const tab of managed) {
		// The period of the group the tab is in (estimating the days of unknown tabs) —
		// a group from bookmarks says nothing about the day.
		const bucket = periodOf(tab);
		const accessedDay = isRealisticTime(tab.lastAccessed) ? dayOf(tab.lastAccessed) : null;
		const knownOpened = openedDays[tab.id];
		const openedDay = Number.isFinite(knownOpened)
			? knownOpened
			: estimateOpenedDay({ bucket, referenceDay, accessedDay: accessedDay ?? today, today });
		const knownUsed = usedDays[tab.id];
		const usedDay = estimateUsedDay({
			knownDay: Number.isFinite(knownUsed) ? knownUsed : null,
			openedDay,
			accessedDay,
			active: tab.active,
			bucket,
			referenceDay,
			today,
		});
		resolvedOpened[tab.id] = openedDay;
		resolvedUsed[tab.id] = usedDay;
		const bookmarkGroup = bookmarkOf(tab.url);
		if (bookmarkGroup >= 0) {
			// A group from bookmarks takes precedence even over dragging.
			delete nextManualDays[tab.id];
			targetOf.set(tab.id, BUCKETS.length + bookmarkGroup);
			continue;
		}
		const ownDay = groupBy === GROUP_BY_LAST_USED ? usedDay : openedDay;
		if (bucket >= 0 && movedByUser(tab)) {
			const manualDay = latestDayOfBucket(bucket, today);
			if (manualDay === null || classifyDay(ownDay, today) === bucket) {
				delete nextManualDays[tab.id];
			} else {
				nextManualDays[tab.id] = manualDay;
			}
		}
		targetOf.set(tab.id, classifyDay(nextManualDays[tab.id] ?? ownDay, today));
	}

	// How many tabs of each module group belong to which target, and where the group
	// starts (on a tie the group more to the left is preferred — a stable result).
	/** @type {Map<number, Map<number, number>>} */
	const counts = new Map();
	/** @type {Map<number, number>} */
	const firstIndex = new Map();
	for (const tab of managed) {
		if (tab.groupId === TAB_GROUP_ID_NONE) continue;
		const byBucket = counts.get(tab.groupId) || new Map();
		const target = /** @type {number} */ (targetOf.get(tab.id));
		byBucket.set(target, (byBucket.get(target) || 0) + 1);
		counts.set(tab.groupId, byBucket);
		firstIndex.set(tab.groupId, Math.min(firstIndex.get(tab.groupId) ?? Number.POSITIVE_INFINITY, tab.index));
	}
	/** @type {Types.TabGroups.GroupCandidate[]} */
	const candidates = [];
	for (const [groupId, byBucket] of counts) {
		for (const [bucket, count] of byBucket) {
			candidates.push({ groupId, bucket, count, sameTarget: ourGroups.get(groupId) === bucket, first: /** @type {number} */ (firstIndex.get(groupId)) });
		}
	}
	candidates.sort(
		(a, b) => b.count - a.count || Number(b.sameTarget) - Number(a.sameTarget) || a.first - b.first || a.bucket - b.bucket
	);
	/** @type {Map<number, number>} */
	const groupOfBucket = new Map();
	/** @type {Set<number>} */
	const assigned = new Set();
	for (const { groupId, bucket } of candidates) {
		if (groupOfBucket.has(bucket) || assigned.has(groupId)) continue;
		groupOfBucket.set(bucket, groupId);
		assigned.add(groupId);
	}

	/** @type {Types.TabGroups.WindowPlan} */
	const plan = { openedDays: resolvedOpened, usedDays: resolvedUsed, manualDays: nextManualDays, updates: [], moves: [], creates: [] };
	targets.forEach(({ title, color, collapsed }, bucket) => {
		const bucketTabs = managed.filter((tab) => targetOf.get(tab.id) === bucket).sort((a, b) => a.index - b.index);
		if (bucketTabs.length === 0) return;
		const groupId = groupOfBucket.get(bucket);
		if (groupId === undefined) {
			// A "collapsed group" is created collapsed — only when the window's active
			// tab is not in it: collapsing would make the browser switch to another tab.
			plan.creates.push({
				bucket,
				title,
				color,
				collapsed: collapsed && !bucketTabs.some((tab) => tab.active),
				tabIds: bucketTabs.map((tab) => tab.id),
			});
			return;
		}
		const group = /** @type {Types.TabGroups.GroupInfo} */ (groupsById.get(groupId));
		if (group.title !== title || group.color !== color) {
			plan.updates.push({ groupId, ...(group.title !== title ? { title } : {}), ...(group.color !== color ? { color } : {}) });
		}
		const outside = bucketTabs.filter((tab) => tab.groupId !== groupId).map((tab) => tab.id);
		if (outside.length > 0) {
			plan.moves.push({ groupId, tabIds: outside });
		}
	});
	return plan;
}

// The target's position from left to right: groups from bookmarks in the order from Settings, after them
// periods from the oldest to the newest ("today" at the very right).
/** @type {Functions.TabGroups.Planner.targetRank} */
export function targetRank(target, bookmarkCount) {
	return target >= BUCKETS.length ? target - BUCKETS.length : bookmarkCount + BUCKETS.length - 1 - target;
}

// The order of the module's groups in the window: at the very right, after all other tabs
// (the user's groups, tabs without a group), in targetRank() order. Returns
// the groups that need to be moved one by one to the end of the window in this order
// — or an empty array when the order is right (then nothing moves).
// targetOfGroup: module group → target (toTargets()); a group of a removed
// row of groups from bookmarks (a target after the last one) is not moved.
/** @type {Functions.TabGroups.Planner.planOrder} */
export function planOrder(tabs, targetOfGroup, bookmarkCount) {
	// The tab strip as a sequence of blocks: a whole group, or one tab without a
	// group. Pinned tabs always stand on the left, the order does not concern them.
	/** @type {string[]} */
	const blocks = [];
	for (const tab of [...tabs].filter((t) => !t.pinned).sort((a, b) => a.index - b.index)) {
		const block = tab.groupId !== TAB_GROUP_ID_NONE ? `group:${tab.groupId}` : `tab:${tab.id}`;
		if (blocks[blocks.length - 1] !== block) blocks.push(block);
	}
	const present = new Set(blocks);
	const desired = [...targetOfGroup]
		.filter(([groupId, target]) => present.has(`group:${groupId}`) && target < BUCKETS.length + bookmarkCount)
		.sort((a, b) => targetRank(a[1], bookmarkCount) - targetRank(b[1], bookmarkCount))
		.map(([groupId]) => groupId);
	const tail = blocks.slice(blocks.length - desired.length);
	return desired.every((groupId, i) => tail[i] === `group:${groupId}`) ? [] : desired;
}
