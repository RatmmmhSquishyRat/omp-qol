/**
 * L1: Offline unit tests for the advisor tool (mock native helpers + fake session).
 *
 * Proves:
 *   A1–A6:  Delegation / pairing (op routing to correct native calls)
 *   A7–A12: Defaults and refusals
 *   A13–A15: Result shape + warnings
 *   A16–A18: Registration / approval tiering / kill switch
 *   A19:    Implicit "default" advisor (synthetic entries + normalization)
 *   A20+:   Safety fixes: anti-clobber guard, duplicate slugs, rename/CJK/
 *           unknown-tool/no_model/restart warnings, remove-miss truthfulness,
 *           fileDeleted semantics, per-path mutate serialization, stat pass-through
 *
 * No real YAML parsing of host files. No real AgentSession. Real tmp files are
 * used ONLY by the anti-clobber guard tests (the guard reads raw disk bytes).
 * See docs/plans/TDDs/qol-004-advisor-tool-tests.md for the original matrix.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod/v4";
import {
	ADVISOR_TOOL_NAME,
	registerAdvisorTool,
	type AdvisorToolOptions,
	type NativeHelpers,
} from "../src/advisor-tool";
import type { HostBridge, LiveAdvisorStat } from "../src/lib/host-bridge";
import factory from "../src/main";

// Isolation: test/setup.ts (bun preload) froze PI_CONFIG_DIR onto a pid-scoped
// ~/.omp-qol-test-root-<pid> before any import — nothing here touches ~/.omp.

// =============================================================================
// Mock builders
// =============================================================================

interface ToolResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

/** Parse the JSON envelope from a result's text (skips a summary line if present). */
function parseEnvelope<T = Record<string, unknown>>(result: ToolResult): T {
	const text = result.content[0]?.text ?? "";
	const start = text.indexOf("{");
	if (start < 0) throw new Error(`no JSON in result text: ${text}`);
	return JSON.parse(text.slice(start)) as T;
}

type CallLog = string[];

interface FakeNativeState {
	projectDoc: { advisors: Array<{ name: string; model?: string; tools?: string[]; instructions?: string; enabled?: boolean }>; instructions?: string };
	userDoc: { advisors: Array<{ name: string; model?: string; tools?: string[]; instructions?: string; enabled?: boolean }>; instructions?: string };
	discoveredAdvisors: Array<{ name: string; model?: string; tools?: string[]; instructions?: string; enabled?: boolean }>;
	discoveredShared: string | undefined;
	/** Override the project edit path (guard tests point it at a real tmp file). */
	projectPath?: string;
}

/** Mirror of the host's slugifyAdvisorName (advisor/config.ts). */
function fakeSlugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "advisor";
}

const FAKE_BUILTIN_TOOLS = ["read", "grep", "glob", "bash", "edit", "write"] as const;

function makeFakeNative(
	calls: CallLog,
	state?: Partial<FakeNativeState>,
): NativeHelpers {
	const s: FakeNativeState = {
		projectDoc: { advisors: [] },
		userDoc: { advisors: [] },
		discoveredAdvisors: [],
		discoveredShared: undefined,
		...state,
	};
	const projectPath = s.projectPath ?? "/fake/project/WATCHDOG.yml";
	const userPath = "/fake/agent/WATCHDOG.yml";

	return {
		nativeGetAgentDir() {
			calls.push("nativeGetAgentDir");
			return "/fake/agent";
		},
		async nativeGetProjectDir(_cwd) {
			calls.push("nativeGetProjectDir");
			return "/fake/project";
		},
		async nativeResolveEditPath(scope, _dirs) {
			calls.push(`nativeResolveEditPath:${scope}`);
			return scope === "user" ? userPath : projectPath;
		},
		async nativeLoadConfigFile(filePath) {
			calls.push(`nativeLoadConfigFile:${filePath.includes("agent") ? "user" : "project"}`);
			return filePath.includes("agent")
				? { ...s.userDoc, advisors: [...s.userDoc.advisors] }
				: { ...s.projectDoc, advisors: [...s.projectDoc.advisors] };
		},
		async nativeSaveConfigFile(filePath, doc) {
			calls.push(`nativeSaveConfigFile:${filePath.includes("agent") ? "user" : "project"}`);
			if (filePath.includes("agent")) {
				s.userDoc = { ...doc };
			} else {
				s.projectDoc = { ...doc };
			}
		},
		async nativeDiscoverAdvisors(_cwd, _agentDir) {
			calls.push("nativeDiscoverAdvisors");
			return { advisors: s.discoveredAdvisors, sharedInstructions: s.discoveredShared };
		},
		nativeSlugifyAdvisorName(name) {
			return fakeSlugify(name);
		},
		nativeNormalizeToolNames(names) {
			const out: string[] = [];
			const seen = new Set<string>();
			for (const name of names) {
				const normalized = name.toLowerCase();
				if (seen.has(normalized)) continue;
				seen.add(normalized);
				out.push(normalized);
			}
			return out;
		},
		nativeBuiltinToolNames() {
			return FAKE_BUILTIN_TOOLS;
		},
	};
}

interface FakeSessionState {
	advisorEnabled: boolean;
	applyCount: number;
	stats: { active: boolean; advisors: LiveAdvisorStat[] };
	/** Post-apply status per advisor name (default "running"). */
	postApplyStatus?: Record<string, string>;
}

