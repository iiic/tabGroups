/**
 * @file modules-background.globals.d.ts
 * @description Global TypeScript declarations for modules-background.mjs — the list of static imports of the module
 * background parts (modules/<name>/background-script.mjs) loaded by background.js. The file exports nothing.
 */

declare global {

	namespace Types {

		/** Namespace of modules-background.mjs — no exports, only imports of the module background parts. */
		type ModulesBackground = typeof import( './modules-background.mjs' );

	}

}

export { };
