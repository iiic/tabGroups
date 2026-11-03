/**
 * @file modules/tabGroups/module.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/module.mjs — the module description without DOM, permissions,
 * group settings, state keys and the names of the services of the background part.
 * Module: Sorts tabs outside your own groups into 9 automatic groups by when they were opened, or when they were
 * last used (an option in Settings).
 */

declare global {

	namespace Types {

		namespace TabGroups {

			/** The module.mjs namespace — checked against Types.ModuleDescriptor (the full module description). */
			type Descriptor = Types.Satisfies<Types.ModuleDescriptor, typeof import( './module.mjs' )>;

			/** Why regrouping did not happen: the module is disabled (or not in the module list), a permission is missing, an error. */
			type RegroupProblem = 'disabled' | 'unavailable' | 'error';

			/** The result of a background part pass (the service tabGroups.regroup). */
			type RegroupResult = {
				ok: boolean;

				/** The pass changed something (renamed, moved, created) */
				changed?: boolean;
				reason?: RegroupProblem;

				/** Text chyby (reason "error") */
				error?: string;
			};

			/** The result of blinking the module's groups (the service tabGroups.identify). */
			type IdentifyResult = {
				ok: boolean;

				/** How many groups blinked (in all windows) */
				count?: number;
				reason?: RegroupProblem;

				/** Text chyby (reason "error") */
				error?: string;
			};

		}
	}

}

export { };
