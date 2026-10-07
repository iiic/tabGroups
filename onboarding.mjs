//@ts-check
"use strict";

// onboarding.mjs — uvítací stránka (onboarding.html). Po instalaci rozšíření
// ji v nové kartě otevře modul onboardingModule (jde otevřít i jeho
// tlačítkem). Vypisuje elementy modulů s plochou výstupu "onboarding" (viz
// DISPLAY_LOCATIONS v base.mjs) stejným sdíleným mechanismem jako postranní
// panel — co na ní bude, určuje u každého modulu „Vypisovat data modulu“.
// Nad výpisy je volba jazyka rozhraní, stejná jako na stránce Nastavení.
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
		// Vykreslí vlastní elementy všech modulů, které mají v Nastavení
		// modulů zvolené "Vypisovat data modulu: Na uvítací stránce".
		await this.renderModulesFor("onboarding", this.outputEl);
		// Bez jediného vypsaného modulu by stránka zůstala prázdná — poradí
		// aspoň, kde se to nastavuje.
		this.emptyEl.hidden = !!this.outputEl.querySelector(".module-frame");
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	await initPageI18n();
	await initUiLanguageSelect(/** @type {HTMLSelectElement} */ (document.getElementById("ui-language")));
	const controller = new OnboardingController();
	controller.initPage();
});
