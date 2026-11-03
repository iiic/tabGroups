//@ts-check
"use strict";

// modules/tabGroups/buckets.mjs
// Time periods of the automatic tab groups and calculations over calendar days —
// without DOM and without chrome.*, shared by the background part (background-script.mjs,
// planner.mjs), the settings editor (groupsEditor.mjs) and the element
// (tabGroups.mjs).
//
// A day is an integer: the ordinal of the local calendar day since 1 Jan 1970 (see
// localDay()). "Today", "yesterday", the week, month and year are then determined by plain
// comparison of numbers, regardless of daylight saving time and the time of day.

import { t, tIn } from "../../sdk.mjs";

/** Length of a day in ms — only for converting a calendar date to a day number and back. */
const DAY_MS = 24 * 60 * 60 * 1000;

// Earlier times (including 0, which the browser could return instead of a missing value)
// are not a real time of tab activity.
const EARLIEST_REALISTIC_TIME = Date.UTC( 2000, 0, 1 );

// Tab group colors — the same set in Chrome and Firefox (tabGroups.Color),
// labels as in the browser menu. The color preview is in tabGroups.css (classes
// tab-groups-color--<color>).
/** @type {Types.TabGroups.ColorOption[]} */
export const GROUP_COLORS = [
	{ value: "grey", get label () { return t( "tabGroups_color_grey" ); } },
	{ value: "blue", get label () { return t( "tabGroups_color_blue" ); } },
	{ value: "red", get label () { return t( "tabGroups_color_red" ); } },
	{ value: "yellow", get label () { return t( "tabGroups_color_yellow" ); } },
	{ value: "green", get label () { return t( "tabGroups_color_green" ); } },
	{ value: "pink", get label () { return t( "tabGroups_color_pink" ); } },
	{ value: "purple", get label () { return t( "tabGroups_color_purple" ); } },
	{ value: "cyan", get label () { return t( "tabGroups_color_cyan" ); } },
	{ value: "orange", get label () { return t( "tabGroups_color_orange" ); } },
];

// Periods from the newest to the oldest — in this order a tab is assigned
// (classifyDay()) and the groups stand in the tab strip from right to left. title and color
// are the default name and color of the group (they can be changed in Settings), range a description of
// the period for the settings editor and the hint in the element. The default colors go around
// the color wheel from green (the newest) to grey (the oldest), each one different.
/** @type {Types.TabGroups.Bucket[]} */
export const BUCKETS = [
	{
		key: "today",
		color: "green",
		get title ()
		{
			return t( "tabGroups_bucket_today_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_today_range" );
		},
	},
	{
		key: "yesterday",
		color: "cyan",
		get title ()
		{
			return t( "tabGroups_bucket_yesterday_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_yesterday_range" );
		},
	},
	{
		key: "dayBeforeYesterday",
		color: "blue",
		get title ()
		{
			return t( "tabGroups_bucket_day_before_yesterday_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_day_before_yesterday_range" );
		},
	},
	{
		key: "thisWeek",
		color: "purple",
		get title ()
		{
			return t( "tabGroups_bucket_this_week_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_this_week_range" );
		},
	},
	{
		key: "lastWeek",
		color: "pink",
		get title ()
		{
			return t( "tabGroups_bucket_last_week_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_last_week_range" );
		},
	},
	{
		key: "thisMonth",
		color: "red",
		get title ()
		{
			return t( "tabGroups_bucket_this_month_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_this_month_range" );
		},
	},
	{
		key: "lastMonth",
		color: "orange",
		get title ()
		{
			return t( "tabGroups_bucket_last_month_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_last_month_range" );
		},
	},
	{
		key: "thisYear",
		color: "yellow",
		get title ()
		{
			return t( "tabGroups_bucket_this_year_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_this_year_range" );
		},
	},
	{
		key: "lastYear",
		color: "grey",
		get title ()
		{
			return t( "tabGroups_bucket_last_year_title" );
		},
		get range ()
		{
			return t( "tabGroups_bucket_last_year_range" );
		},
	},
];

// Default period names in the language language, not in the UI language (BUCKETS
// order) — groups in the browser may have names from the language the UI
// had earlier (groupIdentity.mjs). The text key is derived from the period key:
// "dayBeforeYesterday" → "tabGroups_bucket_day_before_yesterday_title".
/** @type {Functions.TabGroups.Buckets.defaultTitlesIn} */
export function defaultTitlesIn ( language )
{
	return Promise.all(
		BUCKETS.map( ( bucket ) => tIn( language, `tabGroups_bucket_${ bucket.key.replace( /[A-Z]/g, ( letter ) => `_${ letter.toLowerCase() }` ) }_title` ) )
	);
}

/** @type {Functions.TabGroups.Buckets.isGroupColor} */
export function isGroupColor ( value )
{
	return GROUP_COLORS.some( ( color ) => color.value === value );
}

