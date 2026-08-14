# ADR-001: Goal tool — shadow + delegate, no pause, read-tier approval

Date: 2026-08-05 · Status: accepted · Context: QOL-001

## Decision 1 — Shadow the built-in `goal` name and delegate via `ctx.invokeTool`

- Rationale: keeps 100% native semantics (state, persistence, events,
  accounting) with no duplicated machinery; extension tools are active by
  default, solving the availability gap with one registration.
- Rejected alternatives:
  - *Reimplement goal state in the extension* (own entries/prompts):
    duplicates the runtime, desyncs from `/goal`, status line, budget
    accounting, and session-restore logic.
  - *`pi.setActiveTools([...,"goal"])` on session events*: native tool stays,
    but activation must be re-applied on every tool-roster rebuild and fights
    plan/goal-mode tool shuffling; also gives no graceful behavior when
    `goal.enabled` is false.

## Decision 2 — No `pause` op in the agent tool

- `GoalRuntime.pauseGoal()` is unreachable from the extension surface
  (no AgentSession handle; no RPC mutation; no slash-dispatch API).
- A persistence-only pause (`appendModeChange("goal_paused")`) would leave
  the live session's in-memory `#goalModeState` stale → subsequent
  `get`/budget accounting diverges from truth. Partial correctness rejected.
- The user retains `/goal pause`; the agent gets
  create/get/complete/resume/drop (full native tool surface, always active).
- Revisit if upstream exposes the runtime or adds `pause` to the native tool.

## Decision 3 — `approval: "read"` on the shadow tool

- Goal ops mutate only session bookkeeping; the native built-in runs ungated.
  Default `"exec"` would prompt per call and destroy the QoL.
- Escape hatch: users can set `tools.approval.goal: ask|deny` in config.

## Decision 4 — Kill switch via plugin setting `goalToolEnabled` (default true)

- Lets users disable the feature per-plugin without uninstalling; the
  extension factory is async-capable, so settings load before registration.

## Decision 5 — `loadMode: "essential"` (added during verification)

- Discovered empirically: extension tools default to `"discoverable"` and are
  then ABSENT from the schema sent to the model even when registered and
  active (`src/tools/essential-tools.ts`). Pinning `loadMode: "essential"`
  is mandatory for any extension tool the agent must always be able to call.
- Verified via RPC `dumpTools` and the `before_provider_request` payload
  (see docs/plans/impls/qol-001-impl-notes.md).
