/**
 * Fail if plugin package metadata (and optional git tag) disagree.
 *
 * Usage:
 *   bun .sandbox/check-distribution-metadata.ts
 *   bun .sandbox/check-distribution-metadata.ts --tag v0.3.0
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors: string[] = [];

function fail(message: string): void {
	errors.push(message);
}

const pkgPath = path.join(repoRoot, "plugin", "package.json");
const catalogPath = path.join(repoRoot, ".omp-plugin", "marketplace.json");
const pkg = (await Bun.file(pkgPath).json()) as {
	name?: string;
	version?: string;
	license?: string;
	repository?: { url?: string; directory?: string };
	omp?: { extensions?: string[] };
	files?: string[];
	publishConfig?: { access?: string; registry?: string };
};

if (pkg.name !== "omp-qol-plugin") fail(`plugin package name must be omp-qol-plugin, got ${pkg.name}`);
if (!pkg.version) fail("plugin package.json missing version");
if (pkg.license !== "MIT") fail("plugin package.json license must be MIT");
if (!pkg.repository?.url?.includes("RatmmmhSquishyRat/omp-qol")) {
	fail("plugin package.json repository.url must point at RatmmmhSquishyRat/omp-qol");
}
if (pkg.repository?.directory !== "plugin") fail("plugin package.json repository.directory must be plugin");
if (!pkg.omp?.extensions?.includes("./src/main.ts")) fail("omp.extensions must include ./src/main.ts");
if (!pkg.files?.includes("src")) fail("package.json files must include src");
if (pkg.publishConfig?.access !== "public") fail("publishConfig.access must be public");
if (pkg.publishConfig?.registry !== "https://registry.npmjs.org/") {
	fail("publishConfig.registry must be https://registry.npmjs.org/");
}

if (await Bun.file(catalogPath).exists()) {
	fail(".omp-plugin/marketplace.json must not exist; npm is the default user channel");
}

const tagArgIndex = process.argv.indexOf("--tag");
if (tagArgIndex >= 0) {
	const tag = process.argv[tagArgIndex + 1] ?? "";
	const expected = `v${pkg.version}`;
	if (tag !== expected) fail(`git tag ${tag} must equal ${expected}`);
}

if (errors.length > 0) {
	for (const error of errors) console.error(`FAIL: ${error}`);
	process.exit(1);
}

console.log(`distribution metadata ok (omp-qol-plugin@${pkg.version})`);
console.log("VERDICT: PASS");
