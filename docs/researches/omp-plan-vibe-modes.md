# Research: OMP Plan Mode & Vibe Mode (v17.2.4 / source @ 5af71dc)

Date: 2026-08-05 · Follow-up to `omp-goal-system.md` · QOL-002/003

## 1. Plan mode

### User surface
- `/plan` slash command (interactive TUI), mutually exclusive with goal/vibe modes.
- `--plan-yolo` CLI flag: read-only plan mode at startup, auto-approve on first
  resolve, then switch model to implement.
- Session persistence via `appendModeChange("plan" | "plan_paused" | "none")`;
  restored on resume (`interactive-mode.ts:2547-2559`).

### Machinery (two layers)
1. **Session layer** (`agent-session.ts`):
   - `#planModeState` + public `getPlanModeState()` / `setPlanModeState()`.
   - Prompt injection: `#buildPlanModeMessage()` renders
     `plan-mode-active.md` into every turn while `state.enabled`.
   - Write guard: built-in `write` tool calls `enforcePlanModeWrite()`
     (`tools/plan-mode-guard.ts`) — throws unless target is inside the
     `local://` artifact sandbox; move/delete always rejected. Guard is
     driven purely by `session.getPlanModeState()?.enabled`.
   - Decision enforcement at settle: `#enforcePlanModeDecisionAtSettle()`.
2. **Interactive-mode layer** (`#enterPlanMode`, `interactive-mode.ts:2562+`):
   - Snapshots tools, keeps full set + ensures built-in `write` active.
   - Sets session state, installs plan-proposal handler (user review UI),
     steers live context if streaming, model-role switching.

### Extension reachability
- `setPlanModeState` lives on AgentSession — **NOT reachable** from
  extensions (same wall as GoalRuntime, QOL-001 research §5).
- Reachable equivalents: `pi.setActiveTools`, `tool_call` interception
  (fail-closed blocking), `before_agent_start` message injection
  (`{ message: CustomMessagePayload }`), `pi.appendEntry` persistence.
- write/edit param carrying the target: `path` (`tools/write.ts:299`).
  No bash plan-guard exists natively (bash relies on prompt + approval tier).

## 2. Vibe mode

### User surface
- `/vibe [directive]` — interactive-TUI-only command (`docs/vibe-mode.md`).
- Entering: activates parent worker scope, installs five director tools
  (`vibe_spawn/send/wait/kill/list`), reduces active tools to
  `read` + optional `todo` + vibe tools, injects director instructions.
- Mutually exclusive with plan/goal (active AND paused); blocks session
  fork/move/handoff while active.

### Machinery
- `createVibeTools(toolSession)` (`tools/vibe.ts:281`) — provided to
  top-level sessions only (`sdk.ts:3414`), installed via
  `SessionTools.activateVibeTools()` — both **session-side, unreachable
  from extensions**.
- The tools themselves are thin wrappers over `VibeSessionRegistry.global()`
  (`vibe/runtime.ts:380`) — but `spawn(session, …)` / `screens(session, …)`
  require a real `ToolSession` (asyncJobManager, agentOutputManager, model
  wiring, agent id). Forging a ToolSession from an extension is deep
  internal misuse — rejected (see ADR-002).
- Extension-visible crumbs: `ctx.getAsyncJobSnapshot()` (read-only).

### Agent-reachable delegation primitive
- Built-in `task` tool: one-shot subagents (ephemeral, not persistent
  workers). Always available in default tool sets.

## 3. Conclusion for QOL-002/003 (AMENDED by §4)

Unlike QOL-001 (native `goal` tool existed → pure delegation), there are NO
native plan/vibe tools to shadow. Original conclusion: extension-owned
emulation only. **This was wrong in general — see §4: it depends on the
host's distribution form.** The emulation remains the fallback for sealed
hosts.

- **Plan mode**: extension-owned controller CAN reproduce the agent-visible
  contract — write/edit guard via `tool_call` blocking (mirrors
  `enforcePlanModeWrite` allowlist: `local://` targets + plan files), per-turn
  instruction injection via `before_agent_start`, state persistence via
  `appendEntry`. Native proposal-review UI stays user-side.
- **Vibe mode**: native persistent-worker machinery is unreachable without
  forging a ToolSession. Honest scope: "director-lite" — director tool
  presentation + instructions over the built-in `task` subagents; persistent
  workers remain user-`/vibe`-only.

## 4. CORRECTION: the host-bridge discovery (2026-08-05, probe evidence)

§2/§3 claimed `AgentSession` is unreachable from extensions. That is only
true for ONE host form. Probes (`.sandbox/probe-host-bridge.ts`) showed:

