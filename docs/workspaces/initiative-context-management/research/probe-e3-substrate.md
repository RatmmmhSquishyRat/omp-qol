# E3 Runtime Probe: ICM Substrate Hooks (appendEntry / context / session_before_compact)

**Track:** E3 verification of H1 / H2 / H4 conclusions (`research/00-index.md`)
**Date:** 2026-08-16
**Host actually executed:** `@oh-my-pi/pi-coding-agent` **17.3.4** resolved from `plugin/node_modules` (source-shipped package, `main: ./src/index.ts`; matches ref worktree `de6b7974a0`). Expected 17.3.x — confirmed exactly `17.3.4`.
**Probe:** [`plugin/scripts/icm-substrate-probe.ts`](../../../../plugin/scripts/icm-substrate-probe.ts) — standalone bun script, **not** a `bun:test` file, never joins the plugin suite.
**Evidence scale:** E0 idea → E1 inferred → E2 source closed-loop → **E3 deterministic runtime** → E4 model → E5 eval.

---

## Verdicts

| Probe | Hook under test | Verdict | Checks |
|---|---|---|---|
| 1 | `pi.appendEntry` persistence + LLM invisibility + reload survival | **PASS** | 12/12 |
| 2 | `pi.on("context")` projection (clone semantics, transformed wire, journal intact, provenance gap) | **PASS** | 11/11 |
| 3 (stretch) | `pi.on("session_before_compact")` custom `CompactionResult` seal + `{cancel:true}` arm | **PASS** | 17/17 |

All three hooks behaved exactly as the E2 research predicted, with **one construction-level discovery** (§Deltas, D1) that any future ICM test harness must copy: wire visibility of the sealed compaction summary depends on wiring the coding-agent's `convertToLlm` — the first probe run legitimately FAILED on this before the harness was corrected to match `sdk.ts`.

---

## What was constructed (all real host machinery, zero network)

The probe builds, per sub-probe, the same object graph `sdk.ts createAgentSession` builds, using the host's **own** classes from `plugin/node_modules`:

1. **Isolation first.** `process.env.PI_CONFIG_DIR = ".omp-qol-icm-probe-<ts>"` is set **before any host import**; every host module is loaded via `await import(...)` afterwards. The host's `DirResolver` resolves this name against `os.homedir()` (`packages/utils/src/dirs.ts` `getBaseConfigRoot` = `path.join(os.homedir(), getConfigDirName())`) and freezes it at first module load — so the value must be a **home-relative directory name**, not an absolute path (same convention as `plugin/test/setup.ts`). The live `~/.omp` was never touched; the isolation root is deleted at the end of the run (verified: `{"event":"cleanup","isolationRootRemoved":true}` and no stray `~/.omp-qol-icm-probe-*` dirs remain).
2. **A real extension file** (generated into the isolation root) is loaded through the host's own `loadExtensions()` (`extensibility/extensions/loader.ts`): module import → `bindExtension` → `ConcreteExtensionAPI` → default-export factory. The factory registers `context`, `session_before_compact`, `session_compact` handlers and hands the live `ExtensionAPI` back to the probe via a `globalThis` bus.
3. **A real `ExtensionRunner`** constructed with the loaded extension + runtime (constructor arguments mirror `sdk.ts:2552`).
4. **A real `Agent`** (pi-agent-core) with the host's mock provider (`@oh-my-pi/pi-ai/providers/mock`) as `streamFn` — the mock records every provider call's full `Context`, which is the probe's wire-level evidence source — plus:
   - `transformContext` mirroring `sdk.ts:3107` verbatim: `emitContext(messages)` then `wrapSteeringForModel(...)`;
   - `convertToLlm` from `@oh-my-pi/pi-coding-agent/session/messages` (see Deltas D1 — required for faithfulness).
5. **A real `AgentSession`** with `extensionRunner`, `transformContext`, `convertToLlm`, persistent `SessionManager.open(<file>.jsonl)` (so the journal is inspectable on disk), `Settings.isolated({...})`, real `AuthStorage`/`ModelRegistry`, and a **throwing `sideStreamFn` guard** so any unexpected side-channel LLM request (e.g. a summarizer call that should have been skipped) fails loudly instead of reaching the network. The guard never tripped.
6. **The host's own action wiring**: `initializeExtensions(session, {mode:"print",...})` from `modes/runtime-init.ts` — the same function the host's print/RPC modes use — binds the real `appendEntry` → `sessionManager.appendCustomEntry` action and emits `session_start`.

