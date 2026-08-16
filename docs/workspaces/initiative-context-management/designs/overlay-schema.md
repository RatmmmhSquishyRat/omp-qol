# Overlay event schema — PROPOSED FREEZE — pending main-agent review

**date:** 2026-08-16
**host lock:** `docs/ref_repos/oh-my-pi-main` @ `de6b7974a0` (coding-agent 17.3.4)
**scope:** storage, event union, reducer. Compress tool request/response contracts are owned by `designs/compress.md` (sibling task); tool surface names by `designs/agent-ux.md` (Q6). This doc closes ingest item OV13 (`research/ingest-2026-08-09.md`).
**depends on:** `designs/overlay-engine.md`, `designs/address-layer.md`, `designs/sealed-expand.md` (Q4, unratified), `designs/pin.md`, H1 `research/host-compaction.md`, H2 `research/host-context-event.md`, H4 `research/host-addressing.md`, D1 `research/dcp-opencode.md`, D2 `research/pi-dcp.md`, 2026-08-09 handoff `07-CONTEXT-OVERLAY-ENGINE.md` §4–§5.

Verified host facts this freeze stands on (all @ `de6b7974a0`):

| Fact | Host evidence |
|---|---|
| `pi.appendEntry(customType, data): void` — the extension never sees the journal id of its own event | `packages/coding-agent/src/extensibility/extensions/types.ts:1329`; wrapper discards the return: `packages/coding-agent/src/modes/runtime-init.ts:83–85` |
| Custom entries get `{ id, parentId, timestamp }` and chain at the current leaf like any entry | `packages/coding-agent/src/session/session-manager.ts:2188–2192`, `:1094–1100` |
| Custom entries are journaled, never sent to the LLM | H2 §4 (hypothesis 4, E2); `docs/session.md` §`custom` |
| `getBranch()` = root→leaf path walk; host itself folds branch entries for derived state | `session-manager.ts:2334–2340` (and e.g. `getInjectedTtsrRules` `:2244–2252`) |
| `fork()` copies entries verbatim (same entry ids), mints a **new session id** | `session-manager.ts:1359–1400`; H4 §1.1 |
| Compaction is append-only: `CompactionEntry` + `firstKeptEntryId`; custom `CompactionResult` via `session_before_compact`; `session_compact` fires post-append with the entry | H1 §2.4, §3.1–3.2 (E2); `packages/agent/src/compaction/compaction.ts` (`CompactionResult`) |

---

## 1. Custom entry type naming

**FROZEN:** exactly **one** customType for all overlay events:

```
customType = "omp-qol.icm.overlay"
```

The `omp-qol.icm.` prefix is reserved for this module. The version is **not** in the string — it lives in each payload (`schemaVersion`, §2).

Why one type with an internal event union, not one customType per event kind:

- **Replay cost.** Replay is a single `getBranch()` pass filtering on one string equality; foreign `custom` entries are skipped without payload inspection. N customTypes add filter keys without removing any work (the discriminant check just moves into the string).
- **Forward compat.** With one envelope, an old reducer *sees* a newer event inside its own namespace and can skip-and-warn deterministically (§3.4). With per-kind customTypes, a new kind is invisible to old readers — it cannot even warn, which silently breaks the "surface, don't paper over" law (`INVARIANTS.md` preamble).
- **One subsystem key.** Host doc pattern is "subsystem replay may consume known customType values" (H2 §4, `docs/session.md`); one reducer ⇔ one key. Precedent: pi-vault uses a single `"pi-dcp-state"` type (D2 §4.2).

**Rejected:** pi-vault's *whole-state snapshot* payload model (D2 §4.2). Snapshots re-write full state per persist and make branch semantics latest-wins instead of fold-along-path. We store fine-grained **events**; state is derived (§3). A checkpoint/compaction event for the log itself is explicitly out of v1.

## 2. Event union (v1)

Every event is the `data` payload of one `custom` entry. TypeScript, normative:

