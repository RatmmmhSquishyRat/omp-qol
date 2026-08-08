/**
 * Delivery-form e2e: installed omp, launched from test-workspace (project
 * plugin enablement), relay model. Drives EVERY mode op through a real LLM
 * turn and asserts each streamed tool_execution_end frame:
 *
 *   status -> plan_enter -> plan_exit -> vibe_enter -> vibe_exit -> status
 *
 * The final status must show plan/vibe off again, proving the round trip
 * left the host session clean. vibe_enter/vibe_exit specifically exercise
 * the sealed-host LIVE tool-class path (research §7): on the installed
 * binary no trusted vibe registry exists, so enter must install the host's
 * own vibe toolset and exit must enumerate+kill via the injected
 * VibeListTool/VibeKillTool classes — NOT return VIBE_UNTRUSTED_REGISTRY.
 *
 * Usage: bun .sandbox/e2e-workspace-mode.ts
 * Exit: 0 pass, 1 fail, 2 harness error.
 */

import * as path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const workspace = path.join(root, "test-workspace");
const stderrLog = path.join(import.meta.dir, "e2e-workspace-mode.stderr.log");

// The relay-provider pool is personal configuration, not project content:
// supply it at run time via OMPQOL_RELAY_PROVIDERS (comma/space separated,
// listed in preference order). The repo intentionally stores no provider names.
const relayProviders = (process.env.OMPQOL_RELAY_PROVIDERS ?? "").split(/[\s,]+/).filter(Boolean);
if (relayProviders.length === 0) {
	console.error("[e2e-mode] set OMPQOL_RELAY_PROVIDERS=<provider1,provider2,...> to run the real-LLM e2e");
	process.exit(2);
}

interface Step {
	op: string;
	objective?: string;
	expect: RegExp;
}

const steps: Step[] = [
	{ op: "status", expect: /plan: off \| vibe: off \| goal: none/ },
	{ op: "plan_enter", objective: "e2e full-ops verification", expect: /Plan mode is now ACTIVE/ },
	{ op: "plan_exit", expect: /Plan mode exited/ },
	{ op: "vibe_enter", objective: "e2e full-ops verification", expect: /Vibe \(director\) mode is now ACTIVE/ },
	{ op: "vibe_exit", expect: /Vibe mode exited/ },
	{ op: "status", expect: /plan: off \| vibe: off \| goal: none/ },
];

const proc = Bun.spawn(["omp", "--mode", "rpc"], {
	cwd: workspace,
	stdin: "pipe",
	stdout: "pipe",
	stderr: Bun.file(stderrLog),
	env: { ...process.env }, // user's real credentials/config; no overrides
});

const timeout = setTimeout(() => {
	console.error(`[e2e-mode] TIMEOUT at step ${stepIndex + 1}/${steps.length} (${steps[stepIndex]?.op})`);
	proc.kill();
	process.exit(2);
}, 480_000);

const frameTypes: string[] = [];

function send(obj: Record<string, unknown>): void {
	proc.stdin.write(`${JSON.stringify(obj)}\n`);
}

function sendStepPrompt(step: Step): void {
	const objectivePart = step.objective ? ` and objective="${step.objective}"` : "";
	send({
		id: `p${stepIndex + 1}`,
		type: "prompt",
		message:
			`Call the tool named 'mode' exactly once with parameter op=${step.op}${objectivePart}. ` +
			"Do not call any other tool. Then reply with only the exact text the tool returned, nothing else.",
	});
}

let ready = false;
let modelsRequested = false;
let modelSet: { provider: string; modelId: string } | undefined;
let stepIndex = 0;
/** "awaitTool" = turn running, expect the step's mode tool_execution_end;
 *  "awaitTurnEnd" = tool result captured, wait for the turn to finish. */
let phase: "models" | "awaitTool" | "awaitTurnEnd" = "models";
let verdict: boolean | undefined;
const captured: Array<{ op: string; matched: boolean; raw: string }> = [];

const decoder = new TextDecoder();
const reader = proc.stdout.getReader();
let buffer = "";

function fail(reason: string, raw?: string): never {
	console.error(`[e2e-mode] FAIL: ${reason}`);
	if (raw) console.error(`[e2e-mode] raw: ${raw.slice(0, 900)}`);
	console.log(`[e2e-mode] frame types seen: ${[...new Set(frameTypes)].join(", ") || "<none>"}`);
	console.log("[e2e-mode] FAIL");
	clearTimeout(timeout);
	proc.kill();
	process.exit(1);
}

