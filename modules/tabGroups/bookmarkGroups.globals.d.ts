/**
 * @file modules/tabGroups/bookmarkGroups.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/bookmarkGroups.mjs — automatic groups from
 * bookmarks: settings, permissions, matching tab addresses against bookmarks and bookmark folders for the editor.
 */

declare global {

	namespace Types {

		namespace TabGroups {

			/** A settings row of a group from bookmarks (as it is stored). */
			type BookmarkGroupSetting = {

				/** A permanent row id (connects the group in the browser with the row even after renaming) */
				id: string;

				/** The group name as the user entered it (empty = the folder name) */
				title: string;

				/** The bookmark folder (empty = the row is not used) */
				folderId: string;

				/** The folder name at the time of saving (the default group name, the description in the overview) */
				folderTitle: string;

				/** "all URLs on the bookmark's domain" */
				wholeDomain: boolean;
				color: GroupColor;

				/** "collapsed group" — a new group is created collapsed */
				collapsed: boolean;
			};

			/** A used group from bookmarks — a row with a folder and a unique name. */
			type BookmarkGroup = BookmarkGroupSetting;

			/** A tab address → the index of the group from bookmarks, or -1. */
			type BookmarkMatcher = ( url: string | undefined ) => number;

			/** A bookmark folder for the select in the editor. */
			type BookmarkFolder = {
				id: string;

				/** The folder name */
				title: string;

				/** The path with the folder ("Bookmarks bar › Work") */
				label: string;
			};

		}

	}

	namespace Functions {

		namespace TabGroups {

			namespace BookmarkGroups {

				/** The group name when the user does not fill it in and the folder has no name */
				type fallbackTitle = () => string;

				/** The default color of a row by its position */
				type defaultBookmarkColor = ( index: number ) => Types.TabGroups.GroupColor;

				/** Stored settings → an array of rows (with unique ids) */
				type normalizeBookmarkGroups = ( value: unknown ) => Types.TabGroups.BookmarkGroupSetting[];

				/** The row's group name: the entered one, otherwise the folder name */
				type bookmarkGroupTitle = ( setting: Types.TabGroups.BookmarkGroupSetting ) => string;

				/** Used groups (with a folder) with names different from each other and from takenTitles */
				type resolveBookmarkGroups = ( settings: Types.TabGroups.BookmarkGroupSetting[], takenTitles: string[] ) => Types.TabGroups.BookmarkGroup[];

				/** A group description for the overview in the element */
				type describeBookmarkGroup = ( group: Types.TabGroups.BookmarkGroup ) => string;

				/** The address without the part after "#" in a normalized form, or null */
				type pageKey = ( url: unknown ) => string | null;

				/** The host of an http(s) address without "www.", or null */
				type siteOf = ( url: unknown ) => string | null;

				/** Addresses of all bookmarks in the tree nodes (also in subfolders) */
				type collectBookmarkUrls = ( nodes: chrome.bookmarks.BookmarkTreeNode[] ) => string[];

				namespace collectBookmarkUrls {

					/** Projde uzel a jeho potomky */
					type walk = ( node: chrome.bookmarks.BookmarkTreeNode ) => void;

				}

				/** A tab address → the index of the group from bookmarks (the bookmark addresses of each group's folder) */
				type createBookmarkMatcher = ( groups: Types.TabGroups.BookmarkGroup[], urlsByGroup: string[][] ) => Types.TabGroups.BookmarkMatcher;

				/** Folders of the bookmark tree with a path, in tree order */
				type listBookmarkFolders = ( tree: chrome.bookmarks.BookmarkTreeNode[] ) => Types.TabGroups.BookmarkFolder[];

				namespace listBookmarkFolders {

					/** Adds a folder and its subfolders */
					type add = ( node: chrome.bookmarks.BookmarkTreeNode, title: string, path: string[] ) => void;

				}

			}

		}

	}

}

export { };
