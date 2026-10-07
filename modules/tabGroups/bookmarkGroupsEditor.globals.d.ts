declare namespace Functions {
	namespace TabGroups {
		namespace BookmarkGroupsEditor {
			type createBookmarkGroupsEditor = (
				value: unknown,
				options: {
					api: {
						permissions: {
							contains( permission: Types.PermissionSet ): Promise<boolean>;
							request( permission: Types.PermissionSet ): Promise<boolean>;
							onChange( handler: () => void ): () => void;
						};
					};
					periodTitles: string[];
				}
			) => Types.TabGroups.BookmarkGroupsEditorElement;
			type folderTitleOf = ( row: Types.TabGroups.BookmarkEditorRow ) => string;
			type readRow = ( row: Types.TabGroups.BookmarkEditorRow ) => Types.TabGroups.BookmarkGroupSetting;
			type fillFolders = ( row: Types.TabGroups.BookmarkEditorRow ) => void;
			type refresh = () => void;
			type addRow = ( setting: Types.TabGroups.BookmarkGroupSetting ) => void;
			type load = () => Promise<void>;
			type newRowId = () => string;
		}
	}
}
