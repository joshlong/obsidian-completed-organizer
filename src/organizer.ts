import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { DateHit, isYearFolderName, parseLeadingDate } from "./dates";
import { isInside, isManagedLocation, relativeTo } from "./paths";
import { DEFAULT_UNDATED_FOLDER, type CompletedOrganizerSettings } from "./settings";

/** Why something was filed where it was. */
export type MoveReason = DateHit["source"] | "no date";

export interface MoveRecord {
	from: string;
	to: string;
	source: MoveReason;
	kind: "note" | "folder";
}

export interface OrganizeReport {
	moved: MoveRecord[];
	alreadyFiled: number;
	skippedNoDate: string[];
	skippedConflict: string[];
	errors: { path: string; message: string }[];
	dryRun: boolean;
}

export function emptyReport(dryRun: boolean): OrganizeReport {
	return {
		moved: [],
		alreadyFiled: 0,
		skippedNoDate: [],
		skippedConflict: [],
		errors: [],
		dryRun,
	};
}

export class Organizer {
	constructor(
		private app: App,
		private getSettings: () => CompletedOrganizerSettings
	) {}

	private get settings(): CompletedOrganizerSettings {
		return this.getSettings();
	}

	private get root(): string {
		return normalizePath(this.settings.sourceFolder);
	}

	/** Sanitized, since it's free text and has to be a single folder name. */
	private get undatedFolder(): string {
		const name = (this.settings.undatedFolderName ?? "").trim().replace(/[\\/]/g, "");
		return name || DEFAULT_UNDATED_FOLDER;
	}

	/**
	 * Folders the plugin files *into*: the year folders and the undated folder.
	 * They're never moved themselves, and they are walked so that something whose
	 * date has since changed gets re-filed.
	 */
	private isDestinationName(name: string): boolean {
		if (isYearFolderName(name)) return true;
		return name.toLowerCase() === this.undatedFolder.toLowerCase();
	}

	/**
	 * Path of the destination folder for a bucket name. If a folder differing only
	 * in case is already there, that one is used — creating `Undated` next to an
	 * existing `undated` would collide on a case-insensitive disk, and would look
	 * like two folders on any other.
	 */
	private resolveBucketFolder(bucket: string): string {
		const root = this.getSourceFolder();
		const match = root?.children.find(
			(child) => child instanceof TFolder && child.name.toLowerCase() === bucket.toLowerCase()
		);
		return match ? match.path : `${this.root}/${bucket}`;
	}

	/** The configured folder, or null if it doesn't exist yet. */
	getSourceFolder(): TFolder | null {
		const path = this.root;
		if (!path || path === "/" || path === ".") return null;
		const folder = this.app.vault.getAbstractFileByPath(path);
		return folder instanceof TFolder ? folder : null;
	}

	/** True if the note or folder lives anywhere under the configured folder. */
	isInSourceFolder(item: TAbstractFile): boolean {
		const root = this.root;
		if (!root) return false;
		return item.path === root || isInside(root, item.path);
	}

	/** Sweep the whole folder. */
	async organizeAll(): Promise<OrganizeReport> {
		const report = emptyReport(this.settings.dryRun);
		const root = this.getSourceFolder();
		if (!root) {
			report.errors.push({
				path: this.settings.sourceFolder,
				message: "Folder not found in this vault.",
			});
			return report;
		}

		// Collected up front: moving a folder invalidates the paths of everything
		// under it, so the whole tree is read before anything moves.
		for (const item of this.collectCandidates(root, true)) {
			await this.organizeItem(item, report);
		}
		return report;
	}

	/**
	 * File a single note or folder. Safe to call on anything; things the plugin
	 * doesn't manage are ignored.
	 */
	async organizeItem(item: TAbstractFile, report: OrganizeReport): Promise<void> {
		if (!this.isCandidate(item)) return;

		const hit = this.findDate(item);
		if (!hit && !this.settings.fileUndated) {
			report.skippedNoDate.push(item.path);
			return;
		}

		const bucket = hit ? hit.year : this.undatedFolder;
		await this.moveInto(item, this.resolveBucketFolder(bucket), hit?.source ?? "no date", report);
	}

