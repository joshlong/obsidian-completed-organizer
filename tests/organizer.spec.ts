import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import { Organizer } from "../src/organizer.ts";
import { DEFAULT_SETTINGS, type CompletedOrganizerSettings } from "../src/settings.ts";
import { FakeVault } from "./vault.ts";

const ROOT = "06 - Completed";

function organize(paths: string[], overrides: Partial<CompletedOrganizerSettings> = {}) {
	const vault = new FakeVault(paths);
	const settings = { ...DEFAULT_SETTINGS, sourceFolder: ROOT, ...overrides };
	const organizer = new Organizer(vault.app as unknown as App, () => settings);
	return { vault, organizer, run: () => organizer.organizeAll() };
}

test("files a loose dated note into its year folder", async () => {
	const { vault, run } = organize([`${ROOT}/`, `${ROOT}/2024-03-01 -- Ship it.md`]);
	const report = await run();

	assert.deepEqual(report.moved.map((m) => [m.from, m.to, m.kind]), [
		[`${ROOT}/2024-03-01 -- Ship it.md`, `${ROOT}/2024/2024-03-01 -- Ship it.md`, "note"],
	]);
	assert.ok(vault.snapshot().includes(`${ROOT}/2024`), "year folder was created");
});

test("moves a dated folder whole, without disturbing what is inside it", async () => {
	const { vault, run } = organize([
		`${ROOT}/`,
		`${ROOT}/2024-03-01 -- Berlin trip/`,
		`${ROOT}/2024-03-01 -- Berlin trip/notes.md`,
		`${ROOT}/2024-03-01 -- Berlin trip/2019-01-01 -- old receipt.md`,
		`${ROOT}/2024-03-01 -- Berlin trip/photos/img.png`,
	]);
	const report = await run();

	// One move: the folder. Nothing was plucked out of it on the way past.
	assert.deepEqual(report.moved.map((m) => [m.from, m.to, m.kind]), [
		[`${ROOT}/2024-03-01 -- Berlin trip`, `${ROOT}/2024/2024-03-01 -- Berlin trip`, "folder"],
	]);
	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/2024`,
		`${ROOT}/2024/2024-03-01 -- Berlin trip`,
		`${ROOT}/2024/2024-03-01 -- Berlin trip/2019-01-01 -- old receipt.md`,
		`${ROOT}/2024/2024-03-01 -- Berlin trip/notes.md`,
		`${ROOT}/2024/2024-03-01 -- Berlin trip/photos`,
		`${ROOT}/2024/2024-03-01 -- Berlin trip/photos/img.png`,
	]);
	assert.equal(report.moved[0].source, "folder name");
});

test("never moves a year folder", async () => {
	const { vault, run } = organize([
		`${ROOT}/`,
		`${ROOT}/2024/`,
		`${ROOT}/2024/2024-05-05 -- already filed.md`,
	]);
	const report = await run();

	assert.deepEqual(vault.moves, []);
	assert.equal(report.alreadyFiled, 1);
});

test("corrects a note and a folder filed under the wrong year", async () => {
	const { vault, run } = organize([
		`${ROOT}/`,
		`${ROOT}/2024/`,
		`${ROOT}/2024/2023-07-04 -- misfiled.md`,
		`${ROOT}/2024/2022-01-09 -- misfiled folder/`,
		`${ROOT}/2024/2022-01-09 -- misfiled folder/inside.md`,
	]);
	await run();

	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/2022`,
		`${ROOT}/2022/2022-01-09 -- misfiled folder`,
		`${ROOT}/2022/2022-01-09 -- misfiled folder/inside.md`,
		`${ROOT}/2023`,
		`${ROOT}/2023/2023-07-04 -- misfiled.md`,
		`${ROOT}/2024`,
	]);
});

test("with collecting off, undated folders and their contents are left alone", async () => {
	const { vault, run } = organize(
		[
			`${ROOT}/`,
			`${ROOT}/Reference/`,
			`${ROOT}/Reference/2024-03-01 -- buried.md`,
			`${ROOT}/Some note.md`,
		],
		{ fileUndated: false }
	);
	const report = await run();

	assert.deepEqual(vault.moves, []);
	assert.deepEqual(report.skippedNoDate.sort(), [`${ROOT}/Reference`, `${ROOT}/Some note.md`]);
});

