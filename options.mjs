//@ts-check
"use strict";

// options.mjs
import
	{
		BaseController,
		ACTIVATION_MODES,
		DISPLAY_LOCATIONS,
		OUTPUT_ELEMENTS,
		DISABLED_SPEC,
		getModuleSettingKey,
		getModuleDisplayLocations,
		parseDisplayLocations,
		getModuleOutputElement,
		getModuleShowHeading,
		getOutputElementDef,
		parseModuleEntry,
		createModuleInstanceId,
		MODULE_INSTANCE_SEPARATOR,
		MODULES_JSON_KEY,
	} from "./base.mjs";
import { t, initPageI18n, initUiLanguageSelect } from "./i18n.mjs";

// Přípona textu volby, kterou modul sám doporučuje jako výchozí
// (defaultActivationMode/defaultDisplayLocation/defaultOutputElement v
// registerModule). Globální výchozí hodnota se neoznačuje — tu modul
// nedoporučil, jen nic vlastního nedeklaroval.
const recommendedSuffix = () => t( "options_recommended_suffix" );

// Místa, která lze uživatelsky zapnout v nastavení modulu. Options zůstává
// podporované pro starší uložená nastavení, ale není zde volitelné.
const MODULE_SETTINGS_DISPLAY_LOCATIONS = DISPLAY_LOCATIONS.filter(
	( { value } ) => value !== "options"
);

// Věta pod místy výstupu, když se modul nevypíše nikde (viz
// _syncOutputSettingsState) — nic nezaškrtnuté není totéž co vypnutý modul.
// Texty se skládají až při vykreslení (t() potřebuje načtené texty, viz i18n.mjs).
const NOT_DISPLAYED_HINT = "options_hint_not_displayed";
const DISABLED_HINT = "options_hint_disabled";

/** @implements {Classes.OptionsController} */
class OptionsController extends BaseController
{
	constructor ()
	{
		super();
		this.outputEl = /** @type {Classes.OptionsController['outputEl']} */ ( document.getElementById( "modules-output" ) );
		this.container = /** @type {Classes.OptionsController['container']} */ ( document.getElementById( "modules-list" ) );
		this.saveBtn = /** @type {Classes.OptionsController['saveBtn']} */ ( document.getElementById( "save-btn" ) );
		this.resetBtn = /** @type {Classes.OptionsController['resetBtn']} */ ( document.getElementById( "reset-btn" ) );
		this.statusEl = /** @type {Classes.OptionsController['statusEl']} */ ( document.getElementById( "status" ) );

		this.jsonTextareaEl = /** @type {Classes.OptionsController['jsonTextareaEl']} */ ( document.getElementById( "modules-json" ) );
		this.saveJsonBtn = /** @type {Classes.OptionsController['saveJsonBtn']} */ ( document.getElementById( "save-modules-json" ) );
		this.resetJsonBtn = /** @type {Classes.OptionsController['resetJsonBtn']} */ ( document.getElementById( "reset-modules-json" ) );
		this.modulesDiffEl = /** @type {Classes.OptionsController['modulesDiffEl']} */ ( document.getElementById( "modules-json-diff" ) );
		/** @type {Classes.OptionsController['_modulesDiffRun']} */
		this._modulesDiffRun = 0;

		this.moduleSettingsContainer = /** @type {Classes.OptionsController['moduleSettingsContainer']} */ ( document.getElementById( "module-settings-list" ) );
		this.saveModuleSettingsBtn = /** @type {Classes.OptionsController['saveModuleSettingsBtn']} */ ( document.getElementById( "save-module-settings-btn" ) );
		this.resetModuleSettingsBtn = /** @type {Classes.OptionsController['resetModuleSettingsBtn']} */ ( document.getElementById( "reset-module-settings-btn" ) );

		// Definice modulů (vč. jejich settingsSchema) získané dynamickým
		// importem jejich JS souborů — viz _refreshModules().
		/** @type {Classes.OptionsController['_moduleDefs']} */
		this._moduleDefs = [];

		this.saveBtn.addEventListener( "click", () => this.save() );
		this.resetBtn.addEventListener( "click", () => this.reset() );
		this.saveJsonBtn.addEventListener( "click", () => this.saveModulesList() );
		this.resetJsonBtn.addEventListener( "click", () => this.resetModulesList() );
		this.saveModuleSettingsBtn.addEventListener( "click", () => this.saveModuleSettings() );
		this.resetModuleSettingsBtn.addEventListener( "click", () => this.resetModuleSettings() );

		// Upozornění na rozdíl proti modules.json drží krok s uloženým seznamem,
		// ať ho změní editor, přetažení, přidání/odebrání instance, import, nebo
		// jiná karta s Nastavením.
		chrome.storage.onChanged.addListener( ( changes, area ) =>
		{
			if ( area === "local" && changes[ MODULES_JSON_KEY ] ) {
				this._showModulesListDiff();
			}
		} );

		/** @type {Classes.OptionsController['_draggedRow']} */
		this._draggedRow = null;
		this._initDragToReorder();

		// Změna aktivačního režimu, míst výstupu nebo typu elementu mění, které z
		// nastavení výpisu dává smysl (viz _syncOutputSettingsState). Container je
		// pořád ten samý element i po překreslení (viz _initDragToReorder), stačí
		// jeden listener.
		this.container.addEventListener( "change", ( e ) =>
		{
			const row = /** @type {Element} */ ( e.target ).closest( ".module-row" );
			if ( row ) {
				this._syncOutputSettingsState( row );
			}
		} );
	}

	// --- Editor seznamu modulů (modules.json) ---

	/** @type {Classes.OptionsController['loadModulesListEditor']} */
	async loadModulesListEditor ()
	{
		let jsonText;
		try {
			jsonText = await this.getModulesJson();
		} catch ( err ) {
			this._showStatus( t( "options_error", /** @type {Error} */( err ).message ) );
			return;
		}
		try {
			const parsed = JSON.parse( jsonText );
			this.jsonTextareaEl.value = JSON.stringify( parsed, null, 2 );
		} catch {
			this.jsonTextareaEl.value = jsonText;
		}
	}

