//@ts-check
"use strict";

// base.mjs — Shared base module for all JavaScript in the extension

// Přetypování cíle: TypeScript 6 by jinak přiřazení bral jako novou deklaraci
// (expando na globalThis) místo var __extensionModules z base.globals.d.ts.
/** @type {typeof globalThis} */ (globalThis).__extensionModules = globalThis.__extensionModules || [];

import { t, loadI18n } from "./i18n.mjs";

export const SETTINGS_KEY = "moduleSettings";
export const MODULES_JSON_KEY = "modulesJson";
// Stav otevřeno/zavřeno uzavíratelných rámů modulů (<details>, viz
// OUTPUT_ELEMENTS a mountModuleElement) — { [klíč položky seznamu]: { open,
// element, seen } }. Uložený je jen stav, který uživatel sám změnil oproti
// výchozímu z nastavení "Element výpisu dat"; záznamy rámů, které se dlouho
// nevykreslily, se mažou (viz pruneFrameStates()).
export const FRAME_STATE_KEY = "moduleFrameState";
// Záznam rámu, který se tak dlouho nikde nevykreslil, se při nejbližším zápisu
// smaže — moduly se objevují a mizí podle obsahu stránky (activationSpec),
// instance modulů vznikají a zanikají, stav k nim nemá zůstávat navždy.
export const FRAME_STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Pojistka proti nekonečnému růstu: nad tenhle počet se zahodí nejdéle
// neviděné záznamy.
export const FRAME_STATE_MAX_ENTRIES = 500;
// Čas "naposledy viděn" se obnovuje při vykreslení rámu, ale nejvýš jednou
// za tuhle dobu — na přesnosti na den u 30denní lhůty nezáleží a zbytečně se
// tak nezapisuje při každém vykreslení.
export const FRAME_STATE_SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MODE = "popup";
export const DEFAULT_DISPLAY_LOCATION = "popup";

// Výchozí nastavení položek výchozího seznamu modulů (modules.json) — soubor
// v balíčku rozšíření ve stejném tvaru jako moduleSettings v úložišti
// ("<položka>" = aktivační režim, "<položka>.<pole>" = plocha, element
// výpisu, vlastní pole, …; položka je jméno modulu, u instance
// "<modul>#<id>"). Hodí se hlavně pro instance modulů s vícenásobnými
// instancemi, které výchozí seznam už obsahuje: nastavení by jim jinak
// mohl dát jen uživatel (contentDivider#welcome: přivítání na uvítací
// stránce). Do úložiště ho zapíše BaseController.seedDefaultSettings() —
// po instalaci a aktualizaci rozšíření a po uložení seznamu modulů
// v Nastavení —, a to jen chybějící hodnoty.
export const DEFAULT_SETTINGS_FILE = "default-settings.json";

// Popisky se překládají až při čtení (getter) — viz i18n.mjs.
/** @type {Types.ActivationModeOption[]} */
export const ACTIVATION_MODES = [
	{ value: "background", get label() { return t("core_activation_background"); } },
	{ value: "focus", get label() { return t("core_activation_focus"); } },
	{ value: "icon_click", get label() { return t("core_activation_icon_click"); } },
	{ value: "popup", get label() { return t("core_activation_popup"); } },
	{ value: "install", get label() { return t("core_activation_install"); } },
	{ value: "disabled", get label() { return t("core_activation_disabled"); } },
];

// Kam se má vykreslit vlastní element modulu (jeho UI) — nezávisle na
// aktivačním režimu výše (ten řídí, KDY modul pracuje; tohle řídí, KDE se
// zobrazí jeho výstup). Modul se může vypisovat na víc místech najednou —
// nastavení je seznam míst (viz getModuleDisplayLocations() níž), prázdný =
// nikde; v Nastavení je u modulu zaškrtávátko pro každé místo. Používá
// popup.mjs, sidebar.mjs, options.mjs i onboarding.mjs (viz
// BaseController.renderModulesFor) ke shodnému rozhodnutí, jestli daný modul
// patří právě na tu konkrétní plochu. "onboarding" je uvítací stránka
// onboarding.html, kterou po instalaci rozšíření otevře modul onboardingModule.
/** @type {Types.DisplayLocationOption[]} */
export const DISPLAY_LOCATIONS = [
	{ value: "popup", get label() { return t("core_location_popup"); } },
	{ value: "sidebar", get label() { return t("core_location_sidebar"); } },
	{ value: "options", get label() { return t("core_location_options"); } },
	{ value: "onboarding", get label() { return t("core_location_onboarding"); } },
];
// „Nevypisovat nikde“ zapsané jedním řetězcem — z doby, kdy šlo vybrat jen
// jedno místo. Dnes je to prázdný seznam míst, řetězec ale platí dál v
// uloženém nastavení (i v zálohách z importExport) a v defaultDisplayLocation
// modulu (viz parseDisplayLocations()).
const NO_DISPLAY_LOCATION = "none";

// JAK se výstup modulu na zvolené ploše (DISPLAY_LOCATIONS výš) vypíše — do
// jakého rámu jádro vlastní element modulu obalí (viz
// BaseController.mountModuleElement). Řádkový/blokový/odsazený rám je jen
// <div> s třídou module-frame--<value> (vzhled řeší css/module-frame.css),
// uzavíratelný (collapsible) je dvojice <details>/<summary>, "open" určuje,
// jestli je po vykreslení rozbalený.
/** @type {Types.OutputElementOption[]} */
export const OUTPUT_ELEMENTS = [
	{ value: "inline", get label() { return t("core_output_inline"); } },
	{ value: "block", get label() { return t("core_output_block"); } },
	{ value: "indented", get label() { return t("core_output_indented"); } },
	{ value: "details-closed", get label() { return t("core_output_details_closed"); }, collapsible: true, open: false },
	{ value: "details-open", get label() { return t("core_output_details_open"); }, collapsible: true, open: true },
];
// Globální výchozí hodnoty — jen pro modul, který vlastní návrh
// (defaultOutputElement/defaultShowHeading v registerModule) nedeklaruje.
// Odpovídají vzhledu před zavedením rámu (element pod sebou, bez nadpisu).
export const DEFAULT_OUTPUT_ELEMENT = "block";
export const DEFAULT_SHOW_HEADING = false;

/** @type {Functions.Base.registerModule} */
export function registerModule(moduleDef) {
	const { errors, warnings } = validateModule(moduleDef);
	if (errors.length > 0) {
		console.error(
			`Modul "${moduleDef.name}" selže validaci:\n` +
				errors.map((e) => `  - ${e}`).join("\n")
		);
	}
	if (warnings.length > 0) {
		console.warn(
			`Modul "${moduleDef.name}":\n` + warnings.map((w) => `  - ${w}`).join("\n")
		);
	}
	globalThis.__extensionModules.push(moduleDef);
}

// Jména modulů, jejichž background část už je zaregistrovaná (viz
// registerBackgroundScript() níž) — naplní se jen v background.js.
/** @type {Set<string>} */
const registeredBackgroundScripts = new Set();

// Background část modulu — kód, který běží v background.js (service worker v
// Chrome, background skript ve Firefoxu), tedy i bez otevřené stránky
// rozšíření: posluchače událostí prohlížeče (chrome.tabs, chrome.alarms, ...),
// na které má modul reagovat, i když není otevřený popup ani postranní panel.
// Soubor modules/<jméno>/background-script.mjs ji zaregistruje voláním
// registerBackgroundScript({ name, setup }) při svém importu. Importuje ho
// jediný seznam modules-background.mjs — staticky, protože dynamický import()
// Chrome ve service workeru nedovolí (viz background.js).
//
// setup({ api }) jádro zavolá hned, synchronně a v try/catch: chyba modulu tak
// neshodí background.js ani background části ostatních modulů. Posluchače
// chrome.* musí setup() zaregistrovat synchronně, bez čekání na await —
// service worker probuzený událostí ji doručí jen posluchačům, které existují
// po prvním průchodu skriptem. Proto se registrují vždy, i u vypnutého modulu:
// jestli má modul právě pracovat (je v seznamu modulů a není vypnutý), si
// ověřuje sám v obsluze události přes api.activation.isActive().
/** @type {Functions.Base.registerBackgroundScript} */
export function registerBackgroundScript(definition) {
	const name = definition && definition.name;
	if (typeof name !== "string" || !name) {
		console.error("registerBackgroundScript(): chybí jméno modulu (name).");
		return;
	}
	if (typeof definition.setup !== "function") {
		console.error(`Background část modulu "${name}" nemá funkci setup().`);
		return;
	}
	if (registeredBackgroundScripts.has(name)) {
		console.error(`Background část modulu "${name}" je zaregistrovaná dvakrát.`);
		return;
	}
	registeredBackgroundScripts.add(name);
	try {
		Promise.resolve(definition.setup({ api: createModuleApi(name) })).catch((err) =>
			console.error(`Chyba v setup() background části modulu "${name}":`, err)
		);
	} catch (err) {
		console.error(`Chyba v setup() background části modulu "${name}":`, err);
	}
}

// Klíč jedné hodnoty vlastního stavu modulu (api.state v chrome.storage.local,
// api.sessionState v chrome.storage.session, viz createModuleApi()) —
// "moduleState.<modul>.<klíč>". Každá hodnota má vlastní klíč úložiště, zápis
// jedné tak nikdy nepřepíše jinou.
/** @type {Functions.Base.getModuleStateKey} */
function getModuleStateKey(moduleName, key) {
	return `moduleState.${moduleName}.${key}`;
}

