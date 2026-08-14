# Advisor / WATCHDOG Research and Recommended Design

## Closed findings

### Configuration richness already exists

Current OMP WATCHDOG/advisor configuration supports named advisors with per-advisor model, tools, instructions, enabled state and shared instructions, with user/project scopes and merged discovery.

OMP-QOL does not need to design another advisor profile format.

### Hot apply already exists

The current TUI config editor's host callback explicitly owns “disk + live-runtime effects.” On Save, current core does:

```text
saveWatchdogConfigFile(editPath, doc)
  → discoverAdvisorConfigs(cwd, agentDir)
  → session.applyAdvisorConfigs(discovered.advisors, discovered.sharedInstructions)
  → status line/readback
```

`SessionAdvisors.applyAdvisorConfigs(...)` replaces the stored configs/shared instructions, stops old runtimes as necessary and builds the new live roster. Restart is not required.

### Toggle is not refresh

`/advisor on|off` only calls the session's advisor enable/disable path. It does not call `discoverAdvisorConfigs` and therefore should not be used as a fake post-write refresh mechanism.

## Remaining reachability issue

The extension context exposes:

- read-only `sessionManager`;
- mutable `modelRegistry`;
- command/session actions;
- tool invocation/event facilities.

But it does not obviously expose a direct live `AgentSession.applyAdvisorConfigs` action to an arbitrary extension tool. Search of current call sites shows the official live apply in session/selector code, not a general extension action.

### Preferred resolution order

1. Probe whether the existing host-injected live namespace used by QOL-002/003 can reach the session advisor apply call safely.
2. If yes: QOL plugin imports native WATCHDOG parsing/save/discovery helpers and drives the live session action.
3. If not: add one tiny host bridge action such as `applyAdvisorConfigs` / `refreshAdvisors`, implemented inside the host by the exact native sequence.
4. Do **not** duplicate `SessionAdvisors`, config merge precedence, model resolution, recorder lifecycle or runtime construction in the plugin.

## Model-facing surface

A useful agent tool can be declarative rather than file-oriented:

```text
advisor_config list [scope/effective]
advisor_config get <name>
advisor_config upsert <name> { model?, tools?, instructions?, enabled? }
advisor_config remove <name>
advisor_config set_shared_instructions <text>
advisor_config apply/status
```

Implementation may save a whole `WatchdogConfigDoc` atomically, but the model should not have to serialize YAML correctly.

### Mutation response

Return:

- scope modified;
- persisted file path/source;
- effective merged roster after rediscovery;
- whether advisors are enabled;
- which runtimes are currently active and their resolved models;
- warnings for names shadowed by higher-precedence scope or unavailable models/tools.

This is critical: “file write succeeded” is weaker than “requested advisor is active with model X.”

## Scope semantics

The tool should make project vs user scope explicit. Defaulting autonomous changes to **project** is safer and more inspectable than silently modifying user-global advisor behavior.

User/global mutation should be a deliberate operation because it changes unrelated projects and future sessions.

## Test plan

1. Parse/list current user/project/effective rosters.
2. Upsert project advisor while advisor enabled; prove runtime appears without restart.
3. Change model/instructions/tools; prove old runtime is replaced and new values active.
4. Remove project advisor and prove lower-precedence user advisor resurfaces when names collide.
5. Modify config while advisor disabled; prove config persists but runtime remains off; enabling then starts the latest applied roster.
6. Invalid model/tool/config should fail or surface warning without corrupting existing active roster.
7. Branch/resume/new session: prove scope persistence and session enable semantics.
8. Real LLM e2e: agent decides to create an advisor for a concrete task, uses it, then can inspect/remove it.
