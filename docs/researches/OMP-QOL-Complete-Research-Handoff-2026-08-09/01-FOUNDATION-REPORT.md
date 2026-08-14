# OMP-QOL Foundation Report — 2026-08-09


> Purpose: turn the uploaded proposal into an evidence-backed engineering program before implementation. `../original/` preserves the uploaded proposal; this `foundation/` directory is the research/control plane built around it.

## Upstream lock

- Repository: `can1357/oh-my-pi`
- Commit inspected: `45e12e5bb758198a920c6070e7e64cb33b21beac`
- `@oh-my-pi/pi-coding-agent`: **17.2.12**
- Original proposal research is mostly anchored at 17.2.4 / 17.2.8, so lifecycle conclusions were re-checked against current main.

Comparison baselines also inspected:

- `Opencode-DCP/opencode-dynamic-context-pruning@85b6f5ceba144fee9e65eb28dc36cab1b960e418`
- current `PrimeIntellect-ai/prime-agent`
- recent primary harness/self-improvement research listed in `12-EVIDENCE-LEDGER.md`.

## Proposal reframe

The proposal is best understood as three layers.

### Layer 1 — Capability exposure / thin native drivers

Let the main agent drive capabilities OMP already owns without reimplementing them in QOL.

- Goal: substantially solved.
- Plan/Vibe: substantially solved; ADR-004 remains the right law.
- Advisor/WATCHDOG: native config + live apply already exist; QOL needs an agent-facing thin entry point.
- Config/model/agent refresh: not one feature. Each resource has its own owner and activation boundary.

**Design law:**

> Expose the host's primitive. If a required primitive is inaccessible, add the smallest bridge that exposes it. Do not emulate an OMP subsystem in the plugin merely to avoid a narrow host seam.

### Layer 2 — Context projection / lifecycle

Summary/Expand and Pin should share one lossless overlay engine over the canonical `SessionEntry` journal.

But the current-main investigation adds a second requirement:

> Reversible model-request projection and native context headroom are different layers.

OMP intentionally floors native compaction pressure by stored-conversation size. Therefore a `context` transform can make the provider see a small prompt without convincing OMP that the raw active history is small.

Recommended plugin-first architecture:

```text
canonical journal (lossless)
        ↓
reversible QOL overlay: Summary / Expand / Pin
        ↓
when native lifecycle requires a boundary
        ↓
seal mature old-prefix summaries into native CompactionEntry
```

If indefinite exact reversible control of old history is a hard requirement, a narrow core projection-ownership contract is the cleaner long-term target.

### Layer 3 — Harness self-management

PrimeStyle should be a Managed Harness Resource layer, not unrestricted self-editing.

```text
inspect → validate → mutate/propose → native apply → verify → evaluate → promote/rollback
```

OMP already has useful resource owners: managed skills, task-agent discovery, advisors, Settings/model roles, model registry, MCP lifecycle, memory backends and live prompt rebuild primitives.

## Architecture-changing findings

### 1. Advisor hot apply is already native

The configure flow saves WATCHDOG, re-discovers effective user/project advisor config and applies it to the live session. `/advisor off/on` is not a rediscovery workaround.

**QOL action:** thin structured CRUD + exact native apply + readback.

### 2. `ctx.reload()` is not configuration refresh

It reopens/switches the current session file. A generic QOL `reload everything` command would encode false semantics.

### 3. Task-agent file and model-setting lifecycles differ

Task agent definitions are rediscovered each spawn. Model overrides/roles are resolved from the live Settings owner. Editing both files and assuming both became active is incorrect.

### 4. Overlay persistence is already solved

`pi.appendEntry(customType, data)` persists extension state without sending it to the model. Summary/Expand/Pin session state should use this append-only branch journal rather than a sidecar database or destructive message edits.

### 5. Stable message addressing needs explicit provenance

`buildSessionContext()` can deterministically rebuild native context, but the public `context` event does not carry source entry identity. Context handlers are serial and installed plugin ordering does not guarantee QOL is first.

**Conclusion:** content matching is useful for a prototype but is not a robust permanent contract. Add a small entry-aware provenance seam before freezing public `@message` syntax.

