# QOL-004 Implementation Notes

**date**: 2026-08-15
**milestone**: steps 3–8 of `advisor_agent_interface_d5d38882.plan.md`

---

## Files Changed

| File | Role | Status |
|---|---|---|
| `plugin/src/lib/host-bridge.ts` | Added advisor methods to `LiveHostSession`; added `sessionHasAdvisorSurface()` | Modified |
| `plugin/src/lib/advisor-native.ts` | New: thin wrappers for native `advisor/config` helpers + `getAgentDir` / `repo.root` | Created |
| `plugin/src/advisor-tool.ts` | New: `registerAdvisorTool` — 10 ops, ApplyResult, split sanity | Created |
| `plugin/src/lib/settings.ts` | Added `advisorToolEnabled` (default true) | Modified |
| `plugin/package.json` | Added `advisorToolEnabled` setting schema; updated test script | Modified |
| `plugin/src/main.ts` | Registered advisor tool; updated session_start log + qol-config command | Modified |
| `plugin/test/advisor-tool.test.ts` | New: L1 mock tests (at creation: 28 cases, A1–A18 · after 2026-08-15 rework: 55 cases, A1–A25) | Created |
| `plugin/test/advisor-integration.test.ts` | New: L3 real-session tests (at creation: 10 cases, I1–I9 + bridge reach · after 2026-08-15 rework: 14 cases, I1–I12 + bridge reach) | Created |
| `.sandbox/verify-workspace.ts` | Updated L4 to recognize `advisor` tool + 10-op schema check | Modified |
| `.sandbox/e2e-workspace-advisor.ts` | L6 delivery-form e2e: installed omp + real LLM, 6 ops (rework 2026-08-15: rewritten as CRUD + LIVE multi-advisor real-traffic acceptance) | Created |

---

## Rework (2026-08-15)

A 6-model adversarial review (Fable 5 Max / Opus 5 / Grok 4.6 / Gemini 3.7 /
GPT 5.6 Sol / Kimi K3; consolidated in `qol-004_rework_loop_3a82b944.plan.md`)
upheld the user's 不合格 verdict and found this file's own self-grades
inflated. What the review found:

- **No test proved any advisor actually RAN.** `status: "running"` is
  construction-time bookkeeping in the host, not traffic evidence; the L6
  runs below were scripted tool-driven CRUD (a real LLM drives the TOOL, but
  no advisor ever streamed); the roster never reached ≥2 live advisors.
- **The tool discarded the host's evidence fields**: `PerAdvisorStat`
  carries tokens/messages/cost/sessionId, but status/verification only
  passed name/status/model through — "正常运行" was structurally unprovable.
- **Fake passes in the suite** (95/95 was not what it claimed): A9's regex
  had a tautological empty branch; A17 never called the factory; I2/I3/I5/I6
  asserted less than their gate titles; I10 accepted not-paused instead of
  exactly-running.
- **Data-safety holes**: native load silently maps unparsable WATCHDOG.yml
  to an empty doc and an empty save DELETES the file (silent clobber path);
  no mutate serialization (lost updates); untruthful `persisted`/
  `fileDeleted`; blanket `approval: "read"` on ops that write files and
  start billable runtimes.
- **Agent-facing text never holistically reviewed**: IMPLICIT_DEFAULT_NOTE
  taught a call the tool normalizes away, "saved with an empty roster"
  actually meant file deletion, three tools spoke three envelope dialects.

What changed (commit `336d0ab` product/tests/text, `91f670b` L6 harness +
evidence, plus the docs pass you are reading): evidence pass-through
(LiveAdvisorStat incl. tokens/cost/messages/contextTokens/sessionId,
`activeCount`), anti-clobber guard, host slugify reuse, per-path mutate
serialization, truthful `persisted`/`fileDeleted`, per-op approval tiering
(ADR-005 §D5 amended, original preserved), synthetic implicit-default entry,
unified `{ok, tool, op, …}` envelope across advisor/mode/goal, all listed
fake-passes repaired, pid-scoped test isolation roots, NEW I11 (two live
advisors via parallel tool upserts, `activeCount === 2`) + I12
(`advisorStreamFn` scripted streaming with on-disk `__advisor.<slug>.jsonl`
transcripts, paused advisor silent), and the L6 multi-advisor real-traffic
acceptance (§below). Suite grew 95 → 118 tests.

