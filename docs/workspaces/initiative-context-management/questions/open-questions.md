# Open Questions

These can still change architecture. Do not freeze public API while they are open.

## Q1 — Does 17.3.4 still floor native compaction by stored conversation? — **YES (E2, 2026-08-16)**

Closed in `DECISIONS.md`. Overlay-only cannot own headroom. C or D remains required. A is rejected.

See `research/host-compaction.md`. Default strategy is now `snapcompact`; custom `CompactionResult` still skips it.

## Q2 — Address layer — **working hybrid (2026-08-16)**

Closed in `DECISIONS.md` + `designs/address-layer.md`. Persist `(sessionId, entryId)`. Model types `m:<entryId>` / `t:<toolCallId>` / `b:<blockId>` from `getBranch()`. Not `m0001`, not `@N`. Host `ContextRecord` later.

## Q3 — Product target C or D? — **working: C for v1 (2026-08-16)**

Closed in `DECISIONS.md`. Overlay + native seal. D is a migration path, not a v1 host patch. Pillar "expand any summary" after seal is Q4, not a silent D.

## Q4 — What does expand mean after a native seal? — **PROPOSED (2026-08-16), needs author ratification**

Proposal in `designs/sealed-expand.md`: pre-seal = overlay-disable (exact); post-seal default = **rehydrate** (content-exact, position-synthetic, `exactExpandAvailable: false`); post-seal explicit = `branch`. Pillar tension is surfaced there — if the author requires byte-exact in-place expand after seal, architecture D must be pulled forward.

## Q5 — How much automatic policy is allowed? — **working answer: not as v1 defaults**

Pillar rejects plugin-decided compression. D1/D2/D3 all treat auto-dedup / error-purge / threshold nudges as DCP product policy, not ICM.

v1: agent tools + optional skill heuristics only. Auto-policy, if ever added, is opt-in, inspectable, disableable — never the only path.

Still open: whether a later opt-in heuristic pack is worth building at all.

## Q6 — Agent-facing tool shape? — **working bet: one `context` multi-op tool**

U1 / `designs/agent-ux.md`. Advisor envelope + pressure fields. Expand is a tool op (DCP slash-only is a defect). Not a name freeze. Overturn if essential-schema is too large or the host ships `context`.

## Q7 — Pin default placement? — **working: tail-zone (host-side E2)**

H3 confirms tail edits are cheap and system/mid-history move the divergence frontier. Still needs provider USD measurement (Q8 / E1) before calling this E5. ACM's **head** reinjection is rejected as the default (D3).

## Q8 — How do we measure cache and price? — **fixture designed, not yet run (2026-08-16)**

Contract: `research/cache-cost.md` + `designs/eval-metrics.md`.

Four arms (native / overlay / overlay+seal / overlay+pin), pin arm split tail/system/mid. Eight metrics + first divergence. Host `$` via `calculateCost`. Two layers (host prefix vs provider billed cache). Isolation via `PI_CONFIG_DIR`.

Not closed: live billed E4/E5. Tail-cheap remains a hypothesis.
