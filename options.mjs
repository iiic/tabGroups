//@ts-check
"use strict";

// options.mjs
import {
	BaseController,
	ACTIVATION_MODES,
	DISPLAY_LOCATIONS,
	OUTPUT_ELEMENTS,
	DISABLED_SPEC,
	getModuleSettingKey,
	getSettingFieldKey,
	resolveCheckboxTable,
	createModuleApi,
	getModuleDisplayLocations,
	getModuleDelegatedDisplayLocations,
	DELEGATED_DISPLAY_LOCATION_FIELD,
	parseDisplayLocations,
	getModuleOutputElement,
	getModuleShowHeading,
	getOutputElementDef,
	parseModuleEntry,
	createModuleInstanceId,
	MODULE_INSTANCE_SEPARATOR,
	MODULES_JSON_KEY,
	SANDBOX_MODULES_KEY,
	SANDBOX_CAPABILITY_GRANTS_KEY,
	SANDBOX_CAPABILITY_LOG_KEY,
	addSandboxModuleToList,
	clearSandboxCapabilityLog,
	describeSandboxCapability,
	getSandboxCapabilityOverview,
	installSandboxModule,
	isSandboxModuleEntry,
	readSandboxCapabilityGrants,
	readSandboxCapabilityLog,
	readSandboxModules,
	readSandboxPackage,
	removeSandboxModule,
	resetModule,
	setSandboxCapabilityGrant,
	EXTENSION_SERVICE_CLIENTS_KEY,
	EXTENSION_SERVICE_PROVIDER_KEY,
	EXTENSION_SERVICE_REGISTER_NOW_MESSAGE,
	EXTENSION_SERVICES_SECTION_ID,
	SIDEBAR_DISABLED_KEY,
	applySidebarDisabled,
	hasManifestSidebar,
	isFirefox,
	mountExtensionIdWatermark,
	readSidebarDisabled,
	approveExtensionServiceClient,
	denyExtensionServiceClient,
	getServiceProviderState,
	isExtensionServiceClientAlive,
	openExtensionServiceClient,
	readExtensionServiceClients,
	readServiceProviderId,
	removeExtensionServiceClient,
	sendToBackground,
	FRAME_STATE_SEEN_REFRESH_MS,
	loadFrameStates,
	queueFrameState,
} from "./base.mjs";
import { t, initPageI18n, initUiLanguageSelect, getUiLocale } from "./i18n.mjs";

// Suffix of the text of an option the module itself recommends as the default
// (defaultActivationMode/defaultDisplayLocation/defaultOutputElement in
// registerModule). The global default value is not marked — the module did not
// recommend it, it just declared nothing of its own.
const recommendedSuffix = () => t("options_recommended_suffix");

// The sentence below the output locations when the module is not shown anywhere (see
// _syncOutputSettingsState) — nothing ticked is not the same as a turned-off module.
// The texts are put together only when rendering (t() needs the loaded texts, see i18n.mjs).
const NOT_DISPLAYED_HINT = "options_hint_not_displayed";
const DISABLED_HINT = "options_hint_disabled";
const SIDEBAR_ONLY_HINT = "options_hint_sidebar_only";

// The module filter at the top of the page (#module-filter) only from this many modules in the list — with
// fewer it would only get in the way.
const MODULE_FILTER_MIN = 5;
// A narrow screen, where the section tabs turn into an accordion — the same width as in css/options.css.
const SECTIONS_ACCORDION_QUERY = "(max-width: 760px)";
// The section open when Settings are opened, unless the user last chose another one.
const DEFAULT_SECTION = "settings-custom";
// The last chosen section is remembered among the stored open/closed frames (FRAME_STATE_KEY, see bindFrameState()
// in base.mjs) under this prefix + its id, as an opened <details> — the section headings in the accordion are
// such pairs. Like there, only the deviation from the default is stored: choosing DEFAULT_SECTION deletes the record.
// The key is no module list entry key (those have no colon); the record is pruned like the frame ones.
const SECTION_STATE_KEY_PREFIX = "options-section:";

// The permission a column of a "checkboxTable" field or a "checkbox" field with notifications: true asks for in
// Chrome (Web Notifications of the extension); Firefox decides by its own prompt.
/** @type {Types.PermissionSet} */
const NOTIFICATIONS_PERMISSIONS = { permissions: ["notifications"] };

// Levels of the details contract (see registerModule() in base.mjs) in the overview
// of module dependencies — what the shared data relate to.
/** @type {Record<Enums.DetailsScope, string>} */
const DETAILS_SCOPE_LABELS = {
	get visit() { return t("options_details_scope_visit"); },
	get domain() { return t("options_details_scope_domain"); },
	get browser() { return t("options_details_scope_browser"); },
};

// Functions outside the sandbox of an uploaded module (see SANDBOX_CAPABILITIES in base.mjs): the
// risk of a function of the catalog and the outcomes in its record.
/** @type {Record<Enums.SandboxCapabilityRisk, string>} */
const CAPABILITY_RISK_LABELS = {
	get low() { return t("options_sandbox_capability_risk_low"); },
	get medium() { return t("options_sandbox_capability_risk_medium"); },
	get high() { return t("options_sandbox_capability_risk_high"); },
};
/** @type {Record<Enums.SandboxCapabilityOutcome, string>} */
const CAPABILITY_OUTCOME_LABELS = {
	get allowed() { return t("options_sandbox_capability_outcome_allowed"); },
	get failed() { return t("options_sandbox_capability_outcome_failed"); },
	get unavailable() { return t("options_sandbox_capability_outcome_unavailable"); },
	get clickOnly() { return t("options_sandbox_capability_outcome_click_only"); },
	get denied() { return t("options_sandbox_capability_outcome_denied"); },
	get pending() { return t("options_sandbox_capability_outcome_pending"); },
	get undeclared() { return t("options_sandbox_capability_outcome_undeclared"); },
	get forbidden() { return t("options_sandbox_capability_outcome_forbidden"); },
	get unknown() { return t("options_sandbox_capability_outcome_unknown"); },
	get userAllowed() { return t("options_sandbox_capability_outcome_user_allowed"); },
	get userDenied() { return t("options_sandbox_capability_outcome_user_denied"); },
	get userReset() { return t("options_sandbox_capability_outcome_user_reset"); },
};