function makeFakeSession(state?: Partial<FakeSessionState>) {
	const s: FakeSessionState = {
		advisorEnabled: true,
		applyCount: 1,
		// Default: no live runtimes yet (mirrors a real session before any apply).
		stats: { active: false, advisors: [] },
		...state,
	};
	const calls: CallLog = [];

	const session = {
		// plan/vibe surface (unused in advisor ops)
		setPlanModeState: () => { calls.push("setPlanModeState"); },
		getPlanModeState: () => undefined,
		getVibeModeState: () => undefined,
		setVibeModeState: () => {},
		activateVibeTools: async () => {},
		deactivateVibeTools: async () => {},
		getEnabledToolNames: () => [] as string[],
		sessionManager: { getSessionId: () => null, getSessionFile: () => null, appendModeChange: () => {}, getCwd: () => "/fake/cwd" },
		// advisor surface
		applyAdvisorConfigs: (advisors: unknown[]) => {
			calls.push(`applyAdvisorConfigs:${advisors.length}`);
			s.stats.advisors = (advisors as Array<{ name: string }>).map(a => ({
				name: a.name,
				status: s.postApplyStatus?.[a.name] ?? "running",
			}));
			s.stats.active = s.advisorEnabled && s.stats.advisors.some(a => a.status === "running");
			return s.applyCount;
		},
		setAdvisorEnabled: (enabled: boolean) => {
			calls.push(`setAdvisorEnabled:${enabled}`);
			s.advisorEnabled = enabled;
			return enabled;
		},
		isAdvisorEnabled: () => {
			calls.push("isAdvisorEnabled");
			return s.advisorEnabled;
		},
		isAdvisorActive: () => {
			calls.push("isAdvisorActive");
			return s.advisorEnabled && s.stats.active;
		},
		getAdvisorStats: () => {
			calls.push("getAdvisorStats");
			return { active: s.advisorEnabled && s.stats.active, advisors: [...s.stats.advisors] };
		},
		formatAdvisorStatus: () => {
			calls.push("formatAdvisorStatus");
			return `● advisor ${s.advisorEnabled ? "on" : "off"}`;
		},
		formatAdvisorHistoryAsText: (opts?: { compact?: boolean }) => {
			calls.push(`formatAdvisorHistoryAsText:compact=${opts?.compact ?? true}`);
			return opts?.compact === false ? "FULL HISTORY" : "compact history";
		},
	};

	return { session, calls, state: s };
}

function makeAdvisorPi() {
	const tools: Array<{ definition: Record<string, unknown> }> = [];
	const api = {
		zod: z,
		setLabel: () => {},
		logger: { info: () => {}, warn: () => {}, error: () => {} },
		registerTool: (definition: Record<string, unknown>) => tools.push({ definition }),
		registerCommand: () => {},
		on: () => {},
	};
	function advisorTool() {
		const entry = tools.find(t => t.definition.name === ADVISOR_TOOL_NAME);
		if (!entry) throw new Error("advisor tool not registered");
		return entry.definition as {
			name: string;
			label?: string;
			approval?: unknown;
			loadMode?: string;
			description?: string;
			parameters: z.ZodType;
			execute: (
				toolCallId: string,
				params: Record<string, unknown>,
				signal?: AbortSignal,
			) => Promise<ToolResult>;
		};
	}
	return { api, tools, advisorTool };
}

function makeOptions(
	nativeCalls: CallLog,
	nativeState?: Partial<FakeNativeState>,
	sessionState?: Partial<FakeSessionState>,
	extra?: Partial<AdvisorToolOptions>,
): AdvisorToolOptions {
	const { session } = makeFakeSession(sessionState);
	const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
	const native = makeFakeNative(nativeCalls, nativeState);
	return {
		resolveBridge: async () => bridge,
		resolveNative: async () => native,
		getCwd: () => "/fake/cwd",
		...extra,
	};
}

// =============================================================================
// A1: upsert — full save→discover→apply chain (default scope=project)
// =============================================================================

describe("A1: upsert default scope=project chains save→discover→apply", () => {
	test("resolve + load + save + discover + applyAdvisorConfigs in order; setAdvisorEnabled not called", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		const { session, calls: sessionCalls } = makeFakeSession();
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const native = makeFakeNative(calls, {
			discoveredAdvisors: [{ name: "MyAdvisor" }],
		});

		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => native,
			getCwd: () => "/fake/cwd",
		});

		const result = await advisorTool().execute("c", {
			op: "upsert",
			name: "MyAdvisor",
			model: "anthropic/claude-sonnet-4-5",
		});

		expect(result.isError).toBeUndefined();
		// order: GetAgentDir, GetProjectDir, ResolveEditPath, Load, Save, Discover
		expect(calls).toContain("nativeGetAgentDir");
		expect(calls).toContain("nativeGetProjectDir");
		expect(calls).toContain("nativeResolveEditPath:project");
		expect(calls).toContain("nativeLoadConfigFile:project");
		expect(calls).toContain("nativeSaveConfigFile:project");
		expect(calls).toContain("nativeDiscoverAdvisors");
		// order matters: save before discover
		expect(calls.indexOf("nativeSaveConfigFile:project")).toBeLessThan(calls.indexOf("nativeDiscoverAdvisors"));
		// applyAdvisorConfigs is called
		expect(sessionCalls.some(c => c.startsWith("applyAdvisorConfigs"))).toBe(true);
		// setAdvisorEnabled must NOT be called
		expect(sessionCalls.some(c => c.startsWith("setAdvisorEnabled"))).toBe(false);
	});
});

// =============================================================================
// A2: remove / set_shared — same pairing
// =============================================================================

describe("A2: remove and set_shared chain save→discover→apply", () => {
	test("remove: save→discover→apply; setAdvisorEnabled not called", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, {
			projectDoc: { advisors: [{ name: "OldAdvisor" }] },
			discoveredAdvisors: [],
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "remove", name: "OldAdvisor" });
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeSaveConfigFile:project");
		expect(calls).toContain("nativeDiscoverAdvisors");
	});

	test("set_shared: writes top-level instructions then save→discover→apply", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", {
			op: "set_shared",
			shared_instructions: "Always be helpful",
		});
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeSaveConfigFile:project");
		expect(calls).toContain("nativeDiscoverAdvisors");
	});
});

// =============================================================================
// A3: apply — discover + apply only; save not called; persisted=false applied=true
// =============================================================================

describe("A3: standalone apply", () => {
	test("discover + applyAdvisorConfigs only; nativeSaveConfigFile not called; persisted=false applied=true", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "Existing" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "apply" });
		expect(result.isError).toBeUndefined();
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
		expect(calls).toContain("nativeDiscoverAdvisors");
		const parsed = parseEnvelope<{ ok: boolean; persisted: boolean; fileDeleted: boolean; applied: boolean }>(result);
		expect(parsed.ok).toBe(true);
		expect(parsed.persisted).toBe(false);
		expect(parsed.fileDeleted).toBe(false);
		expect(parsed.applied).toBe(true);
	});
});

