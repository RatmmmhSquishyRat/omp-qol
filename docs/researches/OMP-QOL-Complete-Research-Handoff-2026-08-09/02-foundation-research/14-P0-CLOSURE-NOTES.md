# P0 Closure Notes — 2026-08-09

This note records the architecture-changing conclusions discovered after the first foundation pass. It is intentionally sharper than the original proposal: several earlier assumptions are now either closed or disproven on OMP 17.2.12.

## Baseline

- Upstream: `can1357/oh-my-pi`
- Commit inspected: `45e12e5bb758198a920c6070e7e64cb33b21beac`
- Coding agent version: `17.2.12`
- OpenCode DCP comparison baseline: `Opencode-DCP/opencode-dynamic-context-pruning@85b6f5ceba144fee9e65eb28dc36cab1b960e418`
- Prime Agent comparison baseline: current `PrimeIntellect-ai/prime-agent` repository inspected on 2026-08-09.

## 1. Stable context addressing now warrants a small core seam

The original plugin-first idea was to reconstruct the native context from `SessionEntry` and match those messages against `context` event messages.

That is no longer acceptable as the long-term contract:

1. `SessionManager` has stable entry IDs and deterministic branch reconstruction.
2. `buildSessionContext()` deterministically derives native model messages from the journal.
3. The public `context` event exposes only message copies, not source entry provenance.
4. `ExtensionRunner.emitContext()` runs context handlers serially. Each later handler sees the previous handler's rewritten messages.
5. Installed plugin entries are not guaranteed to be the first extension loaded, and `pi.on("context", handler)` has no priority argument.

Therefore an installed OMP-QOL plugin cannot safely assume that content-matching the current `event.messages` against a freshly rebuilt native context will remain unambiguous.

### Recommended seam

Add a small host/core capability that makes provenance explicit before arbitrary context rewriting. Acceptable shapes include:

```ts
interface ContextRecord {
  message: AgentMessage;
  source?: {
    entryId: string;
    kind: "message" | "compaction" | "branch-summary" | "custom-message" | "synthetic";
  };
}
```

or an equivalent sidecar:

```ts
{
  messages: AgentMessage[];
  provenance: Array<ContextMessageProvenance>;
}
```

The goal is not to leak internal journal machinery into every extension. It is to give the QOL projection engine a stable identity substrate before it performs non-trivial reversible transforms.

### Public syntax remains deferred

Do not freeze `@12`, `@m12`, `@#12`, etc. until the provenance prototype survives:

- branch and tree navigation;
- resume;
- native compaction and branch summaries;
- hidden/custom messages;
- multi-tool turns;
- retry/error turns;
- other context extensions before/after QOL.

## 2. Overlay persistence is already solved by the extension API

OMP extensions can call:

```ts
pi.appendEntry(customType, data)
```

The API is explicitly intended for state persistence and the entry is not sent to the LLM.

This is an excellent fit for an append-only overlay event log. QOL does not need a separate database for session-scoped Summary/Expand/Pin state.

Example operations:

```ts
type QolContextEvent =
  | { type: "compress.create"; blockId: string; range: RangeAddress; summary: string; ... }
  | { type: "compress.disable"; blockId: string; ... }
  | { type: "compress.enable"; blockId: string; ... }
  | { type: "pin.create"; pinId: string; spec: PinSpec; ... }
  | { type: "pin.remove"; pinId: string; ... };
```

Active state is rebuilt by replaying QOL custom entries on the active branch. This naturally inherits OMP's branch semantics.

Project/user/global persistent harness state is a different problem and should use separate typed resource stores.

## 3. The biggest correction: transform-only DCP does not own OMP headroom

OMP 17.2.12 intentionally protects native compaction from on-wire compression.

The current compaction trigger calculates effective pressure as the maximum of:

- provider-reported context usage, and
- OMP's estimate of the stored conversation.

The source comment explicitly calls out compression extensions as the reason for the floor: an extension may shrink the request sent to the provider, but OMP does not allow that to make the stored conversation grow without bound.

### Consequence

A QOL `context` overlay can make the model see 20k tokens while the canonical active history still contains 150k tokens. Native OMP may still decide that compaction is required based on the 150k stored estimate.

Therefore this statement is false:

> "If QOL compresses context in the `context` hook, native auto-compaction will automatically respect the reduced headroom."

It will not, by design.

## 4. Four architectures for DCP/native compaction coexistence

### A — Overlay only; native compaction remains authoritative

