//@ts-check
"use strict";

// onboarding.mjs — the welcome page (onboarding.html). After the extension is
// installed, the onboardingModule module opens it in a new tab (it can also be
// opened with its button). It shows the elements of modules with the "onboarding"
// output surface (see DISPLAY_LOCATIONS in base.mjs) using the same shared
// mechanism as the side panel — what it shows is set for each module by
// "Show module output". Above the outputs is the UI language choice, the same
// as on the Settings page.
import { BaseController } from "./base.mjs";
import { initPageI18n, initUiLanguageSelect } from "./i18n.mjs";

/** @implements {Classes.OnboardingController} */
class OnboardingController extends BaseController {
	constructor() {
		super();
		this.outputEl = /** @type {Classes.OnboardingController['outputEl']} */ (document.getElementById("modules-output"));
		this.emptyEl = /** @type {Classes.OnboardingController['emptyEl']} */ (document.getElementById("onboarding-empty"));
	}

	/** @type {Classes.OnboardingController['initPage']} */
	async initPage() {
		// Renders the custom elements of all modules that have "Show module output:
		// On the welcome page" selected in the module Settings.
		await this.renderModulesFor("onboarding", this.outputEl);
		// Without a single module shown the page would stay empty — at least
		// tell the user where it is configured.
		this.emptyEl.hidden = !!this.outputEl.querySelector(".module-frame");
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	await initPageI18n();
	await initUiLanguageSelect(/** @type {HTMLSelectElement} */ (document.getElementById("ui-language")));
	const controller = new OnboardingController();
	controller.initPage();
});
