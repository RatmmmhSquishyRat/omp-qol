# Phase 005: Docs truth pass, pillar restoration, final verification & push

**commit**: _(filled by the mapping commit)_
**date**: 2026-08-15

## Problem / Background

Rework plan `qol-004_rework_loop_3a82b944.plan.md` phase F (文档求真与收尾).
After build phases 1–2 landed the product/test rework (`336d0ab`) and the L6
multi-advisor real-traffic acceptance (`91f670b`), the documentation still
told the OLD story: `qol-004-impl-notes.md` graded F2/F3/F5/F6 as clean
PASSes on assertions the 6-model review had shown to be weaker than their
gate titles, carried stale counts (95 tests, "28 cases A1–A18", "10 cases
I1–I9"), and presented the scripted CRUD e2e as THE real-LLM evidence.
`plugin/README.md` / `package.json` did not mention QOL-004 at all. The
working tree carried an uncommitted edit to the pillar
`advisor-watchdog.md` that deleted two "啊" from the user's verbatim quote
(a pillar-verbatim violation, flagged by the phase-2 worker). Session logs
002/003 were written as if separate conversations, breaking the
one-conversation-one-log protocol. And the test-workspace project anchor
had never been safety-checked against the production repo-root
`WATCHDOG.yml`.

## Decision

- **Truth over tidiness**: every re-grade states BOTH facts — the original
  grade was inflated AND the rework closed the gap — with the evidence
  (strengthened I2/I3/I5/I6, new I11/I12, L6 run `20260815-164307`).
  History is kept explicit (correction blockquotes), never silently
  rewritten.
- **F8 split**: the scripted runs are relabeled "scripted tool-driven CRUD"
  (a real LLM drives the TOOL — no advisor runtime evidence); the L6
  multi-advisor real-traffic acceptance is recorded as the genuine
  use-through and carries the grade.
- **Pillar handling**: `git restore` of the drifted file (the deletion of
  the two "啊" was the ONLY working-tree change, verified via `git diff`),
  then the user's 2026-08-15 acceptance verdict (不合格 → rework) appended
  verbatim as a second clarification with a one-line scope note
  (acceptance bar = 真实模型 + 多个 advisor 均正常运行, Built→Fed→Streamed).
  The incident is recorded openly in session-001 Turn 11.
- **Session-log reconciliation with minimal churn**: session-001 gains
  Turn 10 (user verdict + 6-model review + approved plan) and Turn 11
  (three-phase parallel build summary); session-002/003 stay as build-phase
  detail logs with a one-line subordination pointer at the top (not
  deleted, not renumbered).
- **test-workspace anchor**: probed read-only with the exact resolution
  chain the tool uses (`repo.root(cwd) ?? cwd` →
  `resolveAdvisorConfigEditPath`). Finding documented as a hazard rather
  than papered over (below); no unilateral `git init` — whether
  test-workspace sessions SHOULD see the repo's advisors is a user-domain
  decision.

## Output

- `docs/plans/impls/qol-004-impl-notes.md` — new "Rework (2026-08-15)"
  section (review findings, what changed, probe outcomes: `tools: []` =
  "no tools" vs all-unknown → default subset; duplicate slugs last-wins;
  per-op dynamic approval); F-gate table re-graded with per-row history;
  F8 split; new L6 acceptance section (run `20260815-164307`: Alpha
  assistant 0→6 / tokens 0→28 097 / $0.003796, Beta 0→3 / 0→11 442 /
  $0.000623, Gamma paused all-zero, artifacts under
  `.sandbox/e2e-artifacts/run-20260815-164307/`); counts corrected to the
  verified 118/597.
- `plugin/README.md` — QOL-004 section (ops, envelope, approval tiers,
  implicit default, safety warnings), layout/settings/verify updates;
  `plugin/package.json` description now names the advisor tool.
- `docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md` —
  verbatim quote restored (both "啊"); second user clarification appended
  (2026-08-15 verdict, verbatim, blockquoted) + scope note. Existing prose
  untouched.
- `docs/dev/session-logs/session-001.md` Turns 10–11;
  pointer notes atop `session-002.md` / `session-003.md`.
- This journal entry.

## Verification

- **test-workspace anchor (SAFETY FINDING)**: `test-workspace/` has NO
  `.git` of its own → `repo.root()` resolves to the omp-qol repo root, so
  a project-scope advisor mutate from an omp session launched inside
  test-workspace (or `demo-mini-app/`) targets the PRODUCTION
  `C:\...\omp-qol\WATCHDOG.yml` (6 advisors). Probe output (read-only):
  `cwd=...\test-workspace → projectEditPath=...\omp-qol\WATCHDOG.yml`.
  This is the host's own anchoring semantics (the TUI resolves the same
  way), not a plugin defect — but it means: NEVER run project-scope
  advisor write ops from test-workspace sessions; use git-init'd scratch
  workspaces (all e2e harnesses already do exactly that).
- Plugin reinstalled into test-workspace via `bun .sandbox/install-plugin.ts`
  (the same installer prior sessions used): `git diff --no-index` between
  `plugin/src` / `package.json` and the installed cache copy is EMPTY, and
  the rework-era string ("unattended mutation power") is present in the
  installed `advisor-tool.ts`.
- `bun test` (single process, `plugin/`): **118 pass / 0 fail**, 597
  expect() calls across 6 files.
- `bunx tsc --noEmit -p plugin`: zero errors in plugin src/test (ref_repos
  `.md` import errors remain known-environmental).
- L6 harness rerun on the final tree: run `20260815-170912` — **PASS**
  (exit 0, first attempt, ~133 s; CRUD 9/9; Alpha `zai/glm-4.5-air`
  assistant 0→3 / tokens 0→11 500 / $0.001616, Beta
  `deepseek/deepseek-v4-flash` assistant 0→3 / tokens 0→11 595 /
  $0.000128, Gamma paused all-zero with no transcript; isolated root, no
  fallback; artifacts `.sandbox/e2e-artifacts/run-20260815-170912/`,
  >1 MB raw frame logs kept untracked by size policy).
- All accumulated rework commits pushed to `origin/master`
  (`336d0ab`, `8feb59a`, `91f670b`, `bb88788`, plus this phase's commits).
