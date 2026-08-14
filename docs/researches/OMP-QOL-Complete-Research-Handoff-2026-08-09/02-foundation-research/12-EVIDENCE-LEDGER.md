# Evidence Ledger

## OMP upstream lock

- Repository: `can1357/oh-my-pi`
- Commit inspected: `45e12e5bb758198a920c6070e7e64cb33b21beac`
- Coding-agent package version: `17.2.12`

## OMP primary sources and what they establish

| Source path | Finding |
|---|---|
| `packages/coding-agent/package.json` | inspected coding-agent version |
| `packages/coding-agent/src/extensibility/shared-events.ts` | compaction event/result surfaces; session lifecycle event contracts |
| `packages/coding-agent/src/extensibility/extensions/types.ts` | extension context/API; read-only session manager; `appendEntry` persistence; context event result; no context handler priority |
| `packages/coding-agent/src/extensibility/extensions/runner.ts` | context handlers are serial and later handlers receive earlier rewrites |
| `packages/coding-agent/src/session/session-manager.ts` | append-only journal/tree, stable entry IDs, active branch, `buildSessionContext` wrapper, read-only manager surface |
| `packages/coding-agent/src/session/session-context.ts` | deterministic native context reconstruction across compaction/branch/custom/reset entries |
| `packages/coding-agent/src/session/messages.ts` | provider replay normalization and `sanitizeAssistantForReparentedHistory`; basis for projected-message sanitization |
| `packages/coding-agent/src/session/session-maintenance.ts` | auto/native compaction orchestration; `session.compacting` sees raw preparation; custom hook integration |
| `packages/coding-agent/src/session/session-stats.ts` | provider-anchor context usage vs active-message estimates; history rewrite accounting |
| `packages/agent/src/compaction/compaction.ts` | `CompactionResult`; preparation; **native pressure floor `max(provider context, stored conversation estimate)`** |
| `packages/agent/src/agent-loop.ts` | transformContext → convertToLlm → provider normalize order |
| `packages/agent/src/append-only-context.ts` | stable prefix + longest byte-stable message prefix across in-place rewrites |
| `packages/coding-agent/src/session/session-advisors.ts` | live advisor controller and in-place roster rebuild |
| `packages/coding-agent/src/modes/controllers/selector-controller.ts` | native advisor configure save → discover → apply; plugin/capability refresh choreography |
| `packages/coding-agent/src/slash-commands/builtin-collaboration.ts` | advisor on/off only toggle current state; not config rediscovery |
| `packages/coding-agent/src/task/discovery.ts` | task-agent roots/precedence/discovery |
| `packages/coding-agent/src/task/structured-subagent.ts` | per-spawn agent rediscovery; live Settings/model resolution |
| `packages/coding-agent/src/config/settings.ts` | live Settings mutation, project model roles, cwd reload semantics |
| `packages/coding-agent/src/config/model-registry.ts` | model catalog/provider refresh |
| `packages/coding-agent/src/sdk.ts` | context transform wiring; live base-prompt rebuild closure; context-file re-discovery; startup-captured custom/append prompts |
| `packages/coding-agent/src/session/agent-session.ts` | `reload()` is session reopen/switch; public base-prompt refresh; session host capabilities |
| `packages/coding-agent/src/session/session-tools.ts` | skill refresh and prompt rebuild path |
| `docs/extension-loading.md` | startup-oriented extension loading, installed-plugin order, mtime-busted import when loader runs |
| `docs/advisor-watchdog.md` | advisor/WATCHDOG current documented lifecycle and roster semantics |
| `docs/compaction.md` | current native compaction model, append-only compaction entries, tool pruning, display transcript |
| `docs/config-usage.md` | config sources/precedence/lifecycle |
| `docs/task-agent-discovery.md` | agent definitions + model resolution + execution-time rediscovery |
| `docs/tools/manage_skill.md` | managed-skill CRUD + active refresh |
| `docs/memory.md` / Mnemosyne/Mnemopi docs | memory backends and differing activation boundaries |
| `docs/mcp-runtime-lifecycle.md` | MCP startup/reload/reconnect/list-change lifecycle |
| `docs/system-prompt-customization.md` | SYSTEM/APPEND/TITLE session-construction semantics |
| `packages/metaharness/README.md` | OMP-native comparative benchmark/trace infrastructure |

## OpenCode DCP comparison

- Repository: `Opencode-DCP/opencode-dynamic-context-pruning`
- Baseline commit: `85b6f5ceba144fee9e65eb28dc36cab1b960e418`

Key sources:

| Source | Finding |
|---|---|
| `lib/compress/range.ts` | range schema uses stable display IDs/block IDs; records compress message ID + call ID; stores summary block state |
| `lib/messages/prune.ts` | compressed ranges are replaced by synthetic user summary at anchor; generic tool pruning rewrites outputs/error/question inputs |

Relevant QOL delta: explicitly scrub a successful QOL compression tool's own large summary argument in future projection while leaving canonical history untouched.

## Prime Agent primary sources

Repository: `PrimeIntellect-ai/prime-agent`

Key sources:

- `README.md` — continual harness/refinement/snapshot/rollback product model.
- `packages/coding-agent/src/core/refinement/refinement.ts` — typed refinement kinds (`prompt|memory|skill|subagent`), local/global scope, versioned entries, evidence/outcome events, immutable base-harness assumption.

## External primary research surveyed

- **Continual Harness: Online Adaptation for Self-Improving Foundation Agents**, arXiv:2605.09998.
- **Harness Updating Is Not Harness Benefit: Disentangling Evolution Capabilities in Self-Evolving LLM Agents**, arXiv:2605.30621.
- **SkillHone: A Harness for Continual Agent Skill Evolution Through Persistent Decision History**, arXiv:2606.08671.
- **Self-Harness: Harnesses That Improve Themselves**, arXiv:2606.09498.
- **Self-Evolving Agent Harnesses via Gated Semantic Quality-Diversity**, arXiv:2607.13683.
- **Recursive Harness Self-Improvement**, arXiv:2607.15524.
- **SkillHEX: Improving Agent Skills via Hypothesis-Driven Autonomous Exploration and Exploitation**, arXiv:2608.05628.

These papers are used for design precedent (proposal/evaluation separation, histories, regression, scope), not as proof that a particular OMP API works.

## Reproducibility rule

Before implementing against a newer OMP commit:

1. record the new commit + coding-agent version;
2. diff all source paths above that the feature depends on;
3. re-run source-level lifecycle conclusions;
4. re-run provenance/provider-protocol/headroom integration fixtures;
5. run at least one real-session model e2e before promoting SSOT confidence.
