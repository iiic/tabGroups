declare namespace Classes {
	interface OptionsController extends BaseController {
		outputEl: HTMLElement;
		container: HTMLDivElement;
		saveBtn: HTMLButtonElement;
		resetBtn: HTMLButtonElement;
		statusEl: HTMLElement;
		jsonTextareaEl: HTMLTextAreaElement;
		saveJsonBtn: HTMLButtonElement;
		resetJsonBtn: HTMLButtonElement;
		modulesDiffEl: HTMLDivElement;
		_modulesDiffRun: number;
		moduleSettingsContainer: HTMLDivElement;
		saveModuleSettingsBtn: HTMLButtonElement;
		resetModuleSettingsBtn: HTMLButtonElement;
		_moduleDefs: Types.ModuleDescriptor[];
		_draggedRow: Element | null;
		loadModulesListEditor(): Promise<void>;
		_showModulesListDiff(): Promise<void>;
		_compareModuleLists( userList: string[], defaultList: string[] ): { extra: string[]; missing: string[] };
		saveModulesList(): Promise<void>;
		resetModulesList(): Promise<void>;
		renderModules( modules: string[], settings: Types.ModuleSettings ): void;
		_createModuleRow( path: string, settings: Types.ModuleSettings, moduleDef?: Types.ModuleDescriptor ): HTMLDivElement;
		_createDependenciesField( moduleDef: Types.ModuleDescriptor ): HTMLFieldSetElement;
		_createAddInstanceButton( templateRow: HTMLElement, entry: Types.ModuleEntry, name: string ): HTMLButtonElement;
		_addModuleInstance( templateRow: HTMLElement, entry: Types.ModuleEntry, name: string ): Promise<void>;
		_createRemoveInstanceButton( row: HTMLElement, entry: Types.ModuleEntry, name: string ): HTMLButtonElement;
		_removeModuleInstance( row: HTMLElement, entry: Types.ModuleEntry, name: string ): Promise<void>;
		_syncOutputSettingsState( row: Element ): void;
		_createFieldGroup( legendText: string, className: string, controls: Node[] ): HTMLFieldSetElement;
		_createDisplayLocationsField(
			moduleKey: string,
			locations: Enums.RenderLocation[],
			recommendedLocations: Enums.RenderLocation[]
		): HTMLFieldSetElement;
		_createLabeledSelect(
			labelText: string,
			selectClassName: string,
			moduleKey: string,
			options: Array<{ value: string; label: string }>,
			selectedValue: string,
			recommendedValue?: string
		): HTMLLabelElement;
		_createLabeledCheckbox( labelText: string, checkboxClassName: string, moduleKey: string, checked: boolean ): HTMLLabelElement;
		_initDragToReorder(): void;
		_rowAfterPoint( y: number ): Element | null;
		_persistModuleOrder( status?: string ): Promise<void>;
		_refreshModules( paths: string[], settings: Types.ModuleSettings ): Promise<void>;
		renderModuleSettings( moduleDefs: Types.ModuleDescriptor[], settings: Types.ModuleSettings ): void;
		_createSettingRow( field: Types.SettingField, moduleKey: string, settings: Types.ModuleSettings, controlClassName: string ): HTMLDivElement;
		_createSettingControl( field: Types.SettingField, value: unknown, settings: Types.ModuleSettings ): Types.SettingControl;
		_createCustomControl(
			field: Types.SettingField,
			value: unknown,
			settings: Types.ModuleSettings
		): Types.CustomSettingControl | Types.FallbackSettingControl;
		_readSettingControlValue( element: Types.SettingControl ): unknown;
		saveModuleSettings(): Promise<void>;
		resetModuleSettings(): Promise<void>;
		_loadDefaultSettings(): Promise<Types.ModuleSettings>;
		_showStatus( text: string, duration?: number ): void;
		save(): Promise<void>;
		reset(): Promise<void>;
		initPage(): Promise<void>;
	}
}