// =============================================================================
// A4: enable / disable — setAdvisorEnabled only; no discover/save/apply
// =============================================================================

describe("A4: enable/disable do not touch native or apply", () => {
	test("enable calls setAdvisorEnabled(true) only; returns roster summary", async () => {
		const calls: CallLog = [];
		const { session, calls: sessionCalls } = makeFakeSession({ advisorEnabled: false });
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const native = makeFakeNative(calls);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => native,
		});

		const result = await advisorTool().execute("c", { op: "enable" });
		expect(result.isError).toBeUndefined();
		expect(sessionCalls).toContain("setAdvisorEnabled:true");
		expect(calls.length).toBe(0); // no native calls
		expect(sessionCalls.some(c => c.startsWith("applyAdvisorConfigs"))).toBe(false);
		const parsed = parseEnvelope<{
			ok: boolean;
			tool: string;
			op: string;
			enabled: boolean;
			active: boolean;
			running: boolean;
			discovered: boolean;
			activeCount: number;
			advisors: unknown[];
		}>(result);
		expect(parsed.ok).toBe(true);
		expect(parsed.tool).toBe("advisor");
		expect(parsed.op).toBe("enable");
		expect(parsed.enabled).toBe(true);
		expect(parsed.discovered).toBe(false);
		expect(typeof parsed.activeCount).toBe("number");
		expect(Array.isArray(parsed.advisors)).toBe(true);
	});

	test("disable calls setAdvisorEnabled(false) only", async () => {
		const calls: CallLog = [];
		const { session, calls: sessionCalls } = makeFakeSession({ advisorEnabled: true });
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const native = makeFakeNative(calls);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => native,
		});

		const result = await advisorTool().execute("c", { op: "disable" });
		expect(result.isError).toBeUndefined();
		expect(sessionCalls).toContain("setAdvisorEnabled:false");
		expect(calls.length).toBe(0);
		const parsed = parseEnvelope<{ ok: boolean; op: string; enabled: boolean; discovered: boolean }>(result);
		expect(parsed.ok).toBe(true);
		expect(parsed.op).toBe("disable");
		expect(parsed.enabled).toBe(false);
		expect(parsed.discovered).toBe(false);
	});
});

// =============================================================================
// A5: list/get scope variants
// =============================================================================

describe("A5: list and get scope routing", () => {
	test("list scope=project → load project file only", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { projectDoc: { advisors: [{ name: "P" }] } });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "list", scope: "project" });
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeLoadConfigFile:project");
		expect(calls.some(c => c === "nativeDiscoverAdvisors")).toBe(false);
	});

	test("list scope=user → load user file only", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { userDoc: { advisors: [{ name: "U" }] } });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "list", scope: "user" });
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeLoadConfigFile:user");
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
	});

	test("list scope=effective → discover only (no save/apply)", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "E" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "list", scope: "effective" });
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeDiscoverAdvisors");
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
		expect(calls.some(c => c.startsWith("applyAdvisorConfigs"))).toBe(false);
	});

	test("get scope=effective returns discovered entry", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "MyBot" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "get", name: "MyBot" });
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeDiscoverAdvisors");
	});
});

// =============================================================================
// A6: status / dump
// =============================================================================

describe("A6: status and dump", () => {
	test("status calls formatAdvisorStatus + getAdvisorStats", async () => {
		const calls: CallLog = [];
		const { session, calls: sc } = makeFakeSession();
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => makeFakeNative(calls),
		});

		const result = await advisorTool().execute("c", { op: "status" });
		expect(result.isError).toBeUndefined();
		expect(sc).toContain("formatAdvisorStatus");
		expect(sc).toContain("getAdvisorStats");
		expect(calls.length).toBe(0); // no native calls
		expect(result.content[0].text).toContain('"op": "status"');
	});

	test("dump raw=false → compact=true (default); JSON-first body carries history", async () => {
		const calls: CallLog = [];
		const { session, calls: sc } = makeFakeSession();
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => makeFakeNative(calls),
		});

		const result = await advisorTool().execute("c", { op: "dump" });
		expect(sc).toContain("formatAdvisorHistoryAsText:compact=true");
		const parsed = parseEnvelope<{ ok: boolean; op: string; raw: boolean; empty: boolean; history: string }>(result);
		expect(parsed.ok).toBe(true);
		expect(parsed.op).toBe("dump");
		expect(parsed.raw).toBe(false);
		expect(parsed.empty).toBe(false);
		expect(parsed.history).toBe("compact history");
	});

	test("dump raw=true → compact=false", async () => {
		const calls: CallLog = [];
		const { session, calls: sc } = makeFakeSession();
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => makeFakeNative(calls),
		});

		const result = await advisorTool().execute("c", { op: "dump", raw: true });
		expect(sc).toContain("formatAdvisorHistoryAsText:compact=false");
		const parsed = parseEnvelope<{ raw: boolean; history: string }>(result);
		expect(parsed.raw).toBe(true);
		expect(parsed.history).toBe("FULL HISTORY");
	});
});

// =============================================================================
// A7: mutate scope=user
// =============================================================================

describe("A7: mutate with scope=user uses user edit path", () => {
	test("upsert scope=user → save→discover→apply on user path", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "UserAdvisor" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "UserAdvisor", scope: "user" });
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeResolveEditPath:user");
		expect(calls).toContain("nativeSaveConfigFile:user");
		expect(calls).toContain("nativeDiscoverAdvisors");
	});
});

// =============================================================================
// A8: refusals
// =============================================================================

describe("A8: refusals", () => {
	test("upsert scope=effective → isError with actionable text", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "X", scope: "effective" });
		expect(result.isError).toBe(true);
		const parsed = parseEnvelope<{ ok: boolean; error: string; action?: string }>(result);
		expect(parsed.ok).toBe(false);
		expect(parsed.error).toContain("read-only");
		expect(parsed.action).toContain("scope=project");
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
	});

	test("upsert missing name → isError", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert" });
		expect(result.isError).toBe(true);
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
	});

	test("get missing name → isError", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "get" });
		expect(result.isError).toBe(true);
	});
});

