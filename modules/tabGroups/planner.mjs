//@ts-check
"use strict";

// modules/tabGroups/planner.mjs
// Plánování změn skupin karet v jednom okně — čisté funkce nad popisem karet
// a skupin (bez chrome.*), výsledek provede background-script.mjs. Díky tomu
// jde celé rozhodování ověřit i mimo prohlížeč.
//
// Skupiny modulu jsou "cíle" s pořadovým číslem: 0–8 období (index
// v BUCKETS), od BUCKETS.length skupiny ze záložek v pořadí z Nastavení
// (bookmarkGroups.mjs). Které skupiny v prohlížeči jsou modulu, rozhoduje
// groupIdentity.mjs.
import { BUCKETS, GROUP_BY_LAST_USED, classifyDay, estimateOpenedDay, estimateUsedDay, isRealisticTime, latestDayOfBucket } from "./buckets.mjs";
import { describeTargets, findOurGroups, toTargets } from "./groupIdentity.mjs";

// groupId karty, která není v žádné skupině (tabGroups.TAB_GROUP_ID_NONE).
export const TAB_GROUP_ID_NONE = -1;

// Změny v jednom okně, aby každá karta, která není připnutá ani ve skupině
// uživatele, byla ve skupině svého cíle — skupiny ze záložek, do které patří
// její adresa (bookmarkOf(), přednost má první), jinak období svého dne — dne
// otevření, nebo (groupBy "lastUsed") dne posledního použití:
//   - den otevření: zapamatovaný (openedDays), jinak odhad (estimateOpenedDay()),
//   - den posledního použití: estimateUsedDay() — aktivní karta okna dnes,
//     jinak nejpozdější známý den (usedDays, den otevření, poslední aktivita),
//   - s volbou přetahování karet (manualMoves) má přednost ruční den karty
//     (manualDays): karta, která je v jiné skupině než po minulém průchodu
//     (lastGroups) — tam ji přetáhl uživatel, modul by ji zapsal —, dostane
//     ve skupině období nejnovější den toho období (latestDayOfBucket()),
//     takže v ní zůstane a o půlnoci se posune s ostatními. Karta přetažená
//     zpátky do skupiny svého dne, mimo skupiny období nebo patřící do
//     skupiny ze záložek ruční den ztratí,
//   - každý cíl dostane jednu skupinu — přednostně tu, která už má nejvíc
//     jeho karet. Skupina, jejíž karty přešly do dalšího období (o půlnoci
//     celá "dnes" → "včera"), se tak jen přejmenuje a přebarví a karty se
//     nepřesouvají. Skupina, na kterou cíl nezbyde, se vyprázdní a prohlížeč
//     ji sám zruší,
//   - cíl bez skupiny dostane novou — se zaškrtnutou „uzavřenou skupinou“
//     sbalenou (když v ní není aktivní karta okna). Existující skupiny
//     modul nesbaluje ani nerozbaluje, to nechává na uživateli.
// Vrací i dny otevření a posledního použití všech karet, které modul spravuje
// (k uložení) — oba v obou režimech a i u karet ve skupinách ze záložek, ať
// přepnutí v Nastavení i odchod ze záložky hned sedí —, a ruční dny karet
// okna (bez volby přetahování žádné).
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
	// Období skupiny, ve které karta je, nebo -1 (bez skupiny, skupina
	// uživatele nebo ze záložek).
	/** @type {Functions.TabGroups.Planner.planWindow.periodOf} */
	const periodOf = (tab) => {
		const target = ourGroups.get(tab.groupId) ?? -1;
		return target < BUCKETS.length ? target : -1;
	};
	// Přesunul kartu od minulého průchodu někdo jiný než modul?
	/** @type {Functions.TabGroups.Planner.planWindow.movedByUser} */
	const movedByUser = (tab) => manualMoves && Number.isInteger(lastGroups[tab.id]) && lastGroups[tab.id] !== tab.groupId;
	// Ruční dny zůstávají i kartám, které modul nespravuje (připnuté, skryté,
	// ve skupině uživatele) — kromě těch, které uživatel přesunul mimo
	// skupiny období.
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
		// Období skupiny, ve které karta je (odhad dnů neznámých karet) —
		// skupina ze záložek o dni nic neříká.
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
			// Skupina ze záložek má přednost i před přetažením.
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

	// Kolik karet každé skupiny modulu patří do kterého cíle, a kde skupina
	// začíná (při shodě se dává přednost skupině víc vlevo — stabilní výsledek).
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
			// „uzavřená skupina“ vznikne sbalená — jen když v ní není aktivní
			// karta okna: sbalení by prohlížeč přepnul na jinou kartu.
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

// Pořadí cíle zleva doprava: skupiny ze záložek v pořadí z Nastavení, za nimi
// období od nejstaršího po nejnovější ("dnes" úplně vpravo).
/** @type {Functions.TabGroups.Planner.targetRank} */
export function targetRank(target, bookmarkCount) {
	return target >= BUCKETS.length ? target - BUCKETS.length : bookmarkCount + BUCKETS.length - 1 - target;
}

// Pořadí skupin modulu v okně: úplně vpravo, za všemi ostatními kartami
// (skupiny uživatele, karty bez skupiny), v pořadí targetRank(). Vrací
// skupiny, které je potřeba v tomhle pořadí postupně přesunout na konec okna
// — nebo prázdné pole, když pořadí sedí (pak se nehýbe ničím).
// targetOfGroup: skupina modulu → cíl (toTargets()); skupina zrušeného
// řádku skupin ze záložek (cíl za posledním) se nepřesouvá.
/** @type {Functions.TabGroups.Planner.planOrder} */
export function planOrder(tabs, targetOfGroup, bookmarkCount) {
	// Lišta karet jako posloupnost bloků: celá skupina, nebo jedna karta bez
	// skupiny. Připnuté karty stojí vždy vlevo, pořadí se netýkají.
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
