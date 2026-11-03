//@ts-check
"use strict";

// sandbox-package.mjs — reading the package of an uploaded module (see the section about
// uploaded modules in base.mjs): the ZIP archive the user uploads (listZip(),
// extractZipEntry()) and the places in the source of a JS module that point to other
// files (scanModuleSource()) — the core rewrites them to the addresses of the files
// inside the sandbox, because the sandbox has no folder a relative import could point to.
//
// Only data out — no texts, no storage, no rules of what a package may contain: those
// are in base.mjs, which loads this file with import() only when it needs it (when a
// module is uploaded in Settings), so content scripts importing base.mjs never load it.

// --- ZIP ---
//
// Only what an uploaded module needs: one archive in memory (the core limits its size
// before reading it), the files stored or compressed with deflate (what every common
// tool produces), names in UTF-8. Not supported: ZIP64 (archives over 4 GB or with
// more than 65535 entries), archives split into parts and encryption. The sizes in the
// archive are only declarations — extractZipEntry() never produces more bytes than
// the declared size and checks the CRC-32, so a "zip bomb" cannot grow beyond the
// limit the core checked from the declarations.

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_END_SIZE = 22;
const ZIP_CENTRAL_SIZE = 46;
const ZIP_LOCAL_SIZE = 30;
const ZIP_MAX_COMMENT = 0xffff;

// Bit 0 of the flags: the entry is encrypted.
const ZIP_FLAG_ENCRYPTED = 0x1;

// Compression methods: stored (0) and deflate (8).
const ZIP_STORED = 0;
const ZIP_DEFLATE = 8;

/** @type {Uint32Array | null} */
let crcTable = null;

/** @type {Functions.SandboxPackage.crc32} */
export function crc32(data) {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** @type {Functions.SandboxPackage.zipProblem} */
function zipProblem(code, ...args) {
	return { ok: false, problem: { code, args: args.map(String) } };
}

// The end-of-central-directory record: at the very end of the archive, possibly followed
// by a comment of up to 64 KB — it is searched for backwards. -1 = not found.
/** @type {Functions.SandboxPackage.findZipEnd} */
function findZipEnd(view) {
	const last = view.byteLength - ZIP_END_SIZE;
	const first = Math.max(0, last - ZIP_MAX_COMMENT);
	for (let offset = last; offset >= first; offset--) {
		if (view.getUint32(offset, true) === ZIP_END_SIGNATURE && offset + ZIP_END_SIZE + view.getUint16(offset + 20, true) === view.byteLength) {
			return offset;
		}
	}
	return -1;
}

// The entries of the archive from its central directory (nothing is decompressed yet).
// Directory entries are included (directory: true) — the caller skips them. A "\" in a
// name (older Windows tools) is read as "/".
/** @type {Functions.SandboxPackage.listZip} */
export function listZip(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const end = bytes.byteLength >= ZIP_END_SIZE ? findZipEnd(view) : -1;
	if (end < 0) return zipProblem("notZip");
	const disk = view.getUint16(end + 4, true);
	const directoryDisk = view.getUint16(end + 6, true);
	const entriesOnDisk = view.getUint16(end + 8, true);
	const count = view.getUint16(end + 10, true);
	const directorySize = view.getUint32(end + 12, true);
	const directoryOffset = view.getUint32(end + 16, true);
	if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return zipProblem("zip64");
	if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== count) return zipProblem("multiDisk");
	if (directoryOffset + directorySize > end) return zipProblem("corrupt", "");

	const decoder = new TextDecoder();
	/** @type {Types.ZipEntry[]} */
	const entries = [];
	let offset = directoryOffset;
	for (let i = 0; i < count; i++) {
		if (offset + ZIP_CENTRAL_SIZE > end || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) return zipProblem("corrupt", "");
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const nameEnd = offset + ZIP_CENTRAL_SIZE + nameLength;
		if (nameEnd > end) return zipProblem("corrupt", "");
		const path = decoder.decode(bytes.subarray(offset + ZIP_CENTRAL_SIZE, nameEnd)).replace(/\\/g, "/");
		entries.push({
			path,
			directory: path.endsWith("/"),
			flags: view.getUint16(offset + 8, true),
			method: view.getUint16(offset + 10, true),
			crc: view.getUint32(offset + 16, true),
			compressedSize: view.getUint32(offset + 20, true),
			size: view.getUint32(offset + 24, true),
			localOffset: view.getUint32(offset + 42, true),
		});
		offset = nameEnd + extraLength + commentLength;
	}
	return { ok: true, entries };
}

// Decompresses deflate data into exactly `size` bytes; null = the data are damaged or
// would be larger or smaller than declared (the stream is stopped right away).
/** @type {Functions.SandboxPackage.inflate} */
async function inflate(data, size) {
	const output = new Uint8Array(size);
	let length = 0;
	const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (length + value.length > size) {
				await reader.cancel();
				return null;
			}
			output.set(value, length);
			length += value.length;
		}
	} catch {
		return null;
	}
	return length === size ? output : null;
}

