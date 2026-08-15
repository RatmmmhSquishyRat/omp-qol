# TDD: QOL-004 Advisor Tool Tests

> 本文为**用例清单**。分层金字塔定义见同目录 `qol-delivery-test-plan.md`
> （L1 逻辑单元 → L6 真实 LLM e2e）。QOL-004 本里程碑门禁是 **L1 + L3 + L4**；
> Foundation 第 8 条（真实模型自主配置）挂 L6，可选。

Depends on: `docs/plans/designs/qol-004-advisor-tool-design.md`,
`docs/ssot/adrs/ADR-005-advisor-thin-driver.md`,
Foundation `06-ADVISOR-WATCHDOG.md` Test plan §1–8.

Harness:

- L1: `plugin/test/advisor-tool.test.ts` — mock native helpers + fake
  `LiveHostSession` (bun test).
- L3: `plugin/test/advisor-integration.test.ts` — real `AgentSession` +
  temporary WATCHDOG (recipe: existing `integration-real-session.test.ts`).
- L4: `.sandbox/verify-workspace.ts` — RPC `dumpTools` recognizes `advisor`.

## Isolation (hard)

README "Never write to the global `~/.omp`" is a **test/ops** rule, not a
product ban on `scope=user`. Every QOL-004 test:

- sets `PI_CONFIG_DIR` to a temp basename (same pattern as goal/mode
  kill-switch suites; share one testRoot if files run in one process);
- uses a temporary `agentDir` / project dir for all `WATCHDOG.yml` writes;
- never writes the developer's real `~/.omp` or real user-agent WATCHDOG.

L4 `verify-workspace` uses an isolated official npm install
(`--isolated-root .omp-qol-*`, never live `~/.omp` or
`test-workspace/.omp`). Advisor user-scope L3 cases still use the temp
`agentDir`, not the developer home.

## Levels (this milestone)

| Level | What it proves | QOL-004 harness |
|---|---|---|
| L1 | Tool routes to native helpers / session methods; default project; auto-apply; enable ≠ discover; honest errors | mock |
| L3 | Entry is wired to a real `AgentSession`; Foundation gates 1–7 that can be automated | real session + temp files |
| L4 | Model-visible schema: `advisor` in `dumpTools`, ten ops, `[qol]` marker; control run absent | `verify-workspace` |
| L2 | Host-bridge advisor sanity is independent of plan/vibe (extend H3-class cases if needed) | optional add-on to `host-bridge.test.ts` |
| L5/L6 | Real model creates / inspects / removes an advisor | Foundation §8; optional |

## Foundation test gates

Map of `06-ADVISOR-WATCHDOG.md` "Test plan" → layer. Automate 1–7 on L3;
keep 8 as optional L6.

| # | Foundation gate | Layer | Case ids |
|---|---|---|---|
| F1 | Parse/list current user / project / effective rosters | L1 + L3 | A5, I1 |
| F2 | Upsert project advisor while advisor enabled; runtime appears without restart | L3 | I2 |
| F3 | Change model / instructions / tools; old runtime replaced; verification shows new values | L3 | I3 |
| F4 | Remove project same-name item; user-scope advisor resurfaces in effective (native merge) | L3 | I4 |
| F5 | Mutate while disabled: file persists, runtime stays off; enable then starts latest roster | L3 | I5 |
| F6 | Invalid model / tool / config: warning or failure; existing live roster not corrupted | L1 + L3 | A8, I6 |
| F7 | Branch / resume / new session: scope persistence + session enable semantics | L3 | I7 |
| F8 | Real LLM e2e: agent decides to create an advisor, uses it, inspects / removes | L6 optional | E2E-advisor |

---

## L1 — Offline unit matrix (mock)

Fake: `loadWatchdogConfigFile` / `saveWatchdogConfigFile` /
`discoverAdvisorConfigs` / `resolveAdvisorConfigEditPath` as call
recorders; fake session with `applyAdvisorConfigs`, `setAdvisorEnabled`,
`isAdvisorEnabled`, `isAdvisorActive`, `getAdvisorStats`,
`formatAdvisorStatus`, `formatAdvisorHistoryAsText`. No real YAML, no
real `SessionAdvisors`.

### Delegation / pairing

| # | Case | Expectation |
|---|---|---|
| A1 | `upsert` name+fields, no `scope` | `resolve` + `load` + `save` + `discover` + `applyAdvisorConfigs` in that order; scope dirs use **project**; `setAdvisorEnabled` **not** called |
| A2 | `remove` / `set_shared` | same pairing; `set_shared` writes top-level instructions then discover+apply |
| A3 | `apply` | `discover` + `applyAdvisorConfigs` only; `save` not called; `persisted=false`, `applied=true` |
| A4 | `enable` / `disable` | `setAdvisorEnabled(true\|false)` only; `discover` / `save` / `applyAdvisorConfigs` call counts stay 0 |
| A5 | `list`/`get` `scope=project\|user\|effective` | project/user → `load` of that edit path; effective → `discover` only (no save/apply) |
| A6 | `status` / `dump` | `formatAdvisorStatus` / `formatAdvisorHistoryAsText`; dump `raw=true` → `{ compact: false }` |

### Defaults and refusals

