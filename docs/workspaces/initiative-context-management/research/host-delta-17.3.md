# Host Delta: OMP 17.2.12 → 17.3.4 (ICM Research H5)

**date**: 2026-08-16  
**author**: subagent (file-search / git-diff pass)  
**method**: `git diff` and `git log` on full clone `C:\Users\15480\Desktop\AIWorkshop\ref_repos\oh-my-pi` — no pull, no checkout moves.

| Anchor | Commit | coding-agent |
|---|---|---|
| **OLD LOCK** (2026-08-09 handoff) | `45e12e5bb758198a920c6070e7e64cb33b21beac` | **17.2.12** |
| **NEW** (current main ref) | `de6b7974a0` (17.3.4 tag at `ffd53ff92a` + 1 post-bump commit) | **17.3.4** |

**Delta span**: ~11 version bumps, ~50+ commits touching ICM-adjacent paths (session, extensibility, agent compaction orchestration).

---

## Executive summary

Between 17.2.12 and 17.3.4 the host **did not** add the ICM seams the 2026-08-09 foundation still needs: no `SessionEntry` provenance on the `context` event, no overlay persistence API beyond `appendEntry`, no change to `buildSessionContext` projection, and no change to `AppendOnlyContextManager` or core `compaction.ts` pressure math.

What **did** change materially:

1. **Extension lifecycle hardening** — late tool registration, serialized registry mutations, MCP ownership tracking, `ExtensionMode` on context. New integration surface; does not replace ICM overlay but affects when/how plugins can hook the live session.
2. **Compaction orchestration refinements** — mid-turn gate reorder (skip persistence wait when under threshold), public `contextFitsModel()`, retry-fallback fit-check, `/shake` tail protection, RPC stripping of snapcompact archive blobs from `CompactionResult.preserveData`.
3. **Cache-adjacent fixes** — explicit `anthropicCacheRefresh: true`, advisor delta-split / reset-reason logging (prevents false full replays), Cursor `exec-resolved` symbol preservation through snapshots.
4. **Host-native adjacent features** — `omp compress` semantic file compression CLI, per-agent advisor config, agents hub UI, external thinking / private scratchpad — none are initiative overlay, but they compete for “who owns compression” narrative.
5. **Documentation strengthening** — `message_end` explicitly notification-only; `ContextEvent` doc unchanged (still message copies, no entry IDs).

**Bottom line for ICM architecture (C vs D)**: Route **C** (overlay + seal on top of lossless journal) remains viable and is **not overturned**. Several changes **strengthen** overlay assumptions (message-end isolation, append-only cache manager unchanged). No change **overturns** the provenance gap or makes route **D** (core-owned initiative context) appear shipped. Several **new seams** appeared (late tool registration, semantic compress CLI, advisor granularity) that ICM must account for but do not close P0 questions.

---

## coding-agent version history (17.2.12 → 17.3.4)

