//@ts-check
"use strict";

// modules/tabGroups/bookmarkGroupsEditor.mjs
// Editor skupin ze záložek na stránce Nastavení (pole settingsSchema typu
// "custom"): řádek = název skupiny, složka záložek, zaškrtávátko „všechny url
// na doméně záložky“, barva (stejných 9 barev jako u období, s náhledem) a
// zaškrtávátko „uzavřená skupina“ (jako u období).
// Tlačítkem se přidá řádek, × ho odebere. Prázdný název = název složky (je
// vidět jako placeholder). Název, který už má jiná skupina nebo období,
// editor označí — za běhu by dostal pořadové číslo (resolveBookmarkGroups()).
//
// Složka se vybírá ze skutečného stromu záložek. K tomu i k řazení karet je
// potřeba oprávnění BOOKMARK_GROUPS_PERMISSIONS (záložky a adresy karet) —
// bez něj editor nabídne tlačítko na jeho udělení, nový řádek přidat nejde a
// ve výběru zůstane jen už uložená složka, ať se při uložení neztratí.
//
// Vrací element s metodou getValue() (pole Types.TabGroups.BookmarkGroupSetting,
// prázdné řádky vynechá). Vzhled je v tabGroups.css (společné třídy editoru
// období .tab-groups-editor-* a .tab-groups-bookmarks-*).
import { t } from "../../sdk.mjs";
import { GROUP_COLORS } from "./buckets.mjs";
import { createCollapsedCheckbox } from "./groupsEditor.mjs";
import { BOOKMARK_GROUPS_PERMISSIONS, bookmarkGroupTitle, defaultBookmarkColor, listBookmarkFolders, normalizeBookmarkGroups } from "./bookmarkGroups.mjs";

