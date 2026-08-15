/**
 * L2 unit tests for src/lib/host-bridge.ts against the REAL host
 * AgentRegistry (module instance shared via the workspace junction).
 * Covers the resolution edge cases the production resolver must survive.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { buildVibeParentSession, type HostRootSurface, resolveHostBridge } from "../src/lib/host-bridge";

const TEST_IDS: string[] = [];

function register(ref: { id: string; kind?: "main" | "sub" | "advisor"; session: unknown; status?: "running" | "idle" | "parked" }): void {
	AgentRegistry.global().register({
		id: ref.id,
		displayName: ref.id,
		kind: ref.kind ?? "main",
		session: ref.session as never,
		status: ref.status ?? "running",
	});
	TEST_IDS.push(ref.id);
}

afterEach(() => {
	for (const id of TEST_IDS.splice(0)) AgentRegistry.global().unregister(id);
});

/** Minimal object satisfying the bridge's sanity gate. */
function completeSession(): Record<string, unknown> {
	return {
		getPlanModeState: () => undefined,
		setPlanModeState: () => {},
		activateVibeTools: async () => {},
		deactivateVibeTools: async () => {},
		getEnabledToolNames: () => [],
		sessionManager: { getSessionId: () => "s", getSessionFile: () => null },
	};
}

describe("resolveHostBridge edge cases", () => {
	// H1 is the first test that triggers the bridge's host self-import; on a
	// loaded machine that import alone can exceed bun's default 5s per-test
	// timeout (observed 6.4s). The assertion is unchanged.
	test("H1: no main-kind ref -> null", async () => {
		register({ id: "qol-h1-sub", kind: "sub", session: completeSession() });
		expect(await resolveHostBridge()).toBeNull();
	}, 30_000);

	test("H2: main ref with null session (parked) -> null", async () => {
		register({ id: "qol-h2", session: null, status: "parked" });
		expect(await resolveHostBridge()).toBeNull();
	});

	test("H3: session missing required methods is refused (sanity gate)", async () => {
		register({ id: "qol-h3", session: { getPlanModeState: () => undefined } });
		expect(await resolveHostBridge()).toBeNull();
	});

	test("H4: complete session resolves with vibe registry attached", async () => {
		const session = completeSession();
		register({ id: "qol-h4", session });
		const bridge = await resolveHostBridge();
		expect(bridge?.session).toBe(session);
		expect(bridge?.vibeRegistry).not.toBeNull();
		expect(typeof bridge?.vibeRegistry?.ownerScope).toBe("function");
		expect(typeof bridge?.vibeRegistry?.killAll).toBe("function");
		// Self-import world (shared module instance) => trusted.
		expect(bridge?.vibeRegistryTrusted).toBe(true);
	});

	test("H5: repeated resolution is stable (module-cache backed)", async () => {
		const session = completeSession();
		register({ id: "qol-h5", session });
		const a = await resolveHostBridge();
		const b = await resolveHostBridge();
		expect(a?.session).toBe(b?.session);
	});

	test("H7: injected host namespace takes precedence over self-import", async () => {
		// The REAL registry holds only a sub ref — self-import resolution would
		// return null. If the injected root wins, the bridge still resolves.
		register({ id: "qol-h7-sub", kind: "sub", session: completeSession() });
		const injectedSession = completeSession();
		const injectedRoot: HostRootSurface = {
			AgentRegistry: {
				global: () => ({
					list: () => [{ id: "qol-h7-main", kind: "main", status: "running", session: injectedSession }],
				}),
			},
		};
		const bridge = await resolveHostBridge(injectedRoot);
		expect(bridge?.session).toBe(injectedSession);
	});

	test("H8: injected root without AgentRegistry falls back to self-import", async () => {
		const session = completeSession();
		register({ id: "qol-h8", session });
		const bridge = await resolveHostBridge({} as HostRootSurface);
		expect(bridge?.session).toBe(session);
	});
});

describe("buildVibeParentSession facade", () => {
	test("H6: facade reads through the live session accessors", () => {
		const session = {
			...completeSession(),
			getAgentId: () => "Main",
			asyncJobManager: { marker: true },
			settings: { get: (_k: string) => undefined },
			sessionManager: { getSessionId: () => "sess-42", getSessionFile: () => "/tmp/x.jsonl" },
		};
		const facade = buildVibeParentSession(session as never) as Record<string, (...args: unknown[]) => unknown> & {
			asyncJobManager: unknown;
			settings: unknown;
			sessionManager: unknown;
		};
		expect(facade.getAgentId()).toBe("Main");
		expect(facade.getSessionId()).toBe("sess-42");
		expect(facade.getSessionFile()).toBe("/tmp/x.jsonl");
		expect(facade.asyncJobManager).toBe(session.asyncJobManager);
		expect(facade.settings).toBe(session.settings);
		expect(facade.sessionManager).toBe(session.sessionManager);
	});
});
