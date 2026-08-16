# Design Drafts

Nothing here is frozen. Do not implement from these until the matching P0 question is closed.

Planned drafts (to be written after research reports land):

| Draft | Depends on | Blocks |
|---|---|---|
| `overlay-engine.md` | H1–H5, I1 — **drafted 2026-08-16** | compress + pin |
| `overlay-schema.md` | overlay-engine, H1/H2/H4, D1/D2 — **drafted 2026-08-16, main-agent reviewed; working freeze, Q4-coupled parts (T2) await ratification** | compress + pin storage |
| `address-layer.md` | H2, H4, D2, Q2 — **drafted 2026-08-16, amended (sessionId provenance-only, T4)** | public syntax, tools |
| `sealed-expand.md` | H1, H4, Q4 — **PROPOSED 2026-08-16, needs author ratification** | compress expand ops |
| `compress.md` | overlay-schema, Q3, Q4, Q5 — **drafted 2026-08-16, main-agent integration review (aligned to schema: no nesting, pins accept+warn, straddle→shadowed)** | Phase 4 |
| `pin.md` | overlay, H3, D3, D4, Q7 — **drafted 2026-08-16; storage shape frozen in overlay-schema `PinSpecV1` (T3), semantics still leaned** | Phase 5 |
| `pin-tree.md` | pin | Phase 6 |
| `agent-ux.md` | U1, Q6 — **drafted 2026-08-16** | tool registration |
| `eval-metrics.md` | E1 — **drafted 2026-08-16** | Phase 4–6 acceptance |

The 2026-08-09 designs in `docs/researches/OMP-QOL-Complete-Research-Handoff-2026-08-09/02-foundation-research/07-CONTEXT-OVERLAY-ENGINE.md` and `08-PIN.md` / `09-PIN-STATE-TREE.md` are the starting drafts. New drafts here must say what they keep, what they re-verify, and what they overturn.