// =============================================================================
// A9: no bridge / session null
// =============================================================================

describe("A9: no bridge → honest error", () => {
	test("resolveHostBridge returns null → isError; envelope names the exact failure", async () => {
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => null,
		});

		const result = await advisorTool().execute("c", { op: "status" });
		expect(result.isError).toBe(true);
		const parsed = parseEnvelope<{ ok: boolean; tool: string; op: string; error: string }>(result);
		expect(parsed.ok).toBe(false);
		expect(parsed.tool).toBe("advisor");
		expect(parsed.op).toBe("status");
		expect(parsed.error).toContain("No live main-agent session is reachable");
	});
});

// =============================================================================
// A10: session present, advisor methods missing → only advisor ops error
// =============================================================================

describe("A10: split sanity — session missing advisor surface refuses only advisor ops", () => {
	test("session without advisor methods → status isError; plan/vibe methods still present on session", async () => {
		const { api, advisorTool } = makeAdvisorPi();
		// Build a bridge whose session has plan/vibe but NO advisor methods
		const partialSession = {
			setPlanModeState: () => {},
			getPlanModeState: () => undefined,
			getVibeModeState: () => undefined,
			setVibeModeState: () => {},
			activateVibeTools: async () => {},
			deactivateVibeTools: async () => {},
			getEnabledToolNames: () => [] as string[],
			sessionManager: { getSessionId: () => null, getSessionFile: () => null, appendModeChange: () => {} },
			// No advisor methods at all
		};
		registerAdvisorTool(api as never, {
			resolveBridge: async () => ({ session: partialSession, vibeRegistry: null, vibeRegistryTrusted: false }),
		});

		const result = await advisorTool().execute("c", { op: "status" });
		expect(result.isError).toBe(true);
		const parsed = parseEnvelope<{ error: string }>(result);
		expect(parsed.error).toContain("does not expose the advisor method surface");
		// plan/vibe methods are still on the session object — sanity split worked
		expect(typeof (partialSession as Record<string, unknown>).setPlanModeState).toBe("function");
	});
});

// =============================================================================
// A11: native helpers import fails → honest error, no YAML write
// =============================================================================

describe("A11: native import failure → honest error", () => {
	test("resolveNative returns null → isError mentioning native helpers", async () => {
		const calls: CallLog = [];
		const { session } = makeFakeSession();
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => null,
		});

		const result = await advisorTool().execute("c", { op: "upsert", name: "X" });
		expect(result.isError).toBe(true);
		const text = result.content[0].text ?? "";
		expect(text.toLowerCase()).toMatch(/native|advisor\/config/);
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
	});
});

// =============================================================================
// A12: abort signal already aborted
// =============================================================================

describe("A12: abort signal aborted → cancelled result; no save/apply", () => {
	test("aborted signal before execute body → cancelled", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const aborted = new AbortController();
		aborted.abort();
		const result = await advisorTool().execute("c", { op: "upsert", name: "X" }, aborted.signal);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Cancelled");
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
	});
});

// =============================================================================
// A13: successful upsert result shape
// =============================================================================

describe("A13: ApplyResult shape on successful upsert", () => {
	test("envelope + persisted, fileDeleted, applied, effectiveAt, source, verification, warnings all present", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "Alpha" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "Alpha" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{
			ok: boolean;
			tool: string;
			op: string;
			persisted: boolean;
			fileDeleted: boolean;
			applied: boolean;
			effectiveAt: string;
			source: string;
			verification: { enabled: boolean; active: boolean; activeCount: number; advisors: unknown[] };
			warnings: unknown[];
		}>(result);
		expect(parsed.ok).toBe(true);
		expect(parsed.tool).toBe("advisor");
		expect(parsed.op).toBe("upsert");
		expect(parsed.persisted).toBe(true);
		expect(parsed.fileDeleted).toBe(false);
		expect(parsed.applied).toBe(true);
		expect(parsed.effectiveAt).toBe("immediate");
		expect(typeof parsed.source).toBe("string");
		expect(typeof parsed.verification.enabled).toBe("boolean");
		expect(typeof parsed.verification.active).toBe("boolean");
		expect(typeof parsed.verification.activeCount).toBe("number");
		expect(Array.isArray(parsed.verification.advisors)).toBe(true);
		expect(Array.isArray(parsed.warnings)).toBe(true);
	});
});

// =============================================================================
// A14: upsert while advisor disabled → persist+apply; effectiveAt=stored; warning
// =============================================================================

describe("A14: upsert while advisor disabled", () => {
	test("persist+apply still invoked; verification active=false; effectiveAt=stored; warning mentions enable", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "Disabled" }] }, { advisorEnabled: false, applyCount: 0 });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "Disabled" });
		expect(result.isError).toBeUndefined();
		expect(calls).toContain("nativeSaveConfigFile:project");
		expect(calls).toContain("nativeDiscoverAdvisors");
		const parsed = parseEnvelope<{
			effectiveAt: string;
			verification: { active: boolean };
			warnings: string[];
		}>(result);
		expect(parsed.verification.active).toBe(false);
		expect(parsed.effectiveAt).toBe("stored");
		expect(parsed.warnings.some((w: string) => w.includes("op=enable"))).toBe(true);
	});
});

// =============================================================================
// A15: shadow warning
// =============================================================================

