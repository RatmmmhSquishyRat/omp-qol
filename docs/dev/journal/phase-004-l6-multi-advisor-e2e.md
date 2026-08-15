# Phase 004: L6 multi-advisor real-traffic e2e acceptance

**commit**: `91f670b` `test: land L6 multi-advisor real-traffic e2e with isolated-root evidence`
**date**: 2026-08-15

## Problem / Background

Plan QOL-004 phase D (todo "L6 双 advisor 双模型真实流量验收") required a
user-acceptance line beyond the mocked suite: prove through an INSTALLED
omp with REAL model traffic that two advisors created via the advisor tool
independently get Built → Fed → Streamed, while a paused advisor stays
silent. The prior harness asserted the OLD pre-envelope output shapes, its
9/9 "evidence" was not post-hoc reviewable, and a naive run on the dev
machine would leak the user's ~/.omp WATCHDOG/advisor-role defaults (or,
with a blank config root, resolve zero models and be worthless).

## Decision

- One harness (`.sandbox/e2e-workspace-advisor.ts`), two sections, each in
  its own spawned omp + throwaway git workspace: CRUD (scripted lifecycle,
  envelope-asserted) and LIVE (multi-advisor real traffic).
- Isolate via `PI_CONFIG_DIR` (a homedir-relative dir NAME): copy ONLY
  credential/model-registry files from `~/.omp/agent`; generate a scratch
  `config.yml` pinning `modelRoles.advisor` to an unresolvable selector
  (an unset role falls back to the expensive "slow" chain) and setting
  `advisor.syncBacklog: "1"`. Keep a real-root fallback path that overlays
  a project-scope neutralization config — recorded in evidence if used.
- Zero-baseline hygiene: request `enable` + `status` in ONE primary turn
  (advisors only receive a turn after it ends), with an apply+status
  re-baseline as the single repair path.
- Persist everything to a timestamped `.sandbox/e2e-artifacts/run-*/` dir:
  raw RPC frames, per-step envelopes, baseline/post status JSONs, dump,
  advisor transcripts, final scratch WATCHDOG.yml, isolation manifest,
  EVIDENCE.md + verdict.json. Exit contract: 0 pass · 1 fail · 2 harness
  error · 3 inconclusive (missing credentials/quota never claim pass).

## Output

- Rewritten harness (~1340 lines): OmpRpc frame pump, model ranking with
  provider diversity + 404-blocklist, transient-error primary rotation,
  spawned-process kill registry, EBUSY-tolerant scratch cleanup, debug skip
  flags forced INCONCLUSIVE.
- Run `20260815-164307`: **PASS**, first full run, ~182 s total. CRUD 9/9
  under the unified envelope. Alpha (`zai/glm-4.5-air`) baseline 0 → post
  assistant=6, tokens=28 097, $0.0038; Beta (`deepseek/deepseek-v4-flash`)
  baseline 0 → post assistant=3, tokens=11 442, $0.0006; Gamma paused
  all-zero, no transcript. Isolation held: 401 models resolved in the
  scratch root, no fallback taken.
- Curated evidence committed (31 files); the two >1 MB raw frame logs stay
  working-tree only. Phase 2 / L6 handoff appended to
  `.sandbox/rework-notes.md`.

## Verification

- Harness run exit 0 with all assertions strict (no weakening); repo-root
  `WATCHDOG.yml` untouched (mtime predates run); isolated root deleted on
  success.
- `bun test` in plugin/: 118 pass / 0 fail. Harness `bunx tsc --noEmit`
  clean. No product code changed in this phase; no product issues found.
