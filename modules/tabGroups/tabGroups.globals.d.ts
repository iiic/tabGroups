/**
 * @file modules/tabGroups/tabGroups.globals.d.ts
 * @description Global TypeScript declarations for modules/tabGroups/tabGroups.mjs — how tabs are sorted and the permission status
 * with the buttons for granting them (the overview of the groups is tabGroupsSandbox).
 */

declare global {

	interface HTMLElementTagNameMap {
		'extension-tab-groups': Classes.ExtensionTabGroups;
	}

	namespace Types {

		namespace TabGroups {

			/** What the element lists. */
			type ElementState = {

				/** The browser lets extensions manage tab groups (chrome.tabs.group) */
				supported: boolean;
				hasGroups: boolean;
				hasAlarms: boolean;

				/** Sorting tabs according to the settings (the day opened, or the day of last use) */
				groupBy: GroupBy;

				/** The number of used groups from bookmarks (rows with a folder) */
				bookmarkGroups: number;

				/** Permissions of groups from bookmarks (bookmarks and tab addresses) */
				hasBookmarks: boolean;

				/** Permissions of groups from bookmarks that the manifest offers as optional */
				requestableBookmarks: chrome.runtime.ManifestPermission[];

				/** The module's permissions that the manifest offers as optional */
				requestable: chrome.runtime.ManifestPermission[];
			};

		}

	}

	namespace Classes {

		/** The tabGroups module element. */
		class ExtensionTabGroups extends BaseElement {

			/** The sequence number of the last _render() — an older concurrent call does not write its result */
			_renderToken: number;

			/** Removing the listeners of settings and permissions */
			_unsubscribe?: Array<() => void>;

			/** A deferred re-render */
			_renderTimer?: ReturnType<typeof setTimeout>;

			static override get observedAttributes(): string[];
			constructor ();
			override connectedCallback(): void;
			override disconnectedCallback(): void;
			override connectedMoveCallback(): void;
			override adoptedCallback(): void;
			override attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void;
			override init( options: Types.ModuleInitOptions ): Promise<void>;

			/** Re-renders with a delay (saving Settings changes several keys → one re-render) */
			_scheduleRender(): void;

			/** Support, the sorting and the permissions */
			_readState(): Promise<Types.TabGroups.ElementState>;

			/** Lists the sorting and the status of the permissions */
			_render(): Promise<void>;

			/** A row with the status (problem = in red) */
			_status( text: string, problem: boolean ): HTMLDivElement;

			/** A button for granting the permission (in the floating window a text instead) */
			_appendPermissionButton( status: HTMLElement, label: string, permissions: chrome.runtime.ManifestPermission[] ): void;

		}

		namespace ExtensionTabGroups {

			/** Instance properties (without methods); the class base is cast to them in JS — see Types.WithFields */
			type Fields = Pick<ExtensionTabGroups, '_renderToken' | '_unsubscribe' | '_renderTimer'>;

		}

	}

}

export { };
