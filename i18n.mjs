//@ts-check
"use strict";

// i18n.mjs — user interface translations.
//
// The texts are in the standard WebExtension layout: _locales/<language>/messages.json
// ({ "key": { "message": "text" } }), the default language is English
// (default_locale "en" in the manifest). chrome.i18n, however, always takes the
// language from the browser and cannot switch it at runtime — so the user picks
// the UI language (UI_LANGUAGE_KEY in chrome.storage.local, see the Settings page)
// and the texts of the chosen language are loaded directly from messages.json.
//
// _locales/ has only the texts of the core (and the manifest's __MSG_…__). A module
// has its own in its folder, modules/<module>/_locales/<language>/messages.json
// (keys <module>_…), so a page, a content script or the background loads only the texts of
// the modules that run in it: loadI18n() loads those of the core and of the modules added by
// addModuleI18n(). The core adds them itself — on extension pages the modules it imports
// (importModuleFiles() in base.mjs), in the background the modules with a background part
// (registerBackgroundScript()); a module's content script or its own page loads them with
// loadModuleI18n("<module>") instead of loadI18n().
//
// Usage:
//   await loadI18n();            // once at the start (page, content script)
//   await loadModuleI18n("tabGroups") // the same plus the texts of the module (a content script)
//   t("options_save");            // text by key
//   t("popup_module_error", path) // $1…$9 in the text are replaced with the arguments, "$$" is "$"
//   tp("storageManager_items", n) // plural: keys <key>_one/_few/_many/_other
//                                 // according to Intl.PluralRules, $1 is n
//   applyI18n(document)           // data-i18n* HTML attributes (see below)
//
// Before the texts are loaded (background.js at startup, a content script before
// loadI18n()), t() falls back to chrome.i18n.getMessage() — i.e. to the text in the
// browser language; that knows only _locales/, a module's key comes back as the key
// itself. So never call t() at the top level of a file that is
// imported statically (base.mjs, sdk.mjs): a text should be put together only
// when it is shown (in tables of constants through a getter).
//
// Keys in messages.json are case-insensitive (the same as in chrome.i18n) and
// may contain only [A-Za-z0-9_@]; the convention is
// <module or page>_<description_in_lower_case>.

export const UI_LANGUAGE_KEY = "uiLanguage";
/** @type {Enums.UiLanguage} */
export const DEFAULT_UI_LANGUAGE = "en";

// UI languages — each has its own _locales/<value>/messages.json. The label
// is the name of the language in the language itself, so it is not translated in the menu.
/** @type {Types.UiLanguageOption[]} */
export const UI_LANGUAGES = [
	{ value: "en", label: "English" },
	{ value: "cs", label: "Čeština" },
	{ value: "sk", label: "Slovenčina" },
	{ value: "de", label: "Deutsch" },
	{ value: "el", label: "Ελληνικά" },
];

/** @type {Record<string, string>} */
let fallbackMessages = {};
/** @type {Record<string, string>} */
let currentMessages = {};
/** @type {Enums.UiLanguage} */
let currentLanguage = DEFAULT_UI_LANGUAGE;
/** @type {Promise<void> | null} */
let loading = null;
// The language of the last loadI18n() — a load after adding a module keeps it (a page that
// asked for a language does not get the stored one).
/** @type {Promise<Enums.UiLanguage> | null} */
let loadingLanguage = null;
// Loads can overlap (a module added while the texts are loading) — the tables get the
// result of the newest one, an older one finishing later is dropped.
let loadCount = 0;
let appliedLoad = 0;
// Modules whose texts loadI18n() loads with those of the core (see addModuleI18n()).
/** @type {Set<string>} */
const moduleSources = new Set();
// The core's texts — the "source" of _locales/ itself, a module's source is its folder name.
const CORE_SOURCE = "";
// A module folder name — anything else (an uploaded module, a "#…" instance) has no texts in the package.
const MODULE_SOURCE_RE = /^[A-Za-z0-9_-]+$/;
/** @type {Map<string, Promise<Record<string, string>>>} */
const fileCache = new Map();
/** @type {Set<(language: Enums.UiLanguage) => void>} */
const changeListeners = new Set();
let watching = false;

/** @type {Functions.I18n.normalizeUiLanguage} */
export function normalizeUiLanguage(value) {
	const found = UI_LANGUAGES.find((option) => option.value === value);
	return found ? found.value : DEFAULT_UI_LANGUAGE;
}

// The stored UI language — until the user picks one (or with a value the extension no longer
// has), the browser language if the extension has it, otherwise English (getBrowserUiLanguage()).
/** @type {Functions.I18n.storedUiLanguage} */
function storedUiLanguage(value) {
	return UI_LANGUAGES.find((option) => option.value === value)?.value ?? getBrowserUiLanguage();
}

/** @type {Functions.I18n.readUiLanguage} */
export async function readUiLanguage() {
	try {
		const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
		return storedUiLanguage(stored[UI_LANGUAGE_KEY]);
	} catch {
		// Without chrome.storage (the page's main world, tests without a mock) — the browser language.
		return getBrowserUiLanguage();
	}
}

