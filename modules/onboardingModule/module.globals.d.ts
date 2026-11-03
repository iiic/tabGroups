/**
 * @file modules/onboardingModule/module.globals.d.ts
 * @description Global TypeScript declarations for modules/onboardingModule/module.mjs — the module description without DOM.
 * Module: after the extension is installed, opens the welcome page (onboarding.html) in a new tab.
 */

declare global {

	namespace Types {

		namespace OnboardingModule {

			/** The module.mjs namespace — checked against Types.ModuleDescriptor (the full module description). */
			type Descriptor = Types.Satisfies<Types.ModuleDescriptor, typeof import( './module.mjs' )>;

		}

	}

}

export { };
