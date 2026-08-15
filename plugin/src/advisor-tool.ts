import * as fs from "node:fs/promises";
import { YAML } from "bun";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type * as Zod from "zod/v4";
import {
	sessionHasAdvisorSurface,
	type HostBridge,
	type HostRootSurface,
	type LiveAdvisorMessageCounts,
	type LiveAdvisorStat,
	type LiveAdvisorTokenTotals,
	resolveHostBridge,
} from "./lib/host-bridge";
import type { AdvisorConfig, WatchdogConfigDoc } from "./lib/advisor-native";

/**
 * QOL-004: agent-facing advisor tool — thin driver only.
 *
 * Drives the same native advisor/config helpers and AgentSession methods
 * that the TUI's /advisor command and configure-Save path use. No advisor
 * behavior is reimplemented here. No YAML serializer. No SessionAdvisors
 * emulation. (ADR-005)
 *
 * Ops:
 *   list | get | upsert | remove | set_shared
 *   apply | enable | disable | status | dump
 *
 * Mutate ops (upsert/remove/set_shared) run the full TUI Save sequence:
 *   load → mutate in-memory → save → discover → applyAdvisorConfigs
 * serialized per target file (concurrent mutates chain, never interleave).
 *
 * enable / disable map only to setAdvisorEnabled — never discover (ADR-005
 * §Decision 3). apply = standalone rediscover + applyAdvisorConfigs.
 *
 * Every op returns one JSON envelope (also mirrored into `details`):
 *   success: { ok: true,  tool: "advisor", op, ...fields, warnings: [] }
 *   failure: { ok: false, tool: "advisor", op, error, action? }
 */

export const ADVISOR_TOOL_NAME = "advisor";

const BRIDGE_UNAVAILABLE =
	"No live main-agent session is reachable from this process, so advisor state " +
	"cannot be read or changed. Retry once a session is active, or ask the user to run /advisor in the TUI.";

const ADVISOR_SURFACE_MISSING =
	"The live session does not expose the advisor method surface " +
	"(applyAdvisorConfigs/getAdvisorStats/...), so advisor ops cannot run here. " +
	"Ask the user to run /advisor in the TUI.";

const NATIVE_UNAVAILABLE_PREFIX = "Native advisor/config helpers unavailable";

/**
 * The host's fallback: with zero configured advisors, SessionAdvisors runs
 * one implicit advisor named "default" on the advisor-role model (host
 * session-advisors.ts #resolveAdvisorRuntimeDescriptors). It lives in no
 * WATCHDOG file; file views here surface it as a synthetic entry.
 */
const IMPLICIT_DEFAULT_NOTE =
	'Zero advisors are configured. While the advisor system is enabled, the host still runs ONE implicit advisor named "default" on the advisor-role model; it exists in no WATCHDOG file. ' +
	"Empty file views list it as a synthetic entry marked implicit:true; op=status shows it live. " +
	'To customize it: upsert name="default" with at least one override (model/tools/instructions/enabled) — a bare upsert with no overrides is normalized away and persists nothing. ' +
	'To pause it: upsert name="default" enabled=false. To restore the implicit one: remove name="default". ' +
	'It runs only when a model resolves for the advisor role; otherwise op=status shows it as "no_model".';

/**
 * Mirror of the TUI configure-Save normalization (host advisor-config.ts
 * #isBareDefaultDoc + its save call): a doc whose only content is a bare
 * "default" entry is persisted as an empty doc, so the host's implicit
 * default advisor stays implicit instead of being shadowed by a no-op entry.
 */
function isBareDefaultDoc(doc: WatchdogConfigDoc): boolean {
	if (doc.advisors.length !== 1 || doc.instructions?.trim()) return false;
	const advisor = doc.advisors[0];
	if (!advisor) return false;
	return (
		advisor.name === "default" &&
		!advisor.model?.trim() &&
		advisor.tools === undefined &&
		!advisor.instructions?.trim() &&
		advisor.enabled !== false
	);
}

/**
 * Anti-clobber guard predicate: the native loader returned a completely empty
 * doc, but the raw on-disk text is non-empty. Saving through the native
 * serializer would then overwrite (or delete) content the parser could not
 * represent. Benign exceptions — raw text the parser GENUINELY reads as an
 * empty config — are allowed through: comments/whitespace-only files (YAML
 * parses them to null) and docs whose only keys are advisors/instructions
 * with empty/absent values. Anything else (unparsable YAML, foreign keys,
 * schema-invalid advisor lists) blocks the mutate.
 */
