# Test & Evaluation Plan

Correctness is necessary but not sufficient. OMP-QOL changes agent cognition and durable harness behavior, so testing must cover structural correctness, provider validity, cache economics and task outcome.

## L0 — static/source-contract tests

- Upstream baseline commit/version lock.
- Compile/type tests for host bridges.
- Golden schemas for overlay/pin/resource custom entries.
- Ensure restart-class resources cannot report `applied: true` in current session.

## L1 — pure unit tests

### Overlay reducer

- append-only create/disable/enable/remove replay;
- duplicate IDs;
- branch-path replay;
- malformed/tombstoned entries;
- non-overlapping active ranges in v1;
- shadow/coverage relationships.

### Address/provenance

- journal entry → projected message provenance;
- synthetic native compaction/branch summary provenance;
- alias generation independent of persistence ID.

### Protocol closure

- assistant call + matching result;
- multi-tool assistant with partial selected range;
- errored tool call;
- missing/dangling result detection;
- projected assistant sanitization clears replay-bound metadata when modified.

### Pin renderer

- source/snapshot/instruction;
- tool result → provider-neutral textual record;
- deterministic ordering/priority;
- branch tombstones.

## L2 — current-session integration tests

### Overlay persistence

1. create block → custom entry persisted;
2. next context projection replaces source;
3. restart/resume → reducer reconstructs same active block;
4. disable → raw source returns while unsealed;
5. branch before/after operation → expected inherited state.

### Compression self-footprint

- canonical tool call still stores original full summary;
- future projection replaces only the QOL tool summary argument;
- unrelated sibling tool calls remain;
- tool result remains concise.

### Pin

- pin appears at exact turn-frontier zone;
- latest user/steer semantics remain correct;
- source covered by compression still renders via pin;
- remove immediately changes next projection.

## L3 — native session lifecycle tests

Must include:

- new session;
- resume;
- branch/tree navigation;
- branch summary;
- manual native compaction;
- automatic threshold compaction;
- overflow recovery;
- incomplete-output recovery;
- multi-tool loop;
- queued steering/follow-up;
- another context-transforming extension loaded before QOL;
- another context-transforming extension loaded after QOL.

### Critical DCP headroom test

Construct a session where:

```text
raw stored active history  >> native threshold
QOL projected history      << native threshold
```

Verify separately:

- provider-visible prompt occupancy;
- `getContextUsage`/last provider anchor;
- stored-conversation estimate;
- native compaction decision.

This test must fail for the old assumption "overlay alone owns headroom" and become the regression fixture for architectures C/D.

## L4 — native compaction coexistence matrix

Run identical workloads under four arms:

1. native only;
2. A: QOL overlay + ordinary native compaction;
3. C: QOL overlay + custom native sealing;
4. D: core trusted projection ownership when/if implemented.

B (cancellation gate) is experimental only.

Record:

- extra summarization calls;
- raw vs projected tokens;
- number/time of native compactions;
- exact-expand availability;
- total cache read/write;
- latency/cost;
- lost-information failures.

### Custom sealing tests

- only valid old-prefix ranges can seal;
- multiple blocks merge chronologically;
- pins marked preserve survive summary;
- custom result writes a valid native boundary;
- no second LLM summary is invoked;
- QOL block records map to resulting compaction entry;
- post-seal `expand` reports correct mode/limitations.

## L5 — provider-wire validation

At minimum cover:

- Anthropic-like tool history/signatures;
- OpenAI Responses/Codex replay payloads;
- a generic OpenAI-compatible provider.

Assert:

- no orphan tool call/result;
- no stale provider payload after projected content surgery;
- transformed assistant/tool blocks serialize successfully;
- pins never masquerade as raw dangling tool results;
- compression summary synthetic message is accepted.

## L6 — cache economics

Use OMP's current append-only context manager behavior as the model.

For each transform, record first provider-level divergence and changed suffix:

- tail pin;
- system pin;
- mid-history pin;
- old-range compression;
- recent-range compression;
- compression-tool self-footprint scrub;
- expand;
- sealed native compaction.

Provider telemetry when available:

- input;
- cacheRead;
- cacheWrite;
- prompt/context tokens;
- latency.

Do not reduce this to a boolean "cache hit/miss" metric.

## L7 — behavioral agent evaluation

### DCP agency

Test whether the agent can:

- select obsolete/low-value history rather than recent crucial state;
- write a summary sufficient for future task continuation;
- choose to expand when detail is missing;
- avoid repeatedly compressing the same region;
- avoid compressing for negligible savings;
- react sanely to raw-vs-projected/native-pressure status.

### Pin behavior

Test whether the agent:

- preserves long-lived constraints;
- recalls pinned facts after large unrelated context;
- does not over-authorize historical text;
- removes obsolete pins;
- survives native compaction with preserve pins;
- achieves better task outcomes than no-pin and latest-user-repeat baselines.

### Advisor

- agent creates a specialist advisor with correct model/tools/prompt;
- live apply is verified;
- specialist actually identifies a seeded issue;
- main agent uses useful advice without blindly following bad advice.

## L8 — PrimeStyle refinement evaluation

Every durable harness candidate should have:

- diagnosis/failure evidence;
- intended mechanism;
- activation/readback proof;
- benchmark/eval evidence;
- regression cases;
- decision and rollback target.

Compare separately:

1. updater proposes better artifact;
2. host applies correct revision;
3. main solver can activate/follow artifact;
4. task score improves;
5. unrelated regressions stay within gate.

## Suggested release gates

### Context Overlay alpha

- provenance contract passes branch/resume/native-compaction cases;
- no provider protocol failures in L4/L5;
- lossless journal invariant verified;
- raw-vs-projected headroom behavior exposed in status;
- architecture C or D selected explicitly.

### Pin alpha

- tail placement stable across normal/tool-loop/steering turns;
- provider-neutral source renderer complete;
- measurable behavioral win on constraint-retention suite;
- cache overhead bounded relative to repeated-user-text baseline.

### PrimeStyle alpha

- at least three resource adapters with correct activation boundaries;
- candidate/promote/rollback lifecycle;
- no resource can claim applied without verifier;
- held-in regression suite before project promotion.
