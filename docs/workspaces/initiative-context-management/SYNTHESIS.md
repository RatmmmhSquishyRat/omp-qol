# ICM Opening Program — Synthesis

**date:** 2026-08-16
**covers:** 13 research reports (H1–H6, D1–D4, E1, U1, I1) + E3 probe (P1) + 8 design docs + 2 phases (`phase-012`, `phase-013`)
**host lock:** OMP 17.3.4 @ `de6b7974a0` (`refs/HOST-LOCK.md`)
**read this first**, then `STATUS.md` for the live gate, then the individual docs for depth.

---

## 1. What is being built

Three pillar capabilities that do **not exist** in the OMP host (pillar verbatim: `docs/ssot/pillars/initiative-context-management/`):

1. **Initiative compress** — the agent may, at any time, replace any message range in its projected context with its own summary, reversibly. The journal is never mutated.
2. **Initiative pin** — the agent may, at any time, mark anything as salient so it stays visible.
3. **Pin tree** — QoL policy layer for managing pin sets. Deferred until the two foundations stand.

ADR-004 (thin driver) does not block this: it forbids re-implementing host-owned surfaces, and none of these are host-owned.

## 2. Architecture verdict (settled)

**v1 = Architecture C: reversible overlay + native seal.**

- The overlay is a set of **custom journal events** (`pi.appendEntry`) folded into state along the branch path and applied to the outbound context inside the `pi.on("context")` hook. Fully reversible, append-only, branch-aware for free.
- Overlay alone can never own headroom: native compaction pressure is `max(provider-reported usage, stored-conversation estimate)` — the stored floor ignores projection savings, so hidden bytes still count toward the trigger. This kills Architecture A (overlay-only) permanently.
- Therefore, when native pressure fires, mature agent summaries are **sealed** into a real native `CompactionEntry` via `session_before_compact` (host skips its own LLM summarize — E3-proven). Sealing is the one door where reversibility narrows: content stays recoverable from the lossless journal, but native chronology position does not.
- **Architecture D** (host-trusted projection ownership; a `ContextRecord`/savings seam in core) stays the long-term target that would make sealing unnecessary. Not v1. Upstreaming appetite unknown.

## 3. Evidence state — what is actually proven

**E3 (runtime-proven, reproducible: `bun scripts/icm-substrate-probe.ts` from `plugin/`, 40/40 on real 17.3.4):**

- `appendEntry` — custom entries journaled with stable 8-hex `id`/`parentId`, never reach the model, survive reload, excluded from `buildSessionContext`. Returns `void` → plugin must mint its own `eventId`.
- `context` hook — receives **cloned** `AgentMessage[]` with *zero* provenance keys (key-scanned); the returned array is exactly what the model receives; journal and agent state keep originals. Nuance: mutations of received objects ARE wire-visible if the object ships in the returned array — clone isolation protects the journal, not the wire.
- `session_before_compact` — a custom `CompactionResult` is honored verbatim (`fromExtension:true`, `preserveData` intact, **zero** host summarizer calls, tail projected from our `firstKeptEntryId`); `{cancel:true}` aborts append-only-clean. The hook may even *move* the cut point — our "verbatim, never move" rule is **policy, not host constraint**.

**E2 (source-verified on the pinned worktree, not yet runtime-proven):** pressure-floor math, `session.compacting` hybrid contribution, cross-extension handler ordering, host cache digest details ("cost = first divergence + changed suffix"), invalid-id failure modes.

**Dead (verified false or rejected):** Architecture A; the 2026-08-09 proposal's O1–O16 assumptions; content-matching context clones back to journal rows; sequential `m0001` model-facing aliases; DCP default auto-dedup/purge/nudges; ACM sidecar DB + fixed stubs; OMP `/session pin` (it is an OAuth account lock, not a context pin).

## 4. The mechanism, end to end (frozen + accepted designs)

**Storage** (`designs/overlay-schema.md`, WORKING FREEZE): one customType `omp-qol.icm.overlay`; 8-op versioned event union (`compress.create/disable/enable/seal`, `pin.create/update/remove`, `overlay.reset`); plugin-minted `eventId` idempotency; summaries live **in** the event (≤64 KiB hard / 16 KiB soft); pure `fold(getBranch())` reducer producing five block states (`active-overlay / disabled / shadowed / sealed-native-compaction / invalid-source`), with `shadowed`/`invalid-source` **derived per-path** — a branch forked from before a compaction resurrects its blocks with zero reconciliation code. Unknown events: skip-and-warn + `staleSchema` mutation freeze (read-only degradation). v1: no active-block overlap, **no nesting** (recompress = disable + wider block), pins always win visibility, ranges may not cross a seal boundary. Crash-safe seal linkage via `CompactionResult.preserveData.icm` + `session_start` reconciliation.

**Addressing** (`designs/address-layer.md`): persist `(sessionId, entryId)` with `sessionId` as provenance only — never a resolution key (host `fork()` keeps entry ids under a new session id). The model types **typed canonical ids**: `m:<entryId>`, `t:<toolCallId>`, `b:<blockId>`. No `@N` public syntax yet, no XML id tag injection.

