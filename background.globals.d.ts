declare namespace Functions {
	namespace Background {
		type updateExtensionIcon = ( active: boolean ) => void;
		type drawExtensionIcon = ( active: boolean ) => Promise<void>;
		type handleInstalled = ( details: chrome.runtime.InstalledDetails ) => Promise<void>;
	}
}