// The content of one entry (from listZip()), checked against its CRC-32.
/** @type {Functions.SandboxPackage.extractZipEntry} */
export async function extractZipEntry(bytes, entry) {
	if (entry.flags & ZIP_FLAG_ENCRYPTED) return zipProblem("encrypted", entry.path);
	if (entry.method !== ZIP_STORED && entry.method !== ZIP_DEFLATE) return zipProblem("compression", entry.path, entry.method);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const header = entry.localOffset;
	if (header + ZIP_LOCAL_SIZE > bytes.byteLength || view.getUint32(header, true) !== ZIP_LOCAL_SIGNATURE) {
		return zipProblem("corrupt", entry.path);
	}
	// The name and the extra field of the local header may differ from the central directory.
	const start = header + ZIP_LOCAL_SIZE + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
	if (start + entry.compressedSize > bytes.byteLength) return zipProblem("corrupt", entry.path);
	const compressed = bytes.subarray(start, start + entry.compressedSize);

	/** @type {Uint8Array<ArrayBuffer> | null} */
	let data;
	if (entry.method === ZIP_STORED) {
		data = entry.compressedSize === entry.size ? compressed.slice() : null;
	} else {
		data = await inflate(compressed, entry.size);
	}
	if (!data) return zipProblem("corrupt", entry.path);
	if (crc32(data) !== entry.crc) return zipProblem("checksum", entry.path);
	return { ok: true, data };
}

// --- Imports of a JS module ---
//
// scanModuleSource() finds in the source of a JS module the module specifiers (the strings in
// import … from "…", export … from "…", import "…" and import("…")) and import.meta. It
// is a tokenizer, not a parser: it skips comments, strings, template literals (including
// ${…}) and regular expressions, so nothing inside them is taken for an import. Whether
// "/" starts a regular expression or divides is decided by the token before it (the usual
// heuristic; it is wrong only in rare constructs like `if (a) /x/.test(b)`, and then
// the module itself fails to load in its sandbox — nothing else).
// import() with a computed address cannot be rewritten — it is only counted (dynamic).

// Keywords after which "/" starts a regular expression, not a division.
const REGEXP_AFTER_WORDS = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"case",
	"do",
	"else",
	"yield",
	"await",
	"extends",
]);

// Punctuation after which "/" divides (the end of an expression).
const DIVISION_AFTER_PUNCTUATION = new Set([")", "]", "++", "--"]);

/** @type {Functions.SandboxPackage.isIdentifierChar} */
function isIdentifierChar(code) {
	return (
		(code >= 97 && code <= 122) || // a-z
		(code >= 65 && code <= 90) || // A-Z
		(code >= 48 && code <= 57) || // 0-9
		code === 36 || // $
		code === 95 || // _
		code === 92 || // \ (a Unicode escape in a name)
		code > 127
	);
}

/** @type {Functions.SandboxPackage.isWhitespace} */
function isWhitespace(code) {
	return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12 || code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029;
}

