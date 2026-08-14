# InitiativePin — Foundation Design

## 1. What a pin is

A pin is a **salience intent**, not a copied message and not inherently a system prompt mutation.

Separate identity from placement and scope.

### Pin kinds

```ts
type PinKind =
  | "source"       // references canonical SessionEntry/range
  | "snapshot"     // immutable provider-neutral rendered content captured now
  | "instruction"; // newly authored instruction text
```

Why all three matter:

- source pins follow the canonical source and preserve provenance;
- snapshot pins intentionally freeze what was important at pin time;
- instruction pins are directives, not references to conversation history.

## 2. Scope

### v1 default: branch scope

Because QOL session state can be reconstructed from custom entries on the active `SessionEntry` branch, branch scope gives clean natural semantics:

- create a pin on branch A → descendants inherit it;
- navigate to a sibling created before the pin → it is absent;
- remove pin → descendants after removal see the tombstone.

Explicit later scopes:

- session-wide;
- PinStateTree-derived;
- project/user persistent via Managed Harness Resources.

Do not make project/global persistence an accidental side effect of a session pin.

## 3. Provider-safe source rendering

"Any message can be pinned" does **not** mean "reinsert that original provider message object anywhere."

A source pin should render canonical information into a provider-neutral context record:

```xml
<pinned-context id="p3" source="entry-id" kind="assistant|user|tool-result|...">
...
</pinned-context>
```

This is particularly important for tool results. A standalone raw `toolResult` outside its original tool-call protocol can produce invalid provider history; a textual context record carries the information without pretending it is a live tool protocol item.

Snapshot pins use the same renderer but persist the rendered payload.

## 4. Placement modes

### Tail-zone — v1 default

"Tail" should not mean blindly append after the user's latest request.

Recommended definition:

> Inject the combined pin block immediately before the current turn's request frontier — after older completed history, but before the latest user/steer instruction that the model is currently answering.

For a tool-loop continuation in the same turn, keep the pin block associated with that turn frontier so the latest actual request remains semantically recognizable and the pin stays recent.

Benefits:

- high recency/salience;
- preserves ordinary user request as the last actual request;
- usually moves the cache divergence frontier close to the tail;
- independent of provider-specific system/developer caching behavior.

Exact placement should be validated against steering/follow-up/tool-loop messages.

### System — explicit high-authority mode

Only instruction-class pins should default to being eligible for system placement.

Costs:

- changes stable prompt prefix;
- potentially large cache-write penalty;
- can over-authorize what was originally mere historical evidence;
- frequent churn is undesirable.

Use for truly standing constraints, not ordinary facts.

### Anchored mid-history — experimental

Potential value: restore information near the semantic phase where it belongs.

Costs:

- earliest divergence moves deeper into the cache;
- ordering/protocol interactions become harder;
- unclear behavioral advantage over tail re-injection.

Defer until an eval demonstrates a win.

## 5. Pin projection block

Prefer one bounded synthetic block containing all effective pins in deterministic order rather than N extra provider messages.

Example ordering:

1. instruction pins by explicit priority;
2. source/snapshot pins by creation order or stable ID;
3. PinStateTree-derived pins with tree/path provenance.

Every item should carry a short source label so the model can distinguish user/project instruction from remembered evidence.

## 6. Cache model

The correct question is not "does pinning break cache?" but:

> Where is the first provider-level serialized message that changes?

Track:

- first divergence index/token offset;
- changed suffix tokens;
- stable system/tool prefix fingerprint changes;
- provider cacheRead/cacheWrite.

Expected ranking:

```text
tail-zone pin   ≪   mid-history pin   ≪/varies   system-prefix churn
```

This is a hypothesis to measure, not a provider-universal law.

## 7. Interaction with compression

A source pin can reference content inside an active compressed block.

Recommended behavior:

- compression removes the raw region from ordinary projection;
- the pin separately renders the specifically salient source information;
- block summary does not need to duplicate the entire pin payload;
- inspection shows provenance: `pin p3 source covered by compression b17`.

If an entire block summary is pinned, pin the block/snapshot explicitly rather than creating an ambiguous source-range pin.

## 8. Interaction with native compaction

Pins have two distinct purposes:

1. **request salience** — inject in normal context projection;
2. **compaction preservation** — tell native/custom compaction which constraints must survive the boundary.

Suggested modes:

```ts
type PinCompactionMode =
  | "request-only"
  | "salient"   // tell summarizer to preserve meaning
  | "preserve"; // stronger explicit preservation requirement
```

Exact names can change.

For ordinary native compaction, add active pin guidance through `session.compacting` extra context/prompt. For QOL custom sealing, merge required pins into the sealed summary/preserve metadata deterministically.

After a source range is sealed by native compaction, the pin can still render from canonical journal provenance because the journal is not deleted. It should not rely on that source being in the ordinary native `buildSessionContext()` output.

## 9. Pin lifecycle

```ts
interface PinSpec {
  id: string;
  kind: "source" | "snapshot" | "instruction";
  source?: EntryAddress | RangeAddress;
  content?: string;
  scope: "branch" | "session";
  placement: "tail" | "system" | "anchor";
  compaction: "request-only" | "salient" | "preserve";
  priority?: number;
}
```

Operations:

- create;
- inspect/list;
- remove (append tombstone);
- optionally enable/disable;
- preview effective projection.

## 10. Behavioral evaluation

Token savings alone cannot validate Pin.

Tasks should test whether the model:

- preserves a constraint across long unrelated work;
- correctly recalls a pinned factual/tool observation;
- does not treat historical evidence as a higher-authority instruction;
- survives native compaction while preserving designated constraints;
- avoids unnecessary pins and removes obsolete pins when asked;
- behaves better than simply repeating the same text in the latest user prompt.

Measure behavior + token/cache cost together.

## 11. PinStateTree dependency

Pin implementation must be complete without any tree.

PinStateTree should only decide **which PinSpecs are active**. It must not own storage, provider rendering, compaction, addressing or protocol safety.