function rawIsBenignEmptyConfig(raw: string): boolean {
	let parsed: unknown;
	try {
		parsed = YAML.parse(raw);
	} catch {
		return false;
	}
	if (parsed === null || parsed === undefined) return true;
	if (typeof parsed !== "object" || Array.isArray(parsed)) return false;
	const obj = parsed as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (key !== "advisors" && key !== "instructions") return false;
	}
	const advisors = obj.advisors;
	if (!(advisors === undefined || advisors === null || (Array.isArray(advisors) && advisors.length === 0))) {
		return false;
	}
	const instructions = obj.instructions;
	return (
		instructions === undefined ||
		instructions === null ||
		(typeof instructions === "string" && instructions.trim() === "")
	);
}

/** One advisor's stat entry as passed through from the host's PerAdvisorStat. */
export interface AdvisorStatEntry {
	name: string;
	status: string;
	model?: string;
	tokens?: LiveAdvisorTokenTotals;
	cost?: number;
	messages?: LiveAdvisorMessageCounts;
	contextTokens?: number;
	contextWindow?: number;
	sessionId?: string;
}

/** The shape every durable-mutation op returns (inside the JSON envelope). */
export interface ApplyResult {
	op: "upsert" | "remove" | "set_shared" | "apply";
	/** True when the target file was written (or deleted) on disk. */
	persisted: boolean;
	/** True when the save emptied the doc and native semantics removed the file. */
	fileDeleted: boolean;
	/** True when discover + applyAdvisorConfigs ran against the live session. */
	applied: boolean;
	/**
	 * "immediate": runtimes rebuilt now (session flag on).
	 * "stored": configs stored; they take effect at the next op=enable.
	 * "none": nothing changed (e.g. remove found no matching entry).
	 */
	effectiveAt: "immediate" | "stored" | "none";
	source: string;
	/** remove only: number of entries deleted (slug duplicates count individually). */
	removed?: number;
	verification: {
		enabled: boolean;
		active: boolean;
		activeCount: number;
		advisors: AdvisorStatEntry[];
	};
	warnings: string[];
}

export interface AdvisorToolOptions {
	/** Test seam: override host-bridge resolution. */
	resolveBridge?: () => Promise<HostBridge | null>;
	/**
	 * Test seam: override the native helper bundle.
	 * When provided, the dynamic import of advisor-native is skipped.
	 */
	resolveNative?: () => Promise<NativeHelpers | null>;
	/**
	 * Test seam: override cwd resolution.
	 * In production, cwd is read from the session's sessionManager.getCwd()
	 * or falls back to process.cwd().
	 */
	getCwd?: () => string;
}

/** The shape the advisor-native module exports (used as a test seam). */
export interface NativeHelpers {
	nativeDiscoverAdvisors(
		cwd: string,
		agentDir: string,
	): Promise<{ advisors: AdvisorConfig[]; sharedInstructions: string | undefined }>;
	nativeLoadConfigFile(filePath: string): Promise<WatchdogConfigDoc>;
	nativeSaveConfigFile(filePath: string, doc: WatchdogConfigDoc): Promise<void>;
	nativeResolveEditPath(scope: "project" | "user", dirs: { projectDir: string; agentDir: string }): Promise<string>;
	nativeGetAgentDir(): string;
	nativeGetProjectDir(cwd: string): Promise<string>;
	nativeSlugifyAdvisorName(name: string): string;
	nativeNormalizeToolNames(names: Iterable<string>): string[];
	nativeBuiltinToolNames(): readonly string[];
}

type AdvisorOp =
	| "list"
	| "get"
	| "upsert"
	| "remove"
	| "set_shared"
	| "apply"
	| "enable"
	| "disable"
	| "status"
	| "dump";

type AdvisorScope = "project" | "user" | "effective";

interface AdvisorParams {
	op: AdvisorOp;
	name?: string;
	model?: string;
	tools?: string[];
	instructions?: string;
	enabled?: boolean;
	shared_instructions?: string;
	scope?: AdvisorScope;
	raw?: boolean;
}

/** Ops that only read state; everything else mutates files or runtime. */
const READ_OPS: ReadonlySet<string> = new Set(["list", "get", "status", "dump"]);

/** Failure envelope: { ok:false, tool, op, error, action? } as JSON text + details. */
function fail(op: string, error: string, action?: string) {
	const body: Record<string, unknown> = { ok: false, tool: ADVISOR_TOOL_NAME, op, error };
	if (action) body.action = action;
	return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], details: body, isError: true };
}

/** Success envelope: { ok:true, tool, op, ...fields } as JSON text + details. */
function succeed(op: string, fields: Record<string, unknown>, summary?: string) {
	const body: Record<string, unknown> = { ok: true, tool: ADVISOR_TOOL_NAME, op, ...fields };
	if (!("warnings" in body)) body.warnings = [];
	const json = JSON.stringify(body, null, 2);
	return { content: [{ type: "text" as const, text: summary ? `${summary}\n${json}` : json }], details: body };
}

function modelToString(model: LiveAdvisorStat["model"]): string | undefined {
	if (!model) return undefined;
	if (typeof model === "string") return model;
	if (typeof model === "object" && model !== null) {
		const m = model as { provider?: string; id?: string };
		if (m.provider && m.id) return `${m.provider}/${m.id}`;
		if (m.id) return String(m.id);
	}
	return undefined;
}

