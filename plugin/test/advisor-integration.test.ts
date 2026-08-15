/**
 * L3: Real AgentSession integration tests for the advisor tool.
 *
 * Uses a real AgentSession + SessionManager + AgentRegistry, with a temporary
 * WATCHDOG.yml dir and PI_CONFIG_DIR isolated from the developer's ~/.omp
 * (frozen by test/setup.ts preload before any host module loads).
 *
 * Covers Foundation gates F1–F7 that can be automated (TDD §I1–I9), the
 * implicit-default lifecycle (I10), multi-advisor runtime evidence (I11), and
 * a full advisor streaming round-trip with scripted advisor models (I12):
 * advise → steer into the primary transcript + per-advisor JSONL transcripts.
 *
 * NOT covered here: F8 (real LLM e2e, requires OMPQOL_RELAY_PROVIDERS, optional).
 *
 * Recipe mirrors integration-real-session.test.ts but focuses on advisor paths.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { createMockModel, type MockModel } from "@oh-my-pi/pi-ai/providers/mock";
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

// Config-root isolation comes from test/setup.ts (bun preload), which froze
// PI_CONFIG_DIR onto a pid-scoped ~/.omp-qol-test-root-<pid> before any host
// module loaded. (Setting it here in beforeAll was too late for the host's
// DirResolver — this file's static host imports freeze the root before hooks.)

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
		nativeSlugifyAdvisorName: (name) => advisorNative.nativeSlugifyAdvisorName(name),
		nativeNormalizeToolNames: (names) => advisorNative.nativeNormalizeToolNames(names),
		nativeBuiltinToolNames: () => advisorNative.nativeBuiltinToolNames(),
	};
}

// =============================================================================
// Harness
// =============================================================================

interface ToolResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

interface AdvisorToolHandle {
	execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
}

/** Parse the JSON envelope from a result's text. Results are pure JSON (the
 *  one-liner rides inside the body as `summary`), so direct parse doubles as
 *  the no-prose-prefix assertion. */
function parseEnvelope<T = Record<string, unknown>>(result: ToolResult): T {
	return JSON.parse(result.content[0]?.text ?? "") as T;
}

/** Envelope slice for mutate-op results (upsert/remove/set_shared/apply). */
interface MutateEnvelope {
	ok: boolean;
	op: string;
	persisted: boolean;
	fileDeleted: boolean;
	applied: boolean;
	effectiveAt: "immediate" | "stored" | "none";
	source: string;
	removed?: number;
	verification: {
		enabled: boolean;
		active: boolean;
		activeCount: number;
		advisors: Array<{ name: string; status: string; model?: string }>;
	};
	warnings: string[];
}

/** Poll `predicate` up to `timeoutMs`; returns silently on timeout so the
 *  caller's subsequent expect() fails with the real observed state. */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
}

