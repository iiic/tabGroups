/**
 * @file modules-registry.globals.d.ts
 * @description Global TypeScript declarations for modules-registry.mjs — the entry point of popup.html, which just
 * re-exports the whole base.mjs (and so makes sure it is loaded before popup.mjs).
 */

declare global {

	namespace Types {

		/** Namespace of the modules-registry.mjs module — identical to base.mjs (see Types.BaseModule). */
		type ModulesRegistry = typeof import( './modules-registry.mjs' );

	}

}

export { };
