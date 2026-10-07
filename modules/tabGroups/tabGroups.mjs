//@ts-check
"use strict";

// modules/tabGroups/tabGroups.mjs
// Element modulu tabGroups: přehled automatických skupin v aktuálním okně
// (barevné štítky s počtem karet, v pořadí jako v liště karet), stav
// oprávnění s tlačítkem na jejich udělení a tlačítka „Přeskupit teď“,
// „Nastavení skupin“ a „Identifikovat řízené skupiny“ (skupiny modulu ve
// všech oknech zablikají). Karty řadí background část (background-script.mjs) i
// bez otevřeného elementu — element je jen okno do jejího výsledku. Řazení
// (podle otevření, nebo posledního použití karty), názvy a barvy skupin
// i skupiny ze záložek se nastavují na stránce Nastavení (groupsEditor.mjs,
// bookmarkGroupsEditor.mjs), ne tady.
import { BaseElement, registerModule, t, tp } from "../../sdk.mjs";
import {
	MODULE_NAME,
	TAG,
	DESCRIPTION,
	ACTIVATION_SPEC,
	DEFAULT_ACTIVATION_MODE,
	DEFAULT_DISPLAY_LOCATION,
	DEFAULT_OUTPUT_ELEMENT,
	DEFAULT_SHOW_HEADING,
	STYLES,
	USES_PERMISSIONS,
	SETTINGS_SCHEMA,
	TAB_GROUPS_PERMISSIONS,
	ALARMS_PERMISSIONS,
	BOOKMARK_GROUPS_PERMISSIONS,
	GROUPS_KEY,
	GROUP_BY_KEY,
	TITLE_PREFIX_KEY,
	BOOKMARK_GROUPS_KEY,
	REGROUP_MESSAGE,
	IDENTIFY_MESSAGE,
	GROUP_IDS_KEY,
	KNOWN_TITLES_KEY,
} from "./module.mjs";
import {
	BUCKETS,
	DEFAULT_GROUPS,
	DEFAULT_GROUP_BY,
	DEFAULT_TITLE_PREFIX,
	GROUP_BY_LAST_USED,
	normalizeGroupBy,
	normalizeGroupsConfig,
	normalizeTitlePrefix,
	withTitlePrefix,
} from "./buckets.mjs";
import { describeBookmarkGroup, normalizeBookmarkGroups, resolveBookmarkGroups } from "./bookmarkGroups.mjs";
import { TAB_GROUP_ID_NONE } from "./planner.mjs";
import { describeTargets, findOurGroups, readGroupIds, readKnownTitles, toTargets } from "./groupIdentity.mjs";

// Odstup překreslení po změně karet — přeskupení vyvolá sérii událostí.
const RENDER_DEBOUNCE_MS = 150;

/** @implements {Classes.ExtensionTabGroups} */
class ExtensionTabGroups extends /** @type {Types.WithFields<typeof BaseElement, Classes.ExtensionTabGroups.Fields>} */ (BaseElement) {
	/**
	 * @override
	 * @type {typeof Classes.ExtensionTabGroups.observedAttributes}
	 */
	static get observedAttributes() {
		return [];
	}

