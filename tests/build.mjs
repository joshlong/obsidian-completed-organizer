/**
 * Bundles the *.spec.ts tests, aliasing the `obsidian` import to a stub, so the
 * real Organizer can run under `node --test` outside Obsidian. Plain *.test.ts
 * files don't need this and run directly.
 */
import esbuild from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, "build");

rmSync(outdir, { recursive: true, force: true });

const specs = readdirSync(here)
	.filter((name) => name.endsWith(".spec.ts"))
	.map((name) => path.join(here, name));

if (specs.length === 0) process.exit(0);

await esbuild.build({
	entryPoints: specs,
	outdir,
	outExtension: { ".js": ".test.mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	sourcemap: "inline",
	logLevel: "warning",
	external: ["node:*"],
	alias: { obsidian: path.join(here, "stubs", "obsidian.ts") },
});
