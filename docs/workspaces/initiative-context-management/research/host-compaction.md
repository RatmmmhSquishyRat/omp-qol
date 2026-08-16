# H1: Native compaction on OMP 17.3.4

**Track:** H1 (`host-compaction.md`)  
**Date:** 2026-08-16  
**Host:** `docs/ref_repos/oh-my-pi-main` @ `de6b7974a0` (detached HEAD, current main worktree)  
**Package:** `@oh-my-pi/coding-agent` **17.3.4** (`packages/coding-agent/package.json`)  
**Evidence scale:** E0 idea → E1 inferred → **E2 source closed-loop** → E3 deterministic integration → E4 model → E5 eval

---

## Executive summary

On **17.3.4**, native compaction is a host-owned maintenance pipeline in `SessionMaintenance` that:

1. **Measures pressure** with `compactionContextTokens(providerUsage, storedConversationEstimate) = max(...)`, explicitly to defeat on-wire payload compression (Headroom-class extensions, obfuscators, inline snapcompact).
2. **Decides** via `shouldCompact()` against `resolveThresholdTokens()` (reserve-based default, or fixed token / percent overrides).
3. **Prepares** a cut with `prepareCompaction()` → `findCutPoint()` → `messagesToSummarize` / `firstKeptEntryId`.
4. **Summarizes** (snapcompact default strategy, context-full LLM, remote V2/V1, or extension-provided result).
5. **Persists** by **appending** a `CompactionEntry` (`appendCompaction` → `#recordEntry`) and rebuilding live agent messages from the latest compaction boundary.

**Can a plugin own headroom?** **Partially, not exclusively.**

| Capability | Plugin today (no core patch) | Still needs host seam |
|---|---|---|
| Shrink provider wire payload | `before_provider_request`, `context` | — |
| Suppress compaction via deflated provider usage | **No** — stored-estimate floor defeats this | — |
| Cancel a compaction pass | `session_before_compact` → `{ cancel: true }` | — |
| Seal without second LLM summarize | `session_before_compact` → `{ compaction: CompactionResult }` | Must respect host cut semantics / validation |
| Add summarizer context / prompt / `preserveData` | `session.compacting` (skipped when custom `compaction` returned) | Cannot replace `messagesToSummarize` set |
| Change reserve / threshold / strategy at runtime | Settings only (`compaction.*`) | No extension API for per-session headroom budget |
| Adjust UI context meter after wire shrink | **No** direct API | `recordAnchoredHistoryRewrite` is host-internal (shake path) |

All five **2026-08-09 claims (17.2.12)** **stand on 17.3.4** at **E2** (source closed-loop: trigger → prepare → hook → append → rebuild identified in source). No overturn found in the files reviewed for this track.

---

## Source map (read order)

| File | Role |
|---|---|
| `packages/agent/src/compaction/compaction.ts` | Core types, pressure math, `prepareCompaction`, `compact`, `CompactionResult` |
| `packages/coding-agent/src/session/session-maintenance.ts` | Auto/manual maintenance orchestration, hooks, idle/mid-turn/post-turn paths |
| `packages/coding-agent/src/session/session-stats.ts` | Context breakdown, anchored rewrite correction |
| `packages/coding-agent/src/extensibility/shared-events.ts` | `session_before_compact`, `session.compacting`, `CompactionResult`, auto-compaction reasons |
| `packages/coding-agent/src/session/session-manager.ts` | `appendCompaction` → append-only journal |
| `packages/coding-agent/src/session/session-context.ts` | `buildSessionContext` compaction boundary / `firstKeptEntryId` |
| `packages/coding-agent/src/session/session-entries.ts` | `CompactionEntry`, `fromExtension` |
| `docs/compaction.md` | Secondary; aligns with source on 17.3.4 |

---

## 1. Native pressure and threshold

### 1.1 Pressure floor (provider vs stored conversation)

**Function:** `compactionContextTokens()` in `packages/agent/src/compaction/compaction.ts`

```typescript
export function compactionContextTokens(providerContextTokens: number, storedConversationEstimate: number): number {
	return Math.max(Math.max(0, providerContextTokens), Math.max(0, storedConversationEstimate));
}
```

**Comment (lines 341–354):** explicitly names `before_provider_request` payload transforms — compression extensions (e.g. Headroom), obfuscators, inline snapcompact — as the reason provider-reported usage must be floored by the agent's stored-conversation estimate. Display/cost accounting may use exact provider usage; **only the compaction decision** takes the floor.