	// Porovná uložený seznam modulů s výchozím modules.json a nad editorem
	// vypíše, jestli se liší a co má navíc nebo co mu chybí. Shodný seznam
	// (v úložišti pak žádný není, viz saveModulesJson()) upozornění skryje,
	// stejně jako chyba načtení — tu už hlásí stavový řádek.
	/** @type {Classes.OptionsController['_showModulesListDiff']} */
	async _showModulesListDiff ()
	{
		const run = ++this._modulesDiffRun;
		/** @type {string[]} */
		let userList;
		/** @type {string[]} */
		let defaultList;
		try {
			const [ userText, defaultText ] = await Promise.all( [ this.getModulesJson(), this.fetchDefaultModulesJson() ] );
			userList = JSON.parse( userText );
			defaultList = JSON.parse( defaultText );
			if ( !Array.isArray( userList ) || !Array.isArray( defaultList ) ) {
				throw new Error( t( "core_modules_json_not_array" ) );
			}
		} catch {
			userList = defaultList = [];
		}
		// Mezitím mohla přijít další změna — vypíše se jen ta poslední.
		if ( run !== this._modulesDiffRun ) return;

		userList = userList.filter( ( entry ) => typeof entry === "string" );
		defaultList = defaultList.filter( ( entry ) => typeof entry === "string" );
		this.modulesDiffEl.replaceChildren();
		this.modulesDiffEl.hidden = JSON.stringify( userList ) === JSON.stringify( defaultList );
		if ( this.modulesDiffEl.hidden ) return;

		/** @param {string} text */
		const addLine = ( text ) =>
		{
			const line = document.createElement( "p" );
			line.textContent = text;
			this.modulesDiffEl.appendChild( line );
			return line;
		};
		/** @param {string} label @param {string[]} entries */
		const addEntries = ( label, entries ) =>
		{
			const line = addLine( `${ label } ` );
			entries.forEach( ( entry, index ) =>
			{
				const { name, instance } = parseModuleEntry( entry );
				const item = document.createElement( "strong" );
				item.textContent = `${ this.formatModuleName( name ) }${ instance ? ` ${ MODULE_INSTANCE_SEPARATOR }${ instance }` : "" }`;
				item.title = entry;
				if ( index > 0 ) line.append( ", " );
				line.appendChild( item );
			} );
		};

		const { extra, missing } = this._compareModuleLists( userList, defaultList );
		addLine( t( "options_modules_diff_differs" ) );
		if ( extra.length ) addEntries( t( "options_modules_diff_extra" ), extra );
		if ( missing.length ) addEntries( t( "options_modules_diff_missing" ), missing );
		if ( !extra.length && !missing.length ) addLine( t( "options_modules_diff_order_only" ) );
	}

	// Položky jednoho seznamu, které druhý nemá — porovnává se celá položka
	// (cesta i id instance) a počítá se i s tím, že je stejná položka v
	// seznamu víckrát. Pořadí výsledku sleduje pořadí v seznamu.
	/** @type {Classes.OptionsController['_compareModuleLists']} */
	_compareModuleLists ( userList, defaultList )
	{
		/** @type {Map<string, number>} */
		const remaining = new Map();
		for ( const entry of defaultList ) {
			remaining.set( entry, ( remaining.get( entry ) ?? 0 ) + 1 );
		}
		/** @type {string[]} */
		const extra = [];
		for ( const entry of userList ) {
			const count = remaining.get( entry ) ?? 0;
			if ( count > 0 ) {
				remaining.set( entry, count - 1 );
			} else {
				extra.push( entry );
			}
		}
		/** @type {string[]} */
		const missing = [];
		for ( const [ entry, count ] of remaining ) {
			for ( let i = 0; i < count; i++ ) missing.push( entry );
		}
		return { extra, missing };
	}

	/** @type {Classes.OptionsController['saveModulesList']} */
	async saveModulesList ()
	{
		const text = this.jsonTextareaEl.value.trim();
		let paths;

		try {
			paths = JSON.parse( text );
			if ( !Array.isArray( paths ) ) {
				throw new Error( t( "core_modules_json_not_array" ) );
			}
		} catch ( err ) {
			this._showStatus( t( "options_invalid_json", /** @type {Error} */( err ).message ) );
			return;
		}

		await this.saveModulesJson( text );
		// Položka, která do seznamu přibyla, dostane výchozí nastavení z
		// default-settings.json (jen chybějící hodnoty, viz seedDefaultSettings()).
		const settings = await this.seedDefaultSettings( paths );
		await this._refreshModules( paths, settings );
		this._showStatus( t( "options_modules_saved" ) );
	}

	/** @type {Classes.OptionsController['resetModulesList']} */
	async resetModulesList ()
	{
		let defaultText;
		try {
			defaultText = await this.fetchDefaultModulesJson();
		} catch ( err ) {
			this._showStatus( t( "options_error", /** @type {Error} */( err ).message ) );
			return;
		}

		let paths;
		try {
			paths = JSON.parse( defaultText );
			if ( !Array.isArray( paths ) ) {
				throw new Error( t( "core_modules_json_not_array" ) );
			}
		} catch ( err ) {
			this._showStatus( t( "options_error", /** @type {Error} */( err ).message ) );
			return;
		}

		// Shodný s modules.json — saveModulesJson() seznam z úložiště odebere.
		await this.saveModulesJson( defaultText );
		this.jsonTextareaEl.value = JSON.stringify( paths, null, 2 );

		// Výchozí seznam vrátí i dřív odebrané položky (instance modulů) — jejich
		// nastavení se odebráním smazalo, výchozí hodnoty se proto doplní znovu.
		const settings = await this.seedDefaultSettings( paths );
		await this._refreshModules( paths, settings );
		this._showStatus( t( "options_modules_reset" ) );
	}

	/** @type {Classes.OptionsController['renderModules']} */
	renderModules ( modules, settings )
	{
		this.container.innerHTML = "";

		// Umožní dohledat k modulu jeho vlastní deklarované výchozí hodnoty
		// (defaultActivationMode/defaultDisplayLocation/defaultOutputElement/
		// defaultShowHeading), pokud nějaké má — ty se předvyberou (bez
		// uživatelského nastavení) a ve volbách označí jako doporučené.
		const moduleDefsByName = new Map( this._moduleDefs.map( ( mod ) => [ mod.name, mod ] ) );

		modules.forEach( ( path ) =>
		{
			this.container.appendChild( this._createModuleRow( path, settings, moduleDefsByName.get( this.getModuleKey( path ) ) ) );
		} );
	}

