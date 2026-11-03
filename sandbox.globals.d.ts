/**
 * @file sandbox.globals.d.ts
 * @description Global TypeScript declarations for sandbox.js — the runtime of the sandboxed page (sandbox.html) in
 * which an uploaded module runs: the package of the module, the SDK the module gets (sandboxSdk), the api that asks
 * the core, the serializable Specification Pattern and the message protocol with the core (SandboxModuleElement in
 * base.mjs).
 */

declare global {

	/**
	 * The SDK of an uploaded module — sandbox.js passes it to the evaluated module code (a JS module imports the same
	 * from "../../sdk.mjs"). It is the module's only way to the extension: everything privileged goes through
	 * this.api of its element as a request to the core.
	 */
	const sandboxSdk: Types.SandboxSdk;

	namespace Enums {

		/** What went wrong with an uploaded module in the sandbox — the core turns it into a text (describeSandboxProblem()). */
		type SandboxProblemCode =
			| 'notSandboxed'
			| 'evalBlocked'
			| 'evaluation'
			| 'noRegistration'
			| 'multipleRegistrations'
			| 'notObject'
			| 'nameMismatch'
			| 'tagMismatch'
			| 'notDefined'
			| 'notBaseElement'
			| 'unsupported'
			| 'customField'
			| 'notData'
			| 'badSpec'
			| 'badStyle'
			| 'initFailed';

		/** Kind of an api method of an uploaded module: a request with one response, or a listener (onChange). */
		type SandboxApiKind = 'call' | 'subscribe';

		/**
		 * The state of a function outside the sandbox for an uploaded module (SANDBOX_CAPABILITIES in base.mjs): allowed,
		 * allowed but not working here (this browser or surface does not support it), denied by the user, waiting for the
		 * user's decision, not declared by the module, one that cannot be allowed, or one the core does not offer.
		 */
		type SandboxCapabilityState = 'allowed' | 'unavailable' | 'denied' | 'pending' | 'undeclared' | 'forbidden' | 'unknown';

		/** Where the core puts the buttons it draws for an uploaded module: at the start of the line, or at its end. */
		type SandboxButtonsAlign = 'start' | 'end';

		/** How the entry file of an uploaded module is evaluated: a classic script (.js) or a JS module (.mjs). */
		type SandboxModuleFormat = 'script' | 'module';

	}

	namespace Types {

		/**
		 * The api of an uploaded module (this.api of its element) — the part of Types.ModuleApi the core runs for it.
		 * Only what works with the module's own data or only reads; see SANDBOX_API in base.mjs.
		 */
		interface SandboxModuleApi {

			/** Own settings only — getMode() takes the module's default mode by itself, onChange() gets only the module's keys */
			settings: Pick<ModuleSettingsApi, 'get' | 'set' | 'getMode' | 'onChange'>;
			state: ModuleStateApi;
			sessionState: ModuleStateApi;

			/** isActive() evaluates the activation rule and the default mode the module registered */
			activation: {
				isActive(): Promise<boolean>;
				onChange( handler: () => void ): () => void;
			};
			notifications: Pick<ModuleNotificationsApi, 'show' | 'onClick'>;
			data: ModuleDataApi;
			rateLimit: ModuleRateLimitApi;
			tabs: ModuleTabsApi;
			permissions: Pick<ModulePermissionsApi, 'contains' | 'onChange'>;
			details: ModuleDetailsApi;
			network: Pick<ModuleNetworkApi, 'getIpForActiveTab'>;

			/**
			 * Functions outside the sandbox — declared in registerModule({ capabilities }), run by the core only when the user
			 * allows them in Settings (the request is recorded either way).
			 */
			capabilities: {

				/** Asks the core to run the function ("tabs.create", …); a refused one rejects with the reason */
				call( name: string, ...args: unknown[] ): Promise<unknown>;

				/**
				 * Subscribes to a listener of the catalog ("floatingWindow.onChange", …) — the handler is the last argument;
				 * returns a function to unsubscribe. A refused one gets no events (the reason is in the console), and none
				 * while the user denies the function afterwards.
				 */
				listen( name: string, ...argsAndHandler: [ ...args: unknown[], handler: ( value: unknown ) => void ] ): () => void;

				/** The states of the declared functions */
				state(): Promise<Record<string, Enums.SandboxCapabilityState>>;

				/** The states again after the user changes a decision; returns a function to unsubscribe */
				onChange( handler: ( states: Record<string, Enums.SandboxCapabilityState> ) => void ): () => void;
			};

			/**
			 * Buttons the core draws for the module, above its frame, in the extension page itself: a click on one runs its
			 * function outside the sandbox right in the handler of the click — the only way to the functions the browser
			 * allows only there (popup.open, sidebar.toggle, floatingWindow.toggle; a call of them is refused).
			 */
			buttons: {

				/** Draws these buttons instead of the previous ones (an empty list removes them); a button keeps its id */
				set( buttons: SandboxButtonDefinition[], options?: { align?: Enums.SandboxButtonsAlign } ): Promise<void>;

				/** The result of every click on a drawn button; returns a function to unsubscribe */
				onClick( handler: ( click: SandboxButtonClick ) => void ): () => void;
			};

			/**
			 * Content the core draws for the module in the extension page itself instead of its frame — described as data
			 * (never HTML), drawn in the look of the page; its controls report back. The frame keeps running, hidden.
			 */
			ui: {

				/** Draws this content instead of the previous one (the same content does nothing); null shows the frame again */
				render( content: SandboxUiContent | null ): Promise<void>;

				/**
				 * A click, a change of a checkbox, details opened or closed by the user, the pointer or the focus come to the
				 * content ("enter"); returns a function to unsubscribe. A button with a function reports to buttons.onClick() instead
				 */
				onEvent( handler: ( event: SandboxUiEvent ) => void ): () => void;

				/**
				 * Scrolls the extension page (the side panel, the floating window, …) so that the module's output is at its top —
				 * only that page, never the web page around the floating window; with its frame as well as with the drawn content
				 */
				scrollIntoView( options?: { offset?: number } ): Promise<void>;
			};

		}

		/** Text of the drawn content: one string, or a list of inline nodes. */
		type SandboxUiTextInput = string | SandboxUiInlineInput[];

		/** An inline node of the drawn content (api.ui.render()) — the ids of the controls are unique in the content. */
		type SandboxUiInlineInput =
			| string

			/** itemprop — the text is a property of the nearest item of microdata ("text" is a text without a look of its own) */
			| { type: 'strong' | 'em' | 'code' | 'text'; text: string; itemprop?: string }

			/**
			 * An item of microdata in a line (<span itemscope>): its schema.org type ("https://schema.org/PropertyValue"), the
			 * property of the parent item it is, properties without a visible text (<meta>) and the nodes inside
			 */
			| {
				type: 'item';
				itemtype: string;
				itemprop?: string;
				meta?: Array<{ itemprop: string; content: string }>;
				content: SandboxUiTextInput;
			}
			| {
				type: 'link';
				text: string;
				href: string;
				title?: string;

				/** Greyed out (e.g. a tool that does not support the page) — still a link */
				muted?: boolean;
			}
			| {
				type: 'button';
				id: string;
				label: string;
				title?: string;
				disabled?: boolean;

				/** "link" = drawn like a link (still a button); "button" by default */
				look?: 'button' | 'link';

				/**
				 * A function the module declared — the click runs it within the click, like a button of api.buttons (also those
				 * the browser allows only there), the result goes to buttons.onClick(); without it the click goes to ui.onEvent()
				 */
				capability?: string;
				args?: unknown[];
			}
			| { type: 'checkbox'; id: string; label: string; title?: string; checked?: boolean; disabled?: boolean };

		/** A block that starts an item of microdata: its schema.org type and the property of the parent item it is. */
		type SandboxUiItemInput = { item?: { itemtype: string; itemprop?: string } };

		/** A node of the drawn content: a block or an inline node. */
		type SandboxUiNodeInput =
			| SandboxUiInlineInput
			| ( SandboxUiItemInput & (
				| { type: 'paragraph' | 'heading'; content: SandboxUiTextInput }
				| { type: 'list'; ordered?: boolean; items: SandboxUiTextInput[] }
				| { type: 'definitions'; items: Array<{ term: SandboxUiTextInput; details: SandboxUiTextInput }> }
				| { type: 'table'; caption?: SandboxUiTextInput; head?: SandboxUiTextInput[]; rows: SandboxUiTextInput[][] }
				| { type: 'details'; id?: string; open?: boolean; summary: SandboxUiTextInput; content: SandboxUiNodeInput[] }
				| { type: 'group'; content: SandboxUiNodeInput[] }
			) );

		/** The content of api.ui.render() — the nodes in order. */
		type SandboxUiContent = SandboxUiNodeInput[];

		/** A button an uploaded module asks the core to draw (api.buttons.set()). */
		type SandboxButtonDefinition = {

			/** Unique among the buttons of the module: letters, digits, "_" and "-", at most 64 */
			id: string;

			/** The text of the button (at most 100 characters) and its tooltip (at most 300) */
			label: string;
			title?: string;

			/** A disabled button does nothing — e.g. with the reason in title */
			disabled?: boolean;

			/** A function outside the sandbox the module declared, and its arguments (data only) */
			capability: string;
			args?: unknown[];
		};

		/** A click on a button the core drew: the result of its function, or the error (a refused or failed one). */
		type SandboxButtonClick = {
			id: string;
			capability: string;
			ok: boolean;
			value?: unknown;
			error?: string;
		};

		/**
		 * Name of an api method of an uploaded module ("settings.get", "data.log", …) — capabilities.call() and
		 * capabilities.listen() are added by the sandbox itself, every other name it sends is a function outside the sandbox.
		 */
		type SandboxApiMethod = Exclude<
			{ [A in keyof SandboxModuleApi]: `${ A }.${ keyof SandboxModuleApi[A] & string }` }[keyof SandboxModuleApi],
			'capabilities.call' | 'capabilities.listen'
		>;

		/** A custom settings field of an uploaded module — data only (Settings renders it), a "custom" editor is code. */
		type SandboxSettingField = SimpleSettingField | SelectSettingField | CheckboxTableSettingField;

		/**
		 * What an uploaded module passes to sandboxSdk.registerModule() — the same as Types.ModuleDefinition, but data
		 * only: no pageInit, details, backupData and custom editors (they would be code outside the sandbox); styles are
		 * CSS files of its package (paths in the package or new URL("./x.css", import.meta.url).href); capabilities are
		 * the functions outside the sandbox it asks for.
		 */
		type SandboxModuleDefinition = Omit<
			ModuleDefinition,
			'activationSpec' | 'settingsSchema' | 'instanceSettingsSchema' | 'pageInit' | 'details' | 'backupData' | 'sandbox'
		> & {
			activationSpec?: Classes.SandboxSpecification;
			settingsSchema?: SandboxSettingField[];
			instanceSettingsSchema?: SandboxSettingField[];
		};

		/**
		 * registerModule() of an uploaded module as data — the activation rule as a descriptor (stored, see
		 * SandboxModuleRecord); styles only stay in the sandbox.
		 */
		type SandboxRegistration = Omit<SandboxModuleDefinition, 'activationSpec' | 'styles'> & { activationSpec?: SpecificationDescriptor };

		/** A file of the package of an uploaded module: its type (set by the core) and its bytes. */
		type SandboxPackageFile = { type: string; data: Uint8Array<ArrayBuffer> };

		/** The files of a package: path in the package ("img/logo.svg") → file. */
		type SandboxPackageFiles = Record<string, SandboxPackageFile>;

		/** What a package contains: the module name, its entry file and how it is evaluated, its files. */
		type SandboxPackageContent = {

			/** Module name == the entry file without .js/.mjs */
			name: string;
			entry: string;
			format: Enums.SandboxModuleFormat;
			files: SandboxPackageFiles;
		};

		/** A place in a JS module of the package to rewrite: a file of the package, the SDK, or import.meta. */
		type SandboxRewriteTarget = { kind: 'file'; path: string } | { kind: 'sdk' } | { kind: 'meta' };

		/** One place to rewrite: [start, end) in the text of the file (UTF-16 code units, after a BOM). */
		type SandboxRewrite = { start: number; end: number; target: SandboxRewriteTarget };

		/** How the sandbox loads a JS module of the package: its files, dependencies first, and the places to rewrite in each. */
		type SandboxModulePlan = { order: string[]; rewrites: Record<string, SandboxRewrite[]> };

		/**
		 * The stored package of an uploaded module (IndexedDB, see SANDBOX_PACKAGES_DB in base.mjs) — what the sandbox
		 * gets to run it.
		 */
		type SandboxPackage = SandboxPackageContent & {

			/** SHA-256 of the uploaded file — the same as in its record in chrome.storage.local */
			hash: string;

			/** For a JS module (format "module"); null for a classic script */
			plan: SandboxModulePlan | null;
		};

		/** The module's own texts: language → key → text ($1–$9, "$$" = "$"; plural forms <key>_one/_few/_many/_other). */
		type SandboxMessageTables = Partial<Record<Enums.UiLanguage, Record<string, string>>>;

		/** Argument of init() of an uploaded module's element (as Types.ModuleInitOptions, outputEl is the sandbox's root). */
		type SandboxModuleInitOptions = {
			outputEl: HTMLElement;
			name: string;
			mode: Enums.ActivationMode;
			location?: Enums.ElementLocation;
			instance?: string | null;
		};

		/** Core constants the sandbox gets with the module (permission sets for usesPermissions and permissions.contains()). */
		type SandboxConstants = {
			PAGE_ACCESS_PERMISSIONS: PermissionSet;
			BOOKMARKS_PERMISSIONS: PermissionSet;
			WEBREQUEST_PERMISSIONS: PermissionSet;
			WEBNAVIGATION_PERMISSIONS: PermissionSet;
			NETWORK_RULES_PERMISSIONS: PermissionSet;
			CONTENT_FILTERS_PERMISSIONS: PermissionSet;
			USER_SCRIPTS_PERMISSIONS: PermissionSet;
			NETWORK_FILTERS_PERMISSIONS: PermissionSet;
		};

		/** The look of the page that embeds the sandbox: color-scheme and the values of its CSS variables (--color-…). */
		type SandboxTheme = { colorScheme: string; variables: Record<string, string> };

		/** sandboxSdk — the SDK of an uploaded module (the counterpart of sdk.mjs for modules from the package). */
		type SandboxSdk = Readonly<SandboxConstants & {

			/** The base of the module's element (the counterpart of BaseElement) */
			BaseElement: typeof Classes.SandboxElement;

			/** Registers the module — call it once, right when the file is evaluated, after customElements.define() */
			registerModule( definition: SandboxModuleDefinition ): void;
			getTagName( name: string ): ModuleTag;
			formatModuleName( name: string ): string;

			/** The module's own texts for t()/tp() — call it before the first t() */
			defineMessages( tables: SandboxMessageTables ): void;
			t( key: string, ...substitutions: unknown[] ): string;
			tp( key: string, count: number, ...substitutions: unknown[] ): string;
			getUiLanguage(): Enums.UiLanguage;
			getUiLocale(): string;

			/** The name of the extension in the UI language and its version (the sandbox page has no chrome.runtime) */
			getExtensionInfo(): ExtensionInfo;

			/** The address of a file of the package (a path in it, or new URL("./x.svg", import.meta.url)) for <img>, CSS, … */
			getFileUrl( path: string | URL ): string;

			/** A file of the package as text (UTF-8) */
			getFileText( path: string | URL ): string;

			Specification: typeof Classes.SandboxSpecification;
			AndSpecification: typeof Classes.SandboxAndSpecification;
			OrSpecification: typeof Classes.SandboxOrSpecification;
			NotSpecification: typeof Classes.SandboxNotSpecification;
			ModeSpecification: typeof Classes.SandboxModeSpecification;
			UrlPatternSpecification: typeof Classes.SandboxUrlPatternSpecification;
			LocationSpecification: typeof Classes.SandboxLocationSpecification;
			WebPageSpecification: typeof Classes.SandboxWebPageSpecification;
			NOT_DISABLED_SPEC: Classes.SandboxSpecification;
			DISABLED_SPEC: Classes.SandboxSpecification;
			BACKGROUND_OR_FOCUS_SPEC: Classes.SandboxSpecification;
			POPUP_OR_ICON_CLICK_SPEC: Classes.SandboxSpecification;
			INSTALL_SPEC: Classes.SandboxSpecification;
			WEB_PAGE_SPEC: Classes.SandboxSpecification;
		}>;

		namespace Sandbox {

			/** A problem found in the sandbox: its code and the values for the text. */
			type Problem = { code: Enums.SandboxProblemCode; args: string[] };

			/** What the core sends with the module for evaluation (both when uploading and when rendering). */
			type Context = {

				/** Module name (== the entry file without .js/.mjs) */
				name: string;
				language: Enums.UiLanguage;
				pkg: SandboxPackage;

				/** Api methods the core runs for the module and their kind (SANDBOX_API in base.mjs) */
				apiMethods: Record<string, Enums.SandboxApiKind>;

				/** The extension itself (getExtensionInfo() in base.mjs) */
				extension: ExtensionInfo;
				constants: SandboxConstants;
			};

			/** Rendering the module: where and how it is shown (as BaseController passes it to init()) and the page look. */
			type RenderContext = Context & {
				mode: Enums.ActivationMode;
				location: Enums.ElementLocation;
				instance: string | null;
				theme: SandboxTheme;
			};

			/** A message from the core to the sandbox. */
			type FromHost =
				| ( Context & { kind: 'inspect' } )
				| ( RenderContext & { kind: 'init' } )
				| { kind: 'result'; id: number; ok: true; value: unknown }
				| { kind: 'result'; id: number; ok: false; error: string }
				| { kind: 'event'; id: number; value: unknown }
				| { kind: 'denied'; id: number; error: string }
				| { kind: 'theme'; theme: SandboxTheme };

			/** A message from the sandbox to the core (post() adds the token from the page address). */
			type ToHost =
				| { kind: 'ready' }
				| { kind: 'inspected'; registration: SandboxRegistration | null; problems: Problem[] }
				| { kind: 'problems'; problems: Problem[] }
				| { kind: 'resize'; height: number; width: number }
				| { kind: 'call'; id: number; method: string; args: unknown[] }
				| { kind: 'subscribe'; id: number; method: string; args: unknown[] }
				| { kind: 'unsubscribe'; id: number };

			/** A message to the core as it travels — with the token of the sandbox page (#… of its address). */
			type Envelope = ToHost & { token: string };

			/** A pending api request — settled by the core's "result". */
			type PendingCall = { resolve: ( value: unknown ) => void; reject: ( reason: Error ) => void };

			/** registerModule() of the module as data, or the problems that prevent it. */
			type SerializedRegistration = { registration: SandboxRegistration | null; problems: Problem[] };

			/** registerModule({ styles }) as CSS files of the package, or the problems (a value that is not one). */
			type ResolvedStyles = { paths: string[]; problems: Problem[] };

		}

	}

	namespace Functions {

		namespace Sandbox {

			/** Sends a message to the core (window.parent) with the token of the page */
			type post = ( message: Types.Sandbox.ToHost ) => void;

			/** "Name: message" of an exception */
			type describeError = ( err: unknown ) => string;

			/** The package of the module (an error before "inspect"/"init") */
			type currentPackage = () => Types.SandboxPackage;

			/** Bytes as text (UTF-8, a BOM dropped — the same as in the core) */
			type decodeText = ( data: Uint8Array<ArrayBuffer> ) => string;

			/** An address (blob:) of content created here */
			type blobUrl = ( content: string | Uint8Array<ArrayBuffer>, type: string ) => string;

			/** The virtual address of a file of the package ("sandbox://<name>/<path>") */
			type packageUrl = ( path: string ) => string;

			/** A path in the package from a path or a virtual address; null = no such file */
			type packagePath = ( input: string | URL ) => string | null;

			/** Bytes in base64 */
			type toBase64 = ( data: Uint8Array<ArrayBuffer> ) => string;

			/** The address (data:) of a file of the package, created once */
			type fileUrl = ( path: string ) => string;

			/** sandboxSdk.getFileUrl() */
			type getFileUrl = ( input: string | URL ) => string;

			/** sandboxSdk.getFileText() */
			type getFileText = ( input: string | URL ) => string;

			/** A CSS file of the package with url(…) of its files rewritten to their addresses */
			type packageCss = ( path: string ) => string;

			/** registerModule({ styles }) → CSS files of the package */
			type resolveStyles = ( styles: unknown ) => Types.Sandbox.ResolvedStyles;

			/** Adds the module's CSS files to <head> */
			type applyStyles = ( paths: string[] ) => void;

			/** The replacement of import.meta in a JS module of the package */
			type metaExpression = ( path: string ) => string;

			/** A plain object (not an array, not a class instance)? */
			type isPlainObject = ( value: unknown ) => value is Record<string, unknown>;

			/** Data that survive JSON unchanged (no functions, class instances, NaN, …)? */
			type isJsonData = ( value: unknown, depth?: number ) => boolean;

			/** The same as getTagName() in base.mjs */
			type getTagName = ( name: string ) => Types.ModuleTag;

			/** The same as formatModuleName() in base.mjs */
			type formatModuleName = ( key: string ) => string;

			/** $1–$9 and "$$" in a text, as substitute() in i18n.mjs */
			type substitute = ( message: string, substitutions: unknown[] ) => string;

			/** Adds the module's own texts */
			type defineMessages = ( tables: Types.SandboxMessageTables ) => void;

			/** The module's text in the UI language (English when missing, otherwise the key) */
			type t = ( key: string, ...substitutions: unknown[] ) => string;

			/** The plural form of the module's text by Intl.PluralRules, as tp() in i18n.mjs */
			type tp = ( key: string, count: number, ...substitutions: unknown[] ) => string;

			/** registerModule() of the module — only remembers the definition, the core checks it */
			type registerModule = ( definition: Types.SandboxModuleDefinition ) => void;

			/** An api request with one response */
			type call = ( method: string, args: unknown[] ) => Promise<unknown>;

			/** An api listener (the last argument); returns a function to unsubscribe */
			type subscribe = ( method: string, args: unknown[] ) => () => void;

			/** The api object from the list of methods the core allows */
			type createApi = ( methods: Record<string, Enums.SandboxApiKind> ) => Types.SandboxModuleApi;

			/** The SDK for the module code */
			type createSdk = ( context: Types.Sandbox.Context ) => Types.SandboxSdk;

			/** Evaluates the module of the package with the SDK (a classic script or a JS module) */
			type evaluate = ( sdk: Types.SandboxSdk ) => Promise<void>;

			/** Evaluates the module — what went wrong, otherwise nothing */
			type prepare = ( context: Types.Sandbox.Context ) => Promise<Types.Sandbox.Problem[]>;

			/** registerModule() of the module as data for the core, or the problems found */
			type serializeRegistration = ( name: string ) => Types.Sandbox.SerializedRegistration;

			/** "inspect": evaluates the module and sends the core what it declared */
			type inspect = ( context: Types.Sandbox.Context ) => Promise<void>;

			/** "init": evaluates the module, creates its element and calls its init() */
			type render = ( context: Types.Sandbox.RenderContext ) => Promise<void>;

			/** Sets the colors and color-scheme of the page that embeds the sandbox */
			type applyTheme = ( theme: Types.SandboxTheme | undefined ) => void;

			/** Reports the content height (the height of the <iframe>) and its min-content width to the core on every change */
			type watchSize = () => void;

			/** Settles a pending api request by the core's response */
			type settle = ( message: Extract<Types.Sandbox.FromHost, { kind: 'result' }> ) => void;

		}

	}

	namespace Classes {

		/**
		 * The activation rule of an uploaded module — the same Specification Pattern as in sdk.mjs, but every rule
		 * can be written as data (toDescriptor()); the core evaluates the descriptor with its own classes.
		 */
		class SandboxSpecification {
			isSatisfiedBy( context: Types.SpecificationContext ): boolean;
			and( other: SandboxSpecification ): SandboxAndSpecification;
			or( other: SandboxSpecification ): SandboxOrSpecification;
			not(): SandboxNotSpecification;

			/** The rule as data for the core (specFromDescriptor() in base.mjs) */
			toDescriptor(): Types.SpecificationDescriptor;
		}

		class SandboxAndSpecification extends SandboxSpecification {
			_specs: SandboxSpecification[];
			constructor ( ...specs: SandboxSpecification[] );
		}

		class SandboxOrSpecification extends SandboxSpecification {
			_specs: SandboxSpecification[];
			constructor ( ...specs: SandboxSpecification[] );
		}

		class SandboxNotSpecification extends SandboxSpecification {
			_spec: SandboxSpecification;
			constructor ( spec: SandboxSpecification );
		}

		class SandboxModeSpecification extends SandboxSpecification {
			_mode: Enums.ActivationMode;
			constructor ( mode: Enums.ActivationMode );
		}

		class SandboxUrlPatternSpecification extends SandboxSpecification {
			_patterns: string[];
			constructor ( patterns?: string[] | null );
		}

		class SandboxLocationSpecification extends SandboxSpecification {
			_locations: Enums.RenderLocation[];
			constructor ( locations: Enums.RenderLocation | Enums.RenderLocation[] );
		}

		class SandboxDisabledSpecification extends SandboxSpecification { }

		class SandboxIsNotDisabled extends SandboxSpecification { }

		class SandboxWebPageSpecification extends SandboxSpecification { }

		/** The base of an uploaded module's element — the counterpart of BaseElement inside the sandbox. */
		class SandboxElement extends HTMLElement {
			static get observedAttributes(): string[];

			/** Module name (set by init()) */
			_name: string;

			/** The module's activation mode (set by init()) */
			_mode: Enums.ActivationMode;

			/** The surface on which the element is rendered (set by init()) */
			_location: Enums.ElementLocation;

			/** Instance id of a module with multiple instances, otherwise null (set by init()) */
			_instance: string | null;

			/** The module's activation rule; without it init() takes the registered one */
			activationSpec: SandboxSpecification | undefined;

			/** Requests to the core (created by init()) */
			api: Types.SandboxModuleApi;

			constructor ();
			connectedCallback(): void;
			disconnectedCallback(): void;
			connectedMoveCallback(): void;
			adoptedCallback(): void;
			attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void;
			init( options: Types.SandboxModuleInitOptions ): Promise<void>;

			/** Does the module's activation rule hold for the given mode? */
			isActivationSatisfied( mode?: Enums.ActivationMode ): boolean;
		}

		namespace SandboxElement {

			/** Instance properties (without methods) — see Types.WithFields */
			type Fields = Pick<SandboxElement, '_name' | '_mode' | '_location' | '_instance' | 'activationSpec' | 'api'>;

		}

	}

}

export { };
