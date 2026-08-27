/**
 * Pure path arithmetic, kept away from the Obsidian API so it can be tested
 * directly. Everything here works on vault-relative paths with `/` separators.
 */

/**
 * The part of `path` below `root`, or null when `path` isn't under `root`.
 * The root itself yields "".
 */
export function relativeTo(root: string, path: string): string | null {
	if (path === root) return "";
	if (!root) return path;
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

/** True when `path` sits strictly inside `ancestor`. */
export function isInside(ancestor: string, path: string): boolean {
	return path.startsWith(`${ancestor}/`);
}

/**
 * Which folders under the root the plugin is willing to touch things in.
 *
 * "" is the root itself. A single destination segment — a year folder like
 * `2024`, or the undated folder — is in scope too, so a 2023 note that ended up
 * in `2024/`, or one in `Undated/` that has since gained a date, still gets
 * corrected. Anything else is a folder the user made on purpose, and is left
 * alone unless they ask for it.
 */
export function isManagedLocation(
	relativeFolder: string,
	isDestinationFolder: (name: string) => boolean,
	recurseIntoOtherFolders: boolean
): boolean {
	if (relativeFolder === "") return true;
	if (recurseIntoOtherFolders) return true;
	return !relativeFolder.includes("/") && isDestinationFolder(relativeFolder);
}
