//@ts-check
"use strict";

// modules/tabGroups/tabGroups.mjs
// The tabGroups module element: how tabs are sorted and the status of permissions with buttons
// to grant them. Tabs are sorted by the background part (background-script.mjs) even without an
// open element. The overview of the automatic groups of the window with the "Regroup now",
// "Group settings" and "Identify managed groups" buttons, and the editor of the settings (sorting by
// opening or by the tab's last use, group names and colors, groups from bookmarks), are tabGroupsSandbox
// — it runs in the sandbox (sandbox-modules/tabGroupsSandbox) and the background part of this module does
// for it what needs the browser (its services tabGroups.*, background-script.mjs). What stays here is
// asking for the permissions — a module in the sandbox cannot ask for a permission.
import { BaseElement, registerModule, t } from "../../sdk.mjs";
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
	SETTINGS_EDITED_BY,
	STYLES,
	USES_PERMISSIONS,
	TAB_GROUPS_PERMISSIONS,
	ALARMS_PERMISSIONS,
	BOOKMARK_GROUPS_PERMISSIONS,
	GROUP_BY_KEY,
	BOOKMARK_GROUPS_KEY,
} from "./module.mjs";
import { DEFAULT_GROUP_BY, GROUP_BY_LAST_USED, normalizeGroupBy } from "./buckets.mjs";
import { normalizeBookmarkGroups } from "./bookmarkGroups.mjs";

// The re-render delay after a change — saving Settings changes several keys at once.
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
		// Listeners of settings and permissions from init().
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
		// The element does not hold state tied to its position in the DOM — after a move via
		// moveBefore() nothing needs to be done.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['adoptedCallback']}
	 */
	adoptedCallback() {
		// The module does not need to react to a move to another document.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionTabGroups['attributeChangedCallback']}
	 */
	attributeChangedCallback(_name, _oldValue, _newValue) {
		// The module does not watch any HTML attributes.
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
		// The sorting and a granted permission show up immediately (the side panel stays open).
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

	// What the element lists: support in the browser, the sorting and the permissions.
	/** @type {Classes.ExtensionTabGroups['_readState']} */
	async _readState() {
		const optional = new Set(chrome.runtime.getManifest().optional_permissions || []);
		return {
			supported: !!chrome.tabs && typeof chrome.tabs.group === "function",
			hasGroups: await this.api.permissions.contains(TAB_GROUPS_PERMISSIONS),
			hasAlarms: await this.api.permissions.contains(ALARMS_PERMISSIONS),
			groupBy: normalizeGroupBy(await this.api.settings.get(GROUP_BY_KEY, DEFAULT_GROUP_BY)),
			// Rows with a folder — only those are used (resolveBookmarkGroups() in bookmarkGroups.mjs).
			bookmarkGroups: normalizeBookmarkGroups(await this.api.settings.get(BOOKMARK_GROUPS_KEY, [])).filter((row) => row.folderId).length,
			hasBookmarks: await this.api.permissions.contains(BOOKMARK_GROUPS_PERMISSIONS),
			// Only permissions the manifest offers as optional (Firefox has
			// "alarms" required and would reject the whole request for it).
			requestable: [...(TAB_GROUPS_PERMISSIONS.permissions || []), ...(ALARMS_PERMISSIONS.permissions || [])].filter((p) => optional.has(p)),
			requestableBookmarks: (BOOKMARK_GROUPS_PERMISSIONS.permissions || []).filter((p) => optional.has(p)),
		};
	}

	/** @type {Classes.ExtensionTabGroups['_render']} */
	async _render() {
		const token = ++this._renderToken;
		const state = await this._readState();
		if (token !== this._renderToken) return;

		this.textContent = "";
		const intro = document.createElement("div");
		const lastUsed = state.groupBy === GROUP_BY_LAST_USED;
		const introKey =
			state.bookmarkGroups > 0
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
		let missing = false;
		if (!state.hasGroups) {
			missing = true;
			const status = this._status(t("tabGroups_missing_permission") + " ", true);
			this._appendPermissionButton(status, t("tabGroups_grant_tab_groups"), state.requestable);
			this.appendChild(status);
		}
		if (state.hasGroups && !state.hasAlarms && state.requestable.includes("alarms")) {
			missing = true;
			const status = this._status(t("tabGroups_missing_alarms") + " ", false);
			this._appendPermissionButton(status, t("tabGroups_grant_alarms"), ["alarms"]);
			this.appendChild(status);
		}
		if (state.hasGroups && state.bookmarkGroups > 0 && !state.hasBookmarks) {
			missing = true;
			const status = this._status(t("tabGroups_missing_bookmarks") + " ", true);
			this._appendPermissionButton(status, t("tabGroups_grant_bookmarks"), state.requestableBookmarks);
			this.appendChild(status);
		}
		if (!missing) this.appendChild(this._status(t("tabGroups_permissions_ok"), false));
		this.appendChild(this._status(t("tabGroups_overview_in_sandbox"), false));
	}

	/** @type {Classes.ExtensionTabGroups['_status']} */
	_status(text, problem) {
		const status = document.createElement("div");
		status.className = problem ? "tab-groups-status tab-groups-status--problem" : "tab-groups-status";
		status.textContent = text;
		return status;
	}

	// A button for granting the permission. chrome.permissions is not available inside the floating
	// window's <iframe> (see api.permissions.request() in base.mjs) — the button would
	// always fail there, instead it says where to grant the permission.
	/** @type {Classes.ExtensionTabGroups['_appendPermissionButton']} */
	_appendPermissionButton(status, label, permissions) {
		if (typeof chrome.permissions === "undefined") {
			status.append(t("tabGroups_permission_floating"));
			return;
		}
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = label;
		button.addEventListener("click", async () => {
			// request() is called right away, without waiting — Firefox would not recognize the user gesture after
			// an await.
			if (await this.api.permissions.request({ permissions })) await this._render();
		});
		status.appendChild(button);
	}
}

customElements.define(TAG, ExtensionTabGroups);

registerModule({
	name: MODULE_NAME,
	tag: TAG,
	description: DESCRIPTION,
	version: VERSION,
	activationSpec: ACTIVATION_SPEC,
	usesPermissions: USES_PERMISSIONS,
	styles: STYLES,
	defaultActivationMode: DEFAULT_ACTIVATION_MODE,
	defaultDisplayLocation: DEFAULT_DISPLAY_LOCATION,
	defaultOutputElement: DEFAULT_OUTPUT_ELEMENT,
	defaultShowHeading: DEFAULT_SHOW_HEADING,
	settingsEditedBy: SETTINGS_EDITED_BY,
});
