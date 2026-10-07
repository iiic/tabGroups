declare namespace Types {
	namespace TabGroups {
		type GroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
		type GroupBy = "opened" | "lastUsed";
		type ColorOption = { value: GroupColor; label: string };
		type Bucket = { key: string; title: string; range: string; color: GroupColor };
		type GroupConfig = { title: string; color: GroupColor; collapsed: boolean };
		type BookmarkGroupSetting = GroupConfig & {
			id: string;
			folderId: string;
			folderTitle: string;
			wholeDomain: boolean;
		};
		type BookmarkFolder = { id: string; title: string; label: string };
		type BookmarkMatcher = ( url?: string ) => number;
		type EditorRow = {
			key: string;
			titleInput: HTMLInputElement;
			colorSelect: HTMLSelectElement;
			swatch: HTMLElement;
			collapsedInput: HTMLInputElement;
		};
		type BookmarkEditorRow = {
			id: string;
			tr: HTMLTableRowElement;
			titleInput: HTMLInputElement;
			folderSelect: HTMLSelectElement;
			domainInput: HTMLInputElement;
			colorSelect: HTMLSelectElement;
			swatch: HTMLElement;
			collapsedInput: HTMLInputElement;
			storedFolderId: string;
			storedFolderTitle: string;
		};
		interface GroupsEditorElement extends HTMLDivElement {
			getValue(): Record<string, GroupConfig>;
		}
		interface BookmarkGroupsEditorElement extends HTMLDivElement {
			getValue(): BookmarkGroupSetting[];
		}
		type OverviewChip = {
			title: string;
			color: GroupColor;
			count: number;
			first: number;
		} & (
				| { kind: "period"; range: string }
				| { kind: "bookmarks"; range: string }
			);
		type RegroupProblem = "disabled" | "unavailable" | "error";
		type RegroupResult = { ok: true; changed: boolean } | { ok: false; reason: RegroupProblem; error?: string };
		type IdentifyResult = { ok: true; count: number } | { ok: false; reason: RegroupProblem; error?: string };
		type TabInfo = {
			id: number;
			windowId: number;
			index: number;
			groupId: number;
			url?: string;
			active: boolean;
			pinned: boolean;
			hidden: boolean;
			lastAccessed?: number;
		};
		type GroupInfo = { id: number; windowId?: number; title: string; color: GroupColor; shared?: boolean; collapsed?: boolean };
		type GroupIdEntry = { key: string; title: string; day: number };
		type GroupCandidate = { groupId: number; bucket: number; count: number; sameTarget: boolean; first: number };
		type WindowPlan = {
			openedDays: Record<number, number>;
			usedDays: Record<number, number>;
			manualDays: Record<number, number>;
			updates: Array<{ groupId: number; title?: string; color?: GroupColor }>;
			moves: Array<{ groupId: number; tabIds: number[] }>;
			creates: Array<{ bucket: number; title: string; color: GroupColor; collapsed: boolean; tabIds: number[] }>;
		};
	}
}

declare namespace Functions {
	namespace TabGroups {
		namespace Planner {
			type planWindow = ( input: {
				tabs: Types.TabGroups.TabInfo[];
				groups: Types.TabGroups.GroupInfo[];
				config: Types.TabGroups.GroupConfig[];
				bookmarkGroups: Types.TabGroups.BookmarkGroupSetting[];
				groupIds: Record<string, Types.TabGroups.GroupIdEntry>;
				knownTitles: Array<[string, string]>;
				openedDays: Record<number, number>;
				usedDays: Record<number, number>;
				referenceDay: number;
				today: number;
				dayOf: ( timestamp: number ) => number;
				groupBy: Types.TabGroups.GroupBy;
				bookmarkOf: ( url: string | undefined ) => number;
				manualMoves: boolean;
				lastGroups: Record<number, number>;
				manualDays: Record<number, number>;
			} ) => Types.TabGroups.WindowPlan;
			namespace planWindow {
				type periodOf = ( tab: Types.TabGroups.TabInfo ) => number;
				type movedByUser = ( tab: Types.TabGroups.TabInfo ) => boolean;
			}
			type targetRank = ( target: number, bookmarkCount: number ) => number;
			type planOrder = (
				tabs: Types.TabGroups.TabInfo[],
				targetOfGroup: Map<number, number>,
				bookmarkCount: number
			) => number[];
		}
	}
}
