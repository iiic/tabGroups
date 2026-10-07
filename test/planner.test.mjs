import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { loadI18n } from "../i18n.mjs";
import { BUCKETS, normalizeGroupsConfig } from "../modules/tabGroups/buckets.mjs";
import { TAB_GROUP_ID_NONE, planOrder, planWindow, targetRank } from "../modules/tabGroups/planner.mjs";
import { day, mockLocales, noonOf, utcDayOf } from "./helpers.mjs";

const bucketIndex = (key) => BUCKETS.findIndex((bucket) => bucket.key === key);
const TODAY = bucketIndex("today");
const YESTERDAY = bucketIndex("yesterday");
const LAST_WEEK = bucketIndex("lastWeek");
const THIS_YEAR = bucketIndex("thisYear");

// Středa 7. 10. 2026.
const NOW = day(2026, 10, 7);
const D_YESTERDAY = NOW - 1;
const D_LAST_WEEK = day(2026, 10, 1);
const D_AUGUST = day(2026, 8, 15);

/** @type {ReturnType<typeof normalizeGroupsConfig>} */
let config;

before(async () => {
	mockLocales();
	await loadI18n("en");
	config = normalizeGroupsConfig({});
});

/** Karta bez skupiny na pozici podle id; fields přepíše cokoliv. */
function tab(fields) {
	const { id } = fields;
	return { windowId: 1, index: id, groupId: TAB_GROUP_ID_NONE, url: `https://example.com/${id}`, active: false, pinned: false, hidden: false, ...fields };
}

/** Vstup planWindow() s rozumnými výchozími hodnotami. */
function input(fields) {
	return {
		tabs: [],
		groups: [],
		config,
		bookmarkGroups: [],
		groupIds: {},
		knownTitles: [],
		openedDays: {},
		usedDays: {},
		referenceDay: null,
		today: NOW,
		dayOf: utcDayOf,
		groupBy: "opened",
		bookmarkOf: () => -1,
		manualMoves: false,
		lastGroups: {},
		manualDays: {},
		...fields,
	};
}

