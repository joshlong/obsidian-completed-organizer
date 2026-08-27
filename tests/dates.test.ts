import test from "node:test";
import assert from "node:assert/strict";
import { isYearFolderName, parseLeadingDate } from "../src/dates.ts";

/** Every value that should yield a year, and the year it should yield. */
const MATCHES: [unknown, string][] = [
	["2024-03-01 -- Ship it", "2024"],
	["2019-12-31 -- New Year's Eve", "2019"],
	["2024-03-01 Ship it", "2024"],
	["2024-03-01--Ship it", "2024"],
	["2024-03-01", "2024"],
	["  2024-03-01 -- leading and trailing space  ", "2024"],
	["2024-02-29 -- a real leap day", "2024"],
	[new Date(2021, 6, 4), "2021"],
	[["2018-05-05", "ignored"], "2018"],
];

/** Values the plugin must leave alone. */
const NON_MATCHES: unknown[] = [
	"Ship it 2024-03-01",
	"2024-13-01 -- month 13",
	"2024-00-01 -- month 0",
	"2024-03-00 -- day 0",
	"2024-02-31 -- February has no 31st",
	"2023-02-29 -- not a leap year",
	"20240301 -- no separators",
	"2024-03-011 -- too many digits",
	"24-03-01 -- two-digit year",
	"Untitled",
	"",
	null,
	undefined,
	{},
	[],
	true,
];

test("reads the year out of a leading yyyy-mm-dd", () => {
	for (const [input, year] of MATCHES) {
		const parsed = parseLeadingDate(input);
		assert.ok(parsed, `expected a date from ${JSON.stringify(input)}`);
		assert.equal(parsed.year, year, `wrong year for ${JSON.stringify(input)}`);
	}
});

test("leaves anything without a leading date alone", () => {
	for (const input of NON_MATCHES) {
		assert.equal(
			parseLeadingDate(input),
			null,
			`expected no date from ${JSON.stringify(input)}`
		);
	}
});

test("keeps the full date around for logging", () => {
	assert.deepEqual(parseLeadingDate("2024-03-01 -- Ship it"), {
		year: "2024",
		iso: "2024-03-01",
	});
});

test("recognizes year folders and nothing else", () => {
	for (const name of ["2024", "1999", "0000"]) {
		assert.ok(isYearFolderName(name), `${name} should be a year folder`);
	}
	for (const name of ["24", "2024x", "x2024", "2024 archive", "abcd", ""]) {
		assert.ok(!isYearFolderName(name), `${name} should not be a year folder`);
	}
});
