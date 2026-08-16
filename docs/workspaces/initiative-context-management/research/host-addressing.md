# H4: Host Session Journal Addressing (OMP 17.3.4)

**Track:** H4 (`research/00-index.md`)  
**Date:** 2026-08-16  
**Host:** `docs/ref_repos/oh-my-pi-main` @ `de6b7974a0` (17.3.4)  
**Scope:** Session journal identity, `buildSessionContext` projection, `context` event provenance gap, alias viability, smallest host seam. Research only — no product code.

---

## Executive summary

OMP 17.3.4 has **durable, stable journal IDs** at the `SessionEntry` layer (`entry.id`, tree `parentId`, compaction `firstKeptEntryId`, branch `fromId`). **`AgentMessage` objects carry no public entry id** except a **private Symbol** stamped on assistant messages at append time (internal retry/recovery only). The **`context` event delivers a deep-cloned `AgentMessage[]` with no parallel provenance**, so a plugin **cannot reliably map context messages back to `SessionEntry` without re-projection or content/persistence-key heuristics**.

`buildSessionContext` is **lossy and reordering** relative to the raw branch: compaction/reset-boundary slicing, synthetic summary messages, dangling-tool stripping, retry-recovery elision, and **fresh objects** for `custom_message` / summary entries. A **plugin-only `m0001` alias layer** can work as **overlay-local persistence** but **must not** be treated as canonical identity or shown to the model as frozen `@N` syntax.

**Smallest host seam:** extend the pre-LLM pipeline with **`ContextRecord { message, source: { entryId, kind } }`** built **once** alongside `buildSessionContext`, threaded through `transformContext` / `ContextEvent`. Recommend **persistence identity only** — do not freeze public `@12`-style message numbers.

---

## 1. Stable IDs that exist today

### 1.1 Session and journal layer (`SessionEntry`)

Every persisted row (except the JSONL header) extends `SessionEntryBase`:

| Field | Stability | Role |
|---|---|---|
| `id` | **Stable, unique per session file** | Primary journal address; 8-hex suffix of UUID (collision-checked), snowflake fallback |
| `parentId` | **Stable pointer** | Tree edge; `null` = root |
| `timestamp` | ISO string at append | Sort key; copied into many projected messages as `timestamp: number` |
| `type` | Discriminator | See kinds below |

**Session header** (`SessionHeader`): `id` = session UUID v7 (`mintSessionId()`), distinct from entry ids.

**ID minting** (`session-migrations.ts`):

```typescript
export function generateId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = crypto.randomUUID().slice(-8);
    if (!byId.has(id)) return id;
  }
  return Snowflake.next();
}
```

v1→v2 migration assigned ids in file order with linear `parentId` chain; v2+ entries keep ids across compaction, branch, fork (fork copies entries verbatim with same ids in the new file — new session header id only).

**Kind-specific stable pointers:**

| Entry type | Extra stable fields | In LLM context? |
|---|---|---|
| `message` | Wraps one `AgentMessage` | Yes (when on active path and not filtered) |
| `compaction` | `firstKeptEntryId`, `summary`, `preserveData`, `tokensBefore` | Summary + kept tail (see §3) |
| `branch_summary` | `fromId` (branch point id, not summary entry id) | Yes → synthetic `branchSummary` message |
| `custom_message` | `customType`, `display`, `content` | Yes → re-materialized `custom` message |
| `custom` | `customType`, `data` | **No** — overlay persistence only |
| `reset_boundary` | (marker only) | Boundary only — emission starts after latest on path |
| Metadata (`model_change`, `label`, `session_init`, …) | Various | **No** — settings / audit / TUI |

`SessionManager` exposes **`getEntry(id)`**, **`getBranch(fromId?)`**, **`getLeafId()`**, **`getTree()`**. Extensions receive **`ReadonlySessionManager`** (`getBranch`, `getEntry`, `getEntries`, …) — **not** `buildSessionContext()` on that interface.

### 1.2 Tool-call IDs