### 4.1 The TUI handlers are thin session call sequences
`#enterPlanMode` / `#exitPlanMode` / `#enterVibeMode` / `#exitVibeMode`
(interactive-mode.ts) are sequences of PUBLIC session calls:
`setPlanModeState`, `setActiveToolsByName`, `setPlanProposalHandler`,
`preparePlanForReview`, `sendPlanModeContext`, `activateVibeTools`,
`deactivateVibeTools`, `setVibeModeState`, `VibeSessionRegistry.ownerScope /
activateScope / killAll`, `sessionManager.appendModeChange`.
`AgentRegistry.global().get("Main").session` IS the live `AgentSession`
(agent-registry.ts: the registry stores `session: AgentSession | null`).
So: if an extension can see the host's registry instance, it can drive modes
exactly like the TUI — no forging needed.

### 4.2 Module-instance duality is the only real barrier
- The installed host runs the sealed npm prebuilt bundle `dist/cli.js`
  (13MB; `setPlanModeState`/`activateVibeTools` inlined, class names
  mangled). Package exports map every `@oh-my-pi/*` subpath to the
  package's **src/** tree, so extension imports load a SECOND copy of the
  package: their static singletons (`AgentRegistry.#global`,
  `VibeSessionRegistry`) are distinct from the host's. Probe: registry
  stays `<empty>` forever under the installed host.
- The host's own compat layer (`extensibility/plugins/legacy-pi-compat.ts`)
  is designed to prevent exactly this: "plugins running against the exact
  runtime state of the host (single module registry, single tool registry)".
  In **compiled-binary** mode it serves imports through a
  `globalThis.__ompLegacyPiBundledModules` bridge; in **source-link/dev**
  mode the host itself runs the src tree, so imports share the instance.
  Only the installed-package mode (dist bundle + exported src) falls into
  the dual-copy trap.

### 4.3 Empirical results (win32-x64, omp 17.2.4 / monorepo @ 5af71dc)
- Installed host: `AgentRegistry.global().list()` → `<empty>` at t0/t2/t4/t6;
  `ctx.sessionManager` is the live SessionManager (full prototype incl.
  `appendModeChange` at runtime) but carries no back-reference to the
  session; no `globalThis` bridge (compiled-only). Verdict: emulation only.
- Source-link host (`bun packages/coding-agent/src/cli.ts`, plugin imports
  routed through a node_modules junction to the monorepo):
  `ROOT registry: Main(kind=main,status=running,session=live)`; ALL mode
  methods present; **WRITE-PROOF passed**: `setPlanModeState` round-trip
  `{enabled:true,planFilePath:"local://PLAN.md",...}` and
  `activateVibeTools(["read"])` produced active set
  `[read, vibe_spawn, vibe_send, vibe_wait, vibe_kill, vibe_list]`, then
  clean restore.

### 4.4 Consequence
QOL-002/003 ship a dual-backend `mode` tool: native control via the host
bridge when available (source-link / compiled hosts), emulation fallback on
sealed installed hosts. See ADR-003 and the v2 design.

## 5. The formal entry point exists inside the host (2026-08-05, round 3)

User challenge: no hardcoding — the plugin must only add an entry point onto
what TUI users already have. Final research findings:

1. **The host has a data-driven slash-command registry**
   (`slash-commands/builtin-registry.ts`): each builtin declares `handle`
   (text/ACP mode, `SlashCommandRuntime { session, sessionManager, settings,
   cwd, output, ... }` — "MUST NOT depend on TUI-only state") and/or
   `handleTui` (needs `InteractiveModeContext`). Dispatch for text callers:
   `executeAcpBuiltinSlashCommand(text, runtime)` — the official non-TUI
   entry point (used by ACP editor hosts).
2. **`/plan`, `/vibe`, `/goal`, `/plan-review` are `handleTui`-only by host
   design** — text/ACP callers intentionally don't get them; their TUI
   handlers are one-liners over `ctx.handlePlanModeCommand /
   handleVibeModeCommand / handleGoalModeCommand`.
3. **But ACP drives plan mode anyway** — `acp-agent.ts #applyModeChange`
   (`set_session_mode`): `setPlanModeState` + `setPlanProposalHandler`,
   commenting "Mirror InteractiveMode.#enterPlanMode". So the session-call
   sequence is the host's own cross-surface contract for non-TUI plan mode.
   ACP does NOT touch the tool list (session-level write guard suffices).
4. Vibe has no ACP equivalent; its session-level machinery
   (`VibeSessionRegistry` + `activateVibeTools` + `setVibeModeState`) works
   headless (WRITE-PROOF §4.3), and InteractiveMode's enter/exit are thin
   sequences over exactly those calls.

