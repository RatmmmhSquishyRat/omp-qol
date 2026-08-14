# Proposed SSOT Revisions — Do Not Apply Blindly

These are concrete changes recommended for the original SSOT after the remaining P0 implementation choices are made. The original uploaded proposal remains untouched under `../original/`.

## `self-managed-mode-switch/advisor-watchdog.md`

Replace uncertainty about activation with:

> OMP already has a no-restart advisor roster apply path. Native configure saves WATCHDOG, re-discovers effective project+user advisor configs, then applies them to the live session and rebuilds runtimes. `/advisor on/off` only changes enablement and is not a rediscovery mechanism. OMP-QOL should provide structured project/user advisor CRUD that invokes the same native apply path and returns active roster/model/tool verification.

## `self-managed-mode-switch/config-model-agents-refresh.md`

Replace the universal refresh framing with:

> OMP resources have different owners and activation boundaries. OMP-QOL exposes typed `mutate → apply → verify` contracts rather than a generic reload command.

Examples:

- task-agent definitions: next spawn rediscovery;
- task model overrides/model roles: live Settings owner + next resolution;
- model catalog: ModelRegistry refresh;
- advisor: WATCHDOG save/discover/live apply;
- managed skill: native mutation + refresh;
- MCP: manager reconnect/rediscover/rebind;
- AGENTS/context: file mutation + live base-prompt rebuild;
- SYSTEM/APPEND files: next session/recreate by default;
- extension source: restart-class in v1.

## `initiative-context-management/InitiativeSummary.md`

### Replace the core architecture section with two layers

> InitiativeSummary preserves OMP's canonical session journal and creates reversible compression overlays for model requests. Overlay state is persisted as append-only extension custom entries and is addressed by stable session-entry identity/provenance.
>
> A context overlay alone does not own OMP's native headroom: current OMP floors compaction pressure by stored-conversation size specifically so on-wire compression cannot hide unbounded raw history. Therefore QOL also needs a native-lifecycle integration. Plugin-first v1 should seal mature old-prefix compression summaries into a native custom compaction result when required; a future core projection-ownership seam is preferable if indefinite exact reversibility is a hard requirement.

### Add stable addressing constraint

> Current context events do not expose SessionEntry provenance and context handlers are serial. Because the final QOL delivery is an installed plugin with no guaranteed first-handler position, permanent content matching is insufficient. Use a small entry-aware provenance seam before freezing public message/range syntax.

### Add tool protocol invariant

> Range selection is semantic, but projection must be provider-protocol safe. The planner closes/rejects boundaries that would orphan tool calls/results and sanitizes provider replay metadata whenever it changes an assistant message.

### Add self-footprint rule

> The canonical compression tool call keeps its full summary argument for audit, but future model projections replace that argument with a bounded block reference and clear stale replay-bound metadata. The tool result is concise from creation time.

## `initiative-context-management/InitiativePin.md`

Replace pin-as-message-copy framing with:

> Pin is a salience intent with independent kind, scope and placement. Kinds are source, snapshot and instruction. Branch scope is the v1 default. Arbitrary source pins are rendered into provider-neutral textual context records rather than replaying raw provider toolResult/assistant protocol objects.

Placement:

- tail-zone: default, injected at the current turn request frontier;
- system: explicit high-authority/high-cache-impact instruction placement;
- anchored mid-history: experimental later.

Compaction:

> A pin affects request salience and may additionally request preservation through native/custom compaction. Ordinary native compaction receives pin guidance through current hooks; QOL custom sealing merges preserve pins deterministically.

Cache:

> Evaluate pin cost by earliest provider-message divergence + changed suffix, not binary cache invalidation.

## `initiative-context-management/PinStateTree.md`

Reclassify as:

> A control-plane policy over already-defined PinSpecs. Pin storage, provider rendering, compaction integration and addressing must work without any tree. Trees only derive the active pin set from root→active-leaf paths. Implementation remains deferred until flat pin behavior passes branch/resume/compaction/cache/task evals.

## `initiative-context-management/PrimeStyleManagement.md`

Replace unrestricted-edit framing with:

> Prime-style self-management lets the agent evolve durable **typed Managed Harness Resources** through explicit scope, activation, verification, history and rollback. It reuses OMP-native owners where possible rather than treating files as the primary API.

Resource examples:

- managed skill — immediate native refresh;
- task agent definition — next spawn;
- advisor — live WATCHDOG apply;
- model role — Settings mutation + resolution verification;
- memory — backend-specific;
- AGENTS/context instruction — file + live base-prompt rebuild;
- SYSTEM/APPEND — next-session/recreate by default;
- extension source — restart-class, not autonomous live self-edit in v1.

### Prime precedent correction

> Prime Agent's current continual harness is itself bounded: typed prompt/memory/skill/subagent refinements, scope, version/history and evidence/outcome records. The base harness remains protected. This is the useful precedent, not arbitrary live source mutation.

### Promotion rule

> Durable mutations move through candidate → activation/readback → evaluation/regression → promotion or rollback. The updater's self-assessment is evidence, not the promotion oracle. Project/user/global scopes use progressively stronger gates.
