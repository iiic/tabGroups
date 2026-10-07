//@ts-check
"use strict";

// sdk.mjs — veřejné API pro moduly (modules/<jméno>/*). Tohle je jediný soubor
// jádra, který by měly importovat — base.mjs je interní implementace
// (kontrolery, ...) a modul, který z něj importuje něco jiného
// než přes sdk.mjs, obchází API a váže se na interní detaily, které se mohou
// kdykoliv změnit beze zmínky v téhle veřejné vrstvě.
//
// Element modulu (BaseElement) dostane vlastní "api" objekt automaticky jako
// this.api (viz BaseElement.init() v base.mjs). Kód mimo element si stejnou
// věc vytvoří sám přes createModuleApi(jméno).
//
// Background část modulu (modules/<jméno>/background-script.mjs) běží v
// background.js, tedy i bez otevřené stránky rozšíření. Zaregistruje se
// voláním registerBackgroundScript({ name, setup }) a api dostane jako
// argument setup({ api }); načítá ji seznam modules-background.mjs (viz tam a
// registerBackgroundScript() v base.mjs):
//
//   registerBackgroundScript({
//       name: MODULE_NAME,
//       setup: ({ api }) => {
//           chrome.tabs.onCreated.addListener(async () => {
//               if (!(await api.activation.isActive(DEFAULT_ACTIVATION_MODE))) return;
//               // ...
//           });
//       },
//   });
//
// api.settings — vlastní nastavení modulu (moduleSettings): get(klíč, výchozí)
//   a onChange(handler), bez nutnosti znát SETTINGS_KEY ani volat
//   chrome.storage přímo. U modulu s vícenásobnými instancemi
//   (registerModule({ multiInstance: true })) pracuje api.settings elementu
//   s nastavením jeho instance — createModuleApi(jméno, idInstance).
// api.state / api.sessionState — vlastní stav modulu mimo nastavení: get(klíč,
//   výchozí)/set(klíč, hodnota), každá hodnota pod vlastním klíčem úložiště
//   (chrome.storage.local, resp. chrome.storage.session — ten platí jen do
//   restartu prohlížeče nebo znovunačtení rozšíření). Viz tabGroups.
// api.activation — isActive(výchozíRežim, activationSpec?): je modul v seznamu
//   modulů a platí jeho activationSpec pro aktuální aktivační režim?
//   onChange(handler): změnil se seznam modulů nebo nastavení. Pro background
//   část modulu, jejíž posluchače jsou zaregistrované vždy.
// api.messages — zprávy chrome.runtime: on(typ, handler) s automatickým
//   odhlášením listeneru a send(zpráva).
// api.permissions — chrome.permissions.contains()/request() bez přímé
//   závislosti na chrome.*, plus onChange(handler) při změně udělených
//   oprávnění.
export {
	// --- Základ modulu ---
	BaseElement,
	registerModule,
	registerBackgroundScript,
	getTagName,
	getModuleSettingKey,

	// --- API pro komunikaci s jádrem ---
	createModuleApi,

	// --- Specification Pattern (pravidla aktivace) ---
	NOT_DISABLED_SPEC,
} from "./base.mjs";

// --- Překlady uživatelského rozhraní (viz i18n.mjs) ---
export {
	t,
	tp,
	tIn,
	UI_LANGUAGES,
	loadI18n,
	onUiLanguageChange,
} from "./i18n.mjs";
