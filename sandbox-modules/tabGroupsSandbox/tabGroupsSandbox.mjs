//@ts-check
"use strict";

// sandbox-modules/tabGroupsSandbox/tabGroupsSandbox.mjs
//
// The overview of the automatic tab groups of the current window — colored chips with the number of
// tabs in the order of the tab strip and the "Regroup now", "Group settings" and "Identify managed
// groups" buttons. An UPLOADED module (a package of JS modules) that the extension brings itself
// (BUNDLED_SANDBOX_MODULES in base.mjs): the overview used to be the element of modules/tabGroups and
// now runs in the sandbox.
//
// The work that needs the browser stays with tabGroups: its background part sorts the tabs and the
// core runs its code in the page that embeds the overview through functions outside the sandbox
// (CAPABILITIES in module.mjs). tabGroups.getOverview reads the groups of the window, which of them are
// the module's, the sorting from the settings and which permissions are missing; tabGroups.regroup and
// tabGroups.identify ask the background part to regroup the tabs right now and to blink its groups; the
// listener tabGroups.onChange says when the groups of the page changed ("groups") or the settings, the
// module list or the permissions did ("status"). The user can deny each function in Settings →
// "Uploaded modules (sandbox)": without the overview the module shows only why, without the listener it
// does not follow the changes, a denied button is not shown.
//
// Without the permissions the overview only says what is missing and opens the page where tabGroups asks for
// them (tabGroups.openPermissions — a sandboxed module cannot ask for a permission).
//
// In Settings the element is also the editor of the settings of tabGroups (registerModule({ settingsView }),
// init({ location: "settings" }), settingsView.mjs) — it gets them through tabGroups.getSettings and stores every
// change through tabGroups.setSettings.
//
// The package: tabGroupsSandbox.mjs (the element), module.mjs (the description without DOM), settingsView.mjs
// (the editor of the settings), tabGroupsSandbox.css and messages.json (the texts in all UI languages) — a new file
// belongs in BUNDLED_SANDBOX_MODULES too (tests/manifests.test.mjs checks it).
import { BaseElement, registerModule, t, tp } from "../../sdk.mjs";
import {
	MODULE_NAME,
	TAG,
	DESCRIPTION,
	VERSION,
	ACTIVATION_SPEC,
	DEFAULT_ACTIVATION_MODE,
	DEFAULT_DISPLAY_LOCATION,
	DEFAULT_OUTPUT_ELEMENT,
	DEFAULT_SHOW_HEADING,
	STYLES,
	DEPENDS_ON,
	CAPABILITIES,
	SETTINGS_VIEW,
} from "./module.mjs";
import { renderSettingsEditor } from "./settingsView.mjs";

// The functions outside the sandbox (declared in module.mjs).
const GET_OVERVIEW = "tabGroups.getOverview";
const REGROUP = "tabGroups.regroup";
const IDENTIFY = "tabGroups.identify";
const GET_SETTINGS = "tabGroups.getSettings";
const SET_SETTINGS = "tabGroups.setSettings";
const OPEN_PERMISSIONS = "tabGroups.openPermissions";
const ON_CHANGE = "tabGroups.onChange";
const OPEN_OPTIONS = "options.open";

// Regrouping triggers a series of events — the overview loads once after them.
const REFRESH_DELAY_MS = 150;

// The sorting by the day of last use (GROUP_BY_LAST_USED in modules/tabGroups/buckets.mjs).
const GROUP_BY_LAST_USED = "lastUsed";

// Why tabGroups does not work (the reason of the functions).
/** @type {Record<Enums.SandboxTabGroupsReason, () => string>} */
const NOT_WORKING = {
	notListed: () => t("tabGroupsSandbox_status_not_listed"),
	disabled: () => t("tabGroupsSandbox_status_disabled"),
};

// Type checking sees this.api of BaseElement in sdk.mjs; in the sandbox it is
// Types.SandboxModuleApi, which has capabilities.
/** @type {Functions.TabGroupsSandbox.Element.sandboxApi} */
function sandboxApi(element) {
	return /** @type {Types.SandboxModuleApi} */ (/** @type {unknown} */ (element.api));
}