	/**
	 * File something from anywhere in the vault into the completed folder, in one
	 * move, straight into the year folder it belongs in.
	 *
	 * Unlike a sweep this skips the "is this ours to touch" checks — markdown only,
	 * organize folders, which subfolders are in scope — because the user pointed at
	 * this item by hand. Something already under the completed folder is fine to
	 * send too; it just gets re-filed.
	 */
	async sendToCompleted(item: TAbstractFile, report: OrganizeReport): Promise<void> {
		if (!this.canSendToCompleted(item)) return;

		const hit = this.findDate(item);
		// With no date and collecting turned off there is nowhere to put it but the
		// completed folder itself. Refusing would be worse: the user asked for this
		// one specifically, and a sweep would leave it wherever it is now.
		const targetFolder = hit
			? this.resolveBucketFolder(hit.year)
			: this.settings.fileUndated
				? this.resolveBucketFolder(this.undatedFolder)
				: this.root;

		await this.moveInto(item, targetFolder, hit?.source ?? "no date", report);
	}

	/**
	 * True when the send command has somewhere to put this item. The completed
	 * folder itself, and anything containing it, can't be filed inside it, and the
	 * year and undated folders are destinations rather than things to be filed.
	 */
	canSendToCompleted(item: TAbstractFile): boolean {
		if (!(item instanceof TFile) && !(item instanceof TFolder)) return false;

		const root = this.root;
		if (!root || root === "/" || root === ".") return false;
		if (item.path === root || isInside(item.path, root)) return false;

		if (item instanceof TFolder && this.isInSourceFolder(item)) {
			return !this.isDestinationName(item.name);
		}
		return true;
	}

