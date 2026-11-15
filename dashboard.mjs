//@ts-check
"use strict";

// dashboard.mjs — the dashboard (dashboard.html): the "dashboard" output surface (DISPLAY_LOCATIONS in base.mjs) in
// a whole tab of the browser window. It shows the elements of the modules that have "Show module output: Dashboard"
// ticked, the same way as the side panel — the same shared mechanism (renderModulesFor()), the output follows
// switching tabs and loads of the page, one module can be pinned to the top. It is a tab itself, so the tab it
// relates to is the one the user came from — the most recently used other tab of the window (queryCurrentTab() in
// base.mjs), not the dashboard. When no module is sent to the popup and at least one here, the extension button opens
// this page (or brings its open tab to the front) instead of the popup — see ACTION_OPENS_DASHBOARD_KEY in base.mjs.
import { BaseController, mountExtensionIdWatermark, queryCurrentTab } from "./base.mjs";
import { initPageI18n } from "./i18n.mjs";

/** @implements {Classes.DashboardController} */
class DashboardController extends BaseController {
	constructor() {
		super();
		this.outputEl = /** @type {Classes.DashboardController['outputEl']} */ (document.getElementById("modules-output"));
		this.emptyEl = /** @type {Classes.DashboardController['emptyEl']} */ (document.getElementById("dashboard-empty"));
	}

	// The rules of the modules (WEB_PAGE_SPEC, UrlPatternSpecification) are evaluated for the tab the user came from —
	// the dashboard itself is the active tab while it is shown.
	/**
	 * @override
	 * @type {Classes.DashboardController['queryPageTab']}
	 */
	queryPageTab() {
		return queryCurrentTab();
	}

	/** @type {Classes.DashboardController['initPage']} */
	async initPage() {
		// Right away: from now on the dashboard follows which tab the user came from (the first read starts it,
		// trackPreviousTab() in base.mjs) — a switch of tabs while the modules load counts too.
		await queryCurrentTab();
		// An extension that offers its modules and waits for the user's decision — its modules work twice until then.
		this.mountPendingServiceNotice(this.outputEl, "dashboard");
		// Renders the custom elements of all modules that have "Show module output: Dashboard" selected in the
		// module Settings.
		await this.renderModulesFor("dashboard", this.outputEl);
		// "Filter by name" above them — from OUTPUT_MODULE_FILTER_MIN modules sent here. It says which modules those
		// are: without a single one the page would stay empty — at least tell the user where it is configured. By the
		// settings, not by what is shown right now: a module for web pages is not shown while the last tab is a special
		// page of the browser.
		const modules = await this.mountModuleFilter(this.outputEl, "dashboard");
		this.emptyEl.hidden = modules.length > 0;
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	mountExtensionIdWatermark();
	await initPageI18n();
	const controller = new DashboardController();
	controller.initPage();
});
