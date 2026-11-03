/**
 * @file sandbox-modules/tabGroupsSandbox/tabGroupsSandbox.globals.d.ts
 * @description Global TypeScript declarations for sandbox-modules/tabGroupsSandbox/tabGroupsSandbox.mjs — the overview of the
 * automatic tab groups of the current window (colored chips) with the "Regroup now", "Group settings" and "Identify managed
 * groups" buttons, and the editor of the settings of tabGroups in Settings, as an uploaded package the extension brings: the
 * background part of tabGroups does the work for it, through functions outside the sandbox (its services).
 */

declare global {

	interface HTMLElementTagNameMap {
		'extension-tab-groups-sandbox': Classes.ExtensionTabGroupsSandbox;
	}

	namespace Functions {

		namespace TabGroupsSandbox {

			namespace Element {

				/** this.api of the element as the api of an uploaded module */
				type sandboxApi = ( element: Classes.BaseElement ) => Types.SandboxModuleApi;

				/** The text of an error for the user */
				type errorText = ( err: unknown ) => string;

			}

		}

	}

	namespace Classes {

		/**
		 * The overview in the sandbox. Type checking sees BaseElement of sdk.mjs (the module imports "../../sdk.mjs"); in the
		 * sandbox it is the BaseElement of the sandbox SDK.
		 */
		class ExtensionTabGroupsSandbox extends BaseElement {

			/** The result of the last tabGroups.getOverview (null — not loaded, or it may not be read) */
			_data: Types.SandboxTabGroupsOverview | null;

			/** The overview may not be read, or cannot be (the text for the status) */
			_problem: string | null;

			/** The result of the last "Regroup now" or "Identify managed groups" (empty = nothing yet) */
			_result: string;

			/** Is an action in progress (the buttons are disabled)? */
			_busy: boolean;

			/** The states of the declared functions (capabilities.state()) */
			_states: Record<string, Enums.SandboxCapabilityState>;

			/** Subscribed to the listener tabGroups.onChange (once — while denied the core delivers no events) */
			_listening: boolean;

			/** Unsubscribing the listeners (in disconnectedCallback()) */
			_unsubscribers?: Array<() => void>;

			/** Timer of the deferred refresh after an event */
			_refreshTimer?: ReturnType<typeof setTimeout> | null;

			/** Sequence number of the last load — older concurrent ones are discarded */
			_loadId: number;

			/** The editor of the settings is shown (location "settings") — it is not rendered again while the user edits it */
			_settingsShown: boolean;

			static override get observedAttributes(): string[];
			override connectedCallback(): void;
			override disconnectedCallback(): void;
			override connectedMoveCallback(): void;
			override adoptedCallback(): void;
			override attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void;
			override init( options: Types.ModuleInitOptions ): Promise<void>;

			/** Subscribes to the changes and loads the overview, as far as the user allows the functions */
			_start(): Promise<void>;

			/** Is the function outside the sandbox allowed to the module? */
			_allowed( capability: string ): boolean;

			/** Deferred refresh of the overview (a series of events = one) */
			_scheduleRefresh(): void;

			/** Loads the overview (tabGroups.getOverview) and renders it */
			_load(): Promise<void>;

			/** The sorting, what is missing, the chips, the buttons and the result of the last action */
			_render(): void;

			/** A row with the status (problem = in red) */
			_status( text: string, problem: boolean ): HTMLDivElement;

			/** A missing permission with the button that opens Settings (or where to go) */
			_missing( text: string, problem: boolean ): HTMLDivElement;

			/** Chips of the window's automatic groups (or a note why there are none) */
			_chips( overview: Types.TabGroups.Overview ): HTMLDivElement;

			/** The buttons of the allowed functions */
			_actions(): HTMLDivElement;

			/** A button (disabled while an action is in progress) */
			_button( label: string, onClick: () => void ): HTMLButtonElement;

			/** Runs an action (tabGroups.regroup / tabGroups.identify) and describes its result */
			_act( capability: string, describe: ( result: unknown ) => string ): Promise<void>;

			/** Opens Settings (options.open) */
			_openOptions(): void;

			/** Opens the page where tabGroups asks for its permissions (tabGroups.openPermissions) */
			_openPermissions(): void;

			/** The editor of the settings (location "settings"): loads them and renders it */
			_loadSettings( loadId: number ): Promise<void>;

			/** The text of the "Regroup now" result */
			_describeResult( response: Types.TabGroups.RegroupResult | null ): string;

			/** The text of the "Identify managed groups" result */
			_describeIdentify( response: Types.TabGroups.IdentifyResult | null ): string;

		}

		namespace ExtensionTabGroupsSandbox {

			/** Instance properties (without methods); the class base is cast to them in JS — see Types.WithFields */
			type Fields = Pick<ExtensionTabGroupsSandbox, '_data' | '_problem' | '_result' | '_busy' | '_states' | '_listening' | '_unsubscribers' | '_refreshTimer' | '_loadId' | '_settingsShown'>;

		}

	}

}

export { };
