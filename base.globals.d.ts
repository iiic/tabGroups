declare namespace Enums {
	type ActivationMode = "background" | "focus" | "icon_click" | "popup" | "install" | "disabled";
	type RenderLocation = "popup" | "sidebar" | "options" | "onboarding";
	type SettingFieldType = "text" | "textarea" | "number" | "checkbox" | "select" | "custom";
	type UiLanguage = "en" | "cs" | "sk" | "de" | "el";
}

declare namespace Types {
	type WithFields<T extends typeof HTMLElement, Fields> = T & (
		new ( ...args: ConstructorParameters<T> ) => InstanceType<T> & Fields
	);
	type SpecificationContext = {
		mode: Enums.ActivationMode;
		url?: string;
		hostAccess?: boolean;
		location?: Enums.RenderLocation;
	};
	type ModuleSettings = Record<string, unknown>;
	type PageContext = { url: string; hostAccess?: boolean };
	type ModuleSlot = {
		mod: ModuleDescriptor;
		key: string;
		instance: string | null;
		mode: Enums.ActivationMode;
		anchor: Comment;
		frame: HTMLElement | null;
	};
	type PermissionSet = chrome.permissions.Permissions;
	type ActivationModeOption = { value: Enums.ActivationMode; label: string };
	type DisplayLocationOption = { value: Enums.RenderLocation; label: string };
	type OutputElementOption = {
		value: "inline" | "block" | "indented" | "details-closed" | "details-open";
		label: string;
		collapsible?: boolean;
		open?: boolean;
	};
	type UiLanguageOption = { value: Enums.UiLanguage; label: string };

	type SettingField = {
		key: string;
		label: string;
		type: Enums.SettingFieldType;
		default?: unknown;
		placeholder?: string;
		options?: Array<{ value: string; label: string }>;
		render?: ( value: unknown, settings: ModuleSettings ) => HTMLElement;
	};
	type ModuleDescriptor = {
		name: string;
		tag: string;
		description?: string;
		styles?: string[];
		activationSpec?: Classes.Specification;
		defaultActivationMode?: Enums.ActivationMode;
		defaultDisplayLocation?: Enums.RenderLocation | Enums.RenderLocation[] | "none";
		defaultOutputElement?: Types.OutputElementOption["value"];
		defaultShowHeading?: boolean;
		settingsSchema?: SettingField[];
		usesPermissions?: PermissionSet[];
		pageInit?: ( context: { api: ModuleApi; location: Enums.RenderLocation } ) => void | Promise<void>;
		[key: string]: unknown;
	};

	type ModuleStateApi = {
		get<T = unknown>( key: string, defaultValue?: T ): Promise<T>;
		set( key: string, value: unknown ): Promise<void>;
	};
	type ModuleApi = {
		settings: {
			get<T = unknown>( key: string, defaultValue?: T ): Promise<T>;
			onChange( handler: ( settings: ModuleSettings ) => void ): () => void;
		};
		state: ModuleStateApi;
		sessionState: ModuleStateApi;
		activation: {
			isActive( defaultMode?: Enums.ActivationMode, activationSpec?: Classes.Specification ): Promise<boolean>;
			onChange( handler: () => void ): () => void;
		};
		messages: {
			on<T extends string>(
				type: T,
				handler: ( message: AnyMessage, sender: chrome.runtime.MessageSender, sendResponse: ( response?: MessageResponse<T> ) => void ) => boolean | void
			): () => void;
			send<T extends AnyMessage>( message: T ): Promise<MessageResponse<T["type"]> | undefined>;
		};
		permissions: {
			contains( permissions: PermissionSet ): Promise<boolean>;
			request( permissions: PermissionSet ): Promise<boolean>;
			onChange( handler: () => void ): () => void;
		};
	};
	type ModuleEntry = { entry: string; path: string; name: string; instance: string | null; key: string };
	type ResolvedModuleEntry = ModuleEntry & { mod: ModuleDescriptor };
	type ModuleRowCandidate = { offset: number; row: Element | null };
	type CustomSettingControl = HTMLElement & { getValue(): unknown };
	type FallbackSettingControl = HTMLElement & { getValue(): unknown };
	type ValueSettingControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
	type SettingControl = ValueSettingControl | CustomSettingControl | FallbackSettingControl;
	type StorageLocal = Record<string, unknown>;
	type StorageChangeListener = ( changes: Record<string, chrome.storage.StorageChange>, area: string ) => void;
	type PermissionsChangeListener = ( permissions: chrome.permissions.Permissions ) => void;
	type RuntimeMessageListener = ( message: unknown, sender: chrome.runtime.MessageSender, sendResponse: ( response?: unknown ) => void ) => boolean | void;
	type FrameState = { open: boolean; element: string; seen: number };
	type FrameStateStore = Record<string, FrameState>;
	type AnyMessage = { type: string;[key: string]: unknown };
	type MessageResponse<T extends string> =
		T extends "TAB_GROUPS_REGROUP_NOW" ? TabGroups.RegroupResult
		: T extends "TAB_GROUPS_IDENTIFY" ? TabGroups.IdentifyResult
		: Record<string, unknown>;
}

