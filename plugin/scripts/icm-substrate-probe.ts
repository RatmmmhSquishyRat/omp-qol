/**
 * E3 RUNTIME PROBE — ICM substrate hooks against the REAL host package.
 *
 * Standalone bun script (NOT a bun:test file — must never join the test suite).
 * Run from the plugin directory so `@oh-my-pi/pi-coding-agent` resolves from
 * plugin/node_modules:
 *
 *     cd plugin
 *     bun scripts/icm-substrate-probe.ts
 *
 * Probes (all against a real AgentSession + real ExtensionRunner + real
 * extension file loaded through the host's own loader, scripted mock model,
 * zero network):
 *
 *   1. appendEntry persistence + LLM invisibility (+ reload survival)
 *   2. context hook projection (clone semantics, transformed wire, journal intact)
 *   3. session_before_compact custom CompactionResult (seal path, no LLM summarize)
 *
 * ISOLATION: PI_CONFIG_DIR is frozen to a fresh ~/.omp-qol-icm-probe-<ts>
 * BEFORE any host module import (the host's DirResolver joins the env value
 * onto os.homedir() and caches it at first module load — see
 * packages/utils/src/dirs.ts getBaseConfigRoot). The live ~/.omp is never
 * touched. The isolation dir is deleted at the end.
 *
 * Evidence protocol: every observation prints one line
 *     PROBE_EVIDENCE {json}
 * and the run ends with
 *     PROBE_SUMMARY {json}
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// =============================================================================
// Isolation — MUST happen before any dynamic host import below.
// =============================================================================

const PROBE_DIR_NAME = `.omp-qol-icm-probe-${Date.now()}`;
const ISOLATION_ROOT = path.join(os.homedir(), PROBE_DIR_NAME);
const LIVE_OMP_ROOT = path.join(os.homedir(), ".omp");

if (ISOLATION_ROOT === LIVE_OMP_ROOT || ISOLATION_ROOT.startsWith(LIVE_OMP_ROOT + path.sep)) {
	throw new Error(`SAFETY ABORT: isolation root ${ISOLATION_ROOT} overlaps live ${LIVE_OMP_ROOT}`);
}
// The host resolves PI_CONFIG_DIR relative to homedir (path.join(homedir, name)),
// so we pass the bare directory NAME — mirroring plugin/test/setup.ts.
process.env.PI_CONFIG_DIR = PROBE_DIR_NAME;
fs.rmSync(ISOLATION_ROOT, { recursive: true, force: true });
fs.mkdirSync(ISOLATION_ROOT, { recursive: true });

const WORK_DIR = path.join(ISOLATION_ROOT, "work");
fs.mkdirSync(WORK_DIR, { recursive: true });

// =============================================================================
// Evidence + verdict plumbing
// =============================================================================

type Verdict = "PASS" | "FAIL" | "BLOCKED";
interface CheckRecord {
	claim: string;
	ok: boolean;
	detail?: unknown;
}
interface ProbeResult {
	verdict: Verdict;
	checks: CheckRecord[];
	error?: string;
}
const probeResults: Record<string, ProbeResult> = {};

function evidence(payload: Record<string, unknown>): void {
	console.log(`PROBE_EVIDENCE ${JSON.stringify(payload)}`);
}

class ProbeCheckFailed extends Error {}

type Rec = (claim: string, ok: boolean, detail?: unknown) => void;

async function runProbe(name: string, fn: (rec: Rec) => Promise<void>): Promise<void> {
	const checks: CheckRecord[] = [];
	probeResults[name] = { verdict: "BLOCKED", checks };
	const rec: Rec = (claim, ok, detail) => {
		checks.push({ claim, ok, detail });
		evidence({ probe: name, claim, ok, ...(detail !== undefined ? { detail } : {}) });
		if (!ok) throw new ProbeCheckFailed(`${name} :: ${claim}`);
	};
	try {
		await fn(rec);
		probeResults[name].verdict = "PASS";
	} catch (err) {
		probeResults[name].verdict = err instanceof ProbeCheckFailed ? "FAIL" : "BLOCKED";
		probeResults[name].error = err instanceof Error ? (err.stack ?? err.message) : String(err);
		evidence({ probe: name, event: "probe_error", verdict: probeResults[name].verdict, error: String(err) });
	}
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await new Promise(r => setTimeout(r, 50));
	}
	return predicate();
}

// =============================================================================
// Probe extension source — loaded through the host's REAL extension loader.
// Communicates with this script via globalThis.__ICM_PROBE_BUS__.
// =============================================================================

interface ProbeBus {
	pi?: unknown;
	factoryRuns: number;
	contextMode: "off" | "record" | "transform";
	markers: Record<string, string>;
	contextCalls: Array<{ mode: string; count: number; roles: string[]; snapshotJson: string }>;
	beforeCompactEvents: Array<Record<string, unknown>>;
	compactEvents: Array<Record<string, unknown>>;
	compactResultFactory: ((event: unknown) => unknown) | null;
	handlerErrors: string[];
}

function busRef(): ProbeBus {
	return (globalThis as Record<string, unknown>).__ICM_PROBE_BUS__ as ProbeBus;
}

function resetBus(markers: Record<string, string>): ProbeBus {
	const bus: ProbeBus = {
		pi: undefined,
		factoryRuns: busRef()?.factoryRuns ?? 0,
		contextMode: "off",
		markers,
		contextCalls: [],
		beforeCompactEvents: [],
		compactEvents: [],
		compactResultFactory: null,
		handlerErrors: [],
	};
	(globalThis as Record<string, unknown>).__ICM_PROBE_BUS__ = bus;
	return bus;
}

const EXTENSION_SOURCE = `/**
 * Auto-generated by icm-substrate-probe.ts. A REAL host extension module:
 * imported and bound by the host's own loadExtensions(); handlers run on the
 * host's own ExtensionRunner. Evidence flows through globalThis.__ICM_PROBE_BUS__.
 */
