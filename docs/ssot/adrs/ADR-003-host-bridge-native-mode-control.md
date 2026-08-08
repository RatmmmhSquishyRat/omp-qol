# ADR-003: Host bridge first, emulation second (supersedes ADR-002; emulation part superseded by ADR-004)

Date: 2026-08-05 · Status: accepted · Trigger: user challenge — "TUI 能调的
命令背后就是函数,同进程就能触发"; verified empirically the same day.

## What changed

Probe evidence (`docs/researches/omp-plan-vibe-modes.md` §4) showed
ADR-002's premise ("AgentSession unreachable") is host-form-dependent:

- `AgentRegistry.global()` holds `Main → live AgentSession`; the TUI's
  `/plan`/`/vibe` handlers are thin sequences of its public methods.
- When the extension shares the host's module instance (source-link dev
  runs; compiled-binary installs via the `__ompLegacyPiBundledModules`
  bridge), the root specifier hands us that registry → full native control.
- Only the installed prebuilt `dist/cli.js` host loads a second package
  copy for extension imports; there the bridge resolves null.

## Decision 1 — Dual backend, per-call resolution

`mode` tool resolves the bridge on every op (`resolveHostBridge()`):
native sequences when the live session is visible, the ADR-002 emulation
otherwise. No cached assumption: bridge availability can change across
host forms/sessions.

## Decision 2 — Native sequences mirror InteractiveMode exactly

- plan_enter: guards (plan/vibe/goal live states) → keep tools + built-in
  `write` → `setActiveToolsByName` → `setPlanModeState({enabled:true,
  planFilePath, workflow:"parallel"})` → `setPlanProposalHandler(title →
  preparePlanForReview(title))` → steer context if streaming →
  `appendModeChange("plan", {planFilePath})`.
- plan_exit: `setPlanModeState(undefined)` → restore tools →
  `setPlanProposalHandler(null)` → `appendModeChange("none")`.
- vibe_enter: guards → `VibeSessionRegistry.ownerScope/activateScope` with
  the same `VibeParentSession` facade InteractiveMode builds → base tools
  `read`(+`todo`) → `activateVibeTools` → `setVibeModeState({enabled:true})`
  → `appendModeChange("vibe")`.
- vibe_exit: `killAll(scope)` → `deactivateVibeTools(previous)` →
  `setVibeModeState(undefined)` → `appendModeChange("none")`.
- Model-role switching (plan-role model) stays out of scope: it is a
  TUI-level nicety, not part of the mode contract.

## Decision 3 — Sanity-gate the bridged object

The bridge requires the exact method surface (setPlanModeState,
getPlanModeState, activateVibeTools, deactivateVibeTools,
getEnabledToolNames, sessionManager). Anything partial → refuse → emulation.
Never act on a half-recognized session object.

## Decision 4 — Native mode needs no emulation scaffolding

With native state set, the session's own machinery provides write guard,
prompt injection, decision enforcement, resume (`appendModeChange` is the
host's own persistence). Our `tool_call` gate / `before_agent_start`
injection / `com.omp-qol.mode` entries apply ONLY on the emulated path —
keeping the two backends from interfering.

## Verification

- Offline N1–N8 (fake live session + registry) + M1–M10 emulation, 38/38.
- Live WRITE-PROOF on source-link host (state round-trip + vibe tools
  install/restore).
- RPC dumpTools PASS on both hosts (13 tools w/ markers) + controls (11).
- doctor clean; kill-switch setting unchanged (`modeToolEnabled`).
