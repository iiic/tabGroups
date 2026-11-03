/**
 * @file onboarding.globals.d.ts
 * @description Global TypeScript declarations for onboarding.mjs — the controller of the welcome page (onboarding.html),
 * which the onboardingModule module opens after the extension is installed.
 */

declare global {

	namespace Classes {

		/** Welcome page controller — renders modules with the "onboarding" output surface. */
		class OnboardingController extends BaseController {

			/** Container for the module elements (#modules-output in onboarding.html) */
			outputEl: HTMLElement;

			/** A hint where the welcome page is configured — only when no module is shown on it (#onboarding-empty) */
			emptyEl: HTMLElement;

			constructor ();

			/** Renders the elements of modules that have "On the welcome page" selected */
			initPage(): Promise<void>;

		}

	}

}

export { };