/** @type {Functions.Base.validateModule} */
function validateModule(moduleDef) {
	/** @type {string[]} */
	const errors = [];
	/** @type {string[]} */
	const warnings = [];

	if (!moduleDef || typeof moduleDef !== "object") {
		errors.push("moduleDef není objekt");
		return { errors, warnings };
	}

	if (!moduleDef.name || typeof moduleDef.name !== "string") {
		errors.push("chybí nebo neplatný 'name'");
	}

	if (!moduleDef.tag || typeof moduleDef.tag !== "string") {
		errors.push("chybí nebo neplatný 'tag'");
	} else {
		if (!moduleDef.tag.includes("-") || moduleDef.tag !== moduleDef.tag.toLowerCase()) {
			errors.push(
				`'tag' (${moduleDef.tag}) není platný custom element tag (musí obsahovat pomlčku a být lowercase)`
			);
		}

		if (typeof customElements !== "undefined") {
			// Třída zaregistrovaná pod tagem je zatím neověřená — proto jen tvar
			// "má prototype", jehož init() a dědičnost se kontrolují níž.
			const klass = /** @type {{ prototype: { init?: unknown } } | undefined} */ (customElements.get(moduleDef.tag));
			if (!klass) {
				errors.push(
					`custom element '${moduleDef.tag}' nebyl vytvořen pomocí customElements.define()`
				);
			} else {
				if (typeof klass.prototype.init !== "function") {
					errors.push(
						`třída pro '${moduleDef.tag}' nemá metodu 'init()' — modul musí implementovat init()`
					);
				}
				if (!(klass.prototype instanceof BaseElement)) {
					errors.push(
						`třída pro '${moduleDef.tag}' nevlastní od BaseElement`
					);
				}
			}
		}
	}

	if (
		moduleDef.activationSpec !== undefined &&
		!(moduleDef.activationSpec instanceof Specification)
	) {
		errors.push(
			`'activationSpec' modulu "${moduleDef.name}" musí být instancí Specification`
		);
	}

	// settingsSchema (nastavení celého modulu) i instanceSettingsSchema
	// (nastavení každé instance, viz multiInstance níž) mají stejný tvar.
	for (const schemaName of /** @type {const} */ (["settingsSchema", "instanceSettingsSchema"])) {
		const schema = moduleDef[schemaName];
		if (schema === undefined) continue;
		if (!Array.isArray(schema)) {
			errors.push(`'${schemaName}' modulu "${moduleDef.name}" musí být pole`);
			continue;
		}
		schema.forEach((field, i) => {
			if (!field || typeof field.key !== "string" || !field.key) {
				errors.push(`${schemaName}[${i}] modulu "${moduleDef.name}" nemá platný 'key'`);
			}
			if (!SETTING_FIELD_TYPES.includes(field?.type)) {
				errors.push(
					`${schemaName}[${i}] ("${field?.key}") modulu "${moduleDef.name}" má neplatný 'type' (${field?.type}); povolené: ${SETTING_FIELD_TYPES.join(", ")}`
				);
			}
			if (!field || typeof field.label !== "string" || !field.label) {
				errors.push(`${schemaName}[${i}] ("${field?.key}") modulu "${moduleDef.name}" nemá 'label'`);
			}
			if (field?.type === "custom" && typeof field.render !== "function") {
				errors.push(
					`${schemaName}[${i}] ("${field?.key}") modulu "${moduleDef.name}" je typu 'custom', ale nemá funkci 'render'`
				);
			}
		});
	}

	// Vícenásobné instance (viz MODULE_INSTANCE_SEPARATOR) — ano/ne.
	// instanceSettingsSchema bez nich nemá kde se vykreslit.
	if (moduleDef.multiInstance !== undefined && typeof moduleDef.multiInstance !== "boolean") {
		errors.push(`'multiInstance' modulu "${moduleDef.name}" musí být true/false`);
	}
	if (moduleDef.instanceSettingsSchema !== undefined && moduleDef.multiInstance !== true) {
		warnings.push(`'instanceSettingsSchema' modulu "${moduleDef.name}" se použije jen s multiInstance: true`);
	}

	// Nepovinná deklarace, která nepovinná oprávnění (viz
	// api.permissions) modul může za běhu vyžádat — pole objektů ve tvaru
	// chrome.permissions.request() ({ permissions, origins }), např.
	// [{ permissions: ["tabGroups"] }]. Stránka Nastavení
	// ji vypíše v přehledu závislostí modulu i s tím, jestli je oprávnění udělené.
	if (moduleDef.usesPermissions !== undefined) {
		if (!Array.isArray(moduleDef.usesPermissions)) {
			errors.push(`'usesPermissions' modulu "${moduleDef.name}" musí být pole`);
		} else {
			moduleDef.usesPermissions.forEach((p, i) => {
				const hasPermissions = Array.isArray(p?.permissions);
				const hasOrigins = Array.isArray(p?.origins);
				if (!p || typeof p !== "object" || (!hasPermissions && !hasOrigins)) {
					errors.push(
						`usesPermissions[${i}] modulu "${moduleDef.name}" musí mít pole 'permissions' a/nebo 'origins' (tvar jako chrome.permissions.request())`
					);
				}
			});
		}
	}

	// Nepovinná deklarace závislostí na jiných modulech — pole { module, reason }
	// (jméno modulu a krátká věta, proč ho potřebuje). Jádro podle ní nic
	// nezapíná ani nehlídá, jen ji vypíše stránka Nastavení u obou modulů
	// (na čem modul závisí / kdo závisí na něm).
	if (moduleDef.dependsOn !== undefined) {
		if (!Array.isArray(moduleDef.dependsOn)) {
			errors.push(`'dependsOn' modulu "${moduleDef.name}" musí být pole`);
		} else {
			moduleDef.dependsOn.forEach((d, i) => {
				if (!d || typeof d !== "object" || typeof d.module !== "string" || !d.module || typeof d.reason !== "string") {
					errors.push(`dependsOn[${i}] modulu "${moduleDef.name}" musí být { module: "jméno modulu", reason: "proč" }`);
				} else if (d.module === moduleDef.name) {
					errors.push(`dependsOn[${i}] modulu "${moduleDef.name}" nemůže odkazovat na modul samotný`);
				}
			});
		}
	}

	// Nepovinné vlastní CSS elementu modulu (viz BaseController.loadModuleStyles)
	// — pole ABSOLUTNÍCH adres. Relativní cesta by se řešila vůči stránce, na
	// které se element zrovna vykresluje (popup.html, ...), ne vůči složce
	// modulu, proto se vyžaduje new URL("./soubor.css", import.meta.url).href.
	if (moduleDef.styles !== undefined) {
		if (!Array.isArray(moduleDef.styles)) {
			errors.push(`'styles' modulu "${moduleDef.name}" musí být pole`);
		} else {
			moduleDef.styles.forEach((href, i) => {
				if (typeof href !== "string" || !URL.canParse(href)) {
					errors.push(
						`styles[${i}] modulu "${moduleDef.name}" musí být absolutní adresa — new URL("./soubor.css", import.meta.url).href`
					);
				}
			});
		}
	}

	// Vlastní výchozí hodnoty modulu pro aktivační režim, místa výstupu a
	// element výpisu (viz getModuleMode/getModuleDisplayLocations/
	// getModuleOutputElement/getModuleShowHeading) — všechny jsou nepovinné.
	// Nedeklarování není chyba, jen se o tom modul upozorní (funguje dál,
	// použije se globální výchozí hodnota); neplatná deklarovaná hodnota už
	// chyba je, protože modul se evidentně snažil, jen se spletl.
	if (moduleDef.defaultActivationMode === undefined) {
		warnings.push(
			`nedeklaruje 'defaultActivationMode' — použije se globální výchozí "${DEFAULT_MODE}"`
		);
	} else if (!ACTIVATION_MODES.some((m) => m.value === moduleDef.defaultActivationMode)) {
		errors.push(
			`'defaultActivationMode' (${moduleDef.defaultActivationMode}) modulu "${moduleDef.name}" není platná hodnota; povolené: ${ACTIVATION_MODES.map((m) => m.value).join(", ")}`
		);
	}

	if (moduleDef.defaultDisplayLocation === undefined) {
		warnings.push(
			`nedeklaruje 'defaultDisplayLocation' — použije se globální výchozí "${DEFAULT_DISPLAY_LOCATION}"`
		);
	} else if (
		parseDisplayLocations(moduleDef.defaultDisplayLocation) === null ||
		// Neznámé místo v poli uložené nastavení vynechá (viz
		// parseDisplayLocations()), v deklaraci modulu je to překlep.
		(Array.isArray(moduleDef.defaultDisplayLocation) &&
			!moduleDef.defaultDisplayLocation.every((location) => DISPLAY_LOCATIONS.some((l) => l.value === location)))
	) {
		errors.push(
			`'defaultDisplayLocation' (${JSON.stringify(moduleDef.defaultDisplayLocation)}) modulu "${moduleDef.name}" není platná hodnota; povolené: jedno místo (${DISPLAY_LOCATIONS.map((l) => l.value).join(", ")}), pole míst, nebo "${NO_DISPLAY_LOCATION}" (nikde)`
		);
	}

	if (moduleDef.defaultOutputElement === undefined) {
		warnings.push(
			`nedeklaruje 'defaultOutputElement' — použije se globální výchozí "${DEFAULT_OUTPUT_ELEMENT}"`
		);
	} else if (!OUTPUT_ELEMENTS.some((e) => e.value === moduleDef.defaultOutputElement)) {
		errors.push(
			`'defaultOutputElement' (${moduleDef.defaultOutputElement}) modulu "${moduleDef.name}" není platná hodnota; povolené: ${OUTPUT_ELEMENTS.map((e) => e.value).join(", ")}`
		);
	}

	if (moduleDef.defaultShowHeading === undefined) {
		warnings.push(
			`nedeklaruje 'defaultShowHeading' — použije se globální výchozí ${DEFAULT_SHOW_HEADING}`
		);
	} else if (typeof moduleDef.defaultShowHeading !== "boolean") {
		errors.push(`'defaultShowHeading' modulu "${moduleDef.name}" musí být true/false`);
	}

	// Nepovinná funkce pro celou stránku rozšíření, ne jen pro element modulu
	// — viz BaseController.runPageInits().
	if (moduleDef.pageInit !== undefined && typeof moduleDef.pageInit !== "function") {
		errors.push(`'pageInit' modulu "${moduleDef.name}" musí být funkce`);
	}

	// Krátký (1-2 věty) popisek, co modul dělá — options.mjs ho vypíše pod
	// názvem modulu v sekci "Nastavení modulů" (viz renderModules() a
	// <small> tam). Nepovinné, ale doporučené u každého modulu — bez něj se
	// tahle položka jen tiše nezobrazí, nic se nerozbije.
	if (moduleDef.description === undefined) {
		warnings.push(`nedeklaruje 'description' — v Nastavení se u modulu nezobrazí popisek`);
	} else if (typeof moduleDef.description !== "string" || !moduleDef.description.trim()) {
		errors.push(`'description' modulu "${moduleDef.name}" musí být neprázdný řetězec`);
	}

	return { errors, warnings };
}

