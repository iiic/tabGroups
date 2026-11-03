// scripts/validate.mjs — kontroly projektu, které nepokryje linter ani testy:
//   - JSON soubory jdou přečíst,
//   - verze v package.json a manifest.json je stejná,
//   - soubory, na které odkazuje manifest, HTML stránky, importy a
//     modules.json (i soubory nahraných modulů, které rozšíření přináší),
//     existují a jsou v balíčku npm (package.json → files),
//   - překlady (_locales jádra a modulů, messages.json nahraných modulů):
//     stejné klíče ve všech jazycích, stejné $1…$9, tvary množného čísla pro
//     každý jazyk, jazyky = UI_LANGUAGES v i18n.mjs,
//   - klíče textů použité v kódu, HTML a manifestu existují.
// Spouští `npm run validate`; skončí kódem 1, když najde chybu.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {string[]} */
const errors = [];

/** @param {string} path cesta od kořene projektu */
const toPosix = (path) => path.replace(/\\/g, "/");

/** @param {string} path */
function readJson(path) {
	try {
		return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
	} catch (err) {
		errors.push(`${path}: neplatný JSON — ${/** @type {Error} */ (err).message}`);
		return undefined;
	}
}

/** Soubory v gitu (bez smazaných) — kód projektu, ne node_modules. */
function trackedFiles() {
	const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
	return out.split("\n").filter((file) => file && existsSync(join(ROOT, file)));
}

/** Soubory, které by šly do balíčku npm. */
function packedFiles() {
	const out = execSync("npm pack --dry-run --json --ignore-scripts", { cwd: ROOT, encoding: "utf8" });
	return new Set(JSON.parse(out)[0].files.map((/** @type {{ path: string }} */ file) => toPosix(file.path)));
}

// Odkazy mezi soubory: "soubor s odkazem\0cesta od kořene" (každý jen jednou).
/** @type {Set<string>} */
const references = new Set();

/**
 * @param {string} from soubor, ve kterém odkaz je
 * @param {string} target odkaz relativně k souboru (./x, ../x), nebo od kořene rozšíření (/x)
 */
function addReference(from, target) {
	if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return;
	const clean = target.split(/[?#]/)[0];
	const path = clean.startsWith("/") ? clean.slice(1) : join(dirname(from), clean);
	references.add(`${from}\0${toPosix(normalize(path))}`);
}

// Řádky kódu bez řádků s komentářem — příklady v komentářích nejsou použití.
/** @param {string} source */
const codeLines = (source) =>
	source
		.split("\n")
		.filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
		.join("\n");

// Bez obsahu jednořádkových `šablon` — v textech chybových hlášek bývají
// ukázkové cesty (new URL("./soubor.css", ...)), které nejsou odkazy.
/** @param {string} source */
const withoutTemplates = (source) => source.replace(/`[^`\n]*`/g, "``");

// --- package.json a manifest.json ---------------------------------------
const pkg = readJson("package.json");
const manifest = readJson("manifest.json");

if (pkg && manifest) {
	if (pkg.version !== manifest.version) {
		errors.push(`verze se liší: package.json ${pkg.version}, manifest.json ${manifest.version} — zvedni obě najednou`);
	}
	if (!/^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){0,3}$/.test(manifest.version)) {
		errors.push(`manifest.json: verze "${manifest.version}" musí být 1–4 čísla oddělená tečkou (bez -beta apod.)`);
	}
}

if (manifest) {
	/** @type {string[]} */
	const files = [
		...Object.values(manifest.icons || {}),
		manifest.action?.default_popup,
		...(typeof manifest.action?.default_icon === "string" ? [manifest.action.default_icon] : Object.values(manifest.action?.default_icon || {})),
		manifest.options_page,
		manifest.options_ui?.page,
		manifest.sidebar_action?.default_panel,
		...(typeof manifest.sidebar_action?.default_icon === "string"
			? [manifest.sidebar_action.default_icon]
			: Object.values(manifest.sidebar_action?.default_icon || {})),
		manifest.side_panel?.default_path,
		...(manifest.background?.scripts || []),
		manifest.background?.service_worker,
		manifest.background?.page,
		...(manifest.content_scripts || []).flatMap((/** @type {{ js?: string[], css?: string[] }} */ script) => [...(script.js || []), ...(script.css || [])]),
	].filter((file) => typeof file === "string");
	for (const file of files) addReference("manifest.json", `/${file}`);
	if (manifest.default_locale) addReference("manifest.json", `/_locales/${manifest.default_locale}/messages.json`);
}

// --- Odkazy v HTML a JS ----------------------------------------------------
const tracked = trackedFiles();
const isProjectTool = (/** @type {string} */ file) => /^(scripts|test|\.github)\//.test(file) || file === "eslint.config.js";

for (const file of tracked.filter((file) => file.endsWith(".html"))) {
	const source = readFileSync(join(ROOT, file), "utf8");
	for (const match of source.matchAll(/<(?:script|img|iframe)\b[^>]*\ssrc="([^"]+)"|<link\b[^>]*\shref="([^"]+)"/g)) {
		addReference(file, match[1] ?? match[2]);
	}
}

for (const file of tracked.filter((file) => /\.m?js$/.test(file) && !isProjectTool(file))) {
	const source = withoutTemplates(codeLines(readFileSync(join(ROOT, file), "utf8")));
	const patterns = [
		/\bimport\s+(?:[^"'`;]*?\sfrom\s+)?["']([^"']+)["']/g,
		/\bexport\s+[^"'`;]*?\sfrom\s+["']([^"']+)["']/g,
		/\bimport\(\s*["']([^"']+)["']\s*\)/g,
		/\bnew URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			if (match[1].startsWith(".") || match[1].startsWith("/")) addReference(file, match[1]);
		}
	}
}

