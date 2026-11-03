//@ts-check
"use strict";

// content-scripts/floating-window.js
// Inserts a floating window into the page (FloatingWindow, see base.mjs) — it can be
// dragged by its header, resized with the handle in the bottom right corner and
// closed with the cross. It loads its content from floating.html through an iframe. There is only
// one window per page; the "🗗 Floating window" button (mainButtonsSandbox -> the function
// floatingWindow.toggle -> api.floatingWindow.toggle() in base.mjs, message TOGGLE_FLOATING_WINDOW_MESSAGE)
// opens or closes it according to the current state.
//
// The position, size and state (open/closed) are stored in the extension
// (chrome.storage.local) per domain (see getDomainStorageKey in base.mjs):
// closing with the cross on one domain also applies on the next visit to that
// same domain (it stays closed), leaving it open likewise (it stays
// open), and the same goes for a dragged position/size. Domains without their own
// record take over the last used position, size and state from anywhere
// else (see loadFloatingWindowState).
(async () => {
	// The scripting/<all_urls> permission is optional (see the manifest and
	// api.floatingWindow.toggle() in base.mjs) — a dynamically registered
	// content script is inserted only into pages loaded AFTER the permission is granted,
	// not into an already open tab. That is why toggle(), after the permission is granted, injects
	// this file into the tab once more directly
	// (chrome.scripting.executeScript), so that the button works right the first time.
	// Without this safeguard, a page the script reached both ways would
	// run two instances of the window with two sets of message listeners.
	if (window.__extensionFloatingWindowInjected) {
		return;
	}
	window.__extensionFloatingWindowInjected = true;

	const {
		createFloatingWindow,
		loadFloatingWindowState,
		saveFloatingWindowState,
		TOGGLE_FLOATING_WINDOW_MESSAGE,
	} = /** @type {Types.BaseModule} */ (await import(chrome.runtime.getURL("base.mjs")));
	// The window labels (close, resize) are put together by createFloatingWindow() via
	// t() — the texts must be loaded before the window is created.
	const { loadI18n } = /** @type {Types.Sdk} */ (await import(chrome.runtime.getURL("sdk.mjs")));
	await loadI18n();

	/** @type {Types.FloatingWindowElement | null} */
	let win = null;
	let opening = false;

	// Always reads the CURRENT position/size directly from the live element (not from the
	// previously loaded "saved" object) — saveFloatingWindowState() stores the whole state
	// at once (without merging with the previous record), so if a move
	// stored only top/left and a resize only width/height,
	// each action would overwrite the other. This way every save always sends
	// all 4 values + open at once.
	/** @type {Functions.FloatingWindowContentScript.currentState} */
	function currentState(open) {
		// Called only with an already created window (onMove/onResize/onClose, after buildWindow()).
		return {
			top: /** @type {Types.FloatingWindowElement} */ (win).style.top,
			left: /** @type {Types.FloatingWindowElement} */ (win).style.left,
			width: /** @type {Types.FloatingWindowElement} */ (win).style.width,
			height: /** @type {Types.FloatingWindowElement} */ (win).style.height,
			open,
		};
	}

	/** @type {Functions.FloatingWindowContentScript.buildWindow} */
	function buildWindow(saved) {
		win = createFloatingWindow({
			title: "Tab Groups floating",
			top: saved?.top,
			left: saved?.left,
			width: saved?.width,
			// An explicit default height (unlike top/left/width it does
			// not rely on the default value "auto" in createFloatingWindow) —
			// until the window has a fixed height, height:100% on the iframe below would
			// have nothing to be computed against and would collapse to the default ~150px.
			height: saved?.height || "280px",
			onMove: () => {
				saveFloatingWindowState(location.hostname, currentState(true));
			},
			onResize: () => {
				saveFloatingWindowState(location.hostname, currentState(true));
			},
			onClose: () => {
				saveFloatingWindowState(location.hostname, currentState(false));
			},
		});

		const iframe = document.createElement("iframe");
		iframe.src = chrome.runtime.getURL("floating.html");
		Object.assign(iframe.style, {
			display: "block",
			width: "100%",
			height: "100%",
			border: "none",
		});
		win.appendChild(iframe);

		document.body.appendChild(win);
	}

	// preloadedState: an optionally already loaded state (see the start at the end of the
	// file), so the same domain is not needlessly queried in storage twice.
	/** @type {Functions.FloatingWindowContentScript.openFloatingWindow} */
	async function openFloatingWindow(preloadedState) {
		if (win && win.isConnected) {
			return win;
		}
		// Protection against a quick double click on the toggle button before
		// loading the saved position from storage manages to finish.
		if (opening) {
			return;
		}
		opening = true;

		try {
			const saved = preloadedState !== undefined ? preloadedState : await loadFloatingWindowState(location.hostname);
			buildWindow(saved);
			await saveFloatingWindowState(location.hostname, currentState(true));
			return win;
		} finally {
			opening = false;
		}
	}

	/** @type {Functions.FloatingWindowContentScript.closeFloatingWindow} */
	function closeFloatingWindow() {
		if (win && win.isConnected) {
			win.close();
		}
	}

	/** @type {Functions.FloatingWindowContentScript.toggleFloatingWindow} */
	function toggleFloatingWindow() {
		if (win && win.isConnected) {
			closeFloatingWindow();
		} else {
			openFloatingWindow();
		}
	}

	// On page load, respect the last saved state (open/
	// closed) for this domain — or, if there is no record for it, the
	// global one (last used on any other domain). With no record
	// at all (the very first use) the default behavior stays: open.
	const initialState = await loadFloatingWindowState(location.hostname);
	if (initialState?.open !== false) {
		await openFloatingWindow(initialState);
	}

	chrome.runtime.onMessage.addListener((/** @type {Types.AnyMessage} */ message) => {
		if (message.type === TOGGLE_FLOATING_WINDOW_MESSAGE) {
			toggleFloatingWindow();
		}
	});
})();
