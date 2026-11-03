/**
 * @file popup.globals.d.ts
 * @description Global TypeScript declarations for popup.mjs — the popup controller (popup.html).
 */

declare global {

	namespace Classes {

		/** Popup controller — loads the modules from the list and renders those that belong in the popup. */
		class PopupController extends BaseController {

			/** Container for the module elements and notices (#modules-output in popup.html) */
			outputEl: HTMLElement;

			/** Module list (modules.json entries) loaded in loadAndRegisterModules() */
			_paths: unknown[];

			constructor ();

			/** Imports the module files from the list (except those turned off by the user and misplaced ones) */
			loadAndRegisterModules(): Promise<void>;

			/** Renders the registered modules that should be active in the popup */
			initModules(): Promise<void>;

			/** Loads and renders the modules */
			bootstrap(): Promise<void>;

		}

	}

}

export { };
