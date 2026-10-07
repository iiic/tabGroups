declare namespace Functions {
	namespace TabGroups {
		namespace GroupIdentity {
			type describeTargets = (
				config: Types.TabGroups.GroupConfig[],
				bookmarkGroups: Types.TabGroups.BookmarkGroupSetting[]
			) => { keys: string[]; titles: string[] };
			type findOurGroups = (
				groups: Types.TabGroups.GroupInfo[],
				input: {
					keys: string[];
					titles: string[];
					groupIds: Record<string, Types.TabGroups.GroupIdEntry>;
					knownTitles: Array<[string, string]>;
				}
			) => Map<number, string>;
			type toTargets = ( ours: Map<number, string>, keys: string[] ) => Map<number, number>;
			type rememberGroups = (
				groupIds: Record<string, Types.TabGroups.GroupIdEntry>,
				groups: Types.TabGroups.GroupInfo[],
				ours: Map<number, string>,
				today: number
			) => Record<string, Types.TabGroups.GroupIdEntry>;
			type readGroupIds = ( value: unknown ) => Record<string, Types.TabGroups.GroupIdEntry>;
			type sameGroupIds = (
				left: Record<string, Types.TabGroups.GroupIdEntry>,
				right: Record<string, Types.TabGroups.GroupIdEntry>
			) => boolean;
			type readKnownTitles = ( value: unknown ) => Array<[string, string]> | null;
			type rememberTitles = (
				knownTitles: Array<[string, string]>,
				entries: Array<[string, string]>
			) => Array<[string, string]>;
			type earlierTitles = ( input: {
				keys: string[];
				baseTitles: string[][];
				prefix: string;
				appliedTitles: string[];
				appliedBookmarkTitles: Record<string, string>;
			} ) => Array<[string, string]>;
		}
	}
}
