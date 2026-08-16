# H6: Plugin Seams — What omp-qol Reaches Today vs What ICM Needs

**Track:** H6 (`research/00-index.md`)  
**Date:** 2026-08-16  
**Scope:** Inventory `plugin/src/**`, `plugin/types/**`, ADR-004, ADR-005, `host-bridge.ts`, `main.ts`, `advisor-tool.ts` (envelope/UX only). No product code.  
**Host baseline:** peer `@oh-my-pi/pi-coding-agent >=17.3.0`; research host @ `de6b7974a0` (17.3.4).

---

## Executive summary

omp-qol today is a **thin-driver plugin** over **existing** host surfaces (goal shadow-delegate, plan/vibe session calls, advisor/config + `AgentSession` advisor methods). It reaches the **live main session** via `ExtensionAPI.pi` → `AgentRegistry.global().list()` and reads a **narrow slice** of `sessionManager` (identity, cwd, mode journal, `buildSessionContext().mode`). It registers **three agent tools** with a shared **pure-JSON envelope** and **per-tool kill switches**.

ICM is categorically different: overlay compression, pin, and seal are **not host features to expose** — they are **new engine work** on extension hooks the current plugin **does not use at all** (`pi.on("context")`, `pi.on("session_before_compact")`, `pi.appendEntry`). ADR-004 still applies, but its “no emulation” rule targets **duplicating host behavior that already exists** (plan write-guard, advisor runtime, etc.), not **building net-new overlay machinery** where the host provides hooks but no product.

---

## 1. Live session fields in use today

### 1.1 `LiveHostSession` (declared in `plugin/src/lib/host-bridge.ts`)

The bridge types and sanity-checks these **optional** methods on the live main `AgentSession`:

| Surface | Methods / fields | Used by |
|---|---|---|
| Plan mode | `getPlanModeState`, `setPlanModeState`, `getPlanReferencePath`, `setPlanProposalHandler`, `preparePlanForReview`, `sendPlanModeContext` | `mode-tool` (enter/exit/status); bridge sanity gate |
| Goal mode | `getGoalModeState` | `mode-exclusivity`, `goal-tool` guards |
| Vibe mode | `getVibeModeState`, `setVibeModeState`, `activateVibeTools`, `deactivateVibeTools`, `getEnabledToolNames`, `setActiveToolsByName`, `hasBuiltInTool` | `mode-tool`; bridge sanity gate |
| Session identity | `getAgentId`, `asyncJobManager`, `settings.get(key)` | `buildVibeParentSession`; plan.enabled gate |
| Streaming | `isStreaming` | typed only; not read in current tools |
| Advisor (QOL-004) | `applyAdvisorConfigs`, `setAdvisorEnabled`, `isAdvisorEnabled`, `isAdvisorActive`, `getAdvisorStats`, `formatAdvisorStatus`, `formatAdvisorHistoryAsText` | `advisor-tool`; `sessionHasAdvisorSurface()` |

**Bridge gate:** `resolveHostBridge` returns `null` unless plan/vibe **and** `sessionManager` exist (lines 207–216). Advisor has a **separate** surface check (`sessionHasAdvisorSurface`) so missing advisor methods refuse advisor ops only (ADR-005 §Decision 6).

### 1.2 `sessionManager` — what is actually touched

Declared on `LiveHostSession.sessionManager`:

| Method | Return / args | Production use |
|---|---|---|
| `getSessionId()` | `string \| null` | `buildVibeParentSession` facade |
| `getSessionFile()` | `string \| null` | `buildVibeParentSession` facade |
| `appendModeChange(mode, modeData?)` | void | `mode-tool` on `plan_enter` / `plan_exit` — writes journal the TUI also uses |
| `getCwd?()` | `string` | `advisor-tool` cwd resolution (fallback: `process.cwd()`) |
| `buildSessionContext?()` | `{ mode?: string }` | **Authoritative mode projection** — `mode-exclusivity.resolvedSessionMode()` |
| `getEntries?()` | `Array<{ type?, mode? }>` | **Fallback** when `buildSessionContext` absent (tests); `lastJournalMode()` scans for last `mode_change` |

**Not used anywhere in current plugin code:**

