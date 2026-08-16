# Sealed expand (Q4) — PROPOSAL, needs author ratification

**date:** 2026-08-16
**depends on:** H1 `host-compaction.md`, H4 `host-addressing.md`, I1 HD12, pillar `InitiativeSummary.md`
**status:** proposed default. This is a pillar-tension decision; do not treat as silently closed.

## The tension (surfaced, not rewritten)

**Pillar:** the agent shall be able, at any time, to expand any summary.

**Host fact (E2, 17.3.4):** an architecture-C seal appends a native `CompactionEntry`; from then on `buildSessionContext` starts the active history at `firstKeptEntryId`. The journal keeps every raw entry (lossless), but the sealed range is no longer part of the native chronology the model sees.

So after a seal the pillar is satisfiable in **content** at any time (journal is lossless; we can always re-render the original entries), but **not** in *native chronology position* without a branch or a future architecture-D core seam. Under C this situation is unavoidable: when native pressure fires, the options are seal with our summaries, cancel (unsafe as policy), or let the host summarize its own boundary — all three create a boundary.

## Proposed semantics

| Phase | `expand b:<blockId>` behavior | Envelope |
|---|---|---|
| **Pre-seal** | Disable the overlay block. Raw source returns to the next projection. Exact, cheap, reversible. | `exactExpandAvailable: true`, `expandMode: "overlay-disable"` |
| **Post-seal (default)** | **Rehydrate**: render the original entries from the journal into one provider-neutral block at the tail zone. Content-exact, position-synthetic. | `exactExpandAvailable: false`, `expandMode: "rehydrate"`, `alternatives: ["branch"]` |
| **Post-seal (explicit)** | `mode: "branch"`: navigate/fork to a pre-seal branch point for byte-exact chronology. Expensive (context replay). May be absent in v1 if the branch drive is not cleanly reachable; then `alternatives` omits it and says so. | `expandMode: "branch"` |

Never present sealed and unsealed expand as the same operation. Every `state` / `list` result carries per-block `state` and `exactExpandAvailable`.

## Cache note

Rehydrate at tail = divergence near the tail (cheap, H3). Branch = full context replay (expensive, explicit).

## What would overturn this

- Author rules that byte-exact in-place expand after seal is a hard pillar requirement → architecture D must be pulled forward; C becomes fallback.
- Host ships trusted projection ownership (D seam) → sealed blocks can stay reversible and this doc collapses to the pre-seal row.

## Ratification

**NEEDS AUTHOR RATIFICATION** — this chooses how the pillar's "expand any summary" degrades after a native boundary. Recorded as *proposed* in `DECISIONS.md` until then.