### 6. Transform-only DCP does not own native headroom

This is the most important correction to the initial design. OMP 17.2.12 deliberately uses the maximum of provider-visible usage and stored-conversation estimate for compaction pressure. A 150k raw / 20k projected session can still trigger native compaction.

**Recommended v1:** reversible overlay + custom native compaction sealing. See `07-CONTEXT-OVERLAY-ENGINE.md` and `14-P0-CLOSURE-NOTES.md`.

### 7. Cache behavior is more favorable and more measurable than assumed

Current append-only context handling preserves the longest byte-stable provider-message prefix after an in-place rewrite. Cache cost is therefore the first divergence frontier + changed suffix, not a binary "rewrote history = lost all cache" model.

This strongly favors tail-zone pins and tail-local self-footprint scrubbing; system-prefix churn and arbitrary mid-history pins need evidence.

### 8. Tool protocol safety must be a separate layer

Semantic range selection cannot blindly remove individual tool calls/results. Projection must close/reject invalid boundaries and sanitize provider replay metadata when modifying assistant messages. Arbitrary pinned tool results should be rendered as provider-neutral textual context, not raw standalone `toolResult` objects.

### 9. AGENTS/context and SYSTEM/APPEND are different resources

Live base-prompt rebuild can re-discover ordinary context files in the normal path. SYSTEM/APPEND file contents are startup/session-construction inputs captured as strings; writing those files is not the same live-apply operation.

### 10. Running extension source is restart-class in v1

The loader supports fresh imports when it runs, but no safe supported live teardown + event deregistration + instance replacement protocol has been established. PrimeStyle must not claim live self-edit of QOL implementation code.

### 11. Prime-style self-improvement is mainly a credit/activation problem

Prime Agent itself uses typed prompt/memory/skill/subagent refinements with scope/history/evidence. For OMP-QOL the decisive capability is not "can an LLM edit a file?" but "did the owner apply it, can the solver use it, and did evaluation show benefit without regression?"

## Recommended program order

### P0 — close architecture before surface API

1. Provenance/Address seam prototype and adversarial tests.
2. Choose DCP product target: **C (overlay + native sealing)** vs **D (trusted core projection ownership)**.
3. Prototype custom CompactionResult sealing using an already-authored DCP summary.
4. Define exact post-seal expand semantics.
5. Advisor live-apply bridge.
6. Live AGENTS/context base-prompt refresh bridge.
7. Standard Managed Resource apply/readback result.

### P1 — primitives + behavioral proof

- Summary/Expand overlay with custom-entry persistence.
- Pin source/snapshot/instruction with branch scope and turn-frontier tail placement.
- Provider protocol and cache regression suite.
- Raw-vs-projected/native-pressure headroom fixture.
- Advisor agent-facing CRUD.
- Native resource adapters.

### P2 — higher-order controllers/refinement

- PinStateTree only after flat Pin wins behaviorally.
- Managed Harness Resource revision/promote/rollback lifecycle.
- Metaharness/eval-backed self-improvement.

## Documents

- `01-WORKFLOW.md` — research/decision workflow.
- `02-PROPOSAL-MAP.md` — complete original proposal map.
- `03-UNCERTAINTY-REGISTER.md` — closed/disproven/open questions.
- `04-UPSTREAM-DELTA.md` — 17.2.12 delta from original research versions.
- `05-RESOURCE-APPLICATION-MATRIX.md` — mutate/apply/verify semantics by resource.
- `06-ADVISOR-WATCHDOG.md` — native advisor path and minimal QOL design.
- `07-CONTEXT-OVERLAY-ENGINE.md` — corrected Summary/DCP/Expand + native lifecycle architecture.
- `08-PIN.md` — pin semantics/protocol/cache/compaction.
- `09-PIN-STATE-TREE.md` — higher-order controller design/defer criteria.
- `10-PRIME-STYLE-MANAGEMENT.md` — typed Managed Harness Resources.
- `11-TEST-EVAL-PLAN.md` — correctness/provider/cache/behavior/refinement tests.
- `12-EVIDENCE-LEDGER.md` — primary-source ledger.
- `13-PROPOSED-SSOT-REVISIONS.md` — changes to apply later, not blindly.
- `14-P0-CLOSURE-NOTES.md` — detailed architecture-changing conclusions and DCP options A–D.
- `TODO.md` — prioritized implementation/research backlog.