// Stored group settings ({ [period key]: { title, color, collapsed } }) →
// an array in BUCKETS order, always usable: an empty or missing name →
// the default, an unknown color → the default, "collapsed group" only when true (older
// settings do not have it). Names must not repeat — the module recognizes its groups in the
// browser by name —, so a repeated name gets the period's default name
// (and when that one is taken too, a sequence number).
/** @type {Functions.TabGroups.Buckets.normalizeGroupsConfig} */
export function normalizeGroupsConfig ( value )
{
	const stored = /** @type {Record<string, unknown>} */ ( value && typeof value === "object" && !Array.isArray( value ) ? value : {} );
	/** @type {Set<string>} */
	const used = new Set();
	return BUCKETS.map( ( bucket ) =>
	{
		const item = /** @type {{ title?: unknown, color?: unknown, collapsed?: unknown } | null | undefined} */ ( stored[ bucket.key ] );
		const wanted = item && typeof item.title === "string" ? item.title.trim() : "";
		let title = wanted && !used.has( wanted ) ? wanted : bucket.title;
		for ( let n = 2; used.has( title ); n++ ) {
			title = `${ bucket.title } (${ n })`;
		}
		used.add( title );
		return {
			title,
			color: item && isGroupColor( item.color ) ? item.color : bucket.color,
			collapsed: Boolean( item && item.collapsed === true ),
		};
	} );
}

// An array in BUCKETS order → the form in which the settings are stored (by period
// key, not by order — adding a period thus does not mess up old settings).
/** @type {Functions.TabGroups.Buckets.toStoredGroupsConfig} */
export function toStoredGroupsConfig ( config )
{
	return Object.fromEntries( BUCKETS.map( ( bucket, i ) => [ bucket.key, { title: config[ i ].title, color: config[ i ].color, collapsed: config[ i ].collapsed } ] ) );
}

// Default group settings (settingsSchema, api.settings.get()).
export const DEFAULT_GROUPS = toStoredGroupsConfig( BUCKETS.map( ( bucket ) => ( { title: "", color: bucket.color, collapsed: false } ) ) );

// The prefix of the names of all automatic groups — periods and groups from bookmarks
// (the TITLE_PREFIX_KEY setting in module.mjs). Empty = without a prefix.
export const DEFAULT_TITLE_PREFIX = "ⓐ";

// The stored prefix → a valid value: without spaces at the ends, anything other than
// text = the default. An empty text (the user deleted the prefix) stays empty.
/** @type {Functions.TabGroups.Buckets.normalizeTitlePrefix} */
export function normalizeTitlePrefix ( value )
{
	return typeof value === "string" ? value.trim() : DEFAULT_TITLE_PREFIX;
}

// Group names with the prefix separated by a space — as the groups have them
// in the browser. The same prefix for all preserves that the names do not repeat
// (normalizeGroupsConfig(), resolveBookmarkGroups() check them without it).
/** @type {Functions.TabGroups.Buckets.withTitlePrefix} */
export function withTitlePrefix ( items, prefix )
{
	return prefix ? items.map( ( item ) => ( { ...item, title: `${ prefix } ${ item.title }` } ) ) : items;
}

// Which day decides the period a tab belongs to (the GROUP_BY_KEY setting in
// module.mjs): the day it was opened — the tab stays in that day's group and only
// midnight moves it —, or the day of last use — a tab the user
// switches to moves into "today" (estimateUsedDay()).
/** @type {Types.TabGroups.GroupBy} */
export const GROUP_BY_OPENED = "opened";
/** @type {Types.TabGroups.GroupBy} */
export const GROUP_BY_LAST_USED = "lastUsed";
/** @type {Types.TabGroups.GroupBy} */
export const DEFAULT_GROUP_BY = GROUP_BY_OPENED;

// The stored choice → a valid value; anything unknown = by opening.
/** @type {Functions.TabGroups.Buckets.normalizeGroupBy} */
export function normalizeGroupBy ( value )
{
	return value === GROUP_BY_LAST_USED ? GROUP_BY_LAST_USED : GROUP_BY_OPENED;
}

// The local calendar day of the time ms as a day number (see the introductory comment).
/** @type {Functions.TabGroups.Buckets.localDay} */
export function localDay ( ms )
{
	const date = new Date( ms );
	return Date.UTC( date.getFullYear(), date.getMonth(), date.getDate() ) / DAY_MS;
}

// The nearest local midnight after the time ms (in ms) — new Date(year, month, day + 1)
// calculates in local time, so it is right even on the day of the daylight saving time change.
/** @type {Functions.TabGroups.Buckets.nextLocalMidnight} */
export function nextLocalMidnight ( ms )
{
	const date = new Date( ms );
	return new Date( date.getFullYear(), date.getMonth(), date.getDate() + 1 ).getTime();
}

// Is ms a real time (not a missing value, 0 or nonsense)?
/** @type {Functions.TabGroups.Buckets.isRealisticTime} */
export function isRealisticTime ( ms )
{
	return typeof ms === "number" && Number.isFinite( ms ) && ms >= EARLIEST_REALISTIC_TIME;
}

// Year, month (0–11) and day of the week (0 = Monday) of the day day.
/** @type {Functions.TabGroups.Buckets.dayParts} */
function dayParts ( day )
{
	const date = new Date( day * DAY_MS );
	return { year: date.getUTCFullYear(), month: date.getUTCMonth(), weekday: ( date.getUTCDay() + 6 ) % 7 };
}

