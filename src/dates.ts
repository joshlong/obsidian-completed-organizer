/**
 * Date detection helpers.
 *
 * Everything hinges on finding a leading `yyyy-mm-dd` in some piece of text
 * (file name, front matter value, or title). If we can't find one, the caller
 * leaves the file alone.
 */

/** `yyyy-mm-dd` anchored at the start, not followed by another digit. */
const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/;

export interface ParsedDate {
	year: string;
	iso: string;
}

/** Where a date came from, for logging. */
export type DateSource = "file name" | "front matter" | "title";

export interface DateHit extends ParsedDate {
	source: DateSource;
	/** The raw text the date was read out of. */
	raw: string;
}

/**
 * Pulls a leading `yyyy-mm-dd` off a string and sanity-checks it as a real
 * calendar date, so `2024-13-45 -- nope` is not treated as a date.
 */
export function parseLeadingDate(raw: unknown): ParsedDate | null {
	const text = coerceToText(raw);
	if (!text) return null;

	const match = LEADING_DATE.exec(text.trim());
	if (!match) return null;

	const [, year, month, day] = match;
	const y = Number(year);
	const m = Number(month);
	const d = Number(day);

	if (m < 1 || m > 12 || d < 1 || d > 31) return null;

	// Reject things like 2024-02-31 that pass the range check.
	const probe = new Date(Date.UTC(y, m - 1, d));
	if (
		probe.getUTCFullYear() !== y ||
		probe.getUTCMonth() !== m - 1 ||
		probe.getUTCDate() !== d
	) {
		return null;
	}

	return { year, iso: `${year}-${month}-${day}` };
}

/**
 * Front matter values arrive as strings most of the time, but YAML can also
 * hand back a Date, a number, or a list. Flatten those down to something the
 * date regex can look at.
 */
function coerceToText(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		const year = String(value.getFullYear()).padStart(4, "0");
		const month = String(value.getMonth() + 1).padStart(2, "0");
		const day = String(value.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const text = coerceToText(entry);
			if (text) return text;
		}
	}
	return null;
}

/** True for folder names like `2024` — the folders this plugin manages. */
export function isYearFolderName(name: string): boolean {
	return /^\d{4}$/.test(name);
}