Mock models only; no LLM provider was contacted at any point (the mock's `streamFn` intercepts everything; the side-channel guard covers the summarizer path).

---

## Probe 1 — `appendEntry` persistence + invisibility — PASS

**Drive:** `pi.appendEntry("com.omp-qol.icm-probe", {marker, n:1})` → prompt turn 1 → `appendEntry(..., {n:2})` → prompt turn 2 → read the session JSONL from disk → reload it with a fresh `SessionManager.open` → `buildSessionContext()`.

**Observed (key evidence, verbatim):**

```json
{"probe":"probe1_appendEntry","claim":"journal contains BOTH custom entries (type=custom, customType preserved)","ok":true,"detail":{"count":2,"entries":[{"id":"a1f533d0","parentId":null,"data":{"marker":"E3-PROBE1-MARKER-a41f","n":1}},{"id":"9d84a1ef","parentId":"797df20a","data":{"marker":"E3-PROBE1-MARKER-a41f","n":2}}]}}
{"probe":"probe1_appendEntry","claim":"custom entry NEVER reached the model (no customType, no marker in any wire context)","ok":true}
{"probe":"probe1_appendEntry","claim":"reload: custom entries survive with identical ids","ok":true,"detail":{"ids":["a1f533d0","9d84a1ef"]}}
{"probe":"probe1_appendEntry","claim":"reload: buildSessionContext projection excludes custom entries","ok":true,"detail":{"projectedMessageCount":4}}
```

- **(a) Persistence:** both entries journaled as `type:"custom"` with `customType` preserved, stable unique 8-hex `id`s, `parentId` present (null for the very first journal entry — root; the post-turn entry chains onto the turn-1 assistant tail `797df20a`). Data round-trips verbatim.
- **(b) Invisibility:** the mock model was called exactly twice; positive control confirmed the user prompts DID reach the wire; neither the `customType` string nor the marker appears in any wire `Context`.
- **(c) Reload:** a fresh `SessionManager.open` on the same file returns both entries with identical ids; `buildSessionContext()` on the reloaded manager projects 4 messages (2 turns) and zero trace of the custom entries.

**vs research:** H2 hypothesis 4 and H4 §1.1 (`custom` never emitted) — confirmed at runtime, no deltas.

---

## Probe 2 — `context` hook projection — PASS

**Drive:** turn 1 (record-only mode) with a seed prompt containing `SEED-DROP-ME-c4f1`; then turn 2 in transform mode where the handler (running on the host's real `ExtensionRunner.emitContext`):
1. records the received `AgentMessage[]`,
2. **mutates a received message object in place** (appends `MUTATED-IN-PLACE-9b2d` to the turn-1 assistant text — an object that stays in the returned array),
3. returns a transformed copy: drops the seed message, appends a synthetic user-context block `SYNTHETIC-CONTEXT-BLOCK-5e8c`.

**Observed (key evidence, verbatim):**

```json
{"probe":"probe2_contextHook","claim":"context event messages expose NO entry-id provenance fields (id/entryId/parentId)","ok":true,"detail":{"checkedMessages":3,"keysPerMessage":[["role","content","attribution","timestamp"],["role","content","api","provider","model","usage","stopReason","timestamp","duration","contextSnapshot","errorId"],["role","content","attribution","timestamp"]]}}
{"probe":"probe2_contextHook","claim":"model received the TRANSFORMED sequence: synthetic block present","ok":true}
{"probe":"probe2_contextHook","claim":"model received the TRANSFORMED sequence: dropped seed absent","ok":true}
{"probe":"probe2_contextHook","claim":"in-place mutation of the (kept) received object flowed to the wire — handler owned the outbound array","ok":true}
{"probe":"probe2_contextHook","claim":"live agent state kept originals: seed present, no mutation, no synthetic","ok":true}
{"probe":"probe2_contextHook","claim":"journal on disk unchanged: original seed + original ack present, mutation + synthetic absent","ok":true}
```

- **(a) Clone semantics:** the in-place mutation of a received object never reached `session.agent.state.messages` nor the on-disk journal — `structuredClone` isolation confirmed behaviorally. Nuance: the mutation **is** wire-visible when the mutated object ships inside the returned array (the event delivers the *current chained array*; "safe to modify" means journal-safe, not wire-inert).
- **(b) Transformed wire:** provider call 2 contains the synthetic block and lacks the dropped seed — the model received exactly the handler's output (post `wrapSteeringForModel`, pre `convertToLlm`, matching the documented pipeline position).
- **(c) Journal intact:** original seed and original assistant text on disk, unchanged.
- **Provenance gap (H4):** every message object received by the handler carries only role/content/timestamp(+assistant streaming metadata like `contextSnapshot`, `errorId`) — **no `id`/`entryId`/`parentId` on any of them**, observed directly.

**vs research:** H2 hypotheses 1 & 5 and H4 §2 — confirmed at runtime. Cross-extension ordering (H2 hypothesis 2) and plugin load-order staging (hypothesis 3) were **not** exercised (single extension) and stay E2.

---

## Probe 3 (stretch) — `session_before_compact` custom result — PASS

**Drive:** two turns; `Settings.isolated({"compaction.keepRecentTokens": 1})` so the host's `findCutPoint` produces a non-empty summarize region on a tiny session; then **manual** `session.compact()` (the H1-documented invocation path — no pressure/threshold simulation needed). The hook returns a custom `CompactionResult` with our own summary `ICM-PROBE-SEALED-SUMMARY-33cc` and a **chosen** `firstKeptEntryId` (the turn-2 *user* entry, deliberately different from the host's proposed cut at the turn-2 assistant). Then one more turn to observe the next projection. Finally a second `compact()` with the hook returning `{cancel:true}`.

**Observed (key evidence, verbatim):**

```json
{"probe":"probe3_beforeCompact","claim":"session_before_compact hook fired once with host preparation + branchEntries","ok":true,"detail":{"event":{"hostFirstKeptEntryId":"b81e26ee","messagesToSummarize":2,"turnPrefixMessages":1,"isSplitTurn":true,"tokensBefore":0,"branchEntryCount":4,"branchEntryTypes":["message","message","message","message"]}}}
{"probe":"probe3_beforeCompact","claim":"hook chose its own firstKeptEntryId (differs from host's proposed cut)","ok":true,"detail":{"chosen":"7ef8f18e","hostProposed":"b81e26ee"}}
{"probe":"probe3_beforeCompact","claim":"host did NOT call the model to summarize (mock call count unchanged)","ok":true,"detail":{"before":2,"after":2}}
{"probe":"probe3_beforeCompact","claim":"session_compact notification carried fromExtension=true + our summary","ok":true,"detail":{"event":{"fromExtension":true,"entryId":"83156087","summary":"ICM-PROBE-SEALED-SUMMARY-33cc","firstKeptEntryId":"7ef8f18e"}}}
{"probe":"probe3_beforeCompact","claim":"journal: ONE CompactionEntry appended carrying our summary, fromExtension=true, chosen firstKeptEntryId, preserveData","ok":true,"detail":{"id":"83156087","fromExtension":true,"firstKeptEntryId":"7ef8f18e","preserveData":{"icmProbe":"E3"}}}
{"probe":"probe3_beforeCompact","claim":"post-compaction wire contains the sealed summary","ok":true}
{"probe":"probe3_beforeCompact","claim":"post-compaction wire keeps the tail from chosen firstKeptEntryId (turn-2 present)","ok":true}
{"probe":"probe3_beforeCompact","claim":"post-compaction wire dropped the summarized region (turn-1 absent)","ok":true}
{"probe":"probe3_beforeCompact","claim":"cancel arm: {cancel:true} aborts the pass with CompactionCancelledError","ok":true,"detail":{"errorName":"CompactionCancelledError"}}
{"probe":"probe3_beforeCompact","claim":"cancel arm: journal unchanged — still exactly ONE compaction entry, no new entries","ok":true,"detail":{"entryCount":9,"compactionCount":1}}
```

- **(a) Journaled seal:** exactly one `CompactionEntry` appended, carrying our summary, `fromExtension: true`, the **chosen** `firstKeptEntryId`, and `preserveData` verbatim. Pre-compaction turn-1 entries remain on disk (append-only confirmed).
- **(b) No host summarize:** mock call count unchanged across `compact()`; the throwing side-channel guard (`sideStreamFn`) never fired. Snapcompact was also skipped (the `fromHook` branch short-circuits it — no snapcompact artifacts appeared).
- **(c) Projection boundary:** the next provider call contains the sealed summary + the kept tail from the chosen id (turn-2 user + assistant), and the summarized turn-1 text is absent.
- **Cancel arm:** `{cancel:true}` throws `CompactionCancelledError`, fires no model call, and leaves the journal byte-identical in entry count (one compaction entry, nothing appended).
- **Bonus observations:** the hook fires on manual `compact()` even with `compaction.enabled: false` (the manual path has no enabled gate); `tokensBefore` was `0` under the zero-usage mock (ICM code must not assume it is positive); the host accepted an extension-chosen on-branch `firstKeptEntryId` without complaint (validity is the extension's responsibility, as H1 §5.3 warned — the invalid-id failure mode remains untested).

**vs research:** H1 claims 3 & 5 — confirmed at runtime on both result arms. H1 claims 1, 2 (pressure floor / wire-shrink can't suppress auto-compaction) and 4 (`session.compacting`) were **not** exercised and stay E2 (see refusals below).

---

## Deltas & surprises vs the E2 research docs

| # | Finding | Impact |
|---|---|---|
| **D1** | **First run FAILED probe 3(c) honestly**: with pi-agent-core's `defaultConvertToLlm` (what you get when constructing an `Agent` without `convertToLlm` — which is exactly how the existing integration tests build sessions), the synthetic `compactionSummary` message is **silently dropped from the wire** (`packages/agent/src/agent.ts:61` keeps only `user`/`assistant`/`toolResult`). The real host always wires the coding-agent converter (`sdk.ts:3209/3425` → `session/messages.ts convertToLlm`, which handles `compactionSummary`/`branchSummary` at `messages.ts:1272`). After mirroring that wiring, the check passed. | Any ICM harness (and any future E3 test) **must** pass `convertToLlm` from `@oh-my-pi/pi-coding-agent/session/messages` to both `Agent` and `AgentSession`, or post-compaction context assertions will be wrong. Also a real product insight: compaction-summary wire visibility is a coding-agent-layer concern, invisible at the agent-core layer. |
| **D2** | H2's "deep copy, safe to modify" needs a nuance: in-place mutation of a received context message **does** reach the model if that object remains in the handler's returned array (the event hands you the live chained array). Isolation is only from journal/agent state. | ICM overlay code should treat received arrays as owned scratch (fine to mutate) but must not assume mutations are side-effect-free on the wire. |
| **D3** | `PI_CONFIG_DIR` is a **home-relative directory name**, not an absolute path (`dirs.ts getBaseConfigRoot` = `join(homedir, name)`). The probe-order instruction "set it to `join(os.homedir(), ...)`" would break on Windows (`path.join` of two absolute paths); the bare-name convention from `test/setup.ts` is the correct one and was used. | Isolation recipes must set the name, not the absolute path. |
| **D4** | `prepareCompaction` accepts a **turn-prefix-only** cut: the cancel-arm's second preparation had `messagesToSummarize: 0` with `turnPrefixMessages: 1` and still fired the hook (the no-op guard requires *both* empty). | Seal logic must handle preparations where the summarize region is only a split-turn prefix. |
| **D5** | Manual `compact()` fires `session_before_compact` even with `compaction.enabled: false`; `tokensBefore` can be `0`; assistant messages in the context event carry extra runtime keys (`contextSnapshot`, `errorId`) but still no journal identity. | Minor contract details for ICM implementation; none contradict H1/H2/H4. |

---

## Claim upgrade table (E2 → E3)

Upgrades apply **only** to what the probe runtime-asserted; everything else explicitly stays E2.

| Source doc | Claim | Was | Now | Basis |
|---|---|---|---|---|
| H2 #4 / H4 §1.1 | `pi.appendEntry` persists a `type:"custom"` journal entry with stable `id`/`parentId`; never sent to LLM; survives reload; excluded from `buildSessionContext` | E2 | **E3** | Probe 1 (12 checks) |
| H2 #1 / H4 §2 | `context` delivers cloned `AgentMessage[]`; mutations cannot corrupt journal or agent state; **no** entry-id provenance on any message | E2 | **E3** | Probe 2 (clone-mutation checks + key-scan of every received message) |
| H2 #5 | `transformContext` (extension `context`) runs before `convertToLlm`/provider normalization; handler-returned arrays are exactly what the provider receives | E2 | **E3** | Probe 2 (synthetic AgentMessage inserted at context stage arrived converted on the wire; dropped message absent) |
| H1 #3 (custom-result arm) | `session_before_compact` → `{compaction: CompactionResult}` seals without any host summarize (no LLM, no snapcompact), `fromExtension: true` journaled, `preserveData` persisted | E2 | **E3** | Probe 3 (mock call count frozen; side-channel guard silent; journal fields verbatim) |
| H1 #3 (cancel arm) | `session_before_compact` → `{cancel: true}` aborts with `CompactionCancelledError`, journal untouched | E2 | **E3** | Probe 3 cancel-arm checks |
| H1 #5 / H4 §3 | Compaction is append-only; `firstKeptEntryId` (including an extension-chosen on-branch id) governs the next projection: summary + kept tail, summarized region absent | E2 | **E3** | Probe 3 (journal diff + post-compaction wire) |
| H2 #2 | Handlers chain serially across **multiple extensions** in load order, no priority | E2 | **E2 (refused)** | Only one extension was loaded; single-handler replacement observed, cross-extension order not exercised |
| H2 #3 | Installed plugins load in discovery stage 3, never first | E2 | **E2 (refused)** | Probe loads explicit paths; discovery staging not exercised |
| H1 #1, #2 | Compaction pressure = `max(provider usage, stored estimate)`; wire shrink cannot suppress auto-compaction | E2 | **E2 (refused)** | Probe used the manual `compact()` path only; threshold/pressure math never executed |
| H1 #4 | `session.compacting` adds context/prompt/preserveData but cannot replace the summarize set | E2 | **E2 (refused)** | That hook only fires on the LLM-summarize path, which the probe deliberately never runs (no-network rule) |
| H1 §5.3 | Host does **not validate** extension `firstKeptEntryId`; bad ids break projection | E2 (inference) | **E2 (refused)** | Probe only supplied a *valid* on-branch id; the failure mode was not exercised |

---

## How to re-run

```powershell
cd C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\plugin
bun scripts/icm-substrate-probe.ts
```

- Exit code 0 ⇔ every check in every probe passed; per-check lines are `PROBE_EVIDENCE {json}`, final line before cleanup is `PROBE_SUMMARY {json}`.
- The script freezes `PI_CONFIG_DIR` onto a fresh `~/.omp-qol-icm-probe-<timestamp>` before importing any host module, refuses to run if that would overlap `~/.omp`, and deletes the directory in a `finally` (evidence line `{"event":"cleanup","isolationRootRemoved":true}`).
- It is a plain bun script with no `bun:test` imports; `plugin/bunfig.toml`'s test preload does not apply to it and it can never join `bun test`.
- Deterministic: scripted mock responses only, one mock `streamFn` for the agent, a throwing guard for the side-channel `sideStreamFn`. No API keys used beyond the inert literal `"test-key"`; no network.

## Residual gaps for later E3+ work

1. Auto-compaction pressure floor (H1 #1/#2): needs a harness that manufactures a large stored estimate or a tiny-context-window mock model and observes `runAutoCompaction` — deliberately out of scope here.
2. `session.compacting` merge semantics (H1 #4): requires letting the host run a real summarizer; would need a scripted side-channel mock rather than a throwing guard.
3. Cross-extension `context` ordering and plugin discovery staging (H2 #2/#3): load ≥2 extensions / exercise `discoverExtensionPaths`.
4. Invalid `firstKeptEntryId` failure mode (H1 §5.3): supply an off-branch id and observe `buildSessionContext` breakage — destructive-by-design, keep isolated.
