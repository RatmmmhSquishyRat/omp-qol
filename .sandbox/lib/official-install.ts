/**
 * Isolated official installer for omp-qol-plugin.
 *
 * Default command: `omp plugin install omp-qol-plugin` (npm).
 * Opt-in: `--from-source` → `omp plugin install <repo>/plugin`.
 *
 * Refuses the live user root (~/.omp) and test-workspace/.omp.
 * Isolation is mandatory: `--isolated-root .omp-qol-*` (PI_CONFIG_DIR name
 * under the current homedir) or `--isolated-home <abs>` (fake HOME).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "omp-qol-plugin";
export const PACKAGE_SPEC = "omp-qol-plugin";
export const LIVE_CONFIG_NAME = ".omp";
export const ISOLATED_NAME_PREFIX = ".omp-qol-";

const libDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(libDir, "..", "..");
export const pluginDir = path.join(repoRoot, "plugin");
export const testWorkspaceDir = path.join(repoRoot, "test-workspace");

export const CREDENTIAL_FILES = [
	"agent.db",
	"agent.db-wal",
	"agent.db-shm",
	"models.db",
	"models.db-wal",
	"models.db-shm",
	"models.yml",
	"models.yaml",
	".env",
	"kimi-device-id",
] as const;

export type Isolation = {
	kind: "config-name" | "home";
	home: string;
	configDirName: string;
	configRoot: string;
	pluginsDir: string;
	env: Record<string, string | undefined>;
};

export type IsolationFlags = {
	isolatedRoot?: string;
	isolatedHome?: string;
	fromSource: boolean;
	dryRun: boolean;
	install: boolean;
};

export function usageText(): string {
	return [
		"Isolation is required. Refuses live ~/.omp and test-workspace/.omp.",
		"",
		"  bun .sandbox/install-plugin.ts --isolated-root .omp-qol-<id>",
		"  bun .sandbox/install-plugin.ts --isolated-root .omp-qol-<id> --from-source",
		"  bun .sandbox/install-plugin.ts --isolated-home <abs-scratch-home>",
		"",
		"Default command: omp plugin install omp-qol-plugin",
		"--from-source is opt-in for unpublished local edits (omp plugin install <repo>/plugin).",
		"Do not run this against a live omp session's config root.",
	].join("\n");
}

export function parseIsolationFlags(argv: string[]): IsolationFlags {
	const flags: IsolationFlags = { fromSource: false, dryRun: false, install: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--isolated-root") flags.isolatedRoot = argv[++i];
		else if (arg === "--isolated-home") flags.isolatedHome = argv[++i];
		else if (arg === "--from-source") flags.fromSource = true;
		else if (arg === "--dry-run") flags.dryRun = true;
		else if (arg === "--install") flags.install = true;
		else if (arg === "--help" || arg === "-h") {
			console.log(usageText());
			process.exit(0);
		}
	}
	return flags;
}

export function envConfigDirIfSafe(): string | undefined {
	const value = process.env.PI_CONFIG_DIR;
	if (value && value !== LIVE_CONFIG_NAME && value.startsWith(ISOLATED_NAME_PREFIX)) return value;
	return undefined;
}

function samePath(a: string, b: string): boolean {
	return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function isInside(parent: string, child: string): boolean {
	const rel = path.relative(path.resolve(parent), path.resolve(child));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function liveConfigRoot(home = os.homedir()): string {
	return path.resolve(home, LIVE_CONFIG_NAME);
}

export function livePluginsDir(home = os.homedir()): string {
	return path.join(liveConfigRoot(home), "plugins");
}

function assertSafeIsolation(home: string, configDirName: string, configRoot: string, pluginsDir: string): void {
	const liveRoot = liveConfigRoot();
	const livePlugins = livePluginsDir();
	const testWsOmp = path.join(testWorkspaceDir, LIVE_CONFIG_NAME);

	if (!configDirName || configDirName === "." || configDirName === "..") {
		throw new Error(`invalid isolated config dir name: ${JSON.stringify(configDirName)}`);
	}
	if (samePath(home, os.homedir()) && configDirName === LIVE_CONFIG_NAME) {
		throw new Error("refusing live ~/.omp — pass --isolated-root .omp-qol-<id> or --isolated-home <scratch>");
	}
	if (samePath(home, os.homedir()) && !configDirName.startsWith(ISOLATED_NAME_PREFIX)) {
		throw new Error(`under the live homedir, PI_CONFIG_DIR must start with ${ISOLATED_NAME_PREFIX} (got ${configDirName})`);
	}
	if (samePath(configRoot, liveRoot) || samePath(pluginsDir, livePlugins) || isInside(liveRoot, pluginsDir)) {
		throw new Error(`refusing live user plugin root: ${pluginsDir}`);
	}
	if (isInside(testWsOmp, configRoot) || isInside(testWsOmp, pluginsDir) || samePath(configRoot, testWsOmp)) {
		throw new Error(`refusing test-workspace/.omp (live sessions may be reading it): ${configRoot}`);
	}
	if (isInside(testWorkspaceDir, home)) {
		throw new Error(`refusing isolated HOME inside test-workspace: ${home}`);
	}
}

export function resolveIsolation(opts: { isolatedRoot?: string; isolatedHome?: string } = {}): Isolation {
	const isolatedHome = opts.isolatedHome ? path.resolve(opts.isolatedHome) : undefined;
	const isolatedRoot = opts.isolatedRoot ?? (isolatedHome ? undefined : envConfigDirIfSafe());

	if (!isolatedHome && !isolatedRoot) {
		throw new Error(usageText());
	}

	if (isolatedHome) {
		if (samePath(isolatedHome, os.homedir())) {
			throw new Error(`--isolated-home must not be the live homedir: ${isolatedHome}`);
		}
		const configDirName = isolatedRoot ?? LIVE_CONFIG_NAME;
		const configRoot = path.resolve(isolatedHome, configDirName);
		const pluginsDir = path.join(configRoot, "plugins");
		assertSafeIsolation(isolatedHome, configDirName, configRoot, pluginsDir);
		const env: Record<string, string | undefined> = {
			...process.env,
			HOME: isolatedHome,
			USERPROFILE: isolatedHome,
			PI_CONFIG_DIR: configDirName,
		};
		delete env.PI_CODING_AGENT_DIR;
		delete env.OMP_PROFILE;
		delete env.PI_PROFILE;
		return { kind: "home", home: isolatedHome, configDirName, configRoot, pluginsDir, env };
	}

	const configDirName = isolatedRoot as string;
	const home = os.homedir();
	const configRoot = path.resolve(home, configDirName);
	const pluginsDir = path.join(configRoot, "plugins");
	assertSafeIsolation(home, configDirName, configRoot, pluginsDir);
	const env: Record<string, string | undefined> = { ...process.env, PI_CONFIG_DIR: configDirName };
	delete env.PI_CODING_AGENT_DIR;
	delete env.OMP_PROFILE;
	delete env.PI_PROFILE;
	return { kind: "config-name", home, configDirName, configRoot, pluginsDir, env };
}

export function installSpec(fromSource: boolean): string {
	return fromSource ? pluginDir : PACKAGE_SPEC;
}

function parseJsonFromOutput(text: string): unknown {
	const start = text.indexOf("{");
	if (start < 0) throw new Error(`no JSON in omp output: ${text.slice(0, 400)}`);
	return JSON.parse(text.slice(start));
}

export function runOmp(isolation: Isolation, args: string[]): { stdout: string; stderr: string; status: number } {
	const result = Bun.spawnSync(["omp", ...args], {
		cwd: repoRoot,
		env: isolation.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		status: result.exitCode ?? 1,
	};
}

export function runOfficialInstall(
	isolation: Isolation,
	opts: { fromSource?: boolean; dryRun?: boolean } = {},
): { spec: string; stdout: string; stderr: string; status: number } {
	fs.mkdirSync(isolation.configRoot, { recursive: true });
	const spec = installSpec(opts.fromSource === true);
	const args = ["plugin", "install", spec];
	if (opts.dryRun) args.push("--dry-run");
	const result = runOmp(isolation, args);
	return { spec, ...result };
}

export function listPluginsJson(isolation: Isolation): { npm?: Array<{ name?: string; version?: string; enabled?: boolean; path?: string }>; marketplace?: unknown[] } {
	const result = runOmp(isolation, ["plugin", "list", "--json"]);
	if (result.status !== 0) {
		throw new Error(`omp plugin list --json failed (${result.status}): ${result.stderr || result.stdout}`);
	}
	return parseJsonFromOutput(result.stdout) as {
		npm?: Array<{ name?: string; version?: string; enabled?: boolean; path?: string }>;
		marketplace?: unknown[];
	};
}

export function liveUserPluginPresent(): boolean {
	const pkg = path.join(livePluginsDir(), "node_modules", PACKAGE_NAME, "package.json");
	return fs.existsSync(pkg);
}

export async function seedIsolatedAgentDir(
	isolatedRoot: string,
	realConfigRoot: string,
	configYml?: string,
): Promise<Array<{ file: string; bytes: number }>> {
	const agentDir = path.join(isolatedRoot, "agent");
	await fs.promises.mkdir(agentDir, { recursive: true });
	const copied: Array<{ file: string; bytes: number }> = [];
	const realAgentDir = path.join(realConfigRoot, "agent");
	for (const file of CREDENTIAL_FILES) {
		const src = path.join(realAgentDir, file);
		try {
			await fs.promises.copyFile(src, path.join(agentDir, file));
			copied.push({ file, bytes: (await fs.promises.stat(src)).size });
		} catch {
			/* absent on this machine */
		}
	}
	if (configYml !== undefined) {
		await fs.promises.writeFile(path.join(agentDir, "config.yml"), configYml, "utf8");
	}
	return copied;
}

export async function gitInitScratch(ws: string, readme?: string): Promise<void> {
	await fs.promises.mkdir(ws, { recursive: true });
	const git = Bun.spawnSync(["git", "init"], { cwd: ws, stdout: "pipe", stderr: "pipe" });
	if ((git.exitCode ?? 1) !== 0) {
		throw new Error(`git init failed in ${ws}: ${git.stderr.toString()}`);
	}
	if (readme !== undefined) {
		await fs.promises.writeFile(path.join(ws, "README.md"), readme, "utf8");
	}
}
