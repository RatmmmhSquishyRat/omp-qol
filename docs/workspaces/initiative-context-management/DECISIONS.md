# Decision Log

Only record decisions that are actually taken. Hypotheses stay in `questions/` or research notes.

## 2026-08-16 — Workspace placement

**decision:** Living work lives in `docs/workspaces/initiative-context-management/`.
**why:** The module is long-running, multi-track, and must not overwrite SSOT pillars or the frozen 2026-08-09 handoff.
**overturn if:** Author names a different docs home.

## 2026-08-16 — Author scope for this program

**decision:** v1 program is initiative compress + initiative pin + pin tree. PrimeStyle is adjacent, not v1.
**why:** 2026-08-16 pillar text. PrimeStyle file is not deleted.
**overturn if:** Author expands or narrows the three-piece set.

## 2026-08-16 — 2026-08-09 handoff is prior, not lock

**decision:** Inherit architecture language (overlay, seal, provenance, protocol safety, tail pin). Re-verify every host claim on 17.3.4 before freeze.
**why:** Handoff locked 17.2.12 / `45e12e5`. Current host is 17.3.4 / `de6b7974a0`.
**overturn if:** Current-host source shows the old claims still hold *and* no new seam appeared.

## 2026-08-16 — No product code in the opening pass

**decision:** This opening creates workspace + research + clones only.
**why:** P0 questions can still force a different storage/lifecycle model.
**overturn if:** A later pass closes P0 and the author says build.

## 2026-08-16 — Q1 closed: pressure floor still holds on 17.3.4

**decision:** Overlay-only (architecture A) is not a product target. Native pressure is still `max(provider usage, stored-conversation estimate)`. A plugin can seal via `session_before_compact.compaction` or veto via `cancel`, but cannot hide stored history by shrinking the wire payload.
**evidence:** E2 `research/host-compaction.md` @ host `de6b7974a0` / coding-agent 17.3.4. `compactionContextTokens` + comments naming Headroom / on-wire compression as the reason for the floor.
**new host fact:** default strategy is `snapcompact`; a custom `CompactionResult` still skips both LLM summarize and snapcompact.
**overturn if:** A later host removes the stored-estimate floor or lets extensions report trusted projected occupancy (that would reopen D as a smaller patch, or A as viable).

## 2026-08-16 — Comparison steal / reject (working laws, not a route freeze)

**steal:** transform-only `context` projection; compression blocks; pair-safe tool handling; vault-style `appendEntry` overlay; ACM-style inspect/scan/map; agent-authored summary + explicit expand.
**reject as v1 defaults:** sidecar DB as source of truth; plugin-decided auto-dedup / error-purge / threshold nudges; fixed stubs instead of agent summaries; mutating the host journal; head-of-list pin as the only placement; relying on a later LLM pass to scrub compress-tool self-footprint.
**why:** Pillar freedom + three comparison reports (D1/D2/D3) agree. ACM/DCP are neighbors, not templates.
**overturn if:** Author explicitly wants DCP-like auto-policy as the product.

## 2026-08-16 — Q2 working: hybrid address layer

**decision:** Persist `(sessionId, entryId)` only. The model types `m:<entryId>` / `t:<toolCallId>` / `b:<blockId>` from `getBranch()`, never from `context` clones and never as sequential `m0001`. One QOL handler owns compress+pin order. A host `ContextRecord` seam is desired, not a v1 blocker. Do not freeze `@N`.
**evidence:** E2 H2 + H4. U1 second pass. D1/D2 `m0001` is a neighbor defect to avoid as the typed API.
**overturn if:** Host ships provenance on `context` (then aliases can bind to those records) or `getBranch()` becomes insufficient after compaction/filter.

## 2026-08-16 — Q3 working: v1 target is C

**decision:** Implement overlay + native seal (`session_before_compact` custom `CompactionResult`). Keep block state independent of materialization so a later D seam can keep blocks reversible. Architecture A is rejected. D is not shipped on 17.3.4 and is not a v1 dependency.
**evidence:** H1 pressure floor; H5 delta (C still viable, D not shipped); pillar expand-after-seal remains Q4.
**overturn if:** Author requires indefinite exact expand in the native chronology (then D must start earlier), or host adds trusted projected occupancy.

## 2026-08-16 — Cache model confirmed

