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
| `plugin/test/advisor-tool.test.ts` | New: L1 mock tests (28 cases, A1–A18) | Created |
| `plugin/test/advisor-integration.test.ts` | New: L3 real-session tests (10 cases, I1–I9 + bridge reach) | Created |
| `.sandbox/verify-workspace.ts` | Updated L4 to recognize `advisor` tool + 10-op schema check | Modified |
| `.sandbox/e2e-workspace-advisor.ts` | L6 delivery-form e2e: installed omp + real LLM, 6 ops | Created |

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

---

## Test Results

| Level | File | Pass | Fail |
|---|---|---|---|
| L1 | `advisor-tool.test.ts` | 28 | 0 |
| L3 | `advisor-integration.test.ts` | 10 | 0 |
| Regression | `goal-tool` 12 + `mode-tool` 22 + `host-bridge` 8 + `integration-real-session` 7 | 49 | 0 |
| **Total** | | **87** | **0** |

> Correction (2026-08-15 review): the earlier version of this table claimed
> "47 regression / 85 total" — that arithmetic was wrong. The verified run
> is 12+22+8+7 = 49 regression, 87 total. `host-bridge` H1 was observed to
> be flaky under load (host self-import can exceed bun's default 5s per-test
> timeout); H1 now carries an explicit 30s timeout with an unchanged assertion.
> `bun run typecheck` is not usable in the junction/tsconfig-paths setup:
> all 267 tsc errors come from the host repo's `.md` string imports
> (bun-loader feature); plugin `src/` + `test/` have zero type errors.

### Foundation gate coverage (F1–F7)

| # | Gate | Cases | Status |
|---|---|---|---|
| F1 | Parse/list user/project/effective | A5, I1 | PASS |
| F2 | Upsert while enabled; no restart | I2 | PASS |
| F3 | Change model/instructions; old runtime replaced | I3 | PASS |
| F4 | Remove project entry; user resurfaces | I4 | PASS |
| F5 | Mutate while disabled; file persists; enable starts latest | A14, I5 | PASS |
| F6 | Unknown tool; existing roster untouched | A8, I6 | PASS |
| F7 | File survives new session | I7 | PASS |
| F8 | Real LLM e2e (optional) | `.sandbox/e2e-workspace-advisor.ts` | **PASS 2026-08-15** |

### L6 delivery-form use-through (2026-08-15)

This is the path that was missing from the first impl report. It is **not** L1/L3.

- **Host**: installed `omp` (`C:\Users\15480\.bun\bin\omp.exe`), `--mode rpc`
- **Workspace**: throwaway git repo under `.sandbox/scratch/e2e-advisor-ws-*` (gitignored). `repo.root()` therefore does not resolve to omp-qol. Project `WATCHDOG.yml` stayed in scratch; no write to developer `~/.omp`.
- **Model**: `zai/glm-4.5-flash` (live `get_available_models` → ranked cheap pool; first cursor-nano attempt earlier in the session failed with `Connect error not_found` and never called the tool)
- **Driver**: the model was prompted to call `advisor` exactly once per turn. Assertions are on `tool_execution_end` text, not on the model's chat reply.
- **Result**: **6/6 PASS**, `isError=false` on every step. Wall time ~245s.

| Step | op | What actually happened |
|---|---|---|
| 1 | `status` | Host had merged user-scope advisor `default` (`kimi-code/k3`) running. Tool returned structured `{ "op": "status", "enabled": true, "active": true, "configured": true, "advisors": [{ "name": "default", "status": "running", "model": "kimi-code/k3" }] }`. |
| 2 | `enable` | Returned structured `{ "op": "enable", "enabled": true, "active": true, "running": true, "discovered": false }`. Obeyed ADR-005 D3 (no discover). |
| 3 | `upsert` name=`E2EReviewer` | `persisted: true`, `applied: true`, `effectiveAt: immediate`. `op: "upsert"`, `activeCount: 1`, `advisors: [{ name: "E2EReviewer", status: "running" }]`. Source = scratch `WATCHDOG.yml`, not `~/.omp`. |
| 4 | `list` scope=`effective` | Returned structured `{ "op": "list", "scope": "effective", "advisors": [{ "name": "E2EReviewer", "instructions": "Watch for regressions in this e2e session." }] }`. |
| 5 | `remove` name=`E2EReviewer` | `persisted: true`, `applied: true`, `op: "remove"`. User `default` advisor resurfaced in active roster (`activeCount: 1`). |
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
  `remove` → `activeCount: 1` with user-scope `default` (`kimi-code/k3`)
  back in the live roster — F4 semantics observed live;
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

Honest scope statement: L6 drives 6 of 10 ops through a real LLM
(`status`, `enable`, `upsert`, `list`, `remove`, `disable`). The other
four (`get`, `set_shared`, `apply`, `dump`) are covered at L1+L3 only —
consistent with the TDD, which gates this milestone on L1+L3+L4 and marks
L6 as optional (Foundation F8).

---

## SSOT Amend Decision

Evidence gathered:
- L3 I2 confirms TUI Save is live apply (no restart needed) — confirms what Foundation already knew.
- L3 I5 confirms `enable` does NOT call discover — matches ADR-005 §D3.
- Probe (step 2, prior session) confirmed `applyAdvisorConfigs` is on the real `AgentSession`.

The pillar `docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md` has the phrase "特殊内置 subagent" which ADR-005 notes stands side-by-side with the code fact (advisor is a bypass observer, not a task target). **No amend made**: ADR-005 already documents the coexistence; there is no false claim to correct and no silently rewriting the pillar is warranted.