	constructor() {
		super();
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['connectedCallback']}
	 */
	connectedCallback() {
		this.className = "module-output tab-groups-output";
		this.textContent = t("tabGroups_loading", TAG);
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['disconnectedCallback']}
	 */
	disconnectedCallback() {
		super.disconnectedCallback();
		// Posluchače nastavení, oprávnění, karet a skupin z init()/_render().
		(this._unsubscribe || []).forEach((off) => off());
		/** @type {Classes.ExtensionTabGroups['_unsubscribe']} */
		this._unsubscribe = [];
		clearTimeout(this._renderTimer);
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['connectedMoveCallback']}
	 */
	connectedMoveCallback() {
		// Element nedrží stav vázaný na pozici v DOM — po přesunu pomocí
		// moveBefore() není potřeba nic dělat.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['adoptedCallback']}
	 */
	adoptedCallback() {
		// Modul nepotřebuje reagovat na přesun do jiného dokumentu.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['attributeChangedCallback']}
	 */
	attributeChangedCallback(_name, _oldValue, _newValue) {
		// Modul nesleduje žádné HTML atributy.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['init']}
	 */
	async init({ outputEl, name, mode, location }) {
		await super.init({ outputEl, name, mode, location });

		if (!this.isActivationSatisfied()) {
			this.textContent = t("tabGroups_disabled", name);
			return;
		}

		/** @type {Classes.ExtensionTabGroups['_renderToken']} */
		this._renderToken = 0;
		/** @type {Classes.ExtensionTabGroups['_result']} */
		this._result = "";
		/** @type {Classes.ExtensionTabGroups['_identifying']} */
		this._identifying = false;
		/** @type {Classes.ExtensionTabGroups['_watchingBrowser']} */
		this._watchingBrowser = false;
		// Postranní panel zůstává otevřený — přeskupení, změny karet, nastavení
		// i udělené oprávnění se v něm projeví hned.
		const rerender = () => this._scheduleRender();
		/** @type {Classes.ExtensionTabGroups['_unsubscribe']} */
		this._unsubscribe = [this.api.settings.onChange(rerender), this.api.permissions.onChange(rerender)];
		await this._render();
	}

	/** @type {Classes.ExtensionTabGroups['_scheduleRender']} */
	_scheduleRender() {
		clearTimeout(this._renderTimer);
		/** @type {Classes.ExtensionTabGroups['_renderTimer']} */
		this._renderTimer = setTimeout(() => this._render(), RENDER_DEBOUNCE_MS);
	}

	// Posluchače karet a skupin — chrome.tabGroups existuje až s oprávněním,
	// proto se zaregistrují při prvním vykreslení, kdy ho element má.
	/** @type {Classes.ExtensionTabGroups['_watchBrowser']} */
	_watchBrowser() {
		if (this._watchingBrowser || !chrome.tabGroups || !chrome.tabs) return;
		this._watchingBrowser = true;
		const rerender = () => this._scheduleRender();
		/** @type {Functions.TabGroups.Element.onTabUpdated} */
		const onTabUpdated = (_tabId, changeInfo) => {
			if ("groupId" in changeInfo || "pinned" in changeInfo) rerender();
		};
		const groupEvents = [chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved, chrome.tabGroups.onRemoved];
		groupEvents.forEach((event) => event.addListener(rerender));
		chrome.tabs.onCreated.addListener(rerender);
		chrome.tabs.onRemoved.addListener(rerender);
		chrome.tabs.onUpdated.addListener(onTabUpdated);
		this._unsubscribe = [
			...(this._unsubscribe || []),
			() => {
				groupEvents.forEach((event) => event.removeListener(rerender));
				chrome.tabs.onCreated.removeListener(rerender);
				chrome.tabs.onRemoved.removeListener(rerender);
				chrome.tabs.onUpdated.removeListener(onTabUpdated);
			},
		];
	}

	// Co element vypíše: podpora v prohlížeči, oprávnění a přehled skupin okna.
	/** @type {Classes.ExtensionTabGroups['_readState']} */
	async _readState() {
		const supported = !!chrome.tabs && typeof chrome.tabs.group === "function";
		const optional = new Set(chrome.runtime.getManifest().optional_permissions || []);
		const hasGroups = await this.api.permissions.contains(TAB_GROUPS_PERMISSIONS);
		const hasAlarms = await this.api.permissions.contains(ALARMS_PERMISSIONS);
		// Názvy s předponou, jak je skupiny mají v prohlížeči (viz reconcile()
		// v background-script.mjs).
		const periods = normalizeGroupsConfig(await this.api.settings.get(GROUPS_KEY, DEFAULT_GROUPS));
		const titlePrefix = normalizeTitlePrefix(await this.api.settings.get(TITLE_PREFIX_KEY, DEFAULT_TITLE_PREFIX));
		const config = withTitlePrefix(periods, titlePrefix);
		const groupBy = normalizeGroupBy(await this.api.settings.get(GROUP_BY_KEY, DEFAULT_GROUP_BY));
		const bookmarkGroups = withTitlePrefix(
			resolveBookmarkGroups(
				normalizeBookmarkGroups(await this.api.settings.get(BOOKMARK_GROUPS_KEY, [])),
				periods.map((item) => item.title)
			),
			titlePrefix
		);
		const hasBookmarks = await this.api.permissions.contains(BOOKMARK_GROUPS_PERMISSIONS);
		const overview = supported && hasGroups ? await this._readOverview(config, bookmarkGroups) : null;
		return {
			supported,
			hasGroups,
			hasAlarms,
			groupBy,
			bookmarkGroups,
			hasBookmarks,
			// Jen oprávnění, která manifest nabízí jako nepovinná (Firefox má
			// "alarms" povinné a žádost o něj by odmítl celou).
			requestable: [...(TAB_GROUPS_PERMISSIONS.permissions || []), ...(ALARMS_PERMISSIONS.permissions || [])].filter((p) => optional.has(p)),
			requestableBookmarks: (BOOKMARK_GROUPS_PERMISSIONS.permissions || []).filter((p) => optional.has(p)),
			overview,
		};
	}

	// Skupiny aktuálního okna: automatické (štítky v pořadí lišty karet) a
	// počet ostatních. null, když okno nejde zjistit (bez
	// chrome.windows/chrome.tabGroups).
	/** @type {Classes.ExtensionTabGroups['_readOverview']} */
	async _readOverview(config, bookmarkGroups) {
		if (!chrome.tabGroups || !chrome.windows) return null;
		try {
			const win = await chrome.windows.getCurrent();
			const [tabs, groups] = await Promise.all([chrome.tabs.query({ windowId: win.id }), chrome.tabGroups.query({ windowId: win.id })]);
			// Skupiny modulu stejně jako v background části (groupIdentity.mjs).
			const targets = describeTargets(config, bookmarkGroups);
			const ours = toTargets(
				findOurGroups(
					groups.map((group) => ({ id: group.id, windowId: group.windowId, title: group.title, color: group.color, shared: group.shared === true })),
					{
						...targets,
						groupIds: readGroupIds(await this.api.state.get(GROUP_IDS_KEY, null)),
						knownTitles: readKnownTitles(await this.api.state.get(KNOWN_TITLES_KEY, null)) || [],
					}
				),
				targets.keys
			);
			/** @type {Map<number, { count: number, first: number }>} */
			const stats = new Map();
			for (const tab of tabs) {
				if (tab.groupId === TAB_GROUP_ID_NONE) continue;
				const entry = stats.get(tab.groupId) || { count: 0, first: tab.index };
				stats.set(tab.groupId, { count: entry.count + 1, first: Math.min(entry.first, tab.index) });
			}
			/** @type {Types.TabGroups.OverviewChip[]} */
			const chips = [];
			for (const group of groups) {
				const target = ours.get(group.id);
				const entry = stats.get(group.id);
				// Skupinu odebraného řádku skupin ze záložek právě vyprazdňuje
				// background část.
				if (target === undefined || !entry || target >= BUCKETS.length + bookmarkGroups.length) continue;
				const chip = { title: group.title || "", color: group.color, count: entry.count, first: entry.first };
				chips.push(
					target < BUCKETS.length
						? { ...chip, kind: "period", range: BUCKETS[target].range }
						: { ...chip, kind: "bookmarks", range: describeBookmarkGroup(bookmarkGroups[target - BUCKETS.length]) }
				);
			}
			chips.sort((a, b) => a.first - b.first);
			return {
				chips,
				userGroups: groups.filter((group) => !ours.has(group.id)).length,
				ungrouped: tabs.filter((tab) => !tab.pinned && tab.groupId === TAB_GROUP_ID_NONE).length,
			};
		} catch (err) {
			console.error("tabGroups: skupiny okna nejde zjistit:", err);
			return null;
		}
	}

	/** @type {Classes.ExtensionTabGroups['_render']} */
	async _render() {
		const token = ++this._renderToken;
		const state = await this._readState();
		if (token !== this._renderToken) return;
		if (state.hasGroups) this._watchBrowser();

		this.textContent = "";
		const intro = document.createElement("div");
		const lastUsed = state.groupBy === GROUP_BY_LAST_USED;
		const introKey =
			state.bookmarkGroups.length > 0
				? lastUsed
					? "tabGroups_intro_last_used_bookmarks"
					: "tabGroups_intro_opened_bookmarks"
				: lastUsed
					? "tabGroups_intro_last_used"
					: "tabGroups_intro_opened";
		intro.textContent = t(introKey, this._name || TAG);
		this.appendChild(intro);

		if (!state.supported) {
			this.appendChild(this._status(t("tabGroups_unsupported"), true));
			return;
		}
		if (!state.hasGroups) {
			const status = this._status(t("tabGroups_missing_permission") + " ", true);
			this._appendPermissionButton(status, t("tabGroups_grant_tab_groups"), state.requestable);
			this.appendChild(status);
			return;
		}
		if (!state.hasAlarms && state.requestable.includes("alarms")) {
			const status = this._status(t("tabGroups_missing_alarms") + " ", false);
			this._appendPermissionButton(status, t("tabGroups_grant_alarms"), ["alarms"]);
			this.appendChild(status);
		}
		if (state.bookmarkGroups.length > 0 && !state.hasBookmarks) {
			const status = this._status(t("tabGroups_missing_bookmarks") + " ", true);
			this._appendPermissionButton(status, t("tabGroups_grant_bookmarks"), state.requestableBookmarks);
			this.appendChild(status);
		}

		this.appendChild(this._overview(state.overview, state.groupBy));

		const actions = document.createElement("div");
		actions.className = "tab-groups-actions";
		const regroup = document.createElement("button");
		regroup.type = "button";
		regroup.textContent = t("tabGroups_regroup_now");
		regroup.addEventListener("click", async () => {
			regroup.disabled = true;
			this._result = this._describeResult(await this.api.messages.send({ type: REGROUP_MESSAGE }));
			await this._render();
		});
		const settings = document.createElement("button");
		settings.type = "button";
		settings.textContent = t("tabGroups_group_settings");
		settings.addEventListener("click", () => window.open(chrome.runtime.getURL("options.html#module-settings-list")));
		// Zablikání skupin, které modul řídí — blikání mění barvy skupin, takže
		// se element mezitím překresluje; tlačítko zůstane zablokované až do
		// odpovědi.
		const identify = document.createElement("button");
		identify.type = "button";
		identify.textContent = t("tabGroups_identify");
		identify.title = t("tabGroups_identify_title");
		identify.disabled = this._identifying;
		identify.addEventListener("click", async () => {
			this._identifying = true;
			identify.disabled = true;
			this._result = this._describeIdentify(await this.api.messages.send({ type: IDENTIFY_MESSAGE }));
			this._identifying = false;
			await this._render();
		});
		actions.append(regroup, settings, identify);
		this.appendChild(actions);

		if (this._result) {
			const result = document.createElement("div");
			result.className = "tab-groups-result";
			result.setAttribute("role", "status");
			result.textContent = this._result;
			this.appendChild(result);
		}
	}

	/** @type {Classes.ExtensionTabGroups['_status']} */
	_status(text, problem) {
		const status = document.createElement("div");
		status.className = problem ? "tab-groups-status tab-groups-status--problem" : "tab-groups-status";
		status.textContent = text;
		return status;
	}

	// Tlačítko na udělení oprávnění.
	/** @type {Classes.ExtensionTabGroups['_appendPermissionButton']} */
	_appendPermissionButton(status, label, permissions) {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = label;
		button.addEventListener("click", async () => {
			// request() se volá hned, bez čekání — Firefox by gesto uživatele po
			// await nepoznal.
			if (await this.api.permissions.request({ permissions })) await this._render();
		});
		status.appendChild(button);
	}

	/** @type {Classes.ExtensionTabGroups['_overview']} */
	_overview(overview, groupBy) {
		const box = document.createElement("div");
		if (!overview) {
			box.className = "tab-groups-note";
			box.textContent = t("tabGroups_overview_elsewhere");
			return box;
		}
		if (overview.chips.length === 0) {
			box.className = "tab-groups-note";
			box.textContent =
				overview.ungrouped > 0
					? t("tabGroups_overview_not_sorted")
					: t("tabGroups_overview_no_groups");
			return box;
		}
		const list = document.createElement("ul");
		list.className = "tab-groups-list";
		const periodKey = groupBy === GROUP_BY_LAST_USED ? "tabGroups_chip_last_used" : "tabGroups_chip_opened";
		for (const chip of overview.chips) {
			const item = document.createElement("li");
			item.className = `tab-groups-chip tab-groups-color--${chip.color}`;
			item.title = t(chip.kind === "period" ? periodKey : "tabGroups_chip_bookmarks", chip.range, chip.count);
			const count = document.createElement("span");
			count.className = "tab-groups-count";
			count.textContent = String(chip.count);
			item.append(chip.title, count);
			list.appendChild(item);
		}
		box.appendChild(list);
		if (overview.userGroups > 0) {
			const note = document.createElement("div");
			note.className = "tab-groups-note";
			note.textContent = t("tabGroups_user_groups", overview.userGroups);
			box.appendChild(note);
		}
		return box;
	}

	/** @type {Classes.ExtensionTabGroups['_describeResult']} */
	_describeResult(response) {
		if (!response) return t("tabGroups_no_response");
		if (response.ok) return response.changed ? t("tabGroups_regrouped") : t("tabGroups_nothing_to_regroup");
		/** @type {Record<Types.TabGroups.RegroupProblem, string>} */
		const problems = {
			disabled: t("tabGroups_problem_disabled"),
			unavailable: t("tabGroups_problem_unavailable"),
			error: t("tabGroups_problem_error", response.error || t("tabGroups_unknown_error")),
		};
		return problems[response.reason || "error"];
	}

	/** @type {Classes.ExtensionTabGroups['_describeIdentify']} */
	_describeIdentify(response) {
		if (!response) return t("tabGroups_no_response");
		if (response.ok) return response.count ? tp("tabGroups_identified", response.count) : t("tabGroups_identified_none");
		/** @type {Record<Types.TabGroups.RegroupProblem, string>} */
		const problems = {
			disabled: t("tabGroups_problem_disabled"),
			unavailable: t("tabGroups_problem_unavailable"),
			error: t("tabGroups_identify_error", response.error || t("tabGroups_unknown_error")),
		};
		return problems[response.reason || "error"];
	}
}

customElements.define(TAG, ExtensionTabGroups);

registerModule({
	name: MODULE_NAME,
	tag: TAG,
	description: DESCRIPTION,
	activationSpec: ACTIVATION_SPEC,
	usesPermissions: USES_PERMISSIONS,
	settingsSchema: SETTINGS_SCHEMA,
	styles: STYLES,
	defaultActivationMode: DEFAULT_ACTIVATION_MODE,
	defaultDisplayLocation: DEFAULT_DISPLAY_LOCATION,
	defaultOutputElement: DEFAULT_OUTPUT_ELEMENT,
	defaultShowHeading: DEFAULT_SHOW_HEADING,
});