/** Pass one host PerAdvisorStat through, converting the Model object to "provider/id". */
function statEntry(a: LiveAdvisorStat): AdvisorStatEntry {
	const entry: AdvisorStatEntry = { name: a.name, status: a.status };
	const model = modelToString(a.model);
	if (model) entry.model = model;
	if (a.tokens) entry.tokens = a.tokens;
	if (a.cost !== undefined) entry.cost = a.cost;
	if (a.messages) entry.messages = a.messages;
	if (a.contextTokens !== undefined) entry.contextTokens = a.contextTokens;
	if (a.contextWindow !== undefined) entry.contextWindow = a.contextWindow;
	if (a.sessionId) entry.sessionId = a.sessionId;
	return entry;
}

/**
 * Count of advisors with a live runtime. The host's per-advisor statuses can
 * go stale after disable (stopping runtimes does not rewrite the status map),
 * so a "running" count is only meaningful while isAdvisorActive() is true.
 */
function countRunning(advisors: LiveAdvisorStat[], active: boolean): number {
	if (!active) return 0;
	return advisors.filter(a => a.status === "running").length;
}

function buildApplyResult(
	op: ApplyResult["op"],
	flags: { persisted: boolean; fileDeleted: boolean; applied: boolean; effectiveAt: ApplyResult["effectiveAt"]; removed?: number },
	source: string,
	activeCount: number,
	session: NonNullable<HostBridge["session"]>,
	warnings: string[],
): ApplyResult {
	const stats = session.getAdvisorStats!();
	const enabled = session.isAdvisorEnabled!();
	const active = session.isAdvisorActive!();
	const result: ApplyResult = {
		op,
		persisted: flags.persisted,
		fileDeleted: flags.fileDeleted,
		applied: flags.applied,
		effectiveAt: flags.effectiveAt,
		source,
		verification: {
			enabled,
			active,
			activeCount,
			advisors: stats.advisors.map(statEntry),
		},
		warnings,
	};
	if (flags.removed !== undefined) result.removed = flags.removed;
	return result;
}

/**
 * Per-path serialization of mutate ops: concurrent upsert/remove/set_shared
 * against the same file chain instead of interleaving their load→save windows
 * (a lost-update would silently drop one writer's entry). Keyed by edit path;
 * module-level so every registration shares one chain per file.
 */
const mutateChains = new Map<string, Promise<unknown>>();

function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const tail = mutateChains.get(key) ?? Promise.resolve();
	const run = tail.then(fn);
	const settled = run.then(
		() => undefined,
		() => undefined,
	);
	mutateChains.set(key, settled);
	void settled.then(() => {
		if (mutateChains.get(key) === settled) mutateChains.delete(key);
	});
	return run;
}

