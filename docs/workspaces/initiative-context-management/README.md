# Initiative Context Management — Living Workspace

**status**: research / architecture (no implementation freeze)
**opened**: 2026-08-16
**module**: `initiative-context-management`

This is the long-lived working area for the hardest QOL module. It is **not** SSOT and **not** a frozen research snapshot.

| Kind | Path | Rule |
|---|---|---|
| Pillars (SSOT) | `docs/ssot/pillars/initiative-context-management/` | Verbatim intent. Append only. Never silently rewrite. |
| Frozen 2026-08-09 handoff | `docs/researches/OMP-QOL-Complete-Research-Handoff-2026-08-09/` | Evidence. Do not edit in place. |
| DCP transcripts | `docs/researches/dcp/` | Evidence. |
| This workspace | `docs/workspaces/initiative-context-management/` | Living research, decisions, designs, evals. |
| Reference clones | `docs/ref_repos/` | Gitignored. See `refs/INDEX.md`. |

## Product scope for this program

Author-scoped three-piece set (2026-08-16):

1. **Initiative compress** — foundation
2. **Initiative pin** — foundation
3. **Pin tree** — QoL, after the two foundations

`PrimeStyleManagement` remains a pillar in the same SSOT folder. It is **adjacent**, not part of this three-piece v1.

## Why this module is different

Other QOL tools (goal / plan / vibe / advisor) expose capabilities the host already owns. This module does **not** exist in OMP. It needs original architecture, implementation planning, real-use verification, and cache/cost measurement.

ADR-004 (thin driver, no emulation) still applies to **host-owned** surfaces. It does **not** forbid building a new overlay engine for a capability the host does not have.

## Start here

0. `SYNTHESIS.md` — consolidated digest of the whole opening program (read first)
1. `INVARIANTS.md` — laws that cannot be silently rewritten
2. `WORKFLOW.md` — how this workspace operates
3. `STATUS.md` — what is known / open / blocked
4. `PROGRAM.md` — phased program
5. `TODO.md` — living backlog
6. `questions/open-questions.md` — decisions that can still change architecture
7. `research/00-index.md` — research tracks
8. `designs/00-index.md` — design drafts (none frozen)
9. `refs/INDEX.md` — cloned baselines

## Track map

```text
Track H  host lifecycle          context / compaction / cache / extension seams
Track D  DCP comparison          OpenCode DCP + Pi-DCP ports
Track C  compress primitive      overlay, expand, seal, self-footprint
Track P  pin primitive           kinds, placement, protocol-safe render
Track T  pin tree                policy over pin, deferred
Track E  eval / cache / cost     tokens, cacheRead/Write, price, behavior
Track U  agent-facing UX         tools, prompts, structured JSON, freedom
```