describe("A15: shadow warning when upserted name not in effective", () => {
	test("name written but not in discover result → shadow warning", async () => {
		const calls: CallLog = [];
		// discoveredAdvisors does NOT include the upserted name (shadowed by project)
		const opts = makeOptions(calls, { discoveredAdvisors: [] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "ShadowMe" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some((w: string) => w.includes("shadow"))).toBe(true);
	});

	test("upsert scope=user with same slug in project file → shadow warning even when slug is in effective", async () => {
		const calls: CallLog = [];
		// The slug IS in effective — but it is the PROJECT entry, not the user one.
		const opts = makeOptions(calls, {
			projectDoc: { advisors: [{ name: "Reviewer", model: "a/b" }] },
			discoveredAdvisors: [{ name: "Reviewer", model: "a/b" }],
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "Reviewer", scope: "user", model: "x/y" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some((w: string) => w.includes("shadow") && w.includes("project"))).toBe(true);
	});
});

// =============================================================================
// A16: registerAdvisorTool — schema check + per-op approval tiering
// =============================================================================

describe("A16: registerAdvisorTool produces correct schema", () => {
	test("one tool named advisor; loadMode=essential; per-op approval; hidden=false; 10-op enum", async () => {
		const { api, tools, advisorTool } = makeAdvisorPi();
		const { session } = makeFakeSession();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => ({ session, vibeRegistry: null, vibeRegistryTrusted: false }),
		});

		expect(tools.length).toBe(1);
		const def = tools[0].definition;
		expect(def.name).toBe(ADVISOR_TOOL_NAME);
		expect(def.loadMode).toBe("essential");
		expect(def.hidden).toBeUndefined(); // not hidden
		// description includes [qol]
		expect(String(def.description)).toContain("[qol]");
		// Parameters encode all 10 ops
		const haystack = JSON.stringify(def.parameters);
		for (const op of ["list", "get", "upsert", "remove", "set_shared", "apply", "enable", "disable", "status", "dump"]) {
			expect(haystack).toContain(op);
		}
		// Approval is dynamic (host ToolApproval function form): read ops → "read",
		// mutate/runtime ops → "write", unknown/absent op → "write" (fail-safe).
		const approval = advisorTool().approval as (args: unknown) => string;
		expect(typeof approval).toBe("function");
		for (const op of ["list", "get", "status", "dump"]) {
			expect(approval({ op })).toBe("read");
		}
		for (const op of ["upsert", "remove", "set_shared", "apply", "enable", "disable"]) {
			expect(approval({ op })).toBe("write");
		}
		expect(approval({})).toBe("write");
		expect(approval(undefined)).toBe("write");
	});
});

// =============================================================================
// A17/A18: kill switch via the real lockfile + factory
// =============================================================================

describe("A17/A18: factory kill switch (isolated lockfile)", () => {
	// test/setup.ts (bun preload) froze the host's config root onto the
	// pid-scoped isolation root before any host module loaded. The env value
	// is stable for the whole process after preload, so reading it here in
	// beforeAll is safe (and stays correct if the name scheme changes).
	let testRoot = "";

	function writeLock(settings: Record<string, unknown>): void {
		const lock = { plugins: {}, settings: { "omp-qol-plugin": settings } };
		fs.mkdirSync(path.join(testRoot, "plugins"), { recursive: true });
		fs.writeFileSync(path.join(testRoot, "plugins", "omp-plugins.lock.json"), JSON.stringify(lock));
	}

	function makeFactoryPi() {
		const tools: Array<{ definition: Record<string, unknown> }> = [];
		const pi = {
			zod: z,
			setLabel: () => {},
			logger: { info: () => {}, warn: () => {}, error: () => {} },
			registerTool: (def: Record<string, unknown>) => { tools.push({ definition: def }); },
			registerCommand: () => {},
			on: (_event: string, _handler: unknown) => {},
		};
		return { pi, tools };
	}

	beforeAll(() => {
		testRoot = path.join(os.homedir(), process.env.PI_CONFIG_DIR!);
	});

	afterAll(() => {
		fs.rmSync(path.join(testRoot, "plugins"), { recursive: true, force: true });
	});

	test("A17: lockfile advisorToolEnabled=false → factory skips advisor, keeps goal+mode", async () => {
		writeLock({ advisorToolEnabled: false });
		const { pi, tools } = makeFactoryPi();
		await factory(pi as never);

		expect(tools.some(t => t.definition.name === ADVISOR_TOOL_NAME)).toBe(false);
		expect(tools.some(t => t.definition.name === "goal")).toBe(true);
		expect(tools.some(t => t.definition.name === "mode")).toBe(true);
	});

	test("A18: lockfile without the flag → factory registers the advisor tool", async () => {
		writeLock({});
		const { pi, tools } = makeFactoryPi();
		await factory(pi as never);

		expect(tools.filter(t => t.definition.name === ADVISOR_TOOL_NAME).length).toBe(1);
	});
});

// =============================================================================
// A19: implicit "default" advisor — synthetic entries + bare-default normalization
// (host runs one implicit advisor named "default" when zero are configured;
// the tool must surface it and mirror the TUI configure-Save normalization)
// =============================================================================

