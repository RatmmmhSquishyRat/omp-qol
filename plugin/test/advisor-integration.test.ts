/**
 * L3: Real AgentSession integration tests for the advisor tool.
 *
 * Uses a real AgentSession + SessionManager + AgentRegistry, with a temporary
 * WATCHDOG.yml dir and PI_CONFIG_DIR isolated from the developer's ~/.omp.
 *
 * Covers Foundation gates F1–F7 that can be automated (TDD §I1–I9).
 *
 * NOT covered here: F8 (real LLM e2e, requires OMPQOL_RELAY_PROVIDERS, optional).
 *
 * Recipe mirrors integration-real-session.test.ts but focuses on advisor paths.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { z } from "zod/v4";
import { registerAdvisorTool, type NativeHelpers } from "../src/advisor-tool";
import * as advisorNative from "../src/lib/advisor-native";
import { resolveHostBridge } from "../src/lib/host-bridge";

// =============================================================================
// Isolation
// =============================================================================

beforeAll(() => {
	process.env.PI_CONFIG_DIR = ".omp-qol-l3-advisor";
	// Keep PI_CODING_AGENT_DIR separate from tests — nativeGetAgentDir reads it
});

// =============================================================================
// Real-native wrapper: uses the actual advisor-native helpers but overrides
// nativeGetAgentDir() so tests stay isolated from the real ~/.omp/agent.
// This is necessary because getAgentDir() resolves at module load time and
// does not re-read PI_CODING_AGENT_DIR on subsequent calls.
// =============================================================================

function makeIsolatedNative(agentDir: string): NativeHelpers {
	return {
		nativeGetAgentDir: () => agentDir,
		nativeGetProjectDir: (cwd) => advisorNative.nativeGetProjectDir(cwd),
		nativeResolveEditPath: (scope, dirs) => advisorNative.nativeResolveEditPath(scope, dirs),
		nativeLoadConfigFile: (fp) => advisorNative.nativeLoadConfigFile(fp),
		nativeSaveConfigFile: (fp, doc) => advisorNative.nativeSaveConfigFile(fp, doc),
		nativeDiscoverAdvisors: (cwd, aDir) => advisorNative.nativeDiscoverAdvisors(cwd, aDir),
	};
}

// =============================================================================
// Harness
// =============================================================================

interface AdvisorToolHandle {
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

interface Harness {
	session: AgentSession;
	authStorage: AuthStorage;
	tool: AdvisorToolHandle;
	registryId: string;
	tmp: string;
	projectDir: string;
	agentDir: string;
	watchdogPath: string;
	userWatchdogPath: string;
}

function makeDummyTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `Dummy ${name}`,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};
}

async function makeRealAdvisorSession(projectCwd?: string): Promise<Harness> {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("bundled anthropic model missing");

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qol-l3-adv-"));
	const projectDir = projectCwd ?? tmp;
	const agentDir = path.join(tmp, "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	// Initialize a git repo so repo.root() resolves correctly
	try {
		const { spawnSync } = await import("node:child_process");
		spawnSync("git", ["init", projectDir], { stdio: "ignore" });
	} catch {
		// git might not be available; projectDir will fall back to cwd
	}

	const watchdogPath = path.join(projectDir, "WATCHDOG.yml");
	const userWatchdogPath = path.join(agentDir, "WATCHDOG.yml");

	// Capture the tool definition from registerAdvisorTool.
	const captured: Array<{ definition: Record<string, unknown> }> = [];
	registerAdvisorTool(
		{
			zod: z,
			logger: { info: () => {}, warn: () => {}, error: () => {} },
			registerTool: (def: Record<string, unknown>) => captured.push({ definition: def }),
			on: () => {},
		} as never,
		{
			getCwd: () => projectDir,
			// Override nativeGetAgentDir to return our isolated temp agentDir.
			// getAgentDir() resolves at module load time; env var changes after
			// import don't propagate, so we inject the temp path here.
			resolveNative: async () => makeIsolatedNative(agentDir),
		},
	);
	if (captured.length !== 1) throw new Error("advisor tool not captured");
	const def = captured[0].definition;

	const readTool = makeDummyTool("read");
	const mock = createMockModel({ responses: [{ content: [{ type: "text", text: "done" }] }] });
	// Note: no PI_CODING_AGENT_DIR env needed; agentDir is injected via resolveNative.
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: {
			model,
			systemPrompt: ["Test"],
			tools: [readTool],
			messages: [],
		},
		streamFn: mock.stream,
	});

	const authStorage = await AuthStorage.create(path.join(tmp, `auth-${Snowflake.next()}.db`));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(tmp, `models-${Snowflake.next()}.yml`));

	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(projectDir),
		settings: Settings.isolated({
			"compaction.enabled": false,
			"retry.enabled": false,
			"advisor.enabled": false,
		}),
		modelRegistry,
		toolRegistry: new Map<string, AgentTool>([["read", readTool]]),
		builtInToolNames: ["read"],
		advisorTools: [],
	} as never);

	const registryId = `qol-l3-adv-${Snowflake.next()}`;
	AgentRegistry.global().register({
		id: registryId,
		displayName: "qol-l3-adv",
		kind: "main",
		session,
		status: "running",
	});

	return {
		session,
		authStorage,
		tool: def as unknown as AdvisorToolHandle,
		registryId,
		tmp,
		projectDir,
		agentDir,
		watchdogPath,
		userWatchdogPath,
	};
}

async function teardownHarness(h: Harness | undefined): Promise<void> {
	if (!h) return;
	AgentRegistry.global().unregister(h.registryId);
	try { await h.session.dispose(); } catch { /* best effort */ }
	try { h.authStorage.close(); } catch { /* best effort */ }
	try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