export function registerAdvisorTool(pi: ExtensionAPI, options?: AdvisorToolOptions): void {
	const z = (((pi as unknown as { pi?: { zod?: unknown } }).pi?.zod ?? pi.zod) as typeof Zod);
	const injectedRoot = ((pi as unknown as { pi?: HostRootSurface }).pi ?? null) as HostRootSurface | null;
	const resolveBridge = options?.resolveBridge ?? (() => resolveHostBridge(injectedRoot));

	const resolveNative: () => Promise<NativeHelpers | null> =
		options?.resolveNative ??
		(async () => {
			try {
				return (await import("./lib/advisor-native")) as NativeHelpers;
			} catch {
				return null;
			}
		});

	const getCwdOverride = options?.getCwd;

	pi.registerTool({
		name: ADVISOR_TOOL_NAME,
		label: "Advisor",
		description:
			"[qol] Manage the host's WATCHDOG advisors: background models that watch every primary turn and inject <advisory> notes (they bill tokens while running). " +
			"Read ops — list: roster (scope=effective shows the merged view the host actually uses; project/user show one file raw). get: one advisor by name (matching is slug-based, case/punctuation-insensitive). " +
			"status: live per-advisor evidence (status/model/tokens/cost/messages/context/sessionId). dump: the advisor conversation history as JSON. " +
			"Write ops — upsert/remove/set_shared: edit a WATCHDOG.yml, then auto-run discover+apply, which REBUILDS all advisor runtimes (in-flight advisor turns abort and re-sync next primary turn). " +
			"apply: rediscover+apply after manual file edits. enable/disable: session on/off switch; enable does NOT re-read files. " +
			"Writes default to scope=project (repo WATCHDOG.yml); scope=user is the global file, shared across projects. " +
			"Granting tools like bash/write/edit gives that advisor unattended mutation power — grant deliberately. " +
			"With zero configured advisors the host runs one implicit 'default' advisor on the advisor-role model: op=status shows it live; empty file views list it as a synthetic implicit:true entry.",
		approval: (args: unknown) => {
			const op = (args as { op?: unknown } | null | undefined)?.op;
			return typeof op === "string" && READ_OPS.has(op) ? "read" : "write";
		},
		loadMode: "essential",
		parameters: z.object({
			op: z
				.enum(["list", "get", "upsert", "remove", "set_shared", "apply", "enable", "disable", "status", "dump"])
				.describe(
					"list/get/status/dump read; upsert/remove/set_shared write a file then rediscover+apply; " +
						"apply rediscovers after manual edits; enable/disable toggle the session flag only",
				),
			name: z
				.string()
				.optional()
				.describe(
					'Advisor name; required for get/upsert/remove. Matching is slug-based: "My Bot" and "my-bot" are the same advisor',
				),
			model: z
				.string()
				.optional()
				.describe(
					'Model selector with optional :thinking suffix, e.g. "anthropic/claude-sonnet-4-5" or "x-ai/grok-code-fast:high". ' +
						'Must resolve against the host\'s available models, or the advisor sits at status "no_model"',
				),
			tools: z
				.array(z.string())
				.optional()
				.describe(
					"Built-in tool names for this advisor. Omit = default read/grep/glob subset. Empty [] = NO tools. " +
						"Unknown names are dropped at discovery; if none survive, the advisor falls back to the default subset",
				),
			instructions: z
				.string()
				.optional()
				.describe("Per-advisor specialization, appended after the shared instructions"),
			enabled: z
				.boolean()
				.optional()
				.describe('Per-advisor toggle (default true). false keeps the entry in the file but builds no runtime ("disabled")'),
			shared_instructions: z
				.string()
				.optional()
				.describe(
					"set_shared only: this file's top-level instructions block, prepended for ALL advisors " +
						"(user- and project-file blocks concatenate). Empty string clears the block",
				),
			scope: z
				.enum(["project", "user", "effective"])
				.optional()
				.describe(
					"File scope. Reads default to effective (the merged roster the host uses); writes default to project " +
						"(repo WATCHDOG.yml). user = global file, affects every project. effective is read-only",
				),
			raw: z
				.boolean()
				.optional()
				.describe("dump only: true returns the full uncompacted history (can be very large)"),
		}),

		async execute(_toolCallId, params, signal) {
			const p = params as AdvisorParams;
			const opName = String(p.op);

			if (signal?.aborted) return fail(opName, "Cancelled: the tool call was aborted before it ran.");

			// ---- Bridge resolve (live session gate) --------------------------
			const bridge = await resolveBridge().catch(() => null);
			if (!bridge) return fail(opName, BRIDGE_UNAVAILABLE);
			const s = bridge.session;

			// ---- Advisor surface sanity (independent of plan/vibe) ----------
			if (!sessionHasAdvisorSurface(s)) return fail(opName, ADVISOR_SURFACE_MISSING);

			// ---- Enable / disable (no discover, no native needed) ------------
			if (p.op === "enable" || p.op === "disable") {
				const wantEnabled = p.op === "enable";
				const nowRunning = s.setAdvisorEnabled!(wantEnabled);
				const enabled = s.isAdvisorEnabled!();
				const active = s.isAdvisorActive!();
				if (p.op === "disable") {
					return succeed(
						"disable",
						{ enabled, active, running: nowRunning, discovered: false },
						"advisor session flag OFF — all advisor runtimes stopped",
					);
				}
				// enable: roster summary + no_model guidance (statuses were just rebuilt).
				const stats = s.getAdvisorStats!();
				const activeCount = countRunning(stats.advisors, active);
				const roster = stats.advisors.map(a => {
					const entry: { name: string; status: string; model?: string } = { name: a.name, status: a.status };
					const model = modelToString(a.model);
					if (model) entry.model = model;
					return entry;
				});
				const warnings: string[] = [];
				const noModel = stats.advisors.filter(a => a.status === "no_model").map(a => a.name);
				if (noModel.length > 0) {
					warnings.push(
						`no_model: ${noModel.join(", ")} — no model resolved (bad selector, or no advisor-role model configured). ` +
							"These advisors stay listed but never run. Fix their model field or configure an advisor-role model.",
					);
				}
				if (!nowRunning) {
					warnings.push(
						"enable turned the session flag ON, but no advisor runtime started. " +
							(roster.length === 0
								? "The roster is empty and even the implicit default advisor needs a resolvable advisor-role model."
								: 'Check the roster in this result: entries at "no_model" need a valid model; entries at "disabled" have enabled=false.'),
					);
				}
				return succeed(
					"enable",
					{ enabled, active, running: nowRunning, discovered: false, activeCount, advisors: roster, warnings },
					`advisor session flag ON — ${activeCount} runtime(s) running`,
				);
			}

			// ---- Status / dump (read-only, no native needed) ----------------
			if (p.op === "status") {
				const statusLine = s.formatAdvisorStatus!();
				const stats = s.getAdvisorStats!();
				const active = s.isAdvisorActive!();
				return succeed(
					"status",
					{
						enabled: s.isAdvisorEnabled!(),
						active,
						activeCount: countRunning(stats.advisors, active),
						advisors: stats.advisors.map(statEntry),
						statusLine,
					},
					statusLine,
				);
			}

			if (p.op === "dump") {
				const text = s.formatAdvisorHistoryAsText!({ compact: !p.raw });
				return succeed("dump", {
					raw: !!p.raw,
					empty: !text,
					history: text ?? "(no advisor history yet)",
				});
			}

			// ---- All remaining ops need native helpers -----------------------
			const native = await resolveNative();
			if (!native) {
				return fail(
					opName,
					`${NATIVE_UNAVAILABLE_PREFIX}: import("@oh-my-pi/pi-coding-agent/advisor/config") failed, ` +
						"and the tool never falls back to a hand-written YAML writer (ADR-005).",
					"Ask the user to run /advisor in the TUI.",
				);
			}

			if (signal?.aborted) return fail(opName, "Cancelled: the tool call was aborted before it ran.");

			// Resolve cwd / projectDir / agentDir (mirrors TUI selector-controller.ts)
			const cwd =
				getCwdOverride?.() ??
				(s.sessionManager as { getCwd?(): string } | undefined)?.getCwd?.() ??
				process.cwd();
			const agentDir = native.nativeGetAgentDir();
			const projectDir = await native.nativeGetProjectDir(cwd);

			const slugOf = (name: string) => native.nativeSlugifyAdvisorName(name);

			/** Warn once per slug that appears on multiple entries in one file. */
			const duplicateSlugWarnings = (advisors: AdvisorConfig[], sourcePath: string): string[] => {
				const bySlug = new Map<string, string[]>();
				for (const a of advisors) {
					const slug = slugOf(a.name);
					const names = bySlug.get(slug) ?? [];
					names.push(a.name);
					bySlug.set(slug, names);
				}
				const warnings: string[] = [];
				for (const [slug, names] of bySlug) {
					if (names.length > 1) {
						warnings.push(
							`duplicate slug "${slug}" in ${sourcePath}: entries ${names.map(n => `"${n}"`).join(", ")} all normalize to it. ` +
								"The host keeps only the LAST one at discovery (last-wins); the earlier ones are dead weight.",
						);
					}
				}
				return warnings;
			};

			// ---- List -------------------------------------------------------
			if (p.op === "list") {
				const scope: AdvisorScope = p.scope ?? "effective";
				if (scope === "effective") {
					const discovered = await native.nativeDiscoverAdvisors(cwd, agentDir);
					const body: Record<string, unknown> = { scope, advisors: discovered.advisors };
					if (discovered.sharedInstructions !== undefined) body.sharedInstructions = discovered.sharedInstructions;
					let summary = `scope=effective (${discovered.advisors.length} advisor(s) after merge)`;
					if (discovered.advisors.length === 0) {
						body.advisors = [{ name: "default", implicit: true }];
						body.implicitDefault = true;
						body.note = IMPLICIT_DEFAULT_NOTE;
						summary += ` — the host runs the implicit "default" advisor while enabled`;
					}
					return succeed("list", body, summary);
				}
				const dirs = { projectDir, agentDir };
				const editPath = await native.nativeResolveEditPath(scope, dirs);
				const doc = await native.nativeLoadConfigFile(editPath);
				const body: Record<string, unknown> = { scope, source: editPath, advisors: doc.advisors };
				if (doc.instructions !== undefined) body.instructions = doc.instructions;
				const warnings = duplicateSlugWarnings(doc.advisors, editPath);
				if (warnings.length > 0) body.warnings = warnings;
				return succeed("list", body, `scope=${scope} (${doc.advisors.length} advisor(s) in ${editPath})`);
			}

			// ---- Get --------------------------------------------------------
			if (p.op === "get") {
				if (!p.name?.trim()) return fail("get", "get requires a non-empty `name`.");
				const scope: AdvisorScope = p.scope ?? "effective";
				let advisors: AdvisorConfig[];
				let source: string;
				let fileWarnings: string[] = [];
				if (scope === "effective") {
					const discovered = await native.nativeDiscoverAdvisors(cwd, agentDir);
					advisors = discovered.advisors;
					source = "effective (merged)";
				} else {
					const dirs = { projectDir, agentDir };
					const editPath = await native.nativeResolveEditPath(scope, dirs);
					const doc = await native.nativeLoadConfigFile(editPath);
					advisors = doc.advisors;
					source = editPath;
					fileWarnings = duplicateSlugWarnings(doc.advisors, editPath);
				}
				const slug = slugOf(p.name);
				// Host discovery is last-wins per slug, so "the" entry is the LAST match.
				const matches = advisors.filter(a => slugOf(a.name) === slug || a.name === p.name);
				const found = matches.length > 0 ? matches[matches.length - 1] : undefined;
				if (!found) {
					if (scope === "effective" && advisors.length === 0 && slug === "default") {
						return succeed(
							"get",
							{ scope, source, advisor: { name: "default", implicit: true }, implicitDefault: true, note: IMPLICIT_DEFAULT_NOTE },
							"implicit default advisor (no WATCHDOG entry exists)",
						);
					}
					const hint =
						scope === "effective" && advisors.length === 0
							? IMPLICIT_DEFAULT_NOTE
							: `Known names in ${source}: ${advisors.map(a => `"${a.name}"`).join(", ") || "(none)"}.`;
					return fail("get", `No advisor matching "${p.name}" (slug "${slug}") in ${source}.`, hint);
				}
				const warnings = [...fileWarnings];
				if (matches.length > 1) {
					warnings.push(
						`"${p.name}" matches ${matches.length} entries in ${source}; returning the LAST one (host last-wins semantics).`,
					);
				}
				const body: Record<string, unknown> = { scope, source, advisor: found };
				if (warnings.length > 0) body.warnings = warnings;
				return succeed("get", body, `scope=${scope} source=${source}`);
			}

			// ---- Mutate ops: upsert / remove / set_shared --------------------
			const mutateOps: AdvisorOp[] = ["upsert", "remove", "set_shared"];
			if (mutateOps.includes(p.op)) {
				if (p.scope === "effective") {
					return fail(
						p.op,
						"scope=effective is the merged read-only view; it cannot be a write target.",
						"Retry with scope=project (repo WATCHDOG.yml, the default) or scope=user (global file).",
					);
				}
				if (p.op === "upsert" && !p.name?.trim()) return fail("upsert", "upsert requires a non-empty `name`.");
				if (p.op === "remove" && !p.name?.trim()) return fail("remove", "remove requires a non-empty `name`.");
				if (p.op === "set_shared" && p.shared_instructions === undefined) {
					return fail("set_shared", "set_shared requires `shared_instructions` (use an empty string to clear).");
				}

				const writeScope = (p.scope ?? "project") as "project" | "user";
				const dirs = { projectDir, agentDir };
				const editPath = await native.nativeResolveEditPath(writeScope, dirs);

				// Serialize the whole load→save→discover→apply window per file.
				return withPathLock(editPath, async () => {
					if (signal?.aborted) return fail(p.op, "Cancelled: the tool call was aborted before it ran.");

					const doc = await native.nativeLoadConfigFile(editPath);

					// ---- Anti-clobber guard -----------------------------------
					// The native loader maps missing/unparsable/schema-invalid files
					// all to the same empty doc. Refuse to write when the parse came
					// back empty but the file on disk holds real content.
					if (doc.advisors.length === 0 && !doc.instructions?.trim()) {
						let rawText: string | null = null;
						try {
							rawText = await fs.readFile(editPath, "utf8");
						} catch {
							rawText = null;
						}
						if (rawText !== null && rawText.trim() !== "" && !rawIsBenignEmptyConfig(rawText)) {
							return fail(
								p.op,
								`blocked: ${editPath} is non-empty on disk, but the native parser reads it as an empty config ` +
									"(unparsable YAML, or content outside the advisors/instructions schema). " +
									"Writing now would silently overwrite or delete that content.",
								`Fix or back up ${editPath} by hand, then retry. op=list scope=${writeScope} shows what the parser sees.`,
							);
						}
					}

					const warnings: string[] = [];
					let removedCount: number | undefined;

					if (p.op === "upsert") {
						const name = p.name!.trim();
						const slug = slugOf(name);
						if (!/[a-z0-9]/i.test(name)) {
							warnings.push(
								`slug fallback: "${name}" contains no ASCII letters or digits, so its slug is the generic "advisor" — ` +
									"every such name collides on that one slug. Prefer a name with at least one ASCII letter or digit.",
							);
						}
						const matchIndexes = doc.advisors
							.map((a, i) => (slugOf(a.name) === slug ? i : -1))
							.filter(i => i >= 0);
						if (matchIndexes.length > 1) {
							warnings.push(
								`duplicate slug "${slug}": ${editPath} holds ${matchIndexes.length} matching entries; ` +
									"updated the LAST one (the only one the host uses — last-wins). The earlier duplicates remain dead weight; remove deletes them all.",
							);
						}
						const idx = matchIndexes.length > 0 ? matchIndexes[matchIndexes.length - 1]! : -1;
						if (idx >= 0) {
							// Update: only overwrite fields that were explicitly provided.
							const existing = doc.advisors[idx]!;
							if (existing.name !== name) {
								warnings.push(
									`slug match: existing entry "${existing.name}" normalizes to the same slug "${slug}" as "${name}"; ` +
										`that entry was updated and renamed to "${name}".`,
								);
							}
							doc.advisors[idx] = {
								name,
								model: p.model !== undefined ? p.model.trim() || undefined : existing.model,
								tools: p.tools !== undefined ? p.tools : existing.tools,
								instructions: p.instructions !== undefined ? p.instructions.trim() || undefined : existing.instructions,
								enabled: p.enabled !== undefined ? p.enabled : existing.enabled,
							};
						} else {
							const entry: AdvisorConfig = { name };
							if (p.model?.trim()) entry.model = p.model.trim();
							if (p.tools !== undefined) entry.tools = p.tools;
							if (p.instructions?.trim()) entry.instructions = p.instructions.trim();
							if (p.enabled !== undefined) entry.enabled = p.enabled;
							doc.advisors.push(entry);
						}
						// Unknown-tool warning per probed host semantics (filterAdvisorTools):
						// unknowns are dropped at discovery; if NONE survive, tools becomes
						// undefined = the default subset — NOT "no tools".
						if (p.tools && p.tools.length > 0) {
							const known = new Set(native.nativeBuiltinToolNames());
							const normalized = native.nativeNormalizeToolNames(p.tools);
							const unknown = normalized.filter(t => !known.has(t));
							if (unknown.length > 0 && unknown.length === normalized.length) {
								warnings.push(
									`unknown tools: ${unknown.map(t => `"${t}"`).join(", ")} — none is a known built-in, so discovery drops them ALL ` +
										"and this advisor falls back to the DEFAULT read/grep/glob subset. " +
										'(An all-unknown list does NOT mean "no tools"; pass tools=[] for that.)',
								);
							} else if (unknown.length > 0) {
								warnings.push(
									`unknown tools dropped at discovery: ${unknown.map(t => `"${t}"`).join(", ")}. ` +
										`This advisor keeps: ${normalized.filter(t => known.has(t)).join(", ")}.`,
								);
							}
						}
					} else if (p.op === "remove") {
						const name = p.name!.trim();
						const slug = slugOf(name);
						const before = doc.advisors.length;
						doc.advisors = doc.advisors.filter(a => slugOf(a.name) !== slug && a.name !== name);
						removedCount = before - doc.advisors.length;
						if (removedCount === 0) {
							// Nothing matched: no save, no discover, no apply — report honestly.
							const result = buildApplyResult(
								"remove",
								{ persisted: false, fileDeleted: false, applied: false, effectiveAt: "none", removed: 0 },
								editPath,
								countRunning(s.getAdvisorStats!().advisors, s.isAdvisorActive!()),
								s,
								[
									`no entry matching "${name}" (slug "${slug}") exists in ${editPath}; the file was left untouched.`,
								],
							);
							return succeed("remove", result as unknown as Record<string, unknown>, `no match in ${editPath} — nothing removed`);
						}
						if (removedCount > 1) {
							warnings.push(
								`removed ${removedCount} entries sharing slug "${slug}" — duplicates the host would have collapsed to the last one anyway.`,
							);
						}
					} else if (p.op === "set_shared") {
						const shared = p.shared_instructions!;
						if (shared.trim()) {
							doc.instructions = shared;
						} else {
							delete doc.instructions;
						}
					}

					if (signal?.aborted) return fail(p.op, "Cancelled: the tool call was aborted before saving; the file was not written.");

					// Mirror TUI configure-Save: a doc reduced to one bare "default"
					// entry is saved as an empty doc — the implicit default advisor
					// already covers it, so no file entry is persisted.
					const bareDefault = isBareDefaultDoc(doc);
					const finalDoc: WatchdogConfigDoc = bareDefault ? { advisors: [] } : doc;
					// Native semantics: saving an empty doc DELETES the file — or no-ops
					// when the file never existed. persisted/fileDeleted must report what
					// actually happens on disk, so check existence before the save.
					const savesEmpty = finalDoc.advisors.length === 0 && !finalDoc.instructions?.trim();
					const fileExistedBefore = await fs.access(editPath).then(
						() => true,
						() => false,
					);
					const fileDeleted = savesEmpty && fileExistedBefore;
					const persisted = savesEmpty ? fileDeleted : true;
					if (bareDefault) {
						warnings.push(
							'normalized: a bare "default" entry (no overrides) is not persisted — mirrors the TUI configure-Save; ' +
								"the implicit default advisor already covers it. " +
								(fileDeleted
									? `${editPath} was deleted (native semantics: an empty doc removes the file).`
									: `${editPath} does not exist, so nothing was written.`),
						);
					} else if (fileDeleted) {
						warnings.push(
							`${editPath} became empty and was deleted (native semantics: an empty doc removes the file). ` +
								"Discovery now falls back to other scopes, or to the implicit default advisor if none remain.",
						);
					}

					// Save (native serializer — no hand-written YAML)
					await native.nativeSaveConfigFile(editPath, finalDoc);

					// Snapshot the pre-apply runtime so the restart warning is truthful.
					const wasActive = s.isAdvisorActive!();
					const runningBefore = countRunning(s.getAdvisorStats!().advisors, wasActive);

					// Discover (full walk from cwd)
					const discovered = await native.nativeDiscoverAdvisors(cwd, agentDir);

					// Apply to live session
					const activeCount = s.applyAdvisorConfigs!(discovered.advisors, discovered.sharedInstructions);

					if (wasActive) {
						warnings.push(
							`applied: this ${p.op} rebuilt ALL advisor runtimes (${runningBefore} running before, ${activeCount} now). ` +
								"Any in-flight advisor turn was aborted; advisors re-sync on the next primary turn.",
						);
					}

					// Post-apply roster warnings: no_model entries never run.
					const statsAfter = s.getAdvisorStats!();
					const noModel = statsAfter.advisors.filter(a => a.status === "no_model").map(a => a.name);
					if (noModel.length > 0) {
						warnings.push(
							`no_model: ${noModel.join(", ")} — no model resolved (bad selector, or no advisor-role model configured). ` +
								"These advisors stay in the roster but never run. Fix their model field or configure an advisor-role model.",
						);
					}

					// Shadow warnings: the entry we wrote does not survive into effective.
					if (p.op === "upsert" && p.name && !bareDefault) {
						const writtenSlug = slugOf(p.name);
						const inEffective = discovered.advisors.some(a => slugOf(a.name) === writtenSlug);
						if (!inEffective) {
							warnings.push(
								`shadow: "${p.name}" was written to scope=${writeScope} but is absent from the effective roster — ` +
									"a more-specific WATCHDOG file overrides that slug, so this entry is inert until that file changes.",
							);
						} else if (writeScope === "user") {
							// user-scope entries lose to any project entry with the same slug;
							// slug presence in effective alone cannot tell whose entry won.
							const projectPath = await native.nativeResolveEditPath("project", dirs);
							const projectDoc = await native.nativeLoadConfigFile(projectPath);
							if (projectDoc.advisors.some(a => slugOf(a.name) === writtenSlug)) {
								warnings.push(
									`shadow: the project file ${projectPath} also defines slug "${writtenSlug}", and project entries win at discovery — ` +
										"the user-scope entry you just wrote is inert in this project.",
								);
							}
						}
					}

					// Session flag off: configs are stored, nothing starts now.
					const enabledNow = s.isAdvisorEnabled!();
					if (!enabledNow) {
						warnings.push(
							"stored: the advisor session flag is OFF, so no runtime starts now (activeCount=0). " +
								(persisted ? "The file change persisted and the configs are stored; " : "The configs are stored; ") +
								"op=enable starts the roster.",
						);
					}

					const result = buildApplyResult(
						p.op as ApplyResult["op"],
						{
							persisted,
							fileDeleted,
							applied: true,
							effectiveAt: enabledNow ? "immediate" : "stored",
							removed: removedCount,
						},
						editPath,
						activeCount,
						s,
						warnings,
					);
					return succeed(p.op, result as unknown as Record<string, unknown>);
				});
			}

			// ---- Apply (standalone rediscover + apply) -----------------------
			if (p.op === "apply") {
				const wasActive = s.isAdvisorActive!();
				const runningBefore = countRunning(s.getAdvisorStats!().advisors, wasActive);
				const discovered = await native.nativeDiscoverAdvisors(cwd, agentDir);
				const activeCount = s.applyAdvisorConfigs!(discovered.advisors, discovered.sharedInstructions);
				const warnings: string[] = [];
				if (wasActive) {
					warnings.push(
						`applied: rediscovery rebuilt ALL advisor runtimes (${runningBefore} running before, ${activeCount} now). ` +
							"Any in-flight advisor turn was aborted; advisors re-sync on the next primary turn.",
					);
				}
				const statsAfter = s.getAdvisorStats!();
				const noModel = statsAfter.advisors.filter(a => a.status === "no_model").map(a => a.name);
				if (noModel.length > 0) {
					warnings.push(
						`no_model: ${noModel.join(", ")} — no model resolved (bad selector, or no advisor-role model configured). ` +
							"These advisors stay in the roster but never run. Fix their model field or configure an advisor-role model.",
					);
				}
				const enabledNow = s.isAdvisorEnabled!();
				if (!enabledNow) {
					warnings.push(
						"stored: the advisor session flag is OFF, so no runtime starts now (activeCount=0). " +
							"The configs are stored; op=enable starts the roster.",
					);
				}
				const result = buildApplyResult(
					"apply",
					{ persisted: false, fileDeleted: false, applied: true, effectiveAt: enabledNow ? "immediate" : "stored" },
					`cwd=${cwd}`,
					activeCount,
					s,
					warnings,
				);
				return succeed("apply", result as unknown as Record<string, unknown>);
			}

			return fail(opName, `Unknown op: ${opName}`);
		},
	});
}
