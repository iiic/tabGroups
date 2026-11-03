//@ts-check
"use strict";

// popup.mjs
import {
	BaseController,
	getModuleMode,
	isSandboxModuleEntry,
	loadFrameStates,
	loadSandboxModules,
	loadSidebarDisabled,
	parseModuleEntry,
	resolveModuleEntries,
	validateModuleFileExtension,
	DISABLED_SPEC,
	getModuleFolder,
} from "./base.mjs";
import { measurePerf } from "./perf.mjs";
import { t, initPageI18n, loadModuleI18n } from "./i18n.mjs";

/** @implements {Classes.PopupController} */
class PopupController extends BaseController
{
	constructor ()
	{
		super();
		this.outputEl = /** @type {Classes.PopupController['outputEl']} */ ( document.getElementById( "modules-output" ) );
		// Module list loaded in loadAndRegisterModules() — initModules() uses it to
		// determine the output order (including the individual module instances).
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

		// Instances of one module (see parseModuleEntry() in base.mjs) share
		// a file that is imported only once — and without the instance id, otherwise
		// it would be a new module and the second customElements.define() would fail.
		/** @type {Set<string>} */
		const imported = new Set();

		// The texts of the modules that get imported (modules/<module>/_locales, see i18n.mjs) — before the import,
		// module.mjs composes its description with t() right when it is evaluated. All at once, not module by module.
		await loadModuleI18n( ...paths.flatMap( ( entry ) => {
			if ( typeof entry !== "string" || isSandboxModuleEntry( entry ) ) return [];
			const folder = getModuleFolder( entry );
			const mode = /** @type {Enums.ActivationMode | undefined} */ ( settings[ parseModuleEntry( entry ).key ] );
			return folder === null || DISABLED_SPEC.isSatisfiedBy( { mode } ) ? [] : [ folder ];
		} ) );

		for ( const entry of paths ) {
			if ( typeof entry !== "string" ) continue;
			const { path, name, key } = parseModuleEntry( entry );
			if ( imported.has( path ) ) continue;

			// Without the import the module is known only by its path — so the default
			// value declared by the module (defaultActivationMode) is not known yet.
			// A module explicitly turned off by the user can be recognized already, though,
			// and there is no point in importing it at all; one turned off only by the
			// default value declared by the module is filtered out later by initModules().
			// A turned-off module shows nothing — not even a note that it is turned off.
			// Its activation mode (or nothing) is stored under the bare module name
			// (for an instance under "<module>#<id>"). A turned-off instance does not
			// prevent importing the module for another, enabled instance.
			if ( DISABLED_SPEC.isSatisfiedBy( { mode: /** @type {Enums.ActivationMode | undefined} */ ( settings[ key ] ) } ) ) {
				continue;
			}
			imported.add( path );

			// An uploaded module (sandbox) has no file in the package — the core registers it
			// from storage without running its code (see loadSandboxModules() in base.mjs).
			if ( isSandboxModuleEntry( path ) ) {
				await loadSandboxModules( [ path ] );
				continue;
			}

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
			// The load time goes into the module's load measurement (see perf.mjs).
			try {
				await measurePerf( name, "import", () => import( chrome.runtime.getURL( path ) ) );
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

		// Module behavior for the whole page (pageInit) — the same as
		// renderModulesFor() on the other surfaces, see
		// BaseController.runPageInits().
		this.runPageInits( settings, "popup" );

		// An extension that offers its modules and waits for the user's decision — its modules work twice until then.
		this.mountPendingServiceNotice( this.outputEl, "popup" );

		// Load the saved state of collapsible frames up front, so each frame starts in
		// the state the user chose (see mountModuleElement() in base.mjs).
		await loadFrameStates();
		// "Do not use the sidebar" for the sidebar.toggle button of a module (mainButtonsSandbox).
		await loadSidebarDisabled();

		// In the order of the module list; for a module with multiple instances, each
		// instance in its own place (see resolveModuleEntries() in base.mjs).
		for ( const { mod, key, instance } of resolveModuleEntries( this._paths ) ) {
			const mode = getModuleMode( settings, key, mod.defaultActivationMode );

			// A quick skip without asking for the active tab — isModuleActive() would
			// reject a turned-off module even without it (same as renderModulesFor()).
			if ( DISABLED_SPEC.isSatisfiedBy( { mode } ) ) continue;

			// A module is shown only where the "Show module output" setting sends it,
			// in any enabled mode (even "background"/"focus") — the popup shows nothing
			// about modules that do not belong in it.
			// Whether the module should really be rendered in the popup — the module's
			// own activationSpec (with a fallback for modules without one) and the
			// "Show module output" setting — is one common decision shared with
			// the side panel and the floating window, see
			// BaseController.isModuleActive(). It builds the context for activationSpec
			// (including the URL) from the really active tab, not from the URL of the popup
			// itself (see buildActivationContext).
			const { active, delegated } = await this.isModuleActive( mod, settings, "popup", undefined, key );
			if ( !active ) {
				// A module the service provider of this extension shows instead — a note in its place.
				if ( delegated ) this.mountDelegatedNote( mod, delegated, this.outputEl );
				continue;
			}

			try {
				// Frame according to "Output element" — the same as on the other
				// surfaces, see BaseController.mountModuleElement().
				// Creating the element and init() go into the module's load measurement (see
				// perf.mjs), the same as in BaseController._updateModuleSlot().
				const el = measurePerf( mod.name, "mount", () => this.mountModuleElement( mod, settings, this.outputEl, null, key ) );

				const init = el.init;
				if ( init ) {
					await measurePerf( mod.name, "init", () => init.call( el, { outputEl: this.outputEl, name: mod.name, mode, location: "popup", instance } ) );
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
