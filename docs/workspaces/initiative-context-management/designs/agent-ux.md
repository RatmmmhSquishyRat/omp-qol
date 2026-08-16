# Agent-facing UX (draft, not frozen)

**date:** 2026-08-16
**source:** `research/agent-ux.md` (U1)
**status:** working bets. Do not freeze public names or `@syntax`.

## Tool shape

One essential `context` multi-op tool (advisor pattern: `op` enum, pure JSON, `warnings` / `action`). Pin and later tree are ops on the same tool, not 17 ACM-style verbs.

Overturn if the schema is too large for essential tools, or the host ships a native `context` name we cannot shadow.

## Envelope extras

Copy advisor: `{ ok, tool, op, summary?, error?, action?, warnings }`.

Add ICM fields on every mutating/read result that talks about size:

- `rawActiveEstimateTokens`
- `projectedEstimateTokens`
- `lastProviderPromptTokens`
- `nativeCompactionPressureTokens`
- `exactExpandAvailable` (boolean; false after C seal unless rehydrate/branch is offered)
- `firstDivergence?`

Never put prose outside JSON.

## Addresses the model types

The model types canonical ids with a kind prefix, sourced from `getBranch()`:

- `m:<entryId>` — journal message (8-hex)
- `t:<toolCallId>` — tool call
- `b:<blockId>` — our compression block

Persist `(sessionId, entryId)`. No public `@12`. No `m0001` as the typed argument. Do not inject `<dcp-message-id>` tags on every turn.

## Description vs skill

Tool description = contract (ops, address grammar, protocol-safe reject, pressure fields).
Skill = optional heuristics for *when* to compress/pin. Never a hidden policy engine.

## Approval

Dynamic by `op`: list/state/preview/inspect = `read`; compress/expand/pin/unpin/seal/march/jump = `write`.

## Failures

Protocol-unsafe range → `ok: false` + `suggestedRange` + `action`. Never silently compress extra messages.

## Auto policy

No default nudge. Pressure numbers in the envelope replace DCP “MUST compress.” Expand is a tool op, not slash-only.

## Name collisions

Do not call anything `/session pin`. On OMP that locks an **OAuth account** (`research/pin-ecosystem.md`).
