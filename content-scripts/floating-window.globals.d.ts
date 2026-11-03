/**
 * @file floating-window.globals.d.ts
 * @description Global TypeScript declarations for content-scripts/floating-window.js — the content script that inserts
 * a floating window (createFloatingWindow() from base.mjs) with floating.html in an <iframe> into the page.
 */

declare global {

	interface Window {

		/** A safeguard against running twice (dynamic registration and direct injection on the same page) */
		__extensionFloatingWindowInjected?: boolean;

	}

	namespace Functions {

		namespace FloatingWindowContentScript {

			/** The current position/size of the window (read from the live element) + open/closed */
			type currentState = ( open: boolean ) => Types.FloatingWindowState;

			/** Creates the window with the floating.html <iframe> according to the saved state and inserts it into the page */
			type buildWindow = ( saved: Types.FloatingWindowState | null | undefined ) => void;

			/** Opens the window (unless opening is already in progress); preloadedState saves a second storage read */
			type openFloatingWindow = ( preloadedState?: Types.FloatingWindowState | null ) => Promise<Types.FloatingWindowElement | null | undefined>;

			/** Closes the window if it is open */
			type closeFloatingWindow = () => void;

			/** Opens or closes the window according to the current state */
			type toggleFloatingWindow = () => void;

		}

	}

}

export { };
