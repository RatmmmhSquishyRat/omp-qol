# Context Overlay Engine — Summary / DCP / Expand Foundation

## 0. Corrected architecture

The original lossless-overlay idea remains correct, but it is only **one layer** of the final solution.

Separate two concerns:

1. **Working-context projection** — what the next model request sees. This is reversible and owned by QOL Summary/Expand/Pin overlays.
2. **Native context lifecycle/headroom accounting** — when OMP considers active stored history too large and creates a compaction boundary.

OMP 17.2.12 intentionally does not let an on-wire compression transform hide raw stored-history pressure from native auto-compaction. Therefore a complete DCP design must integrate with both layers.

## 1. Non-negotiable invariant

> **OMP-QOL never destructively deletes canonical session history.**

The `SessionEntry` journal/tree remains the audit and recovery source of truth. QOL persists state as append-only custom entries and changes only model-visible projections or creates an additional native compaction boundary when explicitly sealing a mature block.

Native compaction itself is also append-only at the journal level: it changes which history is reconstructed for the model, not whether old entries still exist on disk.

## 2. Native facts the architecture relies on

Current OMP provides:

- stable `SessionEntry.id` + `parentId` journal/tree;
- deterministic `buildSessionContext()` reconstruction;
- `context` event replacement before `convertToLlm`;
- append-only extension state via `pi.appendEntry(customType, data)`;
- `session_before_compact` with cancel/custom `CompactionResult` capability;
- `session.compacting` for extra summary prompt/context/preserve metadata;
- `AppendOnlyContextManager` that preserves the longest byte-stable provider-message prefix across in-place rewrites.

The missing primitive is stable provenance from outbound context messages back to source entries **before arbitrary extension transforms**.

## 3. Address / Provenance Layer

### Persistence identity

Never persist array indexes. Internal addresses should use journal identity:

```ts
interface EntryAddress {
  sessionId: string;
  entryId: string;
}

interface RangeAddress {
  sessionId: string;
  startEntryId: string;
  endEntryId: string;
}
```

Short aliases are presentation only.

### Why a pure content matcher is not a permanent solution

A plugin can import `buildSessionContext()` and reconstruct native messages from read-only journal entries. That is useful for prototypes/tests, but current extension ordering makes it unsafe as the final identity contract:

- context handlers execute serially;
- later handlers see prior rewrites;
- installed plugin extensions are not guaranteed first;
- event registration has no priority argument.

### Recommended small core seam

Expose entry provenance with the early/native context projection. The seam may be internal to QOL's host namespace rather than a broad public API, but must be identity-based rather than content-based.

Requirements:

- source entry ID for ordinary persisted messages;
- explicit synthetic provenance for compaction/branch summaries/custom messages;
- stable behavior across branch/resume;
- no dependency on provider serialization;
- no mutation privilege over the journal.

## 4. Overlay event log

Use custom session entries as the source of overlay state.

Example:

```ts
type ContextOverlayEvent =
  | {
      type: "compress.create";
      blockId: string;
      range: RangeAddress;
      summary: string;
      topic?: string;
      createdByCallId?: string;
      createdAt: string;
    }
  | { type: "compress.disable"; blockId: string; at: string }
  | { type: "compress.enable"; blockId: string; at: string }
  | { type: "compress.seal"; blockId: string; compactionEntryId?: string; at: string }
  | { type: "pin.create"; pinId: string; spec: PinSpec; at: string }
  | { type: "pin.remove"; pinId: string; at: string };
```

Reducer input is the QOL entries on the **active branch**. This makes branch-scoped overlay state the natural v1 default.

Do not mutate old QOL entries. Use tombstones/state transitions so audit, branch and rollback remain deterministic.

## 5. Compression blocks

A compression block is a semantic object independent of how it is currently materialized:

```ts
type CompressionBlockState =
  | "active-overlay"
  | "disabled"
  | "shadowed"
  | "sealed-native-compaction"
  | "invalid-source";
```

Recommended stored block:

