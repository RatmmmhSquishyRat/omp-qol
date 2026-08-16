# D2: Pi-DCP Ports — Addressing, Overlay, Self-Footprint, Persistence

**Track:** D2 (`research/00-index.md`)  
**Date:** 2026-08-16  
**Scope:** Compare the two Pi extension ports of OpenCode DCP as reference implementations for OMP-QOL initiative-context-management (ICM). Source-only; no product code. Pillars not edited.

| Port | Upstream | Local clone | HEAD | Package |
|---|---|---|---|---|
| **Davecodes** | [Davidcreador/pi-dcp](https://github.com/Davidcreador/pi-dcp) | `docs/ref_repos/pi-dcp` | `7ae24be96110420664e5ccc3eaa2f483cb882ca7` | `@davecodes/pi-dcp` **0.2.0** (AGPL-3.0) |
| **Pi-vault** | [pi-vault/pi-dcp](https://github.com/pi-vault/pi-dcp) | `docs/ref_repos/pi-dcp-vault` | `d9b7569e3c360fe34a376665a69e43a1f6ff8615` | `@pi-vault/pi-dcp` **0.5.0** (MIT) |

Both target **`@earendil-works/pi-coding-agent`** (stock Pi), not **`@oh-my-pi/pi-coding-agent`** (OMP). They are **API-shape neighbors**, not drop-in OMP plugins — but they are the closest existing **Pi-like extension** proof that transform-only context pruning works without mutating the canonical session journal.

**ICM cross-reference:** engineering invariants in `docs/workspaces/initiative-context-management/INVARIANTS.md`; freedom pillar tensions (agent freedom vs DCP auto-policy) are evaluated in §8.

---

## 1. Executive summary

Both ports implement the same product thesis as OpenCode DCP: **keep the on-disk session lossless**, **rewrite only the outbound LLM payload** on the `context` event, and expose a model-callable **`compress`** tool plus operator commands.

They diverge sharply on **addressing**, **persistence**, **compression wire shape**, and **maturity**:

| Dimension | Davecodes `@davecodes/pi-dcp` | Pi-vault `@pi-vault/pi-dcp` |
|---|---|---|
| **Addressing** | `toolCallId` only (`toolCallIds[]` or `startToolCallId`/`endToolCallId`) | Synthetic **`m0001`** message refs + **`bN`** block refs backed by stable content keys |
| **Branch API** | Heavy use of `sessionManager.getBranch()` for range resolution, sweep, nudges | Used for snapshot restore on `session_start` / `session_tree`; pipeline uses flat `event.messages` |
| **Persistence** | Sidecar `~/.pi-dcp/sessions/{sessionId}.json` | **`pi.appendEntry("pi-dcp-state", …)`** on active branch (append-only custom entries) |
| **Compression on wire** | Replace targeted **tool results** with short placeholders; **summary not re-injected** | **Remove** covered messages; inject **synthetic user message** with full wrapped summary at anchor |
| **Auto policy** | Dedup + purgeErrors every context pass; nudges via **`before_agent_start`** system prompt | Same strategies + **in-message** anchored nudges; optional **`dcp:compress`** hidden follow-up |
| **Protocol safety** | Never delete messages; preserve tool-call/tool-result pairing via placeholders | Range expansion + orphan toolResult cleanup; removes assistant/user messages when compressed |
| **ICM alignment** | Good **clone-on-transform** pattern; **wrong persistence** (sidecar); **wrong identity** (toolCallId) | **`appendEntry`** matches overlay invariant; still **wrong identity** (m0001 ≠ `entryId`); richer block model |

Neither port implements OMP ICM pillars (InitiativePin, PinStateTree, agent-only compression policy). Both **conflict** with the freedom pillar on **plugin-decided automatic pruning/nudging**, while still offering reusable **transform mechanics** and **tool-pair safety** patterns.

---

## 2. Context hook and outbound payload rewrite

### 2.1 Davecodes — `pi.on("context")` → `runPipeline` → `{ messages }`

**Registration:** `docs/ref_repos/pi-dcp/index.ts` lines 148–160.

**Contract (documented in `index.ts` header and `lib/pipeline.ts`):**

1. Receive `event.messages` whose objects **share identity** with persisted session entries.
2. Build a **new array**; clone only messages that will be mutated (`cloneForMutation` in `lib/messages.ts`).
3. Apply, in order: **stored compressions** → **deduplication** → **purgeErrors** (`lib/pipeline.ts` lines 126–165).
4. Return `{ messages: result.messages }`; on crash, pass through unchanged (`index.ts` lines 153–158).

**Additional hooks (same file):**

| Event | Role |
|---|---|
| `turn_start` | Increment `state.turnIndex` for error-aging |
| `tool_result` | Record errored `toolCallId` → turn index |
| `before_agent_start` | Append throttled compress **nudges** to system prompt (`lib/nudges.ts`) |
| `session_compact` | Reset ID-based tracking; keep compression records (`lib/persistence.ts` `resetTrackingAfterCompaction`) |
| `session_start` / `session_shutdown` / `agent_end` | Sidecar save/restore |

**No** `appendEntry`, **no** `message_end` mutation, **no** in-journal edits.

### 2.2 Pi-vault — multi-hook pipeline with richer transform stages

**Primary transform:** `docs/ref_repos/pi-dcp-vault/src/index.ts` lines 395–463 — `context` → `runPipeline` → `{ messages: result.messages }`.

**Pipeline stages** (`src/pipeline.ts`):

| Step | Module | Effect |
|---|---|---|
| 0 | `messages/strip.ts` | Strip stale DCP tags / hallucinated markers |
| 0b | `messages/inject.ts` `assignMessageRefs` | Assign stable `m0001` refs |
| 0c | `state/tool-cache.ts` | Sync tool parameter cache, ordered tool ID list |
| 0d | `messages/sync.ts` | Reconcile compression blocks to current indices |
| 1 | `strategies/runner.ts` | Mark tools for dedup / stale-error purge (does not mutate messages yet) |
| 4.5 | `messages/priority.ts` | Priority attrs for message-mode compression hints |
| 5 | `messages/inject.ts` `injectMessageIds` | Append `<dcp-message-id>` tags to user/assistant text |
| 6 | `messages/inject.ts` `injectCompressNudges` | Append `<dcp-system-reminder>` nudges at anchored positions |
| 7 | `messages/prune.ts` `applyPruning` | Filter compressed ranges, placeholder tool outputs, purge failed inputs |

**Additional hooks** (`src/index.ts`):

| Event | Role |
|---|---|
| `before_agent_start` | Append static **`DCP_SYSTEM_PROMPT`** (not threshold nudges) |
| `message_end` | Strip hallucinated DCP tags from assistant messages before persist |
| `tool_call` | Block `compress` when permission `deny` |
| `tool_execution_start` / `tool_execution_end` | Compression timing; sub-agent result cache |
| `session_start` / `session_tree` | Config reload, tool registration, **`restoreActiveBranch`**, persist |
| `session_compact` | Clear ephemeral prune/index state; retain stable `messageIds.byRawId`; **`persistIfChanged`** |

### 2.3 Shared invariant (both ports)

Both explicitly treat **`context` as a projection hook**, not a journal rewrite. Davecodes states this in README §“How it works” and enforces it via cloning. Pi-vault returns new message arrays from prune/inject helpers and uses `message_end` only to sanitize assistant output going **to** the journal.

**ICM note:** This matches invariant #5 (lossless journal) and ADR-004’s “no in-place session mutation” spirit — but ICM still needs **`appendEntry` overlay records** for compress/pin **intent**, not only runtime maps.

---

## 3. Range and identity addressing

### 3.1 Davecodes — `toolCallId` as the address space

**Message mode** — `lib/tools/compress-message.ts`:

- Parameters: `toolCallIds[]`, `topic`, `summary`.
- Validates against `turnProtection` by reading **`ext.sessionManager.getBranch()`**, filtering `type === "message"` entries, mapping to messages, then `protectedByRecency()` (`lib/messages.ts` lines 252–276).

**Range mode** — `lib/tools/compress-range.ts`:

- Parameters: `startToolCallId`, `endToolCallId`, `topic`, `summary`.
- **`branchToolCallIds(branch, config)`** (`lib/tools/shared.ts` lines 94–112): walk branch root→leaf; collect ordered `{ id, toolName }` from **`role === "toolResult"`** entries; skip `ALWAYS_PROTECTED_TOOLS` + config protected tools.
- Resolve slice between endpoints (order-normalized); refuse if endpoints missing or in protected window.

**Sweep** — `lib/commands/sweep.ts`: newest-first walk of **`getBranch()`**; collect tool result IDs back to last user message.

**No `m0001`, no `entryId`, no block refs.** Identity for compression records is **`toolCallId` list** inside sidecar `CompressionRecord` (`lib/state.ts`).

**`getBranch()` usage summary (Davecodes):**

| Call site | Purpose |
|---|---|
| `compress-message.ts`, `compress-range.ts` | Turn protection + range resolution |
| `lib/nudges.ts` | Count messages since last user (iteration nudge) |
| `lib/commands/sweep.ts` | Select recent tool results on active branch |

### 3.2 Pi-vault — synthetic refs + stable keys + block anchors

**Stable keys** — `src/utils/message-ids.ts`:

- Tool results: `toolResult:{toolCallId}` (counter ignored).
- Others: `{role}:{timestamp}:{counter}` with per-prefix counter disambiguation.
- Refs: `m0001`, `m0002`, … assigned once per key into `state.messageIds.byRawId` (persistent across compactions for surviving keys).

**Boundary parsing** — `parseBoundaryId`: accepts **`m0001`** (message ref) or **`bN`** (active compression block ref).

**Range resolution** — `src/compress/search.ts`:

- `resolveBoundaryIndex` maps ref → current array index via runtime `byIndex` scan.
- `resolveSelection` / `expandRangeForToolChains`: expand range so **assistant toolCall and toolResult stay together**; also expand to include **consumed nested blocks**.
- `getProtectedTurnStart`: index-based turn protection on flat message array.

**Compress tool surfaces** (`src/index.ts` lines 198–256):

| Mode | Args | Addressing |
|---|---|---|
| `message` | `targets[{ messageId, summary }]` | Per-message `m0001` |
| `range` | `content[{ startId, endId, summary }]` | `m*` or `b*` boundaries |

**Block refs (`bN`):** Created when summaries are wrapped (`src/compress/state.ts` `wrapCompressedSummary`); model can compress **into** or **across** existing blocks (`consumedBlockIds` in handler).

**`getBranch()` usage (Pi-vault):**

| Call site | Purpose |
|---|---|
| `src/index.ts` `restoreActiveBranch` | Find newest valid `customType === "pi-dcp-state"` entry on branch |
| Not used in compress range resolution | Pipeline uses `event.messages` + ref maps |

### 3.3 Gap vs OMP ICM addressing (invariant #7, #8)

| Mechanism | Survives native compaction? | Branch-aware? | Matches `(sessionId, entryId)`? |
|---|---|---|---|
| Davecodes `toolCallId` | **Partial** — `session_compact` clears tracking; compressions kept but may no-op | Yes for compress/sweep | **No** |
| Vault `m0001` + stable key | **Partial** — keys retained in snapshot; index cache rebuilt | Restore uses branch; selection uses flat array | **No** — refs are synthetic, not host `SessionEntry.id` |
| Vault `bN` | Block metadata persisted in snapshot | N/A | **No** |

**Provenance tension (INVARIANTS.md):** both ports prove **transform-only** compression works without generic `@message` syntax, but neither closes the **entryId / alias** seam OMP ICM still needs.

---

## 4. Persistence: in-memory vs appendEntry vs sidecar

### 4.1 Davecodes — in-memory + filesystem sidecar

**Runtime:** `lib/state.ts` — `SessionState` maps/sets (compressions, dedup sets, erroredAt, nudge counters).

**Durability:** `lib/persistence.ts`:

- Path: **`~/.pi-dcp/sessions/{sanitizedSessionId}.json`**
- Atomic write via temp + rename.
- Persisted: compressions, dedup/purge idempotency sets, erroredAt, turnIndex, per-session stats.
- **Not** persisted: nudge state, runtime manualMode, lifetime stats (`lib/stats.ts` separate file).
- Restore on `session_start` when `getSessionId()` available.

**Does not use `appendEntry`.** Fork/resume/tree navigation **do not** carry DCP state in the session journal — sidecar is keyed only by sessionId string.

**ICM tension:** Conflicts with invariant #6 (“overlay state is append-only custom session entries / tombstones, **not a sidecar DB**”).

### 4.2 Pi-vault — in-memory + native custom entries

**Runtime:** `src/state/types.ts` (via `createSessionState`) — prune maps, messageIds, nudges, tool cache.

**Durability:** `src/state/persistence.ts` + `src/index.ts` `persistIfChanged`:

```typescript
pi.appendEntry("pi-dcp-state", snapshot);  // src/index.ts ~117
```

- Snapshot schema **`DcpSnapshotV1`**: blocks, prune tool marks, messageId maps, nudge anchor keys, stats, manual mode, compress permission.
- Fingerprint dedupe avoids redundant appends.
- **`restoreActiveBranch`**: walk branch newest-first for latest valid `pi-dcp-state` custom entry; validate with `parseDcpSnapshot`.
- **`session_compact`**: wipe ephemeral derived state, persist reset; **retain `byRawId` / `byRef`** (`src/index.ts` lines 323–337).
- **`dcp:lifetime`**: scan all `**/*.jsonl` under sessions parent for aggregate stats (`loadAllSessionStats`).
- README 0.5.0: **legacy `dcp/state.json` sidecars ignored**.

**ICM alignment:** **`appendEntry` pattern is directly reusable** for ICM overlay snapshots. Still need to split **intent records** (compress/pin/tombstone) from **derived projection cache** the way vault splits durable snapshot vs per-pass `byIndex`.

### 4.3 Comparison table

| Concern | Davecodes | Pi-vault |
|---|---|---|
| Fork inherits DCP state | Only if same sessionId sidecar file | Yes — branch carries custom entries; fork rules in README |
| Compaction interaction | Clear tracking; compressions may reference dead IDs | Reset prune caches; rebuild blocks from keys; persist |
| Corruption handling | Ignore bad sidecar file | Skip invalid snapshot blocks with warnings |
| Operator visibility | `~/.pi-dcp/sessions/*.json` | Session JSONL custom lines |

---

## 5. Compress / decompress / sweep / nudge surfaces

### 5.1 Compress tool

| | Davecodes | Pi-vault |
|---|---|---|
| **Registration** | One of two tools based on `config.compress.mode` | Same; re-register on `session_start` |
| **Permission** | `allow` / `ask` / `deny`; `deny` = no tool | `allow` / `deny`; runtime toggle via `dcp:permission` |
| **Manual gate** | `manualMode` refuses LLM compress (`lib/tools/shared.ts` `preflight`) | `manualMode === "active"` skips nudges; strategies optional via `manualMode.automaticStrategies` |
| **Storage** | `CompressionRecord` in memory/sidecar | `CompressionBlock` in memory/snapshot |
| **Wire effect** | Placeholder on tool **results** only | Remove message range; inject summary user bubble |

**Davecodes** compress modes (`lib/config.ts`):

- **`message`:** `toolCallIds[]`
- **`range`:** `startToolCallId` + `endToolCallId`

**Pi-vault** compress modes (`src/index.ts`):

- **`message`:** `targets[{ messageId, summary }]`
- **`range`:** `content[{ startId, endId, summary }]`

Pi-vault supports **batch** range/message entries in one tool call with overlap validation (`src/compress/handler.ts`).

### 5.2 Decompress / recompress

| | Davecodes | Pi-vault |
|---|---|---|
| **Commands** | `/dcp decompress [id]`, `/dcp recompress [id]` | `dcp:decompress <blockId>`, `dcp:recompress <blockId>` |
| **Mechanism** | Set `CompressionRecord.suspended` flag | Set `block.active = false` / `deactivatedByUser`; `rebuildCompressionState` |
| **IDs** | Monotonic `#1`, `#2`, … compression id | Block id `bN` / numeric blockId |
| **Undo scope** | Next context pass restores original tool result content | Next context pass restores full messages from journal projection |

Davecodes toast says “originals restored” (`lib/commands/decompress.ts`) — meaning **placeholders removed**, journal was always full fidelity.

### 5.3 Sweep

| | Davecodes | Pi-vault |
|---|---|---|
| **Command** | `/dcp sweep [n]` | `dcp:sweep` |
| **Behavior** | Stage compression with placeholder summary over recent tool results on branch | `sweepAll` marks **all** eligible completed tools in tool cache for output pruning |
| **Summary** | `"(manual sweep — no summary…)"` | No LLM summary — strategy layer only |
| **Agent involvement** | None — operator command | None |

Both sweeps are **plugin-initiated bulk pruning** — conflicts with freedom pillar unless reframed as explicit operator tooling, not default product behavior.

### 5.4 Nudges

**Davecodes** (`lib/nudges.ts`):

| Surface | Trigger | Delivery |
|---|---|---|
| Soft / strong | `tokens >= minContextLimit` | Append to **system prompt** on `before_agent_start` |
| Hard | `tokens >= maxContextLimit` | Same |
| Iteration | `messagesSinceLastUser >= iterationNudgeThreshold` | Same |

Throttles: `nudgeFrequency`, `nudgeEveryTurns`, `lastKnownTokens` fallback after compaction.

**Pi-vault** (`src/messages/inject.ts`, `src/prompts/nudges.ts`):

| Surface | Trigger | Delivery |
|---|---|---|
| Context limit | Over max (with optional **summaryBuffer** adjustment) | `<dcp-system-reminder>` appended to **anchored user/assistant messages** |
| Turn | Over min, on user turn | Same |
| Iteration | Assistant iterations since user | Same |

Anchors stored as **stable message keys** in snapshot (`nudges.contextLimitAnchors`, etc.). Static **`DCP_SYSTEM_PROMPT`** also appended every turn via `before_agent_start`.

**Pi-vault-only:** `dcp:compress [focus]` sends hidden **`pi.sendMessage`** follow-up to force model to call `compress` (`src/commands/compress.ts`) — explicit **plugin-driven compression request**.

### 5.5 Operator / inspection commands

| Davecodes `/dcp …` | Pi-vault `dcp:…` |
|---|---|
| `context`, `stats`, `help`, `manual`, `sweep`, `decompress`, `recompress` | Same set + **`lifetime`**, **`permission`**, **`compress`** |

---

## 6. Native compaction / headroom interaction

Neither port hooks **`session_before_compact`** or attempts to drive OMP-style **native compaction floors**. Both **react** to **`session_compact`** after the host compacts.

### 6.1 Davecodes

`index.ts` lines 116–130:

- **`resetTrackingAfterCompaction`**: clear dedupedCallIds, purgedErrorCallIds, appliedCompressionTargets, erroredAt.
- **Keep** `state.compressions` Map — user-requested compressions survive.
- Reset `lastKnownTokens` so nudges are not stale.

Commentary in `lib/persistence.ts` lines 208–212: pipeline **no-ops** on missing toolCallIds after compaction.

**Headroom:** No code adjusts native compaction thresholds. Pruning is purely **transform-layer token reduction**. README claims on-disk session untouched so `/compact` keeps originals — DCP and native compaction **stack**, but **ID-based compressions may silently stop applying** while still stored.

### 6.2 Pi-vault

`src/index.ts` lines 323–337:

- Clear tool prune map, message index overlays, active blocks, tool timing, subagent cache.
- **Retain** `messageIds.byRawId` / `byRef`; do **not** reset `nextRefIndex`.
- **`persistIfChanged()`** writes compaction reset to journal.

`syncCompressionBlocks` (`src/messages/sync.ts`) drops blocks whose keys no longer resolve or whose **`compressToolCallId`** vanished from tool cache — compression state **reconciles** post-compaction rather than blindly no-oping.

**Headroom / summaryBuffer:** `injectCompressNudges` subtracts active summary token estimate from usage before firing max-limit nudges (`src/messages/inject.ts` lines 116–132) — acknowledges that **injected summaries consume window** but does **not** integrate with host native headroom APIs.

### 6.3 ICM invariant #12

> Transform-only on-wire compression does **not** automatically own OMP native headroom.

These ports **confirm** that separation: they reduce provider payload size but **do not** claim control over host compaction pressure. OMP ICM must still re-verify on 17.3.4 (track H1/H5).

---

## 7. Self-footprint of compress tool arguments

Compression is never free: the **`compress` tool call** remains in the journal with model-authored **`summary`** text (and boundaries / ids).

### 7.1 Davecodes

**Tool schema** (`lib/tools/compress-message.ts` / `compress-range.ts`):

- `topic` (≤120 chars) + `summary` (≥30 chars) + id fields.
- **`summary` lives in tool arguments** in the permanent session history.
- On wire after compression: targeted tool **results** become **short placeholders** without embedded summary (`lib/messages.ts` `compressionPlaceholderToolResult` — topic only in placeholder text).
- Full summary retained in sidecar `CompressionRecord.summary` for operator decompress UX — **not** re-projected to model on each turn.

**Protected from dedup:** `compress` in `ALWAYS_PROTECTED_TOOLS` (`lib/config.ts` line 113).

**Net effect:** Model still sees the **full compress tool call + result pair** every turn (including large summaries in arguments). Savings come from **other** tool results becoming placeholders. Repeated compressions add **more** tool pairs to history.

### 7.2 Pi-vault

**Tool schema** embeds summaries **inside each target/range entry** — batch compress can carry **multiple large summaries** in one call (`src/index.ts` parameters).

**On wire after compression:**

1. Journal still holds full compress tool call (large args).
2. **`filterCompressedRanges`** removes covered messages and injects **synthetic user message** containing **`wrapCompressedSummary`** output — full summary text **on every context pass** while block active (`src/messages/prune.ts` lines 10–43).

**Mitigations:**

- `config.compress.protectedTools` defaults include **`compress`** (`src/config.ts` lines 36–37) — compress tool **outputs** not dedup-pruned.
- **`summaryBuffer`** reduces nudge urgency by subtracting summary tokens from usage — admission that summaries are **ongoing wire cost**.
- Protected content enrichment may **append** user text / subagent results to summaries (`src/compress/protected-content.ts`) — can **increase** footprint for fidelity.

**Net effect:** Pi-vault can achieve lower wire size for **non-compress messages** (true removal), but pays **duplicate summary tax**: once in compress tool args (history) and again in injected user bubble (projection).

### 7.3 ICM implication (InitiativeSummary pillar)

Pillar: agent chooses **what** to summarize; plugin provides **maximum freedom**, not automatic compression.

**Reusable lesson:** any ICM design must account for **compress-operation footprint** explicitly:

- Prefer **overlay-stored summary** + **minimal wire projection** (Davecodes placeholders) **or** single projection site (vault-style injection) — **not both** without dedupe.
- Consider **seal/expansion** paths where summary leaves active window entirely until expanded.
- **`compress` tool args** should be bounded or referenced by id if summaries grow large.

---

## 8. Protocol safety for tool pairs

Provider APIs require **assistant toolCall ↔ toolResult** pairing. Both ports encode this explicitly.

### 8.1 Davecodes — placeholder preservation

`lib/messages.ts` header invariants (lines 7–10):

> Every ToolCall … MUST be matched by exactly one ToolResultMessage … REPLACE content … **never remove**.

**Dedup / compress / purgeErrors** all rewrite **tool result content** or **toolCall.arguments**, never delete rows from the array.

**purgeErrors** replaces failed call **`arguments`** with `{ __purged: marker }` while keeping error **result** text (`lib/strategies/purge-errors.ts`).

### 8.2 Pi-vault — expand-then-remove

**Range expansion** (`src/compress/search.ts` `expandRangeForToolChains`): if assistant toolCall in range but result outside (or vice versa), expand indices until pairs align.

**Compression removal** (`src/messages/prune.ts`):

- Removes **all roles** in compressed index span (user, assistant, toolResult).
- Injects summary as **synthetic user** message at anchor — avoids orphaned toolResults **within removed span**.
- **`removeOrphanedToolResults`**: safety net after injection — drop toolResults with no matching assistant toolCall id in output array (lines 41–70).

**Failed input purge** (`pruneFailedInputs`): same marker pattern as Davecodes for errored calls.

**Risk contrast:** Pi-vault’s **message removal** is more aggressive; it relies on expansion + orphan cleanup. Davecodes is **conservative** (placeholders only) — closer to “minimal provider surprise” at the cost of array length.

**ICM invariant #8:** Semantic range selection is insufficient — ICM must adopt **expand-to-close-tool-chains** (vault) or **placeholder-never-delete** (Davecodes) as explicit projection rules.

---

## 9. Reusable for OMP-QOL vs freedom-pillar conflicts

Reference: pillar text in `docs/ssot/pillars/initiative-context-management/README.md` and `INVARIANTS.md` §From pillars + §Explicit tensions.

### 9.1 Reusable patterns (mechanism, not product policy)

| Pattern | Source | ICM use |
|---|---|---|
| **`context` hook returns new `messages` array** | Both `index.ts` | Core ICM projection engine |
| **Clone-before-mutate** | `pi-dcp/lib/messages.ts` `cloneForMutation`, `needsClone` | Required if host shares object identity |
| **`appendEntry` durable overlay snapshot** | `pi-dcp-vault/src/index.ts`, `state/persistence.ts` | Matches invariant #6; fork/resume story |
| **Compression block state machine** (active / suspended / nested) | Vault `compress/state.ts`; Davecodes `CompressionRecord.suspended` | InitiativeSummary expand/collapse |
| **Turn protection** | Both configs + enforcement | Optional **safety rail**, not auto-compress |
| **Tool-chain expansion before projection** | Vault `compress/search.ts` | Protocol-safe InitiativeSummary ranges |
| **Stable logical keys → display refs** | Vault `message-ids.ts` | Stepping stone toward `@message` / entry aliases (H4) |
| **Idempotent pipeline passes** | Davecodes `isAlreadyPlaceholder`; vault strip/reinject | Cache-friendly reprojection (invariant #11) |
| **Operator decompress/recompress** | Both command sets | User/agent undo without journal loss |
| **Permission / manual mode switches** | Both | Agent freedom knobs — if default auto policy off |
| **JSON envelope / stats / lifetime scanning** | Vault `loadAllSessionStats` | Observability for cache-cost track E1 |

### 9.2 Conflicts with freedom pillar (“no plugin-decided auto compress as the product”)

| Behavior | Davecodes | Pi-vault | Pillar tension |
|---|---|---|---|
| **Auto deduplication** | Default on every context | Default on every context | Plugin decides **what** to prune without agent intent |
| **Auto purgeErrors** | Default on every context | Default on every context | Same |
| **Threshold nudges** | System prompt pressure | In-message `<dcp-system-reminder>` | Plugin steers **when** to compress |
| **`dcp:compress` / hidden follow-up** | N/A | `pi.sendMessage` trigger | Plugin initiates compression |
| **Sweep** | Operator bulk compress | Operator bulk prune | Acceptable as **explicit command**, not as silent default |
| **Addressing baked into product** | toolCallId-only | Injects `<dcp-message-id>` tags | Alters visible context without agent authorship — OK for DCP, ICM may prefer host-native aliases |

**Manual mode nuance:** Both allow disabling **LLM compress** while **keeping auto strategies** (Davecodes default `manualMode.automaticStrategies: true`; vault `manualMode.automaticStrategies`). That is **explicitly opposite** to “agent decides what/when/how to compress” if shipped unchanged.

**ICM product stance:** Treat DCP-style **strategies + nudges** as **reference implementations to not ship as defaults** — or gate behind disabled-by-default config with agent tools owning InitiativeSummary.

### 9.3 Conflicts with ICM engineering invariants

| Invariant | Davecodes | Pi-vault |
|---|---|---|
| #6 append-only overlay, no sidecar | **Violates** (~/.pi-dcp/sessions) | **Aligns** (`pi-dcp-state` entries) |
| #7 persist `(sessionId, entryId)` | **Violates** (toolCallId) | **Violates** (m0001 synthetic) |
| #5 lossless journal | **Aligns** | **Aligns** |
| #8 protocol-safe projection | **Aligns** (placeholders) | **Aligns** with expansion + orphan pass |
| Agent freedom vs auto-policy tension row | **High** | **High** (+ richer auto surface) |

---

## 10. Port differences (consolidated)

### 10.1 Lineage and packaging

| | Davecodes | Pi-vault |
|---|---|---|
| **Described as** | Faithful OpenCode DCP port | Pi-native reimplementation with schema, benchmarks, CI |
| **License** | AGPL-3.0 | MIT |
| **Version** | 0.2.0 | 0.5.0 |
| **Tests** | 55 (Node 22/24) per README | Large vitest suite + `pnpm benchmark` |
| **Config path** | `~/.pi-dcp/config.json`, `<cwd>/.pi/dcp.json` | `<agentDir>/extensions/dcp.json`, trusted project `.pi/dcp.json` |
| **Commands** | Single `/dcp` with subcommands | Namespaced `dcp:*` |

### 10.2 Architectural forks

1. **Compression wire model:** placeholders on tool results (Davecodes) vs message removal + summary injection (Pi-vault).
2. **Addressing:** toolCallId-only vs m0001/bN with injected tags.
3. **Persistence:** filesystem sidecar vs `appendEntry` journal entries.
4. **Nudge delivery:** system prompt append vs anchored in-message reminders + static system prompt.
5. **Scope:** Pi-vault adds subagent cache, protected file patterns, protected user message enrichment, permission runtime toggle, lifetime stats, message hallucination stripping, schema validation.
6. **Branch usage:** Davecodes uses `getBranch()` in hot path for compress/sweep/nudges; Pi-vault uses branch primarily for **state restore** on navigation events.

### 10.3 Which port to read for which ICM subproblem

| ICM subproblem | Prefer |
|---|---|
| Minimal transform-only proof | Davecodes `lib/pipeline.ts` |
| `appendEntry` overlay persistence | Pi-vault `state/persistence.ts`, `index.ts` |
| Protocol-safe range expansion | Pi-vault `compress/search.ts` |
| Conservative provider pairing | Davecodes `lib/messages.ts` |
| Block nesting / recompress | Pi-vault `compress/state.ts` |
| Self-footprint analysis | Compare §7 above — both highlight the problem differently |

---

## 11. Open questions for ICM (fed to `questions/open-questions.md`)

1. **Identity:** Can OMP expose `SessionEntry.id`-backed aliases without injecting `<dcp-message-id>` tags (vault) or relying on ephemeral `toolCallId` (Davecodes)?
2. **Projection shape:** Placeholder-preserving (Davecodes) vs remove-and-inject (Pi-vault) vs ICM pin zones — cache frontier implications (track H3/E1).
3. **Summary storage:** Single source in overlay entry vs duplicate in tool args + wire injection — how does InitiativeSummary **expand** restore provider-safe pairs?
4. **Default policy:** If auto dedup/purge exist at all, are they host features, opt-in plugin config, or rejected for v1 ICM?
5. **Compaction handshake:** Should ICM register `session_compact` / `session_before_compact` handlers to **rebind** overlay identities (vault pattern) or **seal** summaries (ICM research track)?

---

## 12. Source index (primary files)

### Davecodes (`docs/ref_repos/pi-dcp`)

| Topic | Path |
|---|---|
| Extension wiring | `index.ts` |
| Context pipeline | `lib/pipeline.ts`, `lib/messages.ts` |
| Compress tools | `lib/tools/compress-message.ts`, `lib/tools/compress-range.ts`, `lib/tools/shared.ts` |
| Strategies | `lib/strategies/deduplication.ts`, `lib/strategies/purge-errors.ts` |
| Persistence | `lib/persistence.ts`, `lib/state.ts` |
| Nudges | `lib/nudges.ts` |
| Commands | `lib/commands/sweep.ts`, `lib/commands/decompress.ts`, `lib/commands/manual.ts`, `lib/commands/context.ts` |
| Config | `lib/config.ts` |

### Pi-vault (`docs/ref_repos/pi-dcp-vault`)

| Topic | Path |
|---|---|
| Extension wiring | `src/index.ts` |
| Pipeline | `src/pipeline.ts` |
| Compress | `src/compress/handler.ts`, `src/compress/search.ts`, `src/compress/state.ts`, `src/compress/protected-content.ts` |
| Prune / inject | `src/messages/prune.ts`, `src/messages/inject.ts`, `src/messages/sync.ts`, `src/messages/strip.ts` |
| Strategies | `src/strategies/runner.ts`, `src/strategies/deduplication.ts`, `src/strategies/purge-errors.ts` |
| Persistence | `src/state/persistence.ts`, `src/state/state.ts`, `src/state/types.ts` |
| Addressing | `src/utils/message-ids.ts`, `src/state/tool-cache.ts` |
| Commands | `src/commands/register.ts`, `src/commands/sweep.ts`, `src/commands/decompress.ts`, `src/commands/compress.ts` |
| Nudges | `src/prompts/nudges.ts`, `src/prompts/system.ts` |
| Config | `src/config.ts`, `dcp.schema.json` |

---

*Report complete. No pillar edits. No product code.*
