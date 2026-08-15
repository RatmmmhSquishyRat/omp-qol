import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type * as Zod from "zod/v4";
import { buildVibeParentSession, type HostBridge, type HostRootSurface, type LiveHostSession, resolveHostBridge } from "./lib/host-bridge";

/**
 * QOL-002/003: agent-controlled plan & vibe modes — thin driver only.
 *
 * No behavior is reimplemented here. Plan/vibe mode machinery (write guard,
 * prompt injection, worker lifecycle, decision enforcement) already lives in
 * the host; the TUI's `/plan` and `/vibe` and ACP's `set_session_mode` are
 * just call sequences over the session object. This tool is one more entry
 * point onto those same host primitives:
 *
 *   - plan: mirrors ACP's `#applyModeChange` (acp-agent.ts) — the host's own
 *     official non-TUI plan switch: `setPlanModeState` + `setPlanProposalHandler`.
 *   - vibe: mirrors InteractiveMode's `#enterVibeMode` / `#exitVibeMode` —
 *     `VibeSessionRegistry.ownerScope/activateScope/killAll` +
 *     `activateVibeTools/deactivateVibeTools` + `setVibeModeState`.
 *
 * Requires the host bridge (shared module instance: source-link or
 * compiled-binary hosts). Sealed prebuilt-bundle hosts do not expose the
 * live session; the tool then reports that honestly — no emulation, no
 * duplicated logic (ADR-004).
 */

export const MODE_TOOL_NAME = "mode";

/** Same default as ACP (acp-agent.ts DEFAULT_PLAN_FILE_URL). */
export const DEFAULT_PLAN_FILE_URL = "local://PLAN.md";

const BRIDGE_UNAVAILABLE =
	"Mode control needs the live host session, but none is reachable right now (no main agent session registered). " +
	"The user can still use /plan and /vibe directly.";

const VIBE_UNTRUSTED_REGISTRY =
	"Vibe mode control needs the host's vibe worker registry, which this host form does not expose safely. " +
	"The user can still use /vibe directly; plan mode and status work through this tool.";

export interface ModeToolOptions {
	/** Test seam: override host-bridge resolution. */
	resolveBridge?: () => Promise<HostBridge | null>;
}

type ModeOp = "plan_enter" | "plan_exit" | "vibe_enter" | "vibe_exit" | "status";

interface ModeParams {
	op: ModeOp;
	objective?: string;
}