describe("A19: implicit default advisor visibility and bare-default normalization", () => {
	test("list scope=effective with empty merge → synthetic implicit entry + note", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, makeOptions(calls, { discoveredAdvisors: [] }));

		const result = await advisorTool().execute("c", { op: "list", scope: "effective" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{
			implicitDefault?: boolean;
			note?: string;
			advisors: Array<{ name: string; implicit?: boolean }>;
		}>(result);
		expect(parsed.implicitDefault).toBe(true);
		expect(parsed.advisors).toEqual([{ name: "default", implicit: true }]);
		expect(parsed.note).toContain('"default"');
		expect(parsed.note).toContain("status");
	});

	test("list scope=effective with advisors present → no implicitDefault field", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, makeOptions(calls, { discoveredAdvisors: [{ name: "A" }] }));

		const result = await advisorTool().execute("c", { op: "list", scope: "effective" });
		const parsed = parseEnvelope<{ implicitDefault?: boolean }>(result);
		expect(parsed.implicitDefault).toBeUndefined();
	});

	test("get name=default scope=effective on empty merge → synthetic implicit entry (success)", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, makeOptions(calls, { discoveredAdvisors: [] }));

		const result = await advisorTool().execute("c", { op: "get", name: "default", scope: "effective" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{
			ok: boolean;
			advisor: { name: string; implicit?: boolean };
			implicitDefault?: boolean;
			note?: string;
		}>(result);
		expect(parsed.ok).toBe(true);
		expect(parsed.advisor).toEqual({ name: "default", implicit: true });
		expect(parsed.implicitDefault).toBe(true);
		expect(parsed.note).toContain('upsert name="default"');
	});

	test("get other name scope=effective on empty merge → error mentions the implicit default", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, makeOptions(calls, { discoveredAdvisors: [] }));

		const result = await advisorTool().execute("c", { op: "get", name: "ghost", scope: "effective" });
		expect(result.isError).toBe(true);
		const parsed = parseEnvelope<{ error: string; action?: string }>(result);
		expect(parsed.error).toContain('"ghost"');
		expect(parsed.action).toContain("implicit");
	});

	test("upsert bare default → normalized away; file deleted; no shadow warning", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, makeOptions(calls, { discoveredAdvisors: [] }));

		const result = await advisorTool().execute("c", { op: "upsert", name: "default" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ persisted: boolean; fileDeleted: boolean; warnings: string[] }>(result);
		// No WATCHDOG file existed and the normalized doc is empty → the empty
		// save is a no-op on disk: truthfully NOTHING persisted, nothing deleted.
		expect(parsed.persisted).toBe(false);
		expect(parsed.fileDeleted).toBe(false);
		expect(parsed.warnings.some(w => w.includes("not persisted"))).toBe(true);
		expect(parsed.warnings.some(w => w.startsWith("shadow:"))).toBe(false);

		// Same fake-native closure: the project file must hold an empty roster.
		const list = await advisorTool().execute("c2", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ advisors: unknown[] }>(list);
		expect(listParsed.advisors.length).toBe(0);
	});

	test("upsert default WITH overrides → persisted as a real entry (no normalization)", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, makeOptions(calls, { discoveredAdvisors: [{ name: "default" }] }));

		const result = await advisorTool().execute("c", { op: "upsert", name: "default", instructions: "focus on tests" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some(w => w.includes("not persisted"))).toBe(false);

		const list = await advisorTool().execute("c2", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ advisors: Array<{ name: string; instructions?: string }> }>(list);
		expect(listParsed.advisors.length).toBe(1);
		expect(listParsed.advisors[0].instructions).toBe("focus on tests");
	});

	test("upsert default enabled=false → persisted (per-advisor toggle is an override)", async () => {
		const calls: CallLog = [];
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, makeOptions(calls, { discoveredAdvisors: [{ name: "default", enabled: false }] }));

		const result = await advisorTool().execute("c", { op: "upsert", name: "default", enabled: false });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some(w => w.includes("not persisted"))).toBe(false);

		const list = await advisorTool().execute("c2", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ advisors: Array<{ name: string; enabled?: boolean }> }>(list);
		expect(listParsed.advisors.length).toBe(1);
		expect(listParsed.advisors[0].enabled).toBe(false);
	});
});

// =============================================================================
// A20: anti-clobber guard (real tmp files — the guard reads raw disk bytes)
// =============================================================================

describe("A20: anti-clobber guard for unparsable-but-nonempty files", () => {
	let tmpDir = "";

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-qol-guard-"));
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("unparsable non-empty file + empty parsed doc → mutate blocked, file untouched", async () => {
		const garbagePath = path.join(tmpDir, "WATCHDOG.yml");
		const garbage = "advisors:\n  - name: [unclosed\n\tbroken: yaml: here";
		fs.writeFileSync(garbagePath, garbage);

		const calls: CallLog = [];
		// Fake native mirrors the real loader: unparsable → empty doc.
		const opts = makeOptions(calls, { projectPath: garbagePath, projectDoc: { advisors: [] } });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "NewBot" });
		expect(result.isError).toBe(true);
		const parsed = parseEnvelope<{ ok: boolean; error: string; action?: string }>(result);
		expect(parsed.ok).toBe(false);
		expect(parsed.error).toContain("blocked");
		expect(parsed.error).toContain("overwrite");
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
		// The garbage file is byte-identical — nothing clobbered it.
		expect(fs.readFileSync(garbagePath, "utf8")).toBe(garbage);
	});

	test("foreign-schema file (parses, but not advisor config) → mutate blocked", async () => {
		const foreignPath = path.join(tmpDir, "WATCHDOG-foreign.yml");
		fs.writeFileSync(foreignPath, "someOtherTool:\n  configured: true\n");

		const calls: CallLog = [];
		const opts = makeOptions(calls, { projectPath: foreignPath, projectDoc: { advisors: [] } });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "set_shared", shared_instructions: "x" });
		expect(result.isError).toBe(true);
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
	});

	test("comments-only file parses as empty config → mutate proceeds", async () => {
		const benignPath = path.join(tmpDir, "WATCHDOG-benign.yml");
		fs.writeFileSync(benignPath, "# advisors will go here\n");

		const calls: CallLog = [];
		const opts = makeOptions(calls, {
			projectPath: benignPath,
			projectDoc: { advisors: [] },
			discoveredAdvisors: [{ name: "NewBot" }],
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "NewBot" });
		expect(result.isError).toBeUndefined();
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(true);
	});

	test("explicit empty roster file (advisors: []) → mutate proceeds", async () => {
		const emptyRosterPath = path.join(tmpDir, "WATCHDOG-empty.yml");
		fs.writeFileSync(emptyRosterPath, "advisors: []\n");

		const calls: CallLog = [];
		const opts = makeOptions(calls, {
			projectPath: emptyRosterPath,
			projectDoc: { advisors: [] },
			discoveredAdvisors: [{ name: "NewBot" }],
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "NewBot" });
		expect(result.isError).toBeUndefined();
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(true);
	});
});

// =============================================================================
// A21: duplicate slugs, rename, CJK fallback
// =============================================================================

