import { describe, expect, test } from "bun:test";
import type { LiveHostSession } from "../src/lib/host-bridge";
import { lastJournalMode, planOccupies, resolvedSessionMode } from "../src/lib/mode-exclusivity";

function session(partial: Partial<LiveHostSession>): LiveHostSession {
	return partial as LiveHostSession;
}

describe("resolvedSessionMode / planOccupies", () => {
	test("prefers buildSessionContext.mode over getEntries", () => {
		const s = session({
			sessionManager: {
				getSessionId: () => "s",
				getSessionFile: () => null,
				appendModeChange: () => {},
				getEntries: () => [{ type: "mode_change", mode: "plan_paused" }],
				buildSessionContext: () => ({ mode: "none" }),
			},
		});
		expect(lastJournalMode(s)).toBe("plan_paused");
		expect(resolvedSessionMode(s)).toBe("none");
		expect(planOccupies(s)).toBeNull();
	});

	test("falls back to getEntries when buildSessionContext is missing", () => {
		const s = session({
			sessionManager: {
				getSessionId: () => "s",
				getSessionFile: () => null,
				appendModeChange: () => {},
				getEntries: () => [
					{ type: "mode_change", mode: "plan" },
					{ type: "mode_change", mode: "plan_paused" },
				],
			},
		});
		expect(resolvedSessionMode(s)).toBe("plan_paused");
		expect(planOccupies(s)).toBe("paused");
	});

	test("live setter enabled wins over a paused journal", () => {
		const s = session({
			getPlanModeState: () => ({ enabled: true }),
			sessionManager: {
				getSessionId: () => "s",
				getSessionFile: () => null,
				appendModeChange: () => {},
				buildSessionContext: () => ({ mode: "plan_paused" }),
			},
		});
		expect(planOccupies(s)).toBe("active");
	});

	test("journal mode=plan occupies even when the setter was cleared", () => {
		const s = session({
			getPlanModeState: () => undefined,
			sessionManager: {
				getSessionId: () => "s",
				getSessionFile: () => null,
				appendModeChange: () => {},
				buildSessionContext: () => ({ mode: "plan" }),
			},
		});
		expect(planOccupies(s)).toBe("active");
	});
});
