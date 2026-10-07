import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	DEFAULT_DISPLAY_LOCATION,
	DEFAULT_MODE,
	DEFAULT_OUTPUT_ELEMENT,
	DEFAULT_SHOW_HEADING,
	DISABLED_SPEC,
	FRAME_STATE_MAX_ENTRIES,
	FRAME_STATE_TTL_MS,
	LocationSpecification,
	NOT_DISABLED_SPEC,
	Specification,
	createModuleInstanceId,
	formatModuleName,
	getModuleDisplayLocations,
	getModuleInstanceKey,
	getModuleKey,
	getModuleMode,
	getModuleOutputElement,
	getModuleSettingKey,
	getModuleShowHeading,
	getOutputElementDef,
	getTagName,
	parseDisplayLocations,
	parseModuleEntry,
	pruneFrameStates,
} from "../base.mjs";

describe("jména a klíče modulů", () => {
	it("getModuleKey: jméno souboru bez přípony a bez id instance", () => {
		assert.equal(getModuleKey("./modules/tabGroups/tabGroups.mjs"), "tabGroups");
		assert.equal(getModuleKey("./modules/contentDivider/contentDivider.mjs#k3j9x2"), "contentDivider");
		assert.equal(getModuleKey("modules\\legacy\\legacy.js"), "legacy");
	});

	it("parseModuleEntry", () => {
		assert.deepEqual(parseModuleEntry("./modules/a/a.mjs#k1"), {
			entry: "./modules/a/a.mjs#k1",
			path: "./modules/a/a.mjs",
			name: "a",
			instance: "k1",
			key: "a#k1",
		});
		assert.deepEqual(parseModuleEntry("./modules/a/a.mjs#"), {
			entry: "./modules/a/a.mjs#",
			path: "./modules/a/a.mjs",
			name: "a",
			instance: null,
			key: "a",
		});
	});

	it("getModuleInstanceKey / getModuleSettingKey", () => {
		assert.equal(getModuleInstanceKey("a", "k1"), "a#k1");
		assert.equal(getModuleInstanceKey("a", null), "a");
		assert.equal(getModuleSettingKey("a#k1", "displayLocation"), "a#k1.displayLocation");
	});

	it("createModuleInstanceId: krátké id jen z [a-z0-9]", () => {
		const ids = new Set(Array.from({ length: 100 }, createModuleInstanceId));
		assert.equal(ids.size, 100);
		for (const id of ids) assert.match(id, /^[a-z0-9]{10}$/);
	});

	it("getTagName: název custom elementu", () => {
		assert.equal(getTagName("tabGroups"), "extension-tab-groups");
		assert.equal(getTagName("storageManager"), "extension-storage-manager");
	});

	it("formatModuleName: jméno pro lidi", () => {
		assert.equal(formatModuleName("storageManager"), "Storage Manager");
		assert.equal(formatModuleName("tabGroups"), "Tab Groups");
		assert.equal(formatModuleName("PWAInfo"), "PWA Info");
		assert.equal(formatModuleName("x"), "X");
	});
});

