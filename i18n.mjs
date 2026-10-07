//@ts-check
"use strict";

// i18n.mjs — překlady uživatelského rozhraní.
//
// Texty jsou ve standardním rozložení WebExtension: _locales/<jazyk>/messages.json
// ({ "klíč": { "message": "text" } }), výchozí jazyk je angličtina
// (default_locale "en" v manifestu). chrome.i18n ale jazyk bere vždy z
// prohlížeče a za běhu ho přepnout nejde — jazyk rozhraní si proto uživatel
// volí sám (UI_LANGUAGE_KEY v chrome.storage.local, viz stránka Nastavení) a
// texty zvoleného jazyka se načítají přímo ze souboru messages.json.
//
// Použití:
//   await loadI18n();            // jednou na začátku (stránka, content script)
//   t("options_save");            // text podle klíče
//   t("popup_module_error", path) // $1…$9 v textu nahradí argumenty, "$$" je "$"
//   tp("storageManager_items", n) // množné číslo: klíče <klíč>_one/_few/_many/_other
//                                 // podle Intl.PluralRules, $1 je n
//   applyI18n(document)           // HTML atributy data-i18n* (viz níž)
//
// Než se texty načtou (background.js při startu, content script před
// loadI18n()), t() sáhne po chrome.i18n.getMessage() — tedy po textu v jazyce
// prohlížeče. Proto t() nikdy nevolat na nejvyšší úrovni souboru, který se
// importuje staticky (base.mjs, sdk.mjs): text se má skládat až ve chvíli, kdy
// se vypisuje (u tabulek konstant přes getter).
//
// Klíče jsou v messages.json bez ohledu na velikost písmen (stejně jako u
// chrome.i18n) a smí obsahovat jen [A-Za-z0-9_@]; konvence je
// <modul nebo stránka>_<popis_malými_písmeny>.

export const UI_LANGUAGE_KEY = "uiLanguage";
/** @type {Enums.UiLanguage} */
export const DEFAULT_UI_LANGUAGE = "en";

// Jazyky rozhraní — každý má vlastní _locales/<value>/messages.json. Popisek
// je název jazyka v něm samém, v nabídce se proto nepřekládá.
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
/** @type {Map<Enums.UiLanguage, Promise<Record<string, string>>>} */
const fileCache = new Map();
/** @type {Set<(language: Enums.UiLanguage) => void>} */
const changeListeners = new Set();
let watching = false;

/** @type {Functions.I18n.normalizeUiLanguage} */
export function normalizeUiLanguage(value) {
	const found = UI_LANGUAGES.find((option) => option.value === value);
	return found ? found.value : DEFAULT_UI_LANGUAGE;
}

/** @type {Functions.I18n.readUiLanguage} */
export async function readUiLanguage() {
	try {
		const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
		return normalizeUiLanguage(stored[UI_LANGUAGE_KEY]);
	} catch {
		// Bez chrome.storage (hlavní svět stránky, testy bez mocku) — výchozí jazyk.
		return DEFAULT_UI_LANGUAGE;
	}
}

/** @type {Functions.I18n.setUiLanguage} */
export async function setUiLanguage(language) {
	await chrome.storage.local.set({ [UI_LANGUAGE_KEY]: normalizeUiLanguage(language) });
}

/** @type {Functions.I18n.fetchMessages} */
function fetchMessages(language) {
	const cached = fileCache.get(language);
	if (cached) return cached;
	const promise = (async () => {
		/** @type {Record<string, string>} */
		const messages = {};
		try {
			const response = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const json = /** @type {Record<string, { message?: unknown }>} */ (await response.json());
			for (const [key, entry] of Object.entries(json)) {
				if (entry && typeof entry.message === "string") messages[key.toLowerCase()] = entry.message;
			}
		} catch (err) {
			console.warn(`i18n: texty jazyka "${language}" nejde načíst:`, err);
		}
		return messages;
	})();
	fileCache.set(language, promise);
	return promise;
}

/** @type {Functions.I18n.loadI18n} */
export function loadI18n(language) {
	if (language === undefined && loading) return loading;
	watchUiLanguage();
	const promise = (async () => {
		const target = language === undefined ? await readUiLanguage() : normalizeUiLanguage(language);
		const [fallback, current] = await Promise.all([
			fetchMessages(DEFAULT_UI_LANGUAGE),
			target === DEFAULT_UI_LANGUAGE ? null : fetchMessages(target),
		]);
		fallbackMessages = fallback;
		currentMessages = current || fallback;
		currentLanguage = target;
	})();
	loading = promise;
	return promise;
}