```ts
interface CompressionBlock {
  blockId: string;
  range: RangeAddress;
  summary: string;
  topic?: string;
  summaryTokens?: number;
  createdBy?: { messageEntryId?: string; toolCallId?: string };
  state: CompressionBlockState;
}
```

The summary is first-class durable information; the raw source remains referenced by IDs rather than copied wholesale.

## 6. Range selection must normalize to protocol-safe units

Arbitrary semantic ranges can cross provider tool protocol. Before a block becomes active, resolve it to a safe projection plan.

Rules:

1. no orphaned raw `toolResult` without its corresponding retained tool call;
2. no retained provider-native tool call that expects a removed result unless replaced by a safe shell the provider accepts;
3. multi-tool assistant messages may retain unrelated sibling calls, but the projected assistant message must be reconstructed/sanitized;
4. provider replay payload/signatures tied to the original full assistant turn must not be blindly replayed after content surgery;
5. user-visible aliases may select an intuitive range, while the planner expands the internal closure and reports what additional protocol records were covered.

A good tool response should report both requested and normalized ranges.

## 7. Summary injection

For an active block, replace its normalized source range with a bounded synthetic summary message at a stable anchor.

A user-context synthetic message is a reasonable default because:

- current OpenCode DCP injects compressed summaries as synthetic user messages;
- OMP's own compaction summaries ultimately become user-context messages;
- a summary should preserve information, not gain developer/system authority.

Conceptual rendering:

```xml
<compressed-context block="b17" source="entryA..entryK">
...agent-authored complete summary...
</compressed-context>
```

The exact markup is a prompt/eval decision, not architecture.

## 8. Expand semantics

### Before seal

`expand(blockId)` disables the block overlay. Raw canonical source entries can become visible again on the next projection when they are still part of native active history.

This is cheap and exactly reversible.

### After native seal

Architecture C introduces a meaningful state change. A native compaction boundary may mean the old raw source is no longer part of ordinary `buildSessionContext()` output even though the journal still contains it.

Therefore `expand` after seal must be explicit:

- `rehydrate`: render the selected original entries into a temporary provider-neutral context block;
- `branch`: create/navigate to a pre-seal branch/state when exact native chronology is required;
- or return `exactExpansionAvailable: false` and describe the alternatives.

Do not silently pretend sealed and unsealed expansion are the same operation.

## 9. Compression tool self-footprint

A DCP tool call contains the summary in its arguments, which can immediately re-add a large fraction of the tokens it just saved.

QOL should scrub that footprint **only in future model projections**:

1. persist the original assistant tool call unchanged in the journal;
2. identify the successful QOL compression tool call via stored `messageEntryId/toolCallId`;
3. in projected assistant content replace the large `summary` argument with a marker such as `[stored in block b17]`;
4. preserve unrelated sibling tool calls;
5. clear/sanitize replay-bound provider payload/signature state on the modified projected assistant message;
6. return a concise tool result from the beginning.

This makes the compression event auditable without paying for duplicate summary payload on every later turn.

## 10. Projection pipeline

Recommended high-level order:

```text
native early context + provenance
        ↓
replay QOL overlay state for active branch
        ↓
resolve valid active compression blocks
        ↓
normalize protocol closures
        ↓
replace raw ranges with summaries
        ↓
scrub QOL compression-tool self-footprint
        ↓
render active pins
        ↓
provider-protocol validation / sanitizer
        ↓
return AgentMessage[]
        ↓
OMP convertToLlm + provider normalization
```

QOL itself should ideally own one context handler so Summary and Pin transforms have deterministic internal ordering.

## 11. Cache model

OMP's append-only context manager fingerprints provider-level messages and retains the longest byte-stable prefix.

Therefore define cache impact as:

```text
cache invalidation frontier = first provider message whose serialized semantics changed
```

Measure:

- index / token offset of first divergence;
- changed suffix tokens;
- cacheRead/cacheWrite deltas;
- whether system/tool stable prefix changed.

### Implications

- tail pin: usually cheap;
- compression-tool scrub in recent tail: cheap;
- deep old-range compression: suffix replay from anchor onward;
- system pin: can change stable prefix, expensive;
- mid-history pin: should remain experimental until behavioral benefit exceeds cache cost.

