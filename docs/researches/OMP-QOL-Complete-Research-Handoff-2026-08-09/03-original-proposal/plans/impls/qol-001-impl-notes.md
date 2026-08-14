# QOL-001 Implementation Notes

Status: implemented & verified · 2026-08-05

## Files

| File | Content |
|---|---|
| `repos/omp-qol-extension/src/goal-tool.ts` | `registerGoalTool(pi)` — shadow `goal` tool, native delegation |
| `repos/omp-qol-extension/src/lib/settings.ts` | Shared settings loader (host import + lockfile fallback) |
| `repos/omp-qol-extension/src/main.ts` | Async factory: settings → conditional registration |
| `repos/omp-qol-extension/test/goal-tool.test.ts` | 12-case bun harness (delegation/errors/schema/kill switch) |
| `.sandbox/verify-live.ts` | Live RPC `dumpTools` verification (qol + control modes) |
| `package.json` | Added `goalToolEnabled` setting + `test` script + zod devDep |

## The critical pitfall found during verification: `loadMode`

First live verification FAILED: the tool was registered (registry) and active
(`getActiveTools()`), yet absent from both RPC `dumpTools` and the actual
provider request payload. Root cause:

- omp sends only `loadMode: "essential"` tools in the top-level schema to the
  model; everything else is "discoverable" (see `src/tools/essential-tools.ts`).
- Extension-registered tools default to `"discoverable"` at the adapter
  boundary (`docs/extensions.md`, `defaultLoadModeForToolName`).
- Fix: declare `loadMode: "essential"` on the tool definition.

Lesson: "tool registered + active" is NOT "tool visible to the LLM". The
ground-truth checks are RPC `get_state.dumpTools` and the
`before_provider_request` payload.

## Verification results (all in isolated root ~/.omp-qol)

1. Offline harness: `bun test` → **12 pass / 0 fail** (A1-A3 delegation,
   B1-B4 error surfacing incl. missing invokeTool + abort, C1-C2 schema,
   D1 registration shape, D2-D3 factory kill switch via real lockfile).
2. Live RPC qol run: `dumpTools` = 12 tools incl. `goal` with `[qol]`
   marker → PASS.
3. Live RPC control (`--no-extensions`): 11 tools, no `goal` → PASS
   (proves the entry is ours; native goal stays hidden without goal mode).
4. Provider payload probe: `[omp-qol] provider request tools (12): ... goal
   goalIncluded=true` → the model genuinely receives the tool.
5. `omp plugin doctor` clean; `omp plugin list` shows enabled v0.1.0.
6. Live kill switch: `plugin config set ... goalToolEnabled false` → goal
   absent from `dumpTools`; back to `true` → present again. Setting round-trip
   drives registration at factory time, no reinstall needed.

## Behavior notes

- Native delegation preserves: persistence (`appendModeChange`), `goal_updated`
  events, token/wall-clock accounting, budget-limit steering, TUI renders.
- Agent-created goals do NOT start interactive auto-continuation (gated by the
  user-owned goal-mode flag) — verified against `interactive-mode.ts:1372-1412`.
- `pause` intentionally not exposed (ADR-001 decision 2).
- Errors from the native side (e.g. "already has a goal") surface as
  `isError` results with the original message — the LLM can self-correct.

## Follow-ups

- If upstream adds `pause` to the native goal tool or exposes `GoalRuntime`,
  revisit ADR-001 decision 2.
- Consider a `/qol-goal` status command if users ask for it.