Conclusion (ADR-004): the `mode` tool is a thin driver of these host
primitives — plan ops shaped exactly like ACP's switch, vibe ops shaped
exactly like InteractiveMode's sequences, zero re-implemented behavior; the
ADR-003 emulation backend was deleted.

## 6. CORRECTION: the host injects its own module namespace (2026-08-06)

§4.2 called module-instance duality "the only real barrier" and shipped the
installed-host limitation ("mode reports unavailable on sealed hosts").
That conclusion was WRONG — it confused "the plugin's self-import resolves to
a second copy" with "the host's instance is unreachable". Evidence:

- `ExtensionAPI.pi: typeof PiCodingAgent`
  (`extensibility/extensions/types.ts:1121`, "Injected pi-coding-agent
  exports"): the extension loader hands the factory the HOST'S OWN module
  namespace object, whatever the host form. Being the live instance, its
  `AgentRegistry.global()` IS the running registry even inside the sealed
  installed binary — duality never applies to it.
- Root surface suffices for the bridge: `index.ts:40` re-exports `./sdk`,
  and `sdk.ts:640` exports `AgentRegistry`. `VibeSessionRegistry` is NOT in
  the root surface (only `vibe/runtime.ts:380`), but the bridge only needs
  its global singleton, reachable through the same injected namespace when
  the host exposes it, else the session-carried surfaces still cover
  plan/status.

Fix: `resolveHostBridge(injectedRoot?)` prefers the injected `pi.pi`
namespace; self-`import()` stays as fallback (source-link dev runs, tests).
Expected effect: plan/vibe/status work from `omp` on the installed host,
not just from source.

Process lesson: the delivery test matrix verified tool PRESENCE on the
installed host but never exercised a mode op END-TO-END there — the exact
path the user walks. Verification must cover the delivered launch form.

### 6.1 Delivery-form e2e PROOF (2026-08-06)

`.sandbox/e2e-workspace-mode.ts` runs the exact delivery form: installed
`omp --mode rpc` with cwd = `test-workspace` (project `settings.json`
extensions), user's real config. After `ready` it picks a relay model
(the user's default model was quota-blocked at test
time: `usage_limit_reached`), prompts "call 'mode' with op=status once",
and asserts the streamed `tool_execution_end` frame. Result — **PASS**:

```json
{"type":"tool_execution_end","toolName":"mode",
 "result":{"content":[{"type":"text","text":"plan: off | vibe: off | goal: none"}]},
 "isError":false}
```

The live status line came back from the sealed installed host through a
real LLM turn — the old "host form does not expose" refusal is gone.
Unit/integration regression: 43/43 (`bun test`, single process; the
kill-switch suites share one config root because the host's XDG
DirResolver pins it on first use per process).

**Coverage gap (admitted, found by user live test 2026-08-07):** §6.1 only
proved `op=status`. `vibe_enter` on the installed host still failed with
`VIBE_UNTRUSTED_REGISTRY` ("host form does not expose safely") — the
vibe ops were never part of the delivery-form e2e. §7 closes this
(fix + full-ops verification: §7.4).

## 7. CORRECTION-2: vibe ops on sealed hosts via the injected LIVE tool classes (2026-08-07)

### 7.1 Root cause of the sealed-host vibe refusal

The bridge resolves the vibe worker registry in two steps
(`src/lib/host-bridge.ts`):

1. `root.VibeSessionRegistry?.global()` on the injected namespace — but the
   host's root barrel (`packages/coding-agent/src/index.ts`) has **zero
   vibe exports** (grep-proven: no `Vibe*` in `index.ts`), so this is always
   undefined.
2. Fallback self-import `@oh-my-pi/pi-coding-agent/vibe/runtime` — on the
   sealed installed host this resolves to a SECOND module copy (§4.2/§4.3
   probe evidence), whose `VibeSessionRegistry.global()` singleton is a
   fresh empty registry. The `vibeRegistryTrusted` guard correctly refuses
   it: `killAll` on the wrong copy would silently orphan the host's real
   workers.

So on sealed hosts every vibe op hit `VIBE_UNTRUSTED_REGISTRY`. The guard
was right; the reach was missing.

### 7.2 The live surface that IS injected: the vibe tool classes

The root barrel exports `export * from "./tools"`, and
`tools/index.ts:107` does `export * from "./vibe"` — so the injected
namespace (`ExtensionAPI.pi`) carries the LIVE host classes
`VibeSpawnTool / VibeSendTool / VibeWaitTool / VibeKillTool / VibeListTool`
and `createVibeTools` (`tools/vibe.ts:103-289`) in EVERY host form. Their
bodies call `VibeSessionRegistry.global()` through the host bundle's own
static import — i.e. they always hit the REAL singleton, sealed host
included. Constructing them with a `VibeParentSession`-shaped facade
(`buildVibeParentSession`) drives live host code with zero reimplementation
(ADR-004 compliant: one more entry point onto host primitives).

Registry semantics that make this sound (`vibe/runtime.ts`):

- `ownerScope` is a pure computation over the parent session
  (ownerId/parentSessionId/parentSessionFile) — no hidden state.
- `#terminatedScopes` (spawn admission gate) is only ADDED by `killAll`
  and only REMOVED by `activateScope`. The per-worker `kill()` does not
  touch it. Therefore an exit built from per-id `kill` calls never
  terminates the scope, and a subsequent enter does not need
  `activateScope` — spawning stays admitted.
- `screens()`/`list` filter by scope derived from the session facade, so
  enumeration targets exactly our parent scope's workers.

### 7.3 Resulting op matrix

| bridge state | enter | exit |
| --- | --- | --- |
| trusted registry (source-link / shared-module world: dev runs, unit tests) | `ownerScope` + `activateScope` + `activateVibeTools` + `setVibeModeState` (InteractiveMode parity, unchanged) | `killAll` (mode-exit tombstones + scope termination, unchanged) |
| sealed host (injected namespace only) | `activateVibeTools` + `setVibeModeState` (no registry bookkeeping needed, §7.2) | enumerate via live `VibeListTool`, kill each via live `VibeKillTool` (explicit-kill tombstones), then `deactivateVibeTools` + `setVibeModeState(undefined)` |
| neither | honest refusal | honest refusal |

Known residual limitation (documented, not fixable from outside):
if the TUI's own `/vibe` was entered AND exited earlier in the same
process, `killAll` left the scope in `#terminatedScopes` of the live
registry; only `InteractiveMode.#enterVibeMode` clears it. Our sealed-path
enter then lets the mode switch succeed but the first `vibe_spawn` fails
with the host's own message "Vibe mode has exited; enter Vibe mode again".
Recovery: `/vibe` once in the TUI. In-process TUI-then-agent interleaving
is an edge case; agent-first flows never hit it.

### 7.4 Verification (2026-08-07, after the fix)

Implementation: `src/lib/host-bridge.ts` (VibeListTool/VibeKillTool on
`HostRootSurface`; subpath self-import gated to `!usedInjected`) and
`src/mode-tool.ts` (dual-path enter/exit with a `via: registry|tools`
marker so exit always mirrors the entry path).

| layer | evidence | result |
| --- | --- | --- |
| unit (new T1–T6) | sealed bridge + fake injected tool classes: enter installs the host toolset with no registry bookkeeping; exit lists→kills per id, restores toolset; resistant worker doesn't strand exit; re-enter works; refusal when neither surface; trusted registry takes precedence | 6/6 PASS |
| full suite | `bun test` per file (DirResolver pinning) | 49/49 PASS (12 goal + 22 mode + 8 bridge + 7 integration) |
| typecheck | `tsc --noEmit`, zero errors in `src/` (remaining diagnostics are pre-existing host `.md`-import noise in ref_repos) | PASS |
| reinstall | `.sandbox/install-plugin.ts` refreshed the cache copy + both registries | VERDICT: PASS |
| registry probe | host's own `getEnabledPlugins` + project registry read | PASS (runtime + UI surfaces) |
| live wiring | `verify-live.ts` (13 tools, mode/goal with [qol] marker, schema carries all 5 ops) + `--control` (11 tools, both absent) | PASS / PASS |
| **delivery e2e (the gap)** | `.sandbox/e2e-workspace-mode.ts` extended to run ALL ops on the installed sealed host through real LLM turns: status → plan_enter → plan_exit → vibe_enter → vibe_exit → status | **PASS, 6/6 steps** |

Captured frames from the sealed installed host (relay-pool model):

```
op=status      "plan: off | vibe: off | goal: none"                 isError:false
op=plan_enter  "Plan mode is now ACTIVE — objective: e2e ..."       isError:false
op=plan_exit   "Plan mode exited; the working tree is writable ..." isError:false
op=vibe_enter  "Vibe (director) mode is now ACTIVE — directive: ..." isError:false
op=vibe_exit   "Vibe mode exited; previous toolset restored."       isError:false
op=status      "plan: off | vibe: off | goal: none"                 isError:false
```

The exact failure the user reported (`vibe_enter` →
"host form does not expose safely") is gone: vibe enter/exit now run
against the host's own live machinery on the installed binary, and the
final status proves the round trip left the session clean.

