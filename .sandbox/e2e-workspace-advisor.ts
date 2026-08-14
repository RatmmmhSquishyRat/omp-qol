/**
 * Delivery-form e2e: installed omp + real LLM, project-scoped plugin.
 * Drives the advisor tool through a live session:
 *
 *   status -> enable -> upsert -> list -> remove -> disable
 *
 * Workspace is a throwaway git repo under .sandbox/scratch so
 * repo.root() does not resolve to omp-qol and WATCHDOG.yml never
 * lands in the plugin repo or the developer's ~/.omp.
 *
 * Usage: bun .sandbox/e2e-workspace-advisor.ts
 * Optional: OMPQOL_RELAY_PROVIDERS=<provider1,provider2,...>
 * Exit: 0 pass, 1 fail, 2 harness error.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");
const scratch = path.join(import.meta.dir, "scratch", `e2e-advisor-ws-${Date.now()}`);
const stderrLog = path.join(import.meta.dir, "e2e-workspace-advisor.stderr.log");
const relayProviders = (process.env.OMPQOL_RELAY_PROVIDERS ?? "").split(/[\s,]+/).filter(Boolean);

const pluginSource = path.join(root, "plugin");
const sourcePkg = JSON.parse(await Bun.file(path.join(pluginSource, "package.json")).text()) as {
	name: string;
	version: string;
};
const packageName = sourcePkg.name;
const version = sourcePkg.version;
const MARKETPLACE_NAME = "local";
const PLUGIN_ID = "omp-qol-plugin@local";

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(scratch, { recursive: true });
const gitInit = spawnSync("git", ["init"], { cwd: scratch, encoding: "utf8" });
if (gitInit.status !== 0) {
	console.error("[e2e-advisor] git init failed:", gitInit.stderr);
	process.exit(2);
}

const pluginsRoot = path.join(scratch, ".omp", "plugins");
const cachePath = path.join(pluginsRoot, "cache", MARKETPLACE_NAME, packageName, version);
await fs.mkdir(cachePath, { recursive: true });
await fs.copyFile(path.join(pluginSource, "package.json"), path.join(cachePath, "package.json"));
await fs.cp(path.join(pluginSource, "src"), path.join(cachePath, "src"), { recursive: true });

const linkPath = path.join(pluginsRoot, "node_modules", packageName);
await fs.mkdir(path.dirname(linkPath), { recursive: true });
await fs.symlink(cachePath, linkPath, process.platform === "win32" ? "junction" : "dir");

await Bun.write(
	path.join(pluginsRoot, "omp-plugins.lock.json"),
	`${JSON.stringify({ plugins: { [packageName]: { version, enabledFeatures: null, enabled: true } }, settings: {} }, null, 2)}\n`,
);
await Bun.write(
	path.join(pluginsRoot, "package.json"),
	`${JSON.stringify({ dependencies: { [packageName]: version } }, null, 2)}\n`,
);
const now = new Date().toISOString();
await Bun.write(
	path.join(pluginsRoot, "installed_plugins.json"),
	`${JSON.stringify(
		{
			version: 2,
			plugins: {
				[PLUGIN_ID]: [
					{
						scope: "project",
						installPath: cachePath,
						version,
						installedAt: now,
						lastUpdated: now,
					},
				],
			},
		},
		null,
		2,
	)}\n`,
);

interface Step {
	op: string;
	extra?: string;
	expect: RegExp;
}

const steps: Step[] = [
	{ op: "status", expect: /"op": "status"/ },
	{ op: "enable", expect: /"op": "enable"[\s\S]*"enabled": true/ },
	{
		op: "upsert",
		extra: ' name="E2EReviewer" instructions="Watch for regressions in this e2e session."',
		expect: /"op": "upsert"[\s\S]*E2EReviewer/,
	},
	{ op: "list", extra: ' scope="effective"', expect: /"op": "list"[\s\S]*E2EReviewer/ },
	{ op: "remove", extra: ' name="E2EReviewer"', expect: /"op": "remove"[\s\S]*"persisted": true/ },
	{ op: "disable", expect: /"op": "disable"[\s\S]*"enabled": false/ },
];

const proc = Bun.spawn(["omp", "--mode", "rpc"], {
	cwd: scratch,
	stdin: "pipe",
	stdout: "pipe",
	stderr: Bun.file(stderrLog),
	env: { ...process.env },
});

const timeout = setTimeout(() => {
	console.error(`[e2e-advisor] TIMEOUT at step ${stepIndex + 1}/${steps.length} (${steps[stepIndex]?.op})`);
	proc.kill();
	process.exit(2);
}, 480_000);

const frameTypes: string[] = [];

function send(obj: Record<string, unknown>): void {
	proc.stdin.write(`${JSON.stringify(obj)}\n`);
}

function sendStepPrompt(step: Step): void {
	send({
		id: `p${stepIndex + 1}`,
		type: "prompt",
		message:
			`Call the tool named 'advisor' exactly once with parameter op=${step.op}${step.extra ?? ""}. ` +
			"Do not call any other tool. Then reply with only the exact text the tool returned, nothing else.",
	});
}

let ready = false;
let modelSet: { provider: string; modelId: string } | undefined;
let modelQueue: Array<{ provider: string; id: string }> = [];
let stepIndex = 0;
let phase: "models" | "awaitTool" | "awaitTurnEnd" = "models";
let verdict: boolean | undefined;
const captured: Array<{ op: string; matched: boolean; raw: string }> = [];

function tryNextModel(reason: string): boolean {
	const next = modelQueue.shift();
	if (!next) return false;
	console.log(`[e2e-advisor] switching model after ${reason}: ${next.provider}/${next.id}`);
	modelSet = { provider: next.provider, modelId: next.id };
	phase = "models";
	send({ id: `m-retry-${next.provider}`, type: "set_model", provider: next.provider, modelId: next.id });
	return true;
}

const decoder = new TextDecoder();
const reader = proc.stdout.getReader();
let buffer = "";

function fail(reason: string, raw?: string): never {
	console.error(`[e2e-advisor] FAIL: ${reason}`);
	if (raw) console.error(`[e2e-advisor] raw: ${raw.slice(0, 1200)}`);
	console.log(`[e2e-advisor] frame types seen: ${[...new Set(frameTypes)].join(", ") || "<none>"}`);
	console.log("[e2e-advisor] FAIL");
	clearTimeout(timeout);
	proc.kill();
	process.exit(1);
}

function rankModels(models: Array<{ provider: string; id: string }>): Array<{ provider: string; id: string }> {
	const preferredProviders = ["zai", "deepseek", "kimi-code", "aiberm", "openai-codex"];
	const pool =
		relayProviders.length > 0
			? models.filter(m => relayProviders.includes(m.provider))
			: models.filter(m => preferredProviders.includes(m.provider));
	const fallback = pool.length > 0 ? pool : models.filter(m => m.provider !== "cursor");
	const providers =
		relayProviders.length > 0 ? relayProviders : preferredProviders.filter(p => fallback.some(m => m.provider === p));
	const ranked: Array<{ provider: string; id: string }> = [];
	for (const provider of providers) {
		const group = fallback.filter(m => m.provider === provider);
		const pick =
			group.find(m => /haiku|flash/.test(m.id)) ??
			group.find(m => /mini|turbo/.test(m.id)) ??
			group.find(m => /nano/.test(m.id)) ??
			group[0];
		if (pick) ranked.push(pick);
	}
	return ranked;
}

function isTransientModelError(raw: string): boolean {
	return /not_found|Connect error|usage_limit|rate.?limit|403|401|overloaded|unavailable/i.test(raw);
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
			send({ id: "m1", type: "get_available_models" });
			continue;
		}

		if (phase === "models") {
			if (frame.type === "response" && frame.command === "get_available_models" && frame.success) {
				const models = ((frame.data as { models?: Array<{ provider: string; id: string }> })?.models ?? []).filter(
					Boolean,
				);
				modelQueue = rankModels(models);
				const pick = modelQueue.shift();
				if (!pick) {
					console.error("[e2e-advisor] no models available from host");
					process.exit(2);
				}
				modelSet = { provider: pick.provider, modelId: pick.id };
				send({ id: "m2", type: "set_model", provider: pick.provider, modelId: pick.id });
				continue;
			}
			if (frame.type === "response" && frame.command === "set_model") {
				if (!frame.success) fail(`set_model failed: ${JSON.stringify(frame.error)}`);
				console.log(`[e2e-advisor] model: ${modelSet?.provider}/${modelSet?.modelId}`);
				phase = "awaitTool";
				sendStepPrompt(steps[0]);
				continue;
			}
			continue;
		}

		const ftype = typeof frame.type === "string" ? frame.type : "<no-type>";
		frameTypes.push(ftype);
		if (ftype === "response" && frame.success === false) {
			console.log(`[e2e-advisor] response(failed): command=${frame.command} error=${JSON.stringify(frame.error)}`);
		}
		if (ftype === "message_end") {
			const m = JSON.stringify(frame);
			if (m.includes('stopReason":"error"') || m.includes("errorMessage")) {
				console.log(`[e2e-advisor] message_end(error): ${m.slice(0, 600)}`);
				if (phase === "awaitTool" && isTransientModelError(m) && tryNextModel("message_end error")) continue;
			}
		}

		const raw = JSON.stringify(frame);

		if (phase === "awaitTool") {
			if (frame.type === "tool_execution_end" && frame.toolName === "advisor") {
				const step = steps[stepIndex];
				const text =
					((frame.result as { content?: Array<{ text?: string }> } | undefined)?.content ?? [])
						.map(c => c.text ?? "")
						.join("\n") || raw;
				const matched = step.expect.test(text);
				const markedError = frame.isError === true;
				const refusal = text.includes("host form does not expose") || text.includes("live host session");
				captured.push({ op: step.op, matched, raw: text });
				console.log(
					`[e2e-advisor] step ${stepIndex + 1}/${steps.length} ${step.op}: matched=${matched} isError=${markedError}`,
				);
				if (markedError || refusal) fail(`step ${step.op} returned an error/refusal`, text);
				if (!matched) fail(`step ${step.op} result did not match expectation`, text);
				phase = "awaitTurnEnd";
				continue;
			}
			if (frame.type === "agent_end") {
				if (isTransientModelError(raw) && tryNextModel(`no tool call on ${steps[stepIndex].op}`)) continue;
				fail(`turn ended without the advisor tool call for step ${steps[stepIndex].op}`);
			}
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
console.log(`[e2e-advisor] frame types seen: ${[...new Set(frameTypes)].join(", ") || "<none>"}`);
if (verdict === undefined) {
	console.log("[e2e-advisor] stream closed before completion");
	for (const c of captured) console.log(`[e2e-advisor] captured ${c.op}: matched=${c.matched}`);
	console.log("[e2e-advisor] FAIL");
	process.exit(1);
}
for (const c of captured) console.log(`[e2e-advisor] op ${c.op}: ${c.raw.slice(0, 280)}`);
console.log("[e2e-advisor] PASS");
process.exit(0);
