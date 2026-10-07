//@ts-check
"use strict";

// modules/tabGroups/groupsEditor.mjs
// Editor názvů a barev automatických skupin na stránce Nastavení (vlastní pole
// settingsSchema, type "custom"): pro každé období řádek s popisem, názvem
// skupiny, barvou (výběr ze stejných 9 barev, jaké nabízí prohlížeč, s
// náhledem) a zaškrtávátkem „uzavřená skupina“ (nová skupina vznikne
// sbalená, viz createCollapsedCheckbox()). Prázdný název = výchozí (je vidět jako placeholder). Opakovaný
// název editor hned označí — modul své skupiny pozná podle názvu, takže by se
// uložil výchozí název období (viz normalizeGroupsConfig()).
//
// Vrací element s metodou getValue() (uložený tvar { [klíč období]: { title,
// color, collapsed } }). Vzhled je v tabGroups.css pod třídou .tab-groups-editor — jádro
// CSS modulu připojí i na stránku Nastavení (registerModule({ styles })).
import { t } from "../../sdk.mjs";
import { BUCKETS, GROUP_COLORS, normalizeGroupsConfig, toStoredGroupsConfig } from "./buckets.mjs";

/** @type {Functions.TabGroups.GroupsEditor.createGroupsEditor} */
export function createGroupsEditor(value) {
	const config = normalizeGroupsConfig(value);

	// Metodu getValue() dostane na konci funkce.
	const root = /** @type {Types.TabGroups.GroupsEditorElement} */ (document.createElement("div"));
	root.className = "tab-groups-editor";

	const hint = document.createElement("div");
	hint.className = "tab-groups-editor-hint";
	hint.textContent = t("tabGroups_editor_hint");

	const table = document.createElement("table");
	const head = table.createTHead().insertRow();
	for (const text of [t("tabGroups_editor_period"), t("tabGroups_editor_group_name"), t("tabGroups_editor_color"), ""]) {
		const th = document.createElement("th");
		th.scope = "col";
		th.textContent = text;
		head.appendChild(th);
	}
	const body = table.createTBody();

	/** @type {Types.TabGroups.EditorRow[]} */
	const rows = BUCKETS.map((bucket, i) => {
		const row = body.insertRow();
		const range = document.createElement("th");
		range.scope = "row";
		range.textContent = bucket.range;
		row.appendChild(range);

		const titleInput = document.createElement("input");
		titleInput.type = "text";
		titleInput.className = "tab-groups-editor-title";
		// Výchozí název zůstane prázdný (placeholder) — uloží se jako "" a
		// sleduje tak jazyk rozhraní.
		titleInput.value = config[i].title === bucket.title ? "" : config[i].title;
		titleInput.placeholder = bucket.title;
		titleInput.setAttribute("aria-label", t("tabGroups_editor_title_aria", bucket.range));
		row.insertCell().appendChild(titleInput);

		const colorSelect = document.createElement("select");
		colorSelect.setAttribute("aria-label", t("tabGroups_editor_color_aria", bucket.range));
		for (const color of GROUP_COLORS) {
			const option = document.createElement("option");
			option.value = color.value;
			option.textContent = color.value === bucket.color ? t("tabGroups_editor_color_default", color.label) : color.label;
			colorSelect.appendChild(option);
		}
		colorSelect.value = config[i].color;
		const swatch = document.createElement("span");
		swatch.className = "tab-groups-swatch";
		swatch.setAttribute("aria-hidden", "true");
		const colorCell = row.insertCell();
		colorCell.className = "tab-groups-editor-color";
		colorCell.append(colorSelect, swatch);

		const collapsed = createCollapsedCheckbox(config[i].collapsed, t("tabGroups_editor_collapsed_aria", bucket.range));
		row.insertCell().appendChild(collapsed.label);

		return { key: bucket.key, titleInput, colorSelect, swatch, collapsedInput: collapsed.input };
	});

	const message = document.createElement("div");
	message.className = "tab-groups-editor-message";
	message.setAttribute("aria-live", "polite");

	root.append(hint, table, message);

	// Hodnota tak, jak je v políčkách (před doplněním výchozích názvů).
	/** @type {Functions.TabGroups.GroupsEditor.createGroupsEditor.readRaw} */
	const readRaw = () =>
		Object.fromEntries(rows.map((row) => [row.key, { title: row.titleInput.value, color: row.colorSelect.value, collapsed: row.collapsedInput.checked }]));

	// Náhled barev a označení opakovaných názvů.
	/** @type {Functions.TabGroups.GroupsEditor.createGroupsEditor.refresh} */
	function refresh() {
		/** @type {Map<string, number>} */
		const seen = new Map();
		for (const [i, row] of rows.entries()) {
			const title = row.titleInput.value.trim() || BUCKETS[i].title;
			seen.set(title, (seen.get(title) || 0) + 1);
			row.swatch.className = `tab-groups-swatch tab-groups-color--${row.colorSelect.value}`;
		}
		/** @type {string[]} */
		const duplicates = [];
		for (const [i, row] of rows.entries()) {
			const title = row.titleInput.value.trim() || BUCKETS[i].title;
			const duplicate = (seen.get(title) || 0) > 1;
			row.titleInput.classList.toggle("tab-groups-editor-duplicate", duplicate);
			if (duplicate && !duplicates.includes(title)) duplicates.push(title);
		}
		message.textContent =
			duplicates.length > 0
				? t("tabGroups_editor_duplicates", duplicates.map((title) => t("tabGroups_quoted", title)).join(", "))
				: "";
	}

	root.addEventListener("input", refresh);
	root.addEventListener("change", refresh);
	refresh();

	root.getValue = () => {
		const stored = toStoredGroupsConfig(normalizeGroupsConfig(readRaw()));
		for (const bucket of BUCKETS) {
			if (stored[bucket.key].title === bucket.title) stored[bucket.key].title = "";
		}
		return stored;
	};
	return root;
}

// Zaškrtávátko „uzavřená skupina“ s popiskem — v editoru období i skupin ze
// záložek.
/** @type {Functions.TabGroups.GroupsEditor.createCollapsedCheckbox} */
export function createCollapsedCheckbox(checked, ariaLabel) {
	const label = document.createElement("label");
	label.className = "tab-groups-editor-collapsed";
	// Popis zaškrtávátka „uzavřená skupina“.
	label.title = t("tabGroups_editor_collapsed_title");
	const input = document.createElement("input");
	input.type = "checkbox";
	input.checked = checked;
	input.setAttribute("aria-label", ariaLabel);
	label.append(input, t("tabGroups_editor_collapsed"));
	return { label, input };
}
