//@ts-check
"use strict";

// modules/tabGroups/module.mjs
// Popis modulu bez DOM (viz halloWorld/module.mjs) — sdílí ho element
// (tabGroups.mjs) i background část (background-script.mjs). Období a výpočty
// nad dny jsou v buckets.mjs, skupiny ze záložek v bookmarkGroups.mjs,
// plánování změn skupin v planner.mjs.
import { createModuleApi, getModuleSettingKey, getTagName, NOT_DISABLED_SPEC, t } from "../../sdk.mjs";
import { DEFAULT_GROUPS, DEFAULT_GROUP_BY, DEFAULT_TITLE_PREFIX, GROUP_BY_LAST_USED, GROUP_BY_OPENED, normalizeGroupsConfig } from "./buckets.mjs";
import { BOOKMARK_GROUPS_PERMISSIONS } from "./bookmarkGroups.mjs";
import { createGroupsEditor } from "./groupsEditor.mjs";
import { createBookmarkGroupsEditor } from "./bookmarkGroupsEditor.mjs";

export const MODULE_NAME = "tabGroups";
export const TAG = getTagName( MODULE_NAME ); // "extension-tab-groups"
export const DESCRIPTION = t( "tabGroups_description" );

// Karty řadí background část pořád, dokud modul není vypnutý — žádná
// background/focus/popup nuance (stejně jako backByBackspace). Element
// (přehled skupin aktuálního okna) nezávisí na aktivní záložce.
export const ACTIVATION_SPEC = NOT_DISABLED_SPEC;
/** @type {Types.ModuleDescriptor['DEFAULT_ACTIVATION_MODE']} */
export const DEFAULT_ACTIVATION_MODE = "background";
/** @type {Types.ModuleDescriptor['DEFAULT_DISPLAY_LOCATION']} */
export const DEFAULT_DISPLAY_LOCATION = "sidebar";

// Krátký přehled (řada barevných štítků a dvě tlačítka), má být vidět hned
// celý — blokový element. Nadpis ne, výpis začíná jménem modulu.
/** @type {Types.ModuleDescriptor['DEFAULT_OUTPUT_ELEMENT']} */
export const DEFAULT_OUTPUT_ELEMENT = "block";
/** @type {Types.ModuleDescriptor['DEFAULT_SHOW_HEADING']} */
export const DEFAULT_SHOW_HEADING = false;

// Vzhled přehledu i editoru nastavení (barevné štítky skupin).
/** @type {string[]} */
export const STYLES = [ new URL( "./tabGroups.css", import.meta.url ).href ];

// chrome.tabGroups (názvy, barvy a pořadí skupin) — bez něj modul nic nedělá.
// Ve Firefoxu se uděluje bez dotazu, v Chrome bez varování.
/** @type {Types.PermissionSet} */
export const TAB_GROUPS_PERMISSIONS = { permissions: [ "tabGroups" ] };
// chrome.alarms — přesun skupin přesně o půlnoci. Bez něj se nový den
// projeví až při další práci s kartami. Firefox ho jako nepovinné oprávnění
// nepřijme (ověřeno ve verzi 156), v jeho manifestu je proto povinné.
/** @type {Types.PermissionSet} */
export const ALARMS_PERMISSIONS = { permissions: [ "alarms" ] };
// "bookmarks" a "tabs" — skupiny ze záložek (obsah složek a adresy karet), viz
// BOOKMARK_GROUPS_PERMISSIONS v bookmarkGroups.mjs.
export { BOOKMARK_GROUPS_PERMISSIONS };
/** @type {Types.PermissionSet[]} */
export const USES_PERMISSIONS = [ TAB_GROUPS_PERMISSIONS, ALARMS_PERMISSIONS, BOOKMARK_GROUPS_PERMISSIONS ];

// Názvy a barvy skupin — { [klíč období]: { title, color, collapsed } } pod
// getModuleSettingKey(MODULE_NAME, "groups"), viz normalizeGroupsConfig().
export const GROUPS_KEY = "groups";
// Podle kterého dne se karty řadí do skupin: GROUP_BY_OPENED ("opened", den
// otevření — výchozí) nebo GROUP_BY_LAST_USED ("lastUsed", den posledního
// použití), viz normalizeGroupBy() v buckets.mjs.
export const GROUP_BY_KEY = "groupBy";
// Smí uživatel přetahovat karty mezi skupinami období (checkbox, výchozí
// ne)? Karta přetažená do skupiny jiného dne v ní zůstane — dostane ruční
// den (MANUAL_DAYS_KEY), se kterým se o půlnoci posouvá dál. Bez volby ji
// modul vrátí do skupiny jejího dne.
export const MANUAL_MOVES_KEY = "manualMoves";
export const DEFAULT_MANUAL_MOVES = false;
// Předpona před názvy všech automatických skupin (text, výchozí
// DEFAULT_TITLE_PREFIX v buckets.mjs, prázdná = bez předpony). Změna
// předpony skupiny jen přejmenuje — poznají se podle APPLIED_TITLES_KEY.
export const TITLE_PREFIX_KEY = "titlePrefix";
// Skupiny ze záložek — pole řádků { id, title, folderId, folderTitle,
// wholeDomain, color, collapsed }, viz normalizeBookmarkGroups() v bookmarkGroups.mjs.
export const BOOKMARK_GROUPS_KEY = "bookmarkGroups";