describe("A21: slug alignment with host discovery (last-wins, duplicates, fallback)", () => {
	test("upsert with two same-slug entries → updates the LAST; duplicate warning", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, {
			projectDoc: { advisors: [{ name: "My Bot", model: "first/one" }, { name: "my-bot", model: "second/one" }] },
			discoveredAdvisors: [{ name: "MY BOT" }],
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "MY BOT", instructions: "updated" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some(w => w.includes("duplicate slug"))).toBe(true);

		// The LAST entry got the update (host last-wins); the first is untouched.
		const list = await advisorTool().execute("c2", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ advisors: Array<{ name: string; model?: string; instructions?: string }> }>(list);
		expect(listParsed.advisors.length).toBe(2);
		expect(listParsed.advisors[0].model).toBe("first/one");
		expect(listParsed.advisors[0].instructions).toBeUndefined();
		expect(listParsed.advisors[1].name).toBe("MY BOT");
		expect(listParsed.advisors[1].model).toBe("second/one");
		expect(listParsed.advisors[1].instructions).toBe("updated");
	});

	test("get with duplicates returns the LAST match + warning; list warns too", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, {
			projectDoc: { advisors: [{ name: "Dup", model: "a/1" }, { name: "dup", model: "a/2" }] },
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const got = await advisorTool().execute("c", { op: "get", name: "dup", scope: "project" });
		expect(got.isError).toBeUndefined();
		const gotParsed = parseEnvelope<{ advisor: { model?: string }; warnings?: string[] }>(got);
		expect(gotParsed.advisor.model).toBe("a/2");
		expect((gotParsed.warnings ?? []).some(w => w.includes("LAST"))).toBe(true);

		const list = await advisorTool().execute("c2", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ warnings?: string[] }>(list);
		expect((listParsed.warnings ?? []).some(w => w.includes("duplicate slug"))).toBe(true);
	});

	test("remove deletes ALL same-slug duplicates and reports the count", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, {
			projectDoc: { advisors: [{ name: "Dup" }, { name: "dup" }, { name: "Keeper" }] },
			discoveredAdvisors: [{ name: "Keeper" }],
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "remove", name: "DUP" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ removed?: number; warnings: string[] }>(result);
		expect(parsed.removed).toBe(2);
		expect(parsed.warnings.some(w => w.includes("removed 2"))).toBe(true);

		const list = await advisorTool().execute("c2", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ advisors: Array<{ name: string }> }>(list);
		expect(listParsed.advisors.map(a => a.name)).toEqual(["Keeper"]);
	});

	test("upsert matching an existing entry under a different spelling → rename warning", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, {
			projectDoc: { advisors: [{ name: "My Bot", model: "keep/me" }] },
			discoveredAdvisors: [{ name: "my bot" }],
		});
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "my bot", instructions: "x" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some(w => w.includes("renamed"))).toBe(true);

		const list = await advisorTool().execute("c2", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ advisors: Array<{ name: string; model?: string }> }>(list);
		expect(listParsed.advisors.length).toBe(1);
		expect(listParsed.advisors[0].name).toBe("my bot");
		expect(listParsed.advisors[0].model).toBe("keep/me"); // unspecified fields preserved
	});

	test("upsert a pure-CJK name → generic-slug fallback warning", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "顾问" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "顾问" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some(w => w.includes("slug fallback") && w.includes('"advisor"'))).toBe(true);
	});
});

// =============================================================================
// A22: unknown-tool warnings (per probed filterAdvisorTools semantics)
// =============================================================================

describe("A22: unknown-tool warnings", () => {
	test("all-unknown tools list → warning explains fallback to DEFAULT subset", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "T" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "T", tools: ["frobnicate", "zap"] });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		const warning = parsed.warnings.find(w => w.includes("unknown tools"));
		expect(warning).toBeDefined();
		expect(warning!).toContain("DEFAULT");
		expect(warning!).toContain("tools=[]");
	});

	test("partially-unknown tools list → warning names dropped and kept tools", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "T" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "T", tools: ["read", "frobnicate"] });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		const warning = parsed.warnings.find(w => w.includes("unknown tools dropped"));
		expect(warning).toBeDefined();
		expect(warning!).toContain('"frobnicate"');
		expect(warning!).toContain("read");
	});

	test("known tools or empty list → no unknown-tool warning", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "T" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const known = await advisorTool().execute("c", { op: "upsert", name: "T", tools: ["read", "grep"] });
		expect(parseEnvelope<{ warnings: string[] }>(known).warnings.some(w => w.includes("unknown"))).toBe(false);

		const empty = await advisorTool().execute("c2", { op: "upsert", name: "T", tools: [] });
		expect(parseEnvelope<{ warnings: string[] }>(empty).warnings.some(w => w.includes("unknown"))).toBe(false);
	});
});

// =============================================================================
// A23: truthful persisted/fileDeleted/effectiveAt + remove-miss + runtime warnings
// =============================================================================

describe("A23: truthful result flags and runtime warnings", () => {
	test("remove with no match → persisted=false applied=false effectiveAt=none removed=0; no save", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { projectDoc: { advisors: [{ name: "Other" }] } });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "remove", name: "Ghost" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{
			persisted: boolean;
			fileDeleted: boolean;
			applied: boolean;
			effectiveAt: string;
			removed?: number;
			warnings: string[];
		}>(result);
		expect(parsed.persisted).toBe(false);
		expect(parsed.fileDeleted).toBe(false);
		expect(parsed.applied).toBe(false);
		expect(parsed.effectiveAt).toBe("none");
		expect(parsed.removed).toBe(0);
		expect(parsed.warnings.some(w => w.includes("untouched"))).toBe(true);
		expect(calls.some(c => c.startsWith("nativeSaveConfigFile"))).toBe(false);
		expect(calls.some(c => c === "nativeDiscoverAdvisors")).toBe(false);
	});

	test("removing the last entry empties the doc → fileDeleted=true + warning", async () => {
		// fileDeleted must reflect the disk: the file has to actually exist
		// before the empty save for the tool to report a deletion.
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-qol-del-"));
		const realPath = path.join(tmpDir, "WATCHDOG.yml");
		fs.writeFileSync(realPath, "advisors:\n  - name: OnlyOne\n");
		try {
			const calls: CallLog = [];
			const opts = makeOptions(calls, {
				projectPath: realPath,
				projectDoc: { advisors: [{ name: "OnlyOne" }] },
				discoveredAdvisors: [],
			});
			const { api, advisorTool } = makeAdvisorPi();
			registerAdvisorTool(api as never, opts);

			const result = await advisorTool().execute("c", { op: "remove", name: "OnlyOne" });
			expect(result.isError).toBeUndefined();
			const parsed = parseEnvelope<{ persisted: boolean; fileDeleted: boolean; warnings: string[] }>(result);
			expect(parsed.persisted).toBe(true);
			expect(parsed.fileDeleted).toBe(true);
			expect(parsed.warnings.some(w => w.includes("deleted"))).toBe(true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("mutate while runtimes are live → restart warning with before/after counts", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(
			calls,
			{ discoveredAdvisors: [{ name: "Live" }] },
			{ stats: { active: true, advisors: [{ name: "Live", status: "running" }] }, applyCount: 1 },
		);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "Live", instructions: "tweak" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some(w => w.includes("rebuilt ALL advisor runtimes"))).toBe(true);
	});

	test("advisor lands at no_model after apply → no_model warning names it", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(
			calls,
			{ discoveredAdvisors: [{ name: "Broken", model: "nope/nope" }] },
			{ postApplyStatus: { Broken: "no_model" }, applyCount: 0 },
		);
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "Broken", model: "nope/nope" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{ warnings: string[] }>(result);
		expect(parsed.warnings.some(w => w.includes("no_model") && w.includes("Broken"))).toBe(true);
	});
});

