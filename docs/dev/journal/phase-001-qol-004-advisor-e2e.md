# Phase 001: QOL-004 advisor L6 use-through

**commit**: `475dfbd`, `49ea863` `fix: standardize advisor tool structured JSON outputs and enforce strict e2e assertions`
**date**: 2026-08-15

## Problem / Background

QOL-004 implementation (`dda148b`) shipped L1/L3/L4 only. The impl-notes F8 row said `not run`. The author asked whether a real installed-omp + LLM use-through had been done; it had not.

## Decision

Run delivery-form e2e in an isolated scratch git repo (not `test-workspace`, not omp-qol root, not `~/.omp`). Drive the live `advisor` tool through a real model: status → enable → upsert → list → remove → disable. Record the actual tool texts. Do not kill unrelated `omp` processes.

## Output

- `.sandbox/e2e-workspace-advisor.ts`
- F8 evidence in `docs/plans/impls/qol-004-impl-notes.md`

## Verification

`bun .sandbox/e2e-workspace-advisor.ts` → **PASS** (2026-08-15).

- model: `zai/glm-4.5-flash`
- 6/6 `advisor` `tool_execution_end` frames, `isError=false`
- upsert/remove `source` = scratch `WATCHDOG.yml`
- first cursor-nano attempt was not a use-through (`not_found`, zero tool calls)

Review rerun (`078f686`, same day): fresh install-plugin → L4 PASS → L6
6/6 PASS with full untruncated evidence; `remove` verified to resurface
user-scope `default` (`activeCount: 1`). Full suite corrected to 87 pass
(the earlier "85/47" was miscounted); flaky H1 given an explicit 30s
timeout; harness matchers tightened (upsert requires persisted+applied).
