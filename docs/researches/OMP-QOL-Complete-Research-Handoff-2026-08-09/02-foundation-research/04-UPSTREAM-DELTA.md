# Upstream Delta: Original Research Baseline → OMP 17.2.12

## Why this matters

The uploaded research was careful and often source-grounded, but important pieces target 17.2.4 or 17.2.8. Upstream main inspected for this baseline reports coding-agent 17.2.12. The most consequential delta is not cosmetic: OMP has accumulated more first-class lifecycle and self-management machinery, reducing the amount OMP-QOL needs to invent.

## Delta 1 — Advisor configuration is now an explicit live-rebuild workflow

Current interactive `/advisor configure` flow:

```text
load scope WATCHDOG.yml
    ↓
edit in memory
    ↓
saveWatchdogConfigFile(scope path, doc)
    ↓
discoverAdvisorConfigs(cwd, agentDir)   # merge project + user correctly
    ↓
session.applyAdvisorConfigs(advisors, sharedInstructions)
    ↓
old runtimes stop / new roster builds in-place
```

Important: `/advisor on` and `/advisor off` are not rediscovery operations; they only toggle enabled state against the session's current stored advisor config. Therefore a QOL tool should drive the configure/save/discover/apply path, not “edit file then toggle.”

## Delta 2 — autonomous managed skills are native

Current `manage_skill` is an LLM-callable top-level tool when `autolearn.enabled` is true. It:

- creates/updates/deletes isolated managed `SKILL.md` resources;
- guards path/symlink/hardlink/size issues;
- avoids editing authored skills;
- invokes a `refreshSkills` callback after successful mutation so active interactive discovery can update immediately.

This overlaps directly with the original PrimeStyleManagement idea. OMP-QOL should not build another generic skill editor as the default path.

## Delta 3 — memory is no longer a single vague feature

Current OMP supports four memory backends (`off`, `local`, `hindsight`, `mnemopi`) with different activation semantics.

Notable lifecycle point: local `learn` writes durable lessons but explicitly does **not** mutate the active session's prompt-cache prefix; those lessons inject starting with a subsequent session. Hindsight/Mnemopi expose more live explicit operations.

Consequence: “memory self-management” must identify backend and active-state semantics instead of editing one memory file.

## Delta 4 — task-agent discovery is execution-time fresh

`resolveEffectiveSubagentPolicy()` re-runs `discoverAgents(session.cwd)` for each task/eval spawn. Current discovery reads:

- nearest project `.omp/agents/*.md`;
- user `~/.omp/agent/agents/*.md`;
- OMP extension package `agents/` roots;
- Claude marketplace plugin agents;
- bundled agents.

Thus a newly written/edited OMP task-agent definition can be observed on the next spawn without a “refresh agent definitions” command.

However, model resolution for that spawn reads live settings such as `task.agentModelOverrides` and `modelRoles`. This cleanly explains a class of stale-model failures: changing an agent file and changing config settings are not equivalent lifecycle operations.

## Delta 5 — resource-specific live refresh primitives are richer

Examples:

- Model catalog: `ModelRegistry.refresh()` and `refreshProvider()`.
- MCP: disconnect/rediscover/rebind plus server-initiated list-change refresh.
- Skills: explicit refresh after managed mutation.
- Plugins/settings UI: clears relevant plugin/capability caches and refreshes affected discovery state.
- Settings: mutation API rebuilds effective state and fires change notifications; project model-role setters persist and update live overrides.

This makes a generic OMP-QOL “refresh” command less justifiable, not more.

## Delta 6 — context/compaction extension surfaces support lossless overlays, but overlay alone does not own lifecycle

Current `ContextEvent` changes only outbound LLM messages; persisted session messages are not modified. Current compaction events expose:

- `session_before_compact.preparation` and full branch entries;
- custom compaction result / cancellation;
- `session.compacting` additional context, prompt override and `preserveData`.

This strongly supports a lossless Summary/Pin overlay. However, 17.2.12 also intentionally floors native compaction pressure by an estimate of the stored conversation. A transform-only extension cannot assume reduced provider-visible tokens will postpone native compaction. The plugin-first design therefore needs a second lifecycle step: preferably seal mature old-prefix DCP summaries into a native custom compaction result, or eventually add a narrow core contract for trusted reversible projection ownership.

## Delta 7 — session journal/tree remains a stable canonical substrate

`SessionManager` maintains an indexed append-only entry list with:

- stable `id`;
- `parentId`;
- active leaf;
- child adjacency;
- branch path reconstruction.

The gap is still at the **projection identity boundary**: context hook messages are copies without direct `SessionEntry.id` attached. That is a mapping problem, not a reason to replace the session storage model.

## Delta 8 — OMP itself now contains a benchmark metaharness

`packages/metaharness` is a benchmark manager for Harbor/edit/SnapCompact runs, traces, spend and comparative experiment arms. It is not a self-modifying harness, but it matters for OMP-QOL because it provides an upstream-native direction for **measuring** context/harness changes rather than judging them anecdotally.

Potential future leverage: use the metaharness to compare OMP-QOL context policies or autonomous harness revisions across fixed task sets, models and seeds/attempts.

## Delta 9 — append-only cache now has explicit in-place rewrite support

`AppendOnlyContextManager.syncMessages()` keeps per-message digests and preserves the longest byte-stable provider-message prefix when `transformContext` or another pass rewrites history. A deep rewrite no longer implies an automatic full-log clear.

Consequence: cache analysis for Summary/Pin should measure the **first divergence frontier and changed suffix**, not use a binary cache-hit/cache-miss model. Tail pins and compression-tool self-footprint scrubbing are therefore structurally favored over system-prefix churn or arbitrary mid-history insertion.

## Delta 10 — base prompt rebuild re-discovers ordinary context files but not startup-captured SYSTEM/APPEND file contents

`AgentSession.refreshBaseSystemPrompt()` is a real live operation. In the normal SDK path its rebuild closure re-discovers project context files such as AGENTS when those were not explicitly frozen. Skills also have a refresh path that rebuilds the prompt.

By contrast, SYSTEM/APPEND inputs are resolved into startup/session-construction strings and reused by the rebuild closure. PrimeStyle must model these as different resource lifecycles rather than a single "prompt files" category.
