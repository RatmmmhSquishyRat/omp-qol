/** Plugin-only typecheck stub for `@oh-my-pi/pi-coding-agent/advisor/config`. */
export interface AdvisorConfig {
	name: string;
	model?: string;
	tools?: string[];
	instructions?: string;
	enabled?: boolean;
}

export interface WatchdogConfigDoc {
	instructions?: string;
	advisors: AdvisorConfig[];
}

export function discoverAdvisorConfigs(
	cwd: string,
	agentDir: string,
): Promise<{ advisors: AdvisorConfig[]; sharedInstructions: string | undefined }>;

export function loadWatchdogConfigFile(filePath: string): Promise<WatchdogConfigDoc>;

export function saveWatchdogConfigFile(filePath: string, doc: WatchdogConfigDoc): Promise<void>;

export function resolveAdvisorConfigEditPath(
	scope: "project" | "user",
	dirs: { projectDir: string; agentDir: string },
): Promise<string>;

export function slugifyAdvisorName(name: string): string;
