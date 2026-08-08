import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import {
	GOAL_TOOL_NAME,
	NATIVE_UNAVAILABLE_MESSAGE,
	registerGoalTool,
} from "../src/goal-tool";
import factory from "../src/main";

// =============================================================================
// Faithful mock of the native goal tool's tool-visible semantics
// (GoalTool.execute + GoalRuntime rules; see docs/researches/omp-goal-system.md)
// =============================================================================

interface GoalRec {
	id: string;
	objective: string;
	status: "active" | "paused" | "budget-limited" | "complete" | "dropped";
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
}

class NativeGoalMock {
	goal: GoalRec | null = null;
	calls: Array<Record<string, unknown>> = [];
	#seq = 0;

	async invoke(params: Record<string, unknown>) {
		this.calls.push(JSON.parse(JSON.stringify(params)));
		switch (params.op) {
			case "create": {
				const objective = typeof params.objective === "string" ? params.objective.trim() : "";
				if (!objective) throw new Error("objective is required when op=create");
				const tb = params.token_budget;
				if (tb !== undefined && (!Number.isInteger(tb) || (tb as number) <= 0)) {
					throw new Error("token_budget must be a positive integer when provided");
				}
				if (this.goal && this.goal.status !== "dropped" && this.goal.status !== "complete") {
					throw new Error("cannot create a new goal because this session already has a goal");
				}
				const now = Date.now();
				this.goal = {
					id: String(++this.#seq),
					objective,
					status: "active",
					tokenBudget: tb as number | undefined,
					tokensUsed: 0,
					timeUsedSeconds: 0,
					createdAt: now,
					updatedAt: now,
				};
				return this.#result("create");
			}
			case "get":
				return this.#result("get");
			case "resume": {
				if (!this.goal) throw new Error("No paused goal.");
				if (this.goal.status === "complete") throw new Error("Goal is already complete.");
				this.goal.status = "active";
				return this.#result("resume");
			}
			case "complete": {
				if (!this.goal) throw new Error("cannot complete goal because no goal is active");
				if (this.goal.status === "complete") throw new Error("goal is already complete");
				if (this.goal.status === "dropped") throw new Error("cannot complete a dropped goal");
				this.goal.status = "complete";
				return this.#result("complete");
			}
			case "drop": {
				const dropped = this.goal ? { ...this.goal, status: "dropped" as const } : null;
				this.goal = null;
				return this.#result("drop", dropped);
			}
			default:
				throw new Error(`unknown op: ${String(params.op)}`);
		}
	}

	#result(op: string, goalOverride?: GoalRec | null) {
		const goal = goalOverride !== undefined ? goalOverride : this.goal;
		return {
			content: [
				{
					type: "text" as const,
					text: goal ? `Goal: ${goal.objective}\nStatus: ${goal.status}` : "No active goal.",
				},
			],
			details: { op, goal, remainingTokens: null, completionBudgetReport: null },
		};
	}
}

// =============================================================================
// Extension API mocks
// =============================================================================

interface CapturedTool {
	definition: Record<string, unknown>;
}

function makePiMock() {
	const tools: CapturedTool[] = [];
	const commands: string[] = [];
	return {
		tools,
		commands,
		api: {
			zod: z,
			setLabel: (_label: string) => {},
			logger: { info: (..._a: unknown[]) => {}, warn: (..._a: unknown[]) => {}, error: (..._a: unknown[]) => {} },
			registerTool: (definition: Record<string, unknown>) => {
				tools.push({ definition });
			},
			registerCommand: (name: string, _def: unknown) => {
				commands.push(name);
			},
			on: (_event: string, _handler: unknown) => {},
		},
	};
}

function getGoalTool(pi: ReturnType<typeof makePiMock>) {
	const entry = pi.tools.find(t => t.definition.name === GOAL_TOOL_NAME);
	if (!entry) throw new Error("goal tool not registered");
	return entry.definition as {
		name: string;
		approval?: string;
		parameters: z.ZodType;
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: unknown,
			ctx?: { invokeTool?: (p: Record<string, unknown>, o?: unknown) => Promise<unknown> },
		) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean }>;
	};
}

// =============================================================================
// A. Delegation contract
// =============================================================================

describe("delegation contract", () => {
	test("A1: create forwards params verbatim and passes the native result through", async () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		const native = new NativeGoalMock();
		const params = { op: "create", objective: "Ship QOL-001", token_budget: 50000 };
		const result = await tool.execute("call-1", params, undefined, undefined, {
			invokeTool: p => native.invoke(p),
		});
		expect(native.calls).toEqual([params]);
		expect(result.details).toEqual({
			op: "create",
			goal: expect.objectContaining({ objective: "Ship QOL-001", tokenBudget: 50000, status: "active" }),
			remainingTokens: null,
			completionBudgetReport: null,
		});
		expect(result.isError).toBeUndefined();
	});

	test("A2: get/complete/resume/drop each forward their exact params", async () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		const native = new NativeGoalMock();
		await native.invoke({ op: "create", objective: "seed" });
		native.calls.length = 0;
		const ctx = { invokeTool: (p: Record<string, unknown>) => native.invoke(p) };
		for (const op of ["get", "complete"] as const) {
			await tool.execute(`call-${op}`, { op }, undefined, undefined, ctx);
		}
		expect(native.calls).toEqual([{ op: "get" }, { op: "complete" }]);
	});

	test("A3: native goal record in details is preserved exactly", async () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		const native = new NativeGoalMock();
		const created = await native.invoke({ op: "create", objective: "verify", token_budget: 100 });
		native.calls.length = 0;
		const result = await tool.execute("call-get", { op: "get" }, undefined, undefined, {
			invokeTool: p => native.invoke(p),
		});
		const details = result.details as { goal: GoalRec };
		expect(details.goal).toEqual((created.details as { goal: GoalRec }).goal);
	});
});

