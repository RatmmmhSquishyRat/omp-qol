# Status — 2026-08-16 (workspace opened)

## One-line

Opening research is **in**. Host substrate E2, comparison steal/reject, ingest matrix, UX/eval/pin drafts. v1 leans **C**. Still open before code: sealed-expand UX, overlay event schema, billed cache run. No product code yet.

## What already exists

| Item | State |
|---|---|
| Pillars | Present. 2026-08-16 author scope appended verbatim. |
| 2026-08-09 foundation | Overlay + seal (C) vs core ownership (D); provenance gap; cache-as-frontier; protocol-safe ranges; pin kinds; tree deferred. Locked to OMP **17.2.12** / `45e12e5`. |
| DCP transcripts | Present under `docs/researches/dcp/`. Includes message-id / self-footprint / `@davecodes/pi-dcp` lead. |
| Plugin code | goal / mode / advisor only. No `context` handler, no overlay reducer, no pin tool. |
| Host bridge | Live `AgentSession` for modes/advisors. `sessionManager.buildSessionContext` / `getEntries` already typed as optional. No compaction/context provenance surface. |

## What is being done in this opening pass

- Living workspace created.
- Reference clones/junctions under `docs/ref_repos/`.
- Fan-out source research against **current** OMP 17.3.4 and comparison repos.
- Re-verify or overturn 2026-08-09 claims before any route freeze.

## Landed research

| Track | File | Result |
|---|---|---|
| H1 | `research/host-compaction.md` | 17.3.4 still floors pressure with `max(provider, stored)`. Custom `CompactionResult` still seals without a second LLM. Default strategy is now **snapcompact**. Overlay-only cannot own headroom. |
| H6 | `research/plugin-seams.md` | Plugin is thin-driver only. No `context` / `appendEntry` / `session_before_compact`. ADR-004 does not block a new overlay engine. |
| D1 | `research/dcp-opencode.md` | Transform-on-request overlay + sidecar. Steal blocks and pair-safe projection. Reject auto dedup/purge/nudge as defaults. Must deterministically scrub compress self-footprint. |
| D2 | `research/pi-dcp.md` | Both ports prove plugin `context` overlay. Vault: `appendEntry` + `m0001`/`bN`. Neither uses `session_before_compact` **or** `(sessionId, entryId)`. Auto-policy is not the product. |
| H2 | `research/host-context-event.md` | `context` = cloned messages, no entry ids. Handlers serial, no priority, installed plugins after native. `appendEntry` is durable and not sent to the LLM. `transformContext` before `convertToLlm`. `session_before_compact` has `branchEntries`. |
| H3 | `research/host-cache.md` | Longest byte-stable prefix (#3406) confirmed. Cost = first divergence + suffix. Compaction still clears the whole log. No exported divergence API. |
| H4 | `research/host-addressing.md` | Persist `(sessionId, entryId)`. Do not map `context` copies back to journal. Aliases only from `getBranch()`. Smallest seam: `ContextRecord`. Do not freeze `@N`. |
| H5 | `research/host-delta-17.3.md` | 17.2.12→17.3.4 does **not** close ICM gaps. Four core files unchanged. C still viable; D not shipped. New: late tool registration, `contextFitsModel()`, snapcompact RPC strip, `anthropicCacheRefresh`. |
| D3 | `research/opencode-acm.md` | Flat pin + sidecar DB + **head** reinjection. Steal inspection/scan/map. Reject sidecar, fixed stubs, journal mutation, no-expand. Not a pin tree. |
| D4 | `research/pin-ecosystem.md` | No shipped InitiativePin. OMP `/session pin` is **OAuth**. Codex `isPinned` is a picker flag. Draft: `designs/pin.md`. |
| E1 | `research/cache-cost.md` | Two-layer model (host divergence vs provider billed cache). Fixture: 4 arms, pin split 3 ways, 8 metrics + first divergence. Tail-cheap is still a hypothesis. Draft: `designs/eval-metrics.md`. |
| U1 | `research/agent-ux.md` | One `context` multi-op tool; advisor JSON + pressure + `exactExpandAvailable`; expand is a tool op; no default nudge. Draft: `designs/agent-ux.md`. |
| I1 | `research/ingest-2026-08-09.md` | **No 2026-08-09 ICM host finding overturned on 17.3.4.** O1–O16 stay dead. Advisor/PrimeStyle out of this program. |

Opening fan-out is complete. Tool shape and sealed expand remain working bets, not freezes.

## Must re-verify on 17.3.4 (were E1/E2 on 17.2.12)

1. ~~Native compaction pressure = `max(provider usage, stored-conversation estimate)`.~~ **Confirmed E2**
2. ~~`session_before_compact` custom `CompactionResult`.~~ **Confirmed E2** (skips snapcompact)
3. ~~`pi.appendEntry` persists and is not sent to the LLM.~~ **Confirmed E2** — H2
4. ~~`context` event has no `SessionEntry` provenance.~~ **Confirmed E2** — H2/H4
5. ~~Handlers serial, no priority, plugin not first.~~ **Confirmed E2** — H2
6. ~~Longest byte-stable provider prefix.~~ **Confirmed E2** — H3
7. `refreshBaseSystemPrompt` / SYSTEM vs AGENTS (PrimeStyle-adjacent; deferred)

## Not decided

- Sealed-block expand UX (`rehydrate` / `branch` / limited) — distinction is inherited; pick one.
- Overlay event schema + non-overlap/shadow rules.
- Public `@N` syntax (persistence identity **is** decided).
- Provider-measured cache/price (fixture designed; no billed run yet).

## Blockers for implementation

Host facts are closed. Sealed-expand has a **proposed** default (`designs/sealed-expand.md`, needs author ratification). Remaining before code: overlay event schema freeze (draft in flight), compress closure spec (draft in flight), and an E3 runtime probe of the three load-bearing hooks. Tool-shape and pin defaults are working bets, not freezes.
