# OMP-QOL — Complete Research Handoff

**Date:** 2026-08-09  
**Purpose:** single clean handoff package for continuing OMP-QOL design and implementation with local agents.

This package contains the original proposal unchanged plus the foundation investigation performed against current OMP upstream. It intentionally contains **no nested ZIPs, no duplicated standalone exports, and no temporary working files**.

## Read this first

Recommended order for a new agent:

1. `01-FOUNDATION-REPORT.md` — executive technical report and architecture-changing findings.
2. `02-foundation-research/14-P0-CLOSURE-NOTES.md` — the most important unresolved/closed architecture questions, especially DCP lifecycle.
3. `02-foundation-research/TODO.md` — current execution order.
4. `02-foundation-research/03-UNCERTAINTY-REGISTER.md` — what is proven, disproven, or still open.
5. `02-foundation-research/12-EVIDENCE-LEDGER.md` — evidence/source ledger.
6. Then read topic-specific research as needed.
7. Use `03-original-proposal/` as the preserved source proposal/SSOT input, not as proof that older lifecycle assumptions remain valid.

## Directory layout

```text
OMP-QOL-Complete-Research-Handoff-2026-08-09/
├── README.md
├── 01-FOUNDATION-REPORT.md
├── 02-foundation-research/
│   ├── 01-WORKFLOW.md
│   ├── 02-PROPOSAL-MAP.md
│   ├── 03-UNCERTAINTY-REGISTER.md
│   ├── 04-UPSTREAM-DELTA.md
│   ├── 05-RESOURCE-APPLICATION-MATRIX.md
│   ├── 06-ADVISOR-WATCHDOG.md
│   ├── 07-CONTEXT-OVERLAY-ENGINE.md
│   ├── 08-PIN.md
│   ├── 09-PIN-STATE-TREE.md
│   ├── 10-PRIME-STYLE-MANAGEMENT.md
│   ├── 11-TEST-EVAL-PLAN.md
│   ├── 12-EVIDENCE-LEDGER.md
│   ├── 13-PROPOSED-SSOT-REVISIONS.md
│   ├── 14-P0-CLOSURE-NOTES.md
│   └── TODO.md
├── 03-original-proposal/
│   ├── plans/
│   ├── researches/
│   └── ssot/
└── 99-metadata/
    ├── CONTENTS.txt
    └── SHA256SUMS.txt
```

## Package invariants

- `03-original-proposal/` contains **24 files** and is byte-identical to the corresponding files in the original `docs.zip` input.
- Research files are kept separate from the original proposal; no original SSOT/ADR/design document was rewritten in place.
- The upstream investigation was locked to `can1357/oh-my-pi` commit `45e12e5bb758198a920c6070e7e64cb33b21beac` (`@oh-my-pi/pi-coding-agent` 17.2.12), with comparison work against OpenCode DCP and Prime Agent documented in the research files.

## Current highest-priority decisions

Do **not** begin by polishing public tool syntax. Close the shared substrate first:

- stable SessionEntry → outbound-context provenance/addressing;
- DCP product target: reversible overlay + native sealing versus trusted core projection ownership;
- custom CompactionResult sealing and post-seal Expand semantics;
- advisor live-apply bridge;
- live AGENTS/context prompt-refresh bridge;
- standard Managed Harness Resource apply/readback contract.

PinStateTree and higher-order self-management should remain downstream of those primitives.