// Element → background část: přeskup karty hned (tlačítko „Přeskupit teď“).
// Odpověď: Types.TabGroups.RegroupResult.
export const REGROUP_MESSAGE = "TAB_GROUPS_REGROUP_NOW";
// Element → background část: zablikat skupinami, které modul řídí (tlačítko
// „Identifikovat řízené skupiny“). Odpověď: Types.TabGroups.IdentifyResult.
export const IDENTIFY_MESSAGE = "TAB_GROUPS_IDENTIFY";

// Klíče vlastního stavu modulu (api.state/api.sessionState) — zapisuje je
// background část, element je jen čte.
// Den posledního zařazení karet (api.state): skupiny v prohlížeči mají
// období platná k tomuhle dni — podle něj se po restartu prohlížeče odhadnou
// dny otevření obnovených karet (estimateOpenedDay() v buckets.mjs).
export const REFERENCE_DAY_KEY = "referenceDay";
// Evidence skupin modulu { [id skupiny]: { key, title, day } } (api.state) —
// skupina se pozná podle čísla, dokud má název, který jí dal modul (viz
// groupIdentity.mjs).
export const GROUP_IDS_KEY = "groupIds";
// Všechny názvy, které modul skupinám dal [[název, klíč cíle], …] (api.state)
// — podle nich se pozná skupina, jejíž číslo modul nezná (Chrome po restartu
// prohlížeče), i po změně názvů, předpony nebo jazyka rozhraní.
export const KNOWN_TITLES_KEY = "knownTitles";
// Názvy skupin období a skupin ze záložek ({ [id řádku]: název }) z
// posledního zařazení starší verze (api.state) — čtou se jen jednou, při
// prvním naplnění KNOWN_TITLES_KEY.
export const APPLIED_TITLES_KEY = "appliedTitles";
export const APPLIED_BOOKMARK_TITLES_KEY = "appliedBookmarkTitles";
// Dny otevření karet { [id karty]: den } (api.sessionState — id karet platí
// jen do restartu prohlížeče).
export const OPENED_DAYS_KEY = "openedDays";
// Dny posledního použití karet { [id karty]: den } (api.sessionState) —
// background část je počítá v obou režimech řazení.
export const USED_DAYS_KEY = "usedDays";
// Skupina každé karty, jak ji nechal poslední průchod { [id karty]: id
// skupiny } (api.sessionState, jen s volbou MANUAL_MOVES_KEY) — karta, která
// je při dalším průchodu jinde, se přesunula bez modulu.
export const LAST_GROUPS_KEY = "lastGroups";
// Ruční dny karet, které uživatel přetáhl do skupiny jiného období { [id
// karty]: den } (api.sessionState) — mají přednost před dnem otevření i
// posledního použití; při řazení podle posledního použití platí, dokud se
// uživatel na kartu znovu nepřepne.
export const MANUAL_DAYS_KEY = "manualDays";

// Nejdřív výběr, podle kterého dne se karty řadí, volba přetahování karet a
// předpona názvů skupin (vše vykreslí jádro), pod nimi názvy a barvy skupin a
// skupiny ze záložek:
// pole typu "custom" — render() dodává editor, jehož getValue() vrací
// ukládanou hodnotu. Import editorů (DOM) je tu bezpečný i v background
// části — render() se volá, jen když stránka Nastavení formulář skutečně
// vykresluje. Editor skupin ze záložek dostane vlastní api (oprávnění
// k záložkám) a uložené názvy období (hlídá, aby se neopakovaly).
/** @type {Types.SettingField[]} */
export const SETTINGS_SCHEMA = [
	{
		key: GROUP_BY_KEY,
		label: t( "tabGroups_setting_group_by" ),
		type: "select",
		default: DEFAULT_GROUP_BY,
		options: [
			{ value: GROUP_BY_OPENED, label: t( "tabGroups_setting_group_by_opened" ) },
			{ value: GROUP_BY_LAST_USED, label: t( "tabGroups_setting_group_by_last_used" ) },
		],
	},
	{
		key: MANUAL_MOVES_KEY,
		label: t( "tabGroups_setting_manual_moves" ),
		type: "checkbox",
		default: DEFAULT_MANUAL_MOVES,
	},
	{
		key: TITLE_PREFIX_KEY,
		label: t( "tabGroups_setting_title_prefix" ),
		type: "text",
		default: DEFAULT_TITLE_PREFIX,
		placeholder: t( "tabGroups_setting_title_prefix_placeholder" ),
	},
	{
		key: GROUPS_KEY,
		label: t( "tabGroups_setting_groups" ),
		type: "custom",
		default: DEFAULT_GROUPS,
		render: ( value ) => createGroupsEditor( value ),
	},
	{
		key: BOOKMARK_GROUPS_KEY,
		label: t( "tabGroups_setting_bookmark_groups" ),
		type: "custom",
		default: [],
		render: ( value, settings ) =>
			createBookmarkGroupsEditor( value, {
				api: createModuleApi( MODULE_NAME ),
				periodTitles: normalizeGroupsConfig( settings[ getModuleSettingKey( MODULE_NAME, GROUPS_KEY ) ] ).map( ( item ) => item.title ),
			} ),
	},
];
