/**
 * Delivery-grade integration tests: REAL host AgentSession + REAL bridge
 * resolution + scripted model (the host's own mock provider). No mocks of
 * our own logic, no LLM keys: the agent loop executes our `mode` tool and
 * we assert on the host's real state.
 *
 * Layers covered here (see docs/plans/TDDs/qol-delivery-test-plan.md):
 *   I1  bridge reach: resolveHostBridge() finds the live registered session
 *   I2  scripted-turn e2e: agent calls mode plan_enter/status -> host plan state on
 *   I3  plan_exit direct on the real session -> state cleared
 *   I4  scripted-turn e2e: vibe_enter installs REAL vibe tools into the host
 *       session; vibe_exit restores
 *   I5  real goal runtime blocks plan_enter
 *   I6  unregistered session -> honest refusal (real bridge path)
 *
 * NOTE: these tests import the monorepo host source (ref_repos/oh-my-pi)
 * via the workspace node_modules junction, so the plugin's dynamic
 * `@oh-my-pi/pi-coding-agent` import and these imports share one module
 * instance — exactly the source-link host condition the tool targets.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { createMockModel, type MockResponse } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createVibeTools } from "@oh-my-pi/pi-coding-agent/tools/vibe";
import { enforcePlanModeWrite } from "@oh-my-pi/pi-coding-agent/tools/plan-mode-guard";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { resolveHostBridge } from "../src/lib/host-bridge";
import { registerModeTool } from "../src/mode-tool";
import { z } from "zod/v4";

// =============================================================================
// Harness: a real AgentSession wired like the host does, plus our tool
// =============================================================================

interface ModeToolHandle {
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

interface Harness {
	session: AgentSession;
	authStorage: AuthStorage;
	tool: ModeToolHandle;
	registryId: string;
	tmp: string;
}

function makeDummyTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `Dummy ${name} for integration wiring`,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};
}

async function makeRealSession(responses: MockResponse[], options?: { withVibeTools?: boolean }): Promise<Harness> {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("bundled anthropic model missing");

	// Capture our mode tool definition with the REAL (production) resolver.
	const captured: Array<{ definition: Record<string, unknown> }> = [];
	registerModeTool(
		{
			zod: z,
			logger: { info: () => {}, warn: () => {}, error: () => {} },
			registerTool: (definition: Record<string, unknown>) => captured.push({ definition }),
			on: () => {},
		} as never,
		// no resolveBridge override -> the production resolver runs for real
	);
	if (captured.length !== 1) throw new Error("mode tool not captured");
	const def = captured[0].definition;

	// Agent-loop-compatible wrapper: the host validates params against an
	// omptype schema; ExtensionToolWrapper performs the same pass-through.
	const modeWrapper: AgentTool = {
		name: "mode",
		label: "Mode",
		description: String(def.description),
		parameters: type({ op: type("string"), "objective?": type("string") }),
		execute: (toolCallId, params, signal) =>
			(def.execute as ModeToolHandle["execute"])(toolCallId, params as Record<string, unknown>, signal),
	};

	const readTool = makeDummyTool("read");
	const todoTool = makeDummyTool("todo");

	const mock = createMockModel({ responses });
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: {
			model,
			systemPrompt: ["Test"],
			tools: [modeWrapper, readTool, todoTool],
			messages: [],
		},
		streamFn: mock.stream,
	});

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qol-int-"));
	const authStorage = await AuthStorage.create(path.join(tmp, `auth-${Snowflake.next()}.db`));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(tmp, `models-${Snowflake.next()}.yml`));

	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(),
		settings: Settings.isolated({
			"compaction.enabled": false,
			"retry.enabled": false,
		}),
		modelRegistry,
		toolRegistry: new Map<string, AgentTool>([
			["mode", modeWrapper],
			["read", readTool],
			["todo", todoTool],
		]),
		builtInToolNames: ["read", "todo"],
		advisorTools: [],
		createVibeTools: options?.withVibeTools ? () => createVibeTools(session as never) : undefined,
	} as never);

	// Register exactly like the host does for the main agent.
	const registryId = `qol-int-${Snowflake.next()}`;
	AgentRegistry.global().register({
		id: registryId,
		displayName: "qol-int",
		kind: "main",
		session,
		status: "running",
	});

	return { session, authStorage, tool: def as unknown as ModeToolHandle, registryId, tmp };
}

async function teardown(h: Harness | undefined): Promise<void> {
	if (!h) return;
	AgentRegistry.global().unregister(h.registryId);
	try {
		await h.session.dispose();
	} catch {
		// best effort
	}
	try {
		h.authStorage.close();
	} catch {
		// best effort
	}
	try {
		fs.rmSync(h.tmp, { recursive: true, force: true });
	} catch {
		// best effort
	}
}

const modeCall = (op: string, objective?: string): MockResponse => ({
	content: [{ type: "toolCall", name: "mode", arguments: objective ? { op, objective } : { op } }],
});
const done: MockResponse = { content: [{ type: "text", text: "done" }] };

// =============================================================================
// I1/I6: bridge reach + honest refusal
// =============================================================================

describe("host bridge against a real session", () => {
	let h: Harness | undefined;
	afterEach(async () => {
		await teardown(h);
		h = undefined;
	});

	test("I1: resolveHostBridge finds the live registered session", async () => {
		h = await makeRealSession([done]);
		const bridge = await resolveHostBridge();
		expect(bridge).not.toBeNull();
		expect(bridge?.session).toBe(h!.session as unknown);
	});

	test("I6: with no registered session the tool refuses honestly", async () => {
		h = await makeRealSession([done]);
		AgentRegistry.global().unregister(h!.registryId);
		const result = await h!.tool.execute("c", { op: "status" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("live host session");
		// Re-register so teardown's unregister stays balanced.
		AgentRegistry.global().register({
			id: h!.registryId,
			displayName: "qol-int",
			kind: "main",
			session: h!.session,
			status: "running",
		});
	});
});

// =============================================================================
// I2/I3: plan mode through the real agent loop and real session state
// =============================================================================

describe("plan mode on a real session", () => {
	let h: Harness | undefined;
	afterEach(async () => {
		await teardown(h);
		h = undefined;
	});

	test("I2: scripted agent turn -> mode plan_enter -> host plan state enabled", async () => {
		h = await makeRealSession([modeCall("plan_enter", "design it"), modeCall("status"), done]);
		await h.session.prompt("go");
		await h.session.waitForIdle();
		const state = h.session.getPlanModeState();
		expect(state?.enabled).toBe(true);
		expect(state?.planFilePath).toBe("local://PLAN.md");
		expect(state?.workflow).toBe("parallel");
	});

	test("I3: plan_exit on the real session clears host state", async () => {
		h = await makeRealSession([modeCall("plan_enter"), done]);
		await h.session.prompt("go");
		await h.session.waitForIdle();
		expect(h.session.getPlanModeState()?.enabled).toBe(true);
		const exit = await h.tool.execute("c", { op: "plan_exit" });
		expect(exit.isError).toBeUndefined();
		expect(h.session.getPlanModeState()).toBeUndefined();
	});

	test("I7: state set via the tool drives the host's own write guard", async () => {
		h = await makeRealSession([modeCall("plan_enter"), done]);
		await h.session.prompt("go");
		await h.session.waitForIdle();
		// The host's plan-mode write guard reads exactly the state our driver set:
		// while plan mode is on, non-sandbox writes must be refused.
		expect(() => enforcePlanModeWrite(h!.session as never, "/outside/plan/file.txt")).toThrow(
			/[Pp]lan mode/,
		);
		await h.tool.execute("c", { op: "plan_exit" });
		// After exit the same guard passes (no throw).
		expect(() => enforcePlanModeWrite(h!.session as never, "/outside/plan/file.txt")).not.toThrow();
	});
});

// =============================================================================
// I4: vibe mode — real tool installation into the host session
// =============================================================================

describe("vibe mode on a real session", () => {
	let h: Harness | undefined;
	afterEach(async () => {
		await teardown(h);
		h = undefined;
	});

	test("I4: scripted vibe_enter installs the real vibe toolset; vibe_exit restores", async () => {
		h = await makeRealSession([modeCall("vibe_enter", "ship"), done], { withVibeTools: true });
		await h.session.prompt("go");
		await h.session.waitForIdle();

		expect(h.session.getVibeModeState()?.enabled).toBe(true);
		const active = h.session.getEnabledToolNames();
		for (const name of ["vibe_spawn", "vibe_send", "vibe_wait", "vibe_kill", "vibe_list"]) {
			expect(active).toContain(name);
		}
		expect(active).toContain("read"); // base toolset per InteractiveMode
		expect(active).toContain("todo"); // built-in todo joins the base
		expect(active).toContain("mode"); // the driver keeps its own exit switch callable

		const exit = await h.tool.execute("c", { op: "vibe_exit" });
		expect(exit.isError).toBeUndefined();
		expect(h.session.getVibeModeState()).toBeUndefined();
		// Restored set = pre-vibe snapshot (mode/read/todo): every vibe_* gone,
		// and nothing beyond the snapshot returns.
		const restored = h.session.getEnabledToolNames();
		expect(restored.filter(n => n.startsWith("vibe_"))).toEqual([]);
		expect([...restored].sort()).toEqual(["mode", "read", "todo"]);
	});
});

// =============================================================================
// I5: real goal runtime enforces mutual exclusion
// =============================================================================

describe("goal mutual exclusion on a real session", () => {
	let h: Harness | undefined;
	afterEach(async () => {
		await teardown(h);
		h = undefined;
	});

	test("I5: a real active goal blocks plan_enter through the tool", async () => {
		h = await makeRealSession([done]);
		await h.session.goalRuntime.createGoal({ objective: "real goal" });
		const blocked = await h.tool.execute("c", { op: "plan_enter" });
		expect(blocked.isError).toBe(true);
		expect(blocked.content[0].text).toContain("goal is active");
		expect(h.session.getPlanModeState()).toBeUndefined();
	});
});
