//@ts-check
"use strict";

// modules/onboardingModule/onboardingModule.mjs
// The onboardingModule module element: one line — whether the welcome page opens after the extension
// is installed (according to the activation mode, see
// OPEN_AFTER_INSTALL_SPEC in module.mjs) — and a button that opens it right away,
// for example after changing what is listed on it. The opening after installation itself
// is done by the background part (background-script.mjs), the element is not needed for that.
import { BaseElement, registerModule, t } from "../../sdk.mjs";
import {
	MODULE_NAME,
	TAG,
	DESCRIPTION,
	ACTIVATION_SPEC,
	OPEN_AFTER_INSTALL_SPEC,
	DEFAULT_ACTIVATION_MODE,
	DEFAULT_DISPLAY_LOCATION,
	DEFAULT_OUTPUT_ELEMENT,
	DEFAULT_SHOW_HEADING,
	ONBOARDING_PAGE,
} from "./module.mjs";

/** @implements {Classes.ExtensionOnboardingModule} */
class ExtensionOnboardingModule extends BaseElement {
	/**
	 * @override
	 * @type {typeof Classes.ExtensionOnboardingModule.observedAttributes}
	 */
	static get observedAttributes() {
		return [];
	}

	constructor() {
		super();
	}

	/**
	 * @override
	 * @type {Classes.ExtensionOnboardingModule['connectedCallback']}
	 */
	connectedCallback() {
		this.className = "module-output";
	}

	/**
	 * @override
	 * @type {Classes.ExtensionOnboardingModule['disconnectedCallback']}
	 */
	disconnectedCallback() {
		super.disconnectedCallback();
	}

	/**
	 * @override
	 * @type {Classes.ExtensionOnboardingModule['connectedMoveCallback']}
	 */
	connectedMoveCallback() {
		// The element holds no state tied to its position in the DOM — after a move via
		// moveBefore() nothing needs to be done.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionOnboardingModule['adoptedCallback']}
	 */
	adoptedCallback() {
		// The module does not need to react to a move to another document.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionOnboardingModule['attributeChangedCallback']}
	 */
	attributeChangedCallback(_name, _oldValue, _newValue) {
		// The module does not watch any HTML attributes.
	}

	/**
	 * @override
	 * @type {Classes.ExtensionOnboardingModule['init']}
	 */
	async init({ outputEl, name, mode, location }) {
		await super.init({ outputEl, name, mode, location });

		if (!this.isActivationSatisfied()) {
			this.textContent = t("onboardingModule_disabled", name);
			return;
		}

		this._render();
	}

	/** @type {Classes.ExtensionOnboardingModule['_render']} */
	_render() {
		const status = document.createElement("span");
		status.textContent = OPEN_AFTER_INSTALL_SPEC.isSatisfiedBy({ mode: this._mode })
			? t("onboardingModule_opens_after_install", this._name) + " "
			: t("onboardingModule_not_opening", this._name) + " ";

		const button = document.createElement("button");
		button.type = "button";
		button.textContent = t("onboardingModule_open_button");
		if (this._location === "onboarding") {
			button.disabled = true;
			button.title = t("onboardingModule_already_open");
		} else {
			button.addEventListener("click", () => this._openOnboardingPage());
		}

		this.replaceChildren(status, button);
	}

	// In a new tab of the current window. The floating window's <iframe> in Firefox
	// has no chrome.tabs — there via window.open().
	/** @type {Classes.ExtensionOnboardingModule['_openOnboardingPage']} */
	_openOnboardingPage() {
		const url = chrome.runtime.getURL(ONBOARDING_PAGE);
		if (typeof chrome.tabs?.create !== "function") {
			window.open(url);
			return;
		}
		chrome.tabs.create({ url }).catch((err) => console.error("Uvítací stránku nejde otevřít:", err));
	}
}

customElements.define(TAG, ExtensionOnboardingModule);

registerModule({
	name: MODULE_NAME,
	tag: TAG,
	description: DESCRIPTION,
	activationSpec: ACTIVATION_SPEC,
	defaultActivationMode: DEFAULT_ACTIVATION_MODE,
	defaultDisplayLocation: DEFAULT_DISPLAY_LOCATION,
	defaultOutputElement: DEFAULT_OUTPUT_ELEMENT,
	defaultShowHeading: DEFAULT_SHOW_HEADING,
});
