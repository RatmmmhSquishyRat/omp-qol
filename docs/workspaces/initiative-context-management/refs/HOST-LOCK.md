# Host Lock

**status:** ICM host substrate locked at E2 for compaction, context, cache, addressing. Delta 17.2.12→17.3.4 does not overturn the 2026-08-09 foundation.

| Field | Value |
|---|---|
| Repo | `can1357/oh-my-pi` |
| Inspected worktree | `docs/ref_repos/oh-my-pi-main` |
| Commit | `de6b7974a0` |
| Date | 2026-08-16 |
| `@oh-my-pi/pi-coding-agent` | **17.3.4** |
| Previous research lock | `45e12e5` / 17.2.12 (2026-08-09 handoff) |

## Closed on this lock

| Claim | Grade | Report |
|---|---|---|
| Pressure floor `max(provider, stored)` | E2 | `host-compaction.md` |
| `session_before_compact` cancel + custom `CompactionResult` (skips snapcompact) | E2 | `host-compaction.md` |
| Default strategy `snapcompact` | E2 | `host-compaction.md`, `host-delta-17.3.md` |
| `appendEntry` durable, not sent to LLM | E2 | `host-context-event.md` |
| `context` = clones, no entry provenance; serial handlers; plugin not first | E2 | `host-context-event.md` |
| `transformContext` before `convertToLlm` | E2 | `host-context-event.md` |
| Longest byte-stable prefix; cost = divergence + suffix | E2 | `host-cache.md` |
| Persist `(sessionId, entryId)`; no context→entry map | E2 | `host-addressing.md` |
| Core compaction/cache/session-context files unchanged 17.2.12→17.3.4 | E2 | `host-delta-17.3.md` |

## Refresh rule

Before implementing against a newer OMP commit: record the new hash + coding-agent version, diff the evidence-ledger paths, re-run H1–H5 conclusions.