// Změna jazyka odkudkoliv z rozšíření — texty se načtou znovu a posluchači z
// onUiLanguageChange() dostanou nový jazyk. Content scripty a background tak
// další texty skládají už v novém jazyce; stránky rozšíření se samy načtou
// znovu (viz initPageI18n()).
function watchUiLanguage() {
	if (watching || !globalThis.chrome?.storage?.onChanged) return;
	watching = true;
	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== "local" || !(UI_LANGUAGE_KEY in changes)) return;
		const language = normalizeUiLanguage(changes[UI_LANGUAGE_KEY].newValue);
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

// Jazyk rozhraní podle jazyka prohlížeče ("cs-CZ" → "cs") — jen když ho
// rozšíření má, jinak výchozí angličtina (stejně vybírá chrome.i18n podle
// default_locale). Jazyk rozhraní se podle něj sám nenastavuje, jen se
// označí v nabídce jazyků na stránce Nastavení.
/** @type {Functions.I18n.getBrowserUiLanguage} */
export function getBrowserUiLanguage() {
	let locale = "";
	try {
		locale = globalThis.chrome?.i18n?.getUILanguage?.() || "";
	} catch {
		// chrome.i18n tu není (hlavní svět stránky, testy).
	}
	if (!locale && typeof navigator !== "undefined") locale = navigator.language || "";
	return normalizeUiLanguage(locale.toLowerCase().split(/[-_]/)[0]);
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

// Text v zadaném jazyce, ne v jazyce rozhraní — třeba volba v nabídce jazyků,
// která je celá v jazyce, který nabízí. Chybějící text z angličtiny.
/** @type {Functions.I18n.tIn} */
export async function tIn(language, key, ...substitutions) {
	const id = key.toLowerCase();
	const [fallback, messages] = await Promise.all([fetchMessages(DEFAULT_UI_LANGUAGE), fetchMessages(normalizeUiLanguage(language))]);
	const message = messages[id] ?? fallback[id];
	return message === undefined ? key : substitute(message, substitutions);
}

/** @type {Functions.I18n.t} */
export function t(key, ...substitutions) {
	const id = key.toLowerCase();
	const message = currentMessages[id] ?? fallbackMessages[id];
	if (message !== undefined) return substitute(message, substitutions);
	// Texty ještě nejsou načtené — jazyk prohlížeče přes chrome.i18n.
	try {
		const native = globalThis.chrome?.i18n?.getMessage?.(key, substitutions.map(String));
		if (native) return native;
	} catch {
		// chrome.i18n tu není (hlavní svět stránky, testy).
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
	const exact = `${key}_${rules.select(count)}`;
	return t(hasMessage(exact) ? exact : `${key}_other`, count, ...substitutions);
}

// Texty v HTML: element s data-i18n="klíč" dostane text, data-i18n-html="klíč"
// HTML (jen vlastní texty z _locales, nikdy nic z webu) a data-i18n-<atribut>
// ="klíč" hodnotu atributu (title, placeholder, aria-label, alt, value).
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

// Nabídka jazyků rozhraní (<select> nahoře na stránce Nastavení a na uvítací
// stránce): volby UI_LANGUAGES, vybraný je jazyk rozhraní. Jazyk prohlížeče
// (getBrowserUiLanguage()) má u názvu příponu „jazyk prohlížeče“ — v jazyce
// té volby, stejně jako název. Připraví se předem, ať se nabídka vykreslí
// celá najednou. Změna se uloží hned; tahle i ostatní stránky rozšíření se
// pak načtou znovu v novém jazyce (initPageI18n()).
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

// Začátek každé stránky rozšíření (popup, postranní panel,
// Nastavení, uvítací stránka, ...): načte texty, přeloží HTML a po změně
// jazyka stránku načte znovu — texty už vypsané moduly jinak přeložit nejde.
/** @type {Functions.I18n.initPageI18n} */
export async function initPageI18n() {
	await loadI18n();
	applyI18n(document);
	onUiLanguageChange(() => location.reload());
}
