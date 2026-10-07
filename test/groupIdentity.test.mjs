import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { loadI18n } from "../i18n.mjs";
import { BUCKETS, DEFAULT_TITLE_PREFIX, normalizeGroupsConfig } from "../modules/tabGroups/buckets.mjs";
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
} from "../modules/tabGroups/groupIdentity.mjs";
import { day, mockLocales } from "./helpers.mjs";

const TODAY = day(2026, 10, 7);

before(async () => {
	mockLocales();
	await loadI18n("en");
});

/** Cíle: období + jedna skupina ze záložek. */
function targets() {
	const config = normalizeGroupsConfig({});
	return describeTargets(config, [{ id: "work", title: "Work" }]);
}

describe("describeTargets", () => {
	it("klíče a názvy cílů v pořadí plánovače", () => {
		const { keys, titles } = targets();
		assert.equal(keys.length, BUCKETS.length + 1);
		assert.equal(keys[0], "period:today");
		assert.equal(keys[BUCKETS.length - 1], "period:lastYear");
		assert.equal(keys[BUCKETS.length], "bookmarks:work");
		assert.equal(titles[0], "today");
		assert.equal(titles[BUCKETS.length], "Work");
	});
});

describe("findOurGroups", () => {
	const empty = { groupIds: {}, knownTitles: [] };

	it("pozná skupinu podle čísla, dokud má název od modulu", () => {
		const groupIds = { 5: { key: "period:lastWeek", title: "ⓐ old", day: TODAY } };
		const ours = findOurGroups([{ id: 5, title: "ⓐ old" }], { ...targets(), ...empty, groupIds });
		assert.deepEqual([...ours], [[5, "period:lastWeek"]]);

		const renamed = findOurGroups([{ id: 5, title: "Moje" }], { ...targets(), ...empty, groupIds });
		assert.equal(renamed.size, 0);
	});

	it("pozná skupinu podle názvu z Nastavení a pak podle dřívějšího názvu", () => {
		const knownTitles = [
			["Old work", "bookmarks:work"],
			["today", "period:lastYear"],
		];
		const ours = findOurGroups(
			[
				{ id: 1, title: "yesterday" },
				{ id: 2, title: "Old work" },
				{ id: 3, title: "today" },
				{ id: 4, title: "Skupina uživatele" },
			],
			{ ...targets(), groupIds: {}, knownTitles }
		);
		assert.deepEqual(
			[...ours],
			[
				[1, "period:yesterday"],
				[2, "bookmarks:work"],
				[3, "period:today"],
			]
		);
	});

	it("sdílené skupiny a skupiny bez názvu jsou uživatele", () => {
		const ours = findOurGroups(
			[
				{ id: 1, title: "today", shared: true },
				{ id: 2, title: "" },
				{ id: 3 },
			],
			{ ...targets(), ...empty }
		);
		assert.equal(ours.size, 0);
	});
});

describe("toTargets", () => {
	it("klíč → pořadí cíle, zrušený cíl za všemi", () => {
		const { keys } = targets();
		const result = toTargets(
			new Map([
				[5, "period:yesterday"],
				[6, "bookmarks:work"],
				[7, "bookmarks:gone"],
			]),
			keys
		);
		assert.deepEqual([...result], [
			[5, 1],
			[6, BUCKETS.length],
			[7, keys.length],
		]);
	});
});

describe("rememberGroups", () => {
	it("zapíše viditelné skupiny modulu, neviditelné nechá do 60 dní", () => {
		const groupIds = {
			1: { key: "period:today", title: "today", day: TODAY - 10 },
			2: { key: "period:yesterday", title: "yesterday", day: TODAY - 10 },
			3: { key: "period:lastWeek", title: "last week", day: TODAY - 61 },
			4: { key: "period:lastYear", title: "last year", day: TODAY - 60 },
		};
		const groups = [
			{ id: 1, title: "today" },
			{ id: 2, title: "Moje" },
		];
		const next = rememberGroups(groupIds, groups, new Map([[1, "period:today"]]), TODAY);
		assert.deepEqual(next, {
			1: { key: "period:today", title: "today", day: TODAY },
			4: { key: "period:lastYear", title: "last year", day: TODAY - 60 },
		});
	});
});

describe("readGroupIds / sameGroupIds", () => {
	it("nechá jen platné záznamy", () => {
		assert.deepEqual(readGroupIds(null), {});
		assert.deepEqual(readGroupIds([]), {});
		assert.deepEqual(
			readGroupIds({
				1: { key: "period:today", title: "today", day: 5 },
				2: { key: "period:today", title: "today", day: 5.5 },
				3: { key: 1, title: "today", day: 5 },
				4: null,
			}),
			{ 1: { key: "period:today", title: "today", day: 5 } }
		);
	});

	it("porovná evidence", () => {
		const a = { 1: { key: "k", title: "t", day: 1 } };
		assert.equal(sameGroupIds(a, { 1: { key: "k", title: "t", day: 1 } }), true);
		assert.equal(sameGroupIds(a, { 1: { key: "k", title: "t", day: 2 } }), false);
		assert.equal(sameGroupIds(a, { 2: { key: "k", title: "t", day: 1 } }), false);
		assert.equal(sameGroupIds(a, {}), false);
	});
});

describe("readKnownTitles / rememberTitles", () => {
	it("readKnownTitles: null bez uloženého seznamu, jinak platné dvojice", () => {
		assert.equal(readKnownTitles(undefined), null);
		assert.deepEqual(readKnownTitles([["a", "k"], ["", "k"], ["b"], [1, "k"], "c", ["d", "k2"]]), [
			["a", "k"],
			["d", "k2"],
		]);
	});

	it("rememberTitles přidá nový název na konec a beze změny vrátí tentýž seznam", () => {
		const list = [["a", "k1"]];
		assert.equal(rememberTitles(list, [["a", "k1"], ["", "k2"]]), list);
		assert.deepEqual(rememberTitles(list, [["b", "k2"]]), [
			["a", "k1"],
			["b", "k2"],
		]);
	});

	it("rememberTitles přesune název, který teď patří jinému cíli", () => {
		const list = [
			["a", "k1"],
			["b", "k2"],
		];
		assert.deepEqual(rememberTitles(list, [["a", "k3"]]), [
			["b", "k2"],
			["a", "k3"],
		]);
	});

	it("rememberTitles si pamatuje nejvýš 500 názvů", () => {
		const entries = Array.from({ length: 501 }, (_, i) => [`title ${i}`, "k"]);
		const list = rememberTitles([], entries);
		assert.equal(list.length, 500);
		assert.deepEqual(list[0], ["title 1", "k"]);
		assert.deepEqual(list.at(-1), ["title 500", "k"]);
	});
});

describe("earlierTitles", () => {
	it("názvy se všemi dřívějšími předponami a z posledního zařazení", () => {
		const titles = earlierTitles({
			keys: ["period:today"],
			baseTitles: [["Dnes"]],
			prefix: "P",
			appliedTitles: ["Starý název"],
			appliedBookmarkTitles: { work: "Práce" },
		});
		assert.deepEqual(titles, [
			["Dnes", "period:today"],
			["𓃭 Dnes", "period:today"],
			[`${DEFAULT_TITLE_PREFIX} Dnes`, "period:today"],
			["P Dnes", "period:today"],
			["Starý název", "period:today"],
			["Práce", "bookmarks:work"],
		]);
	});
});
