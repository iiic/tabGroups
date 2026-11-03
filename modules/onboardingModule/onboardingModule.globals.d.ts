/**
 * @file modules/onboardingModule/onboardingModule.globals.d.ts
 * @description Global TypeScript declarations for modules/onboardingModule/onboardingModule.mjs — the module element:
 * does the welcome page open after installation? And a button that opens it right away.
 */

declare global {

	interface HTMLElementTagNameMap {
		'extension-onboarding-module': Classes.ExtensionOnboardingModule;
	}

	namespace Classes {

		/** The onboardingModule module element — the state of opening the welcome page after installation and a button for opening it. */
		class ExtensionOnboardingModule extends BaseElement {
			static override get observedAttributes(): string[];
			constructor ();
			override connectedCallback(): void;
			override disconnectedCallback(): void;
			override connectedMoveCallback(): void;
			override adoptedCallback(): void;
			override attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void;
			override init( options: Types.ModuleInitOptions ): Promise<void>;

			/** Lists the state (according to the activation mode) and the "Open the welcome page" button */
			_render(): void;

			/** Opens the welcome page in a new tab */
			_openOnboardingPage(): void;

		}

	}

}

export { };