**decision:** Design and later evals treat cache cost as **first divergence + changed suffix**. Tail-zone pins and tail self-footprint scrub are the cheap default; system-prefix and mid-history edits are explicit/expensive. Native compaction still invalidates the whole append-only log.
**evidence:** E2 H3 (`AppendOnlyContextManager` #3406, unchanged 17.2.12→17.3.4).
**overturn if:** Provider dialect after `transformProviderContext` is shown to diverge from the digest, or a later host changes prefix matching.

## 2026-08-16 — Pin v1 leans (not a freeze)

**lean:** Agent-first flat pin; kinds source+instruction first; one provider-neutral block; tail-zone; branch scope; compaction request-only; tree deferred. See `designs/pin.md`.
**why:** D4 — no shipped product matches the pillar. btw dual-inject, ACM head replay, and PR 9097 raw mid-history are the anti-patterns.
**not closed:** Q7/Q8 still need provider E4/E5. If a host ships native pin, wrap it (ADR-004).

## 2026-08-16 — Overlay event schema: WORKING FREEZE (`designs/overlay-schema.md`)

**decision:** One customType `omp-qol.icm.overlay`; versioned 8-op event union (`compress.create/disable/enable/seal`, `pin.create/update/remove`, `overlay.reset`); plugin-generated `eventId` as idempotency key (verified: `appendEntry` returns `void`, `types.ts:1329`); pure `fold(getBranch())` reducer with the five overlay-engine block states; `shadowed`/`invalid-source` derived per-path, never event-driven; v1 = no active-block overlap, no nesting (recompress = disable + wider block); pins always win visibility; skip-and-warn + `staleSchema` mutation freeze for forward compat; summary durable in-event, ≤64 KiB hard / ≤16 KiB soft.
**evidence:** Main-agent spot-checks passed: `types.ts:1329` (void return), `runtime-init.ts:83–85` (return discarded), `session-manager.ts:1363–1400` (`fork()` mints new session id at `:1372`, entry ids preserved), block-state names match `overlay-engine.md` exactly.
**caveats:** T2 — the schema hard-codes the unratified Q4 proposal (seal terminal; post-seal rehydrate modeled as `pin.create` over the sealed range). Those parts inherit Q4's ratification gate. T4 folded into `address-layer.md` as an amendment (sessionId provenance-only).
**would overturn:** the 8 items in overlay-schema §8.

## 2026-08-16 — ICM substrate E3-PROVEN at runtime (`research/probe-e3-substrate.md`)

**fact:** All three load-bearing hooks pass deterministic runtime probes against the real host 17.3.4 (40/40 checks; re-run by the main agent, exit 0; `bun scripts/icm-substrate-probe.ts` from `plugin/`): (1) `appendEntry` — journaled with stable ids, never on the wire, survives reload, excluded from `buildSessionContext`; (2) `context` — cloned messages with **zero** provenance keys, transformed array is exactly what the model receives, journal untouched; (3) `session_before_compact` — custom `CompactionResult` sealed with `fromExtension:true` + `preserveData`, zero host summarizer calls, `{cancel:true}` aborts cleanly append-only.
**nuances the probe added:** (a) the hook may return a **different** `firstKeptEntryId` than the host proposed and the host honors it — compress.md's "verbatim, never move the cut" is **our policy, not a host constraint**; (b) H2 "safe to modify" means journal-safe, not wire-inert — a mutated received object that ships in the returned array reaches the wire; (c) test harnesses MUST wire the coding-agent `convertToLlm` (pi-agent-core's default silently drops compaction summaries from the wire — first probe run honestly failed on this); (d) `PI_CONFIG_DIR` is a home-relative directory **name**, not an absolute path.
**explicitly NOT upgraded (stay E2):** pressure floor math, `session.compacting` hybrid, cross-extension ordering, discovery staging, invalid-id failure mode.

## 2026-08-16 — Compress design accepted with integration fixes (`designs/compress.md`)

**decision:** Closure runs on the reconstructed projection plan mirroring host normalizations (`session-context.ts` dangling-strip / error-turn drop); turn unit = assistant slot + all paired toolResult slots + interrupted-thinking marker; **zero-widening tolerance** (only endpoint swap, typed-id unit resolution, invisible-row inclusion auto-applied; anything adding a visible slot rejects with `suggested`, per U1 — supersedes the 2026-08-09 apply-closure language, T1); `preview` = free discovery; self-footprint scrub = projection-only rewrite of `arguments.summary` → `"[stored in block b:<id>]"` correlated by `(assistantEntryId, toolCallId)`; rendering = one synthetic `user` slot, byte-stable, at first covered slot; seal maturity purely positional, `firstKeptEntryId` verbatim, no-mature → let native run + `session.compacting` hybrid (never cancel-as-policy).
**integration fixes (conflicts resolved in the schema freeze's favor, marked inline):** (1) no nesting — containment rejects, `b:` endpoints illegal for create, recompress = disable+wider; (2) pins never reject compress — accept + mandatory warning (pins win visibility); (3) straddling blocks fold `shadowed` (schema reducer), not truncated-active (draft T4 overridden).
**needs author ratification:** T2 — seal gap **verbatim** inlining under a `min(4096 tokens, 20% of region)` budget (plugin-mechanical copying inside an agent-authored summary; over budget → native runs). Fallback if rejected: custom seal only at 100% block coverage.

## 2026-08-16 — Q4 PROPOSED (not closed): sealed expand = rehydrate default, branch explicit

**proposal:** Pre-seal expand disables the overlay (exact). Post-seal expand defaults to journal-sourced **rehydrate** with `exactExpandAvailable: false` and `alternatives: ["branch"]`. See `designs/sealed-expand.md`.
**why:** Journal losslessness satisfies the pillar in content at all times; native chronology after a C seal cannot be restored in place without D. The tension is documented, not rewritten.
**status:** NEEDS AUTHOR RATIFICATION. If the author demands byte-exact in-place expand after seal, D moves forward and C becomes fallback.

## Not decided

- Sealed expand (Q4) — proposed above, awaiting ratification
- Tool surface names (Q6) — working bet only
- Public `@N` syntax
- Provider USD fixture run (Q8)
- Q4-coupled schema parts (seal terminal, rehydrate-as-pin) — ride on Q4 ratification
- Seal gap verbatim inlining + `min(4096, 20%)` budget (compress T2) — author ratification
- Compress open items OI-1..OI-8 (`designs/compress.md` §9) — OI-5 (token estimator) waits on the E3 probe
