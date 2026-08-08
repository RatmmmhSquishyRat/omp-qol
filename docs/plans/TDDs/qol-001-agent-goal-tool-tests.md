# QOL-001 Test Plan (TDD)

Results 2026-08-05: **A/B/C/D all pass (12/12 bun tests); L1–L4 pass.**
Added L5 after the loadMode incident: provider-payload probe confirmed
`goalIncluded=true`. See docs/plans/impls/qol-001-impl-notes.md.

Harness: `test/goal-tool.test.ts`, run with `bun test` in the extension repo.
The native tool is mocked as a faithful state machine of `GoalRuntime`'s
tool-visible semantics (research §3/§4). Live checks are separate scripts.

## A. Offline unit matrix (bun test)

### Delegation contract
- A1 create: params `{op:"create", objective, token_budget}` forwarded verbatim
  to `invokeTool`; native result content+details passed through unchanged.
- A2 get/complete/resume/drop: each forwards exact params object.
- A3 native result with `details.goal` preserved byte-identical.

### Error surfacing
- B1 `invokeTool` undefined → result `isError: true`, text mentions
  `goal.enabled`; no throw escapes `execute`.
- B2 native rejects ("cannot create a new goal because this session already
  has a goal") → `isError: true`, native message preserved.
- B3 native throws for `create` without objective → surfaced as error result.
- B4 abort signal aborted before execution → cancelled result, no delegation.

### Schema
- C1 zod schema rejects unknown op values (parse failure).
- C2 `token_budget` non-integer/negative rejected by native semantics (mock
  throws as native does) — surfaced as error result.

### Kill switch / registration
- D1 `registerGoalTool` registers exactly one tool named `goal` with
  `approval: "read"`, `hidden: false`.
- D2 settings `goalToolEnabled=false` → main factory registers no goal tool
  (mock `pi.registerTool` call count 0 for name `goal`).
- D3 settings default (missing) → goal tool registered.

## B. Live wiring (isolated root ~/.omp-qol, scripts under .sandbox)

- L1 `run-omp.ps1 --mode rpc` + `get_state` → `dumpTools` contains `goal`
  with the QoL description marker.
- L2 control: same run with `--no-extensions` → `goal` absent from
  `dumpTools` (proves the entry is ours; native hides it without goal mode).
- L3 session log contains `[omp-qol] goal tool registered`.
- L4 `omp plugin doctor` stays clean; `plugin list` shows enabled.
- L5 (added after incident): `before_provider_request` probe shows the goal
  tool in the actual payload sent to the model. REQUIRED because
  registered+active ≠ model-visible (`loadMode` gate).

## C. Edge cases (reasoned, enforced in code review + tests)

- E1 Host without native goal tool (goal.enabled=false) → B1 path.
- E2 Tool call during streaming steer → no special handling needed;
  delegation is synchronous wrt session state (GoalRuntime serializes
  accounting internally via its accounting tail).
- E3 Session switch/branch: extension reloads per session; tool re-registers;
  state lives in the session's runtime, not in the extension (no stale cache
  kept — the tool stores nothing between calls).
- E4 Interaction with `/guided-goal` & user `/goal set`: shared runtime, no
  double registration (registry set-by-name).
- E5 Print/headless mode: no UI; delegation still valid; results text-only.