Probe outcomes locked into behavior and text (reviewers had disagreed):

- `tools: []` **persists and means "no tools"** (advisor keeps only
  `advise`); a list of ONLY unknown names collapses to `undefined` at
  discovery → the DEFAULT read/grep/glob subset. The file always keeps the
  written names verbatim; dropping happens at discovery.
- Duplicate same-slug entries in one file: host discovery is **last-wins**;
  the tool aligns (get returns / upsert edits the LAST match; remove deletes
  ALL matching entries and reports the count) and warns on duplicates.
- Host `ToolApproval` accepts a per-call function → **per-op dynamic
  approval is first-class**: list/get/status/dump = `"read"`,
  upsert/remove/set_shared/apply/enable/disable = `"write"`.

Full handoff detail: `.sandbox/rework-notes.md`.

---

## Implementation Decisions

### 1. `sessionHasAdvisorSurface` is independent of `resolveHostBridge` sanity

The existing `resolveHostBridge` sanity gate checks plan/vibe methods. Advisor ops check `sessionHasAdvisorSurface(s)` **separately** inside `execute`. A session that exposes plan/vibe but not advisor methods keeps working for mode ops; only advisor ops return an error. This satisfies ADR-005 §Decision 6 and TDD A10.

### 2. `getAgentDir()` resolves at module load time

`getAgentDir()` from `pi-utils` captures `PI_CODING_AGENT_DIR` when the module is first imported. Setting the env var afterward doesn't propagate. Tests solve this by passing `resolveNative: async () => makeIsolatedNative(agentDir)` — a wrapper that overrides only `nativeGetAgentDir()` while forwarding everything else to the real advisor-native module. This keeps L3 tests using real YAML serialization/discovery without polluting the developer's `~/.omp`.

### 3. Import path for advisor/config

`@oh-my-pi/pi-coding-agent/advisor/config` resolves correctly via:
- tsconfig paths: `@oh-my-pi/pi-coding-agent/*` → `../../../ref_repos/oh-my-pi/packages/coding-agent/src/*`
- At runtime: the `"./*": { "import": "./src/*.ts" }` wildcard in `pi-coding-agent/package.json` covers `./advisor/config`

No `./advisor` barrel barrel export exists; importing the config sub-path directly is the same pattern the TUI uses (confirmed by probe step 2).

### 4. `applyAdvisorConfigs` returns `number` (active count)

While disabled, `applyAdvisorConfigs` stores the configs but returns 0 (no active runtimes). The tool's `verification.activeCount` reflects this. The warning "disabled → runtime=0" is added when `isAdvisorEnabled() === false` after apply.

### 5. `enable`/`disable` have zero native calls

Proven by L1 A4: `setAdvisorEnabled` is called, then the function returns. No `discoverAdvisorConfigs`, no `applyAdvisorConfigs`, no file I/O. Matches TDD requirement and ADR-005 §Decision 3.

### 6. Subdirectory cwd (I8)

`nativeGetProjectDir(cwd)` calls `repo.root(cwd)` which walks up to the git root. Even when `cwd` is a nested subdirectory, the edit path resolves to `<gitRoot>/WATCHDOG.yml`. L3 I8 verifies this with a real temp git repo.

### 7. Structured JSON envelope with `op` on every op (post-e2e fix, 49ea863)

The first L6 use-through showed `enable`/`disable` returning prose only, which
was fragile for both the model and the assertions. All ops now return
parseable JSON containing `op` (plus a one-line human summary where useful),
and the same object is attached as the result `details`. **Design delta,
surfaced here, not silently absorbed**: the design's ApplyResult block
(`qol-004-advisor-tool-design.md` §Track B) and TDD A13 list the shape
without an `op` field; the implementation adds `op` as a strict superset.
Design §Track B "read ops return text plus structured details" is now
literally satisfied. No pillar was touched.

### 8. Implicit "default" advisor is first-class (pillar clarification, 2026-08-15)

User clarification recorded verbatim in the pillar
(`docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md` §用户澄清):
the default advisor the main agent runs under must be visible, configurable,
and toggleable through the tool, exactly like any other advisor in the CLI.

