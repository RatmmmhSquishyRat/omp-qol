# QOL-004 Design: Agent-facing Advisor Tool

Status: approved for implementation · Depends on:
`docs/researches/OMP-QOL-Complete-Research-Handoff-2026-08-09/02-foundation-research/06-ADVISOR-WATCHDOG.md`,
ADR-005 · Tracks A (pathway) and B (convenience) ship in the same milestone.

## Problem

The user already configures and operates advisors through `/advisor
on|off|status|dump [raw]|configure` and the TUI Save path. The main agent
cannot: it has no tool, no file helper, and no live-session apply. Pillar
`advisor-watchdog.md` wants the agent to do what the user can do, freely
and conveniently. Foundation closed the remaining uncertainty: TUI Save is
already no-restart live apply; `/advisor on|off` is **not** rediscovery.

`plugin/src` has no advisor code today. QOL-001/002/003 already proved the
host-bridge pattern; this design adds the advisor entry point only.

## Goal

The main agent can complete every advisor operation the user can perform
today, and can do so with declarative fields plus a verification readback
— without writing YAML, without treating on/off as refresh, and without
the plugin re-implementing `SessionAdvisors`.

Non-goals: Pin / Summary / PrimeStyle; a plugin-owned `SessionAdvisors`;
WATCHDOG schema changes; the TUI configure editor itself; a generic
refresh command; an `invoke` that schedules an advisor turn.

## Mechanism: thin driver (ADR-005)

Same substance as QOL-002/003 v3: the user already has the feature; the
plugin only adds an entry point.

```text
LLM ── advisor(op,…) ──▶ qol advisor tool
                            │
                            ├─ file ops ── native advisor/config
                            │              (load / save / discover / resolvePath)
                            │
                            └─ live ops ── host-bridge AgentSession
                                           (apply / enable / status / dump)
```

- File layer: import native `advisor/config` helpers. No local YAML
  serializer. Sealed-host import failure is an honest error; a host
  `./advisor` export is only considered after e2e proves the gap.
- Live layer: extend `LiveHostSession` with the public advisor methods
  already on `AgentSession` (~8885–8991). Advisor sanity is **independent**
  of the plan/vibe sanity gate — a session that can drive plan/vibe but
  lacks advisor methods must refuse advisor ops only, not null the whole
  bridge.
- Mutate pairing: upsert / remove / set_shared always run the TUI Save
  sequence `saveWatchdogConfigFile` → `discoverAdvisorConfigs` →
  `session.applyAdvisorConfigs`. Half-ops (write-only or apply-only) are
  forbidden on those ops. A standalone `apply` exists for files the model
  or user edited by hand.

Two questions are designed separately and delivered together.

---

## Track A — Pathway completeness

The agent must be able to do everything the user can do. One capability,
one native call. Nothing invented, nothing dropped.

### User capability map

| User surface | Native call | Agent op |
|---|---|---|
| `/advisor on` | `session.setAdvisorEnabled(true)` | `enable` |
| `/advisor off` | `session.setAdvisorEnabled(false)` | `disable` |
| `/advisor status` | `getAdvisorStats` / `formatAdvisorStatus` | `status` |
| `/advisor dump [raw]` | `formatAdvisorHistoryAsText({ compact: !raw })` | `dump` |
| TUI configure Save | `saveWatchdogConfigFile` → `discoverAdvisorConfigs(cwd, agentDir)` → `applyAdvisorConfigs` | `upsert` / `remove` / `set_shared` (auto) and standalone `apply` |
| TUI configure open / list files | `loadWatchdogConfigFile` + `discoverAdvisorConfigs` | `list` / `get` |

`configure` itself is a TUI editor. The agent does not open that overlay;
it performs the same Save sequence with declarative fields (Track B).

### Clarification (2026-08-15): the implicit "default" advisor is in scope

User clarification, recorded verbatim in the pillar
(`docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md` §用户澄清):

> 有一个问题啊, 主agent使用的默认advisor也需要能够被看到和配置以及开关啊, 这些用户在cli里面是都能够做到的, 和其他advisor操作没有区别