test("a dated folder still wins when descending into other folders is on", async () => {
	const { vault, run } = organize(
		[
			`${ROOT}/`,
			`${ROOT}/2024-03-01 -- Berlin trip/`,
			`${ROOT}/2024-03-01 -- Berlin trip/2019-01-01 -- old receipt.md`,
			`${ROOT}/Reference/`,
			`${ROOT}/Reference/2021-02-02 -- buried.md`,
		],
		{ recurseIntoOtherFolders: true, fileUndated: false }
	);
	await run();

	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/2021`,
		// Pulled out of Reference, because that folder has no date of its own.
		`${ROOT}/2021/2021-02-02 -- buried.md`,
		`${ROOT}/2024`,
		// Still inside the dated folder, which moved as a unit.
		`${ROOT}/2024/2024-03-01 -- Berlin trip`,
		`${ROOT}/2024/2024-03-01 -- Berlin trip/2019-01-01 -- old receipt.md`,
		`${ROOT}/Reference`,
	]);
});

test("collects undated notes and folders into the undated folder", async () => {
	const { vault, run } = organize([
		`${ROOT}/`,
		`${ROOT}/Some note.md`,
		`${ROOT}/2024-03-01 -- Ship it.md`,
		`${ROOT}/Reference/`,
		`${ROOT}/Reference/2024-03-01 -- buried.md`,
		`${ROOT}/Reference/nested/deep.md`,
	]);
	const report = await run();

	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/2024`,
		`${ROOT}/2024/2024-03-01 -- Ship it.md`,
		`${ROOT}/Undated`,
		`${ROOT}/Undated/Reference`,
		// The folder moved whole; nothing was lifted out of it.
		`${ROOT}/Undated/Reference/2024-03-01 -- buried.md`,
		`${ROOT}/Undated/Reference/nested`,
		`${ROOT}/Undated/Reference/nested/deep.md`,
		`${ROOT}/Undated/Some note.md`,
	]);
	assert.deepEqual(report.skippedNoDate, []);
	assert.deepEqual(
		report.moved.filter((m) => m.source === "no date").map((m) => m.to).sort(),
		[`${ROOT}/Undated/Reference`, `${ROOT}/Undated/Some note.md`]
	);
});

test("the undated folder is a destination, never cargo", async () => {
	const { vault, run } = organize([`${ROOT}/`, `${ROOT}/Undated/`, `${ROOT}/Undated/loose.md`]);
	const report = await run();

	assert.deepEqual(vault.moves, []);
	assert.equal(report.alreadyFiled, 1);
});

test("something in the undated folder that gains a date moves out to its year", async () => {
	const { vault, run } = organize([
		`${ROOT}/`,
		`${ROOT}/Undated/`,
		`${ROOT}/Undated/was undated.md`,
		`${ROOT}/Undated/2022-09-09 -- now dated.md`,
		`${ROOT}/Undated/2023-01-01 -- now dated folder/`,
	]);
	vault.setCache(`${ROOT}/Undated/was undated.md`, { frontmatter: { date: "2021-05-05" } });
	await run();

	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/2021`,
		`${ROOT}/2021/was undated.md`,
		`${ROOT}/2022`,
		`${ROOT}/2022/2022-09-09 -- now dated.md`,
		`${ROOT}/2023`,
		`${ROOT}/2023/2023-01-01 -- now dated folder`,
		`${ROOT}/Undated`,
	]);
});

test("honors a custom undated folder name and ignores its casing", async () => {
	const { vault, run } = organize(
		[`${ROOT}/`, `${ROOT}/no date.md`, `${ROOT}/inbox/`, `${ROOT}/inbox/kept.md`],
		{ undatedFolderName: "Inbox" }
	);
	await run();

	// The existing `inbox` folder is recognized as the destination despite the
	// different casing, so it is filed into rather than moved into itself.
	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/inbox`,
		`${ROOT}/inbox/kept.md`,
		`${ROOT}/inbox/no date.md`,
	]);
});

test("a blank undated folder name falls back to the default", async () => {
	const { vault, run } = organize([`${ROOT}/`, `${ROOT}/no date.md`], {
		undatedFolderName: "   ",
	});
	await run();

	assert.deepEqual(vault.moves, [
		{ from: `${ROOT}/no date.md`, to: `${ROOT}/Undated/no date.md` },
	]);
});

test("a slash in the undated folder name cannot escape the source folder", async () => {
	const { vault, run } = organize([`${ROOT}/`, `${ROOT}/no date.md`], {
		undatedFolderName: "../../elsewhere",
	});
	await run();

	assert.deepEqual(vault.moves, [
		{ from: `${ROOT}/no date.md`, to: `${ROOT}/....elsewhere/no date.md` },
	]);
});

