/**
 * @file sdk.globals.d.ts
 * @description Global TypeScript declarations for sdk.mjs — the public API for modules and their content scripts
 * (a selection of exports from base.mjs).
 */

declare global {

	namespace Types {

		/**
		 * Namespace of the sdk.mjs module. A content script (a classic script without a static import) loads the SDK
		 * dynamically — casting the result of `await import(chrome.runtime.getURL("sdk.mjs"))` to this type
		 * (JSDoc @type) gives it full types of all exports.
		 */
		type Sdk = typeof import( './sdk.mjs' );

	}

}

export { };