| Version | Bump commit | Date | Notable ICM-adjacent changes in window |
|---|---|---|---|
| **17.2.12** | `45e12e5` (lock) | — | Baseline for 2026-08-09 handoff. |
| **17.2.13** | `2157becbe9` | 2026-08-11 | Late tool registration chain begins; journal resume perf (`reuse parsed journal`); advisor cache-growth delta-split (PR #7247 merge `7e8be71ead`); TUI edit-preview gate. |
| **17.2.14** | `e5ebb2aee0` | 2026-08-11 | External thinking + private scratchpad `think` tool introduced. |
| **17.2.15** | `5481d8b9b0` | 2026-08-12 | `omp compress` semantic compression CLI (`1217ee1317`); prompt condensation; snapcompact opus tier fixes; MCP protocol version negotiation. |
| **17.3.0** | `8b0f400d3c` | 2026-08-13 | **Largest ICM batch**: retry-fallback fit-check + extension events; mid-turn compaction gate reorder; message-end isolation; RPC snapcompact archive strip; WebP provider normalization; `/shake` tail protection (`c3da093a1d` in agent shake.ts). |
| **17.3.1** | `0bc2c342f4` | 2026-08-13 | `ExtensionMode` populated in extension context (`7463803c95`). |
| **17.3.2** | `ae2d3d6ea1` | 2026-08-14 | Post-yield TUI stall fix (orthogonal). |
| **17.3.3** | `039728ad80` | 2026-08-14 | Codex v2 compaction feature header; mupdf native pipeline (orthogonal). |
| **17.3.4** | `ffd53ff92a` | 2026-08-14 | Tag; ref `de6b7974a0` is one commit later (`fix(natives): fall back to cargo without bazel`) — **no ICM file changes** in that commit. |

Commits between bumps that touch required files but sit inside a version window are listed per-file below.

---

## Required file diff inventory

| File | Diff? | Lines (+/−) |
|---|---|---|
| `packages/agent/src/compaction/compaction.ts` | **No** | 0 |
| `packages/agent/src/append-only-context.ts` | **No** | 0 |
| `packages/agent/src/agent-loop.ts` | **Yes** | +16 / −4 |
| `packages/coding-agent/src/session/session-maintenance.ts` | **Yes** | +99 / −57 (approx) |
| `packages/coding-agent/src/session/session-manager.ts` | **Yes** | +12 / −3 |
| `packages/coding-agent/src/session/session-context.ts` | **No** | 0 |
| `packages/coding-agent/src/extensibility/extensions/types.ts` | **Yes** | +46 / −6 |
| `packages/coding-agent/src/extensibility/extensions/runner.ts` | **Yes** | +255 / −125 (approx) |
| `packages/coding-agent/src/extensibility/shared-events.ts` | **Yes** | +15 |
| `packages/coding-agent/src/sdk.ts` | **Yes** | +175 / −125 (approx) |
| `docs/compaction.md` | **No** | 0 |

---

## Per-file analysis

### `packages/agent/src/compaction/compaction.ts` — **UNCHANGED**

**Verdict**: **KEEP** all 2026-08-09 claims about native compaction pressure math.

- `compactionContextTokens(provider, stored)` = `max(provider, stored)` unchanged.
- `CompactionResult`, summarization pipeline, `session_before_compact` hook contract (consumer side in session-maintenance) unchanged at source level.
- Related but out-of-file change: `packages/agent/src/compaction/shake.ts` (`c3da093a1d`, 17.3.0 window) — manual `/shake` now keeps a **4k-token recent tail** of tool results instead of `protectTokens: 0`. **STRENGTHEN** for live-tail pin semantics: host acknowledges destroying the immediate working set is harmful.

**C-vs-D / provenance / cache / appendEntry**: No direct change.

---

### `packages/agent/src/append-only-context.ts` — **UNCHANGED**

**Verdict**: **KEEP** invariant #11 (first-divergence frontier + changed suffix).

- `StablePrefix` + `AppendOnlyLog` + `AppendOnlyContextManager.syncMessages` logic identical between lock and 17.3.4.
- Confirms 2026-08-09 cache-as-frontier model still matches host implementation.

**Cache callout**: Unchanged file, but **sdk.ts now passes `anthropicCacheRefresh: true`** on stream — see sdk section. That is an additive provider hint, not a rewrite of append-only semantics.

---

### `packages/agent/src/agent-loop.ts` — **CHANGED** (minor)

**Commit**: `270fe8d454` / `5cbd482f8e` — fix(cursor): keep `exec-resolved` marker under owned dialects.

**Change**: `snapshotAssistantContentBlock` for `toolCall` blocks now calls `copyCursorExecResolved(snap, block)` after spread-clone, because Bun object spread copies enumerable symbols but the Cursor exec-resolved marker must survive projector/snapshot paths for skip-on-dispatch.

**Verdict**: **STRENGTHEN** cache/dispatch correctness at the agent-loop layer. Orthogonal to ICM overlay design but confirms host continues to treat provider-metadata symbols as load-bearing for cache and dispatch — overlay projections must not strip unknown provider metadata casually.

**C-vs-D**: Neutral.  
**Provenance**: Neutral.  
**Cache**: **STRENGTHEN** — explicit preservation of load-bearing markers through snapshot paths.  
**appendEntry**: Neutral.

---

### `packages/coding-agent/src/session/session-maintenance.ts` — **CHANGED** (material)

#### 1. Mid-turn compaction gate reorder (`94b865be6f`, 17.3.0)

**Before**: Always awaited `persistTurnMessagesForMidRunCompaction` then checked `shouldCompact`.  
**After**: Computes `contextTokens` from live assistant usage + stored estimate **first**; returns early if under threshold; only then awaits persistence barrier.

**Why**: Slow `message_end` listeners could leave TUI in “generating” with no provider request when compaction wasn't going to run anyway.

**Verdict**: **KEEP** overlay/seal model; **STRENGTHEN** operational correctness. Does not change what gets compacted or journal contents — only when async persistence is awaited.

**Cache**: Indirect — fewer unnecessary waits; compaction still rewrites history and triggers advisor reset when it runs.

#### 2. Public `contextFitsModel(model, excludedMessage?)` (`f73baac583`, `abc1897fc3`, 17.3.0)

Extracted from private `#compactionCreatedRetryFit`. Uses same reserve resolution as compaction but **independent of `compaction.enabled`**. Subtracts an excluded failed assistant from both provider and stored token estimates when judging retry prompt fit.

**Verdict**: **NEW SEAM** — extensions cannot call this directly today, but it documents host thinking: “fit” ≠ “under compaction threshold”. Useful reference for ICM when designing expand/seal that must fit provider window without triggering native compaction.

**C-vs-D**: Slightly **STRENGTHEN** route C — host still separates “what is stored” from “what fits on wire” using dual token estimates (mirrors overlay projection concern).

#### 3. `resetAdvisorRuntimes(reason?: string)` (`21d0db72cf` + maintenance call sites)

All history-rewrite paths now pass explicit reasons: `"compact"`, `"auto-compaction"`, `"compaction-rescue"`, `"prune-tool-outputs"`, `"shake"`, etc.

**Verdict**: **STRENGTHEN** observability; pairs with PR #7247 advisor delta-split to avoid false full replays that nuked cache prefix.

**Cache**: **STRENGTHEN** — advisor re-prime is a major cache invalidation source; reason-tagged resets + delta-split reduce accidental full-prefix replay.

#### 4. RPC `preserveData` sanitization (`6f2c931012`, `1451f9a1b9`, 17.3.0)

`auto_compaction_end` and manual compact results now pass `preserveData: snapcompact.stripPreservedArchive(preserveData)` before emitting to extensions/RPC.

**Verdict**: **KEEP** compaction semantics; **NEW SEAM** for RPC consumers — large binary archive stripped from event payload, not from journal entry on disk.

**Provenance**: Events may now carry **less** auxiliary data than persisted entry — extensions observing compaction via events cannot rely on full preserve archive in event mirror.

#### 5. Unchanged ICM-critical paths (verified present, not modified in diff)

- `session_before_compact` hook → custom `CompactionResult` skip path still exists (`compact()`, `runAutoCompaction()`).
- `compactionContextTokens(billed, stored)` usage unchanged.
- Journal rewrite + `buildDisplaySessionContext` + `agent.replaceMessages` flow unchanged.

---

### `packages/coding-agent/src/session/session-manager.ts` — **CHANGED** (minor)

#### 1. Resume perf — reuse parsed journal (`00fc4d5376`, 17.2.13)

`#setSessionFile(sessionFile, loadedEntries?)` internal split; `openFromFile` passes pre-parsed entries instead of re-reading disk.

**Verdict**: **KEEP** journal model; perf only. ICM overlay reads via `getEntries()` benefit from faster resume.

#### 2. `session_init.advisor` field (`e8eed95130`, per-agent advisor config)

`recordSessionInit` and resume parsing now accept/store optional `advisor?: string`.

**Verdict**: **NEW SEAM** — session metadata for advisor selection. Not message provenance, but another `(sessionId, entryId)`-anchored field on `session_init` entries ICM should not collide with.

**Provenance**: Minor metadata enrichment on init entry only — **does not** close message-level provenance gap.

#### 3. `appendCustomEntry` / journal write path — **UNCHANGED** in diff

---

### `packages/coding-agent/src/session/session-context.ts` — **UNCHANGED**

**Verdict**: **KEEP** all claims about `buildSessionContext(entries, leafId, byId)`:

- Walks parent chain from leaf; applies compaction entries, custom messages, mode injections.
- Returns `SessionContext.messages` without parallel `entryId[]` array on the projection API.
- Provenance gap for ICM **persists**.

---

### `packages/coding-agent/src/extensibility/extensions/types.ts` — **CHANGED**

| Addition | ICM verdict |
|---|---|
| `ExtensionMode` (`"tui" \| "rpc" \| "json" \| "print"`) on `ExtensionContext` | **NEW SEAM** — plugins can guard TUI-only overlay UI. |
| `MessageEndEvent` doc: “notification-only… in-place changes do not rewrite agent or provider context” (`92f0ad71f4`) | **STRENGTHEN** route C — formalizes that lifecycle snapshots ≠ mutable context. |
| `ExtensionCustomOptions` (overlay positioning for `ui.custom`) | Orthogonal UI seam. |
| `RetryFallbackAppliedEvent` / `RetryFallbackSucceededEvent` | **NEW SEAM** — retry model switching observable; not context overlay. |
| `ToolRegistrationListener` + `Extension.toolRegistrationListeners` | **NEW SEAM** — see runner/sdk. |
| `ContextEvent` / `ContextEventResult` | **UNCHANGED** — still `{ type, messages }` only. **KEEP** provenance gap. |

---

### `packages/coding-agent/src/extensibility/extensions/runner.ts` — **CHANGED** (large)

#### Tool registration lifecycle (17.2.13 → 17.2.15 chain, merges through `19b428b757`)

New machinery:

- `onToolRegistered(listener)` — observe tools registered after factory load.
- `AsyncLocalStorage` scope during handler execution; `#flushToolRegistrations` before handler completes.
- `setActiveTools` wrapper awaits `#toolRegistrationBarrier`.
- `#runHandlerWithTimeout` refactor — shared by `tool_call`, `input`, **`context`**, etc.

**Verdict**: **NEW SEAM** + **STRENGTHEN** extension reliability.

**ICM implications**:

- A `context` handler that synchronously registers tools will now block until registration settles — could affect handler latency ordering but **does not** add provenance to `ContextEvent`.
- Serial handler order **unchanged** — still extension load order, no priority API.
- **KEEP** claim: QOL/ICM plugin not guaranteed first handler.

#### `emitContext` — logic unchanged

Still: clone messages → serial handlers → each may return replacement `messages` array. No `entryId`, no `SessionEntry` map, no tombstone channel.

**Provenance**: **KEEP** gap.

#### `input` transform fix

Only emit `{ text, images }` keys when actually changed — fixes accidental attachment clearing (`d194f2d76c`).

**Verdict**: **STRENGTHEN** transform-only path integrity (relevant to protocol-safe projection).

#### `appendEntry` wiring

`this.runtime.appendEntry = actions.appendEntry` — unchanged assignment. **KEEP** appendEntry contract.

---

### `packages/coding-agent/src/extensibility/shared-events.ts` — **CHANGED** (minor)

Added `RetryFallbackAppliedEvent` and `RetryFallbackSucceededEvent` only.

`ContextEvent` interface **byte-identical** aside from unrelated file context.

**Verdict**: **KEEP** context event shape.

---

### `packages/coding-agent/src/sdk.ts` — **CHANGED** (material)

#### Late tool registration pipeline (17.2.13+)

After session construction:

- `extensionRunner.onToolRegistered(scheduleToolRegistration)`
- Serialized `session.runToolRegistryMutation` with rollback on failure
- MCP manager tool ownership sets (`initialMcpManagerToolNames`, `mcpManagerToolNames` on session)
- Race close: tools registered between factory and listener attach

**Verdict**: **NEW SEAM** — significant for omp-qol plugin (already uses extensions) but **not** an ICM overlay API.

#### `transformProviderContext` pipeline reorder (17.3.0)

Order is now: obfuscate → snapcompact inline → **clamp images** → **normalize WebP/incompatible images**.

Comment explicitly: clamp before transcode so dropped historical images don't pay decode cost.

**Verdict**: **STRENGTHEN** transform-only wire path (route C). On-wire image normalization is host-owned; ICM overlay must compose **before** or **via** `context` event, not assume raw journal bytes reach provider.

**Cache**: Clamping/normalization can change effective prefix if it mutates retained images — still transform-only, journal lossless.

#### `anthropicCacheRefresh: true` (17.3.x, in stream fn)

Passed on every provider stream invocation when external thinking flags evaluated.

**Verdict**: **NEW SEAM** / **STRENGTHEN** provider cache behavior. Relevant to E1 cache-cost research — host now explicitly requests Anthropic cache refresh. Does **not** overturn append-only frontier model; may change **economics** of prefix stability.

#### External thinking (`10fd42289c`, `19c0afcc0d`)

Hidden `think` tool + `forceReasoningOff` when external thinking enabled.

**Verdict**: **NEW SEAM** — private scratchpad outside visible transcript. Adjacent to “initiative compress” (model-managed hidden state) but host-owned, not plugin overlay.

#### `setSessionActiveToolNames` helper

Unifies active tool names + `toolContextStore.setToolNames` — system prompt rebuild timing fix.

**Verdict**: **KEEP** — internal coherence; ICM tools registering via late path must expect prompt refresh after activation.

---

### `docs/compaction.md` — **UNCHANGED**

**Verdict**: **KEEP** documented compaction model (journal entries, branch summaries, hook points). No new ICM extension points documented.

---

## Adjacent changes outside required file list (ICM-relevant)

| Change | Location | Verdict | Notes |
|---|---|---|---|
| Advisor delta-split + cache growth | `packages/coding-agent/src/advisor/` | **STRENGTHEN** cache | PR #7247. Split session updates into per-message user messages. |
| `omp compress` CLI | `packages/coding-agent/src/compress/` | **NEW SEAM** | Host-native **file** semantic compression, not session overlay. Competes narratively with “initiative compress” but different domain (static files → dense prompt register). |
| Per-agent advisor config | session init + agents | **NEW SEAM** | Fine-grained advisor selection; read `session_init.advisor`. |
| Agents hub UI | `modes/components/agent-hub.ts` | Orthogonal | UI for agent CRUD. |
| Anthropic keep-alive migration | `1132c3e31c` | **Cache-adjacent** | Connection lifecycle; track in H3. |
| Message-end isolation impl | `agent-session.ts` `7ab6b554f6` | **STRENGTHEN** C | Detached snapshot for `message_end`; pairs with types doc. |
| Handoff artifact copy | `dbc199d2db` | Orthogonal | Session boundary file copy. |

---

## Cross-cutting ICM axes

### C vs D (overlay/seal vs core ownership)

| Finding | Effect on C vs D |
|---|---|
| No host overlay reducer, pin tool, or entry-provenance on `context` | **KEEP** — route D not shipped. |
| `message_end` isolation documented + implemented | **STRENGTHEN C** — notification snapshots ≠ authoritative context. |
| `ContextEvent` still transform-only on message copies | **KEEP C** — overlay projection remains the intended plugin shape. |
| `omp compress` + native compaction + snapcompact | **NEW SEAM** — host owns several compression stories; ICM must differentiate **session initiative overlay** vs **host maintenance** vs **file compress CLI**. Does not invalidate C; clarifies boundary. |
| Late tool registration | **NEW SEAM** — more host machinery for plugin integration; still not context overlay. |

**No overturn** of C-vs-D framing from 2026-08-09. Decision still open per `DECISIONS.md`.

### Provenance

| Claim (17.2.12) | 17.3.4 status |
|---|---|
| `ContextEvent.messages` are deep copies without `entryId` | **KEEP** — unchanged. |
| `buildSessionContext` returns messages only | **KEEP** — `session-context.ts` unchanged. |
| Serial handlers, no priority | **KEEP** — `emitContext` order unchanged. |
| `@message` public syntax undecided | **KEEP** — no host alias layer added. |
| `session_init.advisor` metadata | **NEW** — minor init-entry field only. |
| RPC compaction events strip archive from `preserveData` | **NEW** — event mirror ≠ full journal payload. |

### Cache

| Claim | 17.3.4 status |
|---|---|
| `AppendOnlyContextManager` first-divergence frontier | **KEEP** — file unchanged. |
| Compaction pressure = max(provider, stored) | **KEEP** — `compaction.ts` unchanged. |
| Transform-only ≠ free native headroom | **KEEP** — must re-measure on 17.3.4 (invariant #12). |
| Advisor false full replay | **STRENGTHEN** — delta-split + reset reasons. |
| `anthropicCacheRefresh: true` | **NEW** — explicit refresh hint on streams. |
| Cursor exec-resolved preservation | **STRENGTHEN** — agent-loop snapshot fix. |
| Image clamp → normalize ordering | **STRENGTHEN** — cheaper transform path; watch for prefix mutations on kept images. |

### appendEntry

| Claim | 17.3.4 status |
|---|---|
| `pi.appendEntry(customType, data)` persists without LLM send | **KEEP** — wiring unchanged (`runtime-init.ts` → `sessionManager.appendCustomEntry`). |
| Overlay state as custom journal entries | **KEEP** — still the correct persistence seam for route C. |
| No new typed ICM entry kinds in host | **KEEP** — no host-namespace ICM types added. |

---

## 2026-08-09 must-reverify checklist (from `STATUS.md`)

| # | Claim | Result on 17.3.4 |
|---|---|---|
| 1 | Native compaction pressure = max(provider usage, stored estimate) | **KEEP** — `compaction.ts` unchanged. |
| 2 | `session_before_compact` → custom `CompactionResult` skips second LLM summary | **KEEP** — session-maintenance paths intact. |
| 3 | `appendEntry` persists extension state, not sent to model | **KEEP** — unchanged wiring. |
| 4 | `context` event = message copies, no `SessionEntry` provenance | **KEEP** — types + runner unchanged. |
| 5 | Serial handlers, no priority, plugin not guaranteed first | **KEEP**. |
| 6 | `AppendOnlyContextManager` preserves longest byte-stable prefix | **KEEP** — file unchanged. |
| 7 | SYSTEM vs AGENTS / `refreshBaseSystemPrompt` split | **Not in required diff scope** — defer to H1/H6; no signal of removal. |

---

## ICM verdict matrix (all material deltas)

| Change | keep / strengthen / overturn / new seam | C-vs-D | Provenance | Cache | appendEntry |
|---|---|---|---|---|---|
| `compaction.ts` unchanged | **keep** | — | — | keep pressure math | — |
| `append-only-context.ts` unchanged | **keep** | strengthen C assumptions | — | **keep** frontier model | — |
| `session-context.ts` unchanged | **keep** | keep C | **keep** gap | — | — |
| `docs/compaction.md` unchanged | **keep** | — | — | — | — |
| agent-loop exec-resolved copy | **strengthen** | — | — | **strengthen** | — |
| mid-turn compaction gate reorder | **strengthen** | — | — | indirect | — |
| `contextFitsModel()` public | **new seam** | strengthen C | — | fit vs threshold | — |
| advisor reset reasons + delta-split | **strengthen** | — | — | **strengthen** | — |
| RPC strip snapcompact archive from events | **new seam** | — | weaken event mirror | — | — |
| `/shake` 4k tail protection | **strengthen** | — | — | protects working tail | — |
| `message_end` isolation doc + impl | **strengthen** | **strengthen C** | — | — | — |
| late tool registration (runner/sdk) | **new seam** | — | — | prompt/tool snapshot timing | — |
| `ExtensionMode` on context | **new seam** | — | — | — | — |
| retry fallback extension events | **new seam** | — | — | — | — |
| WebP / image normalize in provider path | **strengthen** | strengthen transform path | — | possible prefix change | — |
| `anthropicCacheRefresh: true` | **new seam** | — | — | **new behavior** | — |
| external thinking / think tool | **new seam** | host hidden state | — | — | — |
| `omp compress` CLI | **new seam** | host compress ≠ ICM | — | — | — |
| session resume journal reuse | **strengthen** (perf) | — | — | — | — |
| `session_init.advisor` field | **new seam** | — | minor metadata | — | — |
| `ContextEvent` unchanged | **keep** | **keep C** | **keep gap** | — | — |
| `appendEntry` unchanged | **keep** | **keep C** | — | — | **keep** |

---

## Implications for ICM program (actionable)

1. **Do not freeze architecture yet** — provenance gap and handler ordering claims **survive** re-verification; no host relief appeared.
2. **Route C remains default hypothesis** — several 17.3.x changes reinforce transform-only overlay + lossless journal (`message_end` isolation, unchanged appendEntry, unchanged context event).
3. **Cache research (H3/E1) must include new variables** — `anthropicCacheRefresh`, advisor delta-split, image normalization order, RPC preserveData stripping.
4. **Differentiate compression products** — native auto-compaction, snapcompact, `/shake`, `omp compress`, and future ICM initiative compress are distinct; pillar “agent decides” applies to session overlay, not file CLI.
5. **Late tool registration** — when ICM ships tools, use the new registration path consciously; context handlers should not register tools synchronously unless prepared for barrier latency.
6. **Next research tracks** — H1 (compaction/seal on 17.3.4), H2 (context event + appendEntry live trace), H3 (cache with new refresh flag), H4 (addressing unchanged gap).

---

## Commands used (repro)

```bash
cd C:\Users\15480\Desktop\AIWorkshop\ref_repos\oh-my-pi
git diff 45e12e5bb758198a920c6070e7e64cb33b21beac..de6b7974a0 -- \
  packages/agent/src/compaction/compaction.ts \
  packages/agent/src/append-only-context.ts \
  packages/agent/src/agent-loop.ts \
  packages/coding-agent/src/session/session-maintenance.ts \
  packages/coding-agent/src/session/session-manager.ts \
  packages/coding-agent/src/session/session-context.ts \
  packages/coding-agent/src/extensibility/extensions/types.ts \
  packages/coding-agent/src/extensibility/extensions/runner.ts \
  packages/coding-agent/src/extensibility/shared-events.ts \
  packages/coding-agent/src/sdk.ts \
  docs/compaction.md
```

---

## Related workspace docs

- Research index: `research/00-index.md` (H5)
- Invariants: `INVARIANTS.md`
- Status checklist: `STATUS.md`
- Open questions: `questions/open-questions.md` (Q2 provenance)
