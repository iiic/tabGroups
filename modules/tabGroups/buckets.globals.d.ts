declare namespace Functions {
	namespace TabGroups {
		namespace Buckets {
			type defaultTitlesIn = ( language: Enums.UiLanguage ) => Promise<string[]>;
			type isGroupColor = ( value: unknown ) => value is Types.TabGroups.GroupColor;
			type normalizeGroupsConfig = ( value: unknown ) => Types.TabGroups.GroupConfig[];
			type toStoredGroupsConfig = ( config: Types.TabGroups.GroupConfig[] ) => Record<string, Types.TabGroups.GroupConfig>;
			type normalizeTitlePrefix = ( value: unknown ) => string;
			type withTitlePrefix = <T extends { title: string }>( items: T[], prefix: string ) => T[];
			type normalizeGroupBy = ( value: unknown ) => Types.TabGroups.GroupBy;
			type localDay = ( milliseconds: number ) => number;
			type nextLocalMidnight = ( milliseconds: number ) => number;
			type isRealisticTime = ( milliseconds: unknown ) => milliseconds is number;
			type dayParts = ( day: number ) => { year: number; month: number; weekday: number };
			type bucketBounds = ( today: number ) => number[];
			type classifyDay = ( day: number, today: number ) => number;
			type bucketWindow = ( bucket: number, today: number ) => { start: number; end: number };
			type latestDayOfBucket = ( bucket: number, today: number ) => number | null;
			type estimateOpenedDay = ( input: {
				bucket: number;
				referenceDay: number | null;
				accessedDay: number;
				today: number;
			} ) => number;
			type estimateUsedDay = ( input: {
				knownDay: number | null;
				openedDay: number;
				accessedDay: number | null;
				active: boolean;
				bucket: number;
				referenceDay: number | null;
				today: number;
			} ) => number;
		}
	}
}