## 12. Native compaction conflict: raw stored-history floor

This is the most important current OMP behavior for DCP.

OMP auto-maintenance does not trust provider prompt usage alone. Its context pressure is floored by an estimate of the stored conversation. This is explicitly designed to stop on-wire compression extensions from letting the raw conversation grow without bound.

So this state is possible:

```text
canonical active history: 150k
QOL projected history:      20k
provider usage:             ~20k
native pressure floor:      ~150k
```

Native auto-compaction can fire despite excellent QOL compression.

## 13. Four coexistence architectures

### A. Overlay only + ordinary native compaction

Simple baseline. Reversible QOL context works until native compaction eventually changes the active boundary.

Good as reference arm, not full agent-managed lifecycle.

### B. Overlay + cancel threshold/idle compaction

Potential plugin-only experiment. Track `auto_compaction_start` reason; cancel only threshold/idle when effective projected usage is safe. Never cancel overflow/incomplete/manual.

Rejected as default because raw pressure will trigger repeatedly and puts QOL in conflict with host safety accounting.

### C. Overlay + native compaction sealing — **recommended plugin-first v1**

When native pressure requires a real lifecycle boundary, reuse already-generated QOL summaries as a custom `CompactionResult` through `session_before_compact`.

Requirements:

- only seal source that forms a valid old-prefix compaction boundary;
- merge multiple QOL blocks in chronological order;
- include pinned/preserved constraints in summary material;
- persist QOL block→native compaction relationship;
- mark affected blocks `sealed-native-compaction`;
- avoid a second LLM summarization call;
- verify resulting native context occupancy after apply.

This bridges reversible working overlays into OMP's native safety/accounting model.

### D. Core trusted projection ownership — **preferred long-term if exact reversibility is required**

Add a narrow core interface for recoverable projection savings/effective history occupancy. It must preserve overflow safety and never allow an extension to lie below observed provider occupancy.

Potential requirements:

- savings map is tied to stable source entry IDs and QOL block IDs;
- only enabled/recoverable blocks count;
- provider successful prompt usage is a lower bound;
- overflow/incomplete recovery can ignore extension preferences;
- invalid projection state falls back to native compaction.

## 14. Interaction with native compaction summarizer

Even before implementing custom sealing, QOL pins can inform ordinary native summarization through existing hooks:

- `session.compacting.context`: include active constraints/pins that the summary must preserve;
- `session.compacting.prompt`: optional bounded summarization instruction;
- `preserveData`: record QOL metadata needed after compaction.

But this hook does **not** replace the raw messages-to-summarize input. If QOL wants to avoid duplicate summarization, it should return a custom compaction result from `session_before_compact` rather than only adding prompt context.

## 15. State inspection must distinguish raw, projected and native-effective context

`context_state` should report three quantities where possible:

```ts
{
  rawActiveEstimateTokens,
  projectedEstimateTokens,
  lastProviderPromptTokens,
  nativeCompactionPressureTokens,
  activeBlocks,
  sealedBlocks,
  firstProjectionDivergence,
}
```

This is essential because "context is 20k" becomes ambiguous once QOL and native OMP intentionally measure different things.

## 16. V1 API sketch

```text
context compress <range(s)> <summary/topic>
context expand <block>
context collapse <block>
context state
context preview
context seal [block|auto]
```

Agent-facing tools should return structured results, not only prose:

```ts
{
  blockId: "b17",
  requestedRange: {...},
  normalizedRange: {...},
  state: "active-overlay",
  estimatedTokensRemoved: 18420,
  summaryTokens: 1450,
  earliestDivergenceEntryId: "...",
  exactExpandAvailable: true,
}
```

## 17. Design decision gate

Before implementation freeze, answer one product question:

> Must an old compressed range remain exactly reinjectable into the normal native chronology indefinitely, even after OMP would otherwise compact it?

- **No:** architecture C is the right v1 target.
- **Yes:** implement/propose architecture D early; C can still be the fallback/recovery path.
