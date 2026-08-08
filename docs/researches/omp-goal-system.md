# Research: OMP Goal System (v17.2.4 / source @ 5af71dc)

Date: 2026-08-05 · Source: `ref_repos/oh-my-pi` (packages/coding-agent)

## 1. Components

| File | Role |
|---|---|
| `src/goals/state.ts` | Types: `Goal`, `GoalModeState`, `GoalStatus` = active \| paused \| budget-limited \| complete \| dropped |
| `src/goals/runtime.ts` | `GoalRuntime` — all mutations: createGoal / replaceGoal / resumeGoal / pauseGoal / dropGoal / completeGoalFromTool / onBudgetMutated; token & wall-clock accounting; budget-limit steering |
| `src/goals/tools/goal-tool.ts` | Native LLM tool `goal`, ops: `create \| get \| complete \| resume \| drop` (NO pause) |
| `src/session/agent-session.ts:1305` | `#goalRuntime = new GoalRuntime(host)` — constructed **unconditionally** per session |
| `src/tools/index.ts:446-449,588-592` | `goal` is a HIDDEN_TOOL; `isToolAllowed` gates it on settings `goal.enabled` |
| `src/sdk.ts:2651-2663` | Native goal tool registered in registry whenever `goal.enabled`, captured in `nativeToolsByName` BEFORE extension overrides |
| `src/modes/interactive-mode.ts` | User-facing `/goal` command, goal-mode enter/exit, continuation loop |
| `src/slash-commands/builtin-registry.ts:472-505` | `/goal` (set/show/pause/resume/drop) + `/guided-goal`, gated by settings `goal.enabled`, blocked by plan mode |

## 2. User surface (`/goal`)

- `set <objective>` → `#enterGoalMode` → `goalRuntime.createGoal(...)` + adds `goal` to active tools
- `show` → displays state
- `pause` → `goalRuntime.pauseGoal()`
- `resume` → `goalRuntime.resumeGoal()`
- `drop` → `goalRuntime.dropGoal()`
- Budget editor → `goalRuntime.onBudgetMutated(n|undefined)`
- All gated by settings `goal.enabled`; blocked while plan/vibe mode active.

## 3. Agent surface (native)

- The `goal` tool exists in the registry whenever `goal.enabled` is set, but is only added
  to the **active** tool set when goal mode state `enabled === true`
  (`tools/index.ts:466-469`) or when explicitly activated (`/guided-goal` flow,
  `interactive-mode.ts:2748-2755`).
- Consequence: **the agent can never initiate a goal**; the user must first run `/goal set`.
- `GoalTool.execute` resolves the runtime via `session.getGoalRuntime()`, which is always
  defined (`sdk.ts:1764`), so the tool works whenever it is actually executed — the only
  gate is tool-set membership.

## 4. Persistence & events

- Persist via `sessionManager.appendModeChange("goal" | "goal_paused" | "none", { goal })`
  (`agent-session.ts:1324-1330`); restored on session resume via `sessionContext.mode`
  (`interactive-mode.ts:2508-2520`).
- Every mutation emits `goal_updated` session event; extensions receive it
  (`shared-events.ts`, docs/extensions.md "Reliability/runtime signals").

## 5. Extension reachability (what our plugin can touch)

- `ctx.sessionManager` — SessionManager (typed Readonly; runtime object is the real one)
- `pi.getAllTools/getActiveTools/setActiveTools`, `pi.registerTool` (+ `ctx.invokeTool`
  same-tool native delegation, `docs/extensions.md` §"Delegating to a native built-in")
- `pi.on("goal_updated")` — state observation
- **NOT reachable**: `AgentSession`, `GoalRuntime` instance. No RPC goal-mutation methods
  exist (`docs/rpc.md` — goal appears only as the `goal_updated` event). `execCommand`
  export is shell-exec, not slash-command dispatch.

## 6. Safety property (critical)

Autonomous goal continuation in interactive mode requires the mode-owned flag
`goalModeEnabled`, which is set **only** by `#enterGoalMode` (user `/goal set`).
A goal created via tool call sets goal state but does NOT start the continuation
timer (`interactive-mode.ts:1372-1412`, gate at 1378 + 1390). Completion cleanup
happens lazily via `mode === "exiting"` at next input (`:1331-1333`).

## 7. Settings

- `goal.enabled` (boolean) — master gate for `/goal` and the native tool.
- `goal.continuationModes` — which modes run the continuation loop.

## 8. Gap statement

Agent-visible goal operations today: none until the user enables goal mode.
User-visible operations: set/show/pause/resume/drop (+ budget).
QoL goal: agent can always view+manipulate goals; maximize op parity through
supported extension surfaces.

## 9. Addendum — tool visibility layers (found during QOL-001 verification)

Three distinct layers; a tool can be in the first two and still never reach
the model:

1. **Registry** — `toolRegistry` map (`pi.getAllTools()`).
2. **Active set** — enabled names (`pi.getActiveTools()`).
3. **Model schema** — only `loadMode: "essential"` tools of the active set
   (`src/tools/essential-tools.ts`); extension tools default to
   `"discoverable"`. Verify layer 3 via RPC `get_state.dumpTools` or the
   `before_provider_request` payload.
