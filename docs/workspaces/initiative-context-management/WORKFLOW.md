# Workspace Workflow

## Operating model

This module is a multi-month control plane. Work is split so tracks can proceed in parallel without coupling storage, projection, policy, and eval.

```text
pillar (immutable intent)
    ↓
research (source / transcript / ecosystem)     evidence grades E0–E5
    ↓
decision (C vs D, address, sealed expand, UX)  recorded in DECISIONS.md
    ↓
design (overlay / compress / pin / tree / eval)
    ↓
route freeze (only after P0 questions close)
    ↓
implementation plan + TDD
    ↓
code + L1/L3/L5/L6 + cache/cost arms
```

Do not start public tool-syntax polish before the shared substrate is closed.

## Evidence grades

Reuse the 2026-08-09 scale:

- **E0** idea
- **E1** source inferred
- **E2** source closed-loop (mutate + apply + readback identified)
- **E3** deterministic integration on a real OMP session, no LLM
- **E4** real model invokes the feature
- **E5** comparative eval (task score + tokens + cache + cost)

A design is not done at E1.

## Layer discipline

1. **Host capability exposure** — only if OMP already owns the primitive.
2. **Context projection** — what the next model request sees. Lossless journal.
3. **Durable harness state** — project/user resources. Not session pin by accident.

Compress and pin are layer 2. Pin tree is policy over layer 2. PrimeStyle is layer 3 and out of v1.

## Decision rules

- Current OMP source + runtime beat older docs when they disagree.
- The 2026-08-09 handoff is a strong prior, not a lock. Host is now 17.3.4 (`de6b7974a0` main / local junction `ffd53ff92a`).
- Pillar freedom beats DCP convenience defaults. Auto-policy may exist as an **optional** heuristic, never as the only path.
- If a question can force a different storage model, it is P0 and blocks implementation freeze.

## Document rules

- Research notes go under `research/<track>/`.
- Decisions go to `DECISIONS.md` with date, evidence grade, and what would overturn them.
- Designs stay drafts until the matching P0 question is closed.
- SSOT pillars are appended, never silently rewritten.
- The 2026-08-09 handoff is not edited.

## Implementation gate

Implementation of a primitive may start only when:

- invariant is explicit
- native lifecycle is E2 or better on **current** host
- plugin/core boundary is known
- failure / branch / resume / compaction semantics are defined
- a test + cache/cost matrix exists
- no open question could force a different storage model

Pin tree does not pass this gate until flat pin has E4/E5 evidence.