/** @type {Functions.Base.getModuleKey} */
export function getModuleKey(path) {
	// Položka instance ("…/contentDivider.mjs#k3j9x2", viz parseModuleEntry()
	// níž) patří pořád stejnému modulu — id instance se do jména nepočítá.
	const parts = path.split(MODULE_INSTANCE_SEPARATOR)[0].replace(/\\/g, "/").split("/");
	const filename = parts[parts.length - 1];
	// .m?js pokryje jak klasické .js, tak modulové .mjs soubory.
	return filename.replace(/\.m?js$/, "");
}

// Vícenásobné instance modulu (registerModule({ multiInstance: true })) —
// modul, který jde do seznamu modulů vložit víckrát, pokaždé na jiné místo a
// s vlastním nastavením (contentDivider: oddělovač s nadpisem a kouskem HTML).
// Každá instance je v seznamu vlastní položkou: cesta k modulu + "#" + id
// instance ("./modules/contentDivider/contentDivider.mjs#k3j9x2"). Položka bez
// id je u takového modulu jen jeho „šablona“: modul načte (bez ní by stránka
// Nastavení nevěděla, že jde přidat další instanci) a sama nic nevypisuje.
// Nastavení instance (aktivační režim, plocha, rám, instanceSettingsSchema) se
// ukládá pod klíčem "<modul>#<id>" místo holého jména modulu, viz
// getModuleInstanceKey().
export const MODULE_INSTANCE_SEPARATOR = "#";

// Klíč, pod kterým má položka seznamu modulů svoje nastavení (moduleSettings):
// u instance "<modul>#<id>", jinak holé jméno modulu — jde tak rovnou předat
// všude, kde se dřív předávalo jméno modulu (getModuleMode(),
// getModuleSettingKey(), ...).
/** @type {Functions.Base.getModuleInstanceKey} */
export function getModuleInstanceKey(moduleName, instance) {
	return instance ? `${moduleName}${MODULE_INSTANCE_SEPARATOR}${instance}` : moduleName;
}

// Rozloží položku seznamu modulů na cestu k souboru (bez id instance — ta se
// importuje), jméno modulu, id instance (null = obyčejná položka nebo šablona)
// a klíč nastavení (getModuleInstanceKey()).
/** @type {Functions.Base.parseModuleEntry} */
export function parseModuleEntry(entry) {
	const index = entry.indexOf(MODULE_INSTANCE_SEPARATOR);
	const path = index === -1 ? entry : entry.slice(0, index);
	const instance = index === -1 ? null : entry.slice(index + 1) || null;
	const name = getModuleKey(path);
	return { entry, path, name, instance, key: getModuleInstanceKey(name, instance) };
}

// Nové id instance — krátké, jen [a-z0-9], ať ho jde bez escapování zapsat do
// seznamu modulů i do klíče nastavení ("<modul>#<id>.<pole>").
/** @type {Functions.Base.createModuleInstanceId} */
export function createModuleInstanceId() {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

// Položky seznamu modulů, které se mají vypsat, v pořadí seznamu: jen moduly,
// které se podařilo načíst (registerModule()), u modulu s vícenásobnými
// instancemi jen jeho instance (šablona nic nevypisuje, viz výš) a u
// ostatních jen položky bez id instance. Každý klíč jen jednou. Sdílené mezi
// popup.mjs a BaseController.renderModulesFor(), ať pořadí výpisu na všech
// plochách určuje stejně seznam modulů, ne pořadí registrace.
/** @type {Functions.Base.resolveModuleEntries} */
export function resolveModuleEntries(paths) {
	const byName = new Map((globalThis.__extensionModules || []).map((mod) => [mod.name, mod]));
	/** @type {Set<string>} */
	const seen = new Set();
	/** @type {Types.ResolvedModuleEntry[]} */
	const entries = [];
	for (const item of paths) {
		if (typeof item !== "string") continue;
		const entry = parseModuleEntry(item);
		const mod = byName.get(entry.name);
		if (!mod || seen.has(entry.key) || !!mod.multiInstance !== !!entry.instance) continue;
		seen.add(entry.key);
		entries.push({ ...entry, mod });
	}
	return entries;
}

// Soubor je opravdový JS modul, jen pokud obsahuje aspoň jeden top-level
// import/export příkaz — samotné použití dynamického import() (běžné funkce,
// dostupné i v klasických skriptech) modul ještě nezakládá.
const ES_MODULE_SYNTAX_RE = /^\s*(?:import\s|import\{|import\*|export\s|export\{|export\*)/m;

/** @type {Functions.Base.looksLikeEsModuleSource} */
function looksLikeEsModuleSource(sourceText) {
	return ES_MODULE_SYNTAX_RE.test(sourceText);
}

// Povinná kontrola konvence přípon: soubor používající top-level
// import/export (skutečný JS modul) musí mít příponu .mjs; soubor bez nich
// (klasický skript, klidně i s dynamickým import()) musí mít příponu .js. Na
// rozdíl od validateModule() výš (chybějící volitelná metadata -> jen
// warning) je tohle vždy chyba — špatná přípona reálně hrozí tím, že se
// soubor podle toho, kde/jak se použije (např. jako content script), vůbec
// nenačte. Nic ale neblokuje — jen se nahlásí, ať to jde snadno najít a
// opravit (stejně jako u ostatních kontrol modulů v tomto souboru).
/** @type {Functions.Base.validateModuleFileExtension} */
export async function validateModuleFileExtension(path) {
	let sourceText;
	try {
		const res = await fetch(chrome.runtime.getURL(path));
		sourceText = await res.text();
	} catch (err) {
		console.error(`Nelze ověřit příponu souboru "${path}": ${/** @type {Error} */ (err).message}`);
		return false;
	}

	const isModule = looksLikeEsModuleSource(sourceText);
	const hasMjsExt = /\.mjs$/.test(path);
	const hasJsExt = /\.js$/.test(path) && !hasMjsExt;

	if (isModule && !hasMjsExt) {
		console.error(
			`Soubor "${path}" používá import/export (je to JS modul) — musí mít příponu .mjs.`
		);
		return false;
	}

	if (!isModule && !hasJsExt) {
		console.error(
			`Soubor "${path}" nepoužívá import/export (není to JS modul) — musí mít příponu .js.`
		);
		return false;
	}

	return true;
}

/** @type {Functions.Base.getTagName} */
export function getTagName(name) {
	const kebab = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
	return `extension-${kebab}`;
}

// Jméno modulu pro lidi: slova z camelCase s velkým počátečním písmenem
// ("storageManager" -> "Storage Manager"); zkratka psaná velkými písmeny
// zůstane, jak je ("PWAInfo" -> "PWA Info").
/** @type {Functions.Base.formatModuleName} */
export function formatModuleName(key) {
	const words = key.match(/[A-Z]?[a-z]+|[0-9]+|[A-Z]+(?=[A-Z][a-z])/g);
	if (words && words.length > 1) {
		return words
			.map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
			.join(" ");
	}
	return key.charAt(0).toUpperCase() + key.slice(1);
}

// moduleDefaultMode: nepovinná hodnota deklarovaná samotným modulem (viz
// registerModule -> defaultActivationMode). Přednost má vždy explicitní
// uživatelské nastavení; teprve pak vlastní výchozí hodnota modulu; teprve
// pak globální DEFAULT_MODE.
/** @type {Functions.Base.getModuleMode} */
export function getModuleMode(settings, moduleName, moduleDefaultMode) {
	// Pod holým jménem modulu je v moduleSettings uložený jeho aktivační režim.
	return /** @type {Enums.ActivationMode | undefined} */ (settings[moduleName]) || moduleDefaultMode || DEFAULT_MODE;
}

// Pročistí uložené stavy rámů (FRAME_STATE_KEY): zahodí neplatné záznamy
// a záznamy neviděné déle než FRAME_STATE_TTL_MS, a když jich i tak zbyde
// víc než FRAME_STATE_MAX_ENTRIES, nechá jen ty naposledy viděné. Vrací nový
// objekt, vstup nemění.
/** @type {Functions.Base.pruneFrameStates} */
export function pruneFrameStates(store, now = Date.now()) {
	/** @type {[string, Types.FrameState][]} */
	const entries = [];
	for (const [key, entry] of Object.entries(store && typeof store === "object" ? store : {})) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof entry.open !== "boolean" ||
			typeof entry.element !== "string" ||
			typeof entry.seen !== "number" ||
			now - entry.seen > FRAME_STATE_TTL_MS
		) {
			continue;
		}
		entries.push([key, entry]);
	}
	entries.sort((a, b) => b[1].seen - a[1].seen);
	return Object.fromEntries(entries.slice(0, FRAME_STATE_MAX_ENTRIES));
}

// Poslední známý obsah FRAME_STATE_KEY na téhle stránce — načtený předem
// (BaseController.preloadFrameStates()), ať mountModuleElement() může
// uložený stav nastavit hned při vytvoření rámu, bez probliknutí výchozího
// stavu. Změny z jiných ploch (popup, postranní panel) sem
// přicházejí přes chrome.storage.onChanged.
/** @type {Types.FrameStateStore | null} */
let frameStateCache = null;
let frameStateListening = false;
// Změny čekající na zápis (klíč → nový záznam, nebo null = smazat) a řetěz
// zápisů — v rámci stránky jdou zápisy po sobě, každý čte aktuální obsah
// úložiště, ať se nepřepíšou změny jiných ploch.
/** @type {Map<string, Types.FrameState | null>} */
const pendingFrameStates = new Map();
/** @type {Promise<void>} */
let frameStateWrite = Promise.resolve();

/** @type {Functions.Base.readFrameStates} */
function readFrameStates() {
	return new Promise((resolve) => {
		chrome.storage.local.get([FRAME_STATE_KEY], (/** @type {Types.StorageLocal} */ result) => {
			resolve(pruneFrameStates(result[FRAME_STATE_KEY] || {}));
		});
	});
}

// Načte uložené stavy rámů do frameStateCache a začne sledovat jejich změny.
/** @type {Functions.Base.loadFrameStates} */
export async function loadFrameStates() {
	if (!frameStateListening && chrome.storage?.onChanged) {
		frameStateListening = true;
		chrome.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== "local" || !(FRAME_STATE_KEY in changes)) return;
			frameStateCache = /** @type {Types.FrameStateStore | undefined} */ (changes[FRAME_STATE_KEY].newValue) || {};
		});
	}
	frameStateCache = await readFrameStates();
	return frameStateCache;
}

