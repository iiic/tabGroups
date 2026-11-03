/**
 * @file i18n.globals.d.ts
 * @description Global TypeScript declarations for i18n.mjs — user interface translations
 * (_locales/<language>/messages.json of the core and modules/<module>/_locales/<language>/messages.json
 * of the modules, language choice in chrome.storage.local).
 */

declare global {

	namespace Enums {

		/** User interface language (a folder in _locales). */
		type UiLanguage = 'en' | 'cs' | 'sk' | 'de' | 'el';

	}

	namespace Types {

		/** An item of the UI language menu (see UI_LANGUAGES). */
		interface UiLanguageOption {
			value: Enums.UiLanguage;
			/** Name of the language in the language itself — not translated. */
			label: string;
		}

		/** Value substituted for $1…$9 in a text. */
		type I18nSubstitution = string | number;

	}

	namespace Functions {

		namespace I18n {

			/** A supported UI language, otherwise the default (English). */
			type normalizeUiLanguage = ( value: unknown ) => Enums.UiLanguage;

			/** A stored UI language value — the browser language (getBrowserUiLanguage()) when it is not set or not supported. */
			type storedUiLanguage = ( value: unknown ) => Enums.UiLanguage;

			/** UI language stored in chrome.storage.local, until the user picks one the browser language. */
			type readUiLanguage = () => Promise<Enums.UiLanguage>;

			/** Saves the UI language — the other extension pages switch by themselves. */
			type setUiLanguage = ( language: Enums.UiLanguage ) => Promise<void>;

			/** Texts of one language of the core (source "": _locales/<language>/messages.json) or of a module
			 * (source = its folder: modules/<module>/_locales/<language>/messages.json); keys in lower case. */
			type fetchMessages = ( source: string, language: Enums.UiLanguage ) => Promise<Record<string, string>>;

			/** Loads the texts of the core and of the added modules in the UI language (without an argument the
			 * stored one — or the one of the previous load, otherwise the given one). */
			type loadI18n = ( language?: Enums.UiLanguage ) => Promise<void>;

			/** The texts of these modules (folder names in modules/) are loaded by every further loadI18n() too. */
			type addModuleI18n = ( ...names: string[] ) => void;

			/** addModuleI18n() and loadI18n() — the texts of the core and of the modules. */
			type loadModuleI18n = ( ...names: string[] ) => Promise<void>;

			/** Listener of UI language changes; returns a function that unsubscribes it. */
			type onUiLanguageChange = ( listener: ( language: Enums.UiLanguage ) => void ) => () => void;

			/** The currently loaded UI language. */
			type getUiLanguage = () => Enums.UiLanguage;

			/** UI language matching the browser language, otherwise the default (English). */
			type getBrowserUiLanguage = () => Enums.UiLanguage;

			/** Language for Intl.* and toLocale*() according to the UI language. */
			type getUiLocale = () => string;

			/** Is there a text with this key? */
			type hasMessage = ( key: string ) => boolean;

			/** Replaces $1…$9 with values and "$$" with the "$" character. */
			type substitute = ( message: string, substitutions: Types.I18nSubstitution[] ) => string;

			/** UI text by key; $1…$9 are replaced with the arguments. */
			type t = ( key: string, ...substitutions: Types.I18nSubstitution[] ) => string;

			/** Text by key in the given language (not the UI language); $1…$9 are replaced with the arguments. */
			type tIn = ( language: Enums.UiLanguage, key: string, ...substitutions: Types.I18nSubstitution[] ) => Promise<string>;

			/** Plural text according to count (keys <key>_one/_few/_many/_other); $1 is count. */
			type tp = ( key: string, count: number, ...substitutions: Types.I18nSubstitution[] ) => string;

			/** Translates the data-i18n* attributes in a document or part of it. */
			type applyI18n = ( root?: Document | Element | DocumentFragment ) => void;

			/** Loads the texts and translates an extension page; reloads it after a language change. */
			type initPageI18n = () => Promise<void>;

			/** Fills the UI language menu (the browser language with a suffix) and saves the language after a change. */
			type initUiLanguageSelect = ( select: HTMLSelectElement ) => Promise<void>;

		}

	}

}

export { };