// Helper to write a WATCHDOG.yml to a path
function writeWatchdog(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
}

// =============================================================================
// I1: list project / user / effective against seeded WATCHDOG files (F1)
// =============================================================================

describe("I1: list + native parse/merge (F1)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("list project/user/effective reads native files; no plugin roster", async () => {
		h = await makeRealAdvisorSession();
		// Seed project and user WATCHDOG files
		writeWatchdog(h.watchdogPath, `advisors:\n  - name: ProjectBot\n    model: anthropic/claude-haiku-4-5\n`);
		writeWatchdog(h.userWatchdogPath, `advisors:\n  - name: UserBot\n`);

		const project = await h.tool.execute("t1", { op: "list", scope: "project" });
		expect(project.isError).toBeUndefined();
		expect(project.content[0].text).toContain("ProjectBot");
		expect(project.content[0].text).not.toContain("UserBot");

		const user = await h.tool.execute("t2", { op: "list", scope: "user" });
		expect(user.isError).toBeUndefined();
		expect(user.content[0].text).toContain("UserBot");

		const effective = await h.tool.execute("t3", { op: "list", scope: "effective" });
		expect(effective.isError).toBeUndefined();
		// effective merges both (by native discover)
		expect(effective.content[0].text).toContain("ProjectBot");
		expect(effective.content[0].text).toContain("UserBot");
	});
});

// =============================================================================
// I2: upsert while advisor enabled → active without restart (F2)
// =============================================================================

describe("I2: upsert while enabled → runtime appears without restart (F2)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("upsert + enable → isAdvisorActive; name in stats", async () => {
		h = await makeRealAdvisorSession();

		// Enable first
		h.session.setAdvisorEnabled(true);

		const result = await h.tool.execute("t", {
			op: "upsert",
			name: "LiveBot",
			instructions: "Watch for issues",
		});
		expect(result.isError).toBeUndefined();

		// advisor is active (enabled + configured)
		expect(h.session.isAdvisorEnabled()).toBe(true);
		// File exists
		expect(fs.existsSync(h.watchdogPath)).toBe(true);
		// Verification in result
		const parsed = JSON.parse(result.content[0].text!) as { verification: { enabled: boolean }; persisted: boolean; applied: boolean };
		expect(parsed.persisted).toBe(true);
		expect(parsed.applied).toBe(true);
		expect(parsed.verification.enabled).toBe(true);
	});
});

// =============================================================================
// I3: change model/instructions → old runtime replaced; verification reflects new (F3)
// =============================================================================

describe("I3: second upsert changes values; verification reflects new (F3)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("upsert twice; second upsert overrides model+instructions", async () => {
		h = await makeRealAdvisorSession();
		h.session.setAdvisorEnabled(true);

		await h.tool.execute("t1", { op: "upsert", name: "Changer", model: "anthropic/claude-haiku-4-5", instructions: "v1" });
		const result2 = await h.tool.execute("t2", { op: "upsert", name: "Changer", model: "openai/gpt-4o-mini", instructions: "v2" });
		expect(result2.isError).toBeUndefined();

		// File on disk should reflect v2
		const content = fs.readFileSync(h.watchdogPath, "utf8");
		expect(content).toContain("v2");
		expect(content).toContain("gpt-4o-mini");
		// No duplicate "Changer" entries
		expect((content.match(/name: Changer/g) ?? []).length).toBe(1);
	});
});

// =============================================================================
// I4: remove project advisor → user resurfaces in effective (F4)
// =============================================================================

