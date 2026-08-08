# TDD: QOL-002/003 Agent Mode Tool Tests

> 本文为**单元用例清单**。交付级分层测试金字塔(L1 单元 → L5 真实 LLM e2e,
> 含真实会话集成与缺陷捕获记录)见同目录 `qol-delivery-test-plan.md`。

Depends on: `docs/plans/designs/qol-002-003-agent-mode-control-design.md`
Harness: `repos/omp-qol-extension/test/mode-tool.test.ts` (bun test)

## Levels

- L1–L4: offline controller semantics on a mock ExtensionAPI.
- L5: live wiring — RPC `dumpTools` must list `mode` (marker `[qol]`);
  `--no-extensions` control run must not; provider payload must include it.

## Offline cases

| #   | Case                                                            | Expectation |
| --- | --------------------------------------------------------------- | ----------- |
| M1  | `plan_enter` fresh session                                       | ok result, entry `{mode:"plan"}` persisted, instructions text |
| M2  | plan-active guard matrix: `write src/a.ts` / `ast_edit src/a.ts` / `write PLAN.md` / `write docs/x-plan.md` / `write local://PLAN.md` / `bash` / `read` | blocked, blocked, allowed, allowed, allowed, allowed, allowed; block reason mentions plan mode |
| M3  | `plan_exit` then `write src/a.ts`                                | exit ok + entry `{mode:null}`; subsequent write NOT blocked |
| M4  | transitions: double plan_enter; plan_enter during vibe; vibe_enter during plan; plan_exit without mode; vibe_exit without mode | all `isError: true` with specific messages |
| M5  | `vibe_enter` snapshots then applies director set; `vibe_exit` restores snapshot (filtered to registry) | active tools swap + restore |
| M6  | goal exclusion: `goal_updated` {active} blocks plan/vibe enter; `{complete}` / `{dropped}` / `{goal:null}` re-allows | error then ok |
| M7  | rebuild: `session_start` with branch entries `com.omp-qol.mode` → plan re-arms guard; vibe re-applies director set; `{mode:null}` entry keeps everything off | guard/director behavior after rebuild |
| M8  | `before_agent_start` returns hidden reminder while plan/vibe active, nothing otherwise | customType qol-plan-mode-context / qol-vibe-mode-context / none |
| M9  | registration shape: name `mode`, label, `loadMode: "essential"`, `approval: "read"`, op enum of 5 | all asserted |

## Edge-case notes

- Controller state is per-factory closure: a second mock instance starts clean.
- Guard never fires for tools other than write/ast_edit even in plan mode.
- Restore filters snapshot against current registry (dead names dropped).
- Persist failures must not break transitions (logger.warn path only).

## Results

- 2026-08-05 run: **18/18 pass** (M1–M10 matrix, incl. M5b/M7a–c/M9b–e),
  `bun test` total 30/30 with the goal suite.
- L5 live: RPC `dumpTools` 13 tools incl. `mode` with `[qol]` marker; control
  11 tools clean; kill-switch round trip (`modeToolEnabled` false→true)
  verified; doctor clean at v0.2.0. See `docs/plans/impls/qol-002-003-impl-notes.md`.

## v2 addendum — native backend cases (post host-bridge discovery)

| #   | Case | Expectation |
| --- | ---- | ----------- |
| N1  | plan_enter on fake live session | native sequence fired: state set, proposal handler, `appendModeChange:plan`, no emulation entry |
| N2  | guards: plan-on / vibe-on / goal-active | all refused with specific messages |
| N3  | plan_exit clears state/handler, persists none; second exit errors | as stated |
| N4  | vibe_enter installs native vibe toolset + scope + state | active = read(+todo)+vibe_*; ownerScope/activateScope called |
| N5  | vibe_exit kills workers, restores tools, clears state | `killed 2` text; killAll; restore |
| N6  | status reports bridge + live states | native host bridge / plan / goal lines |
| N7  | vibe_enter with null registry | refused ("registry is unavailable") |
| N8  | bridge loss mid-session | falls back to emulation (entry persisted) |

- 2026-08-05 v2 run: **38/38** (files run serially; see impl notes for the
  `PI_CONFIG_DIR` parallel-flap incident). Live WRITE-PROOF on source host:
  plan state round-trip + vibe toolset install/restore succeeded.
- Live re-check: dumpTools PASS on installed AND source-link hosts
  (`OMP_SOURCE_CLI`), controls clean.

## v3 final — thin driver (ADR-004): emulation suites removed

M1–M10 (emulation) deleted with the emulation backend. Final suite N1–N12:

| #    | Case |
| ---- | ---- |
| N1/N1b/N1c | plan_enter ACP-shaped state + proposal handler; idempotent re-enter + path/workflow preservation + reentry flag; `plan.enabled=false` gate |
| N2   | plan_enter blocked by live vibe/goal state |
| N3   | plan_exit clears handler+state; exit-without-plan errors |
| N4   | vibe_enter: scope activation + native vibe toolset + state |
| N5   | vibe_exit: killAll(2) + toolset restore + state clear |
| N6   | mutual exclusion both directions + idempotent vibe re-enter |
| N7   | vibe_enter without registry refused |
| N8   | status reads live host state verbatim |
| N9   | no bridge -> honest error for every op (nothing emulated) |
| N10  | pre-aborted signal cancels |
| N11  | registration shape + op enum |
| N12a/b | factory kill switch (`modeToolEnabled`) via isolated lockfile |

- 2026-08-05 v3 run: **27/27** (goal 12 + mode 15). Live: dumpTools PASS ×4
  (installed/source × qol/control); doctor clean.
