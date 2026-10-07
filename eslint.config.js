// ESLint — kontrola chyb v JS (ne formátování: styl kódu se v souborech liší
// a sjednocovat ho tady není cílem). Spouští `npm run lint:js`.
import js from "@eslint/js";
import globals from "globals";

export default [
	{
		ignores: ["node_modules/", "web-ext-artifacts/", "coverage/"],
	},
	js.configs.recommended,
	{
		// Kód rozšíření — běží v prohlížeči (stránky, background).
		files: ["**/*.js", "**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			globals: {
				...globals.browser,
				...globals.webextensions,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: "error",
		},
		rules: {
			"no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
		},
	},
	{
		// Nástroje a testy — běží v Node.
		files: ["eslint.config.js", "scripts/**", "test/**"],
		languageOptions: {
			globals: globals.node,
		},
	},
];