/** @type {Functions.TabGroups.BookmarkGroupsEditor.createBookmarkGroupsEditor} */
export function createBookmarkGroupsEditor(value, { api, periodTitles }) {
	// Metodu getValue() dostane na konci funkce.
	const root = /** @type {Types.TabGroups.BookmarkGroupsEditorElement} */ (document.createElement("div"));
	root.className = "tab-groups-editor tab-groups-bookmarks-editor";

	const hint = document.createElement("div");
	hint.className = "tab-groups-editor-hint";
	hint.textContent = t("tabGroups_bookmarks_hint");

	const notice = document.createElement("div");
	notice.className = "tab-groups-editor-hint tab-groups-bookmarks-notice";

	const table = document.createElement("table");
	const head = table.createTHead().insertRow();
	for (const text of [t("tabGroups_editor_group_name"), t("tabGroups_bookmarks_folder"), "", t("tabGroups_editor_color"), "", ""]) {
		const th = document.createElement("th");
		th.scope = "col";
		th.textContent = text;
		head.appendChild(th);
	}
	const body = table.createTBody();

	const empty = document.createElement("div");
	empty.className = "tab-groups-editor-hint";
	empty.textContent = t("tabGroups_bookmarks_empty");

	const message = document.createElement("div");
	message.className = "tab-groups-editor-message";
	message.setAttribute("aria-live", "polite");

	const addButton = document.createElement("button");
	addButton.type = "button";
	addButton.className = "tab-groups-bookmarks-add";
	addButton.textContent = t("tabGroups_bookmarks_add");
	// Bez oprávnění k záložkám nejde vybrat složku — povolí ho load().
	addButton.disabled = true;

	root.append(hint, notice, table, empty, message, addButton);

	/** @type {Types.TabGroups.BookmarkEditorRow[]} */
	const rows = [];
	// Složky stromu záložek, jakmile jde strom přečíst (null = zatím ne).
	/** @type {Types.TabGroups.BookmarkFolder[] | null} */
	let folders = null;

	// Název složky řádku: ze stromu záložek, jinak uložený.
	/** @type {Functions.TabGroups.BookmarkGroupsEditor.folderTitleOf} */
	const folderTitleOf = (row) => {
		const folder = folders && folders.find((item) => item.id === row.folderSelect.value);
		return folder ? folder.title : row.folderSelect.value === row.storedFolderId ? row.storedFolderTitle : "";
	};

	/** @type {Functions.TabGroups.BookmarkGroupsEditor.readRow} */
	const readRow = (row) => ({
		id: row.id,
		title: row.titleInput.value.trim(),
		folderId: row.folderSelect.value,
		folderTitle: folderTitleOf(row),
		wholeDomain: row.domainInput.checked,
		color: /** @type {Types.TabGroups.GroupColor} */ (row.colorSelect.value),
		collapsed: row.collapsedInput.checked,
	});

	// Nabídka složek řádku: stromu záložek, a uložená složka, kterou ve stromu
	// nejde najít (smazaná, nebo strom zatím nejde přečíst).
	/** @type {Functions.TabGroups.BookmarkGroupsEditor.fillFolders} */
	function fillFolders(row) {
		// Poprvé uložená složka, pak to, co je vybrané.
		const selected = row.folderSelect.options.length > 0 ? row.folderSelect.value : row.storedFolderId;
		const placeholder = new Option(t("tabGroups_bookmarks_choose_folder"), "");
		const options = (folders || []).map((folder) => new Option(folder.label, folder.id));
		if (selected && !options.some((option) => option.value === selected)) {
			const label = row.storedFolderTitle || selected;
			options.push(new Option(folders ? t("tabGroups_bookmarks_folder_not_found", label) : label, selected));
		}
		row.folderSelect.replaceChildren(placeholder, ...options);
		row.folderSelect.value = selected;
	}

	// Náhled barev, placeholder názvu (název složky) a hlášky: opakované názvy
	// a řádky bez složky.
	/** @type {Functions.TabGroups.BookmarkGroupsEditor.refresh} */
	function refresh() {
		const used = new Set(periodTitles);
		/** @type {string[]} */
		const duplicates = [];
		let withoutFolder = false;
		for (const row of rows) {
			const setting = readRow(row);
			row.swatch.className = `tab-groups-swatch tab-groups-color--${setting.color}`;
			row.titleInput.placeholder = setting.folderTitle || t("tabGroups_bookmarks_folder_name");
			let duplicate = false;
			if (setting.folderId) {
				const title = bookmarkGroupTitle(setting);
				duplicate = used.has(title);
				if (duplicate && !duplicates.includes(title)) duplicates.push(title);
				used.add(title);
			} else if (setting.title || setting.wholeDomain) {
				withoutFolder = true;
			}
			row.titleInput.classList.toggle("tab-groups-editor-duplicate", duplicate);
		}
		/** @type {string[]} */
		const texts = [];
		if (duplicates.length > 0) {
			texts.push(
				t("tabGroups_bookmarks_duplicates", duplicates.map((title) => t("tabGroups_quoted", title)).join(", "))
			);
		}
		if (withoutFolder) texts.push(t("tabGroups_bookmarks_without_folder"));
		message.textContent = texts.join(" ");
		empty.hidden = rows.length > 0;
		table.hidden = rows.length === 0;
	}

	/** @type {Functions.TabGroups.BookmarkGroupsEditor.addRow} */
	function addRow(setting) {
		const tr = body.insertRow();

		const titleInput = document.createElement("input");
		titleInput.type = "text";
		titleInput.className = "tab-groups-editor-title";
		titleInput.value = setting.title;
		titleInput.setAttribute("aria-label", t("tabGroups_bookmarks_title_aria"));
		tr.insertCell().appendChild(titleInput);

		const folderSelect = document.createElement("select");
		folderSelect.className = "tab-groups-bookmarks-folder";
		folderSelect.setAttribute("aria-label", t("tabGroups_bookmarks_folder"));
		tr.insertCell().appendChild(folderSelect);

		const domainLabel = document.createElement("label");
		domainLabel.className = "tab-groups-bookmarks-domain";
		// Popis zaškrtávátka — co přesně „doména záložky“ znamená.
		domainLabel.title = t("tabGroups_bookmarks_whole_domain_title");
		const domainInput = document.createElement("input");
		domainInput.type = "checkbox";
		domainInput.checked = setting.wholeDomain;
		domainLabel.append(domainInput, t("tabGroups_bookmarks_whole_domain"));
		tr.insertCell().appendChild(domainLabel);

		const colorSelect = document.createElement("select");
		colorSelect.setAttribute("aria-label", t("tabGroups_bookmarks_color_aria"));
		for (const color of GROUP_COLORS) colorSelect.appendChild(new Option(color.label, color.value));
		colorSelect.value = setting.color;
		const swatch = document.createElement("span");
		swatch.setAttribute("aria-hidden", "true");
		const colorCell = tr.insertCell();
		colorCell.className = "tab-groups-editor-color";
		colorCell.append(colorSelect, swatch);

		const collapsed = createCollapsedCheckbox(setting.collapsed, t("tabGroups_bookmarks_collapsed_aria"));
		tr.insertCell().appendChild(collapsed.label);

		const removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.className = "tab-groups-bookmarks-remove";
		removeButton.textContent = "×";
		removeButton.title = t("tabGroups_bookmarks_remove");
		removeButton.setAttribute("aria-label", t("tabGroups_bookmarks_remove"));
		tr.insertCell().appendChild(removeButton);

		/** @type {Types.TabGroups.BookmarkEditorRow} */
		const row = {
			id: setting.id,
			tr,
			titleInput,
			folderSelect,
			domainInput,
			colorSelect,
			swatch,
			collapsedInput: collapsed.input,
			storedFolderId: setting.folderId,
			storedFolderTitle: setting.folderTitle,
		};
		rows.push(row);
		fillFolders(row);
		removeButton.addEventListener("click", () => {
			rows.splice(rows.indexOf(row), 1);
			tr.remove();
			refresh();
		});
	}

	// Oprávnění a strom záložek — při otevření editoru a po každé změně
	// oprávnění (udělení tlačítkem tady i jinde).
	/** @type {Functions.TabGroups.BookmarkGroupsEditor.load} */
	async function load() {
		const granted = await api.permissions.contains(BOOKMARK_GROUPS_PERMISSIONS);
		addButton.disabled = !granted;
		notice.replaceChildren();
		if (!granted) {
			notice.append(t("tabGroups_bookmarks_missing_permission") + " ");
			if (typeof chrome.permissions === "undefined") {
				notice.append(t("tabGroups_bookmarks_permission_here"));
			} else {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = t("tabGroups_grant_bookmarks");
				// request() hned v obsluze kliknutí — Firefox by gesto uživatele
				// po await nepoznal.
				button.addEventListener("click", async () => {
					if (await api.permissions.request(BOOKMARK_GROUPS_PERMISSIONS)) await load();
				});
				notice.appendChild(button);
			}
		}
		if (typeof chrome.bookmarks !== "undefined" && (await api.permissions.contains({ permissions: ["bookmarks"] }))) {
			try {
				folders = listBookmarkFolders(await chrome.bookmarks.getTree());
			} catch (err) {
				console.error("tabGroups: záložky nejde načíst:", err);
				folders = [];
			}
		}
		rows.forEach(fillFolders);
		refresh();
	}

	root.addEventListener("input", refresh);
	root.addEventListener("change", refresh);
	addButton.addEventListener("click", () => {
		addRow({ id: newRowId(), title: "", folderId: "", folderTitle: "", wholeDomain: false, color: defaultBookmarkColor(rows.length), collapsed: false });
		refresh();
		rows[rows.length - 1].folderSelect.focus();
	});

	root.getValue = () =>
		normalizeBookmarkGroups(
			rows.map(readRow).filter((setting) => setting.folderId || setting.title)
		);

	for (const setting of normalizeBookmarkGroups(value)) addRow(setting);
	refresh();
	load();
	// Po udělení nebo odebrání oprávnění jinde (element modulu, správce
	// oprávnění) — posluchač odpojeného editoru se při další změně odhlásí.
	const off = api.permissions.onChange(() => {
		if (root.isConnected) load();
		else off();
	});
	return root;
}

// Stálé id nového řádku (spojuje skupinu v prohlížeči s řádkem i po
// přejmenování).
/** @type {Functions.TabGroups.BookmarkGroupsEditor.newRowId} */
function newRowId() {
	return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID().slice(0, 8)
		: Math.random().toString(36).slice(2, 10);
}
