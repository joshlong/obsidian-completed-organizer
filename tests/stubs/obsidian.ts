/**
 * Just enough of the Obsidian API for the organizer to run outside Obsidian.
 * tests/build.mjs aliases the real `obsidian` import to this file.
 */

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class App {}
export class Plugin {}
export class Notice {}
export class Modal {}
export class PluginSettingTab {}
export class Setting {}