/** @implements {Classes.OptionsController} */
class OptionsController extends BaseController {
	constructor() {
		super();
		this.outputEl = /** @type {Classes.OptionsController['outputEl']} */ (document.getElementById("modules-output"));
		this.container = /** @type {Classes.OptionsController['container']} */ (document.getElementById("modules-list"));
		this.saveBtn = /** @type {Classes.OptionsController['saveBtn']} */ (document.getElementById("save-btn"));
		this.resetBtn = /** @type {Classes.OptionsController['resetBtn']} */ (document.getElementById("reset-btn"));
		this.statusEl = /** @type {Classes.OptionsController['statusEl']} */ (document.getElementById("status"));

		this.jsonTextareaEl = /** @type {Classes.OptionsController['jsonTextareaEl']} */ (document.getElementById("modules-json"));
		this.saveJsonBtn = /** @type {Classes.OptionsController['saveJsonBtn']} */ (document.getElementById("save-modules-json"));
		this.resetJsonBtn = /** @type {Classes.OptionsController['resetJsonBtn']} */ (document.getElementById("reset-modules-json"));
		this.modulesDiffEl = /** @type {Classes.OptionsController['modulesDiffEl']} */ (document.getElementById("modules-json-diff"));
		/** @type {Classes.OptionsController['_modulesDiffRun']} */
		this._modulesDiffRun = 0;

		this.moduleSettingsContainer = /** @type {Classes.OptionsController['moduleSettingsContainer']} */ (document.getElementById("module-settings-list"));
		this.saveModuleSettingsBtn = /** @type {Classes.OptionsController['saveModuleSettingsBtn']} */ (document.getElementById("save-module-settings-btn"));
		this.resetModuleSettingsBtn = /** @type {Classes.OptionsController['resetModuleSettingsBtn']} */ (document.getElementById("reset-module-settings-btn"));
		/** @type {Classes.OptionsController['_savedValues']} */
		this._savedValues = { list: new Map(), settings: new Map() };
		/** @type {Classes.OptionsController['_unsavedChecks']} */
		this._unsavedChecks = new Set();
		this._initUnsavedChanges();

		this.sandboxFileInput = /** @type {Classes.OptionsController['sandboxFileInput']} */ (document.getElementById("sandbox-module-file"));
		this.sandboxReportEl = /** @type {Classes.OptionsController['sandboxReportEl']} */ (document.getElementById("sandbox-module-report"));
		this.sandboxListEl = /** @type {Classes.OptionsController['sandboxListEl']} */ (document.getElementById("sandbox-modules-list"));
		this.servicesSectionEl = /** @type {Classes.OptionsController['servicesSectionEl']} */ (document.getElementById("extension-services"));
		this.servicesProviderEl = /** @type {Classes.OptionsController['servicesProviderEl']} */ (document.getElementById("extension-services-provider"));
		this.servicesListEl = /** @type {Classes.OptionsController['servicesListEl']} */ (document.getElementById("extension-services-list"));
		/** @type {Classes.OptionsController['_servicesRenderRun']} */
		this._servicesRenderRun = 0;
		/** @type {Classes.OptionsController['_servicesScrolled']} */
		this._servicesScrolled = false;
		/** @type {Classes.OptionsController['_serviceProviderId']} */
		this._serviceProviderId = null;
		/** @type {Classes.OptionsController['_serviceProviderName']} */
		this._serviceProviderName = null;
		/** @type {Classes.OptionsController['_sandboxRenderRun']} */
		this._sandboxRenderRun = 0;

		this.sidebarDisabledCheckbox = /** @type {Classes.OptionsController['sidebarDisabledCheckbox']} */ (document.getElementById("sidebar-disabled"));
		this.sidebarDisabledHintEl = /** @type {Classes.OptionsController['sidebarDisabledHintEl']} */ (document.getElementById("sidebar-disabled-hint"));
		/** @type {Classes.OptionsController['_sidebarDisabled']} */
		this._sidebarDisabled = false;
		this.sidebarDisabledCheckbox.addEventListener("change", () => this._setSidebarDisabled(this.sidebarDisabledCheckbox.checked));


		this.sectionsEl = /** @type {Classes.OptionsController['sectionsEl']} */ (document.getElementById("options-sections"));
		this.tabbarEl = /** @type {Classes.OptionsController['tabbarEl']} */ (document.getElementById("options-tabbar"));
		/** @type {Classes.OptionsController['_accordion']} */
		this._accordion = window.matchMedia(SECTIONS_ACCORDION_QUERY);
		/** @type {Classes.OptionsController['_activeSection']} */
		this._activeSection = null;
		this._initSectionTabs();

		this.filterEl = /** @type {Classes.OptionsController['filterEl']} */ (document.getElementById("module-filter"));
		this.filterInput = /** @type {Classes.OptionsController['filterInput']} */ (document.getElementById("module-filter-input"));
		this.filterNamesEl = /** @type {Classes.OptionsController['filterNamesEl']} */ (document.getElementById("module-filter-names"));
		this._initModuleFilter();

		// Module definitions (incl. their settingsSchema) obtained by dynamically
		// importing their JS files — see _refreshModules().
		/** @type {Classes.OptionsController['_moduleDefs']} */
		this._moduleDefs = [];
		// The module output of this page (renderModulesFor() in initPage()) — the reset of a module creates its elements anew.
		/** @type {Classes.OptionsController['_outputSurface']} */
		this._outputSurface = undefined;

		this.saveBtn.addEventListener("click", () => this.save());
		this.saveJsonBtn.addEventListener("click", () => this.saveModulesList());
		this.resetJsonBtn.addEventListener("click", () => this.resetModulesList());
		this.saveModuleSettingsBtn.addEventListener("click", () => this.saveModuleSettings());
		// "Restore defaults" overwrites the settings of all modules — a stray click must not do it.
		this._requireSecondClick(this.resetBtn, () => t("options_reset_defaults_confirm"), () => this.reset());
		this._requireSecondClick(this.resetModuleSettingsBtn, () => t("options_reset_defaults_confirm"), () => this.resetModuleSettings());
		this.sandboxFileInput.addEventListener("change", () => this._uploadSandboxModule());

		// The notice about the difference from modules.json keeps up with the stored list,
		// whether it is changed by the editor, dragging, adding/removing an instance, an import, or
		// another tab with Settings. So does the list of uploaded modules (it says which of them
		// are in the module list, and the decisions about their functions outside the sandbox and
		// their record — a module on this or another page may be asking right now).
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== "local") return;
			if (changes[MODULES_JSON_KEY]) {
				this._showModulesListDiff();
			}
			if (changes[MODULES_JSON_KEY] || changes[SANDBOX_MODULES_KEY] || changes[SANDBOX_CAPABILITY_GRANTS_KEY] || changes[SANDBOX_CAPABILITY_LOG_KEY]) {
				this._renderSandboxModules();
			}
			if (changes[EXTENSION_SERVICE_CLIENTS_KEY] || changes[EXTENSION_SERVICE_PROVIDER_KEY]) {
				this._renderExtensionServices();
			}
			// From this page, another tab with Settings or a restored backup.
			if (changes[SIDEBAR_DISABLED_KEY]) {
				this._showSidebarDisabled(!hasManifestSidebar() || changes[SIDEBAR_DISABLED_KEY].newValue === true);
			}
		});

		/** @type {Classes.OptionsController['_draggedRow']} */
		this._draggedRow = null;
		this._initDragToReorder();

		// A change of the activation mode, output locations or element type changes which of the
		// output settings make sense (see _syncOutputSettingsState). The container is
		// still the same element even after re-rendering (see _initDragToReorder), so one
		// listener is enough.
		this.container.addEventListener("change", (e) => {
			const row = /** @type {Element} */ (e.target).closest(".module-row");
			if (row) {
				this._syncOutputSettingsState(row);
			}
		});
	}

	// --- Module list editor (modules.json) ---

	/** @type {Classes.OptionsController['loadModulesListEditor']} */
	async loadModulesListEditor() {
		let jsonText;
		try {
			jsonText = await this.getModulesJson();
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}
		try {
			const parsed = JSON.parse(jsonText);
			this.jsonTextareaEl.value = JSON.stringify(parsed, null, 2);
		} catch {
			this.jsonTextareaEl.value = jsonText;
		}
	}

	// Compares the stored module list with the default modules.json and above the editor
	// shows whether they differ and what it has extra or what it is missing. An identical list
	// (then there is none in storage, see saveModulesJson()) hides the notice,
	// as does a loading error — that one is already reported by the status line.
	/** @type {Classes.OptionsController['_showModulesListDiff']} */
	async _showModulesListDiff() {
		const run = ++this._modulesDiffRun;
		/** @type {string[]} */
		let userList;
		/** @type {string[]} */
		let defaultList;
		try {
			const [userText, defaultText] = await Promise.all([this.getModulesJson(), this.fetchDefaultModulesJson()]);
			userList = JSON.parse(userText);
			defaultList = JSON.parse(defaultText);
			if (!Array.isArray(userList) || !Array.isArray(defaultList)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch {
			userList = defaultList = [];
		}
		// Another change may have come in the meantime — only the last one is shown.
		if (run !== this._modulesDiffRun) return;

		userList = userList.filter((entry) => typeof entry === "string");
		defaultList = defaultList.filter((entry) => typeof entry === "string");
		this.modulesDiffEl.replaceChildren();
		this.modulesDiffEl.hidden = JSON.stringify(userList) === JSON.stringify(defaultList);
		if (this.modulesDiffEl.hidden) return;

		/** @param {string} text */
		const addLine = (text) => {
			const line = document.createElement("p");
			line.textContent = text;
			this.modulesDiffEl.appendChild(line);
			return line;
		};
		/** @param {string} label @param {string[]} entries */
		const addEntries = (label, entries) => {
			const line = addLine(`${label} `);
			entries.forEach((entry, index) => {
				const { name, instance } = parseModuleEntry(entry);
				const item = document.createElement("strong");
				item.textContent = `${this.formatModuleName(name)}${instance ? ` ${MODULE_INSTANCE_SEPARATOR}${instance}` : ""}`;
				item.title = entry;
				if (index > 0) line.append(", ");
				line.appendChild(item);
			});
		};

		const { extra, missing } = this._compareModuleLists(userList, defaultList);
		addLine(t("options_modules_diff_differs"));
		if (extra.length) addEntries(t("options_modules_diff_extra"), extra);
		if (missing.length) addEntries(t("options_modules_diff_missing"), missing);
		if (!extra.length && !missing.length) addLine(t("options_modules_diff_order_only"));
	}

	// Entries of one list that the other does not have — the whole entry is compared
	// (path and instance id), and it also counts with the same entry being in the
	// list several times. The order of the result follows the order in the list.
	/** @type {Classes.OptionsController['_compareModuleLists']} */
	_compareModuleLists(userList, defaultList) {
		/** @type {Map<string, number>} */
		const remaining = new Map();
		for (const entry of defaultList) {
			remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
		}
		/** @type {string[]} */
		const extra = [];
		for (const entry of userList) {
			const count = remaining.get(entry) ?? 0;
			if (count > 0) {
				remaining.set(entry, count - 1);
			} else {
				extra.push(entry);
			}
		}
		/** @type {string[]} */
		const missing = [];
		for (const [entry, count] of remaining) {
			for (let i = 0; i < count; i++) missing.push(entry);
		}
		return { extra, missing };
	}

	/** @type {Classes.OptionsController['saveModulesList']} */
	async saveModulesList() {
		const text = this.jsonTextareaEl.value.trim();
		let paths;

		try {
			paths = JSON.parse(text);
			if (!Array.isArray(paths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch (err) {
			this._showStatus(t("options_invalid_json", /** @type {Error} */ (err).message));
			return;
		}

		await this.saveModulesJson(text);
		// An entry that was added to the list gets the default settings from
		// default-settings.json (only the missing values, see seedDefaultSettings()).
		const settings = await this.seedDefaultSettings(paths);
		await this._refreshModules(paths, settings);
		this._showStatus(t("options_modules_saved"));
	}

	/** @type {Classes.OptionsController['resetModulesList']} */
	async resetModulesList() {
		let defaultText;
		try {
			defaultText = await this.fetchDefaultModulesJson();
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}

		let paths;
		try {
			paths = JSON.parse(defaultText);
			if (!Array.isArray(paths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}

		// Identical to modules.json — saveModulesJson() removes the list from storage.
		await this.saveModulesJson(defaultText);
		this.jsonTextareaEl.value = JSON.stringify(paths, null, 2);

		// The default list also brings back previously removed entries (module instances) —
		// their settings were deleted by the removal, so the default values are filled in again.
		const settings = await this.seedDefaultSettings(paths);
		await this._refreshModules(paths, settings);
		this._showStatus(t("options_modules_reset"));
	}

	/** @type {Classes.OptionsController['renderModules']} */
	renderModules(modules, settings) {
		this.container.innerHTML = "";

		// Makes it possible to look up the module's own declared default values
		// (defaultActivationMode/defaultDisplayLocation/defaultOutputElement/
		// defaultShowHeading), if it has any — they are preselected (without
		// a user setting) and marked as recommended in the options.
		const moduleDefsByName = new Map(this._moduleDefs.map((mod) => [mod.name, mod]));

		modules.forEach((path) => {
			this.container.appendChild(this._createModuleRow(path, settings, moduleDefsByName.get(this.getModuleKey(path))));
		});
		this._updateModuleFilter(modules);
		this._markSaved("list");
	}

	// One row of the module list. A list entry can also be an instance of a module with
	// multiple instances ("…#id", see parseModuleEntry() in base.mjs) — that one
	// has its own settings under the "<module>#<id>" key (entry.key) instead of the module
	// name, plus the instanceSettingsSchema fields and a button to remove it.
	// The template of such a module (the entry without an id) shows nothing, so it has no
	// settings either — just a button that adds a new instance.
	/** @type {Classes.OptionsController['_createModuleRow']} */
	_createModuleRow(path, settings, moduleDef) {
		const entry = parseModuleEntry(path);
		const key = entry.key;
		const name = this.formatModuleName(entry.name);
		const mode = this.getModuleMode(settings, key, moduleDef?.defaultActivationMode);
		const displayLocations = getModuleDisplayLocations(
			settings,
			key,
			moduleDef?.defaultDisplayLocation
		);

		const row = document.createElement("div");
		row.className = "module-row";
		// MODULE_NAME (== key, see getModuleKey — according to the rules in README the
		// module file/folder must have the same name; for an instance "<module>#<id>") is
		// a more stable identifier for the row id than TAG (extension-*, derived from
		// MODULE_NAME): it is directly the value the row already carries as
		// dataset.moduleKey on the selects below. The whole list entry is stored separately
		// (dataset.modulePath) — without it, after dragging (see
		// _initDragToReorder/_persistModuleOrder) there would be no way to put
		// modules.json back together from the mere order of the <div>s.
		row.id = `module-row-${key}`;
		row.dataset.modulePath = path;
		row.dataset.moduleFilter = key;

		const nameEl = document.createElement("div");
		nameEl.className = "module-name";
		nameEl.textContent = name;
		// The module can be dragged up/down in the list by this heading (not by the
		// whole row) — see _initDragToReorder.
		nameEl.draggable = true;
		nameEl.title = t("options_drag_to_reorder");
		row.appendChild(nameEl);

		// A short module description (see moduleDef.description, module.mjs) —
		// optional, a missing one is simply not shown (no error, just a warning
		// on registration, see validateModule() in base.mjs). Not for an instance —
		// the description is already at the template and would only get in the way in every instance row.
		if (moduleDef?.description && !entry.instance) {
			const descriptionEl = document.createElement("small");
			descriptionEl.className = "module-description";
			descriptionEl.textContent = moduleDef.description;
			row.appendChild(descriptionEl);
		}

		// An uploaded module (see the "Uploaded modules (sandbox)" section) — the file it comes from,
		// or that the extension brings it itself.
		if (moduleDef?.sandbox && !entry.instance) {
			const noteEl = document.createElement("small");
			noteEl.className = "module-description";
			noteEl.textContent = moduleDef.sandbox.bundled
				? t("options_sandbox_row_note_bundled")
				: t("options_sandbox_row_note", moduleDef.sandbox.fileName);
			row.appendChild(noteEl);
		}

		if (moduleDef?.multiInstance && !entry.instance) {
			row.classList.add("module-row--template");
			row.appendChild(this._createAddInstanceButton(row, entry, name));
			row.appendChild(this._createDependenciesField(moduleDef));
			return row;
		}

		// The instanceSettingsSchema fields (contentDividerSandbox: heading and HTML) — the same
		// controls as the custom module settings below, they just belong to one
		// instance, so they are directly in its row. save() stores them.
		if (entry.instance) {
			row.classList.add("module-row--instance");
			(moduleDef?.instanceSettingsSchema || []).forEach((field) => {
				row.appendChild(this._createSettingRow(field, key, settings, "module-instance-setting-control"));
			});
		}

		row.appendChild(
			this._createLabeledSelect(
				t("options_activation_mode"),
				"module-mode",
				key,
				ACTIVATION_MODES,
				mode,
				moduleDef?.defaultActivationMode
			)
		);

		// A module this extension (a client) offers its service provider has two sets: alone, and while the provider
		// shows it too (see getModuleDelegatedDisplayLocations() in base.mjs).
		const offered = this._offersToProvider(moduleDef);
		row.appendChild(
			this._createDisplayLocationsField(
				key,
				displayLocations,
				// Only what the module itself declares — the global default value is not
				// marked (see RECOMMENDED_SUFFIX).
				parseDisplayLocations(moduleDef?.defaultDisplayLocation) || [],
				offered ? t("options_display_locations_alone") : undefined
			)
		);
		if (offered) {
			row.appendChild(this._createDelegatedDisplayLocationsField(key, getModuleDelegatedDisplayLocations(settings, key, displayLocations)));
		}

		// The frame and the heading are shared by all ticked locations — a different look in
		// different locations would mean both options for each location separately.
		row.appendChild(
			this._createFieldGroup(t("options_output_look"), "module-output-look", [
				this._createLabeledSelect(
					t("options_output_element"),
					"module-output-element",
					key,
					OUTPUT_ELEMENTS,
					getModuleOutputElement(settings, key, moduleDef?.defaultOutputElement),
					moduleDef?.defaultOutputElement
				),
				this._createLabeledCheckbox(
					t("options_show_heading"),
					"module-show-heading",
					key,
					getModuleShowHeading(settings, key, moduleDef?.defaultShowHeading)
				),
			])
		);

		// A module has one set of dependencies for all instances — they are shown only
		// at the template (above), like the description.
		if (moduleDef && !entry.instance) {
			row.appendChild(this._createDependenciesField(moduleDef));
		}

		if (entry.instance) {
			row.appendChild(this._createRemoveInstanceButton(row, entry, name));
		}

		this._syncOutputSettingsState(row);
		return row;
	}

	// Overview of dependencies at the end of a module row — everything the modules themselves
	// published in registerModule(), nothing is guessed from their code:
	// - dependsOn: modules without which the module (or part of it) does not work, and
	//   conversely modules that declare a dependency on it;
	// - consumesDetails / details: which modules it takes data from (the details
	//   contract) and which modules it provides data to;
	// - usesPermissions: optional permissions, including whether they are granted
	//   (filled in asynchronously, chrome.permissions.contains()).
	// Relations to other modules count only with modules in the current list
	// (this._moduleDefs) — a declared dependency on a module outside the list is
	// shown with a warning.
	/** @type {Classes.OptionsController['_createDependenciesField']} */
	_createDependenciesField(moduleDef) {
		const defs = this._moduleDefs;
		const listed = new Set(defs.map((mod) => mod.name));
		/** @type {HTMLElement[]} */
		const items = [];

		/** @type {(label: string, text: string, warning?: boolean) => HTMLElement} */
		const addItem = (label, text, warning = false) => {
			const item = document.createElement("li");
			const strong = document.createElement("strong");
			strong.textContent = `${label}: `;
			item.append(strong, text);
			if (warning) item.classList.add("module-dependency--warning");
			items.push(item);
			return item;
		};

		(moduleDef.dependsOn || []).forEach(({ module, reason }) => {
			const missing = !listed.has(module);
			const suffix = missing ? t("options_dependency_missing_suffix") : "";
			addItem(t("options_dependency_needs", this.formatModuleName(module)), `${reason}${suffix}`, missing);
		});

		const dependents = defs.filter((mod) => (mod.dependsOn || []).some((d) => d.module === moduleDef.name));
		if (dependents.length > 0) {
			addItem(t("options_dependency_dependents"), dependents.map((mod) => this.formatModuleName(mod.name)).join(", "));
		}

		(moduleDef.consumesDetails || []).forEach((scope) => {
			const providers = defs.filter((mod) => mod.name !== moduleDef.name && typeof mod.details?.[scope] === "function");
			addItem(
				t("options_details_consumes", DETAILS_SCOPE_LABELS[scope]),
				providers.length > 0
					? providers.map((mod) => this.formatModuleName(mod.name)).join(", ")
					: t("options_details_no_provider")
			);
		});

		/** @type {Enums.DetailsScope[]} */ (Object.keys(moduleDef.details || {})).forEach((scope) => {
			const consumers = defs.filter((mod) => mod.name !== moduleDef.name && (mod.consumesDetails || []).includes(scope));
			if (consumers.length === 0) return;
			addItem(
				t("options_details_provides", DETAILS_SCOPE_LABELS[scope]),
				consumers.map((mod) => this.formatModuleName(mod.name)).join(", ")
			);
		});

		(moduleDef.usesPermissions || []).forEach((permissionSet) => {
			const names = [...(permissionSet.permissions || []), ...(permissionSet.origins || [])];
			const item = addItem(t("options_optional_permission"), names.join(" + "));
			const status = document.createElement("span");
			status.className = "module-dependency-status";
			item.appendChild(status);
			// A permission the browser does not know (in Firefox e.g. "debugger") makes
			// contains() in Firefox fail SYNCHRONOUSLY with an exception (a check of the
			// parameter schema), not with a rejected promise — hence the call inside
			// .then(), otherwise the exception would break rendering of the whole module list.
			Promise.resolve()
				.then(() => chrome.permissions.contains(permissionSet))
				.then((granted) => {
					status.textContent = granted ? t("options_permission_granted") : t("options_permission_not_granted");
				})
				.catch(() => {
					status.textContent = t("options_permission_unavailable");
				});
		});

		const list = document.createElement("ul");
		list.className = "module-dependencies-list";
		if (items.length > 0) {
			list.append(...items);
		} else {
			const item = document.createElement("li");
			item.textContent = t("options_dependencies_none");
			list.appendChild(item);
		}

		return this._createFieldGroup(t("options_dependencies"), "module-dependencies", [list]);
	}

	// --- Instances of a module with multiple instances (see parseModuleEntry()) ---
	//
	// Adding and removing an instance changes the module list, so it is saved immediately —
	// the same as dragging a row (see _persistModuleOrder). The settings of a new
	// instance (fields in its row, mode, surface, ...) are saved like those of
	// other modules with the "Save settings" button; until then the default
	// values declared by the module apply.

	/** @type {Classes.OptionsController['_createAddInstanceButton']} */
	_createAddInstanceButton(templateRow, entry, name) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "module-row-button";
		button.textContent = t("options_add_instance", name);
		button.title = t("options_add_instance_title");
		button.addEventListener("click", () => this._addModuleInstance(templateRow, entry, name));
		return button;
	}

	// The new instance is inserted right below the template the user is clicking
	// (not at the end of a long list) and gets the focus.
	/** @type {Classes.OptionsController['_addModuleInstance']} */
	async _addModuleInstance(templateRow, entry, name) {
		const moduleDef = this._moduleDefs.find((mod) => mod.name === entry.name);
		const path = `${entry.path}${MODULE_INSTANCE_SEPARATOR}${createModuleInstanceId()}`;
		const row = this._createModuleRow(path, this._settings, moduleDef);
		templateRow.after(row);
		// Until the user changes them, the module's default values apply even without saving.
		this._markSaved("list", row);
		row.scrollIntoView({ block: "nearest" });
		/** @type {HTMLElement | null} */ (row.querySelector("input, textarea, select"))?.focus();
		await this._persistModuleOrder(t("options_instance_added", name));
	}

	/** @type {Classes.OptionsController['_createRemoveInstanceButton']} */
	_createRemoveInstanceButton(row, entry, name) {
		return this._createRemoveButton(() => this._removeModuleInstance(row, entry, name));
	}

	// Removing module instances and uploaded modules.
	/** @type {Classes.OptionsController['_createRemoveButton']} */
	_createRemoveButton(onConfirm) {
		return this._createConfirmButton(t("options_remove"), t("options_remove_confirm"), "module-row-button module-row-button--remove", onConfirm);
	}

	/** @type {Classes.OptionsController['_createConfirmButton']} */
	_createConfirmButton(label, confirmLabel, className, onConfirm) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = className;
		button.textContent = label;
		this._requireSecondClick(button, () => confirmLabel, onConfirm);
		return button;
	}

	// A two-step confirmation instead of window.confirm() (the same as importExport):
	// the first click only changes the button text, the second one within a few seconds confirms.
	// The label is taken at the first click — a button from options.html gets it from applyI18n() only after the constructor.
	/** @type {Classes.OptionsController['_requireSecondClick']} */
	_requireSecondClick(button, confirmLabel, onConfirm) {
		let label = "";
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let confirmTimer;
		const restore = () => {
			confirmTimer = undefined;
			button.textContent = label;
			button.classList.remove("button--confirming");
		};
		button.addEventListener("click", () => {
			if (confirmTimer === undefined) {
				label = button.textContent ?? "";
				button.textContent = confirmLabel();
				button.classList.add("button--confirming");
				confirmTimer = setTimeout(restore, 4000);
				return;
			}
			clearTimeout(confirmTimer);
			restore();
			onConfirm(button);
		});
	}

	// Removes the row and the list entry and with them all the instance settings —
	// "<module>#<id>" (mode) and "<module>#<id>.<field>" (surface, frame, fields of
	// instanceSettingsSchema). Without the instance it would only get in the way in storage.
	/** @type {Classes.OptionsController['_removeModuleInstance']} */
	async _removeModuleInstance(row, entry, name) {
		row.remove();
		await this._persistModuleOrder(t("options_instance_removed", name));

		const settings = { ...(await this.loadSettings()) };
		for (const storageKey of Object.keys(settings)) {
			if (storageKey === entry.key || storageKey.startsWith(`${entry.key}.`)) {
				delete settings[storageKey];
			}
		}
		await this.saveSettings(settings);
	}

	// Which of the output settings in the row make sense. A turned-off module is not shown
	// anywhere — the locations are grayed out, but the ticks stay, so they still apply after the
	// module is turned on. Without a ticked location the module is not shown anywhere; the sentence
	// below the locations explains both. "Output element" and "with module heading" make sense only
	// for a module that is shown somewhere. In addition, the heading cannot be turned off for
	// a collapsible element — <summary> is the only thing the frame can be expanded by
	// (see mountModuleElement in base.mjs). Values of disabled fields are kept unchanged
	// on save.
	/** @type {Classes.OptionsController['_syncOutputSettingsState']} */
	_syncOutputSettingsState(row) {
		const modeSelect = /** @type {HTMLSelectElement | null} */ (row.querySelector(".module-mode"));
		const locationsField = row.querySelector(".module-display-locations");
		const locationCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (row.querySelectorAll(".module-display-location"));
		const hint = /** @type {HTMLElement | null} */ (row.querySelector(".module-display-locations .module-row-hint"));
		const elementSelect = /** @type {HTMLSelectElement | null} */ (row.querySelector(".module-output-element"));
		const headingCheckbox = /** @type {HTMLInputElement | null} */ (row.querySelector(".module-show-heading"));
		// The template of a module with multiple instances has no output settings (see
		// _createModuleRow).
		if (!modeSelect || !locationsField || !hint || !elementSelect || !headingCheckbox) return;

		const disabled = DISABLED_SPEC.isSatisfiedBy({ mode: /** @type {Enums.ActivationMode} */ (modeSelect.value) });
		// With "Do not use the sidebar" the sidebar tick stays (and is saved), it just does not show the module.
		/** @param {HTMLInputElement} checkbox */
		const isSidebarOff = (checkbox) => this._sidebarDisabled && checkbox.value === "sidebar";
		// An extension without a sidebar in its manifest (hasManifestSidebar()) does not offer the location at all.
		const noSidebar = !hasManifestSidebar();
		const ticked = [...locationCheckboxes].filter((checkbox) => checkbox.checked);
		const notDisplayed = disabled || !ticked.some((checkbox) => !isSidebarOff(checkbox));
		const collapsible = !!getOutputElementDef(elementSelect.value).collapsible;
		// The second set of a module offered to the service provider (_createDelegatedDisplayLocationsField()) — the look
		// of the output also applies to it.
		const delegatedCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (row.querySelectorAll(".module-delegated-display-location"));
		const noOutput = notDisplayed && (disabled || ![...delegatedCheckboxes].some((checkbox) => checkbox.checked && !isSidebarOff(checkbox)));

		[...locationCheckboxes, ...delegatedCheckboxes].forEach((checkbox) => {
			const label = /** @type {HTMLLabelElement} */ (checkbox.parentElement);
			checkbox.disabled = disabled || isSidebarOff(checkbox);
			label.title = isSidebarOff(checkbox) && !noSidebar ? t("options_location_sidebar_off") : "";
			label.hidden = noSidebar && checkbox.value === "sidebar";
		});
		hint.textContent = disabled
			? t(DISABLED_HINT)
			: notDisplayed && ticked.length > 0
				? t(SIDEBAR_ONLY_HINT)
				: notDisplayed
					? t(NOT_DISPLAYED_HINT)
					: "";
		hint.hidden = !notDisplayed;

		elementSelect.disabled = noOutput;
		headingCheckbox.disabled = noOutput || collapsible;
		/** @type {HTMLLabelElement} */ (headingCheckbox.parentElement).title =
			!noOutput && collapsible
				? t("options_heading_always_visible")
				: "";
	}

	// A group of options in a module row — a <fieldset> with a heading (<legend>) and
	// options side by side (they wrap when they do not fit). Shared between the output
	// locations and the output look.
	/** @type {Classes.OptionsController['_createFieldGroup']} */
	_createFieldGroup(legendText, className, controls) {
		const fieldset = document.createElement("fieldset");
		fieldset.className = `module-row-group ${className}`;

		const legend = document.createElement("legend");
		legend.textContent = legendText;

		const options = document.createElement("div");
		options.className = "module-row-group-options";
		options.append(...controls);

		fieldset.append(legend, options);
		return fieldset;
	}

	// "Show module output" — a checkbox for each location (DISPLAY_LOCATIONS);
	// the module is shown in all ticked ones. "Show nowhere" is not an option,
	// but the state without any tick; what it means is said by the sentence below the locations (see
	// _syncOutputSettingsState). Locations the module itself recommends
	// (defaultDisplayLocation, possibly several) have RECOMMENDED_SUFFIX after the text.
	/** @type {Classes.OptionsController['_createDisplayLocationsField']} */
	_createDisplayLocationsField(moduleKey, locations, recommendedLocations, legendText = t("options_display_locations")) {
		const checkboxes = DISPLAY_LOCATIONS.map((opt) => {
			const label = this._createLabeledCheckbox(
				recommendedLocations.includes(opt.value) ? `${opt.label}${recommendedSuffix()}` : opt.label,
				"module-display-location",
				moduleKey,
				locations.includes(opt.value)
			);
			/** @type {HTMLInputElement} */ (label.querySelector("input")).value = opt.value;
			return label;
		});

		const fieldset = this._createFieldGroup(legendText, "module-display-locations", checkboxes);
		fieldset.dataset.moduleKey = moduleKey;

		const hint = document.createElement("small");
		hint.className = "module-row-hint";
		hint.hidden = true;
		fieldset.appendChild(hint);
		return fieldset;
	}

	// The second set of output locations (delegatedDisplayLocation): where this client shows a module while its service
	// provider shows it too.
	/** @type {Classes.OptionsController['_createDelegatedDisplayLocationsField']} */
	_createDelegatedDisplayLocationsField(moduleKey, locations) {
		const checkboxes = DISPLAY_LOCATIONS.map((opt) => {
			const label = this._createLabeledCheckbox(opt.label, "module-delegated-display-location", moduleKey, locations.includes(opt.value));
			/** @type {HTMLInputElement} */ (label.querySelector("input")).value = opt.value;
			return label;
		});
		const fieldset = this._createFieldGroup("", "module-delegated-display-locations", checkboxes);
		fieldset.dataset.moduleKey = moduleKey;
		this._describeDelegatedDisplayLocations(fieldset);
		return fieldset;
	}

	// The provider's name comes later than the rows (_renderExtensionServices()) — it is put in again then.
	/** @type {Classes.OptionsController['_describeDelegatedDisplayLocations']} */
	_describeDelegatedDisplayLocations(fieldset) {
		const legend = fieldset.querySelector("legend");
		if (legend) legend.textContent = t("options_display_locations_delegated", this._serviceProviderName ?? t("options_services_provider_unnamed"));
	}

	// The modules this extension (a client) offers its service provider: its uploaded modules the extension brings itself
	// (buildServiceRegistration() in base.mjs) — only those can the provider show.
	/** @type {Classes.OptionsController['_offersToProvider']} */
	_offersToProvider(moduleDef) {
		return !!this._serviceProviderId && !!moduleDef?.sandbox?.bundled && !moduleDef.sandbox.client;
	}

	// Builds <label>Text<select>...</select></label> for one module row
	// — shared between the select of the activation mode and of the output element, so the
	// same logic is not created separately in several places. The option
	// the module recommends (recommendedValue) gets RECOMMENDED_SUFFIX;
	// without a recommendation (or with an invalid value) none is marked.
	/** @type {Classes.OptionsController['_createLabeledSelect']} */
	_createLabeledSelect(labelText, selectClassName, moduleKey, options, selectedValue, recommendedValue) {
		const label = document.createElement("label");
		label.className = "module-row-field";
		label.textContent = labelText;

		const select = document.createElement("select");
		select.className = selectClassName;
		select.dataset.moduleKey = moduleKey;

		options.forEach((opt) => {
			const option = document.createElement("option");
			option.value = opt.value;
			option.textContent = opt.value === recommendedValue ? `${opt.label}${recommendedSuffix()}` : opt.label;
			if (opt.value === selectedValue) {
				option.selected = true;
			}
			select.appendChild(option);
		});

		label.appendChild(select);
		return label;
	}

	// The counterpart of _createLabeledSelect for a yes/no option — a checkbox before the text.
	/** @type {Classes.OptionsController['_createLabeledCheckbox']} */
	_createLabeledCheckbox(labelText, checkboxClassName, moduleKey, checked) {
		const label = document.createElement("label");
		label.className = "module-row-field module-row-checkbox";

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.className = checkboxClassName;
		checkbox.dataset.moduleKey = moduleKey;
		checkbox.checked = checked;

		label.append(checkbox, labelText);
		return label;
	}

	// --- Dragging a row (changing the module order) ---
	//
	// It can be grabbed only by the module heading (.module-name, draggable="true" — see
	// renderModules), not by the whole row (e.g. because of the selects, where
	// draggable on the parent would prevent normal mouse work). The rows are always
	// below each other in one column, so "only along the Y axis" (up/down) holds by
	// itself — the dragged row moves among its siblings according to which of them
	// the cursor is currently over (see _rowAfterPoint), not according to the X position.
	// The container (#modules-list) listens permanently, even after re-rendering — it is
	// still the same element, only its content is cleared/filled (see renderModules).
	/** @type {Classes.OptionsController['_initDragToReorder']} */
	_initDragToReorder() {
		this.container.addEventListener("dragstart", (e) => {
			const handle = /** @type {Element} */ (e.target).closest(".module-name");
			const row = handle && handle.closest(".module-row");
			if (!row) return;
			this._draggedRow = row;
			/** @type {DataTransfer} */ (e.dataTransfer).effectAllowed = "move";
			// The data are not read anywhere (the move is handled directly in the DOM, see dragover/drop), but
			// without at least an empty setData() Firefox would not start the drag at all.
			/** @type {DataTransfer} */ (e.dataTransfer).setData("text/plain", row.id);
			row.classList.add("dragging");
		});

		this.container.addEventListener("dragend", () => {
			if (this._draggedRow) {
				this._draggedRow.classList.remove("dragging");
			}
			this._draggedRow = null;
		});

		this.container.addEventListener("dragover", (e) => {
			if (!this._draggedRow) return;
			// Without preventDefault() the browser does not allow the drop at all (the default
			// behavior of dragover is "you cannot drop here").
			e.preventDefault();
			/** @type {DataTransfer} */ (e.dataTransfer).dropEffect = "move";

			const afterRow = this._rowAfterPoint(e.clientY);
			if (afterRow === null) {
				this.container.appendChild(this._draggedRow);
			} else if (afterRow !== this._draggedRow) {
				this.container.insertBefore(this._draggedRow, afterRow);
			}
		});

		this.container.addEventListener("drop", async (e) => {
			e.preventDefault();
			if (!this._draggedRow) return;
			await this._persistModuleOrder();
		});
	}

	// The row BEFORE which the dragged row should be inserted — according to whether
	// the cursor is over the upper or the lower half of the given row (the vertical center as
	// the boundary). null = the dragged row belongs at the very end of the list.
	/** @type {Classes.OptionsController['_rowAfterPoint']} */
	_rowAfterPoint(y) {
		const rows = [...this.container.querySelectorAll(".module-row:not(.dragging)")];
		/** @type {Types.ModuleRowCandidate} */
		let closest = { offset: Number.NEGATIVE_INFINITY, row: null };

		for (const row of rows) {
			const box = row.getBoundingClientRect();
			const offset = y - box.top - box.height / 2;
			if (offset < 0 && offset > closest.offset) {
				closest = { offset, row };
			}
		}
		return closest.row;
	}

	// The current order of <div class="module-row"> in the DOM (after dragging, see above) ->
	// a new array of paths -> the same persistence path as for a manual edit of the JSON
	// textarea (saveModulesList), and the JSON editor is kept in sync too, so the
	// dragged order is visible in it right away.
	// The same after adding/removing a module instance, just with a different message (status).
	/** @type {Classes.OptionsController['_persistModuleOrder']} */
	async _persistModuleOrder(status = t("options_order_saved")) {
		const paths = [.../** @type {NodeListOf<HTMLElement>} */ (this.container.querySelectorAll(".module-row"))].map((row) => row.dataset.modulePath);
		const text = JSON.stringify(paths, null, 2);

		this.jsonTextareaEl.value = text;
		await this.saveModulesJson(text);
		this._showStatus(status);
	}

	// Dynamically loads the module JS files (so their registration runs and
	// their settingsSchema is available), and re-renders both sections that depend on
	// the current module list — the activation modes and the custom settings.
	/** @type {Classes.OptionsController['_refreshModules']} */
	async _refreshModules(paths, settings) {
		this._moduleDefs = await this.importModuleFiles(paths);
		this.renderModules(paths, settings);
		this.renderModuleSettings(this._moduleDefs, settings);
	}

	// After a change of the module list from outside the editor (an uploaded module added or
	// removed) — the JSON editor, the default settings of a new entry and both sections that
	// depend on the list, the same as saveModulesList().
	/** @type {Classes.OptionsController['_reloadModulesList']} */
	async _reloadModulesList() {
		await this.loadModulesListEditor();
		let paths;
		try {
			paths = JSON.parse(await this.getModulesJson());
			if (!Array.isArray(paths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}
		const settings = await this.seedDefaultSettings(paths);
		await this._refreshModules(paths, settings);
	}

	// --- Uploaded modules (sandbox) ---
	//
	// The file input only hands the file to the core: checking it, evaluating it in the
	// sandbox, the module rules, storing it and adding it to the module list is done by
	// installSandboxModule() in base.mjs. Here is just the result for the user, the list of
	// uploaded modules and refreshing the sections that depend on the module list.

	/** @type {Classes.OptionsController['_uploadSandboxModule']} */
	async _uploadSandboxModule() {
		const file = this.sandboxFileInput.files?.[0];
		if (!file) return;
		this.sandboxFileInput.disabled = true;
		this._showSandboxReport({ text: t("options_sandbox_checking", file.name) });
		try {
			const result = await installSandboxModule(file);
			if (result.ok && result.name) {
				const title = this.formatModuleName(result.name);
				const text = result.updated
					? t("options_sandbox_updated", title)
					: result.added
						? t("options_sandbox_installed", title)
						: t("options_sandbox_uploaded", title);
				// The functions outside the sandbox the module asks for and the user has not decided about yet.
				const record = (await readSandboxModules())[result.name];
				const pending = record
					? getSandboxCapabilityOverview(record, await readSandboxCapabilityGrants())
							.filter((capability) => capability.state === "pending")
							.map((capability) => capability.name)
					: [];
				const notes = pending.length > 0 ? [t("options_sandbox_capabilities_pending", pending.join(", "))] : [];
				this._showSandboxReport({ text, notes, warnings: result.warnings });
				await this._reloadModulesList();
			} else {
				this._showSandboxReport({ text: t("options_sandbox_failed"), items: result.errors, warnings: result.warnings, error: true });
			}
		} catch (err) {
			console.error("Nahrání modulu selhalo:", err);
			this._showSandboxReport({ text: t("options_sandbox_failed"), items: [/** @type {Error} */ (err).message], error: true });
		} finally {
			this.sandboxFileInput.disabled = false;
			// The same file can be chosen again (after it is fixed).
			this.sandboxFileInput.value = "";
		}
		await this._renderSandboxModules();
	}

	// The result of an upload below the file input: the first sentence, the errors (the module rules
	// are the same as for modules from the package, see validateModule() in base.mjs) and warnings.
	/** @type {Classes.OptionsController['_showSandboxReport']} */
	_showSandboxReport({ text, items = [], notes = [], warnings = [], error = false }) {
		const report = this.sandboxReportEl;
		report.replaceChildren();
		report.hidden = false;
		report.classList.toggle("sandbox-module-report--error", error);

		/** @type {(content: string) => void} */
		const addParagraph = (content) => {
			const paragraph = document.createElement("p");
			paragraph.textContent = content;
			report.appendChild(paragraph);
		};
		/** @type {(lines: string[]) => void} */
		const addList = (lines) => {
			const list = document.createElement("ul");
			for (const line of lines) {
				const item = document.createElement("li");
				item.textContent = line;
				list.appendChild(item);
			}
			report.appendChild(list);
		};

		addParagraph(text);
		if (items.length > 0) addList(items);
		for (const note of notes) addParagraph(note);
		if (warnings.length > 0) {
			addParagraph(t("options_sandbox_warnings"));
			addList(warnings);
		}
	}

	// The list of uploaded modules: the file, the size, when it was uploaded, its fingerprint and whether
	// it is in the module list (otherwise it is not loaded anywhere) — or that its files are missing
	// (the whole-extension backup has only chrome.storage.local, the files are in IndexedDB, see
	// SANDBOX_PACKAGES_DB in base.mjs); "Add to the module list" and "Remove". Only the last of
	// overlapping renderings is shown.
	/** @type {Classes.OptionsController['_renderSandboxModules']} */
	async _renderSandboxModules() {
		const run = ++this._sandboxRenderRun;
		const store = await readSandboxModules();
		/** @type {Set<string>} */
		const listed = new Set();
		try {
			const paths = JSON.parse(await this.getModulesJson());
			if (Array.isArray(paths)) {
				for (const path of paths.filter(isSandboxModuleEntry)) listed.add(this.getModuleKey(path));
			}
		} catch {
			// An unreadable list — every module is shown as not listed.
		}
		const records = Object.values(store).sort((a, b) => String(a.name).localeCompare(String(b.name)));
		const [intact, grants, log] = await Promise.all([
			Promise.all(records.map(async (record) => (await readSandboxPackage(record.name))?.hash === record.hash)),
			readSandboxCapabilityGrants(),
			readSandboxCapabilityLog(),
		]);
		if (run !== this._sandboxRenderRun) return;

		this.sandboxListEl.replaceChildren();
		if (records.length === 0) {
			const empty = document.createElement("li");
			empty.className = "no-settings";
			empty.textContent = t("options_sandbox_none");
			this.sandboxListEl.appendChild(empty);
			return;
		}
		records.forEach((record, index) => {
			const item = this._createSandboxModuleItem(record, listed.has(record.name), intact[index]);
			const capabilities = this._createSandboxCapabilities(
				record,
				grants,
				log.filter((entry) => entry.module === record.name)
			);
			if (capabilities) item.appendChild(capabilities);
			this.sandboxListEl.appendChild(item);
		});
	}

	// The functions outside the sandbox of one uploaded module (see SANDBOX_CAPABILITIES in base.mjs):
	// those it declared, each with what it allows, its risk and the user's choice — or why it cannot be
	// allowed, or that the core does not offer it; below them the requests for functions it did not
	// declare. Each with its record (outcomes with counts, the last time). null = nothing to show.
	/** @type {Classes.OptionsController['_createSandboxCapabilities']} */
	_createSandboxCapabilities(record, grants, entries) {
		const overview = getSandboxCapabilityOverview(record, grants);
		const declared = new Set(overview.map((capability) => capability.name));
		const others = [...new Set(entries.map((entry) => entry.capability))].filter((name) => !declared.has(name));
		if (overview.length === 0 && others.length === 0) return null;

		const box = document.createElement("div");
		box.className = "sandbox-capabilities";
		const title = document.createElement("p");
		title.className = "sandbox-capabilities-title";
		title.textContent = t("options_sandbox_capabilities_title");
		box.appendChild(title);

		/** @type {(names: string[]) => HTMLUListElement} */
		const createList = (names) => {
			const list = document.createElement("ul");
			list.className = "sandbox-capability-list";
			for (const name of names) {
				const info = overview.find((capability) => capability.name === name) ?? describeSandboxCapability(name);
				const item = document.createElement("li");
				item.className = "sandbox-capability";
				item.dataset.capability = name;
				const nameEl = document.createElement("code");
				nameEl.textContent = name;
				const aboutEl = document.createElement("span");
				aboutEl.className = "sandbox-capability-about";
				if (info.kind === "catalog") {
					aboutEl.textContent = `${info.about} · ${info.risk ? CAPABILITY_RISK_LABELS[info.risk] : ""}`;
				} else if (info.kind === "forbidden") {
					aboutEl.textContent = t("options_sandbox_capability_forbidden", info.blocked ?? "");
				} else if (info.kind === "base") {
					aboutEl.textContent = t("options_sandbox_capability_base");
				} else {
					aboutEl.textContent = t("options_sandbox_capability_unknown");
				}
				item.append(nameEl, " ", aboutEl);
				// The user's choice — only for a declared function of the catalog.
				if (info.kind === "catalog" && declared.has(name)) item.appendChild(this._createSandboxCapabilityChoice(record, name, grants));
				const usage = this._describeSandboxCapabilityUse(entries.filter((entry) => entry.capability === name));
				if (usage) {
					const usageEl = document.createElement("small");
					usageEl.className = "sandbox-capability-usage";
					usageEl.textContent = usage;
					item.appendChild(usageEl);
				}
				list.appendChild(item);
			}
			return list;
		};

		if (overview.length > 0) box.appendChild(createList(overview.map((capability) => capability.name)));
		if (others.length > 0) {
			const othersTitle = document.createElement("p");
			othersTitle.className = "sandbox-capabilities-title";
			othersTitle.textContent = t("options_sandbox_capabilities_other");
			box.append(othersTitle, createList(others));
		}
		if (entries.length > 0) {
			const clearButton = document.createElement("button");
			clearButton.type = "button";
			clearButton.className = "module-row-button";
			clearButton.textContent = t("options_sandbox_capabilities_clear");
			clearButton.addEventListener("click", () => {
				clearSandboxCapabilityLog(record.name).catch((err) => this._showStatus(t("options_error", /** @type {Error} */ (err).message)));
			});
			box.appendChild(clearButton);
		}
		return box;
	}

	// The <select> of the user's decision about a function: undecided (refused — for a module the
	// extension brings itself allowed), allow, deny. The core stores it (and records it); the list is
	// rendered again by the storage change.
	/** @type {Classes.OptionsController['_createSandboxCapabilityChoice']} */
	_createSandboxCapabilityChoice(record, name, grants) {
		const select = document.createElement("select");
		select.className = "sandbox-capability-choice";
		select.setAttribute("aria-label", t("options_sandbox_capability_select_label", name));
		const options = [
			{ value: "", label: record.bundled ? t("options_sandbox_capability_choice_default") : t("options_sandbox_capability_choice_pending") },
			{ value: "allow", label: t("options_sandbox_capability_choice_allow") },
			{ value: "deny", label: t("options_sandbox_capability_choice_deny") },
		];
		for (const { value, label } of options) {
			const option = document.createElement("option");
			option.value = value;
			option.textContent = label;
			select.appendChild(option);
		}
		const own = Object.hasOwn(grants, record.name) ? grants[record.name] : {};
		const decision = Object.hasOwn(own, name) ? own[name] : undefined;
		select.value = decision === true ? "allow" : decision === false ? "deny" : "";
		select.addEventListener("change", () => {
			const value = select.value === "allow" ? true : select.value === "deny" ? false : null;
			setSandboxCapabilityGrant(record.name, name, value).catch((err) => this._showStatus(t("options_error", /** @type {Error} */ (err).message)));
		});
		return select;
	}

	// The record of one function as one line: the outcomes with their counts and the last time.
	/** @type {Classes.OptionsController['_describeSandboxCapabilityUse']} */
	_describeSandboxCapabilityUse(entries) {
		if (entries.length === 0) return "";
		const counts = entries.map((entry) => `${CAPABILITY_OUTCOME_LABELS[entry.outcome] ?? entry.outcome} ${entry.count}×`);
		const last = Math.max(...entries.map((entry) => entry.last));
		return `${counts.join(", ")} · ${t("options_sandbox_capability_last", new Date(last).toLocaleString(getUiLocale()))}`;
	}

	/** @type {Classes.OptionsController['_createSandboxModuleItem']} */
	_createSandboxModuleItem(record, listed, intact) {
		const item = document.createElement("li");
		item.className = "module-row";
		item.dataset.moduleFilter = record.name;

		const nameEl = document.createElement("div");
		nameEl.className = "module-name";
		nameEl.textContent = this.formatModuleName(record.name);

		const metaEl = document.createElement("small");
		metaEl.className = "module-description";
		const updated = new Date(record.updatedAt).toLocaleString(getUiLocale());
		// A module the extension brings itself has no uploaded file — the core installs it from
		// the extension (see BUNDLED_SANDBOX_MODULES in base.mjs).
		metaEl.textContent = record.bundled
			? t("options_sandbox_bundled_meta", record.files, this.formatBytes(record.size), updated, String(record.hash).slice(0, 12))
			: t(
					"options_sandbox_meta",
					record.files > 1 ? t("options_sandbox_package", record.fileName, record.files) : record.fileName,
					this.formatBytes(record.size),
					updated,
					String(record.hash).slice(0, 12)
				);
		metaEl.title = `SHA-256 ${record.hash}`;

		const statusEl = document.createElement("small");
		statusEl.className = "module-row-hint";
		statusEl.textContent = !intact ? t("options_sandbox_files_missing") : listed ? t("options_sandbox_listed") : t("options_sandbox_not_listed");

		const buttons = document.createElement("div");
		buttons.className = "sandbox-module-buttons";
		if (!listed) {
			const addButton = document.createElement("button");
			addButton.type = "button";
			addButton.className = "module-row-button";
			addButton.textContent = t("options_sandbox_add_to_list");
			addButton.addEventListener("click", () => this._addSandboxModuleToList(record.name));
			buttons.appendChild(addButton);
		}
		// One the extension brings itself would be installed again by the next page.
		if (!record.bundled) buttons.appendChild(this._createRemoveButton(() => this._removeSandboxModule(record.name)));

		item.append(nameEl, metaEl, statusEl, buttons);
		return item;
	}

	// Modules from other extensions (see base.mjs): as a client what its service provider shows (and that the modules
	// are edited here too), as the provider the extensions that offer their modules — the user allows, denies or
	// removes each one (never in a standalone extension: it has no clients, readExtensionServiceClients()). The section
	// is hidden when there is nothing to say. Only the last of overlapping renderings is shown.
	/** @type {Classes.OptionsController['_renderExtensionServices']} */
	async _renderExtensionServices() {
		const run = ++this._servicesRenderRun;
		const [providerId, clients] = await Promise.all([readServiceProviderId(), readExtensionServiceClients()]);
		const state = providerId ? await getServiceProviderState() : null;
		const records = Object.values(clients).sort((a, b) => a.name.localeCompare(b.name));
		const alive = await Promise.all(records.map((client) => (client.status === "approved" ? isExtensionServiceClientAlive(client.id) : Promise.resolve(false))));
		if (run !== this._servicesRenderRun) return;

		this.servicesSectionEl.hidden = !providerId && records.length === 0;
		this._syncSectionTabs();
		// The provider's name also in the second set of output locations of the module rows.
		this._serviceProviderName = state?.provider ?? null;
		this.container.querySelectorAll(".module-delegated-display-locations").forEach((fieldset) => this._describeDelegatedDisplayLocations(fieldset));
		this.servicesProviderEl.replaceChildren();
		this.servicesProviderEl.hidden = !state;
		if (state) this.servicesProviderEl.appendChild(this._describeServiceProvider(state));

		this.servicesListEl.replaceChildren();
		records.forEach((client, index) => this.servicesListEl.appendChild(this._createServiceClientItem(client, alive[index])));

		// options.html#extension-services (the notice of a pending client on the other pages): the section is shown only
		// now — initPage() may have scrolled before it was.
		if (!this._servicesScrolled && !this.servicesSectionEl.hidden && window.location.hash === `#${EXTENSION_SERVICES_SECTION_ID}`) {
			this._servicesScrolled = true;
			this._revealTarget(this.servicesSectionEl);
		}
	}

	// What the service provider of this extension (a client) shows: the status and what to do.
	/** @type {Classes.OptionsController['_describeServiceProvider']} */
	_describeServiceProvider(state) {
		const box = document.createElement("div");
		const paragraph = document.createElement("p");
		const provider = state.provider ?? t("options_services_provider_unnamed");
		const shown = state.shown.map((name) => this.formatModuleName(name)).join(", ");
		paragraph.textContent =
			state.status === "approved"
				? shown
					? t("options_services_client_approved", shown, provider)
					: t("options_services_client_approved_none", provider)
				: state.status === "pending"
					? t("options_services_client_pending", provider)
					: state.status === "denied"
						? t("options_services_client_denied", provider)
						: t("options_services_client_unknown");
		box.appendChild(paragraph);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "module-row-button";
		button.textContent = t("options_services_client_register");
		// The registration needs the services of the background parts — background.js sends it.
		button.addEventListener("click", () => {
			button.disabled = true;
			sendToBackground({ type: EXTENSION_SERVICE_REGISTER_NOW_MESSAGE })
				.catch((err) => this._showStatus(t("options_error", /** @type {Error} */ (err).message)))
				.finally(() => {
					button.disabled = false;
				});
		});
		box.appendChild(button);
		return box;
	}

	// One extension that offers its modules: its name, id and version, the decision, its modules, the modules of this
	// extension it runs instead, what it does for its modules (the functions it serves), and the buttons.
	/** @type {Classes.OptionsController['_createServiceClientItem']} */
	_createServiceClientItem(client, alive) {
		const item = document.createElement("li");
		// A pending client stands out — until the decision the modules it runs instead work in both extensions.
		item.className = client.status === "pending" ? "module-row module-row--attention" : "module-row";
		item.dataset.serviceClient = client.id;

		const nameEl = document.createElement("div");
		nameEl.className = "module-name";
		nameEl.textContent = client.name;
		const metaEl = document.createElement("small");
		metaEl.className = "module-description";
		metaEl.textContent = t("options_services_meta", client.id, client.version, new Date(client.updatedAt).toLocaleString(getUiLocale()));
		const statusEl = document.createElement("small");
		statusEl.className = "module-row-hint";
		statusEl.textContent =
			client.status === "approved"
				? alive
					? t("options_services_status_approved")
					: t("options_services_status_approved_absent")
				: client.status === "denied"
					? t("options_services_status_denied")
					: t("options_services_status_pending");
		item.append(nameEl, metaEl, statusEl);

		/** @type {(text: string) => void} */
		const addLine = (text) => {
			const line = document.createElement("small");
			line.className = "module-row-hint";
			line.textContent = text;
			item.appendChild(line);
		};
		const modules = Object.keys(client.modules).map((name) => this.formatModuleName(name));
		if (modules.length > 0) addLine(t("options_services_modules", modules.join(", ")));
		if (client.replaces.length > 0) addLine(t("options_services_replaces", client.replaces.map((name) => this.formatModuleName(name)).join(", ")));
		const backup = client.backup ?? [];
		if (backup.length > 0) addLine(t("options_services_backup", backup.map((name) => this.formatModuleName(name)).join(", ")));
		if (client.services.length > 0) {
			const box = document.createElement("div");
			box.className = "sandbox-capabilities";
			const title = document.createElement("p");
			title.className = "sandbox-capabilities-title";
			title.textContent = t("options_services_services_title");
			const list = document.createElement("ul");
			list.className = "sandbox-capability-list";
			for (const service of client.services) {
				const entry = document.createElement("li");
				entry.className = "sandbox-capability";
				const code = document.createElement("code");
				code.textContent = service.name;
				// A function this extension knows from its own catalog is described in its own words (and the UI
				// language of this page); otherwise as the other extension describes it.
				const known = describeSandboxCapability(service.name);
				const about = document.createElement("span");
				about.className = "sandbox-capability-about";
				about.textContent =
					known.kind === "catalog" && known.about && known.risk
						? `${known.about} · ${CAPABILITY_RISK_LABELS[known.risk]}`
						: `${service.about} · ${CAPABILITY_RISK_LABELS[service.risk]}`;
				entry.append(code, " ", about);
				list.appendChild(entry);
			}
			box.append(title, list);
			item.appendChild(box);
		}
		// The services of the modules of this extension its modules use (api.services.call()) — this extension does them for
		// it, with its data (the categories of bookmarkChecker for the contacts of contactsModule), as it says why.
		const uses = client.uses ?? [];
		if (uses.length > 0) {
			const box = document.createElement("div");
			box.className = "sandbox-capabilities";
			const title = document.createElement("p");
			title.className = "sandbox-capabilities-title";
			title.textContent = t("options_services_uses_title");
			const list = document.createElement("ul");
			list.className = "sandbox-capability-list";
			for (const use of uses) {
				const entry = document.createElement("li");
				entry.className = "sandbox-capability";
				const code = document.createElement("code");
				code.textContent = use.name;
				const about = document.createElement("span");
				about.className = "sandbox-capability-about";
				about.textContent = use.about;
				entry.append(code, " ", about);
				list.appendChild(entry);
			}
			box.append(title, list);
			item.appendChild(box);
		}

		const buttons = document.createElement("div");
		buttons.className = "sandbox-module-buttons";
		/** @type {(label: string, action: () => Promise<unknown>) => void} */
		const addButton = (label, action) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "module-row-button";
			button.textContent = label;
			button.addEventListener("click", async () => {
				button.disabled = true;
				try {
					await action();
				} catch (err) {
					this._showStatus(t("options_error", /** @type {Error} */ (err).message));
				} finally {
					button.disabled = false;
				}
			});
			buttons.appendChild(button);
		};
		if (client.status !== "approved") {
			addButton(t("options_services_allow"), async () => {
				const { problems, removed } = await approveExtensionServiceClient(client.id);
				await this._reloadModulesList();
				const messages = [];
				if (removed.length > 0) messages.push(t("options_services_allowed_removed", removed.map((name) => this.formatModuleName(name)).join(", "), client.name));
				if (problems.length > 0) messages.push(`${t("options_services_allowed_problems")} ${problems.join("; ")}`);
				if (messages.length > 0) this._showStatus(messages.join(" "), 10000);
			});
		}
		if (client.status !== "denied") addButton(t("options_services_deny"), () => denyExtensionServiceClient(client.id));
		if (client.status === "approved" && alive) addButton(t("options_services_open"), () => openExtensionServiceClient(client.id));
		buttons.appendChild(this._createRemoveButton(() => removeExtensionServiceClient(client.id)));
		item.appendChild(buttons);
		return item;
	}

	/** @type {Classes.OptionsController['_addSandboxModuleToList']} */
	async _addSandboxModuleToList(name) {
		if (await addSandboxModuleToList(name)) {
			this._showStatus(t("options_sandbox_added", this.formatModuleName(name)), 4000);
		}
		await this._reloadModulesList();
		await this._renderSandboxModules();
	}

	// The core removes the module with its list entries and settings; its element in the
	// "Module output" section of this page goes away with it.
	/** @type {Classes.OptionsController['_removeSandboxModule']} */
	async _removeSandboxModule(name) {
		await removeSandboxModule(name);
		this.outputEl.querySelectorAll(`.module-frame[data-module="${CSS.escape(name)}"]`).forEach((frame) => frame.remove());
		await this._reloadModulesList();
		await this._renderSandboxModules();
		this._showStatus(t("options_sandbox_removed", this.formatModuleName(name)), 4000);
	}

	// --- Custom module settings (settingsSchema) ---

	/** @type {Classes.OptionsController['renderModuleSettings']} */
	renderModuleSettings(moduleDefs, settings) {
		this.moduleSettingsContainer.innerHTML = "";

		// A module whose element edits its settings itself (registerModule({ settingsView }) — an uploaded module's editor
		// runs in its sandbox) gets a block too.
		const modulesWithSchema = moduleDefs.filter(
			(mod) => (Array.isArray(mod.settingsSchema) && mod.settingsSchema.length > 0) || mod.settingsView === true
		);

		if (modulesWithSchema.length === 0) {
			const notice = document.createElement("div");
			notice.className = "no-settings";
			notice.textContent = t("options_no_module_settings");
			this.moduleSettingsContainer.appendChild(notice);
			this._markSaved("settings");
			return;
		}

		modulesWithSchema.forEach((mod) => {
			const block = this._createModuleSettingsBlock(mod, settings);
			this.moduleSettingsContainer.appendChild(block);
			if (mod.settingsView === true) this._mountSettingsView(mod, block, settings);
		});
		this._markSaved("settings");
	}

	// The settings block of one module: the heading with the reset button and its fields.
	/** @type {Classes.OptionsController['_createModuleSettingsBlock']} */
	_createModuleSettingsBlock(mod, settings) {
		// A custom editor (type "custom") may be styled by the module's CSS
		// (registerModule({ styles })) — otherwise the core attaches it only with
		// the module element, which does not have to be rendered on this page.
		this.loadModuleStyles(mod);

		// id = the module name, i.e. also its folder (modules/<name>/<name>.mjs) —
		// a link to the settings of a specific module (options.html#<name>), the heading
		// links to it.
		const block = document.createElement("div");
		block.className = "module-settings-block";
		block.id = mod.name;
		block.dataset.moduleFilter = mod.name;

		const headingContainer = document.createElement("div");
		headingContainer.className = "module-settings-heading-container";

		const heading = document.createElement("div");
		heading.className = "module-name";
		const link = document.createElement("a");
		link.href = `#${mod.name}`;
		link.textContent = this.formatModuleName(mod.name);
		heading.appendChild(link);
		headingContainer.appendChild(heading);

		// The only reset of the module — a module does not offer its own "Restore defaults" (its settings view neither).
		headingContainer.appendChild(
			this._createConfirmButton(
				t("options_reset_module_settings_and_data"),
				t("options_reset_module_confirm"),
				"module-row-button module-reset-button",
				(button) => this._resetSingleModule(mod.name, button)
			)
		);

		block.appendChild(headingContainer);

		(mod.settingsSchema || []).forEach((field) => {
			block.appendChild(this._createSettingRow(field, mod.name, settings, "module-setting-control"));
		});
		return block;
	}

	// The editor a module renders itself (registerModule({ settingsView })): its element with location "settings" in the
	// module's block — it stores its settings itself (an uploaded module through its functions outside the sandbox),
	// the "Save module settings" button does not save it. Also for a turned-off module (its settings can be edited).
	/** @type {Classes.OptionsController['_mountSettingsView']} */
	_mountSettingsView(mod, block, settings) {
		const view = /** @type {Classes.BaseElement} */ (document.createElement(mod.tag));
		view.classList.add("module-settings-view");
		block.appendChild(view);
		const mode = this.getModuleMode(settings, mod.name, mod.defaultActivationMode);
		Promise.resolve(view.init?.({ outputEl: block, name: mod.name, mode, location: "settings" })).catch((err) =>
			console.error(`Editor nastavení modulu "${mod.name}" nejde vykreslit:`, err)
		);
	}

	// One settings field with a label — shared between the custom module settings
	// (settingsSchema, key = module name) and the instance fields in its row of the
	// module list (instanceSettingsSchema, key = "<module>#<id>", see
	// _createModuleRow). controlClassName distinguishes which button saves the field.
	/** @type {Classes.OptionsController['_createSettingRow']} */
	_createSettingRow(field, moduleKey, settings, controlClassName) {
		const storageKey = getSettingFieldKey(moduleKey, field);
		const value = settings[storageKey] !== undefined ? settings[storageKey] : field.default;

		const row = document.createElement("div");
		row.className = "module-setting-row";

		const control = this._createSettingControl(field, value, settings, moduleKey);
		// classList instead of assigning className — a custom editor (type "custom") may
		// carry its own classes, which must not be overwritten.
		control.classList.add(controlClassName);
		control.dataset.moduleKey = moduleKey;
		control.dataset.fieldKey = field.key;
		control.dataset.fieldType = field.type;
		control.dataset.settingKey = storageKey;
		// A field shared by several modules (SettingField.shared) is in the block of each of them — one value.
		if (typeof field.shared === "string") {
			const sync = () => this._syncSharedControls(/** @type {Types.SettingControl} */ (control));
			control.addEventListener("input", sync);
			control.addEventListener("change", sync);
		}

		if (field.type === "custom" || field.type === "checkboxTable") {
			// A custom editor and a table contain several controls, a <label> would bind only
			// to the first of them — so the label is in a separate element.
			const caption = document.createElement("div");
			caption.className = "module-setting-caption";
			caption.textContent = field.label;
			row.appendChild(caption);
			row.appendChild(control);
		} else {
			const label = document.createElement("label");
			label.textContent = field.label;
			label.appendChild(document.createElement("br"));
			label.appendChild(control);
			row.appendChild(label);
		}
		// A checkbox that sends notifications — under it whether they are allowed (the permissions belong to the
		// module, not to its instance).
		if (field.type === "checkbox" && field.notifications === true) {
			const checkbox = /** @type {HTMLInputElement} */ (control);
			row.appendChild(this._createNotificationsLine(moduleKey.split(MODULE_INSTANCE_SEPARATOR)[0], [checkbox], () => checkbox.checked));
		}
		// A shared field: which other modules of the list have the same value.
		const sharedWith =
			typeof field.shared === "string"
				? this._moduleDefs.filter(
						(mod) => mod.name !== moduleKey && (mod.settingsSchema || []).some((other) => other.shared === field.shared && other.key === field.key)
					)
				: [];
		if (sharedWith.length > 0) {
			const note = document.createElement("div");
			note.className = "module-setting-shared";
			note.textContent = t("options_setting_shared", sharedWith.map((mod) => this.formatModuleName(mod.name)).join(", "));
			row.appendChild(note);
		}
		return row;
	}

	// A shared field changed in the block of one module — the same field in the blocks of the others gets the value too
	// (saving reads all of them, the last one would win).
	/** @type {Classes.OptionsController['_syncSharedControls']} */
	_syncSharedControls(source) {
		const key = /** @type {string} */ (source.dataset.settingKey);
		/** @type {NodeListOf<Types.SettingControl>} */ (this.moduleSettingsContainer.querySelectorAll(`[data-setting-key="${CSS.escape(key)}"]`)).forEach((control) => {
			if (control === source) return;
			if (control.dataset.fieldType === "checkbox") /** @type {HTMLInputElement} */ (control).checked = /** @type {HTMLInputElement} */ (source).checked;
			else /** @type {Types.ValueSettingControl} */ (control).value = /** @type {Types.ValueSettingControl} */ (source).value;
		});
	}

	/** @type {Classes.OptionsController['_createSettingControl']} */
	_createSettingControl(field, value, settings, moduleKey) {
		/** @type {Types.SettingControl} */
		let control;

		switch (field.type) {
			case "textarea":
				control = document.createElement("textarea");
				control.value = /** @type {string} */ (value ?? "");
				break;
			case "checkbox":
				control = document.createElement("input");
				control.type = "checkbox";
				control.checked = !!value;
				break;
			case "number":
				control = document.createElement("input");
				control.type = "number";
				control.value = /** @type {string} */ (value ?? "");
				// "any" lets the field take decimals (without it a browser marks 2.5 as invalid).
				if ("step" in field && field.step) control.step = field.step;
				break;
			case "select":
				control = document.createElement("select");
				(field.options || []).forEach((opt) => {
					const option = document.createElement("option");
					option.value = opt.value;
					option.textContent = opt.label;
					if (opt.value === value) {
						option.selected = true;
					}
					control.appendChild(option);
				});
				break;
			case "checkboxTable":
				// The instance fields have "<module>#<id>" — the permissions belong to the module.
				control = this._createCheckboxTableControl(field, value, moduleKey.split(MODULE_INSTANCE_SEPARATOR)[0]);
				break;
			case "custom":
				control = this._createCustomControl(field, value, settings);
				break;
			case "text":
			default:
				control = document.createElement("input");
				control.type = "text";
				control.value = /** @type {string} */ (value ?? "");
				break;
		}

		if (field.placeholder) {
			/** @type {HTMLInputElement | HTMLTextAreaElement} */ (control).placeholder = field.placeholder;
		}

		return control;
	}

	// A custom editor supplied by the module: field.render(value, settings) returns an element
	// with a getValue() method. If rendering failed, the other settings must stay
	// functional and the original value must not be overwritten on save — hence
	// a fallback element that just returns it unchanged.
	/** @type {Classes.OptionsController['_createCustomControl']} */
	_createCustomControl(field, value, settings) {
		try {
			const control = field.render(value, settings);
			if (!control || typeof control.getValue !== "function") {
				throw new Error(t("options_custom_field_invalid"));
			}
			return control;
		} catch (err) {
			console.error(`Nelze vykreslit vlastní pole "${field.key}":`, err);
			// It gets the getValue() method a few lines below.
			const fallback = /** @type {Types.FallbackSettingControl} */ (document.createElement("div"));
			fallback.className = "no-settings";
			fallback.textContent = t("options_custom_field_failed", /** @type {Error} */ (err).message);
			fallback.getValue = () => value;
			return fallback;
		}
	}

	// A table of checkboxes (type "checkboxTable"): a row for every item of field.rows, a column
	// for every item of field.columns, the checked cells by the stored value (or the default,
	// resolveCheckboxTable()); getValue() returns the whole table. While a cell of a column with
	// notifications: true is checked, a line under the table says whether notifications are
	// allowed, with a button that asks for them — Chrome by the extension's "notifications"
	// permission (without it Notification.permission of an extension page is "default" and
	// Notification.requestPermission() returns "denied" right away, without a prompt), Firefox
	// by its standard prompt. The button therefore first calls Notification.requestPermission()
	// and when the result is "denied" and the permission is missing, requests it (as the
	// notifySetting.mjs of the modules do — Chrome still accepts the click gesture after that
	// immediate response). The request is logged under the module's name.
	/** @type {Classes.OptionsController['_createCheckboxTableControl']} */
	_createCheckboxTableControl(field, value, moduleName) {
		const cells = resolveCheckboxTable(field, value);
		// It gets the getValue() method a few lines below.
		const root = /** @type {Types.CheckboxTableControl} */ (document.createElement("div"));
		root.className = "module-setting-table";

		const table = document.createElement("table");
		const headRow = table.createTHead().insertRow();
		headRow.appendChild(document.createElement("td"));
		field.columns.forEach((column) => {
			const th = document.createElement("th");
			th.scope = "col";
			th.textContent = column.label;
			if (column.title) th.title = column.title;
			headRow.appendChild(th);
		});
		/** @type {HTMLInputElement[]} */
		const checkboxes = [];
		const body = table.createTBody();
		field.rows.forEach((row) => {
			const tr = body.insertRow();
			const th = document.createElement("th");
			th.scope = "row";
			th.textContent = row.label;
			tr.appendChild(th);
			field.columns.forEach((column) => {
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.checked = cells[row.value][column.value];
				checkbox.dataset.row = row.value;
				checkbox.dataset.column = column.value;
				checkbox.setAttribute("aria-label", `${row.label}: ${column.label}`);
				if (column.title) checkbox.title = column.title;
				tr.insertCell().appendChild(checkbox);
				checkboxes.push(checkbox);
			});
		});
		root.appendChild(table);
		root.getValue = () => {
			/** @type {Types.CheckboxTableValue} */
			const out = {};
			checkboxes.forEach((checkbox) => {
				const row = /** @type {string} */ (checkbox.dataset.row);
				(out[row] ??= {})[/** @type {string} */ (checkbox.dataset.column)] = checkbox.checked;
			});
			return out;
		};

		const notifying = new Set(field.columns.filter((column) => column.notifications === true).map((column) => column.value));
		if (notifying.size === 0) return root;
		root.appendChild(
			this._createNotificationsLine(moduleName, checkboxes, () =>
				checkboxes.some((checkbox) => checkbox.checked && notifying.has(/** @type {string} */ (checkbox.dataset.column)))
			)
		);
		return root;
	}

	// The line with the state of the notifications under a "checkboxTable" field (a column with notifications: true)
	// or a "checkbox" field with notifications: true — shown while wanted() holds (something that sends notifications
	// is checked); see _createCheckboxTableControl above.
	/** @type {Classes.OptionsController['_createNotificationsLine']} */
	_createNotificationsLine(moduleName, checkboxes, wanted) {
		const api = createModuleApi(moduleName);
		const line = document.createElement("div");
		line.className = "module-setting-notifications";
		line.hidden = true;
		// Sequence number of the running refresh() — only the newest one writes into the DOM.
		let token = 0;
		const refresh = async () => {
			const current = ++token;
			if (!wanted()) {
				line.hidden = true;
				return;
			}
			const extensionGranted = await api.permissions.contains(NOTIFICATIONS_PERMISSIONS);
			if (current !== token) return;
			line.hidden = false;
			line.textContent = "";
			if (typeof Notification === "undefined") {
				line.textContent = t("options_setting_notifications_unsupported");
				return;
			}
			const permission = Notification.permission;
			if (permission === "granted") {
				line.textContent = t("options_setting_notifications_granted");
				return;
			}
			if (permission === "denied" && extensionGranted) {
				line.textContent = t("options_setting_notifications_blocked");
				return;
			}
			line.append(`${t("options_setting_notifications_ask")} `);
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = t("options_setting_notifications_button");
			button.title = t("options_setting_notifications_button_title");
			button.addEventListener("click", async () => {
				const result = permission === "default" ? await Notification.requestPermission() : permission;
				if (result === "denied" && !extensionGranted) await api.permissions.request(NOTIFICATIONS_PERMISSIONS);
				await refresh();
			});
			line.appendChild(button);
		};
		checkboxes.forEach((checkbox) => checkbox.addEventListener("change", refresh));
		// A permission granted/revoked elsewhere (Permissions management, browser settings).
		const unsubscribe = api.permissions.onChange(() => {
			if (line.isConnected) refresh();
			else unsubscribe();
		});
		refresh();
		return line;
	}

	/** @type {Classes.OptionsController['_readSettingControlValue']} */
	_readSettingControlValue(el) {
		if (el.dataset.fieldType === "custom" || el.dataset.fieldType === "checkboxTable") {
			return /** @type {Types.CustomSettingControl} */ (el).getValue();
		}
		if (el.dataset.fieldType === "checkbox") {
			return /** @type {HTMLInputElement} */ (el).checked;
		}
		return /** @type {Types.ValueSettingControl} */ (el).value;
	}

	/** @type {Classes.OptionsController['_readModuleSettingValues']} */
	_readModuleSettingValues(root) {
		/** @type {Types.ModuleSettings} */
		const values = {};
		/** @type {NodeListOf<Types.SettingControl>} */ (root.querySelectorAll(".module-setting-control")).forEach((el) => {
			// _createSettingRow() sets the storage key on every control (of the module, or shared).
			values[/** @type {string} */ (el.dataset.settingKey)] = this._readSettingControlValue(el);
		});
		return values;
	}

	/** @type {Classes.OptionsController['saveModuleSettings']} */
	async saveModuleSettings() {
		const values = this._readModuleSettingValues(this.moduleSettingsContainer);
		const settings = { ...(await this.loadSettings()), ...values };

		await this.saveSettings(settings);
		this._markSaved("settings");
		this._showStatus(t("options_module_settings_saved"));
	}

	/** @type {Classes.OptionsController['resetModuleSettings']} */
	async resetModuleSettings() {
		const defaults = await this._loadDefaultSettings();
		const settings = { ...(await this.loadSettings()) };

		// Default settings from default-settings.json take precedence over the default
		// value of the field in settingsSchema — the same values as after installation.
		this._moduleDefs.forEach((mod) => {
			(mod.settingsSchema || []).forEach((field) => {
				const storageKey = getSettingFieldKey(mod.name, field);
				settings[storageKey] = defaults[storageKey] !== undefined ? defaults[storageKey] : field.default;
			});
		});

		await this.saveSettings(settings);
		this.renderModuleSettings(this._moduleDefs, settings);
		this._showStatus(t("options_module_settings_reset"));
	}

	// The reset of one module (resetModule() of base.mjs): its settings back to the defaults, its data deleted. Then
	// everything of it on this page is created anew from the stored state — its rows in the module list (the activation
	// mode and output — "Save" would otherwise store the old ones again), its settings block (incl. the settings view)
	// and its elements in the output of this page; the other modules keep their unsaved changes.
	/** @type {Classes.OptionsController['_resetSingleModule']} */
	async _resetSingleModule(moduleName, button) {
		button.disabled = true;
		try {
			await resetModule(moduleName);
		} catch (err) {
			button.disabled = false;
			this._showStatus(t("options_error", /** @type {Error} */ (err).message), 10000);
			return;
		}
		const settings = await this.loadSettings();
		const moduleDefsByName = new Map(this._moduleDefs.map((mod) => [mod.name, mod]));
		const edited = this._moduleDefs.filter((mod) => mod.settingsEditedBy === moduleName).map((mod) => mod.name);

		/** @type {NodeListOf<HTMLElement>} */ (this.container.querySelectorAll(".module-row")).forEach((row) => {
			const path = /** @type {string} */ (row.dataset.modulePath);
			const name = parseModuleEntry(path).name;
			if (name !== moduleName) return;
			const fresh = this._createModuleRow(path, settings, moduleDefsByName.get(name));
			row.replaceWith(fresh);
			this._markSaved("list", fresh);
		});

		const mod = moduleDefsByName.get(moduleName);
		const block = this.moduleSettingsContainer.querySelector(`.module-settings-block[data-module-filter="${CSS.escape(moduleName)}"]`);
		if (mod && block) {
			const fresh = this._createModuleSettingsBlock(mod, settings);
			block.replaceWith(fresh);
			if (mod.settingsView === true) this._mountSettingsView(mod, fresh, settings);
			this._markSaved("settings", fresh);
		}

		await this._outputSurface?.remount([moduleName, ...edited]);
		this._showStatus(t("options_module_reset_confirmed"), 4000);
	}

	// Default settings from the extension package (default-settings.json, see
	// BaseController.fetchDefaultSettings()) for the "Restore defaults" buttons.
	// When it cannot be loaded, only the modules' default values are restored.
	/** @type {Classes.OptionsController['_loadDefaultSettings']} */
	async _loadDefaultSettings() {
		try {
			return await this.fetchDefaultSettings();
		} catch (err) {
			console.error("Výchozí nastavení modulů nejde načíst:", err);
			return {};
		}
	}

	/** @type {Classes.OptionsController['_showStatus']} */
	_showStatus(text, duration = 2000) {
		this.statusEl.textContent = text;
		setTimeout(() => {
			this.statusEl.textContent = "";
		}, duration);
	}

	/** @type {Classes.OptionsController['_readModuleListValues']} */
	_readModuleListValues(root) {
		/** @type {Types.ModuleSettings} */
		const settings = {};

		// _createLabeledSelect/_createLabeledCheckbox set dataset.moduleKey on every element of the row.
		/** @type {NodeListOf<HTMLSelectElement>} */ (root.querySelectorAll(".module-mode")).forEach((select) => {
			settings[/** @type {string} */ (select.dataset.moduleKey)] = select.value;
		});

		// Output locations as an array of the ticked locations in the order of DISPLAY_LOCATIONS
		// (empty = nowhere), even for a turned-off module with disabled locations.
		/** @type {NodeListOf<HTMLFieldSetElement>} */ (root.querySelectorAll(".module-display-locations")).forEach((fieldset) => {
			const checked = /** @type {NodeListOf<HTMLInputElement>} */ (fieldset.querySelectorAll(".module-display-location:checked"));
			settings[getModuleSettingKey(/** @type {string} */ (fieldset.dataset.moduleKey), "displayLocation")] = [...checked].map((checkbox) => checkbox.value);
		});
		// The second set, only in the rows of the modules offered to the service provider.
		/** @type {NodeListOf<HTMLFieldSetElement>} */ (root.querySelectorAll(".module-delegated-display-locations")).forEach((fieldset) => {
			const checked = /** @type {NodeListOf<HTMLInputElement>} */ (fieldset.querySelectorAll(".module-delegated-display-location:checked"));
			settings[getModuleSettingKey(/** @type {string} */ (fieldset.dataset.moduleKey), DELEGATED_DISPLAY_LOCATION_FIELD)] = [...checked].map((checkbox) => checkbox.value);
		});

		// Saved even from disabled fields (see _syncOutputSettingsState) — the choice
		// thus stays ready for when the module starts being shown somewhere again.
		/** @type {NodeListOf<HTMLSelectElement>} */ (root.querySelectorAll(".module-output-element")).forEach((select) => {
			settings[getModuleSettingKey(/** @type {string} */ (select.dataset.moduleKey), "outputElement")] = select.value;
		});

		/** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll(".module-show-heading")).forEach((checkbox) => {
			settings[getModuleSettingKey(/** @type {string} */ (checkbox.dataset.moduleKey), "showHeading")] = checkbox.checked;
		});

		// The instanceSettingsSchema fields in the instance rows (see _createModuleRow) —
		// their moduleKey is "<module>#<id>".
		/** @type {NodeListOf<Types.SettingControl>} */ (root.querySelectorAll(".module-instance-setting-control")).forEach((el) => {
			settings[getModuleSettingKey(/** @type {string} */ (el.dataset.moduleKey), /** @type {string} */ (el.dataset.fieldKey))] =
				this._readSettingControlValue(el);
		});
		return settings;
	}

	/** @type {Classes.OptionsController['save']} */
	async save() {
		// Starts from the currently stored settings, not from an empty object —
		// otherwise overwriting the whole "moduleSettings" would also lose the custom
		// module settings (see saveModuleSettings) stored outside this form.
		const values = this._readModuleListValues(this.container);
		const settings = { ...(await this.loadSettings()), ...values };

		await this.saveSettings(settings);
		this._markSaved("list");
		this._showStatus(t("options_settings_saved"));
	}

	// --- Unsaved changes (the two sections with the floating "Save") ---
	//
	// The values of a section's form are compared with the ones it had after rendering or the last save; while one of
	// them differs, a bubble above "Save" reminds the user to save. Comparing values (instead of a flag set by any input)
	// hides the bubble again when a field is set back, and ignores inputs that change no setting (the search of a viewer
	// in a custom editor — its getValue() is null). A settings view (settingsView) stores its settings itself and has no
	// controls read here; reordering the rows and adding/removing an instance is saved right away.

	/** @type {Classes.OptionsController['_savedFormRoot']} */
	_savedFormRoot(section) {
		return section === "list" ? this.container : this.moduleSettingsContainer;
	}

	/** @type {Classes.OptionsController['_initUnsavedChanges']} */
	_initUnsavedChanges() {
		/** @type {Types.SavedFormSection[]} */ (["list", "settings"]).forEach((section) => {
			const root = this._savedFormRoot(section);
			// A click and a drop too — a custom editor adds, removes or moves its rows in their handlers, without "input".
			["input", "change", "click", "drop"].forEach((type) => root.addEventListener(type, () => this._scheduleUnsavedCheck(section)));
		});
	}

	/** @type {Classes.OptionsController['_scheduleUnsavedCheck']} */
	_scheduleUnsavedCheck(section) {
		if (this._unsavedChecks.has(section)) return;
		this._unsavedChecks.add(section);
		// After all handlers of the event — the container gets it before an editor that listens higher up (or later)
		// has changed its rows.
		setTimeout(() => {
			this._unsavedChecks.delete(section);
			this._syncUnsavedChanges(section);
		});
	}

	/** @type {Classes.OptionsController['_markSaved']} */
	_markSaved(section, root) {
		const saved = this._savedValues[section];
		if (!root) saved.clear();
		const values = section === "list"
			? this._readModuleListValues(root ?? this.container)
			: this._readModuleSettingValues(root ?? this.moduleSettingsContainer);
		Object.entries(values).forEach(([key, value]) => saved.set(key, JSON.stringify(value)));
		this._syncUnsavedChanges(section);
	}

	/** @type {Classes.OptionsController['_syncUnsavedChanges']} */
	_syncUnsavedChanges(section) {
		const root = this._savedFormRoot(section);
		const saved = this._savedValues[section];
		const values = section === "list" ? this._readModuleListValues(root) : this._readModuleSettingValues(root);
		const unsaved = Object.entries(values).some(([key, value]) => saved.get(key) !== JSON.stringify(value));
		// options.html: the floating bar follows the form in the same panel.
		const bar = /** @type {HTMLElement} */ (root.parentElement?.querySelector(".buttons--floating"));
		bar.classList.toggle("buttons--unsaved", unsaved);
		/** @type {HTMLElement} */ (bar.querySelector(".unsaved-bubble")).hidden = !unsaved;
	}

	/** @type {Classes.OptionsController['reset']} */
	async reset() {
		let jsonText;
		try {
			jsonText = await this.fetchDefaultModulesJson();
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}

		let paths;
		try {
			paths = JSON.parse(jsonText);
			if (!Array.isArray(paths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}

		// The current module list — it may have a different order, different modules and extra
		// module instances (see parseModuleEntry()). Its entries are reset too and
		// exactly it is rendered: the button does not change the list itself (that is what
		// "Restore default list" is for), the default list would show a different order
		// in the rows than the one that applies.
		/** @type {unknown[]} */
		let currentPaths;
		try {
			currentPaths = JSON.parse(await this.getModulesJson());
			if (!Array.isArray(currentPaths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch {
			currentPaths = paths;
		}
		const currentList = currentPaths.filter((path) => typeof path === "string");
		const allPaths = [...paths, ...currentList];

		// For the reset to respect the modules' own default values (see
		// defaultActivationMode/defaultDisplayLocation/defaultOutputElement/
		// defaultShowHeading), their definitions have to be loaded — even if
		// the current module list is different from the default one.
		const moduleDefs = await this.importModuleFiles(allPaths);
		const moduleDefsByName = new Map(moduleDefs.map((mod) => [mod.name, mod]));

		// Default settings from default-settings.json — for the entries that are in it
		// (contentDividerSandbox#welcome: the "onboarding" location) they take precedence over
		// the module's suggestion, the same as after installation.
		const defaults = await this._loadDefaultSettings();

		// Starts from the currently stored settings (see save() above) — only
		// the activation modes, output locations and output element (incl. the heading)
		// are reset; the custom module settings (settingsSchema) and the instance fields
		// (instanceSettingsSchema — content, not the way of output) do not change.
		const settings = { ...(await this.loadSettings()) };
		allPaths.forEach((path) => {
			const { name, instance, key } = parseModuleEntry(path);
			const moduleDef = moduleDefsByName.get(name);
			// The template of a module with multiple instances has no settings.
			if (moduleDef?.multiInstance && !instance) return;
			// Getters from base.mjs over the default settings instead of the stored ones =
			// default-settings.json, otherwise the module's suggestion, otherwise the global default
			// value (for the output element and the heading also skipping an invalid value).
			settings[key] = this.getModuleMode(defaults, key, moduleDef?.defaultActivationMode);
			settings[getModuleSettingKey(key, "displayLocation")] = getModuleDisplayLocations(
				defaults,
				key,
				moduleDef?.defaultDisplayLocation
			);
			// The second set of a module offered to the service provider: from default-settings.json, otherwise it follows
			// the first one again (getModuleDelegatedDisplayLocations()).
			const delegatedKey = getModuleSettingKey(key, DELEGATED_DISPLAY_LOCATION_FIELD);
			const delegated = parseDisplayLocations(defaults[delegatedKey]);
			if (delegated) {
				settings[delegatedKey] = delegated;
			} else {
				delete settings[delegatedKey];
			}
			settings[getModuleSettingKey(key, "outputElement")] = getModuleOutputElement(
				defaults,
				key,
				moduleDef?.defaultOutputElement
			);
			settings[getModuleSettingKey(key, "showHeading")] = getModuleShowHeading(
				defaults,
				key,
				moduleDef?.defaultShowHeading
			);
		});

		this._moduleDefs = moduleDefs;
		await this.saveSettings(settings);
		this.renderModules(currentList, settings);
		this.renderModuleSettings(this._moduleDefs, settings);
		this._showStatus(t("options_settings_reset"));
	}

	// --- Sections as tabs (an accordion on a narrow screen) ---
	//
	// One section is open: in the tabs always one (DEFAULT_SECTION or the first visible, while the chosen one is hidden or
	// closed in the accordion), in the accordion the chosen one or none. The last chosen one opens next time. The tab bar is made from the section headings
	// (options.html); a hidden section (extension-services with nothing to show) has its tab hidden too, an empty one
// (options-section--empty, see _syncOutputSection()) has its tab and accordion button disabled.

	/** @type {Classes.OptionsController['_initSectionTabs']} */
	_initSectionTabs() {
		for (const section of this._sections()) {
			const toggle = /** @type {HTMLButtonElement} */ (section.querySelector(".options-section-toggle"));
			const panel = /** @type {HTMLElement} */ (section.querySelector(".options-section-panel"));
			panel.id = `${section.id}-panel`;
			toggle.setAttribute("aria-controls", panel.id);
			// The open section closes again in the accordion.
			toggle.addEventListener("click", () => {
				this._activateSection(this._activeSection === section.id ? null : section.id);
				toggle.scrollIntoView({ block: "nearest" });
			});

			const tab = document.createElement("button");
			tab.type = "button";
			tab.className = "options-tab";
			tab.id = `${section.id}-tab`;
			tab.dataset.section = section.id;
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-controls", section.id);
			tab.textContent = toggle.textContent;
			tab.addEventListener("click", () => this._activateSection(section.id));
			this.tabbarEl.appendChild(tab);
		}

		// Arrows, Home and End between the tabs (the WAI-ARIA tabs pattern) — only the selected tab is in the Tab order.
		this.tabbarEl.addEventListener("keydown", (e) => {
			const tabs = [.../** @type {NodeListOf<HTMLButtonElement>} */ (this.tabbarEl.querySelectorAll(".options-tab:not([hidden]):not(:disabled)"))];
			const index = tabs.findIndex((tab) => tab === document.activeElement);
			const next = index === -1 ? undefined : { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[e.key];
			if (next === undefined) return;
			e.preventDefault();
			const tab = tabs[(next + tabs.length) % tabs.length];
			tab.focus();
			tab.click();
		});

		this._accordion.addEventListener("change", () => this._syncSectionTabs());
		// A link within the page (the heading of a module's settings, options.html#<name> typed into the address bar).
		window.addEventListener("hashchange", () => this._revealHashTarget());

		// The remembered section — until the stored states load, no section is open, so the default one does not
		// flash first. A section chosen meanwhile (a click, a link within the page) wins.
		loadFrameStates().then((store) => {
			if (this._activeSection !== null) return;
			const stored = this._sections().find((section) => store[`${SECTION_STATE_KEY_PREFIX}${section.id}`]?.open === true);
			if (stored) {
				const key = `${SECTION_STATE_KEY_PREFIX}${stored.id}`;
				const entry = store[key];
				if (Date.now() - entry.seen > FRAME_STATE_SEEN_REFRESH_MS) queueFrameState(key, { ...entry, seen: Date.now() });
			}
			this._activeSection = stored?.id ?? DEFAULT_SECTION;
			this._syncSectionTabs();
		});
	}

	/** @type {Classes.OptionsController['_sections']} */
	_sections() {
		return [.../** @type {NodeListOf<HTMLElement>} */ (this.sectionsEl.querySelectorAll(":scope > .options-section"))];
	}

	/** @type {Classes.OptionsController['_activateSection']} */
	_activateSection(id) {
		this._activeSection = id;
		// Closing all in the accordion keeps the last chosen one remembered. The writes go in one batch.
		if (id) {
			for (const section of this._sections()) {
				const open = section.id === id && id !== DEFAULT_SECTION;
				queueFrameState(`${SECTION_STATE_KEY_PREFIX}${section.id}`, open ? { open, element: "details-closed", seen: Date.now() } : null);
			}
		}
		this._syncSectionTabs();
	}

	// The open section by the choice and the current width — the classes of the sections (css/options.css) and the
	// states of the tabs and of the accordion buttons.
	/** @type {Classes.OptionsController['_syncSectionTabs']} */
	_syncSectionTabs() {
		const sections = this._sections();
		const accordion = this._accordion.matches;
		const usable = sections.filter((section) => !section.hidden && !section.classList.contains("options-section--empty"));
		const fallback = usable.find((section) => section.id === DEFAULT_SECTION) ?? usable[0];
		const chosen = usable.some((section) => section.id === this._activeSection) ? this._activeSection : null;
		const open = accordion ? chosen : chosen ?? fallback?.id ?? null;
		for (const section of sections) {
			const active = section.id === open;
			const empty = section.classList.contains("options-section--empty");
			section.classList.toggle("options-section--active", active);
			const toggle = /** @type {HTMLButtonElement | null} */ (section.querySelector(".options-section-toggle"));
			if (toggle) {
				toggle.setAttribute("aria-expanded", String(active));
				toggle.disabled = empty;
				toggle.title = empty ? t("options_section_empty") : "";
			}
			const tab = /** @type {HTMLButtonElement | null} */ (this.tabbarEl.querySelector(`[data-section="${section.id}"]`));
			if (!tab) continue;
			tab.hidden = section.hidden;
			tab.disabled = empty;
			tab.title = empty ? t("options_section_empty") : "";
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
		}
	}

	// "Module output" with no module frame (no module has Settings among its output locations, or none of them holds
	// now) is empty — its tab cannot be chosen. Only after the output is rendered (initPage()), until then the section
	// stays as it is; then it follows the frames coming and going (a module reset, a module shown later).
	/** @type {Classes.OptionsController['_syncOutputSection']} */
	_syncOutputSection() {
		const section = /** @type {HTMLElement} */ (this.outputEl.closest(".options-section"));
		const empty = !this.outputEl.querySelector(":scope > .module-frame");
		if (section.classList.contains("options-section--empty") === empty) return;
		section.classList.toggle("options-section--empty", empty);
		this._syncSectionTabs();
	}

	// Opens the section with the element and scrolls to it. Outside the sections only scrolls.
	/** @type {Classes.OptionsController['_revealTarget']} */
	_revealTarget(target) {
		if (!target) return;
		const section = /** @type {HTMLElement | null} */ (target.closest(".options-section"));
		if (section && !section.hidden && !section.classList.contains("options-section--empty")) this._activateSection(section.id);
		target.scrollIntoView({ block: "start" });
	}

	/** @type {Classes.OptionsController['_revealHashTarget']} */
	_revealHashTarget() {
		const id = decodeURIComponent(window.location.hash.slice(1));
		if (id) this._revealTarget(document.getElementById(id));
	}

	// The button of the notice about an extension waiting for the decision (mountPendingServiceNotice()) — its section
	// may be in a tab that is not open.
	/**
	 * @override
	 * @type {Classes.OptionsController['scrollToSettingsSection']}
	 */
	scrollToSettingsSection(id) {
		this._revealTarget(document.getElementById(id));
	}

	// --- Module filter ---
	//
	// Only the modules whose name (as shown, "Storage Manager") or id ("storageManager", an instance
	// "contentDividerSandbox#k3j9x2") contains the text stay visible in all sections — the rows of the module list,
	// the custom settings, the uploaded modules and the module output. Elements of modules carry the id in
	// data-module-filter, the output frames have it from the core (data-module-key / data-module). A rendering
	// (another module list, a module shown later) is filtered again by the observer.

	/** @type {Classes.OptionsController['_initModuleFilter']} */
	_initModuleFilter() {
		this.filterInput.addEventListener("input", () => this._applyModuleFilter());
		const observer = new MutationObserver(() => this._applyModuleFilter());
		for (const el of [this.outputEl, this.container, this.moduleSettingsContainer, this.sandboxListEl]) {
			observer.observe(el, { childList: true });
		}
	}

	// The filter only from MODULE_FILTER_MIN modules on (instances of one module count once); the suggestions are the
	// names of the modules in the list.
	/** @type {Classes.OptionsController['_updateModuleFilter']} */
	_updateModuleFilter(paths) {
		const names = [...new Set(paths.map((path) => this.formatModuleName(parseModuleEntry(path).name)))].sort((a, b) => a.localeCompare(b, getUiLocale()));
		this.filterEl.hidden = names.length < MODULE_FILTER_MIN;
		this.filterNamesEl.replaceChildren(
			...names.map((name) => {
				const option = document.createElement("option");
				option.value = name;
				return option;
			})
		);
		this._applyModuleFilter();
	}

	/** @type {Classes.OptionsController['_applyModuleFilter']} */
	_applyModuleFilter() {
		const query = this.filterEl.hidden ? "" : this.filterInput.value.trim().toLowerCase();
		const elements = /** @type {NodeListOf<HTMLElement>} */ (this.sectionsEl.querySelectorAll("[data-module-filter], #modules-output > .module-frame[data-module]"));
		for (const el of elements) {
			const key = el.dataset.moduleFilter ?? el.dataset.moduleKey ?? el.dataset.module ?? "";
			const name = this.formatModuleName(parseModuleEntry(key).name);
			const matches = !query || [key, name].some((text) => text.toLowerCase().includes(query));
			el.classList.toggle("module-filter-hidden", !matches);
		}
	}

	// "Do not use the sidebar" — Firefox closes an open sidebar only within the user's action, hence
	// before the first await; Chrome closes its panel by itself when it is turned off
	// (applySidebarDisabled()). The page follows the stored change (_showSidebarDisabled()).
	/** @type {Classes.OptionsController['_setSidebarDisabled']} */
	async _setSidebarDisabled(disabled) {
		const firefox = chrome.sidebarAction;
		if (disabled && firefox?.close) {
			firefox.close().catch(() => {
				// Not open, or not this extension's sidebar.
			});
		}
		try {
			await chrome.storage.local.set({ [SIDEBAR_DISABLED_KEY]: disabled });
			await applySidebarDisabled(disabled);
			this._showStatus(t(disabled ? "options_sidebar_disabled_saved" : "options_sidebar_enabled_saved"));
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
		}
	}

	// The checkbox and the output locations of all module rows by the stored choice (see
	// _syncOutputSettingsState) — the locations stay ticked, only the sidebar is out of use.
	/** @type {Classes.OptionsController['_showSidebarDisabled']} */
	_showSidebarDisabled(disabled) {
		this._sidebarDisabled = disabled;
		this.sidebarDisabledCheckbox.checked = disabled;
		this.container.querySelectorAll(".module-row").forEach((row) => this._syncOutputSettingsState(row));
	}


	/** @type {Classes.OptionsController['initPage']} */
	async initPage() {
		// Before the module rows — their output locations depend on it.
		this.sidebarDisabledHintEl.textContent = t(isFirefox() ? "options_sidebar_disabled_hint_firefox" : "options_sidebar_disabled_hint_chrome");
		this._showSidebarDisabled(await readSidebarDisabled());
		// Without a sidebar in the manifest there is nothing to turn on — the choice (and the line above it) is not offered.
		if (!hasManifestSidebar()) {
			const label = /** @type {HTMLElement} */ (this.sidebarDisabledCheckbox.closest("label"));
			const line = label.previousElementSibling;
			for (const el of [label, this.sidebarDisabledHintEl, line instanceof HTMLHRElement ? line : null]) if (el) el.hidden = true;
		}

		await this.loadModulesListEditor();
		this._showModulesListDiff();
		this._renderSandboxModules();
		this._renderExtensionServices();
		// An extension that offers its modules and waits for the decision — above the sections, its section is in a tab further on.
		this.mountPendingServiceNotice(this.sectionsEl, "options");

		let jsonText;
		try {
			jsonText = await this.getModulesJson();
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}

		let paths;
		try {
			paths = JSON.parse(jsonText);
			if (!Array.isArray(paths)) {
				throw new Error(t("core_modules_json_not_array"));
			}
		} catch (err) {
			this._showStatus(t("options_error", /** @type {Error} */ (err).message));
			return;
		}

		// Before the module rows — a client's module it offers its provider has a second set of output locations.
		this._serviceProviderId = await readServiceProviderId();
		const settings = await this.loadSettings();
		await this._refreshModules(paths, settings);

		// A link to a module's settings (options.html#<name>, see
		// renderModuleSettings()) — the block is created only after the modules load, so the
		// browser no longer scrolls to the address target by itself — and it may be in a section that is not open
		// (_revealTarget()). The module output above it (below) does not upset the scrolling; the content on
		// screen is held by scroll anchoring (overflow-anchor).
		this._revealHashTarget();

		// Modules whose locations include "options" (see DISPLAY_LOCATIONS in
		// base.mjs) are rendered here — the same shared mechanism as
		// popup/sidebar/floating (BaseController.renderModulesFor()), just with
		// a new fourth target surface.
		this._outputSurface = await this.renderModulesFor("options", this.outputEl);
		this._syncOutputSection();
		new MutationObserver(() => this._syncOutputSection()).observe(this.outputEl, { childList: true });
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	mountExtensionIdWatermark();
	await initPageI18n();
	// UI language choice (the same one is on the welcome page too).
	await initUiLanguageSelect(/** @type {HTMLSelectElement} */ (document.getElementById("ui-language")));
	const controller = new OptionsController();
	controller.initPage();
});