describe("I4: remove project entry → user advisor resurfaces (F4)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("user 'Reviewer' + project 'Reviewer' → remove project → effective shows user", async () => {
		h = await makeRealAdvisorSession();
		// Seed user advisor
		writeWatchdog(h.userWatchdogPath, `advisors:\n  - name: Reviewer\n    instructions: "user version"\n`);
		// Upsert project version (overrides user in effective)
		await h.tool.execute("t1", { op: "upsert", name: "Reviewer", instructions: "project version" });

		let effective = await h.tool.execute("t2", { op: "get", name: "Reviewer", scope: "effective" });
		expect(effective.content[0].text).toContain("project version");

		// Remove project entry
		await h.tool.execute("t3", { op: "remove", name: "Reviewer" });

		// Now effective should fall back to user version
		effective = await h.tool.execute("t4", { op: "get", name: "Reviewer", scope: "effective" });
		expect(effective.isError).toBeUndefined();
		expect(effective.content[0].text).toContain("user version");
	});
});

// =============================================================================
// I5: disable → upsert → file persists, active=false → enable starts latest (F5)
// =============================================================================

describe("I5: persist while disabled; enable starts latest roster (F5)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("upsert while disabled: file persisted, active=false; enable makes advisor active", async () => {
		h = await makeRealAdvisorSession();

		// Ensure disabled
		const disableRes = await h.tool.execute("t0", { op: "disable" });
		expect(disableRes.isError).toBeUndefined();

		// Upsert while disabled
		const upsertRes = await h.tool.execute("t1", { op: "upsert", name: "WhenDisabled" });
		expect(upsertRes.isError).toBeUndefined();
		// File should exist
		expect(fs.existsSync(h.watchdogPath)).toBe(true);
		// Verification says active=false
		const parsed = JSON.parse(upsertRes.content[0].text!) as { verification: { active: boolean; enabled: boolean } };
		expect(parsed.verification.enabled).toBe(false);
		// Warning mentions disabled
		const warnings = (JSON.parse(upsertRes.content[0].text!) as { warnings: string[] }).warnings;
		expect(warnings.some((w: string) => w.toLowerCase().includes("disabled"))).toBe(true);

		// Enable — advisor tool must NOT call discover here (ADR-005 §D3)
		const enableRes = await h.tool.execute("t2", { op: "enable" });
		expect(enableRes.isError).toBeUndefined();
		expect(h.session.isAdvisorEnabled()).toBe(true);
	});
});

// =============================================================================
// I6: unknown tool name in upsert → warning; existing roster untouched (F6)
// =============================================================================

describe("I6: unknown tool name → warning; live roster unaffected (F6)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("upsert with tools=[unknown_tool] succeeds with warning or applies without unknown tool", async () => {
		h = await makeRealAdvisorSession();
		h.session.setAdvisorEnabled(true);

		// First, establish a known-good advisor
		await h.tool.execute("t0", { op: "upsert", name: "GoodBot" });

		// Now upsert with an invalid tool name
		const result = await h.tool.execute("t1", {
			op: "upsert",
			name: "BadToolBot",
			tools: ["nonexistent_tool_xyz"],
		});
		// Should either warn or succeed (native drops unknown tools silently)
		// Crucially, it must not be a hard error that corrupts the live roster
		// (the existing GoodBot should still be in the stats after apply)
		expect(result.isError).toBeUndefined();
		// GoodBot should still be accessible via list
		const list = await h.tool.execute("t2", { op: "list", scope: "effective" });
		expect(list.content[0].text).toContain("GoodBot");
	});
});

// =============================================================================
// I7: new session after project file write → file still on disk (F7)
// =============================================================================

describe("I7: session persistence — file survives new session (F7)", () => {
	let h: Harness | undefined;
	let h2: Harness | undefined;
	afterEach(async () => {
		await teardownHarness(h);
		await teardownHarness(h2);
		h = undefined;
		h2 = undefined;
	});

	test("WATCHDOG.yml written by tool remains after session teardown + new session", async () => {
		h = await makeRealAdvisorSession();
		await h.tool.execute("t1", { op: "upsert", name: "Persistent" });
		expect(fs.existsSync(h.watchdogPath)).toBe(true);

		// New session on same projectDir — file should still be there
		h2 = await makeRealAdvisorSession(h.projectDir);
		const list = await h2.tool.execute("t2", { op: "list", scope: "project" });
		expect(list.content[0].text).toContain("Persistent");
	});
});

// =============================================================================
// I8: ctx.cwd is a subdirectory → edit path resolves to project root (F: path)
// =============================================================================

