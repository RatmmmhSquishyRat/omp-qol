# Research Index

Each track writes one report under its folder. Reports must cite file paths and commits. E0 claims are not enough.

| Track | Report | Question |
|---|---|---|
| H1 | `host-compaction.md` | Pressure floor, `session_before_compact`, custom `CompactionResult`, seal path on 17.3.4 |
| H2 | `host-context-event.md` | `context` event shape, handler order, `appendEntry`, extension API |
| H3 | `host-cache.md` | `AppendOnlyContextManager`, first-divergence, provider cache fields |
| H4 | [`host-addressing.md`](./host-addressing.md) | `SessionEntry.id`, `buildSessionContext`, provenance gap, alias options |
| H5 | `host-delta-17.3.md` | What changed since 17.2.12 / `45e12e5` that can overturn ICM design |
| H6 | [`plugin-seams.md`](./plugin-seams.md) | What omp-qol already reaches; what ICM still cannot reach |
| D1 | [`dcp-opencode.md`](dcp-opencode.md) | OpenCode DCP mechanisms vs pillar freedom — **done** @ DCP `85b6f5c` |
| D2 | [`pi-dcp.md`](pi-dcp.md) | Pi-DCP ports: addressing, overlay, self-footprint, persistence |
| D3 | `opencode-acm.md` | ACM pin + compact as a near-neighbor product |
| D4 | `pin-ecosystem.md` | btw pin, OpenCode native pin PR, other pin systems |
| E1 | [`cache-cost.md`](./cache-cost.md) | Provider cache economics and how to measure in OMP — **done** @ host `de6b7974a0`, docs 2026-08-16 |
| U1 | [`agent-ux.md`](./agent-ux.md) | Tool/prompt/output lessons from DCP transcripts + current QOL tools — **done** (recommend, not freeze) |
| I1 | `ingest-2026-08-09.md` | Claim-by-claim inherit / re-verify / overturn matrix |

## Source policy

- Host truth: `docs/ref_repos/oh-my-pi-main` @ `de6b7974a0` (17.3.4 current main)
- Local junction (do not move): `docs/ref_repos/oh-my-pi` @ `ffd53ff92a` (17.3.4, 2026-08-14)
- Comparison: `opencode-dynamic-context-pruning`, `pi-dcp`, `pi-dcp-vault`, `opencode-acm`, `opencode-btw`, `prime-agent`