**Compress** (`designs/compress.md`, accepted with integration fixes): ops `compress / expand / state / preview / seal` in one multi-op tool. Closure is computed on the **reconstructed projection plan** (mirroring host dangling-strip and error-turn drops), turn unit = assistant slot + all paired toolResults + interrupted-thinking marker. **Zero-widening tolerance**: only endpoint swap, typed-id unit resolution, and invisible-row inclusion are auto-applied; anything adding a visible slot rejects with `suggested` + alternatives (13-reason catalog); `preview` is the free discovery path. Self-footprint scrub: projection-only rewrite of the committed call's `arguments.summary` → `"[stored in block b:<id>]"`. Rendering: one byte-stable synthetic `user` slot at the first covered position — cache cost is a one-time suffix rewrite (host digest = first divergence + changed suffix). Seal: maturity is purely positional (block fully inside the host-chosen summarized region); chronological merge; uncovered gaps inlined **verbatim** under a `min(4096 tokens, 20%)` budget, else let native run (never cancel-as-policy) with `session.compacting` hybrid contribution.

**Sealed expand** (`designs/sealed-expand.md`, PROPOSED): pre-seal expand = exact overlay-disable; post-seal default = **rehydrate** (journal-sourced content at tail, `exactExpandAvailable:false`), explicit `mode:"branch"` for byte-exact chronology. Storage-wise, rehydrate = `pin.create` over the sealed range (schema T2).

**Pin** (`designs/pin.md`, working bets; storage shape frozen as `PinSpecV1`): kinds `source | instruction | snapshot`; one provider-neutral block; tail-zone placement; branch scope; `request-only` default compaction behavior. Pin tree deferred.

**Agent UX** (`designs/agent-ux.md`, working bets): one `context` multi-op tool; advisor-style JSON envelope + pressure fields (`rawActiveEstimateTokens / projectedEstimateTokens / lastProviderPromptTokens / nativeCompactionPressureTokens`) + `exactExpandAvailable` on every sizing result; approval tiers by op (read vs write); **no default nudges** — affordances live in-band in rendered blocks and tool descriptions; heuristics go to skills, contracts go to the tool description.

## 5. Ecosystem verdicts (what we steal / reject)

| Source | Steal | Reject |
|---|---|---|
| OpenCode DCP (D1) | block concept, pair-safe projection, scrub-the-summary-argument lesson | auto-dedup/purge, nudges, `m0001`/`bN` sequential ids, turnProtection defaults |
| Pi-DCP ports (D2) | `appendEntry` persistence (pi-vault), transform-only overlay proof | whole-state snapshots, alias tables, auto-policies |
| opencode-acm (D3) | inspection tools, dual compact model | sidecar DB, fixed stubs, head-of-list reinjection, no expand |
| Pin ecosystem (D4) | nothing shipped matches; instructive negatives | standing-file pins as session pins; OAuth "pin" naming |

## 6. Cost model + evaluation (designed, not yet run)

Two cache layers: host append-only digest (divergence + suffix) and provider caches (TTL, min prefix, write multipliers; DeepSeek/GLM report no write cost). Fixture (`designs/eval-metrics.md`): four arms — native / overlay / overlay+seal / overlay+pin — per-turn metrics `raw / projected / provider / nativePressure / cacheRead / cacheWrite / firstDivergence / $`. Isolation: `PI_CONFIG_DIR` = home-relative **name**, set before host import; harness must wire coding-agent `convertToLlm` (default converter silently drops compaction summaries — probe-discovered). Hypotheses queued: tail pin cheap, system pin expensive, mid-history compress = one-time suffix cost, deep compress invalidates from anchor.

## 7. Decision ledger (compact)

| State | Items |
|---|---|
| **Frozen / working** | Architecture C (Q3); pressure floor kills A (Q1); hybrid address layer + typed canonical ids (Q2); no auto-policy defaults (Q5); overlay event schema (working freeze); compress design (accepted, integration-fixed) |
| **PROPOSED — author ratification package** | Q4 sealed-expand (rehydrate default / branch explicit); rehydrate-as-pin storage mapping (schema T2); seal gap verbatim inlining under `min(4096, 20%)` (compress T2) |
| **Working bets (freeze later)** | tool surface names (Q6); pin placement defaults (Q7); pin provider evals (Q8) |
| **Open (non-blocking)** | compress OI-1..8 (partial-slot surgery, batch, `c:` targets, hold marks, token estimator, rehydrate render, state-vs-list, snapcompact imaging); public `@N`; fixture run; PinStateTree design |

## 8. Risks

1. **Host drift** — 17.3.x minor bumps can move `session-context.ts` / compaction internals; mitigation: HOST-LOCK + delta re-check per bump (H5 pattern), probe re-run is one command.
2. **Model adoption UX** — typed ids and honest rejections are unproven at E4/E5 (no model-in-the-loop eval yet); mitigation: eval fixture + skill iteration; recorded escape hatch `acceptClosure:true` if models stall on rejects.
3. **Provider cache variance** — savings math differs per provider; fixture measures, never assumes.
4. **Multi-writer coexistence** — schema currently assumes one ICM writer per session (overturn item 8.8).

## 9. Next steps (in order)

1. **Author ratifies (or rejects) the three-item package** — §7 row 2. Rejection of Q4 in the byte-exact direction pulls Architecture D forward and reopens the seal parts of the schema.
2. TDD matrix per primitive (reducer / closure / scrub / seal / render), then Phase 4 implementation plan for the overlay engine + compress.
3. Pin (Phase 5) → pin tree (Phase 6) → skills/heuristics (Phase 7).
4. Eval fixture run (Q8) once compress is implementable — cache/cost numbers before defaults are declared final.