// =============================================================================
// B. Error surfacing
// =============================================================================

describe("error surfacing", () => {
	test("B1: missing invokeTool -> actionable error, no throw", async () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		const result = await tool.execute("call-x", { op: "get" }, undefined, undefined, {});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBe(NATIVE_UNAVAILABLE_MESSAGE);
		expect(result.content[0].text).toContain("goal.enabled");
	});

	test("B2: native state error surfaces with native message", async () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		const native = new NativeGoalMock();
		await native.invoke({ op: "create", objective: "first" });
		const result = await tool.execute(
			"call-2",
			{ op: "create", objective: "second" },
			undefined,
			undefined,
			{ invokeTool: p => native.invoke(p) },
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("already has a goal");
	});

	test("B3: create without objective surfaces native validation error", async () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		const native = new NativeGoalMock();
		const result = await tool.execute("call-3", { op: "create" }, undefined, undefined, {
			invokeTool: p => native.invoke(p),
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("objective is required");
		expect(result.content[0].text).toContain("goal create failed");
	});

	test("B4: pre-aborted signal cancels without delegating", async () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		const native = new NativeGoalMock();
		const controller = new AbortController();
		controller.abort();
		const result = await tool.execute("call-4", { op: "get" }, controller.signal, undefined, {
			invokeTool: p => native.invoke(p),
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBe("Cancelled");
		expect(native.calls.length).toBe(0);
	});
});

// =============================================================================
// C. Schema
// =============================================================================

describe("schema", () => {
	test("C1: unknown op rejected by the parameter schema", () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		expect(() => tool.parameters.parse({ op: "pause" })).toThrow();
		expect(tool.parameters.parse({ op: "get" })).toEqual({ op: "get" });
	});

	test("C2: token_budget must be a positive integer", () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const tool = getGoalTool(pi);
		expect(() => tool.parameters.parse({ op: "create", objective: "x", token_budget: -5 })).toThrow();
		expect(() => tool.parameters.parse({ op: "create", objective: "x", token_budget: 1.5 })).toThrow();
		expect(tool.parameters.parse({ op: "create", objective: "x", token_budget: 10 })).toEqual({
			op: "create",
			objective: "x",
			token_budget: 10,
		});
	});
});

// =============================================================================
// D. Registration shape + kill switch (via real factory + isolated lockfile)
// =============================================================================

describe("registration", () => {
	test("D1: registers exactly one 'goal' tool with read-tier approval and essential loadMode", () => {
		const pi = makePiMock();
		registerGoalTool(pi.api as never);
		const goalTools = pi.tools.filter(t => t.definition.name === GOAL_TOOL_NAME);
		expect(goalTools.length).toBe(1);
		expect(goalTools[0].definition.approval).toBe("read");
		expect(goalTools[0].definition.loadMode).toBe("essential");
		expect(goalTools[0].definition.label).toBe("Goal");
	});
});

describe("factory kill switch (isolated lockfile)", () => {
	const testRoot = path.join(os.homedir(), `.omp-qol-test-${process.pid}`);
	const prevConfigDir = process.env.PI_CONFIG_DIR;

	function writeLock(settings: Record<string, unknown>): void {
		const lock = { plugins: {}, settings: { "omp-qol-plugin": settings } };
		fs.mkdirSync(path.join(testRoot, "plugins"), { recursive: true });
		fs.writeFileSync(path.join(testRoot, "plugins", "omp-plugins.lock.json"), JSON.stringify(lock));
	}

	beforeAll(() => {
		process.env.PI_CONFIG_DIR = path.basename(testRoot);
	});

	afterAll(() => {
		if (prevConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
		else process.env.PI_CONFIG_DIR = prevConfigDir;
		fs.rmSync(testRoot, { recursive: true, force: true });
	});

	test("D2: goalToolEnabled=false -> factory registers no goal tool", async () => {
		writeLock({ goalToolEnabled: false });
		const pi = makePiMock();
		await factory(pi.api as never);
		expect(pi.tools.filter(t => t.definition.name === GOAL_TOOL_NAME).length).toBe(0);
		expect(pi.commands).toContain("qol-config");
	});

	test("D3: default settings -> factory registers the goal tool", async () => {
		writeLock({});
		const pi = makePiMock();
		await factory(pi.api as never);
		expect(pi.tools.filter(t => t.definition.name === GOAL_TOOL_NAME).length).toBe(1);
	});
});
