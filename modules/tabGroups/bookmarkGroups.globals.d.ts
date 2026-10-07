declare namespace Functions {
	namespace TabGroups {
		namespace BookmarkGroups {
			type fallbackTitle = () => string;
			type defaultBookmarkColor = ( index: number ) => Types.TabGroups.GroupColor;
			type normalizeBookmarkGroups = ( value: unknown ) => Types.TabGroups.BookmarkGroupSetting[];
			type bookmarkGroupTitle = ( setting: Types.TabGroups.BookmarkGroupSetting ) => string;
			type resolveBookmarkGroups = (
				settings: Types.TabGroups.BookmarkGroupSetting[],
				takenTitles: string[]
			) => Types.TabGroups.BookmarkGroupSetting[];
			type describeBookmarkGroup = ( group: Types.TabGroups.BookmarkGroupSetting ) => string;
			type pageKey = ( url: string | undefined ) => string | null;
			type siteOf = ( url: string | undefined ) => string | null;
			type collectBookmarkUrls = ( nodes: chrome.bookmarks.BookmarkTreeNode[] ) => string[];
			namespace collectBookmarkUrls {
				type walk = ( node: chrome.bookmarks.BookmarkTreeNode ) => void;
			}
			type createBookmarkMatcher = (
				groups: Types.TabGroups.BookmarkGroupSetting[],
				urlsByGroup: string[][]
			) => Types.TabGroups.BookmarkMatcher;
			type listBookmarkFolders = ( tree: chrome.bookmarks.BookmarkTreeNode[] ) => Types.TabGroups.BookmarkFolder[];
			namespace listBookmarkFolders {
				type add = ( node: chrome.bookmarks.BookmarkTreeNode, title: string, path: string[] ) => void;
			}
		}
	}
}