	// Jeden řádek seznamu modulů. Položka seznamu může být i instance modulu s
	// vícenásobnými instancemi ("…#id", viz parseModuleEntry() v base.mjs) — ta
	// má vlastní nastavení pod klíčem "<modul>#<id>" (entry.key) místo jména
	// modulu, navíc pole instanceSettingsSchema a tlačítko pro odebrání.
	// Šablona takového modulu (položka bez id) nic nevypisuje, a proto nemá ani
	// nastavení — jen tlačítko, které přidá novou instanci.
	/** @type {Classes.OptionsController['_createModuleRow']} */
	_createModuleRow ( path, settings, moduleDef )
	{
		const entry = parseModuleEntry( path );
		const key = entry.key;
		const name = this.formatModuleName( entry.name );
		const mode = this.getModuleMode( settings, key, moduleDef?.defaultActivationMode );
		const displayLocations = getModuleDisplayLocations(
			settings,
			key,
			moduleDef?.defaultDisplayLocation
		);

		const row = document.createElement( "div" );
		row.className = "module-row";
		// MODULE_NAME (== key, viz getModuleKey — soubor/složka modulu se podle
		// pravidel v README musí jmenovat stejně; u instance "<modul>#<id>") je
		// stabilnější identifikátor pro id řádku než TAG (extension-*, odvozený z
		// MODULE_NAME): je to přímo hodnota, kterou už řádek nese jako
		// dataset.moduleKey u selectů níž. Celá položka seznamu se ukládá zvlášť
		// (dataset.modulePath) — bez ní by po přetažení (viz
		// _initDragToReorder/_persistModuleOrder) nebylo z pouhého pořadí <div>ů
		// jak sestavit zpátky modules.json.
		row.id = `module-row-${ key }`;
		row.dataset.modulePath = path;

		const nameEl = document.createElement( "div" );
		nameEl.className = "module-name";
		nameEl.textContent = name;
		// Za tenhle nadpis (ne za celý řádek) jde modul přetáhnout výš/níž v
		// seznamu — viz _initDragToReorder.
		nameEl.draggable = true;
		nameEl.title = t( "options_drag_to_reorder" );
		row.appendChild( nameEl );

		// Krátký popisek modulu (viz moduleDef.description, module.mjs) —
		// nepovinný, chybějící se prostě nevypíše (bez chyby, jen warning
		// při registraci, viz validateModule() v base.mjs). U instance ne —
		// popisek už je u šablony a v každém řádku instance by jen překážel.
		if ( moduleDef?.description && !entry.instance ) {
			const descriptionEl = document.createElement( "small" );
			descriptionEl.className = "module-description";
			descriptionEl.textContent = moduleDef.description;
			row.appendChild( descriptionEl );
		}

		if ( moduleDef?.multiInstance && !entry.instance ) {
			row.classList.add( "module-row--template" );
			row.appendChild( this._createAddInstanceButton( row, entry, name ) );
			row.appendChild( this._createDependenciesField( moduleDef ) );
			return row;
		}

		// Pole instanceSettingsSchema (contentDivider: nadpis a HTML) — stejné
		// ovládací prvky jako vlastní nastavení modulů níž, jen patří jedné
		// instanci, a proto jsou přímo v jejím řádku. Uloží je save().
		if ( entry.instance ) {
			row.classList.add( "module-row--instance" );
			( moduleDef?.instanceSettingsSchema || [] ).forEach( ( field ) =>
			{
				row.appendChild( this._createSettingRow( field, key, settings, "module-instance-setting-control" ) );
			} );
		}

		row.appendChild(
			this._createLabeledSelect(
				t( "options_activation_mode" ),
				"module-mode",
				key,
				ACTIVATION_MODES,
				mode,
				moduleDef?.defaultActivationMode
			)
		);

		row.appendChild(
			this._createDisplayLocationsField(
				key,
				displayLocations,
				// Jen to, co modul sám deklaruje — globální výchozí hodnota se
				// neoznačuje (viz RECOMMENDED_SUFFIX).
				parseDisplayLocations( moduleDef?.defaultDisplayLocation ) || []
			)
		);

		// Rám a nadpis jsou jedny pro všechna zaškrtnutá místa — jiný vzhled na
		// různých místech by znamenal obě volby u každého místa zvlášť.
		row.appendChild(
			this._createFieldGroup( t( "options_output_look" ), "module-output-look", [
				this._createLabeledSelect(
					t( "options_output_element" ),
					"module-output-element",
					key,
					OUTPUT_ELEMENTS,
					getModuleOutputElement( settings, key, moduleDef?.defaultOutputElement ),
					moduleDef?.defaultOutputElement
				),
				this._createLabeledCheckbox(
					t( "options_show_heading" ),
					"module-show-heading",
					key,
					getModuleShowHeading( settings, key, moduleDef?.defaultShowHeading )
				),
			] )
		);

		// Závislosti má modul jedny pro všechny instance — vypíšou se jen
		// u šablony (výš), stejně jako popisek.
		if ( moduleDef && !entry.instance ) {
			row.appendChild( this._createDependenciesField( moduleDef ) );
		}

		if ( entry.instance ) {
			row.appendChild( this._createRemoveInstanceButton( row, entry, name ) );
		}

		this._syncOutputSettingsState( row );
		return row;
	}

	// Přehled závislostí na konci řádku modulu — všechno z toho, co moduly samy
	// zveřejnily v registerModule(), nic se nehádá z jejich kódu:
	// - dependsOn: moduly, bez kterých modul (nebo jeho část) nefunguje, a
	//   naopak moduly, které deklarují závislost na něm;
	// - usesPermissions: nepovinná oprávnění, i s tím, jestli jsou udělená
	//   (doplní se asynchronně, chrome.permissions.contains()).
	// Vztahy k ostatním modulům počítá jen s moduly v aktuálním seznamu
	// (this._moduleDefs) — deklarovaná závislost na modulu mimo seznam se
	// vypíše s upozorněním.
	/** @type {Classes.OptionsController['_createDependenciesField']} */
	_createDependenciesField ( moduleDef )
	{
		const defs = this._moduleDefs;
		const listed = new Set( defs.map( ( mod ) => mod.name ) );
		/** @type {HTMLElement[]} */
		const items = [];

		/** @type {(label: string, text: string, warning?: boolean) => HTMLElement} */
		const addItem = ( label, text, warning = false ) =>
		{
			const item = document.createElement( "li" );
			const strong = document.createElement( "strong" );
			strong.textContent = `${ label }: `;
			item.append( strong, text );
			if ( warning ) item.classList.add( "module-dependency--warning" );
			items.push( item );
			return item;
		};

		( moduleDef.dependsOn || [] ).forEach( ( { module, reason } ) =>
		{
			const missing = !listed.has( module );
			const suffix = missing ? t( "options_dependency_missing_suffix" ) : "";
			addItem( t( "options_dependency_needs", this.formatModuleName( module ) ), `${ reason }${ suffix }`, missing );
		} );

		const dependents = defs.filter( ( mod ) => ( mod.dependsOn || [] ).some( ( d ) => d.module === moduleDef.name ) );
		if ( dependents.length > 0 ) {
			addItem( t( "options_dependency_dependents" ), dependents.map( ( mod ) => this.formatModuleName( mod.name ) ).join( ", " ) );
		}

		( moduleDef.usesPermissions || [] ).forEach( ( permissionSet ) =>
		{
			const names = [ ...( permissionSet.permissions || [] ), ...( permissionSet.origins || [] ) ];
			const item = addItem( t( "options_optional_permission" ), names.join( " + " ) );
			const status = document.createElement( "span" );
			status.className = "module-dependency-status";
			item.appendChild( status );
			// Oprávnění, které prohlížeč nezná (ve Firefoxu třeba "debugger"),
			// odmítne contains() ve Firefoxu SYNCHRONNĚ výjimkou (kontrola
			// schématu parametrů), ne zamítnutou promisou — proto volání uvnitř
			// .then(), jinak by výjimka shodila vykreslení celého seznamu modulů.
			Promise.resolve()
				.then( () => chrome.permissions.contains( permissionSet ) )
				.then( ( granted ) =>
				{
					status.textContent = granted ? t( "options_permission_granted" ) : t( "options_permission_not_granted" );
				} )
				.catch( () =>
				{
					status.textContent = t( "options_permission_unavailable" );
				} );
		} );

		const list = document.createElement( "ul" );
		list.className = "module-dependencies-list";
		if ( items.length > 0 ) {
			list.append( ...items );
		} else {
			const item = document.createElement( "li" );
			item.textContent = t( "options_dependencies_none" );
			list.appendChild( item );
		}

		return this._createFieldGroup( t( "options_dependencies" ), "module-dependencies", [ list ] );
	}

