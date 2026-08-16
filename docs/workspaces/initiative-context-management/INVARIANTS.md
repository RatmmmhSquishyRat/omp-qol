# Invariants

These are laws. If implementation reality conflicts with one of them, **surface the tension**. Do not silently rewrite.

## From pillars (verbatim intent)

1. The agent must be able to manage its own context freely.
2. **InitiativeSummary:** the agent shall be able, at any time, to summarize any messages into any content, or expand any summary. How to use it, and how well it works, is the model's problem. The plugin's job is maximum freedom. Heuristic skills/instructions are allowed; plugin-decided automatic "this should be compressed" policy is not the product.
3. **InitiativePin:** any session message may need to be pinned (user command, system reminder, tool result, file result, agent message). The perfect shape is still open, but the principle is not: give the agent the largest possible pin/unpin freedom.
4. **PinStateTree:** trees select pin state by ancestor path. One active leaf per tree; many trees may exist; display only current path + siblings; agent marches or jumps; a leaf may pin messages or custom instructions.

## Engineering invariants (from 2026-08-09 research, still treated as working laws until disproven on current host)

5. Canonical `SessionEntry` journal is lossless. QOL never destructively deletes history.
6. Overlay state is append-only (custom session entries / tombstones), not a sidecar DB and not in-place message mutation.
7. Persist identity as `(sessionId, entryId)`, never array indexes.
8. Projection must be provider-protocol safe. Semantic range selection is not enough.
9. A pin is a salience intent, not a raw provider-message replay. Tool results render as provider-neutral text.
10. PinStateTree depends on Pin. Pin must not depend on PinStateTree.
11. Cache cost is **first divergence frontier + changed suffix**, not "rewrote history = lost all cache".
12. Transform-only on-wire compression does **not** automatically own OMP native headroom. That claim was disproven on 17.2.12 and must be re-checked on 17.3.4.

## Explicit tensions (do not paper over)

| Tension | Side A | Side B |
|---|---|---|
| Agent freedom vs DCP auto-policy | Pillar: agent decides what/when/how to compress | DCP auto-dedup / auto-error-purge / auto-nudge |
| Reversible expand vs native safety | Pillar: expand any summary | OMP floors compaction pressure by stored history |
| Thin-driver ADR-004 vs new engine | Do not emulate host features that exist | This feature does not exist; an overlay engine is new work |
| PrimeStyle in same pillar folder | Existing SSOT file | 2026-08-16 author scope is compress + pin + tree |
| Public `@message` syntax | Agents need a usable address | Provenance seam is not closed; do not freeze syntax early |
