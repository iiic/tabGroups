//@ts-check
"use strict";

// modules/onboardingModule/background-script.mjs
// The background part of the onboardingModule module (see registerBackgroundScript() in
// sdk.mjs): after the extension is installed it opens the welcome page in a new tab —
// in the "After the extension is installed" activation mode (OPEN_AFTER_INSTALL_SPEC).
// The listener is api.activation.onInstalled(), not
// chrome.runtime.onInstalled directly: the core calls it only after the default
// module settings (default-settings.json) are written, so the page renders already
// with them — including the modules those very settings send to the "onboarding" surface.
// In a standalone extension built from a module (a client of the full extension, see "Modules from
// other extensions" in base.mjs) the page opens only when the full extension is not installed — next to
// it the user already got its welcome page and the module's place is in it.
import { registerBackgroundScript, isServiceProviderPresent } from "../../sdk.mjs";
import { MODULE_NAME, DEFAULT_ACTIVATION_MODE, OPEN_AFTER_INSTALL_SPEC, ONBOARDING_PAGE } from "./module.mjs";

registerBackgroundScript({
	name: MODULE_NAME,
	setup: ({ api }) => {
		// Only after a fresh install — neither an update nor a reload of the extension
		// opens the welcome page.
		/** @type {Functions.OnboardingModule.BackgroundScript.openAfterInstall} */
		async function openAfterInstall({ reason }) {
			if (reason !== "install") return;
			if (!(await api.activation.isActive(DEFAULT_ACTIVATION_MODE, OPEN_AFTER_INSTALL_SPEC))) return;
			if (await isServiceProviderPresent()) return;
			await chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PAGE) });
		}

		// The listener synchronously in setup() (see registerBackgroundScript()).
		api.activation.onInstalled(openAfterInstall);
	},
});