Host facts this maps onto: with zero configured advisors the host runs one
implicit advisor `{ name: "default" }` on the advisor-role model
(`session-advisors.ts` legacy fallback, no file entry). The TUI seeds a
`default` row in the configure editor and normalizes a bare `default`
entry back to an empty roster on Save (`advisor-config.ts`). Capability
map for it (no new ops; same rows as above): `status` sees it live;
`upsert name="default"` materializes/overrides it; `upsert name="default"
enabled=false` pauses only it; `remove name="default"` restores the
implicit one. The tool annotates empty `list`/`get scope=effective` views
so the agent can discover it, and mirrors the TUI bare-default Save
normalization. Details: impl-notes Decision 8; proven at L3 I10 and L6
steps 6–8.

### Native surfaces (do not reimplement)

`AgentSession` already publishes:

- `applyAdvisorConfigs(advisors, sharedInstructions): number`
- `setAdvisorEnabled(enabled): boolean`
- `toggleAdvisorEnabled(): boolean` — user slash only; the tool uses
  explicit `enable` / `disable`
- `isAdvisorEnabled()` / `isAdvisorActive()`
- `getAdvisorStats()` / `formatAdvisorStatus()`
- `formatAdvisorHistoryAsText(options?)`
- `getAdvisorAvailableToolNames()`

File helpers live in `advisor/config.ts` (host `index.ts` does **not**
re-export them; package.json has no `./advisor` export). The plugin
imports the subpath the same way the TUI does. Wrappers in
`advisor-native.ts` may only forward `loadWatchdogConfigFile`,
`saveWatchdogConfigFile`, `discoverAdvisorConfigs`,
`resolveAdvisorConfigEditPath`.

