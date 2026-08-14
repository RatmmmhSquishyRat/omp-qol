import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerAdvisorTool } from "./advisor-tool";
import { registerGoalTool } from "./goal-tool";
import { loadSettings } from "./lib/settings";
import { registerModeTool } from "./mode-tool";

/**
 * omp-qol-plugin — entry point.
 *
 * The factory receives the ExtensionAPI at load time. Registration is the
 * only thing allowed here; runtime actions (sendMessage, exec, ...) must be
 * performed from event handlers, tools, or command handlers — calling them
 * during load throws ExtensionRuntimeNotInitializedError.
 *
 * The factory may return a promise; settings are loaded before tool
 * registration so feature kill switches apply from the very first session.
 */

const PLUGIN_NAME = "omp-qol-plugin";

export default async function ompQolPlugin(pi: ExtensionAPI): Promise<void> {
	pi.setLabel("OMP QoL");
	pi.logger.info("[omp-qol] plugin registered");

	// Settings load at factory time so registration-time kill switches work.
	// cwd is not meaningful yet at load; the settings readers don't need it
	// for the user-scope lockfile path (project overrides apply per-event
	// via the host loader when available).
	const bootSettings = await loadSettings(PLUGIN_NAME, process.cwd());

	// -- QOL-001: agent-facing goal tool (always-on, native delegation) -----
	if (bootSettings.goalToolEnabled) {
		registerGoalTool(pi);
		pi.logger.info("[omp-qol] goal tool registered");
	} else {
		pi.logger.info("[omp-qol] goal tool disabled by setting goalToolEnabled=false");
	}

	// -- QOL-002/003: agent-controlled plan & vibe modes ---------------------
	if (bootSettings.modeToolEnabled) {
		registerModeTool(pi);
		pi.logger.info("[omp-qol] mode tool registered");
	} else {
		pi.logger.info("[omp-qol] mode tool disabled by setting modeToolEnabled=false");
	}

	// -- QOL-004: agent-facing advisor tool ----------------------------------
	if (bootSettings.advisorToolEnabled) {
		registerAdvisorTool(pi);
		pi.logger.info("[omp-qol] advisor tool registered");
	} else {
		pi.logger.info("[omp-qol] advisor tool disabled by setting advisorToolEnabled=false");
	}

	// -- Session lifecycle ---------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		const settings = await loadSettings(PLUGIN_NAME, ctx.cwd);
		pi.logger.info(
			`[omp-qol] settings: greeting=${JSON.stringify(settings.greeting)} notifyOnSessionStart=${settings.notifyOnSessionStart} goalToolEnabled=${settings.goalToolEnabled} modeToolEnabled=${settings.modeToolEnabled} advisorToolEnabled=${settings.advisorToolEnabled}`,
		);
		if (settings.notifyOnSessionStart) {
			ctx.ui.notify(settings.greeting, "info");
		}
		// Host-bridge diagnostics: set OMP_QOL_PROBE=1 to log live-session reach.
		// The probe lives outside the plugin (dev-only); ignore when missing.
		if (process.env.OMP_QOL_PROBE) {
			try {
				// plugin/src/main.ts -> plugin/ -> omp-qol/.sandbox
				const probeSpecifier = "../../.sandbox/probe-host-bridge";
				const { runProbeOnce } = (await import(probeSpecifier)) as {
					runProbeOnce: (pi: ExtensionAPI, ctx: unknown) => Promise<void>;
				};
				await runProbeOnce(pi, ctx);
			} catch (err) {
				pi.logger.warn(`[omp-qol] probe unavailable: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	});

	// -- Slash commands --------------------------------------------------------
	pi.registerCommand("qol-config", {
		description: "Show omp-qol-plugin settings and how to change them",
		handler: async (_args, ctx) => {
			const settings = await loadSettings(PLUGIN_NAME, ctx.cwd);
			const lines = [
				`greeting = ${JSON.stringify(settings.greeting)}`,
				`notifyOnSessionStart = ${settings.notifyOnSessionStart}`,
				`goalToolEnabled = ${settings.goalToolEnabled}`,
				`modeToolEnabled = ${settings.modeToolEnabled}`,
				`advisorToolEnabled = ${settings.advisorToolEnabled}`,
				"",
				"Change with: omp plugin config set omp-qol-plugin <key> <value>",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
