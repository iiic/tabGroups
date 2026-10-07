import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { loadI18n } from "../i18n.mjs";
import {
	BUCKETS,
	DEFAULT_GROUPS,
	DEFAULT_TITLE_PREFIX,
	bucketBounds,
	bucketWindow,
	classifyDay,
	defaultTitlesIn,
	estimateOpenedDay,
	estimateUsedDay,
	isGroupColor,
	isRealisticTime,
	latestDayOfBucket,
	localDay,
	nextLocalMidnight,
	normalizeGroupBy,
	normalizeGroupsConfig,
	normalizeTitlePrefix,
	toStoredGroupsConfig,
	withTitlePrefix,
} from "../modules/tabGroups/buckets.mjs";
import { day, mockLocales } from "./helpers.mjs";

const bucketIndex = (key) => BUCKETS.findIndex((bucket) => bucket.key === key);
const TODAY = bucketIndex("today");
const YESTERDAY = bucketIndex("yesterday");
const DAY_BEFORE_YESTERDAY = bucketIndex("dayBeforeYesterday");
const THIS_WEEK = bucketIndex("thisWeek");
const LAST_WEEK = bucketIndex("lastWeek");
const THIS_MONTH = bucketIndex("thisMonth");
const LAST_MONTH = bucketIndex("lastMonth");
const THIS_YEAR = bucketIndex("thisYear");
const LAST_YEAR = bucketIndex("lastYear");

// Středa 7. 10. 2026 — týden začal v pondělí 5. 10.
const WEDNESDAY = day(2026, 10, 7);

before(async () => {
	mockLocales();
	await loadI18n("en");
});

describe("localDay / nextLocalMidnight", () => {
	it("celý místní den má stejné číslo dne", () => {
		assert.equal(localDay(new Date(2026, 9, 7, 0, 0).getTime()), WEDNESDAY);
		assert.equal(localDay(new Date(2026, 9, 7, 23, 59, 59).getTime()), WEDNESDAY);
		assert.equal(localDay(new Date(2026, 9, 8, 0, 0).getTime()), WEDNESDAY + 1);
	});

	it("nextLocalMidnight vrací místní půlnoc následujícího dne", () => {
		assert.equal(nextLocalMidnight(new Date(2026, 9, 7, 15, 30).getTime()), new Date(2026, 9, 8).getTime());
		assert.equal(nextLocalMidnight(new Date(2026, 11, 31, 12).getTime()), new Date(2027, 0, 1).getTime());
		// Přechod na letní čas (EU 29. 3. 2026) — den nemá 24 hodin.
		assert.equal(nextLocalMidnight(new Date(2026, 2, 29, 1).getTime()), new Date(2026, 2, 30).getTime());
	});
});

describe("isRealisticTime", () => {
	it("přijme jen skutečný čas od roku 2000", () => {
		assert.equal(isRealisticTime(Date.UTC(2000, 0, 1)), true);
		assert.equal(isRealisticTime(Date.now()), true);
		assert.equal(isRealisticTime(Date.UTC(1999, 11, 31)), false);
		assert.equal(isRealisticTime(0), false);
		assert.equal(isRealisticTime(Number.NaN), false);
		assert.equal(isRealisticTime(Number.POSITIVE_INFINITY), false);
		assert.equal(isRealisticTime(undefined), false);
		assert.equal(isRealisticTime(String(Date.now())), false);
	});
});