/** @type {Functions.SandboxPackage.scanModuleSource} */
export function scanModuleSource(source) {
	/** @type {Types.ModuleSourceImport[]} */
	const imports = [];
	/** @type {Types.SourceRange[]} */
	const metas = [];
	let dynamic = 0;
	const length = source.length;

	// The last token that is not whitespace or a comment: its kind and text.
	/** @type {"punctuation" | "word" | "value" | null} */
	let lastKind = null;
	let lastText = "";
	// Brace depths at which a template literal continues after ${…}.
	/** @type {number[]} */
	const templates = [];
	let braces = 0;
	// After import/export: the next `from "…"` holds a specifier.
	let expectFrom = false;

	/** @type {(position: number) => number} */
	const skipTrivia = (position) => {
		let p = position;
		while (p < length) {
			const code = source.charCodeAt(p);
			if (isWhitespace(code)) {
				p++;
			} else if (code === 47 && source.charCodeAt(p + 1) === 47) {
				const end = source.indexOf("\n", p);
				p = end === -1 ? length : end;
			} else if (code === 47 && source.charCodeAt(p + 1) === 42) {
				const end = source.indexOf("*/", p + 2);
				p = end === -1 ? length : end + 2;
			} else {
				break;
			}
		}
		return p;
	};
	// position at the opening quote → the position after the closing one
	/** @type {(position: number) => number} */
	const skipString = (position) => {
		const quote = source.charCodeAt(position);
		let p = position + 1;
		while (p < length) {
			const code = source.charCodeAt(p);
			if (code === 92) {
				p += 2;
			} else if (code === quote) {
				return p + 1;
			} else if (code === 10) {
				return p;
			} else {
				p++;
			}
		}
		return length;
	};
	/** @type {(position: number) => number} */
	const skipWord = (position) => {
		let p = position;
		while (p < length && isIdentifierChar(source.charCodeAt(p))) p++;
		return p;
	};
	/** @type {(position: number) => boolean} */
	const isQuote = (position) => {
		const code = source.charCodeAt(position);
		return code === 34 || code === 39;
	};
	/** @type {(start: number, dynamicImport: boolean) => number} */
	const addSpecifier = (start, dynamicImport) => {
		const end = skipString(start);
		imports.push({ start, end, specifier: source.slice(start + 1, end - 1), dynamic: dynamicImport });
		return end;
	};
	// The rest of a template literal from position (after ` or after the } of ${…}) —
	// returns where the scanning continues: after the closing `, or after ${.
	/** @type {(position: number) => number} */
	const scanTemplate = (position) => {
		let p = position;
		while (p < length) {
			const code = source.charCodeAt(p);
			if (code === 92) {
				p += 2;
			} else if (code === 96) {
				lastKind = "value";
				lastText = "`";
				return p + 1;
			} else if (code === 36 && source.charCodeAt(p + 1) === 123) {
				templates.push(braces);
				lastKind = "punctuation";
				lastText = "${";
				return p + 2;
			} else {
				p++;
			}
		}
		return length;
	};

	let i = 0;
	if (source.startsWith("#!")) {
		const end = source.indexOf("\n");
		i = end === -1 ? length : end;
	}
	while (i < length) {
		i = skipTrivia(i);
		if (i >= length) break;
		const code = source.charCodeAt(i);

		if (code === 34 || code === 39) {
			i = skipString(i);
			lastKind = "value";
			lastText = '"';
			continue;
		}
		if (code === 96) {
			i = scanTemplate(i + 1);
			continue;
		}
		if (isIdentifierChar(code) && !(code >= 48 && code <= 57)) {
			const end = skipWord(i);
			const word = source.slice(i, end);
			// A property (a.import, a?.from, this.#export) is never a keyword.
			const member = lastText === "." || lastText === "#";
			if (!member && word === "import") {
				const next = skipTrivia(end);
				const nextCode = source.charCodeAt(next);
				if (nextCode === 40) {
					// import("…") — only a plain string as the whole first argument can be rewritten.
					const argument = skipTrivia(next + 1);
					if (isQuote(argument)) {
						const after = skipTrivia(skipString(argument));
						if (source[after] === ")" || source[after] === ",") {
							addSpecifier(argument, true);
						} else {
							dynamic++;
						}
					} else {
						dynamic++;
					}
				} else if (nextCode === 46) {
					const property = skipTrivia(next + 1);
					const propertyEnd = skipWord(property);
					if (source.slice(property, propertyEnd) === "meta") {
						metas.push({ start: i, end: propertyEnd });
						i = propertyEnd;
						lastKind = "value";
						lastText = "meta";
						continue;
					}
				} else if (isQuote(next)) {
					// import "…" (only for its side effects)
					i = addSpecifier(next, false);
					lastKind = "value";
					lastText = '"';
					continue;
				} else if (nextCode === 123 || nextCode === 42 || isIdentifierChar(nextCode)) {
					expectFrom = true;
				}
			} else if (!member && word === "export") {
				const nextCode = source.charCodeAt(skipTrivia(end));
				if (nextCode === 123 || nextCode === 42) expectFrom = true;
			} else if (!member && word === "from" && expectFrom) {
				const next = skipTrivia(end);
				if (isQuote(next)) {
					i = addSpecifier(next, false);
					expectFrom = false;
					lastKind = "value";
					lastText = '"';
					continue;
				}
			}
			i = end;
			lastKind = member ? "value" : "word";
			lastText = word;
			continue;
		}
		if ((code >= 48 && code <= 57) || (code === 46 && source.charCodeAt(i + 1) >= 48 && source.charCodeAt(i + 1) <= 57)) {
			let p = i + 1;
			while (p < length && (isIdentifierChar(source.charCodeAt(p)) || source.charCodeAt(p) === 46)) p++;
			i = p;
			lastKind = "value";
			lastText = "0";
			continue;
		}
		if (code === 47) {
			const regexp =
				lastKind === null ||
				(lastKind === "punctuation" && !DIVISION_AFTER_PUNCTUATION.has(lastText)) ||
				(lastKind === "word" && REGEXP_AFTER_WORDS.has(lastText));
			if (regexp) {
				let p = i + 1;
				let inClass = false;
				while (p < length) {
					const c = source.charCodeAt(p);
					if (c === 92) {
						p += 2;
						continue;
					}
					if (c === 10) break;
					if (c === 91) inClass = true;
					else if (c === 93) inClass = false;
					else if (c === 47 && !inClass) {
						p++;
						break;
					}
					p++;
				}
				i = skipWord(p);
				lastKind = "value";
				lastText = "/";
				continue;
			}
		}

		// Punctuation (one character; ++ and -- together, they decide about a following "/").
		let text = source[i];
		if ((text === "+" || text === "-") && source[i + 1] === text) text += text;
		i += text.length;
		if (text === "{") {
			braces++;
		} else if (text === "}") {
			if (templates.length > 0 && templates[templates.length - 1] === braces) {
				templates.pop();
				i = scanTemplate(i);
				continue;
			}
			braces--;
		}
		if (expectFrom && text !== "{" && text !== "}" && text !== "," && text !== "*") expectFrom = false;
		lastKind = "punctuation";
		lastText = text;
	}

	return { imports, metas, dynamic };
}