---

# P0 Closure Notes — 2026-08-09

This note records the architecture-changing conclusions discovered after the first foundation pass. It is intentionally sharper than the original proposal: several earlier assumptions are now either closed or disproven on OMP 17.2.12.

## Baseline

- Upstream: `can1357/oh-my-pi`
- Commit inspected: `45e12e5bb758198a920c6070e7e64cb33b21beac`
- Coding agent version: `17.2.12`
- OpenCode DCP comparison baseline: `Opencode-DCP/opencode-dynamic-context-pruning@85b6f5ceba144fee9e65eb28dc36cab1b960e418`
- Prime Agent comparison baseline: current `PrimeIntellect-ai/prime-agent` repository inspected on 2026-08-09.

## 1. Stable context addressing now warrants a small core seam

The original plugin-first idea was to reconstruct the native context from `SessionEntry` and match those messages against `context` event messages.

That is no longer acceptable as the long-term contract:

1. `SessionManager` has stable entry IDs and deterministic branch reconstruction.
2. `buildSessionContext()` deterministically derives native model messages from the journal.
3. The public `context` event exposes only message copies, not source entry provenance.
4. `ExtensionRunner.emitContext()` runs context handlers serially. Each later handler sees the previous handler's rewritten messages.
5. Installed plugin entries are not guaranteed to be the first extension loaded, and `pi.on("context", handler)` has no priority argument.

Therefore an installed OMP-QOL plugin cannot safely assume that content-matching the current `event.messages` against a freshly rebuilt native context will remain unambiguous.

### Recommended seam

Add a small host/core capability that makes provenance explicit before arbitrary context rewriting. Acceptable shapes include:

```ts
interface ContextRecord {
  message: AgentMessage;
  source?: {
    entryId: string;
    kind: "message" | "compaction" | "branch-summary" | "custom-message" | "synthetic";
  };
}
```

or an equivalent sidecar:

```ts
{
  messages: AgentMessage[];
  provenance: Array<ContextMessageProvenance>;
}
```

The goal is not to leak internal journal machinery into every extension. It is to give the QOL projection engine a stable identity substrate before it performs non-trivial reversible transforms.

### Public syntax remains deferred

Do not freeze `@12`, `@m12`, `@#12`, etc. until the provenance prototype survives:

- branch and tree navigation;
- resume;
- native compaction and branch summaries;
- hidden/custom messages;
- multi-tool turns;
- retry/error turns;
- other context extensions before/after QOL.

## 2. Overlay persistence is already solved by the extension API

OMP extensions can call:

```ts
pi.appendEntry(customType, data)
```

The API is explicitly intended for state persistence and the entry is not sent to the LLM.

This is an excellent fit for an append-only overlay event log. QOL does not need a separate database for session-scoped Summary/Expand/Pin state.

Example operations:

```ts
type QolContextEvent =
  | { type: "compress.create"; blockId: string; range: RangeAddress; summary: string; ... }
  | { type: "compress.disable"; blockId: string; ... }
  | { type: "compress.enable"; blockId: string; ... }
  | { type: "pin.create"; pinId: string; spec: PinSpec; ... }
  | { type: "pin.remove"; pinId: string; ... };
```

Active state is rebuilt by replaying QOL custom entries on the active branch. This naturally inherits OMP's branch semantics.

Project/user/global persistent harness state is a different problem and should use separate typed resource stores.

## 3. The biggest correction: transform-only DCP does not own OMP headroom

OMP 17.2.12 intentionally protects native compaction from on-wire compression.

The current compaction trigger calculates effective pressure as the maximum of:

- provider-reported context usage, and
- OMP's estimate of the stored conversation.

The source comment explicitly calls out compression extensions as the reason for the floor: an extension may shrink the request sent to the provider, but OMP does not allow that to make the stored conversation grow without bound.

