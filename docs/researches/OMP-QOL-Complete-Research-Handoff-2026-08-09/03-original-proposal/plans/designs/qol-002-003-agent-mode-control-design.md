# QOL-002/003 Design: Agent-controlled Plan & Vibe Modes

Status: **v3 final (2026-08-05)** — thin driver only (ADR-004). v1's
emulation and v2's dual backend are superseded; the v1 body below is kept
only as historical record of the rejected approach. Delivery-tested via the
full L1–L5 pyramid (see `../TDDs/qol-delivery-test-plan.md`); one real
defect (vibe exit-switch loss) was caught and fixed in the real-LLM e2e
layer, plus a follow-up type-hygiene pass (`bun run typecheck` clean).

## v3 in one paragraph

The user already has these features via `/plan` and `/vibe`; the plugin's
only job is to add an entry point. The `mode` tool resolves the live
`AgentSession` (host bridge) and drives the same host primitives the TUI
uses — plan ops shaped exactly like the host's own non-TUI switch (ACP
`#applyModeChange`), vibe ops exactly like InteractiveMode's sequences.
Zero re-implemented behavior; sealed dist hosts get an honest error instead
of emulation.

## v2 (superseded by v3)

The `mode` tool resolves the live host session on every call via the root
`@oh-my-pi/pi-coding-agent` import + `AgentRegistry.global()` (host bridge).
When the live `AgentSession` is visible (source-link / compiled-binary
hosts), ops drive the exact InteractiveMode call sequences — real native
plan/vibe semantics including persistent vibe workers and host-native
resume persistence. When the host is the sealed prebuilt dist bundle
(bridge null), the v1 emulation below applies unchanged.

## v1 body (emulation backend) — kept as the fallback spec

Status: approved for implementation · Depends on: `docs/researches/omp-plan-vibe-modes.md`

## Problem

`/plan` and `/vibe` are user-only interactive commands. The agent cannot
enter or leave either mode on its own judgment.

## Constraint recap (why this differs from QOL-001)

QOL-001 delegated to an existing native tool. Plan/vibe have **no native
tools** — their machinery lives on `AgentSession`/`InteractiveMode`
(unreachable). So these are extension-owned controllers that reproduce the
agent-visible contract with documented extension primitives only
(ADR-002 bounds the scope honestly).

## Surface: one `mode` tool

```text
mode(op: "plan_enter" | "plan_exit" | "vibe_enter" | "vibe_exit" | "status",
     objective?: string)
```

- `loadMode: "essential"` (QOL-001 lesson), `approval: "read"`.
- Single tool keeps the schema small; ops mirror the user commands.
- Kill switch: plugin setting `modeToolEnabled` (default true).

## QOL-002: plan mode controller

### Enter (`plan_enter`)
1. Guards: reject if QoL plan/vibe already active; reject if a non-terminal
   goal is known active (tracked via `goal_updated` events + our own goal
   tool calls) — mirrors native `/plan` mutual exclusion.
2. Activate the **write guard**: `tool_call` handler blocks `write` and
   `ast_edit` unless the target `path` is allowlisted:
   - any `local://` scheme target (session artifact sandbox — mirrors
     `enforcePlanModeWrite`),
   - files named `PLAN.md` or `*-plan.md` (case-insensitive).
   Block reason tells the model where to write instead. `bash` stays
   ungated exactly like native plan mode.
3. Persist state: `pi.appendEntry("com.omp-qol.mode", { mode: "plan", ... })`.
4. Result text carries the plan-mode instructions (draft the plan file,
   no working-tree edits, `mode plan_exit` when done, then confirm with the
   user before implementing).

### While active
- `before_agent_start` injects a hidden reminder message every turn
  (`customType: "qol-plan-mode-context"`, `display: false`).

### Exit (`plan_exit`)
- Deactivate guard, persist `{ mode: null }`, confirm in result text.

## QOL-003: vibe mode controller (director-lite, honest scope)

### Enter (`vibe_enter`)
1. Same mutual-exclusion guards as plan.
2. Snapshot `pi.getActiveTools()`, then `pi.setActiveTools()` the director
   set: `read`, `todo`, `task`, `goal`, `mode` (filtered to what exists).
3. Persist + result text with director instructions: decompose into
   independent workstreams, one `task` call each with a self-contained
   brief, verify claims by reading touched files, `mode vibe_exit` when the
   outcome is reached.

### While active / Exit
- Same `before_agent_start` reminder pattern (`qol-vibe-mode-context`).
- `vibe_exit` restores the snapshot (filtered to current registry) and
  persists `{ mode: null }`.

### Documented divergence from native `/vibe`
- No persistent workers / `vibe_*` tools — delegation uses one-shot `task`
  subagents. Native worker lifecycle stays user-`/vibe`-only. ADR-002.

## Shared behavior

- `status` op: reports QoL mode + known goal state.
- **Rebuild on session lifecycle**: `session_start` / `session_branch` /
  `session_tree` rescan the branch for the latest `com.omp-qol.mode` entry
  and re-arm guard / director toolset — so resume/branch keeps the mode.
- Controller state lives in the factory closure (fresh per session load);
  nothing module-global, so multi-session hosts stay isolated.
- Subagent sessions: `restrictToolNames` hosts ignore extension tools
  (`sdk.ts:2623`); the gate only acts when the per-session state says plan
  mode is on, so subagents are unaffected.

## Interaction with native commands (documented limits)

- Native `/plan` entered by the user afterwards: both guards stack
  harmlessly (both read-only). Native `/vibe` while ours active: user
  command wins visually; our director set stays until `vibe_exit`.
- We cannot observe native mode state; the status op reports QoL state only.

## Verification strategy

1. **Offline harness** (bun test): controller state machine on a mock
   `ExtensionAPI` — enter/exit transitions, guard allow/deny matrix
   (local://, PLAN.md, working-tree paths, ast_edit, bash passthrough),
   mutual exclusion, double-enter, exit-without-enter, snapshot restore,
   rebuild-from-entries, goal-exclusion via simulated `goal_updated`.
2. **Live wiring**: RPC `dumpTools` contains `mode` (essential); control
   run without extensions does not; provider payload probe parity with
   QOL-001's L5 check.
3. **Native backend (v2)**: N1–N8 offline on a fake live session; live
   WRITE-PROOF on the source-link host (`setPlanModeState` round trip;
   `activateVibeTools` installs the five vibe tools; clean restore).
   Reproduce: `OMP_QOL_PROBE=1` + `.sandbox/probe-host-bridge.ts`.
