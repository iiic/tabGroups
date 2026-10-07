//@ts-check
"use strict";

// modules/tabGroups/bookmarkGroups.mjs
// Automatické skupiny ze záložek — bez DOM a bez chrome.*, sdílené background
// částí (background-script.mjs), plánovačem (planner.mjs), editorem nastavení
// (bookmarkGroupsEditor.mjs) i elementem (tabGroups.mjs).
//
// Skupina ze záložek je řádek nastavení (BOOKMARK_GROUPS_KEY v module.mjs):
// název skupiny, složka záložek, barva, volba „všechny url na doméně
// záložky“ a „uzavřená skupina“ (nová skupina vznikne sbalená). Karta do skupiny patří, když je její adresa záložkou kdekoliv ve
// složce (i v podsložkách) — porovnává se celá adresa bez části za "#" —,
// nebo se zaškrtnutou volbou, když je na doméně některé záložky ze složky
// (jen http/https; "www." na začátku se nepočítá: záložka some.tld platí pro
// some.tld/cokoliv i www.some.tld/cokoliv, ne pro jiné subdomény). Skupiny ze
// záložek mají přednost před obdobími; karta, která patří do víc skupin, jde
// do první v pořadí z Nastavení.
import { t } from "../../sdk.mjs";
import { GROUP_COLORS, isGroupColor } from "./buckets.mjs";

// Oprávnění skupin ze záložek: "bookmarks" (obsah složek) a "tabs" (adresy
// všech karet — bez něj je prohlížeč neprozradí). Obě jsou v manifestu
// nepovinná, v Chrome s varováním.
/** @type {Types.PermissionSet} */
export const BOOKMARK_GROUPS_PERMISSIONS = { permissions: ["bookmarks", "tabs"] };

// Název skupiny, když ho uživatel nevyplní a složka název nemá.
/** @type {Functions.TabGroups.BookmarkGroups.fallbackTitle} */
const fallbackTitle = () => t("tabGroups_bookmarks_fallback_title");

// Výchozí barva řádku podle pořadí — jiná než u sousedních řádků.
/** @type {Functions.TabGroups.BookmarkGroups.defaultBookmarkColor} */
export function defaultBookmarkColor(index) {
	return GROUP_COLORS[(index + 1) % GROUP_COLORS.length].value;
}

// Uložené nastavení (pole řádků editoru) → vždy použitelné pole. Řádky, které
// nejsou objekt, vypadnou; chybějící nebo opakované id dostane náhradní (id
// spojuje skupinu v prohlížeči s řádkem i po přejmenování, viz
// groupIdentity.mjs). Název zůstává, jak ho uživatel zadal (prázdný =
// název složky, viz resolveBookmarkGroups()). Řádek bez složky se uloží, ale
// nepoužije.
/** @type {Functions.TabGroups.BookmarkGroups.normalizeBookmarkGroups} */
export function normalizeBookmarkGroups(value) {
	/** @type {Types.TabGroups.BookmarkGroupSetting[]} */
	const groups = [];
	/** @type {Set<string>} */
	const ids = new Set();
	const items = Array.isArray(value) ? value : [];
	items.forEach((item, index) => {
		if (!item || typeof item !== "object") return;
		const row = /** @type {Record<string, unknown>} */ (item);
		let id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `auto-${index}`;
		for (let n = 2; ids.has(id); n++) id = `${id}-${n}`;
		ids.add(id);
		groups.push({
			id,
			title: typeof row.title === "string" ? row.title.trim() : "",
			folderId: typeof row.folderId === "string" ? row.folderId : "",
			folderTitle: typeof row.folderTitle === "string" ? row.folderTitle : "",
			wholeDomain: row.wholeDomain === true,
			color: isGroupColor(row.color) ? row.color : defaultBookmarkColor(index),
			collapsed: row.collapsed === true,
		});
	});
	return groups;
}

// Název skupiny řádku: zadaný, jinak název složky.
/** @type {Functions.TabGroups.BookmarkGroups.bookmarkGroupTitle} */
export function bookmarkGroupTitle(setting) {
	return setting.title || setting.folderTitle.trim() || fallbackTitle();
}

// Skupiny ze záložek, které se opravdu použijí (řádky s vybranou složkou),
// s názvy odlišnými od sebe navzájem i od názvů období (takenTitles) — modul
// své skupiny v prohlížeči pozná podle názvu. Opakovaný název dostane
// pořadové číslo.
/** @type {Functions.TabGroups.BookmarkGroups.resolveBookmarkGroups} */
export function resolveBookmarkGroups(settings, takenTitles) {
	const used = new Set(takenTitles);
	return settings
		.filter((setting) => setting.folderId)
		.map((setting) => {
			const wanted = bookmarkGroupTitle(setting);
			let title = wanted;
			for (let n = 2; used.has(title); n++) title = `${wanted} (${n})`;
			used.add(title);
			return { ...setting, title };
		});
}