	// --- Instance modulu s vícenásobnými instancemi (viz parseModuleEntry()) ---
	//
	// Přidání i odebrání instance mění seznam modulů, a proto se uloží hned —
	// stejně jako přetažení řádku (viz _persistModuleOrder). Nastavení nové
	// instance (pole v jejím řádku, režim, plocha, ...) se ukládá jako u
	// ostatních modulů tlačítkem „Uložit nastavení“; do té doby platí výchozí
	// hodnoty, které deklaroval modul.

	/** @type {Classes.OptionsController['_createAddInstanceButton']} */
	_createAddInstanceButton ( templateRow, entry, name )
	{
		const button = document.createElement( "button" );
		button.type = "button";
		button.className = "module-row-button";
		button.textContent = t( "options_add_instance", name );
		button.title = t( "options_add_instance_title" );
		button.addEventListener( "click", () => this._addModuleInstance( templateRow, entry, name ) );
		return button;
	}

	// Nová instance se vloží hned pod šablonu, na kterou uživatel právě kliká
	// (ne na konec dlouhého seznamu), a dostane focus.
	/** @type {Classes.OptionsController['_addModuleInstance']} */
	async _addModuleInstance ( templateRow, entry, name )
	{
		const moduleDef = this._moduleDefs.find( ( mod ) => mod.name === entry.name );
		const path = `${ entry.path }${ MODULE_INSTANCE_SEPARATOR }${ createModuleInstanceId() }`;
		const row = this._createModuleRow( path, this._settings, moduleDef );
		templateRow.after( row );
		row.scrollIntoView( { block: "nearest" } );
		/** @type {HTMLElement | null} */ ( row.querySelector( "input, textarea, select" ) )?.focus();
		await this._persistModuleOrder( t( "options_instance_added", name ) );
	}

	// Dvoukrokové potvrzení místo window.confirm() (stejně jako importExport):
	// první klik jen změní text tlačítka, odebere až druhý během pár sekund.
	/** @type {Classes.OptionsController['_createRemoveInstanceButton']} */
	_createRemoveInstanceButton ( row, entry, name )
	{
		const button = document.createElement( "button" );
		button.type = "button";
		button.className = "module-row-button module-row-button--remove";
		button.textContent = t( "options_remove" );
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let confirmTimer;
		button.addEventListener( "click", () =>
		{
			if ( confirmTimer === undefined ) {
				button.textContent = t( "options_remove_confirm" );
				confirmTimer = setTimeout( () =>
				{
					confirmTimer = undefined;
					button.textContent = t( "options_remove" );
				}, 4000 );
				return;
			}
			clearTimeout( confirmTimer );
			this._removeModuleInstance( row, entry, name );
		} );
		return button;
	}

	// Odebere řádek i položku ze seznamu a s nimi celé nastavení instance —
	// "<modul>#<id>" (režim) a "<modul>#<id>.<pole>" (plocha, rám, pole
	// instanceSettingsSchema). Bez instance by v úložišti jen překáželo.
	/** @type {Classes.OptionsController['_removeModuleInstance']} */
	async _removeModuleInstance ( row, entry, name )
	{
		row.remove();
		await this._persistModuleOrder( t( "options_instance_removed", name ) );

		const settings = { ...( await this.loadSettings() ) };
		for ( const storageKey of Object.keys( settings ) ) {
			if ( storageKey === entry.key || storageKey.startsWith( `${ entry.key }.` ) ) {
				delete settings[ storageKey ];
			}
		}
		await this.saveSettings( settings );
	}

	// Co z nastavení výpisu v řádku dává smysl. Vypnutý modul se nevypíše nikde
	// — místa zešednou, ale zaškrtnutí zůstanou, ať po zapnutí modulu platí dál.
	// Bez zaškrtnutého místa se modul nikde nevypisuje; věta pod místy obojí
	// vysvětlí. "Element výpisu dat" i "s nadpisem modulu" mají smysl jen u
	// modulu, který se někde vypisuje. Nadpis navíc nejde vypnout u
	// uzavíratelného elementu — <summary> je jediné, za co jde rám rozbalit
	// (viz mountModuleElement v base.mjs). Hodnoty zablokovaných polí se při
	// uložení zachovají beze změny.
	/** @type {Classes.OptionsController['_syncOutputSettingsState']} */
	_syncOutputSettingsState ( row )
	{
		const modeSelect = /** @type {HTMLSelectElement | null} */ ( row.querySelector( ".module-mode" ) );
		const locationsField = row.querySelector( ".module-display-locations" );
		const locationCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ ( row.querySelectorAll( ".module-display-location" ) );
		const hint = /** @type {HTMLElement | null} */ ( row.querySelector( ".module-display-locations .module-row-hint" ) );
		const elementSelect = /** @type {HTMLSelectElement | null} */ ( row.querySelector( ".module-output-element" ) );
		const headingCheckbox = /** @type {HTMLInputElement | null} */ ( row.querySelector( ".module-show-heading" ) );
		// Šablona modulu s vícenásobnými instancemi nastavení výpisu nemá (viz
		// _createModuleRow).
		if ( !modeSelect || !locationsField || !hint || !elementSelect || !headingCheckbox ) return;

		const disabled = DISABLED_SPEC.isSatisfiedBy( { mode: /** @type {Enums.ActivationMode} */ ( modeSelect.value ) } );
		const notDisplayed = disabled || ![ ...locationCheckboxes ].some( ( checkbox ) => checkbox.checked );
		const collapsible = !!getOutputElementDef( elementSelect.value ).collapsible;

		locationCheckboxes.forEach( ( checkbox ) =>
		{
			checkbox.disabled = disabled;
		} );
		hint.textContent = disabled ? t( DISABLED_HINT ) : notDisplayed ? t( NOT_DISPLAYED_HINT ) : "";
		hint.hidden = !notDisplayed;

		elementSelect.disabled = notDisplayed;
		headingCheckbox.disabled = notDisplayed || collapsible;
		/** @type {HTMLLabelElement} */ ( headingCheckbox.parentElement ).title =
			!notDisplayed && collapsible
				? t( "options_heading_always_visible" )
				: "";
	}

