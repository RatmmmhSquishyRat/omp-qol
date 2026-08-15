/** Plugin-only typecheck stub. Runtime still loads the real host module. */
export interface ExtensionAPI {
	setLabel(label: string): void;
	logger: {
		info(message: string): void;
		warn(message: string): void;
	};
	zod: unknown;
	on(
		event: string,
		handler: (
			event: unknown,
			ctx: { cwd: string; ui: { notify(message: string, level?: string): void } },
		) => unknown,
	): void;
	registerCommand(
		name: string,
		def: {
			description: string;
			handler: (args: string, ctx: { cwd: string; ui: { notify(message: string, level?: string): void } }) => unknown;
		},
	): void;
	registerTool(def: Record<string, unknown>): void;
}

export function getAgentDir(): string;

export const repo: {
	root(cwd: string): Promise<string | null | undefined>;
};
