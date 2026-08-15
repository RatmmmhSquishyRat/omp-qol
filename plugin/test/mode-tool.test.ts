import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import { DEFAULT_PLAN_FILE_URL, MODE_TOOL_NAME, registerModeTool } from "../src/mode-tool";
import type { HostBridge } from "../src/lib/host-bridge";
import factory from "../src/main";

// =============================================================================
// Extension API mock (registration + tool capture)
// =============================================================================

interface ToolResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

/** Parse the unified JSON envelope from a result's text. */
function parseEnvelope<T = Record<string, unknown>>(result: ToolResult): T {
	const text = result.content[0]?.text ?? "";
	const start = text.indexOf("{");
	if (start < 0) throw new Error(`no JSON in result text: ${text}`);
	return JSON.parse(text.slice(start)) as T;
}

function makeModePi() {
	const tools: Array<{ definition: Record<string, unknown> }> = [];
	const api = {
		zod: z,
		setLabel: (_label: string) => {},
		logger: { info: (..._a: unknown[]) => {}, warn: (..._a: unknown[]) => {}, error: (..._a: unknown[]) => {} },
		registerTool: (definition: Record<string, unknown>) => {
			tools.push({ definition });
		},
		registerCommand: (_name: string, _def: unknown) => {},
		on: (_event: string, _handler: unknown) => {},
	};
	function modeTool() {
		const entry = tools.find(t => t.definition.name === MODE_TOOL_NAME);
		if (!entry) throw new Error("mode tool not registered");
		return entry.definition as {
			name: string;
			label?: string;
			approval?: string;
			loadMode?: string;
			description?: string;
			parameters: z.ZodType;
			execute: (
				toolCallId: string,
				params: Record<string, unknown>,
				signal?: AbortSignal,
				onUpdate?: unknown,
				ctx?: Record<string, unknown>,
			) => Promise<ToolResult>;
		};
	}
	return { api, tools, modeTool };
}

type ModePi = ReturnType<typeof makeModePi>;

// =============================================================================
// Fake live session + vibe registry (host-bridge stand-ins)
// =============================================================================

function makeFakeSession() {
	const state: {
		plan?: { enabled?: boolean; planFilePath?: string; workflow?: string; reentry?: boolean };
		vibe?: { enabled?: boolean };
		goal?: { enabled?: boolean; goal?: { status?: string } };
		settings: Record<string, unknown>;
		journal: Array<{ type?: string; mode?: string }>;
	} = { settings: {}, journal: [] };
	let active = ["read", "write", "edit", "bash", "todo", "task", "goal", "mode"];
	const calls: string[] = [];
	let proposalHandler: ((title: string) => unknown) | null = null;
	const session = {
		getPlanModeState: () => state.plan,
		setPlanModeState: (s: unknown) => {
			state.plan = s as typeof state.plan;
			calls.push("setPlanModeState");
		},
		getGoalModeState: () => state.goal,
		getVibeModeState: () => state.vibe,
		setVibeModeState: (s: unknown) => {
			state.vibe = s as typeof state.vibe;
		},
		activateVibeTools: async (base: string[]) => {
			active = [...base, "vibe_spawn", "vibe_send", "vibe_wait", "vibe_kill", "vibe_list"];
			calls.push("activateVibeTools");
		},
		deactivateVibeTools: async (next: string[]) => {
			active = [...next];
			calls.push("deactivateVibeTools");
		},
		getEnabledToolNames: () => [...active],
		hasBuiltInTool: (name: string) => name === "todo",
		setPlanProposalHandler: (h: ((title: string) => unknown) | null) => {
			proposalHandler = h;
			calls.push(`setPlanProposalHandler:${h ? "set" : "null"}`);
		},
		settings: { get: (key: string) => state.settings[key] },
		getAgentId: () => "Main",
		asyncJobManager: {},
		sessionManager: {
			getSessionId: () => "sess-1",
			getSessionFile: () => "/tmp/sess.jsonl",
			appendModeChange: (mode: string) => {
				state.journal.push({ type: "mode_change", mode });
			},
			getEntries: () => [...state.journal],
			buildSessionContext: () => {
				let mode = "none";
				for (const entry of state.journal) {
					if (entry.type === "mode_change" && typeof entry.mode === "string") mode = entry.mode;
				}
				return { mode };
			},
		},
	};
	return {
		session,
		state,
		calls,
		getActive: () => [...active],
		getProposalHandler: () => proposalHandler,
	};
}