describe("planWindow", () => {
	it("karty bez skupiny dostanou nové skupiny svých období", () => {
		const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3 }), tab({ id: 4 })];
		const plan = planWindow(input({ tabs, openedDays: { 1: NOW, 2: D_YESTERDAY, 3: D_AUGUST, 4: NOW } }));
		assert.deepEqual(plan.creates, [
			{ bucket: TODAY, title: "today", color: BUCKETS[TODAY].color, collapsed: false, tabIds: [1, 4] },
			{ bucket: YESTERDAY, title: "yesterday", color: BUCKETS[YESTERDAY].color, collapsed: false, tabIds: [2] },
			{ bucket: THIS_YEAR, title: "this year", color: BUCKETS[THIS_YEAR].color, collapsed: false, tabIds: [3] },
		]);
		assert.deepEqual(plan.updates, []);
		assert.deepEqual(plan.moves, []);
		assert.deepEqual(plan.openedDays, { 1: NOW, 2: D_YESTERDAY, 3: D_AUGUST, 4: NOW });
	});

	it("připnuté, skryté karty a karty ve skupinách uživatele se nespravují", () => {
		const tabs = [tab({ id: 1, pinned: true }), tab({ id: 2, hidden: true }), tab({ id: 3, groupId: 50 })];
		const plan = planWindow(input({ tabs, groups: [{ id: 50, title: "Moje", color: "red" }] }));
		assert.deepEqual(plan.creates, []);
		assert.deepEqual(plan.moves, []);
		assert.deepEqual(plan.openedDays, {});
	});

	it("o půlnoci se skupina „dnes“ jen přejmenuje a přebarví na „včera“", () => {
		const tabs = [tab({ id: 1, groupId: 10 }), tab({ id: 2, groupId: 10 })];
		const plan = planWindow(
			input({
				tabs,
				groups: [{ id: 10, title: "today", color: BUCKETS[TODAY].color }],
				openedDays: { 1: D_YESTERDAY, 2: D_YESTERDAY },
			})
		);
		assert.deepEqual(plan.updates, [{ groupId: 10, title: "yesterday", color: BUCKETS[YESTERDAY].color }]);
		assert.deepEqual(plan.moves, []);
		assert.deepEqual(plan.creates, []);
	});

	it("nová karta se přesune do existující skupiny svého období", () => {
		const tabs = [tab({ id: 1, groupId: 10 }), tab({ id: 2 })];
		const plan = planWindow(
			input({ tabs, groups: [{ id: 10, title: "today", color: BUCKETS[TODAY].color }], openedDays: { 1: NOW, 2: NOW } })
		);
		assert.deepEqual(plan.updates, []);
		assert.deepEqual(plan.moves, [{ groupId: 10, tabIds: [2] }]);
		assert.deepEqual(plan.creates, []);
	});

	it("skupina zůstane cíli, který v ní už je, karty jiného období odejdou", () => {
		const tabs = [tab({ id: 1, groupId: 10 }), tab({ id: 2, groupId: 10 })];
		const plan = planWindow(
			input({ tabs, groups: [{ id: 10, title: "today", color: BUCKETS[TODAY].color }], openedDays: { 1: NOW, 2: D_LAST_WEEK } })
		);
		assert.deepEqual(plan.updates, []);
		assert.deepEqual(plan.creates.map(({ bucket, tabIds }) => ({ bucket, tabIds })), [{ bucket: LAST_WEEK, tabIds: [2] }]);
	});

	it("„uzavřená skupina“ vznikne sbalená, jen když v ní není aktivní karta", () => {
		const collapsedConfig = normalizeGroupsConfig({ today: { collapsed: true }, yesterday: { collapsed: true } });
		const tabs = [tab({ id: 1, active: true }), tab({ id: 2 })];
		const plan = planWindow(input({ tabs, config: collapsedConfig, openedDays: { 1: NOW, 2: D_YESTERDAY } }));
		assert.deepEqual(
			plan.creates.map(({ bucket, collapsed }) => ({ bucket, collapsed })),
			[
				{ bucket: TODAY, collapsed: false },
				{ bucket: YESTERDAY, collapsed: true },
			]
		);
	});

	it("skupina ze záložek má přednost před obdobím", () => {
		const bookmarkGroups = [{ id: "work", title: "Work", color: "blue", collapsed: false }];
		const tabs = [tab({ id: 1, url: "https://work.example/" }), tab({ id: 2 })];
		const plan = planWindow(
			input({
				tabs,
				bookmarkGroups,
				openedDays: { 1: NOW, 2: NOW },
				bookmarkOf: (url) => (url?.startsWith("https://work.") ? 0 : -1),
			})
		);
		assert.deepEqual(
			plan.creates.map(({ bucket, title, tabIds }) => ({ bucket, title, tabIds })),
			[
				{ bucket: TODAY, title: "today", tabIds: [2] },
				{ bucket: BUCKETS.length, title: "Work", tabIds: [1] },
			]
		);
		// Dny se počítají i kartám ve skupinách ze záložek.
		assert.deepEqual(plan.openedDays, { 1: NOW, 2: NOW });
	});

	it("neznámá karta dostane den otevření podle poslední aktivity", () => {
		const tabs = [tab({ id: 1, lastAccessed: noonOf(D_YESTERDAY) }), tab({ id: 2, lastAccessed: 0 })];
		const plan = planWindow(input({ tabs }));
		assert.deepEqual(plan.openedDays, { 1: D_YESTERDAY, 2: NOW });
		assert.deepEqual(
			plan.creates.map(({ bucket, tabIds }) => ({ bucket, tabIds })),
			[
				{ bucket: TODAY, tabIds: [2] },
				{ bucket: YESTERDAY, tabIds: [1] },
			]
		);
	});

	it("groupBy „lastUsed“ řadí podle posledního použití", () => {
		const tabs = [tab({ id: 1 }), tab({ id: 2, active: true }), tab({ id: 3 })];
		const plan = planWindow(
			input({
				tabs,
				groupBy: "lastUsed",
				openedDays: { 1: D_AUGUST, 2: D_AUGUST, 3: D_AUGUST },
				usedDays: { 1: D_YESTERDAY },
			})
		);
		assert.deepEqual(plan.usedDays, { 1: D_YESTERDAY, 2: NOW, 3: D_AUGUST });
		assert.deepEqual(
			plan.creates.map(({ bucket, tabIds }) => ({ bucket, tabIds })),
			[
				{ bucket: TODAY, tabIds: [2] },
				{ bucket: YESTERDAY, tabIds: [1] },
				{ bucket: THIS_YEAR, tabIds: [3] },
			]
		);
	});

	describe("přetahování karet (manualMoves)", () => {
		const groups = [
			{ id: 10, title: "today", color: BUCKETS[TODAY].color },
			{ id: 11, title: "yesterday", color: BUCKETS[YESTERDAY].color },
		];

		it("karta přetažená do jiného období v něm zůstane", () => {
			const tabs = [tab({ id: 1, groupId: 11 }), tab({ id: 2, groupId: 10 })];
			const plan = planWindow(
				input({ tabs, groups, manualMoves: true, openedDays: { 1: NOW, 2: NOW }, lastGroups: { 1: 10, 2: 10 } })
			);
			assert.deepEqual(plan.manualDays, { 1: D_YESTERDAY });
			assert.deepEqual(plan.moves, []);
			assert.deepEqual(plan.creates, []);
		});

		it("bez volby se přetažená karta vrátí do svého období", () => {
			const tabs = [tab({ id: 1, groupId: 11 }), tab({ id: 2, groupId: 10 })];
			const plan = planWindow(
				input({ tabs, groups, manualMoves: false, openedDays: { 1: NOW, 2: NOW }, lastGroups: { 1: 10, 2: 10 } })
			);
			assert.deepEqual(plan.manualDays, {});
			assert.deepEqual(plan.moves, [{ groupId: 10, tabIds: [1] }]);
		});

		it("karta přetažená zpátky do svého období ruční den ztratí", () => {
			const tabs = [tab({ id: 1, groupId: 10 })];
			const plan = planWindow(
				input({ tabs, groups, manualMoves: true, openedDays: { 1: NOW }, lastGroups: { 1: 11 }, manualDays: { 1: D_YESTERDAY } })
			);
			assert.deepEqual(plan.manualDays, {});
			assert.deepEqual(plan.moves, []);
		});

		it("karta přetažená mimo skupiny období ruční den ztratí", () => {
			const tabs = [tab({ id: 1, groupId: 50 })];
			const plan = planWindow(
				input({
					tabs,
					groups: [...groups, { id: 50, title: "Moje", color: "red" }],
					manualMoves: true,
					openedDays: { 1: NOW },
					lastGroups: { 1: 11 },
					manualDays: { 1: D_YESTERDAY },
				})
			);
			assert.deepEqual(plan.manualDays, {});
		});
	});
});