**Stored estimate:** `SessionMaintenance.#estimateStoredContextTokens()` (`session-maintenance.ts` ~990–1000):

- `computeNonMessageTokens(session)` + sum of `estimateTokens(msg, { excludeEncryptedReasoning: true })` over active messages (+ pending).
- Same Headroom comment block (~981–988).

**Call sites (compaction trigger, not display-only):**

| Phase | Location | Provider arm | Stored arm |
|---|---|---|---|
| Pre-prompt threshold | `#estimatePrePromptContextTokens` | `getContextBreakdown().usedTokens` | `#estimateStoredContextTokens(pending)` |
| Mid-turn threshold | `maintainContextMidRun` | `calculateContextTokens(lastAssistant.usage)` | `#estimateStoredContextTokens()` |
| Post-turn threshold | `checkCompaction` | `calculateContextTokens(assistant.usage)` (0 if predates compaction) | `#estimateStoredContextTokens()` |
| Idle path | via `runAutoCompaction("idle")` after `#currentContextTokens()` gate in TUI | (idle gate uses context meter; auto path reuses threshold logic inside maintenance) |
| Advisor compaction | `session-advisors.ts` ~1346–1352 | provider + incoming delta | full local estimate + incoming delta |
| Post-pass headroom check | `#compactionCreatedHeadroom` | `getContextUsage().tokens` | `#estimateStoredContextTokens()` |

**Threshold:** `shouldCompact(contextTokens, contextWindow, settings)` → `contextTokens > resolveThresholdTokens(...)`.

Default threshold when `thresholdPercent` / `thresholdTokens` unset: `contextWindow - resolveBudgetReserveTokens(...)`, where reserve defaults to `max(15% of window, DEFAULT_RESERVE_TOKENS=16384)` unless explicitly configured (`compaction.ts` `resolveThresholdTokens`, `resolveBudgetReserveTokens`).

### 1.2 Context stats vs compaction decision

`SessionStatsTracker.getContextBreakdown()` (`session-stats.ts`) anchors on last assistant usage + tail estimates for **UI / cost display**. It supports `recordAnchoredHistoryRewrite()` to persist reductions already included in the provider anchor (used by **shake**, not exposed to extensions).

