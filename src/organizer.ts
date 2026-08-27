import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { DateHit, isYearFolderName, parseLeadingDate } from "./dates";
import { isInside, isManagedLocation, relativeTo } from "./paths";
import type { CompletedOrganizerSettings } from "./settings";

export interface MoveRecord {
	from: string;
	to: string;
	source: DateHit["source"];
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
		if (!hit) {
			report.skippedNoDate.push(item.path);
			return;
		}

		const kind = item instanceof TFolder ? "folder" : "note";
		const targetFolder = `${this.root}/${hit.year}`;
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
			report.moved.push({ from: item.path, to: targetPath, source: hit.source, kind });
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
			report.moved.push({ from, to: targetPath, source: hit.source, kind });
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

	/** A folder whose name carries a date, and which isn't a year folder itself. */
	private isDatedFolder(folder: TFolder): boolean {
		if (!this.settings.organizeFolders) return false;
		if (isYearFolderName(folder.name)) return false;
		return parseLeadingDate(folder.name) !== null;
	}

	private isCandidate(item: TAbstractFile): boolean {
		if (!this.isInSourceFolder(item)) return false;
		if (item.path === this.root) return false;

		const relativeFolder = relativeTo(this.root, item.parent?.path ?? "");
		if (relativeFolder === null) return false;

		if (item instanceof TFolder) {
			// Year folders are the destinations, never the cargo.
			if (isYearFolderName(item.name)) return false;
			if (!this.settings.organizeFolders) return false;
		} else if (item instanceof TFile) {
			if (this.settings.markdownOnly && item.extension !== "md") return false;
			// A note inside a dated folder travels with that folder.
			if (this.hasDatedAncestor(item)) return false;
		} else {
			return false;
		}

		return isManagedLocation(
			relativeFolder,
			isYearFolderName,
			this.settings.recurseIntoOtherFolders
		);
	}

	/** True when some folder between the item and the root is itself dated. */
	private hasDatedAncestor(item: TAbstractFile): boolean {
		const root = this.root;
		let parent = item.parent;
		while (parent && parent.path !== root && isInside(root, parent.path)) {
			if (this.isDatedFolder(parent)) return true;
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
				// A *dated* folder moves as a unit, so don't also go picking at its
				// contents — that would empty it out on the way past. An undated one
				// is only here to be reported, so carry on into it as usual.
				if (this.isDatedFolder(child)) continue;
			}

			const descend =
				this.settings.recurseIntoOtherFolders || (isRoot && isYearFolderName(child.name));
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
