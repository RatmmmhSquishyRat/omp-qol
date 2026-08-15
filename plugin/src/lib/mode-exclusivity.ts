/**
 * User-side occupancy table for plan / vibe / goal.
 *
 * The TUI's RAM flags (`planModePaused` on InteractiveMode) are not exported.
 * That is not "state we cannot get". The author persists the current mode on
 * the session journal (`mode_change`) and projects it with
 * `sessionManager.buildSessionContext().mode` — the same call InteractiveMode
 * uses on resume to restore `plan_paused`. `getEntries()` is a public
 * SessionManager method and is the fallback when a test double has no
 * `buildSessionContext`.
 *
 * Do not treat journal `vibe` as occupancy: TUI vibe exit does not write
 * `mode_change none`, so a stale `vibe` entry can outlive the live flag.
 */

import type { LiveHostSession } from "./host-bridge";

export type Occupancy = "active" | "paused";

/** Last `mode_change` in the raw entry list (not branch-aware). */
export function lastJournalMode(session: LiveHostSession): string | undefined {
	const entries = session.sessionManager?.getEntries?.();
	if (!entries?.length) return undefined;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "mode_change" && typeof entry.mode === "string") {
			return entry.mode;
		}
	}
	return undefined;
}

/**
 * Author's current-mode projection. Prefer `buildSessionContext().mode`
 * (leaf-to-root, what `/plan` resume reads). Fall back to the last journal
 * `mode_change` when only `getEntries` is present.
 */
export function resolvedSessionMode(session: LiveHostSession): string | undefined {
	const mode = session.sessionManager?.buildSessionContext?.()?.mode;
	if (typeof mode === "string") return mode;
	return lastJournalMode(session);
}

/** TUI: `goalModeEnabled || goalModePaused`. Paused is session-visible. */
export function goalOccupies(session: LiveHostSession): Occupancy | null {
	const state = session.getGoalModeState?.();
	const status = state?.goal?.status;
	if (!status || status === "complete" || status === "dropped") return null;
	if (status === "paused") return "paused";
	if (state?.enabled) return "active";
	return null;
}

/**
 * TUI: `planModeEnabled || planModePaused`.
 * Live setter wins. Otherwise the author's session-context mode is the paused
 * (and still-on) bit — not the TUI field we cannot import.
 */
export function planOccupies(session: LiveHostSession): Occupancy | null {
	if (session.getPlanModeState?.()?.enabled) return "active";
	const mode = resolvedSessionMode(session);
	if (mode === "plan") return "active";
	if (mode === "plan_paused") return "paused";
	return null;
}

/** TUI vibe has no paused state. Live session flag only. */
export function vibeOccupies(session: LiveHostSession): boolean {
	return Boolean(session.getVibeModeState?.()?.enabled);
}

export function goalStatusLabel(session: LiveHostSession): "active" | "paused" | "none" {
	return goalOccupies(session) ?? "none";
}

export function refuseGoalOccupancy(kind: Occupancy): { error: string; action: string } {
	if (kind === "paused") {
		return {
			error: "A goal is paused; pause still occupies the exclusive slot (same as the user's /plan, /vibe, and /goal).",
			action: "Drop it first: goal op=drop. Pause does not free the slot; complete is not available while the goal is paused.",
		};
	}
	return {
		error: "A goal is active; modes are mutually exclusive (same as the user's /plan, /vibe, and /goal).",
		action: "Complete or drop it first: goal op=complete or op=drop. Pausing the goal does not free the slot.",
	};
}

export function refusePlanOccupancy(kind: Occupancy): { error: string; action: string } {
	if (kind === "paused") {
		return {
			error: "Plan mode is paused; pause still occupies the exclusive slot (same as the user's /plan, /vibe, and /goal).",
			action: "Ask the user to fully exit plan with /plan (toggle off). Pause does not free the slot; mode plan_exit cannot clear a TUI-paused plan.",
		};
	}
	return {
		error: "Plan mode is active; plan and vibe are mutually exclusive (same as the user's /plan and /vibe).",
		action: "Exit it first: mode plan_exit. Pausing plan does not free the slot.",
	};
}

export function refuseVibeOccupancy(): { error: string; action: string } {
	return {
		error: "Vibe mode is active; plan and vibe are mutually exclusive (same as the user's /plan and /vibe).",
		action: "Exit it first: mode vibe_exit.",
	};
}

/** User `/goal` refuses while plan or vibe occupies the slot. */
export function refuseGoalBecauseOtherMode(session: LiveHostSession): { error: string; action: string } | null {
	const plan = planOccupies(session);
	if (plan) {
		if (plan === "paused") {
			return {
				error: "Plan mode is paused; /goal refuses while plan occupies the slot (same as the user's /goal).",
				action: "Ask the user to fully exit plan with /plan. Pause does not free the slot.",
			};
		}
		return {
			error: "Plan mode is active; /goal refuses while plan occupies the slot (same as the user's /goal).",
			action: "Exit it first: mode plan_exit. Pausing plan does not free the slot.",
		};
	}
	if (vibeOccupies(session)) {
		return {
			error: "Vibe mode is active; /goal refuses while vibe occupies the slot (same as the user's /goal).",
			action: "Exit it first: mode vibe_exit.",
		};
	}
	return null;
}
