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
