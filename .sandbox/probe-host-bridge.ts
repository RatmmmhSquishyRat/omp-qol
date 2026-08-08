/**
 * Host-bridge diagnostics (evidence for docs/researches/omp-plan-vibe-modes.md §4).
 *
 * Usage: set env OMP_QOL_PROBE=1 and start any omp session; the extension
 * logs `[omp-qol][probe]` lines describing:
 *   - whether the root `@oh-my-pi/pi-coding-agent` import resolves to the
 *     host's own module instance (AgentRegistry showing `Main` = shared),
 *   - the live session's mode-control methods,
 *   - a WRITE-PROOF round trip (setPlanModeState / activateVibeTools).
 *
 * Findings (2026-08-05, omp 17.2.4, win32-x64):
 *   - Installed host (bun global, dist/cli.js bundle): registry always
 *     <empty> — extension imports load a second src/ copy; the host's live
 *     session is unreachable.
 *   - Source-link host (bun packages/coding-agent/src/cli.ts from the
 *     monorepo): registry shows Main(kind=main,status=running,session=live);
 *     all mode methods present; WRITE-PROOF succeeded for both plan state
 *     and vibe tool installation.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export async function runProbeOnce(pi: ExtensionAPI, ctx: { sessionManager: unknown; modelRegistry: unknown }): Promise<void> {
	try {
		// PRIMARY path (the fix): the host-injected namespace `pi.pi`.
		const injected = (pi as unknown as { pi?: unknown }).pi as
			| { AgentRegistry?: { global(): { list(): Array<{ id: string; kind: string; status: string; session: unknown }> } } }
			| undefined;
		if (injected?.AgentRegistry) {
			const refs = injected.AgentRegistry.global().list();
			pi.logger.info(
				`[omp-qol][probe] INJECTED registry: ${refs.map(r => `${r.id}(kind=${r.kind},status=${r.status},session=${r.session ? "live" : "null"})`).join(", ") || "<empty>"}`,
			);
			const main = refs.find(r => r.kind === "main");
			const s = main?.session as Record<string, unknown> | undefined;
			if (s && typeof s.setPlanModeState === "function" && s.getPlanModeState?.() === undefined) {
				(s.setPlanModeState as (st: unknown) => void)({ enabled: true, planFilePath: "local://PLAN.md", workflow: "parallel", reentry: false });
				pi.logger.info(`[omp-qol][probe] INJECTED WRITE-PROOF plan state set: ${JSON.stringify(s.getPlanModeState?.())}`);
				(s.setPlanModeState as (st: unknown) => void)(undefined);
				pi.logger.info("[omp-qol][probe] INJECTED WRITE-PROOF plan state cleared");
			}
		} else {
			pi.logger.info("[omp-qol][probe] INJECTED namespace has no AgentRegistry");
		}

		const root = (await import("@oh-my-pi/pi-coding-agent")) as {
			AgentRegistry?: { global(): { list(): Array<{ id: string; kind: string; status: string; session: unknown }> } };
		};
		if (!root.AgentRegistry) {
			pi.logger.info("[omp-qol][probe] ROOT has no AgentRegistry export");
			return;
		}
		const refs = root.AgentRegistry.global().list();
		pi.logger.info(
			`[omp-qol][probe] ROOT registry: ${refs.map(r => `${r.id}(kind=${r.kind},status=${r.status},session=${r.session ? "live" : "null"})`).join(", ") || "<empty>"}`,
		);
		const main = refs.find(r => r.kind === "main");
		const s = main?.session as Record<string, unknown> | undefined;
		if (!s) return;
		const probe = (k: string) => `${k}=${typeof s[k]}`;
		pi.logger.info(
			`[omp-qol][probe] session: ${["getPlanModeState", "setPlanModeState", "getVibeModeState", "setVibeModeState", "activateVibeTools", "deactivateVibeTools", "getEnabledToolNames", "setActiveToolsByName", "hasBuiltInTool", "getPlanReferencePath", "setPlanProposalHandler", "sendPlanModeContext", "isStreaming", "settings", "sessionManager"].map(probe).join(" ")}`,
		);
		// WRITE-PROOF round trip (only when plan mode is currently off).
		if (typeof s.setPlanModeState === "function" && s.getPlanModeState?.() === undefined) {
			(s.setPlanModeState as (st: unknown) => void)({ enabled: true, planFilePath: "local://PLAN.md", workflow: "parallel", reentry: false });
			pi.logger.info(`[omp-qol][probe] WRITE-PROOF plan state set: ${JSON.stringify(s.getPlanModeState?.())}`);
			(s.setPlanModeState as (st: unknown) => void)(undefined);
			const prev = (s.getEnabledToolNames as () => string[])();
			await (s.activateVibeTools as (base: string[]) => Promise<void>)(["read"]);
			pi.logger.info(`[omp-qol][probe] WRITE-PROOF vibe active tools: ${JSON.stringify((s.getEnabledToolNames as () => string[])())}`);
			await (s.deactivateVibeTools as (next: string[]) => Promise<void>)(prev);
			pi.logger.info(`[omp-qol][probe] WRITE-PROOF restored: ${(s.getEnabledToolNames as () => string[])().length} tools`);
		}
		pi.logger.info(`[omp-qol][probe] sessionManager own keys: ${Object.keys(ctx.sessionManager).join(",") || "<none>"}`);
		// Hunt for an exposed mode controller / interactive context:
		pi.logger.info(`[omp-qol][probe] session own keys: ${Object.keys(s).join(",") || "<none>"}`);
		pi.logger.info(`[omp-qol][probe] ctx own keys: ${Object.keys(ctx).join(",") || "<none>"}`);
		const ui = (ctx as { ui?: Record<string, unknown> }).ui;
		if (ui) {
			pi.logger.info(`[omp-qol][probe] ui own keys: ${Object.keys(ui).join(",") || "<none>"}`);
		}
		const runner = (s as { extensionRunner?: Record<string, unknown> }).extensionRunner;
		if (runner) {
			pi.logger.info(`[omp-qol][probe] extensionRunner own keys: ${Object.keys(runner).join(",") || "<none>"}`);
		}
	} catch (err) {
		pi.logger.info(`[omp-qol][probe] failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}
