//@ts-check
"use strict";

// popup.mjs
import {
	BaseController,
	getModuleMode,
	loadFrameStates,
	parseModuleEntry,
	resolveModuleEntries,
	validateModuleFileExtension,
	DISABLED_SPEC,
} from "./base.mjs";
import { t, initPageI18n } from "./i18n.mjs";

/** @implements {Classes.PopupController} */
class PopupController extends BaseController
{
	constructor ()
	{
		super();
		this.outputEl = /** @type {Classes.PopupController['outputEl']} */ ( document.getElementById( "modules-output" ) );
		// Seznam modulů načtený v loadAndRegisterModules() — initModules() podle
		// něj určí pořadí výpisu (i jednotlivých instancí modulu).
		/** @type {Classes.PopupController['_paths']} */
		this._paths = [];
	}

	/** @type {Classes.PopupController['loadAndRegisterModules']} */
	async loadAndRegisterModules ()
	{
		const settings = await this.loadSettings();
		let paths;

		try {
			paths = JSON.parse( await this.getModulesJson() );
			if ( !Array.isArray( paths ) ) {
				throw new Error( t( "core_modules_json_not_array" ) );
			}
		} catch ( err ) {
			const errEl = document.createElement( "div" );
			errEl.className = "error";
			errEl.textContent = t( "popup_json_error", /** @type {Error} */ ( err ).message );
			this.outputEl.appendChild( errEl );
			return;
		}
		this._paths = paths;

		// Instance jednoho modulu (viz parseModuleEntry() v base.mjs) sdílejí
		// soubor, který se importuje jen jednou — a bez id instance, jinak by šlo
		// o nový modul a druhé customElements.define() by selhalo.
		/** @type {Set<string>} */
		const imported = new Set();

		for ( const entry of paths ) {
			if ( typeof entry !== "string" ) continue;
			const { path, name, key } = parseModuleEntry( entry );
			if ( imported.has( path ) ) continue;

			// Modul je bez importu znám jen podle cesty — modulem deklarovanou
			// výchozí hodnotu (defaultActivationMode) proto ještě neznáme.
			// Explicitně uživatelem vypnutý modul ale poznat jde už teď a nemá
			// smysl ho vůbec importovat; vypnutý jen podle modulem deklarované
			// výchozí hodnoty odfiltruje až initModules(). Vypnutý modul nic
			// nevypisuje — ani poznámku, že je vypnutý.
			// Pod holým jménem modulu (u instance pod "<modul>#<id>") je uložený
			// jeho aktivační režim (nebo nic). Vypnutá instance nebrání importu
			// modulu kvůli jiné, zapnuté instanci.
			if ( DISABLED_SPEC.isSatisfiedBy( { mode: /** @type {Enums.ActivationMode | undefined} */ ( settings[ key ] ) } ) ) {
				continue;
			}
			imported.add( path );

			// Validate module folder placement
			const normalizedPath = path.replace( /\\/g, "/" );
			const pathParts = normalizedPath.split( "/" );
			const folderName = pathParts[ pathParts.length - 2 ];
			if ( folderName !== name || pathParts.length < 3 ) {
				const errEl = document.createElement( "div" );
				errEl.className = "error";
				errEl.textContent = t( "popup_module_not_in_folder", name, path );
				this.outputEl.appendChild( errEl );
				continue;
			}

			await validateModuleFileExtension( path );

			// Import modules for "popup" and "icon_click" modes so custom elements are defined
			try {
				await import( chrome.runtime.getURL( path ) );
			} catch ( err ) {
				console.error( `Chyeba při načítání modulu ${ path }:`, err );
				const errEl = document.createElement( "div" );
				errEl.className = "error";
				errEl.textContent = t( "popup_module_error", path );
				this.outputEl.appendChild( errEl );
			}
		}
	}

	/** @type {Classes.PopupController['initModules']} */
	async initModules ()
	{
		const settings = await this.loadSettings();

		// Chování modulů pro celou stránku (pageInit) — stejně jako
		// renderModulesFor() na ostatních plochách, viz
		// BaseController.runPageInits().
		this.runPageInits( settings, "popup" );

		// Uložený stav uzavíratelných rámů předem, ať je rám hned ve stavu,
		// který si uživatel zvolil (viz mountModuleElement() v base.mjs).
		await loadFrameStates();

		// V pořadí seznamu modulů, u modulu s vícenásobnými instancemi každá
		// instance na svém místě (viz resolveModuleEntries() v base.mjs).
		for ( const { mod, key, instance } of resolveModuleEntries( this._paths ) ) {
			const mode = getModuleMode( settings, key, mod.defaultActivationMode );

			// Rychlý odskok bez dotazu na aktivní záložku — isModuleActive() by
			// vypnutý modul odmítla i bez něj (stejně jako renderModulesFor()).
			if ( DISABLED_SPEC.isSatisfiedBy( { mode } ) ) continue;

			// Modul se vypisuje jen tam, kam ho posílá nastavení "Vypisovat data
			// modulu", v jakémkoliv zapnutém režimu (i "background"/"focus") —
			// popup o modulech, které do něj nepatří, nic nevypisuje.
			// Zda se má modul v popupu skutečně vykreslit — vlastní
			// activationSpec modulu (fallback pro moduly bez ní) i nastavení
			// "Vypisovat data modulu" — je jedno společné rozhodnutí sdílené s
			// postranním panelem, viz
			// BaseController.isModuleActive(). Kontext pro activationSpec (mj.
			// URL) si sestaví ze skutečně aktivní záložky, ne z URL popupu
			// samotného (viz buildActivationContext).
			const { active } = await this.isModuleActive( mod, settings, "popup", undefined, key );
			if ( !active ) continue;

			try {
				// Rám podle "Element výpisu dat" — stejný jako na ostatních
				// plochách, viz BaseController.mountModuleElement().
				const el = this.mountModuleElement( mod, settings, this.outputEl, null, key );

				const init = el.init;
				if ( init ) {
					await init.call( el, { outputEl: this.outputEl, name: mod.name, mode, location: "popup", instance } );
				}
			} catch ( err ) {
				console.error( `Chyba při inicializaci modulu ${ key }:`, err );
				const errEl = document.createElement( "div" );
				errEl.className = "error";
				errEl.textContent = t( "popup_module_error", key );
				this.outputEl.appendChild( errEl );
			}
		}
	}

	/** @type {Classes.PopupController['bootstrap']} */
	async bootstrap ()
	{
		await initPageI18n();
		await this.loadAndRegisterModules();
		await this.initModules();
	}
}

const controller = new PopupController();
controller.bootstrap();