describe("bucketBounds / classifyDay", () => {
	it("první dny období vůči středě", () => {
		assert.deepEqual(bucketBounds(WEDNESDAY), [
			day(2026, 10, 7),
			day(2026, 10, 6),
			day(2026, 10, 5),
			day(2026, 10, 5),
			day(2026, 9, 28),
			day(2026, 10, 1),
			day(2026, 9, 1),
			day(2026, 1, 1),
			Number.NEGATIVE_INFINITY,
		]);
	});

	it("zařadí den do prvního období, jehož první den nepředchází", () => {
		assert.equal(classifyDay(day(2026, 10, 7), WEDNESDAY), TODAY);
		assert.equal(classifyDay(day(2026, 10, 6), WEDNESDAY), YESTERDAY);
		assert.equal(classifyDay(day(2026, 10, 5), WEDNESDAY), DAY_BEFORE_YESTERDAY);
		assert.equal(classifyDay(day(2026, 10, 4), WEDNESDAY), LAST_WEEK);
		assert.equal(classifyDay(day(2026, 10, 1), WEDNESDAY), LAST_WEEK);
		assert.equal(classifyDay(day(2026, 9, 28), WEDNESDAY), LAST_WEEK);
		assert.equal(classifyDay(day(2026, 9, 27), WEDNESDAY), LAST_MONTH);
		assert.equal(classifyDay(day(2026, 9, 1), WEDNESDAY), LAST_MONTH);
		assert.equal(classifyDay(day(2026, 8, 31), WEDNESDAY), THIS_YEAR);
		assert.equal(classifyDay(day(2026, 1, 1), WEDNESDAY), THIS_YEAR);
		assert.equal(classifyDay(day(2025, 12, 31), WEDNESDAY), LAST_YEAR);
		assert.equal(classifyDay(day(2001, 5, 5), WEDNESDAY), LAST_YEAR);
	});

	it("den z budoucnosti (posunuté hodiny) patří do dneška", () => {
		assert.equal(classifyDay(day(2026, 10, 9), WEDNESDAY), TODAY);
	});

	it("v pondělí je neděle „včera“, ne „minulý týden“", () => {
		const monday = day(2026, 10, 5);
		assert.equal(classifyDay(day(2026, 10, 4), monday), YESTERDAY);
		assert.equal(classifyDay(day(2026, 10, 3), monday), DAY_BEFORE_YESTERDAY);
		assert.equal(classifyDay(day(2026, 10, 2), monday), LAST_WEEK);
	});

	it("v lednu je minulý měsíc prosinec předchozího roku", () => {
		const friday = day(2026, 1, 2);
		assert.equal(classifyDay(day(2025, 12, 15), friday), LAST_MONTH);
		assert.equal(classifyDay(day(2025, 11, 30), friday), LAST_YEAR);
	});

	it("dny každého období navazují bez mezer a překryvů", () => {
		for (let today = day(2026, 1, 1); today <= day(2026, 12, 31); today++) {
			for (let offset = 0; offset < 800; offset++) {
				const date = today - offset;
				const bucket = classifyDay(date, today);
				const { start, end } = bucketWindow(bucket, today);
				assert.ok(start <= date && date < end, `den ${date} v období ${bucket} vůči ${today}`);
			}
		}
	});
});

describe("bucketWindow / latestDayOfBucket", () => {
	it("prázdné období vrací null", () => {
		// Ve středu: „dřív v tomto týdnu“ = pondělí, to je ale „předevčírem“.
		assert.equal(latestDayOfBucket(THIS_WEEK, WEDNESDAY), null);
		// 1.–4. 10. patří do „minulého týdne“, který začal dřív než měsíc.
		assert.equal(latestDayOfBucket(THIS_MONTH, WEDNESDAY), null);
	});

	it("nejnovější den období", () => {
		assert.equal(latestDayOfBucket(TODAY, WEDNESDAY), WEDNESDAY);
		assert.equal(latestDayOfBucket(YESTERDAY, WEDNESDAY), day(2026, 10, 6));
		assert.equal(latestDayOfBucket(LAST_WEEK, WEDNESDAY), day(2026, 10, 4));
		assert.equal(latestDayOfBucket(LAST_MONTH, WEDNESDAY), day(2026, 9, 27));
		assert.equal(latestDayOfBucket(LAST_YEAR, WEDNESDAY), day(2025, 12, 31));
	});

	it("nejnovější den období classifyDay() zařadí zpátky do téhož období", () => {
		for (let today = day(2026, 1, 1); today <= day(2026, 12, 31); today++) {
			BUCKETS.forEach((_bucket, index) => {
				const latest = latestDayOfBucket(index, today);
				if (latest !== null) assert.equal(classifyDay(latest, today), index);
			});
		}
	});
});