// =============================================================================
// A24: per-path mutate serialization
// =============================================================================

describe("A24: concurrent mutates on one file are serialized (no lost update)", () => {
	test("Promise.all two upserts → both entries survive in the doc", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "One" }, { name: "Two" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const [r1, r2] = await Promise.all([
			advisorTool().execute("c1", { op: "upsert", name: "One" , model: "m/1" }),
			advisorTool().execute("c2", { op: "upsert", name: "Two", model: "m/2" }),
		]);
		expect(r1.isError).toBeUndefined();
		expect(r2.isError).toBeUndefined();

		// The fake native's load→save is a copy-replace: without per-path
		// serialization the second writer would overwrite the first (lost update).
		const list = await advisorTool().execute("c3", { op: "list", scope: "project" });
		const listParsed = parseEnvelope<{ advisors: Array<{ name: string }> }>(list);
		expect(listParsed.advisors.map(a => a.name).sort()).toEqual(["One", "Two"]);
	});
});

// =============================================================================
// A25: status/verification evidence pass-through (Phase A surface)
// =============================================================================

describe("A25: status passes the host's PerAdvisorStat evidence through", () => {
	const fullStat: LiveAdvisorStat = {
		name: "Evidence",
		status: "running",
		model: { provider: "anthropic", id: "claude-haiku-4-5" },
		contextWindow: 200000,
		contextTokens: 1234,
		tokens: { input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2, total: 167 },
		cost: 0.0123,
		messages: { user: 3, assistant: 2, total: 5 },
		sessionId: "sess-123",
	};

	test("status body: activeCount, per-advisor tokens/cost/messages/context/sessionId; no `configured`", async () => {
		const calls: CallLog = [];
		const { session } = makeFakeSession({ stats: { active: true, advisors: [fullStat] } });
		const bridge: HostBridge = { session, vibeRegistry: null, vibeRegistryTrusted: false };
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, {
			resolveBridge: async () => bridge,
			resolveNative: async () => makeFakeNative(calls),
		});

		const result = await advisorTool().execute("c", { op: "status" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{
			enabled: boolean;
			active: boolean;
			activeCount: number;
			statusLine: string;
			advisors: Array<{
				name: string;
				status: string;
				model?: string;
				tokens?: { total: number };
				cost?: number;
				messages?: { total: number };
				contextTokens?: number;
				contextWindow?: number;
				sessionId?: string;
			}>;
		}>(result);
		expect(parsed.activeCount).toBe(1);
		expect(parsed.advisors.length).toBe(1);
		const a = parsed.advisors[0];
		expect(a.name).toBe("Evidence");
		expect(a.status).toBe("running");
		expect(a.model).toBe("anthropic/claude-haiku-4-5");
		expect(a.tokens?.total).toBe(167);
		expect(a.cost).toBe(0.0123);
		expect(a.messages?.total).toBe(5);
		expect(a.contextTokens).toBe(1234);
		expect(a.contextWindow).toBe(200000);
		expect(a.sessionId).toBe("sess-123");
		expect(typeof parsed.statusLine).toBe("string");
		// `configured` was dropped: it only mirrored the enable flag.
		expect("configured" in (parsed as Record<string, unknown>)).toBe(false);
	});

	test("verification advisors carry the same pass-through entries after a mutate", async () => {
		const calls: CallLog = [];
		const opts = makeOptions(calls, { discoveredAdvisors: [{ name: "Evidence" }] });
		const { api, advisorTool } = makeAdvisorPi();
		registerAdvisorTool(api as never, opts);

		const result = await advisorTool().execute("c", { op: "upsert", name: "Evidence" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<{
			verification: { advisors: Array<{ name: string; status: string }> };
		}>(result);
		expect(parsed.verification.advisors.length).toBe(1);
		expect(parsed.verification.advisors[0].name).toBe("Evidence");
		expect(parsed.verification.advisors[0].status).toBe("running");
	});
});

// =============================================================================
// Factory default: main.ts registers advisor with default settings
// =============================================================================

describe("main factory registers advisor tool (default settings)", () => {
	test("factory with advisorToolEnabled=true (default) registers exactly one advisor tool", async () => {
		const tools: Array<{ definition: Record<string, unknown> }> = [];
		const pi = {
			zod: z,
			setLabel: () => {},
			logger: { info: () => {}, warn: () => {}, error: () => {} },
			registerTool: (def: Record<string, unknown>) => { tools.push({ definition: def }); },
			registerCommand: () => {},
			on: (_event: string, _handler: unknown) => {},
		};

		// Settings load defaults (advisorToolEnabled=true): the pid-scoped
		// PI_CONFIG_DIR root holds no lockfile at this point (A17's afterAll
		// removed its plugins dir).
		await factory(pi as never);

		const advisorTools = tools.filter(t => t.definition.name === ADVISOR_TOOL_NAME);
		expect(advisorTools.length).toBe(1);
		expect(advisorTools[0].definition.loadMode).toBe("essential");
		// Approval is the dynamic per-op function, not a static tier.
		const approval = advisorTools[0].definition.approval as (args: unknown) => string;
		expect(typeof approval).toBe("function");
		expect(approval({ op: "status" })).toBe("read");
		expect(approval({ op: "upsert" })).toBe("write");
	});
});