// Naplánuje změnu záznamu rámu (null = smazat) a zapíše všechny čekající
// změny jedním zápisem; zápis zároveň pročistí staré záznamy. Vrací Promise
// dokončení zápisu.
/** @type {Functions.Base.queueFrameState} */
export function queueFrameState(key, entry) {
	pendingFrameStates.set(key, entry);
	frameStateWrite = frameStateWrite.then(async () => {
		if (pendingFrameStates.size === 0) return;
		const changes = [...pendingFrameStates];
		pendingFrameStates.clear();
		/** @type {Types.FrameStateStore} */
		const store = await readFrameStates();
		for (const [changedKey, changedEntry] of changes) {
			if (changedEntry) store[changedKey] = changedEntry;
			else delete store[changedKey];
		}
		const pruned = pruneFrameStates(store);
		frameStateCache = pruned;
		await new Promise((resolve) => chrome.storage.local.set({ [FRAME_STATE_KEY]: pruned }, () => resolve(undefined)));
	}).catch((err) => console.error("Nelze uložit stav rámu modulu:", err));
	return frameStateWrite;
}

// Napojí rám modulu na uložený stav: u uzavíratelného rámu nastaví uložené
// otevřeno/zavřeno (pokud uživatel stav změnil a od té doby se nezměnilo
// nastavení "Element výpisu dat"), obnoví čas "naposledy viděn" a každou
// změnu stavu uživatelem uloží. Stav, který se vrátí k výchozímu, se
// z úložiště smaže — ukládá se jen odchylka od nastavení. U rámu, který už
// uzavíratelný není, nebo má jiné výchozí nastavení, se starý záznam smaže.
/** @type {Functions.Base.bindFrameState} */
export function bindFrameState(frame, key, outputElement) {
	/** @param {Types.FrameStateStore} store */
	const apply = (store) => {
		const entry = store[key];
		if (!entry) return;
		if (!outputElement.collapsible || entry.element !== outputElement.value) {
			queueFrameState(key, null);
			return;
		}
		/** @type {HTMLDetailsElement} */ (frame).open = entry.open;
		expectedOpen = entry.open;
		if (Date.now() - entry.seen > FRAME_STATE_SEEN_REFRESH_MS) {
			queueFrameState(key, { ...entry, seen: Date.now() });
		}
	};

	// Stav, který rámu nastavil kód (výchozí, nebo uložený) — událost toggle
	// přichází i po změně z kódu, uloží se jen změna, která se od něj liší.
	const defaultOpen = outputElement.collapsible ? outputElement.open : false;
	let expectedOpen = defaultOpen;
	let userToggled = false;

	if (frameStateCache) {
		apply(frameStateCache);
	} else {
		readFrameStates().then((store) => {
			if (!userToggled) apply(store);
		});
	}

	if (!outputElement.collapsible) return;
	frame.addEventListener("toggle", () => {
		const open = /** @type {HTMLDetailsElement} */ (frame).open;
		if (open === expectedOpen) return;
		expectedOpen = open;
		userToggled = true;
		queueFrameState(
			key,
			open === defaultOpen ? null : { open, element: outputElement.value, seen: Date.now() }
		);
	});
}

// Podporované typy polí pro vlastní nastavení modulu (settingsSchema) —
// jediný zdroj pravdy pro to, co umí generický formulář v options.mjs
// vykreslit, aniž by o konkrétním modulu cokoliv věděl.
//
// Typ "custom" je pro nastavení, které se do jednoduchého pole nevejde (třeba
// seznam s libovolným počtem položek): modul u pole dodá funkci
// render(value, settings), která vrátí element s metodou getValue(). Formulář
// ho jen vloží a při uložení si od něj hodnotu vyžádá (viz bookmarkChecker).
/** @type {Enums.SettingFieldType[]} */
export const SETTING_FIELD_TYPES = ["text", "textarea", "number", "checkbox", "select", "custom"];

// Sestaví klíč, pod kterým se v úložišti (moduleSettings) drží konkrétní
// vlastní nastavení modulu — odděleně od jeho aktivačního režimu (ten je
// uložen pod holým jménem modulu). Sdílené mezi modulem (čtení/zápis svého
// nastavení) a options.mjs (generické vykreslení/uložení formuláře).
/** @type {Functions.Base.getModuleSettingKey} */
export function getModuleSettingKey(moduleName, fieldKey) {
	return `${moduleName}.${fieldKey}`;
}

// Místa výstupu ze zapsané hodnoty: pole míst (["options", "onboarding"],
// prázdné = nikde), nebo jeden řetězec — jedno místo, "none" = nikde (starší
// zápis, viz NO_DISPLAY_LOCATION). Výsledek je v pořadí DISPLAY_LOCATIONS a bez
// opakování. Neznámá místa v poli se vynechají (třeba záloha z novější verze
// rozšíření s místem, které tahle verze nezná); neznámý řetězec nebo jiný typ
// je neplatná hodnota → null.
/** @type {Functions.Base.parseDisplayLocations} */
export function parseDisplayLocations(value) {
	if (value === NO_DISPLAY_LOCATION) return [];
	const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
	if (!values) return null;
	const locations = DISPLAY_LOCATIONS.map((item) => item.value).filter((location) => values.includes(location));
	return typeof value === "string" && locations.length === 0 ? null : locations;
}

// Kde se má vykreslit vlastní element modulu — seznam míst, uložený pod
// stejnou konvencí jako settingsSchema pole (getModuleSettingKey), takže to
// nekoliduje s holým "settings[moduleName]" (tam je aktivační režim).
//
// moduleDefaultLocation: nepovinná hodnota deklarovaná samotným modulem (viz
// registerModule -> defaultDisplayLocation), stejná priorita jako u
// getModuleMode (uživatel > modul > globální výchozí hodnota). Neplatná
// hodnota na kterékoliv úrovni se přeskočí (viz parseDisplayLocations()).
/** @type {Functions.Base.getModuleDisplayLocations} */
export function getModuleDisplayLocations(settings, moduleName, moduleDefaultLocation) {
	return (
		parseDisplayLocations(settings[getModuleSettingKey(moduleName, "displayLocation")]) ||
		parseDisplayLocations(moduleDefaultLocation) || [DEFAULT_DISPLAY_LOCATION]
	);
}

// Položka OUTPUT_ELEMENTS podle hodnoty — neznámá/chybějící hodnota (např.
// ručně upravené úložiště) spadne na DEFAULT_OUTPUT_ELEMENT, ať rám vždy
// dostane platný tvar.
/** @type {Functions.Base.getOutputElementDef} */
export function getOutputElementDef(value) {
	// Položka DEFAULT_OUTPUT_ELEMENT v OUTPUT_ELEMENTS vždy existuje.
	return /** @type {Types.OutputElementOption} */ (
		OUTPUT_ELEMENTS.find((item) => item.value === value) ||
		OUTPUT_ELEMENTS.find((item) => item.value === DEFAULT_OUTPUT_ELEMENT)
	);
}

// "Element výpisu dat" a "s nadpisem modulu" — stejná konvence klíčů i
// priorita jako displayLocation výš (uživatel > modul, viz registerModule ->
// defaultOutputElement/defaultShowHeading > globální výchozí hodnota).
// Neplatná hodnota na kterékoliv úrovni se přeskočí, ne použije.
/** @type {Functions.Base.getModuleOutputElement} */
export function getModuleOutputElement(settings, moduleName, moduleDefaultOutputElement) {
	// Přetypování samotné funkce: typový predikát přes @type na proměnné TS u
	// arrow funkce neumí (typ proměnné by jen porovnal s odvozeným boolean).
	const isValid = /** @type {Functions.Base.getModuleOutputElement.isValid} */ ((value) => OUTPUT_ELEMENTS.some((item) => item.value === value));
	const userValue = settings[getModuleSettingKey(moduleName, "outputElement")];
	if (isValid(userValue)) return userValue;
	if (isValid(moduleDefaultOutputElement)) return moduleDefaultOutputElement;
	return DEFAULT_OUTPUT_ELEMENT;
}

