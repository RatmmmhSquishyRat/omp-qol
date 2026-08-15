/**
 * Thin wrappers around the native advisor/config helpers and the barrel
 * utilities used for path resolution.
 *
 * Import contract (locked by probe, step 2):
 *   - File helpers: @oh-my-pi/pi-coding-agent/advisor/config
 *   - getAgentDir / repo: @oh-my-pi/pi-coding-agent
 *
 * No YAML serializer lives here. No advisor barrel. If either import fails
 * the wrappers below throw honestly — callers must surface that, not swallow
 * it into a silent YAML writer (ADR-005 §Decision 1).
 */

import {
	discoverAdvisorConfigs,
	loadWatchdogConfigFile,
	resolveAdvisorConfigEditPath,
	saveWatchdogConfigFile,
	slugifyAdvisorName,
	type AdvisorConfig,
	type WatchdogConfigDoc,
} from "@oh-my-pi/pi-coding-agent/advisor/config";
import { BUILTIN_TOOL_NAMES, normalizeToolNames } from "@oh-my-pi/pi-coding-agent/tools/builtin-names";
import { getAgentDir, repo } from "@oh-my-pi/pi-coding-agent";

export type { AdvisorConfig, WatchdogConfigDoc };

/**
 * The host's own advisor-name slugifier (advisor/config.ts): lowercase,
 * non-[a-z0-9] runs collapse to "-", trimmed; names with NO ascii letters
 * or digits (e.g. pure CJK) all fall back to the shared slug "advisor".
 * Re-exported so the tool's name matching can never drift from discovery.
 */
export function nativeSlugifyAdvisorName(name: string): string {
	return slugifyAdvisorName(name);
}

/**
 * The host's tool-name normalizer (lowercase + legacy aliases + dedupe,
 * first-seen order) and the built-in name list — the exact inputs the host's
 * discovery-time `filterAdvisorTools` uses to drop unknown names.
 */
export function nativeNormalizeToolNames(names: Iterable<string>): string[] {
	return normalizeToolNames(names);
}

export function nativeBuiltinToolNames(): readonly string[] {
	return BUILTIN_TOOL_NAMES;
}

/** Discover + merge advisors from user + project WATCHDOG files. */
export async function nativeDiscoverAdvisors(
	cwd: string,
	agentDir: string,
): Promise<{ advisors: AdvisorConfig[]; sharedInstructions: string | undefined }> {
	return discoverAdvisorConfigs(cwd, agentDir);
}

/** Load one WATCHDOG.yml raw (no merge, no @import expansion). */
export async function nativeLoadConfigFile(filePath: string): Promise<WatchdogConfigDoc> {
	return loadWatchdogConfigFile(filePath);
}

/**
 * Serialize and save (or delete when empty) one WATCHDOG.yml.
 * Uses the native serializer — never a hand-written YAML encoder.
 */
export async function nativeSaveConfigFile(filePath: string, doc: WatchdogConfigDoc): Promise<void> {
	return saveWatchdogConfigFile(filePath, doc);
}

/**
 * Resolve which WATCHDOG.{yml,yaml} to edit for a scope.
 * Prefers `.yml`; falls back to `.yaml` only when that is the existing file.
 */
export async function nativeResolveEditPath(
	scope: "project" | "user",
	dirs: { projectDir: string; agentDir: string },
): Promise<string> {
	return resolveAdvisorConfigEditPath(scope, dirs);
}

/**
 * Synchronous: the agent's global config directory (e.g. ~/.omp/agent).
 * Reads PI_CODING_AGENT_DIR env var or falls back to the default platform path.
 */
export function nativeGetAgentDir(): string {
	return getAgentDir();
}

/**
 * The project root for the given cwd: walks up to the nearest git root,
 * or returns cwd when no git root is found. Mirrors the TUI's resolution.
 */
export async function nativeGetProjectDir(cwd: string): Promise<string> {
	return (await repo.root(cwd)) ?? cwd;
}
