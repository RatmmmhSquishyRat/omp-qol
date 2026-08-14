# Resource Application Matrix

The central correction to the original `config-model-agents-refresh` framing is: **OMP has no single configuration-refresh lifecycle.** Each resource has an owner, mutation path, activation boundary, verifier and rollback story.

## Matrix

| Resource | Source of truth | Read/discovery timing | Native mutation/apply path | Effective boundary | Verification | QOL recommendation |
|---|---|---|---|---|---|---|
| Goal | session goal state | live | native goal operations | immediate / loop-specific | goal state/event | already solved; thin driver |
| Plan mode | session plan state | live | native session operation | immediate | plan state/tool surface | already solved; thin driver |
| Vibe mode | vibe runtime | live | native session operation | immediate | vibe state/tool surface | already solved; thin driver |
| Advisor roster | merged user/project `WATCHDOG.yml` | startup + configure rediscovery | save → discover → `session.applyAdvisorConfigs` | immediate live rebuild | active roster/status/model/tools | thin CRUD + exact native apply |
| Advisor enabled | session/settings | live | set/toggle enabled | immediate | advisor status | separate from roster mutation |
| Task agent definition | `.omp/agents/*.md` + other agent roots | every task spawn | write/update definition; spawn rediscovers | next spawn | rediscover + resolved agent | no generic refresh required |
| Task model override | live Settings | each spawn resolution | Settings mutation | next spawn | effective setting + resolved model | never rely on raw YAML write alone |
| Model role | live Settings | role resolution at use | typed Settings/model-role mutation | next role resolution | resolve to concrete model | expose set + resolve/readback |
| Active main model | AgentSession state | live | native model switch | next provider call | current model | separate from defaults/roles |
| Model catalog | bundled/config/discovered registry | registry cache | `ModelRegistry.refresh/refreshProvider` | immediate after await | list/lookup | thin native driver |
| Generic settings | layered Settings owner | live/cached owner | owner mutation APIs | setting-specific | `settings.get` + downstream verify | expose typed resources, not "edit config + reload" |
| Managed skill | managed skill store | discovery + active refresh | native `manage_skill` | same session after refresh | skill list/read + prompt metadata | reuse native tool |
| Authored skill | skill roots | rediscovery | file mutation + `refreshSkills` | immediate if refresh invoked | active skills + prompt rebuild | autonomous changes should prefer managed skill |
| MCP servers/tools | MCP capability/config | startup, reload, server notifications | disconnect/reconnect/rediscover + refresh tools | immediate after lifecycle completes | live connections/tool registry | drive native lifecycle |
| Extension module | extension roots/plugins | primarily startup | loader can import edited module when invoked, but no supported live instance replacement | restart/session recreate | loaded registry + behavior | restart-class in v1 |
| AGENTS/context files | project context discovery | startup + base-prompt rebuild | file edit + `session.refreshBaseSystemPrompt()` | next provider request after rebuild | prompt dump/context + advisor context | viable live resource through thin bridge |
| `SYSTEM.md` / `APPEND_SYSTEM.md` files | startup-resolved prompt inputs | session creation | file edit does not make captured text reread | next session/recreate by default | new-session prompt dump | do not conflate with AGENTS |
| Active base system prompt text | AgentSession/SessionTools | live | `refreshBaseSystemPrompt` / internal setter paths | immediate next request | agent prompt state | only expose narrowly if needed |
| Local memory summary/lessons | local memory store | often startup injection + background consolidation | memory tools/learn | backend-specific; local learned summary often next session | memory view/artifact | report exact activation boundary |
| Hindsight/Mnemopi memory | backend DB/state | live operations + injection rules | backend-native tools | backend-specific | recall/stats/readback | reuse backend semantics |
| QOL context overlay events | session custom entries | replay current branch + every context projection | `pi.appendEntry` + projection reducer | next request | overlay state + projection preview | canonical session remains lossless |
| QOL active compression block | custom entry + addressed source | context projection | create/enable/disable overlay | next request | projected context/tokens | reversible until sealed |
| QOL sealed compression | native CompactionEntry + QOL metadata | native context reconstruction | custom `CompactionResult` via compaction hook | after compaction | native boundary + QOL block state | recommended plugin-first lifecycle bridge |
| QOL pin | custom entry + source/snapshot/instruction | branch replay + context projection | pin create/remove | next request | effective pin set + preview | tail-zone default |
| PinStateTree | QOL control-plane state | state change + projection | march/jump | next request | active paths + derived pins | build later |

## Standard resource mutation result

Every model-facing durable mutation should report activation explicitly:

```ts
interface ApplyResult {
  persisted: boolean;
  applied: boolean;
  effectiveAt: "immediate" | "next_request" | "next_spawn" | "next_session" | "restart";
  source?: string;
  revision?: string;
  verification?: unknown;
  warnings?: string[];
}
```

`persisted: true` is not synonymous with `applied: true`.

## Why file editing alone is dangerous

Three superficially similar writes behave differently:

1. edit `.omp/agents/reviewer.md` → next `task` spawn discovers the new definition;
2. edit `.omp/config.yml` model role → live Settings may still hold the prior value;
3. edit `AGENTS.md` → live session can re-discover it if `refreshBaseSystemPrompt()` is invoked;
4. edit `SYSTEM.md` → current rebuild still uses startup-captured custom prompt text, so the file change is not equivalent to live apply.

The fix is not a universal `refresh()`. The fix is a **resource adapter that owns mutate → apply → verify**.

## PrimeStyle adapter contract

A future Managed Harness Resource adapter should expose at least:

```ts
interface HarnessResourceAdapter<TSpec, TObserved> {
  inspect(): Promise<TObserved>;
  validate(spec: TSpec): Promise<ValidationResult>;
  mutate(spec: TSpec): Promise<PersistResult>;
  apply(): Promise<ApplyResult>;
  verify(): Promise<TObserved>;
  rollback(revision: string): Promise<ApplyResult>;
}
```

This is deliberately more explicit than "agent can edit any file" because the hard part is knowing whether the running harness actually changed.