export default function icmProbeExtension(pi) {
	const bus = globalThis.__ICM_PROBE_BUS__;
	if (!bus) throw new Error("icm probe bus missing");
	bus.pi = pi;
	bus.factoryRuns = (bus.factoryRuns ?? 0) + 1;

	pi.on("context", (event) => {
		const b = globalThis.__ICM_PROBE_BUS__;
		try {
			if (b.contextMode === "off") return;
			b.contextCalls.push({
				mode: b.contextMode,
				count: event.messages.length,
				roles: event.messages.map((m) => m.role),
				snapshotJson: JSON.stringify(event.messages),
			});
			if (b.contextMode !== "transform") return;

			// (a) IN-PLACE MUTATION of a received message object that will be KEPT
			// in the returned array — proves journal/agent state are protected by
			// the host's structuredClone, while the returned array is what ships.
			for (const m of event.messages) {
				if (m.role === "assistant" && Array.isArray(m.content)) {
					for (const block of m.content) {
						if (block.type === "text" && typeof block.text === "string" && block.text.includes(b.markers.keepText)) {
							block.text = block.text + " " + b.markers.mutation;
						}
					}
				}
			}

			// (b) TRANSFORMED COPY: drop the seed message, append a synthetic
			// user-context block (cloned from a real user message for shape safety).
			const kept = event.messages.filter(
				(m) => !JSON.stringify(m.content ?? "").includes(b.markers.dropText),
			);
			const lastUser = [...event.messages].reverse().find((m) => m.role === "user");
			if (!lastUser) throw new Error("probe: no user message to clone");
			const synthetic = JSON.parse(JSON.stringify(lastUser));
			synthetic.content = b.markers.synthetic;
			synthetic.timestamp = Date.now();
			kept.push(synthetic);
			return { messages: kept };
		} catch (err) {
			b.handlerErrors.push("context: " + String(err));
			throw err;
		}
	});

	pi.on("session_before_compact", (event) => {
		const b = globalThis.__ICM_PROBE_BUS__;
		try {
			b.beforeCompactEvents.push({
				hostFirstKeptEntryId: event.preparation?.firstKeptEntryId,
				messagesToSummarize: event.preparation?.messagesToSummarize?.length,
				turnPrefixMessages: event.preparation?.turnPrefixMessages?.length,
				isSplitTurn: event.preparation?.isSplitTurn,
				tokensBefore: event.preparation?.tokensBefore,
				branchEntryCount: event.branchEntries?.length,
				branchEntryTypes: event.branchEntries?.map((e) => e.type),
			});
			if (!b.compactResultFactory) return;
			return b.compactResultFactory(event);
		} catch (err) {
			b.handlerErrors.push("session_before_compact: " + String(err));
			throw err;
		}
	});

	pi.on("session_compact", (event) => {
		const b = globalThis.__ICM_PROBE_BUS__;
		b.compactEvents.push({
			fromExtension: event.fromExtension,
			entryId: event.compactionEntry?.id,
			summary: event.compactionEntry?.summary,
			firstKeptEntryId: event.compactionEntry?.firstKeptEntryId,
		});
	});
}
`;

const EXTENSION_FILE = path.join(ISOLATION_ROOT, "icm-probe-extension.ts");
fs.writeFileSync(EXTENSION_FILE, EXTENSION_SOURCE, "utf8");

// =============================================================================
// Host harness (all host imports are dynamic — AFTER PI_CONFIG_DIR is frozen)
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface Harness {
	session: Any;
	sessionManager: Any;
	authStorage: Any;
	mock: Any;
	sessionFile: string;
	runnerErrors: unknown[];
	sideGuard: { called: number };
}

async function main(): Promise<void> {
	// ---- dynamic host imports (order matters: env var already set above) ----
	const { Agent } = await import("@oh-my-pi/pi-agent-core");
	const { createMockModel } = await import("@oh-my-pi/pi-ai/providers/mock");
	const { getBundledModel } = await import("@oh-my-pi/pi-catalog/models");
	const { AgentSession } = await import("@oh-my-pi/pi-coding-agent/session/agent-session");
	const { AuthStorage } = await import("@oh-my-pi/pi-coding-agent/session/auth-storage");
	const { SessionManager } = await import("@oh-my-pi/pi-coding-agent/session/session-manager");
	const { ModelRegistry } = await import("@oh-my-pi/pi-coding-agent/config/model-registry");
	const { Settings } = await import("@oh-my-pi/pi-coding-agent/config/settings");
	const { loadExtensions } = await import("@oh-my-pi/pi-coding-agent/extensibility/extensions/loader");
	const { ExtensionRunner } = await import("@oh-my-pi/pi-coding-agent/extensibility/extensions/runner");
	const { initializeExtensions } = await import("@oh-my-pi/pi-coding-agent/modes/runtime-init");
	const { wrapSteeringForModel, convertToLlm } = await import("@oh-my-pi/pi-coding-agent/session/messages");

	const hostPkg = JSON.parse(
		fs.readFileSync(path.join(process.cwd(), "node_modules/@oh-my-pi/pi-coding-agent/package.json"), "utf8"),
	) as { version: string };
	evidence({
		event: "environment",
		hostVersion: hostPkg.version,
		piConfigDir: process.env.PI_CONFIG_DIR,
		isolationRoot: ISOLATION_ROOT,
		bun: Bun.version,
	});

	async function makeHarness(opts: {
		name: string;
		responses: Any[];
		settingsOverrides?: Record<string, unknown>;
	}): Promise<Harness> {
		const extResult = await loadExtensions([EXTENSION_FILE], WORK_DIR);
		if (extResult.errors.length > 0) {
			throw new Error(`extension load errors: ${JSON.stringify(extResult.errors)}`);
		}
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("bundled anthropic model missing");

		const mock = createMockModel({ responses: opts.responses });
		const sessionFile = path.join(WORK_DIR, `${opts.name}-session.jsonl`);
		const sessionManager = await SessionManager.open(sessionFile, undefined, undefined, { initialCwd: WORK_DIR });
		const authStorage = await AuthStorage.create(path.join(WORK_DIR, `auth-${opts.name}.db`));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(WORK_DIR, `models-${opts.name}.yml`));
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.enabled": false,
			"advisor.enabled": false,
			...(opts.settingsOverrides ?? {}),
		});

		// Real runner over the really-loaded extension (constructor mirrors sdk.ts).
		const runner = new ExtensionRunner(
			extResult.extensions,
			extResult.runtime,
			WORK_DIR,
			sessionManager,
			modelRegistry,
			() => undefined,
			settings,
			undefined,
			() => null,
		);
		const runnerErrors: unknown[] = [];

		// Mirrors sdk.ts createAgentSession transformContext verbatim.
		const transformContext = async (messages: Any[], _signal?: AbortSignal): Promise<Any[]> => {
			const withContext = await runner.emitContext(messages);
			return wrapSteeringForModel(withContext);
		};

		// Hard guard: ANY side-channel LLM request (e.g. a summarizer call that
		// should have been skipped) throws instead of reaching the network.
		const sideGuard = { called: 0 };
		const sideStreamFn = (..._args: unknown[]): never => {
			sideGuard.called += 1;
			throw new Error("PROBE GUARD: unexpected side-channel LLM request (would have been a network call)");
		};

		// The host NEVER uses pi-agent-core's defaultConvertToLlm (which keeps only
		// user/assistant/toolResult and would drop compactionSummary/branchSummary):
		// sdk.ts always wires the coding-agent converter (convertToLlmFinal =
		// filterProviderReplayMessages(convertToLlmWithBlockImages(...)) + optional
		// obfuscation — all layered on session/messages.convertToLlm). The probe
		// mirrors the core converter; the image/refusal/secret layers are inert for
		// a text-only mock conversation.
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: ["ICM substrate probe"],
				tools: [],
				messages: [],
			},
			streamFn: mock.stream,
			transformContext,
			convertToLlm,
		} as Any);

		const session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			toolRegistry: new Map(),
			builtInToolNames: [],
			advisorTools: [],
			extensionRunner: runner,
			transformContext,
			convertToLlm,
			sideStreamFn,
		} as never);

		// The host's own extension-runtime wiring (print/RPC path): binds the
		// REAL appendEntry/sendMessage/... actions and emits session_start.
		await initializeExtensions(session, {
			reportSendError: (action: string, error: Error) => runnerErrors.push({ action, error: String(error) }),
			reportRuntimeError: (err: unknown) => runnerErrors.push(err),
			mode: "print",
		});

		return { session, sessionManager, authStorage, mock, sessionFile, runnerErrors, sideGuard };
	}

	async function teardown(h: Harness | undefined): Promise<void> {
		if (!h) return;
		try {
			await h.session.dispose();
		} catch {
			/* best effort */
		}
		try {
			h.authStorage.close();
		} catch {
			/* best effort */
		}
	}

	function readJournal(file: string): Any[] {
		return fs
			.readFileSync(file, "utf8")
			.split("\n")
			.filter(l => l.trim().length > 0)
			.map(l => JSON.parse(l));
	}

	// ==========================================================================
	// PROBE 1 — appendEntry persistence + invisibility (+ reload survival)
	// ==========================================================================
	await runProbe("probe1_appendEntry", async rec => {
		const CUSTOM_TYPE = "com.omp-qol.icm-probe";
		const MARKER = "E3-PROBE1-MARKER-a41f";
		resetBus({});
		let h: Harness | undefined;
		try {
			h = await makeHarness({
				name: "probe1",
				responses: [
					{ content: [{ type: "text", text: "ack-one PROBE1" }] },
					{ content: [{ type: "text", text: "ack-two PROBE1" }] },
				],
			});
			const bus = busRef();
			rec("extension factory ran and captured a real ExtensionAPI", bus.factoryRuns >= 1 && bus.pi !== undefined, {
				factoryRuns: bus.factoryRuns,
			});
			const pi = bus.pi as Any;
			rec("pi.appendEntry is a function", typeof pi.appendEntry === "function");

			// append → prompt → append → prompt
			pi.appendEntry(CUSTOM_TYPE, { marker: MARKER, n: 1 });
			await h.session.prompt("hello probe one turn one");
			await h.session.waitForIdle();
			pi.appendEntry(CUSTOM_TYPE, { marker: MARKER, n: 2 });
			await h.session.prompt("hello probe one turn two");
			await h.session.waitForIdle();

			await waitFor(() => {
				try {
					return readJournal(h!.sessionFile).filter(e => e.type === "custom" && e.customType === CUSTOM_TYPE).length >= 2;
				} catch {
					return false;
				}
			}, 5000);

			const entries = readJournal(h.sessionFile);
			const custom = entries.filter(e => e.type === "custom" && e.customType === CUSTOM_TYPE);
			rec("journal contains BOTH custom entries (type=custom, customType preserved)", custom.length === 2, {
				count: custom.length,
				entries: custom.map(e => ({ id: e.id, parentId: e.parentId, data: e.data })),
			});
			const [c1, c2] = custom;
			rec(
				"custom entries carry stable id + parentId fields",
				typeof c1.id === "string" &&
					c1.id.length > 0 &&
					typeof c2.id === "string" &&
					c2.id.length > 0 &&
					c1.id !== c2.id &&
					"parentId" in c1 &&
					"parentId" in c2,
				{ c1: { id: c1.id, parentId: c1.parentId }, c2: { id: c2.id, parentId: c2.parentId } },
			);
			rec("second custom entry chains onto the turn-1 tail (parentId non-null)", c2.parentId !== null && c2.parentId !== undefined, {
				parentId: c2.parentId,
			});
			rec("custom entry data round-trips verbatim", c1.data?.marker === MARKER && c1.data?.n === 1 && c2.data?.n === 2, {
				d1: c1.data,
				d2: c2.data,
			});

			// invisibility on the wire
			rec("mock model was called exactly twice (one per turn)", h.mock.calls.length === 2, {
				calls: h.mock.calls.length,
			});
			const allWire = JSON.stringify(h.mock.calls.map((c: Any) => c.context));
			rec(
				"positive control: user prompts DID reach the model",
				allWire.includes("hello probe one turn one") && allWire.includes("hello probe one turn two"),
			);
			rec(
				"custom entry NEVER reached the model (no customType, no marker in any wire context)",
				!allWire.includes(CUSTOM_TYPE) && !allWire.includes(MARKER),
			);

			rec("no extension runtime errors", h.runnerErrors.length === 0, { runnerErrors: h.runnerErrors });

			// reload survival: fresh SessionManager on the same file
			await teardown(h);
			const reloaded = await SessionManager.open(h.sessionFile, undefined, undefined, { initialCwd: WORK_DIR });
			const relCustom = reloaded.getEntries().filter((e: Any) => e.type === "custom" && e.customType === CUSTOM_TYPE);
			rec(
				"reload: custom entries survive with identical ids",
				relCustom.length === 2 && relCustom[0].id === c1.id && relCustom[1].id === c2.id,
				{ ids: relCustom.map((e: Any) => e.id) },
			);
			const projected = reloaded.buildSessionContext();
			const projectedJson = JSON.stringify(projected.messages ?? projected);
			rec(
				"reload: buildSessionContext projection excludes custom entries",
				!projectedJson.includes(MARKER) && !projectedJson.includes(CUSTOM_TYPE),
				{ projectedMessageCount: (projected.messages ?? []).length },
			);
			h = undefined;
		} finally {
			await teardown(h);
		}
	});

	// ==========================================================================
	// PROBE 2 — context hook projection
	// ==========================================================================
	await runProbe("probe2_contextHook", async rec => {
		const DROP = "SEED-DROP-ME-c4f1";
		const KEEP_TEXT = "ack-one-KEEPME";
		const MUTATION = "MUTATED-IN-PLACE-9b2d";
		const SYNTHETIC = "SYNTHETIC-CONTEXT-BLOCK-5e8c";
		const bus = resetBus({ dropText: DROP, keepText: KEEP_TEXT, mutation: MUTATION, synthetic: SYNTHETIC });
		let h: Harness | undefined;
		try {
			h = await makeHarness({
				name: "probe2",
				responses: [
					{ content: [{ type: "text", text: `${KEEP_TEXT} PROBE2` }] },
					{ content: [{ type: "text", text: "ack-two PROBE2" }] },
				],
			});

			bus.contextMode = "record";
			await h.session.prompt(`${DROP} original seed payload`);
			await h.session.waitForIdle();

			bus.contextMode = "transform";
			await h.session.prompt("turn two prompt PROBE2");
			await h.session.waitForIdle();

			rec("context handler fired for both provider calls", bus.contextCalls.length === 2, {
				calls: bus.contextCalls.map(c => ({ mode: c.mode, count: c.count, roles: c.roles })),
			});
			rec("mock model was called exactly twice", h.mock.calls.length === 2, { calls: h.mock.calls.length });

			const wire1 = JSON.stringify(h.mock.calls[0].context);
			rec("baseline (record mode): seed text passed through untransformed to the model", wire1.includes(DROP));

			const received2 = bus.contextCalls[1];
			rec(
				"transform call received the full prior history (seed + ack + new prompt)",
				received2.snapshotJson.includes(DROP) &&
					received2.snapshotJson.includes(`${KEEP_TEXT} PROBE2`) &&
					received2.snapshotJson.includes("turn two prompt PROBE2"),
				{ roles: received2.roles },
			);

			// H4 provenance gap, observed at runtime: the cloned AgentMessage[]
			// carries NO journal identity fields on any message object.
			const receivedMessages = JSON.parse(received2.snapshotJson) as Array<Record<string, unknown>>;
			const provenanceKeys = ["id", "entryId", "parentId"];
			const leakedKeys = receivedMessages.flatMap(m => provenanceKeys.filter(k => k in m));
			rec("context event messages expose NO entry-id provenance fields (id/entryId/parentId)", leakedKeys.length === 0, {
				checkedMessages: receivedMessages.length,
				keysPerMessage: receivedMessages.map(m => Object.keys(m)),
			});

			const wire2 = JSON.stringify(h.mock.calls[1].context);
			rec("model received the TRANSFORMED sequence: synthetic block present", wire2.includes(SYNTHETIC));
			rec("model received the TRANSFORMED sequence: dropped seed absent", !wire2.includes(DROP));
			rec(
				"in-place mutation of the (kept) received object flowed to the wire — handler owned the outbound array",
				wire2.includes(MUTATION),
			);

			// clone semantics: live agent state + journal unpolluted
			const stateJson = JSON.stringify(h.session.agent.state.messages);
			rec(
				"live agent state kept originals: seed present, no mutation, no synthetic",
				stateJson.includes(DROP) && !stateJson.includes(MUTATION) && !stateJson.includes(SYNTHETIC),
			);

			await waitFor(() => {
				try {
					return JSON.stringify(readJournal(h!.sessionFile)).includes("ack-two PROBE2");
				} catch {
					return false;
				}
			}, 5000);
			const journalJson = JSON.stringify(readJournal(h.sessionFile));
			rec(
				"journal on disk unchanged: original seed + original ack present, mutation + synthetic absent",
				journalJson.includes(DROP) &&
					journalJson.includes(`${KEEP_TEXT} PROBE2`) &&
					!journalJson.includes(MUTATION) &&
					!journalJson.includes(SYNTHETIC),
			);
			rec("no extension runtime errors", h.runnerErrors.length === 0 && bus.handlerErrors.length === 0, {
				runnerErrors: h.runnerErrors,
				handlerErrors: bus.handlerErrors,
			});
		} finally {
			bus.contextMode = "off";
			await teardown(h);
		}
	});

	// ==========================================================================
	// PROBE 3 — session_before_compact custom CompactionResult (seal path)
	// ==========================================================================
	await runProbe("probe3_beforeCompact", async rec => {
		const T1 = "TURN-ONE-PAYLOAD-11aa";
		const T2 = "TURN-TWO-PAYLOAD-22bb";
		const T3 = "TURN-THREE-PAYLOAD-44dd";
		const SEAL = "ICM-PROBE-SEALED-SUMMARY-33cc";
		const bus = resetBus({});
		let h: Harness | undefined;
		try {
			h = await makeHarness({
				name: "probe3",
				responses: [
					{ content: [{ type: "text", text: "ack-one PROBE3" }] },
					{ content: [{ type: "text", text: "ack-two PROBE3" }] },
					{ content: [{ type: "text", text: "ack-three PROBE3" }] },
				],
				// keepRecentTokens=1 makes findCutPoint cut immediately below the
				// newest assistant message, so a tiny 2-turn session still yields a
				// non-empty messagesToSummarize (prepareCompaction otherwise no-ops).
				settingsOverrides: { "compaction.keepRecentTokens": 1 },
			});

			await h.session.prompt(`${T1} — first-turn filler so the summarized region has real content in it.`);
			await h.session.waitForIdle();
			await h.session.prompt(`${T2} — second turn, this one must survive as the kept tail.`);
			await h.session.waitForIdle();

			let chosenFirstKept: string | undefined;
			bus.compactResultFactory = (event: Any) => {
				// Choose our OWN firstKeptEntryId: the turn-2 USER entry (valid
				// on-branch id, earlier than the host's proposed cut).
				const t2entry = event.branchEntries.find(
					(e: Any) => e.type === "message" && e.message?.role === "user" && JSON.stringify(e.message.content).includes(T2),
				);
				if (!t2entry) throw new Error("probe: turn-2 user entry not found in branchEntries");
				chosenFirstKept = t2entry.id;
				return {
					compaction: {
						summary: SEAL,
						shortSummary: "icm probe seal",
						firstKeptEntryId: t2entry.id,
						tokensBefore: event.preparation.tokensBefore,
						details: { probe: "icm-e3" },
						preserveData: { icmProbe: "E3" },
					},
				};
			};

			const callsBefore = h.mock.calls.length;
			const result = await h.session.compact();

			rec("session_before_compact hook fired once with host preparation + branchEntries", bus.beforeCompactEvents.length === 1, {
				event: bus.beforeCompactEvents[0],
			});
			rec("hook chose its own firstKeptEntryId (differs from host's proposed cut)", Boolean(chosenFirstKept) && chosenFirstKept !== (bus.beforeCompactEvents[0] as Any)?.hostFirstKeptEntryId, {
				chosen: chosenFirstKept,
				hostProposed: (bus.beforeCompactEvents[0] as Any)?.hostFirstKeptEntryId,
			});
			rec("compact() returned the extension's CompactionResult verbatim", result.summary === SEAL && result.firstKeptEntryId === chosenFirstKept, {
				summary: result.summary,
				firstKeptEntryId: result.firstKeptEntryId,
			});
			rec("host did NOT call the model to summarize (mock call count unchanged)", h.mock.calls.length === callsBefore, {
				before: callsBefore,
				after: h.mock.calls.length,
			});
			rec("side-channel LLM guard never tripped", h.sideGuard.called === 0, { sideGuardCalls: h.sideGuard.called });
			rec(
				"session_compact notification carried fromExtension=true + our summary",
				bus.compactEvents.length === 1 &&
					(bus.compactEvents[0] as Any).fromExtension === true &&
					(bus.compactEvents[0] as Any).summary === SEAL,
				{ event: bus.compactEvents[0] },
			);

			await waitFor(() => {
				try {
					return readJournal(h!.sessionFile).some((e: Any) => e.type === "compaction");
				} catch {
					return false;
				}
			}, 5000);
			const entries = readJournal(h.sessionFile);
			const compactionEntries = entries.filter((e: Any) => e.type === "compaction");
			const ce = compactionEntries[0];
			rec(
				"journal: ONE CompactionEntry appended carrying our summary, fromExtension=true, chosen firstKeptEntryId, preserveData",
				compactionEntries.length === 1 &&
					ce.summary === SEAL &&
					ce.fromExtension === true &&
					ce.firstKeptEntryId === chosenFirstKept &&
					ce.preserveData?.icmProbe === "E3" &&
					typeof ce.id === "string",
				{
					id: ce?.id,
					fromExtension: ce?.fromExtension,
					firstKeptEntryId: ce?.firstKeptEntryId,
					preserveData: ce?.preserveData,
				},
			);
			rec(
				"journal stayed append-only: pre-compaction turn-1 entries still on disk",
				JSON.stringify(entries).includes(T1),
			);

			// next projection starts from firstKeptEntryId
			await h.session.prompt(`${T3} — post-compaction turn.`);
			await h.session.waitForIdle();
			rec("model called exactly once more after compaction", h.mock.calls.length === callsBefore + 1, {
				calls: h.mock.calls.length,
			});
			const wire3 = JSON.stringify(h.mock.calls[callsBefore].context);
			rec("post-compaction wire contains the sealed summary", wire3.includes(SEAL));
			rec("post-compaction wire keeps the tail from chosen firstKeptEntryId (turn-2 present)", wire3.includes(T2));
			rec("post-compaction wire dropped the summarized region (turn-1 absent)", !wire3.includes(T1));

			// Cancel arm of SessionBeforeCompactResult: {cancel:true} must abort the
			// pass with CompactionCancelledError and leave the journal untouched.
			bus.compactResultFactory = () => ({ cancel: true });
			let cancelError: unknown;
			try {
				await h.session.compact();
			} catch (err) {
				cancelError = err;
			}
			rec(
				"cancel arm: {cancel:true} aborts the pass with CompactionCancelledError",
				cancelError instanceof Error && cancelError.constructor.name === "CompactionCancelledError",
				{ errorName: cancelError instanceof Error ? cancelError.constructor.name : String(cancelError) },
			);
			rec("cancel arm: hook fired a second time (preparation was valid)", bus.beforeCompactEvents.length === 2, {
				secondEvent: bus.beforeCompactEvents[1],
			});
			await waitFor(() => {
				try {
					return JSON.stringify(readJournal(h!.sessionFile)).includes("ack-three PROBE3");
				} catch {
					return false;
				}
			}, 5000);
			const entriesAfterCancel = readJournal(h.sessionFile);
			rec(
				"cancel arm: journal unchanged — still exactly ONE compaction entry, no new entries",
				entriesAfterCancel.filter((e: Any) => e.type === "compaction").length === 1 &&
					entriesAfterCancel.length === entries.length + 2, // + turn-3 user/assistant only
				{ entryCount: entriesAfterCancel.length, compactionCount: entriesAfterCancel.filter((e: Any) => e.type === "compaction").length },
			);
			rec("cancel arm: no model call, no side-channel call during cancelled pass", h.mock.calls.length === callsBefore + 1 && h.sideGuard.called === 0, {
				mockCalls: h.mock.calls.length,
				sideGuardCalls: h.sideGuard.called,
			});

			rec("no extension runtime errors", h.runnerErrors.length === 0 && bus.handlerErrors.length === 0, {
				runnerErrors: h.runnerErrors,
				handlerErrors: bus.handlerErrors,
			});
		} finally {
			bus.compactResultFactory = null;
			await teardown(h);
		}
	});

	// ==========================================================================
	// Isolation proof + summary
	// ==========================================================================
	const rootChildren = fs.existsSync(ISOLATION_ROOT) ? fs.readdirSync(ISOLATION_ROOT) : [];
	evidence({ event: "isolation_root_contents", children: rootChildren });

	console.log(
		`PROBE_SUMMARY ${JSON.stringify({
			hostVersion: hostPkg.version,
			results: Object.fromEntries(
				Object.entries(probeResults).map(([k, v]) => [k, { verdict: v.verdict, checks: v.checks.length, failed: v.checks.filter(c => !c.ok).length, error: v.error }]),
			),
		})}`,
	);

	const bad = Object.values(probeResults).some(r => r.verdict !== "PASS");
	process.exitCode = bad ? 1 : 0;
}

try {
	await main();
} finally {
	// Cleanup: delete the isolation root (retry once for Windows file locks).
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.rmSync(ISOLATION_ROOT, { recursive: true, force: true });
			break;
		} catch {
			await new Promise(r => setTimeout(r, 500));
		}
	}
	evidence({ event: "cleanup", isolationRootRemoved: !fs.existsSync(ISOLATION_ROOT), isolationRoot: ISOLATION_ROOT });
}
