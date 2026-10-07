declare namespace Functions {
	namespace I18n {
		type normalizeUiLanguage = ( value: unknown ) => Enums.UiLanguage;
		type readUiLanguage = () => Promise<Enums.UiLanguage>;
		type setUiLanguage = ( language: Enums.UiLanguage ) => Promise<void>;
		type fetchMessages = ( language: Enums.UiLanguage ) => Promise<Record<string, string>>;
		type loadI18n = ( language?: Enums.UiLanguage ) => Promise<void>;
		type onUiLanguageChange = ( listener: ( language: Enums.UiLanguage ) => void ) => () => void;
		type getBrowserUiLanguage = () => Enums.UiLanguage;
		type hasMessage = ( key: string ) => boolean;
		type substitute = ( message: string, substitutions: unknown[] ) => string;
		type tIn = ( language: Enums.UiLanguage, key: string, ...substitutions: Array<string | number> ) => Promise<string>;
		type t = ( key: string, ...substitutions: Array<string | number> ) => string;
		type tp = ( key: string, count: number, ...substitutions: Array<string | number> ) => string;
		type applyI18n = ( root?: Document | HTMLElement ) => void;
		type initUiLanguageSelect = ( select: HTMLSelectElement ) => Promise<void>;
		type initPageI18n = () => Promise<void>;
	}
}