// Boolean, takže bez "||" — uložené false je platná volba uživatele.
/** @type {Functions.Base.getModuleShowHeading} */
export function getModuleShowHeading(settings, moduleName, moduleDefaultShowHeading) {
	const userValue = settings[getModuleSettingKey(moduleName, "showHeading")];
	if (typeof userValue === "boolean") return userValue;
	if (typeof moduleDefaultShowHeading === "boolean") return moduleDefaultShowHeading;
	return DEFAULT_SHOW_HEADING;
}

/** @implements {Classes.Specification} */
export class Specification {
	/** @type {Classes.Specification['isSatisfiedBy']} */
	isSatisfiedBy(_context) {
		return true;
	}

	/** @type {Classes.Specification['and']} */
	and(other) {
		return new AndSpecification(this, other);
	}
}

/** @implements {Classes.AndSpecification} */
export class AndSpecification extends Specification {
	/** @param {...Classes.Specification} specs */
	constructor(...specs) {
		super();
		/** @type {Classes.AndSpecification['_specs']} */
		this._specs = specs;
	}

	/**
	 * @override
	 * @type {Classes.AndSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return this._specs.every((spec) => spec.isSatisfiedBy(context));
	}
}

// Pravidlo pro PLOCHU výstupu modulu (popup/sidebar/…) — stejná
// role jako ModeSpecification, ale pro DISPLAY_LOCATIONS místo
// ACTIVATION_MODES: plocha, na které se právě vykresluje (context.location),
// je daná plocha, nebo jedna z daných — seznam míst, kam modul posílá
// „Vypisovat data modulu“ (getModuleDisplayLocations(), prázdný = nikde).
// Nahrazuje přímé porovnání řetězců v BaseController, ať je rozhodnutí "patří
// modul na tuhle plochu" vyjádřené stejně jako rozhodnutí "je modul aktivní" —
// obě přes Specification, ne různě.
/** @implements {Classes.LocationSpecification} */
export class LocationSpecification extends Specification {
	/** @param {Enums.RenderLocation | Enums.RenderLocation[]} locations */
	constructor(locations) {
		super();
		/** @type {Classes.LocationSpecification['_locations']} */
		this._locations = Array.isArray(locations) ? locations : [locations];
	}

	/**
	 * @override
	 * @type {Classes.LocationSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return context.location !== undefined && this._locations.includes(context.location);
	}
}

/** @implements {Classes.DisabledSpecification} */
export class DisabledSpecification extends Specification {
	/**
	 * @override
	 * @type {Classes.DisabledSpecification['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return context.mode === "disabled";
	}
}

/** @implements {Classes.IsNotDisabled} */
export class IsNotDisabled extends Specification {
	/**
	 * @override
	 * @type {Classes.IsNotDisabled['isSatisfiedBy']}
	 */
	isSatisfiedBy(context) {
		return context.mode !== "disabled";
	}
}

// Sdílené, znovupoužitelné instance specifikací — jediný zdroj pravdy pro
// aktivační pravidla napříč controllery, moduly i content skripty.
export const NOT_DISABLED_SPEC = new IsNotDisabled();
export const DISABLED_SPEC = new DisabledSpecification();

// Jména modulů, jejichž pageInit už na téhle stránce proběhl (viz
// BaseController.runPageInits) — base.mjs je na stránce jedna instance.
/** @type {Set<string>} */
const pageInitDone = new Set();

// Adresy CSS souborů modulů (moduleDef.styles), které už na téhle stránce
// mají <link> v <head> (viz BaseController.loadModuleStyles) — každý se
// vloží jen jednou, i když se element modulu vykreslí víckrát.
/** @type {Set<string>} */
const loadedModuleStyles = new Set();

/** @implements {Classes.BaseController} */
export class BaseController {
	constructor() {
		/** @type {Classes.BaseController['_settings']} */
		this._settings = {};
	}

	/** @type {Classes.BaseController['loadSettings']} */
	async loadSettings() {
		return new Promise((resolve) => {
			chrome.storage.local.get([SETTINGS_KEY], (/** @type {Types.StorageLocal} */ result) => {
				this._settings = /** @type {Types.ModuleSettings} */ (result[SETTINGS_KEY] || {});
				resolve(this._settings);
			});
		});
	}

	/** @type {Classes.BaseController['saveSettings']} */
	async saveSettings(settings) {
		this._settings = settings;
		return new Promise((resolve) => {
			chrome.storage.local.set({ [SETTINGS_KEY]: settings }, resolve);
		});
	}

	/** @type {Classes.BaseController['getModulesJson']} */
	async getModulesJson() {
		return new Promise((resolve, reject) => {
			chrome.storage.local.get([MODULES_JSON_KEY], (/** @type {Types.StorageLocal} */ result) => {
				if (result[MODULES_JSON_KEY]) {
					resolve(/** @type {string} */ (result[MODULES_JSON_KEY]));
				} else {
					// Seznam v úložišti je jen tehdy, když se od modules.json liší
					// (viz saveModulesJson) — jinak platí přímo modules.json.
					this.fetchDefaultModulesJson().then(resolve, reject);
				}
			});
		});
	}

	/** @type {Classes.BaseController['fetchDefaultModulesJson']} */
	async fetchDefaultModulesJson() {
		let res;
		try {
			res = await fetch(chrome.runtime.getURL("modules.json"));
		} catch (err) {
			// Chybějící soubor v balíčku je chyba sítě, ne odpověď 404.
			throw new Error(t("core_default_modules_load_failed", /** @type {Error} */ (err).message), { cause: err });
		}
		if (!res.ok) {
			throw new Error(t("core_default_modules_load_failed", res.status));
		}
		return (await res.text()).trim();
	}

	// Výchozí nastavení položek seznamu modulů z balíčku rozšíření (viz
	// DEFAULT_SETTINGS_FILE) — objekt ve tvaru moduleSettings.
	/** @type {Classes.BaseController['fetchDefaultSettings']} */
	async fetchDefaultSettings() {
		const res = await fetch(chrome.runtime.getURL(DEFAULT_SETTINGS_FILE));
		if (!res.ok) {
			throw new Error(t("core_file_load_failed", DEFAULT_SETTINGS_FILE, res.status));
		}
		const defaults = await res.json();
		if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
			throw new Error(t("core_default_settings_not_object", DEFAULT_SETTINGS_FILE));
		}
		// Texty ve výchozím nastavení (nadpis a HTML uvítacího oddělovače) jsou
		// zapsané jako "__MSG_klíč__" (stejně jako v manifestu) a doplní se v
		// jazyce rozhraní — do úložiště jde už hotový text, který si uživatel
		// může upravit.
		await loadI18n();
		for (const [key, value] of Object.entries(defaults)) {
			const match = typeof value === "string" ? /^__MSG_(\w+)__$/.exec(value) : null;
			if (match) defaults[key] = t(match[1]);
		}
		return defaults;
	}

	// Doplní do uloženého moduleSettings výchozí nastavení (fetchDefaultSettings())
	// položek seznamu modulů paths, které ještě žádnou hodnotu nemají — hodnotu,
	// kterou uživatel změnil, nikdy nepřepíše. Klíč patří položce podle části
	// před první tečkou ("contentDivider#welcome.title" -> "contentDivider#welcome");
	// hodnoty položek, které v seznamu nejsou, se nezapisují (odebraná instance
	// modulu by se jinak po každé aktualizaci vracela do úložiště). Volá ho
	// background.js po instalaci a aktualizaci rozšíření a Nastavení po uložení
	// seznamu modulů (položka mohla přibýt). Vrací moduleSettings po doplnění.
	/** @type {Classes.BaseController['seedDefaultSettings']} */
	async seedDefaultSettings(paths) {
		/** @type {Types.ModuleSettings} */
		let defaults;
		try {
			defaults = await this.fetchDefaultSettings();
		} catch (err) {
			console.error("Výchozí nastavení modulů nejde načíst:", err);
			return this.loadSettings();
		}

		const entryKeys = new Set(
			paths.filter((path) => typeof path === "string").map((path) => parseModuleEntry(path).key)
		);
		const settings = { ...(await this.loadSettings()) };
		let changed = false;
		for (const [storageKey, value] of Object.entries(defaults)) {
			if (!entryKeys.has(storageKey.split(".")[0]) || settings[storageKey] !== undefined) continue;
			settings[storageKey] = value;
			changed = true;
		}
		if (changed) {
			await this.saveSettings(settings);
		}
		return settings;
	}

	// Seznam shodný s výchozím modules.json se do úložiště neukládá — klíč se
	// smaže a platí zase přímo modules.json, i s jeho pozdějšími změnami (nový
	// modul po aktualizaci rozšíření). V úložišti je tak jen seznam, který se
	// od výchozího liší; „Obnovit výchozí seznam“ tím klíč odstraní.
	/** @type {Classes.BaseController['saveModulesJson']} */
	async saveModulesJson(text) {
		let isDefault = false;
		try {
			const defaultText = await this.fetchDefaultModulesJson();
			isDefault = JSON.stringify(JSON.parse(text)) === JSON.stringify(JSON.parse(defaultText));
		} catch {
			// Výchozí seznam nejde načíst nebo porovnat — uloží se, co přišlo.
		}

		return new Promise((resolve, reject) => {
			const done = () => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					resolve();
				}
			};
			if (isDefault) {
				chrome.storage.local.remove(MODULES_JSON_KEY, done);
			} else {
				chrome.storage.local.set({ [MODULES_JSON_KEY]: text }, done);
			}
		});
	}

	/** @type {Classes.BaseController['getModuleKey']} */
	getModuleKey(path) {
		return getModuleKey(path);
	}

	/** @type {Classes.BaseController['formatModuleName']} */
	formatModuleName(key) {
		return formatModuleName(key);
	}

	/** @type {Classes.BaseController['getModuleMode']} */
	getModuleMode(settings, moduleName, moduleDefaultMode) {
		return getModuleMode(settings, moduleName, moduleDefaultMode);
	}

