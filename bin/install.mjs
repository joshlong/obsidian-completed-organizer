/**
 * Copies the built plugin into a vault: `npm run install-plugin -- /path/to/vault`.
 * Falls back to $OBSIDIAN_VAULT, then to the vault Obsidian itself has open.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'completed-organizer';
const REQUIRED = ['main.js', 'manifest.json'];
const OPTIONAL = ['styles.css'];

/** Obsidian keeps the list of known vaults here; the most recently opened one wins. */
async function lastOpenedVault() {
	const configs = [
		path.join(homedir(), 'Library/Application Support/obsidian/obsidian.json'),
		path.join(homedir(), '.config/obsidian/obsidian.json'),
		path.join(process.env.APPDATA ?? '', 'obsidian/obsidian.json'),
	];
	for (const config of configs) {
		if (!existsSync(config)) continue;
		const vaults = Object.values(JSON.parse(await readFile(config, 'utf8')).vaults ?? {});
		const newest = vaults.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0];
		if (newest?.path) return newest.path;
	}
	return null;
}

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const vault = process.argv[2] ?? process.env.OBSIDIAN_VAULT ?? (await lastOpenedVault());

if (!vault) {
	console.error('usage: npm run install-plugin -- /path/to/vault');
	process.exit(1);
}
if (!existsSync(path.join(vault, '.obsidian'))) {
	console.error(vault + " doesn't look like an Obsidian vault (no .obsidian folder)");
	process.exit(1);
}
if (!existsSync(path.join(root, 'main.js'))) {
	console.error('main.js is missing — run `npm run build` first');
	process.exit(1);
}

const target = path.join(vault, '.obsidian', 'plugins', PLUGIN_ID);
await mkdir(target, { recursive: true });
for (const file of REQUIRED) await copyFile(path.join(root, file), path.join(target, file));
for (const file of OPTIONAL) {
	if (existsSync(path.join(root, file))) {
		await copyFile(path.join(root, file), path.join(target, file));
	}
}

console.log(`installed ${PLUGIN_ID} into ` + target);
console.log('enable it under Settings → Community plugins (reload Obsidian if it was already on)');