describe("estimateOpenedDay", () => {
	it("bez období skupiny je odhad den poslední aktivity, nejpozději dnes", () => {
		const args = { bucket: -1, referenceDay: WEDNESDAY, today: WEDNESDAY };
		assert.equal(estimateOpenedDay({ ...args, accessedDay: day(2026, 10, 3) }), day(2026, 10, 3));
		assert.equal(estimateOpenedDay({ ...args, accessedDay: day(2026, 10, 9) }), WEDNESDAY);
		assert.equal(estimateOpenedDay({ bucket: YESTERDAY, referenceDay: null, accessedDay: day(2026, 10, 3), today: WEDNESDAY }), day(2026, 10, 3));
	});

	it("karta ze skupiny „dnes“ ke dni referenceDay je z toho dne", () => {
		const monday = day(2026, 10, 5);
		assert.equal(estimateOpenedDay({ bucket: TODAY, referenceDay: monday, accessedDay: WEDNESDAY, today: WEDNESDAY }), monday);
	});

	it("odhad zůstane v rozsahu období skupiny", () => {
		assert.equal(
			estimateOpenedDay({ bucket: LAST_WEEK, referenceDay: WEDNESDAY, accessedDay: day(2026, 10, 6), today: WEDNESDAY }),
			day(2026, 10, 4)
		);
		assert.equal(
			estimateOpenedDay({ bucket: LAST_WEEK, referenceDay: WEDNESDAY, accessedDay: day(2026, 9, 1), today: WEDNESDAY }),
			day(2026, 9, 28)
		);
	});

	it("prázdné období skupiny se nepoužije", () => {
		assert.equal(
			estimateOpenedDay({ bucket: THIS_WEEK, referenceDay: WEDNESDAY, accessedDay: day(2026, 10, 2), today: WEDNESDAY }),
			day(2026, 10, 2)
		);
	});
});

describe("estimateUsedDay", () => {
	const base = { knownDay: null, openedDay: day(2026, 9, 1), accessedDay: null, active: false, bucket: -1, referenceDay: null, today: WEDNESDAY };

	it("aktivní karta je používaná dnes", () => {
		assert.equal(estimateUsedDay({ ...base, active: true }), WEDNESDAY);
	});

	it("nejpozdější známý den, nejpozději dnes", () => {
		assert.equal(estimateUsedDay({ ...base, knownDay: day(2026, 10, 3), accessedDay: day(2026, 10, 5) }), day(2026, 10, 5));
		assert.equal(estimateUsedDay({ ...base, knownDay: day(2026, 10, 6) }), day(2026, 10, 6));
		assert.equal(estimateUsedDay(base), day(2026, 9, 1));
		assert.equal(estimateUsedDay({ ...base, accessedDay: day(2026, 10, 9) }), WEDNESDAY);
	});

	it("neznámá karta ve skupině období je použitá nejdřív v jeho první den", () => {
		assert.equal(estimateUsedDay({ ...base, bucket: YESTERDAY, referenceDay: WEDNESDAY }), day(2026, 10, 6));
		// Známý den má přednost — období skupiny se pak nepoužije.
		assert.equal(estimateUsedDay({ ...base, knownDay: day(2026, 9, 1), bucket: YESTERDAY, referenceDay: WEDNESDAY }), day(2026, 9, 1));
	});
});

