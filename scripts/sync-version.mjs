// scripts/sync-version.mjs — přepíše verzi v manifest.json na verzi
// z package.json. Spouští ho `npm version patch|minor|major` (skript
// "version" v package.json), takže se obě verze zvednou jedním příkazem.

import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const manifestUrl = new URL("../manifest.json", import.meta.url);
const source = readFileSync(manifestUrl, "utf8");

// Jen hodnota "version" — formátování souboru zůstane, jak je.
const updated = source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${pkg.version}$2`);
if (JSON.parse(updated).version !== pkg.version) {
	console.error("manifest.json: verzi se nepodařilo přepsat");
	process.exit(1);
}
writeFileSync(manifestUrl, updated);
console.log(`manifest.json: verze ${pkg.version}`);