function makeFakeVibeRegistry() {
	const calls: string[] = [];
	return {
		registry: {
			ownerScope: (_s: unknown) => {
				calls.push("ownerScope");
				return { ownerId: "Main", parentSessionId: "sess-1", parentSessionFile: null };
			},
			activateScope: (_scope: unknown) => {
				calls.push("activateScope");
			},
			killAll: async (_s: unknown, _scope?: unknown) => {
				calls.push("killAll");
				return 2;
			},
		},
		calls,
	};
}

function makeNativeBridge(withVibe = true): {
	bridge: HostBridge;
	fake: ReturnType<typeof makeFakeSession>;
	vibeCalls: string[];
} {
	const fake = makeFakeSession();
	const reg = makeFakeVibeRegistry();
	return {
		bridge: { session: fake.session, vibeRegistry: withVibe ? reg.registry : null, vibeRegistryTrusted: withVibe } as HostBridge,
		fake,
		vibeCalls: reg.calls,
	};
}

// =============================================================================
// N. Plan mode — the host's own switch, ACP-shaped
// =============================================================================

describe("plan mode (native switch)", () => {
	test("N1: plan_enter sets host plan state (ACP shape) + proposal handler", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const result = await pi.modeTool().execute("c", { op: "plan_enter", objective: "x" });
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("ACTIVE");
		expect(fake.state.plan).toEqual({
			enabled: true,
			planFilePath: DEFAULT_PLAN_FILE_URL,
			workflow: "parallel",
			reentry: false,
		});
		expect(fake.calls).toContain("setPlanProposalHandler:set");
		expect(fake.getProposalHandler()).toBeTruthy();
		expect(fake.state.journal.at(-1)).toEqual({ type: "mode_change", mode: "plan" });
		// Host primitives untouched by us: no tool-list changes (ACP parity).
		expect(fake.calls).not.toContain("activateVibeTools");
	});

	test("N1b: plan_enter is idempotent while active; re-entry preserves existing plan path", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		await tool.execute("c", { op: "plan_enter" });
		const again = await tool.execute("c", { op: "plan_enter" });
		expect(again.isError).toBeUndefined();
		expect(again.content[0].text).toContain("already active");
		// A pre-existing plan path (e.g. from a prior plan session) is kept,
		// and re-applying over live state marks reentry (ACP shape).
		fake.state.plan = { enabled: false, planFilePath: "local://qol-plan.md", workflow: "iterative" };
		await tool.execute("c", { op: "plan_enter" });
		expect(fake.state.plan?.planFilePath).toBe("local://qol-plan.md");
		expect(fake.state.plan?.workflow).toBe("iterative");
		expect(fake.state.plan?.reentry).toBe(true);
	});

	test("N1c: plan.enabled=false in settings blocks plan_enter", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		fake.state.settings["plan.enabled"] = false;
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const result = await pi.modeTool().execute("c", { op: "plan_enter" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("plan.enabled");
	});

	test("N2: guards — vibe-on and goal-active block plan_enter", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();

		fake.state.vibe = { enabled: true };
		const blockedByVibe = await tool.execute("c", { op: "plan_enter" });
		expect(blockedByVibe.isError).toBe(true);
		expect(blockedByVibe.content[0].text).toContain("Vibe mode is active");
		fake.state.vibe = undefined;

		fake.state.goal = { enabled: true, goal: { status: "active" } };
		const blockedByGoal = await tool.execute("c", { op: "plan_enter" });
		expect(blockedByGoal.isError).toBe(true);
		expect(blockedByGoal.content[0].text).toContain("goal is active");
		expect(blockedByGoal.content[0].text).toContain("Pausing the goal does not free the slot");
	});

	test("N2b: paused goal occupies the slot — blocks plan_enter and vibe_enter", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		fake.state.goal = { enabled: false, goal: { status: "paused" } };

		const planBlocked = await tool.execute("c", { op: "plan_enter" });
		expect(planBlocked.isError).toBe(true);
		expect(planBlocked.content[0].text).toContain("goal is paused");
		expect(planBlocked.content[0].text).toContain("Pause does not free the slot");
		expect(fake.state.plan).toBeUndefined();

		const vibeBlocked = await tool.execute("c", { op: "vibe_enter" });
		expect(vibeBlocked.isError).toBe(true);
		expect(vibeBlocked.content[0].text).toContain("goal is paused");
		expect(fake.state.vibe).toBeUndefined();
	});

	test("N2c: journal plan_paused occupies the slot for vibe_enter; plan_enter may re-enter", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		fake.state.journal.push({ type: "mode_change", mode: "plan_paused" });

		const vibeBlocked = await tool.execute("c", { op: "vibe_enter" });
		expect(vibeBlocked.isError).toBe(true);
		expect(vibeBlocked.content[0].text).toContain("Plan mode is paused");
		expect(vibeBlocked.content[0].text).toContain("Pause does not free the slot");
		expect(fake.state.vibe).toBeUndefined();

		// Same-mode re-enter: TUI #enterPlanMode does not treat planPaused as a foreign mode.
		const planEnter = await tool.execute("c", { op: "plan_enter" });
		expect(planEnter.isError).toBeUndefined();
		expect(fake.state.plan?.enabled).toBe(true);
	});

	test("N2e: buildSessionContext.mode is enough when getEntries is absent", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		delete (fake.session.sessionManager as { getEntries?: unknown }).getEntries;
		fake.session.sessionManager.buildSessionContext = () => ({ mode: "plan_paused" });
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		const vibeEnter = await tool.execute("c", { op: "vibe_enter" });
		expect(vibeEnter.isError).toBe(true);
		expect(vibeEnter.content[0].text).toContain("Plan mode is paused");
		expect(fake.state.vibe).toBeUndefined();
	});

	test("N2f: buildSessionContext wins over a stale getEntries tail", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		fake.session.sessionManager.getEntries = () => [{ type: "mode_change", mode: "plan_paused" }];
		fake.session.sessionManager.buildSessionContext = () => ({ mode: "none" });
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		const vibeEnter = await tool.execute("c", { op: "vibe_enter" });
		expect(vibeEnter.isError).toBeUndefined();
		expect(fake.state.vibe?.enabled).toBe(true);
	});

	test("N2d: complete/dropped goals do not occupy the slot", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		fake.state.goal = { enabled: false, goal: { status: "complete" } };
		const afterComplete = await tool.execute("c", { op: "plan_enter" });
		expect(afterComplete.isError).toBeUndefined();
		await tool.execute("c", { op: "plan_exit" });
		fake.state.goal = { enabled: false, goal: { status: "dropped" } };
		const afterDropped = await tool.execute("c", { op: "plan_enter" });
		expect(afterDropped.isError).toBeUndefined();
	});

	test("N3: plan_exit clears handler + state; exit without plan errors", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		await tool.execute("c", { op: "plan_enter" });
		const exit = await tool.execute("c", { op: "plan_exit" });
		expect(exit.isError).toBeUndefined();
		expect(fake.state.plan).toBeUndefined();
		expect(fake.calls).toContain("setPlanProposalHandler:null");
		expect(fake.getProposalHandler()).toBeNull();
		const exitAgain = await tool.execute("c", { op: "plan_exit" });
		expect(exitAgain.isError).toBe(true);
		expect(exitAgain.content[0].text).toContain("not active");
	});
});