	// Jediné místo, kde se pro vyhodnocení Specification zjišťuje aktivní
	// záložka — url je adresa AKTIVNÍ ZÁLOŽKY (chrome.tabs.query), ne adresa
	// stránky, která zrovna kontext staví. Dřív si popup.mjs stavěl vlastní
	// kontext s window.location.href, což je adresa popup.html samotného, ne
	// stránky, na které je uživatel — activationSpec závislá na adrese
	// by tak nikdy nefungovala správně. Sdílené i pro
	// sidebar (přes renderModulesFor), ať mají všechny plochy stejný,
	// funkční zdroj URL.
	/** @type {Classes.BaseController['buildPageContext']} */
	async buildPageContext() {
		let url = "";
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			url = (tab && tab.url) || "";
		} catch (err) {
			console.error("Nelze zjistit URL aktivní záložky:", err);
		}
		return { url };
	}

	// Kontext { mode, url, hostAccess } pro vyhodnocení Specification — režim
	// modulu a aktivní záložka (buildPageContext() výš).
	/** @type {Classes.BaseController['buildActivationContext']} */
	async buildActivationContext(mode) {
		return { mode, ...(await this.buildPageContext()) };
	}

	// Jedno místo pravdy pro "má být tenhle modul právě teď aktivní a
	// vykreslený na týhle konkrétní ploše" — skládá modulem deklarovanou
	// activationSpec (fallback NOT_DISABLED_SPEC, stejný jako výchozí hodnota
	// v BaseElement) s LocationSpecification pro místa, kam modul posílá svůj
	// výstup (cílová plocha musí být jedním z nich), takže
	// "kdy" i "kde" se vyhodnocují jednotně přes Specification Pattern na
	// jednom místě, místo aby každý kontroler (popup/sidebar)
	// duplikoval vlastní verzi týchž dvou kontrol. Používá ho popup.mjs i
	// renderModulesFor() níž — ten předává jeden snímek aktivní záložky (page)
	// pro všechny moduly najednou, jinak se zjistí pro každý modul zvlášť.
	/** @type {Classes.BaseController['isModuleActive']} */
	// key: klíč nastavení položky seznamu (viz getModuleInstanceKey()) — u
	// instance modulu se režim a místa výstupu čtou z jejího vlastního nastavení.
	async isModuleActive(mod, settings, location, page, key = mod.name) {
		const mode = getModuleMode(settings, key, mod.defaultActivationMode);
		const displayLocations = getModuleDisplayLocations(settings, key, mod.defaultDisplayLocation);
		/** @type {Types.SpecificationContext} */
		const ctx = page ? { mode, ...page } : await this.buildActivationContext(mode);
		ctx.location = location;

		const spec = (mod.activationSpec || NOT_DISABLED_SPEC).and(new LocationSpecification(displayLocations));
		return { active: spec.isSatisfiedBy(ctx), mode, ctx };
	}

	// Dynamicky načte JS soubory modulů, čímž proběhne jejich
	// customElements.define()/registerModule() a jejich metadata (např.
	// settingsSchema) se objeví ve window.__extensionModules. Chyby u
	// jednotlivých modulů jsou nefatální — jen se zalogují a pokračuje se dál.
	/** @type {Classes.BaseController['importModuleFiles']} */
	async importModuleFiles(paths) {
		// Instance jednoho modulu (viz parseModuleEntry()) sdílejí soubor —
		// importuje se jednou a bez id instance: jiná adresa (i jen jiný
		// fragment) by byla nový modul a druhé customElements.define() by selhalo.
		const files = new Set(paths.filter((path) => typeof path === "string").map((path) => parseModuleEntry(path).path));
		for (const path of files) {
			await validateModuleFileExtension(path);
			try {
				await import(chrome.runtime.getURL(path));
			} catch (err) {
				console.error(`Chyba při načítání modulu ${path}:`, err);
			}
		}
		return globalThis.__extensionModules || [];
	}

	// Zavolá pageInit({ api, location }) všech načtených, nevypnutých modulů,
	// které ho deklarují (registerModule), jednou na stránku — na KAŽDÉ
	// stránce rozšíření (popup/sidebar/options/onboarding), bez ohledu na to,
	// kde (a jestli vůbec) se vykresluje element modulu. Pro chování, které
	// se týká celé stránky (příklad: styleSwitch přepíná styly stránky).
	// Nečeká se na ně — vykreslení elementů nezdrží a chyba jednoho modulu
	// neshodí ostatní. Volá ho renderModulesFor() níž i popup.mjs.
	/** @type {Classes.BaseController['runPageInits']} */
	runPageInits(settings, location) {
		for (const mod of globalThis.__extensionModules || []) {
			if (typeof mod.pageInit !== "function" || pageInitDone.has(mod.name)) continue;
			const mode = getModuleMode(settings, mod.name, mod.defaultActivationMode);
			if (DISABLED_SPEC.isSatisfiedBy({ mode })) continue;

			pageInitDone.add(mod.name);
			const pageInit = mod.pageInit;
			try {
				Promise.resolve(pageInit.call(mod, { api: createModuleApi(mod.name), location })).catch((err) =>
					console.error(`Chyba v pageInit modulu ${mod.name}:`, err)
				);
			} catch (err) {
				console.error(`Chyba v pageInit modulu ${mod.name}:`, err);
			}
		}
	}

	// Vlastní CSS modulu (moduleDef.styles, absolutní adresy) jako <link> na
	// konec <head> — za CSS stránky (mvp.css, theme-*.css, module-frame.css),
	// takže při stejné specifičnosti vyhrává modul. Bez atributu title: přepínač
	// vzhledu (styleSwitch) ho tak nebere jako volbu a nechá ho zapnutý vždy.
	// Neplatnou deklaraci nahlásí už validateModule(), tady se jen přeskočí.
	/** @type {Classes.BaseController['loadModuleStyles']} */
	loadModuleStyles(mod) {
		if (!Array.isArray(mod.styles)) return;
		for (const href of mod.styles) {
			if (typeof href !== "string" || loadedModuleStyles.has(href)) continue;
			loadedModuleStyles.add(href);
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = href;
			link.dataset.module = mod.name;
			document.head.appendChild(link);
		}
	}

	// Vytvoří vlastní element modulu obalený rámem podle nastavení "Element
	// výpisu dat" a "s nadpisem modulu" (viz OUTPUT_ELEMENTS), připojí ho do
	// outputEl (na konec, nebo před uzel before) a vrátí samotný element (bez
	// rámu) k zavolání init(). Sdílené mezi renderModulesFor() níž a
	// popup.mjs, ať rám vypadá na všech plochách stejně.
	//
	// Nadpis je v rámu, ne v elementu modulu — moduly si obsah běžně přepisují
	// celý (this.textContent = ...), nadpis by jim tak zmizel. Vypnutý nadpis
	// v rámu zůstává, jen s atributem hidden. Výjimka je uzavíratelný rám:
	// tam je nadpis <summary>, jediné, za co jde rám rozbalit, takže se
	// neskrývá nikdy (skrytý by zavřený modul nešel otevřít vůbec).
	/** @type {Classes.BaseController['mountModuleElement']} */
	//
	// key: klíč nastavení položky seznamu (viz isModuleActive()) — rám instance
	// modulu se řídí jejím vlastním nastavením.
	mountModuleElement(mod, settings, outputEl, before = null, key = mod.name) {
		this.loadModuleStyles(mod);

		const outputElement = getOutputElementDef(
			getModuleOutputElement(settings, key, mod.defaultOutputElement)
		);

		const frame = document.createElement(outputElement.collapsible ? "details" : "div");
		frame.className = `module-frame module-frame--${outputElement.value}`;
		frame.dataset.module = mod.name;
		if (key !== mod.name) {
			frame.dataset.moduleKey = key;
		}
		if (outputElement.collapsible) {
			/** @type {HTMLDetailsElement} */ (frame).open = outputElement.open === true;
		}

		const heading = document.createElement(outputElement.collapsible ? "summary" : "div");
		heading.className = "module-frame-heading";
		heading.textContent = formatModuleName(mod.name);
		heading.hidden =
			!outputElement.collapsible && !getModuleShowHeading(settings, key, mod.defaultShowHeading);
		frame.appendChild(heading);
		bindFrameState(frame, key, outputElement);

		const el = document.createElement(mod.tag);
		frame.appendChild(el);
		outputEl.insertBefore(frame, before);
		return el;
	}

	// Vykreslí do outputEl vlastní elementy všech (ne vypnutých) modulů,
	// které daná lokace ("sidebar" | "options" | "onboarding")
	// je mezi místy z jejich nastavení "Vypisovat data modulu" — sdílené mezi
	// sidebar.mjs, options.mjs a onboarding.mjs (popup.mjs má
	// vlastní smyčku nad stejnými metodami), aby rozhodnutí "kde se modul
	// zobrazí" bylo na jednom místě, ne duplikované na každé ploše zvlášť.
	/** @type {Classes.BaseController['renderModulesFor']} */
	async renderModulesFor(location, outputEl) {
		let paths;
		try {
			const jsonText = await this.getModulesJson();
			paths = JSON.parse(jsonText);
			if (!Array.isArray(paths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch (err) {
			console.error("Nelze načíst seznam modulů:", err);
			return;
		}

		const settings = await this.loadSettings();
		await this.importModuleFiles(paths);
		await loadFrameStates();
		this.runPageInits(settings, location);

		/** @type {Types.ModuleSlot[]} */
		const slots = [];
		// Položky seznamu v jeho pořadí — u modulu s vícenásobnými instancemi
		// každá instance zvlášť, na svém místě (viz resolveModuleEntries()).
		for (const { mod, key, instance } of resolveModuleEntries(paths)) {
			// Rychlý odskok bez dotazu na aktivní záložku (viz
			// buildActivationContext) pro moduly, které jsou zjevně vypnuté —
			// čistě výkonnostní zkratka, isModuleActive() by je odmítla i bez ní
			// (NOT_DISABLED_SPEC v režimu "disabled" sám vrátí false).
			const mode = getModuleMode(settings, key, mod.defaultActivationMode);
			if (DISABLED_SPEC.isSatisfiedBy({ mode })) continue;

			// Místo modulu ve výpisu v pořadí seznamu modulů — neviditelná značka,
			// před kterou se vloží jeho rám, i když se modul vypíše až později
			// (viz _followActiveTab()).
			slots.push({ mod, key, instance, mode, anchor: outputEl.appendChild(document.createComment(key)), frame: null });
		}

		// Průchody všemi moduly se neprolínají: změna během průchodu jen vyžádá
		// ještě jeden — vypsání modulu (s čekáním na jeho init()) a jeho
		// odpojení se tak nemůžou předběhnout.
		/** @type {Promise<void> | null} */
		let running = null;
		let pending = false;
		/** @type {Functions.Base.BaseController.renderModulesFor.update} */
		const update = () => {
			if (running) {
				pending = true;
				return running;
			}
			running = (async () => {
				try {
					do {
						pending = false;
						// Jeden snímek aktivní záložky pro celý průchod.
						const page = await this.buildPageContext();
						for (const slot of slots) {
							await this._updateModuleSlot(slot, settings, location, outputEl, page);
						}
					} while (pending);
				} finally {
					running = null;
				}
			})();
			return running;
		};

		if (location === "sidebar") {
			this._followActiveTab(update);
		}
		await update();
	}

	// Vypíše modul na jeho místo (slot.anchor), když pro danou plochu a
	// aktivní záložku platí jeho pravidla, a odpojí ho, když přestala platit.
	// Odpojí se celý rám — element si v disconnectedCallback() uklidí
	// posluchače a při dalším vypsání vznikne nový (s novým init()). Modul,
	// jehož výsledek se nezměnil, zůstává beze změny i se svým stavem.
	/** @type {Classes.BaseController['_updateModuleSlot']} */
	async _updateModuleSlot(slot, settings, location, outputEl, page) {
		// Jedno místo pravdy pro "kdy" (activationSpec) i "kde" (displayLocation)
		// — viz isModuleActive() výš. Dřív se tu kontrolovala jen cílová
		// plocha, vlastní activationSpec modulu se v
		// postranním panelu vůbec nevyhodnocovala.
		const { active } = await this.isModuleActive(slot.mod, settings, location, page, slot.key);

		if (!active) {
			if (slot.frame) {
				slot.frame.remove();
				slot.frame = null;
			}
			return;
		}
		if (slot.frame) return;

		try {
			const name = slot.mod.name;
			const el = this.mountModuleElement(slot.mod, settings, outputEl, slot.anchor, slot.key);
			slot.frame = el.parentElement;

			const init = el.init;
			if (init) {
				await init.call(el, { outputEl, name, mode: slot.mode, location, instance: slot.instance });
			}
		} catch (err) {
			console.error(`Chyba při inicializaci modulu ${slot.key}:`, err);
		}
	}

	// Postranní panel zůstává otevřený i po přepnutí záložky nebo navigaci v
	// ní (popup se zavře, Nastavení jsou
	// záložka sama) — pravidla modulů závislá na aktivní záložce se tam proto po každé takové změně vyhodnotí
	// znovu (update() z renderModulesFor()). U navigace až po dokončení
	// načtení, ne hned s novou adresou: modul vypsaný uprostřed načítání by
	// stránku změřil dřív, než v ní poběží jeho content script.
	/** @type {Classes.BaseController['_followActiveTab']} */
	_followActiveTab(update) {
		if (!chrome.tabs?.onActivated || !chrome.tabs.onUpdated) return;

		chrome.tabs.onActivated.addListener(() => {
			update();
		});
		chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
			if (tab.active && changeInfo.status === "complete") {
				update();
			}
		});
	}
}

