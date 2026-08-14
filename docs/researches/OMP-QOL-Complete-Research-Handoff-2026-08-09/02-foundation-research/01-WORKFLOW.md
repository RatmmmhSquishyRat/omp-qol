# Research / Engineering Workflow

## 1. Operating model

Treat every OMP-QOL proposal as a hypothesis about one of three layers:

1. **Host capability exposure** — the capability exists in core, but the model cannot conveniently invoke it.
2. **Context projection** — the capability changes only the context materialized for a model request.
3. **Durable harness state** — the capability changes persistent resources that shape future behavior.

Do not cross these layers accidentally. A context overlay should not rewrite the canonical journal. A durable harness edit should not silently claim to be active until its runtime apply path and verification query succeed.

## 2. Evidence grades

Use these grades in design docs and ADRs:

- **E0 — idea:** plausible design, no source/runtime proof.
- **E1 — source inferred:** implementation path identified in current upstream source.
- **E2 — source closed-loop:** mutation + apply + readback/verification path all identified.
- **E3 — deterministic integration:** exercised against a real OMP session/runtime without an LLM.
- **E4 — agent behavioral e2e:** a real model invokes the feature and the expected runtime behavior is observed.
- **E5 — comparative/eval:** repeated tasks show the feature improves the intended metric without unacceptable regressions.

A proposal is not “done” because E1 source inspection says it should work. QOL-002/003 already demonstrated why: L5 real-LLM e2e caught tool-surface loss that lower levels did not.

## 3. Per-feature research loop

### Step A — state the invariant before API shape

Examples:

- Summary/Pin: canonical session journal is lossless.
- Advisor: runtime semantics are OMP-native; plugin only drives them.
- Harness mutation: no promotion without readback + provenance; broader scopes require stronger validation.

### Step B — identify the native lifecycle

Record:

- source of truth;
- discovery/read path;
- mutable in-memory owner;
- existing mutation API;
- existing apply/refresh API;
- runtime boundary (immediate / next turn / next spawn / next session / restart);
- readback/verification API;
- persistence and rollback path.

### Step C — prove reachability from an extension/tool

Classify the native primitive as:

- directly reachable from extension context;
- importable but not wired to the live session owner;
- reachable only through a slash/TUI controller;
- inaccessible without a small host bridge.

Only after this classification choose plugin-only vs core seam.

### Step D — design the thinnest model-facing contract

The model should express intent, not internal OMP choreography.

Good examples:

- `advisor { action: "upsert", ... }` whose implementation uses native save/discover/apply.
- `context.compress { range, replacement }` whose implementation persists overlay state and lets the `context` hook project it.
- `resource.apply { type, ... }` only when that type has a well-defined native apply contract.

Bad example:

- a single `reload` that means different things for settings, models, MCP, extensions, skills, and task-agent definitions.

### Step E — add verification to the operation

Every mutating tool should return both mutation result and active-state evidence where possible:

- persisted = yes/no;
- applied = yes/no;
- active version/hash/config source;
- warnings;
- requires = none/next-turn/next-spawn/next-session/restart.

The agent should never need to infer “the refresh probably worked.”

### Step F — test lifecycle transitions

At minimum: current turn, next turn, branch, resume, session reload, compaction, auto-compaction, model change, project/cwd change, extension/plugin change when relevant.

## 4. Parallel research tracks

The work is intentionally separable into independently reviewable tracks:

- **Track A — upstream lifecycle:** settings/models/agents/advisor/skills/extensions/MCP/memory/system prompt.
- **Track B — context engine:** provenance/addressing, compression projection, expansion, tool-pair integrity, provider metadata sanitization, native headroom/compaction coexistence.
- **Track C — pin semantics:** pin identity, source vs snapshot, placement, cache economics, compaction behavior.
- **Track D — state controller:** PinStateTree formal semantics and persistence.
- **Track E — continual harness:** Prime Agent, Continual Harness, Self-Harness, GSME, SkillHone/SkillHEX, scope/rollback/evaluation.
- **Track F — verification:** unit/integration/real session/real LLM/eval matrices.

Cross-review rule: no track may introduce a new core abstraction unless another track demonstrates that an existing OMP native primitive cannot satisfy the lifecycle.

## 5. Source policy

For OMP behavior, current upstream source is authoritative. Documentation is useful but source and runtime probes win when they disagree.

For external harness research, prefer primary papers and official code repositories. Marketing summaries and social discussion are useful only for discovering leads, not for deciding architecture.

## 6. SSOT update policy

Original `ssot/` files remain intent documents. When a research finding changes an assumption:

1. update the relevant research doc first;
2. create/update an ADR if architecture changes;
3. only then amend the SSOT wording;
4. never erase the old reasoning—mark it superseded and link the new evidence.

## 7. Decision gate before implementation

Implementation can begin when:

- invariant is explicit;
- native lifecycle is E2 or better;
- plugin/core boundary is known;
- failure semantics are defined;
- persistence/branch/resume semantics are defined;
- a test matrix exists;
- no unresolved question could force a different storage model.

PinStateTree and autonomous global harness promotion do **not** currently pass this gate. Advisor control is close to passing it. The lossless overlay storage/projection model is strong, but Summary/DCP as a complete lifecycle feature does **not** pass until provenance and the native-headroom C-vs-D decision are closed.
