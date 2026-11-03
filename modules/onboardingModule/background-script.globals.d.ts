/**
 * @file modules/onboardingModule/background-script.globals.d.ts
 * @description Global TypeScript declarations for modules/onboardingModule/background-script.mjs — the background part
 * of the module: after the extension is installed it opens the welcome page in a new tab.
 */

declare global {

	namespace Functions {

		namespace OnboardingModule {

			namespace BackgroundScript {

				/** After a fresh install opens the welcome page — only in the "After the extension is installed" activation mode and not in a standalone extension next to the full one */
				type openAfterInstall = ( details: chrome.runtime.InstalledDetails ) => Promise<void>;

			}

		}

	}

}

export { };