	// Skupina voleb v řádku modulu — <fieldset> s nadpisem (<legend>) a
	// volbami vedle sebe (zalomí se, když se nevejdou). Sdílené mezi místy
	// výstupu a vzhledem výpisu.
	/** @type {Classes.OptionsController['_createFieldGroup']} */
	_createFieldGroup ( legendText, className, controls )
	{
		const fieldset = document.createElement( "fieldset" );
		fieldset.className = `module-row-group ${ className }`;

		const legend = document.createElement( "legend" );
		legend.textContent = legendText;

		const options = document.createElement( "div" );
		options.className = "module-row-group-options";
		options.append( ...controls );

		fieldset.append( legend, options );
		return fieldset;
	}

	// „Vypisovat data modulu“ — zaškrtávátko pro každé místo (DISPLAY_LOCATIONS),
	// modul se vypíše na všech zaškrtnutých. „Nevypisovat nikde“ není volba,
	// ale stav bez zaškrtnutí; co znamená, řekne věta pod místy (viz
	// _syncOutputSettingsState). Místa, která modul sám doporučuje
	// (defaultDisplayLocation, klidně víc), mají za textem RECOMMENDED_SUFFIX.
	/** @type {Classes.OptionsController['_createDisplayLocationsField']} */
	_createDisplayLocationsField ( moduleKey, locations, recommendedLocations )
	{
		const checkboxes = MODULE_SETTINGS_DISPLAY_LOCATIONS.map( ( opt ) =>
		{
			const label = this._createLabeledCheckbox(
				recommendedLocations.includes( opt.value ) ? `${ opt.label }${ recommendedSuffix() }` : opt.label,
				"module-display-location",
				moduleKey,
				locations.includes( opt.value )
			);
			/** @type {HTMLInputElement} */ ( label.querySelector( "input" ) ).value = opt.value;
			return label;
		} );

		const fieldset = this._createFieldGroup( t( "options_display_locations" ), "module-display-locations", checkboxes );
		fieldset.dataset.moduleKey = moduleKey;

		const hint = document.createElement( "small" );
		hint.className = "module-row-hint";
		hint.hidden = true;
		fieldset.appendChild( hint );
		return fieldset;
	}

	// Sestaví <label>Text<select>...</select></label> pro jeden řádek modulu
	// — sdílené mezi selectem aktivačního režimu a elementu výpisu, ať se
	// stejná logika nevytváří na víc místech zvlášť. Volba,
	// kterou modul doporučuje (recommendedValue), dostane RECOMMENDED_SUFFIX;
	// bez doporučení (nebo s neplatnou hodnotou) se neoznačí žádná.
	/** @type {Classes.OptionsController['_createLabeledSelect']} */
	_createLabeledSelect ( labelText, selectClassName, moduleKey, options, selectedValue, recommendedValue )
	{
		const label = document.createElement( "label" );
		label.className = "module-row-field";
		label.textContent = labelText;

		const select = document.createElement( "select" );
		select.className = selectClassName;
		select.dataset.moduleKey = moduleKey;

		options.forEach( ( opt ) =>
		{
			const option = document.createElement( "option" );
			option.value = opt.value;
			option.textContent = opt.value === recommendedValue ? `${ opt.label }${ recommendedSuffix() }` : opt.label;
			if ( opt.value === selectedValue ) {
				option.selected = true;
			}
			select.appendChild( option );
		} );

		label.appendChild( select );
		return label;
	}

	// Obdoba _createLabeledSelect pro ano/ne volbu — checkbox před textem.
	/** @type {Classes.OptionsController['_createLabeledCheckbox']} */
	_createLabeledCheckbox ( labelText, checkboxClassName, moduleKey, checked )
	{
		const label = document.createElement( "label" );
		label.className = "module-row-field module-row-checkbox";

		const checkbox = document.createElement( "input" );
		checkbox.type = "checkbox";
		checkbox.className = checkboxClassName;
		checkbox.dataset.moduleKey = moduleKey;
		checkbox.checked = checked;

		label.append( checkbox, labelText );
		return label;
	}

	// --- Přetažení řádku (změna pořadí modulů) ---
	//
	// Uchopit jde jen za nadpis modulu (.module-name, draggable="true" — viz
	// renderModules), ne za celý řádek (třeba kvůli selectům, u kterých by
	// draggable na rodiči bránilo běžné práci s myší). Řádky jsou vždy pod
	// sebou v jednom sloupci, takže "jen v ose Y" (nahoru/dolů) platí samo od
	// sebe — přetažený řádek se přesouvá mezi svými sourozenci podle toho, nad
	// kterým z nich je zrovna kurzor (viz _rowAfterPoint), ne podle X pozice.
	// Container (#modules-list) poslouchá napořád, i po překreslení — je to
	// pořád ten samý element, jen se mu maže/plní obsah (viz renderModules).
	/** @type {Classes.OptionsController['_initDragToReorder']} */
	_initDragToReorder ()
	{
		this.container.addEventListener( "dragstart", ( e ) =>
		{
			const handle = /** @type {Element} */ ( e.target ).closest( ".module-name" );
			const row = handle && handle.closest( ".module-row" );
			if ( !row ) return;
			this._draggedRow = row;
			/** @type {DataTransfer} */ ( e.dataTransfer ).effectAllowed = "move";
			// Data se nikde nečtou (přesun řeší přímo DOM, viz dragover/drop), ale
			// bez aspoň prázdného setData() by Firefox drag vůbec nezahájil.
			/** @type {DataTransfer} */ ( e.dataTransfer ).setData( "text/plain", row.id );
			row.classList.add( "dragging" );
		} );

		this.container.addEventListener( "dragend", () =>
		{
			if ( this._draggedRow ) {
				this._draggedRow.classList.remove( "dragging" );
			}
			this._draggedRow = null;
		} );

		this.container.addEventListener( "dragover", ( e ) =>
		{
			if ( !this._draggedRow ) return;
			// Bez preventDefault() prohlížeč drop vůbec nepovolí (výchozí chování
			// dragover je "sem se pustit nedá").
			e.preventDefault();
			/** @type {DataTransfer} */ ( e.dataTransfer ).dropEffect = "move";

			const afterRow = this._rowAfterPoint( e.clientY );
			if ( afterRow === null ) {
				this.container.appendChild( this._draggedRow );
			} else if ( afterRow !== this._draggedRow ) {
				this.container.insertBefore( this._draggedRow, afterRow );
			}
		} );

		this.container.addEventListener( "drop", async ( e ) =>
		{
			e.preventDefault();
			if ( !this._draggedRow ) return;
			await this._persistModuleOrder();
		} );
	}