// Nahraný modul, který rozšíření přináší (položka sandbox://<modul>/…): jádro ho instaluje ze souborů, které pro něj
// uvádí BUNDLED_SANDBOX_MODULES v base.mjs (složka BUNDLED_SANDBOX_DIR/<modul>/).
const { BUNDLED_SANDBOX_DIR, BUNDLED_SANDBOX_MODULES, SANDBOX_ENTRY_PREFIX } = await import("../base.mjs");
const modulesList = readJson("modules.json");
if (modulesList !== undefined) {
	if (!Array.isArray(modulesList) || modulesList.some((entry) => typeof entry !== "string")) {
		errors.push("modules.json: musí být pole cest k modulům (řetězců)");
	} else {
		for (const entry of modulesList) {
			if (!entry.startsWith(SANDBOX_ENTRY_PREFIX)) {
				addReference("modules.json", `/${entry.split("#")[0]}`);
				continue;
			}
			const name = entry.slice(SANDBOX_ENTRY_PREFIX.length).split("/")[0];
			const files = Object.hasOwn(BUNDLED_SANDBOX_MODULES, name) ? BUNDLED_SANDBOX_MODULES[name] : null;
			if (!files) errors.push(`modules.json: ${entry} — modul ${name} není v BUNDLED_SANDBOX_MODULES (base.mjs)`);
			for (const file of files || []) addReference("modules.json", `/${BUNDLED_SANDBOX_DIR}/${name}/${file}`);
		}
	}
}

const defaultSettings = readJson("default-settings.json");
if (defaultSettings !== undefined && (typeof defaultSettings !== "object" || defaultSettings === null || Array.isArray(defaultSettings))) {
	errors.push("default-settings.json: musí být objekt");
}

const packed = packedFiles();
for (const reference of references) {
	const [from, to] = reference.split("\0");
	if (!existsSync(join(ROOT, to))) {
		errors.push(`${from}: odkazuje na neexistující soubor ${to}`);
	} else if (!packed.has(to)) {
		errors.push(`${from}: soubor ${to} chybí v balíčku npm — doplň ho do "files" v package.json`);
	}
}

// --- Překlady ----------------------------------------------------------------
// Texty jádra (_locales/<jazyk>/messages.json), modulů (modules/<modul>/_locales/<jazyk>/messages.json — i18n.mjs je
// načte po addModuleI18n()) a nahraných modulů, které rozšíření přináší (sandbox-modules/<modul>/messages.json,
// { jazyk: { klíč: text } }).
const LOCALES_DIR = "_locales";
const defaultLocale = manifest?.default_locale || "en";
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** @type {Map<string, string>} klíč malými písmeny → klíč, jak je zapsaný (přednost má výchozí jazyk) */
const keyNames = new Map();
/** @param {string} id */
const keyName = (id) => keyNames.get(id) ?? id;

