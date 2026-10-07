import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	DEFAULT_UI_LANGUAGE,
	UI_LANGUAGES,
	getBrowserUiLanguage,
	hasMessage,
	loadI18n,
	normalizeUiLanguage,
	t,
	tIn,
	tp,
} from "../i18n.mjs";
import { mockLocales } from "./helpers.mjs";

// Vlastní texty místo skutečných souborů — testuje se mechanika překladů.
// Skutečné soubory _locales kontroluje scripts/validate.mjs.
const MESSAGES = {
	en: {
		Greeting: { message: "Hello $1, you have $$$2" },
		only_en: { message: "English only" },
		items_one: { message: "$1 item" },
		items_other: { message: "$1 items" },
	},
	cs: {
		greeting: { message: "Ahoj $1" },
		items_one: { message: "$1 položka" },
		items_few: { message: "$1 položky" },
		items_other: { message: "$1 položek" },
	},
};

describe("i18n.mjs", () => {
	it("normalizeUiLanguage: neznámý jazyk → výchozí", () => {
		assert.equal(normalizeUiLanguage("cs"), "cs");
		assert.equal(normalizeUiLanguage("xx"), DEFAULT_UI_LANGUAGE);
		assert.equal(normalizeUiLanguage(undefined), DEFAULT_UI_LANGUAGE);
		assert.ok(UI_LANGUAGES.some((option) => option.value === DEFAULT_UI_LANGUAGE));
	});

	it("bez načtených textů a bez chrome.i18n vrací t() klíč", () => {
		assert.equal(t("neexistuje"), "neexistuje");
	});

	it("texty, proměnné a náhrada z výchozího jazyka", async () => {
		mockLocales((language) => MESSAGES[language]);
		await loadI18n("cs");
		assert.equal(t("greeting", "Petře"), "Ahoj Petře");
		// Klíče bez ohledu na velikost písmen.
		assert.equal(t("GREETING", "Petře"), "Ahoj Petře");
		assert.equal(t("only_en"), "English only");
		assert.equal(t("neexistuje"), "neexistuje");
		assert.equal(hasMessage("Only_EN"), true);
		assert.equal(hasMessage("neexistuje"), false);
	});

	it("tp() vybírá tvar množného čísla podle jazyka", async () => {
		mockLocales((language) => MESSAGES[language]);
		await loadI18n("cs");
		assert.equal(tp("items", 1), "1 položka");
		assert.equal(tp("items", 3), "3 položky");
		assert.equal(tp("items", 5), "5 položek");
		assert.equal(tp("items", 0), "0 položek");

		await loadI18n("en");
		assert.equal(tp("items", 1), "1 item");
		assert.equal(tp("items", 3), "3 items");
		assert.equal(t("greeting", "Ann", 5), "Hello Ann, you have $5");
	});

	it("tIn() překládá do zadaného jazyka bez změny jazyka rozhraní", async () => {
		mockLocales((language) => MESSAGES[language]);
		await loadI18n("en");
		assert.equal(await tIn("cs", "greeting", "Evo"), "Ahoj Evo");
		assert.equal(await tIn("cs", "only_en"), "English only");
		assert.equal(await tIn("cs", "neexistuje"), "neexistuje");
		assert.equal(t("greeting", "Ann", 1), "Hello Ann, you have $1");
	});

	it("getBrowserUiLanguage: jazyk prohlížeče, jen když ho rozšíření má", () => {
		const original = globalThis.chrome;
		try {
			globalThis.chrome = { i18n: { getUILanguage: () => "cs-CZ" } };
			assert.equal(getBrowserUiLanguage(), "cs");
			globalThis.chrome = { i18n: { getUILanguage: () => "pt_BR" } };
			assert.equal(getBrowserUiLanguage(), DEFAULT_UI_LANGUAGE);
		} finally {
			globalThis.chrome = original;
		}
	});
});
