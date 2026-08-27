import { Notice, Plugin, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { Organizer, OrganizeReport, emptyReport, summarize } from "./organizer";
import { ReportModal } from "./report-modal";
import {
	CompletedOrganizerSettingTab,
	CompletedOrganizerSettings,
	DEFAULT_SETTINGS,
} from "./settings";

/** How long to wait after a create/rename before filing the note. */
const AUTO_ORGANIZE_DELAY_MS = 750;

export default class CompletedOrganizerPlugin extends Plugin {
	settings: CompletedOrganizerSettings = DEFAULT_SETTINGS;
	private organizer!: Organizer;
	private pending = new Map<string, number>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.organizer = new Organizer(this.app, () => this.settings);

		this.addSettingTab(new CompletedOrganizerSettingTab(this.app, this));

		this.addCommand({
			id: "organize-all",
			name: "Organize completed notes into year folders",
			callback: () => void this.runSweep(this.organizer),
		});

		this.addCommand({
			id: "preview-organize-all",
			name: "Preview which notes would move (dry run)",
			callback: () =>
				void this.runSweep(this.organizerWith({ dryRun: true }), "Dry run"),
		});

		this.addCommand({
			id: "organize-current-file",
			name: "Organize the current note into its year folder",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.organizer.isInSourceFolder(file)) return false;
				if (checking) return true;
				void this.organizeSingle(file);
				return true;
			},
		});

		if (this.settings.showRibbonIcon) {
			this.addRibbonIcon("calendar-clock", "Organize completed notes by year", () =>
				void this.runSweep(this.organizer)
			);
		}

		// Right-click any folder to file that folder by year.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((item) =>
					item
						.setTitle("Organize by year")
						.setIcon("calendar-clock")
						.onClick(() =>
							void this.runSweep(this.organizerWith({ sourceFolder: file.path }))
						)
				);
			})
		);

		// Wait for layout: Obsidian fires `create` for every file while loading.
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.organizeOnStartup) {
				void this.runSweep(this.organizer, undefined, true);
			}
			this.registerEvent(
				this.app.vault.on("create", (file) => this.scheduleAuto(file))
			);
			this.registerEvent(
				this.app.vault.on("rename", (file) => this.scheduleAuto(file))
			);
		});
	}

	onunload(): void {
		for (const handle of this.pending.values()) window.clearTimeout(handle);
		this.pending.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** An organizer that sees the current settings with a few fields overridden. */
	private organizerWith(overrides: Partial<CompletedOrganizerSettings>): Organizer {
		return new Organizer(this.app, () => ({ ...this.settings, ...overrides }));
	}

	private async runSweep(
		organizer: Organizer,
		titlePrefix?: string,
		quiet = false
	): Promise<void> {
		const report = await organizer.organizeAll();
		this.reportResults(report, titlePrefix, quiet);
	}

	private async organizeSingle(file: TFile): Promise<void> {
		const report = emptyReport(this.settings.dryRun);
		await this.organizer.organizeFile(file, report);

		if (report.moved.length) {
			const move = report.moved[0];
			new Notice(
				report.dryRun
					? `Would move to ${move.to} (from the ${move.source})`
					: `Moved to ${move.to}`
			);
		} else if (report.skippedNoDate.length) {
			new Notice("No yyyy-mm-dd found in the file name, front matter, or title.");
		} else if (report.skippedConflict.length) {
			new Notice("A note with that name is already in the year folder.");
		} else if (report.errors.length) {
			new Notice(`Could not move it: ${report.errors[0].message}`);
		} else {
			new Notice("Already in the right year folder.");
		}
	}

	private reportResults(report: OrganizeReport, titlePrefix?: string, quiet = false): void {
		const summary = summarize(report);
		console.log(`[completed-organizer] ${summary}`, report);

		if (quiet && !report.moved.length && !report.errors.length) return;

		const interesting =
			report.dryRun ||
			report.errors.length > 0 ||
			report.skippedConflict.length > 0 ||
			report.moved.length > 0;

		if (interesting) {
			const title = titlePrefix
				? `${titlePrefix}: organize by year`
				: "Organize completed notes by year";
			new ReportModal(this.app, report, title).open();
		} else {
			new Notice(`Completed Organizer: ${summary}`);
		}
	}

	/**
	 * Creates and renames arrive one at a time and often before the metadata
	 * cache has caught up, so debounce briefly per path.
	 */
	private scheduleAuto(file: TAbstractFile): void {
		if (!this.settings.organizeOnChange) return;
		if (!(file instanceof TFile)) return;
		if (!this.organizer.isInSourceFolder(file)) return;

		const key = file.path;
		const existing = this.pending.get(key);
		if (existing) window.clearTimeout(existing);

		const handle = window.setTimeout(() => {
			this.pending.delete(key);
			// Re-resolve: the file may have moved or vanished while we waited.
			const current = this.app.vault.getAbstractFileByPath(normalizePath(key));
			if (!(current instanceof TFile)) return;

			const report = emptyReport(this.settings.dryRun);
			void this.organizer.organizeFile(current, report).then(() => {
				if (report.moved.length) {
					const move = report.moved[0];
					console.log(`[completed-organizer] ${move.from} -> ${move.to} (${move.source})`);
				}
				for (const error of report.errors) {
					console.error(`[completed-organizer] ${error.path}: ${error.message}`);
				}
			});
		}, AUTO_ORGANIZE_DELAY_MS);

		this.pending.set(key, handle);
	}
}