// --------------------------------------------------------------------
// createModuleApi — veřejné API, přes které modul (element i jeho content
// script) komunikuje s jádrem rozšíření, aniž by musel znát tvar úložiště
// (moduleSettings) nebo drátový protokol zpráv s
// background.js. Je to jediná cesta ven ze sdk.mjs, kterou by moduly měly
// používat — base.mjs zůstává interní.
//
// BaseElement.init() vytvoří instanci automaticky (this.api); kód mimo
// element (background část modulu) ji dostane od jádra, viz
// registerBackgroundScript().
// --------------------------------------------------------------------
//
// instance: id instance modulu s vícenásobnými instancemi (viz
// MODULE_INSTANCE_SEPARATOR) — api.settings pak čte a zapisuje nastavení TÉ
// instance (klíč "<modul>#<id>"), ne celého modulu. Všechno ostatní (stav,
// oprávnění, ...) patří dál modulu jako celku.
/** @type {Functions.Base.createModuleApi} */
export function createModuleApi(moduleName, instance = null) {
	// Pod čím je v moduleSettings nastavení (režim i vlastní pole) — viz
	// getModuleInstanceKey().
	const settingsKey = getModuleInstanceKey(moduleName, instance);

	/** @type {Functions.Base.createModuleApi.readAllSettings} */
	async function readAllSettings() {
		return new Promise((resolve) => {
			chrome.storage.local.get([SETTINGS_KEY], (/** @type {Types.StorageLocal} */ result) => {
				resolve(/** @type {Types.ModuleSettings} */ (result[SETTINGS_KEY] || {}));
			});
		});
	}

	// api.state (chrome.storage.local) a api.sessionState (chrome.storage.session):
	// každá hodnota pod vlastním klíčem úložiště (getModuleStateKey()), takže
	// zápis jedné hodnoty nemůže přepsat jinou (žádné read-modify-write
	// společného objektu).
	/** @type {Functions.Base.createModuleApi.createStateArea} */
	function createStateArea(areaName) {
		/** @type {Functions.Base.createModuleApi.createStateArea.storageArea} */
		const storageArea = () => {
			const area = typeof chrome !== "undefined" && chrome.storage ? chrome.storage[areaName] : undefined;
			if (!area) {
				throw new Error(t("core_storage_unavailable", areaName));
			}
			return area;
		};
		return {
			/**
			 * @template T
			 * @param {string} key
			 * @param {T} [defaultValue]
			 * @returns {Promise<T>}
			 */
			async get(key, defaultValue) {
				const storageKey = getModuleStateKey(moduleName, key);
				const result = /** @type {Record<string, unknown>} */ (await storageArea().get(storageKey));
				return /** @type {T} */ (result[storageKey] !== undefined ? result[storageKey] : defaultValue);
			},
			async set(key, value) {
				await storageArea().set({ [getModuleStateKey(moduleName, key)]: value });
			},
		};
	}

	// Je modul v aktuálním seznamu modulů (modules.json, nebo seznam upravený v
	// Nastavení, viz BaseController.getModulesJson())? Nečitelný seznam = ne.
	/** @type {Functions.Base.createModuleApi.isListed} */
	async function isListed() {
		try {
			const paths = JSON.parse(await new BaseController().getModulesJson());
			return Array.isArray(paths) && paths.some((path) => typeof path === "string" && getModuleKey(path) === moduleName);
		} catch {
			return false;
		}
	}

	/** @type {Types.ModuleApi} */
	const api = {
		settings: {
			// Jedna vlastní hodnota modulu pod getModuleSettingKey(settingsKey, key)
			// — stejná konvence jako pole settingsSchema v Nastavení (u instance
			// modulu pole instanceSettingsSchema).
			// Typ hodnoty určuje volající výchozí hodnotou (viz Types.ModuleSettingsApi.get)
			// — jen jeho vlastní klíč, pod kterým hodnotu tohoto typu sám ukládá.
			/**
			 * @template T
			 * @param {string} key
			 * @param {T} [defaultValue]
			 * @returns {Promise<T>}
			 */
			async get(key, defaultValue) {
				const settings = await readAllSettings();
				const value = settings[getModuleSettingKey(settingsKey, key)];
				return /** @type {T} */ (value !== undefined ? value : defaultValue);
			},

			// Zavolá handler(settings) při každé změně moduleSettings odkudkoliv
			// z rozšíření. Vrací funkci pro odhlášení.
			onChange(handler) {
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					if (area === "local" && changes[SETTINGS_KEY]) {
						handler(/** @type {Types.ModuleSettings} */ (changes[SETTINGS_KEY].newValue || {}));
					}
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},
		},

		// Vlastní stav modulu mimo jeho nastavení — hodnoty, které si modul
		// počítá a pamatuje sám a uživatel je v Nastavení neupravuje (tabGroups:
		// den posledního zařazení karet). Nastavení (api.settings) je jeden
		// společný objekt moduleSettings, který stránka Nastavení ukládá celý
		// najednou, a častý zápis odjinud by se s ním mohl přetahovat. Tady má
		// každá hodnota vlastní klíč v chrome.storage.local
		// ("moduleState.<modul>.<klíč>").
		state: createStateArea("local"),

		// Totéž v chrome.storage.session — platí jen do restartu prohlížeče nebo
		// znovunačtení rozšíření (pak je prázdné) a přežije uspání service
		// workeru. Pro údaje vázané na běh prohlížeče, třeba čísla karet, která
		// po restartu prohlížeče přestanou platit (tabGroups: dny otevření
		// karet).
		sessionState: createStateArea("session"),

		// Má modul právě pracovat? Pro kód, který neběží jako element (ten
		// kontroler vůbec nevykreslí, když modul pracovat nemá) — hlavně
		// background část modulu (registerBackgroundScript()), jejíž posluchače
		// jsou zaregistrované vždy.
		activation: {
			// Modul je v seznamu modulů a jeho activationSpec (výchozí
			// NOT_DISABLED_SPEC) platí pro aktuální aktivační režim (uživatel >
			// moduleDefaultMode > globální výchozí). Plochu (LocationSpecification)
			// ani aktivní záložku tu nic nevyhodnocuje — kontext je jen { mode }.
			async isActive(moduleDefaultMode, activationSpec = NOT_DISABLED_SPEC) {
				const [settings, listed] = await Promise.all([readAllSettings(), isListed()]);
				return listed && activationSpec.isSatisfiedBy({ mode: getModuleMode(settings, moduleName, moduleDefaultMode) });
			},
			// Zavolá handler() při změně seznamu modulů nebo moduleSettings (tedy
			// i aktivačního režimu) — výsledek isActive() se mohl změnit. Vrací
			// funkci pro odhlášení.
			onChange(handler) {
				/** @type {Types.StorageChangeListener} */
				const listener = (changes, area) => {
					if (area === "local" && (changes[SETTINGS_KEY] || changes[MODULES_JSON_KEY])) {
						handler();
					}
				};
				chrome.storage.onChanged.addListener(listener);
				return () => chrome.storage.onChanged.removeListener(listener);
			},
		},

		messages: {
			// Naslouchá zprávám s daným "type" z chrome.runtime.onMessage. Vrací
			// funkci pro odhlášení; handler smí vrátit true pro asynchronní
			// sendResponse stejně jako u syrového chrome.runtime.onMessage.addListener.
			on(type, handler) {
				// Přetypování místo @type: posluchač smí vrátit true (asynchronní
				// sendResponse), tvar z @types/chrome ale deklaruje návrat void.
				const listener = /** @type {Types.RuntimeMessageListener} */ ((message, sender, sendResponse) => {
					const typed = /** @type {Types.AnyMessage | null | undefined} */ (message);
					if (typed && typed.type === type) {
						return handler(typed, sender, sendResponse);
					}
				});
				chrome.runtime.onMessage.addListener(listener);
				return () => chrome.runtime.onMessage.removeListener(listener);
			},
			// Rozešle zprávu všem posluchačům v rozšíření (moduly, background).
			send(message) {
				return chrome.runtime.sendMessage(message).catch(() => {});
			},
		},

		permissions: {
			// Zjistí, jestli je daná sada oprávnění (tvar jako
			// chrome.permissions.contains — { permissions, origins }) už
			// udělená, aniž by modul musel řešit chrome.permissions přímo.
			async contains(permissions) {
				try {
					return await chrome.permissions.contains(permissions);
				} catch (err) {
					console.error("Nelze zjistit oprávnění:", err);
					return false;
				}
			},
			// Musí být zavoláno v přímé reakci na gesto uživatele (klik) —
			// Chrome i Firefox by jinak požadavek tiše odmítly. Vrátí true, jen
			// když uživatel oprávnění skutečně udělil.
			async request(permissions) {
				try {
					return await chrome.permissions.request(permissions);
				} catch (err) {
					console.error("Nelze vyžádat oprávnění:", err);
					return false;
				}
			},
			// Zavolá handler() při jakékoliv změně udělených oprávnění, ať už ji
			// způsobil modul, nebo si uživatel oprávnění odebral přímo v nastavení
			// prohlížeče. Starší prohlížeče chrome.permissions.onAdded/onRemoved
			// nemusí mít — pak se handler nezavolá. Vrací funkci pro odhlášení.
			onChange(handler) {
				/** @type {Types.PermissionsChangeListener} */
				const listener = () => handler();
				const hasPermissionEvents = chrome.permissions?.onAdded && chrome.permissions?.onRemoved;
				if (hasPermissionEvents) {
					chrome.permissions.onAdded.addListener(listener);
					chrome.permissions.onRemoved.addListener(listener);
				}
				return () => {
					if (hasPermissionEvents) {
						chrome.permissions.onAdded.removeListener(listener);
						chrome.permissions.onRemoved.removeListener(listener);
					}
				};
			},
		},
	};
	return api;
}