/** @type {Functions.I18n.setUiLanguage} */
export async function setUiLanguage(language) {
	await chrome.storage.local.set({ [UI_LANGUAGE_KEY]: normalizeUiLanguage(language) });
}

/** @type {Functions.I18n.fetchMessages} */
function fetchMessages(source, language) {
	const path = source === CORE_SOURCE ? `_locales/${language}/messages.json` : `modules/${source}/_locales/${language}/messages.json`;
	const cached = fileCache.get(path);
	if (cached) return cached;
	const promise = (async () => {
		/** @type {Record<string, string>} */
		const messages = {};
		try {
			const response = await fetch(chrome.runtime.getURL(path));
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const json = /** @type {Record<string, { message?: unknown }>} */ (await response.json());
			for (const [key, entry] of Object.entries(json)) {
				if (entry && typeof entry.message === "string") messages[key.toLowerCase()] = entry.message;
			}
		} catch (err) {
			console.warn(`i18n: texty ${path} nejde načíst:`, err);
		}
		return messages;
	})();
	fileCache.set(path, promise);
	return promise;
}

/** @type {Functions.I18n.loadI18n} */
export function loadI18n(language) {
	if (language === undefined && loading) return loading;
	watchUiLanguage();
	const target = language === undefined ? (loadingLanguage ?? readUiLanguage()) : Promise.resolve(normalizeUiLanguage(language));
	loadingLanguage = target;
	const sources = [CORE_SOURCE, ...moduleSources];
	const order = ++loadCount;
	const promise = (async () => {
		const lang = await target;
		const tables = await Promise.all(
			sources.map((source) =>
				Promise.all([fetchMessages(source, DEFAULT_UI_LANGUAGE), lang === DEFAULT_UI_LANGUAGE ? null : fetchMessages(source, lang)])
			)
		);
		if (order < appliedLoad) return;
		appliedLoad = order;
		// The keys of the core and of the modules do not overlap (<module>_… only in the module's folder).
		fallbackMessages = Object.assign({}, ...tables.map(([fallback]) => fallback));
		currentMessages = lang === DEFAULT_UI_LANGUAGE ? fallbackMessages : Object.assign({}, ...tables.map(([, current]) => current));
		currentLanguage = lang;
	})();
	loading = promise;
	return promise;
}

// The texts of modules (modules/<module>/_locales) are loaded by every further loadI18n() together with
// those of the core — the texts already loaded stay available until then. Only for modules from the
// package (every one has _locales, see tests/locales.test.mjs): another name would only be a failed fetch.
/** @type {Functions.I18n.addModuleI18n} */
export function addModuleI18n(...names) {
	for (const name of names) {
		if (!MODULE_SOURCE_RE.test(name) || moduleSources.has(name)) continue;
		moduleSources.add(name);
		loading = null;
	}
}

/** @type {Functions.I18n.loadModuleI18n} */
export function loadModuleI18n(...names) {
	addModuleI18n(...names);
	return loadI18n();
}

// A language change from anywhere in the extension — the texts are loaded again and
// listeners from onUiLanguageChange() get the new language. Content scripts and the
// background thus compose further texts in the new language; extension pages reload
// themselves (see initPageI18n()).
function watchUiLanguage() {
	if (watching || !globalThis.chrome?.storage?.onChanged) return;
	watching = true;
	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== "local" || !(UI_LANGUAGE_KEY in changes)) return;
		const language = storedUiLanguage(changes[UI_LANGUAGE_KEY].newValue);
		if (language === currentLanguage) return;
		loading = null;
		loadI18n(language).then(() => {
			for (const listener of changeListeners) listener(language);
		});
	});
}

/** @type {Functions.I18n.onUiLanguageChange} */
export function onUiLanguageChange(listener) {
	watchUiLanguage();
	changeListeners.add(listener);
	return () => changeListeners.delete(listener);
}

/** @type {Functions.I18n.getUiLanguage} */
export function getUiLanguage() {
	return currentLanguage;
}

// UI language according to the browser language ("cs-CZ" → "cs") — only if the
// extension has it, otherwise the default English (chrome.i18n picks the same way
// according to default_locale). It is the UI language until the user picks one
// (readUiLanguage()) and it is marked in the language menu (initUiLanguageSelect()).
/** @type {Functions.I18n.getBrowserUiLanguage} */
export function getBrowserUiLanguage() {
	let locale = "";
	try {
		locale = globalThis.chrome?.i18n?.getUILanguage?.() || "";
	} catch {
		// chrome.i18n is not available here (the page's main world, tests).
	}
	if (!locale && typeof navigator !== "undefined") locale = navigator.language || "";
	return normalizeUiLanguage(locale.toLowerCase().split(/[-_]/)[0]);
}

// Language for Intl.* and toLocale*() — the same as the UI language, so that dates and
// numbers are not formatted differently from the surrounding text.
/** @type {Functions.I18n.getUiLocale} */
export function getUiLocale() {
	return currentLanguage;
}

