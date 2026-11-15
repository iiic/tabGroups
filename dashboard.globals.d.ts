/**
 * @file dashboard.globals.d.ts
 * @description Global TypeScript declarations for dashboard.mjs — the dashboard controller (dashboard.html).
 */

declare global {

	namespace Classes {

		/** Dashboard controller — renders modules with the "dashboard" output surface in a whole tab, the same way as the side panel. */
		class DashboardController extends BaseController {

			/** Container for the module elements (#modules-output in dashboard.html) */
			outputEl: HTMLElement;

			/** The hint shown when no module is sent to the dashboard (#dashboard-empty) */
			emptyEl: HTMLElement;

			constructor ();

			/** The tab the user came from (the dashboard is the active tab itself) — for the rules of the modules */
			override queryPageTab(): Promise<chrome.tabs.Tab | null>;

			/** Renders the elements of modules that have "Dashboard" selected (with "Filter by name" above them), the hint without any */
			initPage(): Promise<void>;

		}

	}

}

export { };
