//@ts-check
"use strict";

// modules-background.mjs — the list of module background parts
// (modules/<name>/background-script.mjs, see registerBackgroundScript() in
// base.mjs) loaded by background.js.
//
// Why a list, and not a lookup by modules.json as for content scripts:
// in Chrome, background.js is a service worker, and that does not allow
// dynamic import() (see the comment at the beginning of background.js). Module
// code gets into it only by a static import, so a module with a background part
// is also written here (one line), not only into modules.json.
//
// Careful: a file listed here that is missing on disk (or has a syntax error)
// stops loading the WHOLE background.js — the browser then reports a service
// worker error for the extension. When removing a module from disk, delete its
// line here too. Removing a module from the module list or turning it off in
// Settings does not require changing this file: the background part itself
// checks whether it should work, through api.activation (see sdk.mjs).
import "./modules/tabGroups/background-script.mjs";
import "./modules/onboardingModule/background-script.mjs";