- `appendEntry` (removed with ADR-004 deletions; was `com.omp-qol.mode` persistence)
- Branch APIs (`getBranch`, branch-aware replay)
- Full entry typing (`SessionEntry.id`, tool results, custom types)
- Any read of entries beyond `type === "mode_change"` tail scan
- `buildSessionContext` fields other than `mode` (if the host exposes more, the plugin ignores them)

### 1.3 `buildSessionContext().mode` semantics (mode-exclusivity)

From `plugin/src/lib/mode-exclusivity.ts`:

- **Preferred:** `sessionManager.buildSessionContext().mode` — leaf-to-root projection; same call InteractiveMode uses on resume (`plan_paused`).
- **Fallback:** last `mode_change` entry in `getEntries()` (not branch-aware).
- **Values observed in tests:** `"plan"`, `"plan_paused"`, `"none"`, and journal modes written by `appendModeChange`.
- **Explicit non-use:** journal `vibe` is **not** treated as occupancy — TUI vibe exit does not write `mode_change none`; live `getVibeModeState().enabled` wins.

### 1.4 `applyAdvisorConfigs` and related

Used only in `advisor-tool.ts`:

- Mutate path: `nativeSaveConfigFile` → `nativeDiscoverAdvisors` → `applyAdvisorConfigs(advisors, sharedInstructions)` → returns **active runtime count**.
- `enable`/`disable`: **only** `setAdvisorEnabled` — never discover/apply (ADR-005 §Decision 3).
- Read path: `getAdvisorStats`, `isAdvisorEnabled`, `isAdvisorActive`, `formatAdvisorStatus`, `formatAdvisorHistoryAsText`.

### 1.5 `getEntries` usage summary

- **Production:** effectively **unused** when real `SessionManager` provides `buildSessionContext`.
- **Tests:** fake sessions without `buildSessionContext` rely on `getEntries` for mode exclusivity cases (N2e, N2f in `mode-tool.test.ts`).
- **ICM implication:** the plugin already documents that `getEntries` alone is a weak fallback; ICM must not treat index scans as identity — pillars require `(sessionId, entryId)`.

---

## 2. Context event handler — present?

**No.** Confirmed by repo search:

| Hook / API | In plugin today? |
|---|---|
| `pi.on("context", …)` | **No** |
| `pi.on("session_before_compact", …)` | **No** |
| `pi.on("before_agent_start", …)` | **No** (explicitly deleted per ADR-004) |
| `pi.appendEntry(…)` | **No** (deleted with mode emulation) |
| `pi.on("session_start", …)` | **Yes** — `main.ts` only (settings log + optional greeting + probe) |

The ambient stub `plugin/types/host-ambient.d.ts` types `pi.on(event, handler)` generically but does **not** declare `context` or `session_before_compact` shapes. ICM will need **new** event registrations and likely **expanded ambient types** (or imports from host types in a dedicated ICM module).

Foundation handoff (`12-EVIDENCE-LEDGER.md`) notes: extension API supports context event results and `appendEntry`, but **no handler priority** — relevant for ICM overlay ordering, not for omp-qol today.

---

## 3. Tool registration, approval tiers, pure-JSON envelope — patterns ICM should copy

### 3.1 Registration (`main.ts`)

```text
bootSettings = await loadSettings(PLUGIN_NAME, process.cwd())
if (bootSettings.<feature>ToolEnabled) registerXTool(pi)
pi.on("session_start", …)  // reload settings per cwd
pi.registerCommand("qol-config", …)  // surfaces all kill switches
```

- Factory is **async**; settings load **before** registration so kill switches apply from first session.
- **No runtime actions** during factory load (host throws `ExtensionRuntimeNotInitializedError`).
- Each tool lives in its own module with `registerXTool(pi, options?)` and test seams (`resolveBridge`, etc.).

### 3.2 `registerTool` contract (all three tools)

| Field | goal | mode | advisor | ICM note |
|---|---|---|---|---|
| `name` | `goal` | `mode` | `advisor` | Single tool, multi-op enum is proven (advisor: 10 ops) |
| `loadMode` | `"essential"` | `"essential"` | `"essential"` | **Required** for LLM schema visibility (`plugin/README.md`) |
| `approval` | static `"read"` | static `"read"` | **dynamic** `(args) => READ_OPS.has(op) ? "read" : "write"` | ICM should tier read (list/get/status) vs write (mutate overlay/pin) |
| `description` | `[qol]` marker + op list | same | same | Long, operational descriptions reduce model misuse |
| `parameters` | zod via `pi.pi.zod ?? pi.zod` | same | same | Prefer injected host zod on sealed binary |
| `execute` | delegates via `ctx.invokeTool` | drives bridge | drives bridge + native | AbortSignal checked early |