	// Řádek, PŘED který se má přetahovaný řádek vložit — podle toho, jestli je
	// kurzor nad horní, nebo dolní polovinou daného řádku (svislý střed jako
	// hranice). null = přetahovaný řádek patří až na konec seznamu.
	/** @type {Classes.OptionsController['_rowAfterPoint']} */
	_rowAfterPoint ( y )
	{
		const rows = [ ...this.container.querySelectorAll( ".module-row:not(.dragging)" ) ];
		/** @type {Types.ModuleRowCandidate} */
		let closest = { offset: Number.NEGATIVE_INFINITY, row: null };

		for ( const row of rows ) {
			const box = row.getBoundingClientRect();
			const offset = y - box.top - box.height / 2;
			if ( offset < 0 && offset > closest.offset ) {
				closest = { offset, row };
			}
		}
		return closest.row;
	}

	// Aktuální pořadí <div class="module-row"> v DOM (po přetažení, viz výš) ->
	// nové pole cest -> stejná cesta persistence jako u ruční úpravy JSON
	// textarey (saveModulesList) i JSON editor drží v souladu, ať v něm
	// přetažené pořadí hned vidět.
	// Totéž po přidání/odebrání instance modulu, jen s jinou hláškou (status).
	/** @type {Classes.OptionsController['_persistModuleOrder']} */
	async _persistModuleOrder ( status = t( "options_order_saved" ) )
	{
		const paths = [ .../** @type {NodeListOf<HTMLElement>} */ ( this.container.querySelectorAll( ".module-row" ) ) ].map( ( row ) => row.dataset.modulePath );
		const text = JSON.stringify( paths, null, 2 );

		this.jsonTextareaEl.value = text;
		await this.saveModulesJson( text );
		this._showStatus( status );
	}

	// Dynamicky načte JS soubory modulů (aby proběhla jejich registrace a
	// byla dostupná jejich settingsSchema), a překreslí obě sekce, které na
	// aktuálním seznamu modulů závisí — aktivační režimy i vlastní nastavení.
	/** @type {Classes.OptionsController['_refreshModules']} */
	async _refreshModules ( paths, settings )
	{
		this._moduleDefs = await this.importModuleFiles( paths );
		this.renderModules( paths, settings );
		this.renderModuleSettings( this._moduleDefs, settings );
	}

	// --- Vlastní nastavení modulů (settingsSchema) ---

	/** @type {Classes.OptionsController['renderModuleSettings']} */
	renderModuleSettings ( moduleDefs, settings )
	{
		this.moduleSettingsContainer.innerHTML = "";

		const modulesWithSchema = moduleDefs.filter(
			( mod ) => Array.isArray( mod.settingsSchema ) && mod.settingsSchema.length > 0
		);

		if ( modulesWithSchema.length === 0 ) {
			const notice = document.createElement( "div" );
			notice.className = "no-settings";
			notice.textContent = t( "options_no_module_settings" );
			this.moduleSettingsContainer.appendChild( notice );
			return;
		}

		modulesWithSchema.forEach( ( mod ) =>
		{
			// Vlastní editor (typ "custom") se může stylovat z CSS modulu
			// (registerModule({ styles })) — to jinak jádro připojí jen s
			// elementem modulu, který se na téhle stránce vykreslovat nemusí.
			this.loadModuleStyles( mod );

			// id = jméno modulu, tedy i jeho složky (modules/<jméno>/<jméno>.mjs) —
			// odkaz na nastavení konkrétního modulu (options.html#<jméno>), nadpis
			// na něj odkazuje.
			const block = document.createElement( "div" );
			block.className = "module-settings-block";
			block.id = mod.name;

			const heading = document.createElement( "div" );
			heading.className = "module-name";
			const link = document.createElement( "a" );
			link.href = `#${ mod.name }`;
			link.textContent = this.formatModuleName( mod.name );
			heading.appendChild( link );
			block.appendChild( heading );

			// Jen moduly s neprázdným settingsSchema (viz filter výš).
			/** @type {Types.SettingField[]} */ ( mod.settingsSchema ).forEach( ( field ) =>
			{
				block.appendChild( this._createSettingRow( field, mod.name, settings, "module-setting-control" ) );
			} );

			this.moduleSettingsContainer.appendChild( block );
		} );
	}

	// Jedno pole nastavení s popiskem — sdílené mezi vlastním nastavením modulů
	// (settingsSchema, klíč = jméno modulu) a poli instance v jejím řádku
	// seznamu modulů (instanceSettingsSchema, klíč = "<modul>#<id>", viz
	// _createModuleRow). controlClassName odliší, které tlačítko pole uloží.
	/** @type {Classes.OptionsController['_createSettingRow']} */
	_createSettingRow ( field, moduleKey, settings, controlClassName )
	{
		const storageKey = getModuleSettingKey( moduleKey, field.key );
		const value = settings[ storageKey ] !== undefined ? settings[ storageKey ] : field.default;

		const row = document.createElement( "div" );
		row.className = "module-setting-row";

		const control = this._createSettingControl( field, value, settings );
		// classList místo přiřazení className — vlastní editor (typ "custom") si
		// může nést vlastní třídy, které se nesmí přepsat.
		control.classList.add( controlClassName );
		control.dataset.moduleKey = moduleKey;
		control.dataset.fieldKey = field.key;
		control.dataset.fieldType = field.type;

		if ( field.type === "custom" ) {
			// Vlastní editor obsahuje víc ovládacích prvků, <label> by se vázal
			// jen na první z nich — popisek je proto v samostatném elementu.
			const caption = document.createElement( "div" );
			caption.className = "module-setting-caption";
			caption.textContent = field.label;
			row.appendChild( caption );
			row.appendChild( control );
		} else {
			const label = document.createElement( "label" );
			label.textContent = field.label;
			label.appendChild( document.createElement( "br" ) );
			label.appendChild( control );
			row.appendChild( label );
		}
		return row;
	}

