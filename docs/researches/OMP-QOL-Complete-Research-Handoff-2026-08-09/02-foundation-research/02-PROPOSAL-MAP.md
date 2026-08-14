# Complete Proposal Map

## Existing delivered / high-confidence foundation

### QOL-001 — Agent-facing Goal

Original evidence:

- `../original/researches/omp-goal-system.md`
- `../original/plans/designs/qol-001-agent-goal-tool-design.md`
- `../original/plans/TDDs/qol-001-agent-goal-tool-tests.md`
- `../original/plans/impls/qol-001-impl-notes.md`
- `../original/ssot/adrs/ADR-001-goal-tool-shadow-delegate.md`

Architectural contribution: shadow the native model-facing name and delegate to native behavior; preserve host safety semantics; explicit registration/load-mode verification.

### QOL-002/003 — Agent-controlled Plan / Vibe

Original evidence:

- `../original/researches/omp-plan-vibe-modes.md`
- `../original/plans/designs/qol-002-003-agent-mode-control-design.md`
- `../original/plans/TDDs/qol-002-003-mode-tool-tests.md`
- `../original/plans/impls/qol-002-003-impl-notes.md`
- `../original/ssot/adrs/ADR-002-plan-vibe-extension-controllers.md`
- `../original/ssot/adrs/ADR-003-host-bridge-native-mode-control.md`
- `../original/ssot/adrs/ADR-004-thin-driver-no-emulation.md`

Architectural contribution: research moved from emulation → dual backend → thin native driver only. ADR-004 should be treated as the default law for every later “user can do it, agent cannot” QOL feature.

### Project-scoped plugin delivery

- `../original/researches/omp-project-scoped-plugins.md`

Contribution: project plugin installation/discovery/delivery mechanics and corrections. Keep delta-checking on current main because plugin/capability roots are active upstream development areas.

### Delivery testing discipline

- `../original/plans/TDDs/qol-delivery-test-plan.md`

Contribution: L1–L5 pyramid with real LLM e2e. This should be extended, not replaced, for context/harness features.

## Current proposal: self-managed mode/capability layer

### Plan / Goal / Vibe

- Intent: `../original/ssot/pillars/self-managed-mode-switch/plan-goal-vibe.md`
- Status: essentially delivered; only regression/delta maintenance remains.

### Advisor WatchDog

- Intent: `../original/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md`
- Original uncertainty: whether modified WATCHDOG config applies immediately.
- Current finding: hot-apply is native and explicit; this uncertainty is closed.
- Remaining design problem: model-facing CRUD/config + live apply through the thinnest reachable host path.

### Config / model / agents refresh

- Intent: `../original/ssot/pillars/self-managed-mode-switch/config-model-agents-refresh.md`
- Status: should not become one feature. Replace the conceptual problem with a Resource Application Matrix.
- Main insight: task agent files, model settings, model catalog, skills, MCP, extensions and system-prompt files have distinct activation boundaries.

## Current proposal: self-managed context layer

### InitiativeSummary

- Intent: `../original/ssot/pillars/initiative-context-management/InitiativeSummary.md`
- Long research: `../original/researches/omp_dcp_research_transcript.md`
- Goal: agent decides any range/message(s), timing, and replacement content; later expansion restores raw context.
- Architectural dependency: stable address layer + lossless context overlay + projection sanitizer.

### InitiativePin

- Intent: `../original/ssot/pillars/initiative-context-management/InitiativePin.md`
- Goal: any important session content/instruction can be kept salient; may affect normal request projection and compaction.
- Open design axes: source vs snapshot vs instruction, placement, scope, branch semantics, cache impact, compaction policy.
- Dependency: same stable address layer and overlay persistence as Summary.

### PinStateTree

- Intent: `../original/ssot/pillars/initiative-context-management/PinStateTree.md`
- Goal: one active leaf per tree; ancestors compose active pin state; multiple trees can coexist; agent marches/jumps.
- Recommended classification: **control plane over pins**, not part of pin storage/projection core.
- Dependency: Pin semantics must first be stable.

## Current proposal: harness self-management

### PrimeStyleManagement

- Intent: `../original/ssot/pillars/initiative-context-management/PrimeStyleManagement.md`
- Goal: agent can evolve previously static harness components such as instructions, skills, subagents and memory.
- Current correction: OMP already has structured mutable surfaces for many of these, and Prime Agent itself constrains refinement to typed harness entries with scopes/history. The useful target is not raw unrestricted mutation; it is structured autonomous resource management plus evidence/rollback/evaluation.

## Orthogonal proposal/research

### RDP performance

- `../original/researches/omp-rdp-performance-investigation.md`
- Mature independent performance workstream. It is not a dependency of context/harness self-management and should remain separate.

## Dependency graph

```text
ADR-004 thin native driver
        |
        +--> Advisor agent-facing control
        +--> typed resource apply/verify tools

SessionEntry journal + extension context hook
        |
        +--> Address Layer
                |
                +--> Summary / Expand overlay
                +--> Pin primitive
                        |
                        +--> PinStateTree controller

OMP native managed resources
(skill / memory / task agent / advisor / settings / model roles ...)
        |
        +--> Managed Harness Resource abstraction
                |
                +--> evidence + history + rollback
                +--> autonomous refinement loop
                +--> regression/evaluation gate
```
