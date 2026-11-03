/**
 * @file modules/tabGroups/groupIdentity.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/groupIdentity.mjs — how the module recognizes its groups
 * in the browser (the registry of group numbers, names from Settings, all previously used names).
 */

declare global {

	namespace Types {

		namespace TabGroups {

			/** A module group in the registry (GROUP_IDS_KEY) — under the group's number in the browser. */
			type GroupIdEntry = {

				/** The target key: "period:<period key>", or "bookmarks:<row id>" */
				key: string;

				/** The name the group had after the last pass (given to it by the module) */
				title: string;

				/** The day of the last pass that saw the group */
				day: number;
			};

			/** Target keys in the planner's order and their names from Settings. */
			type TargetDescription = { keys: string[]; titles: string[] };

			/** Everything a module group is recognized by. */
			type GroupIdentityInput = TargetDescription & {

				/** The group registry: group id → record */
				groupIds: Record<string, GroupIdEntry>;

				/** All names the module gave to groups: [name, target key], the newest at the end */
				knownTitles: [string, string][];
			};

			/** Vstup earlierTitles(). */
			type EarlierTitlesInput = {

				/** Target keys (describeTargets()) */
				keys: string[];

				/** For each target the base names without the prefix */
				baseTitles: string[][];

				/** The prefix from Settings */
				prefix: string;

				/** Period group names from the last assignment by an older version (APPLIED_TITLES_KEY) */
				appliedTitles: string[];

				/** Names of groups from bookmarks from the last assignment by an older version: row id → name */
				appliedBookmarkTitles: Record<string, string>;
			};

		}

	}

	namespace Functions {

		namespace TabGroups {

			namespace GroupIdentity {

				/** Keys and names of the targets (periods, then groups from bookmarks) */
				type describeTargets = ( config: Types.TabGroups.GroupConfig[], bookmarkGroups: Types.TabGroups.BookmarkGroup[] ) => Types.TabGroups.TargetDescription;

				/** The module's groups → target key */
				type findOurGroups = ( groups: Types.TabGroups.GroupInfo[], identity: Types.TabGroups.GroupIdentityInput ) => Map<number, string>;

				/** Target keys → target positions (a target outside Settings = keys.length) */
				type toTargets = ( ours: Map<number, string>, keys: string[] ) => Map<number, number>;

				/** The group registry after a pass */
				type rememberGroups = (
					groupIds: Record<string, Types.TabGroups.GroupIdEntry>,
					groups: Types.TabGroups.GroupInfo[],
					ours: Map<number, string>,
					today: number
				) => Record<string, Types.TabGroups.GroupIdEntry>;

				/** The stored group registry → valid records */
				type readGroupIds = ( value: unknown ) => Record<string, Types.TabGroups.GroupIdEntry>;

				/** Do both registries have the same content? */
				type sameGroupIds = ( a: Record<string, Types.TabGroups.GroupIdEntry>, b: Record<string, Types.TabGroups.GroupIdEntry> ) => boolean;

				/** The stored list of names → valid pairs, or null (not stored yet) */
				type readKnownTitles = ( value: unknown ) => [string, string][] | null;

				/** The list of names extended with more (unchanged the same list) */
				type rememberTitles = ( knownTitles: [string, string][], entries: [string, string][] ) => [string, string][];

				/** Names the module's groups may have from the time before the list of names */
				type earlierTitles = ( input: Types.TabGroups.EarlierTitlesInput ) => [string, string][];

			}

		}

	}

}

export { };
