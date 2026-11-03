/**
 * @file floating.globals.d.ts
 * @description Global TypeScript declarations for floating.mjs — the controller of the floating window content (floating.html in an <iframe>).
 */

declare global {

	namespace Classes {

		/** Controller of the floating window content — renders modules with the "floating" output surface. */
		class FloatingController extends BaseController {

			/** Container for the module elements (#modules-output in floating.html) */
			outputEl: HTMLElement;

			constructor ();

			/** Renders the elements of modules that have "In the floating window" selected */
			initPage(): Promise<void>;

		}

	}

}

export { };
