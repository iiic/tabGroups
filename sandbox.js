//@ts-check
"use strict";

// sandbox.js — the runtime of sandbox.html, the page an uploaded module runs in
// (Settings → "Uploaded modules (sandbox)", see the section about uploaded modules
// in base.mjs and README).
//
// The page is declared in the manifest as sandboxed ("sandbox.pages") and the core
// embeds it with the iframe sandbox attribute as well: it has an opaque origin, no
// chrome.* API, no access to the extension pages or their storage, and its own CSP
// (content_security_policy.sandbox) — it may evaluate code ('unsafe-eval') and run the
// scripts it creates itself (blob:), but it cannot load anything from the network or
// embed other pages. The only way out is window.parent.postMessage() to the core element
// (SandboxModuleElement in base.mjs), which runs what the module asks for through its
// own api (createModuleApi()), only from an allowlist (SANDBOX_API in base.mjs), and
// sends back the result. Anything else the module asks for with
// this.api.capabilities.call(name, …) — a function outside the sandbox: the core runs it only
// when it offers it (SANDBOX_CAPABILITIES), the module declared it in
// registerModule({ capabilities }) and the user allowed it in Settings, and records every
// such request; this.api.capabilities.listen(name, …, handler) subscribes to a listener of the
// catalog by the same rules. What the browser allows only in the handler of a click (popup.open,
// sidebar.toggle, floatingWindow.toggle) runs only from a button the core draws for the module
// in the extension page (this.api.buttons.set(), or a button with the function in this.api.ui.render())
// — a click here in the frame would reach the core as a message. Instead of its own DOM in this frame the module can describe its content as
// data (this.api.ui.render()): the core checks it and draws it in the extension page itself, in its
// look, without HTML — the frame keeps running, hidden — and its controls report back
// (this.api.ui.onEvent()). What cannot be allowed at all (the DOM of the extension page, synchronous
// calls, …) is listed in base.mjs ("Functions outside the sandbox") and README.
//
// A classic script (.js), not a module: a module script would be loaded from the
// opaque origin with CORS, and the sandbox needs nothing from the core files anyway —
// the core sends what it needs (the package of the module, the UI language, the allowed
// api methods, constants, the look of the page) in its first message.
//
// The package (Types.SandboxPackage): the files of the module as data and its entry file.
// A module that is a JS module (.mjs) is loaded as one — the core found in its sources
// (planSandboxPackage() in base.mjs) where it imports the files of the package or the SDK
// ("../../sdk.mjs") and where it uses import.meta, and here those places are rewritten to
// the addresses (blob:) of the module scripts and JSON files created here, before the file
// itself gets its address (dependencies first). The other files (images, fonts, url() in its
// CSS, getFileUrl()) get data: addresses — Firefox does not let a page with an opaque
// origin load an image from its own blob: address. Inside the module the files are at
// "sandbox://<name>/<path>" (import.meta.url) — getFileUrl() and registerModule({ styles })
// take these addresses or paths in the package.
//
// The protocol (Types.Sandbox.*): the sandbox announces "ready" and the core answers
//   "inspect" — when uploading in Settings: evaluate the module and return what it
//               declared in registerModule() (as data), or the problems found;
//   "init"    — when rendering: evaluate the module, create its element, call init();
// then "call"/"subscribe"/"unsubscribe" (api requests) → "result"/"event"/"denied",
// "resize" (the content height and width for the <iframe>), "theme" (page colors) and
// "problems". Every message to the core carries the token from the page address
// (#…): after a navigation of the frame elsewhere the new page does not know it and
// the core no longer answers.
(() => {
	const root = /** @type {HTMLElement} */ (document.getElementById("sandbox-root"));
	const token = location.hash.slice(1);

	/** @type {Functions.Sandbox.post} */
	function post(message) {
		/** @type {Types.Sandbox.Envelope} */
		const envelope = { ...message, token };
		window.parent.postMessage(envelope, "*");
	}

	// The core embeds the page with the sandbox attribute, so its origin is always opaque.
	// Anything else means the page is not sandboxed (it was opened directly, or the browser
	// ignored the attribute) — the module code is not run in such a page.
	if (self.origin !== "null") {
		post({ kind: "problems", problems: [{ code: "notSandboxed", args: [] }] });
		return;
	}

	// Only one module, evaluated once — the page is created for it and thrown away with it.
	let started = false;
	let lastId = 0;
	/** @type {Map<number, Types.Sandbox.PendingCall>} */
	const pending = new Map();
	/** @type {Map<number, (value: unknown) => void>} */
	const listeners = new Map();

	/** @type {Enums.UiLanguage} */
	let language = "en";
	/** @type {Record<string, Record<string, string>>} */
	const messages = {};
	/** @type {Types.SandboxModuleDefinition[]} */
	const registrations = [];
	/** @type {Types.SandboxModuleApi | null} */
	let moduleApi = null;
	/** @type {Types.SandboxPackage | null} */
	let pkg = null;
	// Addresses of the files of the package (data:), created on first use.
	/** @type {Map<string, string>} */
	const fileUrls = new Map();

	// The texts of the module in its package (SANDBOX_MESSAGES_FILE in base.mjs).
	const MESSAGES_FILE = "messages.json";

	// Keys of registerModule() an uploaded module may use — data the core can store and
	// evaluate without the module code (activationSpec as a descriptor, see below).
	const DATA_KEYS = [
		"name",
		"tag",
		"description",
		// The version of the module (a standalone extension built from it gets it).
		"version",
		"defaultActivationMode",
		"defaultDisplayLocation",
		"defaultOutputElement",
		"defaultShowHeading",
		"settingsSchema",
		"multiInstance",
		"instanceSettingsSchema",
		"usesPermissions",
		"dependsOn",
		"consumesDetails",
		// The functions outside the sandbox the module asks for (this.api.capabilities.call()).
		"capabilities",
		// The element edits the module's settings itself (Settings renders it with init({ location: "settings" })).
		"settingsView",
		// The configuration of the core's filters the module declares instead of setting it from its element — the
		// core applies it from the installation (DECLARED_FILTERS in base.mjs).
		"networkFilters",
		"contentFilters",
	];
	const SPEC_KEY = "activationSpec";
	// The module's CSS — files of the package, the sandbox applies them itself (render()).
	const STYLES_KEY = "styles";
	const SCHEMA_KEYS = ["settingsSchema", "instanceSettingsSchema"];
	const MAX_DATA_DEPTH = 32;

	/** @type {Functions.Sandbox.describeError} */
	function describeError(err) {
		return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
	}

	/** @type {Functions.Sandbox.isPlainObject} */
	function isPlainObject(value) {
		if (!value || typeof value !== "object" || Array.isArray(value)) return false;
		const proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	}

	/** @type {Functions.Sandbox.isJsonData} */
	function isJsonData(value, depth = 0) {
		if (depth > MAX_DATA_DEPTH) return false;
		if (value === null || typeof value === "string" || typeof value === "boolean") return true;
		if (typeof value === "number") return Number.isFinite(value);
		if (Array.isArray(value)) return value.every((item) => isJsonData(item, depth + 1));
		if (isPlainObject(value)) return Object.values(value).every((item) => isJsonData(item, depth + 1));
		return false;
	}

	/** @type {Functions.Sandbox.getTagName} */
	function getTagName(name) {
		const kebab = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
		return `extension-${kebab}`;
	}

	/** @type {Functions.Sandbox.formatModuleName} */
	function formatModuleName(key) {
		const words = key.match(/[A-Z]?[a-z]+|[0-9]+|[A-Z]+(?=[A-Z][a-z])/g);
		if (words && words.length > 1) {
			return words
				.map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
				.join(" ");
		}
		return key.charAt(0).toUpperCase() + key.slice(1);
	}

	// --- The package of the module ---

	/** @type {Functions.Sandbox.currentPackage} */
	function currentPackage() {
		if (!pkg) throw new Error("The module package is not loaded yet");
		return pkg;
	}

	/** @type {Functions.Sandbox.decodeText} */
	function decodeText(data) {
		return new TextDecoder().decode(data);
	}

	/** @type {Functions.Sandbox.blobUrl} */
	function blobUrl(content, type) {
		return URL.createObjectURL(new Blob([content], { type }));
	}

	// The virtual address of a file of the package — import.meta.url and the sourceURL of its code.
	/** @type {Functions.Sandbox.packageUrl} */
	function packageUrl(path) {
		return `sandbox://${currentPackage().name}/${path}`;
	}

	// A path in the package from a path relative to its root ("img/a.svg", "./img/a.svg") or a
	// virtual address (new URL("./img/a.svg", import.meta.url)); null = no such file.
	/** @type {Functions.Sandbox.packagePath} */
	function packagePath(input) {
		const current = currentPackage();
		let value = String(input).replace(/[?#][\s\S]*$/, "");
		const prefix = `sandbox://${current.name}/`;
		if (value.startsWith(prefix)) value = value.slice(prefix.length);
		/** @type {string[]} */
		const segments = [];
		for (const segment of value.split("/")) {
			if (segment === "" || segment === ".") continue;
			if (segment !== "..") {
				segments.push(segment);
			} else if (segments.pop() === undefined) {
				return null;
			}
		}
		const path = segments.join("/");
		return Object.hasOwn(current.files, path) ? path : null;
	}

	/** @type {Functions.Sandbox.toBase64} */
	function toBase64(data) {
		let binary = "";
		// In parts — String.fromCharCode() takes the bytes as arguments.
		for (let i = 0; i < data.length; i += 0x2000) binary += String.fromCharCode(...data.subarray(i, i + 0x2000));
		return btoa(binary);
	}

	/** @type {Functions.Sandbox.fileUrl} */
	function fileUrl(path) {
		let url = fileUrls.get(path);
		if (!url) {
			const file = currentPackage().files[path];
			url = `data:${file.type};base64,${toBase64(file.data)}`;
			fileUrls.set(path, url);
		}
		return url;
	}

	// sandboxSdk.getFileUrl() — the address of a file of the package for <img src>, CSS, …;
	// the #fragment of the input stays (an SVG sprite).
	/** @type {Functions.Sandbox.getFileUrl} */
	function getFileUrl(input) {
		const path = packagePath(input);
		if (!path) throw new Error(`The module package has no file "${String(input)}"`);
		const fragment = /#[\s\S]*$/.exec(String(input));
		return fileUrl(path) + (fragment ? fragment[0] : "");
	}

	// sandboxSdk.getFileText() — a file of the package as text (UTF-8).
	/** @type {Functions.Sandbox.getFileText} */
	function getFileText(input) {
		const path = packagePath(input);
		if (!path) throw new Error(`The module package has no file "${String(input)}"`);
		return decodeText(currentPackage().files[path].data);
	}

	// A CSS file of the package with url(…) pointing to its files rewritten to their addresses
	// (relative to the CSS file, as in a browser). The rest (data:, #…, an outer address —
	// the CSP blocks it anyway) stays as it is.
	/** @type {Functions.Sandbox.packageCss} */
	function packageCss(path) {
		const folder = path.slice(0, path.lastIndexOf("/") + 1);
		return getFileText(path).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote, value) => {
			const reference = String(value).trim();
			if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(reference)) return match;
			const target = packagePath(folder + reference);
			if (!target) return match;
			const fragment = /#[\s\S]*$/.exec(reference);
			return `url("${fileUrl(target)}${fragment ? fragment[0] : ""}")`;
		});
	}

	// registerModule({ styles }) → CSS files of the package (addresses or paths, as getFileUrl()).
	/** @type {Functions.Sandbox.resolveStyles} */
	function resolveStyles(styles) {
		/** @type {string[]} */
		const paths = [];
		/** @type {Types.Sandbox.Problem[]} */
		const problems = [];
		if (styles === undefined) return { paths, problems };
		for (const item of Array.isArray(styles) ? styles : [styles]) {
			const path = typeof item === "string" || item instanceof URL ? packagePath(item) : null;
			if (path && currentPackage().files[path].type === "text/css") {
				paths.push(path);
			} else {
				problems.push({ code: "badStyle", args: [String(item)] });
			}
		}
		return { paths, problems };
	}

	// The module's CSS at the end of <head> — after mvp.css and sandbox.css, so the module wins with
	// the same specificity (the same as moduleDef.styles of a module from the package).
	/** @type {Functions.Sandbox.applyStyles} */
	function applyStyles(paths) {
		for (const path of paths) {
			const style = document.createElement("style");
			style.dataset.file = path;
			style.textContent = packageCss(path);
			document.head.appendChild(style);
		}
	}

	// import.meta of a JS module of the package: its virtual address (and resolve() against it).
	/** @type {Functions.Sandbox.metaExpression} */
	function metaExpression(path) {
		const url = JSON.stringify(packageUrl(path));
		return `Object.freeze({ url: ${url}, resolve: (specifier) => new URL(specifier, ${url}).href })`;
	}

	// --- The module's own texts (it cannot add them to _locales, so it carries them itself) ---

	/** @type {Functions.Sandbox.substitute} */
	function substitute(message, substitutions) {
		return message.replace(/\$(\$|[1-9])/g, (_match, token) => (token === "$" ? "$" : String(substitutions[Number(token) - 1] ?? "")));
	}

	/** @type {Functions.Sandbox.defineMessages} */
	function defineMessages(tables) {
		if (!isPlainObject(tables)) throw new TypeError("defineMessages() expects { language: { key: text } }");
		for (const [lang, table] of Object.entries(tables)) {
			if (!isPlainObject(table)) continue;
			const target = (messages[lang] ??= {});
			for (const [key, text] of Object.entries(table)) {
				if (typeof text === "string") target[key.toLowerCase()] = text;
			}
		}
	}

	/** @type {Functions.Sandbox.t} */
	function t(key, ...substitutions) {
		const id = String(key).toLowerCase();
		const message = messages[language]?.[id] ?? messages.en?.[id];
		return message === undefined ? String(key) : substitute(message, substitutions);
	}

	/** @type {Map<string, Intl.PluralRules>} */
	const pluralRulesCache = new Map();

	/** @type {Functions.Sandbox.tp} */
	function tp(key, count, ...substitutions) {
		let rules = pluralRulesCache.get(language);
		if (!rules) {
			rules = new Intl.PluralRules(language);
			pluralRulesCache.set(language, rules);
		}
		// The same order as tp() in i18n.mjs: forms of the UI language first, English
		// only when the language has not even "_other".
		const exact = `${key}_${rules.select(count)}`.toLowerCase();
		const other = `${key}_other`.toLowerCase();
		const own = [exact, other].find((id) => id in (messages[language] || {}));
		return t(own ?? (exact in (messages.en || {}) ? exact : other), count, ...substitutions);
	}

	// --- Specification Pattern as data ---
	//
	// The same classes and ready-made rules as in sdk.mjs, but each one can be written as
	// a descriptor (toDescriptor()) — the core stores it and evaluates it with its own
	// classes (specFromDescriptor() in base.mjs), so that "when" and "where" are decided for an
	// uploaded module the same way as for the others. Here the rule only serves
	// isActivationSatisfied() of the element (a context with { mode } only).

	/** @implements {Classes.SandboxSpecification} */
	class SandboxSpecification {
		/** @type {Classes.SandboxSpecification['isSatisfiedBy']} */
		isSatisfiedBy(_context) {
			return true;
		}

		/** @type {Classes.SandboxSpecification['and']} */
		and(other) {
			return new SandboxAndSpecification(this, other);
		}

		/** @type {Classes.SandboxSpecification['or']} */
		or(other) {
			return new SandboxOrSpecification(this, other);
		}

		/** @type {Classes.SandboxSpecification['not']} */
		not() {
			return new SandboxNotSpecification(this);
		}

		/** @type {Classes.SandboxSpecification['toDescriptor']} */
		toDescriptor() {
			return { type: "all" };
		}
	}

	/** @implements {Classes.SandboxAndSpecification} */
	class SandboxAndSpecification extends SandboxSpecification {
		/** @param {...Classes.SandboxSpecification} specs */
		constructor(...specs) {
			super();
			/** @type {Classes.SandboxAndSpecification['_specs']} */
			this._specs = specs;
		}

		/**
		 * @override
		 * @type {Classes.SandboxAndSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			return this._specs.every((spec) => spec.isSatisfiedBy(context));
		}

		/**
		 * @override
		 * @type {Classes.SandboxAndSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "and", specs: this._specs.map((spec) => spec.toDescriptor()) };
		}
	}

	/** @implements {Classes.SandboxOrSpecification} */
	class SandboxOrSpecification extends SandboxSpecification {
		/** @param {...Classes.SandboxSpecification} specs */
		constructor(...specs) {
			super();
			/** @type {Classes.SandboxOrSpecification['_specs']} */
			this._specs = specs;
		}

		/**
		 * @override
		 * @type {Classes.SandboxOrSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			return this._specs.some((spec) => spec.isSatisfiedBy(context));
		}

		/**
		 * @override
		 * @type {Classes.SandboxOrSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "or", specs: this._specs.map((spec) => spec.toDescriptor()) };
		}
	}

	/** @implements {Classes.SandboxNotSpecification} */
	class SandboxNotSpecification extends SandboxSpecification {
		/** @param {Classes.SandboxSpecification} spec */
		constructor(spec) {
			super();
			/** @type {Classes.SandboxNotSpecification['_spec']} */
			this._spec = spec;
		}

		/**
		 * @override
		 * @type {Classes.SandboxNotSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			return !this._spec.isSatisfiedBy(context);
		}

		/**
		 * @override
		 * @type {Classes.SandboxNotSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "not", spec: this._spec.toDescriptor() };
		}
	}

	/** @implements {Classes.SandboxModeSpecification} */
	class SandboxModeSpecification extends SandboxSpecification {
		/** @param {Enums.ActivationMode} mode */
		constructor(mode) {
			super();
			/** @type {Classes.SandboxModeSpecification['_mode']} */
			this._mode = mode;
		}

		/**
		 * @override
		 * @type {Classes.SandboxModeSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			return context.mode === this._mode;
		}

		/**
		 * @override
		 * @type {Classes.SandboxModeSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "mode", mode: this._mode };
		}
	}

	// The same comparison as UrlPatternSpecification in base.mjs (a pattern without a path
	// also matches the site root with a trailing slash).
	const BARE_ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/]+$/i;

	/** @implements {Classes.SandboxUrlPatternSpecification} */
	class SandboxUrlPatternSpecification extends SandboxSpecification {
		/** @param {string[] | null} [patterns] */
		constructor(patterns) {
			super();
			/** @type {Classes.SandboxUrlPatternSpecification['_patterns']} */
			this._patterns = patterns || [];
		}

		/**
		 * @override
		 * @type {Classes.SandboxUrlPatternSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			const url = (context.url || "").toLowerCase().trim();
			return this._patterns.some((item) => {
				const pattern = String(item).toLowerCase().trim();
				if (pattern.length === 0) return false;
				if (pattern.endsWith("/")) return url.startsWith(pattern);
				const candidates = BARE_ORIGIN_RE.test(pattern) ? [pattern, `${pattern}/`] : [pattern];
				return candidates.some((p) => url === p || url.startsWith(`${p}#`) || url.startsWith(`${p}?`));
			});
		}

		/**
		 * @override
		 * @type {Classes.SandboxUrlPatternSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "url", patterns: [...this._patterns] };
		}
	}

	/** @implements {Classes.SandboxLocationSpecification} */
	class SandboxLocationSpecification extends SandboxSpecification {
		/** @param {Enums.RenderLocation | Enums.RenderLocation[]} locations */
		constructor(locations) {
			super();
			/** @type {Classes.SandboxLocationSpecification['_locations']} */
			this._locations = Array.isArray(locations) ? locations : [locations];
		}

		/**
		 * @override
		 * @type {Classes.SandboxLocationSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			// "settings" (the editor of the module's settings) is never among the surfaces.
			return context.location !== undefined && context.location !== "settings" && this._locations.includes(context.location);
		}

		/**
		 * @override
		 * @type {Classes.SandboxLocationSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "location", locations: [...this._locations] };
		}
	}

	/** @implements {Classes.SandboxDisabledSpecification} */
	class SandboxDisabledSpecification extends SandboxSpecification {
		/**
		 * @override
		 * @type {Classes.SandboxDisabledSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			return context.mode === "disabled";
		}

		/**
		 * @override
		 * @type {Classes.SandboxDisabledSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "disabled" };
		}
	}

	/** @implements {Classes.SandboxIsNotDisabled} */
	class SandboxIsNotDisabled extends SandboxSpecification {
		/**
		 * @override
		 * @type {Classes.SandboxIsNotDisabled['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			return context.mode !== "disabled";
		}

		/**
		 * @override
		 * @type {Classes.SandboxIsNotDisabled['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "notDisabled" };
		}
	}

	// The element gets only { mode } here — the rule then holds, as WebPageSpecification
	// in base.mjs does without an address. The real decision about the active tab is made by the core.
	/** @implements {Classes.SandboxWebPageSpecification} */
	class SandboxWebPageSpecification extends SandboxSpecification {
		/**
		 * @override
		 * @type {Classes.SandboxWebPageSpecification['isSatisfiedBy']}
		 */
		isSatisfiedBy(context) {
			if (context.url) return /^(?:https?|file):/i.test(context.url);
			return context.hostAccess !== true;
		}

		/**
		 * @override
		 * @type {Classes.SandboxWebPageSpecification['toDescriptor']}
		 */
		toDescriptor() {
			return { type: "webPage" };
		}
	}

	const NOT_DISABLED_SPEC = new SandboxIsNotDisabled();

	// --- The element base ---

	/** @implements {Classes.SandboxElement} */
	class SandboxElement extends /** @type {Types.WithFields<typeof HTMLElement, Classes.SandboxElement.Fields>} */ (HTMLElement) {
		/** @type {typeof Classes.SandboxElement.observedAttributes} */
		static get observedAttributes() {
			return [];
		}

		constructor() {
			super();
			/** @type {Classes.SandboxElement['_name']} */
			this._name = "";
			/** @type {Classes.SandboxElement['_mode']} */
			this._mode = "popup";
			/** @type {Classes.SandboxElement['_location']} */
			this._location = "popup";
			/** @type {Classes.SandboxElement['_instance']} */
			this._instance = null;
			// As in BaseElement: without its own value init() takes the registered rule.
			/** @type {Classes.SandboxElement['activationSpec']} */
			this.activationSpec = undefined;
		}

		/** @type {Classes.SandboxElement['connectedCallback']} */
		connectedCallback() {
			// The module builds its content in its own connectedCallback()/init().
		}

		/** @type {Classes.SandboxElement['disconnectedCallback']} */
		disconnectedCallback() {
			// The core unsubscribes the module's listeners itself when its element in the
			// extension page is detached (the whole sandbox page goes away with it).
		}

		/** @type {Classes.SandboxElement['connectedMoveCallback']} */
		connectedMoveCallback() {
			// Nothing to do after a move with moveBefore().
		}

		/** @type {Classes.SandboxElement['adoptedCallback']} */
		adoptedCallback() {
			// Nothing to do after a move into another document.
		}

		/** @type {Classes.SandboxElement['attributeChangedCallback']} */
		attributeChangedCallback(_name, _oldValue, _newValue) {
			// No attributes are observed by default.
		}

		/** @type {Classes.SandboxElement['init']} */
		async init({ name, mode, location, instance }) {
			this._name = name;
			this._mode = mode || "popup";
			this._location = location || "popup";
			this._instance = instance || null;
			/** @type {Classes.SandboxElement['api']} */
			this.api = /** @type {Types.SandboxModuleApi} */ (moduleApi);
			if (this.activationSpec === undefined) {
				const definition = registrations.find((d) => d && d.name === name);
				this.activationSpec = definition?.activationSpec || NOT_DISABLED_SPEC;
			}
		}

		/** @type {Classes.SandboxElement['isActivationSatisfied']} */
		isActivationSatisfied(mode = this._mode) {
			return (this.activationSpec || NOT_DISABLED_SPEC).isSatisfiedBy({ mode });
		}
	}

	/** @type {Functions.Sandbox.registerModule} */
	function registerModule(definition) {
		registrations.push(definition);
	}

	// --- api: requests to the core ---

	/** @type {Functions.Sandbox.call} */
	function call(method, args) {
		return new Promise((resolve, reject) => {
			const id = ++lastId;
			pending.set(id, { resolve, reject });
			try {
				post({ kind: "call", id, method, args });
			} catch (err) {
				// The arguments cannot be copied to the core (a function, a DOM node, …).
				pending.delete(id);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	/** @type {Functions.Sandbox.subscribe} */
	function subscribe(method, args) {
		const handler = args.pop();
		if (typeof handler !== "function") {
			throw new TypeError(`${method}(): the last argument must be a function`);
		}
		const id = ++lastId;
		listeners.set(id, /** @type {(value: unknown) => void} */ (handler));
		post({ kind: "subscribe", id, method, args });
		return () => {
			if (listeners.delete(id)) post({ kind: "unsubscribe", id });
		};
	}

	/** @type {Functions.Sandbox.createApi} */
	function createApi(methods) {
		/** @type {Record<string, Record<string, (...args: unknown[]) => unknown>>} */
		const areas = {};
		for (const [method, kind] of Object.entries(methods)) {
			const [area, name] = method.split(".");
			if (!area || !name) continue;
			const target = (areas[area] ??= {});
			target[name] = kind === "subscribe" ? (...args) => subscribe(method, args) : (...args) => call(method, args);
		}
		// A function outside the sandbox — any name; the core decides whether it runs it (and records it).
		(areas.capabilities ??= {}).call = (name, ...args) => call(String(name), args);
		// A listener outside the sandbox (floatingWindow.onChange, …) — the handler is the last argument;
		// a refused one gets no events (the reason is in the console, see "denied").
		areas.capabilities.listen = (name, ...args) => subscribe(String(name), args);
		for (const area of Object.values(areas)) Object.freeze(area);
		return /** @type {Types.SandboxModuleApi} */ (/** @type {unknown} */ (Object.freeze(areas)));
	}

	/** @type {Functions.Sandbox.settle} */
	function settle(message) {
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.ok) {
			entry.resolve(message.value);
		} else {
			entry.reject(new Error(message.error));
		}
	}

	/** @type {Functions.Sandbox.createSdk} */
	function createSdk(context) {
		const constants = context.constants;
		const extension = Object.freeze({ name: String(context.extension?.name ?? ""), version: String(context.extension?.version ?? "") });
		return Object.freeze({
			BaseElement: SandboxElement,
			registerModule,
			getTagName,
			formatModuleName,
			defineMessages,
			t,
			tp,
			getUiLanguage: () => language,
			getUiLocale: () => language,
			// The name and version of the extension the core sent with the module (getExtensionInfo() in base.mjs).
			getExtensionInfo: () => ({ ...extension }),
			getFileUrl,
			getFileText,
			Specification: SandboxSpecification,
			AndSpecification: SandboxAndSpecification,
			OrSpecification: SandboxOrSpecification,
			NotSpecification: SandboxNotSpecification,
			ModeSpecification: SandboxModeSpecification,
			UrlPatternSpecification: SandboxUrlPatternSpecification,
			LocationSpecification: SandboxLocationSpecification,
			WebPageSpecification: SandboxWebPageSpecification,
			NOT_DISABLED_SPEC,
			DISABLED_SPEC: new SandboxDisabledSpecification(),
			BACKGROUND_OR_FOCUS_SPEC: new SandboxModeSpecification("background").or(new SandboxModeSpecification("focus")),
			POPUP_OR_ICON_CLICK_SPEC: new SandboxModeSpecification("popup").or(new SandboxModeSpecification("icon_click")),
			INSTALL_SPEC: new SandboxModeSpecification("install"),
			WEB_PAGE_SPEC: new SandboxWebPageSpecification(),
			PAGE_ACCESS_PERMISSIONS: constants.PAGE_ACCESS_PERMISSIONS,
			BOOKMARKS_PERMISSIONS: constants.BOOKMARKS_PERMISSIONS,
			WEBREQUEST_PERMISSIONS: constants.WEBREQUEST_PERMISSIONS,
			WEBNAVIGATION_PERMISSIONS: constants.WEBNAVIGATION_PERMISSIONS,
			NETWORK_RULES_PERMISSIONS: constants.NETWORK_RULES_PERMISSIONS,
			CONTENT_FILTERS_PERMISSIONS: constants.CONTENT_FILTERS_PERMISSIONS,
			USER_SCRIPTS_PERMISSIONS: constants.USER_SCRIPTS_PERMISSIONS,
			NETWORK_FILTERS_PERMISSIONS: constants.NETWORK_FILTERS_PERMISSIONS,
		});
	}

	// --- Evaluating the module ---

	// A classic script (.js) as the body of a function with sandboxSdk; a JS module (.mjs) as
	// a module script from the addresses of the files of its graph (see the header). The SDK is
	// for a JS module a module of its own — its members as named exports ("import { t } from
	// "../../sdk.mjs""), the whole SDK as the default one.
	/** @type {Functions.Sandbox.evaluate} */
	async function evaluate(sdk) {
		const current = currentPackage();
		const plan = current.plan;
		if (current.format !== "module" || !plan) {
			// sourceURL: the module code under its own name in DevTools and in error stacks.
			const run = new Function("sandboxSdk", `${decodeText(current.files[current.entry].data)}\n//# sourceURL=${packageUrl(current.entry)}`);
			run.call(undefined, sdk);
			return;
		}
		const sdkUrl = blobUrl(`const sdk = globalThis.sandboxSdk;\nexport const { ${Object.keys(sdk).join(", ")} } = sdk;\nexport default sdk;\n`, "text/javascript");
		// The module scripts by their path; a JSON file gets its address when it is imported first.
		/** @type {Map<string, string>} */
		const urls = new Map();
		/** @type {(path: string) => string} */
		const moduleUrl = (path) => {
			let url = urls.get(path);
			if (!url) {
				const file = current.files[path];
				url = blobUrl(file.data, file.type);
				urls.set(path, url);
			}
			return url;
		};
		for (const path of plan.order) {
			let source = decodeText(current.files[path].data);
			// From the end, so that the positions of the earlier places stay valid.
			const rewrites = [...(plan.rewrites[path] || [])].sort((a, b) => b.start - a.start);
			for (const { start, end, target } of rewrites) {
				const replacement =
					target.kind === "sdk"
						? JSON.stringify(sdkUrl)
						: target.kind === "file"
							? JSON.stringify(moduleUrl(target.path))
							: metaExpression(path);
				source = source.slice(0, start) + replacement + source.slice(end);
			}
			urls.set(path, blobUrl(`${source}\n//# sourceURL=${packageUrl(path)}`, "text/javascript"));
		}
		await import(/** @type {string} */ (urls.get(current.entry)));
	}

	/** @type {Functions.Sandbox.prepare} */
	async function prepare(context) {
		language = context.language;
		document.documentElement.lang = context.language;
		moduleApi = createApi(context.apiMethods);
		pkg = context.pkg;
		try {
			// The texts of the package first — the module uses t() right when it is evaluated.
			const messagesFile = pkg.files[MESSAGES_FILE];
			if (messagesFile) defineMessages(JSON.parse(decodeText(messagesFile.data)));
			const sdk = createSdk(context);
			Object.defineProperty(globalThis, "sandboxSdk", { value: sdk });
			await evaluate(sdk);
		} catch (err) {
			// EvalError: the browser did not apply the sandbox CSP from the manifest (it does not know
			// "sandbox", Firefox before 154) and the extension CSP forbids evaluating code.
			if (err instanceof EvalError) return [{ code: "evalBlocked", args: [] }];
			console.error(err);
			return [{ code: "evaluation", args: [describeError(err)] }];
		}
		return [];
	}

	/** @type {Functions.Sandbox.serializeRegistration} */
	function serializeRegistration(name) {
		if (registrations.length === 0) {
			return { registration: null, problems: [{ code: "noRegistration", args: [] }] };
		}
		/** @type {Types.Sandbox.Problem[]} */
		const problems = [];
		if (registrations.length > 1) problems.push({ code: "multipleRegistrations", args: [] });

		const definition = /** @type {unknown} */ (registrations[0]);
		if (!isPlainObject(definition)) {
			return { registration: null, problems: [...problems, { code: "notObject", args: [] }] };
		}

		// The same rules as for a module from the package: the name is the file name, the tag
		// comes from getTagName() and the element is defined before registerModule().
		const tag = getTagName(name);
		if (definition.name !== name) problems.push({ code: "nameMismatch", args: [String(definition.name), name] });
		if (definition.tag !== tag) problems.push({ code: "tagMismatch", args: [String(definition.tag), tag] });
		const klass = typeof definition.tag === "string" ? customElements.get(definition.tag) : undefined;
		if (!klass) {
			problems.push({ code: "notDefined", args: [String(definition.tag)] });
		} else if (!(klass.prototype instanceof SandboxElement)) {
			problems.push({ code: "notBaseElement", args: [String(definition.tag)] });
		}

		/** @type {Record<string, unknown>} */
		const registration = {};
		for (const [key, value] of Object.entries(definition)) {
			if (value === undefined) continue;
			if (key === SPEC_KEY) {
				try {
					if (!(value instanceof SandboxSpecification)) throw new TypeError(SPEC_KEY);
					registration[key] = value.toDescriptor();
				} catch {
					problems.push({ code: "badSpec", args: [] });
				}
				continue;
			}
			// Only checked — the core does not need the CSS, the sandbox applies it when rendering.
			if (key === STYLES_KEY) {
				problems.push(...resolveStyles(value).problems);
				continue;
			}
			if (!DATA_KEYS.includes(key)) {
				// pageInit, details, backupData, … — code outside the sandbox.
				problems.push({ code: "unsupported", args: [key] });
				continue;
			}
			if (SCHEMA_KEYS.includes(key) && Array.isArray(value)) {
				const custom = value.find((field) => isPlainObject(field) && field.type === "custom");
				if (custom) {
					problems.push({ code: "customField", args: [String(/** @type {Record<string, unknown>} */ (custom).key)] });
					continue;
				}
			}
			if (!isJsonData(value)) {
				problems.push({ code: "notData", args: [key] });
				continue;
			}
			registration[key] = JSON.parse(JSON.stringify(value));
		}

		return problems.length > 0
			? { registration: null, problems }
			: { registration: /** @type {Types.SandboxRegistration} */ (registration), problems };
	}

	/** @type {Functions.Sandbox.inspect} */
	async function inspect(context) {
		const problems = await prepare(context);
		const result = problems.length > 0 ? { registration: null, problems } : serializeRegistration(context.name);
		post({ kind: "inspected", registration: result.registration, problems: result.problems });
	}

	/** @type {Functions.Sandbox.applyTheme} */
	function applyTheme(theme) {
		if (!theme || typeof theme !== "object") return;
		const style = document.documentElement.style;
		for (const [name, value] of Object.entries(theme.variables || {})) {
			if (name.startsWith("--") && typeof value === "string") style.setProperty(name, value);
		}
		if (typeof theme.colorScheme === "string") style.colorScheme = theme.colorScheme;
	}

	/** @type {Functions.Sandbox.watchSize} */
	function watchSize() {
		let lastHeight = -1;
		let lastWidth = -1;
		const report = () => {
			const height = Math.ceil(root.getBoundingClientRect().height);
			// The narrowest width the content fits in without scrolling (min-content: a table in one piece, a text
			// wrapped) — a page may give the <iframe> as much room. Measured with the width set for a moment; it is
			// back before the next rendering, so no observer sees the change.
			root.style.width = "min-content";
			const width = Math.ceil(Math.max(root.getBoundingClientRect().width, root.scrollWidth));
			root.style.width = "";
			if (height === lastHeight && width === lastWidth) return;
			lastHeight = height;
			lastWidth = width;
			post({ kind: "resize", height, width });
		};
		new ResizeObserver(report).observe(root);
		report();
	}

	/** @type {Functions.Sandbox.render} */
	async function render(context) {
		applyTheme(context.theme);
		watchSize();
		const problems = await prepare(context);
		const definition = registrations.find((d) => d && d.name === context.name);
		if (problems.length === 0 && !definition) problems.push({ code: "noRegistration", args: [] });
		const styles = definition && problems.length === 0 ? resolveStyles(definition.styles) : null;
		if (styles) problems.push(...styles.problems);
		if (problems.length > 0 || !definition || !styles) {
			post({ kind: "problems", problems });
			return;
		}
		applyStyles(styles.paths);

		const element = document.createElement(String(definition.tag));
		if (!(element instanceof SandboxElement)) {
			post({ kind: "problems", problems: [{ code: "notBaseElement", args: [String(definition.tag)] }] });
			return;
		}
		// The same order as in BaseController: attach (connectedCallback()), then init().
		root.replaceChildren(element);
		try {
			await element.init({
				outputEl: root,
				name: context.name,
				mode: context.mode,
				location: context.location,
				instance: context.instance,
			});
		} catch (err) {
			console.error(err);
			post({ kind: "problems", problems: [{ code: "initFailed", args: [describeError(err)] }] });
		}
	}

	window.addEventListener("message", (event) => {
		// Only the extension page that embeds the sandbox (the core) — not a page this one
		// might open.
		if (event.source !== window.parent) return;
		const message = /** @type {Types.Sandbox.FromHost} */ (event.data);
		if (!message || typeof message !== "object") return;
		switch (message.kind) {
			case "inspect":
				if (started) return;
				started = true;
				inspect(message);
				break;
			case "init":
				if (started) return;
				started = true;
				render(message);
				break;
			case "result":
				settle(message);
				break;
			case "event": {
				const listener = listeners.get(message.id);
				if (!listener) return;
				try {
					listener(message.value);
				} catch (err) {
					console.error(err);
				}
				break;
			}
			case "denied":
				listeners.delete(message.id);
				console.error(message.error);
				break;
			case "theme":
				applyTheme(message.theme);
				break;
		}
	});

	post({ kind: "ready" });
})();
