//@ts-check
"use strict";

// modules/tabGroups/background-script.mjs
// Background část modulu tabGroups (viz registerBackgroundScript() v sdk.mjs)
// — běží v background.js, takže karty řadí i bez otevřené stránky rozšíření.
//
// Jeden průchod (reconcile()) v každém okně:
//   1. Každé kartě, která není připnutá ani ve skupině uživatele, určí den
//      otevření: zapamatovaný (karta otevřená, když modul běžel), jinak odhad
//      (estimateOpenedDay() v buckets.mjs), a den posledního použití
//      (estimateUsedDay() — aktivní karta okna je používaná dnes).
//   2. Zařadí ji do skupiny ze záložek, když je její adresa záložkou ve
//      složce některé z nich (bookmarkGroups.mjs), jinak do skupiny období
//      podle dne otevření, nebo (nastavení GROUP_BY_KEY) dne posledního
//      použití (planWindow() v planner.mjs). S volbou přetahování karet
//      (MANUAL_MOVES_KEY) platí přednostně ruční den karty, kterou uživatel
//      přetáhl do skupiny jiného období. Skupina, jejíž karty přešly do
//      dalšího období (o půlnoci celá "dnes" → "včera"), se jen přejmenuje
//      a přebarví.
//   3. Skupiny modulu seřadí vpravo za všechny ostatní karty: skupiny ze
//      záložek, pak období od nejstaršího po nejnovější (planOrder()).
// Skupiny modulu se poznají podle čísla z evidence (GROUP_IDS_KEY), jinak
// podle názvu z Nastavení (s předponou, TITLE_PREFIX_KEY) nebo kteréhokoliv
// dřív použitého (KNOWN_TITLES_KEY), viz groupIdentity.mjs. Skupiny uživatele,
// připnuté a skryté karty modul nemění.
//
// Kdy: po otevření karty, po změně skupiny nebo připnutí karty, při řazení
// podle posledního použití i po přepnutí karty, se skupinami ze záložek i po
// změně adresy karty a po změně záložek, po změně skupin (vznik, název,
// barva, přesun), po změně nastavení nebo seznamu modulů, při startu
// prohlížeče a po udělení oprávnění — vždy s krátkým odstupem, ať se série
// událostí (i těch, které vyvolají změny samotného modulu) sejde do jednoho
// průchodu. O půlnoci průchod spustí budík (chrome.alarms). Bez oprávnění
// "alarms" se nový den projeví při první další práci s kartami (přepnutí karty
// nebo okna). Na žádost elementu skupiny modulu zablikají (identifyGroups()).
//
// Dny otevření a posledního použití karet drží api.sessionState — id karet
// platí jen do restartu prohlížeče, pak se úložiště samo vyprázdní a obnoveným
// kartám se dny odhadnou podle období skupiny, ve které jsou (proto api.state
// pamatuje den posledního zařazení, evidenci skupin a použité názvy).
//
// Přetažení karty uživatelem (volba MANUAL_MOVES_KEY): průchod si zapíše
// skupinu každé karty tak, jak ji nechal (LAST_GROUPS_KEY). Karta, která je
// při dalším průchodu jinde, se přesunula bez modulu — ve skupině období
// dostane ruční den (MANUAL_DAYS_KEY, viz planWindow()). Při řazení podle
// posledního použití ruční den skončí, jakmile se uživatel na kartu znovu
// přepne (samotné přetažení kartu vybere ještě před přesunem do skupiny).
import { UI_LANGUAGES, loadI18n, onUiLanguageChange, registerBackgroundScript } from "../../sdk.mjs";
import {
	MODULE_NAME,
	ACTIVATION_SPEC,
	DEFAULT_ACTIVATION_MODE,
	GROUPS_KEY,
	GROUP_BY_KEY,
	BOOKMARK_GROUPS_KEY,
	REGROUP_MESSAGE,
	IDENTIFY_MESSAGE,
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

// Kdy začala tahle instance rozšíření (api.sessionState — start prohlížeče,
// znovunačtení nebo aktualizace rozšíření ho vyprázdní).
const INSTANCE_KEY = "instanceStartedAt";
// Budík na nejbližší půlnoc (chrome.alarms).
const ALARM_NAME = "tabGroups.midnight";
// Odstup průchodu od poslední události.
const DEBOUNCE_MS = 400;
// Prvních STARTUP_GRACE_MS po startu prohlížeče nebo rozšíření prohlížeč
// obnovuje karty minulé relace: ty nejsou nově otevřené (den otevření se jim
// odhadne) a průchod čeká déle, ať obnova stihne doběhnout.
const STARTUP_GRACE_MS = 60 * 1000;
const STARTUP_DEBOUNCE_MS = 3000;
// Karta, kterou prohlížeč ohlásí jako novou, ale aktivní byla naposledy před
// víc než NEW_TAB_MAX_AGE_MS (obnovená relace, znovu otevřená zavřená karta),
// není otevřená teď.
const NEW_TAB_MAX_AGE_MS = 2 * 60 * 1000;
// Pojistka proti zacyklení: když se LOOP_REPEATS× po sobě (s odstupem pod
// LOOP_WINDOW_MS) opakují úplně stejné změny, prohlížeč je nejspíš nepřijímá
// (nebo je uživatel pořád vrací) — na LOOP_PAUSE_MS se přestane reagovat na
// změny karet a skupin.
const LOOP_REPEATS = 3;
const LOOP_WINDOW_MS = 10 * 1000;
const LOOP_PAUSE_MS = 60 * 1000;
// Zablikání skupin modulu (tlačítko „Identifikovat řízené skupiny“): kolikrát
// a jak dlouho trvá jedna barva.
const BLINK_TIMES = 3;
const BLINK_STEP_MS = 500;
// Žádná skupina ze záložek (bez skupin, bez oprávnění).
/** @type {Types.TabGroups.BookmarkMatcher} */
const NO_BOOKMARK_GROUP = () => -1;

// Barva, se kterou skupina při zablikání střídá svou: šedá, u šedé skupiny
// azurová.
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

// Seznam názvů skupin poprvé (KNOWN_TITLES_KEY ještě není uložený) — názvy,
// které skupiny modulu mohou mít z dřívějška (earlierTitles()): výchozí názvy
// období ve všech jazycích rozhraní a názvy z Nastavení, s dřívějšími
// předponami, a názvy z posledního zařazení starší verze.
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
		// Jen Firefox (tabs.hide()) — skryté karty modul nechává být.
		hidden: /** @type {{ hidden?: boolean }} */ (tab).hidden === true,
		// Bez oprávnění "tabs" prohlížeč adresu neprozradí. Karta, která se
		// teprve načítá, má v Chrome cílovou adresu v pendingUrl.
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

// Zkusí jednu změnu v prohlížeči; chyba (karta nebo skupina mezitím zanikla,
// ...) se jen zaloguje a průchod pokračuje.
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

// Karty do skupiny groupId, nebo (bez groupId) do nové skupiny v okně
// windowId. Když prohlížeč odmítne celou dávku (jedna karta mezitím zanikla),
// zkusí se karty po jedné. Vrací id skupiny, nebo null.
/** @type {Functions.TabGroups.BackgroundScript.groupTabs} */
async function groupTabs(tabIds, groupId, windowId) {
	/** @type {Functions.TabGroups.BackgroundScript.groupTabs.group} */
	const group = (ids, target) => {
		// Plánovač posílá jen neprázdné seznamy karet.
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

// Provede plán jednoho okna (planWindow()). Vrací popis všech pokusů o změnu
// (pro pojistku proti zacyklení; prázdné pole = nebylo co měnit) a nové
// skupiny s jejich cílem — do evidence skupin patří, i kdyby je prohlížeč
// odmítl pojmenovat.
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

// Karty ze všech běžných oken a všechny skupiny.
/** @type {Functions.TabGroups.BackgroundScript.snapshot} */
async function snapshot() {
	const [tabs, groups] = await Promise.all([chrome.tabs.query({ windowType: "normal" }), chrome.tabGroups.query({})]);
	return { tabs: tabs.filter((tab) => typeof tab.id === "number").map(toTabInfo), groups: groups.map(toGroupInfo) };
}

// Budík na nejbližší místní půlnoc (o sekundu později, ať je nový den jistě
// tady). Prohlížeč ho odloží, když počítač o půlnoci spí.
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
		// Průchody i zápisy dnů otevření jdou za sebou.
		/** @type {Promise<unknown>} */
		let chain = Promise.resolve();
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let timer;
		// Den posledního průchodu (jen v paměti — po probuzení service workeru
		// průchod proběhne tak jako tak).
		/** @type {number | null} */
		let lastDay = null;
		// Má přepnutí karty spustit průchod? Jen u zapnutého modulu, který řadí
		// podle posledního použití (nastavuje každý průchod); null, dokud po
		// startu service workeru žádný neproběhl.
		/** @type {boolean | null} */
		let passOnActivation = null;
		// Má změna adresy karty nebo záložek spustit průchod? Jen u zapnutého
		// modulu se skupinami ze záložek; null jako u passOnActivation.
		/** @type {boolean | null} */
		let passOnUrlChange = null;
		// Porovnání adres se záložkami pro poslední skupiny ze záložek —
		// staví se znovu po změně skupin v Nastavení, záložek nebo oprávnění.
		// generation brání uložení porovnání postaveného ze starých záložek.
		/** @type {{ key: string, match: Types.TabGroups.BookmarkMatcher } | null} */
		let bookmarkCache = null;
		let bookmarkGeneration = 0;
		// Karty otevřené od posledního průchodu: id → den otevření.
		/** @type {Map<number, number>} */
		const pendingOpened = new Map();
		// Karty, na které se uživatel od posledního průchodu přepnul (jen při
		// řazení podle posledního použití) — končí jejich ruční den.
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

		// Změna karet nebo skupin — průchod, pokud reakci nepozastavila pojistka
		// proti zacyklení (noteRun()).
		/** @type {Functions.TabGroups.BackgroundScript.onTabsChanged} */
		function onTabsChanged() {
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

		// Porovnání adres karet se záložkami skupin ze záložek. Bez oprávnění
		// "bookmarks" (chrome.bookmarks chybí) žádná karta do skupiny ze
		// záložek nepatří; složka, která zmizela, nic neobsahuje.
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

		// Záložky nebo oprávnění se změnily — porovnání se postaví znovu.
		/** @type {Functions.TabGroups.BackgroundScript.forgetBookmarks} */
		function forgetBookmarks() {
			bookmarkGeneration++;
			bookmarkCache = null;
		}

		// Cíle skupin z Nastavení a podle čeho se poznají skupiny modulu
		// (groupIdentity.mjs): evidence čísel skupin a všechny použité názvy —
		// doplněné o současné názvy z Nastavení, poprvé i o názvy z dřívějška.
		// Výchozí názvy jsou v jazyce rozhraní (loadI18n() předem).
		/** @type {Functions.TabGroups.BackgroundScript.readTargets} */
		async function readTargets() {
			// Skupiny v prohlížeči mají názvy z Nastavení s předponou.
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

			// Výchozí názvy skupin jsou v jazyce rozhraní.
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
			// Nové skupiny → klíč cíle.
			/** @type {Map<number, string>} */
			const created = new Map();
			let current = await snapshot();
			// Skupiny karet před průchodem a karty, se kterými průchod hýbal
			// (pro LAST_GROUPS_KEY).
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
			// Skupiny modulu po změnách: přejmenované se poznají podle názvu
			// z Nastavení, nové i podle čísla (kdyby se je nepovedlo pojmenovat).
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

			// Dny otevření a použití jen karet, které pořád existují — i těch ve
			// skupinách uživatele (kdyby je uživatel ze skupiny zase vyndal).
			/** @type {Record<string, number>} */
			const nextDays = {};
			/** @type {Record<string, number>} */
			const nextUsedDays = {};
			/** @type {Record<string, number>} */
			const nextManualDays = {};
			// Skupina, ve které průchod kartu nechal: u karet, se kterými hýbal,
			// podle posledního snímku, u ostatních podle prvního — kdyby je
			// uživatel přesunul během průchodu, pozná se to při dalším.
			// Karty otevřené během průchodu se zapíšou až příště.
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
			// Bez volby přetahování zůstanou oba záznamy prázdné — po jejím
			// zapnutí se přetažení počítají až od prvního průchodu.
			if (!sameDays(storedLastGroups, nextLastGroups)) {
				await api.sessionState.set(LAST_GROUPS_KEY, nextLastGroups).catch((err) => console.warn("tabGroups: skupiny karet nejde uložit:", err));
			}
			if (!sameDays(storedManualDays, nextManualDays)) {
				await api.sessionState.set(MANUAL_DAYS_KEY, nextManualDays).catch((err) => console.warn("tabGroups: ruční dny karet nejde uložit:", err));
			}
			if (referenceDay !== today) {
				await api.state.set(REFERENCE_DAY_KEY, today);
			}
			// Evidence skupin s názvy, které skupiny po průchodu opravdu mají
			// (den průchodu se mění jednou za den — častěji se nezapisuje).
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

		// Tlačítko „Identifikovat řízené skupiny“: skupiny, které modul řídí
		// (ve všech oknech), BLINK_TIMES× vystřídají svou barvu s blinkColor()
		// a nakonec ji dostanou zpátky. Běží ve frontě jako průchod — průchod
		// vyvolaný změnami barev počká, až zablikání skončí, a barvy mezitím
		// „neopraví“.
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
				// Skupina mezitím mohla zaniknout — ostatní blikají dál.
				await Promise.all(
					blinking.map((group) => chrome.tabGroups.update(group.id, { color: flash ? blinkColor(group.color) : group.color }).catch(() => undefined))
				);
			}
			return { ok: true, count: blinking.length };
		}

		// --- Posluchače: synchronně, ať je prohlížeč doručí i probuzenému service workeru ---

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
			// Nová adresa karty může patřit do jiné skupiny ze záložek (nebo už
			// do žádné).
			if ("groupId" in changeInfo || "pinned" in changeInfo || ("url" in changeInfo && passOnUrlChange !== false)) onTabsChanged();
		});
		chrome.tabs.onAttached.addListener(() => onTabsChanged());
		// Karta, na kterou se uživatel přepne, je při řazení podle posledního
		// použití používaná dnes — průchod ji přesune do "dnes" (i přetaženou
		// do jiné skupiny, viz pendingActivated).
		chrome.tabs.onActivated.addListener(({ tabId }) => {
			if (passOnActivation !== false) {
				pendingActivated.add(tabId);
				onTabsChanged();
			}
		});

		// Bez budíku (oprávnění "alarms") se nový den pozná při práci s kartami.
		if (!chrome.alarms) {
			const checkDay = () => {
				if (lastDay !== null && localDay(Date.now()) !== lastDay) onTabsChanged();
			};
			chrome.tabs.onActivated.addListener(checkDay);
			if (chrome.windows && chrome.windows.onFocusChanged) chrome.windows.onFocusChanged.addListener(checkDay);
		}

		// chrome.tabGroups, chrome.bookmarks a chrome.alarms jsou jen
		// s (nepovinným) oprávněním — jejich posluchače se zaregistrují hned,
		// nebo až po jeho udělení.
		let groupEventsAttached = false;
		let alarmAttached = false;
		let bookmarkEventsAttached = false;
		/** @type {Functions.TabGroups.BackgroundScript.attachOptionalListeners} */
		function attachOptionalListeners() {
			if (!groupEventsAttached && chrome.tabGroups) {
				chrome.tabGroups.onCreated.addListener(() => onTabsChanged());
				chrome.tabGroups.onUpdated.addListener(() => onTabsChanged());
				chrome.tabGroups.onMoved.addListener(() => onTabsChanged());
				groupEventsAttached = true;
			}
			if (!bookmarkEventsAttached && chrome.bookmarks) {
				const onBookmarksChanged = () => {
					forgetBookmarks();
					if (passOnUrlChange !== false) onTabsChanged();
				};
				// onChildrenReordered a onImportEnded Firefox nemá.
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
				schedule();
			});
		}
		if (chrome.permissions && chrome.permissions.onRemoved) {
			chrome.permissions.onRemoved.addListener(() => {
				forgetBookmarks();
				schedule();
			});
		}
		chrome.runtime.onStartup.addListener(() => schedule());
		chrome.runtime.onInstalled.addListener(() => schedule());
		// Řazení, názvy a barvy v Nastavení, vypnutí/zapnutí modulu, seznam modulů.
		api.activation.onChange(() => schedule());
		// Jiný jazyk rozhraní — skupiny s výchozími názvy se přejmenují.
		onUiLanguageChange(() => schedule());

		// Tlačítko „Přeskupit teď“ v elementu — průchod hned, odpověď po něm.
		api.messages.on(REGROUP_MESSAGE, (_message, _sender, sendResponse) => {
			clearTimeout(timer);
			timer = undefined;
			enqueue(reconcile).then(sendResponse, (err) =>
				sendResponse({ ok: false, reason: "error", error: /** @type {Error} */ (err).message || String(err) })
			);
			return true;
		});

		// Tlačítko „Identifikovat řízené skupiny“ — odpověď po zablikání.
		api.messages.on(IDENTIFY_MESSAGE, (_message, _sender, sendResponse) => {
			enqueue(identifyGroups).then(sendResponse, (err) =>
				sendResponse({ ok: false, reason: "error", error: /** @type {Error} */ (err).message || String(err) })
			);
			return true;
		});

		// Průchod po každém startu service workeru — dožene, co se změnilo, když
		// spal (třeba propásnutá půlnoc).
		schedule();
	},
});