### 3.3 Pure-JSON envelope (advisor-tool is canonical; mode/goal match)

**Success:**

```json
{
  "ok": true,
  "tool": "<name>",
  "op": "<op>",
  "summary": "optional one-liner",
  "...fields": "...",
  "warnings": []
}
```

**Failure:**

```json
{
  "ok": false,
  "tool": "<name>",
  "op": "<op>",
  "error": "human actionable",
  "action": "optional next step"
}
```

**Rules (from `advisor-tool.ts` comments + implementation):**

1. `content[0].text` is **`JSON.stringify(body, null, 2)`** — no prose prefix; `JSON.parse(text)` must work.
2. Same object mirrored in `details`.
3. Failures set `isError: true`.
4. Human-readable one-liner lives **inside** body as `summary` or `message`, never prefixed outside JSON.
5. Default `warnings: []` on success if omitted.
6. `goal-tool` wraps native tool output into the same envelope after `invokeTool`.

**ICM should copy:** one parse rule across compress/pin/tree tools; `warnings` for non-fatal semantics (shadow entries, cache frontier hints); `action` on failures pointing to user/TUI/host settings.

### 3.4 Approval tiering pattern (ADR-005 amendment)

```typescript
const READ_OPS = new Set(["list", "get", "status", "dump"]);
approval: (args) => typeof args?.op === "string" && READ_OPS.has(args.op) ? "read" : "write"
```

Host `ToolApproval` supports function form — first-class contract. ICM mutate ops (pin, compress seal, overlay writes) should be `"write"`; introspection ops `"read"`.

### 3.5 Other UX patterns worth reusing

- **Bridge-unavailable errors** name the failure and point to user path (`/plan`, `/advisor`, retry when session active).
- **Per-path serialization** (`withPathLock` in advisor-tool) for concurrent mutates against one file — ICM may need analogous **per-session overlay locks**.
- **Anti-clobber guards** before persisting when parser sees empty but disk is non-empty — analogous discipline for overlay state files.
- **Test seams:** `resolveBridge`, `resolveNative`, `getCwd` overrides — ICM engine should expose hooks for fake context/compaction events.

---

## 4. Host-bridge: reuse vs new reach

### 4.1 Reuse as-is

| Pattern | Location | ICM use |
|---|---|---|
| `ExtensionAPI.pi` as `HostRootSurface` | all tools | If ICM needs live session for tool ops, same injection path |
| `resolveHostBridge(injectedRoot)` | `host-bridge.ts` | Optional for tools that gate on live session; **not sufficient alone for overlay** |
| `AgentRegistry.global().list()` → `kind === "main"` | `host-bridge.ts` | Same live-session discovery |
| Self-import fallback + honest null | `host-bridge.ts` | Keep fail-honest when sealed host lacks registry |
| `buildVibeParentSession` | `host-bridge.ts` | Template for minimal session facades if ICM constructs host-facing objects |
| `loadSettings` + kill switch at registration | `settings.ts`, `main.ts` | `contextToolEnabled` / `icmToolEnabled` same pattern |
| `session_start` settings reload | `main.ts` | Per-project overrides |
| Mode journal write via `appendModeChange` | `mode-tool.ts` | Shows **host-native** journal mutation (not `appendEntry`) — ICM should prefer **`pi.appendEntry(customType)`** for overlay state per foundation research |

### 4.2 Partial reuse (extend types, do not conflate gates)

- **`LiveHostSession`:** grow new optional methods only when host exposes them on `AgentSession`; do **not** fold ICM requirements into the plan/vibe bridge null gate.
- **`sessionManager`:** ICM needs **`appendEntry`**, full **`getEntries` / branch replay**, and likely **`buildSessionContext` beyond `mode`** — extend bridge types separately from QOL-002/003 sanity check.

### 4.3 New reach ICM requires (absent from plugin today)