### Consequence

A QOL `context` overlay can make the model see 20k tokens while the canonical active history still contains 150k tokens. Native OMP may still decide that compaction is required based on the 150k stored estimate.

Therefore this statement is false:

> "If QOL compresses context in the `context` hook, native auto-compaction will automatically respect the reduced headroom."

It will not, by design.

## 4. Four architectures for DCP/native compaction coexistence

### A — Overlay only; native compaction remains authoritative

QOL Summary/Expand is reversible between native compactions. OMP eventually performs ordinary native compaction when its raw-history threshold fires.

**Advantages**

- minimal core/plugin work;
- native overflow safety untouched;
- straightforward first functional prototype.

**Problems**

- agent-authored DCP does not truly control context lifecycle;
- native compaction may summarize the same raw material again;
- a later native compaction can make exact expansion of an old region impossible in the normal native projection.

**Use:** prototype/reference arm, not preferred final architecture.

### B — Overlay plus auto-compaction cancellation gate

When auto threshold/idle compaction fires, QOL can cancel it if its projected provider-visible context remains safely below a QOL threshold. Never cancel overflow/incomplete/manual recovery.

**Advantages**

- can remain plugin-only;
- preserves reversible overlay longer.

**Problems**

- OMP's raw stored-history floor will keep rediscovering pressure, so cancellation can repeat every turn;
- creates policy conflict with the host's safety model;
- risks churn/noise and future upstream incompatibility.

**Use:** diagnostic experiment only. Do not make this the default design.

### C — Overlay plus native `CompactionEntry` sealing/materialization

QOL remains lossless and reversible while a compression block is "open". When native lifecycle pressure requires a real boundary, QOL converts a mature contiguous old-prefix set of summaries into a native custom compaction result through `session_before_compact`.

Conceptually:

```text
raw journal (never deleted)
        ↓
QOL overlay blocks (reversible working context)
        ↓ seal when lifecycle pressure requires it
custom CompactionResult / native CompactionEntry
        ↓
native active-history boundary advances
```

The custom `CompactionResult` can reuse already-authored DCP summaries instead of calling a second summarizer.

**Advantages**

- mostly plugin-native integration;
- respects OMP's own compaction lifecycle;
- removes the raw-active-history pressure that the floor is designed to detect;
- avoids paying to re-summarize already-compressed information;
- journal remains auditable/lossless.

**Tradeoff**

After sealing, `expand` can no longer mean "simply re-enable the old raw messages in the current native history projection". It becomes one of:

1. explicit rehydration into a temporary synthetic context block;
2. branch/fork to a pre-seal point;
3. future core-supported overlay ownership that can bypass/reinterpret the native boundary.

**Recommendation:** best plugin-first v1 architecture if exact indefinite expansion is not mandatory.

### D — Core-supported trusted projection ownership

Add a narrow core contract allowing an extension to report recoverable projected-history savings/provenance into context maintenance, rather than always flooring by raw stored-message estimate.

The contract must not weaken overflow safety. A possible rule:

- never report effective pressure below the last successful provider prompt occupancy;
- only count reductions backed by stable QOL block records whose source ranges are still recoverable;
- overflow/incomplete recovery may always override extension policy;
- native compaction remains fallback when projected state cannot be materialized.

**Advantages**

- cleanest long-term semantics;
- agent-authored context management can truly own headroom;
- preserves exact reversible overlays for longer.

**Cost**

- requires a carefully designed core seam;
- must be threat-modeled because it affects a safety/recovery boundary.

**Recommendation:** preferred long-term architecture if "fully agent-managed reversible context lifecycle" is a hard product requirement.

## 5. Current recommendation: C first, preserve a migration path to D

Implement the overlay engine so that blocks are independent of their materialization state:

```ts
type CompressionBlockState =
  | "active-overlay"
  | "disabled"
  | "sealed-native-compaction"
  | "invalid-source"
  | "shadowed";
```

Then v1 can use architecture C without baking native `CompactionEntry` semantics into the block model. If a future core seam implements D, active blocks can remain reversible rather than being sealed merely to satisfy host headroom accounting.

