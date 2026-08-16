# Phase 012: initiative-context-management workspace opening

**commit**: `7bee9cc` `docs: open initiative-context-management workspace with 17.3.4 research lock`
**date**: 2026-08-16

## Problem / Background

The user opened the ICM program: initiative compress + initiative pin (foundations) and pin tree (QoL), the hardest module in omp-qol because the capability does not exist in the OMP host at all. Unlike the thin-driver features (ADR-004), ICM needs ground-up architecture, and the 2026-08-09 foundation handoff had to be re-verified against OMP 17.3.4 before anything could be trusted.

## Decision

- Created a long-lived workspace at `docs/workspaces/initiative-context-management/` (control plane: README / INVARIANTS / WORKFLOW / STATUS / PROGRAM / TODO / DECISIONS / questions / research / designs / refs), separate from SSOT pillars and the frozen handoff.
- Cloned/junctioned reference repos into `docs/ref_repos/` (ignored): oh-my-pi worktree @17.3.4, opencode-dynamic-context-pruning, two pi-dcp ports, opencode-acm, opencode-btw, prime-agent.
- Fanned out 13 research tracks (H1–H6 host, D1–D4 ecosystem, E1 cache/cost, U1 agent UX, I1 ingest matrix). No 2026-08-09 host finding was overturned; architecture A (overlay-only) stays dead; v1 target remains architecture C (overlay + native seal).
- Closed Q1/Q2/Q3/Q5 as working decisions; the model-facing address form is typed canonical ids (`m:<entryId>` / `t:<toolCallId>` / `b:<blockId>`), explicitly not DCP-style `m0001`.
- Proposed Q4 sealed-expand semantics (rehydrate default, branch explicit) with the pillar tension surfaced and flagged for author ratification.

## Output

34 files, 6749 insertions: 13 research reports, 7 design drafts, workspace control plane, verbatim user pillar appended to `docs/ssot/pillars/initiative-context-management/README.md`, `.gitignore` entry for `docs/ref_repos/`.

## Verification

Research is source-verified against the pinned host worktree (HOST-LOCK 17.3.4). Runtime (E3) verification of the three load-bearing hooks (`appendEntry`, `context`, `session_before_compact`) is launched as the next phase; no product code exists yet by design.