	/** The move itself, once the destination folder has been decided. */
	private async moveInto(
		item: TAbstractFile,
		targetFolder: string,
		source: MoveReason,
		report: OrganizeReport
	): Promise<void> {
		const kind = item instanceof TFolder ? "folder" : "note";
		if (item.parent?.path === targetFolder) {
			report.alreadyFiled++;
			return;
		}

		// A folder can never be filed into itself, whatever the name says.
		if (item.path === targetFolder || isInside(item.path, targetFolder)) {
			report.skippedConflict.push(item.path);
			return;
		}

		const targetPath = this.resolveTargetPath(targetFolder, item);
		if (!targetPath) {
			report.skippedConflict.push(item.path);
			return;
		}

		if (this.settings.dryRun) {
			report.moved.push({ from: item.path, to: targetPath, source, kind });
			return;
		}

		// Read before the move: renameFile updates item.path in place, so afterwards
		// there is no "from" left to report.
		const from = item.path;
		try {
			await this.ensureFolder(targetFolder);
			// renameFile (not vault.rename) so links follow. It takes folders too,
			// and moves everything inside them along with it.
			await this.app.fileManager.renameFile(item, targetPath);
			report.moved.push({ from, to: targetPath, source, kind });
		} catch (error) {
			report.errors.push({
				path: item.path,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * For a note: the file name, then the front matter, then the first heading.
	 * For a folder: its name, which is the only thing there is to go on.
	 * Returns null when nothing matches, which means "leave it".
	 */
	findDate(item: TAbstractFile): DateHit | null {
		if (item instanceof TFolder) {
			const parsed = parseLeadingDate(item.name);
			return parsed ? { ...parsed, source: "folder name", raw: item.name } : null;
		}
		if (!(item instanceof TFile)) return null;

		if (this.settings.useFileName) {
			const parsed = parseLeadingDate(item.basename);
			if (parsed) return { ...parsed, source: "file name", raw: item.basename };
		}

		const cache = this.app.metadataCache.getFileCache(item);

		if (this.settings.useFrontmatter && cache?.frontmatter) {
			const frontmatter = cache.frontmatter;
			const title = parseLeadingDate(frontmatter["title"]);
			if (title) {
				return { ...title, source: "front matter", raw: String(frontmatter["title"]) };
			}
			for (const key of this.settings.frontmatterKeys) {
				const parsed = parseLeadingDate(frontmatter[key]);
				if (parsed) return { ...parsed, source: "front matter", raw: `${key}: ${parsed.iso}` };
			}
		}

		if (this.settings.useTitle && cache?.headings) {
			const heading = cache.headings.find((entry) => entry.level === 1);
			if (heading) {
				const parsed = parseLeadingDate(heading.heading);
				if (parsed) return { ...parsed, source: "title", raw: heading.heading };
			}
		}

		return null;
	}

	/**
	 * A folder that will be moved in one piece, so the plugin must not go
	 * rummaging inside it: a dated one, or — when undated things are collected —
	 * any folder that isn't a destination.
	 */
	private movesAsUnit(folder: TFolder): boolean {
		if (!this.settings.organizeFolders) return false;
		if (this.isDestinationName(folder.name)) return false;
		if (parseLeadingDate(folder.name) !== null) return true;
		return this.settings.fileUndated;
	}

	private isCandidate(item: TAbstractFile): boolean {
		if (!this.isInSourceFolder(item)) return false;
		if (item.path === this.root) return false;

		const relativeFolder = relativeTo(this.root, item.parent?.path ?? "");
		if (relativeFolder === null) return false;

		if (item instanceof TFolder) {
			// Year folders and the undated folder are destinations, never cargo.
			if (this.isDestinationName(item.name)) return false;
			if (!this.settings.organizeFolders) return false;
		} else if (item instanceof TFile) {
			if (this.settings.markdownOnly && item.extension !== "md") return false;
			// A note inside a folder that is itself being moved travels with it.
			if (this.hasUnitAncestor(item)) return false;
		} else {
			return false;
		}

		return isManagedLocation(
			relativeFolder,
			(name) => this.isDestinationName(name),
			this.settings.recurseIntoOtherFolders
		);
	}

	/** True when some folder between the item and the root moves in one piece. */
	private hasUnitAncestor(item: TAbstractFile): boolean {
		const root = this.root;
		let parent = item.parent;
		while (parent && parent.path !== root && isInside(root, parent.path)) {
			if (this.movesAsUnit(parent)) return true;
			parent = parent.parent;
		}
		return false;
	}

	private collectCandidates(folder: TFolder, isRoot: boolean): TAbstractFile[] {
		const items: TAbstractFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				if (this.isCandidate(child)) items.push(child);
				continue;
			}
			if (!(child instanceof TFolder)) continue;

			if (this.isCandidate(child)) {
				items.push(child);
				// A folder that moves in one piece must not also have its contents
				// picked at — that would empty it out on the way past. A folder that
				// is staying put is only here to be reported, so carry on into it.
				if (this.movesAsUnit(child)) continue;
			}

			const descend =
				this.settings.recurseIntoOtherFolders ||
				(isRoot && this.isDestinationName(child.name));
			if (descend) items.push(...this.collectCandidates(child, false));
		}
		return items;
	}

	/**
	 * Where the note or folder should end up. Returns null when the name is taken
	 * and the conflict strategy says to leave it alone. Existing folders are never
	 * merged into — that would be far harder to undo than a numbered sibling.
	 */
	private resolveTargetPath(targetFolder: string, item: TAbstractFile): string | null {
		const direct = `${targetFolder}/${item.name}`;
		if (!this.app.vault.getAbstractFileByPath(direct)) return direct;
		if (this.settings.conflictStrategy === "skip") return null;

		const file = item instanceof TFile ? item : null;
		const stem = file ? file.basename : item.name;
		const suffix = file && file.extension ? `.${file.extension}` : "";
		for (let n = 1; n < 1000; n++) {
			const candidate = `${targetFolder}/${stem} ${n}${suffix}`;
			if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
		}
		return null;
	}

	/** Creates the year folder (and any missing parents) if needed. */
	private async ensureFolder(path: string): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(path)) return;
		try {
			await this.app.vault.createFolder(path);
		} catch (error) {
			// A concurrent move may have created it between the check and the call.
			if (!this.app.vault.getAbstractFileByPath(path)) throw error;
		}
	}
}

export function summarize(report: OrganizeReport): string {
	const parts: string[] = [];
	const verb = report.dryRun ? "would move" : "moved";
	const folders = report.moved.filter((move) => move.kind === "folder").length;
	const notes = report.moved.length - folders;

	const what = [
		notes ? `${notes} note${notes === 1 ? "" : "s"}` : "",
		folders ? `${folders} folder${folders === 1 ? "" : "s"}` : "",
	]
		.filter(Boolean)
		.join(" and ");
	parts.push(what ? `${verb} ${what}` : `nothing to ${report.dryRun ? "move" : "do"}`);

	if (report.alreadyFiled) parts.push(`${report.alreadyFiled} already filed`);
	if (report.skippedNoDate.length) parts.push(`${report.skippedNoDate.length} without a date`);
	if (report.skippedConflict.length) parts.push(`${report.skippedConflict.length} name conflicts`);
	if (report.errors.length) parts.push(`${report.errors.length} errors`);
	return parts.join(", ");
}