describe("normalizeGroupsConfig / toStoredGroupsConfig", () => {
	it("neplatné nastavení → výchozí názvy a barvy", () => {
		for (const value of [undefined, null, [], "x", 42]) {
			const config = normalizeGroupsConfig(value);
			assert.equal(config.length, BUCKETS.length);
			config.forEach((item, i) => {
				assert.deepEqual(item, { title: BUCKETS[i].title, color: BUCKETS[i].color, collapsed: false });
			});
		}
		assert.equal(normalizeGroupsConfig({})[TODAY].title, "today");
	});

	it("vlastní název, barva a uzavřená skupina", () => {
		const config = normalizeGroupsConfig({
			today: { title: "  Dnes  ", color: "red", collapsed: true },
			yesterday: { title: "", color: "black", collapsed: "yes" },
		});
		assert.deepEqual(config[TODAY], { title: "Dnes", color: "red", collapsed: true });
		assert.deepEqual(config[YESTERDAY], { title: "yesterday", color: BUCKETS[YESTERDAY].color, collapsed: false });
	});

	it("opakovaný název dostane výchozí název období, případně číslo", () => {
		const repeated = normalizeGroupsConfig({ today: { title: "X" }, yesterday: { title: "X" } });
		assert.equal(repeated[TODAY].title, "X");
		assert.equal(repeated[YESTERDAY].title, "yesterday");

		const taken = normalizeGroupsConfig({ today: { title: "yesterday" } });
		assert.equal(taken[TODAY].title, "yesterday");
		assert.equal(taken[YESTERDAY].title, "yesterday (2)");

		const titles = taken.map((item) => item.title);
		assert.equal(new Set(titles).size, titles.length);
	});

	it("uložený tvar je podle klíče období a jde zpátky přečíst", () => {
		const config = normalizeGroupsConfig({ lastYear: { title: "Staré", color: "pink", collapsed: true } });
		const stored = toStoredGroupsConfig(config);
		assert.deepEqual(Object.keys(stored), BUCKETS.map((bucket) => bucket.key));
		assert.deepEqual(stored.lastYear, { title: "Staré", color: "pink", collapsed: true });
		assert.deepEqual(normalizeGroupsConfig(stored), config);
	});

	it("DEFAULT_GROUPS dává výchozí nastavení", () => {
		assert.deepEqual(normalizeGroupsConfig(DEFAULT_GROUPS), normalizeGroupsConfig(undefined));
	});
});

describe("drobné normalizace", () => {
	it("normalizeTitlePrefix", () => {
		assert.equal(normalizeTitlePrefix("  ⓐ "), "ⓐ");
		assert.equal(normalizeTitlePrefix(""), "");
		assert.equal(normalizeTitlePrefix(undefined), DEFAULT_TITLE_PREFIX);
		assert.equal(normalizeTitlePrefix(5), DEFAULT_TITLE_PREFIX);
	});

	it("withTitlePrefix", () => {
		const items = [{ title: "today", color: "green" }];
		assert.deepEqual(withTitlePrefix(items, "ⓐ"), [{ title: "ⓐ today", color: "green" }]);
		assert.equal(withTitlePrefix(items, ""), items);
		assert.equal(items[0].title, "today");
	});

	it("normalizeGroupBy", () => {
		assert.equal(normalizeGroupBy("lastUsed"), "lastUsed");
		assert.equal(normalizeGroupBy("opened"), "opened");
		assert.equal(normalizeGroupBy("cokoliv"), "opened");
		assert.equal(normalizeGroupBy(undefined), "opened");
	});

	it("isGroupColor", () => {
		assert.equal(isGroupColor("red"), true);
		assert.equal(isGroupColor("grey"), true);
		assert.equal(isGroupColor("black"), false);
		assert.equal(isGroupColor(undefined), false);
	});

	it("každé období má jinou výchozí barvu", () => {
		const colors = BUCKETS.map((bucket) => bucket.color);
		assert.equal(new Set(colors).size, colors.length);
		assert.ok(colors.every(isGroupColor));
	});
});

describe("defaultTitlesIn", () => {
	it("výchozí názvy období v zadaném jazyce", async () => {
		const titles = await defaultTitlesIn("en");
		assert.deepEqual(titles, BUCKETS.map((bucket) => bucket.title));
		const czech = await defaultTitlesIn("cs");
		assert.equal(czech.length, BUCKETS.length);
		assert.notDeepEqual(czech, titles);
	});
});
