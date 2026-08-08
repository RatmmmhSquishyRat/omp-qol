/**
 * Deterministic project-local installer for omp-qol-plugin.
 *
 * Faithfully replicates the PROJECT-SIDE artifacts that the host's
 * MarketplaceManager.installPlugin(scope:"project") would produce, without
 * touching global ~/.omp at all (no marketplaces.json entry, no global
 * cache). See docs/researches/omp-project-scoped-plugins.md §5.4.
 *
 * Artifacts written (all under test-workspace/.omp/plugins/):
 *   1. cache/local/omp-qol-plugin/<version>/      plugin content copy
 *      (installPath MUST point here — never at the source repo, because
 *      host uninstallPlugin fs.rm's installPath)
 *   2. node_modules/omp-qol-plugin                junction -> the copy
 *   3. omp-plugins.lock.json                      runtime enablement entry
 *   4. installed_plugins.json                     UI-visible registry entry
 *   (+ root package.json dependency pin)
 *
 * Idempotent: re-run to refresh after source changes (bumps nothing unless
 * package.json version changed; content is always re-copied).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, ".."); // repos/omp-qol
const pluginSource = path.join(repoRoot, "plugin");
const pluginsRoot = path.join(repoRoot, "test-workspace", ".omp", "plugins");

const MARKETPLACE_NAME = "local";
const PLUGIN_ID = "omp-qol-plugin@local";

// ── 1. Read source manifest ─────────────────────────────────────────────
const sourcePkg = JSON.parse(await Bun.file(path.join(pluginSource, "package.json")).text());
const packageName: string = sourcePkg.name;
const version: string = sourcePkg.version;
if (!packageName || !version) throw new Error("source package.json missing name/version");

const cachePath = path.join(pluginsRoot, "cache", MARKETPLACE_NAME, packageName, version);

// ── 2. Copy plugin content into the project-local cache ────────────────
await fs.rm(cachePath, { recursive: true, force: true });
await fs.mkdir(cachePath, { recursive: true });
// Runtime payload = manifest + extension entry points. Tests/dev files are
// deliberately excluded from the installed artifact.
await fs.copyFile(path.join(pluginSource, "package.json"), path.join(cachePath, "package.json"));
await fs.cp(path.join(pluginSource, "src"), path.join(cachePath, "src"), { recursive: true });
for (const optional of ["README.md", "LICENSE", "tsconfig.json"]) {
	await fs.copyFile(path.join(pluginSource, optional), path.join(cachePath, optional)).catch(() => {});
}

// ── 3. Re-point the runtime junction at the cache copy ─────────────────
const linkPath = path.join(pluginsRoot, "node_modules", packageName);
await fs.mkdir(path.dirname(linkPath), { recursive: true });
try {
	const stat = await fs.lstat(linkPath);
	if (stat.isSymbolicLink()) {
		// unlink removes only the junction/reparse point, never the target
		await fs.unlink(linkPath);
	} else {
		throw new Error(`unexpected non-link at ${linkPath} — refusing to delete`);
	}
} catch (err) {
	if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
// Same call the host uses (#registerRuntimePlugin, marketplace/manager.ts:830)
await fs.symlink(cachePath, linkPath, process.platform === "win32" ? "junction" : "dir");

// ── 4. Runtime lockfile entry ───────────────────────────────────────────
const lockPath = path.join(pluginsRoot, "omp-plugins.lock.json");
let lock: { plugins: Record<string, unknown>; settings: Record<string, unknown> } = {
	plugins: {},
	settings: {},
};
try {
	lock = JSON.parse(await Bun.file(lockPath).text());
} catch {
	// first run — defaults are fine
}
const previous = (lock.plugins[packageName] ?? {}) as { enabledFeatures?: string[] | null; enabled?: boolean };
lock.plugins[packageName] = {
	version,
	enabledFeatures: previous.enabledFeatures ?? null,
	enabled: previous.enabled ?? true,
};
await Bun.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

// ── 5. Root package.json dependency pin ────────────────────────────────
const rootPkgPath = path.join(pluginsRoot, "package.json");
let rootPkg: { dependencies?: Record<string, string> } = {};
try {
	rootPkg = JSON.parse(await Bun.file(rootPkgPath).text());
} catch {
	// fresh root
}
rootPkg.dependencies = { ...(rootPkg.dependencies ?? {}), [packageName]: version };
await Bun.write(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);

// ── 6. UI-visible installed registry (project scope) ───────────────────
const registryPath = path.join(pluginsRoot, "installed_plugins.json");
type Entry = {
	scope: "user" | "project";
	installPath: string;
	version: string;
	installedAt: string;
	lastUpdated: string;
	enabled?: boolean;
};
let registry: { version: number; plugins: Record<string, Entry[]> } = { version: 2, plugins: {} };
try {
	registry = JSON.parse(await Bun.file(registryPath).text());
} catch {
	// fresh registry
}
const now = new Date().toISOString();
const existing = registry.plugins[PLUGIN_ID]?.[0];
registry.plugins[PLUGIN_ID] = [
	{
		scope: "project",
		installPath: cachePath,
		version,
		installedAt: existing?.installedAt ?? now,
		lastUpdated: now,
		...(existing?.enabled === false ? { enabled: false } : {}),
	},
];
await Bun.write(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

console.log(`installed ${PLUGIN_ID} v${version} (scope=project)`);
console.log(`  content:  ${cachePath}`);
console.log(`  junction: ${linkPath} -> cache copy`);
console.log(`  registry: ${registryPath}`);
console.log("VERDICT: PASS");
