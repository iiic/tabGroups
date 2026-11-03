/**
 * @file modules/tabGroups/planner.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/planner.mjs — planning tab group changes
 * in one window (pure functions without chrome.*).
 */

declare global {

	namespace Types {

		namespace TabGroups {

			/** A tab as the planner needs it (from chrome.tabs.Tab). */
			type TabInfo = {
				id: number;
				windowId: number;

				/** The position in the window's tab strip */
				index: number;
				pinned: boolean;

				/** The window's active tab (the one the window shows) — counts as in use */
				active: boolean;

				/** The tab's group, or TAB_GROUP_ID_NONE */
				groupId: number;

				/** When the tab was last active (ms) */
				lastAccessed?: number;

				/** A hidden tab (Firefox only, tabs.hide()) */
				hidden?: boolean;

				/** The tab's address (without the "tabs" permission the browser does not reveal it) */
				url?: string;
			};

			/** A group as the planner needs it (from chrome.tabGroups.TabGroup). */
			type GroupInfo = {
				id: number;
				windowId: number;
				title?: string;
				color: GroupColor;

				/** A shared group (Chrome) — always a user's group */
				shared?: boolean;
			};

			/** Vstup planWindow() — karty a skupiny jednoho okna. */
			type WindowPlanInput = {
				tabs: TabInfo[];
				groups: GroupInfo[];

				/** Name, color and "collapsed group" of each period (normalizeGroupsConfig()) */
				config: GroupConfig[];

				/** Groups from bookmarks (resolveBookmarkGroups()) — targets from BUCKETS.length */
				bookmarkGroups: BookmarkGroup[];

				/** The registry of the module's groups: group id → record (groupIdentity.mjs) */
				groupIds: Record<string, GroupIdEntry>;

				/** All names the module gave to groups: [name, target key] (groupIdentity.mjs) */
				knownTitles: [string, string][];

				/** Remembered opened days of tabs: tab id → day */
				openedDays: Record<string, number>;

				/** Remembered days of last use of tabs: tab id → day */
				usedDays: Record<string, number>;

				/** The day of the last assignment, or null */
				referenceDay: number | null;
				today: number;

				/** Time (ms) → local day (localDay()) */
				dayOf: ( ms: number ) => number;

				/** Which day decides the period a tab belongs to (normalizeGroupBy()) */
				groupBy: GroupBy;

				/** A tab address → the index of the group from bookmarks, or -1 (createBookmarkMatcher()) */
				bookmarkOf: BookmarkMatcher;

				/** May the user drag tabs between period groups (the MANUAL_MOVES_KEY option)? */
				manualMoves: boolean;

				/** Each tab's group after the previous pass: tab id → group id (only with manualMoves) */
				lastGroups: Record<string, number>;

				/** Manual days of tabs dragged by the user: tab id → day */
				manualDays: Record<string, number>;
			};

			/** Renaming/recoloring an existing group. */
			type GroupUpdate = { groupId: number; title?: string; color?: GroupColor };

			/** Tabs that are to move into an existing group. */
			type TabsIntoGroup = { groupId: number; tabIds: number[] };

			/** A new group for a target (a period, from BUCKETS.length a group from bookmarks) that has no group in the window. */
			type NewGroup = {
				bucket: number;
				title: string;
				color: GroupColor;

				/** Create it collapsed ("collapsed group" and the window's active tab is not in it) */
				collapsed: boolean;
				tabIds: number[];
			};

			/** The plan of changes of one window. */
			type WindowPlan = {

				/** Opened days of all managed tabs (remembered and estimated) */
				openedDays: Record<number, number>;

				/** Days of last use of all managed tabs (in both modes) */
				usedDays: Record<number, number>;

				/** Manual days of the window's tabs (empty without the dragging option) */
				manualDays: Record<number, number>;
				updates: GroupUpdate[];
				moves: TabsIntoGroup[];
				creates: NewGroup[];
			};

			/** A candidate for assigning a group to a target (a period or a group from bookmarks): how many of its tabs belong to it. */
			type GroupCandidate = {
				groupId: number;
				bucket: number;
				count: number;

				/** The group is this target's group (groupIdentity.mjs) */
				sameTarget: boolean;

				/** The position of the group's first tab */
				first: number;
			};

		}

	}

	namespace Functions {

		namespace TabGroups {

			namespace Planner {

				/** Group changes of one window: renames, tab moves, new groups */
				type planWindow = ( input: Types.TabGroups.WindowPlanInput ) => Types.TabGroups.WindowPlan;

				namespace planWindow {

					/** The period of the module group the tab is in, or -1 */
					type periodOf = ( tab: Types.TabGroups.TabInfo ) => number;

					/** Is the tab in a different group than after the previous pass (did the user move it)? */
					type movedByUser = ( tab: Types.TabGroups.TabInfo ) => boolean;

				}

				/** The target's position from left to right (groups from bookmarks, then periods from the oldest) */
				type targetRank = ( target: number, bookmarkCount: number ) => number;

				/** The module's groups that need to be moved one by one to the end of the window (empty = the order is right) */
				type planOrder = ( tabs: Types.TabGroups.TabInfo[], targetOfGroup: Map<number, number>, bookmarkCount: number ) => number[];

			}

		}

	}

}

export { };