Within assistant turns, each `toolCall` block has **`block.id`** (tool use id). **`toolResult` messages** carry **`toolCallId`** + **`toolName`**. Pairing is by id on the resolved leaf→root path; dangling calls are stripped before LLM replay (`session-context.ts`).

These ids are **stable within a persisted assistant turn** but address **tool invocations**, not journal rows (tool results are separate `message` entries).

### 1.3 Message-layer IDs (provider / persistence keys)

**`AgentMessage` has no `entryId` field.** Roles use provider- or runtime-scoped identifiers:

| Role / artifact | Identifiers | Notes |
|---|---|---|
| `assistant` | `timestamp`, `provider`, `model`, `responseId?`, `stopReason`, `retryRecovery?` | `sessionMessagePersistenceKey()` uses these for dedup |
| `toolResult` | `timestamp`, `toolCallId`, `toolName` | Persistence key |
| `user` / `developer` | `timestamp`, `attribution?` | Persistence key |
| `fileMention` | `timestamp` | Persistence key |
| `custom` / summaries | `timestamp`, `customType` / `summary` | **No** persistence key in `turn-persistence.ts` |
| `compactionSummary` | `timestamp`, `tokensBefore`, `summary` | Synthetic; not a journal row shape |
| `branchSummary` | `fromId`, `timestamp` | `fromId` = branch **point**, not summary entry id |

**Internal-only entry link:** on assistant append, `AgentSession` sets  
`Symbol("persistedSessionEntryId")` → entry id (`agent-session.ts`). Used by turn recovery; **not part of public API**, not on other roles, **lost** when messages are re-built from summaries/custom entries, and **not a contract for plugins**.

### 1.4 Display / model-facing “numbers” (not message journal ids)

Host does **not** expose `@12` or `m0001` message indices to the model for journal addressing.

What **does** exist:

| Syntax | Scope | Purpose |
|---|---|---|
| `[Image #N]` / `attachment://N` | Latest user message images only | TUI + tools (`session-provider-boundary.ts`, `image-references.ts`) |
| `@filepath` | User input | `fileMention` entries — **file** reference, not message id |
| Entry id prefix in hooks UI | TUI branch confirm | e.g. `event.entryId.slice(0, 8)` — not model context |
| `turn_id` | `session_stop` event | Turn counter, not journal entry |

**Transcript / history export** serializes `AgentMessage[]` with roles and text — **no stable ordinal** tied to `SessionEntry.id`.

---

## 2. Can a plugin map `context` event `AgentMessage[]` → `SessionEntry` without content matching?

### 2.1 What the `context` event actually delivers

From `shared-events.ts`:

```typescript
export interface ContextEvent {
  type: "context";
  /** Messages about to be sent to the LLM (deep copy, safe to modify) */
  messages: AgentMessage[];
}
```

Pipeline (`sdk.ts` → `agent-loop.ts`):

1. `agent.state.messages` = output of last `buildSessionContext()` sync (via `replaceMessages`).
2. Before each provider call: `transformContext(messages)` → `extensionRunner.emitContext(messages)`.
3. `emitContext` **`structuredClone`s** the array (fallback: shallow copy) then runs handlers **in extension load order**; each may replace the entire `messages` array (`extensions/runner.ts`).

**Original session entries are explicitly not modified** (`shared-events.ts` comment). Only the outbound LLM view changes.

### 2.2 Verdict: **not reliably without heuristics or host provenance**

| Approach | Works? | Why |
|---|---|---|
| Object identity (`message === entry.message`) | **No** | `structuredClone` in `emitContext`; custom/summary messages are **new objects** every rebuild |
| `entry.id` on message | **No** | Not on public message shape; Symbol only on some assistants at append time |
| `sessionMessagePersistenceKey` | **Partial** | Covers `assistant`, `toolResult`, `user`, `developer`, `fileMention` only; collisions need `sameMessageContent`; **no key** for `custom`, summaries, bash/python |
| Re-walk `getBranch()` + replicate `buildSessionContext` | **Fragile** | Duplicates host logic; breaks on any host projection change; still ambiguous for synthetic 1:N mappings |
| Content hash / text match | **Unsafe** | Compaction/shake/steering wrap/prune mutate content; duplicate text; summary replaces many entries |