// Popis skupiny pro přehled v elementu („Karty …: 3“).
/** @type {Functions.TabGroups.BookmarkGroups.describeBookmarkGroup} */
export function describeBookmarkGroup(group) {
	const folder = group.folderTitle.trim() || fallbackTitle();
	return group.wholeDomain ? t("tabGroups_bookmarks_describe_domain", folder) : t("tabGroups_bookmarks_describe_folder", folder);
}

// Adresa bez části za "#" v jednotném tvaru (malá písmena hostitele, bez
// výchozího portu) — tak se porovnává karta se záložkou. Neplatná adresa
// null.
/** @type {Functions.TabGroups.BookmarkGroups.pageKey} */
export function pageKey(url) {
	if (typeof url !== "string" || !url) return null;
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		return parsed.href;
	} catch {
		return null;
	}
}

// Doména adresy pro volbu „všechny url na doméně záložky“: hostitel http(s)
// adresy bez koncové tečky a bez "www." na začátku; jinak null.
/** @type {Functions.TabGroups.BookmarkGroups.siteOf} */
export function siteOf(url) {
	if (typeof url !== "string" || !url) return null;
	try {
		const { protocol, hostname } = new URL(url);
		if (protocol !== "http:" && protocol !== "https:") return null;
		return hostname.replace(/\.$/, "").replace(/^www\./, "") || null;
	} catch {
		return null;
	}
}

// Adresy všech záložek v uzlech stromu záložek (i v podsložkách) —
// z chrome.bookmarks.getSubTree(složka).
/** @type {Functions.TabGroups.BookmarkGroups.collectBookmarkUrls} */
export function collectBookmarkUrls(nodes) {
	/** @type {string[]} */
	const urls = [];
	/** @type {Functions.TabGroups.BookmarkGroups.collectBookmarkUrls.walk} */
	const walk = (node) => {
		if (node.url) urls.push(node.url);
		for (const child of node.children || []) walk(child);
	};
	nodes.forEach(walk);
	return urls;
}

// Funkce adresa karty → pořadí skupiny ze záložek (index v groups), nebo -1.
// urlsByGroup: adresy záložek složky každé skupiny (collectBookmarkUrls()).
/** @type {Functions.TabGroups.BookmarkGroups.createBookmarkMatcher} */
export function createBookmarkMatcher(groups, urlsByGroup) {
	const rules = groups.map((group, i) => {
		const urls = urlsByGroup[i] || [];
		return {
			pages: new Set(urls.map(pageKey).filter((key) => key !== null)),
			sites: group.wholeDomain ? new Set(urls.map(siteOf).filter((site) => site !== null)) : new Set(),
		};
	});
	return (url) => {
		const key = pageKey(url);
		if (key === null) return -1;
		const site = siteOf(url);
		return rules.findIndex((rule) => rule.pages.has(key) || (site !== null && rule.sites.has(site)));
	};
}

// Složky záložek pro výběr v editoru: každá složka stromu (bez neviditelného
// kořene) s cestou, v pořadí stromu — složka, hned za ní její podsložky.
// Chrome se záložkami v účtu má kořenové složky dvakrát se stejným názvem (v
// účtu a jen v zařízení) — rozliší je syncing (Chrome 134+).
/** @type {Functions.TabGroups.BookmarkGroups.listBookmarkFolders} */
export function listBookmarkFolders(tree) {
	/** @type {Types.TabGroups.BookmarkFolder[]} */
	const folders = [];
	/** @type {Functions.TabGroups.BookmarkGroups.listBookmarkFolders.add} */
	const add = (node, title, path) => {
		folders.push({ id: node.id, title, label: [...path, title].join(" › ") });
		for (const child of node.children || []) {
			if (!child.url && child.children) add(child, child.title || t("tabGroups_folder_untitled"), [...path, title]);
		}
	};
	const topLevel = tree.flatMap((root) => (root.children || []).filter((node) => !node.url && node.children));
	/** @type {Map<string, number>} */
	const counts = new Map();
	for (const node of topLevel) counts.set(node.title, (counts.get(node.title) || 0) + 1);
	for (const node of topLevel) {
		let title = node.title || t("tabGroups_folder_untitled");
		if (/** @type {number} */ (counts.get(node.title)) > 1 && typeof node.syncing === "boolean") {
			title = t(node.syncing ? "tabGroups_folder_in_account" : "tabGroups_folder_device_only", title);
		}
		add(node, title, []);
	}
	return folders;
}