// The first day of each period relative to the day today, in BUCKETS order. A tab belongs to the
// FIRST period whose first day it does not precede (classifyDay()) — a tab from
// yesterday, which was also in last week (today is Monday), thus belongs
// to "yesterday", not to "last week". The week starts on Monday. The last period
// has no first day — it takes everything older.
/** @type {Functions.TabGroups.Buckets.bucketBounds} */
export function bucketBounds ( today )
{
	const { year, month, weekday } = dayParts( today );
	const weekStart = today - weekday;
	return [
		today,
		today - 1,
		today - 2,
		weekStart,
		weekStart - 7,
		Date.UTC( year, month, 1 ) / DAY_MS,
		// Date.UTC() converts month -1 to December of the previous year by itself.
		Date.UTC( year, month - 1, 1 ) / DAY_MS,
		Date.UTC( year, 0, 1 ) / DAY_MS,
		Number.NEGATIVE_INFINITY,
	];
}

// Which period (index in BUCKETS) a tab belongs to whose day (opened, or
// last used) is day, when today is today. A tab "from the future"
// (a clock moved back) belongs to today's.
/** @type {Functions.TabGroups.Buckets.classifyDay} */
export function classifyDay ( day, today )
{
	const index = bucketBounds( today ).findIndex( ( bound ) => day >= bound );
	return index === -1 ? 0 : index;
}

// Days that classifyDay() assigns to the period bucket on the day today: [start, end),
// end is the first day that already belongs to some newer period. start >= end
// means the period is empty that day (on Monday for example "earlier this week").
/** @type {Functions.TabGroups.Buckets.bucketWindow} */
export function bucketWindow ( bucket, today )
{
	const bounds = bucketBounds( today );
	return { start: bounds[ bucket ], end: Math.min( Number.POSITIVE_INFINITY, ...bounds.slice( 0, bucket ) ) };
}

// The newest day that classifyDay() assigns to the period bucket on the day today —
// it is given to a tab the user dragged into the period's group (the
// MANUAL_MOVES_KEY option in module.mjs): it thus stays in the group as long as possible and at
// midnight moves on like the other tabs. null when the period is empty
// that day.
/** @type {Functions.TabGroups.Buckets.latestDayOfBucket} */
export function latestDayOfBucket ( bucket, today )
{
	const { start, end } = bucketWindow( bucket, today );
	return start < end ? Math.min( end - 1, today ) : null;
}

// An estimate of the opened day of a tab the module does not know — it was opened before it
// started working, or it was restored from the previous session (after a browser restart
// tabs get new numbers and the module loses their days). The browser reveals
// only when the tab was last active (accessedDay): it cannot have been opened
// later, so that is taken as the latest possible day. A tab in an automatic
// group additionally carries the period the module put it into on the day referenceDay —
// the estimate is limited to its range, and to referenceDay at the latest (the "today" group
// as of that day contains tabs from exactly that day, even if they were active later). For
// "today", "yesterday" and "2 days ago" the day after restoring a session is thus exact, and even with
// longer periods the tab does not jump anywhere other than where it belonged.
/** @type {Functions.TabGroups.Buckets.estimateOpenedDay} */
export function estimateOpenedDay ( { bucket, referenceDay, accessedDay, today } )
{
	const latest = Math.min( accessedDay, today );
	if ( bucket < 0 || referenceDay === null ) {
		return latest;
	}
	const { start, end } = bucketWindow( bucket, referenceDay );
	if ( !( start < end ) ) {
		return latest;
	}
	return Math.min( Math.max( latest, start ), end - 1, referenceDay, today );
}

// The day of the tab's last use. The window's active tab (active) counts as
// in use right now — as long as the window shows it, it belongs to "today", even past midnight.
// Otherwise the latest day the module knows about: remembered from earlier passes
// (knownDay), the opened day (openedDay — opening is also a use) and the day of
// last activity according to the browser (accessedDay, null = the browser did not
// reveal it). Chrome reports as the last activity when the tab last
// appeared on the screen (leaving the tab does not change it), Firefox when the
// user left it — that is why the module remembers knownDay: a tab active past midnight
// would otherwise fall back into "yesterday" after switching elsewhere. A tab the module
// does not know (knownDay null — after a browser restart) additionally carries the period of its
// automatic group as of the day referenceDay: it was used (or
// opened) in that period, so on its first day at the earliest.
/** @type {Functions.TabGroups.Buckets.estimateUsedDay} */
export function estimateUsedDay ( { knownDay, openedDay, accessedDay, active, bucket, referenceDay, today } )
{
	if ( active ) {
		return today;
	}
	let day = Math.max( openedDay, knownDay ?? Number.NEGATIVE_INFINITY, accessedDay ?? Number.NEGATIVE_INFINITY );
	if ( knownDay === null && bucket >= 0 && referenceDay !== null ) {
		const { start, end } = bucketWindow( bucket, referenceDay );
		if ( start < end ) {
			day = Math.max( day, start );
		}
	}
	return Math.min( day, today );
}
