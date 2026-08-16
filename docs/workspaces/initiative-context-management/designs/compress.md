# Initiative Compress — primitive design

**status:** PROPOSED — main-agent integration review done 2026-08-16
**integration review:** §§1.3 / 2.2 / 2.4 / 5.5 / 6 / 7 / 8-T4 aligned to the `overlay-schema.md` working freeze (no nesting, `b:` endpoints illegal for create, pins accept+warn, straddling→`shadowed`). Each fix is marked inline; conflicts recorded in `DECISIONS.md`, not silently resolved.
**date:** 2026-08-16
**host lock:** OMP 17.3.4 @ `de6b7974a0` (`docs/ref_repos/oh-my-pi-main`, read-only)
**depends on:** `designs/overlay-engine.md`, `designs/address-layer.md`, `designs/agent-ux.md`, `designs/sealed-expand.md` (taken as given), `designs/overlay-schema.md` (sibling, owns event storage — referenced loosely as "per overlay-schema"), H1 `research/host-compaction.md`, H2 `research/host-context-event.md`, H3 `research/host-cache.md`, H4 `research/host-addressing.md`, D1 `research/dcp-opencode.md`, D2 `research/pi-dcp.md`, U1 `research/agent-ux.md`.
**scope:** compress family of the single multi-op `context` tool (working bet, `designs/agent-ux.md` §Tool shape). Documentation only. Event schema, block-id minting, non-overlap/shadow/pin-conflict rules are owned by overlay-schema and only referenced here.

## 0. Host shapes this design was verified against

- `AgentMessage = Message | CustomAgentMessages[...]` — `packages/agent/src/types.ts` ~660. Core `Message = UserMessage | DeveloperMessage | AssistantMessage | ToolResultMessage` — `packages/ai/src/types.ts` ~963.
- One assistant message may carry **multiple `ToolCall` blocks** in `content` (`AssistantMessage` ~891; `ToolCall { type:"toolCall", id, name, arguments }` ~796). Every tool result is a **separate message** `ToolResultMessage { toolCallId, toolName, content, isError, useless? }` ~941 — a multi-call turn is one assistant slot followed by N toolResult slots.
- Coding-agent custom roles handled by `convertOne` (`packages/coding-agent/src/session/messages.ts` ~1168–1285): `bashExecution`/`pythonExecution` (dropped when `excludeFromContext`), `fileMention` (**1:N** — one entry projects into a `developer` slot plus a `user` image slot), `custom`, `hookMessage`, `branchSummary`, `compactionSummary`.
- Pipeline order (H2 §Executive summary; `sdk.ts` ~3107–3110): `buildSessionContext` → `emitContext` (our handler, cloned `AgentMessage[]`, **no entry ids**) → `wrapSteeringForModel` → `convertToLlm` → provider normalize. Steering wrap is position-independent and cache-deterministic (`messages.ts` ~758–777).
- Host projection already normalizes, before our handler sees the array (`session-context.ts`): dangling `toolCall` blocks stripped from any assistant turn, empty turns spliced out (~473–534); error/aborted assistant turns dropped **together with their paired synthetic toolResults**, except the interrupted-thinking continuity pair (~536–569).
- `type:"custom"` journal entries are never model-visible (`session-entries.ts` ~148–152; H2 §4).
- Native cut points are never `toolResult` (`packages/agent/src/compaction/compaction.ts` `findValidCutPoints` ~540–570); `CompactionPreparation { firstKeptEntryId, messagesToSummarize, turnPrefixMessages, isSplitTurn, tokensBefore, … }` ~1163–1183; `SessionBeforeCompactEvent { preparation, branchEntries, signal }` — `shared-events.ts` ~64–74.

## 1. Op set and envelope

Addresses are typed canonical ids per `designs/agent-ux.md`: `m:<entryId>` (journal message), `t:<toolCallId>` (tool call+result unit), `b:<blockId>` (compression block). Resolution is always from `getBranch()` (H4 §2.2 — never from `context` clones). Envelope copies advisor (`designs/agent-ux.md` §Envelope extras): `{ ok, tool:"context", op, summary?, error?, action?, warnings }` plus, on every result that talks about size: `rawActiveEstimateTokens`, `projectedEstimateTokens`, `lastProviderPromptTokens`, `nativeCompactionPressureTokens` (= `max(provider, stored)`, H1 §1.1), `exactExpandAvailable`. Approval: `state`/`preview` = read; `compress`/`expand`/`seal` = write (agent-ux §Approval).

