/**
 * Isolated official installer for omp-qol-plugin.
 *
 * Default: `omp plugin install omp-qol-plugin` (published npm).
 * Opt-in:  `--from-source` → `omp plugin install <repo>/plugin`.
 *
 * Isolation is mandatory. This script never writes live ~/.omp or
 * test-workspace/.omp. Live omp sessions must not be pointed at the
 * isolated root you pass here.
 *
 * Usage:
 *   bun .sandbox/install-plugin.ts --isolated-root .omp-qol-<id>
 *   bun .sandbox/install-plugin.ts --isolated-root .omp-qol-<id> --from-source
 *   bun .sandbox/install-plugin.ts --isolated-home <abs-scratch-home>
 */

import { parseIsolationFlags, resolveIsolation, runOfficialInstall } from "./lib/official-install.ts";

const flags = parseIsolationFlags(process.argv.slice(2));
let isolation;
try {
	isolation = resolveIsolation({ isolatedRoot: flags.isolatedRoot, isolatedHome: flags.isolatedHome });
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(2);
}

const result = runOfficialInstall(isolation, { fromSource: flags.fromSource, dryRun: flags.dryRun });
if (result.stdout.trim()) console.log(result.stdout.trimEnd());
if (result.stderr.trim()) console.error(result.stderr.trimEnd());
if (result.status !== 0) {
	console.error(`official install failed (${result.status}): omp plugin install ${result.spec}`);
	process.exit(result.status);
}

console.log(`official install: omp plugin install ${result.spec}${flags.dryRun ? " --dry-run" : ""}`);
console.log(`  isolation: ${isolation.kind} home=${isolation.home} PI_CONFIG_DIR=${isolation.configDirName}`);
console.log(`  plugins:   ${isolation.pluginsDir}`);
console.log("VERDICT: PASS");
