/**
 * Ambient host types for plugin-only tsc.
 * These declarations cover the `@oh-my-pi/*` modules imported by `plugin/src`.
 * They exist so `tsconfig.plugin.json` does not walk host source (and its
 * Bun-only `.md` imports). Runtime still loads the real host.
 */

declare module "@oh-my-pi/pi-coding-agent" {
	export interface ExtensionUIContext {
		notify(message: string, level?: string): void;
	}

	export interface ExtensionContext {
		cwd: string;
		ui: ExtensionUIContext;
	}

	export interface ExtensionCommandContext extends ExtensionContext {}

	export interface ExtensionLogger {
		info(message: string): void;
		warn(message: string): void;
	}

	export interface AgentToolResult {
		content?: Array<{ type?: string; text?: string }>;
		details?: unknown;
		isError?: boolean;
	}

	export interface ToolExecuteContext extends ExtensionContext {
		invokeTool?: (
			params: Record<string, unknown>,
			options?: { signal?: AbortSignal; onUpdate?: unknown },
		) => Promise<AgentToolResult>;
	}

	export interface ExtensionAPI {
		setLabel(label: string): void;
		logger: ExtensionLogger;
		zod: unknown;
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): void;
		registerCommand(
			name: string,
			def: {
				description: string;
				handler: (args: string, ctx: ExtensionCommandContext) => unknown;
			},
		): void;
		registerTool(def: {
			name: string;
			label?: string;
			description?: string;
			approval?: string | ((args: unknown) => string);
			loadMode?: string;
			hidden?: boolean;
			parameters?: unknown;
			execute: (
				toolCallId: string,
				params: unknown,
				signal: AbortSignal | undefined,
				onUpdate: unknown,
				ctx: ToolExecuteContext,
			) => unknown;
		}): void;
	}

	export function getAgentDir(): string;
	export const repo: {
		root(cwd: string): Promise<string | null>;
	};
}

declare module "@oh-my-pi/pi-coding-agent/advisor/config" {
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
}

declare module "@oh-my-pi/pi-coding-agent/tools/builtin-names" {
	export const BUILTIN_TOOL_NAMES: readonly string[];
	export function normalizeToolNames(names: Iterable<string>): string[];
}

declare module "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader" {
	export function getPluginSettings(name: string, cwd: string): Promise<Record<string, unknown>>;
}