	/** @type {Classes.OptionsController['_createSettingControl']} */
	_createSettingControl ( field, value, settings )
	{
		/** @type {Types.SettingControl} */
		let control;

		switch ( field.type ) {
			case "textarea":
				control = document.createElement( "textarea" );
				control.value = /** @type {string} */ ( value ?? "" );
				break;
			case "checkbox":
				control = document.createElement( "input" );
				control.type = "checkbox";
				control.checked = !!value;
				break;
			case "number":
				control = document.createElement( "input" );
				control.type = "number";
				control.value = /** @type {string} */ ( value ?? "" );
				break;
			case "select":
				control = document.createElement( "select" );
				( field.options || [] ).forEach( ( opt ) =>
				{
					const option = document.createElement( "option" );
					option.value = opt.value;
					option.textContent = opt.label;
					if ( opt.value === value ) {
						option.selected = true;
					}
					control.appendChild( option );
				} );
				break;
			case "custom":
				control = this._createCustomControl( field, value, settings );
				break;
			case "text":
			default:
				control = document.createElement( "input" );
				control.type = "text";
				control.value = /** @type {string} */ ( value ?? "" );
				break;
		}

		if ( field.placeholder ) {
			/** @type {HTMLInputElement | HTMLTextAreaElement} */ ( control ).placeholder = field.placeholder;
		}

		return control;
	}

	// Vlastní editor dodaný modulem: field.render(value, settings) vrací element
	// s metodou getValue(). Kdyby se vykreslení nepovedlo, ostatní nastavení musí
	// zůstat funkční a původní hodnota se při uložení nesmí přepsat — proto
	// záložní element, který ji jen vrací beze změny.
	/** @type {Classes.OptionsController['_createCustomControl']} */
	_createCustomControl ( field, value, settings )
	{
		try {
			const control = field.render( value, settings );
			if ( !control || typeof control.getValue !== "function" ) {
				throw new Error( t( "options_custom_field_invalid" ) );
			}
			return control;
		} catch ( err ) {
			console.error( `Nelze vykreslit vlastní pole "${ field.key }":`, err );
			// Metodu getValue() dostane o pár řádků níž.
			const fallback = /** @type {Types.FallbackSettingControl} */ ( document.createElement( "div" ) );
			fallback.className = "no-settings";
			fallback.textContent = t( "options_custom_field_failed", /** @type {Error} */( err ).message );
			fallback.getValue = () => value;
			return fallback;
		}
	}

	/** @type {Classes.OptionsController['_readSettingControlValue']} */
	_readSettingControlValue ( el )
	{
		if ( el.dataset.fieldType === "custom" ) {
			return /** @type {Types.CustomSettingControl} */ ( el ).getValue();
		}
		if ( el.dataset.fieldType === "checkbox" ) {
			return /** @type {HTMLInputElement} */ ( el ).checked;
		}
		return /** @type {Types.ValueSettingControl} */ ( el ).value;
	}

	/** @type {Classes.OptionsController['saveModuleSettings']} */
	async saveModuleSettings ()
	{
		const controls = /** @type {NodeListOf<Types.SettingControl>} */ ( this.moduleSettingsContainer.querySelectorAll( ".module-setting-control" ) );
		const settings = { ...( await this.loadSettings() ) };

		controls.forEach( ( el ) =>
		{
			// moduleKey i fieldKey nastavuje renderModuleSettings() každému ovládacímu prvku.
			const storageKey = getModuleSettingKey(/** @type {string} */( el.dataset.moduleKey ), /** @type {string} */( el.dataset.fieldKey ) );
			settings[ storageKey ] = this._readSettingControlValue( el );
		} );

		await this.saveSettings( settings );
		this._showStatus( t( "options_module_settings_saved" ) );
	}

	/** @type {Classes.OptionsController['resetModuleSettings']} */
	async resetModuleSettings ()
	{
		const defaults = await this._loadDefaultSettings();
		const settings = { ...( await this.loadSettings() ) };

		// Výchozí nastavení z default-settings.json má přednost před výchozí
		// hodnotou pole v settingsSchema — stejné hodnoty jako po instalaci.
		this._moduleDefs.forEach( ( mod ) =>
		{
			( mod.settingsSchema || [] ).forEach( ( field ) =>
			{
				const storageKey = getModuleSettingKey( mod.name, field.key );
				settings[ storageKey ] = defaults[ storageKey ] !== undefined ? defaults[ storageKey ] : field.default;
			} );
		} );

		await this.saveSettings( settings );
		this.renderModuleSettings( this._moduleDefs, settings );
		this._showStatus( t( "options_module_settings_reset" ) );
	}

	// Výchozí nastavení z balíčku rozšíření (default-settings.json, viz
	// BaseController.fetchDefaultSettings()) pro tlačítka „Obnovit výchozí“.
	// Když ho nejde načíst, obnoví se jen výchozí hodnoty modulů.
	/** @type {Classes.OptionsController['_loadDefaultSettings']} */
	async _loadDefaultSettings ()
	{
		try {
			return await this.fetchDefaultSettings();
		} catch ( err ) {
			console.error( "Výchozí nastavení modulů nejde načíst:", err );
			return {};
		}
	}

	/** @type {Classes.OptionsController['_showStatus']} */
	_showStatus ( text, duration = 2000 )
	{
		this.statusEl.textContent = text;
		setTimeout( () =>
		{
			this.statusEl.textContent = "";
		}, duration );
	}

	/** @type {Classes.OptionsController['save']} */
	async save ()
	{
		// Vychází z aktuálně uložených nastavení, ne z prázdného objektu —
		// jinak by se přepsáním celého "moduleSettings" ztratila i vlastní
		// nastavení modulů (viz saveModuleSettings) uložená mimo tento formulář.
		const settings = { ...( await this.loadSettings() ) };

		// dataset.moduleKey nastavují _createLabeledSelect/_createLabeledCheckbox každému prvku řádku.
		/** @type {NodeListOf<HTMLSelectElement>} */ ( this.container.querySelectorAll( ".module-mode" ) ).forEach( ( select ) =>
		{
			settings[/** @type {string} */ ( select.dataset.moduleKey ) ] = select.value;
		} );

		// Místa výstupu jako pole zaškrtnutých míst v pořadí DISPLAY_LOCATIONS
		// (prázdné = nikde), i u vypnutého modulu se zablokovanými místy.
		/** @type {NodeListOf<HTMLFieldSetElement>} */ ( this.container.querySelectorAll( ".module-display-locations" ) ).forEach( ( fieldset ) =>
		{
			const checked = /** @type {NodeListOf<HTMLInputElement>} */ ( fieldset.querySelectorAll( ".module-display-location:checked" ) );
			settings[ getModuleSettingKey(/** @type {string} */( fieldset.dataset.moduleKey ), "displayLocation" ) ] = [ ...checked ].map( ( checkbox ) => checkbox.value );
		} );

		// Ukládá se i ze zablokovaných polí (viz _syncOutputSettingsState) — volba
		// tak zůstane připravená, až se modul zase začne někde vypisovat.
		/** @type {NodeListOf<HTMLSelectElement>} */ ( this.container.querySelectorAll( ".module-output-element" ) ).forEach( ( select ) =>
		{
			settings[ getModuleSettingKey(/** @type {string} */( select.dataset.moduleKey ), "outputElement" ) ] = select.value;
		} );

		/** @type {NodeListOf<HTMLInputElement>} */ ( this.container.querySelectorAll( ".module-show-heading" ) ).forEach( ( checkbox ) =>
		{
			settings[ getModuleSettingKey(/** @type {string} */( checkbox.dataset.moduleKey ), "showHeading" ) ] = checkbox.checked;
		} );

		// Pole instanceSettingsSchema v řádcích instancí (viz _createModuleRow) —
		// moduleKey je u nich "<modul>#<id>".
		/** @type {NodeListOf<Types.SettingControl>} */ ( this.container.querySelectorAll( ".module-instance-setting-control" ) ).forEach( ( el ) =>
		{
			settings[ getModuleSettingKey(/** @type {string} */( el.dataset.moduleKey ), /** @type {string} */( el.dataset.fieldKey ) ) ] =
				this._readSettingControlValue( el );
		} );

		await this.saveSettings( settings );
		this._showStatus( t( "options_settings_saved" ) );
	}

