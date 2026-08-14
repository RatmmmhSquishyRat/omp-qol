# ADR-004: Thin driver only — no emulation, no assembled behavior (supersedes ADR-003's dual backend)

Date: 2026-08-05 · Status: accepted · Trigger: user principle — "TUI 用户已经
可以使用这些功能了, 我们做的事情的实质只是增加调用入口", so nothing the host
already implements may be re-implemented (hardcoded) in the plugin.

## What changed vs ADR-003

ADR-003 kept an emulated fallback backend (write-guard allowlist, per-turn
injection, director-lite toolset, appendEntry rebuild). All of it was
duplicated host behavior — exactly the hardcoding the user rejected. It is
deleted. The `mode` tool is now a **thin driver over host primitives**; on
host forms where the live session is not exposed it reports that honestly
instead of faking behavior.

## Decision 1 — The entry point is the host's own call surface

The host already drives modes from TWO non-agent surfaces with plain session
calls: InteractiveMode (`/plan`, `/vibe`) and ACP `set_session_mode`
(`acp-agent.ts #applyModeChange`, which literally comments "Mirror
InteractiveMode.#enterPlanMode"). The session-call sequence is therefore a
cross-surface host contract, not TUI-private logic. This tool is a third
entry point onto the same contract — nothing more.

## Decision 2 — plan ops mirror ACP's official non-TUI switch

- plan_enter: gate on live states (vibe/goal) + `settings plan.enabled` →
  `setPlanModeState({enabled, planFilePath: prev ?? local://PLAN.md,
  workflow: prev ?? "parallel", reentry: prev !== undefined})` →
  `setPlanProposalHandler(handler)`. No tool-list manipulation (ACP does
  none; the session-level write guard enforces read-only on its own).
- plan_exit: `setPlanProposalHandler(null)` → `setPlanModeState(undefined)`.
- Proposal handler: acknowledge + never strand plan mode (ACP's fallback
  rationale: the agent always has a way out).
- Re-enter while active: idempotent report (no state churn).

## Decision 3 — vibe ops mirror InteractiveMode's sequences verbatim

- vibe_enter: gates → `VibeSessionRegistry.ownerScope/activateScope` (same
  `VibeParentSession` facade the TUI builds) → base `["read"]` + `todo`
  when built-in → `activateVibeTools(base)` → `setVibeModeState({enabled:true})`.
- vibe_exit: `killAll(scope)` → `deactivateVibeTools(previous)` →
  `setVibeModeState(undefined)`.
- Persistent workers, delivery, lifecycle: all host machinery, untouched.

## Decision 4 — Honest unavailability instead of emulation

No bridge (sealed prebuilt dist host) → the tool returns an actionable error
pointing at the research doc. Faking plan/vibe semantics there would
re-introduce duplicated behavior and desync — the exact failure mode this
ADR exists to prevent.

## Deletions

- `tool_call` write guard + plan-path allowlist (`isPlanWritableTarget`)
- `before_agent_start` injections (`qol-*-mode-context`)
- `com.omp-qol.mode` appendEntry persistence + session_* rebuild handlers
- `goal_updated` event tracking (guards read live session state instead)
- director-lite toolset swapping; emulation state machine
- ~260 lines of src, ~450 lines of tests; net mode-tool.ts: 370 → 112 lines

## Verification

- Offline N1–N12 on fake live session/registry: 15/15 (goal suite 12/12).
- Live WRITE-PROOF (source host): plan state round-trip + native vibe
  toolset install/restore (`.sandbox/probe-host-bridge.ts`).
- RPC dumpTools PASS on installed AND source hosts + controls; doctor clean.