**Plugin CAN** address journal rows directly via **`ctx.sessionManager.getEntry(entryId)`** and **`getBranch()`** when the agent tool / overlay **stores `entryId`** in `appendEntry` custom data. It **CANNOT** infer that id from the cloned context array alone.

### 2.3 Correspondence table (projection → entry)

When **`buildSessionContext`** builds the LLM list (non-transcript), each emitted slot maps to sources as follows:

| Emitted `AgentMessage` | Typical source | 1:1 with one `SessionEntry.id`? |
|---|---|---|
| `user` / `assistant` / `toolResult` / … from `type:"message"` | Same object as `entry.message` **before clone** | **Yes** — one entry |
| `custom` from `custom_message` | **New** object from `createCustomMessage(entry.*)` | **Yes** — one entry, but new identity each rebuild |
| `branchSummary` | **New** from `createBranchSummaryMessage(summary, entry.fromId, …)` | **Mixed** — one `branch_summary` entry; `fromId` ≠ summary entry id |
| `compactionSummary` | **New** from compaction entry | **One entry, many elided** — summary represents whole compacted region |
| (none) | `retryRecovery` assistant on branch | Entry exists on disk; **dropped** from LLM context |
| (none) | `PREWALK_PLAN` custom_message | Entry on disk; **dropped** from LLM context |
| (none) | `custom` entries | Never emitted |
| (stripped / dropped) | Dangling tool calls, error/aborted turns | Entry may exist; **message shape changed or removed** |

---

## 3. How `buildSessionContext` reconstructs native messages

**Entry point:** `SessionManager.buildSessionContext(options?)` → `buildSessionContext(entries, leafId, byId, options)` in `session-context.ts`.

### 3.1 Path resolution

1. Resolve **leaf** (`leafId` arg, else last entry).
2. Walk **`parentId` chain** leaf→root (cycle-safe), reverse to **chronological path**.
3. Scan path for **settings**: thinking/model/service tier/mode/TTSR; keep **latest compaction** on path.

### 3.2 Emission modes (mutually exclusive branches)

**A. Full transcript** — `transcript: true`, `collapseCompactedHistory: false`  
Every path entry in order; each compaction inline (superseded compactions get placeholder summary text).

**B. Reset boundary wins** — latest `reset_boundary` on path **after** latest compaction index  
Emit **`appendMessage` only for entries after boundary** (both LLM and collapsed transcript). Pre-reset history remains on disk only.

**C. Compaction path** — latest `compaction` on path (and no later reset boundary)  
1. Optionally prepend **`compactionSummary`** first for LLM (not transcript ordering).  
2. Emit **kept tail**: entries from `firstKeptEntryId` through pre-compaction index (unless OpenAI remote replacement skips kept rows for LLM-only payload).  
3. For transcript: insert summary at chronological compaction point.  
4. Emit all entries **after** compaction entry.

**D. Default** — no compaction / boundary logic  
All path entries via `appendMessage`.

### 3.3 `appendMessage` rules

- **`message` entry:** push `entry.message` (skip `assistant` with `retryRecovery` when not transcript).
- **`custom_message`:** skip `PREWALK_PLAN` (non-transcript); normalize → `createCustomMessage` (**new object**, `timestamp` from entry ISO).
- **`branch_summary`:** `createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)`.

**Not emitted:** `custom`, labels, model/mode metadata, `session_init`, pins, etc.

### 3.4 Post-processing (LLM context only unless noted)

1. **Dangling tool calls:** strip unpaired `toolCall` blocks from assistant turns; neutralize signed thinking; transcript keeps placeholder via `strippedToolCalls` marker.
2. **Error/aborted assistants:** remove failed turns and paired synthetic tool results (except interrupted-thinking continuity pair).

