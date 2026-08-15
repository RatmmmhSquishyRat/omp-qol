/**
 * Delivery-form e2e for the advisor tool: installed omp + real LLMs.
 *
 * One run delivers TWO acceptance sections, each in its own spawned omp
 * process and its own throwaway git workspace:
 *
 *   [CRUD]  scripted lifecycle through the tool (status/enable/upsert/list/
 *           remove/implicit-default/disable), asserted on the unified
 *           {ok, tool, op, ...} JSON envelope.
 *   [LIVE]  multi-advisor real-traffic acceptance (plan QOL-004 phase D /
 *           todo L6): advisors Alpha+Beta pinned to two different cheap
 *           models + paused control Gamma; baseline all-zero counters via an
 *           enable+status combo turn; ONE real primary turn ("Reply PING");
 *           per-advisor delta assertions (messages.assistant>=1 AND
 *           tokens.total>0, independently); dump carries both advisors;
 *           on-disk __advisor.<slug>.jsonl transcripts for Alpha+Beta and
 *           none for Gamma.
 *
 * Plugin install: `omp plugin install omp-qol-plugin` into the isolated
 * PI_CONFIG_DIR (user-scope npm). Scratch workspaces are git-init only —
 * no copy/junction/fake marketplace under the workspace. Official install
 * is never pointed at live ~/.omp or test-workspace/.omp.
 *
 * Config-root isolation: the spawned omp runs with PI_CONFIG_DIR pointing at
 * a scratch root under the user's home (the host resolves the value relative
 * to homedir). ONLY credential / model-registry material is copied from the
 * real ~/.omp (agent.db + models.db [+wal/shm], models.yml, .env,
 * kimi-device-id). WATCHDOG files, sessions, and the user's config.yml are
 * NEVER copied. A minimal scratch agent/config.yml is written instead:
 * setupVersion (skip wizard), advisor.syncBacklog="1" (primary turn awaits
 * advisor catch-up), and modelRoles.advisor pinned to an unresolvable
 * selector — without that pin an unset advisor role falls back to the host's
 * "slow" priority chain (a strong, expensive model) for the implicit default
 * advisor. If the isolated root cannot resolve enough models (credential
 * copy failed), the harness falls back to the REAL config root plus a
 * project-scope .omp/config.yml overlay carrying the same neutralization,
 * and records the fallback in the evidence.
 *
 * Artifacts (survive the run) land in .sandbox/e2e-artifacts/run-<ts>/:
 * every raw RPC frame (both directions), every advisor envelope, baseline +
 * post-turn status JSONs, the dump, advisor transcripts, the final scratch
 * WATCHDOG.yml, session stats, and EVIDENCE.md.
 *
 * SAFETY: never touches the repo-root WATCHDOG.yml (every mutate's
 * envelope.source is asserted to live inside the scratch workspace); never
 * kills processes it did not spawn; scratch dirs are timestamped and cleanup
 * is EBUSY-tolerant (leave-behind on failure is acceptable).
 *
 * Usage:   bun .sandbox/e2e-workspace-advisor.ts
 * Env:     OMPQOL_RELAY_PROVIDERS=<p1,p2>  restrict provider pool
 *          OMPQOL_E2E_SKIP_CRUD=1 | OMPQOL_E2E_SKIP_LIVE=1  (debug only)
 * Exit:    0 pass · 1 fail · 2 harness error · 3 inconclusive
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	gitInitScratch,
	liveUserPluginPresent,
	resolveIsolation,
	runOfficialInstall,
} from "./lib/official-install.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Section 0 — run identity, paths, artifact store
// ═══════════════════════════════════════════════════════════════════════════

const runStamp = new Date();
const runId =
	`${runStamp.getFullYear()}${String(runStamp.getMonth() + 1).padStart(2, "0")}${String(runStamp.getDate()).padStart(2, "0")}` +
	`-${String(runStamp.getHours()).padStart(2, "0")}${String(runStamp.getMinutes()).padStart(2, "0")}${String(runStamp.getSeconds()).padStart(2, "0")}`;

const scratchParent = path.join(import.meta.dir, "scratch");
const wsCrud = path.join(scratchParent, `e2e-advisor-ws-${runId}-crud`);
const wsLive = path.join(scratchParent, `e2e-advisor-ws-${runId}-live`);
const artifactDir = path.join(import.meta.dir, "e2e-artifacts", `run-${runId}`);

const ISOLATED_ROOT_PREFIX = ".omp-qol-e2e-";
const isolatedRootName = `${ISOLATED_ROOT_PREFIX}${runId}`;
const isolatedRoot = path.join(os.homedir(), isolatedRootName);
const realConfigRoot = path.join(os.homedir(), ".omp");

/** Selector that must not resolve: neutralizes the advisor-role fallback. */
const BLOCKED_ADVISOR_ROLE = "omp-qol-e2e-blocked/no-such-model";

const relayProviders = (process.env.OMPQOL_RELAY_PROVIDERS ?? "").split(/[\s,]+/).filter(Boolean);
const PHASE_DEADLINE_MS = 720_000;

const log = (msg: string) => console.log(`[e2e-advisor] ${msg}`);
const logErr = (msg: string) => console.error(`[e2e-advisor] ${msg}`);

async function saveArtifact(name: string, content: string | Uint8Array): Promise<void> {
	await fs.mkdir(artifactDir, { recursive: true });
	await Bun.write(path.join(artifactDir, name), content);
}

async function saveJsonArtifact(name: string, value: unknown): Promise<void> {
	await saveArtifact(name, `${JSON.stringify(value, null, 2)}\n`);
}

async function copyArtifact(src: string, name: string): Promise<boolean> {
	try {
		await fs.mkdir(artifactDir, { recursive: true });
		await fs.copyFile(src, path.join(artifactDir, name));
		return true;
	} catch {
		return false;
	}
}

const rmrf = (p: string) => fs.rm(p, { recursive: true, force: true }).catch(() => {});

// Evidence accumulator — everything EVIDENCE.md needs, filled as the run goes.
interface AdvisorDelta {
	name: string;
	model?: string;
	baseline: { user: number; assistant: number; tokensTotal: number; cost: number };
	post?: { user: number; assistant: number; tokensTotal: number; cost: number };
}
const evidence = {
	startedAt: runStamp.toISOString(),
	configRootMode: "isolated" as "isolated" | "fallback-real-root",
	isolationCopied: [] as Array<{ file: string; bytes: number }>,
	primaryModel: "",
	advisorModels: { alpha: "", beta: "", gamma: "" },
	baselineRepaired: false,
	repins: [] as string[],
	crudSteps: [] as Array<{ step: number; op: string; ok: boolean }>,
	liveChecks: [] as Array<{ label: string; ok: boolean; detail?: string }>,
	deltas: { alpha: undefined as AdvisorDelta | undefined, beta: undefined as AdvisorDelta | undefined },
	gammaSilent: false,
	transcripts: { alpha: false, beta: false, gammaAbsent: false },
	pingReply: "",
	sessionFile: "",
	timings: {} as Record<string, number>,
	verdict: "unknown" as "pass" | "fail" | "inconclusive" | "unknown",
	verdictReason: "",
	productIssues: [] as string[],
	notes: [] as string[],
};

class Inconclusive extends Error {}
class StepFailure extends Error {}

// ═══════════════════════════════════════════════════════════════════════════
// Section 1 — isolated config root (credential copy + neutralized bootstrap)
// ═══════════════════════════════════════════════════════════════════════════

/** Credential / model-registry files copied verbatim from ~/.omp/agent. */
const CREDENTIAL_FILES = [
	"agent.db",
	"agent.db-wal",
	"agent.db-shm",
	"models.db",
	"models.db-wal",
	"models.db-shm",
	"models.yml",
	"models.yaml",
	".env",
	"kimi-device-id",
];

