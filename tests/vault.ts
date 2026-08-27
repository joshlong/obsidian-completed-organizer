/**
 * An in-memory stand-in for the bits of the vault the organizer touches, so the
 * real Organizer can be driven over a made-up folder tree.
 */
import { TAbstractFile, TFile, TFolder } from "obsidian";

export interface FakeCache {
	frontmatter?: Record<string, unknown>;
	headings?: { level: number; heading: string }[];
}

export class FakeVault {
	readonly index = new Map<string, TAbstractFile>();
	readonly root: TFolder;
	/** Every move the organizer performed, oldest first. */
	readonly moves: { from: string; to: string }[] = [];
	private caches = new Map<string, FakeCache>();

	constructor(paths: string[]) {
		this.root = new TFolder();
		this.root.path = "";
		this.root.name = "";
		this.index.set("", this.root);
		for (const path of paths) this.add(path);
	}

	/** `a/b/` makes a folder, `a/b.md` makes a file; parents are created as needed. */
	add(path: string): TAbstractFile {
		const isFolder = path.endsWith("/");
		const clean = isFolder ? path.slice(0, -1) : path;
		const existing = this.index.get(clean);
		if (existing) return existing;

		const cut = clean.lastIndexOf("/");
		const parentPath = cut === -1 ? "" : clean.slice(0, cut);
		const name = clean.slice(cut + 1);
		const parent = (cut === -1 ? this.root : this.add(`${parentPath}/`)) as TFolder;

		const item = isFolder ? new TFolder() : new TFile();
		item.path = clean;
		item.name = name;
		item.parent = parent;
		if (item instanceof TFile) {
			const dot = name.lastIndexOf(".");
			item.basename = dot === -1 ? name : name.slice(0, dot);
			item.extension = dot === -1 ? "" : name.slice(dot + 1);
		}
		parent.children.push(item);
		this.index.set(clean, item);
		return item;
	}

	setCache(path: string, cache: FakeCache): void {
		this.caches.set(path, cache);
	}

	/** Paths of everything in the vault, sorted — the shape assertions compare against this. */
	snapshot(): string[] {
		return [...this.index.keys()].filter(Boolean).sort();
	}

	/** Reparents an item and rewrites the paths of everything beneath it. */
	private reindex(item: TAbstractFile, newPath: string): void {
		this.index.delete(item.path);
		item.path = newPath;
		this.index.set(newPath, item);
		if (item instanceof TFolder) {
			for (const child of item.children) {
				this.reindex(child, `${newPath}/${child.name}`);
			}
		}
	}

	/** The subset of `App` the organizer actually calls. */
	get app() {
		const vault = this;
		return {
			vault: {
				getAbstractFileByPath(path: string): TAbstractFile | null {
					return vault.index.get(path) ?? null;
				},
				async createFolder(path: string): Promise<TFolder> {
					if (vault.index.has(path)) throw new Error(`already exists: ${path}`);
					return vault.add(`${path}/`) as TFolder;
				},
			},
			fileManager: {
				async renameFile(item: TAbstractFile, newPath: string): Promise<void> {
					const cut = newPath.lastIndexOf("/");
					const parentPath = cut === -1 ? "" : newPath.slice(0, cut);
					const parent = vault.index.get(parentPath);
					if (!(parent instanceof TFolder)) {
						throw new Error(`no such folder: ${parentPath}`);
					}
					if (vault.index.has(newPath)) throw new Error(`already exists: ${newPath}`);

					const from = item.path;
					if (item.parent) {
						item.parent.children = item.parent.children.filter((c) => c !== item);
					}
					parent.children.push(item);
					item.parent = parent;
					item.name = newPath.slice(cut + 1);
					if (item instanceof TFile) {
						const dot = item.name.lastIndexOf(".");
						item.basename = dot === -1 ? item.name : item.name.slice(0, dot);
						item.extension = dot === -1 ? "" : item.name.slice(dot + 1);
					}
					vault.reindex(item, newPath);
					vault.moves.push({ from, to: newPath });
				},
			},
			metadataCache: {
				getFileCache(file: TFile): FakeCache | null {
					return vault.caches.get(file.path) ?? null;
				},
			},
		};
	}
}
