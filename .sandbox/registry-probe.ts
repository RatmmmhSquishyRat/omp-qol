/**
 * Official-install visibility probe.
 *
 * Asserts the host CLI npm list surface after `omp plugin install omp-qol-plugin`
 * into an isolated config root. Does not import host modules (those freeze
 * PI_CONFIG_DIR at first use). Does not read live ~/.omp or test-workspace/.omp
 * as the expected install.
 *
 * Usage:
 *   bun .sandbox/registry-probe.ts --isolated-root .omp-qol-<id>
 *   bun .sandbox/registry-probe.ts --isolated-home <abs-scratch-home>
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	PACKAGE_NAME,
	listPluginsJson,
	parseIsolationFlags,
	resolveIsolation,
	usageText,
} from "./lib/official-install.ts";

const flags = parseIsolationFlags(process.argv.slice(2));
let isolation;
try {
	isolation = resolveIsolation({ isolatedRoot: flags.isolatedRoot, isolatedHome: flags.isolatedHome });
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	if (!flags.isolatedRoot && !flags.isolatedHome) console.error(`\n${usageText()}`);
	process.exit(2);
}

const listed = listPluginsJson(isolation);
const npm = listed.npm ?? [];
for (const plugin of npm) {
	console.log(`npm plugin: ${plugin.name}@${plugin.version} enabled=${plugin.enabled !== false}`);
	if (plugin.path) console.log(`  path: ${plugin.path}`);
}

const marketplace = listed.marketplace ?? [];
if (marketplace.length > 0) {
	console.log(`marketplace entries: ${marketplace.length} (not the default install story)`);
}

const npmOk = npm.some(plugin => plugin.name === PACKAGE_NAME && plugin.enabled !== false);
const modulePath = path.join(isolation.pluginsDir, "node_modules", PACKAGE_NAME, "package.json");
const fsOk = fs.existsSync(modulePath);
console.log(`plugins dir: ${isolation.pluginsDir}`);
console.log(`node_modules package: ${fsOk ? modulePath : "MISSING"}`);

if (npmOk && fsOk) {
	console.log("VERDICT: PASS — omp-qol-plugin listed as npm plugin under the isolated official install");
	process.exit(0);
}
console.log(`VERDICT: FAIL (npm=${npmOk}, fs=${fsOk})`);
process.exit(1);
