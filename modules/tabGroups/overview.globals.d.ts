/**
 * @file modules/tabGroups/overview.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/overview.mjs — the overview of the automatic groups of a
 * window for tabGroupsSandbox (the service tabGroups.getOverview of the background part) and watching its tab and group events.
 */

declare global {

	namespace Types {

		namespace TabGroups {

			/** A chip of an automatic group in the overview. */
			type OverviewChip = {
				title: string;
				color: GroupColor;

				/** The number of tabs in the group */
				count: number;

				/** The position of the group's first tab (sorting as in the strip) */
				first: number;

				/** A period, or a group from bookmarks */
				kind: 'period' | 'bookmarks';

				/** A description of the period or the group from bookmarks ("from bookmarks in the "Work" folder") */
				range: string;
			};

			/** Groups of the current window. */
			type WindowGroups = {
				chips: OverviewChip[];

				/** The number of the user's groups */
				userGroups: number;

				/** Unpinned tabs without a group (not yet assigned) */
				ungrouped: number;
			};

			/** What the overview lists (readOverview()). */
			type Overview = {

				/** The browser lets extensions manage tab groups (chrome.tabs.group) */
				supported: boolean;
				hasGroups: boolean;

				/** "alarms" is granted, or the manifest does not offer it as optional (Firefox has it required) */
				hasAlarms: boolean;

				/** The permissions of groups from bookmarks are granted, or no group from bookmarks is used */
				hasBookmarks: boolean;

				/** Sorting tabs according to the settings (the day opened, or the day of last use) */
				groupBy: GroupBy;

				/** The number of used groups from bookmarks (rows with a folder) */
				bookmarkGroups: number;

				/** Groups of the current window, or null (without the permission, the window cannot be determined) */
				groups: WindowGroups | null;
			};

		}

	}

	namespace Functions {

		namespace TabGroups {

			namespace Overview {

				/** The overview of the window (null — unknown: no chips) with the state of the module (permissions, sorting) */
				type readOverview = ( api: Types.ModuleApi, windowId: number | null ) => Promise<Types.TabGroups.Overview>;

				/** Groups of the window, or null */
				type readWindowGroups = ( api: Types.ModuleApi, windowId: number, config: Types.TabGroups.GroupConfig[], bookmarkGroups: Types.TabGroups.BookmarkGroup[] ) => Promise<Types.TabGroups.WindowGroups | null>;

				/** Watches the tab and group events that change the overview; returns a function to unsubscribe */
				type watchWindowGroups = ( onChange: () => void ) => () => void;

				/** A chrome.tabs.onUpdated listener (a tab's group changed or it was pinned) */
				type onTabUpdated = Parameters<typeof chrome.tabs.onUpdated.addListener>[0];

			}

		}

	}

}

export { };
