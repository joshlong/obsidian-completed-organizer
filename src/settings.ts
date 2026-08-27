import { App, PluginSettingTab, Setting } from "obsidian";
import type CompletedOrganizerPlugin from "./main";

export type ConflictStrategy = "rename" | "skip";

export interface CompletedOrganizerSettings {
	/** Vault-relative folder whose notes get filed by year. */
	sourceFolder: string;
	/** Front matter keys to read a date out of, in order. */
	frontmatterKeys: string[];
	useFileName: boolean;
	useFrontmatter: boolean;
	useTitle: boolean;
	/** File the note again whenever it is created or renamed in the folder. */
	organizeOnChange: boolean;
	/** Run at startup, once the vault has finished loading. */
	organizeOnStartup: boolean;
	/**
	 * Also walk subfolders that aren't year folders. Off by default so a
	 * hand-made `06 - Completed/Reference` folder is left intact.
	 */
	recurseIntoOtherFolders: boolean;
	/** Only touch markdown notes; otherwise every file in the folder. */
	markdownOnly: boolean;
	/** Report what would move without moving anything. */
	dryRun: boolean;
	conflictStrategy: ConflictStrategy;
	showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: CompletedOrganizerSettings = {
	sourceFolder: "06 - Completed",
	frontmatterKeys: ["date", "created", "completed", "completed-on", "day"],
	useFileName: true,
	useFrontmatter: true,
	useTitle: true,
	organizeOnChange: true,
	organizeOnStartup: false,
	recurseIntoOtherFolders: false,
	markdownOnly: true,
	dryRun: false,
	conflictStrategy: "rename",
	showRibbonIcon: true,
};

export class CompletedOrganizerSettingTab extends PluginSettingTab {
	plugin: CompletedOrganizerPlugin;

	constructor(app: App, plugin: CompletedOrganizerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Folder to organize")
			.setDesc(
				"Vault-relative path. Notes here are filed into year subfolders, e.g. 06 - Completed/2024."
			)
			.addText((text) =>
				text
					.setPlaceholder("06 - Completed")
					.setValue(this.plugin.settings.sourceFolder)
					.onChange(async (value) => {
						this.plugin.settings.sourceFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Where to look for the date").setHeading();

		new Setting(containerEl)
			.setName("File name")
			.setDesc("Read a leading yyyy-mm-dd off the file name, e.g. 2024-03-01 -- Ship it.md.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.useFileName).onChange(async (value) => {
					this.plugin.settings.useFileName = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Front matter")
			.setDesc("Check the front matter keys listed below.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.useFrontmatter).onChange(async (value) => {
					this.plugin.settings.useFrontmatter = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Front matter keys")
			.setDesc("Comma separated, checked in order. A `title` key is always checked too.")
			.addText((text) =>
				text
					.setPlaceholder("date, created, completed")
					.setValue(this.plugin.settings.frontmatterKeys.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.frontmatterKeys = value
							.split(",")
							.map((key) => key.trim())
							.filter((key) => key.length > 0);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Title")
			.setDesc("Fall back to the first level-one heading in the note.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.useTitle).onChange(async (value) => {
					this.plugin.settings.useTitle = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Organize automatically")
			.setDesc("File notes as they are created or renamed inside the folder.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.organizeOnChange).onChange(async (value) => {
					this.plugin.settings.organizeOnChange = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Organize on startup")
			.setDesc("Sweep the whole folder once when Obsidian finishes loading.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.organizeOnStartup).onChange(async (value) => {
					this.plugin.settings.organizeOnStartup = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Dry run")
			.setDesc("Report what would move in the developer console without moving anything.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange(async (value) => {
					this.plugin.settings.dryRun = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("When a note of the same name already exists")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("rename", "Move it and add a numeric suffix")
					.addOption("skip", "Leave it where it is")
					.setValue(this.plugin.settings.conflictStrategy)
					.onChange(async (value) => {
						this.plugin.settings.conflictStrategy = value as ConflictStrategy;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Markdown only")
			.setDesc("Leave attachments and other file types alone.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.markdownOnly).onChange(async (value) => {
					this.plugin.settings.markdownOnly = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Descend into non-year subfolders")
			.setDesc(
				"Off: only loose notes and notes already in a year folder are considered. On: every subfolder is flattened into year folders."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.recurseIntoOtherFolders)
					.onChange(async (value) => {
						this.plugin.settings.recurseIntoOtherFolders = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show ribbon icon")
			.setDesc("Requires a reload of the plugin to take effect.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (value) => {
					this.plugin.settings.showRibbonIcon = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