## 6. Provider/cache semantics are better than the old proposal assumed

OMP's `AppendOnlyContextManager` handles in-place context rewrites by finding the longest byte-stable provider-message prefix. It truncates/replays only from the first divergent message.

Therefore cache cost should be modeled as:

> **earliest divergence position + changed suffix**, not "did we rewrite history? yes/no".

Practical consequences:

- tail-zone pins are usually cache-friendly;
- scrubbing the compression tool's own large summary argument in the recent tail is cache-friendly;
- compressing deep old history invalidates the suffix from that compression anchor, but not necessarily the whole prompt;
- system-prompt pins can invalidate the stable system/tool prefix and should be rare/explicit;
- arbitrary mid-history pin placement needs a measured benefit before accepting its cache cost.

## 7. Tool protocol safety must be independent from semantic selection

Any arbitrary range may cross assistant tool calls and tool results. A provider-facing projection must never leave invalid dangling tool protocol.

### Compression rule

Normalize a user-selected source range to a **protocol-safe closure** before projection:

- if a removed assistant tool call has matching result(s), remove/replace the full dependency unit;
- reject or expand boundaries that would leave orphaned results/calls;
- preserve unrelated sibling tool calls in a multi-tool assistant message;
- when a modified assistant message retains only a subset of original tool blocks, strip replay-bound provider payload from the projected copy.

### Pin rule

An arbitrary source message can be pinned, including a tool result, but a pin should not reinsert a raw standalone provider `toolResult` message. Render arbitrary sources into provider-neutral textual context records such as:

```xml
<pinned-context source="entry-id" kind="tool-result">
...
</pinned-context>
```

This decouples "what information is salient" from provider protocol pairing.

## 8. Compression self-footprint should be scrubbed only in the projection

OpenCode DCP's current range compression records both the compression message ID and call ID, injects a synthetic summary at an anchor, and prunes addressed messages. Its generic tool pruning does not obviously provide a deterministic successful-compress special case that removes the large summary argument from that same successful tool call.

QOL should explicitly support this:

1. canonical session keeps the original compress tool call and full summary argument for audit;
2. next model projection rewrites only that compress tool block's `summary` argument to a bounded marker such as `[stored in block b17]`;
3. projected assistant provider replay payload is cleared/sanitized;
4. the tool result itself is concise from the start.

This eliminates the pathological "the context-compression tool adds almost the same summary twice" behavior.

## 9. Prompt resources have different live-apply semantics

A current session has a real `refreshBaseSystemPrompt()` path.

However the resources feeding it differ:

- **AGENTS/context files:** the live rebuild closure re-discovers them when `contextFiles` were not explicitly frozen by SDK options. Therefore a host bridge to `session.refreshBaseSystemPrompt()` can make normal project context edits live in the current session.
- **SYSTEM.md / APPEND_SYSTEM.md:** CLI/startup resolution has already turned them into captured strings. Rebuilding the prompt reuses those values; it does not necessarily re-read the files.
- **skills:** `refreshSkills()` re-discovers skills and rebuilds the prompt.

PrimeStyle must not flatten these into one "prompt file" resource.

## 10. Extension code remains restart-class

The extension loader can import edited source with an mtime cache-buster when the loader runs. But extension discovery/loading is startup-oriented, and `ctx.reload()` only reopens the session. No supported live teardown + handler deregistration + instance replacement protocol has been established.

Therefore v1 PrimeStyle must not autonomously self-edit the running QOL extension and claim it is active. Treat extension source mutation as:

```text
persisted: true
applied: false
effectiveAt: restart
```

until a real lifecycle is proven.

## 11. Prime-style management should manage typed resources, not files

Current Prime Agent's continual harness already uses typed kinds (`prompt`, `memory`, `skill`, `subagent`), scope, version/history, evidence and outcomes, while preserving an immutable base harness.

The OMP-QOL equivalent should expose resource adapters:

```ts
inspect -> validate -> mutate/propose -> native apply -> verify -> record -> rollback
```

