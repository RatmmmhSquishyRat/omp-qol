/**
 * Dev-environment linker: junctions the oh-my-pi monorepo packages into
 * plugin/node_modules/@oh-my-pi/* so the integration tests share ONE module
 * instance with the host source (the source-link condition they target).
 *
 * The plugin's RUNTIME delivery never needs this — the installed host
 * injects its own namespace. These links serve `bun test` only.
 *
 * Usage: bun .sandbox/link-dev-deps.ts   (idempotent; requires junction
 * privilege on Windows — run outside any filesystem sandbox)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.resolve(repoRoot, "..", "..", "ref_repos", "oh-my-pi", "packages");
const linkRoot = path.join(repoRoot, "plugin", "node_modules", "@oh-my-pi");

if (!fs.existsSync(packagesDir)) {
	throw new Error(`monorepo packages not found at ${packagesDir}`);
}
fs.mkdirSync(linkRoot, { recursive: true });

let linked = 0;
for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const pkgDir = path.join(packagesDir, entry.name);
	const manifestPath = path.join(pkgDir, "package.json");
	if (!fs.existsSync(manifestPath)) continue;
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string };
	if (!manifest.name?.startsWith("@oh-my-pi/")) continue;
	const shortName = manifest.name.slice("@oh-my-pi/".length);
	const linkPath = path.join(linkRoot, shortName);
	const stat = fs.lstatSync(linkPath, { throwIfNoEntry: false });
	if (stat?.isSymbolicLink()) {
		if (fs.realpathSync(linkPath) === fs.realpathSync(pkgDir)) continue; // already correct
		fs.unlinkSync(linkPath); // repoint a stale link; unlink never touches the target
	} else if (stat) {
		throw new Error(`unexpected non-link at ${linkPath} — refusing to replace`);
	}
	fs.symlinkSync(pkgDir, linkPath, process.platform === "win32" ? "junction" : "dir");
	console.log(`linked @oh-my-pi/${shortName}`);
	linked += 1;
}
console.log(linked === 0 ? "dev links already up to date" : `${linked} dev link(s) created`);
