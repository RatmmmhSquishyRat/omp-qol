/**
 * Live wiring verification for the delivery form (QOL-001 + QOL-002/003).
 *
 * Spawns omp with cwd=test-workspace and NO PI_CONFIG_DIR override — the
 * user root stays the global one (untouched), and the plugin must load from
 * the project root `test-workspace/.omp/plugins`. Waits for the RPC ready
 * frame, issues `get_state`, and checks `dumpTools` for the [qol] tools
 * (`goal`, `mode`) plus the model-visible mode-op schema.
 *
 * Usage:
 *   bun .sandbox/verify-workspace.ts                     # installed host
 *   bun .sandbox/verify-workspace.ts --source            # source-link host
 *   bun .sandbox/verify-workspace.ts --control           # --no-extensions (absent)
 *   bun .sandbox/verify-workspace.ts --source --control
 */

import * as path from "node:path";

const CONTROL = process.argv.includes("--control");
const SOURCE = process.argv.includes("--source");
const root = path.resolve(import.meta.dir, "..");
const workspace = path.join(root, "test-workspace");

const args = ["--mode", "rpc", "--model", "openai/gpt-4o-mini"];
if (CONTROL) args.push("--no-extensions");

const defaultSourceCli = path.resolve(root, "..", "..", "ref_repos", "oh-my-pi", "packages", "coding-agent", "src", "cli.ts");
const sourceCli = SOURCE ? defaultSourceCli : process.env.OMP_SOURCE_CLI;
const cmd = sourceCli ? ["bun", sourceCli, ...args] : ["omp", ...args];
console.log(`[verify-workspace] host: ${sourceCli ? `source-link (${sourceCli})` : "installed omp"} (cwd=${workspace})`);

const proc = Bun.spawn(cmd, {
	cwd: workspace,
	stdin: "pipe",
	stdout: "pipe",
	stderr: "pipe",
	env: { ...process.env }, // no PI_CONFIG_DIR: global user root, project-scoped plugin
});

const timeout = setTimeout(() => {
	console.error(`[verify-workspace] TIMEOUT waiting for RPC frames (control=${CONTROL})`);
	proc.kill();
	process.exit(2);
}, 90_000);

function send(obj: Record<string, unknown>): void {
	proc.stdin.write(`${JSON.stringify(obj)}\n`);
}

let ready = false;
let sent = false;
let sentSecond = false;
let verdict: boolean | undefined;

const decoder = new TextDecoder();
const reader = proc.stdout.getReader();
let buffer = "";

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
			continue;
		}
		if (ready && !sent) {
			sent = true;
			send({ id: "st1", type: "get_state" });
			setTimeout(() => {
				if (!sentSecond) {
					sentSecond = true;
					send({ id: "st2", type: "get_state" });
				}
			}, 4000);
			continue;
		}
		if (frame.type === "response" && (frame.id === "st1" || frame.id === "st2")) {
			if (frame.id === "st1" && !sentSecond) continue;
			const data = (frame.data ?? {}) as { dumpTools?: Array<{ name: string; description?: string; parameters?: unknown }> };
			const tools = data.dumpTools ?? [];
			console.log(`[verify-workspace] dumpTools names: ${tools.map(t => t.name).join(", ")}`);
			const goal = tools.find(t => t.name === "goal");
			const mode = tools.find(t => t.name === "mode");
			const advisor = tools.find(t => t.name === "advisor");
			if (CONTROL) {
				verdict = goal === undefined && mode === undefined && advisor === undefined;
				console.log(
					`[verify-workspace] control: goal ${goal ? "PRESENT (unexpected)" : "absent (expected)"}, mode ${mode ? "PRESENT (unexpected)" : "absent (expected)"}, advisor ${advisor ? "PRESENT (unexpected)" : "absent (expected)"}`,
				);
			} else {
				const goalOurs = goal !== undefined && (goal.description ?? "").includes("[qol]");
				const modeOurs = mode !== undefined && (mode.description ?? "").includes("[qol]");
				const advisorOurs = advisor !== undefined && (advisor.description ?? "").includes("[qol]");
				// Model-side schema check: the advertised ops must be visible to the
				// model. Installed hosts serialize zod into JSON-schema parameters;
				// the source host may dump parameters differently, so accept ops
				// present in either surface.
				const modeHaystack = `${JSON.stringify(mode?.parameters ?? {})} ${mode?.description ?? ""}`;
				const expectedModeOps = ["plan_enter", "plan_exit", "vibe_enter", "vibe_exit", "status"];
				const modeSchemaOk = expectedModeOps.every(op => modeHaystack.includes(op));
				// Advisor: 10 ops must appear in schema or description
				const advisorHaystack = `${JSON.stringify(advisor?.parameters ?? {})} ${advisor?.description ?? ""}`;
				const expectedAdvisorOps = ["list", "get", "upsert", "remove", "set_shared", "apply", "enable", "disable", "status", "dump"];
				const advisorSchemaOk = expectedAdvisorOps.every(op => advisorHaystack.includes(op));
				verdict = goalOurs && modeOurs && modeSchemaOk && advisorOurs && advisorSchemaOk;
				console.log(
					`[verify-workspace] project-scoped load: goal ${goalOurs ? "present [qol]" : "MISSING/UNMARKED"}, mode ${modeOurs ? "present [qol]" : "MISSING/UNMARKED"}, schema ${modeSchemaOk ? "carries all 5 ops" : "MISSING OPS"}, advisor ${advisorOurs ? "present [qol]" : "MISSING/UNMARKED"}, advisor-schema ${advisorSchemaOk ? "carries all 10 ops" : "MISSING OPS"}`,
				);
			}
			break;
		}
	}
	if (verdict !== undefined) break;
}

clearTimeout(timeout);
proc.kill();
console.log(`[verify-workspace] ${CONTROL ? "control" : "qol"} run: ${verdict ? "PASS" : "FAIL"}`);
process.exit(verdict ? 0 : 1);