Each adapter declares its activation boundary. Examples:

- skill: native `manage_skill`, immediate refresh;
- task agent definition: file-backed, next spawn rediscovery;
- advisor: WATCHDOG save/discover/live apply;
- model role: live Settings mutation + resolution verification;
- AGENTS/context: write + live prompt rebuild bridge;
- SYSTEM/APPEND: next-session/recreate unless a new owner API is added;
- extension code: restart;
- memory: backend-specific.

## 12. P0 decisions after this pass

### Closed

- Advisor roster hot apply exists natively.
- `ctx.reload()` is not a generic refresh.
- Task agent definitions re-discover each spawn.
- Overlay state can persist through custom session entries.
- Live skill refresh exists.
- MCP has its own reload/rebind lifecycle.
- `context` rewrites are cache-compatible via longest stable prefix.
- transform-only DCP does **not** automatically suppress native compaction pressure.
- AGENTS/context live rebuild and SYSTEM/APPEND file reread are different problems.
- extension source cannot be treated as safe live-self-edit in v1.

### Still architecture-level P0

1. Exact provenance/core seam for stable message addressing.
2. Choose C vs D as the product target for DCP/native headroom ownership.
3. Minimal host action for advisor `applyAdvisorConfigs` from QOL.
4. Minimal host action for `refreshBaseSystemPrompt()` where PrimeStyle needs live AGENTS/context activation.
5. Exact custom-compaction sealing format and expand UX after seal.



---

# OMP-QOL Foundation TODO

Legend: **P0** architecture/blocker, **P1** implementation/validation, **P2** higher-order/experimental.

## P0 — architecture closure

- [ ] **Provenance seam prototype:** expose source `SessionEntry` identity alongside the native early context projection. Do not permanently rely on content matching.
- [ ] **Provenance adversarial tests:** branch/tree, resume, hidden/custom messages, branch summary, native compaction, retries/errors, multi-tool turns, context transformers before/after QOL.
- [ ] **Public address syntax:** freeze only after provenance passes. Keep persisted identity as `(sessionId, entryId)` regardless of UI syntax.
- [ ] **DCP lifecycle target:** choose architecture **C (overlay + native seal)** vs **D (trusted projection ownership core seam)** as the product target. Keep A as baseline and B as experiment only.
- [ ] **Custom seal prototype:** return a QOL-authored `CompactionResult` from `session_before_compact` using an already-generated old-prefix block summary; prove no second LLM summary is required.
- [ ] **Sealed expand semantics:** choose `rehydrate`, `branch`, or explicitly limited exact expansion; expose state to model/user.
- [ ] **Advisor host bridge:** reach native `session.applyAdvisorConfigs` through existing namespace or add one minimal host action.
- [ ] **Base-prompt refresh bridge:** expose `session.refreshBaseSystemPrompt()` for live AGENTS/context activation; keep SYSTEM/APPEND file edits next-session.
- [x] **Extension live-reload classification:** no supported teardown/re-register contract proven; classify running extension source as restart-class for v1.
- [ ] **Resource apply result schema:** finalize `persisted/applied/effectiveAt/verification/warnings`.

## P0 — Context Overlay v1 design

- [x] Freeze invariant: canonical journal is lossless.
- [x] Choose append-only session custom entries as session overlay persistence.
- [ ] Freeze overlay event schemas and state transition rules.
- [ ] Define non-overlap/shadowing rule for active compression blocks.
- [ ] Define protocol-safe range closure and boundary expansion/rejection UX.
- [ ] Define provider-neutral summary wrapper and sanitizer.
- [ ] Define compression-tool self-footprint scrub using stored message/tool-call identity.
- [ ] Define projected assistant replay sanitization for Anthropic/OpenAI Responses families.
- [ ] Define state metrics: raw active estimate, projected estimate, last provider prompt, native pressure, first divergence.
- [ ] Define sealed/native block mapping and preserveData metadata.

## P1 — Context Overlay implementation