// =============================================================================
// V. Vibe mode — the host's own sequence (InteractiveMode-shaped)
// =============================================================================

describe("vibe mode (native sequence)", () => {
	test("N4: vibe_enter drives registry scope + installs native vibe tools", async () => {
		const pi = makeModePi();
		const { bridge, fake, vibeCalls } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const result = await pi.modeTool().execute("c", { op: "vibe_enter", objective: "ship" });
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("vibe_spawn");
		expect(fake.getActive()).toEqual(["read", "todo", "mode", "vibe_spawn", "vibe_send", "vibe_wait", "vibe_kill", "vibe_list"]);
		expect(fake.state.vibe).toEqual({ enabled: true });
		expect(vibeCalls).toEqual(["ownerScope", "activateScope"]);
	});

	test("N5: vibe_exit kills workers, restores tools, clears state", async () => {
		const pi = makeModePi();
		const { bridge, fake, vibeCalls } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		const before = fake.getActive();
		await tool.execute("c", { op: "vibe_enter" });
		const exit = await tool.execute("c", { op: "vibe_exit" });
		expect(exit.isError).toBeUndefined();
		expect(exit.content[0].text).toContain("killed 2 worker sessions");
		expect(vibeCalls).toContain("killAll");
		expect(fake.getActive()).toEqual(before);
		expect(fake.state.vibe).toBeUndefined();
		expect((await tool.execute("c", { op: "vibe_exit" })).isError).toBe(true);
	});

	test("N6: mutual exclusion both directions + idempotent re-enter", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		await tool.execute("c", { op: "vibe_enter" });
		const planBlocked = await tool.execute("c", { op: "plan_enter" });
		expect(planBlocked.isError).toBe(true);
		const again = await tool.execute("c", { op: "vibe_enter" });
		expect(again.isError).toBeUndefined();
		expect(again.content[0].text).toContain("already active");
		await tool.execute("c", { op: "vibe_exit" });
		await tool.execute("c", { op: "plan_enter" });
		const vibeBlocked = await tool.execute("c", { op: "vibe_enter" });
		expect(vibeBlocked.isError).toBe(true);
		expect(vibeBlocked.content[0].text).toContain("Plan mode is active");
	});

	test("N7: vibe_enter without a registry is refused", async () => {
		const pi = makeModePi();
		const { bridge } = makeNativeBridge(false);
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const result = await pi.modeTool().execute("c", { op: "vibe_enter" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("vibe worker registry");
	});

	test("N7b: vibe_enter with an UNTRUSTED registry is refused (would orphan workers)", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		bridge.vibeRegistryTrusted = false;
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const result = await pi.modeTool().execute("c", { op: "vibe_enter" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("vibe worker registry");
		// State must remain untouched.
		expect(fake.state.vibe).toBeUndefined();
	});
});

// =============================================================================
// T. Vibe mode on sealed hosts — the injected LIVE tool-class path (§7.2)
// =============================================================================

/**
 * Stand-ins for the host's own VibeListTool/VibeKillTool classes as carried
 * by the injected root barrel. The real classes' bodies hit the host
 * bundle's VibeSessionRegistry singleton; here we only verify the driver
 * contract: construction with the VibeParentSession facade, list→per-id kill,
 * and that exit degrades gracefully when a worker resists.
 */
function makeFakeVibeToolClasses(initialIds: string[], failKill: Set<string> = new Set()) {
	let ids = [...initialIds];
	const calls: string[] = [];
	const seenSessions: Array<Record<string, unknown>> = [];
	class VibeListTool {
		constructor(readonly session: Record<string, unknown>) {
			seenSessions.push(session);
		}
		async execute() {
			calls.push("list");
			return { content: [], details: { op: "list", screens: ids.map(id => ({ id })) } };
		}
	}
	class VibeKillTool {
		constructor(readonly session: Record<string, unknown>) {
			seenSessions.push(session);
		}
		async execute(_toolCallId: string, params: { session: string }) {
			calls.push(`kill:${params.session}`);
			if (failKill.has(params.session)) throw new Error("worker resists");
			ids = ids.filter(id => id !== params.session);
			return { content: [], details: { op: "kill", screens: [] } };
		}
	}
	return { VibeListTool, VibeKillTool, calls, seenSessions, remaining: () => [...ids] };
}

function makeSealedPi(toolClasses?: ReturnType<typeof makeFakeVibeToolClasses>) {
	const pi = makeModePi();
	const injectedRoot = toolClasses
		? { VibeListTool: toolClasses.VibeListTool, VibeKillTool: toolClasses.VibeKillTool }
		: {};
	const api = { ...pi.api, pi: injectedRoot };
	const fake = makeFakeSession();
	const bridge: HostBridge = { session: fake.session, vibeRegistry: null, vibeRegistryTrusted: false };
	return { api, modeTool: pi.modeTool, fake, bridge };
}

describe("vibe mode (sealed host, injected live tool classes)", () => {
	test("T1: vibe_enter uses the tools path when no trusted registry exists", async () => {
		const classes = makeFakeVibeToolClasses(["w1"]);
		const { api, modeTool, fake, bridge } = makeSealedPi(classes);
		registerModeTool(api as never, { resolveBridge: async () => bridge });
		const result = await modeTool().execute("c", { op: "vibe_enter", objective: "ship" });
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("vibe_spawn");
		expect(fake.state.vibe).toEqual({ enabled: true });
		expect(fake.getActive()).toEqual(["read", "todo", "mode", "vibe_spawn", "vibe_send", "vibe_wait", "vibe_kill", "vibe_list"]);
		// No registry bookkeeping on this path (§7.2): enter touches no tools yet.
		expect(classes.calls).toEqual([]);
	});

	test("T2: vibe_exit enumerates screens and kills per-id via the live classes", async () => {
		const classes = makeFakeVibeToolClasses(["w1", "w2"]);
		const { api, modeTool, fake, bridge } = makeSealedPi(classes);
		registerModeTool(api as never, { resolveBridge: async () => bridge });
		const tool = modeTool();
		const before = fake.getActive();
		await tool.execute("c", { op: "vibe_enter" });
		const exit = await tool.execute("c", { op: "vibe_exit" });
		expect(exit.isError).toBeUndefined();
		expect(exit.content[0].text).toContain("killed 2 worker sessions");
		expect(classes.calls).toEqual(["list", "kill:w1", "kill:w2"]);
		expect(classes.remaining()).toEqual([]);
		// The tool classes were constructed with the VibeParentSession facade.
		for (const session of classes.seenSessions) {
			expect(typeof (session as { getSessionId?: () => unknown }).getSessionId).toBe("function");
			expect((session as { getSessionId: () => string }).getSessionId()).toBe("sess-1");
		}
		expect(fake.getActive()).toEqual(before);
		expect(fake.state.vibe).toBeUndefined();
		expect((await tool.execute("c", { op: "vibe_exit" })).isError).toBe(true);
	});

	test("T3: a worker that resists kill does not strand vibe_exit", async () => {
		const classes = makeFakeVibeToolClasses(["w1", "w2"], new Set(["w1"]));
		const { api, modeTool, fake, bridge } = makeSealedPi(classes);
		registerModeTool(api as never, { resolveBridge: async () => bridge });
		const tool = modeTool();
		await tool.execute("c", { op: "vibe_enter" });
		const exit = await tool.execute("c", { op: "vibe_exit" });
		expect(exit.isError).toBeUndefined();
		expect(exit.content[0].text).toContain("killed 1 worker session");
		expect(fake.state.vibe).toBeUndefined();
	});

	test("T4: re-enter after tools-path exit works (no terminated-scope lockout)", async () => {
		const classes = makeFakeVibeToolClasses(["w1"]);
		const { api, modeTool, fake, bridge } = makeSealedPi(classes);
		registerModeTool(api as never, { resolveBridge: async () => bridge });
		const tool = modeTool();
		await tool.execute("c", { op: "vibe_enter" });
		await tool.execute("c", { op: "vibe_exit" });
		const reenter = await tool.execute("c", { op: "vibe_enter" });
		expect(reenter.isError).toBeUndefined();
		expect(fake.state.vibe).toEqual({ enabled: true });
	});

	test("T5: neither trusted registry nor tool classes -> honest refusal", async () => {
		const { api, modeTool, fake, bridge } = makeSealedPi(undefined);
		registerModeTool(api as never, { resolveBridge: async () => bridge });
		const result = await modeTool().execute("c", { op: "vibe_enter" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("vibe worker registry");
		expect(fake.state.vibe).toBeUndefined();
		expect(fake.calls).not.toContain("activateVibeTools");
	});

	test("T6: trusted registry takes precedence over the tools path", async () => {
		const classes = makeFakeVibeToolClasses(["w1"]);
		const pi = makeModePi();
		const api = { ...pi.api, pi: { VibeListTool: classes.VibeListTool, VibeKillTool: classes.VibeKillTool } };
		const { bridge, fake, vibeCalls } = makeNativeBridge(true);
		registerModeTool(api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();
		await tool.execute("c", { op: "vibe_enter" });
		expect(vibeCalls).toEqual(["ownerScope", "activateScope"]);
		const exit = await tool.execute("c", { op: "vibe_exit" });
		expect(exit.content[0].text).toContain("killed 2 worker sessions");
		expect(vibeCalls).toContain("killAll");
		// Live tool classes never driven while the registry path is available.
		expect(classes.calls).toEqual([]);
		expect(fake.state.vibe).toBeUndefined();
	});
});

// =============================================================================
// S. Status, bridge availability, registration shape
// =============================================================================

describe("status / bridge / registration", () => {
	test("N8: status reads live host state (structured envelope)", async () => {
		const pi = makeModePi();
		const { bridge, fake } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const tool = pi.modeTool();

		const off = parseEnvelope<{ ok: boolean; tool: string; op: string; plan: boolean; vibe: boolean; goal: string; message: string; planPaused: boolean }>(
			await tool.execute("c", { op: "status" }),
		);
		expect(off.ok).toBe(true);
		expect(off.tool).toBe("mode");
		expect(off.op).toBe("status");
		expect(off.plan).toBe(false);
		expect(off.vibe).toBe(false);
		expect(off.goal).toBe("none");
		expect(off.planPaused).toBe(false);
		expect(off.message).toBe("plan: off | vibe: off | goal: none");

		fake.state.plan = { enabled: true };
		fake.state.goal = { enabled: true, goal: { status: "active" } };
		const on = parseEnvelope<{ plan: boolean; vibe: boolean; goal: string; message: string; planPaused: boolean }>(
			await tool.execute("c", { op: "status" }),
		);
		expect(on.plan).toBe(true);
		expect(on.vibe).toBe(false);
		expect(on.goal).toBe("active");
		expect(on.planPaused).toBe(false);
		expect(on.message).toBe("plan: on | vibe: off | goal: active");

		fake.state.plan = undefined;
		fake.state.goal = { enabled: false, goal: { status: "paused" } };
		fake.state.journal.push({ type: "mode_change", mode: "plan_paused" });
		const paused = parseEnvelope<{ plan: boolean; vibe: boolean; goal: string; message: string; planPaused: boolean }>(
			await tool.execute("c", { op: "status" }),
		);
		expect(paused.plan).toBe(false);
		expect(paused.planPaused).toBe(true);
		expect(paused.goal).toBe("paused");
		expect(paused.message).toBe("plan: paused | vibe: off | goal: paused");
	});

	test("N9: no bridge -> honest unavailability, nothing emulated", async () => {
		const pi = makeModePi();
		registerModeTool(pi.api as never, { resolveBridge: async () => null });
		const tool = pi.modeTool();
		for (const op of ["plan_enter", "plan_exit", "vibe_enter", "vibe_exit", "status"]) {
			const result = await tool.execute("c", { op });
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("live host session");
		}
	});

	test("N10: pre-aborted signal cancels", async () => {
		const pi = makeModePi();
		const { bridge } = makeNativeBridge();
		registerModeTool(pi.api as never, { resolveBridge: async () => bridge });
		const controller = new AbortController();
		controller.abort();
		const result = await pi.modeTool().execute("c", { op: "plan_enter" }, controller.signal);
		expect(result.isError).toBe(true);
		const parsed = parseEnvelope<{ ok: boolean; error: string }>(result);
		expect(parsed.ok).toBe(false);
		expect(parsed.error).toContain("Cancelled");
	});

	test("N11: registration shape — one 'mode' tool, read-tier, essential, marked", () => {
		const pi = makeModePi();
		registerModeTool(pi.api as never, { resolveBridge: async () => null });
		const defs = pi.tools.filter(t => t.definition.name === MODE_TOOL_NAME);
		expect(defs.length).toBe(1);
		expect(defs[0].definition.approval).toBe("read");
		expect(defs[0].definition.loadMode).toBe("essential");
		expect(defs[0].definition.label).toBe("Mode");
		expect(String(defs[0].definition.description)).toContain("[qol]");
		const params = pi.modeTool().parameters;
		for (const op of ["plan_enter", "plan_exit", "vibe_enter", "vibe_exit", "status"]) {
			expect(params.parse({ op })).toEqual({ op });
		}
		expect(() => params.parse({ op: "pause" })).toThrow();
	});
});

// =============================================================================
// Factory kill switch (isolated lockfile)
// =============================================================================

describe("factory kill switch (mode tool)", () => {
	// test/setup.ts (bun preload) froze the host's config root onto the
	// pid-scoped isolation root (.omp-qol-test-root-<pid>) before any host
	// module loaded (the pi-utils DirResolver pins it at first module load per
	// process). The env value is stable for the whole process after preload,
	// so reading it in beforeAll is safe. Shared with goal-tool.test.ts.
	let testRoot = "";

	function writeLock(settings: Record<string, unknown>): void {
		const lock = { plugins: {}, settings: { "omp-qol-plugin": settings } };
		fs.mkdirSync(path.join(testRoot, "plugins"), { recursive: true });
		fs.writeFileSync(path.join(testRoot, "plugins", "omp-plugins.lock.json"), JSON.stringify(lock));
	}

	beforeAll(() => {
		testRoot = path.join(os.homedir(), process.env.PI_CONFIG_DIR!);
	});

	afterAll(() => {
		fs.rmSync(path.join(testRoot, "plugins"), { recursive: true, force: true });
	});

	test("N12a: modeToolEnabled=false -> no mode tool, goal tool still registered", async () => {
		writeLock({ modeToolEnabled: false });
		const pi = makeModePi();
		await factory(pi.api as never);
		expect(pi.tools.filter(t => t.definition.name === MODE_TOOL_NAME).length).toBe(0);
		expect(pi.tools.filter(t => t.definition.name === "goal").length).toBe(1);
	});

	test("N12b: defaults -> both goal and mode tools registered", async () => {
		writeLock({});
		const pi = makeModePi();
		await factory(pi.api as never);
		expect(pi.tools.filter(t => t.definition.name === MODE_TOOL_NAME).length).toBe(1);
		expect(pi.tools.filter(t => t.definition.name === "goal").length).toBe(1);
	});
});
