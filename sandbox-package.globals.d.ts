/**
 * @file sandbox-package.globals.d.ts
 * @description Global TypeScript declarations for sandbox-package.mjs — reading the package of an uploaded module:
 * the ZIP archive and the module specifiers and import.meta in the source of a JS module.
 */

declare global {

	namespace Enums {

		/** What is wrong with a ZIP archive — base.mjs turns it into a text. */
		type ZipProblemCode =
			| 'notZip'
			| 'zip64'
			| 'multiDisk'
			| 'corrupt'
			| 'encrypted'
			| 'compression'
			| 'checksum';

	}

	namespace Types {

		/** A problem of a ZIP archive: its code and the values for the text (the path of the entry, …). */
		type ZipProblem = { code: Enums.ZipProblemCode; args: string[] };

		/** A failed step of reading an archive. */
		type ZipFailure = { ok: false; problem: ZipProblem };

		/** One entry of the central directory of a ZIP archive (nothing decompressed yet). */
		type ZipEntry = {

			/** Path in the archive ("/" as the separator, also for names written with "\") */
			path: string;

			/** A directory entry (the path ends with "/") */
			directory: boolean;
			flags: number;

			/** 0 = stored, 8 = deflate */
			method: number;
			crc: number;
			compressedSize: number;

			/** Declared size after decompression */
			size: number;

			/** Where its local header starts */
			localOffset: number;
		};

		/** listZip(): the entries of the archive, or what is wrong with it. */
		type ZipListing = { ok: true; entries: ZipEntry[] } | ZipFailure;

		/** extractZipEntry(): the content of the entry, or what is wrong with it. */
		type ZipExtraction = { ok: true; data: Uint8Array<ArrayBuffer> } | ZipFailure;

		/** A part of a source text: [start, end) in UTF-16 code units. */
		type SourceRange = { start: number; end: number };

		/** A module specifier in the source: the string literal with its quotes, and its content. */
		type ModuleSourceImport = SourceRange & {
			specifier: string;

			/** import("…") rather than a static import/export */
			dynamic: boolean;
		};

		/** scanModuleSource(): the specifiers, import.meta and the number of import() with a computed address. */
		type ModuleSourceScan = { imports: ModuleSourceImport[]; metas: SourceRange[]; dynamic: number };

	}

	namespace Functions {

		namespace SandboxPackage {

			/** CRC-32 (as in ZIP) */
			type crc32 = ( data: Uint8Array ) => number;

			/** A failed step of reading an archive */
			type zipProblem = ( code: Enums.ZipProblemCode, ...args: unknown[] ) => Types.ZipFailure;

			/** Offset of the end-of-central-directory record; -1 = not found */
			type findZipEnd = ( view: DataView ) => number;

			/** The entries of a ZIP archive from its central directory */
			type listZip = ( bytes: Uint8Array<ArrayBuffer> ) => Types.ZipListing;

			/** Decompresses deflate data into exactly the declared size; null = damaged or of a different size */
			type inflate = ( data: Uint8Array<ArrayBuffer>, size: number ) => Promise<Uint8Array<ArrayBuffer> | null>;

			/** The content of one entry, checked against its CRC-32 */
			type extractZipEntry = ( bytes: Uint8Array<ArrayBuffer>, entry: Types.ZipEntry ) => Promise<Types.ZipExtraction>;

			/** A character of a JS identifier (or a non-ASCII one, or "\" of an escape)? */
			type isIdentifierChar = ( code: number ) => boolean;

			/** JS whitespace (including line ends)? */
			type isWhitespace = ( code: number ) => boolean;

			/** The module specifiers and import.meta in the source of a JS module */
			type scanModuleSource = ( source: string ) => Types.ModuleSourceScan;

		}

	}

}

export { };
