/**
 * @file modules/tabGroups/settings.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/settings.mjs — the settings of tabGroups as data for their
 * editor in tabGroupsSandbox (tabGroups.getSettings) and the checks of a change (tabGroups.setSettings).
 */

declare global {

	namespace Enums {

		namespace TabGroups {

			/** A setting of tabGroups the editor changes */
			type SettingKey = 'groupBy' | 'manualMoves' | 'titlePrefix' | 'groups' | 'bookmarkGroups';

		}

	}

	namespace Types {

		namespace TabGroups {

			/** The values of the settings as the editor shows them (a default period name is ""). */
			type SettingsValues = {
				groupBy: GroupBy;
				manualMoves: boolean;
				titlePrefix: string;
				groups: StoredGroupsConfig;
				bookmarkGroups: BookmarkGroupSetting[];
			};

			/** A period for the editor: its key, the default name and color in the UI language and its description. */
			type SettingsPeriod = { key: string; title: string; color: GroupColor; range: string };

			/** What the editor of the settings gets (tabGroups.getSettings). */
			type SettingsView = {
				values: SettingsValues;
				periods: SettingsPeriod[];

				/** The colors of the groups with their names in the UI language */
				colors: { value: GroupColor; label: string }[];

				/** The default prefix of the group names */
				defaultTitlePrefix: string;

				/** The folders of the bookmarks; null without the permission to bookmarks */
				folders: BookmarkFolder[] | null;

				/** The permissions of groups from bookmarks (bookmarks and tab addresses) are granted */
				hasBookmarks: boolean;
			};

		}

	}

	namespace Functions {

		namespace TabGroups {

			namespace Settings {

				/** Is it a setting the editor may change? */
				type isSettingKey = ( key: unknown ) => key is Enums.TabGroups.SettingKey;

				/** The names and colors of the periods for the editor (a default name as "") */
				type groupsForEditor = ( value: unknown ) => Types.TabGroups.StoredGroupsConfig;

				/** The settings with what their editor needs */
				type readSettingsView = ( api: Types.ModuleApi ) => Promise<Types.TabGroups.SettingsView>;

				/** The value of one setting as it is stored; an invalid value throws */
				type normalizeSetting = ( key: Enums.TabGroups.SettingKey, value: unknown ) => unknown;

				/** One change of the editor ({ key, value } or { reset: true }); returns the stored value(s) */
				type applySettingsChange = ( api: Types.ModuleApi, change: unknown ) => Promise<Record<string, unknown>>;

			}

		}

	}

}

export { };
