/**
 * Host bridge: resolve the LIVE AgentSession of the current host process.
 *
 * The TUI's `/plan` and `/vibe` handlers are thin sequences of calls on the
 * session object (`setPlanModeState`, `activateVibeTools`, ...). The primary
 * reach is the HOST-INJECTED module namespace: the extension loader passes
 * the factory `ExtensionAPI.pi` — the host's own `pi-coding-agent` exports
 * object (types.ts:1121). Being the live instance, its `AgentRegistry`
 * is the running registry in EVERY host form, including the sealed installed
 * binary where any self-`import()` resolves to a second module copy.
 *
 * Self-import stays only as a fallback (source-link dev runs, tests); when
 * it resolves to a second copy the registry lists no agents and this bridge
 * returns `null`.
 */

export interface LiveHostSession {
	getPlanModeState?(): { enabled?: boolean; planFilePath?: string } | undefined;
	setPlanModeState?(state: unknown): void;
	getGoalModeState?(): { enabled?: boolean; goal?: { status?: string } } | undefined;
	getVibeModeState?(): { enabled?: boolean } | undefined;
	setVibeModeState?(state: unknown): void;
	activateVibeTools?(baseToolNames: string[]): Promise<void>;
	deactivateVibeTools?(nextToolNames: string[]): Promise<void>;
	getEnabledToolNames?(): string[];
	setActiveToolsByName?(names: string[]): Promise<void> | void;
	hasBuiltInTool?(name: string): boolean;
	getPlanReferencePath?(): string | undefined;
	setPlanProposalHandler?(handler: ((title: string) => unknown) | null): void;
	preparePlanForReview?(title: string): Promise<unknown> | unknown;
	sendPlanModeContext?(options?: { deliverAs?: string }): Promise<unknown> | unknown;
	isStreaming?: boolean;
	getAgentId?(): string | null;
	asyncJobManager?: unknown;
	settings?: { get(key: string): unknown };
	sessionManager?: {
		getSessionId(): string | null;
		getSessionFile(): string | null;
		appendModeChange(mode: string, modeData?: Record<string, unknown>): void;
	};
}

export interface VibeRegistryLike {
	ownerScope(session: unknown): unknown;
	activateScope(scope: unknown): void;
	killAll(session: unknown, scope?: unknown): Promise<number>;
}

/** Live vibe tool instances as constructed from the injected host classes. */
export interface VibeToolResultLike {
	details?: { screens?: Array<{ id: string }> };
}

export interface VibeListToolLike {
	execute(): Promise<VibeToolResultLike>;
}

export interface VibeKillToolLike {
	execute(toolCallId: string, params: { session: string }): Promise<VibeToolResultLike>;
}

export interface HostBridge {
	session: LiveHostSession;
	vibeRegistry: VibeRegistryLike | null;
	/**
	 * True when `vibeRegistry` is provably the host's own singleton (carried by
	 * the injected host namespace, or resolved in a shared-module-instance world
	 * such as source-link runs). False when it came from a subpath self-import
	 * that may be a second module copy — vibe worker lifecycle ops (killAll)
	 * would then silently miss the host's real workers and must be refused.
	 */
	vibeRegistryTrusted: boolean;
}

/** The host's own module namespace, as injected via `ExtensionAPI.pi`. */
export type HostRootSurface = {
	AgentRegistry?: {
		global(): { list(): Array<{ id: string; kind: string; status: string; session: unknown }> };
	};
	VibeSessionRegistry?: { global(): VibeRegistryLike };
	/**
	 * LIVE vibe tool classes — the root barrel re-exports `./tools`, which
	 * re-exports `./vibe` (tools/index.ts), so every host form injects them.
	 * Their bodies hit the host bundle's own VibeSessionRegistry singleton,
	 * which is exactly what the sealed installed host cannot reach otherwise
	 * (research §7.2). Constructor takes a VibeParentSession-shaped facade.
	 */
	VibeListTool?: new (session: Record<string, unknown>) => VibeListToolLike;
	VibeKillTool?: new (session: Record<string, unknown>) => VibeKillToolLike;
};

/**
 * Resolve the live host session, or null when no live main session exists.
 * Pass `injectedRoot` — the host's own module namespace as handed to the
 * extension factory (`ExtensionAPI.pi`) — so the bridge works on every host
 * form; self-import is only the fallback. Cheap after the first import
 * (module cache), so callers may resolve per operation.
 */
export async function resolveHostBridge(injectedRoot?: HostRootSurface | null): Promise<HostBridge | null> {
	const usedInjected = Boolean(injectedRoot?.AgentRegistry);
	let root: HostRootSurface | null = usedInjected ? (injectedRoot as HostRootSurface) : null;
	if (!root) {
		try {
			root = (await import("@oh-my-pi/pi-coding-agent")) as unknown as HostRootSurface;
		} catch {
			return null;
		}
	}
	if (!root.AgentRegistry) return null;

	let refs: Array<{ id: string; kind: string; status: string; session: unknown }>;
	try {
		refs = root.AgentRegistry.global().list();
	} catch {
		return null;
	}
	const main = refs.find(ref => ref.kind === "main" && ref.session);
	const session = main?.session as LiveHostSession | undefined;
	if (!session) return null;
	// Sanity: require the exact surfaces the mode sequences drive. A partial
	// match would mean a foreign/older session object — refuse it.
	if (
		typeof session.setPlanModeState !== "function" ||
		typeof session.getPlanModeState !== "function" ||
		typeof session.activateVibeTools !== "function" ||
		typeof session.deactivateVibeTools !== "function" ||
		typeof session.getEnabledToolNames !== "function" ||
		!session.sessionManager
	) {
		return null;
	}

	let vibeRegistry: VibeRegistryLike | null = null;
	// Carried by the root surface => the host's own singleton (trusted).
	try {
		vibeRegistry = root.VibeSessionRegistry?.global() ?? null;
	} catch {
		vibeRegistry = null;
	}
	let vibeRegistryTrusted = vibeRegistry !== null;
	if (!vibeRegistry && !usedInjected) {
		// Self-import fallback only makes sense in the shared-module-instance
		// world (source-link dev runs, tests). With an injected root the subpath
		// resolves to a second module copy whose registry singleton is a fresh
		// empty one — killAll on it would orphan the host's real workers, so
		// the sealed host takes the live vibe-tool-class path instead (§7.2).
		try {
			const vibeMod = (await import("@oh-my-pi/pi-coding-agent/vibe/runtime")) as {
				VibeSessionRegistry?: { global(): VibeRegistryLike };
			};
			vibeRegistry = vibeMod.VibeSessionRegistry?.global() ?? null;
			vibeRegistryTrusted = vibeRegistry !== null;
		} catch {
			vibeRegistry = null;
		}
	}
	return { session, vibeRegistry, vibeRegistryTrusted };
}

/** VibeParentSession facade exactly as InteractiveMode builds it. */
export function buildVibeParentSession(session: LiveHostSession): Record<string, unknown> {
	return {
		getAgentId: () => session.getAgentId?.() ?? null,
		getSessionId: () => session.sessionManager?.getSessionId() ?? null,
		getSessionFile: () => session.sessionManager?.getSessionFile() ?? null,
		sessionManager: session.sessionManager,
		asyncJobManager: session.asyncJobManager,
		settings: session.settings,
	};
}