### 3.5 Identity implications for ICM

- **`message` entries:** stable **in-place** `entry.message` reference across rebuilds until maintenance mutates content (shake, image strip, retry markers) — see `applyShakeRegion` comment in `shake.ts`.
- **`custom_message` entries:** **unstable message identity** across rebuilds (always re-materialized).
- **Compaction:** one summary message **substitutes for** many entries in LLM view; **`firstKeptEntryId`** is the durable pointer to the kept tail anchor on disk.
- **OpenAI remote compaction:** `preserveData.openaiRemoteCompaction.replacementHistory` can replace kept messages for LLM while transcript still shows kept `SessionEntry` rows.

---

## 4. Plugin-only alias layer (`m0001` style) — viability and breakages

### 4.1 Viable use

A plugin **may** maintain its **own** map:

```text
overlay alias (m0001) → (sessionId, entryId)
```

stored in **`appendEntry` custom types**, assigned when the reducer **walks `getBranch()`** and emits projection slots — **provided** it computes provenance from **entries**, not from cloned context messages.

Aliases are **overlay-local**, **append-only**, and **reassignable** across sessions/branches if the plugin defines tie-break rules (e.g. never reuse alias after tombstone).

### 4.2 What breaks if aliases are derived from `context` messages

| Scenario | Failure mode |
|---|---|
| **Other context plugins first** | Extension order replaces whole array; alias table tied to array index or clone content desyncs |
| **Retries / `retryRecovery`** | Superseded assistant entries exist on disk but **absent** from context; alias appears to “jump” or point at dead turns |
| **Multi-tool turns** | One assistant entry, many `toolCallId`s; one alias cannot address individual tools without sub-addressing |
| **Hidden / filtered messages** | `display:false` custom, `PREWALK_PLAN`, `excludeFromContext` bash/python — on disk, not in LLM list; index-based alias skips them |
| **Compaction / branch summary** | One context slot ↔ many elided entries; alias must bind to **`compaction` / `branch_summary` entry id**, not summary text |
| **Dangling-tool rewrite** | Assistant entry persists; context message **content differs** (stripped calls) |
| **Steering wrap** | `wrapSteeringForModel` changes user bytes **after** context event in `transformContext` chain — alias tied to pre-wrap content diverges from wire |
| **Remote compaction** | LLM sees replacement history; kept entries still on branch — alias from context count ≠ journal |
| **`structuredClone`** | Cannot attach non-enumerable Symbol maps to cloned messages safely for cross-handler provenance |

### 4.3 Do not expose `@N` / `m0001` as frozen public syntax

Per `INVARIANTS.md` tension row: **provenance seam is not closed**; freezing `@12` in tool prompts or agent docs creates **false confidence**. Use **`entryId`** (and session id) in **persistence and overlay**; if human-readable aliases are shown, label them **session-local and unstable across replay**.

---

## 5. Smallest host seam for provenance

### 5.1 Recommended shape

Introduce **`ContextRecord`** at the boundary where the host already owns truth:

```typescript
type ContextSourceKind =
  | SessionEntry["type"]
  | "synthetic_compaction"
  | "synthetic_branch"
  | "synthetic_custom";

interface ContextSource {
  /** Journal row id when one row owns this slot; null for purely synthetic slots */
  entryId: string | null;
  kind: ContextSourceKind;
  /** Optional: compaction.firstKeptEntryId, branchSummary.fromId, toolCallId for sub-entry precision */
  anchor?: { firstKeptEntryId?: string; fromId?: string; toolCallId?: string };
}

interface ContextRecord {
  message: AgentMessage;
  source: ContextSource;
}
```

### 5.2 Minimal integration points (ordered by invasiveness)

1. **Build provenance alongside projection** — extend internal `buildSessionContext` (or parallel builder) to return `{ messages, records }` with **aligned indices**, using the **same emission branches** as §3 (compaction, reset, appendMessage, post-filters record **inclusion/exclusion** explicitly).