describe("nastavení modulu: uživatel > modul > výchozí", () => {
	it("getModuleMode", () => {
		assert.equal(getModuleMode({ a: "background" }, "a", "sidebar"), "background");
		assert.equal(getModuleMode({}, "a", "sidebar"), "sidebar");
		assert.equal(getModuleMode({}, "a"), DEFAULT_MODE);
	});

	it("parseDisplayLocations", () => {
		assert.deepEqual(parseDisplayLocations("none"), []);
		assert.deepEqual(parseDisplayLocations("sidebar"), ["sidebar"]);
		assert.equal(parseDisplayLocations("nikde"), null);
		assert.equal(parseDisplayLocations(42), null);
		assert.deepEqual(parseDisplayLocations(["options", "nikde", "popup", "popup"]), ["popup", "options"]);
		assert.deepEqual(parseDisplayLocations([]), []);
	});

	it("getModuleDisplayLocations", () => {
		const key = getModuleSettingKey("a", "displayLocation");
		assert.deepEqual(getModuleDisplayLocations({ [key]: ["options"] }, "a", "sidebar"), ["options"]);
		assert.deepEqual(getModuleDisplayLocations({ [key]: [] }, "a", "sidebar"), []);
		assert.deepEqual(getModuleDisplayLocations({ [key]: "nikde" }, "a", "sidebar"), ["sidebar"]);
		assert.deepEqual(getModuleDisplayLocations({}, "a", "nikde"), [DEFAULT_DISPLAY_LOCATION]);
	});

	it("getOutputElementDef / getModuleOutputElement", () => {
		assert.equal(getOutputElementDef("details-open").collapsible, true);
		assert.equal(getOutputElementDef("nic").value, DEFAULT_OUTPUT_ELEMENT);

		const key = getModuleSettingKey("a", "outputElement");
		assert.equal(getModuleOutputElement({ [key]: "inline" }, "a", "indented"), "inline");
		assert.equal(getModuleOutputElement({ [key]: "nic" }, "a", "indented"), "indented");
		assert.equal(getModuleOutputElement({}, "a", "nic"), DEFAULT_OUTPUT_ELEMENT);
	});

	it("getModuleShowHeading: uložené false platí", () => {
		const key = getModuleSettingKey("a", "showHeading");
		assert.equal(getModuleShowHeading({ [key]: false }, "a", true), false);
		assert.equal(getModuleShowHeading({ [key]: "ano" }, "a", true), true);
		assert.equal(getModuleShowHeading({}, "a"), DEFAULT_SHOW_HEADING);
	});
});

describe("pruneFrameStates", () => {
	const NOW = Date.UTC(2026, 9, 7);

	it("zahodí neplatné a staré záznamy, vstup nemění", () => {
		const store = {
			ok: { open: true, element: "details-open", seen: NOW - 1000 },
			old: { open: true, element: "details-open", seen: NOW - FRAME_STATE_TTL_MS - 1 },
			noOpen: { element: "details-open", seen: NOW },
			badSeen: { open: false, element: "details-open", seen: "včera" },
			nothing: null,
		};
		const copy = structuredClone(store);
		assert.deepEqual(pruneFrameStates(store, NOW), { ok: store.ok });
		assert.deepEqual(store, copy);
		assert.deepEqual(pruneFrameStates(null, NOW), {});
	});

	it("nechá nejvýš FRAME_STATE_MAX_ENTRIES naposledy viděných", () => {
		const store = Object.fromEntries(
			Array.from({ length: FRAME_STATE_MAX_ENTRIES + 5 }, (_, i) => [`k${i}`, { open: true, element: "details-open", seen: NOW - i }])
		);
		const pruned = pruneFrameStates(store, NOW);
		assert.equal(Object.keys(pruned).length, FRAME_STATE_MAX_ENTRIES);
		assert.ok("k0" in pruned);
		assert.ok(!(`k${FRAME_STATE_MAX_ENTRIES}` in pruned));
	});
});

describe("Specification", () => {
	it("vypnutý / nevypnutý modul", () => {
		assert.equal(DISABLED_SPEC.isSatisfiedBy({ mode: "disabled" }), true);
		assert.equal(DISABLED_SPEC.isSatisfiedBy({ mode: "popup" }), false);
		assert.equal(NOT_DISABLED_SPEC.isSatisfiedBy({ mode: "disabled" }), false);
		assert.equal(NOT_DISABLED_SPEC.isSatisfiedBy({ mode: "background" }), true);
	});

	it("plocha výstupu a skládání přes and()", () => {
		const onSidebar = new LocationSpecification(["sidebar", "options"]);
		assert.equal(onSidebar.isSatisfiedBy({ mode: "popup", location: "sidebar" }), true);
		assert.equal(onSidebar.isSatisfiedBy({ mode: "popup", location: "popup" }), false);
		assert.equal(onSidebar.isSatisfiedBy({ mode: "popup" }), false);
		assert.equal(new LocationSpecification("popup").isSatisfiedBy({ mode: "popup", location: "popup" }), true);

		const both = NOT_DISABLED_SPEC.and(onSidebar);
		assert.equal(both.isSatisfiedBy({ mode: "popup", location: "sidebar" }), true);
		assert.equal(both.isSatisfiedBy({ mode: "disabled", location: "sidebar" }), false);
		assert.equal(new Specification().isSatisfiedBy({ mode: "disabled" }), true);
	});
});
