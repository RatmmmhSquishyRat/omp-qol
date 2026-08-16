# Living TODO

Legend: **P0** architecture, **P1** primitive implementation, **P2** tree/eval scale-up.

## P0 — opening (in progress 2026-08-16)

- [x] Create living workspace separate from SSOT and frozen handoff
- [x] Append 2026-08-16 author scope to the pillar README (verbatim)
- [x] Junction/clone reference repos under `docs/ref_repos/`
- [x] Plugin seam inventory (`research/plugin-seams.md`)
- [x] Fan-out host compaction (H1)
- [x] Fan-out remaining host research (H2–H5)
- [x] Fan-out DCP / Pi-DCP / ACM (D1–D3)
- [x] Fan-out pin ecosystem (D4)
- [x] Fan-out cache-cost (E1)
- [x] Fan-out agent-ux (U1) and ingest (I1)
- [x] Draft `designs/eval-metrics.md`
- [x] Draft `designs/agent-ux.md` + `designs/overlay-engine.md`
- [x] Draft `designs/pin.md` (working defaults, not frozen)
- [x] Write `refs/HOST-LOCK.md`
- [ ] Ingest 2026-08-09 claims into a re-verification matrix
- [x] Draft `designs/address-layer.md`

## P0 — architecture (blocked on current-host evidence)

- [x] Re-verify native pressure floor on 17.3.4 (E2, A rejected)
- [x] Re-verify `session_before_compact` custom `CompactionResult` (E2)
- [x] Re-verify `appendEntry` overlay persistence (E2, H2)
- [x] Re-verify context-event provenance gap + handler ordering (E2, H2/H4)
- [x] Re-verify append-only cache longest-prefix behavior (E2, H3)
- [x] Address strategy: hybrid — persist entryId, alias from `getBranch()`
- [x] v1 product target C (D is migration, not a v1 host patch)
- [x] Sealed expand semantics — PROPOSED in `designs/sealed-expand.md`, needs author ratification
- [x] Freeze overlay event schema and non-overlap/shadow rules — `designs/overlay-schema.md`, working freeze after main-agent review; Q4-coupled parts await ratification
- [x] Define protocol-safe closure + rejection UX — `designs/compress.md` (10-step closure, zero-widening tolerance, 13-reason reject catalog); integration-fixed to the schema freeze
- [x] E3 substrate probe — 40/40 PASS on host 17.3.4, main-agent re-run confirmed (`research/probe-e3-substrate.md`, `plugin/scripts/icm-substrate-probe.ts`)
- [ ] Define agent-facing tool shape (working bet in `designs/agent-ux.md`; freeze after schema)

## P1 — after P0 close

- [ ] Compress overlay + expand + state + preview
- [ ] Pin kinds + tail-zone + renderer
- [ ] L1/L3/L5/L6 + cache/cost arms

## P2

- [ ] Pin tree
- [ ] Comparative eval harness (native / overlay / overlay+seal / overlay+pin / tree)
