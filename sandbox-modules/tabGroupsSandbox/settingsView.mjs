//@ts-check
"use strict";

// sandbox-modules/tabGroupsSandbox/settingsView.mjs
// The editor of the settings of tabGroups — the element of tabGroupsSandbox renders it in Settings, in its settings
// block (registerModule({ settingsView }), init({ location: "settings" })). It runs in the sandbox, so it gets the
// settings as data (tabGroups.getSettings: the values, the periods with their default names and colors, the
// colors, the folders of the bookmarks) and stores every change right away (tabGroups.setSettings — the
// background part of tabGroups checks the value the same way the editors in Settings used to). Whose settings they
// are does not matter here: of this extension, or of the standalone Tab Groups extension when its service provider
// shows the module (the functions go to it then).
//
// The parts, from the top: how the tabs are sorted (a select), dragging tabs between the automatic groups (a
// checkbox), the prefix of the group names (text), the names and colors of the automatic groups (a table: a row = a
// period, an empty name = the default one, a repeated name is marked) and the groups from bookmarks (a table: the
// name, a folder of the bookmarks, "all URLs on the bookmark's domain", the color, "collapsed group", ×; the button
// adds a row). Without the permission to bookmarks a folder cannot be chosen — the editor says so and opens the
// page where tabGroups asks for it (tabGroups.openPermissions); the stored folders stay. Below it the status of the
// last save. The settings go back to the defaults with the reset button of the block in Settings (the core resets
// tabGroups with this module — registerModule({ settingsEditedBy }) of tabGroups).
import { t } from "../../sdk.mjs";

// The sorting values (GROUP_BY_OPENED, GROUP_BY_LAST_USED of modules/tabGroups/buckets.mjs).
const GROUP_BY_VALUES = /** @type {const} */ (["opened", "lastUsed"]);

/** @type {Record<string, () => string>} */
const GROUP_BY_LABELS = {
	opened: () => t("tabGroupsSandbox_setting_group_by_opened"),
	lastUsed: () => t("tabGroupsSandbox_setting_group_by_last_used"),
};

