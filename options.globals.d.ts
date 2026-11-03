/**
 * @file options.globals.d.ts
 * @description Global TypeScript declarations for options.mjs — the Settings page (options.html): the module
 * list (modules.json), activation modes and output surfaces, custom module settings (settingsSchema).
 */

declare global {

	namespace Types {

		/** An item of a <select> in a module row (ACTIVATION_MODES, OUTPUT_ELEMENTS). */
		type LabeledSelectOption = { value: string; label: string };

		/** The control of one field of a module's custom settings (by field type). */
		type SettingControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | CustomSettingControl | CheckboxTableControl;

		/** A control whose value is readable through .value (all except a custom editor). */
		type ValueSettingControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

		/** Replacement for a custom editor whose render() failed — getValue() returns the original value unchanged. */
		type FallbackSettingControl = HTMLDivElement & { getValue(): unknown };

		/** A table of checkboxes (a "checkboxTable" field) — getValue() returns the whole table. */
		type CheckboxTableControl = HTMLDivElement & { getValue(): CheckboxTableValue };

		/** The nearest row under the cursor while dragging (see OptionsController._rowAfterPoint()). */
		type ModuleRowCandidate = { offset: number; row: Element | null };

		/** Difference of the stored module list against modules.json (see OptionsController._compareModuleLists()). */
		type ModulesListDiff = { extra: string[]; missing: string[] };

		/** A section with the floating "Save" — the module list (#modules-list) or the custom module settings (#module-settings-list). */
		type SavedFormSection = "list" | "settings";

		/**
		 * The result of uploading a module below the file input: the sentence, the items (errors), notes (the functions
		 * outside the sandbox waiting for the user's decision) and warnings.
		 */
		type SandboxReport = { text: string; items?: string[]; notes?: string[]; warnings?: string[]; error?: boolean };

	}

	namespace Classes {

		/** Controller of the Settings page. */
		class OptionsController extends BaseController {

			/** Output of modules with the "options" surface (#modules-output) */
			outputEl: HTMLElement;

			/** Module rows — mode, output locations, frame, heading (#modules-list) */
			container: HTMLElement;
			saveBtn: HTMLButtonElement;
			resetBtn: HTMLButtonElement;

			/** A short status message (#status) */
			statusEl: HTMLElement;

			/** Editor of the module list as JSON (#modules-json) */
			jsonTextareaEl: HTMLTextAreaElement;
			saveJsonBtn: HTMLButtonElement;
			resetJsonBtn: HTMLButtonElement;

			/** A notice that the stored list differs from modules.json (#modules-json-diff) */
			modulesDiffEl: HTMLElement;

			/** Sequence number of the last list comparison — an older result is not shown */
			_modulesDiffRun: number;

			/** Custom module settings (#module-settings-list) */
			moduleSettingsContainer: HTMLElement;
			saveModuleSettingsBtn: HTMLButtonElement;
			resetModuleSettingsBtn: HTMLButtonElement;

			/** The values of a section's form after rendering or the last save, as JSON by storage key (see _syncUnsavedChanges()) */
			_savedValues: Record<Types.SavedFormSection, Map<string, string>>;

			/** The sections whose check of unsaved changes is already planned */
			_unsavedChecks: Set<Types.SavedFormSection>;

			/** Module definitions loaded by a dynamic import (incl. settingsSchema) */
			_moduleDefs: Types.ModuleDefinition[];

			/** The module output of this page (#modules-output); undefined until it is rendered */
			_outputSurface: Types.ModuleSurface | undefined;

			/** The module row being dragged right now */
			_draggedRow: Element | null;

			/** File input of an uploaded module (#sandbox-module-file) */
			sandboxFileInput: HTMLInputElement;

			/** The result of the last upload (#sandbox-module-report) */
			sandboxReportEl: HTMLElement;

			/** The list of uploaded modules (#sandbox-modules-list) */
			sandboxListEl: HTMLElement;

			/** The section "Modules from other extensions", the status of the service provider (a client) and the list of clients (the provider) */
			servicesSectionEl: HTMLElement;
			servicesProviderEl: HTMLElement;
			servicesListEl: HTMLElement;

			/** The number of the last rendering of the section — older overlapping ones are not shown */
			_servicesRenderRun: number;

			/** Settings opened at the section (options.html#extension-services) scrolled to it once it was shown */
			_servicesScrolled: boolean;

			/** The service provider of this extension (a client) — its id (null: not a client) and its name as it said it last */
			_serviceProviderId: string | null;
			_serviceProviderName: string | null;

			/** Sequence number of the last rendering of the uploaded modules — an older one is not shown */
			_sandboxRenderRun: number;

			/** "Do not use the sidebar" (#sidebar-disabled) and its explanation for the current browser (#sidebar-disabled-hint) */
			sidebarDisabledCheckbox: HTMLInputElement;
			sidebarDisabledHintEl: HTMLElement;

			/** The stored "Do not use the sidebar" — the sidebar location of the module rows is out of use */
			_sidebarDisabled: boolean;


			/** The sections (#options-sections) and the tab bar made from their headings (#options-tabbar) */
			sectionsEl: HTMLElement;
			tabbarEl: HTMLElement;

			/** A narrow screen — the sections as an accordion instead of tabs */
			_accordion: MediaQueryList;

			/** The id of the chosen section; null = all closed in the accordion, or not yet restored (the tabs then show the default one) */
			_activeSection: string | null;

			/** The module filter (#module-filter, shown from MODULE_FILTER_MIN modules), its input and the suggested names (<datalist>) */
			filterEl: HTMLElement;
			filterInput: HTMLInputElement;
			filterNamesEl: HTMLDataListElement;

			constructor ();

			/** Fills the JSON editor with the stored module list */
			loadModulesListEditor(): Promise<void>;

			/** Above the editor shows whether the stored list differs from modules.json and what it has extra / what it is missing */
			_showModulesListDiff(): Promise<void>;

			/** Extra entries (only in userList) and missing ones (only in defaultList); also counts repeated entries */
			_compareModuleLists( userList: string[], defaultList: string[] ): Types.ModulesListDiff;

			/** Saves the module list from the JSON editor */
			saveModulesList(): Promise<void>;

			/** Resets the module list to the default modules.json */
			resetModulesList(): Promise<void>;

			/** Renders the module rows (mode, output locations, frame, heading) */
			renderModules( modules: string[], settings: Types.ModuleSettings ): void;

			/** Row of one module list entry — a plain module, an instance (with fields and "Remove"), or a template (only "Add") */
			_createModuleRow( path: string, settings: Types.ModuleSettings, moduleDef: Types.ModuleDefinition | undefined ): HTMLDivElement;

			/** Button of the template of a module with multiple instances that adds a new instance */
			_createAddInstanceButton( templateRow: HTMLElement, entry: Types.ModuleEntry, name: string ): HTMLButtonElement;

			/** Inserts a new instance row below the template and saves the module list */
			_addModuleInstance( templateRow: HTMLElement, entry: Types.ModuleEntry, name: string ): Promise<void>;

			/** The "Remove" button in an instance row (two-step confirmation) */
			_createRemoveInstanceButton( row: HTMLElement, entry: Types.ModuleEntry, name: string ): HTMLButtonElement;

			/** A "Remove" button with a two-step confirmation; onConfirm after the second click */
			_createRemoveButton( onConfirm: () => void ): HTMLButtonElement;

			/** A button with a two-step confirmation: the first click shows confirmLabel, the second one within a few seconds calls onConfirm */
			_createConfirmButton( label: string, confirmLabel: string, className: string, onConfirm: ( button: HTMLButtonElement ) => void ): HTMLButtonElement;

			/** The two-step confirmation on an existing button: the first click shows confirmLabel(), the second one within a few seconds calls onConfirm */
			_requireSecondClick( button: HTMLButtonElement, confirmLabel: () => string, onConfirm: ( button: HTMLButtonElement ) => void ): void;

			/** Removes an instance from the module list including its settings */
			_removeModuleInstance( row: HTMLElement, entry: Types.ModuleEntry, name: string ): Promise<void>;

			/**
			 * Disables output settings that make no sense (a turned-off module, no location, the sidebar with "Do not use the
			 * sidebar", a collapsible frame), and below
			 * the output locations explains why the module is not shown anywhere
			 */
			_syncOutputSettingsState( row: ParentNode ): void;

			/** <fieldset> s <legend> a volbami vedle sebe (.module-row-group-options) */
			_createFieldGroup( legendText: string, className: string, controls: HTMLElement[] ): HTMLFieldSetElement;

			/**
			 * "Dependencies" at the end of a module row — modules it depends on (dependsOn) and modules that depend on it,
			 * data exchange through the details contract (consumesDetails/details) and optional permissions (usesPermissions)
			 */
			_createDependenciesField( moduleDef: Types.ModuleDefinition ): HTMLFieldSetElement;

			/**
			 * "Show module output" — a checkbox for each location (DISPLAY_LOCATIONS) and a hidden sentence for the state
			 * when the module is not shown anywhere; locations from recommendedLocations have "(recommended by the module)" after the text
			 */
			_createDisplayLocationsField( moduleKey: string, locations: Enums.RenderLocation[], recommendedLocations: Enums.RenderLocation[], legendText?: string ): HTMLFieldSetElement;

			/**
			 * The second set of output locations of a module this client offers its provider — where it is shown here while the
			 * provider shows it too (delegatedDisplayLocation, see getModuleDelegatedDisplayLocations() in base.mjs)
			 */
			_createDelegatedDisplayLocationsField( moduleKey: string, locations: Enums.RenderLocation[] ): HTMLFieldSetElement;

			/** The legend of the second set of output locations with the provider's name (_serviceProviderName) */
			_describeDelegatedDisplayLocations( fieldset: Element ): void;

			/** Does the module row get the second set of output locations — a module from the package this client offers its provider */
			_offersToProvider( moduleDef: Types.ModuleDefinition | undefined ): boolean;

			/**
			 * <label>Text<select>…</select></label> of one module setting; the option equal to recommendedValue
			 * (the default value declared by the module) has "(recommended by the module)" after the text
			 */
			_createLabeledSelect( labelText: string, selectClassName: string, moduleKey: string, options: Types.LabeledSelectOption[], selectedValue: string, recommendedValue?: string ): HTMLLabelElement;

			/** <label><input type="checkbox">Text</label> of one module setting */
			_createLabeledCheckbox( labelText: string, checkboxClassName: string, moduleKey: string, checked: boolean ): HTMLLabelElement;

			/** Reordering modules by dragging their heading */
			_initDragToReorder(): void;

			/** The row BEFORE which the dragged row should be inserted; null = at the end */
			_rowAfterPoint( y: number ): Element | null;

			/** Saves the row order as a new module list and shows the status message */
			_persistModuleOrder( status?: string ): Promise<void>;

			/** Imports the modules and re-renders both sections that depend on the module list */
			_refreshModules( paths: string[], settings: Types.ModuleSettings ): Promise<void>;

			/** After a change of the module list outside the editor: the editor, default settings and both sections */
			_reloadModulesList(): Promise<void>;

			/** Hands the chosen file to the core (installSandboxModule()) and shows the result */
			_uploadSandboxModule(): Promise<void>;

			/** The result of an upload below the file input */
			_showSandboxReport( report: Types.SandboxReport ): void;

			/** The list of uploaded modules */
			_renderSandboxModules(): Promise<void>;

			/** The section "Modules from other extensions": the provider of this client, or the clients of this provider */
			_renderExtensionServices(): Promise<void>;

			/** What the service provider of this extension shows */
			_describeServiceProvider( state: Types.ExtensionServiceProviderState ): HTMLDivElement;

			/** One extension that offers its modules, with the buttons of the decision */
			_createServiceClientItem( client: Types.ExtensionServiceClient, alive: boolean ): HTMLLIElement;

			/** One uploaded module in the list (listed = it is in the module list) */
			_createSandboxModuleItem( record: Types.SandboxModuleRecord, listed: boolean, intact: boolean ): HTMLLIElement;

			/** The functions outside the sandbox of an uploaded module with the user's choices and their record; null = none */
			_createSandboxCapabilities(
				record: Types.SandboxModuleRecord,
				grants: Types.SandboxCapabilityGrants,
				entries: Types.SandboxCapabilityLogEntry[],
			): HTMLDivElement | null;

			/** The <select> of the user's decision about one function outside the sandbox */
			_createSandboxCapabilityChoice( record: Types.SandboxModuleRecord, name: string, grants: Types.SandboxCapabilityGrants ): HTMLSelectElement;

			/** The record of one function as one line (outcomes with counts, the last time); "" = no record */
			_describeSandboxCapabilityUse( entries: Types.SandboxCapabilityLogEntry[] ): string;

			/** Adds an uploaded module to the module list */
			_addSandboxModuleToList( name: string ): Promise<void>;

			/** Removes an uploaded module (with its list entries and settings) */
			_removeSandboxModule( name: string ): Promise<void>;

			/** Renders the form of custom module settings according to their settingsSchema */
			renderModuleSettings( moduleDefs: Types.ModuleDefinition[], settings: Types.ModuleSettings ): void;

			/** The settings block of one module: the heading with the reset button and its settingsSchema fields */
			_createModuleSettingsBlock( mod: Types.ModuleDefinition, settings: Types.ModuleSettings ): HTMLDivElement;

			/** The editor a module renders itself (settingsView): its element with location "settings" in the module's block */
			_mountSettingsView( mod: Types.ModuleDefinition, block: HTMLElement, settings: Types.ModuleSettings ): void;

			/** A settings field with a label; the value is under getModuleSettingKey(moduleKey, field.key) */
			_createSettingRow( field: Types.SettingField, moduleKey: string, settings: Types.ModuleSettings, controlClassName: string ): HTMLDivElement;

			/** A shared field (SettingField.shared) changed — the same field of the other modules gets its value */
			_syncSharedControls( source: Types.SettingControl ): void;

			/** The control of one settings field according to its type (moduleKey: the module, or "<module>#<id>" of an instance) */
			_createSettingControl( field: Types.SettingField, value: unknown, settings: Types.ModuleSettings, moduleKey: string ): Types.SettingControl;

			/** The module's custom editor; on an error a replacement element that returns the original value */
			_createCustomControl( field: Types.CustomSettingField, value: unknown, settings: Types.ModuleSettings ): Types.CustomSettingControl;

			/** A table of checkboxes; under it the state of the notifications while a cell of a column with notifications: true is checked */
			_createCheckboxTableControl( field: Types.CheckboxTableSettingField, value: unknown, moduleName: string ): Types.CheckboxTableControl;

			/** The line with the state of the notifications (and a button that asks for them) — shown while wanted() holds, refreshed on a change of the checkboxes and of the permissions */
			_createNotificationsLine( moduleName: string, checkboxes: HTMLInputElement[], wanted: () => boolean ): HTMLDivElement;

			/** The current value of a settings control */
			_readSettingControlValue( el: Types.SettingControl ): unknown;

			/** The values of the custom module settings under root, by storage key (what "Save module settings" stores) */
			_readModuleSettingValues( root: ParentNode ): Types.ModuleSettings;

			/** The values of the module rows under root — mode, output locations, frame, heading, instance fields — by storage key (what "Save settings" stores) */
			_readModuleListValues( root: ParentNode ): Types.ModuleSettings;

			/** The form element of a section with the floating "Save" */
			_savedFormRoot( section: Types.SavedFormSection ): HTMLElement;

			/** Listens to the changes of the forms of both sections with the floating "Save" (see _syncUnsavedChanges()) */
			_initUnsavedChanges(): void;

			/** Plans _syncUnsavedChanges() of the section after the current event (several events in a row = one check) */
			_scheduleUnsavedCheck( section: Types.SavedFormSection ): void;

			/** Takes the current values of the section's form (all, or just those under root) as saved and refreshes the reminder */
			_markSaved( section: Types.SavedFormSection, root?: ParentNode ): void;

			/** Shows the reminder above "Save" while a value of the section's form differs from the saved one */
			_syncUnsavedChanges( section: Types.SavedFormSection ): void;

			/** Saves the custom module settings */
			saveModuleSettings(): Promise<void>;

			/** Resets the custom module settings to the default values (default-settings.json, otherwise settingsSchema) */
			resetModuleSettings(): Promise<void>;

			/** Resets one module (the reset button in its block, resetModule()) and creates its rows, block and elements on this page anew */
			_resetSingleModule( moduleName: string, button: HTMLButtonElement ): Promise<void>;

			/** Default settings from default-settings.json; an empty object when it cannot be loaded */
			_loadDefaultSettings(): Promise<Types.ModuleSettings>;

			/** A status message for duration ms */
			_showStatus( text: string, duration?: number ): void;

			/** Saves the modes, output locations, frames and headings of all modules */
			save(): Promise<void>;

			/** Resets the modes, output locations, frames and headings of the list entries to the default values */
			reset(): Promise<void>;

			/** Stores "Do not use the sidebar" and applies it to the browser (Firefox closes the sidebar, Chrome turns its panel off) */
			_setSidebarDisabled( disabled: boolean ): Promise<void>;

			/** Shows the stored "Do not use the sidebar" — the checkbox and the output locations of the module rows */
			_showSidebarDisabled( disabled: boolean ): void;


			/** Makes the tab bar from the section headings, the accordion buttons and opens the last chosen section (the stored frame states) */
			_initSectionTabs(): void;

			/** The sections of the page in their order */
			_sections(): HTMLElement[];

			/** Opens the section (null = closes all in the accordion) and remembers it for the next opening of Settings */
			_activateSection( id: string | null ): void;

			/** Shows the open section by the choice and the screen width — the tabs, the accordion buttons */
			_syncSectionTabs(): void;

			/** Marks "Module output" as empty when it has no module frame (its tab and accordion button disabled) */
			_syncOutputSection(): void;

			/** Opens the section with the element and scrolls to it */
			_revealTarget( target: HTMLElement | null ): void;

			/** _revealTarget() for the element of the address fragment (options.html#<id>) */
			_revealHashTarget(): void;

			/** Opens the section of the element first */
			scrollToSettingsSection( id: string ): void;

			/** Filters while typing and after every rendering of the module elements */
			_initModuleFilter(): void;

			/** Shows the filter (from MODULE_FILTER_MIN modules on) and fills the suggestions with the names of the modules in the list */
			_updateModuleFilter( paths: string[] ): void;

			/** Hides the module elements whose name or id does not contain the filter text */
			_applyModuleFilter(): void;

			/** Fills the whole page */
			initPage(): Promise<void>;

		}

	}

}

export { };
