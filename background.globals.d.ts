declare namespace Functions {
	namespace Background {
		type updateExtensionIcon = ( active: boolean ) => Promise<void>;
		type loadIcon = () => Promise<HTMLImageElement>;
		type drawExtensionIcon = ( active: boolean ) => Promise<void>;
		type handleInstalled = ( details: chrome.runtime.InstalledDetails ) => Promise<void>;
		type closeSidebarWhenUnused = ( settings: Types.ModuleSettings ) => Promise<void>;
	}
}