declare namespace Classes {
	interface Specification {
		isSatisfiedBy( context: Types.SpecificationContext ): boolean;
		and( other: Specification ): AndSpecification;
	}
	interface AndSpecification extends Specification {
		_specs: Specification[];
	}
	interface LocationSpecification extends Specification {
		_locations: Enums.RenderLocation[];
	}
	interface DisabledSpecification extends Specification { }
	interface IsNotDisabled extends Specification { }
	interface BaseElement extends HTMLElement {
		_name: string;
		_mode: Enums.ActivationMode;
		_instance: string | null;
		_location: Enums.RenderLocation;
		activationSpec: Specification | undefined;
		api: Types.ModuleApi;
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
		isActivationSatisfied( mode?: Enums.ActivationMode ): boolean;
	}
	namespace BaseElement {
		type Fields = Pick<BaseElement, "_name" | "_mode" | "_instance" | "_location" | "activationSpec" | "api">;
		const observedAttributes: string[];
	}
	interface BaseController {
		_settings: Types.ModuleSettings;
		loadSettings(): Promise<Types.ModuleSettings>;
		saveSettings( settings: Types.ModuleSettings ): Promise<void>;
		getModulesJson(): Promise<string>;
		fetchDefaultModulesJson(): Promise<string>;
		fetchDefaultSettings(): Promise<Types.ModuleSettings>;
		seedDefaultSettings( paths: string[] ): Promise<Types.ModuleSettings>;
		saveModulesJson( text: string ): Promise<void>;
		getModuleKey( path: string ): string;
		formatModuleName( key: string ): string;
		getModuleMode( settings: Types.ModuleSettings, moduleName: string, moduleDefaultMode?: Enums.ActivationMode ): Enums.ActivationMode;
		buildPageContext(): Promise<Types.PageContext>;
		buildActivationContext( mode: Enums.ActivationMode ): Promise<Types.SpecificationContext>;
		isModuleActive(
			module: Types.ModuleDescriptor,
			settings: Types.ModuleSettings,
			location: Enums.RenderLocation,
			page?: Types.PageContext,
			key?: string
		): Promise<{ active: boolean; mode: Enums.ActivationMode; ctx: Types.SpecificationContext }>;
		importModuleFiles( paths: string[] ): Promise<Types.ModuleDescriptor[]>;
		runPageInits( settings: Types.ModuleSettings, location: Enums.RenderLocation ): void;
		loadModuleStyles( module: Types.ModuleDescriptor ): void;
		mountModuleElement(
			module: Types.ModuleDescriptor,
			settings: Types.ModuleSettings,
			output: HTMLElement,
			before?: Node | null,
			key?: string
		): HTMLElement;
		renderModulesFor( location: Enums.RenderLocation, output: HTMLElement ): Promise<void>;
		_updateModuleSlot(
			slot: Types.ModuleSlot,
			settings: Types.ModuleSettings,
			location: Enums.RenderLocation,
			output: HTMLElement,
			page: Types.PageContext
		): Promise<void>;
		_followActiveTab( update: () => unknown ): void;
	}
}

declare namespace Functions {
	namespace Base {
		type registerBackgroundScript = ( definition: {
			name: string;
			setup: ( input: { api: Types.ModuleApi } ) => void | Promise<void>;
		} ) => void;
		type createModuleApi = ( moduleName: string, instance?: string | null ) => Types.ModuleApi;
		namespace createModuleApi {
			type readAllSettings = () => Promise<Types.ModuleSettings>;
			type createStateArea = ( areaName: "local" | "session" ) => Types.ModuleStateApi;
			namespace createStateArea {
				type storageArea = () => chrome.storage.StorageArea;
			}
			type isListed = () => Promise<boolean>;
		}
		type parseDisplayLocations = ( value: unknown ) => Enums.RenderLocation[] | null;
		type getModuleDisplayLocations = (
			settings: Types.ModuleSettings,
			moduleName: string,
			moduleDefaultLocation?: Enums.RenderLocation | Enums.RenderLocation[] | "none"
		) => Enums.RenderLocation[];
		type getOutputElementDef = ( value: unknown ) => Types.OutputElementOption;
		type getModuleOutputElement = (
			settings: Types.ModuleSettings,
			moduleName: string,
			moduleDefault?: Types.OutputElementOption["value"]
		) => Types.OutputElementOption["value"];
		namespace getModuleOutputElement {
			type isValid = ( value: unknown ) => value is Types.OutputElementOption["value"];
		}
		type getModuleShowHeading = ( settings: Types.ModuleSettings, moduleName: string, moduleDefault?: boolean ) => boolean;
		type getModuleSettingKey = ( moduleName: string, fieldKey: string ) => string;
		type getModuleKey = ( path: string ) => string;
		type getModuleInstanceKey = ( moduleName: string, instance: string | null ) => string;
		type parseModuleEntry = ( entry: string ) => Types.ModuleEntry;
		type createModuleInstanceId = () => string;
		type resolveModuleEntries = ( paths: string[] ) => Types.ResolvedModuleEntry[];
		type getModuleStateKey = ( moduleName: string, key: string ) => string;
		type getTagName = ( name: string ) => string;
		type formatModuleName = ( key: string ) => string;
		type validateModuleFileExtension = ( path: string ) => Promise<boolean>;
		type looksLikeEsModuleSource = ( source: string ) => boolean;
		type validateModule = ( module: Types.ModuleDescriptor ) => { errors: string[]; warnings: string[] };
		type pruneFrameStates = ( store: unknown, now?: number ) => Types.FrameStateStore;
		type readFrameStates = () => Promise<Types.FrameStateStore>;
		type loadFrameStates = () => Promise<Types.FrameStateStore>;
		type queueFrameState = ( key: string, entry: Types.FrameState | null ) => Promise<void>;
		type bindFrameState = ( frame: HTMLElement, key: string, outputElement: Types.OutputElementOption ) => void;
	}
}