| Capability | Host API (per foundation / H2 track) | Current plugin |
|---|---|---|
| Overlay persistence | `pi.appendEntry(customType, data)` | Not called |
| Outbound context transform | `pi.on("context", handler)` → return modified messages | Not registered |
| Compaction seal | `pi.on("session_before_compact", …)` → custom `CompactionResult` | Not registered |
| Stable addressing | `SessionEntry.id`, branch-aware `getBranch()` | Not used |
| Entry-id pin/compress targets | Read full journal, not mode tail | Not implemented |
| Projection preview | Context event dry-run / reducer | Not implemented |

**Important distinction:** QOL mode tool writes **`sessionManager.appendModeChange`** (host journal API on the live session object). ICM overlay state should use **`pi.appendEntry`** (extension persistence API on `ExtensionAPI`), which is a **different seam** — the deleted ADR-004 emulation used `appendEntry("com.omp-qol.mode", …)`; ICM would use new custom types (e.g. `com.omp-qol.icm-pin`, `com.omp-qol.dcp-block` per research).

### 4.4 Bridge vs extension hooks — architectural split

```text
Thin-driver tools (goal/mode/advisor):
  Tool execute → resolveHostBridge → AgentSession methods

ICM overlay engine (new):
  pi.on("context") / pi.on("session_before_compact")
  pi.appendEntry(customType, …)
  Optional agent tool for initiative ops (compress/pin/list/…)
  Reducer reads append-only custom entries + canonical journal
```

ICM should **not** route overlay projection through `resolveHostBridge` alone; hooks fire on **`pi`**, not on `AgentSession`. Bridge remains useful for **tool ops that need live session metadata** (sessionId, cwd, streaming guard) and for **consistency with existing QOL patterns**.

---

## 5. ADR-004 tension: thin driver vs overlay engine

### 5.1 What ADR-004 actually forbids

From `docs/ssot/adrs/ADR-004-thin-driver-no-emulation.md`:

- Re-implementing **host-owned behavior** the TUI/ACP already perform (plan write-guard, prompt injection, vibe worker lifecycle, advisor runtime).
- **Emulated fallbacks** when the live session is unreachable (fake plan/vibe state).
- Deleted mechanisms: `before_agent_start` injection, `appendEntry` mode rebuild handlers, director-lite toolset swapping, write-guard allowlists.

The trigger quote: add **calling entry points** for features the **user can already use** — not “never add new functionality.”

### 5.2 Why ICM is not blocked

Pillar README (2026-08-16) and `INVARIANTS.md` state explicitly:

> This module is **not** thin-driver exposure of existing host capability; the **feature does not exist**.

ICM builds on **extension hooks** (`context`, `session_before_compact`, `appendEntry`) where the host provides **mechanism** but **no product** for initiative compress/pin/tree. That is **new engine work**, analogous to using a public API — not emulating `/plan` or `SessionAdvisors`.

### 5.3 How to apply the law without blocking ICM

| Do | Don't |
|---|---|
| Implement overlay as **append-only custom entries** + **context event projection** | Re-implement native compaction, native pin UI, or destructive message edits |
| Return **custom `CompactionResult`** from `session_before_compact` when sealing | Run a parallel summarizer that duplicates host compaction when host already sealed |
| Use **stable entry IDs** from host journal | Use array indexes as pin/compress addresses |
| Fail honestly if hook unavailable on a host form | Fake projection or silent no-op that desyncs canonical journal |
| Keep agent tools as **thin drivers over the overlay engine** (ops invoke reducer + appendEntry) | Put overlay logic only inside tool execute without event handlers |
| Document **new ADR** (ICM-specific) for overlay boundaries | Silently rewrite ADR-004 or pillars |

**Framing:** ADR-004 is the **anti-duplication** law for **existing host features**. ICM needs a **sibling ADR** (overlay engine, seal path C, pin semantics) that cites ADR-004 §“Deletions” as **why** mode-tool no longer uses `appendEntry`, while ICM **reintroduces** `appendEntry` for **different custom types** and **different lifecycle** — not mode emulation.

### 5.4 Residual risk to surface

If future host adds **native initiative context management**, ICM would need the same thin-driver migration ADR-004 performed for plan/vibe — peel emulation, keep entry tool. Until then, overlay engine is greenfield.

