import { App, Modal } from "obsidian";
import { OrganizeReport, summarize } from "./organizer";

/** Shows the outcome of a sweep, mostly useful for dry runs. */
export class ReportModal extends Modal {
	constructor(
		app: App,
		private report: OrganizeReport,
		private title: string
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", { text: summarize(this.report) });

		if (this.report.moved.length) {
			contentEl.createEl("h3", {
				text: this.report.dryRun ? "Would move" : "Moved",
			});
			const list = contentEl.createEl("ul");
			for (const move of this.report.moved) {
				list.createEl("li", { text: `${move.from} → ${move.to}  (${move.source})` });
			}
		}

		this.section("Left alone (no yyyy-mm-dd found)", this.report.skippedNoDate);
		this.section("Left alone (a note of that name already exists)", this.report.skippedConflict);

		if (this.report.errors.length) {
			contentEl.createEl("h3", { text: "Errors" });
			const list = contentEl.createEl("ul");
			for (const error of this.report.errors) {
				list.createEl("li", { text: `${error.path}: ${error.message}` });
			}
		}
	}

	private section(heading: string, paths: string[]): void {
		if (!paths.length) return;
		this.contentEl.createEl("h3", { text: heading });
		const list = this.contentEl.createEl("ul");
		for (const path of paths) {
			list.createEl("li", { text: path });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