/** @type {Functions.I18n.hasMessage} */
export function hasMessage(key) {
	const id = key.toLowerCase();
	return id in currentMessages || id in fallbackMessages;
}

/** @type {Functions.I18n.substitute} */
function substitute(message, substitutions) {
	return message.replace(/\$(\$|[1-9])/g, (_match, token) => (token === "$" ? "$" : String(substitutions[Number(token) - 1] ?? "")));
}

// Text in the given language, not in the UI language — e.g. an option in the language
// menu, which is entirely in the language it offers. A missing text comes from English.
/** @type {Functions.I18n.tIn} */
export async function tIn(language, key, ...substitutions) {
	const id = key.toLowerCase();
	const sources = [CORE_SOURCE, ...moduleSources];
	const [fallback, messages] = await Promise.all(
		[DEFAULT_UI_LANGUAGE, normalizeUiLanguage(language)].map((lang) => Promise.all(sources.map((source) => fetchMessages(source, lang))))
	);
	const message = messages.find((table) => id in table)?.[id] ?? fallback.find((table) => id in table)?.[id];
	return message === undefined ? key : substitute(message, substitutions);
}

/** @type {Functions.I18n.t} */
export function t(key, ...substitutions) {
	const id = key.toLowerCase();
	const message = currentMessages[id] ?? fallbackMessages[id];
	if (message !== undefined) return substitute(message, substitutions);
	// The texts are not loaded yet — the browser language through chrome.i18n.
	try {
		const native = globalThis.chrome?.i18n?.getMessage?.(key, substitutions.map(String));
		if (native) return native;
	} catch {
		// chrome.i18n is not available here (the page's main world, tests).
	}
	return key;
}

/** @type {Map<string, Intl.PluralRules>} */
const pluralRulesCache = new Map();

/** @type {Functions.I18n.tp} */
export function tp(key, count, ...substitutions) {
	let rules = pluralRulesCache.get(currentLanguage);
	if (!rules) {
		rules = new Intl.PluralRules(currentLanguage);
		pluralRulesCache.set(currentLanguage, rules);
	}
	// Forms of the UI language take precedence over the English ones: Czech, for
	// example, has no "_one" (its "$1×" from "_other" is enough) and the English "once"
	// would otherwise get mixed into the Czech text. English only when the language
	// has not even "_other".
	const exact = `${key}_${rules.select(count)}`.toLowerCase();
	const other = `${key}_other`.toLowerCase();
	const own = [exact, other].find((id) => id in currentMessages);
	return t(own ?? (exact in fallbackMessages ? exact : other), count, ...substitutions);
}

// Texts in HTML: an element with data-i18n="key" gets the text, data-i18n-html="key"
// HTML (only the extension's own texts from _locales, never anything from the web) and
// data-i18n-<attribute>="key" the attribute value (title, placeholder, aria-label, alt, value).
const I18N_ATTRIBUTES = ["title", "placeholder", "aria-label", "alt", "value"];

/** @type {Functions.I18n.applyI18n} */
export function applyI18n(root = document) {
	for (const el of root.querySelectorAll("[data-i18n]")) {
		el.textContent = t(el.getAttribute("data-i18n") || "");
	}
	for (const el of root.querySelectorAll("[data-i18n-html]")) {
		el.innerHTML = t(el.getAttribute("data-i18n-html") || "");
	}
	for (const attr of I18N_ATTRIBUTES) {
		for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
			el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`) || ""));
		}
	}
	if (root === document) document.documentElement.lang = currentLanguage;
}

// UI language menu (the <select> at the top of the Settings page and on the welcome
// page): the UI_LANGUAGES options, the selected one is the UI language. The browser
// language (getBrowserUiLanguage()) has the suffix "browser language" after its
// name — in the language of that option, like the name. Prepared in advance so the
// menu renders all at once. A change is saved immediately; this and the other
// extension pages then reload in the new language (initPageI18n()).
/** @type {Functions.I18n.initUiLanguageSelect} */
export async function initUiLanguageSelect(select) {
	const browserLanguage = getBrowserUiLanguage();
	const browserOption = UI_LANGUAGES.find((option) => option.value === browserLanguage);
	const browserLabel = browserOption ? await tIn(browserLanguage, "core_ui_language_browser", browserOption.label) : "";
	for (const { value, label } of UI_LANGUAGES) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = value === browserLanguage ? browserLabel : label;
		select.appendChild(option);
	}
	select.value = currentLanguage;
	select.addEventListener("change", () => {
		setUiLanguage(/** @type {Enums.UiLanguage} */ (select.value));
	});
}

// Start of every extension page (popup, side panel, floating window,
// Settings, welcome page, ...): loads the texts, translates the HTML and after a language
// change reloads the page — texts of already rendered modules cannot be translated otherwise.
/** @type {Functions.I18n.initPageI18n} */
export async function initPageI18n() {
	await loadI18n();
	applyI18n(document);
	onUiLanguageChange(() => location.reload());
}