interface HarnessOptions {
	projectCwd?: string;
	/**
	 * When true the session gets a PERSISTENT SessionManager opened on
	 * `<tmp>/primary-session.jsonl` (exposed as Harness.sessionFile). Advisor
	 * transcript recorders derive their JSONL path from getSessionFile(), which
	 * is null for the default in-memory manager — so streaming tests need this.
	 */
	persistentSession?: boolean;
	/** streamFn given to ALL advisor runtimes (dispatch per advisor inside). */
	advisorStreamFn?: unknown;
	/** Primary-agent mock; defaults to a single scripted "done" response. */
	primaryMock?: MockModel;
	/** Set advisor.syncBacklog="1" so a primary turn awaits advisor catch-up. */
	syncBacklog?: boolean;
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
	/** Set when persistentSession was requested. */
	sessionFile?: string;
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

async function makeRealAdvisorSession(options: HarnessOptions = {}): Promise<Harness> {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("bundled anthropic model missing");

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qol-l3-adv-"));
	const projectDir = options.projectCwd ?? tmp;
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
	const mock = options.primaryMock ?? createMockModel({ responses: [{ content: [{ type: "text", text: "done" }] }] });
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

	let sessionFile: string | undefined;
	let sessionManager: SessionManager;
	if (options.persistentSession) {
		sessionFile = path.join(tmp, "primary-session.jsonl");
		sessionManager = await SessionManager.open(sessionFile, undefined, undefined, { initialCwd: projectDir });
	} else {
		sessionManager = SessionManager.inMemory(projectDir);
	}

	const session = new AgentSession({
		agent,
		sessionManager,
		settings: Settings.isolated({
			"compaction.enabled": false,
			"retry.enabled": false,
			"advisor.enabled": false,
			...(options.syncBacklog ? { "advisor.syncBacklog": "1" } : {}),
		}),
		modelRegistry,
		toolRegistry: new Map<string, AgentTool>([["read", readTool]]),
		builtInToolNames: ["read"],
		advisorTools: [],
		...(options.advisorStreamFn ? { advisorStreamFn: options.advisorStreamFn } : {}),
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
		sessionFile,
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

	test("upsert + enable → isAdvisorActive; runtime in stats; verification carries evidence", async () => {
		h = await makeRealAdvisorSession();

		// Enable first
		h.session.setAdvisorEnabled(true);

		const result = await h.tool.execute("t", {
			op: "upsert",
			name: "LiveBot",
			model: "anthropic/claude-haiku-4-5",
			instructions: "Watch for issues",
		});
		expect(result.isError).toBeUndefined();

		// Live session state: enabled AND active (a runtime is actually running).
		expect(h.session.isAdvisorEnabled()).toBe(true);
		expect(h.session.isAdvisorActive()).toBe(true);
		const stats = h.session.getAdvisorStats();
		expect(stats.active).toBe(true);
		const live = stats.advisors.find((a) => a.name === "LiveBot");
		expect(live).toBeDefined();
		expect(live!.status).toBe("running");

		// File exists
		expect(fs.existsSync(h.watchdogPath)).toBe(true);

		// Envelope evidence: truthful flags + verification mirrors the live stats.
		const parsed = parseEnvelope<MutateEnvelope>(result);
		expect(parsed.ok).toBe(true);
		expect(parsed.persisted).toBe(true);
		expect(parsed.applied).toBe(true);
		expect(parsed.fileDeleted).toBe(false);
		expect(parsed.effectiveAt).toBe("immediate");
		expect(parsed.verification.enabled).toBe(true);
		expect(parsed.verification.active).toBe(true);
		expect(parsed.verification.activeCount).toBeGreaterThanOrEqual(1);
		const verified = parsed.verification.advisors.find((a) => a.name === "LiveBot");
		expect(verified).toBeDefined();
		expect(verified!.status).toBe("running");
		expect(verified!.model).toBe("anthropic/claude-haiku-4-5");
	});
});

// =============================================================================
// I3: change model/instructions → old runtime replaced; verification reflects new (F3)
// =============================================================================

describe("I3: second upsert changes values; verification reflects new (F3)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("upsert twice; second upsert replaces the runtime (new model in stats)", async () => {
		h = await makeRealAdvisorSession();
		h.session.setAdvisorEnabled(true);

		await h.tool.execute("t1", { op: "upsert", name: "Changer", model: "anthropic/claude-haiku-4-5", instructions: "v1" });
		const statsV1 = h.session.getAdvisorStats();
		const liveV1 = statsV1.advisors.find((a) => a.name === "Changer");
		expect(liveV1).toBeDefined();
		expect(liveV1!.status).toBe("running");
		expect(JSON.stringify(liveV1!.model)).toContain("haiku");

		const result2 = await h.tool.execute("t2", { op: "upsert", name: "Changer", model: "anthropic/claude-sonnet-4-5", instructions: "v2" });
		expect(result2.isError).toBeUndefined();

		// File on disk should reflect v2, with NO duplicate entries.
		const content = fs.readFileSync(h.watchdogPath, "utf8");
		expect(content).toContain("v2");
		expect(content).toContain("claude-sonnet-4-5");
		expect((content.match(/name: Changer/g) ?? []).length).toBe(1);

		// Live stats containment: exactly ONE Changer runtime, now on the NEW model.
		const statsV2 = h.session.getAdvisorStats();
		const changers = statsV2.advisors.filter((a) => a.name === "Changer");
		expect(changers.length).toBe(1);
		expect(changers[0].status).toBe("running");
		expect(JSON.stringify(changers[0].model)).toContain("sonnet");
		expect(JSON.stringify(changers[0].model)).not.toContain("haiku");

		// Envelope verification mirrors the replaced runtime.
		const parsed = parseEnvelope<MutateEnvelope>(result2);
		const verified = parsed.verification.advisors.find((a) => a.name === "Changer");
		expect(verified).toBeDefined();
		expect(verified!.model).toBe("anthropic/claude-sonnet-4-5");
		expect(verified!.status).toBe("running");
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

	test("upsert while disabled: persisted + stored, not active; enable starts the runtime", async () => {
		h = await makeRealAdvisorSession();

		// Ensure disabled
		const disableRes = await h.tool.execute("t0", { op: "disable" });
		expect(disableRes.isError).toBeUndefined();

		// Upsert while disabled
		const upsertRes = await h.tool.execute("t1", { op: "upsert", name: "WhenDisabled", model: "anthropic/claude-haiku-4-5" });
		expect(upsertRes.isError).toBeUndefined();
		// File should exist
		expect(fs.existsSync(h.watchdogPath)).toBe(true);

		// Truthful semantics: persisted but NOT effective yet (stored until enable).
		const parsed = parseEnvelope<MutateEnvelope>(upsertRes);
		expect(parsed.persisted).toBe(true);
		expect(parsed.effectiveAt).toBe("stored");
		expect(parsed.verification.enabled).toBe(false);
		expect(parsed.verification.active).toBe(false);
		expect(parsed.verification.activeCount).toBe(0);
		expect(parsed.warnings.some((w) => w.includes("session flag is OFF") && w.includes("op=enable"))).toBe(true);
		expect(h.session.isAdvisorActive()).toBe(false);

		// Enable — advisor tool must NOT call discover here (ADR-005 §D3); the
		// host starts the roster stored by the upsert above.
		const enableRes = await h.tool.execute("t2", { op: "enable" });
		expect(enableRes.isError).toBeUndefined();
		expect(h.session.isAdvisorEnabled()).toBe(true);
		expect(h.session.isAdvisorActive()).toBe(true);
		const stats = h.session.getAdvisorStats();
		const started = stats.advisors.find((a) => a.name === "WhenDisabled");
		expect(started).toBeDefined();
		expect(started!.status).toBe("running");

		// Enable envelope carries the roster summary as evidence.
		const en = parseEnvelope<{ enabled: boolean; active: boolean; activeCount: number; advisors: Array<{ name: string; status: string }> }>(enableRes);
		expect(en.enabled).toBe(true);
		expect(en.active).toBe(true);
		expect(en.activeCount).toBeGreaterThanOrEqual(1);
		expect(en.advisors.some((a) => a.name === "WhenDisabled" && a.status === "running")).toBe(true);
	});
});

// =============================================================================
// I6: unknown tool name in upsert → warning; existing roster untouched (F6)
// =============================================================================

describe("I6: unknown tool name → warning; live roster unaffected (F6)", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("upsert with tools=[unknown] persists verbatim, warns about the default-subset fallback", async () => {
		h = await makeRealAdvisorSession();
		h.session.setAdvisorEnabled(true);

		// First, establish a known-good advisor
		await h.tool.execute("t0", { op: "upsert", name: "GoodBot", model: "anthropic/claude-haiku-4-5" });

		// Now upsert with an invalid tool name
		const result = await h.tool.execute("t1", {
			op: "upsert",
			name: "BadToolBot",
			model: "anthropic/claude-haiku-4-5",
			tools: ["nonexistent_tool_xyz"],
		});
		expect(result.isError).toBeUndefined();

		// Probed host semantics: the file keeps the unknown name VERBATIM, but
		// discovery drops unknown names; an all-unknown list collapses to
		// undefined → the advisor falls back to the host's default tool subset.
		// The tool must surface that as a warning (F6).
		const parsed = parseEnvelope<MutateEnvelope>(result);
		expect(
			parsed.warnings.some((w) => w.includes("nonexistent_tool_xyz") && w.includes("falls back to the DEFAULT")),
		).toBe(true);
		const fileContent = fs.readFileSync(h.watchdogPath, "utf8");
		expect(fileContent).toContain("nonexistent_tool_xyz");

		// The live roster is unaffected: BOTH advisors run (BadToolBot with the
		// default subset), and GoodBot is still listed.
		const stats = h.session.getAdvisorStats();
		expect(stats.advisors.find((a) => a.name === "GoodBot")?.status).toBe("running");
		expect(stats.advisors.find((a) => a.name === "BadToolBot")?.status).toBe("running");
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
		h2 = await makeRealAdvisorSession({ projectCwd: h.projectDir });
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
			expect(fs.existsSync(expectedPath)).toBe(true);
			// source in result should point to project root path
			const parsed = parseEnvelope<MutateEnvelope>(result);
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
// I10: implicit "default" advisor — visible, configurable, toggleable through
// the tool (CLI parity: the TUI seeds a default row and /advisor status shows
// it live; host legacy fallback in session-advisors #resolveAdvisorRuntimeDescriptors)
// =============================================================================

describe("I10: implicit default advisor lifecycle via the tool", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("empty roster → 'default' running; upsert enabled=false pauses it; remove restores implicit", async () => {
		h = await makeRealAdvisorSession();

		// (1) Enable with zero configured advisors → host runs the implicit legacy default.
		const en = await h.tool.execute("t0", { op: "enable" });
		expect(en.isError).toBeUndefined();
		let stats = h.session.getAdvisorStats();
		expect(stats.advisors.length).toBe(1);
		expect(stats.advisors[0].name).toBe("default");
		expect(stats.advisors[0].status).toBe("running");

		// list effective surfaces the synthetic implicit-default entry (decision 2).
		const list = await h.tool.execute("t1", { op: "list", scope: "effective" });
		expect(list.isError).toBeUndefined();
		const listBody = parseEnvelope<{ advisors: Array<{ name: string; implicit?: boolean }>; implicitDefault?: boolean; note?: string }>(list);
		expect(listBody.implicitDefault).toBe(true);
		expect(listBody.advisors).toEqual([{ name: "default", implicit: true }]);
		expect(listBody.note).toBeTruthy();

		// get name=default scope=effective returns the same synthetic entry.
		const got = await h.tool.execute("t1b", { op: "get", name: "default", scope: "effective" });
		expect(got.isError).toBeUndefined();
		const gotBody = parseEnvelope<{ advisor: { name: string; implicit?: boolean }; implicitDefault?: boolean }>(got);
		expect(gotBody.implicitDefault).toBe(true);
		expect(gotBody.advisor).toEqual({ name: "default", implicit: true });

		// (2) Per-advisor toggle: materialize with enabled=false → paused, still visible.
		const off = await h.tool.execute("t2", { op: "upsert", name: "default", enabled: false });
		expect(off.isError).toBeUndefined();
		stats = h.session.getAdvisorStats();
		expect(stats.advisors.length).toBe(1);
		expect(stats.advisors[0].name).toBe("default");
		expect(stats.advisors[0].status).toBe("paused");

		// (3) Remove the entry → file entry gone → implicit default resurfaces running.
		const rm = await h.tool.execute("t3", { op: "remove", name: "default" });
		expect(rm.isError).toBeUndefined();
		stats = h.session.getAdvisorStats();
		expect(stats.advisors.length).toBe(1);
		expect(stats.advisors[0].name).toBe("default");
		expect(stats.advisors[0].status).toBe("running");
	});

	test("upsert bare default → normalized away (mirrors TUI Save); no WATCHDOG entry left", async () => {
		h = await makeRealAdvisorSession();

		const result = await h.tool.execute("t0", { op: "upsert", name: "default" });
		expect(result.isError).toBeUndefined();
		const parsed = parseEnvelope<MutateEnvelope>(result);
		expect(parsed.warnings.some((w) => w.includes("not persisted"))).toBe(true);
		expect(parsed.persisted).toBe(false);

		// The project WATCHDOG must not contain a bare default entry.
		if (fs.existsSync(h.watchdogPath)) {
			const content = fs.readFileSync(h.watchdogPath, "utf8");
			expect(content).not.toContain("name: default");
		}
	});
});

// =============================================================================
// I11: multi-advisor runtime — two upserts + enable → TWO live runtimes with
// distinct models; parallel upserts on the same file both survive (per-path
// mutate serialization). This is the direct evidence for the "multi-advisor
// works at runtime" claim the 6-model review found unproven.
// =============================================================================

describe("I11: two advisors run concurrently; parallel upserts both survive", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("Promise.all upserts land both entries; enable → activeCount=2, both running, distinct models", async () => {
		h = await makeRealAdvisorSession();

		// Parallel upserts against the SAME WATCHDOG.yml — the per-path mutate
		// chain must serialize them so neither read-modify-write clobbers the other.
		const [r1, r2] = await Promise.all([
			h.tool.execute("t1", { op: "upsert", name: "Alpha", model: "anthropic/claude-haiku-4-5", instructions: "a" }),
			h.tool.execute("t2", { op: "upsert", name: "Beta", model: "anthropic/claude-sonnet-4-5", instructions: "b" }),
		]);
		expect(r1.isError).toBeUndefined();
		expect(r2.isError).toBeUndefined();
		const fileContent = fs.readFileSync(h.watchdogPath, "utf8");
		expect(fileContent).toContain("name: Alpha");
		expect(fileContent).toContain("name: Beta");

		// Enable → both runtimes start.
		const en = await h.tool.execute("t3", { op: "enable" });
		expect(en.isError).toBeUndefined();
		const enBody = parseEnvelope<{ activeCount: number; advisors: Array<{ name: string; status: string; model?: string }> }>(en);
		expect(enBody.activeCount).toBe(2);

		expect(h.session.isAdvisorActive()).toBe(true);
		const stats = h.session.getAdvisorStats();
		expect(stats.advisors.length).toBe(2);
		const alpha = stats.advisors.find((a) => a.name === "Alpha");
		const beta = stats.advisors.find((a) => a.name === "Beta");
		expect(alpha).toBeDefined();
		expect(beta).toBeDefined();
		expect(alpha!.status).toBe("running");
		expect(beta!.status).toBe("running");
		// Distinct models actually resolved per advisor.
		expect(JSON.stringify(alpha!.model)).toContain("haiku");
		expect(JSON.stringify(beta!.model)).toContain("sonnet");

		// status op passes the same evidence through the envelope.
		const status = await h.tool.execute("t4", { op: "status" });
		const stBody = parseEnvelope<{ activeCount: number; advisors: Array<{ name: string; status: string; model?: string }> }>(status);
		expect(stBody.activeCount).toBe(2);
		expect(stBody.advisors.find((a) => a.name === "Alpha")?.model).toBe("anthropic/claude-haiku-4-5");
		expect(stBody.advisors.find((a) => a.name === "Beta")?.model).toBe("anthropic/claude-sonnet-4-5");
	});
});

// =============================================================================
// I12: L3 streaming — real AgentSession, scripted advisor streams via the
// host's `advisorStreamFn` seam (agent-session.ts → session-advisors options).
// Two advisors each emit a unique-marker blocker advise; the host steers the
// advisories into the primary transcript. A persistent SessionManager (NOT
// inMemory — its getSessionFile() is null so recorders would skip writes)
// makes AdvisorTranscriptRecorder persist `<sessionStem>/__advisor.<slug>.jsonl`.
// A paused advisor must produce NO transcript.
// =============================================================================

describe("I12: advisor advise streams reach the primary; transcripts persisted", () => {
	let h: Harness | undefined;
	afterEach(async () => { await teardownHarness(h); h = undefined; });

	test("two advisors' markers reach the primary; __advisor.<slug>.jsonl written; paused advisor silent", async () => {
		// Distinctive, content-bearing notes: the host's AdvisorEmissionGuard
		// suppresses content-free filler ("ok", "no issues"), so markers ride
		// inside realistic advice sentences. Severity "blocker" delivers even
		// against in-progress-update withholding, and steers when the primary
		// is idle (resolveAdvisorDeliveryChannel).
		const MARKER_ALPHA = "Verify the retry cap in loader.ts before merging (ref QOL-MARK-ALPHA-7431).";
		const MARKER_BETA = "Missing await on writeStream.end() can lose buffered writes (ref QOL-MARK-BETA-9182).";

		// Each advisor's scripted model: one advise tool call, then plain text
		// for every later review turn (constructor responses → fallback handler).
		const alphaMock = createMockModel({
			responses: [
				{ content: [{ type: "toolCall", name: "advise", arguments: { note: MARKER_ALPHA, severity: "blocker" } }] },
			],
			handler: { content: ["Alpha review turn complete."] },
		});
		const betaMock = createMockModel({
			responses: [
				{ content: [{ type: "toolCall", name: "advise", arguments: { note: MARKER_BETA, severity: "blocker" } }] },
			],
			handler: { content: ["Beta review turn complete."] },
		});
		// One advisorStreamFn serves ALL advisor runtimes; dispatch on the
		// advisor's resolved model (Alpha=haiku, Beta=sonnet).
		const advisorStreamFn = (model: { id?: string }, context: unknown, options?: unknown) =>
			(model?.id ?? "").includes("haiku")
				? alphaMock.stream(model as never, context as never, options as never)
				: betaMock.stream(model as never, context as never, options as never);

		// Primary mock: one scripted answer for the user prompt, then a fallback
		// for the turns the steered blocker advisories trigger.
		const primaryMock = createMockModel({
			responses: [{ content: [{ type: "text", text: "Initial answer from the primary." }] }],
			handler: { content: ["Acknowledged the advisory."] },
		});

		h = await makeRealAdvisorSession({
			persistentSession: true,
			advisorStreamFn,
			primaryMock,
			syncBacklog: true, // primary turn awaits advisor catch-up (advisor.syncBacklog="1")
		});

		// Roster: two live advisors with distinct models + one paused advisor.
		await h.tool.execute("t1", { op: "upsert", name: "Alpha", model: "anthropic/claude-haiku-4-5" });
		await h.tool.execute("t2", { op: "upsert", name: "Beta", model: "anthropic/claude-sonnet-4-5" });
		await h.tool.execute("t3", { op: "upsert", name: "Gamma", model: "anthropic/claude-haiku-4-5", enabled: false });
		const en = await h.tool.execute("t4", { op: "enable" });
		expect(en.isError).toBeUndefined();
		const enBody = parseEnvelope<{ activeCount: number }>(en);
		expect(enBody.activeCount).toBe(2);

		// One primary turn. syncBacklog=1 makes onPrimaryTurnEnd await both
		// advisors' review turns (which fire the advise calls).
		await h.session.prompt("Please review the current work.");

		// Blocker advisories steer in as custom messages and trigger follow-up
		// turns; poll until both markers are in the primary transcript.
		const messagesText = () => JSON.stringify(h!.session.agent.state.messages);
		await waitFor(() => messagesText().includes(MARKER_ALPHA) && messagesText().includes(MARKER_BETA), 20_000);
		await h.session.waitForIdle();
		expect(messagesText()).toContain(MARKER_ALPHA);
		expect(messagesText()).toContain(MARKER_BETA);

		// Both advisors actually streamed through the seam.
		expect(alphaMock.calls.length).toBeGreaterThanOrEqual(1);
		expect(betaMock.calls.length).toBeGreaterThanOrEqual(1);

		// Transcripts: <sessionStem>/__advisor.<slug>.jsonl with assistant records.
		const stem = h.sessionFile!.slice(0, -".jsonl".length);
		const alphaTranscript = path.join(stem, "__advisor.alpha.jsonl");
		const betaTranscript = path.join(stem, "__advisor.beta.jsonl");
		const hasAssistantRecord = (file: string): boolean => {
			if (!fs.existsSync(file)) return false;
			return fs
				.readFileSync(file, "utf8")
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.some((line) => {
					try {
						return JSON.stringify(JSON.parse(line)).includes('"role":"assistant"');
					} catch {
						return false;
					}
				});
		};
		// Recorder writes are queued async; poll until flushed.
		await waitFor(() => hasAssistantRecord(alphaTranscript) && hasAssistantRecord(betaTranscript), 15_000);
		expect(fs.existsSync(alphaTranscript)).toBe(true);
		expect(fs.existsSync(betaTranscript)).toBe(true);
		expect(hasAssistantRecord(alphaTranscript)).toBe(true);
		expect(hasAssistantRecord(betaTranscript)).toBe(true);

		// The paused advisor never ran → no transcript file.
		expect(fs.existsSync(path.join(stem, "__advisor.gamma.jsonl"))).toBe(false);
	}, 60_000);
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
		expect(result.content[0].text).toContain("No live main-agent session");

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