QOL Summary/Expand is reversible between native compactions. OMP eventually performs ordinary native compaction when its raw-history threshold fires.

**Advantages**

- minimal core/plugin work;
- native overflow safety untouched;
- straightforward first functional prototype.

**Problems**

- agent-authored DCP does not truly control context lifecycle;
- native compaction may summarize the same raw material again;
- a later native compaction can make exact expansion of an old region impossible in the normal native projection.

**Use:** prototype/reference arm, not preferred final architecture.

### B — Overlay plus auto-compaction cancellation gate

When auto threshold/idle compaction fires, QOL can cancel it if its projected provider-visible context remains safely below a QOL threshold. Never cancel overflow/incomplete/manual recovery.

**Advantages**

- can remain plugin-only;
- preserves reversible overlay longer.

**Problems**

- OMP's raw stored-history floor will keep rediscovering pressure, so cancellation can repeat every turn;
- creates policy conflict with the host's safety model;
- risks churn/noise and future upstream incompatibility.

**Use:** diagnostic experiment only. Do not make this the default design.

### C — Overlay plus native `CompactionEntry` sealing/materialization

QOL remains lossless and reversible while a compression block is "open". When native lifecycle pressure requires a real boundary, QOL converts a mature contiguous old-prefix set of summaries into a native custom compaction result through `session_before_compact`.

Conceptually:

```text
raw journal (never deleted)
        ↓
QOL overlay blocks (reversible working context)
        ↓ seal when lifecycle pressure requires it
custom CompactionResult / native CompactionEntry
        ↓
native active-history boundary advances
```

The custom `CompactionResult` can reuse already-authored DCP summaries instead of calling a second summarizer.

**Advantages**

- mostly plugin-native integration;
- respects OMP's own compaction lifecycle;
- removes the raw-active-history pressure that the floor is designed to detect;
- avoids paying to re-summarize already-compressed information;
- journal remains auditable/lossless.

**Tradeoff**

After sealing, `expand` can no longer mean "simply re-enable the old raw messages in the current native history projection". It becomes one of:

1. explicit rehydration into a temporary synthetic context block;
2. branch/fork to a pre-seal point;
3. future core-supported overlay ownership that can bypass/reinterpret the native boundary.

**Recommendation:** best plugin-first v1 architecture if exact indefinite expansion is not mandatory.

### D — Core-supported trusted projection ownership

Add a narrow core contract allowing an extension to report recoverable projected-history savings/provenance into context maintenance, rather than always flooring by raw stored-message estimate.

The contract must not weaken overflow safety. A possible rule:

- never report effective pressure below the last successful provider prompt occupancy;
- only count reductions backed by stable QOL block records whose source ranges are still recoverable;
- overflow/incomplete recovery may always override extension policy;
- native compaction remains fallback when projected state cannot be materialized.

**Advantages**

- cleanest long-term semantics;
- agent-authored context management can truly own headroom;
- preserves exact reversible overlays for longer.

**Cost**

- requires a carefully designed core seam;
- must be threat-modeled because it affects a safety/recovery boundary.

**Recommendation:** preferred long-term architecture if "fully agent-managed reversible context lifecycle" is a hard product requirement.

## 5. Current recommendation: C first, preserve a migration path to D

Implement the overlay engine so that blocks are independent of their materialization state:

```ts
type CompressionBlockState =
  | "active-overlay"
  | "disabled"
  | "sealed-native-compaction"
  | "invalid-source"
  | "shadowed";
```

Then v1 can use architecture C without baking native `CompactionEntry` semantics into the block model. If a future core seam implements D, active blocks can remain reversible rather than being sealed merely to satisfy host headroom accounting.

## 6. Provider/cache semantics are better than the old proposal assumed

OMP's `AppendOnlyContextManager` handles in-place context rewrites by finding the longest byte-stable provider-message prefix. It truncates/replays only from the first divergent message.

Therefore cache cost should be modeled as:

> **earliest divergence position + changed suffix**, not "did we rewrite history? yes/no".

Practical consequences:

- tail-zone pins are usually cache-friendly;
- scrubbing the compression tool's own large summary argument in the recent tail is cache-friendly;
- compressing deep old history invalidates the suffix from that compression anchor, but not necessarily the whole prompt;
- system-prompt pins can invalidate the stable system/tool prefix and should be rare/explicit;
- arbitrary mid-history pin placement needs a measured benefit before accepting its cache cost.

## 7. Tool protocol safety must be independent from semantic selection

Any arbitrary range may cross assistant tool calls and tool results. A provider-facing projection must never leave invalid dangling tool protocol.