### 1.1 `compress` (write)

Request: `{ "op":"compress", "start":<id>, "end":<id>, "summary":<string, required, agent-authored>, "topic":<string ≤120, optional> }`. One contiguous range per call (batch = open item OI-2).

Response adds: `blockId`, `requested` (echo), `applied` (resolved slot boundaries after typed-id resolution — §2.3), `estimate { tokensBefore, tokensAfter }` (frozen at commit), `exactExpandAvailable: true`.

Worked example — compress an exploration span whose `end` names a tool call:

```json
{ "op": "compress", "start": "m:1f2e3d4c", "end": "t:call_9frT2",
  "topic": "repo layout exploration",
  "summary": "Explored packages/: agent owns loop+compaction; coding-agent owns session/tools; found buildSessionContext in session-context.ts. No edits made." }
```

```json
{ "ok": true, "tool": "context", "op": "compress", "blockId": "b:k7q2",
  "requested": { "start": "m:1f2e3d4c", "end": "t:call_9frT2" },
  "applied": { "start": "m:1f2e3d4c", "end": "m:8c1d9e0f", "visibleSlots": 14 },
  "estimate": { "tokensBefore": 18400, "tokensAfter": 310 },
  "rawActiveEstimateTokens": 141200, "projectedEstimateTokens": 96900,
  "lastProviderPromptTokens": 91800, "nativeCompactionPressureTokens": 141200,
  "exactExpandAvailable": true,
  "warnings": ["end t:call_9frT2 resolved to its full call+result unit (last result m:8c1d9e0f)"] }
```

### 1.2 `expand` (write)

Request: `{ "op":"expand", "target":"b:<blockId>", "mode?":"auto"|"rehydrate"|"branch" }`. Semantics per `designs/sealed-expand.md`, taken as given: pre-seal `auto` → overlay-disable (exact, reversible); post-seal `auto` → `rehydrate` (journal-sourced provider-neutral block at tail), `exactExpandAvailable:false`, `alternatives:["branch"]`; `branch` only when explicitly requested and reachable. Expand on an already-disabled block is idempotent `ok:true` + warning. Explicitly requested unavailable mode → reject `mode_unavailable`.

Worked example — post-seal:

```json
{ "op": "expand", "target": "b:k7q2" }
```

```json
{ "ok": true, "tool": "context", "op": "expand", "blockId": "b:k7q2",
  "expandMode": "rehydrate", "exactExpandAvailable": false,
  "alternatives": ["branch"],
  "summary": "b:k7q2 was sealed into compaction c:77aa01bc; original entries re-rendered from journal at tail (content-exact, position-synthetic).",
  "rawActiveEstimateTokens": 88100, "projectedEstimateTokens": 74300,
  "lastProviderPromptTokens": 70400, "nativeCompactionPressureTokens": 88100,
  "warnings": [] }
```

### 1.3 `state` (read; may merge into `list`/`status` at tool-shape freeze, Q6 open)

Request: `{ "op":"state", "target?":"b:<blockId>" }`. Response: per-block rows `{ blockId, state, topic, range {start,end}, estimate, mature, exactExpandAvailable, sealedTo? }`. Block states per `designs/overlay-engine.md`: `active-overlay | disabled | shadowed | sealed-native-compaction | invalid-source` (+ `straddlesSeal:true` display note for blocks whose range crossed the host cut, §5 step 5).

Worked example:

```json
{ "op": "state" }
```

```json
{ "ok": true, "tool": "context", "op": "state",
  "blocks": [
    { "blockId": "b:k7q2", "state": "sealed-native-compaction", "topic": "repo layout exploration",
      "range": { "start": "m:1f2e3d4c", "end": "m:8c1d9e0f" }, "mature": false,
      "exactExpandAvailable": false, "sealedTo": "c:77aa01bc" },
    { "blockId": "b:m3x8", "state": "active-overlay", "topic": "failed build attempts",
      "range": { "start": "m:0a1b2c3d", "end": "m:4e5f6a7b" }, "mature": true,
      "estimate": { "tokensBefore": 9200, "tokensAfter": 180 }, "exactExpandAvailable": true } ],
  "rawActiveEstimateTokens": 88100, "projectedEstimateTokens": 74300,
  "lastProviderPromptTokens": 70400, "nativeCompactionPressureTokens": 88100,
  "warnings": [] }
```

