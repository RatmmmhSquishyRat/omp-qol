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

---

## Test Results

| Level | File | Pass | Fail |
|---|---|---|---|
| L1 | `advisor-tool.test.ts` | 28 | 0 |
| L3 | `advisor-integration.test.ts` | 10 | 0 |
| Regression (L1+L3+bridge) | all pre-existing | 47 | 0 |
| **Total** | | **85** | **0** |

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
| 1 | `status` | Host already had a merged user-scope advisor `default` (`kimi-code/k3`) running. Tool returned `Advisor is enabled … configured: true`. Session flag was already on before we wrote anything. |
| 2 | `enable` | `setAdvisorEnabled(true) returned true. enabled=true active=true`. No discover (live-only op). |
| 3 | `upsert` name=`E2EReviewer` | `persisted: true`, `applied: true`, `effectiveAt: immediate`. Source = scratch `WATCHDOG.yml`, not `~/.omp`. |
| 4 | `list` scope=`effective` | After merge: **1** advisor, `E2EReviewer` with the e2e instructions. Project leaf hid user `default`. |
| 5 | `remove` name=`E2EReviewer` | `persisted: true`, `applied: true`, same scratch source. Project entry gone. |
| 6 | `disable` | `setAdvisorEnabled(false) returned false. enabled=false active=false`. |

First-attempt gaps (so this is not silently rewritten as “always green”):
- Cursor `gpt-5.4-nano-high` was a dead model (`not_found`); the turn ended with **zero** `advisor` calls. That is not a use-through.
- An intermediate run called `enable` successfully (`Advisor enabled. … enabled=true active=true`) but the harness regex looked for JSON `"enabled": true` and falsely failed. The tool itself worked.
- `remove` once matched against the outer stringified RPC frame (`\"persisted\": true`) and falsely failed; the tool had already persisted. Matcher now reads `result.content[].text`.

---

## SSOT Amend Decision

Evidence gathered:
- L3 I2 confirms TUI Save is live apply (no restart needed) — confirms what Foundation already knew.
- L3 I5 confirms `enable` does NOT call discover — matches ADR-005 §D3.
- Probe (step 2, prior session) confirmed `applyAdvisorConfigs` is on the real `AgentSession`.

The pillar `docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md` has the phrase "特殊内置 subagent" which ADR-005 notes stands side-by-side with the code fact (advisor is a bypass observer, not a task target). **No amend made**: ADR-005 already documents the coexistence; there is no false claim to correct and no silently rewriting the pillar is warranted.
