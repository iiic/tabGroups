/**
 * @file sandbox-modules/tabGroupsSandbox/settingsView.globals.d.ts
 * @description Global TypeScript declarations for sandbox-modules/tabGroupsSandbox/settingsView.mjs — the editor of the settings
 * of tabGroups in the sandbox (sorting, dragging tabs, the prefix, the names and colors of the periods, the groups from bookmarks).
 */

declare global {

	namespace Types {

		namespace TabGroupsSandbox {

			/** A row of the groups from bookmarks in the editor. */
			type BookmarkRow = {
				id: string;
				titleInput: HTMLInputElement;
				folderSelect: HTMLSelectElement;
				domainInput: HTMLInputElement;
				colorSelect: HTMLSelectElement;
				collapsedInput: HTMLInputElement;

				/** The stored folder (it stays selectable when the tree does not have it) */
				storedFolderId: string;
				storedFolderTitle: string;
			};

			/** What the editor does with a change. */
			type SettingsEditorActions = {

				/** Stores one setting */
				save( key: Enums.TabGroups.SettingKey, value: unknown ): Promise<void>;

				/** Opens the page where tabGroups asks for its permissions; null — not allowed */
				openPermissions: ( () => void ) | null;
			};

		}

	}

	namespace Functions {

		namespace TabGroupsSandbox {

			namespace SettingsView {

				/** A new id of a row of the groups from bookmarks */
				type newRowId = () => string;

				/** A control with its label above it */
				type labeled = ( text: string, control: HTMLElement ) => HTMLLabelElement;

				/** The "collapsed group" checkbox with its label */
				type collapsedCheckbox = ( checked: boolean, ariaLabel: string ) => { label: HTMLLabelElement; input: HTMLInputElement };

				/** A select of the colors with a preview in a table cell */
				type colorPicker = (
					colors: Types.TabGroups.SettingsView['colors'],
					value: string,
					ariaLabel: string,
					defaultColor?: string | null,
				) => { cell: HTMLTableCellElement; select: HTMLSelectElement };

				/** The header row of a table */
				type tableHead = ( table: HTMLTableElement, titles: string[] ) => void;

				/** The names and colors of the periods; periodTitles() — the names as they would be (for the duplicates of the groups from bookmarks) */
				type createGroupsTable = (
					view: Types.TabGroups.SettingsView,
					onChange: ( value: Types.TabGroups.StoredGroupsConfig ) => void,
				) => { element: HTMLDivElement; periodTitles: () => string[] };

				/** The groups from bookmarks; refresh() marks the duplicates again */
				type createBookmarksTable = (
					view: Types.TabGroups.SettingsView,
					periodTitles: () => string[],
					onChange: ( value: Types.TabGroups.BookmarkGroupSetting[] ) => void,
					openPermissions: ( () => void ) | null,
				) => { element: HTMLDivElement; refresh: () => void };

				/** The whole editor into the container */
				type renderSettingsEditor = ( container: HTMLElement, view: Types.TabGroups.SettingsView, actions: Types.TabGroupsSandbox.SettingsEditorActions ) => void;

			}

		}

	}

}

export { };