### 1.4 `preview` (read, dry-run)

Request: `{ "op":"preview", "start":<id>, "end":<id> }` — no `summary` required, nothing persisted. Runs the full closure algorithm (§2) and returns exactly what `compress` would return (`applied`, `estimate`, warnings) or exactly the rejection `compress` would return, with `wouldApply:true|false`. This is the discovery path that makes the zero-widening tolerance (§2.3) cheap: preview → copy `applied`/`suggested` → compress.

Worked example (unsafe range):

```json
{ "op": "preview", "start": "m:2b3c4d5e", "end": "m:6f7a8b9c" }
```

```json
{ "ok": false, "tool": "context", "op": "preview", "wouldApply": false,
  "error": "range splits a multi-call assistant turn: m:6f7a8b9c carries 3 toolCall blocks; results t:call_a2/t:call_b7 fall outside the range",
  "reason": "turn_split",
  "requested": { "start": "m:2b3c4d5e", "end": "m:6f7a8b9c" },
  "suggested": { "start": "m:2b3c4d5e", "end": "m:d0e1f2a3" },
  "suggestedAlternatives": [ { "start": "m:2b3c4d5e", "end": "m:5e6f7a8b" } ],
  "action": "re-issue compress with `suggested` (full closure) or an alternative that stops before the split turn",
  "warnings": [] }
```

### 1.5 `seal` (write, explicit) + passive seal

Request: `{ "op":"seal" }` — explicitly asks the host to compact **now** via `ctx.compact` (H2 §Actions); the passive path is identical except the trigger is native pressure (§5). Our `session_before_compact` handler then supplies (or declines to supply) the custom `CompactionResult`. Response after the pass: `mode: "custom-seal" | "native-fallback" | "nothing-to-do"`, `sealedBlocks`, `compactionEntry` (`c:<entryId>`), `gapTokens`.

Worked example:

```json
{ "op": "seal" }
```

```json
{ "ok": true, "tool": "context", "op": "seal", "mode": "custom-seal",
  "sealedBlocks": ["b:m3x8", "b:p9r4"], "compactionEntry": "c:9d8e7f6a", "gapTokens": 1450,
  "summary": "2 mature blocks merged chronologically into one CompactionResult; firstKeptEntryId taken verbatim from host preparation.",
  "rawActiveEstimateTokens": 52300, "projectedEstimateTokens": 51200,
  "lastProviderPromptTokens": 49900, "nativeCompactionPressureTokens": 52300,
  "exactExpandAvailable": false,
  "warnings": ["sealed blocks now expand via rehydrate/branch only (designs/sealed-expand.md)"] }
```

## 2. Protocol-safe closure algorithm

Protocol safety is a property of the **projected message array**, not of journal rows (INVARIANTS §8). The engine therefore computes closure on a reconstruction of the native projection plan from `getBranch()` (address-layer §How the plugin sees entries), mirroring the host's own emission and normalization rules.

### 2.1 Definitions

