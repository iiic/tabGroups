/**
 * @file modules/tabGroups/background-script.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/background-script.mjs — the background part of the module:
 * sorting tabs into automatic groups in background.js (tab and group events, an alarm at midnight).
 */

declare global {

	namespace Types {

		namespace TabGroups {

			/** Tabs from all normal windows and all groups. */
			type Snapshot = { tabs: TabInfo[]; groups: GroupInfo[] };

			/** Group targets from Settings and what the module's groups are recognized by (readTargets()). */
			type TargetsSetup = {

				/** Name, color and "collapsed group" of the periods — names with the prefix */
				config: GroupConfig[];

				/** Used groups from bookmarks — names with the prefix */
				bookmarkGroups: BookmarkGroup[];

				/** Keys and names of the targets (describeTargets()) */
				targets: TargetDescription;

				/** The registry of the module's groups (GROUP_IDS_KEY) */
				groupIds: Record<string, GroupIdEntry>;

				/** The stored list of names, or null (not stored yet) */
				storedKnownTitles: [string, string][] | null;

				/** The list of names extended with the current names (the first time also with names from earlier) */
				knownTitles: [string, string][];
			};

			/** The result of applyPlan(): a description of the change attempts and new groups → target (index in the planner). */
			type AppliedPlan = { operations: string[]; created: Map<number, number> };

			/** Vstup initialKnownTitles(). */
			type InitialKnownTitlesInput = {

				/** Target keys (describeTargets()) */
				keys: string[];

				/** Period names from Settings without the prefix */
				periods: GroupConfig[];

				/** Groups from bookmarks with names without the prefix */
				bookmarkGroups: BookmarkGroup[];

				/** The prefix from Settings */
				prefix: string;

				/** Period group names from the last assignment by an older version */
				appliedTitles: string[];

				/** Names of groups from bookmarks from the last assignment by an older version: row id → name */
				appliedBookmarkTitles: Record<string, string>;
			};

		}

	}

	namespace Functions {

		namespace TabGroups {

			namespace BackgroundScript {

				/** The color a group alternates with its own when blinking (grey, for grey cyan) */
				type blinkColor = ( color: Types.TabGroups.GroupColor ) => Types.TabGroups.GroupColor;

				/** A stored day, or null */
				type readDay = ( value: unknown ) => number | null;

				/** Stored group names (as many as there are periods), otherwise an empty array */
				type readTitles = ( value: unknown ) => string[];

				/** Stored names of groups from bookmarks: row id → name (only non-empty strings) */
				type readBookmarkTitles = ( value: unknown ) => Record<string, string>;

				/** Stored records { tab id: number } — opened, used and manual days, tab groups (only integers) */
				type readDays = ( value: unknown ) => Record<string, number>;

				/** The list of group names the first time: names the module's groups may have from earlier */
				type initialKnownTitles = ( input: Types.TabGroups.InitialKnownTitlesInput ) => Promise<[string, string][]>;

				/** Do both records of tab days have the same content? */
				type sameDays = ( a: Record<string, number>, b: Record<string, number> ) => boolean;

				/** chrome.tabs.Tab → a tab for the planner */
				type toTabInfo = ( tab: chrome.tabs.Tab ) => Types.TabGroups.TabInfo;

				/** chrome.tabGroups.TabGroup → a group for the planner */
				type toGroupInfo = ( group: chrome.tabGroups.TabGroup ) => Types.TabGroups.GroupInfo;

				/** Tabs by window */
				type byWindow = ( tabs: Types.TabGroups.TabInfo[] ) => Map<number, Types.TabGroups.TabInfo[]>;

				/** One change in the browser; an error is only logged (false) */
				type attempt = ( label: string, change: () => Promise<unknown> ) => Promise<boolean>;

				/** Tabs into a group (or into a new group in the window), on an error one by one; the group id, or null */
				type groupTabs = ( tabIds: number[], groupId: number | undefined, windowId: number ) => Promise<number | null>;

				namespace groupTabs {

					/** chrome.tabs.group() for the ids tabs into the target group (without target into a new one) */
					type group = ( ids: number[], target: number | undefined ) => Promise<number>;

				}

				/** Carries out the window plan; returns a description of the change attempts (empty = nothing to change) and new groups */
				type applyPlan = ( windowId: number, plan: Types.TabGroups.WindowPlan ) => Promise<Types.TabGroups.AppliedPlan>;

				/** Tabs of normal windows and groups */
				type snapshot = () => Promise<Types.TabGroups.Snapshot>;

				/** An alarm for the nearest midnight (only with the "alarms" permission) */
				type scheduleMidnight = ( now: number ) => Promise<void>;

				/** A task after the previous tasks (passes and writes of opened days go one after another) */
				type enqueue = <T>( task: () => T | Promise<T> ) => Promise<T>;

				/** Schedules a pass with a delay (the default depends on the time since the extension started) */
				type schedule = ( delayMs?: number ) => void;

				/** A change of tabs or groups → a pass (unless paused by the safeguard against looping) */
				type onTabsChanged = () => void;

				/** A safeguard against looping: the same changes several times in a row → pause reacting to events */
				type noteRun = ( operations: string[] ) => void;

				/** Matching tab addresses against the bookmarks of groups from bookmarks (without the permission nothing belongs anywhere) */
				type bookmarkMatcher = ( bookmarkGroups: Types.TabGroups.BookmarkGroup[] ) => Promise<Types.TabGroups.BookmarkMatcher>;

				/** Discards the bookmark matching (a change of bookmarks or permissions) */
				type forgetBookmarks = () => void;

				/** Group targets from Settings, the group registry and the list of names */
				type readTargets = () => Promise<Types.TabGroups.TargetsSetup>;

				/** One pass: assigning tabs, the order of groups, saving the state, the alarm */
				type reconcile = () => Promise<Types.TabGroups.RegroupResult>;

				/** Blinking the groups the module manages (in all windows) */
				type identifyGroups = () => Promise<Types.TabGroups.IdentifyResult>;

				/** Listeners of chrome.tabGroups, chrome.bookmarks and chrome.alarms, as soon as the APIs are available */
				type attachOptionalListeners = () => void;

			}

		}

	}

}

export { };
