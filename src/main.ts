import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { withFileExplorerHeld } from "./explorer";
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
	/**
	 * The create/rename watcher never files undated items: a note is undated the
	 * moment it's created, and sweeping it into the undated folder mid-keystroke
	 * would fight the user. Sweeps pick those up instead.
	 */
	private autoOrganizer!: Organizer;
	private pending = new Map<string, number>();
	/** Timers that release the file explorer once a move has settled. */
	private holds = new Set<number>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.organizer = new Organizer(this.app, () => this.settings);
		this.autoOrganizer = this.organizerWith({ fileUndated: false });

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
				void this.runSweep(this.organizerWith({ dryRun: true }), "Dry run: organize by year"),
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

		this.addCommand({
			id: "send-current-file-to-completed",
			name: "Send the current note to the completed folder",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.organizer.canSendToCompleted(file)) return false;
				if (checking) return true;
				void this.sendToCompleted([file]);
				return true;
			},
		});

		if (this.settings.showRibbonIcon) {
			this.addRibbonIcon("calendar-clock", "Organize completed notes by year", () =>
				void this.runSweep(this.organizer)
			);
		}

		// Right-click anything to send it in; right-click a folder to file that
		// folder by year, treating it as the root for one run.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				this.addSendMenuItem(menu, [file]);
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

		// And the same for a multi-file selection in the file explorer.
		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				this.addSendMenuItem(menu, files);
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
		// Left to run: they only hand the file explorer back to itself, and doing
		// that late is better than not at all.
		this.holds.clear();
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
		title?: string,
		quiet = false
	): Promise<void> {
		const report = await this.moving(() => organizer.organizeAll());
		this.reportResults(report, title, quiet);
	}

	/**
	 * Every move the plugin makes goes through here, so that none of them drag
	 * the file explorer off to the year folder behind the user's back.
	 */
	private moving<T>(action: () => Promise<T>): Promise<T> {
		if (!this.settings.keepExplorerInPlace) return action();
		return withFileExplorerHeld(this.app, action, this.holds);
	}

	/**
	 * Adds "Send to completed folder" for whatever the file explorer has selected.
	 * Left off entirely when nothing in the selection could move.
	 */
	private addSendMenuItem(menu: Menu, files: TAbstractFile[]): void {
		const movable = files.filter((file) => this.organizer.canSendToCompleted(file));
		if (!movable.length) return;

		const label =
			movable.length === 1
				? "Send to completed folder"
				: `Send ${movable.length} items to completed folder`;
		menu.addItem((item) =>
			item
				.setTitle(label)
				.setIcon("archive")
				.onClick(() => void this.sendToCompleted(movable))
		);
	}

	/** Move items in from anywhere in the vault, straight into their year folder. */
	private async sendToCompleted(files: TAbstractFile[]): Promise<void> {
		const report = emptyReport(this.settings.dryRun);
		await this.moving(async () => {
			for (const file of files) {
				await this.organizer.sendToCompleted(file, report);
			}
		});

		if (files.length === 1) {
			this.noticeForSingle(report);
		} else {
			this.reportResults(report, "Send to completed folder");
		}
	}

	private async organizeSingle(file: TAbstractFile): Promise<void> {
		const report = emptyReport(this.settings.dryRun);
		await this.moving(() => this.organizer.organizeItem(file, report));
		this.noticeForSingle(report);
	}

	/** One line about what happened to one item, since a modal would be overkill. */
	private noticeForSingle(report: OrganizeReport): void {
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
			new Notice("Something with that name is already in the year folder.");
		} else if (report.errors.length) {
			new Notice(`Could not move it: ${report.errors[0].message}`);
		} else {
			new Notice("Already in the right year folder.");
		}
	}

	private reportResults(report: OrganizeReport, title?: string, quiet = false): void {
		const summary = summarize(report);
		console.log(`[completed-organizer] ${summary}`, report);

		if (quiet && !report.moved.length && !report.errors.length) return;

		const interesting =
			report.dryRun ||
			report.errors.length > 0 ||
			report.skippedConflict.length > 0 ||
			report.moved.length > 0;

		if (interesting) {
			new ReportModal(this.app, report, title ?? "Organize completed notes by year").open();
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
		if (!(file instanceof TFile) && !(file instanceof TFolder)) return;
		if (!this.organizer.isInSourceFolder(file)) return;

		const key = file.path;
		const existing = this.pending.get(key);
		if (existing) window.clearTimeout(existing);

		const handle = window.setTimeout(() => {
			this.pending.delete(key);
			// Re-resolve: it may have moved or vanished while we waited.
			const current = this.app.vault.getAbstractFileByPath(normalizePath(key));
			if (!current) return;

			const report = emptyReport(this.settings.dryRun);
			void this.moving(() => this.autoOrganizer.organizeItem(current, report)).then(() => {
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
