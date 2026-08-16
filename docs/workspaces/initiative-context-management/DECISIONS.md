# Decision Log

Only record decisions that are actually taken. Hypotheses stay in `questions/` or research notes.

## 2026-08-16 — Workspace placement

**decision:** Living work lives in `docs/workspaces/initiative-context-management/`.
**why:** The module is long-running, multi-track, and must not overwrite SSOT pillars or the frozen 2026-08-09 handoff.
**overturn if:** Author names a different docs home.

## 2026-08-16 — Author scope for this program

**decision:** v1 program is initiative compress + initiative pin + pin tree. PrimeStyle is adjacent, not v1.
**why:** 2026-08-16 pillar text. PrimeStyle file is not deleted.
**overturn if:** Author expands or narrows the three-piece set.

## 2026-08-16 — 2026-08-09 handoff is prior, not lock

**decision:** Inherit architecture language (overlay, seal, provenance, protocol safety, tail pin). Re-verify every host claim on 17.3.4 before freeze.
**why:** Handoff locked 17.2.12 / `45e12e5`. Current host is 17.3.4 / `de6b7974a0`.
**overturn if:** Current-host source shows the old claims still hold *and* no new seam appeared.

## 2026-08-16 — No product code in the opening pass

**decision:** This opening creates workspace + research + clones only.
**why:** P0 questions can still force a different storage/lifecycle model.
**overturn if:** A later pass closes P0 and the author says build.

## 2026-08-16 — Q1 closed: pressure floor still holds on 17.3.4

**decision:** Overlay-only (architecture A) is not a product target. Native pressure is still `max(provider usage, stored-conversation estimate)`. A plugin can seal via `session_before_compact.compaction` or veto via `cancel`, but cannot hide stored history by shrinking the wire payload.
**evidence:** E2 `research/host-compaction.md` @ host `de6b7974a0` / coding-agent 17.3.4. `compactionContextTokens` + comments naming Headroom / on-wire compression as the reason for the floor.
**new host fact:** default strategy is `snapcompact`; a custom `CompactionResult` still skips both LLM summarize and snapcompact.
**overturn if:** A later host removes the stored-estimate floor or lets extensions report trusted projected occupancy (that would reopen D as a smaller patch, or A as viable).

## 2026-08-16 — Comparison steal / reject (working laws, not a route freeze)

**steal:** transform-only `context` projection; compression blocks; pair-safe tool handling; vault-style `appendEntry` overlay; ACM-style inspect/scan/map; agent-authored summary + explicit expand.
**reject as v1 defaults:** sidecar DB as source of truth; plugin-decided auto-dedup / error-purge / threshold nudges; fixed stubs instead of agent summaries; mutating the host journal; head-of-list pin as the only placement; relying on a later LLM pass to scrub compress-tool self-footprint.
**why:** Pillar freedom + three comparison reports (D1/D2/D3) agree. ACM/DCP are neighbors, not templates.
**overturn if:** Author explicitly wants DCP-like auto-policy as the product.

## 2026-08-16 — Q2 working: hybrid address layer

**decision:** Persist `(sessionId, entryId)` only. The model types `m:<entryId>` / `t:<toolCallId>` / `b:<blockId>` from `getBranch()`, never from `context` clones and never as sequential `m0001`. One QOL handler owns compress+pin order. A host `ContextRecord` seam is desired, not a v1 blocker. Do not freeze `@N`.
**evidence:** E2 H2 + H4. U1 second pass. D1/D2 `m0001` is a neighbor defect to avoid as the typed API.
**overturn if:** Host ships provenance on `context` (then aliases can bind to those records) or `getBranch()` becomes insufficient after compaction/filter.

## 2026-08-16 — Q3 working: v1 target is C

**decision:** Implement overlay + native seal (`session_before_compact` custom `CompactionResult`). Keep block state independent of materialization so a later D seam can keep blocks reversible. Architecture A is rejected. D is not shipped on 17.3.4 and is not a v1 dependency.
**evidence:** H1 pressure floor; H5 delta (C still viable, D not shipped); pillar expand-after-seal remains Q4.
**overturn if:** Author requires indefinite exact expand in the native chronology (then D must start earlier), or host adds trusted projected occupancy.

## 2026-08-16 — Cache model confirmed

**decision:** Design and later evals treat cache cost as **first divergence + changed suffix**. Tail-zone pins and tail self-footprint scrub are the cheap default; system-prefix and mid-history edits are explicit/expensive. Native compaction still invalidates the whole append-only log.
**evidence:** E2 H3 (`AppendOnlyContextManager` #3406, unchanged 17.2.12→17.3.4).
**overturn if:** Provider dialect after `transformProviderContext` is shown to diverge from the digest, or a later host changes prefix matching.

## 2026-08-16 — Pin v1 leans (not a freeze)

**lean:** Agent-first flat pin; kinds source+instruction first; one provider-neutral block; tail-zone; branch scope; compaction request-only; tree deferred. See `designs/pin.md`.
**why:** D4 — no shipped product matches the pillar. btw dual-inject, ACM head replay, and PR 9097 raw mid-history are the anti-patterns.
**not closed:** Q7/Q8 still need provider E4/E5. If a host ships native pin, wrap it (ADR-004).

## 2026-08-16 — Q4 PROPOSED (not closed): sealed expand = rehydrate default, branch explicit

**proposal:** Pre-seal expand disables the overlay (exact). Post-seal expand defaults to journal-sourced **rehydrate** with `exactExpandAvailable: false` and `alternatives: ["branch"]`. See `designs/sealed-expand.md`.
**why:** Journal losslessness satisfies the pillar in content at all times; native chronology after a C seal cannot be restored in place without D. The tension is documented, not rewritten.
**status:** NEEDS AUTHOR RATIFICATION. If the author demands byte-exact in-place expand after seal, D moves forward and C becomes fallback.

## Not decided

- Sealed expand (Q4) — proposed above, awaiting ratification
- Tool surface names (Q6) — working bet only
- Public `@N` syntax
- Provider USD fixture run (Q8)
- Overlay event schema freeze (draft in flight)