while (true) {
	const { value, done } = await reader.read();
	if (done) break;
	buffer += decoder.decode(value, { stream: true });
	let newline: number;
	while ((newline = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		let frame: Record<string, unknown>;
		try {
			frame = JSON.parse(line);
		} catch {
			continue;
		}

		if (frame.type === "ready" && !ready) {
			ready = true;
			// The user's default model may be quota-blocked; discover the pool
			// and switch to a relay provider before prompting.
			modelsRequested = true;
			send({ id: "m1", type: "get_available_models" });
			continue;
		}

		if (phase === "models") {
			if (frame.type === "response" && frame.command === "get_available_models" && frame.success) {
				const models = ((frame.data as { models?: Array<{ provider: string; id: string }> })?.models ?? []).filter(m =>
					relayProviders.includes(m.provider),
				);
				if (models.length === 0) {
					console.error("[e2e-mode] no relay-provider models available");
					process.exit(2);
				}
				let pick: { provider: string; id: string } | undefined;
				for (const provider of relayProviders) {
					const pool = models.filter(m => m.provider === provider);
					if (pool.length === 0) continue;
					pick =
						pool.find(m => /nano/.test(m.id)) ??
						pool.find(m => /haiku|flash/.test(m.id)) ??
						pool.find(m => /mini/.test(m.id)) ??
						pool[0];
					break;
				}
				if (!pick) pick = models[0];
				modelSet = { provider: pick.provider, modelId: pick.id };
				send({ id: "m2", type: "set_model", provider: pick.provider, modelId: pick.id });
				continue;
			}
			if (frame.type === "response" && frame.command === "set_model") {
				if (!frame.success) fail(`set_model failed: ${JSON.stringify(frame.error)}`);
				console.log(`[e2e-mode] model: ${modelSet?.provider}/${modelSet?.modelId}`);
				phase = "awaitTool";
				sendStepPrompt(steps[0]);
				continue;
			}
			continue;
		}

		// Diagnostics: record every frame type; surface prompt errors.
		const ftype = typeof frame.type === "string" ? frame.type : "<no-type>";
		frameTypes.push(ftype);
		if (ftype === "response" && frame.success === false) {
			console.log(`[e2e-mode] response(failed): command=${frame.command} error=${JSON.stringify(frame.error)}`);
		}
		if (ftype === "auto_retry_end") {
			console.log(`[e2e-mode] auto_retry_end: ${JSON.stringify(frame).slice(0, 600)}`);
		}
		if (ftype === "message_end") {
			const m = JSON.stringify(frame);
			if (m.includes("stopReason\":\"error\"") || m.includes("errorMessage")) {
				console.log(`[e2e-mode] message_end(error): ${m.slice(0, 600)}`);
			}
		}

		const raw = JSON.stringify(frame);

		if (phase === "awaitTool") {
			if (raw.includes("tool_execution_end") && raw.includes('"mode"')) {
				const step = steps[stepIndex];
				const matched = step.expect.test(raw);
				const markedError = raw.includes('"isError":true');
				const oldRefusal = raw.includes("host form does not expose") || raw.includes("live host session");
				captured.push({ op: step.op, matched, raw });
				console.log(`[e2e-mode] step ${stepIndex + 1}/${steps.length} ${step.op}: matched=${matched} isError=${markedError}`);
				if (markedError || oldRefusal) fail(`step ${step.op} returned an error/refusal`, raw);
				if (!matched) fail(`step ${step.op} result did not match expectation`, raw);
				phase = "awaitTurnEnd";
				continue;
			}
			if (frame.type === "agent_end") fail(`turn ended without the mode tool call for step ${steps[stepIndex].op}`);
			continue;
		}

		if (phase === "awaitTurnEnd") {
			if (frame.type === "agent_end") {
				stepIndex += 1;
				if (stepIndex >= steps.length) {
					verdict = true;
					break;
				}
				phase = "awaitTool";
				sendStepPrompt(steps[stepIndex]);
			}
			continue;
		}
	}
	if (verdict !== undefined) break;
}

clearTimeout(timeout);
proc.kill();
console.log(`[e2e-mode] frame types seen: ${[...new Set(frameTypes)].join(", ") || "<none>"}`);
if (verdict === undefined) {
	console.log("[e2e-mode] stream closed before completion");
	for (const c of captured) console.log(`[e2e-mode] captured ${c.op}: matched=${c.matched}`);
	console.log("[e2e-mode] FAIL");
	process.exit(1);
}
for (const c of captured) console.log(`[e2e-mode] op ${c.op}: ${c.raw.slice(0, 220)}`);
console.log("[e2e-mode] PASS");
process.exit(0);
