declare namespace Functions {
	namespace TabGroups {
		namespace BackgroundScript {
			type blinkColor = ( color: Types.TabGroups.GroupColor ) => Types.TabGroups.GroupColor;
			type readDay = ( value: unknown ) => number | null;
			type readTitles = ( value: unknown ) => string[];
			type readBookmarkTitles = ( value: unknown ) => Record<string, string>;
			type readDays = ( value: unknown ) => Record<string, number>;
			type sameDays = ( left: Record<string, number>, right: Record<string, number> ) => boolean;
			type initialKnownTitles = ( input: {
				keys: string[];
				periods: Types.TabGroups.GroupConfig[];
				bookmarkGroups: Types.TabGroups.BookmarkGroupSetting[];
				prefix: string;
				appliedTitles: string[];
				appliedBookmarkTitles: Record<string, string>;
			} ) => Promise<Array<[string, string]>>;
			type toTabInfo = ( tab: chrome.tabs.Tab ) => Types.TabGroups.TabInfo;
			type toGroupInfo = ( group: chrome.tabGroups.TabGroup ) => Types.TabGroups.GroupInfo;
			type byWindow = ( tabs: Types.TabGroups.TabInfo[] ) => Map<number, Types.TabGroups.TabInfo[]>;
			type attempt = ( label: string, change: () => Promise<unknown> | unknown ) => Promise<boolean>;
			type groupTabs = ( tabIds: number[], groupId: number | undefined, windowId: number ) => Promise<number | null>;
			namespace groupTabs {
				type group = ( tabIds: number[], groupId: number | undefined ) => Promise<number>;
			}
			type applyPlan = ( windowId: number, plan: Types.TabGroups.WindowPlan ) => Promise<{
				operations: string[];
				created: Map<number, number>;
			}>;
			type snapshot = () => Promise<{ tabs: Types.TabGroups.TabInfo[]; groups: Types.TabGroups.GroupInfo[] }>;
			type scheduleMidnight = ( now: number ) => Promise<void>;
			type enqueue = <T>( task: () => T | Promise<T> ) => Promise<T>;
			type schedule = ( delayMs?: number ) => void;
			type onTabsChanged = () => void;
			type noteRun = ( operations: string[] ) => void;
			type bookmarkMatcher = ( groups: Types.TabGroups.BookmarkGroupSetting[] ) => Promise<Types.TabGroups.BookmarkMatcher>;
			type forgetBookmarks = () => void;
			type readTargets = () => Promise<{
				config: Types.TabGroups.GroupConfig[];
				bookmarkGroups: Types.TabGroups.BookmarkGroupSetting[];
				targets: { keys: string[]; titles: string[] };
				groupIds: Record<string, Types.TabGroups.GroupIdEntry>;
				storedKnownTitles: Array<[string, string]> | null;
				knownTitles: Array<[string, string]>;
			}>;
			type reconcile = () => Promise<Types.TabGroups.RegroupResult>;
			type identifyGroups = () => Promise<Types.TabGroups.IdentifyResult>;
			type attachOptionalListeners = () => void;
		}
	}
}
