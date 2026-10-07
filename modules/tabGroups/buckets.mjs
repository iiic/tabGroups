//@ts-check
"use strict";

// modules/tabGroups/buckets.mjs
// Časová období automatických skupin karet a výpočty nad kalendářními dny —
// bez DOM a bez chrome.*, sdílené background částí (background-script.mjs,
// planner.mjs), editorem nastavení (groupsEditor.mjs) i elementem
// (tabGroups.mjs).
//
// Den je celé číslo: pořadí místního kalendářního dne od 1. 1. 1970 (viz
// localDay()). "Dnes", "včera", týden, měsíc i rok se pak určují prostým
// porovnáním čísel, bez ohledu na letní/zimní čas a denní dobu.

import { t, tIn } from "../../sdk.mjs";

/** Délka dne v ms — jen pro převod kalendářního data na číslo dne a zpět. */
const DAY_MS = 24 * 60 * 60 * 1000;

// Starší časy (i 0, kterou by prohlížeč mohl vrátit místo chybějící hodnoty)
// nejsou skutečný čas aktivity karty.
const EARLIEST_REALISTIC_TIME = Date.UTC( 2000, 0, 1 );

// Barvy skupin karet — stejná sada v Chrome i Firefoxu (tabGroups.Color),
// popisky jako v nabídce prohlížeče. Náhled barvy je v tabGroups.css (třídy
// tab-groups-color--<barva>).
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

// Období od nejnovějšího po nejstarší — v tomhle pořadí se karta zařazuje
// (classifyDay()) a skupiny stojí v liště karet zprava doleva. title a color
// jsou výchozí název a barva skupiny (v Nastavení jdou změnit), range popis
// období pro editor nastavení a nápovědu v elementu. Výchozí barvy jdou po
// barevném kruhu od zelené (nejnovější) po šedou (nejstarší), každá jiná.
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

// Výchozí názvy období v jazyce language, ne v jazyce rozhraní (pořadí
// BUCKETS) — skupiny v prohlížeči můžou mít názvy z jazyka, který rozhraní
// mělo dřív (groupIdentity.mjs). Klíč textu je z klíče období:
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

// Uložené nastavení skupin ({ [klíč období]: { title, color, collapsed } }) →
// pole v pořadí BUCKETS, vždy použitelné: prázdný nebo chybějící název →
// výchozí, neznámá barva → výchozí, „uzavřená skupina“ jen při true (starší
// nastavení ji nemá). Názvy se nesmí opakovat — modul své skupiny v
// prohlížeči pozná podle názvu —, opakovaný název proto dostane výchozí název
// období (a když je i ten obsazený, pořadové číslo).
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

// Pole v pořadí BUCKETS → tvar, ve kterém se nastavení ukládá (podle klíče
// období, ne podle pořadí — přidání období tak staré nastavení nerozhodí).
/** @type {Functions.TabGroups.Buckets.toStoredGroupsConfig} */
export function toStoredGroupsConfig ( config )
{
	return Object.fromEntries( BUCKETS.map( ( bucket, i ) => [ bucket.key, { title: config[ i ].title, color: config[ i ].color, collapsed: config[ i ].collapsed } ] ) );
}

// Výchozí nastavení skupin (settingsSchema, api.settings.get()).
export const DEFAULT_GROUPS = toStoredGroupsConfig( BUCKETS.map( ( bucket ) => ( { title: "", color: bucket.color, collapsed: false } ) ) );

// Předpona názvů všech automatických skupin — období i skupin ze záložek
// (nastavení TITLE_PREFIX_KEY v module.mjs). Prázdná = bez předpony.
export const DEFAULT_TITLE_PREFIX = "ⓐ";

// Uložená předpona → platná hodnota: bez mezer na krajích, cokoliv jiného než
// text = výchozí. Prázdný text (uživatel předponu smazal) zůstane prázdný.
/** @type {Functions.TabGroups.Buckets.normalizeTitlePrefix} */
export function normalizeTitlePrefix ( value )
{
	return typeof value === "string" ? value.trim() : DEFAULT_TITLE_PREFIX;
}

// Názvy skupin s předponou oddělenou mezerou — tak je skupiny mají
// v prohlížeči. Stejná předpona u všech zachová, že se názvy neopakují
// (normalizeGroupsConfig(), resolveBookmarkGroups() je hlídají bez ní).
/** @type {Functions.TabGroups.Buckets.withTitlePrefix} */
export function withTitlePrefix ( items, prefix )
{
	return prefix ? items.map( ( item ) => ( { ...item, title: `${ prefix } ${ item.title }` } ) ) : items;
}

// Podle kterého dne karta patří do období (nastavení GROUP_BY_KEY v
// module.mjs): dne otevření — karta zůstane ve skupině toho dne a posouvá ji
// jen půlnoc —, nebo dne posledního použití — karta, na kterou se uživatel
// přepne, se přesune do "dnes" (estimateUsedDay()).
/** @type {Types.TabGroups.GroupBy} */
export const GROUP_BY_OPENED = "opened";
/** @type {Types.TabGroups.GroupBy} */
export const GROUP_BY_LAST_USED = "lastUsed";
/** @type {Types.TabGroups.GroupBy} */
export const DEFAULT_GROUP_BY = GROUP_BY_OPENED;

// Uložená volba → platná hodnota; cokoliv neznámého = podle otevření.
/** @type {Functions.TabGroups.Buckets.normalizeGroupBy} */
export function normalizeGroupBy ( value )
{
	return value === GROUP_BY_LAST_USED ? GROUP_BY_LAST_USED : GROUP_BY_OPENED;
}