/** Podsložky složky (bez souborů); žádné, když složka není. @param {string} dir */
const subdirs = (dir) =>
	existsSync(join(ROOT, dir))
		? readdirSync(join(ROOT, dir), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
		: [];

/**
 * Texty jednoho souboru v jednom jazyce: klíč malými písmeny → text.
 * @param {string} where @param {unknown} json @param {boolean} plain text přímo (nahraný modul), jinak { message }
 * @param {string} locale
 */
function readMessages(where, json, plain, locale) {
	/** @type {Record<string, string>} */
	const table = {};
	if (!json || typeof json !== "object" || Array.isArray(json)) {
		errors.push(`${where}: texty musí být objekt`);
		return table;
	}
	for (const [key, entry] of Object.entries(json)) {
		if (!/^[A-Za-z0-9_@]+$/.test(key)) errors.push(`${where}: klíč "${key}" smí obsahovat jen A–Z, a–z, 0–9, _ a @`);
		if (key.startsWith("@@")) errors.push(`${where}: klíč "${key}" je vyhrazený prohlížeči`);
		const message = plain ? entry : entry?.message;
		if (typeof message !== "string") {
			errors.push(`${where}: "${key}" nemá text${plain ? "" : " (message)"}`);
			continue;
		}
		const id = key.toLowerCase();
		if (id in table) errors.push(`${where}: klíč "${key}" je tam dvakrát (bez ohledu na velikost písmen)`);
		table[id] = message;
		if (!keyNames.has(id) || locale === defaultLocale) keyNames.set(id, key);
	}
	return table;
}

/** Zdroje textů: odkud (složka) → jazyk → texty, a kde je text jazyka. */
/** @type {{ dir: string, tables: Record<string, Record<string, string>>, where: (locale: string) => string }[]} */
const sources = [];
for (const dir of [LOCALES_DIR, ...subdirs("modules").map((module) => `modules/${module}/${LOCALES_DIR}`)]) {
	if (!existsSync(join(ROOT, dir))) continue;
	const where = (/** @type {string} */ locale) => `${dir}/${locale}/messages.json`;
	/** @type {Record<string, Record<string, string>>} */
	const tables = {};
	for (const locale of subdirs(dir)) {
		const json = readJson(where(locale));
		if (json) tables[locale] = readMessages(where(locale), json, false, locale);
	}
	sources.push({ dir, tables, where });
}
for (const module of subdirs("sandbox-modules")) {
	const path = `sandbox-modules/${module}/messages.json`;
	if (!existsSync(join(ROOT, path))) continue;
	const where = (/** @type {string} */ locale) => `${path} (${locale})`;
	const json = readJson(path) ?? {};
	/** @type {Record<string, Record<string, string>>} */
	const tables = {};
	for (const [locale, table] of Object.entries(json)) tables[locale] = readMessages(where(locale), table, true, locale);
	sources.push({ dir: `sandbox-modules/${module}`, tables, where });
}

const coreSource = sources[0];
const coreLocales = Object.keys(coreSource?.tables ?? {}).sort();
/** @param {string} message */
const placeholders = (message) => [...new Set(message.match(/\$[1-9]/g) || [])].sort().join(", ") || "žádné";

for (const { dir, tables, where } of sources) {
	const base = tables[defaultLocale];
	if (!base) {
		errors.push(`chybí výchozí jazyk ${where(defaultLocale)}`);
		continue;
	}
	const locales = Object.keys(tables).sort();
	if (dir !== LOCALES_DIR && locales.join() !== coreLocales.join()) {
		errors.push(`${dir}: jazyky ${locales.join(", ")} místo ${coreLocales.join(", ")} (jako ${LOCALES_DIR} jádra)`);
	}
	// Množné číslo (tp() v i18n.mjs): klíč <x>_other, ke kterému má výchozí jazyk i jiný tvar (<x>_one, …) — samotný
	// klíč končící na _other je obyčejný text.
	const pluralBases = Object.keys(base)
		.filter((key) => key.endsWith("_other"))
		.map((key) => key.slice(0, -"_other".length))
		.filter((stem) => Object.keys(base).some((key) => key !== `${stem}_other` && PLURAL_SUFFIX.test(key) && key.replace(PLURAL_SUFFIX, "") === stem));
	for (const locale of locales) {
		const own = tables[locale];
		for (const key of Object.keys(base)) {
			if (!(key in own)) {
				errors.push(`${where(locale)}: chybí klíč "${keyName(key)}"`);
			} else if (placeholders(base[key]) !== placeholders(own[key])) {
				errors.push(`${where(locale)}: "${keyName(key)}" má jiné proměnné než ${defaultLocale} (${placeholders(own[key])} místo ${placeholders(base[key])})`);
			}
		}
		for (const key of Object.keys(own)) {
			if (key in base) continue;
			const pluralBase = key.replace(PLURAL_SUFFIX, "");
			if (pluralBase === key || !pluralBases.includes(pluralBase)) {
				errors.push(`${where(locale)}: klíč "${keyName(key)}" není ve výchozím jazyce ${defaultLocale}`);
			}
		}
		// Tvary množného čísla, které jazyk u celých čísel používá.
		const rules = new Intl.PluralRules(locale);
		const categories = new Set(Array.from({ length: 1001 }, (_, n) => rules.select(n)));
		for (const pluralBase of pluralBases) {
			for (const category of categories) {
				if (!(`${pluralBase}_${category}` in own)) {
					errors.push(`${where(locale)}: chybí tvar množného čísla "${keyName(`${pluralBase}_other`).replace(/other$/, category)}"`);
				}
			}
		}
	}
}

// Klíče použité v kódu, HTML a manifestu (jen zapsané přímo jako text — klíče skládané za běhu se tady ověřit nedají).
// Kód modulu má texty jádra a své (modules/<modul>/_locales), nahraný modul své (messages.json) a jádra, jádro i texty
// modulů.
/** @param {string} dir */
const defaultTable = (dir) => sources.find((source) => source.dir === dir)?.tables[defaultLocale] ?? {};
const moduleTables = sources.filter((source) => source.dir.startsWith("modules/")).map((source) => source.tables[defaultLocale] ?? {});
/** @param {string} file @returns {Record<string, string>[]} */
function tablesFor(file) {
	const core = defaultTable(LOCALES_DIR);
	const module = /^(sandbox-)?modules\/([^/]+)\//.exec(file);
	if (!module) return [core, ...moduleTables];
	return [core, defaultTable(module[1] ? `sandbox-modules/${module[2]}` : `modules/${module[2]}/${LOCALES_DIR}`)];
}

/** @type {[file: string, key: string][]} */
const used = [];
for (const file of tracked.filter((file) => /\.(m?js|html)$/.test(file) && !isProjectTool(file))) {
	const raw = readFileSync(join(ROOT, file), "utf8");
	const source = file.endsWith(".html") ? raw : codeLines(raw);
	for (const match of source.matchAll(/\bt\(\s*["']([A-Za-z0-9_@]+)["']/g)) used.push([file, match[1]]);
	for (const match of source.matchAll(/\btp\(\s*["']([A-Za-z0-9_@]+)["']/g)) used.push([file, `${match[1]}_other`]);
	for (const match of source.matchAll(/\btIn\(\s*[^,()]+,\s*["']([A-Za-z0-9_@]+)["']/g)) used.push([file, match[1]]);
	for (const match of source.matchAll(/\bdata-i18n(?:-[a-z-]+)?=["']([^"']+)["']/g)) used.push([file, match[1]]);
}
for (const match of JSON.stringify(manifest || {}).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) used.push([`manifest.json`, match[1]]);
for (const [file, key] of used) {
	const tables = file === "manifest.json" ? [defaultTable(LOCALES_DIR)] : tablesFor(file);
	if (!tables.some((table) => key.toLowerCase() in table)) {
		const where = tables.length === 2 && file.includes("/") ? ` ani v textech modulu` : "";
		errors.push(`${file}: text "${key}" není v ${LOCALES_DIR}/${defaultLocale}/messages.json${where}`);
	}
}

// Jazyky v nabídce rozhraní = složky _locales.
const { UI_LANGUAGES } = await import("../i18n.mjs");
const offered = UI_LANGUAGES.map((/** @type {{ value: string }} */ option) => option.value).sort();
if (offered.join() !== coreLocales.join()) {
	errors.push(`UI_LANGUAGES v i18n.mjs (${offered.join(", ")}) neodpovídá složkám ${LOCALES_DIR} (${coreLocales.join(", ")})`);
}

// --- Výsledek ----------------------------------------------------------------
if (errors.length > 0) {
	for (const error of errors) console.error(`chyba: ${error}`);
	const noun = { one: "chyba", few: "chyby" }[new Intl.PluralRules("cs").select(errors.length)] ?? "chyb";
	console.error(`\nValidace selhala: ${errors.length} ${noun}.`);
	process.exit(1);
}
console.log(`Validace v pořádku (${references.size} odkazů na soubory, ${coreLocales.length} jazyků, ${sources.length} zdrojů textů).`);