describe("targetRank", () => {
	it("skupiny ze záložek vlevo, období od nejstaršího, „dnes“ úplně vpravo", () => {
		const bookmarkCount = 2;
		const ranks = [BUCKETS.length, BUCKETS.length + 1, BUCKETS.length - 1, 1, 0].map((target) => targetRank(target, bookmarkCount));
		assert.deepEqual(ranks, [0, 1, 2, BUCKETS.length, BUCKETS.length + 1]);
	});
});

describe("planOrder", () => {
	const targetOfGroup = new Map([
		[20, TODAY],
		[21, YESTERDAY],
	]);

	it("skupiny modulu se seřadí na konec okna", () => {
		const tabs = [
			tab({ id: 1, index: 0 }),
			tab({ id: 2, index: 1, groupId: 20 }),
			tab({ id: 3, index: 2, groupId: 20 }),
			tab({ id: 4, index: 3, groupId: 21 }),
		];
		assert.deepEqual(planOrder(tabs, targetOfGroup, 0), [21, 20]);
	});

	it("když pořadí sedí, nic se nepřesouvá", () => {
		const tabs = [
			tab({ id: 1, index: 0, pinned: true, groupId: 20 }),
			tab({ id: 2, index: 1 }),
			tab({ id: 3, index: 2, groupId: 21 }),
			tab({ id: 4, index: 3, groupId: 20 }),
		];
		assert.deepEqual(planOrder(tabs, targetOfGroup, 0), []);
	});

	it("skupina zrušeného řádku skupin ze záložek se nepřesouvá", () => {
		const tabs = [tab({ id: 1, index: 0, groupId: 30 }), tab({ id: 2, index: 1, groupId: 20 }), tab({ id: 3, index: 2 })];
		assert.deepEqual(planOrder(tabs, new Map([[20, TODAY], [30, BUCKETS.length]]), 0), [20]);
	});
});