2. **Thread through agent state** — when calling `agent.replaceMessages`, optionally sync a **parallel `ContextRecord[]`** (or WeakMap from message object → source **before** clone) on `AgentSession`.

3. **Extend `ContextEvent`** — e.g. `{ type: "context", records: ContextRecord[] }` **or** `{ messages, sources }` with `sources.length === messages.length`. Handlers that only replace `messages` must **also** replace or pass through `sources` (document contract).

4. **`transformContext` signature** — accept/return records, or wrap in `sdk.ts` so `emitContext` preserves sources when handlers return `{ messages }` only (host re-joins via persistence keys as fallback — explicit degradation).

**Do not** require plugins to import private `buildSessionContext` from package internals; expose via **`ReadonlySessionManager.buildSessionContextWithProvenance?()`** or event payload only.

### 5.3 What this unlocks for ICM

- Pin/compress targets **`(sessionId, entryId)`** with explicit handling for **summary slots** (`kind: synthetic_compaction`).
- Overlay reducer can diff **first divergence frontier** using stable entry ids instead of text.
- Agent tools return **`entryId`** in JSON envelope; optional **`alias`** as display-only field.

### 5.4 Explicit non-goals for the seam

- **No** frozen `@N` wire syntax in host prompts.
- **No** requirement that every tool call within a turn get its own entry id (tool granularity stays `toolCallId` unless journal splits are added later).
- **No** change to lossless JSONL journal (overlay remains `custom` + `appendEntry`).

---

## 6. Recommendations for omp-qol ICM

1. **Persist pins/compress/seal targets as `(sessionId, entryId)`** in overlay custom entries — never array indexes into `context.messages`.

2. **Build overlay projection from `getBranch()` + entry ids**, not from post-clone context arrays. Treat `context` event messages as **malleable output**, not authoritative keys.

3. **Use `sessionMessagePersistenceKey` only as a secondary dedup hint** inside the host session, not as ICM primary identity.

4. **Request host provenance** (`ContextRecord`) as the real fix; until then, document **known ambiguous cases** (compaction summaries, branch summaries, filtered custom messages, multi-handler context chains).

5. **Agent-facing tools:** return **`entryId`** and **`sessionId`** in the pure-JSON envelope; if showing shorthand aliases, mark **`"stable": false`** or omit from v1 tool schema.

6. **Do not implement `@12` / `m0001` as public contract** in prompts, skills, or pillar docs — aligns with `INVARIANTS.md` §Explicit tensions.

---

## Appendix A — Key file references (host @ de6b7974a0)

| Topic | Path |
|---|---|
| Entry types | `packages/coding-agent/src/session/session-entries.ts` |
| ID generation / migration | `packages/coding-agent/src/session/session-migrations.ts` |
| Journal API | `packages/coding-agent/src/session/session-manager.ts` |
| Context projection | `packages/coding-agent/src/session/session-context.ts` |
| Message transforms / LLM | `packages/coding-agent/src/session/messages.ts` |
| Persistence keys | `packages/coding-agent/src/session/turn-persistence.ts` |
| Assistant entry Symbol | `packages/coding-agent/src/session/agent-session.ts` (~424, ~2290) |
| Context event | `packages/coding-agent/src/extensibility/shared-events.ts` |
| Extension emitContext | `packages/coding-agent/src/extensibility/extensions/runner.ts` |
| transformContext wiring | `packages/coding-agent/src/sdk.ts`, `packages/agent/src/agent-loop.ts` |
| ReadonlySessionManager surface | `packages/coding-agent/src/session/session-manager.ts` (~327) |
| Summary message factories | `packages/agent/src/compaction/messages.ts` |

## Appendix B — Cross-references

- H6 plugin reach: [`plugin-seams.md`](./plugin-seams.md)
- Invariants: [`../INVARIANTS.md`](../INVARIANTS.md) (items 7, 11; `@message` tension)
- Pending: H2 `host-context-event.md`, H1 `host-compaction.md`, H3 `host-cache.md`
