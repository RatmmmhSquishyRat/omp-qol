/**
 * Registry visibility probe — asserts BOTH independent surfaces the host
 * exposes for plugins (see docs/researches/omp-project-scoped-plugins.md §5.4):
 *   1. RUNTIME: getEnabledPlugins(cwd) — feeds extension loading
 *   2. UI:      <project>/.omp/plugins/installed_plugins.json — feeds
 *               /plugins panel, /plugins + /marketplace installed slash
 *               commands, and CLI `omp plugin list`
 * Both are read with the HOST'S OWN functions.
 */
import { resolveOrDefaultProjectRegistryPath } from "../../../ref_repos/oh-my-pi/packages/coding-agent/src/discovery/helpers";
import { getEnabledPlugins } from "../../../ref_repos/oh-my-pi/packages/coding-agent/src/extensibility/plugins/loader";
import { readInstalledPluginsRegistry } from "../../../ref_repos/oh-my-pi/packages/coding-agent/src/extensibility/plugins/marketplace/registry";
import path from "node:path";

const cwd = path.resolve(import.meta.dir, "..", "test-workspace");

// ── Surface 1: runtime registry ─────────────────────────────────────────
const plugins = await getEnabledPlugins(cwd);
for (const p of plugins) {
	console.log(`runtime plugin: ${p.name}@${p.version} scope=${p.scope} enabled=${p.enabled}`);
	console.log(`  path: ${p.path}`);
	console.log(`  manifest.extensions: ${JSON.stringify(p.manifest.extensions)}`);
}
const runtimeOk = plugins.some(p => p.name === "omp-qol-plugin" && p.scope === "project" && p.enabled !== false);

// ── Surface 2: UI installed registry (project scope) ───────────────────
const registryPath = await resolveOrDefaultProjectRegistryPath(cwd);
console.log(`project installed registry: ${registryPath}`);
let uiOk = false;
if (registryPath) {
	const reg = await readInstalledPluginsRegistry(registryPath);
	for (const [id, entries] of Object.entries(reg.plugins)) {
		for (const e of entries) {
			console.log(`ui plugin: ${id} v${e.version} scope=${e.scope} enabled=${e.enabled !== false}`);
			console.log(`  installPath: ${e.installPath}`);
		}
	}
	uiOk = (reg.plugins["omp-qol-plugin@local"] ?? []).some(e => e.scope === "project" && e.enabled !== false);
}

if (runtimeOk && uiOk) {
	console.log("VERDICT: PASS — runtime loadable AND listed in /plugins + `omp plugin list` (project scope)");
	process.exit(0);
}
console.log(`VERDICT: FAIL (runtime=${runtimeOk}, ui=${uiOk})`);
process.exit(1);