export function registerModeTool(pi: ExtensionAPI, options?: ModeToolOptions): void {
	// Real zod (root barrel exports it as `zod`) via the host's OWN injected
	// namespace — no bare host imports, which the sealed installed binary
	// cannot resolve from the plugin cache copy. Fall back to `pi.zod` for
	// mocks/source hosts without the injected surface.
	const z = (((pi as unknown as { pi?: { zod?: unknown } }).pi?.zod ?? pi.zod) as typeof Zod);
	// The host hands the factory its OWN module namespace (`ExtensionAPI.pi`).
	// Prefer it so the bridge reaches the live registry on every host form,
	// including the sealed installed binary where self-import is a second copy.
	const injectedRoot = ((pi as unknown as { pi?: HostRootSurface }).pi ?? null) as HostRootSurface | null;
	const resolveBridge = options?.resolveBridge ?? (() => resolveHostBridge(injectedRoot));

	// Same bookkeeping InteractiveMode keeps (#vibeModePreviousTools / #vibeModeOwnerScope).
	let vibePreviousTools: string[] | null = null;
	// `via` records which reach drove the entry: the trusted vibe registry
	// (shared-module worlds) or the injected LIVE vibe tool classes (sealed
	// hosts — research §7). Exit must mirror the matching path.
	let vibeScope: { parent: Record<string, unknown>; ownerScope: unknown; via: "registry" | "tools" } | null = null;

	// Unified JSON envelope, same shape as the advisor and goal tools:
	//   success: { ok:true,  tool:"mode", op, ...fields, message, warnings: [] }
	//   failure: { ok:false, tool:"mode", op, error, action? }
	const fail = (op: string, error: string, action?: string) => {
		const body: Record<string, unknown> = { ok: false, tool: MODE_TOOL_NAME, op, error };
		if (action) body.action = action;
		return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], details: body, isError: true };
	};
	const succeed = (op: string, message: string, fields?: Record<string, unknown>) => {
		const body: Record<string, unknown> = { ok: true, tool: MODE_TOOL_NAME, op, ...fields, message };
		if (!("warnings" in body)) body.warnings = [];
		return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], details: body };
	};

	// Plan proposals (`xd://propose`) must never strand plan mode; ACP's
	// fallback auto-approves for clients without elicitation. Same idea:
	// acknowledge the proposal and leave exit to an explicit plan_exit.
	const planProposalHandler = (title: string) => ({
		content: [
			{
				type: "text" as const,
				text: `Plan "${title}" recorded. Call mode plan_exit when ready to implement (the user should confirm the plan first).`,
			},
		],
	});

	const goalActive = (s: LiveHostSession): boolean => {
		const g = s.getGoalModeState?.();
		return Boolean(g?.enabled) && g?.goal?.status !== "complete" && g?.goal?.status !== "dropped";
	};

	pi.registerTool({
		name: MODE_TOOL_NAME,
		label: "Mode",
		description:
			"[qol] Enter or exit the host's plan & vibe modes — drives the same session " +
			"primitives the /plan and /vibe commands use. plan_enter: read-only planning mode, " +
			"draft the plan into PLAN.md. plan_exit: leave plan mode. vibe_enter: director mode " +
			"with persistent vibe_spawn/vibe_send/vibe_wait/vibe_kill/vibe_list workers. " +
			"vibe_exit: kill workers and restore the previous toolset. status: report mode state. " +
			"Modes are mutually exclusive and blocked while a goal is active.",
		approval: "read",
		loadMode: "essential",
		parameters: z.object({
			op: z
				.enum(["plan_enter", "plan_exit", "vibe_enter", "vibe_exit", "status"])
				.describe("Mode operation to perform"),
			objective: z
				.string()
				.optional()
				.describe("Optional objective/directive echoed into the plan_enter or vibe_enter result"),
		}),
		async execute(_toolCallId, params, signal) {
			const p = params as ModeParams;
			const opName = String(p.op);
			if (signal?.aborted) return fail(opName, "Cancelled: the tool call was aborted before it ran.");

			const bridge = await resolveBridge().catch(() => null);
			if (!bridge) return fail(opName, BRIDGE_UNAVAILABLE);
			const s = bridge.session;

			switch (p.op) {
				case "plan_enter": {
					if (s.getPlanModeState?.()?.enabled) {
						return succeed("plan_enter", "Plan mode is already active.", { mode: "plan", active: true, alreadyActive: true });
					}
					if (s.getVibeModeState?.()?.enabled) {
						return fail("plan_enter", "Vibe mode is active; plan and vibe are mutually exclusive.", "Exit it first: mode vibe_exit.");
					}
					if (goalActive(s)) {
						return fail("plan_enter", "A goal is active; modes are blocked while a goal runs.", "Complete or drop it first: goal op=complete or op=drop.");
					}
					if (s.settings?.get?.("plan.enabled") === false) {
						return fail("plan_enter", "Plan mode is disabled in settings (plan.enabled=false).", "Ask the user to enable plan.enabled in omp settings.");
					}
					// Same shape as the host's own non-TUI switch (ACP #applyModeChange).
					const previous = s.getPlanModeState?.() as
						| { planFilePath?: string; workflow?: string }
						| undefined;
					s.setPlanModeState?.({
						enabled: true,
						planFilePath: previous?.planFilePath ?? DEFAULT_PLAN_FILE_URL,
						workflow: previous?.workflow ?? "parallel",
						reentry: previous !== undefined,
					});
					s.setPlanProposalHandler?.(planProposalHandler);
					return succeed(
						"plan_enter",
						`Plan mode is now ACTIVE${p.objective?.trim() ? ` — objective: ${p.objective.trim()}` : ""}. ` +
							"The host's plan-mode guard makes the working tree read-only except the plan file " +
							"(PLAN.md / local:// paths). Draft the plan, then call mode plan_exit.",
						{ mode: "plan", active: true },
					);
				}
				case "plan_exit": {
					if (!s.getPlanModeState?.()?.enabled) return fail("plan_exit", "Plan mode is not active; nothing to exit.");
					s.setPlanProposalHandler?.(null);
					s.setPlanModeState?.(undefined);
					return succeed(
						"plan_exit",
						"Plan mode exited; the working tree is writable again. " +
							"Present the plan to the user and get confirmation before implementing.",
						{ mode: "plan", active: false },
					);
				}
				case "vibe_enter": {
					if (s.getVibeModeState?.()?.enabled) {
						return succeed("vibe_enter", "Vibe mode is already active.", { mode: "vibe", active: true, alreadyActive: true });
					}
					if (s.getPlanModeState?.()?.enabled) {
						return fail("vibe_enter", "Plan mode is active; plan and vibe are mutually exclusive.", "Exit it first: mode plan_exit.");
					}
					if (goalActive(s)) {
						return fail("vibe_enter", "A goal is active; modes are blocked while a goal runs.", "Complete or drop it first: goal op=complete or op=drop.");
					}
					const registryPath = Boolean(bridge.vibeRegistry && bridge.vibeRegistryTrusted);
					const toolsPath = !registryPath && typeof injectedRoot?.VibeListTool === "function" && typeof injectedRoot.VibeKillTool === "function";
					if (!registryPath && !toolsPath) return fail("vibe_enter", VIBE_UNTRUSTED_REGISTRY);
					const parent = buildVibeParentSession(s);
					let ownerScope: unknown = null;
					if (registryPath) {
						// Same sequence as InteractiveMode.#enterVibeMode.
						ownerScope = bridge.vibeRegistry?.ownerScope(parent);
						bridge.vibeRegistry?.activateScope(ownerScope);
					}
					// On the sealed/tools path no registry bookkeeping is needed:
					// ownerScope is pure session math and activateScope only matters
					// after killAll — which this path never calls (§7.2).
					vibePreviousTools = s.getEnabledToolNames?.() ?? [];
					// Host base set is [read] (+todo); we additionally keep `mode` itself
					// callable — the director set replaces everything else, and without
					// this the agent loses its own exit switch (proven by live e2e).
					const base = ["read"];
					if (s.hasBuiltInTool?.("todo")) base.push("todo");
					if (vibePreviousTools.includes(MODE_TOOL_NAME)) base.push(MODE_TOOL_NAME);
					await s.activateVibeTools?.(base);
					s.setVibeModeState?.({ enabled: true });
					vibeScope = { parent, ownerScope, via: registryPath ? "registry" : "tools" };
					return succeed(
						"vibe_enter",
						`Vibe (director) mode is now ACTIVE${p.objective?.trim() ? ` — directive: ${p.objective.trim()}` : ""}. ` +
							"Your toolset is now only read/todo/vibe_* plus this mode tool. " +
							"Direct persistent workers with vibe_spawn / vibe_send / vibe_wait / vibe_kill / vibe_list; " +
							"verify their results by reading touched files; call mode vibe_exit when the outcome is reached.",
						{ mode: "vibe", active: true },
					);
				}
				case "vibe_exit": {
					if (!s.getVibeModeState?.()?.enabled) return fail("vibe_exit", "Vibe mode is not active; nothing to exit.");
					let killed = 0;
					if (vibeScope?.via === "registry" && bridge.vibeRegistry) {
						// Same sequence as InteractiveMode.#exitVibeMode.
						try {
							killed = await bridge.vibeRegistry.killAll(vibeScope.parent, vibeScope.ownerScope);
						} catch (e) {
							pi.logger.warn(`[omp-qol] vibe killAll failed: ${e instanceof Error ? e.message : String(e)}`);
						}
					} else if (vibeScope?.via === "tools" && typeof injectedRoot?.VibeListTool === "function" && typeof injectedRoot.VibeKillTool === "function") {
						// Sealed host: drive the LIVE host tool classes — their bodies hit
						// the real VibeSessionRegistry singleton inside the host bundle.
						// Per-id kill (not killAll) keeps the scope admitted for re-entry.
						try {
							const listing = await new injectedRoot.VibeListTool(vibeScope.parent).execute();
							const ids = (listing.details?.screens ?? []).map(screen => screen.id);
							for (const id of ids) {
								try {
									await new injectedRoot.VibeKillTool(vibeScope.parent).execute("qol-vibe-exit", { session: id });
									killed += 1;
								} catch (e) {
									pi.logger.warn(`[omp-qol] vibe kill ${id} failed: ${e instanceof Error ? e.message : String(e)}`);
								}
							}
						} catch (e) {
							pi.logger.warn(`[omp-qol] vibe worker enumeration failed: ${e instanceof Error ? e.message : String(e)}`);
						}
					}
					await s.deactivateVibeTools?.(vibePreviousTools ?? []);
					s.setVibeModeState?.(undefined);
					vibeScope = null;
					vibePreviousTools = null;
					return succeed(
						"vibe_exit",
						killed > 0
							? `Vibe mode exited; killed ${killed} worker session${killed === 1 ? "" : "s"}; previous toolset restored.`
							: "Vibe mode exited; previous toolset restored.",
						{ mode: "vibe", active: false, killed },
					);
				}
				default: {
					const plan = Boolean(s.getPlanModeState?.()?.enabled);
					const vibe = Boolean(s.getVibeModeState?.()?.enabled);
					const goal = goalActive(s) ? "active" : "none";
					return succeed(
						"status",
						`plan: ${plan ? "on" : "off"} | vibe: ${vibe ? "on" : "off"} | goal: ${goal}`,
						{ plan, vibe, goal },
					);
				}
			}
		},
	});
}