---

## 6. Settings kill-switch pattern for a future context tool

### 6.1 Current pattern (copy verbatim structure)

**`plugin/package.json` → `omp.settings`:**

```json
"contextToolEnabled": {
  "type": "boolean",
  "default": true,
  "description": "Register the agent-facing initiative context tool (ICM)"
}
```

**`plugin/src/lib/settings.ts`:**

- Add to `DEFAULT_SETTINGS` and `QolSettings`.
- Coerce in `coerce()` with `typeof … === "boolean"` fallback to default.

**`plugin/src/main.ts`:**

```typescript
if (bootSettings.contextToolEnabled) {
  registerContextTool(pi);
  pi.logger.info("[omp-qol] context tool registered");
} else {
  pi.logger.info("[omp-qol] context tool disabled by setting contextToolEnabled=false");
}
```

**`session_start`:** log `contextToolEnabled` in settings line (registration itself is boot-time; overlay **event handlers** are a separate decision — see below).

**`qol-config` command:** include `contextToolEnabled` in displayed lines.

### 6.2 Kill-switch granularity for ICM

| Switch | Controls | Default suggestion |
|---|---|---|
| `contextToolEnabled` | Agent `context` / `icm` tool registration | `true` |
| `icmOverlayEnabled` | Register `pi.on("context")` handler | `true` when engine ready |
| `icmSealEnabled` | Register `pi.on("session_before_compact")` | `false` until seal path proven |
| `icmPinTreeEnabled` | Pin-tree ops (pillar: deferred QoL) | `false` |

Follow advisor precedent: **tool off** = agent cannot invoke ops; **overlay off** = no projection (canonical context only). Document in `qol-config` and README.

### 6.3 Registration vs runtime

- **Tools:** gated at factory time (current pattern).
- **Event handlers:** likely registered unconditionally but **no-op early** when settings disable — OR gated at factory with explicit log. Prefer **register + no-op** if host requires handler registration before first turn; document choice in ICM ADR after H2 verification.

---

## Appendix A — File map (what was read)

| Path | Relevance |
|---|---|
| `plugin/src/lib/host-bridge.ts` | Live session type surface, bridge resolution |
| `plugin/src/lib/mode-exclusivity.ts` | `buildSessionContext`, `getEntries` mode semantics |
| `plugin/src/lib/settings.ts` | Kill-switch loader |
| `plugin/src/main.ts` | Registration, `session_start`, commands |
| `plugin/src/advisor-tool.ts` | Envelope, approval tiering, bridge gate, native sequencing |
| `plugin/src/mode-tool.ts` | `appendModeChange`, bridge usage |
| `plugin/src/goal-tool.ts` | Envelope, `invokeTool` delegate |
| `plugin/types/host-ambient.d.ts` | Minimal ExtensionAPI stub |
| `docs/ssot/adrs/ADR-004-thin-driver-no-emulation.md` | No emulation law |
| `docs/ssot/adrs/ADR-005-advisor-thin-driver.md` | Advisor patterns, dynamic approval |
| `docs/workspaces/initiative-context-management/INVARIANTS.md` | ICM laws + ADR-004 tension row |

## Appendix B — ICM checklist (derived gaps)

- [ ] Type and call `pi.appendEntry` for overlay records
- [ ] Register `pi.on("context")` reducer (H2 report)
- [ ] Register `pi.on("session_before_compact")` seal path (H1 report)
- [ ] Address entries by `(sessionId, entryId)` not journal index
- [ ] Agent tool with advisor-style envelope + dynamic approval
- [ ] `contextToolEnabled` (and optional sub-switches) in `package.json` + settings
- [ ] New ADR: overlay engine scope vs ADR-004
- [ ] Do **not** reuse deleted mode `appendEntry` types or `before_agent_start` injection

---

## Cross-references

- H1: `host-compaction.md` (pending)
- H2: `host-context-event.md` (pending)
- H4: `host-addressing.md` (pending)
- Frozen handoff: `docs/researches/OMP-QOL-Complete-Research-Handoff-2026-08-09/02-foundation-research/07-CONTEXT-OVERLAY-ENGINE.md`
- Pillar scope: `docs/ssot/pillars/initiative-context-management/README.md`