- **Emission window:** journal path entries after the later of (latest `compaction` on path, latest `reset_boundary` on path) — mirrors `buildSessionContext` emission modes B/C/D (H4 §3.2). Plus the synthetic `compactionSummary` slot, which is **not addressable as a compress target in v1** (U1 §5.3: `c:` is a representing id, not a default target).
- **Visible slot:** a projected `AgentMessage` the model will see. From `convertOne` + host normalization: `user`, `developer`, `assistant` (post dangling-strip, post error-drop), `toolResult`, `bashExecution`/`pythonExecution` without `excludeFromContext`, `fileMention` (one entry → up to two slots), `custom` (from `custom_message` entries, except `PREWALK_PLAN`), `hookMessage`, `branchSummary`.
- **Coverage-only row:** journal row inside the range that projects nothing — `retryRecovery` assistants, dropped error/aborted turns and their synthetic results, `excludeFromContext` executions, `PREWALK_PLAN` (H4 §2.3). Recorded as covered (per overlay-schema), never forces closure, never rendered.
- **Excluded row:** `type:"custom"` entries (ours and others') and metadata entries (`model_change`, `label`, `thinking_level_change`, …). Not model-visible, not covered, not tombstoned — they pass through untouched.
- **Turn unit:** one assistant slot + **all** toolResult slots paired to its `toolCall` block ids + its interrupted-thinking continuity marker when present (`session-context.ts` ~550). After host normalization every projected pair is complete, so units are well-defined.

### 2.2 Algorithm (numbered)

1. **Resolve endpoints** on the active branch: `m:<entryId>` → that entry; `t:<toolCallId>` → its turn unit (start endpoint → the assistant entry carrying the call; end endpoint → the last toolResult entry paired to any call of that unit); `b:<blockId>` → **rejected as a compress/preview endpoint** (`block_endpoint`) — overlay-schema §4.2 forbids block ids as create boundaries in v1; the rejection carries the block's stored `m:` range so the agent can copy it. Unknown id → reject `unknown_ref`; id on another branch → `off_branch`; id naming an excluded row → `not_projectable`. *(Integration fix 2026-08-16: draft resolved `b:` to source boundaries.)*
2. **Order-normalize:** if `start` follows `end` in path order, swap and append a warning (argument-order fix, not a widening).
3. **Window check:** if the resolved range is not fully inside the emission window → reject `crosses_boundary`, with `suggested` = the range clipped to the window (§7.3).
4. **Materialize** the contiguous journal slice `[start..end]` and classify every row: visible slot(s) / coverage-only / excluded (§2.1).
5. **Rebuild the projection plan** for the window (same walk the `context` handler uses to replay overlay state — one reducer, address-layer §How), applying the host's own normalizations: dangling `toolCall` strip and empty-turn splice (`session-context.ts` ~473–534), error/abort turn drop with paired synthetic results (~536–569). After this step every toolCall in the plan has exactly one paired toolResult slot and vice versa.
6. **Unit-closure check:** for every turn unit that intersects the requested visible slots, verify the unit is **entirely** inside the range. Violations:
   - unit's toolResult slots extend past `end` → minimal closure extends `end` to the unit's last slot;
   - a toolResult inside the range whose assistant slot precedes `start` → closure extends `start` to that assistant slot;
   - a multi-call assistant slot inside the range with any sibling result outside → closure extends to cover all sibling results;
   - an interrupted-thinking pair split by an endpoint → closure includes both slots.
   If any closure extension adds ≥1 visible slot → **reject** `pair_split` (result/call machinery) or `turn_split` (multi-call sibling / interrupted pair), returning `suggested` = the minimal contiguous closure and `suggestedAlternatives` = maximal safe subranges strictly inside the request. Never apply the closure (§2.3).
7. **Contiguity note:** `suggested` is contiguous, so interleaved user/steering/`custom_message` slots sitting between a call and its results are listed inside `suggested`. The rejection `error` names them; compressing them happens only if the agent re-issues with that range (agent decides, U1 §8.3).
8. **Overlap check** per overlay-schema §4.1–4.4: **any** overlap with an `active-overlay` block — partial or full containment — → reject `overlaps_block` (no nesting in v1; the recompress path is disable-the-old-block then create-the-wider-block; overlap with `disabled` blocks is legal). Pinned entries inside the range → **accepted** with a mandatory warning listing the covered pin ids (pins win visibility; both apply — §7.1). *(Integration fix 2026-08-16: draft nested containment and rejected pinned ranges.)*
9. **Empty check:** zero visible slots in range → reject `empty_range`.
10. **Persist and return:** append the compress event citing `(sessionId, entryId)` boundaries plus the resolved coverage list (per overlay-schema); return the envelope with `requested`, `applied`, frozen `estimate`.

### 2.3 What is auto-normalized vs rejected — the tolerance

**Tolerance for silent widening over visible slots: zero.** The engine auto-applies exactly three normalizations, all disclosed via `applied` + `warnings`, none of which add a visible slot the request did not span:

| Auto-applied (resolution, not widening) | Rejected (closure over visible slots) |
|---|---|
| Endpoint order swap (step 2) | Any extension adding a visible slot: `pair_split`, `turn_split` |
| Typed-id unit resolution: `t:` endpoint → its own unit's boundary slots; `b:` endpoint → block source boundary (step 1) | Range crossing compaction / reset boundary: `crosses_boundary` (clip suggested, never silently clipped) |
| Inclusion of coverage-only and excluded rows falling inside the span (they project nothing) | Partial overlap with an active block: `overlaps_block` |

Rationale: `designs/agent-ux.md` §Failures ("never silently compress extra messages") and U1 §8.3 explicitly reject widen-and-persist, including sibling call/result pulls. The 2026-08-09 overlay-engine language permitting planner-applied closure with a report is superseded by that choice — tension recorded in §8, not silently resolved. `preview` (§1.4) keeps the two-call cost negligible. Note the `t:` resolution can legitimately surprise (a `t:` end in a single-call turn pulls in that turn's result slot — that IS the unit the id names); it is disclosed in `warnings` every time.

### 2.4 Edge-case table

| Case (verified host shape) | Behavior |
|---|---|
| Multi-call assistant turn, range covers all its results | Accept; whole unit inside |
| Multi-call assistant turn, some sibling results outside | Reject `turn_split` + suggested closure (no partial-slot surgery in v1 — OI-1) |
| Range starts at a toolResult of an earlier assistant | Reject `pair_split`; suggested start = that assistant slot |
| `t:` endpoint in a multi-call turn | Resolves to the **whole turn unit**; if the unit fits the range → accept, else `turn_split` |
| Errored toolResult (`isError:true`) paired normally | Normal visible unit; compressible |
| Error/aborted assistant turn + synthetic results (journal) | Coverage-only — host already dropped them (`session-context.ts` ~536–569) |
| Dangling toolCall (results off-path) | Host already stripped the block / spliced empty turn (~473–534); coverage-only if the row projects nothing |
| Interrupted-thinking pair (aborted assistant + marker) | Atomic unit; splitting endpoint → `turn_split` |
| Steering user message (`steering:true`) inside range | Visible user slot; compressible (pillar: any message). Wrap happens after our handler (`sdk.ts` ~3107–3110) so hiding it is safe |
| `developer` / `custom_message` / `hookMessage` / `branchSummary` slots | Visible; compressible |
| `fileMention` entry (projects 1:N) | Addressed at entry level; hiding the entry hides both projected slots |
| `bashExecution` with `excludeFromContext` / `PREWALK_PLAN` / `retryRecovery` | Coverage-only |
| Our overlay events / any `type:"custom"` entry inside range | Excluded — never model-visible (`session-entries.ts` ~148), never covered |
| `compactionSummary` slot as target | Reject `not_projectable` in v1 (OI-3) |
| Range crossing latest compaction / reset boundary | Reject `crosses_boundary` + clipped `suggested` (§7.3) |
| Range overlapping an `active-overlay` block (any form, incl. containment) | Reject `overlaps_block`; recompress = disable + wider create (overlay-schema §4.2); overlap with `disabled` blocks legal |
| Pinned entry inside range | Accept + mandatory warning listing covered pin ids (pins win visibility, overlay-schema §4.4) |
| Trailing messages of the current turn | Allowed — no turn protection by design (pillar §2; DCP `turnProtection` is a rejected default, D1 §8) |

## 3. Self-footprint scrub

The `compress` call itself persists an assistant `toolCall` block whose `arguments.summary` duplicates the stored summary — DCP's measured defect (D1 §5: block projected **and** full summary re-sent in tool args; DECISIONS §Comparison reject: "relying on a later LLM pass to scrub self-footprint").

**Spec:** on every projection **after** a compress event is committed, the one `context` handler rewrites the committed call's `toolCall` block in the cloned array: `arguments.summary` → the marker string `"[stored in block b:<blockId>]"`. All other argument fields (`op`, `start`, `end`, `topic`) stay intact so history remains interpretable. The paired toolResult already contains only the small envelope (§1.1) and is not touched. The journal is never mutated (H2 §Session messages are not mutated).

- **Which turns:** every provider call from the first projection after commit, forever — including after the block is expanded or sealed (the summary remains readable via `state`/journal; determinism matters more than restoring dead bytes). **Not scrubbed:** failed/rejected compress calls (no block exists; the agent may want to reuse its own summary text on retry) and `preview` calls (carry no summary).
- **Correlation:** the committed call is found by `(entryId of the assistant message, toolCallId)` recorded on the compress event (per overlay-schema), resolved via the `getBranch()` walk — never by matching cloned text (H4 §2.2).
- **Why pairing survives:** the rewrite edits one block's `arguments` value in place; block `id`/`name` and the paired `toolCallId` are untouched, so `convertToLlm` (`messages.ts` ~1312) emits a normal call/result pair — same mechanism as DCP's pair-preserving content replacement (D1 §7 "same tool part, same callID"). `transformContext` runs before `convertToLlm` and provider normalization (H2 §5), so every provider dialect sees a consistent pair.
- **Why cache-cheap (H3):** the append-only digest covers `toolCalls` fields, so the scrub diverges that one message index exactly once — on the first turn after commit, when the message is near the tail — and is byte-identical every turn after (marker is a pure function of `blockId`). Cost = one near-tail suffix rewrite (H3 §Self-footprint scrub: "structurally favored, not implemented in host"; DECISIONS §Cache model: tail self-footprint scrub is the cheap default).

## 4. Active-block rendering

An `active-overlay` block replaces its covered visible slots with **one** synthetic `user` AgentMessage (`synthetic:true`, `packages/ai/src/types.ts` ~836), placed at the position of the first covered slot — provider-neutral text, the same role-shift pi-vault ships successfully (D2 §8.2), and INVARIANTS §9 (tool results render as provider-neutral text):

```text
<qol:compressed id="b:k7q2" range="m:1f2e3d4c..m:8c1d9e0f" slots="14">
topic: repo layout exploration
[agent-authored summary, verbatim]
</qol:compressed>
[compressed placeholder — expand with context op=expand target=b:k7q2]
```

Rules: rendering is a pure function of the block event (frozen `topic`, `summary`, boundary ids, slot count — no live token counts, no timestamps of "now"; the synthetic message reuses the first covered slot's `timestamp`), so bytes are identical on every turn. The framing tells the model (a) this is a placeholder, not conversation, (b) its address, (c) the expand path — replacing DCP's nudges with in-band affordance (U1 §9, no default nudges). Adjacent blocks render adjacent slots; no merging.

**Cache consequence (H3 §Deep-range compress):** committing a block diverges the append-only digest at the first covered index — prefix `[0, anchor)` stays warm, suffix re-syncs once. Every later turn is byte-stable and shorter, so the recurring prompt cost drops while divergence cost is paid once. Mid-history compress is therefore a one-time suffix rewrite, not a per-turn tax; expand re-diverges at the same index (same model). Native compaction still clears the whole append-only log regardless (H3 §Compaction shrink) — sealing does not pretend otherwise.

## 5. Seal flow (architecture C, DECISIONS §Q3)

Trigger: host `session_before_compact` fires (native pressure, manual `/compact`, or our `seal` op via `ctx.compact`). The handler receives `preparation` + `branchEntries` (H1 §3.1) and decides:

1. **Maturity (positional, not policy):** a block is **mature** iff `active-overlay` AND its entire source range lies inside the to-be-summarized region `[boundaryStart, preparation.firstKeptEntryId)`. The host already chose that boundary (`prepareCompaction`/`findCutPoint`, H1 §2.2 — plugin does not run there); maturity substitutes agent-authored summaries for content the host was about to summarize anyway. No agent mark step in v1 (OI-4 records the rejected `hold` escape hatch).
2. **Gap measure:** `gapTokens` = estimated tokens of visible summarized-region slots (including `turnPrefixMessages` when `isSplitTurn`) not covered by any mature block.
3. **Custom seal** iff `matureBlocks ≥ 1` AND `gapTokens ≤ min(4096, 20% of region estimate)`. Compose one `CompactionResult`:
   - `summary` = **chronological merge**: walk the summarized region in path order; at each mature block's first covered slot emit its stored summary (once, with its `b:` id and range); for uncovered visible slots emit a compact **verbatim** rendering (role-labeled text, no paraphrase — copying is mechanical, summarizing would be plugin-authored semantics, see §8 tension T2). Coverage-only and excluded rows emit nothing.
   - `shortSummary` = joined block topics. `firstKeptEntryId` = `preparation.firstKeptEntryId` **verbatim** — the seal never moves the host cut (H1 §5.3 warns bad ids break `buildSessionContext`; moving later discards context the host chose to keep, moving earlier risks the dead-end rescue). `tokensBefore` = `preparation.tokensBefore`.
   - `preserveData` = seal linkage (sealed block ids, coverage, schema version) per overlay-schema. Host skips both LLM summarize and snapcompact (H1 claim 3), appends the `CompactionEntry` with `fromExtension:true`.
4. **No mature blocks (or gap too large): let native run.** Return no result — never `cancel` as policy (H1 §5.2: cancel on overflow/incomplete can strand the session; DECISIONS §Q1). Hybrid contribution: register `session.compacting` to pass mature-block summaries (when any exist but gaps were too large) as `context` lines plus `preserveData` linkage, so agent-authored text still informs the host summarizer (H1 §3.2 — skipped automatically when a custom result was returned).
5. **Post-seal transitions** (recorded on `session_compact`, which supplies the `CompactionEntry` id, H1 §3.1):
   - mature blocks merged into a custom seal → `sealed-native-compaction` (`sealedBy:"qol"`, `sealedTo: c:<entryId>`);
   - blocks fully behind the boundary when native ran → `sealed-native-compaction` (`sealedBy:"native"`) — sources left chronology either way; expand semantics identical (rehydrate default / branch explicit, per `designs/sealed-expand.md`);
   - blocks fully inside the kept tail → unchanged `active-overlay`;
   - **straddling blocks** (range crosses `firstKeptEntryId` — possible because agent ranges ignore future cut points): fold to **`shadowed`** per the overlay-schema reducer (§3.2) — the block projects nothing, the kept remainder shows raw, and `state` flags `straddlesSeal:true` with a warning suggesting the agent re-compress the remainder (agent's decision, Q5 — never auto-recompress). Projecting the old summary over just the remainder would misattribute coverage. `exactExpandAvailable:false` (the sealed part expands via rehydrate only). *(Integration fix 2026-08-16: draft kept straddling blocks active with window-intersection truncation — overridden, see §8 T4.)*
   - Events for all transitions per overlay-schema.

## 6. Failure / rejection UX

Every rejection: `{ ok:false, reason, error (human, names the offending ids), requested, suggested?, suggestedAlternatives?, action, warnings }` — U1 §8.2 pattern; `suggested` is never applied server-side. Catalog:

| `reason` | Trigger | `suggested` carries |
|---|---|---|
| `unknown_ref` | id not on any known unit | known refs hint via `state`/`list` |
| `off_branch` | entry exists, not on active branch path | — |
| `not_projectable` | endpoint names an excluded row / `compactionSummary` slot | nearest visible slot ids |
| `pair_split` | closure must add call/result machinery slots | minimal closure + inner safe subranges |
| `turn_split` | multi-call sibling or interrupted pair split | same |
| `crosses_boundary` | range crosses compaction / reset boundary | range clipped to emission window |
| `overlaps_block` | any overlap with an active block (incl. containment) | disable/expand-that-block recipe + disjoint subranges |
| `block_endpoint` | `b:` used as a compress/preview endpoint (illegal in v1, overlay-schema §4.2) | the block's stored `m:` range, copyable from `state` |
| `empty_range` | zero visible slots | — |
| `summary_missing` | compress without `summary` | — (schema validation) |
| `block_not_found` | expand/state target unknown | known block ids |
| `mode_unavailable` | expand `mode:"branch"` unreachable | remaining alternatives |
| `engine_off` / `no_session` | kill switch / no live session (advisor `NATIVE_UNAVAILABLE` class) | user path |

## 7. Interaction rules

1. **Compress over pinned entries: accepted, never rejected** (overlay-schema §4.4 — pins win visibility, both apply); the response carries a mandatory warning listing covered pin ids. One handler owns compress+pin projection order (DECISIONS §Q2). *(Integration fix 2026-08-16: draft had a `pinned_conflict` rejection; removed to match the schema freeze.)*
2. **Compress over already-compressed: no nesting in v1** (overlay-schema §4.2 — the nested/consumed graph is both DCP lineages' defect zone). `b:` endpoints are illegal for create/preview (`block_endpoint`). Any overlap with an active block rejects (`overlaps_block`); recompress = disable-then-wider-create, and overlap with `disabled` blocks is legal. *(Integration fix 2026-08-16: draft assumed nesting per an older overlay-schema expectation.)*
3. **Range crossing an existing compaction boundary: rejected** (`crosses_boundary`), with `suggested` clipped to the emission window. Decision rationale: pre-boundary entries are not in native chronology (H4 §3.2 emission mode C) — a block over them would hide nothing and corrupt coverage accounting; the represented history is already one `compactionSummary` slot, and compressing *that* is OI-3, not a range op.

## 8. Tensions flagged (not silently resolved)

- **T1 — closure policy:** 2026-08-09 overlay-engine §6 allowed apply-closure-and-report; U1/`designs/agent-ux.md` chose reject-with-suggested. This design follows the sibling designs (zero-widening tolerance, §2.3). If eval shows models stall after honest rejects, the recorded escape is an explicit `acceptClosure:true` second-call flag (U1 §8.2), never a silent default.
- **T2 — seal gap rendering:** verbatim gap inlining inside a custom seal is plugin-mechanical content in a summary the pillar wants agent-authored. Mitigation: verbatim copy makes no semantic choice; above the stated gap budget we hand the pass to native rather than paraphrase. If the author rejects even verbatim inlining, the fallback is "custom seal only at 100% coverage", which will rarely fire — surfaced for ratification alongside Q4.
- **T3 — hybrid fallback authorship:** when native runs, the boundary summary is host-LLM-authored even though agent block summaries were fed via `session.compacting`. That is native behavior, but the agent's summaries end up paraphrased — noted, unavoidable under C without cancel-as-policy.
- **T4 — straddling blocks (§5 step 5) — RESOLVED at integration 2026-08-16:** the draft kept straddling blocks active with window-intersection truncation; the overlay-schema reducer instead derives `shadowed` (project nothing, warn, agent may re-compress the remainder). Schema wins: truncated projection misattributes coverage and narrows a block's effect without an agent op (brushes Q5's no-auto-policy line). The raw remainder reappearing is honest and warned, not silent.

## 9. Open items

- **OI-1:** partial-slot surgery (stub one `toolCall`/result content of a multi-call turn, DCP-davecodes style) — excluded from v1 compress; would need a distinct content-elision op with its own pairing rules.
- **OI-2:** batch compress (multiple ranges per call, DCP/pi-vault shape) — deferred until single-range closure is E3-proven; batch overlap validation belongs to overlay-schema.
- **OI-3:** compressing the `compactionSummary` slot itself (`c:` as target) — rejected in v1; reopens if long sessions accumulate heavy native summaries.
- **OI-4:** agent-controlled `hold`/maturity mark to keep a block out of a seal — rejected in v1 because holding cannot keep sources in chronology once the host cut covers them (only moving `firstKeptEntryId` could, and the seal never moves the cut). Reopens with architecture D.
- **OI-5:** `estimate` token math — which host estimator (`estimateTokens` family) the plugin can call or must replicate; needs the E3 substrate probe (`research/probe-e3-substrate.md`, in flight).
- **OI-6:** rehydrate rendering shape after sealed expand (tail block format) — owned by `designs/sealed-expand.md` follow-up, referenced here only.
- **OI-7:** whether `state` merges into the tool-wide `list`/`status` ops at Q6 freeze; envelope fields are final per `designs/agent-ux.md` either way.
- **OI-8:** interaction with snapcompact-inline imaging of tool frames (`transformProviderContext`, H2 §5 — runs after us, no extension hook): a scrubbed/blocked slot is smaller before imaging, believed benign; verify at E3.

## 10. Source index

| Claim | Source |
|---|---|
| Message/toolCall/toolResult shapes | `packages/ai/src/types.ts` ~796–963; `packages/agent/src/types.ts` ~660 |
| Role handling, convertToLlm, steering wrap | `packages/coding-agent/src/session/messages.ts` ~758–777, ~1168–1371 |
| transformContext before convertToLlm | `packages/coding-agent/src/sdk.ts` ~3101–3110; H2 §5 |
| Dangling strip / error-turn drop | `packages/coding-agent/src/session/session-context.ts` ~473–569 |
| Custom entries invisible; entry types | `packages/coding-agent/src/session/session-entries.ts` ~96–152; H2 §4 |
| Compaction contract, pressure floor, seal seam | `packages/agent/src/compaction/compaction.ts` ~540–686, ~1163–1183; `shared-events.ts` ~64–89; H1 §§1–5 |
| Provenance gap, projection lossiness | H4 §§2–3 |
| Cache divergence model, scrub economics | H3 §§Exact algorithms, Implications |
| Pair-safe projection, self-footprint defect | D1 §§5, 7; D2 §§7–8 |
| Rejection UX, no nudges, typed ids | U1 §§5, 8, 9; `designs/agent-ux.md` |