- [ ] Implement `context_compress`, `context_expand`, `context_state`, `context_preview`.
- [ ] Implement overlay reducer from active-branch QOL custom entries.
- [ ] Implement protocol-safe projection planner.
- [ ] Implement provider-neutral synthetic summary injection.
- [ ] Implement compression-tool call argument scrub in projection only.
- [ ] Implement architecture C sealing if chosen.
- [ ] Integrate pins into ordinary compaction guidance and custom sealing.
- [ ] L1 reducer/address/protocol unit tests.
- [ ] L3 branch/resume/native-compaction/tool-loop integration tests.
- [ ] L5 provider-wire tests for Anthropic-like + OpenAI Responses-like paths.
- [ ] Raw 150k / projected 20k headroom regression test.
- [ ] Measure token/cache/cost vs native-only and overlay-only arms.

## P1 — Pin v1

- [ ] Implement pin kinds: source, snapshot, instruction.
- [ ] Implement branch scope as default.
- [ ] Implement provider-neutral source renderer so arbitrary tool results can be pinned safely.
- [ ] Implement **turn-frontier tail-zone** placement first.
- [ ] Implement explicit system placement only for instruction-class pins.
- [ ] Add compaction modes such as request-only/salient/preserve.
- [ ] Define pin/compression coverage/conflict introspection.
- [ ] Add list/inspect/remove/preview.
- [ ] Benchmark tail vs system authority/cache/cost.
- [ ] Behavioral eval: constraint retention, factual recall, no authority escalation, post-compaction preservation.

## P1 — Advisor

- [ ] Effective project/user roster inspection.
- [ ] Atomic upsert/remove/shared-instruction mutation.
- [ ] Reuse native WATCHDOG parser/save/discovery.
- [ ] Invoke exact live apply path through minimal host bridge.
- [ ] Return resolved active roster/model/tool verification, not file-write success only.
- [ ] Test project/user merge/shadowing/disabled behavior.
- [ ] E2E: agent creates specialist and benefits from useful review.

## P1 — Managed resource lifecycle

- [ ] Model-facing effective model role + concrete resolution inspection.
- [ ] Settings-backed model role mutation/readback instead of raw YAML-only changes.
- [ ] Model catalog native refresh driver if needed.
- [ ] Document task-agent definition as `next_spawn` activation.
- [ ] Reuse native `manage_skill` rather than duplicate skill CRUD.
- [ ] MCP reload/reconnect wrapper only if agent control is useful.
- [ ] AGENTS/context adapter: file mutation → base-prompt refresh → effective prompt verification.
- [ ] SYSTEM/APPEND adapter: report `next_session` unless a real owner update API is introduced.
- [ ] Extension source adapter: report `restart` and never pretend live apply.

## P2 — PinStateTree

- [ ] Build control-plane only after flat Pin API/evals are stable.
- [ ] Separate reusable tree definition from session active leaf.
- [ ] March/jump/path+sibling inspection.
- [ ] Merge multiple trees/manual pins with provenance/conflict display.
- [ ] Compare against flat pin baseline before promotion.

## P2 — Prime-style Managed Harness Resources

- [ ] Define adapter interface and revision/history store.
- [ ] Start with managed skill, task agent, advisor, model role, memory.
- [ ] Add QOL supplemental instruction resource only if native AGENTS/context is insufficient.
- [ ] Session/project/user scope and candidate→promotion policy.
- [ ] Record diagnosis → patch → activation proof → evidence → outcome.
- [ ] Rollback for every durable resource.
- [ ] Weakness Mining → Proposal → Validation loop.
- [ ] Deterministic/eval-owned credit assignment where possible.
- [ ] Separate updater quality from solver activation/benefit.
- [ ] Keep autonomous live extension-code self-edit disabled until a real runtime lifecycle exists.

## P2 — Evaluation infrastructure

- [ ] Add OMP-QOL arms to `packages/metaharness` or a compatible runner.
- [ ] Fixed arms: native; overlay-only; overlay+seal; overlay+pin; tree later.
- [ ] Record task score, raw/projected/provider tokens, native pressure, cacheRead/cacheWrite, latency, actions and information-loss errors.
- [ ] Harness evolution: held-in regression + held-out/sealed evaluation as task volume permits.
