import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Mirrors the `omp.settings` schema declared in package.json. */
export const DEFAULT_SETTINGS = {
	greeting: "omp-qol ready.",
	notifyOnSessionStart: true,
	goalToolEnabled: true,
	modeToolEnabled: true,
	advisorToolEnabled: true,
};

export interface QolSettings {
	greeting: string;
	notifyOnSessionStart: boolean;
	goalToolEnabled: boolean;
	modeToolEnabled: boolean;
	advisorToolEnabled: boolean;
}

/**
 * Read this plugin's persisted settings (as managed by
 * `omp plugin config set <name> <key> <value>`).
 *
 * Prefers the host's own loader (`getPluginSettings`, which also applies
 * project-level overrides); falls back to reading the plugin lockfile
 * directly so the extension keeps working on hosts that don't expose the
 * subpath to extensions.
 */
export async function loadSettings(pluginName: string, cwd: string): Promise<QolSettings> {
	const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };

	// Preferred path: host plugin loader.
	try {
		const mod = (await import(
			// Kept as a string so static analysis does not try to bundle it;
			// the omp host remaps @oh-my-pi imports onto its bundled copies.
			"@oh-my-pi/pi-coding-agent/extensibility/plugins/loader"
		)) as { getPluginSettings?: (name: string, cwd: string) => Promise<Record<string, unknown>> };
		if (typeof mod.getPluginSettings === "function") {
			Object.assign(settings, await mod.getPluginSettings(pluginName, cwd));
			return coerce(settings);
		}
	} catch {
		// Fall through to the lockfile read.
	}

	// Fallback: <config root>/plugins/omp-plugins.lock.json -> settings[<name>].
	try {
		const root = getConfigRoot();
		const lockPath = path.join(root, "plugins", "omp-plugins.lock.json");
		const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
			settings?: Record<string, Record<string, unknown>>;
		};
		Object.assign(settings, lock.settings?.[pluginName] ?? {});
	} catch {
		// No persisted settings — defaults stand.
	}

	return coerce(settings);
}

/** Coerce stored values onto the declared schema shape defensively. */
function coerce(raw: Record<string, unknown>): QolSettings {
	return {
		greeting: typeof raw.greeting === "string" && raw.greeting.length > 0 ? raw.greeting : DEFAULT_SETTINGS.greeting,
		notifyOnSessionStart:
			typeof raw.notifyOnSessionStart === "boolean"
				? raw.notifyOnSessionStart
				: DEFAULT_SETTINGS.notifyOnSessionStart,
		goalToolEnabled:
			typeof raw.goalToolEnabled === "boolean" ? raw.goalToolEnabled : DEFAULT_SETTINGS.goalToolEnabled,
		modeToolEnabled:
			typeof raw.modeToolEnabled === "boolean" ? raw.modeToolEnabled : DEFAULT_SETTINGS.modeToolEnabled,
		advisorToolEnabled:
			typeof raw.advisorToolEnabled === "boolean" ? raw.advisorToolEnabled : DEFAULT_SETTINGS.advisorToolEnabled,
	};
}

/** Resolve the active omp config root (~/.omp by default), profile-aware. */
function getConfigRoot(): string {
	const base = path.join(os.homedir(), process.env.PI_CONFIG_DIR || ".omp");
	const profile = process.env.OMP_PROFILE || process.env.PI_PROFILE;
	return profile && profile !== "default" ? path.join(base, "profiles", profile) : base;
}
