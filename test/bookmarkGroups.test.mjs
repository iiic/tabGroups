import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { loadI18n } from "../i18n.mjs";
import { GROUP_COLORS } from "../modules/tabGroups/buckets.mjs";
import {
	bookmarkGroupTitle,
	collectBookmarkUrls,
	createBookmarkMatcher,
	defaultBookmarkColor,
	describeBookmarkGroup,
	listBookmarkFolders,
	normalizeBookmarkGroups,
	pageKey,
	resolveBookmarkGroups,
	siteOf,
} from "../modules/tabGroups/bookmarkGroups.mjs";
import { mockLocales } from "./helpers.mjs";

before(async () => {
	mockLocales();
	await loadI18n("en");
});

describe("pageKey", () => {
	it("adresa bez části za # v jednotném tvaru", () => {
		assert.equal(pageKey("https://Example.COM:443/a?b=1#sekce"), "https://example.com/a?b=1");
		assert.equal(pageKey("http://example.com:80/"), "http://example.com/");
		assert.equal(pageKey("https://example.com:8443/"), "https://example.com:8443/");
	});

	it("neplatná adresa → null", () => {
		assert.equal(pageKey("není adresa"), null);
		assert.equal(pageKey(""), null);
		assert.equal(pageKey(undefined), null);
	});
});

describe("siteOf", () => {
	it("hostitel http(s) adresy bez www. a koncové tečky", () => {
		assert.equal(siteOf("https://www.example.com/x"), "example.com");
		assert.equal(siteOf("http://example.com./"), "example.com");
		assert.equal(siteOf("https://sub.example.com/"), "sub.example.com");
	});

	it("jiné protokoly a neplatné adresy → null", () => {
		assert.equal(siteOf("ftp://example.com/"), null);
		assert.equal(siteOf("about:blank"), null);
		assert.equal(siteOf("file:///C:/x.html"), null);
		assert.equal(siteOf("není adresa"), null);
		assert.equal(siteOf(undefined), null);
	});
});

describe("collectBookmarkUrls", () => {
	it("adresy záložek i z podsložek", () => {
		const tree = [
			{
				id: "1",
				children: [
					{ id: "2", url: "https://a.com/" },
					{ id: "3", children: [{ id: "4", url: "https://b.com/" }, { id: "5", children: [] }] },
				],
			},
		];
		assert.deepEqual(collectBookmarkUrls(tree), ["https://a.com/", "https://b.com/"]);
	});
});

describe("createBookmarkMatcher", () => {
	const match = createBookmarkMatcher(
		[{ wholeDomain: false }, { wholeDomain: true }, { wholeDomain: false }],
		[["https://a.com/page#x", "není adresa"], ["https://www.b.com/one"], ["https://a.com/page"]]
	);

	it("stejná adresa bez části za #", () => {
		assert.equal(match("https://a.com/page"), 0);
		assert.equal(match("https://a.com/page#jinde"), 0);
		assert.equal(match("https://a.com/other"), -1);
	});

	it("„všechny url na doméně“ platí pro doménu i www., ne pro jiné subdomény", () => {
		assert.equal(match("https://b.com/cokoliv"), 1);
		assert.equal(match("http://www.b.com/z?q=1"), 1);
		assert.equal(match("https://sub.b.com/"), -1);
	});

	it("neplatná adresa nepatří nikam", () => {
		assert.equal(match(undefined), -1);
		assert.equal(match("není adresa"), -1);
	});
});

describe("normalizeBookmarkGroups", () => {
	it("neplatné nastavení → prázdné pole", () => {
		assert.deepEqual(normalizeBookmarkGroups(undefined), []);
		assert.deepEqual(normalizeBookmarkGroups({}), []);
	});

	it("doplní id, barvu a volby", () => {
		const groups = normalizeBookmarkGroups([
			null,
			{ id: " a ", title: "  Práce ", folderId: "10", folderTitle: "Work", wholeDomain: true, color: "red", collapsed: true },
			{ id: "a", wholeDomain: "ano", color: "black" },
			{},
		]);
		assert.deepEqual(groups, [
			{ id: "a", title: "Práce", folderId: "10", folderTitle: "Work", wholeDomain: true, color: "red", collapsed: true },
			{ id: "a-2", title: "", folderId: "", folderTitle: "", wholeDomain: false, color: defaultBookmarkColor(2), collapsed: false },
			{ id: "auto-3", title: "", folderId: "", folderTitle: "", wholeDomain: false, color: defaultBookmarkColor(3), collapsed: false },
		]);
	});

	it("výchozí barva se u sousedních řádků liší", () => {
		for (let i = 0; i < GROUP_COLORS.length * 2; i++) {
			assert.notEqual(defaultBookmarkColor(i), defaultBookmarkColor(i + 1));
		}
	});
});

describe("bookmarkGroupTitle / resolveBookmarkGroups / describeBookmarkGroup", () => {
	const row = (fields) => ({ id: "x", title: "", folderId: "1", folderTitle: "", wholeDomain: false, color: "blue", collapsed: false, ...fields });

	it("název: zadaný, jinak složky, jinak výchozí", () => {
		assert.equal(bookmarkGroupTitle(row({ title: "Moje", folderTitle: "Složka" })), "Moje");
		assert.equal(bookmarkGroupTitle(row({ folderTitle: " Složka " })), "Složka");
		assert.equal(bookmarkGroupTitle(row({})), "Bookmarks");
	});

	it("použijí se jen řádky se složkou a názvy se neopakují", () => {
		const resolved = resolveBookmarkGroups(
			[row({ id: "a", title: "today" }), row({ id: "b", folderId: "" }), row({ id: "c", title: "Work" }), row({ id: "d", title: "Work" })],
			["today"]
		);
		assert.deepEqual(
			resolved.map(({ id, title }) => [id, title]),
			[
				["a", "today (2)"],
				["c", "Work"],
				["d", "Work (2)"],
			]
		);
	});

	it("popis skupiny podle volby domény", () => {
		assert.match(describeBookmarkGroup(row({ folderTitle: "Work" })), /Work/);
		assert.notEqual(describeBookmarkGroup(row({ folderTitle: "Work" })), describeBookmarkGroup(row({ folderTitle: "Work", wholeDomain: true })));
	});
});

describe("listBookmarkFolders", () => {
	it("složky stromu s cestou, bez kořene a bez záložek", () => {
		const tree = [
			{
				id: "0",
				children: [
					{ id: "1", title: "Bookmarks bar", children: [{ id: "10", title: "Work", children: [{ id: "100", title: "", children: [] }] }, { id: "11", url: "https://x.com/" }] },
					{ id: "2", title: "Other", children: [] },
				],
			},
		];
		assert.deepEqual(listBookmarkFolders(tree), [
			{ id: "1", title: "Bookmarks bar", label: "Bookmarks bar" },
			{ id: "10", title: "Work", label: "Bookmarks bar › Work" },
			{ id: "100", title: "(untitled)", label: "Bookmarks bar › Work › (untitled)" },
			{ id: "2", title: "Other", label: "Other" },
		]);
	});

	it("stejnojmenné kořenové složky v účtu a v zařízení se rozliší", () => {
		const tree = [
			{
				id: "0",
				children: [
					{ id: "1", title: "Bookmarks bar", syncing: false, children: [] },
					{ id: "2", title: "Bookmarks bar", syncing: true, children: [] },
				],
			},
		];
		assert.deepEqual(
			listBookmarkFolders(tree).map((folder) => folder.title),
			["Bookmarks bar (on this device only)", "Bookmarks bar (in account)"]
		);
	});
});
