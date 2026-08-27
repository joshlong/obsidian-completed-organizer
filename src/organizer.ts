import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { DateHit, isYearFolderName, parseLeadingDate } from "./dates";
import type { CompletedOrganizerSettings } from "./settings";

export interface MoveRecord {
	from: string;
	to: string;
	source: DateHit["source"];
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

	/** The configured folder, or null if it doesn't exist yet. */
	getSourceFolder(): TFolder | null {
		const path = normalizePath(this.settings.sourceFolder);
		if (!path || path === "/" || path === ".") return null;
		const folder = this.app.vault.getAbstractFileByPath(path);
		return folder instanceof TFolder ? folder : null;
	}

	/** True if the file lives anywhere under the configured folder. */
	isInSourceFolder(file: TAbstractFile): boolean {
		const root = normalizePath(this.settings.sourceFolder);
		if (!root) return false;
		return file.path === root || file.path.startsWith(`${root}/`);
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

		for (const file of this.collectCandidates(root, true)) {
			await this.organizeFile(file, report);
		}
		return report;
	}

	/** File a single note. Safe to call on anything; non-candidates are ignored. */
	async organizeFile(file: TFile, report: OrganizeReport): Promise<void> {
		if (!this.isCandidate(file)) return;

		const hit = this.findDate(file);
		if (!hit) {
			report.skippedNoDate.push(file.path);
			return;
		}

		const root = normalizePath(this.settings.sourceFolder);
		const targetFolder = `${root}/${hit.year}`;
		if (file.parent?.path === targetFolder) {
			report.alreadyFiled++;
			return;
		}

		const targetPath = this.resolveTargetPath(targetFolder, file);
		if (!targetPath) {
			report.skippedConflict.push(file.path);
			return;
		}

		if (this.settings.dryRun) {
			report.moved.push({ from: file.path, to: targetPath, source: hit.source });
			return;
		}

		try {
			await this.ensureFolder(targetFolder);
			// renameFile (not vault.rename) so links to the note follow it.
			await this.app.fileManager.renameFile(file, targetPath);
			report.moved.push({ from: file.path, to: targetPath, source: hit.source });
		} catch (error) {
			report.errors.push({
				path: file.path,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Looks for a `yyyy-mm-dd` in the file name, then the front matter, then the
	 * first heading. Returns null when nothing matches, which means "leave it".
	 */
	findDate(file: TFile): DateHit | null {
		if (this.settings.useFileName) {
			const parsed = parseLeadingDate(file.basename);
			if (parsed) return { ...parsed, source: "file name", raw: file.basename };
		}

		const cache = this.app.metadataCache.getFileCache(file);

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

	private isCandidate(file: TFile): boolean {
		if (!this.isInSourceFolder(file)) return false;
		if (this.settings.markdownOnly && file.extension !== "md") return false;

		const root = normalizePath(this.settings.sourceFolder);
		const relativeFolder = (file.parent?.path ?? "").slice(root.length).replace(/^\//, "");
		if (!relativeFolder) return true; // loose in the folder root
		if (this.settings.recurseIntoOtherFolders) return true;
		// Otherwise only notes already sitting in a year folder, so a misfiled
		// 2023 note inside 2024/ still gets corrected.
		return !relativeFolder.includes("/") && isYearFolderName(relativeFolder);
	}

	private collectCandidates(folder: TFolder, isRoot: boolean): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				if (this.isCandidate(child)) files.push(child);
			} else if (child instanceof TFolder) {
				const descend =
					this.settings.recurseIntoOtherFolders || (isRoot && isYearFolderName(child.name));
				if (descend) files.push(...this.collectCandidates(child, false));
			}
		}
		return files;
	}

	/**
	 * Where the note should end up. Returns null when the name is taken and the
	 * conflict strategy says to leave it alone.
	 */
	private resolveTargetPath(targetFolder: string, file: TFile): string | null {
		const direct = `${targetFolder}/${file.name}`;
		if (!this.app.vault.getAbstractFileByPath(direct)) return direct;
		if (this.settings.conflictStrategy === "skip") return null;

		const suffix = file.extension ? `.${file.extension}` : "";
		for (let n = 1; n < 1000; n++) {
			const candidate = `${targetFolder}/${file.basename} ${n}${suffix}`;
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
	parts.push(`${report.moved.length} ${verb}`);
	if (report.alreadyFiled) parts.push(`${report.alreadyFiled} already filed`);
	if (report.skippedNoDate.length) parts.push(`${report.skippedNoDate.length} without a date`);
	if (report.skippedConflict.length) parts.push(`${report.skippedConflict.length} name conflicts`);
	if (report.errors.length) parts.push(`${report.errors.length} errors`);
	return parts.join(", ");
}
