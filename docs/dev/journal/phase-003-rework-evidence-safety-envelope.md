# Phase 003: Rework — evidence surface, safety fixes, unified envelope, test integrity

**commit**: `336d0ab` `feat: surface live advisor evidence and unify tool envelopes per review rework`
**date**: 2026-08-15

## Problem / Background

A 6-model adversarial review of the qol-004 advisor tool found: (1) the
"multi-advisor works at runtime" claim had no test evidence; (2) data-safety
holes — the native loader silently maps unparsable files to an empty doc and
an empty save deletes the file, so a mutate could destroy a user's
WATCHDOG.yml; (3) test-integrity failures — a tautological regex (A9), a
fake kill-switch test (A17), weak L3 assertions; (4) misleading agent-facing
output — `configured` echo, untruthful `persisted`/`fileDeleted`, blanket
`approval: "read"` on ops that write files and start billable runtimes.
The approved rework plan (`qol-004_rework_loop_3a82b944.plan.md`) phases
A/B/C/E were executed in this build.

## Decision

- Empirical probes before code: `tools: []` persists and means "no tools",
  while an all-unknown list collapses to undefined → default subset at
  discovery; duplicate slugs are last-wins at discovery; the host's
  `ToolApproval` accepts a per-call function, so per-op tiering
  (list/get/status/dump = read; mutate/enable/disable/apply = write) was
  implemented and ADR-005 §Decision 5 amended (appended, original preserved).
- Evidence surface: status/verification pass the host's `PerAdvisorStat`
  through verbatim-but-serialized (model → "provider/id"); `configured`
  dropped; enable returns the roster + no_model guidance.
- Safety: anti-clobber guard (raw-bytes vs parsed-empty check) refuses
  mutates that would overwrite unparsable-but-nonempty files; per-path
  mutate serialization; truthful `persisted`/`fileDeleted` computed from
  pre-save disk existence (an empty save on a nonexistent file persists
  nothing); host `slugifyAdvisorName`/`normalizeToolNames` re-exported so
  matching can never drift from discovery.
- Unified `{ok, tool, op, ...}` JSON envelope across advisor/mode/goal;
  synthetic `{name:"default", implicit:true}` entry for empty effective
  list/get; full agent-facing text rewrite.
- Test integrity: pid-scoped preload isolation root + stale-root sweep;
  real lockfile kill-switch tests; strengthened I2/I3/I5/I6/I10; new I11
  (two live advisors, parallel upserts) and I12 (scripted advisor streams
  via the host's `advisorStreamFn` seam — advise markers steer into the
  primary; `__advisor.<slug>.jsonl` transcripts written; paused advisor
  produces none).

## Output

- `plugin/src/advisor-tool.ts`, `plugin/src/lib/host-bridge.ts`,
  `plugin/src/lib/advisor-native.ts`, `plugin/src/mode-tool.ts`,
  `plugin/src/goal-tool.ts` — evidence surface, guards, envelope, text.
- `plugin/test/setup.ts` + all four test files — integrity repairs and the
  new I11/I12 gates.
- `docs/ssot/adrs/ADR-005-advisor-thin-driver.md` — Decision 5 amendment.
- `.sandbox/rework-notes.md` — handoff for pipeline phases 2 and 3 (probe
  outcomes, exact envelope field names, warning triggers, test counts).

## Verification

- `bun test` (single process, `plugin/`): 118 pass / 0 fail, 597 asserts.
- Per-file spot checks: goal 12/12, mode 22/22, advisor L1 55/55.
- `bunx tsc --noEmit -p .`: zero errors in plugin src/test (ref_repos `.md`
  import errors are known-environmental).
- One truthfulness bug was caught BY the strengthened L3 (bare-default
  upsert claimed `persisted:true` with no file on disk) and fixed in source
  rather than in the test.
