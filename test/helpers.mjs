// Pomocníci testů — rozšíření běží v prohlížeči, testy v Node bez chrome.*.

import { readFileSync } from "node:fs";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Číslo dne jako localDay() v buckets.mjs; měsíc 1–12. */
export function day(year, month, date) {
	return Date.UTC(year, month - 1, date) / DAY_MS;
}

/** Čas (ms) v poledne dne day — pro lastAccessed karet. */
export function noonOf(dayNumber) {
	return dayNumber * DAY_MS + DAY_MS / 2;
}

/** Den času ms podle UTC (testy nezávisí na časovém pásmu počítače). */
export function utcDayOf(ms) {
	return Math.floor(ms / DAY_MS);
}

/** @param {string} language */
function readLocaleFile(language) {
	try {
		return JSON.parse(readFileSync(new URL(`../_locales/${language}/messages.json`, import.meta.url), "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * Napodobí chrome.runtime.getURL() a fetch() souborů _locales, ať jde v Node
 * zavolat loadI18n()/tIn() z i18n.mjs. Výchozí jsou skutečné soubory
 * projektu, read(language) může vrátit vlastní obsah messages.json.
 * @param {(language: string) => object | undefined} [read]
 */
export function mockLocales(read = readLocaleFile) {
	globalThis.chrome = { runtime: { getURL: (path) => `test-extension://id/${path}` } };
	globalThis.fetch = async (url) => {
		const match = /^test-extension:\/\/id\/_locales\/([^/]+)\/messages\.json$/.exec(String(url));
		const data = match ? read(match[1]) : undefined;
		return data
			? { ok: true, status: 200, json: async () => data }
			: { ok: false, status: 404, json: async () => ({}) };
	};
}