// A new id of a row of the groups from bookmarks (it connects the group in the browser with the row even after renaming).
/** @type {Functions.TabGroupsSandbox.SettingsView.newRowId} */
function newRowId() {
	return [...crypto.getRandomValues(new Uint8Array(4))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @type {Functions.TabGroupsSandbox.SettingsView.labeled} */
function labeled(text, control) {
	const label = document.createElement("label");
	label.className = "tab-groups-setting";
	label.append(text, document.createElement("br"), control);
	return label;
}

// The "collapsed group" checkbox with its label — in both tables.
/** @type {Functions.TabGroupsSandbox.SettingsView.collapsedCheckbox} */
function collapsedCheckbox(checked, ariaLabel) {
	const label = document.createElement("label");
	label.className = "tab-groups-editor-collapsed";
	label.title = t("tabGroupsSandbox_editor_collapsed_title");
	const input = document.createElement("input");
	input.type = "checkbox";
	input.checked = checked;
	input.setAttribute("aria-label", ariaLabel);
	label.append(input, t("tabGroupsSandbox_editor_collapsed"));
	return { label, input };
}

// A select of the colors of the groups with a preview; defaultColor gets "(default)".
/** @type {Functions.TabGroupsSandbox.SettingsView.colorPicker} */
function colorPicker(colors, value, ariaLabel, defaultColor = null) {
	const select = document.createElement("select");
	select.setAttribute("aria-label", ariaLabel);
	for (const color of colors) {
		select.appendChild(new Option(color.value === defaultColor ? t("tabGroupsSandbox_editor_color_default", color.label) : color.label, color.value));
	}
	select.value = value;
	const swatch = document.createElement("span");
	swatch.className = "tab-groups-swatch";
	swatch.setAttribute("aria-hidden", "true");
	const refresh = () => {
		swatch.className = `tab-groups-swatch tab-groups-color--${select.value}`;
	};
	select.addEventListener("change", refresh);
	refresh();
	const cell = document.createElement("td");
	cell.className = "tab-groups-editor-color";
	cell.append(select, swatch);
	return { cell, select };
}

/** @type {Functions.TabGroupsSandbox.SettingsView.tableHead} */
function tableHead(table, titles) {
	const head = table.createTHead().insertRow();
	for (const text of titles) {
		const th = document.createElement("th");
		th.scope = "col";
		th.textContent = text;
		head.appendChild(th);
	}
}

// The names and colors of the periods: a row per period; read() gives the stored form { [key]: { title, color,
// collapsed } } (an empty name = the default one).
/** @type {Functions.TabGroupsSandbox.SettingsView.createGroupsTable} */
function createGroupsTable(view, onChange) {
	const root = document.createElement("div");
	root.className = "tab-groups-editor";
	const hint = document.createElement("div");
	hint.className = "tab-groups-editor-hint";
	hint.textContent = t("tabGroupsSandbox_editor_hint");
	const table = document.createElement("table");
	tableHead(table, [t("tabGroupsSandbox_editor_period"), t("tabGroupsSandbox_editor_group_name"), t("tabGroupsSandbox_editor_color"), ""]);
	const body = table.createTBody();
	const rows = view.periods.map((period) => {
		const stored = view.values.groups[period.key] ?? { title: "", color: period.color, collapsed: false };
		const tr = body.insertRow();
		const range = document.createElement("th");
		range.scope = "row";
		range.textContent = period.range;
		tr.appendChild(range);
		const titleInput = document.createElement("input");
		titleInput.type = "text";
		titleInput.className = "tab-groups-editor-title";
		titleInput.value = stored.title;
		titleInput.placeholder = period.title;
		titleInput.setAttribute("aria-label", t("tabGroupsSandbox_editor_title_aria", period.range));
		tr.insertCell().appendChild(titleInput);
		const color = colorPicker(view.colors, stored.color, t("tabGroupsSandbox_editor_color_aria", period.range), period.color);
		tr.appendChild(color.cell);
		const collapsed = collapsedCheckbox(stored.collapsed, t("tabGroupsSandbox_editor_collapsed_aria", period.range));
		tr.insertCell().appendChild(collapsed.label);
		return { period, titleInput, colorSelect: color.select, collapsedInput: collapsed.input };
	});
	const message = document.createElement("div");
	message.className = "tab-groups-editor-message";
	message.setAttribute("aria-live", "polite");
	root.append(hint, table, message);

	// A repeated name is marked — the background part would store the period's default name instead.
	const mark = () => {
		/** @type {Map<string, number>} */
		const seen = new Map();
		const titles = rows.map((row) => row.titleInput.value.trim() || row.period.title);
		for (const title of titles) seen.set(title, (seen.get(title) || 0) + 1);
		/** @type {string[]} */
		const duplicates = [];
		rows.forEach((row, index) => {
			const duplicate = (seen.get(titles[index]) || 0) > 1;
			row.titleInput.classList.toggle("tab-groups-editor-duplicate", duplicate);
			if (duplicate && !duplicates.includes(titles[index])) duplicates.push(titles[index]);
		});
		message.textContent =
			duplicates.length > 0 ? t("tabGroupsSandbox_editor_duplicates", duplicates.map((title) => t("tabGroupsSandbox_quoted", title)).join(", ")) : "";
	};
	const read = () =>
		Object.fromEntries(
			rows.map((row) => [
				row.period.key,
				{ title: row.titleInput.value.trim(), color: /** @type {Types.TabGroups.GroupColor} */ (row.colorSelect.value), collapsed: row.collapsedInput.checked },
			])
		);
	root.addEventListener("input", mark);
	// A text is stored when it is done (the field loses the focus, Enter), a choice right away.
	root.addEventListener("change", () => {
		mark();
		onChange(read());
	});
	mark();
	return { element: root, periodTitles: () => rows.map((row) => row.titleInput.value.trim() || row.period.title) };
}

// The groups from bookmarks: a row per group; onChange gets the rows that have a folder or a name (the empty ones
// are not stored).
/** @type {Functions.TabGroupsSandbox.SettingsView.createBookmarksTable} */
function createBookmarksTable(view, periodTitles, onChange, openPermissions) {
	const root = document.createElement("div");
	root.className = "tab-groups-editor tab-groups-bookmarks-editor";
	const hint = document.createElement("div");
	hint.className = "tab-groups-editor-hint";
	hint.textContent = t("tabGroupsSandbox_bookmarks_hint");
	const notice = document.createElement("div");
	notice.className = "tab-groups-editor-hint tab-groups-bookmarks-notice";
	if (!view.hasBookmarks) {
		notice.append(t("tabGroupsSandbox_bookmarks_missing_permission") + " ");
		if (openPermissions) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = t("tabGroupsSandbox_bookmarks_grant");
			button.addEventListener("click", openPermissions);
			notice.appendChild(button);
		}
	}
	const table = document.createElement("table");
	tableHead(table, [t("tabGroupsSandbox_editor_group_name"), t("tabGroupsSandbox_bookmarks_folder"), "", t("tabGroupsSandbox_editor_color"), "", ""]);
	const body = table.createTBody();
	const empty = document.createElement("div");
	empty.className = "tab-groups-editor-hint";
	empty.textContent = t("tabGroupsSandbox_bookmarks_empty");
	const message = document.createElement("div");
	message.className = "tab-groups-editor-message";
	message.setAttribute("aria-live", "polite");
	const addButton = document.createElement("button");
	addButton.type = "button";
	addButton.className = "tab-groups-bookmarks-add";
	addButton.textContent = t("tabGroupsSandbox_bookmarks_add");
	// Without the folders (no permission to bookmarks) a new row could not get one.
	addButton.disabled = view.folders === null;
	root.append(hint, notice, table, empty, message, addButton);

	/** @type {Types.TabGroupsSandbox.BookmarkRow[]} */
	const rows = [];
	const folders = view.folders ?? [];
	/** @type {(row: Types.TabGroupsSandbox.BookmarkRow) => string} */
	const folderTitleOf = (row) => {
		const folder = folders.find((item) => item.id === row.folderSelect.value);
		return folder ? folder.title : row.folderSelect.value === row.storedFolderId ? row.storedFolderTitle : "";
	};
	/** @type {(row: Types.TabGroupsSandbox.BookmarkRow) => Types.TabGroups.BookmarkGroupSetting} */
	const readRow = (row) => ({
		id: row.id,
		title: row.titleInput.value.trim(),
		folderId: row.folderSelect.value,
		folderTitle: folderTitleOf(row),
		wholeDomain: row.domainInput.checked,
		color: /** @type {Types.TabGroups.GroupColor} */ (row.colorSelect.value),
		collapsed: row.collapsedInput.checked,
	});
	const read = () => rows.map(readRow).filter((setting) => setting.folderId || setting.title);

	// The names (a repeated one is marked — it would get a sequence number), the placeholder (the folder name) and
	// a row without a folder.
	const mark = () => {
		const used = new Set(periodTitles());
		/** @type {string[]} */
		const duplicates = [];
		let withoutFolder = false;
		for (const row of rows) {
			const setting = readRow(row);
			row.titleInput.placeholder = setting.folderTitle || t("tabGroupsSandbox_bookmarks_folder_name");
			let duplicate = false;
			if (setting.folderId) {
				const title = setting.title || setting.folderTitle.trim() || t("tabGroupsSandbox_bookmarks_fallback_title");
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
		if (duplicates.length > 0) texts.push(t("tabGroupsSandbox_bookmarks_duplicates", duplicates.map((title) => t("tabGroupsSandbox_quoted", title)).join(", ")));
		if (withoutFolder) texts.push(t("tabGroupsSandbox_bookmarks_without_folder"));
		message.textContent = texts.join(" ");
		empty.hidden = rows.length > 0;
		table.hidden = rows.length === 0;
	};

	/** @type {(setting: Types.TabGroups.BookmarkGroupSetting) => Types.TabGroupsSandbox.BookmarkRow} */
	const addRow = (setting) => {
		const tr = body.insertRow();
		const titleInput = document.createElement("input");
		titleInput.type = "text";
		titleInput.className = "tab-groups-editor-title";
		titleInput.value = setting.title;
		titleInput.setAttribute("aria-label", t("tabGroupsSandbox_bookmarks_title_aria"));
		tr.insertCell().appendChild(titleInput);

		const folderSelect = document.createElement("select");
		folderSelect.className = "tab-groups-bookmarks-folder";
		folderSelect.setAttribute("aria-label", t("tabGroupsSandbox_bookmarks_folder"));
		folderSelect.appendChild(new Option(t("tabGroupsSandbox_bookmarks_choose_folder"), ""));
		for (const folder of folders) folderSelect.appendChild(new Option(folder.label, folder.id));
		// The stored folder the tree does not have (deleted, or the tree cannot be read) stays selectable.
		if (setting.folderId && !folders.some((folder) => folder.id === setting.folderId)) {
			const label = setting.folderTitle || setting.folderId;
			folderSelect.appendChild(new Option(view.folders ? t("tabGroupsSandbox_bookmarks_folder_not_found", label) : label, setting.folderId));
		}
		folderSelect.value = setting.folderId;
		tr.insertCell().appendChild(folderSelect);

		const domainLabel = document.createElement("label");
		domainLabel.className = "tab-groups-bookmarks-domain";
		domainLabel.title = t("tabGroupsSandbox_bookmarks_whole_domain_title");
		const domainInput = document.createElement("input");
		domainInput.type = "checkbox";
		domainInput.checked = setting.wholeDomain;
		domainLabel.append(domainInput, t("tabGroupsSandbox_bookmarks_whole_domain"));
		tr.insertCell().appendChild(domainLabel);

		const color = colorPicker(view.colors, setting.color, t("tabGroupsSandbox_bookmarks_color_aria"));
		tr.appendChild(color.cell);
		const collapsed = collapsedCheckbox(setting.collapsed, t("tabGroupsSandbox_bookmarks_collapsed_aria"));
		tr.insertCell().appendChild(collapsed.label);

		const removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.className = "tab-groups-bookmarks-remove";
		removeButton.textContent = "×";
		removeButton.title = t("tabGroupsSandbox_bookmarks_remove");
		removeButton.setAttribute("aria-label", t("tabGroupsSandbox_bookmarks_remove"));
		tr.insertCell().appendChild(removeButton);

		/** @type {Types.TabGroupsSandbox.BookmarkRow} */
		const row = {
			id: setting.id,
			titleInput,
			folderSelect,
			domainInput,
			colorSelect: color.select,
			collapsedInput: collapsed.input,
			storedFolderId: setting.folderId,
			storedFolderTitle: setting.folderTitle,
		};
		rows.push(row);
		removeButton.addEventListener("click", () => {
			rows.splice(rows.indexOf(row), 1);
			tr.remove();
			mark();
			onChange(read());
		});
		return row;
	};

	for (const setting of view.values.bookmarkGroups) addRow(setting);
	root.addEventListener("input", mark);
	root.addEventListener("change", () => {
		mark();
		onChange(read());
	});
	addButton.addEventListener("click", () => {
		// A new row is stored once it has a folder or a name (the empty ones are not).
		const row = addRow({
			id: newRowId(),
			title: "",
			folderId: "",
			folderTitle: "",
			wholeDomain: false,
			color: view.colors[(rows.length + 1) % view.colors.length]?.value ?? "blue",
			collapsed: false,
		});
		mark();
		row.folderSelect.focus();
	});
	mark();
	return { element: root, refresh: mark };
}

// The whole editor into container (its previous content goes away). save(key, value) stores one setting;
// openPermissions is null when the function is not allowed.
/** @type {Functions.TabGroupsSandbox.SettingsView.renderSettingsEditor} */
export function renderSettingsEditor(container, view, { save, openPermissions }) {
	const root = document.createElement("div");
	root.className = "tab-groups-settings";

	const groupBy = document.createElement("select");
	for (const value of GROUP_BY_VALUES) groupBy.appendChild(new Option(GROUP_BY_LABELS[value](), value));
	groupBy.value = view.values.groupBy;
	groupBy.addEventListener("change", () => save("groupBy", groupBy.value));

	const manualMoves = document.createElement("input");
	manualMoves.type = "checkbox";
	manualMoves.checked = view.values.manualMoves;
	manualMoves.addEventListener("change", () => save("manualMoves", manualMoves.checked));
	const manualMovesLabel = document.createElement("label");
	manualMovesLabel.className = "tab-groups-setting tab-groups-setting--checkbox";
	manualMovesLabel.append(manualMoves, " ", t("tabGroupsSandbox_setting_manual_moves"));

	const titlePrefix = document.createElement("input");
	titlePrefix.type = "text";
	titlePrefix.value = view.values.titlePrefix;
	titlePrefix.placeholder = t("tabGroupsSandbox_setting_title_prefix_placeholder");
	titlePrefix.addEventListener("change", () => save("titlePrefix", titlePrefix.value));

	const groupsCaption = document.createElement("div");
	groupsCaption.className = "tab-groups-setting-caption";
	groupsCaption.textContent = t("tabGroupsSandbox_setting_groups");
	/** @type {{ refresh: () => void } | null} */
	let bookmarks = null;
	const groups = createGroupsTable(view, (value) => {
		bookmarks?.refresh();
		save("groups", value);
	});

	const bookmarksCaption = document.createElement("div");
	bookmarksCaption.className = "tab-groups-setting-caption";
	bookmarksCaption.textContent = t("tabGroupsSandbox_setting_bookmark_groups");
	const bookmarksTable = createBookmarksTable(view, groups.periodTitles, (value) => save("bookmarkGroups", value), openPermissions);
	bookmarks = bookmarksTable;

	root.append(
		labeled(t("tabGroupsSandbox_setting_group_by"), groupBy),
		manualMovesLabel,
		labeled(t("tabGroupsSandbox_setting_title_prefix"), titlePrefix),
		groupsCaption,
		groups.element,
		bookmarksCaption,
		bookmarksTable.element
	);
	container.replaceChildren(root);
}
