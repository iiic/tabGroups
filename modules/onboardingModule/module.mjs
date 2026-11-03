//@ts-check
"use strict";

// modules/onboardingModule/module.mjs
// The module description without DOM (see halloWorld/module.mjs). The module is tied to
// the extension's installation: its background part (background-script.mjs) opens the
// welcome page onboarding.html in a new tab after installation. That page is
// the "onboarding" output surface — what is listed on it is decided for each module by
// its "Show module output" option in Settings. The module's element only shows
// whether the page opens after installation, and offers to open it right away.
import { getTagName, NOT_DISABLED_SPEC, INSTALL_SPEC, t } from "../../sdk.mjs";

export const MODULE_NAME = "onboardingModule";
export const TAG = getTagName(MODULE_NAME); // "extension-onboarding-module"
export const DESCRIPTION = t("onboardingModule_description");

// The element is listed in every enabled mode — in a mode other than "After the extension
// is installed" it points out that the page does not open after installation.
export const ACTIVATION_SPEC = NOT_DISABLED_SPEC;
// It opens the welcome page after installation only in the "After the extension is installed" mode.
export const OPEN_AFTER_INSTALL_SPEC = INSTALL_SPEC;
/** @type {Types.ModuleDescriptor['DEFAULT_ACTIVATION_MODE']} */
export const DEFAULT_ACTIVATION_MODE = "install";
// The status and the button belong to managing the extension, not to browsing pages.
/** @type {Types.ModuleDescriptor['DEFAULT_DISPLAY_LOCATION']} */
export const DEFAULT_DISPLAY_LOCATION = "options";

// One short line with a button — a block element, without the frame heading (the text
// starts with the module name).
/** @type {Types.ModuleDescriptor['DEFAULT_OUTPUT_ELEMENT']} */
export const DEFAULT_OUTPUT_ELEMENT = "block";
/** @type {Types.ModuleDescriptor['DEFAULT_SHOW_HEADING']} */
export const DEFAULT_SHOW_HEADING = false;

// The welcome page — the core's page for the "onboarding" output surface (the path
// in the extension for chrome.runtime.getURL()).
export const ONBOARDING_PAGE = "onboarding.html";