const SCRATCH_CONFIG_YML = [
	"# omp-qol e2e bootstrap — generated, throwaway",
	"setupVersion: 1",
	"advisor:",
	'  syncBacklog: "1"',
	"modelRoles:",
	`  advisor: ${BLOCKED_ADVISOR_ROLE}`,
	"",
].join("\n");

async function sweepStaleIsolatedRoots(): Promise<void> {
	try {
		for (const entry of await fs.readdir(os.homedir())) {
			if (entry.startsWith(ISOLATED_ROOT_PREFIX) && entry !== isolatedRootName) {
				await rmrf(path.join(os.homedir(), entry));
			}
		}
	} catch {
		/* best-effort */
	}
}

async function buildIsolatedRoot(): Promise<void> {
	const agentDir = path.join(isolatedRoot, "agent");
	await fs.mkdir(agentDir, { recursive: true });
	const realAgentDir = path.join(realConfigRoot, "agent");
	for (const file of CREDENTIAL_FILES) {
		const src = path.join(realAgentDir, file);
		try {
			await fs.copyFile(src, path.join(agentDir, file));
			const size = (await fs.stat(src)).size;
			evidence.isolationCopied.push({ file, bytes: size });
		} catch {
			/* absent on this machine — fine */
		}
	}
	await Bun.write(path.join(agentDir, "config.yml"), SCRATCH_CONFIG_YML);
	log(`isolated config root: ${isolatedRoot} (copied: ${evidence.isolationCopied.map(f => f.file).join(", ")})`);
}

/** Project-scope settings overlay used ONLY in fallback-real-root mode. */
const FALLBACK_PROJECT_CONFIG = [
	"# omp-qol e2e neutralization overlay — generated, throwaway",
	"advisor:",
	"  enabled: false",
	'  syncBacklog: "1"',
	"  subagents: false",
	"modelRoles:",
	`  advisor: ${BLOCKED_ADVISOR_ROLE}`,
	"",
].join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// Section 2 — scratch workspace (git only) + isolated official install
// ═══════════════════════════════════════════════════════════════════════════

async function makeWorkspace(ws: string): Promise<void> {
	await gitInitScratch(ws, "omp-qol e2e scratch — plugin comes from isolated official npm install\n");
}

