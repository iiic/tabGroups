declare namespace Types {
	namespace TabGroups {
		type Overview = {
			chips: OverviewChip[];
			userGroups: number;
			ungrouped: number;
		};
		type ElementState = {
			supported: boolean;
			hasGroups: boolean;
			hasAlarms: boolean;
			groupBy: GroupBy;
			bookmarkGroups: BookmarkGroupSetting[];
			hasBookmarks: boolean;
			requestable: chrome.runtime.ManifestPermission[];
			requestableBookmarks: chrome.runtime.ManifestPermission[];
			overview: Overview | null;
		};
	}
}

declare namespace Classes {
	interface ExtensionTabGroups extends BaseElement {
		_renderToken: number;
		_result: string;
		_identifying: boolean;
		_watchingBrowser: boolean;
		_unsubscribe: Array<() => void>;
		_renderTimer: ReturnType<typeof setTimeout> | undefined;
		connectedCallback(): void;
		disconnectedCallback(): void;
		connectedMoveCallback(): void;
		adoptedCallback(): void;
		attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void;
		init( input: {
			outputEl: HTMLElement;
			name: string;
			mode?: Enums.ActivationMode;
			location?: Enums.RenderLocation;
			instance?: string | null;
		} ): Promise<void>;
		_scheduleRender(): void;
		_watchBrowser(): void;
		_readState(): Promise<Types.TabGroups.ElementState>;
		_readOverview( config: Types.TabGroups.GroupConfig[], bookmarkGroups: Types.TabGroups.BookmarkGroupSetting[] ): Promise<Types.TabGroups.Overview | null>;
		_render(): Promise<void>;
		_status( text: string, problem: boolean ): HTMLElement;
		_appendPermissionButton( status: HTMLElement, label: string, permissions: chrome.runtime.ManifestPermission[] ): void;
		_overview( overview: Types.TabGroups.Overview | null, groupBy: Types.TabGroups.GroupBy ): HTMLElement;
		_describeResult( response: Types.TabGroups.RegroupResult | null | undefined ): string;
		_describeIdentify( response: Types.TabGroups.IdentifyResult | null | undefined ): string;
	}
	namespace ExtensionTabGroups {
		type Fields = Pick<ExtensionTabGroups, "_renderToken" | "_result" | "_identifying" | "_watchingBrowser" | "_unsubscribe" | "_renderTimer">;
		const observedAttributes: string[];
	}
}