/** @type {Functions.TabGroupsSandbox.Element.errorText} */
function errorText(err) {
	return err instanceof Error ? err.message : String(err);
}

/** @implements {Classes.ExtensionTabGroupsSandbox} */
class ExtensionTabGroupsSandbox extends /** @type {Types.WithFields<typeof BaseElement, Classes.ExtensionTabGroupsSandbox.Fields>} */ (BaseElement) {
	// activationSpec is looked up from the registry in init() (see ACTIVATION_SPEC in module.mjs).

	/**
	 * @override
	 * @type {typeof Classes.ExtensionTabGroupsSandbox.observedAttributes}
	 */
	static get observedAttributes() {
		return [];
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroupsSandbox['connectedCallback']}
	 */
	connectedCallback() {
		this.className = "module-output tab-groups-sandbox";
		this.textContent = t("tabGroupsSandbox_loading", TAG);
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroupsSandbox['disconnectedCallback']}
	 */
	disconnectedCallback() {
		// The core unsubscribes the module's listeners itself when its element in the extension page
		// goes away (the whole sandbox page goes with it) — this is for a detach in the sandbox.
		super.disconnectedCallback();
		for (const unsubscribe of this._unsubscribers || []) unsubscribe();
		this._unsubscribers = [];
		if (this._refreshTimer) clearTimeout(this._refreshTimer);
		this._refreshTimer = null;
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroupsSandbox['connectedMoveCallback']}
	 */
	connectedMoveCallback() {
		// The module holds no state tied to a position in the DOM — after a move
		// with moveBefore() there is nothing to do.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroupsSandbox['adoptedCallback']}
	 */
	adoptedCallback() {
		// The module does not need to react to a move into another document.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroupsSandbox['attributeChangedCallback']}
	 */
	attributeChangedCallback(_name, _oldValue, _newValue) {
		// The module observes no HTML attributes.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroupsSandbox['init']}
	 */
	async init({ outputEl, name, mode, location }) {
		await super.init({ outputEl, name, mode, location });

		// The editor of the settings works also while the module is turned off.
		if (location !== "settings" && !this.isActivationSatisfied(mode)) {
			this.textContent = t("tabGroupsSandbox_disabled", name);
			return;
		}

		const api = sandboxApi(this);
		this._data = null;
		this._problem = null;
		this._result = "";
		this._busy = false;
		this._states = {};
		this._listening = false;
		this._unsubscribers = [];
		this._refreshTimer = null;
		this._loadId = 0;
		this._settingsShown = false;
		this.textContent = t("tabGroupsSandbox_loading", this._name || TAG);

		// The user decides about the functions in Settings — after a change the overview starts again
		// (reading allowed now, the listener denied, …).
		this._unsubscribers.push(
			api.capabilities.onChange((states) => {
				this._states = states;
				this._start();
			})
		);
		try {
			this._states = await api.capabilities.state();
		} catch (err) {
			console.error(err);
		}
		await this._start();
	}

	// Follows the changes and loads the overview — as far as the user allows the functions. A listener
	// the user denies later gets no events from the core (and gets them again once allowed), so it is
	// subscribed only once.
	/** @type {Classes.ExtensionTabGroupsSandbox['_start']} */
	async _start() {
		if (this._allowed(ON_CHANGE) && !this._listening) {
			this._listening = true;
			// The editor of the settings follows only the settings and the permissions ("status"), not the tabs.
			const unsubscribe = sandboxApi(this).capabilities.listen(ON_CHANGE, (change) => {
				if (this._location !== "settings" || change === "status") this._scheduleRefresh();
			});
			(this._unsubscribers ??= []).push(unsubscribe);
		}
		await this._load();
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_allowed']} */
	_allowed(capability) {
		return this._states[capability] === "allowed";
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_scheduleRefresh']} */
	_scheduleRefresh() {
		if (this._refreshTimer) clearTimeout(this._refreshTimer);
		this._refreshTimer = setTimeout(() => {
			this._refreshTimer = null;
			this._load();
		}, REFRESH_DELAY_MS);
	}

	// Loads the overview and renders it. Concurrent loads may return in a different order — only the
	// last one is rendered.
	/** @type {Classes.ExtensionTabGroupsSandbox['_load']} */
	async _load() {
		const loadId = this._loadId + 1;
		this._loadId = loadId;
		if (this._location === "settings") {
			await this._loadSettings(loadId);
			return;
		}
		if (!this._allowed(GET_OVERVIEW)) {
			this._data = null;
			this._problem = t("tabGroupsSandbox_not_allowed", this._name || TAG);
			this._render();
			return;
		}
		/** @type {Types.SandboxTabGroupsOverview} */
		let result;
		try {
			result = /** @type {Types.SandboxTabGroupsOverview} */ (await sandboxApi(this).capabilities.call(GET_OVERVIEW));
		} catch (err) {
			if (loadId !== this._loadId) return;
			console.error(err);
			this._data = null;
			this._problem = t("tabGroupsSandbox_load_failed", this._name || TAG, errorText(err));
			this._render();
			return;
		}
		if (loadId !== this._loadId) return;
		this._data = result;
		this._problem = null;
		this._render();
	}

	// The intro with the sorting, what is missing, the chips, the buttons and the result of the last one.
	/** @type {Classes.ExtensionTabGroupsSandbox['_render']} */
	_render() {
		this.textContent = "";
		const name = this._name || TAG;
		if (this._problem !== null) {
			this.appendChild(this._status(this._problem, true));
			return;
		}
		const data = this._data;
		if (!data) {
			this.textContent = t("tabGroupsSandbox_loading", name);
			return;
		}
		if (data.reason) {
			this.append(this._status(t("tabGroupsSandbox_intro", name), false), this._status(NOT_WORKING[data.reason](), true));
			return;
		}
		const overview = data.overview;
		if (!overview) return;

		const intro = document.createElement("div");
		const lastUsed = overview.groupBy === GROUP_BY_LAST_USED;
		const introKey =
			overview.bookmarkGroups > 0
				? lastUsed
					? "tabGroupsSandbox_intro_last_used_bookmarks"
					: "tabGroupsSandbox_intro_opened_bookmarks"
				: lastUsed
					? "tabGroupsSandbox_intro_last_used"
					: "tabGroupsSandbox_intro_opened";
		intro.textContent = t(introKey, name);
		this.appendChild(intro);

		if (!overview.supported) {
			this.appendChild(this._status(t("tabGroupsSandbox_unsupported"), true));
			return;
		}
		if (!overview.hasGroups) {
			this.appendChild(this._missing(t("tabGroupsSandbox_missing_permission"), true));
			return;
		}
		if (!overview.hasAlarms) this.appendChild(this._missing(t("tabGroupsSandbox_missing_alarms"), false));
		if (!overview.hasBookmarks) this.appendChild(this._missing(t("tabGroupsSandbox_missing_bookmarks"), true));

		this.appendChild(this._chips(overview));
		this.appendChild(this._actions());

		if (this._result) {
			const result = this._status(this._result, false);
			result.setAttribute("role", "status");
			this.appendChild(result);
		}
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_status']} */
	_status(text, problem) {
		const status = document.createElement("div");
		status.className = problem ? "tab-groups-status tab-groups-status--problem" : "tab-groups-status";
		status.textContent = text;
		return status;
	}

	// A missing permission with the button that opens the page where tabGroups asks for it, or where to go.
	/** @type {Classes.ExtensionTabGroupsSandbox['_missing']} */
	_missing(text, problem) {
		const status = this._status(text + " ", problem);
		if (this._allowed(OPEN_PERMISSIONS)) {
			status.appendChild(this._button(t("tabGroupsSandbox_open_settings"), () => this._openPermissions()));
		} else {
			status.append(t("tabGroupsSandbox_grant_in_options"));
		}
		return status;
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_openPermissions']} */
	_openPermissions() {
		sandboxApi(this)
			.capabilities.call(OPEN_PERMISSIONS)
			.catch((err) => console.warn("tabGroupsSandbox: stránka s oprávněními se neotevřela", err));
	}

	// The editor of the settings (location "settings"): the settings of tabGroups and its editor — not while the user
	// is editing it (a change made elsewhere shows up on the next opening then).
	/** @type {Classes.ExtensionTabGroupsSandbox['_loadSettings']} */
	async _loadSettings(loadId) {
		const name = this._name || TAG;
		if (!this._allowed(GET_SETTINGS) || !this._allowed(SET_SETTINGS)) {
			this.replaceChildren(this._status(t("tabGroupsSandbox_settings_not_allowed", name), true));
			this._settingsShown = false;
			return;
		}
		if (this._settingsShown && this.contains(document.activeElement)) return;
		/** @type {Types.TabGroups.SettingsView} */
		let view;
		try {
			view = /** @type {Types.TabGroups.SettingsView} */ (await sandboxApi(this).capabilities.call(GET_SETTINGS));
		} catch (err) {
			if (loadId !== this._loadId) return;
			console.error(err);
			this.replaceChildren(this._status(t("tabGroupsSandbox_settings_load_failed", name, errorText(err)), true));
			this._settingsShown = false;
			return;
		}
		if (loadId !== this._loadId) return;
		const editor = document.createElement("div");
		const status = this._status("", false);
		status.setAttribute("role", "status");
		/** @type {(work: () => Promise<unknown>, done: string) => Promise<void>} */
		const store = async (work, done) => {
			try {
				await work();
				status.className = "tab-groups-status";
				status.textContent = done;
			} catch (err) {
				console.error(err);
				status.className = "tab-groups-status tab-groups-status--problem";
				status.textContent = t("tabGroupsSandbox_settings_save_failed", errorText(err));
			}
		};
		renderSettingsEditor(editor, view, {
			save: (key, value) => store(() => sandboxApi(this).capabilities.call(SET_SETTINGS, { key, value }), t("tabGroupsSandbox_settings_saved")),
			openPermissions: this._allowed(OPEN_PERMISSIONS) ? () => this._openPermissions() : null,
		});
		this.replaceChildren(editor, status);
		this._settingsShown = true;
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_chips']} */
	_chips(overview) {
		const box = document.createElement("div");
		const groups = overview.groups;
		if (!groups) {
			box.className = "tab-groups-status";
			box.textContent = t("tabGroupsSandbox_overview_elsewhere");
			return box;
		}
		if (groups.chips.length === 0) {
			box.className = "tab-groups-status";
			box.textContent = groups.ungrouped > 0 ? t("tabGroupsSandbox_overview_not_sorted") : t("tabGroupsSandbox_overview_no_groups");
			return box;
		}
		const list = document.createElement("ul");
		list.className = "tab-groups-list";
		const periodKey = overview.groupBy === GROUP_BY_LAST_USED ? "tabGroupsSandbox_chip_last_used" : "tabGroupsSandbox_chip_opened";
		for (const chip of groups.chips) {
			const item = document.createElement("li");
			item.className = `tab-groups-chip tab-groups-color--${chip.color}`;
			item.title = t(chip.kind === "period" ? periodKey : "tabGroupsSandbox_chip_bookmarks", chip.range, chip.count);
			const count = document.createElement("span");
			count.className = "tab-groups-count";
			count.textContent = String(chip.count);
			item.append(chip.title, count);
			list.appendChild(item);
		}
		box.appendChild(list);
		if (groups.userGroups > 0) box.appendChild(this._status(t("tabGroupsSandbox_user_groups", groups.userGroups), false));
		return box;
	}

	// The buttons the user allows (a denied function has no button).
	/** @type {Classes.ExtensionTabGroupsSandbox['_actions']} */
	_actions() {
		const actions = document.createElement("div");
		actions.className = "tab-groups-actions";
		if (this._allowed(REGROUP)) {
			actions.appendChild(
				this._button(t("tabGroupsSandbox_regroup_now"), () =>
					this._act(REGROUP, (result) => this._describeResult(/** @type {Types.TabGroups.RegroupResult | null} */ (result)))
				)
			);
		}
		if (this._allowed(OPEN_OPTIONS)) actions.appendChild(this._button(t("tabGroupsSandbox_group_settings"), () => this._openOptions()));
		if (this._allowed(IDENTIFY)) {
			const identify = this._button(t("tabGroupsSandbox_identify"), () =>
				this._act(IDENTIFY, (result) => this._describeIdentify(/** @type {Types.TabGroups.IdentifyResult | null} */ (result)))
			);
			identify.title = t("tabGroupsSandbox_identify_title");
			actions.appendChild(identify);
		}
		return actions;
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_button']} */
	_button(label, onClick) {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = label;
		button.disabled = this._busy;
		button.addEventListener("click", onClick);
		return button;
	}

	// One action at a time: the buttons are disabled until the background part responds (blinking the
	// groups changes their colors — the overview re-renders in the meantime).
	/** @type {Classes.ExtensionTabGroupsSandbox['_act']} */
	async _act(capability, describe) {
		if (this._busy) return;
		this._busy = true;
		this._render();
		try {
			this._result = describe(await sandboxApi(this).capabilities.call(capability));
		} catch (err) {
			console.error(err);
			this._result = t("tabGroupsSandbox_action_failed", errorText(err));
		}
		this._busy = false;
		await this._load();
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_openOptions']} */
	_openOptions() {
		sandboxApi(this)
			.capabilities.call(OPEN_OPTIONS, { hash: "tabGroupsSandbox" })
			.catch((err) => console.warn("tabGroupsSandbox: Nastavení se neotevřelo", err));
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_describeResult']} */
	_describeResult(response) {
		if (!response) return t("tabGroupsSandbox_no_response");
		if (response.ok) return response.changed ? t("tabGroupsSandbox_regrouped") : t("tabGroupsSandbox_nothing_to_regroup");
		/** @type {Record<Types.TabGroups.RegroupProblem, string>} */
		const problems = {
			disabled: t("tabGroupsSandbox_problem_disabled"),
			unavailable: t("tabGroupsSandbox_problem_unavailable"),
			error: t("tabGroupsSandbox_problem_error", response.error || t("tabGroupsSandbox_unknown_error")),
		};
		return problems[response.reason || "error"];
	}

	/** @type {Classes.ExtensionTabGroupsSandbox['_describeIdentify']} */
	_describeIdentify(response) {
		if (!response) return t("tabGroupsSandbox_no_response");
		if (response.ok) return response.count ? tp("tabGroupsSandbox_identified", response.count) : t("tabGroupsSandbox_identified_none");
		/** @type {Record<Types.TabGroups.RegroupProblem, string>} */
		const problems = {
			disabled: t("tabGroupsSandbox_problem_disabled"),
			unavailable: t("tabGroupsSandbox_problem_unavailable"),
			error: t("tabGroupsSandbox_identify_error", response.error || t("tabGroupsSandbox_unknown_error")),
		};
		return problems[response.reason || "error"];
	}
}

customElements.define(TAG, ExtensionTabGroupsSandbox);

registerModule({
	name: MODULE_NAME,
	tag: TAG,
	description: DESCRIPTION,
	version: VERSION,
	activationSpec: ACTIVATION_SPEC,
	dependsOn: DEPENDS_ON,
	capabilities: CAPABILITIES,
	settingsView: SETTINGS_VIEW,
	defaultActivationMode: DEFAULT_ACTIVATION_MODE,
	defaultDisplayLocation: DEFAULT_DISPLAY_LOCATION,
	defaultOutputElement: DEFAULT_OUTPUT_ELEMENT,
	defaultShowHeading: DEFAULT_SHOW_HEADING,
	styles: STYLES,
});
