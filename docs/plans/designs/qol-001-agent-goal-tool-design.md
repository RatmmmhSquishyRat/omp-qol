# QOL-001 Design: Agent-facing Goal Tool

Status: approved for implementation · Depends on: `docs/researches/omp-goal-system.md`

## Problem

In stock omp the LLM agent can never initiate or manage a goal: the native
`goal` tool is only added to the active tool set after the **user** enters
goal mode (`/goal set`). The agent has zero goal operations until then.

## Goal

The main agent can always view and manipulate the session goal — the same
operations the native goal machinery supports — without any user action,
while reusing the native goal runtime 100% (state, persistence, budget
accounting, `goal_updated` events, status line, resume-on-restart).

## Mechanism: shadow + native delegation

`omp-qol-extension` registers a tool **named `goal`**, shadowing the hidden
built-in:

1. Host startup (`sdk.ts:2651-2663`) creates the native `goal` tool whenever
   settings `goal.enabled` is true and captures it into `nativeToolsByName`
   *before* extension tools overwrite registry entries.
2. Our registered `goal` tool replaces the registry entry and — as an
   extension tool — is **active by default**, so the LLM always sees it.
3. `execute()` delegates every op to the native tool through the documented
   `ctx.invokeTool(params)` same-tool delegation (`docs/extensions.md`
   §"Delegating to a native built-in"). All native semantics are preserved:
   `GoalRuntime` mutations, `appendModeChange` persistence, `goal_updated`
   events, token/wall-clock accounting, budget-limit steering.

```text
LLM ── goal(op,…) ──▶ qol extension tool ── ctx.invokeTool ──▶ native GoalTool ──▶ GoalRuntime
                          (always active)         (same-tool, no re-gate)        (native state/persist/events)
```

## Operation surface

| op | native? | semantics |
|---|---|---|
| `create` | ✅ delegate | requires `objective`, optional positive-int `token_budget`; fails if a non-terminal goal exists |
| `get` | ✅ delegate | current goal or "No active goal." |
| `complete` | ✅ delegate | marks goal complete (+ budget report) |
| `resume` | ✅ delegate | resumes paused goal |
| `drop` | ✅ delegate | drops goal, clears state |
| `pause` | ❌ not exposed | see ADR-001: `GoalRuntime` unreachable from extension surface; fake pause would desync live in-memory state. User keeps `/goal pause`. |

## Failure modes handled

- `ctx.invokeTool === undefined` (host has no native goal tool: `goal.enabled`
  false, restricted tool mode, older host) → friendly, actionable error text
  instead of a throw.
- Native delegation rejects (validation / state errors like "already has a
  goal") → surfaced as `isError` result with the native message.
- Plugin-level kill switch: plugin setting `goalToolEnabled` (default true);
  when false the tool is not registered at all (factory is async-capable).

## Approval

Tool declares `approval: "read"` — goal ops are session bookkeeping (no
filesystem/system mutation); the native built-in itself runs ungated.
Deliberate choice, see ADR-001. Users can still override via
`tools.approval.goal` policies.

## Interaction with existing flows (verified against source)

- `/guided-goal` explicitly activating `goal`: no conflict — tool already
  present in registry; `setActiveToolsByName` keeps working.
- User `/goal set` afterwards: `GoalRuntime` state is shared; our `get`
  reflects it. `#enterGoalMode` early-returns if already in goal mode.
- **Safety**: agent-created goals do NOT start interactive auto-continuation
  (gated by mode-owned `goalModeEnabled`, research §6). No runaway loops.
- Completion cleanup (`mode: "exiting"`) still happens lazily at next input.

## Verification strategy

1. **Offline harness** (`bun test`): faithful mock of native `invokeTool`
   (state machine + error semantics) → delegation contract, pass-through,
   error surfacing, schema validation, kill switch. See `docs/plans/TDDs/`.
2. **Live wiring**: isolated omp in `--mode rpc`; `get_state` → `dumpTools`
   must contain our `goal` entry; control run with `--no-extensions` must not.
3. **Live load**: `[omp-qol]` log markers at registration.
