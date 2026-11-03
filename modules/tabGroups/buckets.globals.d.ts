/**
 * @file modules/tabGroups/buckets.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/buckets.mjs — periods of the automatic tab
 * groups, group colors, group settings and calculations over local calendar days.
 */

declare global {

	namespace Types {

		namespace TabGroups {

			/** A tab group color (tabGroups.Color — the same set in Chrome and Firefox). */
			type GroupColor = `${ chrome.tabGroups.Color }`;

			/** A group color with a label for the select in Settings. */
			type ColorOption = { value: GroupColor; label: string };

			/** The period of an automatic group (order in BUCKETS: from the newest to the oldest). */
			type Bucket = {

				/** The period key in the stored settings */
				key: string;

				/** The default group name */
				title: string;

				/** The default group color */
				color: GroupColor;

				/** Description of the period ("earlier this week (since Monday)") */
				range: string;

			};

			/** Name, color and "collapsed group" of one period. */
			type GroupConfig = {
				title: string;
				color: GroupColor;

				/** "collapsed group" — a new group is created collapsed */
				collapsed: boolean;
			};

			/** Stored group settings: period key → name, color and "collapsed group". */
			type StoredGroupsConfig = Record<string, GroupConfig>;

			/** Which day decides the period a tab belongs to: the day it was opened, or the day of last use. */
			type GroupBy = 'opened' | 'lastUsed';

			/** Days [start, end) of one period; start >= end = the period is empty. */
			type BucketWindow = { start: number; end: number };

			/** Year, month (0–11) and day of the week (0 = Monday) of one day. */
			type DayParts = { year: number; month: number; weekday: number };

			/** Vstup estimateOpenedDay(). */
			type EstimateInput = {

				/** The period of the group the tab is in (index in BUCKETS), otherwise -1 */
				bucket: number;

				/** The day the periods of the groups in the browser apply to (the last assignment), otherwise null */
				referenceDay: number | null;

				/** The day the tab was last active */
				accessedDay: number;
				today: number;

			};

			/** Vstup estimateUsedDay(). */
			type UsedDayInput = {

				/** The remembered day of last use, or null (a tab the module does not know) */
				knownDay: number | null;

				/** The opened day (remembered or estimated) */
				openedDay: number;

				/** The day of last activity according to the browser, or null (the browser did not reveal it) */
				accessedDay: number | null;

				/** The window's active tab — in use right now */
				active: boolean;

				/** The period of the group the tab is in (index in BUCKETS), otherwise -1 */
				bucket: number;

				/** The day the periods of the groups in the browser apply to (the last assignment), otherwise null */
				referenceDay: number | null;
				today: number;

			};

		}

	}

	namespace Functions {

		namespace TabGroups {

			namespace Buckets {

				/** Default period names in the given language (BUCKETS order) */
				type defaultTitlesIn = ( language: Enums.UiLanguage ) => Promise<string[]>;

				/** Is the value a tab group color? */
				type isGroupColor = ( value: unknown ) => value is Types.TabGroups.GroupColor;

				/** Stored settings → name, color and "collapsed group" of each period (without empty and repeated names) */
				type normalizeGroupsConfig = ( value: unknown ) => Types.TabGroups.GroupConfig[];

				/** An array in BUCKETS order → the stored form by period keys */
				type toStoredGroupsConfig = ( config: Types.TabGroups.GroupConfig[] ) => Types.TabGroups.StoredGroupsConfig;

				/** The stored group name prefix → a valid value (without spaces at the ends, a type other than text = the default) */
				type normalizeTitlePrefix = ( value: unknown ) => string;

				/** Group names with the prefix (an empty prefix = unchanged) — as the groups have them in the browser */
				type withTitlePrefix = <T extends { title: string }>( items: T[], prefix: string ) => T[];

				/** The stored sorting choice → a valid value (unknown = by opening) */
				type normalizeGroupBy = ( value: unknown ) => Types.TabGroups.GroupBy;

				/** The local calendar day of the time ms as an integer */
				type localDay = ( ms: number ) => number;

				/** The nearest local midnight after the time ms (ms) */
				type nextLocalMidnight = ( ms: number ) => number;

				/** Is the value a real time (not a missing value, 0 or nonsense)? */
				type isRealisticTime = ( ms: unknown ) => ms is number;

				/** Year, month and day of the week of the day day */
				type dayParts = ( day: number ) => Types.TabGroups.DayParts;

				/** The first day of each period relative to the day today, in BUCKETS order */
				type bucketBounds = ( today: number ) => number[];

				/** The period (index in BUCKETS) of a tab whose day (opened, or last used) is day */
				type classifyDay = ( day: number, today: number ) => number;

				/** Days that belong to the period bucket on the day today */
				type bucketWindow = ( bucket: number, today: number ) => Types.TabGroups.BucketWindow;

				/** The newest day of the period (the day of a tab dragged into its group), or null when the period is empty */
				type latestDayOfBucket = ( bucket: number, today: number ) => number | null;

				/** An estimate of the opened day of a tab the module does not know */
				type estimateOpenedDay = ( input: Types.TabGroups.EstimateInput ) => number;

				/** The day of the tab's last use (an active tab = today) */
				type estimateUsedDay = ( input: Types.TabGroups.UsedDayInput ) => number;

			}

		}

	}

}

export { };