| # | Case | Expectation |
|---|---|---|
| A7 | mutate with `scope=user` | user edit path used; still save→discover→apply |
| A8 | mutate with `scope=effective` or unknown op / missing `name` | `isError`; no save |
| A9 | no bridge / session null | honest error; no throw out of `execute`; mentions `/advisor` or live session |
| A10 | session present, advisor methods missing | advisor op errors; mock plan/vibe methods unused (split sanity — do not require the whole bridge to be null) |
| A11 | native helper import/wrapper throws "no advisor/config" | honest error; no local YAML write attempted |
| A12 | abort signal already aborted | cancelled result; no save/apply |

### Result shape

| # | Case | Expectation |
|---|---|---|
| A13 | successful upsert | `ApplyResult`: `persisted`, `applied`, `effectiveAt:"immediate"`, `source` path, `verification` (enabled/active/advisors), `warnings` array |
| A14 | upsert while fake `isAdvisorEnabled()===false` | persist+apply still invoked; verification `active=false`; warning mentions disabled / runtime=0 |
| A15 | discover returns a shadowed name (project slug overrides user) | warning includes `shadow` |

### Registration / kill switch

| # | Case | Expectation |
|---|---|---|
| A16 | `registerAdvisorTool` | exactly one tool named `advisor`; `loadMode:"essential"`; `approval:"read"`; `hidden:false`; op enum of the ten ops |
| A17 | `advisorToolEnabled=false` | factory registers no `advisor` tool |
| A18 | settings default (missing key) | `advisor` registered |

---

## L3 — Real session integration

Recipe: real `AgentSession` + `SessionManager.inMemory()` + host
`createMockModel` (offline, no API key). Extension registered with the
production resolver (do not inject a fake bridge). Temporary project dir
+ temporary `agentDir`; `PI_CONFIG_DIR` isolated.

`projectDir` must be a git-style repo root **or** the test must exercise
the `repo.root(cwd) ?? cwd` rule with a **subdirectory cwd** (I8).

| # | Case | Proves |
|---|---|---|
| I1 | `list` project / user / effective against seeded WATCHDOG files | F1: native parse + merge, not a plugin roster |
| I2 | `upsert` project advisor while `setAdvisorEnabled(true)` | F2: `isAdvisorActive` / stats contain the new name **without restart** |
| I3 | second `upsert` changes model/instructions/tools | F3: old runtime gone; verification reflects new values |
| I4 | user-scope advisor `reviewer`; project upsert same slug; then `remove` project | F4: effective returns to the user entry after remove (native precedence) |
| I5 | `disable` → `upsert` → file on disk, `isAdvisorActive===false` → `enable` | F5: persist while off; enable starts the **latest** applied roster; enable did not need a second discover from the tool |
| I6 | upsert with unknown tool name and/or unresolvable model | F6: warning or error; pre-existing live advisor still present |
| I7 | new in-memory session (or resume-equivalent) after project file write | F7: file still on disk; session enable is per-session (new session does not inherit the previous session's enable override unless native settings say so — assert native behavior, do not invent persistence) |
| I8 | `ctx.cwd` is a subdirectory of the temp repo | edit path is repo-root `WATCHDOG.yml`, not the subdir |
| I9 | no extension registered | honest error on the real resolver path (parity with mode I6) |

L3 must not construct a plugin-side `SessionAdvisors`. If a test needs
roster truth, read it from the session (`getAdvisorStats` /
`isAdvisorActive`) or from native `discoverAdvisorConfigs`.

---

## L4 — Live wiring (`.sandbox/verify-workspace.ts`)

Same four-quadrant matrix as goal/mode (installed/source ×
extension/control):

- QoL run: `dumpTools` contains `advisor` with the `[qol]` description
  marker; model-side schema lists all ten ops
  (`list|get|upsert|remove|set_shared|apply|enable|disable|status|dump`).
- Control (`--no-extensions`): `advisor` absent.
- `omp plugin doctor` stays clean.

Do not add L4 cases that write the developer `~/.omp`.

---

## L2 note (bridge sanity, if extended)

If `host-bridge.test.ts` grows an advisor check:

- H-advisor-1: session missing advisor methods → bridge for **mode** still
  resolves (plan/vibe sanity unchanged).
- H-advisor-2: session with advisor methods → advisor ops can see them.

Not a substitute for A10.

---

## L6 optional (Foundation F8)

Real LLM on the installed or source host, isolated config root, relay
pool `OMPQOL_RELAY_PROVIDERS`. Prompt: create a project advisor for a
concrete review task, `status`/`dump`, then `remove`. Evidence = session
transcript. Not required to merge the first implementation cut.

---

## Edge-case notes (review + tests)

- No `invoke` op in schema or execute switch.
- Enable/disable traces must be assertable as "zero discover calls".
- Empty remove of the last project advisor: native save deletes the file;
  effective may fall back to user/legacy default — assert native, do not
  special-case in the plugin.
- Sealed-host missing `advisor/config`: L1 A11; live e2e only if a sealed
  host is under test — fail honestly, do not skip into a YAML writer.
- Kill-switch suites that touch `PI_CONFIG_DIR` must share the process
  testRoot with goal/mode (historical XDG DirResolver flap).

## Results

Not yet run. This file is the pre-implementation contract. Fill pass
counts into `docs/plans/impls/qol-004-impl-notes.md` when L1/L3/L4 exist.
