//@ts-check
"use strict";

// modules/tabGroups/bookmarkGroups.mjs
// Automatic groups from bookmarks — without DOM and without chrome.*, shared by the background
// part (background-script.mjs), the planner (planner.mjs), the settings editor
// (bookmarkGroupsEditor.mjs) and the element (tabGroups.mjs).
//
// A group from bookmarks is a settings row (BOOKMARK_GROUPS_KEY in module.mjs):
// the group name, a bookmark folder, a color, the option "all URLs on the bookmark's
// domain" and "collapsed group" (a new group is created collapsed). A tab belongs to the group when its address is a bookmark anywhere in the
// folder (also in subfolders) — the whole address without the part after "#" is compared —,
// or with the option checked, when it is on the domain of some bookmark from the folder
// (only http/https; "www." at the beginning does not count: a bookmark some.tld applies to
// some.tld/anything and www.some.tld/anything, not to other subdomains). Groups from
// bookmarks take precedence over periods; a tab that belongs to several groups goes
// to the first one in the order from Settings.
import { t } from "../../sdk.mjs";
import { GROUP_COLORS, isGroupColor } from "./buckets.mjs";

// Permissions of groups from bookmarks: "bookmarks" (folder contents) and "tabs" (addresses
// of all tabs — without it the browser does not reveal them). Both are optional
// in the manifest, in Chrome with a warning.
/** @type {Types.PermissionSet} */
export const BOOKMARK_GROUPS_PERMISSIONS = { permissions: ["bookmarks", "tabs"] };

// The group name when the user does not fill it in and the folder has no name.
/** @type {Functions.TabGroups.BookmarkGroups.fallbackTitle} */
const fallbackTitle = () => t("tabGroups_bookmarks_fallback_title");

// The default color of a row by its position — different from the neighboring rows.
/** @type {Functions.TabGroups.BookmarkGroups.defaultBookmarkColor} */
export function defaultBookmarkColor(index) {
	return GROUP_COLORS[(index + 1) % GROUP_COLORS.length].value;
}

// Stored settings (the editor's array of rows) → an always usable array. Rows that
// are not an object drop out; a missing or repeated id gets a replacement (the id
// connects the group in the browser with the row even after renaming, see
// groupIdentity.mjs). The name stays as the user entered it (empty =
// the folder name, see resolveBookmarkGroups()). A row without a folder is stored, but
// not used.
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

// The row's group name: the entered one, otherwise the folder name.
/** @type {Functions.TabGroups.BookmarkGroups.bookmarkGroupTitle} */
export function bookmarkGroupTitle(setting) {
	return setting.title || setting.folderTitle.trim() || fallbackTitle();
}

// Groups from bookmarks that are really used (rows with a selected folder),
// with names different from each other and from the period names (takenTitles) — the module
// recognizes its groups in the browser by name. A repeated name gets
// a sequence number.
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

// A group description for the overview of tabGroupsSandbox ("Tabs …: 3", overview.mjs).
/** @type {Functions.TabGroups.BookmarkGroups.describeBookmarkGroup} */
export function describeBookmarkGroup(group) {
	const folder = group.folderTitle.trim() || fallbackTitle();
	return group.wholeDomain ? t("tabGroups_bookmarks_describe_domain", folder) : t("tabGroups_bookmarks_describe_folder", folder);
}

// The address without the part after "#" in a normalized form (lowercase host, without
// the default port) — this is how a tab is compared with a bookmark. An invalid address
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

// The domain of an address for the option "all URLs on the bookmark's domain": the host of an http(s)
// address without a trailing dot and without "www." at the beginning; otherwise null.
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

// Addresses of all bookmarks in the nodes of the bookmark tree (also in subfolders) —
// from chrome.bookmarks.getSubTree(folder).
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

// A function tab address → the index of the group from bookmarks (index in groups), or -1.
// urlsByGroup: the bookmark addresses of each group's folder (collectBookmarkUrls()).
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

// Bookmark folders for the select in the editor: every folder of the tree (without the invisible
// root) with a path, in tree order — a folder, right after it its subfolders.
// Chrome with bookmarks in the account has the root folders twice with the same name (in the
// account and only on the device) — syncing tells them apart (Chrome 134+).
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