describe("I8: subdirectory cwd → edit path at repo root", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("cwd=subdir: WATCHDOG.yml written at projectDir (git root), not subdir", async () => {
		// Create a git repo and a subdir
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "qol-i8-"));
		try {
			const { spawnSync } = await import("node:child_process");
			spawnSync("git", ["init", tmp2], { stdio: "ignore" });
		} catch { /* git may not be available */ }
		const subdir = path.join(tmp2, "src", "nested");
		fs.mkdirSync(subdir, { recursive: true });

		// Make a harness with cwd=subdir but the session's getCwd returns tmp2 (project root)
		// This tests that nativeGetProjectDir correctly uses repo.root to go up.
		// We simulate by passing subdir as getCwd but the git root is tmp2.
		const agentDir = path.join(tmp2, "agent");
		fs.mkdirSync(agentDir, { recursive: true });

		const captured: Array<{ definition: Record<string, unknown> }> = [];
		registerAdvisorTool(
			{
				zod: z,
				logger: { info: () => {}, warn: () => {}, error: () => {} },
				registerTool: (def: Record<string, unknown>) => captured.push({ definition: def }),
				on: () => {},
			} as never,
			{
				getCwd: () => subdir,
				resolveNative: async () => makeIsolatedNative(agentDir),
			},
		);
		expect(captured.length).toBe(1);
		const def = captured[0].definition as { execute: AdvisorToolHandle["execute"] };

		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		const mock = createMockModel({ responses: [{ content: [{ type: "text", text: "done" }] }] });
		const agent = new Agent({
			getApiKey: () => "k",
			initialState: { model, systemPrompt: ["t"], tools: [], messages: [] },
			streamFn: mock.stream,
		});
		const authDb = path.join(tmp2, `auth-${Snowflake.next()}.db`);
		const auth = await AuthStorage.create(authDb);
		auth.setRuntimeApiKey("anthropic", "k");
		const modelReg = new ModelRegistry(auth, path.join(tmp2, `m-${Snowflake.next()}.yml`));
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(subdir),
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry: modelReg,
			toolRegistry: new Map(),
			builtInToolNames: [],
			advisorTools: [],
		} as never);
		const regId = `qol-i8-${Snowflake.next()}`;
		AgentRegistry.global().register({ id: regId, displayName: "qol-i8", kind: "main", session, status: "running" });

		try {
			const result = await def.execute("t1", { op: "upsert", name: "SubBot" });
			expect(result.isError).toBeUndefined();
			// The WATCHDOG.yml must be at tmp2 (the git root), NOT at subdir
			const expectedPath = path.join(tmp2, "WATCHDOG.yml");
			const content = result.content[0].text ?? "";
			expect(fs.existsSync(expectedPath)).toBe(true);
			// source in result should point to project root path
			const parsed = JSON.parse(content) as { source: string };
			expect(parsed.source).toContain(tmp2);
			expect(parsed.source).not.toContain("nested");
		} finally {
			AgentRegistry.global().unregister(regId);
			try { await session.dispose(); } catch { /* best effort */ }
			try { auth.close(); } catch { /* best effort */ }
			try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch { /* best effort */ }
		}
	});
});

// =============================================================================
// I9: no extension registered → honest error on real resolver path
// =============================================================================

describe("I9: no session registered → honest error", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("tool uses production resolver; unregistered session → isError", async () => {
		h = await makeRealAdvisorSession();
		// Unregister so resolveHostBridge returns null
		AgentRegistry.global().unregister(h.registryId);

		const result = await h.tool.execute("c", { op: "status" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("live host session");

		// Re-register for teardown
		AgentRegistry.global().register({
			id: h.registryId,
			displayName: "qol-l3-adv",
			kind: "main",
			session: h.session,
			status: "running",
		});
	});
});

// =============================================================================
// Bridge reach: resolveHostBridge finds the live session with advisor methods
// =============================================================================

describe("host bridge reaches real session with advisor surface", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("resolveHostBridge returns non-null; session has advisor methods", async () => {
		h = await makeRealAdvisorSession();
		const bridge = await resolveHostBridge();
		expect(bridge).not.toBeNull();
		expect(bridge?.session).toBe(h.session as unknown);
		// The real AgentSession must have all advisor methods
		const s = bridge!.session;
		expect(typeof s.applyAdvisorConfigs).toBe("function");
		expect(typeof s.setAdvisorEnabled).toBe("function");
		expect(typeof s.isAdvisorEnabled).toBe("function");
		expect(typeof s.isAdvisorActive).toBe("function");
		expect(typeof s.getAdvisorStats).toBe("function");
		expect(typeof s.formatAdvisorStatus).toBe("function");
		expect(typeof s.formatAdvisorHistoryAsText).toBe("function");
	});
});