Host facts (not plugin behavior):
- With **zero** configured advisors, `SessionAdvisors#resolveAdvisorRuntimeDescriptors`
  runs one implicit advisor `{ name: "default" }` on the advisor-role model
  (host `session-advisors.ts`, legacy fallback). It lives in **no WATCHDOG file**.
- The TUI configure editor **seeds** a `default` row when the doc is empty
  (`advisor-config.ts #ensureRosterVisible`) and on Save **normalizes** a doc
  that is exactly one bare `default` entry back to `{ advisors: [] }`
  (`#isBareDefaultDoc`), so the implicit default is never shadowed by a no-op
  file entry.

Correction to earlier sections of this file: the e2e `default`
(`kimi-code/k3`) was previously described as a "user-scope advisor" — wrong.
No user WATCHDOG exists; it is this implicit legacy fallback. The L6 tables
below have been corrected accordingly (marked, not silently rewritten).

Plugin changes (thin-driver compliant — both mirror existing TUI behavior):
- `list`/`get` `scope=effective` with an empty merge now annotate the body
  (`implicitDefault: true` + note) so the model can *see* the implicit default
  and knows the ops that manage it (`status` live view; `upsert name="default"`
  materializes; `remove` restores; `enable`/`disable` global).
- Mutate save now mirrors the TUI bare-default normalization: a doc reduced to
  one bare `default` entry is saved as an empty roster, with an explicit
  warning in the result; the misleading shadow warning is skipped in that case.
- Tool description documents the implicit-default semantics.

CLI-parity map for the default advisor (all proven at L3 I10 + L6):
- see: `status` (live stats include `default` with status/model) — CLI `/advisor status`.
- configure: `upsert name="default" …` (model/tools/instructions overrides) — CLI configure editor row.
- pause only it: `upsert name="default" enabled=false` → status `paused` — CLI configure enabled toggle.
- restore implicit: `remove name="default"` — CLI configure delete/bare-row Save.
- global toggle: `enable`/`disable` — CLI `/advisor on|off`.

---

## Test Results

| Level | File | Pass | Fail |
|---|---|---|---|
| L1 | `advisor-tool.test.ts` (A1–A25) | 55 | 0 |
| L3 | `advisor-integration.test.ts` (I1–I12 + bridge) | 14 | 0 |
| Regression | `goal-tool` 12 + `mode-tool` 22 + `host-bridge` 8 + `integration-real-session` 7 | 49 | 0 |
| **Total** | single-process `bun test` | **118** | **0** |

> Count history (kept explicit, not silently rewritten): at the original
> milestone this table read 95/95 (34 L1 A1–A19 + 12 L3 I1–I10 + 49
> regression). The 2026-08-15 rework (commit `336d0ab`) repaired the fake
> passes listed in §Rework and added A20–A25 / I11–I12; the suite is now
> **118 pass / 0 fail, 597 expect() calls across 6 files** — re-verified by
> a fresh single-process `bun test` run during the 2026-08-15 docs pass.

> Correction (2026-08-15 review): an earlier version of this table claimed
> "47 regression / 85 total" — that arithmetic was wrong. `host-bridge` H1 was
> observed to be flaky under load (host self-import can exceed bun's default
> 5s per-test timeout); H1 now carries an explicit 30s timeout with an
> unchanged assertion. `bun run typecheck` is not usable in the
> junction/tsconfig-paths setup: all tsc errors come from the host repo's
> `.md` string imports (bun-loader feature); plugin `src/` + `test/` have
> zero type errors.

