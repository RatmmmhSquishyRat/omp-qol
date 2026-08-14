import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type * as Zod from "zod/v4";
import {
	sessionHasAdvisorSurface,
	type HostBridge,
	type HostRootSurface,
	type LiveAdvisorStat,
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
 *
 * enable / disable map only to setAdvisorEnabled — never discover (ADR-005
 * §Decision 3). apply = standalone rediscover + applyAdvisorConfigs.
 */

export const ADVISOR_TOOL_NAME = "advisor";

const BRIDGE_UNAVAILABLE =
	"Advisor ops need the live host session, but none is reachable right now " +
	"(no main agent session registered). The user can still use /advisor directly.";

const ADVISOR_SURFACE_MISSING =
	"The live session does not expose advisor methods. " +
	"Plan/vibe ops remain unaffected. Use /advisor directly.";

const NATIVE_UNAVAILABLE_PREFIX = "Native advisor/config helpers unavailable";

/** The shape every durable-mutation op returns. */
export interface ApplyResult {
	op: "upsert" | "remove" | "set_shared" | "apply";
	persisted: boolean;
	applied: boolean;
	effectiveAt: "immediate";
	source: string;
	verification: {
		enabled: boolean;
		active: boolean;
		activeCount: number;
		advisors: Array<{
			name: string;
			status: string;
			model?: string;
			tools?: string[];
		}>;
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

const err = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const ok = (text: string, details?: object) =>
	details
		? { content: [{ type: "text" as const, text }], details }
		: { content: [{ type: "text" as const, text }] };

/** Track B: every op returns parseable JSON with `op`. Optional one-line summary above. */
function okJson(body: object, summary?: string) {
	const text = summary ? `${summary}\n${JSON.stringify(body, null, 2)}` : JSON.stringify(body, null, 2);
	return ok(text, body);
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

function buildApplyResult(
	op: ApplyResult["op"],
	persisted: boolean,
	applied: boolean,
	source: string,
	activeCount: number,
	session: NonNullable<HostBridge["session"]>,
	warnings: string[],
): ApplyResult {
	const stats = session.getAdvisorStats!();
	const enabled = session.isAdvisorEnabled!();
	const active = session.isAdvisorActive!();
	return {
		op,
		persisted,
		applied,
		effectiveAt: "immediate",
		source,
		verification: {
			enabled,
			active,
			activeCount,
			advisors: stats.advisors.map(a => {
				const entry: ApplyResult["verification"]["advisors"][number] = {
					name: a.name,
					status: a.status,
				};
				const m = modelToString(a.model);
				if (m) entry.model = m;
				if (a.tools?.length) entry.tools = a.tools;
				return entry;
			}),
		},
		warnings,
	};
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
			} catch (e) {
				return null;
			}
		});

	const getCwdOverride = options?.getCwd;

	pi.registerTool({
		name: ADVISOR_TOOL_NAME,
		label: "Advisor",
		description:
			"[qol] Manage WATCHDOG advisors — drives the same native advisor/config helpers and " +
			"AgentSession methods as the /advisor command and configure-Save TUI path. " +
			"Ops: list (show roster), get (one advisor), upsert (create/update), remove (delete), " +
			"set_shared (top-level instructions), apply (rediscover + apply after manual file edits), " +
			"enable/disable (session toggle — not rediscovery), status (live stats), dump (history). " +
			"Mutate ops auto-run save→discover→apply. Advisor is a bypass observer, not a task target.",
		approval: "read",
		loadMode: "essential",
		parameters: z.object({
			op: z
				.enum(["list", "get", "upsert", "remove", "set_shared", "apply", "enable", "disable", "status", "dump"])
				.describe("Advisor operation to perform"),
			name: z
				.string()
				.optional()
				.describe("Advisor name (required for get/upsert/remove)"),
			model: z
				.string()
				.optional()
				.describe("Model selector, e.g. anthropic/claude-sonnet-4-5 or x-ai/grok-code-fast:high"),
			tools: z
				.array(z.string())
				.optional()
				.describe("Built-in tool names to grant this advisor (omit for default read/grep/glob subset)"),
			instructions: z
				.string()
				.optional()
				.describe("Per-advisor specialization instructions"),
			enabled: z
				.boolean()
				.optional()
				.describe("Per-advisor on/off toggle (default true)"),
			shared_instructions: z
				.string()
				.optional()
				.describe("Top-level shared instructions for all advisors (set_shared op; empty string clears)"),
			scope: z
				.enum(["project", "user", "effective"])
				.optional()
				.describe("File scope: project (default for mutate), user (explicit), effective (discover merge, read-only)"),
			raw: z
				.boolean()
				.optional()
				.describe("dump op: when true, emit the full unformatted history (compact=false)"),
		}),

		async execute(_toolCallId, params, signal) {
			if (signal?.aborted) return err("Cancelled");

			const p = params as AdvisorParams;

			// ---- Bridge resolve (plan/vibe gate) ----------------------------
			const bridge = await resolveBridge().catch(() => null);
			if (!bridge) return err(BRIDGE_UNAVAILABLE);
			const s = bridge.session;

			// ---- Advisor surface sanity (independent of plan/vibe) ----------
			const hasAdvisor = sessionHasAdvisorSurface(s);

			// ops that ONLY need the session advisor surface
			const liveOnlyOps: AdvisorOp[] = ["enable", "disable", "status", "dump"];
			// ops that need native helpers + session advisor surface
			const nativeOps: AdvisorOp[] = ["list", "get", "upsert", "remove", "set_shared", "apply"];

			if ([...liveOnlyOps, ...nativeOps].includes(p.op) && !hasAdvisor) {
				return err(ADVISOR_SURFACE_MISSING);
			}

			// ---- Enable / disable (no discover, no native needed) ------------
			if (p.op === "enable" || p.op === "disable") {
				const wantEnabled = p.op === "enable";
				const nowRunning = s.setAdvisorEnabled!(wantEnabled);
				const enabled = s.isAdvisorEnabled!();
				const active = s.isAdvisorActive!();
				return okJson({
					op: p.op,
					enabled,
					active,
					running: nowRunning,
					discovered: false,
				});
			}

			// ---- Status / dump (read-only, no native needed) ----------------
			if (p.op === "status") {
				const text = s.formatAdvisorStatus!();
				const stats = s.getAdvisorStats!();
				return okJson(
					{
						op: "status",
						enabled: s.isAdvisorEnabled!(),
						active: s.isAdvisorActive!(),
						configured: stats.configured,
						advisors: stats.advisors.map(a => ({
							name: a.name,
							status: a.status,
							model: modelToString(a.model),
						})),
					},
					text,
				);
			}

			if (p.op === "dump") {
				const text = s.formatAdvisorHistoryAsText!({ compact: !p.raw });
				const history = text ?? "(no advisor history yet)";
				return okJson({ op: "dump", raw: !!p.raw, empty: !text }, history);
			}

			// ---- All remaining ops need native helpers -----------------------
			const native = await resolveNative();
			if (!native) {
				return err(
					`${NATIVE_UNAVAILABLE_PREFIX}: import("@oh-my-pi/pi-coding-agent/advisor/config") failed. ` +
						"Cannot proceed without native WATCHDOG helpers (ADR-005). Use /advisor directly.",
				);
			}

			if (signal?.aborted) return err("Cancelled");

			// Resolve cwd / projectDir / agentDir (mirrors TUI selector-controller.ts)
			const cwd =
				getCwdOverride?.() ??
				(s.sessionManager as { getCwd?(): string } | undefined)?.getCwd?.() ??
				process.cwd();
			const agentDir = native.nativeGetAgentDir();
			const projectDir = await native.nativeGetProjectDir(cwd);

			// ---- List -------------------------------------------------------
			if (p.op === "list") {
				const scope: AdvisorScope = p.scope ?? "effective";
				if (scope === "effective") {
					const discovered = await native.nativeDiscoverAdvisors(cwd, agentDir);
					return okJson(
						{ op: "list", scope, ...discovered },
						`scope=effective (${discovered.advisors.length} advisor(s) after merge)`,
					);
				}
				const dirs = { projectDir, agentDir };
				const editPath = await native.nativeResolveEditPath(scope, dirs);
				const doc = await native.nativeLoadConfigFile(editPath);
				return okJson(
					{ op: "list", scope, source: editPath, ...doc },
					`scope=${scope} (${doc.advisors.length} advisor(s) in ${editPath})`,
				);
			}

			// ---- Get --------------------------------------------------------
			if (p.op === "get") {
				if (!p.name?.trim()) return err("get requires a non-empty `name`.");
				const scope: AdvisorScope = p.scope ?? "effective";
				let advisors: AdvisorConfig[];
				let source: string;
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
				}
				const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "advisor";
				const found = advisors.find(a => {
					const s = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "advisor";
					return s === slug || a.name === p.name;
				});
				if (!found) return err(`Advisor "${p.name}" not found in ${source}.`);
				return okJson(
					{ op: "get", scope, source, advisor: found },
					`scope=${scope} source=${source}`,
				);
			}

			// ---- Mutate ops: upsert / remove / set_shared / apply -----------
			// Validate scope for mutate ops
			const mutateOps: AdvisorOp[] = ["upsert", "remove", "set_shared"];
			if (mutateOps.includes(p.op)) {
				const scope = p.scope;
				if (scope === "effective") {
					return err(`scope=effective is a read-only view; it cannot be a write target. Use scope=project or scope=user.`);
				}
				if (p.op === "upsert" && !p.name?.trim()) {
					return err("upsert requires a non-empty `name`.");
				}
				if (p.op === "remove" && !p.name?.trim()) {
					return err("remove requires a non-empty `name`.");
				}
				if (p.op === "set_shared" && p.shared_instructions === undefined) {
					return err("set_shared requires `shared_instructions` (use empty string to clear).");
				}
			}

			if (signal?.aborted) return err("Cancelled");

			// ---- Upsert / remove / set_shared (save→discover→apply) ---------
			if (mutateOps.includes(p.op)) {
				const writeScope = (p.scope ?? "project") as "project" | "user";
				const dirs = { projectDir, agentDir };
				const editPath = await native.nativeResolveEditPath(writeScope, dirs);

				// Load raw doc
				const doc = await native.nativeLoadConfigFile(editPath);

				const warnings: string[] = [];

				if (p.op === "upsert") {
					const name = p.name!.trim();
					const slug =
						name
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-+|-+$/g, "") || "advisor";
					const idx = doc.advisors.findIndex(a => {
						const s = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "advisor";
						return s === slug;
					});
					if (idx >= 0) {
						// Update: only overwrite fields that were explicitly provided.
						const existing = doc.advisors[idx];
						doc.advisors[idx] = {
							name,
							model: p.model !== undefined ? (p.model.trim() || undefined) : existing.model,
							tools: p.tools !== undefined ? p.tools : existing.tools,
							instructions:
								p.instructions !== undefined
									? (p.instructions.trim() || undefined)
									: existing.instructions,
							enabled: p.enabled !== undefined ? p.enabled : existing.enabled,
						};
					} else {
						// Insert new entry.
						const entry: AdvisorConfig = { name };
						if (p.model?.trim()) entry.model = p.model.trim();
						if (p.tools !== undefined) entry.tools = p.tools;
						if (p.instructions?.trim()) entry.instructions = p.instructions.trim();
						if (p.enabled !== undefined) entry.enabled = p.enabled;
						doc.advisors.push(entry);
					}
				} else if (p.op === "remove") {
					const name = p.name!.trim();
					const slug =
						name
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-+|-+$/g, "") || "advisor";
					const before = doc.advisors.length;
					doc.advisors = doc.advisors.filter(a => {
						const s = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "advisor";
						return s !== slug && a.name !== name;
					});
					if (doc.advisors.length === before) {
						warnings.push(`Advisor "${name}" not found in ${editPath}; file unchanged.`);
					}
				} else if (p.op === "set_shared") {
					const shared = p.shared_instructions!;
					if (shared.trim()) {
						doc.instructions = shared;
					} else {
						delete doc.instructions;
					}
				}

				if (signal?.aborted) return err("Cancelled");

				// Save (native serializer — no hand-written YAML)
				await native.nativeSaveConfigFile(editPath, doc);

				// Discover (full walk from cwd)
				const discovered = await native.nativeDiscoverAdvisors(cwd, agentDir);

				// Apply to live session
				const activeCount = s.applyAdvisorConfigs!(discovered.advisors, discovered.sharedInstructions);

				// Shadow warnings: advisors we wrote but that don't survive into effective
				if (p.op === "upsert" && p.name) {
					const writtenSlug =
						p.name
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-+|-+$/g, "") || "advisor";
					const inEffective = discovered.advisors.some(a => {
						const s = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "advisor";
						return s === writtenSlug;
					});
					if (!inEffective) {
						warnings.push(
							`shadow: "${p.name}" was written to scope=${writeScope} but is not present in the effective roster ` +
								`(a more-specific scope may be overriding it).`,
						);
					}
				}

				// Disabled warning
				if (!s.isAdvisorEnabled!()) {
					warnings.push(
						`Advisor session flag is off (disabled). File persisted and configs applied (stored for next enable), ` +
							`but activeCount=0. Call advisor enable to start the roster.`,
					);
				}

				const result = buildApplyResult(p.op as ApplyResult["op"], true, true, editPath, activeCount, s, warnings);
				return okJson(result);
			}

			// ---- Apply (standalone rediscover + apply) -----------------------
			if (p.op === "apply") {
				const discovered = await native.nativeDiscoverAdvisors(cwd, agentDir);
				const activeCount = s.applyAdvisorConfigs!(discovered.advisors, discovered.sharedInstructions);
				const warnings: string[] = [];
				if (!s.isAdvisorEnabled!()) {
					warnings.push(
						`Advisor session flag is off. Configs applied (stored), but activeCount=0. ` +
							`Call advisor enable to start the roster.`,
					);
				}
				const result = buildApplyResult("apply", false, true, `cwd=${cwd}`, activeCount, s, warnings);
				return okJson(result);
			}

			return err(`Unknown op: ${String(p.op)}`);
		},
	});
}
