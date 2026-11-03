/**
 * @file sandbox-modules/tabGroupsSandbox/module.globals.d.ts
 * @description Global TypeScript declarations for sandbox-modules/tabGroupsSandbox/module.mjs — the description of the package
 * of the overview of the tab groups without DOM: the dependency on tabGroups and the functions outside the sandbox it works with.
 */

declare global {

	namespace Types {

		namespace TabGroupsSandbox {

			/** The module.mjs namespace — checked against Types.ModuleDescriptor (the full module description). */
			type Descriptor = Types.Satisfies<Types.ModuleDescriptor, typeof import( './module.mjs' )>;

		}

	}

}

export { };
