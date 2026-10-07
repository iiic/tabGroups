//@ts-check
"use strict";

// background.js — service worker (Chrome) / background skript (Firefox); oba se
// v manifestu načítají jako modul ("type": "module").
//
// base.mjs se importuje staticky, ne dynamickým import(): ten je ve Service
// Workeru (Chrome) zakázaný specifikací HTML, takže původní
// `await import(chrome.runtime.getURL("base.mjs"))` tam vyhodilo TypeError
// a background nikdy nezačal fungovat (Firefox to zvládal, protože jeho
// background skript není Service Worker). Statický import navíc zajistí, že se
// message listenery zaregistrují synchronně hned při vyhodnocení skriptu, jak
// to MV3 pro probouzení service workeru vyžaduje.
import * as base from "./base.mjs";
// Background části modulů (modules/<jméno>/background-script.mjs, viz
// registerBackgroundScript() v base.mjs) — jejich seznam je v
// modules-background.mjs. Import je statický ze stejného důvodu jako u
// base.mjs výš: moduly se vyhodnotí ještě před zbytkem tohohle souboru a své
// posluchače zaregistrují při prvním průchodu skriptem.
import "./modules-background.mjs";

( () =>
{
	// --- Zelená tečka v ikonce, dokud service worker/background běží ---
	//
	// Chrome v MV3 service worker po ~30 s nečinnosti uspí a znovu probudí až
	// při další relevantní události (zpráva, alarm, kliknutí na ikonku, ...) —
	// tenhle indikátor jde sledovat v reálném čase přímo v liště prohlížeče.
	// Kreslí se přes OffscreenCanvas (service worker nemá <canvas>/document,
	// ale OffscreenCanvas je dostupný i tam) — načte se původní icon.png,
	// vykreslí beze změny a jen v aktivním stavu se do levého dolního rohu
	// přidá malá zelená tečka s měkkým (průhledným) okrajem přes
	// createRadialGradient(). Ve Firefoxu (kde background BĚŽÍ jako obyčejný
	// skript, ne service worker, viz komentář na začátku souboru) bude
	// zelená prakticky trvale — smysluplně odráží, že tam se ke stejnému
	// "uspání" neděje.
	//
	// iconDrawPromise řetězí volání, ať dvě rychle po sobě jdoucí (typicky
	// onSuspend hned následované onSuspendCanceled, když prohlížeč uspání
	// mezitím zruší) doopravdy skončí ve správném POŘADÍ POŽADAVKŮ, ne v
	// pořadí, v jakém se náhodou dokončí jejich async práce (fetch/decode).
	/** @type {Promise<void>} */
	let iconDrawPromise = Promise.resolve();
	/** @type {Functions.Background.updateExtensionIcon} */
	function updateExtensionIcon ( active )
	{
		iconDrawPromise = iconDrawPromise.catch( () => { } ).then( () => drawExtensionIcon( active ) );
		return iconDrawPromise;
	}

	/** @type {Functions.Background.drawExtensionIcon} */
	async function drawExtensionIcon ( active )
	{
		if ( !chrome.action || !chrome.action.setIcon || typeof OffscreenCanvas === "undefined" ) {
			return;
		}
		try {
			const response = await fetch( chrome.runtime.getURL( "icon.png" ) );
			const bitmap = await createImageBitmap( await response.blob() );
			const canvas = new OffscreenCanvas( bitmap.width, bitmap.height );
			// 2D kontext OffscreenCanvas je vždy k dispozici (null jen pro nepodporovaný typ).
			const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ ( canvas.getContext( "2d" ) );
			ctx.drawImage( bitmap, 0, 0 );

			if ( active ) {
				// Zadaná velikost (~9 px) platí pro ikonku zobrazenou při 32 px
				// (běžná velikost v liště prohlížeče na displejích s vyšším
				// rozlišením) — přepočteno poměrem ke skutečné velikosti
				// zdrojového obrázku (icon.png, 256×256), ať tečka vypadá stejně
				// velká bez ohledu na to, na jakou velikost ji prohlížeč zrovna
				// škáluje.
				const scale = bitmap.width / 32;
				const radius = ( 9 / 2 ) * scale;
				const margin = radius * 0.6;
				const cx = margin + radius;
				const cy = bitmap.height - margin - radius;

				const gradient = ctx.createRadialGradient( cx, cy, 0, cx, cy, radius );
				gradient.addColorStop( 0, "rgba(30, 180, 70, 1)" );
				gradient.addColorStop( 0.7, "rgba(30, 180, 70, 1)" );
				gradient.addColorStop( 1, "rgba(30, 180, 70, 0)" );

				ctx.fillStyle = gradient;
				ctx.beginPath();
				ctx.arc( cx, cy, radius, 0, Math.PI * 2 );
				ctx.fill();
			}

			await chrome.action.setIcon( { imageData: ctx.getImageData( 0, 0, canvas.width, canvas.height ) } );
		} catch ( err ) {
			console.error( "Překreslení ikonky rozšíření (indikátor běžícího service workeru) selhalo:", err );
		}
	}

	if ( chrome.runtime.onSuspend ) {
		chrome.runtime.onSuspend.addListener( () =>
		{
			updateExtensionIcon( false );
		} );
	}
	if ( chrome.runtime.onSuspendCanceled ) {
		chrome.runtime.onSuspendCanceled.addListener( () =>
		{
			updateExtensionIcon( true );
		} );
	}
	// Vyhodnocení tohohle souboru OD ZAČÁTKU (tenhle řádek) je přesně
	// okamžik, kdy service worker/background skript začíná běžet — proto se
	// tu (ne až v nějakém pozdějším handleru) rovnou nastaví aktivní stav.
	updateExtensionIcon( true );

	// Firefox sidebar_action z manifestu nejde dynamicky odebrat. Když ale
	// žádné uložené umístění modulu sidebar neobsahuje, zavři případně otevřený panel.
	/** @type {Functions.Background.closeSidebarWhenUnused} */
	async function closeSidebarWhenUnused ( settings )
	{
		const sidebarAction = Reflect.get( chrome, "sidebarAction" );
		if ( !sidebarAction || typeof sidebarAction.close !== "function" ) return;

		const locationSettings = Object.entries( settings ).filter( ( [ key ] ) => key.endsWith( ".displayLocation" ) );
		if ( !locationSettings.length ) return;
		const sidebarIsUsed = locationSettings.some( ( [ , value ] ) =>
			value === "sidebar" || ( Array.isArray( value ) && value.includes( "sidebar" ) )
		);
		if ( sidebarIsUsed ) return;

		try {
			await sidebarAction.close();
		} catch ( err ) {
			console.error( "Zavření nepoužívaného sidebaru selhalo:", err );
		}
	}

	async function syncSidebarAvailability ()
	{
		try {
			const stored = await chrome.storage.local.get( base.SETTINGS_KEY );
			await closeSidebarWhenUnused( /** @type {Types.ModuleSettings} */ ( stored[ base.SETTINGS_KEY ] || {} ) );
		} catch ( err ) {
			console.error( "Kontrola nastavení sidebaru selhala:", err );
		}
	}

	chrome.storage.onChanged.addListener( ( changes, area ) =>
	{
		const change = changes[ base.SETTINGS_KEY ];
		if ( area !== "local" || !change ) return;
		void closeSidebarWhenUnused( /** @type {Types.ModuleSettings} */ ( change.newValue || {} ) );
	} );

	// Po instalaci a aktualizaci rozšíření doplní výchozí nastavení položek
	// seznamu modulů (default-settings.json, jen chybějící hodnoty — viz
	// BaseController.seedDefaultSettings()). Onboarding se otevírá až po
	// dokončení této přípravy.
	/** @type {Functions.Background.handleInstalled} */
	async function handleInstalled ( details )
	{
		if ( details.reason === "install" || details.reason === "update" ) {
			try {
				const controller = new base.BaseController();
				const paths = JSON.parse( await controller.getModulesJson() );
				if ( !Array.isArray( paths ) ) {
					throw new Error( "modules.json musí být pole řetězců" );
				}
				await controller.seedDefaultSettings( paths );
			} catch ( err ) {
				console.error( "Výchozí nastavení modulů se nepodařilo zapsat:", err );
			}
		}
		if ( details.reason === "install" ) {
			try {
				await chrome.tabs.create( { url: chrome.runtime.getURL( "onboarding.html" ) } );
			} catch ( err ) {
				console.error( "Uvítací stránku se nepodařilo otevřít:", err );
			}
		}
	}

	chrome.runtime.onInstalled.addListener( ( details ) =>
	{
		handleInstalled( details );
	} );
	void syncSidebarAvailability();
} )();