// base.mjs se importuje i v background.js, který v Chrome běží jako opravdový
// Service Worker bez DOM — tam HTMLElement neexistuje a "class X extends
// HTMLElement" by vyhodilo ReferenceError hned při definici třídy (ještě než
// se stihnou zaregistrovat message listenery v background.js). Bezpečný
// náhradní základ zajistí, že se base.mjs vždy dá naimportovat všude, i když
// jsou samotné custom elementy použitelné jen v realmu se skutečným DOM.
// Typově vždy HTMLElement — BaseElement se instancuje jen v realmu se skutečným DOM.
const HTMLElementOrFallback = /** @type {typeof HTMLElement} */ (typeof HTMLElement !== "undefined" ? HTMLElement : class {});

/** @implements {Classes.BaseElement} */
export class BaseElement extends /** @type {Types.WithFields<typeof HTMLElement, Classes.BaseElement.Fields>} */ (HTMLElementOrFallback) {
	// Žádné HTML atributy se ve výchozím stavu nesledují — konfigurace modulů
	// probíhá přes init(), ne přes atributy. Konkrétní moduly si mohou vlastní
	// observedAttributes přesto deklarovat, pokud to budou potřebovat.
	/** @type {typeof Classes.BaseElement.observedAttributes} */
	static get observedAttributes() {
		return [];
	}

	constructor() {
		super();
		/** @type {Classes.BaseElement['_name']} */
		this._name = "";
		/** @type {Classes.BaseElement['_mode']} */
		this._mode = "popup";
		/** @type {Classes.BaseElement['_instance']} */
		this._instance = null;
		// Necháno neurčené záměrně — init() ho dopočítá samo z registru
		// (globalThis.__extensionModules), podle toho, co modul deklaroval v
		// registerModule({ activationSpec }). Modul může activationSpec přesto
		// nastavit i tady v konstruktoru (starší styl, viz bookmarkChecker před
		// zavedením module.mjs) — pak má přednost tahle explicitní hodnota a
		// init() se registru vůbec neptá.
		/** @type {Classes.BaseElement['activationSpec']} */
		this.activationSpec = undefined;
	}

	// --- Custom Elements lifecycle: společný základ ---
	// Konkrétní moduly mají vlastní (byť třeba prázdné) přepisy kvůli
	// jednotnosti API napříč moduly; volají super.*(), aby se nezpřetrhal
	// úklid registrovaný zde.

	/** @type {Classes.BaseElement['connectedCallback']} */
	connectedCallback() {
		// Výchozí chování: nic. Moduly si po připojení do DOM sestavují
		// vlastní obsah/UI ve svém vlastním connectedCallback().
	}

	/** @type {Classes.BaseElement['disconnectedCallback']} */
	disconnectedCallback() {
		// Výchozí chování: nic. Moduly si po odpojení z DOM uklízí vlastní
		// posluchače ve svém vlastním disconnectedCallback().
	}

	/** @type {Classes.BaseElement['connectedMoveCallback']} */
	connectedMoveCallback() {
		// Voláno místo disconnectedCallback+connectedCallback, když je element
		// přesunut pomocí moveBefore() (state-preserving move). DOM podstrom
		// i interní stav zůstávají zachovány beze změny — žádná akce netřeba.
	}

	/** @type {Classes.BaseElement['adoptedCallback']} */
	adoptedCallback() {
		// Moduly nedrží žádný stav vázaný na konkrétní document/realm, přesun
		// pomocí document.adoptNode() proto nevyžaduje žádnou akci.
	}

	/** @type {Classes.BaseElement['attributeChangedCallback']} */
	attributeChangedCallback(_name, _oldValue, _newValue) {
		// Výchozí observedAttributes je prázdné pole, takže se tato metoda
		// v základní podobě nikdy nezavolá — je zde jen pro úplnost API.
	}

	/** @type {Classes.BaseElement['init']} */
	async init({ name, mode, location, instance }) {
		this._name = name;
		this._mode = mode || "popup";
		// Id instance modulu s vícenásobnými instancemi (viz
		// MODULE_INSTANCE_SEPARATOR), jinak null. this.api.settings pak pracuje
		// s nastavením téhle instance.
		/** @type {Classes.BaseElement['_instance']} */
		this._instance = instance || null;
		// Plocha, na které se element vykresluje ("popup"/"sidebar")
		// — na rozdíl od "mode" (KDY modul pracuje) jde o KDE. Většina modulů ji
		// nepotřebuje, ale existuje pro ty, co se musí chovat jinak podle toho,
		// jestli běží v krátkodobém popupu, nebo dlouhodobě otevřeném postranním
		// panelu.
		/** @type {Classes.BaseElement['_location']} */
		this._location = location || "popup";
		// Veřejné API pro komunikaci s jádrem (nastavení, zprávy, stav,
		// oprávnění) — viz createModuleApi() výš. Moduly ho používají jako
		// this.api.*.
		/** @type {Classes.BaseElement['api']} */
		this.api = createModuleApi(name, this._instance);

		// Pokud konstruktor activationSpec sám nenastavil, dohledá se v
		// registru podle jména modulu — stejná hodnota, jakou modul předal
		// registerModule({ activationSpec }) (typicky ACTIVATION_SPEC z jeho
		// module.mjs). Jedno místo pravdy místo dřívějšího "stejné pravidlo
		// drž na dvou místech" (viz README): modul spec deklaruje jen jednou,
		// v registerModule(), a element si ji odsud sám převezme.
		if (this.activationSpec === undefined) {
			const moduleDef = (globalThis.__extensionModules || []).find((m) => m.name === name);
			this.activationSpec = (moduleDef && moduleDef.activationSpec) || NOT_DISABLED_SPEC;
		}
	}

	// Zapouzdřuje vyhodnocení modulem deklarované aktivační specifikace,
	// takže ji moduly nemusí ověřovat ručně a nezávisle na volajícím kontextu.
	/** @type {Classes.BaseElement['isActivationSatisfied']} */
	isActivationSatisfied(mode = this._mode) {
		return (this.activationSpec || NOT_DISABLED_SPEC).isSatisfiedBy({ mode });
	}
}
