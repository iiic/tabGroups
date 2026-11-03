//@ts-check
"use strict";

// floating.mjs
import { BaseController } from "./base.mjs";
import { initPageI18n } from "./i18n.mjs";

/** @implements {Classes.FloatingController} */
class FloatingController extends BaseController {
	constructor() {
		super();
		this.outputEl = /** @type {Classes.FloatingController['outputEl']} */ (document.getElementById("modules-output"));
	}

	/** @type {Classes.FloatingController['initPage']} */
	async initPage() {
		// An extension that offers its modules and waits for the user's decision — its modules work twice until then.
		this.mountPendingServiceNotice(this.outputEl, "floating");
		// Renders the custom elements of all modules that have "Show module output:
		// In the floating window" selected in the module Settings.
		await this.renderModulesFor("floating", this.outputEl);
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	await initPageI18n();
	const controller = new FloatingController();
	controller.initPage();
});