function installPluginOfficialIsolated(): void {
	const isolation = resolveIsolation({ isolatedRoot: isolatedRootName });
	const result = runOfficialInstall(isolation);
	if (result.stdout.trim()) log(result.stdout.trim());
	if (result.stderr.trim()) log(result.stderr.trim());
	if (result.status !== 0) {
		throw new Error(`official install failed (${result.status}): omp plugin install ${result.spec}\n${result.stderr}`);
	}
	evidence.notes.push(`official install: omp plugin install ${result.spec} → ${isolation.pluginsDir}`);
	log(`official install: omp plugin install ${result.spec} → ${isolation.pluginsDir}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 3 — RPC client (spawn, frame pump, frame log, turn driver)
// ═══════════════════════════════════════════════════════════════════════════

type Frame = Record<string, unknown>;

/** Every spawned omp, so a hard-deadline exit can still kill OUR children. */
const spawnedRpcs: OmpRpc[] = [];

interface CapturedTool {
	toolName: string;
	isError: boolean;
	text: string;
}

interface TurnResult {
	tools: CapturedTool[];
	/** message_end frames that carried an error marker, raw. */
	errors: string[];
}

class OmpRpc {
	#proc: ReturnType<typeof Bun.spawn> | undefined;
	#queue: Frame[] = [];
	#waiters: Array<{ resolve: (f: Frame) => void; predicate: (f: Frame) => boolean }> = [];
	#closed = false;
	#frameLogPath: string;
	#t0 = Date.now();
	#promptSeq = 0;

	constructor(frameLogName: string) {
		this.#frameLogPath = path.join(artifactDir, frameLogName);
	}

	async start(cwd: string, env: Record<string, string | undefined>, stderrName: string): Promise<void> {
		await fs.mkdir(artifactDir, { recursive: true });
		this.#proc = Bun.spawn(["omp", "--mode", "rpc"], {
			cwd,
			stdin: "pipe",
			stdout: "pipe",
			stderr: Bun.file(path.join(artifactDir, stderrName)),
			env,
		});
		spawnedRpcs.push(this);
		void this.#pump();
	}

	get exited(): Promise<number> | undefined {
		return this.#proc?.exited;
	}

	async #logFrame(dir: "in" | "out", frame: Frame): Promise<void> {
		const line = `${JSON.stringify({ t: Date.now() - this.#t0, dir, frame })}\n`;
		await fs.appendFile(this.#frameLogPath, line).catch(() => {});
	}

	async #pump(): Promise<void> {
		const reader = (this.#proc!.stdout as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, newline).trim();
					buffer = buffer.slice(newline + 1);
					if (!line) continue;
					let frame: Frame;
					try {
						frame = JSON.parse(line) as Frame;
					} catch {
						continue;
					}
					void this.#logFrame("in", frame);
					const idx = this.#waiters.findIndex(w => w.predicate(frame));
					if (idx >= 0) {
						const [w] = this.#waiters.splice(idx, 1);
						w.resolve(frame);
					} else {
						this.#queue.push(frame);
						if (this.#queue.length > 5000) this.#queue.splice(0, 1000);
					}
				}
			}
		} finally {
			this.#closed = true;
		}
	}

	send(obj: Frame): void {
		void this.#logFrame("out", obj);
		(this.#proc!.stdin as { write(s: string): unknown }).write(`${JSON.stringify(obj)}\n`);
	}

	waitFrame(predicate: (f: Frame) => boolean, timeoutMs: number, label: string): Promise<Frame> {
		const idx = this.#queue.findIndex(predicate);
		if (idx >= 0) {
			const [f] = this.#queue.splice(idx, 1);
			return Promise.resolve(f);
		}
		if (this.#closed) return Promise.reject(new Error(`stream closed while waiting for ${label}`));
		return new Promise<Frame>((resolve, reject) => {
			const waiter = { resolve: (f: Frame) => resolve(f), predicate };
			this.#waiters.push(waiter);
			setTimeout(() => {
				const i = this.#waiters.indexOf(waiter);
				if (i >= 0) {
					this.#waiters.splice(i, 1);
					reject(new Error(`timeout (${timeoutMs}ms) waiting for ${label}`));
				}
			}, timeoutMs);
		});
	}

	async request(type: string, fields: Frame = {}, timeoutMs = 60_000): Promise<Frame> {
		const id = `req-${type}-${++this.#promptSeq}`;
		this.send({ id, type, ...fields });
		const resp = await this.waitFrame(f => f.type === "response" && f.id === id, timeoutMs, `response(${type})`);
		return resp;
	}

	/**
	 * Send one prompt and collect every advisor tool_execution_end until
	 * agent_end. message_end error markers are surfaced for transient-model
	 * rotation by the caller.
	 */
	async promptTurn(message: string, timeoutMs: number): Promise<TurnResult> {
		const id = `p-${++this.#promptSeq}`;
		this.send({ id, type: "prompt", message });
		const tools: CapturedTool[] = [];
		const errors: string[] = [];
		const deadline = Date.now() + timeoutMs;
		while (true) {
			const remain = deadline - Date.now();
			if (remain <= 0) throw new Error(`turn timeout after ${timeoutMs}ms (prompt ${id})`);
			const frame = await this.waitFrame(
				f => f.type === "agent_end" || f.type === "tool_execution_end" || f.type === "message_end",
				remain,
				"turn frame",
			);
			if (frame.type === "tool_execution_end") {
				const text =
					((frame.result as { content?: Array<{ text?: string }> } | undefined)?.content ?? [])
						.map(c => c.text ?? "")
						.join("\n") || JSON.stringify(frame);
				tools.push({ toolName: String(frame.toolName ?? ""), isError: frame.isError === true, text });
				continue;
			}
			if (frame.type === "message_end") {
				const raw = JSON.stringify(frame);
				if (raw.includes('stopReason":"error"') || raw.includes("errorMessage")) errors.push(raw);
				continue;
			}
			if (frame.type === "agent_end") return { tools, errors };
		}
	}

	kill(): void {
		try {
			this.#proc?.kill();
		} catch {
			/* already gone */
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 4 — model selection
// ═══════════════════════════════════════════════════════════════════════════

interface ModelRef {
	provider: string;
	id: string;
}
const modelKey = (m: ModelRef) => `${m.provider}/${m.id}`;

const PROVIDER_PREFERENCE = ["zai", "deepseek", "kimi-code", "aiberm", "scnet", "lmuai", "openai-codex"];
const CHEAP_ID = /flash|haiku|mini|lite|air|turbo|nano|chat|v3|k2/i;
const BLOCKED_MODEL = (m: ModelRef) => m.provider === "cursor" || m.id.includes("gpt-5.4-nano");

function providerPool(): string[] {
	return relayProviders.length > 0 ? relayProviders : PROVIDER_PREFERENCE;
}

/** Primary-model queue: one cheap-looking pick per preferred provider. */
function rankPrimaryModels(models: ModelRef[]): ModelRef[] {
	const pool = providerPool();
	const usable = models.filter(m => !BLOCKED_MODEL(m) && pool.includes(m.provider));
	const ranked: ModelRef[] = [];
	for (const provider of pool) {
		const group = usable.filter(m => m.provider === provider);
		const pick = group.find(m => CHEAP_ID.test(m.id)) ?? group[0];
		if (pick) ranked.push(pick);
	}
	return ranked;
}

/** Advisor candidates: cheap-looking ids across the pool, provider-diverse first. */
function rankAdvisorCandidates(models: ModelRef[]): ModelRef[] {
	const pool = providerPool();
	const usable = models.filter(m => !BLOCKED_MODEL(m) && pool.includes(m.provider) && CHEAP_ID.test(m.id));
	const byProvider = new Map<string, ModelRef[]>();
	for (const m of usable) {
		const list = byProvider.get(m.provider) ?? [];
		list.push(m);
		byProvider.set(m.provider, list);
	}
	// Round-robin providers in preference order so the first two candidates
	// come from two different providers whenever possible.
	const ranked: ModelRef[] = [];
	let added = true;
	let round = 0;
	while (added) {
		added = false;
		for (const provider of pool) {
			const list = byProvider.get(provider) ?? [];
			if (round < list.length) {
				ranked.push(list[round]!);
				added = true;
			}
		}
		round++;
	}
	return ranked;
}

const isTransientModelError = (raw: string) =>
	/not_found|Connect error|usage_limit|rate.?limit|\b40[13]\b|overloaded|unavailable|ECONNRE|timed?.?out/i.test(raw);

// ═══════════════════════════════════════════════════════════════════════════
// Section 5 — envelope helpers + assertion plumbing
// ═══════════════════════════════════════════════════════════════════════════

type Envelope = Record<string, unknown> & {
	ok?: boolean;
	tool?: string;
	op?: string;
	advisors?: Array<Record<string, unknown>>;
	verification?: { enabled?: boolean; active?: boolean; activeCount?: number; advisors?: Array<Record<string, unknown>> };
	warnings?: string[];
};

/** Results are pure JSON (the one-liner rides inside the body as `summary`),
 *  so direct parse doubles as the no-prose-prefix assertion. */
function parseEnvelope(text: string): Envelope {
	try {
		return JSON.parse(text) as Envelope;
	} catch {
		throw new StepFailure(`tool result is not pure JSON: ${text.slice(0, 300)}`);
	}
}

interface StatShape {
	name: string;
	status: string;
	model?: string;
	sessionId?: string;
	cost?: number;
	tokens?: { total?: number };
	messages?: { user?: number; assistant?: number; total?: number };
}

function statOf(advisors: Array<Record<string, unknown>> | undefined, name: string): StatShape | undefined {
	return (advisors as StatShape[] | undefined)?.find(a => a.name === name);
}

function insideWorkspace(sourcePath: string, ws: string): boolean {
	const norm = (p: string) => path.resolve(p).toLowerCase();
	return norm(sourcePath).startsWith(norm(ws));
}

/** Throw StepFailure listing every failed check. */
function assertAll(label: string, checks: Array<[string, boolean]>): void {
	const failed = checks.filter(([, ok]) => !ok).map(([desc]) => desc);
	if (failed.length > 0) throw new StepFailure(`${label}: ${failed.join(" | ")}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 6 — phase driver scaffolding (spawn omp, pick model, run LLM steps)
// ═══════════════════════════════════════════════════════════════════════════

interface PhaseCtx {
	rpc: OmpRpc;
	ws: string;
	primaryQueue: ModelRef[];
	primary: ModelRef;
}

function childEnv(mode: "isolated" | "fallback-real-root"): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env };
	delete env.PI_CODING_AGENT_DIR;
	delete env.OMP_PROFILE;
	delete env.PI_PROFILE;
	if (mode === "isolated") env.PI_CONFIG_DIR = isolatedRootName;
	else delete env.PI_CONFIG_DIR;
	return env;
}

async function startPhase(
	ws: string,
	mode: "isolated" | "fallback-real-root",
	frameLogName: string,
	stderrName: string,
	models?: ModelRef[],
): Promise<{ ctx: PhaseCtx; models: ModelRef[] }> {
	const rpc = new OmpRpc(frameLogName);
	await rpc.start(ws, childEnv(mode), stderrName);
	await rpc.waitFrame(f => f.type === "ready", 120_000, "ready");
	let available = models;
	if (!available) {
		const resp = await rpc.request("get_available_models", {}, 180_000);
		if (resp.success !== true) throw new Error(`get_available_models failed: ${JSON.stringify(resp.error)}`);
		available = (((resp.data as { models?: ModelRef[] })?.models ?? []) as ModelRef[]).filter(
			m => m && typeof m.provider === "string" && typeof m.id === "string",
		);
	}
	const primaryQueue = rankPrimaryModels(available);
	const primary = primaryQueue.shift();
	if (!primary) throw new Inconclusive("no usable primary model resolved from the host (credentials missing?)");
	const set = await rpc.request("set_model", { provider: primary.provider, modelId: primary.id }, 120_000);
	if (set.success !== true) throw new Error(`set_model failed: ${JSON.stringify(set.error)}`);
	log(`primary model: ${modelKey(primary)}`);
	return { ctx: { rpc, ws, primaryQueue, primary }, models: available };
}

async function rotatePrimary(ctx: PhaseCtx, reason: string): Promise<boolean> {
	const next = ctx.primaryQueue.shift();
	if (!next) return false;
	log(`rotating primary after ${reason}: ${modelKey(next)}`);
	const set = await ctx.rpc.request("set_model", { provider: next.provider, modelId: next.id }, 120_000);
	if (set.success !== true) return rotatePrimary(ctx, `set_model failure on ${modelKey(next)}`);
	ctx.primary = next;
	evidence.primaryModel = modelKey(next);
	return true;
}

/**
 * Run one LLM step: prompt → collect advisor tool envelopes → agent_end.
 * Retries on transient model errors (rotating the primary), and re-prompts
 * once when the model failed to make the expected number of advisor calls.
 */
async function llmStep(
	ctx: PhaseCtx,
	label: string,
	prompt: string,
	expectedOps: string[],
	artifactName?: string,
): Promise<Envelope[]> {
	for (let attempt = 1; attempt <= 4; attempt++) {
		const result = await ctx.rpc.promptTurn(prompt, 300_000);
		const advisorCalls = result.tools.filter(t => t.toolName === "advisor");
		if (advisorCalls.length === 0 && expectedOps.length > 0) {
			const transient = result.errors.find(isTransientModelError);
			if (transient && (await rotatePrimary(ctx, `no tool call on ${label}`))) continue;
			if (attempt < 4) {
				log(`${label}: no advisor call this turn (attempt ${attempt}) — re-prompting`);
				continue;
			}
			throw new StepFailure(`${label}: turn ended without the advisor tool call`);
		}
		const envelopes = advisorCalls.map(t => parseEnvelope(t.text));
		if (artifactName) {
			await saveJsonArtifact(artifactName, {
				label,
				prompt,
				envelopes,
				rawTexts: advisorCalls.map(t => t.text),
			});
		}
		for (const [i, env] of envelopes.entries()) {
			if (advisorCalls[i]!.isError || env.ok === false) {
				throw new StepFailure(`${label}: advisor call #${i + 1} returned an error envelope: ${advisorCalls[i]!.text.slice(0, 500)}`);
			}
		}
		const gotOps = envelopes.map(e => String(e.op));
		const wantedFound = expectedOps.every(op => gotOps.includes(op));
		const unexpected = gotOps.filter(op => !expectedOps.includes(op));
		if (!wantedFound) {
			if (attempt < 4) {
				const missing = expectedOps.filter(op => !gotOps.includes(op));
				log(`${label}: missing op(s) ${missing.join(",")} (got ${gotOps.join(",") || "none"}) — re-prompting`);
				// Ask only for what is missing; caller-level combos handle baseline
				// hygiene themselves.
				prompt = `Call the tool named 'advisor' ${missing.length === 1 ? "exactly once" : `${missing.length} times`}, with op=${missing.join(" then op=")}${promptSuffix}`;
				expectedOps = missing;
				continue;
			}
			throw new StepFailure(`${label}: expected ops ${expectedOps.join(",")}, got ${gotOps.join(",")}`);
		}
		if (unexpected.length > 0) {
			throw new StepFailure(
				`${label}: model made unexpected advisor call(s): ${unexpected.join(",")} — evidence integrity requires exactly the scripted ops`,
			);
		}
		return envelopes;
	}
	throw new StepFailure(`${label}: exhausted retries`);
}

const promptSuffix = ". Do not call any other tool. Then reply with the single word DONE.";
const oneCall = (params: string) =>
	`Call the tool named 'advisor' exactly once with parameters ${params}${promptSuffix}`;

// ═══════════════════════════════════════════════════════════════════════════
// Section 7 — [CRUD] scripted lifecycle under the new envelope
// ═══════════════════════════════════════════════════════════════════════════

async function runCrudPhase(mode: "isolated" | "fallback-real-root", models: ModelRef[]): Promise<void> {
	const t0 = Date.now();
	const { ctx } = await startPhase(wsCrud, mode, "frames-crud.jsonl", "stderr-crud.txt", models);
	evidence.primaryModel = modelKey(ctx.primary);
	try {
		let step = 0;
		const runStep = async (
			op: string,
			params: string,
			check: (e: Envelope) => void,
		): Promise<Envelope> => {
			step++;
			const label = `crud step ${step} (${op})`;
			const [env] = await llmStep(ctx, label, oneCall(params), [op], `crud-step-${String(step).padStart(2, "0")}-${op}.json`);
			check(env!);
			evidence.crudSteps.push({ step, op, ok: true });
			log(`${label}: OK`);
			return env!;
		};

		// 1 — status (envelope shape)
		await runStep("status", "op=status", e =>
			assertAll("status shape", [
				["ok===true", e.ok === true],
				['tool==="advisor"', e.tool === "advisor"],
				['op==="status"', e.op === "status"],
				["enabled is boolean", typeof e.enabled === "boolean"],
				["active is boolean", typeof e.active === "boolean"],
				["activeCount is number", typeof e.activeCount === "number"],
				["advisors is array", Array.isArray(e.advisors)],
				["statusLine is string", typeof e.statusLine === "string"],
			]),
		);

		// 2 — enable (empty roster + neutralized advisor role → implicit default at no_model)
		await runStep("enable", "op=enable", e =>
			assertAll("enable", [
				["ok", e.ok === true],
				["enabled===true", e.enabled === true],
				["discovered===false", e.discovered === false],
				["running is boolean", typeof e.running === "boolean"],
				["running===false (neutralized role)", e.running === false],
				["activeCount===0", e.activeCount === 0],
				["no_model warning present", (e.warnings ?? []).some(w => w.startsWith("no_model:"))],
				["no-runtime warning present", (e.warnings ?? []).some(w => w.includes("no advisor runtime started"))],
			]),
		);

		// 3 — upsert a named advisor (no model pin — role is neutralized, so no_model)
		await runStep(
			"upsert",
			'op=upsert name="E2EReviewer" instructions="Watch for regressions in this e2e session."',
			e => {
				const v = e.verification;
				assertAll("upsert E2EReviewer", [
					["ok", e.ok === true],
					["persisted===true", e.persisted === true],
					["fileDeleted===false", e.fileDeleted === false],
					["applied===true", e.applied === true],
					['effectiveAt==="immediate"', e.effectiveAt === "immediate"],
					["source inside scratch ws (SAFETY)", typeof e.source === "string" && insideWorkspace(e.source as string, wsCrud)],
					["verification.enabled===true", v?.enabled === true],
					["roster has E2EReviewer", !!statOf(v?.advisors, "E2EReviewer")],
				]);
			},
		);

		// 4 — list effective
		await runStep("list", 'op=list scope="effective"', e =>
			assertAll("list effective", [
				["ok", e.ok === true],
				['scope==="effective"', e.scope === "effective"],
				["contains E2EReviewer", (e.advisors ?? []).some(a => a.name === "E2EReviewer")],
				["no implicitDefault flag", e.implicitDefault === undefined],
			]),
		);

		// 5 — remove (only entry → native empty-doc semantics delete the file)
		await runStep("remove", 'op=remove name="E2EReviewer"', e =>
			assertAll("remove E2EReviewer", [
				["ok", e.ok === true],
				["persisted===true", e.persisted === true],
				["removed===1", e.removed === 1],
				["fileDeleted===true (native empty-doc delete)", e.fileDeleted === true],
				["source inside scratch ws (SAFETY)", typeof e.source === "string" && insideWorkspace(e.source as string, wsCrud)],
			]),
		);

		// 6 — status shows the implicit default (empty roster, enabled)
		await runStep("status", "op=status", e => {
			const d = statOf(e.advisors, "default");
			assertAll("status implicit default", [
				["enabled===true", e.enabled === true],
				["exactly one advisor entry", (e.advisors ?? []).length === 1],
				['entry is "default"', !!d],
				['default at "no_model" (neutralized role)', d?.status === "no_model"],
				["activeCount===0", e.activeCount === 0],
			]);
		});

		// 7 — pause the implicit default by materializing enabled=false
		await runStep("upsert", 'op=upsert name="default" enabled=false', e => {
			const v = e.verification;
			const d = statOf(v?.advisors, "default");
			assertAll("pause default", [
				["ok", e.ok === true],
				["persisted===true", e.persisted === true],
				["fileDeleted===false", e.fileDeleted === false],
				['default is "paused"', d?.status === "paused"],
				["activeCount===0", v?.activeCount === 0],
				["source inside scratch ws (SAFETY)", typeof e.source === "string" && insideWorkspace(e.source as string, wsCrud)],
			]);
		});

		// 8 — remove the materialized default → implicit default restored
		await runStep("remove", 'op=remove name="default"', e => {
			const v = e.verification;
			const d = statOf(v?.advisors, "default");
			assertAll("restore implicit default", [
				["ok", e.ok === true],
				["persisted===true", e.persisted === true],
				["removed===1", e.removed === 1],
				["fileDeleted===true", e.fileDeleted === true],
				["implicit default back in stats", !!d],
				['restored default at "no_model" (not paused)', d?.status === "no_model"],
			]);
		});

		// 9 — disable
		await runStep("disable", "op=disable", e =>
			assertAll("disable", [
				["ok", e.ok === true],
				["enabled===false", e.enabled === false],
				["active===false", e.active === false],
				["running===false", e.running === false],
				["discovered===false", e.discovered === false],
			]),
		);
	} finally {
		ctx.rpc.kill();
		evidence.timings.crudMs = Date.now() - t0;
	}
	log(`CRUD phase complete in ${Math.round(evidence.timings.crudMs / 1000)}s`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 8 — [LIVE] multi-advisor real-traffic acceptance
// ═══════════════════════════════════════════════════════════════════════════

const ADVISOR_INSTRUCTIONS = "Reply with at most one advise note per review, severity info only, under 15 words.";

interface BaselineStats {
	alpha: StatShape;
	beta: StatShape;
	gamma: StatShape;
}

function snapshotDelta(name: string, s: StatShape): AdvisorDelta {
	return {
		name,
		model: s.model,
		baseline: {
			user: s.messages?.user ?? 0,
			assistant: s.messages?.assistant ?? 0,
			tokensTotal: s.tokens?.total ?? 0,
			cost: s.cost ?? 0,
		},
	};
}

function checkBaselineStatus(e: Envelope, mAlpha: string, mBeta: string): BaselineStats {
	const alpha = statOf(e.advisors, "Alpha");
	const beta = statOf(e.advisors, "Beta");
	const gamma = statOf(e.advisors, "Gamma");
	assertAll("baseline status", [
		["enabled===true", e.enabled === true],
		["active===true", e.active === true],
		["activeCount===2", e.activeCount === 2],
		["exactly 3 roster entries", (e.advisors ?? []).length === 3],
		["Alpha present", !!alpha],
		['Alpha exactly "running"', alpha?.status === "running"],
		[`Alpha model===${mAlpha}`, alpha?.model === mAlpha],
		["Alpha tokens.total===0", (alpha?.tokens?.total ?? -1) === 0],
		["Alpha messages.total===0", (alpha?.messages?.total ?? -1) === 0],
		["Alpha has sessionId", typeof alpha?.sessionId === "string" && alpha.sessionId.length > 0],
		["Beta present", !!beta],
		['Beta exactly "running"', beta?.status === "running"],
		[`Beta model===${mBeta}`, beta?.model === mBeta],
		["Beta tokens.total===0", (beta?.tokens?.total ?? -1) === 0],
		["Beta messages.total===0", (beta?.messages?.total ?? -1) === 0],
		["Beta has sessionId", typeof beta?.sessionId === "string" && beta.sessionId.length > 0],
		["models distinct", mAlpha !== mBeta],
		["Gamma present", !!gamma],
		['Gamma exactly "paused"', gamma?.status === "paused"],
		["Gamma has no sessionId (skeleton)", !gamma?.sessionId],
		["Gamma zero tokens", (gamma?.tokens?.total ?? 0) === 0],
		["Gamma zero messages", (gamma?.messages?.total ?? 0) === 0],
	]);
	return { alpha: alpha!, beta: beta!, gamma: gamma! };
}

async function runLivePhase(mode: "isolated" | "fallback-real-root", models: ModelRef[]): Promise<void> {
	const t0 = Date.now();
	const { ctx } = await startPhase(wsLive, mode, "frames-live.jsonl", "stderr-live.txt", models);
	evidence.primaryModel = modelKey(ctx.primary);

	const advisorQueue = rankAdvisorCandidates(models);
	if (advisorQueue.length < 2) {
		ctx.rpc.kill();
		throw new Inconclusive(
			`fewer than 2 cheap advisor candidates resolved (got: ${advisorQueue.map(modelKey).join(", ") || "none"}) — credentials/providers unavailable`,
		);
	}
	let mAlpha = advisorQueue.shift()!;
	let mBeta = advisorQueue.find(m => m.provider !== mAlpha.provider) ?? advisorQueue[0];
	if (!mBeta) throw new Inconclusive("no second advisor candidate");
	advisorQueue.splice(advisorQueue.indexOf(mBeta), 1);
	log(`advisor models: Alpha=${modelKey(mAlpha)} Beta=${modelKey(mBeta)} (paused Gamma pins ${modelKey(mAlpha)})`);

	try {
		// T1–T3: roster writes while the session flag is OFF (fresh session).
		// effectiveAt==="stored" doubles as an isolation canary: it fails if the
		// environment leaked advisor.enabled=true into this session.
		const upsertCheck = (label: string) => (e: Envelope) => {
			assertAll(label, [
				["ok", e.ok === true],
				["persisted===true", e.persisted === true],
				['effectiveAt==="stored" (flag off)', e.effectiveAt === "stored"],
				["verification.enabled===false", e.verification?.enabled === false],
				["verification.active===false", e.verification?.active === false],
				["source inside scratch ws (SAFETY)", typeof e.source === "string" && insideWorkspace(e.source as string, wsLive)],
				["stored warning present", (e.warnings ?? []).some(w => w.startsWith("stored:"))],
			]);
		};
		const [t1] = await llmStep(
			ctx,
			"live T1 upsert Alpha",
			oneCall(`op=upsert name="Alpha" model="${modelKey(mAlpha)}" instructions="${ADVISOR_INSTRUCTIONS}"`),
			["upsert"],
			"live-T1-upsert-alpha.json",
		);
		upsertCheck("T1 upsert Alpha")(t1!);
		const [t2] = await llmStep(
			ctx,
			"live T2 upsert Beta",
			oneCall(`op=upsert name="Beta" model="${modelKey(mBeta)}" instructions="${ADVISOR_INSTRUCTIONS}"`),
			["upsert"],
			"live-T2-upsert-beta.json",
		);
		upsertCheck("T2 upsert Beta")(t2!);
		const [t3] = await llmStep(
			ctx,
			"live T3 upsert Gamma (paused control)",
			oneCall(`op=upsert name="Gamma" model="${modelKey(mAlpha)}" enabled=false`),
			["upsert"],
			"live-T3-upsert-gamma.json",
		);
		upsertCheck("T3 upsert Gamma")(t3!);
		evidence.liveChecks.push({ label: "T1-T3 roster stored while disabled", ok: true });

		// T4: enable + status in ONE turn — the status executes before this
		// turn ends, i.e. before any advisor has been fed a single turn, so the
		// all-zero baseline is honest. If the driving model splits the combo
		// across turns (runtimes up AND already fed), op=apply rebuilds every
		// runtime with fresh counters, so an apply+status combo restores an
		// honest zero baseline.
		const comboPrompt =
			"Call the tool named 'advisor' exactly twice, in order: first call with op=enable and no other parameters; " +
			`second call with op=status and no other parameters${promptSuffix}`;
		const repairPrompt =
			"Call the tool named 'advisor' exactly twice, in order: first call with op=apply and no other parameters; " +
			`second call with op=status and no other parameters${promptSuffix}`;
		const rebaseline = async (label: string, artifact: string): Promise<Envelope> => {
			evidence.baselineRepaired = true;
			const envs = await llmStep(ctx, label, repairPrompt, ["apply", "status"], artifact);
			return envs.find(e => e.op === "status")!;
		};
		let baselineEnv: Envelope;
		try {
			const envs = await llmStep(ctx, "live T4 enable+status", comboPrompt, ["enable", "status"], "live-T4-enable-status.json");
			baselineEnv = envs.find(e => e.op === "status")!;
		} catch (err) {
			if (!(err instanceof StepFailure)) throw err;
			log(`T4 combo failed (${(err as Error).message.slice(0, 120)}); repairing via apply+status combo`);
			baselineEnv = await rebaseline("live T4b apply+status repair", "live-T4b-apply-status.json");
		}

		// no_model re-pin loop: bounded, each iteration is an upsert+status combo
		// (upsert rebuilds all runtimes mid-turn → same-turn status is a fresh
		// zero baseline again).
		for (let repin = 0; repin < 3; repin++) {
			const alpha = statOf(baselineEnv.advisors, "Alpha");
			const beta = statOf(baselineEnv.advisors, "Beta");
			const broken: Array<["Alpha" | "Beta", StatShape | undefined]> = [];
			if (alpha?.status !== "running") broken.push(["Alpha", alpha]);
			if (beta?.status !== "running") broken.push(["Beta", beta]);
			if (broken.length === 0) break;
			const [name, stat] = broken[0]!;
			if (stat?.status && !["no_model", "quota_exhausted", "error"].includes(stat.status)) {
				throw new StepFailure(`${name} baseline status is "${stat.status}" — not a model-availability issue`);
			}
			const next = advisorQueue.shift();
			if (!next) {
				throw new Inconclusive(
					`advisor ${name} stuck at "${stat?.status}" and no candidate models remain — credentials/providers unavailable`,
				);
			}
			log(`re-pinning ${name} (${stat?.status}) to ${modelKey(next)}`);
			evidence.repins.push(`${name} → ${modelKey(next)} (was ${stat?.status})`);
			if (name === "Alpha") mAlpha = next;
			else mBeta = next;
			const repinPrompt =
				`Call the tool named 'advisor' exactly twice, in order: first call with op=upsert name="${name}" model="${modelKey(next)}"; ` +
				`second call with op=status and no other parameters${promptSuffix}`;
			const repinEnvs = await llmStep(ctx, `live T4 re-pin ${name}`, repinPrompt, ["upsert", "status"], `live-T4-repin-${name.toLowerCase()}-${repin}.json`);
			baselineEnv = repinEnvs.find(e => e.op === "status")!;
		}

		let baseline: BaselineStats;
		try {
			baseline = checkBaselineStatus(baselineEnv, modelKey(mAlpha), modelKey(mBeta));
		} catch (err) {
			// A tainted baseline (combo split across turns → advisors already fed)
			// shows up here as nonzero counters. One repair attempt, then honest
			// failure — never a weakened assertion.
			if (!(err instanceof StepFailure) || evidence.baselineRepaired) throw err;
			log(`baseline check failed (${(err as Error).message.slice(0, 160)}); one apply+status re-baseline`);
			baselineEnv = await rebaseline("live T4c apply+status re-baseline", "live-T4c-apply-status.json");
			baseline = checkBaselineStatus(baselineEnv, modelKey(mAlpha), modelKey(mBeta));
		}
		await saveJsonArtifact("status-baseline.json", baselineEnv);
		evidence.advisorModels = { alpha: modelKey(mAlpha), beta: modelKey(mBeta), gamma: modelKey(mAlpha) };
		evidence.deltas.alpha = snapshotDelta("Alpha", baseline.alpha);
		evidence.deltas.beta = snapshotDelta("Beta", baseline.beta);
		evidence.liveChecks.push({ label: "baseline: Alpha+Beta running distinct models, all counters zero; Gamma paused", ok: true });
		log(`baseline OK: Alpha=${modelKey(mAlpha)} Beta=${modelKey(mBeta)} all-zero; Gamma paused`);

		// T5: the ONE real primary turn. advisor.syncBacklog="1" makes prompt()
		// wait (≤30s per advisor) for advisor catch-up before agent_end.
		const ping = await ctx.rpc.promptTurn("Reply with exactly: PING", 300_000);
		if (ping.tools.some(t => t.toolName === "advisor")) {
			throw new StepFailure("PING turn unexpectedly called the advisor tool");
		}
		const lastText = await ctx.rpc.request("get_last_assistant_text", {}, 60_000);
		evidence.pingReply = String((lastText.data as { text?: string })?.text ?? "").slice(0, 200);
		if (!evidence.pingReply.includes("PING")) {
			evidence.notes.push(`PING reply did not echo PING verbatim: ${JSON.stringify(evidence.pingReply)} (cosmetic; not a gate)`);
		}
		log(`PING turn done (reply: ${JSON.stringify(evidence.pingReply.slice(0, 60))})`);

		// T6: post-turn per-advisor delta assertions (poll up to 3 status turns).
		let post: Envelope | undefined;
		let lastProblem = "";
		for (let poll = 1; poll <= 3; poll++) {
			const [statusEnv] = await llmStep(ctx, `live T6 status (poll ${poll})`, oneCall("op=status"), ["status"], `status-post-${poll}.json`);
			post = statusEnv!;
			const alpha = statOf(post.advisors, "Alpha");
			const beta = statOf(post.advisors, "Beta");
			const settled = (s?: StatShape) => (s?.messages?.assistant ?? 0) >= 1 && (s?.tokens?.total ?? 0) > 0;
			if (settled(alpha) && settled(beta)) break;
			lastProblem = `Alpha assistant=${alpha?.messages?.assistant ?? 0}/tokens=${alpha?.tokens?.total ?? 0}, Beta assistant=${beta?.messages?.assistant ?? 0}/tokens=${beta?.tokens?.total ?? 0}`;
			log(`poll ${poll}: advisors not settled yet (${lastProblem})`);
			await Bun.sleep(5_000);
		}
		const alphaPost = statOf(post!.advisors, "Alpha");
		const betaPost = statOf(post!.advisors, "Beta");
		const gammaPost = statOf(post!.advisors, "Gamma");
		for (const [name, stat] of [
			["Alpha", alphaPost],
			["Beta", betaPost],
		] as const) {
			if (stat?.status && ["quota_exhausted", "error"].includes(stat.status)) {
				throw new Inconclusive(`advisor ${name} ended at "${stat.status}" — provider/quota failure, not judgeable as pass or fail`);
			}
		}
		const delta = (name: "Alpha" | "Beta", s: StatShape | undefined, base: AdvisorDelta) => {
			const postNums = {
				user: s?.messages?.user ?? 0,
				assistant: s?.messages?.assistant ?? 0,
				tokensTotal: s?.tokens?.total ?? 0,
				cost: s?.cost ?? 0,
			};
			base.post = postNums;
			assertAll(`post-turn delta ${name}`, [
				[`${name} still running`, s?.status === "running"],
				[`${name} messages.user >= 1 (Fed)`, postNums.user - base.baseline.user >= 1],
				[`${name} messages.assistant >= 1 (Streamed)`, postNums.assistant - base.baseline.assistant >= 1],
				[`${name} tokens.total > 0 (Streamed)`, postNums.tokensTotal - base.baseline.tokensTotal > 0],
			]);
		};
		delta("Alpha", alphaPost, evidence.deltas.alpha!);
		delta("Beta", betaPost, evidence.deltas.beta!);
		assertAll("post-turn Gamma control", [
			['Gamma still "paused"', gammaPost?.status === "paused"],
			["Gamma zero tokens", (gammaPost?.tokens?.total ?? 0) === 0],
			["Gamma zero messages", (gammaPost?.messages?.total ?? 0) === 0],
		]);
		evidence.gammaSilent = true;
		evidence.liveChecks.push({
			label: "per-advisor deltas: Alpha & Beta independently Fed+Streamed; Gamma all-zero",
			ok: true,
			detail:
				`Alpha ${JSON.stringify(evidence.deltas.alpha!.post)} · Beta ${JSON.stringify(evidence.deltas.beta!.post)}`,
		});
		log("post-turn deltas OK (both advisors Fed+Streamed; Gamma silent)");

		// T7: dump carries both advisors' history
		const [dumpEnv] = await llmStep(ctx, "live T7 dump", oneCall("op=dump"), ["dump"], "dump.json");
		assertAll("dump", [
			["ok", dumpEnv!.ok === true],
			["history is string", typeof dumpEnv!.history === "string"],
			["mentions Alpha", String(dumpEnv!.history).includes("Alpha")],
			["mentions Beta", String(dumpEnv!.history).includes("Beta")],
		]);
		evidence.liveChecks.push({ label: "dump shows both advisors' history", ok: true });

		// T8: disable (stop billing runtimes cleanly)
		const [disableEnv] = await llmStep(ctx, "live T8 disable", oneCall("op=disable"), ["disable"], "live-T8-disable.json");
		assertAll("live disable", [["enabled===false", disableEnv!.enabled === false]]);

		// Post-processing (no LLM): session file, stats, transcripts, WATCHDOG copy.
		const state = await ctx.rpc.request("get_state", {}, 60_000);
		await saveJsonArtifact("get-state.json", state);
		const sessionFile = String((state.data as { sessionFile?: string })?.sessionFile ?? "");
		evidence.sessionFile = sessionFile;
		const stats = await ctx.rpc.request("get_session_stats", {}, 60_000);
		await saveJsonArtifact("session-stats.json", stats);
		ctx.rpc.kill();
		await Bun.sleep(1_500); // let the recorder flush + release handles

		if (!sessionFile.endsWith(".jsonl")) throw new StepFailure(`unexpected sessionFile: ${sessionFile}`);
		const transcriptDir = sessionFile.slice(0, -".jsonl".length);
		const readTranscript = async (slug: string) => {
			const p = path.join(transcriptDir, `__advisor.${slug}.jsonl`);
			try {
				return { path: p, text: await fs.readFile(p, "utf8") };
			} catch {
				return { path: p, text: null };
			}
		};
		const [ta, tb, tg] = await Promise.all([readTranscript("alpha"), readTranscript("beta"), readTranscript("gamma")]);
		assertAll("advisor transcripts on disk", [
			[`__advisor.alpha.jsonl exists (${ta.path})`, ta.text !== null],
			["alpha transcript has assistant record", !!ta.text?.includes('"assistant"')],
			[`__advisor.beta.jsonl exists (${tb.path})`, tb.text !== null],
			["beta transcript has assistant record", !!tb.text?.includes('"assistant"')],
			["NO __advisor.gamma.jsonl (paused control never ran)", tg.text === null],
		]);
		evidence.transcripts = { alpha: true, beta: true, gammaAbsent: true };
		if (ta.text) await saveArtifact("advisor-transcript.alpha.jsonl", ta.text);
		if (tb.text) await saveArtifact("advisor-transcript.beta.jsonl", tb.text);
		evidence.liveChecks.push({ label: "transcripts: alpha+beta persisted with assistant records; gamma absent", ok: true });

		const watchdogCopied = await copyArtifact(path.join(wsLive, "WATCHDOG.yml"), "watchdog-final.yml");
		if (!watchdogCopied) evidence.notes.push("final WATCHDOG.yml copy failed (file missing?)");
		log("LIVE phase complete");
	} finally {
		ctx.rpc.kill();
		evidence.timings.liveMs = Date.now() - t0;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 9 — probe (isolation validation), evidence writer, main
// ═══════════════════════════════════════════════════════════════════════════

/** Spawn omp once just to list models — validates the credential copy. */
async function probeModels(mode: "isolated" | "fallback-real-root"): Promise<ModelRef[]> {
	const rpc = new OmpRpc(`frames-probe-${mode}.jsonl`);
	await rpc.start(wsCrud, childEnv(mode), `stderr-probe-${mode}.txt`);
	try {
		await rpc.waitFrame(f => f.type === "ready", 120_000, "ready");
		const resp = await rpc.request("get_available_models", {}, 180_000);
		if (resp.success !== true) throw new Error(`get_available_models failed: ${JSON.stringify(resp.error)}`);
		const models = (((resp.data as { models?: ModelRef[] })?.models ?? []) as ModelRef[]).filter(
			m => m && typeof m.provider === "string" && typeof m.id === "string",
		);
		await saveJsonArtifact(`models-available-${mode}.json`, models.map(m => ({ provider: m.provider, id: m.id })));
		return models;
	} finally {
		rpc.kill();
	}
}

async function writeEvidence(): Promise<void> {
	await saveJsonArtifact("verdict.json", evidence);
	const d = evidence.deltas;
	const fmtDelta = (x?: AdvisorDelta) =>
		x
			? `baseline user=${x.baseline.user} assistant=${x.baseline.assistant} tokens=${x.baseline.tokensTotal} → ` +
				(x.post
					? `post user=${x.post.user} assistant=${x.post.assistant} tokens=${x.post.tokensTotal} cost=$${x.post.cost.toFixed(6)}`
					: "post (not reached)")
			: "(not reached)";
	const lines = [
		`# L6 multi-advisor real-traffic acceptance — run ${runId}`,
		"",
		`- **Verdict**: ${evidence.verdict.toUpperCase()}${evidence.verdictReason ? ` — ${evidence.verdictReason}` : ""}`,
		`- **Config root**: ${evidence.configRootMode}${evidence.configRootMode === "isolated" ? ` (\`~${path.sep}${isolatedRootName}\`; copied: ${evidence.isolationCopied.map(f => f.file).join(", ")})` : " (real ~/.omp + project .omp/config.yml neutralization overlay)"}`,
		`- **Advisor-role neutralization**: modelRoles.advisor pinned to \`${BLOCKED_ADVISOR_ROLE}\` (unset role falls back to the host's expensive "slow" chain)`,
		`- **Primary model**: ${evidence.primaryModel}`,
		`- **Advisors**: Alpha=\`${evidence.advisorModels.alpha}\` · Beta=\`${evidence.advisorModels.beta}\` · Gamma (paused control) pins \`${evidence.advisorModels.gamma}\``,
		`- **Timings**: crud=${Math.round((evidence.timings.crudMs ?? 0) / 1000)}s · live=${Math.round((evidence.timings.liveMs ?? 0) / 1000)}s`,
		`- **Baseline repaired**: ${evidence.baselineRepaired}${evidence.repins.length ? ` · re-pins: ${evidence.repins.join("; ")}` : ""}`,
		`- **PING reply**: ${JSON.stringify(evidence.pingReply)}`,
		`- **Session file**: \`${evidence.sessionFile}\``,
		"",
		"## CRUD lifecycle (envelope-asserted)",
		"",
		...(evidence.crudSteps.length
			? evidence.crudSteps.map(s => `- step ${s.step} \`${s.op}\`: ${s.ok ? "OK" : "FAILED"}`)
			: ["- (not reached)"]),
		"",
		"## Per-advisor evidence (Built → Fed → Streamed)",
		"",
		`- **Alpha** (${evidence.advisorModels.alpha}): ${fmtDelta(d.alpha)}`,
		`- **Beta** (${evidence.advisorModels.beta}): ${fmtDelta(d.beta)}`,
		`- **Gamma** (paused control): ${evidence.gammaSilent ? "all-zero throughout, no transcript file" : "(not verified)"}`,
		`- **Transcripts**: alpha=${evidence.transcripts.alpha} beta=${evidence.transcripts.beta} gammaAbsent=${evidence.transcripts.gammaAbsent}`,
		"",
		"## Live checks",
		"",
		...(evidence.liveChecks.length
			? evidence.liveChecks.map(c => `- ${c.ok ? "OK" : "FAILED"} — ${c.label}${c.detail ? ` (${c.detail})` : ""}`)
			: ["- (not reached)"]),
		"",
		"## Product issues found",
		"",
		...(evidence.productIssues.length ? evidence.productIssues.map(i => `- ${i}`) : ["- none"]),
		"",
		"## Notes / deviations",
		"",
		...(evidence.notes.length ? evidence.notes.map(n => `- ${n}`) : ["- none"]),
		"",
		"## Artifact index",
		"",
		"- `frames-*.jsonl` — every raw RPC frame, both directions, with ms offsets",
		"- `crud-step-*.json` / `live-T*.json` — advisor tool envelopes per step (parsed + raw)",
		"- `status-baseline.json` / `status-post-*.json` — op=status evidence (zero baseline, settled deltas)",
		"- `dump.json` — op=dump envelope with both advisors' history",
		"- `advisor-transcript.{alpha,beta}.jsonl` — on-disk advisor transcripts (copies)",
		"- `watchdog-final.yml` — final scratch WATCHDOG.yml (Alpha/Beta/Gamma roster)",
		"- `get-state.json` / `session-stats.json` — session file path + primary session stats",
		"- `models-available-*.json` — the host's model listing under the e2e config root",
		"- `verdict.json` — this run's full machine-readable evidence",
		"",
	];
	await saveArtifact("EVIDENCE.md", lines.join("\n"));
}

async function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const guard = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} exceeded hard deadline of ${ms / 1000}s`)), ms);
	});
	try {
		return await Promise.race([p, guard]);
	} finally {
		clearTimeout(timer);
	}
}

async function main(): Promise<number> {
	// -- workspace + root hygiene ------------------------------------------
	try {
		for (const entry of await fs.readdir(scratchParent).catch(() => [] as string[])) {
			if (entry.startsWith("e2e-advisor-ws")) await rmrf(path.join(scratchParent, entry));
		}
	} catch {
		/* fine */
	}
	await sweepStaleIsolatedRoots();
	await fs.mkdir(artifactDir, { recursive: true });

	// -- isolated root + official npm install + probe (real-root fallback) --
	let mode: "isolated" | "fallback-real-root" = "isolated";
	await buildIsolatedRoot();
	installPluginOfficialIsolated();
	await makeWorkspace(wsCrud);
	let models = await probeModels("isolated");
	let primaryOk = rankPrimaryModels(models).length > 0;
	let advisorsOk = rankAdvisorCandidates(models).length >= 2;
	log(`probe (isolated): ${models.length} models · primary ok=${primaryOk} · advisor candidates ok=${advisorsOk}`);
	if (!primaryOk || !advisorsOk) {
		log("isolated root cannot resolve enough models — falling back to the REAL config root with a project-scope neutralization overlay");
		mode = "fallback-real-root";
		evidence.configRootMode = mode;
		if (!liveUserPluginPresent()) {
			throw new Inconclusive(
				"isolated credentials failed and live ~/.omp has no omp-qol-plugin; refusing official install into the live user root",
			);
		}
		evidence.notes.push(
			"fallback-real-root: did not run omp plugin install (live ~/.omp is in use); using the already-present user plugin",
		);
		await rmrf(wsCrud);
		await makeWorkspace(wsCrud);
		await fs.mkdir(path.join(wsCrud, ".omp"), { recursive: true });
		await Bun.write(path.join(wsCrud, ".omp", "config.yml"), FALLBACK_PROJECT_CONFIG);
		models = await probeModels(mode);
		primaryOk = rankPrimaryModels(models).length > 0;
		advisorsOk = rankAdvisorCandidates(models).length >= 2;
		if (!primaryOk || !advisorsOk) {
			throw new Inconclusive("even the real config root resolves no usable models — credentials unavailable on this machine");
		}
	}
	await makeWorkspace(wsLive);
	if (mode === "fallback-real-root") {
		await fs.mkdir(path.join(wsLive, ".omp"), { recursive: true });
		await Bun.write(path.join(wsLive, ".omp", "config.yml"), FALLBACK_PROJECT_CONFIG);
	}
	await saveJsonArtifact("isolation-manifest.json", {
		mode,
		install: mode === "isolated" ? "omp plugin install omp-qol-plugin" : "already-present live user plugin (no install)",
		isolatedRoot: mode === "isolated" ? isolatedRoot : null,
		copied: evidence.isolationCopied,
		scratchConfigYml: SCRATCH_CONFIG_YML,
		fallbackOverlay: mode === "fallback-real-root" ? FALLBACK_PROJECT_CONFIG : null,
		neverCopied: ["config.yml (user settings)", "WATCHDOG.*", "sessions/", "history.db", "AGENTS.md", "memories/", "extensions/", "agents/"],
	});

	// -- phases --------------------------------------------------------------
	if (process.env.OMPQOL_E2E_SKIP_CRUD === "1") {
		log("skipping CRUD phase (OMPQOL_E2E_SKIP_CRUD=1)");
		evidence.notes.push("CRUD phase skipped via OMPQOL_E2E_SKIP_CRUD=1 (debug run — not a full verdict)");
	} else {
		await withDeadline(runCrudPhase(mode, models), PHASE_DEADLINE_MS, "CRUD phase");
	}
	if (process.env.OMPQOL_E2E_SKIP_LIVE === "1") {
		log("skipping LIVE phase (OMPQOL_E2E_SKIP_LIVE=1)");
		evidence.notes.push("LIVE phase skipped via OMPQOL_E2E_SKIP_LIVE=1 (debug run — not a full verdict)");
	} else {
		await withDeadline(runLivePhase(mode, models), PHASE_DEADLINE_MS, "LIVE phase");
	}

	if (process.env.OMPQOL_E2E_SKIP_CRUD === "1" || process.env.OMPQOL_E2E_SKIP_LIVE === "1") {
		evidence.verdict = "inconclusive";
		evidence.verdictReason = "debug run: a phase was skipped via OMPQOL_E2E_SKIP_* — never a full verdict";
		return 3;
	}
	evidence.verdict = "pass";
	evidence.verdictReason =
		"all CRUD steps green under the new envelope; Alpha and Beta independently Built(running, distinct models) → Fed(user>=1) → Streamed(assistant>=1, tokens>0); paused Gamma silent; transcripts on disk";
	return 0;
}

let exitCode: number;
try {
	exitCode = await main();
} catch (err) {
	if (err instanceof Inconclusive) {
		evidence.verdict = "inconclusive";
		evidence.verdictReason = err.message;
		logErr(`INCONCLUSIVE: ${err.message}`);
		exitCode = 3;
	} else if (err instanceof StepFailure) {
		evidence.verdict = "fail";
		evidence.verdictReason = err.message;
		logErr(`FAIL: ${err.message}`);
		exitCode = 1;
	} else {
		evidence.verdict = "fail";
		evidence.verdictReason = `harness error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
		logErr(`HARNESS ERROR: ${evidence.verdictReason}`);
		exitCode = 2;
	}
}

for (const rpc of spawnedRpcs) rpc.kill();
await writeEvidence().catch(e => logErr(`evidence write failed: ${e}`));
if (exitCode === 0) {
	// Success: remove the isolated root (12+ MB credential copy under home).
	// Scratch workspaces are swept at the next run's start; failures leave
	// everything behind for inspection.
	await rmrf(isolatedRoot);
	log(`artifacts: ${artifactDir}`);
	log("PASS");
} else {
	log(`artifacts (partial): ${artifactDir}`);
	log(evidence.verdict === "inconclusive" ? "INCONCLUSIVE" : "FAIL");
}
process.exit(exitCode);
