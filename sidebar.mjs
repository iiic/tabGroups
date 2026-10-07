//@ts-check
"use strict";

// sidebar.mjs
import { BaseController } from "./base.mjs";
import { initPageI18n } from "./i18n.mjs";

/** @implements {Classes.SidebarController} */
class SidebarController extends BaseController {
	constructor() {
		super();
		this.outputEl = /** @type {Classes.SidebarController['outputEl']} */ (document.getElementById("modules-output"));
	}

	/** @type {Classes.SidebarController['initPage']} */
	async initPage() {
		// Vykreslí vlastní elementy všech modulů, které mají v Nastavení
		// modulů zvolené "Vypisovat data modulu: V postranním panelu".
		await this.renderModulesFor("sidebar", this.outputEl);
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	await initPageI18n();
	const controller = new SidebarController();
	controller.initPage();
});
