# ADR-002: Plan/vibe modes — extension-owned controllers, no internal forging

Date: 2026-08-05 · Status: **SUPERSEDED by ADR-003** (host-bridge discovery:
the "unreachable" premise held only for the sealed installed host; on
shared-instance hosts we now drive the native machinery directly). The
emulation described here survives as the fallback backend.
Context: QOL-002/003

## Decision 1 — Extension-owned controllers instead of native delegation

- Unlike QOL-001, there are no native plan/vibe tools to shadow; the mode
  state setters (`setPlanModeState`, `activateVibeTools`) live on
  `AgentSession`, which extensions cannot reach.
- Rejected: forging/reconstructing internal state through other seams
  (e.g. writing `appendModeChange` entries via the runtime SessionManager
  behind `ctx.sessionManager`) — the live session's in-memory state would
  stay stale, same desync class rejected in ADR-001 decision 2.
- Accepted: reproduce the agent-visible contract with supported primitives
  only: `tool_call` blocking, `before_agent_start` injection,
  `setActiveTools`, `appendEntry`.

## Decision 2 — Plan guard mirrors `enforcePlanModeWrite` allowlist

- Block `write`/`ast_edit` targets except `local://` scheme paths and
  `PLAN.md`/`*-plan.md` files. `bash` stays ungated (native parity).
- The guard is fail-closed by construction (`tool_call` errors block).

## Decision 3 — Vibe is "director-lite", not faked native vibe

- `VibeSessionRegistry.global().spawn()` requires a genuine `ToolSession`
  (asyncJobManager, agentOutputManager, model wiring). Constructing one
  from an extension is deep internal misuse and version-fragile — rejected.
- Accepted: director presentation + instructions over the built-in `task`
  tool, with the divergence documented in the tool's own result text.
- Upgrade path: if upstream ever exposes session/ToolSession handles to
  extensions, switch to native delegation as in QOL-001.

## Decision 4 — One `mode` tool, five ops, essential loadMode

- `plan_enter | plan_exit | vibe_enter | vibe_exit | status`.
- `loadMode: "essential"` (ADR-001 decision 5 applies verbatim).
- Mutual exclusion enforced among QoL modes plus known-active goals
  (tracked from `goal_updated` events), mirroring native `/plan` gating.

## Decision 5 — Kill switch setting `modeToolEnabled` (default true)

- Same pattern as QOL-001's `goalToolEnabled`; factory-time settings load.
