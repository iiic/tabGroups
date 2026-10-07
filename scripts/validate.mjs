// scripts/validate.mjs — kontroly projektu, které nepokryje linter ani testy:
//   - JSON soubory jdou přečíst,
//   - verze v package.json a manifest.json je stejná,
//   - soubory, na které odkazuje manifest, HTML stránky, importy a
//     modules.json, existují a jsou v balíčku npm (package.json → files),
//   - překlady (_locales): stejné klíče ve všech jazycích, stejné $1…$9,
//     tvary množného čísla pro každý jazyk, jazyky = UI_LANGUAGES v i18n.mjs,
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

const modulesList = readJson("modules.json");
if (modulesList !== undefined) {
	if (!Array.isArray(modulesList) || modulesList.some((entry) => typeof entry !== "string")) {
		errors.push("modules.json: musí být pole cest k modulům (řetězců)");
	} else {
		for (const entry of modulesList) addReference("modules.json", `/${entry.split("#")[0]}`);
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
const LOCALES_DIR = "_locales";
const defaultLocale = manifest?.default_locale || "en";
const locales = readdirSync(join(ROOT, LOCALES_DIR), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

/** @type {Record<string, Record<string, string>>} jazyk → klíč malými písmeny → text */
const messages = {};
/** @type {Map<string, string>} klíč malými písmeny → klíč, jak je zapsaný (přednost má výchozí jazyk) */
const keyNames = new Map();
/** @param {string} id */
const keyName = (id) => keyNames.get(id) ?? id;
for (const locale of locales) {
	const path = `${LOCALES_DIR}/${locale}/messages.json`;
	const json = readJson(path);
	if (!json) continue;
	messages[locale] = {};
	for (const [key, entry] of Object.entries(json)) {
		if (!/^[A-Za-z0-9_@]+$/.test(key)) errors.push(`${path}: klíč "${key}" smí obsahovat jen A–Z, a–z, 0–9, _ a @`);
		if (key.startsWith("@@")) errors.push(`${path}: klíč "${key}" je vyhrazený prohlížeči`);
		if (!entry || typeof entry.message !== "string") {
			errors.push(`${path}: "${key}" nemá text (message)`);
			continue;
		}
		const id = key.toLowerCase();
		if (id in messages[locale]) errors.push(`${path}: klíč "${key}" je tam dvakrát (bez ohledu na velikost písmen)`);
		messages[locale][id] = entry.message;
		if (!keyNames.has(id) || locale === defaultLocale) keyNames.set(id, key);
	}
}

const base = messages[defaultLocale];
if (!base) {
	errors.push(`chybí výchozí jazyk ${LOCALES_DIR}/${defaultLocale}/messages.json`);
} else {
	const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
	const pluralBases = Object.keys(base)
		.filter((key) => key.endsWith("_other"))
		.map((key) => key.slice(0, -"_other".length));
	/** @param {string} message */
	const placeholders = (message) => [...new Set(message.match(/\$[1-9]/g) || [])].sort().join(", ") || "žádné";

	for (const locale of locales) {
		const own = messages[locale];
		if (!own) continue;
		const path = `${LOCALES_DIR}/${locale}/messages.json`;
		for (const key of Object.keys(base)) {
			if (!(key in own)) {
				errors.push(`${path}: chybí klíč "${keyName(key)}"`);
			} else if (placeholders(base[key]) !== placeholders(own[key])) {
				errors.push(`${path}: "${keyName(key)}" má jiné proměnné než ${defaultLocale} (${placeholders(own[key])} místo ${placeholders(base[key])})`);
			}
		}
		for (const key of Object.keys(own)) {
			if (key in base) continue;
			const pluralBase = key.replace(PLURAL_SUFFIX, "");
			if (pluralBase === key || !pluralBases.includes(pluralBase)) {
				errors.push(`${path}: klíč "${keyName(key)}" není ve výchozím jazyce ${defaultLocale}`);
			}
		}
		// Tvary množného čísla, které jazyk u celých čísel používá (tp() v i18n.mjs).
		const rules = new Intl.PluralRules(locale);
		const categories = new Set(Array.from({ length: 1001 }, (_, n) => rules.select(n)));
		for (const pluralBase of pluralBases) {
			for (const category of categories) {
				if (!(`${pluralBase}_${category}` in own)) {
					errors.push(`${path}: chybí tvar množného čísla "${keyName(`${pluralBase}_other`).replace(/other$/, category)}"`);
				}
			}
		}
	}

	// Klíče použité v kódu, HTML a manifestu (jen zapsané přímo jako text —
	// klíče skládané za běhu se tady ověřit nedají).
	/** @type {Map<string, string>} klíč → kde je použitý */
	const used = new Map();
	for (const file of tracked.filter((file) => /\.(m?js|html)$/.test(file) && !isProjectTool(file))) {
		const raw = readFileSync(join(ROOT, file), "utf8");
		const source = file.endsWith(".html") ? raw : codeLines(raw);
		for (const match of source.matchAll(/\bt\(\s*["']([A-Za-z0-9_@]+)["']/g)) used.set(match[1], file);
		for (const match of source.matchAll(/\btp\(\s*["']([A-Za-z0-9_@]+)["']/g)) used.set(`${match[1]}_other`, file);
		for (const match of source.matchAll(/\btIn\(\s*[^,()]+,\s*["']([A-Za-z0-9_@]+)["']/g)) used.set(match[1], file);
		for (const match of source.matchAll(/\bdata-i18n(?:-[a-z-]+)?=["']([^"']+)["']/g)) used.set(match[1], file);
	}
	for (const match of JSON.stringify(manifest || {}).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) used.set(match[1], "manifest.json");
	for (const [key, file] of used) {
		if (!(key.toLowerCase() in base)) errors.push(`${file}: text "${key}" není v ${LOCALES_DIR}/${defaultLocale}/messages.json`);
	}

	// Jazyky v nabídce rozhraní = složky _locales.
	const { UI_LANGUAGES } = await import("../i18n.mjs");
	const offered = UI_LANGUAGES.map((/** @type {{ value: string }} */ option) => option.value).sort();
	const present = [...locales].sort();
	if (offered.join() !== present.join()) {
		errors.push(`UI_LANGUAGES v i18n.mjs (${offered.join(", ")}) neodpovídá složkám ${LOCALES_DIR} (${present.join(", ")})`);
	}
}

// --- Výsledek ----------------------------------------------------------------
if (errors.length > 0) {
	for (const error of errors) console.error(`chyba: ${error}`);
	const noun = { one: "chyba", few: "chyby" }[new Intl.PluralRules("cs").select(errors.length)] ?? "chyb";
	console.error(`\nValidace selhala: ${errors.length} ${noun}.`);
	process.exit(1);
}
console.log(`Validace v pořádku (${references.size} odkazů na soubory, ${locales.length} jazyků).`);