Compaction **does not** subtract pruning savings from the threshold input on the post-turn path (comment ~1361–1371, issue #3174): pruning frees the *next* prompt; the trigger uses last turn's billed tokens floored by post-prune stored estimate.

---

## 2. Compaction pipeline

### 2.1 Triggers and `AutoCompactionStartEvent.reason`

From `shared-events.ts`:

```typescript
export interface AutoCompactionStartEvent {
	type: "auto_compaction_start";
	reason: "threshold" | "overflow" | "idle" | "incomplete";
	action: "context-full" | "handoff" | "shake" | "snapcompact";
}
```

| Reason | Trigger (source) | `willRetry` typical | Notes |
|---|---|---|---|
| **`threshold`** | Post-turn `checkCompaction` when `shouldCompact` after successful assistant; pre-prompt `runPrePromptCompactionIfNeeded`; mid-turn `maintainContextMidRun` | false (may auto-continue) | Promotion tried first; handoff may defer post-prompt |
| **`overflow`** | `checkCompaction` on same-model context overflow error, not predating latest compaction | true | Error turn dropped from active context; handoff **not** used (`reason === "overflow"`) |
| **`incomplete`** | `stopReason === "length"` (OpenAI/Codex incomplete output) | true | Handoff allowed (input still usable) |
| **`idle`** | `event-controller.#scheduleIdleCompaction` → `runIdleCompaction` when `idleEnabled`, empty input, tokens ≥ `idleThresholdTokens`, after timeout | false | Separate from reserve threshold; uses fixed `idleThresholdTokens` (default 200k) |

Manual: `/compact` → `SessionMaintenance.compact()` (same hook + append path, `trigger: "manual"` for Codex metadata).

### 2.2 Preparation (`prepareCompaction`)

`packages/agent/src/compaction/compaction.ts` — `prepareCompaction(pathEntries, settings, activeModel?)`:

1. Skip if last entry is already `compaction`.
2. Find previous compaction on path (may skip non-reusable remote preserve per `remotePreserveReusable`).
3. `boundaryStart = prevCompactionIndex + 1`.
4. Adapt `keepRecentTokens` if provider prompt/estimate ratio > 1.
5. `findCutPoint()` — walk backward, accumulate ≥ `keepRecentTokens`, cut at valid message boundaries (never `toolResult`).
6. Build `messagesToSummarize`, `turnPrefixMessages` (split turn), `recentMessages`.
7. Return `undefined` if nothing to summarize.

**Plugin does not run here.** Cut set is host-computed before hooks fire.

### 2.3 Execution strategies (17.3.4 defaults)

From `DEFAULT_COMPACTION_SETTINGS` / `settings-schema` / `docs/compaction.md`:

- Default **`compaction.strategy`: `"snapcompact"`** (changed from context-full in earlier docs; 17.3.4 source confirms).
- Auto snapcompact falls back to context-full LLM when vision unavailable or local snapcompact blockers (manual `/compact snapcompact` fails locally instead).

Execution order in `SessionMaintenance.compact()` / `runAutoCompaction()`:

1. `session_before_compact` (optional cancel or custom result)
2. `#prepareCompactionFromHooks` → optionally `session.compacting` if no custom result
3. Branch: hook result | snapcompact | `#compactWithFallbackModel` → agent `compact()`

### 2.4 Persist and reload (append-only journal)

**Append:** `SessionManager.appendCompaction()` (`session-manager.ts` ~2152–2173):

```typescript
appendCompaction(summary, shortSummary, firstKeptEntryId, tokensBefore, details?, fromExtension?, preserveData?): string {
	const entry: CompactionEntry = { type: "compaction", ...this.#freshEntryFields(), ... };
	this.#recordEntry(entry);  // push + append JSONL; does not delete prior entries
	return entry.id;
}
```

**Journal model:** `SessionManager` docstring ~403: "append-only conversation journal". Prior entries (including older `compaction` entries and summarized messages) remain on the branch.

**Context rebuild:** `buildSessionContext()` (`session-context.ts` ~294–465):

- Latest compaction on path wins for **LLM context**.
- Emits compaction summary, then entries from `firstKeptEntryId` up to compaction index, then post-compaction entries.
- Transcript mode (`transcript: true`) keeps full chronological history with superseded compaction dividers (`SUPERSEDED_COMPACTION_SUMMARY`).

**Live agent state:** after append, `agent.replaceMessages(buildDisplaySessionContext())` + `rebaseAfterCompaction()`.

---

## 3. Extension / hook seams

### 3.1 Types (`shared-events.ts`)

**`SessionBeforeCompactEvent`:** `preparation`, `branchEntries`, `customInstructions?`, `signal`.

**`SessionBeforeCompactResult`:**

```typescript
export interface SessionBeforeCompactResult {
	cancel?: boolean;
	compaction?: CompactionResult;
}
```

**`CompactionResult`** (agent `compaction.ts` ~149–159):

```typescript
export interface CompactionResult<T = unknown> {
	summary: string;
	shortSummary?: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
	preserveData?: Record<string, unknown>;
}
```

**`SessionCompactingEvent`:** `{ type: "session.compacting", sessionId, messages }` where `messages = messagesToSummarize + turnPrefixMessages`.

**`SessionCompactingResult`:** `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` — **no** `messages` override.

**`SessionCompactEvent`:** post-append notification; `fromExtension: boolean`.

**`CompactionEntry.fromExtension`:** persisted on entry (`session-entries.ts` ~106–107); affects file-op inheritance in `extractFileOperations` (skips prior extension details).

### 3.2 Handler wiring (`session-maintenance.ts`)

**Manual + auto** both call `extensionRunner.emit({ type: "session_before_compact", ... })`:

- Manual: ~644–660
- Auto: ~2462–2485

On `{ cancel: true }`: throws `CompactionCancelledError` (manual) or emits `auto_compaction_end` aborted (auto).

On `{ compaction: CompactionResult }`: sets `fromExtension = true`, `#prepareCompactionFromHooks` returns `kind: "fromHook"`, **skips** LLM and snapcompact.

**`session.compacting`:** only in `#prepareCompactionFromHooks` when `!hookCompaction` (~1638–1648). Merged into summarizer as `extraContext`, `promptOverride`, and merged `preserveData`. Memory backend may append more context (~1651–1654).

**Handler precedence:** extension/hook runners assign `result = handlerResult` per handler — **last registered handler wins** for `compaction`, `context`, `prompt`, `preserveData` (no array merge across handlers).

### 3.3 Wire compression (`before_provider_request`)

`ExtensionRunner.emitBeforeProviderRequest()` (`extensions/runner.ts` ~1424–1450): chains payload replacements per extension. Does **not** mutate stored session entries.

Compaction pressure still uses stored estimate floor (section 1).

---

## 4. Claim verification (2026-08-09 @ 17.2.12 → re-checked 17.3.4)

| # | Claim | Verdict | Grade | Primary evidence |
|---|---|---|---|---|
| **1** | Native pressure = `max(provider-reported context usage, stored-conversation estimate)`, explicitly to defeat on-wire compression extensions | **Confirmed** | **E2** | `compactionContextTokens` + comments `compaction.ts:341–358`; `#estimateStoredContextTokens` comments `session-maintenance.ts:979–988`; all trigger call sites use `compactionContextTokens` |
| **2** | Context transform shrinking provider prompt to ~20k while raw active history ~150k can still trigger native auto-compaction | **Confirmed** | **E2** | Floor math: `max(20k, 150k) = 150k`; if `150k > resolveThresholdTokens(window, settings)` then `shouldCompact` true. Stored estimate counts full active messages (`#estimateStoredContextTokens`), not wire payload |
| **3** | `session_before_compact` can cancel OR return custom `CompactionResult` so QOL can seal mature summaries without a second LLM summarize | **Confirmed** | **E2** | `SessionBeforeCompactResult` `shared-events.ts:375–381`; manual `session-maintenance.ts:653–660`; auto `2462–2485`; `fromHook` branch skips `compact()` `799–805`, `2585–2591` |
| **4** | `session.compacting` can add context/prompt/preserveData but does NOT replace messages-to-summarize | **Confirmed** | **E2** | `SessionCompactingResult` shape `shared-events.ts:383–391`; `#prepareCompactionFromHooks` only passes hook outputs into `SummaryOptions` `1634–1669`; `prepareCompaction` messages fixed before hook |
| **5** | Compaction is append-only at journal level (`CompactionEntry` + `firstKeptEntryId`) | **Confirmed** | **E2** | `appendCompaction` → `#recordEntry` push `session-manager.ts:1111–1127, 2152–2173`; `buildSessionContext` boundary at `firstKeptEntryId` `session-context.ts:438–465`; older compactions remain on branch (transcript superseded markers) |

**17.3.4 deltas relevant to ICM (not overturning claims):**

- Default strategy **`snapcompact`** (auto fallback to context-full remains).
- Richer post-compaction progress guards (`#compactionCreatedHeadroom`, `#rescueCompactionDeadEnd`, snapcompact frame rescue).
- `recordAnchoredHistoryRewrite` / `contextSnapshot.historyRewriteTokensRemoved` for shake — orthogonal to compaction floor.
- Mid-turn dead-end and pre-prompt promotion paths expanded; floor logic unchanged.

---

## 5. Can a plugin own headroom?

### 5.1 What "own headroom" would mean for ICM

1. **Control when native compaction fires** relative to true stored history.
2. **Control reserve/threshold** below the context window.
3. **Replace summarization** with a sealed, plugin-authored summary.
4. **Keep journal lossless** while shrinking model-visible context.

### 5.2 What works today (no core patch)

**Seal path (custom `CompactionResult`) — E2 design, E3+ to validate in omp-qol:**

```
prepareCompaction() → SessionBeforeCompactEvent.preparation
        ↓
plugin session_before_compact handler:
  IF mature summary ready:
    return {
      compaction: {
        summary: <sealed text>,
        shortSummary: <optional UI line>,
        firstKeptEntryId: preparation.firstKeptEntryId,  // or host-valid alternate
        tokensBefore: preparation.tokensBefore,
        preserveData: { icm: { version, index, ... } },
        details: { ... }  // optional
      }
    }
  ELSE IF not ready:
    return { cancel: true }  // abort this pass; journal unchanged
        ↓
host: fromExtension=true, skip LLM/snapcompact
        ↓
appendCompaction(...) → #recordEntry (append-only)
        ↓
buildSessionContext() → compactionSummary + kept tail
        ↓
session_compact { compactionEntry, fromExtension: true }
```

**Supporting hooks:**

- **`session.compacting`:** inject `<additional-context>` lines, override summarizer prompt, stash `preserveData` — only when **not** returning full custom compaction.
- **`before_provider_request` / `context`:** shrink **wire** prompt; **cannot** alone prevent threshold compaction (claim 1).
- **`session_before_compact` cancel:** defer host compaction; use for "not ready to seal" or "ICM will compact on next turn". Risk: cancel on overflow/incomplete recovery may leave session stuck unless combined with other recovery.

**`preserveData`:** survives on `CompactionEntry`, read back via `preparation.previousPreserveData` on iterative compaction and snapcompact/OpenAI remote reuse paths.

### 5.3 What still needs a host seam

| Gap | Why |
|---|---|
| **Runtime reserve/threshold API** | Only `compaction.*` settings; no extension hook to set per-session headroom budget |
| **Replace `messagesToSummarize` / cut algorithm** | `prepareCompaction` + `findCutPoint` are host-only; plugin can only choose `firstKeptEntryId` in returned result (must align with real branch IDs) |
| **Teach context meter about wire-only savings** | `recordAnchoredHistoryRewrite` not on extension surface; only shake uses it today |
| **Merge multi-handler `session.compacting` contributions** | Last handler wins; no built-in concat |
| **Force compaction strategy per plugin** | Strategy is settings-driven (`snapcompact` default on 17.3.4) |
| **Validate custom `firstKeptEntryId`** | Host trusts extension result; bad IDs break `buildSessionContext` emission |

**Bottom line:** A plugin can **own the seal outcome** (summary + preserveData + boundary id) and **veto** a pass, but **cannot own the compaction pressure model** or **silently substitute wire compression for native maintenance**. Native compaction remains the backstop when stored history exceeds threshold.

---

## 6. Overflow / incomplete / manual / threshold / idle (quick reference)

| Path | Entry function | Reason string | Compaction enabled gate | Handoff |
|---|---|---|---|---|
| Context overflow error | `checkCompaction` → `runRecoveryCompactionWithRollback` | `"overflow"` | yes | **forced context-full** |
| Incomplete output (`length`) | same | `"incomplete"` | yes | allowed |
| Post-turn size | `checkCompaction` | `"threshold"` | yes | deferrable (post-prompt task) |
| Pre-prompt size | `runPrePromptCompactionIfNeeded` | `"threshold"` | yes | suppressed inline |
| Mid tool-loop | `maintainContextMidRun` | `"threshold"` | yes + `midTurnEnabled` | suppressed (`suppressHandoff`) |
| Idle timer | `runIdleCompaction` | `"idle"` | **`strategy !== "off"`** (idle ignores `enabled` false except strategy off) | n/a |
| Manual `/compact` | `compact()` | (manual Codex metadata) | user invoked | per strategy |

Promotion (`contextPromotion.enabled`) is attempted before compaction on threshold, overflow, and incomplete paths.

---

## 7. Key functions index

| Function | File |
|---|---|
| `compactionContextTokens` | `packages/agent/src/compaction/compaction.ts` |
| `shouldCompact`, `resolveThresholdTokens`, `resolveBudgetReserveTokens` | `packages/agent/src/compaction/compaction.ts` |
| `prepareCompaction`, `findCutPoint`, `compact` | `packages/agent/src/compaction/compaction.ts` |
| `CompactionResult` (type) | `packages/agent/src/compaction/compaction.ts` |
| `#estimateStoredContextTokens`, `checkCompaction`, `runAutoCompaction`, `compact` | `packages/coding-agent/src/session/session-maintenance.ts` |
| `appendCompaction`, `#recordEntry` | `packages/coding-agent/src/session/session-manager.ts` |
| `buildSessionContext`, `getLatestCompactionEntry` | `packages/coding-agent/src/session/session-context.ts` |
| `getContextBreakdown`, `recordAnchoredHistoryRewrite` | `packages/coding-agent/src/session/session-stats.ts` |
| `SessionBeforeCompact*`, `SessionCompacting*` | `packages/coding-agent/src/extensibility/shared-events.ts` |
| `emitBeforeProviderRequest` | `packages/coding-agent/src/extensibility/extensions/runner.ts` |

---

## 8. ICM implications

1. **Treat native compaction as backstop, not competitor** — floor guarantees ICM wire compression cannot hide 150k stored history behind 20k provider usage.
2. **Primary seal seam: `session_before_compact.compaction`** — skip redundant LLM; set `preserveData` for ICM index/version.
3. **Use `session.compacting` only for LLM-assisted fallback** when ICM has not yet produced a seal.
4. **Do not rely on `cancel: true` alone on overflow** — pair with recovery strategy or accept host retry behavior.
5. **Persist ICM state in `preserveData`**, not by mutating pre-boundary journal entries (append-only invariant).
6. **Implementation gate:** seal path is **E2** on current host; omp-qol needs **E3** (deterministic session test: hook → append → rebuild reads sealed summary + preserveData).

---

## 9. Secondary doc cross-check

`docs/compaction.md` on this commit matches source for: six trigger paths, hook shapes, append/reload flow, default snapcompact strategy, overflow vs incomplete vs threshold behavior, and `firstKeptEntryId` boundary semantics. Use source when doc and code diverge; no divergence found for the five claims above.