Advisor is a bypass observer: it watches the primary turn and injects
notes via `advise`. It is not a `task` target. Pillar wording ("special
built-in subagent") and this code fact stand side by side; this design
does not reconcile them and does not add `invoke`.

### Path resolution (must mirror TUI)

TUI Save (`selector-controller.ts` `showAdvisorConfigure`) resolves:

```text
cwd       = sessionManager.getCwd()
projectDir = repo.root(cwd) ?? cwd     // NOT blindly ctx.cwd (may be a subdir)
agentDir  = getAgentDir() ?? getProjectDir()
editPath  = resolveAdvisorConfigEditPath(scope, { projectDir, agentDir })
discover  = discoverAdvisorConfigs(cwd, agentDir)
```

`project` writes `<projectDir>/WATCHDOG.yml` (or the existing `.yaml` if
that is the only file at that scope). `user` writes
`<agentDir>/WATCHDOG.yml`. Discovery walks user + project ancestors;
same-slug entries are overwritten by the more specific file (project leaf
> ancestor > user). Malformed YAML is skipped, not thrown.

### Read scopes

`list` / `get` accept `scope`:

| scope | Meaning |
|---|---|
| `project` | Raw, unmerged `WatchdogConfigDoc` at the project edit path |
| `user` | Raw, unmerged doc at the user edit path |
| `effective` (default for list) | `discoverAdvisorConfigs` merge result |

`get` without a matching name returns a not-found error (not an empty
success). `effective` get uses the merged roster after slug collision.

### Mutate pairing (integrity)

Two incomplete states are both wrong:

- Write file, skip apply → disk changed, live roster stale.
- Apply without write → live roster changed, restart loses it.

Mutate ops (`upsert` / `remove` / `set_shared`) must do both halves, in
the TUI order. `apply` is the explicit rediscover+apply for out-of-band
file edits. `enable` / `disable` never write files and never discover.

### Enable is not refresh

`/advisor on|off` only calls `setAdvisorEnabled`. Foundation closed the
"use on/off as post-write refresh" idea. After a mutate, the tool applies
via `applyAdvisorConfigs`. After `enable`, the session starts whatever
roster was last applied (or the startup-discovered roster). The tool must
not call `discoverAdvisorConfigs` on the enable/disable path.

---

## Track B — Agent convenience

Pathway completeness is not enough. The model will hand-write YAML, forget
to apply after upsert, treat on/off as refresh, silently edit the user
scope, or try to `task` an advisor. Track B is the contract that makes
those mistakes unnecessary.

### Surface: one `advisor` tool

```text
advisor(op: "list" | "get" | "upsert" | "remove" | "set_shared"
            | "apply" | "enable" | "disable" | "status" | "dump",
        name?: string,
        model?: string,
        tools?: string[],
        instructions?: string,
        enabled?: boolean,
        shared_instructions?: string,
        scope?: "project" | "user" | "effective",
        raw?: boolean)
```

- `loadMode: "essential"` (QOL-001 lesson: registered ≠ model-visible).
- `approval: "read"` — same tier as `goal` / `mode`; users can still
  override via `tools.approval.advisor`. File writes are the native
  WATCHDOG helpers, not a general filesystem tool.
- Kill switch: plugin setting `advisorToolEnabled` (default true).
- Single tool keeps the schema small; ops cover the user command set plus
  declarative configure-save.

### Operation semantics

| op | Writes file? | Discovers? | Live session? | Default scope |
|---|---|---|---|---|
| `list` | no | yes if `effective` | no | `effective` |
| `get` | no | yes if `effective` | no | `effective` |
| `upsert` | yes | yes | `applyAdvisorConfigs` | `project` |
| `remove` | yes | yes | `applyAdvisorConfigs` | `project` |
| `set_shared` | yes | yes | `applyAdvisorConfigs` | `project` |
| `apply` | no | yes | `applyAdvisorConfigs` | n/a (always cwd+agentDir discover) |
| `enable` | no | **no** | `setAdvisorEnabled(true)` | n/a |
| `disable` | no | **no** | `setAdvisorEnabled(false)` | n/a |
| `status` | no | no | `getAdvisorStats` / `formatAdvisorStatus` | n/a |
| `dump` | no | no | `formatAdvisorHistoryAsText` | n/a |

`scope=user` is accepted only when the model (or user) sets it explicitly
on `list` / `get` / `upsert` / `remove` / `set_shared`. Missing scope on
a mutate is `project`. `scope=effective` is invalid on mutate ops.

### Upsert / remove / set_shared (internal sequence)

1. Resolve `projectDir` / `agentDir` / edit path for the chosen scope
   (Track A path rules).
2. `loadWatchdogConfigFile(editPath)` — raw doc, no merge.
3. Mutate the in-memory `WatchdogConfigDoc`:
   - `upsert`: match by slugified `name`; insert or replace `name` plus
     any of `model` / `tools` / `instructions` / `enabled` (per-advisor).
     Omitted fields keep the previous value on update; on insert they stay
     unset (native defaults apply).
   - `remove`: drop the named entry; empty doc deletes the file (native
     `saveWatchdogConfigFile` behavior).
   - `set_shared`: set or clear top-level `instructions` from
     `shared_instructions`.
4. `saveWatchdogConfigFile(editPath, doc)` — native serializer only.
5. `discoverAdvisorConfigs(cwd, agentDir)` — native merge.
6. `session.applyAdvisorConfigs(discovered.advisors, discovered.sharedInstructions)`.
7. Read back via `isAdvisorEnabled` / `isAdvisorActive` / `getAdvisorStats`
   and return an `ApplyResult`.

`name` is required for `upsert` / `remove` / `get`. `shared_instructions`
is required for `set_shared` (empty string clears).

### Standalone `apply`

Rediscover + `applyAdvisorConfigs` only. Used when the model or user
edited `WATCHDOG.yml` outside this tool. Does not invent a second merge
algorithm.

### `ApplyResult` (Foundation resource matrix)

Every durable mutation (`upsert` / `remove` / `set_shared` / `apply`)
returns the standard shape from
`05-RESOURCE-APPLICATION-MATRIX.md`:

```ts
{
  persisted: boolean;          // file write happened (false for apply)
  applied: boolean;            // applyAdvisorConfigs was invoked
  effectiveAt: "immediate";    // TUI Save is live; no restart
  source: string;              // edit path or discover source
  verification: {
    enabled: boolean;          // isAdvisorEnabled
    active: boolean;           // isAdvisorActive
    activeCount: number;       // applyAdvisorConfigs return
    advisors: Array<{
      name: string;
      status: string;          // running | paused | quota_exhausted | error | no_model
      model?: string;          // resolved provider/id when present
      tools?: string[];        // granted / resolved tool names when known
    }>;
  };
  warnings: string[];          // shadow, unknown tool, no_model, disabled → runtime=0
}
```

`persisted: true` is not `applied: true`. Warnings (not silent success):

- **shadow** — a same-slug entry in a more specific scope wins; the
  written name is not in the effective roster.
- **unknown tool** — native discovery already drops unknown tool names;
  surface the drop.
- **no_model** — enabled but no advisor-role / explicit model resolved.
- **disabled** — session advisor flag is off, so `activeCount` is 0 even
  though the file was saved (native: configs stored for next enable).

Read ops (`list` / `get` / `status` / `dump` / `enable` / `disable`)
return text plus structured details; they do not pretend to be a file
mutation. `enable` / `disable` report the boolean `setAdvisorEnabled`
return (actively running after the call) and must not claim a discover
ran.

### Rejected "conveniences"

- Plugin-owned advisor turn / forged `<advisory>` injection.
- Model-supplied YAML string as an upsert body.
- Combining `enable` and `apply` into one "refresh".
- An `invoke` op that schedules the advisor to run a round.
- Defaulting autonomous writes to the user/global `WATCHDOG.yml`.

### README `~/.omp` vs product default

README "Never write to the global `~/.omp`" is a **test / ops rule**:
debugging the plugin must not pollute the developer's real global OMP.
It is not a product ban on user-scope advisor files. Product default is
`scope=project` (smallest, most inspectable change). `scope=user` is
allowed when explicit. Tests isolate with `PI_CONFIG_DIR` and a temporary
`agentDir`.

---

## Failure modes handled

- No live main session / bridge null → actionable error; user can still
  use `/advisor`. Nothing emulated.
- Session present but advisor methods missing → refuse **advisor** ops
  only; plan/vibe keep working (split sanity).
- Native `advisor/config` import fails (sealed host, no subpath) → honest
  error naming the missing helper. No homemade YAML writer.
- `ctx` cwd is a subdirectory → still resolve `projectDir` via `repo.root`
  (L3 regression).
- Unknown `op` / missing `name` on upsert/remove/get / `scope=effective`
  on mutate → schema or execute error, no disk write.
- Native save/discover skips malformed YAML → tool reports the skip /
  empty-doc outcome; does not throw out of `execute`.
- Abort signal before work → cancelled result, no write.
- Kill switch `advisorToolEnabled=false` → tool is not registered.

## Approval and settings

- `approval: "read"`, `loadMode: "essential"`, `hidden: false`.
- New plugin setting `advisorToolEnabled` (default true), same factory
  pattern as `goalToolEnabled` / `modeToolEnabled`.
- Users override approval with `tools.approval.advisor`.

## Interaction with existing flows

- User `/advisor on|off|status|dump|configure` and the agent tool share
  the same `AgentSession` / same files. No second roster.
- User TUI Save after an agent upsert: native rediscover sees the file
  the tool wrote; live apply replaces again. Harmless.
- Agent `enable` while the user already enabled: `setAdvisorEnabled(true)`
  is idempotent at the flag; runtime rebuild follows native matching.
- Advisor cannot be a `task` target. Tool description must say so.
- Disabled session: mutate still persists + apply stores configs;
  `verification.active` stays false until `enable`.

## Verification strategy

1. **L1 mock** (`plugin/test/advisor-tool.test.ts`): fake native helpers +
   fake live session. Prove op routing, default `project`, mutate
   save→discover→apply order, `enable`/`disable` never discover, honest
   errors, schema, kill switch. See `docs/plans/TDDs/qol-004-advisor-tool-tests.md`.
2. **L3 real session** (`plugin/test/advisor-integration.test.ts`): real
   `AgentSession` + temporary WATCHDOG + isolated `PI_CONFIG_DIR` /
   `agentDir`. Automate Foundation gates 1–7.
3. **L4 live wiring**: `.sandbox/verify-workspace.ts` `dumpTools` contains
   `advisor` with the `[qol]` marker and the ten-op schema; `--no-extensions`
   control does not.
4. **L6 optional**: real-LLM e2e (Foundation gate 8) behind
   `OMPQOL_RELAY_PROVIDERS`; not a merge blocker for the first cut.

## Code landing (implementation, not this docs step)

| File | Role |
|---|---|
| `plugin/src/advisor-tool.ts` | `registerAdvisorTool` |
| `plugin/src/lib/advisor-native.ts` | wrap native load/save/discover/resolvePath only |
| `plugin/src/lib/host-bridge.ts` | advisor methods on `LiveHostSession`; split sanity |
| `plugin/src/lib/settings.ts`, `plugin/package.json`, `plugin/src/main.ts` | `advisorToolEnabled` + registration |
| `plugin/test/advisor-tool.test.ts` | L1 |
| `plugin/test/advisor-integration.test.ts` | L3 |
| `.sandbox/verify-workspace.ts` | L4 recognizes `advisor` |

`docs/plans/impls/qol-004-impl-notes.md` is written during implementation.
SSOT pillar amend waits for ADR-005 **and** implementation evidence; this
design does not rewrite `docs/ssot/pillars/`.