> Test-infra fix (2026-08-15, implicit-default session): a bare single-process
> `bun test` had **never** been green — the kill-switch tests (goal D2, mode
> N12a) redirect `PI_CONFIG_DIR` in `beforeAll`, but the host's pi-utils
> `DirResolver` freezes the config root at first module load, and the advisor
> test files statically import host packages before any hook runs. The old
> `package.json` test script masked this by running each file in its own
> process. Fixed with a bun test preload (`test/setup.ts` + `bunfig.toml`)
> that freezes `PI_CONFIG_DIR=.omp-qol-test-root` before any import; the
> kill-switch tests write their lockfile into that root; the test script is
> now a plain `bun test`. Verified green both single-process and per-file.
> (Rework 2026-08-15: the preload root is now **pid-scoped**
> `~/.omp-qol-test-root-<pid>` with a stale-root sweep at preload —
> concurrent `bun test` processes previously shared one root and could
> delete each other's state, a 6/6-reviewer finding.)

### Foundation gate coverage (F1–F8)

> **Re-grade (2026-08-15 rework), both facts on record**: the original
> version of this table graded F2/F3/F5/F6 as PASS on assertions weaker than
> their gate titles (I2/I3/I5/I6 did not actually check live-apply effects,
> runtime replacement, enable-starts-latest, or the unknown-tool semantics —
> "部分验证" at best; the grades were inflated). The 6-model review called
> this out; commit `336d0ab` strengthened those cases and added I11/I12, and
> run `20260815-164307` added real-traffic acceptance. The grades below are
> the CURRENT, evidence-backed state with the history explicit per row.

| # | Gate | Cases | Status |
|---|---|---|---|
| F1 | Parse/list user/project/effective | A5, I1 | PASS |
| F2 | Upsert while enabled; live apply without session restart | I2 (strengthened: `isAdvisorActive`, stats containment, exact `"running"`, envelope verification) + I11 + L6 | PASS — original grade inflated (weak I2); re-proven 2026-08-15 |
| F3 | Change model/instructions; old runtime replaced | I3 (strengthened: real haiku→sonnet runtime replacement, exactly one stats entry, file has one entry) | PASS — original grade inflated (weak I3); re-proven 2026-08-15 |
| F4 | Remove project entry; user resurfaces | I4 | PASS |
| F5 | Mutate while disabled; file persists; enable starts latest | A14, I5 (strengthened: `effectiveAt:"stored"`, `activeCount:0` while disabled → enable → exact `"running"` + enable-envelope roster) | PASS — original grade inflated (weak I5); re-proven 2026-08-15 |
| F6 | Unknown tool; existing roster untouched | A8, A22, I6 (strengthened: probed all-unknown→default-subset fallback warning, verbatim persistence, both live advisors stay `"running"`) | PASS — original grade inflated (weak I6); re-proven 2026-08-15 |
| F7 | File survives new session | I7 | PASS |
| F8 | Real-LLM use-through (optional) | (a) scripted tool-driven CRUD runs (§below — relabeled; a real LLM drives the TOOL, but no advisor runtime evidence) · (b) **L6 multi-advisor real-traffic acceptance, run `20260815-164307`** (§below — the genuine use-through) | PASS 2026-08-15 — (b) carries the grade |

### L6 delivery-form use-through (2026-08-15) — scripted tool-driven CRUD

> Relabel (2026-08-15 rework): this run and the two below were originally
> presented as THE real-LLM e2e. Honest label: **scripted tool-driven
> CRUD** — a real LLM calls the advisor TOOL step by step, which proves the
> delivery form and the op surface, but produces NO evidence that any
> advisor runtime ran (no tokens, no advisor messages, roster never ≥2).
> The genuine use-through is the multi-advisor real-traffic acceptance
> further below.

This is the path that was missing from the first impl report. It is **not** L1/L3.

- **Host**: installed `omp` (`C:\Users\15480\.bun\bin\omp.exe`), `--mode rpc`
- **Workspace**: throwaway git repo under `.sandbox/scratch/e2e-advisor-ws-*` (gitignored). `repo.root()` therefore does not resolve to omp-qol. Project `WATCHDOG.yml` stayed in scratch; no write to developer `~/.omp`.
- **Model**: `zai/glm-4.5-flash` (live `get_available_models` → ranked cheap pool; first cursor-nano attempt earlier in the session failed with `Connect error not_found` and never called the tool)
- **Driver**: the model was prompted to call `advisor` exactly once per turn. Assertions are on `tool_execution_end` text, not on the model's chat reply.
- **Result**: **6/6 PASS**, `isError=false` on every step. Wall time ~245s.

| Step | op | What actually happened |
|---|---|---|
| 1 | `status` | Host was running the **implicit legacy `default` advisor** (`kimi-code/k3`; corrected 2026-08-15 — previously misdescribed as "user-scope": no user WATCHDOG exists, see Decision 8). Tool returned structured `{ "op": "status", "enabled": true, "active": true, "configured": true, "advisors": [{ "name": "default", "status": "running", "model": "kimi-code/k3" }] }`. |
| 2 | `enable` | Returned structured `{ "op": "enable", "enabled": true, "active": true, "running": true, "discovered": false }`. Obeyed ADR-005 D3 (no discover). |
| 3 | `upsert` name=`E2EReviewer` | `persisted: true`, `applied: true`, `effectiveAt: immediate`. `op: "upsert"`, `activeCount: 1`, `advisors: [{ name: "E2EReviewer", status: "running" }]`. Source = scratch `WATCHDOG.yml`, not `~/.omp`. |
| 4 | `list` scope=`effective` | Returned structured `{ "op": "list", "scope": "effective", "advisors": [{ "name": "E2EReviewer", "instructions": "Watch for regressions in this e2e session." }] }`. |
| 5 | `remove` name=`E2EReviewer` | `persisted: true`, `applied: true`, `op: "remove"`. Implicit legacy `default` advisor resurfaced in active roster (`activeCount: 1`; corrected 2026-08-15, see Decision 8). |
| 6 | `disable` | Returned structured `{ "op": "disable", "enabled": false, "active": false, "running": false, "discovered": false }`. |

First-attempt gaps (so this is not silently rewritten as “always green”):
- Cursor `gpt-5.4-nano-high` was a dead model (`not_found`); the turn ended with **zero** `advisor` calls. That is not a use-through.
- An intermediate run called `enable` successfully (`Advisor enabled. … enabled=true active=true`) but the harness regex looked for JSON `"enabled": true` and falsely failed. The tool itself worked.
- `remove` once matched against the outer stringified RPC frame (`\"persisted\": true`) and falsely failed; the tool had already persisted. Matcher now reads `result.content[].text`.

### Review rerun (2026-08-15, post-49ea863)

An independent review rerun (fresh `install-plugin` → L4 → L6) reproduced
**6/6 PASS** on `zai/glm-4.5-flash` with the harness now printing the
complete, untruncated text of every `tool_execution_end`. This closed two
evidence gaps of the earlier report:
- the earlier console truncated results at 280 chars, so `remove`'s
  verification block was partially inferred; the full rerun evidence shows
  `remove` → `activeCount: 1` with the implicit legacy `default`
  (`kimi-code/k3`; corrected 2026-08-15, see Decision 8) back in the live
  roster;
- `upsert`'s live verification shows `E2EReviewer` running with the
  advisor-role default model resolved (`kimi-code/k3`).

Harness fixes made during review (all in the strict direction):
- upsert step now requires `"persisted": true` and `"applied": true`, not
  just the advisor name;
- after a mid-run model switch the harness resumes at the CURRENT step
  (previously it re-sent step 1's prompt while asserting the current
  step's expectation — a latent false-FAIL bug);
- transient-error regex uses word boundaries for 401/403 so token counts
  like "4403" cannot trigger a spurious model switch;
- old scratch dirs are cleaned up best-effort; processes not spawned by
  the script are never touched.

Honest scope statement: this run drove 6 of 10 ops through a real LLM
(`status`, `enable`, `upsert`, `list`, `remove`, `disable`). (Rework
2026-08-15: the multi-advisor acceptance run below also drives `dump`,
bringing real-LLM coverage to 7 of 10; `get`, `set_shared`, `apply` remain
covered at L1+L3 only — consistent with the TDD, which gates this milestone
on L1+L3+L4 and marks L6 as optional/Foundation F8.)

### L6 rerun with implicit-default lifecycle (2026-08-15, 9 steps) — scripted tool-driven CRUD

After Decision 8's changes, the e2e sequence was extended to prove the
pillar clarification end-to-end on `zai/glm-4.5-flash` (fresh scratch
workspace, fresh plugin copy): **9/9 PASS**, full untruncated evidence.

| Step | op | What actually happened |
|---|---|---|
| 6 | `status` (roster empty again) | Implicit `default` visible live: `advisors: [{ "name": "default", "status": "running", "model": "kimi-code/k3" }]`. |
| 7 | `upsert` name=`default` enabled=false | `persisted: true`, `applied: true`, verification `advisors: [{ "name": "default", "status": "paused" }]`, `activeCount: 0` — the default alone paused while the advisor system stays enabled. |
| 8 | `remove` name=`default` | `persisted: true`; verification shows implicit `default` back to `running` (`activeCount: 1`) — implicit restored. |
| 9 | `disable` | `enabled: false, active: false` — global toggle unchanged. |

(Steps 1–5 identical to the earlier table.) First attempt of this run
timed out at step 8's **turn end**: the model stalled echoing the full
ApplyResult JSON back as its chat reply. Harness fixes (assertions
untouched): the reply instruction now asks for a one-word `DONE` (the
assertions run on `tool_execution_end` frames, never on the reply), and
the global timeout is 720s for 9 steps. Rerun passed 9/9.

### L6 multi-advisor real-traffic acceptance (2026-08-15, run `20260815-164307`) — the genuine use-through

The user's acceptance bar (recorded verbatim in the pillar): 真实模型 +
多个 advisor 均正常运行, graded per the Built→Fed→Streamed evidence ladder.
The scripted CRUD runs above cannot satisfy it; this run does (rework plan
phase D, commit `91f670b`). **Verdict: PASS** (first full run, exit 0,
~182 s).

- Harness: `.sandbox/e2e-workspace-advisor.ts`, rewritten into CRUD + LIVE
  sections, each with its own spawned installed-omp process and throwaway
  git workspace.
- **Isolated config root** (`PI_CONFIG_DIR` → scratch): ONLY
  credential/model-registry material copied from `~/.omp/agent`; user
  config/WATCHDOG/sessions never copied (`isolation-manifest.json`); 401
  models resolved inside the isolated root, NO fallback taken;
  `modelRoles.advisor` pinned to an unresolvable selector so the host's
  implicit default could not leak expensive traffic in.
- CRUD lifecycle **9/9** green under the unified `{ok, tool, op, …}`
  envelope; every mutate's `source` asserted INSIDE the scratch workspace
  (production repo-root `WATCHDOG.yml` untouched, mtime predates the run).
- Advisors created via the TOOL only: Alpha `zai/glm-4.5-air`, Beta
  `deepseek/deepseek-v4-flash` (distinct providers), Gamma paused control
  (`enabled: false`). Primary model `zai/glm-4.5-air`, one real PING turn.
- **Per-advisor deltas** (baseline asserted all-zero first):
  - Alpha: assistant 0→6, tokens 0→28 097, cost $0.003796 — Built ✓ Fed ✓ Streamed ✓
  - Beta: assistant 0→3, tokens 0→11 442, cost $0.000623 — Built ✓ Fed ✓ Streamed ✓
  - Gamma (paused): all-zero throughout, NO transcript file — negative control ✓
- On-disk `__advisor.alpha.jsonl` + `__advisor.beta.jsonl` transcripts with
  assistant records; `op=dump` history names both advisors.
- Post-hoc reviewable artifacts:
  `.sandbox/e2e-artifacts/run-20260815-164307/` — `EVIDENCE.md` index,
  per-step envelopes, baseline/post `op=status` JSONs, transcripts, final
  scratch WATCHDOG.yml, `verdict.json` (the two >1 MB raw frame logs stay
  working-tree only by size policy).
- Final-tree confirmation: the harness was rerun once more during the
  2026-08-15 docs pass (Phase 3) on the finished tree — see the run
  artifacts dir recorded in the phase-005 journal entry.

---

## SSOT Amend Decision

Evidence gathered:
- L3 I2 confirms TUI Save is live apply (no restart needed) — confirms what Foundation already knew.
- L3 I5 confirms `enable` does NOT call discover — matches ADR-005 §D3.
- Probe (step 2, prior session) confirmed `applyAdvisorConfigs` is on the real `AgentSession`.

The pillar `docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md` has the phrase "特殊内置 subagent" which ADR-005 notes stands side-by-side with the code fact (advisor is a bypass observer, not a task target). **No amend made**: ADR-005 already documents the coexistence; there is no false claim to correct and no silently rewriting the pillar is warranted.

## Amendment (2026-08-15): L4 / L6 install path

L4 `verify-workspace` and L6 `e2e-workspace-advisor` no longer refresh a project-scoped copy under `test-workspace/.omp/plugins`. Default install for those harnesses is isolated `omp plugin install omp-qol-plugin`. Historical L4/L6 evidence above still describes the old copier; it is not silently rewritten. Live test-workspace was not reinstalled in this amendment.
