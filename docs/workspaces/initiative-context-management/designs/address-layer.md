# Address Layer (draft, not frozen public syntax)

**date:** 2026-08-16
**depends on:** H2 `host-context-event.md`, H4 `host-addressing.md`, D1/D2 alias practice
**status:** working design for persistence + model-facing aliases. Public `@N` is **not** frozen.

## Persistence identity

Always store:

```ts
interface EntryAddress {
  sessionId: string;
  entryId: string; // SessionEntry.id, 8-hex
}

interface RangeAddress {
  sessionId: string;
  startEntryId: string;
  endEntryId: string;
}
```

Never persist context-array indexes, `m0001` aliases, or `@12` numbers.

## How the plugin sees entries

Do **not** recover identity from `context` event messages. Those are `structuredClone`d `AgentMessage[]` with no `entryId`.

Do:

1. Read the active branch via `sessionManager.getBranch()` / `getEntries()`.
2. Build overlay-local aliases from that journal walk.
3. Persist compress/pin ops as `appendEntry` events that cite `entryId`.
4. On the next `context` hook, replay overlay state and rewrite the cloned messages by reconstructing the native projection from the journal, then applying blocks — not by matching cloned text.

`session_before_compact` already includes `branchEntries` (H2). Seal/address work that needs journal ids should prefer that event over `context`.

## What the model types

U1 (second pass): the model types **typed prefixes on canonical ids**, not a DCP sequence.

| Thing | Persist | Model argument |
|---|---|---|
| Journal message | `(sessionId, entryId)` | `m:<entryId>` |
| Tool call | `toolCallId` | `t:<toolCallId>` |
| Compression block | our `blockId` | `b:<blockId>` |

Do **not** make `m0001` what the model types. A sequential short label may appear in `list` as unstable display only; mutate paths still accept `entryId` / `m:<entryId>`.

Do not default-inject XML id tags into every outbound message (DCP does; it costs tokens and couples the model to a rebuilt table).

If another context extension runs first, QOL still addresses from `getBranch()`, not from the rewritten wire array. One handler owns compress+pin. Long-term: host `ContextRecord` provenance.

## Smallest host seam (not a v1 blocker)

```ts
interface ContextRecord {
  message: AgentMessage;
  source?: {
    entryId: string;
    kind: "message" | "compaction" | "branch-summary" | "custom-message" | "synthetic";
  };
}
```

Thread this through `ContextEvent` / `transformContext`. v1 can ship without it if identity always comes from the journal. Do not freeze `@12` until this seam (or an equivalent) survives branch/resume/compaction/multi-tool/retry/other extensions.

## Rejected

- Content-matching context copies to journal rows as the permanent contract
- ACM-style substring message ids
- Sidecar maps as the only identity store
- Head-of-list pin identity (placement is a different draft)