test("collecting undated items leaves attachments alone unless asked", async () => {
	const { vault, run } = organize([`${ROOT}/`, `${ROOT}/scan.pdf`, `${ROOT}/note.md`]);
	await run();

	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/Undated`,
		`${ROOT}/Undated/note.md`,
		`${ROOT}/scan.pdf`,
	]);
});

test("a year folder is never itself swept into the undated folder", async () => {
	const { vault, run } = organize([`${ROOT}/`, `${ROOT}/2024/`, `${ROOT}/2024/a.md`]);
	await run();

	// The year folder stays put. The undated note inside it is collected, because
	// sitting in 2024/ is not by itself evidence of a date.
	assert.deepEqual(vault.snapshot(), [
		ROOT,
		`${ROOT}/2024`,
		`${ROOT}/Undated`,
		`${ROOT}/Undated/a.md`,
	]);
});

test("with folder organizing off, dated folders are left alone", async () => {
	const { vault, run } = organize(
		[`${ROOT}/`, `${ROOT}/2024-03-01 -- Berlin trip/`, `${ROOT}/2024-03-01 -- Berlin trip/a.md`],
		{ organizeFolders: false }
	);
	await run();

	assert.deepEqual(vault.moves, []);
});

test("a name already taken in the year folder gets a numbered sibling", async () => {
	const { vault, run } = organize([
		`${ROOT}/`,
		`${ROOT}/2024/`,
		`${ROOT}/2024/2024-03-01 -- Trip/`,
		`${ROOT}/2024-03-01 -- Trip/`,
		`${ROOT}/2024-03-01 -- Trip/a.md`,
	]);
	await run();

	assert.deepEqual(vault.moves, [
		{ from: `${ROOT}/2024-03-01 -- Trip`, to: `${ROOT}/2024/2024-03-01 -- Trip 1` },
	]);
	// The folder that was already there is untouched, not merged into.
	assert.ok(vault.snapshot().includes(`${ROOT}/2024/2024-03-01 -- Trip`));
	assert.ok(vault.snapshot().includes(`${ROOT}/2024/2024-03-01 -- Trip 1/a.md`));
});

test("the skip strategy leaves a conflicting item where it is", async () => {
	const { vault, run } = organize(
		[`${ROOT}/`, `${ROOT}/2024/`, `${ROOT}/2024/dup.md`, `${ROOT}/dup.md`],
		{ conflictStrategy: "skip", useFileName: false }
	);
	// Both are dated 2024, so the one already in 2024/ stays and holds the name.
	vault.setCache(`${ROOT}/2024/dup.md`, { frontmatter: { date: "2024-01-01" } });
	vault.setCache(`${ROOT}/dup.md`, { frontmatter: { date: "2024-06-06" } });
	const report = await run();

	assert.deepEqual(vault.moves, []);
	assert.deepEqual(report.skippedConflict, [`${ROOT}/dup.md`]);
});

test("falls back to front matter and then to the first heading", async () => {
	const { vault, run } = organize([`${ROOT}/`, `${ROOT}/no date here.md`, `${ROOT}/nor here.md`]);
	vault.setCache(`${ROOT}/no date here.md`, { frontmatter: { created: "2020-04-04 -- x" } });
	vault.setCache(`${ROOT}/nor here.md`, {
		headings: [{ level: 1, heading: "2015-08-08 -- an old one" }],
	});
	const report = await run();

	assert.deepEqual(
		report.moved.map((m) => [m.to, m.source]).sort(),
		[
			[`${ROOT}/2015/nor here.md`, "title"],
			[`${ROOT}/2020/no date here.md`, "front matter"],
		].sort()
	);
});

test("markdownOnly leaves attachments alone, and turning it off files them", async () => {
	const paths = [`${ROOT}/`, `${ROOT}/2024-03-01 -- scan.pdf`];

	const kept = organize(paths);
	await kept.run();
	assert.deepEqual(kept.vault.moves, []);

	const filed = organize(paths, { markdownOnly: false });
	await filed.run();
	assert.deepEqual(filed.vault.moves, [
		{ from: `${ROOT}/2024-03-01 -- scan.pdf`, to: `${ROOT}/2024/2024-03-01 -- scan.pdf` },
	]);
});

test("a dry run reports moves without performing any", async () => {
	const { vault, run } = organize(
		[`${ROOT}/`, `${ROOT}/2024-03-01 -- Trip/`, `${ROOT}/2024-06-06 -- note.md`],
		{ dryRun: true }
	);
	const report = await run();

	assert.equal(report.moved.length, 2);
	assert.deepEqual(vault.moves, []);
	assert.ok(!vault.snapshot().includes(`${ROOT}/2024`), "no year folder was created");
});

test("reports a missing source folder instead of throwing", async () => {
	const { run } = organize([`Somewhere else/`]);
	const report = await run();

	assert.equal(report.errors.length, 1);
	assert.match(report.errors[0].message, /not found/i);
});
