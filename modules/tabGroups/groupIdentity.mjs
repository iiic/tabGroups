//@ts-check
"use strict";

// modules/tabGroups/groupIdentity.mjs
// Jak modul pozná své skupiny v prohlížeči — čisté funkce bez DOM a bez
// chrome.*, sdílené background částí (background-script.mjs), plánovačem
// (planner.mjs) i elementem (tabGroups.mjs).
//
// Cíl skupiny má stálý klíč, nezávislý na názvu i pořadí: "period:<klíč
// období>" (BUCKETS) a "bookmarks:<id řádku>" (skupiny ze záložek). Skupina
// modulu se pozná (findOurGroups()):
//   1. podle čísla skupiny — evidence GROUP_IDS_KEY { [id skupiny]: { key,
//      title, day } }, kterou zapisuje každý průchod (rememberGroups()).
//      Platí, jen dokud má skupina název, který jí dal modul: skupinu, kterou
//      uživatel v liště přejmenuje, si tím vezme za svou. Firefox nechává
//      skupině číslo i po restartu prohlížeče (odvozuje ho z vnitřního id,
//      které ukládá do relace — ověřeno ve verzi 157), Chrome obnoveným
//      skupinám dá nová čísla,
//   2. podle názvu z Nastavení (období, pak skupiny ze záložek),
//   3. podle kteréhokoliv názvu, který modul skupinám kdy dal
//      (KNOWN_TITLES_KEY, rememberTitles()) — v Chrome po restartu a po změně
//      předpony, názvů nebo jazyka rozhraní, i když se jich sešlo víc najednou.
//      Poprvé se seznam naplní i názvy, které skupiny mohly mít před jeho
//      zavedením (earlierTitles()).
// Skupina uživatele, která se jmenuje jako skupina modulu (i dřívějším
// názvem), se tak pozná jako skupina modulu.
import { BUCKETS, DEFAULT_TITLE_PREFIX } from "./buckets.mjs";

const PERIOD_KEY_PREFIX = "period:";
const BOOKMARKS_KEY_PREFIX = "bookmarks:";
// Záznam skupiny, kterou průchod nevidí (zavřené okno, ve Firefoxu uložená a
// zavřená skupina), zůstane v evidenci tolik dní od posledního průchodu, který
// ji viděl.
const GROUP_IDS_MAX_AGE_DAYS = 60;
// Kolik naposledy použitých názvů si modul pamatuje.
const KNOWN_TITLES_MAX = 500;
// Předpony, se kterými mohly skupiny vzniknout před seznamem názvů: žádná
// (verze bez předpony) a "𓃭" (první výchozí předpona). K nim se přidá
// současná výchozí a předpona z Nastavení.
const EARLIER_TITLE_PREFIXES = ["", "𓃭"];

// Klíče cílů v pořadí plánovače (období, pak skupiny ze záložek) a jejich
// názvy z Nastavení (s předponou, jak je skupiny mají v prohlížeči).
/** @type {Functions.TabGroups.GroupIdentity.describeTargets} */
export function describeTargets(config, bookmarkGroups) {
	return {
		keys: [...BUCKETS.map((bucket) => PERIOD_KEY_PREFIX + bucket.key), ...bookmarkGroups.map((group) => BOOKMARKS_KEY_PREFIX + group.id)],
		titles: [...config.map((item) => item.title), ...bookmarkGroups.map((group) => group.title)],
	};
}

// Skupiny modulu → klíč jejich cíle (pořadí přednosti viz úvodní komentář).
// Klíč může patřit cíli, který v Nastavení už není (odebraný řádek skupin ze
// záložek) — skupina je pořád skupina modulu a karty z ní se rozejdou jinam.
// Sdílené skupiny (Chrome) jsou vždy skupiny uživatele.
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

// Klíče cílů → pořadí cílů v plánovači (index v keys). Cíl, který v Nastavení
// už není, dostane keys.length — za všemi cíli.
/** @type {Functions.TabGroups.GroupIdentity.toTargets} */
export function toTargets(ours, keys) {
	const indexOf = new Map(keys.map((key, i) => [key, i]));
	return new Map([...ours].map(([groupId, key]) => [groupId, indexOf.get(key) ?? keys.length]));
}

// Evidence skupin po průchodu: skupiny modulu (ours, ze snímku po změnách)
// s názvem, který opravdu mají, a dnem today. Skupina, kterou průchod nevidí,
// v evidenci zůstane GROUP_IDS_MAX_AGE_DAYS dní; skupina, která je vidět, ale
// modulu nepatří (uživatel ji přejmenoval), vypadne.
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

// Uložená evidence skupin → jen platné záznamy.
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

// Uložený seznam názvů ([název, klíč cíle], nejnovější na konci) → platné
// dvojice, nebo null, když ještě uložený není (pak ho naplní earlierTitles()).
/** @type {Functions.TabGroups.GroupIdentity.readKnownTitles} */
export function readKnownTitles(value) {
	if (!Array.isArray(value)) return null;
	return value.filter(
		/** @returns {item is [string, string]} */
		(item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && item[0] !== "" && typeof item[1] === "string"
	);
}

// Seznam názvů doplněný o entries ([název, klíč cíle]): nový název, nebo
// název, který teď patří jinému cíli, se přesune na konec; nejstarší nad
// KNOWN_TITLES_MAX vypadnou. Beze změny vrací tentýž seznam.
/** @type {Functions.TabGroups.GroupIdentity.rememberTitles} */
export function rememberTitles(knownTitles, entries) {
	let list = knownTitles;
	for (const [title, key] of entries) {
		if (!title || list.some(([known, knownKey]) => known === title && knownKey === key)) continue;
		list = [...list.filter(([known]) => known !== title), [title, key]];
	}
	return list.length > KNOWN_TITLES_MAX ? list.slice(-KNOWN_TITLES_MAX) : list;
}

// Názvy, které skupiny modulu mohou mít z doby před seznamem názvů: každý
// základní název cíle (baseTitles: výchozí názvy období ve všech jazycích
// rozhraní a název z Nastavení — bez předpony) bez předpony, s dřívější,
// výchozí i současnou předponou (prefix), a názvy z posledního zařazení
// starší verze (appliedTitles podle období, appliedBookmarkTitles podle id
// řádku — ty mají přednost).
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