### Compression rule

Normalize a user-selected source range to a **protocol-safe closure** before projection:

- if a removed assistant tool call has matching result(s), remove/replace the full dependency unit;
- reject or expand boundaries that would leave orphaned results/calls;
- preserve unrelated sibling tool calls in a multi-tool assistant message;
- when a modified assistant message retains only a subset of original tool blocks, strip replay-bound provider payload from the projected copy.

### Pin rule

An arbitrary source message can be pinned, including a tool result, but a pin should not reinsert a raw standalone provider `toolResult` message. Render arbitrary sources into provider-neutral textual context records such as:

```xml
<pinned-context source="entry-id" kind="tool-result">
...
</pinned-context>
```

This decouples "what information is salient" from provider protocol pairing.

## 8. Compression self-footprint should be scrubbed only in the projection

OpenCode DCP's current range compression records both the compression message ID and call ID, injects a synthetic summary at an anchor, and prunes addressed messages. Its generic tool pruning does not obviously provide a deterministic successful-compress special case that removes the large summary argument from that same successful tool call.

QOL should explicitly support this:

1. canonical session keeps the original compress tool call and full summary argument for audit;
2. next model projection rewrites only that compress tool block's `summary` argument to a bounded marker such as `[stored in block b17]`;
3. projected assistant provider replay payload is cleared/sanitized;
4. the tool result itself is concise from the start.

This eliminates the pathological "the context-compression tool adds almost the same summary twice" behavior.

## 9. Prompt resources have different live-apply semantics

A current session has a real `refreshBaseSystemPrompt()` path.

However the resources feeding it differ:

- **AGENTS/context files:** the live rebuild closure re-discovers them when `contextFiles` were not explicitly frozen by SDK options. Therefore a host bridge to `session.refreshBaseSystemPrompt()` can make normal project context edits live in the current session.
- **SYSTEM.md / APPEND_SYSTEM.md:** CLI/startup resolution has already turned them into captured strings. Rebuilding the prompt reuses those values; it does not necessarily re-read the files.
- **skills:** `refreshSkills()` re-discovers skills and rebuilds the prompt.

PrimeStyle must not flatten these into one "prompt file" resource.

## 10. Extension code remains restart-class

The extension loader can import edited source with an mtime cache-buster when the loader runs. But extension discovery/loading is startup-oriented, and `ctx.reload()` only reopens the session. No supported live teardown + handler deregistration + instance replacement protocol has been established.

Therefore v1 PrimeStyle must not autonomously self-edit the running QOL extension and claim it is active. Treat extension source mutation as:

```text
persisted: true
applied: false
effectiveAt: restart
```

until a real lifecycle is proven.

## 11. Prime-style management should manage typed resources, not files

Current Prime Agent's continual harness already uses typed kinds (`prompt`, `memory`, `skill`, `subagent`), scope, version/history, evidence and outcomes, while preserving an immutable base harness.

The OMP-QOL equivalent should expose resource adapters:

```ts
inspect -> validate -> mutate/propose -> native apply -> verify -> record -> rollback
```

Each adapter declares its activation boundary. Examples:

- skill: native `manage_skill`, immediate refresh;
- task agent definition: file-backed, next spawn rediscovery;
- advisor: WATCHDOG save/discover/live apply;
- model role: live Settings mutation + resolution verification;
- AGENTS/context: write + live prompt rebuild bridge;
- SYSTEM/APPEND: next-session/recreate unless a new owner API is added;
- extension code: restart;
- memory: backend-specific.

## 12. P0 decisions after this pass

### Closed

- Advisor roster hot apply exists natively.
- `ctx.reload()` is not a generic refresh.
- Task agent definitions re-discover each spawn.
- Overlay state can persist through custom session entries.
- Live skill refresh exists.
- MCP has its own reload/rebind lifecycle.
- `context` rewrites are cache-compatible via longest stable prefix.
- transform-only DCP does **not** automatically suppress native compaction pressure.
- AGENTS/context live rebuild and SYSTEM/APPEND file reread are different problems.
- extension source cannot be treated as safe live-self-edit in v1.

### Still architecture-level P0

1. Exact provenance/core seam for stable message addressing.
2. Choose C vs D as the product target for DCP/native headroom ownership.
3. Minimal host action for advisor `applyAdvisorConfigs` from QOL.
4. Minimal host action for `refreshBaseSystemPrompt()` where PrimeStyle needs live AGENTS/context activation.
5. Exact custom-compaction sealing format and expand UX after seal.