	/** @type {Classes.OptionsController['reset']} */
	async reset ()
	{
		let jsonText;
		try {
			jsonText = await this.fetchDefaultModulesJson();
		} catch ( err ) {
			this._showStatus( t( "options_error", /** @type {Error} */( err ).message ) );
			return;
		}

		let paths;
		try {
			paths = JSON.parse( jsonText );
			if ( !Array.isArray( paths ) ) {
				throw new Error( t( "core_modules_json_not_array" ) );
			}
		} catch ( err ) {
			this._showStatus( t( "options_error", /** @type {Error} */( err ).message ) );
			return;
		}

		// Aktuální seznam modulů — může mít jiné pořadí, jiné moduly i instance
		// modulů navíc (viz parseModuleEntry()). Resetují se i jeho položky a
		// vykreslí se právě on: seznam samotný tlačítko nemění (na to je
		// „Obnovit výchozí seznam“), výchozí seznam by v řádcích ukázal jiné
		// pořadí, než jaké platí.
		/** @type {unknown[]} */
		let currentPaths;
		try {
			currentPaths = JSON.parse( await this.getModulesJson() );
			if ( !Array.isArray( currentPaths ) ) {
				throw new Error( t( "core_modules_json_not_array" ) );
			}
		} catch {
			currentPaths = paths;
		}
		const currentList = currentPaths.filter( ( path ) => typeof path === "string" );
		const allPaths = [ ...paths, ...currentList ];

		// Aby reset respektoval vlastní výchozí hodnoty modulů (viz
		// defaultActivationMode/defaultDisplayLocation/defaultOutputElement/
		// defaultShowHeading), je potřeba mít jejich definice načtené — i kdyby
		// aktuální seznam modulů byl jiný než výchozí.
		const moduleDefs = await this.importModuleFiles( allPaths );
		const moduleDefsByName = new Map( moduleDefs.map( ( mod ) => [ mod.name, mod ] ) );

		// Výchozí nastavení z default-settings.json — u položek, které v něm
		// jsou (contentDivider#welcome: místo "onboarding"), má přednost před
		// návrhem modulu, stejně jako po instalaci.
		const defaults = await this._loadDefaultSettings();

		// Vychází z aktuálně uložených nastavení (viz save() výše) — resetují
		// se jen aktivační režimy, místa výstupu a element výpisu (vč. nadpisu),
		// vlastní nastavení modulů (settingsSchema) ani pole instancí
		// (instanceSettingsSchema — obsah, ne způsob výpisu) se nemění.
		const settings = { ...( await this.loadSettings() ) };
		allPaths.forEach( ( path ) =>
		{
			const { name, instance, key } = parseModuleEntry( path );
			const moduleDef = moduleDefsByName.get( name );
			// Šablona modulu s vícenásobnými instancemi žádné nastavení nemá.
			if ( moduleDef?.multiInstance && !instance ) return;
			// Gettery z base.mjs nad výchozím nastavením místo uloženého =
			// default-settings.json, jinak návrh modulu, jinak globální výchozí
			// hodnota (u elementu výpisu a nadpisu i s přeskočením neplatné hodnoty).
			settings[ key ] = this.getModuleMode( defaults, key, moduleDef?.defaultActivationMode );
			settings[ getModuleSettingKey( key, "displayLocation" ) ] = getModuleDisplayLocations(
				defaults,
				key,
				moduleDef?.defaultDisplayLocation
			);
			settings[ getModuleSettingKey( key, "outputElement" ) ] = getModuleOutputElement(
				defaults,
				key,
				moduleDef?.defaultOutputElement
			);
			settings[ getModuleSettingKey( key, "showHeading" ) ] = getModuleShowHeading(
				defaults,
				key,
				moduleDef?.defaultShowHeading
			);
		} );

		this._moduleDefs = moduleDefs;
		await this.saveSettings( settings );
		this.renderModules( currentList, settings );
		this.renderModuleSettings( this._moduleDefs, settings );
		this._showStatus( t( "options_settings_reset" ) );
	}

	/** @type {Classes.OptionsController['initPage']} */
	async initPage ()
	{
		await this.loadModulesListEditor();
		this._showModulesListDiff();

		let jsonText;
		try {
			jsonText = await this.getModulesJson();
		} catch ( err ) {
			this._showStatus( t( "options_error", /** @type {Error} */( err ).message ) );
			return;
		}

		let paths;
		try {
			paths = JSON.parse( jsonText );
			if ( !Array.isArray( paths ) ) {
				throw new Error( t( "core_modules_json_not_array" ) );
			}
		} catch ( err ) {
			this._showStatus( t( "options_error", /** @type {Error} */( err ).message ) );
			return;
		}

		const settings = await this.loadSettings();
		await this._refreshModules( paths, settings );

		// Odkaz na nastavení modulu (options.html#<jméno>, viz
		// renderModuleSettings()) — blok vzniká až po načtení modulů, na cíl
		// adresy už prohlížeč sám neposune. Výpis modulů nad ním (níž) posun
		// nerozhodí, obsah na obrazovce drží ukotvení posunu (overflow-anchor).
		if ( window.location.hash ) {
			document.getElementById( window.location.hash.slice( 1 ) )?.scrollIntoView();
		}

		// Moduly, mezi jejichž místy je "options" (viz DISPLAY_LOCATIONS v
		// base.mjs) se vykreslují sem — stejný sdílený mechanismus jako
		// popup/sidebar (BaseController.renderModulesFor()), jen
		// další cílová plocha navíc.
		await this.renderModulesFor( "options", this.outputEl );
	}
}

document.addEventListener( "DOMContentLoaded", async () =>
{
	await initPageI18n();
	// Volba jazyka rozhraní (stejná je i na uvítací stránce).
	await initUiLanguageSelect(/** @type {HTMLSelectElement} */( document.getElementById( "ui-language" ) ) );
	const controller = new OptionsController();
	controller.initPage();
} );