```ts
/** Common envelope. schemaVersion is MANDATORY on every event. */
interface OverlayEventBase {
  schemaVersion: 1;
  /** Plugin-generated 8-hex, unique per event. Required because pi.appendEntry
   *  returns void (types.ts:1329) — the journal id of the event is not observable
   *  at append time. Idempotency key for replay (§3.3). */
  eventId: string;
  origin?: {
    actor: "agent" | "user" | "plugin"; // "plugin" = lifecycle reconciliation only (§5), never auto-policy (Q5)
    toolCallId?: string;       // causing tool call — enables self-footprint scrub (handoff 07 §9)
    assistantEntryId?: string; // entry carrying that tool call, when resolvable (SHOULD, §6)
  };
}

/** Range address. Closed interval over branch-path positions [pos(start), pos(end)].
 *  Membership is immutable: the parentId path to a fixed entry never changes
 *  (append-only journal, session-manager.ts #freshEntryFields/:1094). Stored ranges
 *  MUST already be protocol-closed at append time (§6.3) — the reducer never re-runs closure. */
interface StoredRange {
  sessionId: string;     // provenance ONLY — never a reducer filter key (§5, host fork() proof)
  startEntryId: string;  // SessionEntry.id, 8-hex (H4 §1.1)
  endEntryId: string;
}

interface EntryRef { sessionId: string; entryId: string; }

type OverlayEvent =
  | CompressCreate | CompressDisable | CompressEnable | CompressSeal
  | PinCreate | PinUpdate | PinRemove
  | OverlayReset;

interface CompressCreate extends OverlayEventBase {
  op: "compress.create";
  blockId: string;        // 8-hex; model-facing as b:<blockId> (address-layer.md §What the model types)
  range: StoredRange;
  summary: string;        // durable first-class copy — see size policy below
  topic?: string;         // ≤120 chars, display only
}
interface CompressDisable extends OverlayEventBase {
  op: "compress.disable";
  blockId: string;
  reason?: "expand" | "supersede" | "user"; // display only; no semantic branch in the reducer
}
interface CompressEnable extends OverlayEventBase { op: "compress.enable"; blockId: string; }

/** Seal linkage (architecture C, DECISIONS Q3). Appended on `session_compact` after the
 *  host appends the CompactionEntry produced from our custom CompactionResult (H1 §5.2). */
interface CompressSeal extends OverlayEventBase {
  op: "compress.seal";
  blockIds: string[];          // blocks merged into this native boundary, chronological
  compactionEntryId: string;   // the CompactionEntry's SessionEntry.id
  firstKeptEntryId: string;    // echoed from CompactionResult (compaction.ts) for replay without entry lookup
}

interface PinCreate extends OverlayEventBase { op: "pin.create"; pinId: string; spec: PinSpecV1; }
/** Full-replacement spec, NOT a patch — idempotent, no merge ambiguity; pins are small. */
interface PinUpdate extends OverlayEventBase { op: "pin.update"; pinId: string; spec: PinSpecV1; }
interface PinRemove extends OverlayEventBase { op: "pin.remove"; pinId: string; }

/** Storage shape frozen here; field SEMANTICS are owned by designs/pin.md (working defaults,
 *  Q7/Q8 open). Additive optional fields do not bump schemaVersion (§7). */
interface PinSpecV1 {
  kind: "source" | "instruction" | "snapshot";
  target?: EntryRef | StoredRange;  // absent for pure instruction pins
  instruction?: string;             // instruction-kind text (size policy applies)
  snapshotText?: string;            // snapshot-kind frozen render (size policy applies)
  placement: "tail" | "system";     // pin.md: system only if instruction-class and explicit
  scope: "branch";
  compaction: "request-only" | "salient" | "preserve"; // pin.md default: request-only
  priority: number;                 // default 0
}

/** Escape hatch: folds to empty overlay state (§3.2). Native CompactionEntries are untouched. */
interface OverlayReset extends OverlayEventBase { op: "overlay.reset"; }
```

Notes, all decided:

- **No `at` field.** The 2026-08-09 handoff sketch (07 §4) carried per-event `at`; dropped — the carrying `CustomEntry` already has `timestamp` (`session-manager.ts:1094–1100`), and ordering authority is journal position, never wall clock. (Tension T1, §9.)
- **Summary lives IN the event, durable first-class** (handoff 07 §5). This is what makes the projected self-footprint scrub safe: the compress tool call's giant `summary` argument may be replaced by a marker in projection (handoff 07 §9) *because* the event holds the authoritative copy. It also avoids pi-vault's duplicate-summary tax analysis trap (D2 §7.2) — one durable copy, projection decides rendering.
- **Size-limit policy** (plugin-enforced; no host-side cap exists — `appendCustomEntry` serializes any JSON, `session-manager.ts:2188`): `summary` / `instruction` / `snapshotText` **MUST** be ≤ 65,536 bytes UTF-8 (hard reject at tool layer) and **SHOULD** be ≤ 16,384 bytes (warn above). Rationale: every journal line is parsed on session load; unbounded events tax every future load and every replay.
- **Ids:** `eventId`, `blockId`, `pinId` are plugin-generated random 8-hex (same style as host entry ids, H4 §1.1). Not monotonic integers: DCP-style monotonic ids (`b1`, `m0001`) collide across sibling branches and capped at 9999 (D1 §2, defect list §8 item 8). Model-facing forms are `b:<blockId>` / future `p:<pinId>` per `address-layer.md`; never `@N`.

## 3. Reducer semantics

### 3.1 Fold

```
fold(pathEntries: SessionEntry[]) -> OverlayState
```

Input is the **full active branch path** (`getBranch()`, root→leaf), not just our events: native `compaction` entries drive derived states (§3.2), and message entries back ref-resolution. The fold is a **pure function of the path** — no wall clock, no config input (caps apply only at append time, §6) — so identical paths always produce identical state. The reducer **never throws**; malformed input degrades to warnings.

```ts
interface OverlayState {
  staleSchema: boolean;              // true if any unknown-schemaVersion event was skipped (§3.4)
  blocks: Map<string, BlockState>;   // audit-inclusive: disabled/sealed blocks stay listed
  pins: Map<string, PinState>;       // active pins; removed pins drop to an audit list
  seals: CompressSeal[];             // seal linkage records, path order
  seenEventIds: Set<string>;
  warnings: ReplayWarning[];         // surfaced via state/list tool ops (U1: never silent)
}
interface BlockState {
  def: CompressCreate;
  state: "active-overlay" | "disabled" | "shadowed" | "sealed-native-compaction" | "invalid-source";
  seal?: { compactionEntryId: string; firstKeptEntryId: string };
}
interface PinState { def: PinCreate | PinUpdate; targetBehindSeal: boolean; }
```

State names are exactly the five from `designs/overlay-engine.md` §Block states; nothing renamed.

### 3.2 Block states and legal transitions

Event-driven transitions (from our events, in path order):

| From | Event | To | Notes |
|---|---|---|---|
| — | `compress.create` | `active-overlay` | validation guarantees no active overlap at append (§6) |
| `active-overlay` | `compress.disable` | `disabled` | pre-seal expand = disable (`sealed-expand.md` pre-seal row) |
| `disabled` | `compress.enable` | `active-overlay` | **reducer guard:** if enabling would overlap an active block, the block stays `disabled` + warning — the no-active-overlap invariant is enforced at both layers |
| `active-overlay` \| `disabled` | `compress.seal` listing the blockId | `sealed-native-compaction` | terminal in v1; sealing a `disabled` block records reality + warning |
| any | `overlay.reset` | dropped from maps | state after reset = empty blocks/pins; sealed ranges stay behind the native boundary regardless (the `CompactionEntry` governs host projection, H1 §2.4) |

`disable`/`enable` targeting a `sealed-native-compaction` block: no-op + warning. Benign repeats (`disable` on `disabled`, `enable` on `active-overlay`, `remove` on removed): no-op, debug note only.

Derived states — recomputed on every fold from **path facts**, never event-driven:

- **`shadowed`:** block whose range lies fully or partially behind the latest native compaction boundary on the path (`firstKeptEntryId` of the latest `compaction` entry, `session-context.ts` emission mode C, H4 §3.2) **without** a seal event listing it. Projects nothing (source already outside native chronology). Straddling blocks (host cut inside our range — the host `findCutPoint` knows nothing of blocks, H1 §2.2) are also `shadowed`: projecting a summary over a partial remainder would misattribute coverage; the kept remainder shows raw, and the warning suggests the agent re-compress it (agent's decision — Q5, no auto-policy).
- **`invalid-source`:** refs unresolvable on this path (corruption, foreign writer, validation bug). Defensive only: because validation requires range entries to be on the active path at append time and the path to any fixed entry is immutable, honest events cannot become `invalid-source` on the branch where they were appended. Projects nothing + warning.

Derived states are per-path, which makes branch behavior automatic: a branch forked from before a compaction has no boundary on its path, so a block that is `shadowed` on one path folds back to `active-overlay` on the other. This is the payoff of fold-derived state over pi-vault's stored-snapshot reconciliation (`syncCompressionBlocks` defect class, D2 §6.2, D1 §2 orphan risk).

### 3.3 Idempotency

- **Duplicate `eventId`** on the path: first occurrence wins; later ones skipped + warning. Duplicates are reachable because `appendEntry` returns `void` — a retry after an ambiguous failure cannot check whether the first append landed.
- `compress.create` with an already-seen `blockId` (different eventId), `pin.create` with seen `pinId`: skip + warning (first-wins; journal order is truth).
- `pin.update` / `pin.remove` on unknown or removed pinId: no-op + warning (no resurrection).
- `compress.seal` naming unknown blockIds: linkage recorded for audit, unknown ids warned, known ids transition.

### 3.4 Unknown events and unknown schemaVersion: **skip-and-warn**, never hard fail

Chosen over hard fail because a version-downgraded plugin (or a v1 reducer meeting v2 events after a shared session file moves between machines) must not brick the session: a throwing `context` handler is swallowed by the host but kills the overlay every turn (H2 §2, errors logged and chain continues). Skip-and-warn degrades to "newer ops don't apply" and the warning is surfaced in `state`/`list` output.

Guard rail: skipping unknown events can leave state semantically stale (e.g. a skipped v2 "disable" leaves a block active), so when any unknown-version event was skipped the reducer sets `staleSchema: true` and the tool layer **MUST refuse all mutating overlay ops** (create/disable/enable/seal/pin writes) with a clear message, while projection continues on the events it understands. Read-only degradation, no interleaved v1 writes into a v2 log.

Unknown **fields** on a known op+version are ignored (additive forward compat, §7). An event missing `op`/`eventId`/`schemaVersion` is treated as unknown.

## 4. Non-overlap and shadow rules (v1)

1. **Two ACTIVE blocks MUST NOT overlap** (interval overlap on path positions). Enforced at tool layer (§6) and re-checked by the reducer enable-guard (§3.2). Overlapping active summaries create coverage ambiguity and double-hide; both DCP lineages needed graph machinery to manage it.
2. **No nesting in v1** — a block may not be created inside, across, or referencing another block; `b:` ids are not legal range boundaries for create (unlike DCP `bN` boundaries, D1 §2). Justification: nesting/consumed-block graphs are where both neighbor lineages accumulated defects — orphaned `bN` boundary refs after alias resets (D1 §2 "Compaction / orphan risk"), nested reactivation guards (D1 §6), consumed-block bookkeeping (D2 §3.2). **Recompress path without nesting:** `disable` the old block, `create` a wider block whose self-contained summary supersedes it (overlap with *disabled* blocks is legal; the old block simply stays disabled as audit). This preserves DCP's recompress capability with zero graph edges.
3. **Pin inside a compressed range: both apply; pin wins visibility.** The block stays active (range stays summarized in chronology); the pin renders its target's content from the journal at its placement (a pin is a salience intent rendered provider-neutral — `INVARIANTS.md` #9, `designs/pin.md` §Identity). Rejecting the pin would violate the pillar's maximum pin freedom (`INVARIANTS.md` #3). Tool layer MUST warn, both directions (§6).
4. **Compress range covering a pinned entry: allowed, symmetric to (3),** with a mandatory warning listing covered pin ids (U1: never silent extra effect).
5. **Range crossing a seal boundary: REJECTED at create.** A new range MUST lie entirely within native active history (at/after the latest compaction's `firstKeptEntryId` on the path). Behind-the-boundary content is not in native chronology (H4 §3.2); "compressing" it is a wire no-op with undefined projection semantics. Entirely-behind requests get a rejection naming the sealed/rehydrate alternatives (`sealed-expand.md`).
6. **Pin whose target falls behind a native seal:** the pin is kept; the reducer derives `targetBehindSeal: true`; the projector honors `spec.compaction` — `preserve` re-renders from the journal, `request-only`/`salient` go dormant + warning. This stores pin.md's compaction modes verbatim instead of inventing a winner here.

## 5. Branch semantics

- **Overlay state is branch-path state.** Events are journal entries chained at the leaf where they were appended (`session-manager.ts:1094–1100`), so `fold(getBranch())` naturally scopes state to the active branch. **Events on abandoned branches are never visible to replay** of another path; they remain in the session file for audit (`getEntries()`, tree UI) and are never deleted (`INVARIANTS.md` #5/#6).
- **Fork:** host `fork()` copies all entries verbatim with the same entry ids and mints only a new session header id (`session-manager.ts:1359–1400`). Therefore the **embedded `sessionId` in `StoredRange`/`EntryRef` is provenance metadata only — the reducer MUST NOT use it as a filter key**; resolution keys on `entryId` within the current file. A sessionId mismatch produces a provenance note, not a rejection. (Clarifies `address-layer.md` "always store `(sessionId, entryId)`": stored yes, filtered no. Tension T4, §9.)
- **Branch fork before a block's create event:** the new path lacks the event; the block does not exist there. Fork before the seal: both the `CompactionEntry` and the `compress.seal` event (appended after it) are off-path, so blocks fold back to `active-overlay` — exactly the pre-seal world. No reconciliation code; the fold gives it for free.
- **Seal linkage stores `{ compactionEntryId, firstKeptEntryId }`** (§2). Ordering: our `session_before_compact` handler returns the custom `CompactionResult` (H1 §3.2); host appends the `CompactionEntry`; on `session_compact` (carries the entry, H1 §5.2) we append `compress.seal`. The seal event therefore sits after the compaction entry on the path.
- **Crash window:** if the session dies between the host's `CompactionEntry` append and our seal append, affected blocks fold as `shadowed` — safe degradation (project nothing; native summary governs). To make the linkage recoverable, the seal-time `CompactionResult.preserveData` MUST carry `{ icm: { sealEventId, blockIds } }` (H1 §5.2 preserveData survives on the entry), and on `session_start` the plugin SHOULD detect a `fromExtension` compaction entry with our preserveData but no matching seal event and append the reconciling seal (`origin.actor: "plugin"`).

## 6. Validation (tool layer, before any append)

The tool layer validates; the reducer only guards invariants it can check deterministically (§3.2). Protocol-closure **computation** is owned by `designs/compress.md`; this schema only fixes what the *stored* range must satisfy.

**MUST:**

1. `eventId` always fresh 8-hex; `blockId`/`pinId` fresh on `*.create` (not present in the current fold's seen-sets). Mutating ops (`disable`/`enable`/`update`/`remove`) reference existing ids.
2. All range endpoints (compress ranges AND pin range targets) resolve via `getEntry` and lie **on the active branch path**, with `pos(start) ≤ pos(end)`.
3. *(compress ranges)* Range is non-empty and covers ≥ 1 `message`-type entry (meta/custom entries are not compressible material).
4. *(compress ranges)* The stored `[startEntryId, endEntryId]` interval is already **protocol-closed** (no half-pairs of toolCall/toolResult at the edges) — closure algorithm and reject UX per `designs/compress.md`; storage never persists an unclosed range.
5. *(compress ranges)* No overlap with any `active-overlay` block (§4.1); no nesting boundaries (§4.2).
6. *(compress ranges)* Range entirely within native active history on the path (§4.5). **Not applied to pin targets** — pins over sealed ranges are legal and are exactly the post-seal rehydrate mechanism (§9 T2).
7. `summary`/`instruction`/`snapshotText` ≤ 65,536 bytes UTF-8.
8. If `staleSchema` is true: refuse all mutating ops (§3.4).
9. `compress.seal` only from the real seal flow: `compactionEntryId` from the `session_compact` event, `firstKeptEntryId` echoed from the returned `CompactionResult`, `preserveData.icm = { sealEventId, blockIds }` written (§5).
10. Pin entry targets resolve on the active branch path (range targets covered by rule 2).
11. Appends happen only on the active branch — inherent to `pi.appendEntry` (chains at leaf), stated so nobody reaches for `appendToBranch`-style side doors.

**SHOULD:**

12. `summary` ≤ 16,384 bytes (soft target; warn above — the summary is re-projected wire cost, D2 §7.2).
13. Warn and list affected ids when a new block covers pinned entries or a new pin lands inside an active block (§4.3–4.4).
14. Record `origin.toolCallId`, and `origin.assistantEntryId` when resolvable, on agent-initiated events (self-footprint scrub anchor, handoff 07 §9).
15. Preview/`dryRun` paths reuse exactly this validator so reject UX matches real appends (U1).

## 7. Migration policy

- `schemaVersion` is an integer, starting at 1, **inside the payload** (§1: never in the customType string).
- **Bump** on any breaking change: field removal/retype, semantic change to an existing op, or change to StoredRange closure semantics. **No bump** for additive optional fields (readers MUST ignore unknown fields, §3.4). A **new op** without a bump is allowed only when old-reader skip is semantically safe (pure additions like a new annotation event); if skipping could corrupt projection semantics (e.g. a new op that retargets existing blocks), bump.
- **v1 reducer on v2 events:** skip-and-warn per event, set `staleSchema`, freeze mutations (§3.4). It never guesses at v2 payloads.
- **v2 reducer on v1 events:** MUST read v1 natively (read-time upconversion, at least one major version back). Migration is **read-time only** — the journal is never rewritten (`INVARIANTS.md` #5/#6; H1 §2.4 append-only).
- `overlay.reset` is not a migration tool; version transitions never require resetting user state.

## 8. What would change this freeze

1. **Q4 ratification goes the other way** (author requires byte-exact in-place expand after seal → architecture D pulled forward, `sealed-expand.md` §Overturn): `sealed-native-compaction` stops being terminal, seal linkage shape and §3.2 transitions reopen.
2. **Host ships `ContextRecord` provenance or trusted projection ownership** (H4 §5, DECISIONS Q2/Q3 overturn rows): range/pin targets may bind to context records; `shadowed` derivation changes.
3. **`appendEntry` starts returning the entry id** (change at `types.ts:1329` / `runtime-init.ts:83–85`): `eventId` could collapse into the journal id; §2 envelope reopens to simplify.
4. **`designs/compress.md` closure needs sub-entry masking** (partial ranges inside one assistant turn addressed by `t:<toolCallId>`): `StoredRange` gains sub-entry refs → schemaVersion 2.
5. **Pin E4/E5 provider evals (Q7/Q8) overturn tail-zone or one-block render, or a host-native context pin ships** (pin.md §Overturn): `PinSpecV1` fields change (additive if lucky, v2 if not).
6. **Author demands nesting/recompress graphs in v1**: §4.1–4.2 reopen; the event union would need consumed-block linkage.
7. **H1 claim 5 breaks on a later host** (compaction stops being append-only, or `firstKeptEntryId` semantics change): seal linkage and §4.5 boundary math reopen.
8. **Multiple ICM-writing extensions must coexist in one session**: envelope gains a writer-identity field; idempotency rules extend beyond `eventId`.

## 9. Tensions surfaced (not silently rewritten)

- **T1 — deviation from the 2026-08-09 handoff sketch** (07 §4): dropped per-event `at` (entry timestamp already exists), made seal linkage mandatory and multi-block (sketch had optional `compactionEntryId`, single block), added `pin.update`/`overlay.reset`. Allowed by DECISIONS "2026-08-09 handoff is prior, not lock", flagged for visibility.
- **T2 — Q4 is unratified, and this schema takes a position:** seal is terminal, and **post-seal rehydrate-expand is modeled as `pin.create` (kind `source`/`snapshot` over the sealed range), not a new event op**. This keeps the union minimal and reuses pin rendering mechanics, but it hard-codes the `sealed-expand.md` proposal into storage. If the author ratifies differently, §2/§3.2/§4.6 reopen (item 8.1). Do not treat this as closing Q4.
- **T3 — pin.md defaults are leaned, not frozen** (Q7/Q8 open), yet `PinSpecV1` freezes their *storage shape*. Mitigation: semantics stay owned by pin.md; storage additions are additive (§7). If placement/kind vocabulary changes, that is item 8.5.
- **T4 — `address-layer.md` "always store `(sessionId, entryId)`"** is kept for storage, but this freeze forbids using the embedded sessionId as a reducer filter key, because host `fork()` preserves entry ids under a new session id (§5). A literal reading of address-layer could have keyed on it; this doc is the stricter contract.