// Místní kalendářní den času ms jako číslo dne (viz úvodní komentář).
/** @type {Functions.TabGroups.Buckets.localDay} */
export function localDay ( ms )
{
	const date = new Date( ms );
	return Date.UTC( date.getFullYear(), date.getMonth(), date.getDate() ) / DAY_MS;
}

// Nejbližší místní půlnoc po čase ms (v ms) — new Date(rok, měsíc, den + 1)
// počítá v místním čase, takže sedí i v den přechodu na letní/zimní čas.
/** @type {Functions.TabGroups.Buckets.nextLocalMidnight} */
export function nextLocalMidnight ( ms )
{
	const date = new Date( ms );
	return new Date( date.getFullYear(), date.getMonth(), date.getDate() + 1 ).getTime();
}

// Je ms skutečný čas (ne chybějící hodnota, 0 nebo nesmysl)?
/** @type {Functions.TabGroups.Buckets.isRealisticTime} */
export function isRealisticTime ( ms )
{
	return typeof ms === "number" && Number.isFinite( ms ) && ms >= EARLIEST_REALISTIC_TIME;
}

// Rok, měsíc (0–11) a den v týdnu (0 = pondělí) dne day.
/** @type {Functions.TabGroups.Buckets.dayParts} */
function dayParts ( day )
{
	const date = new Date( day * DAY_MS );
	return { year: date.getUTCFullYear(), month: date.getUTCMonth(), weekday: ( date.getUTCDay() + 6 ) % 7 };
}

// První den každého období vůči dni today, v pořadí BUCKETS. Karta patří do
// PRVNÍHO období, jehož první den nepředchází (classifyDay()) — karta ze
// včerejška, který byl zároveň v minulém týdnu (dnes je pondělí), tak patří
// do "včera", ne do "v minulém týdnu". Týden začíná pondělím. Poslední období
// první den nemá — bere všechno starší.
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
		// Date.UTC() měsíc -1 sám převede na prosinec předchozího roku.
		Date.UTC( year, month - 1, 1 ) / DAY_MS,
		Date.UTC( year, 0, 1 ) / DAY_MS,
		Number.NEGATIVE_INFINITY,
	];
}

// Do kterého období (index v BUCKETS) patří karta, jejíž den (otevření, nebo
// posledního použití) je day, když je dnes today. Karta "z budoucnosti"
// (posunuté hodiny) patří do dnešní.
/** @type {Functions.TabGroups.Buckets.classifyDay} */
export function classifyDay ( day, today )
{
	const index = bucketBounds( today ).findIndex( ( bound ) => day >= bound );
	return index === -1 ? 0 : index;
}

// Dny, které classifyDay() v den today zařadí do období bucket: [start, end),
// end je první den, který už patří do některého novějšího období. start >= end
// znamená, že je období ten den prázdné (v pondělí třeba "dřív v tomto týdnu").
/** @type {Functions.TabGroups.Buckets.bucketWindow} */
export function bucketWindow ( bucket, today )
{
	const bounds = bucketBounds( today );
	return { start: bounds[ bucket ], end: Math.min( Number.POSITIVE_INFINITY, ...bounds.slice( 0, bucket ) ) };
}

// Nejnovější den, který classifyDay() v den today zařadí do období bucket —
// ten dostane karta, kterou uživatel přetáhl do skupiny období (volba
// MANUAL_MOVES_KEY v module.mjs): ve skupině tak zůstane co nejdéle a o
// půlnoci se posouvá dál jako ostatní karty. null, když je období ten den
// prázdné.
/** @type {Functions.TabGroups.Buckets.latestDayOfBucket} */
export function latestDayOfBucket ( bucket, today )
{
	const { start, end } = bucketWindow( bucket, today );
	return start < end ? Math.min( end - 1, today ) : null;
}

// Odhad dne otevření karty, kterou modul nezná — byla otevřená dřív, než
// začal pracovat, nebo je obnovená z minulé relace (po restartu prohlížeče
// dostanou karty nová čísla a modul o jejich dny přijde). Prohlížeč prozradí
// jen, kdy byla karta naposledy aktivní (accessedDay): otevřená být nemohla
// později, proto se bere jako nejpozdější možný den. Karta v automatické
// skupině navíc nese období, do kterého ji modul zařadil v den referenceDay —
// odhad se omezí na jeho rozsah, a nejpozději na referenceDay (skupina "dnes"
// k tomu dni obsahuje karty právě z něj, i když byly aktivní později). Pro
// "dnes", "včera" a "předevčírem" je tak den po obnovení relace přesný a ani u
// delších období karta nepřeskočí jinam, než kam patřila.
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

// Den posledního použití karty. Aktivní karta okna (active) se počítá jako
// používaná právě teď — dokud ji okno ukazuje, patří do "dnes", i přes půlnoc.
// Jinak nejpozdější den, o kterém modul ví: zapamatovaný z dřívějších průchodů
// (knownDay), den otevření (openedDay — otevření je také použití) a den
// poslední aktivity podle prohlížeče (accessedDay, null = prohlížeč ho
// neprozradil). Chrome jako poslední aktivitu hlásí, kdy se karta naposledy
// objevila na obrazovce (odchodem z karty se nemění), Firefox, kdy z ní
// uživatel odešel — proto modul pamatuje knownDay: karta aktivní přes půlnoc
// by jinak po přepnutí jinam spadla zpátky do "včera". Karta, kterou modul
// nezná (knownDay null — po restartu prohlížeče), navíc nese období své
// automatické skupiny ke dni referenceDay: v tom období byla použitá (nebo
// otevřená), tedy nejdřív v jeho první den.
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
