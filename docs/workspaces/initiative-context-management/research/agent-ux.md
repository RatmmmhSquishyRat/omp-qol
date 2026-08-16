# U1: Agent-Facing UX for ICM Tools

**Track:** U1 (`research/00-index.md`)  
**Date:** 2026-08-16  
**Scope:** Design-research only. Recommendations, not a public-API freeze. No product code. Pillars unread-as-editable.  
**Evidence grade:** E1–E2 (source + existing QOL tools + DCP/ACM/Pi-DCP reports). Not E3/E4 until a model actually calls the tool.

**Questions answered:** workspace `questions/open-questions.md` **Q6** (tool shape), **Q4** (expand after seal visibility), **Q5** (how much automatic policy), and the address-presentation half of **Q2**. Storage/lifecycle (Q1, Q3, Q7, Q8) stay in other tracks.

---

## Executive summary

OpenCode DCP, the Pi-DCP ports, and ACM already show that an agent *can* drive context work through tools. They also show three failure modes QOL already paid to avoid: **too many discrete tools** (ACM’s 17), **policy dressed as help** (DCP nudges / auto-dedup), and **an expand path the model cannot call** (DCP / Pi-DCP decompress is slash-only).

Current omp-qol already has a working agent contract: **one essential tool per domain**, **`op` enum**, **pure JSON** (`JSON.parse(text)` on every result), **`warnings` / `action`**, and **advisor-style read/write approval**. ICM should copy that contract and add three ICM-only fields: **raw / projected / native pressure**, and **`exactExpandAvailable`**.

The seven recommendations below are the working UX bet. They do **not** freeze names, `@syntax`, C vs D, or auto-heuristic defaults.

| # | Bet | Overturn if |
|---|---|---|
| 1 | One `context` multi-op tool | Essential-schema token cost makes a single description unusable, or host later ships a native `context` tool name collision that cannot be shadowed cleanly |
| 2 | Advisor envelope + pressure + `exactExpandAvailable` | Host later exposes a first-class context-meter API that makes our three pressure numbers redundant or wrong |
| 3 | Provisional `m:` / `t:` / `b:` / `c:` refs; no public `@` freeze | H4 provenance seam lands and a host-owned presentation ID is cheaper and safer |
| 4 | Tool description = contract; skill = heuristics | A short description plus a required skill still leaves models unable to call ops correctly |
| 5 | Dynamic read vs write by `op` | Host approval function form regresses, or overlay writes are reclassified as session bookkeeping |
| 6 | Protocol-unsafe range → `ok:false` + suggested range; never silent extra compress | Eval shows models refuse to retry after an honest reject (then consider an explicit `acceptNormalized` later, not silent apply) |
| 7 | No default auto-nudge; pressure in the envelope; skills optional | Author later wants an inspectable, off-by-default advisor note *and* it still never chooses the range |

---

## 1. Background

### 1.1 What the pillars require of the *tool*, not the engine

From `docs/ssot/pillars/initiative-context-management/` (verbatim intent, not rewritten):

- **InitiativeSummary:** the agent may, at any time, summarize any messages into any content, or expand any summary. Heuristic skills/instructions are allowed. Plugin-decided “this should be compressed” is not the product.
- **InitiativePin:** any session message may need to be pinned. Maximum pin/unpin freedom.
- **PinStateTree:** agent marches or jumps; inspect current path + siblings, not a fully expanded tree.

`INVARIANTS.md` already records the UX-relevant tensions: agent freedom vs DCP auto-policy; expand-any-summary vs native seal; public `@message` syntax must not freeze early.

`PROGRAM.md` Phase 7 already points at the same split this report recommends: heuristic practice for *when* to compress/pin, and a unified JSON envelope consistent with existing tools.

### 1.2 What the current QOL tools already teach

Three registered tools, all `loadMode: "essential"`, all `[qol]`-prefixed descriptions:

| Tool | File | Shape | Approval | Envelope |
|---|---|---|---|---|
| `goal` | `plugin/src/goal-tool.ts` | 5 ops | static `"read"` | `{ ok, tool, op, message, details?, warnings }` |
| `mode` | `plugin/src/mode-tool.ts` | 5 ops | static `"read"` | `{ ok, tool, op, message, …fields, warnings }` |
| `advisor` | `plugin/src/advisor-tool.ts` | 10 ops | **dynamic** by `op` | `{ ok, tool, op, summary?, …fields, warnings }` / fail `{ error, action? }` |

`advisor-tool.ts` is the canonical pattern. Comments there state the parse rule: no prose prefix, so `JSON.parse(text)` works on every result. Human one-liners live **inside** the body (`summary` / `message`), never outside JSON. Failures set `isError: true` and often include `action` (retry with a different scope, ask the user to run `/advisor`, fix the file by hand).

Goal and mode stay `"read"` because they only mutate session bookkeeping the host already exposes ungated. Advisor mutates files and rebuilds runtimes, so write ops are `"write"`. ICM overlay writes (`appendEntry`, pin, compress, seal) are closer to advisor than to goal.

### 1.3 What neighbors already tried

| Neighbor | Agent surface | Expand | Auto policy | Address the model sees |
|---|---|---|---|---|
| OpenCode DCP @ `85b6f5c` | One `compress` tool; decompress is **slash-only** | Model cannot expand | Default-on dedup, error purge, threshold nudges | Injected `<dcp-message-id>m0001</…>` |
| pi-dcp @ `7ae24be` | One `compress`; `/dcp decompress` | Slash-only | Dedup/purge every `context` pass; `before_agent_start` nudges | `toolCallId` only; no generic message IDs |
| pi-dcp-vault @ `d9b7569` | OpenCode-like `compress` + injected IDs | Slash-only | Same family of auto strategies + in-message nudges | `m0001` + `bN` |
| ACM @ `6ca26461` | **17 discrete tools** (`acm_pin`, `acm_prune`, `acm_scan`, …) | No structured expand | No auto-compact-on-pressure; default-on telemetry | OpenCode `msg_…` / last-12-chars / `includes()` |

DCP transcripts under `docs/researches/dcp/` add two UX facts that source reports already closed:

1. **Self-footprint:** `summary` is a tool argument, so the next request can contain the synthetic block *and* the same summary again in `compress` input (`omp_dcp_research_transcript.md`). DCP does not scrub immediately; message-mode *asks the model* to clean it later.
2. **Pairing is the hard rule, not “cannot compress tools”:** content of call or result may shrink; deleting one side of a pair must not leave the other as live tool protocol (`dcp_tool_call_result_compression_supplement_transcript.md`).

---

## 2. Hypotheses this report is testing

1. One multi-op tool will cost fewer schema tokens and keep one parse rule, without hiding pin/tree behind a second discovery step.
2. Honest pressure numbers in the envelope will replace most of the *reason* DCP injects nudges.
3. A provisional prefixed alias is enough for v1 tool arguments; a public `@12` grammar is not.
4. Putting “when to compress” in the tool description recreates DCP’s policy engine inside the schema.
5. Silent protocol-closure (compress extra messages to make a range safe) is the same class of fault as advisor’s anti-clobber case: the plugin decided something the agent did not ask.

Each section below answers one of the seven requested design questions and then callbacks these hypotheses.

---

## 3. One `context` tool vs separate `compress` / `pin` / `tree`

**Recommendation:** one essential tool named `context`, with an `op` enum, same family as `advisor`. Do not register three essential tools in v1. Do not freeze the string `context` if a host collision appears.

### 3.1 What we observed

QOL already grouped a domain into one tool once the ops shared state and a parse rule. Advisor’s ten ops (`list|get|upsert|remove|set_shared|apply|enable|disable|status|dump`) are still one schema object. Goal and mode are smaller, but they are the same shape.

ACM went the other way: seventeen tools. That gives verb-per-name clarity (`acm_scan` then `acm_pin`) and a useful inspect-then-act loop. It also spends seventeen essential-schema slots and fragments “what is the overlay state?” across `acm_info` / `acm_scan` / `acm_map`. `opencode-acm.md` already treats that as a UX pattern to steal **as ops**, not as seventeen registrations.

DCP registered **one** agent tool (`compress`) and hid reverse/inspect behind user slash commands. That is the opposite pillar miss: InitiativeSummary requires the *agent* to expand. Pi-DCP copies the same split (`compress` tool, `/dcp decompress`).

PinStateTree is specified as QoL *over* pin (`INVARIANTS.md` §10). PROGRAM Phases 4–6 land compress, then pin, then tree. A single tool can grow `tree_*` ops later without a third `loadMode: "essential"` name. A kill switch can omit tree ops from the zod enum until Phase 6 (`plugin-seams.md` §6.2 already sketches `icmPinTreeEnabled`).

### 3.2 Why one tool fits the hypotheses

Compress, pin, and tree share:

- the same address vocabulary (entry / tool / block / compaction);
- the same pressure triple (raw / projected / native);
- the same overlay reducer and branch replay;
- the same “preview then mutate” loop ACM proved useful.

Three tools would triple the essential-schema cost and invite three slightly different envelopes. One tool keeps `JSON.parse` and `warnings` identical to advisor/goal/mode.

The description will be long. Advisor’s description is already a dense operational paragraph (read ops, write ops, implicit default, tool-grant warning). That is the cost of one-tool-per-domain, and it has not forced a split in QOL yet.

### 3.3 Suggested op groups (not a freeze)

| Group | Candidate ops | Notes |
|---|---|---|
| Inspect | `list`, `get`, `status`, `preview` | ACM’s scan/info/map belong here as *fields*, not extra tools |
| Compress | `compress`, `expand` | `expand` is first-class; not a slash command |
| Pin | `pin`, `unpin` | Flat pin only in v1 |
| Seal | `seal` | Explicit; only if product target C is chosen (Q3 still open) |
| Tree | `tree_inspect`, `tree_march`, `tree_jump` | Later; gated |

`preview` is a dry-run of a compress/pin/seal plan. It must not persist overlay events.

### 3.4 Name collision

Host event `pi.on("context")` and a tool named `context` live in different namespaces. QOL already shadows a host tool (`goal`). If a future host ships a built-in `context` tool, treat it like goal: shadow-delegate or pick `icm`. That is an overturn condition, not a reason to start with three names.

---

## 4. Pure JSON envelope fields

**Recommendation:** copy the advisor envelope exactly, then add ICM fields. Do not invent a second parse rule.

### 4.1 Shared contract (already shipping)

Success:

```json
{
  "ok": true,
  "tool": "context",
  "op": "status",
  "summary": "optional one-liner",
  "warnings": []
}
```

Failure:

```json
{
  "ok": false,
  "tool": "context",
  "op": "compress",
  "error": "human actionable",
  "action": "optional next step"
}
```

Rules copied from `advisor-tool.ts` / `plugin-seams.md` §3.3:

1. `content[0].text` is `JSON.stringify(body, null, 2)` — no prose prefix.
2. Same object in `details`.
3. Failures set `isError: true`.
4. Default `warnings: []` on success.
5. `action` is a retry hint, not a second error channel.

Goal uses `message` for the native one-liner; advisor uses `summary`. **Prefer `summary`** for ICM so inspect ops stay field-shaped and do not smuggle a second schema through `message`.

### 4.2 ICM-only success fields

| Field | Meaning | Why it exists |
|---|---|---|
| `pressure.raw` | Stored-conversation estimate (host `#estimateStoredContextTokens` family) | Native compaction still floors on stored history (`host-compaction.md`; Q1 still open as a *product* question, but the *meter* is already real on 17.3.4) |
| `pressure.projected` | Overlay-visible tokens after current blocks/pins | This is what the next model request is trying to be |
| `pressure.native` | `compactionContextTokens` = `max(provider, stored)` | The number that actually decides auto-compact. Overlay-only cannot hide it |
| `pressure.provider` | Last provider-reported context usage, if known | Optional; display/cost may use this while native uses the floor |
| `exactExpandAvailable` | `true` if `expand` can re-project the original range from active native history | Q4 / overlay-engine §8. After a native seal this is `false` |
| `blockId` / `pinId` / `treeId` | Overlay object just written or inspected | Persist as journal overlay identity, not array index |
| `requested` | Addresses the model asked for | Always echo, including on failure |
| `suggested` | Protocol-safe alternative, **only on reject** | See §7. Not applied unless the model calls again |

2026-08-09 overlay notes used `exactExpansionAvailable`. This report uses the shorter **`exactExpandAvailable`** from the U1 brief. Treat them as the same boolean until a design freeze picks one spelling.

### 4.3 When to attach pressure

Attach `pressure` on **every successful inspect and every successful mutate**. The point of hypothesis 2 is that the model should not need a system reminder to learn that native pressure did not move.

Do not attach invented heuristics (`"you should compress now"`). A number plus `warnings` is enough. Example warning, copied in spirit from advisor `no_model` / `stored`:

> `native pressure still above threshold; overlay shrinks projected tokens only. Native auto-compact can still fire.`

### 4.4 `exactExpandAvailable` on expand / get

| Block state (2026-08-09 overlay language) | `exactExpandAvailable` | `action` if the model asked to expand |
|---|---|---|
| `active-overlay` / `disabled` with sources still in native active history | `true` | — |
| `sealed-native-compaction` | `false` | Name `rehydrate` vs `branch` as *options*, do not pretend they are the same as expand |
| `invalid-source` / compacted-away | `false` | Point at the representing compaction / block id (message-id transcript tombstone pattern) |

Do not return `ok: true` for an expand that only rehydrated a paraphrase after seal. That is the “silently did something else” fault applied to reverse.

---

## 5. How the model names messages before public `@syntax` is frozen

**Recommendation:** hybrid presentation now, host provenance later. Persist `(sessionId, entryId)`. Let the model pass **typed prefixes on those same ids** (`m:<entryId>`, `t:<toolCallId>`). Do **not** freeze `@12`, `@m12`, or `@#12`. Do **not** default-inject XML id tags into every outbound message. Do **not** invent sequential `m0001` as what the model types.

H4 (`host-addressing.md`) already closed the dangerous half of this: **do not map `context` event clones back to the journal.** `pi.on("context")` messages are fresh objects, reordered, and possibly rewritten by an earlier handler. Addressable units for `list` / `get` / mutate args are built by walking `getBranch()` (and `getEntry`), then stored on overlay events. A later `ContextRecord` seam can attach `entryId` to outbound slots; until then, the tool must not pretend the cloned array is a keyspace.

### 5.1 What is already decided vs still open

`INVARIANTS.md` §7: persist identity as `(sessionId, entryId)`, never array indexes.  
`DECISIONS.md`: public address syntax is **not decided**.  
2026-08-09 foundation: do not freeze `@12` until provenance survives branch, resume, native compaction, hidden/custom messages, multi-tool turns, retry, and other context extensions (`01-FOUNDATION-REPORT.md`).  
Q2: plugin alias first vs host provenance seam first vs hybrid.

### 5.2 What DCP taught, and what to refuse

OpenCode DCP maps `message.info.id` → sequential `m0001`…`m9999`, injects `<dcp-message-id>`, and accepts `mNNNN` / `bN` in `compress`. Two operational faults are already documented:

- hard cap 9999 (`MESSAGE_REF_MAX_INDEX`);
- presentation IDs orphan after host compaction (`OMP_DCP_message_id_supplement_transcript.md`).

The same transcript’s correction is the one to keep: DCP needed a **stable alias the plugin can resolve**, not a core-native sequence number. OMP already has `SessionEntry.id` and `toolCallId`. Pi-DCP further proved tool-output work can address **only** `toolCallId`.

ACM’s `includes()` / last-12-char match is the other anti-pattern: ambiguous IDs succeed. Advisor `get` is the pattern to copy — no match → `ok: false` plus known names.

### 5.3 Provisional vocabulary (presentation only)

| Object | Persist | Model-facing ref (provisional) | Number in v1? |
|---|---|---|---|
| User / assistant journal message | `(sessionId, entryId)` | `m:<entryId>` (prefix on the journal id, not a sequence) | Yes, from `getBranch()` / `getEntry` — **not** from `context.messages[i]` |
| Tool call **and** its result | `toolCallId` | `t:<toolCallId>` | Yes; pair shares one id |
| Overlay compression block | overlay `blockId` | `b:<blockId>` | Yes |
| Native compaction / branch summary | compaction `entryId` | `c:<entryId>` | Yes, as a *representing* id, not as a compress target by default |
| Synthetic pin-zone / injected reminder | none | **unnumbered** | No |

This matches the message-id transcript’s “only address safe units” rule. Temporary extension context and provider-only injects stay unnumbered so the model cannot point at a ghost.

**Do not ship `m0001` as what the model types.** H4 allows a sequential alias only as overlay-local, append-only, **display** state, marked unstable across replay. If `list` ever shows one, the mutate path still accepts `entryId` / `m:<entryId>`. Persistence stays `(sessionId, entryId)`.

**Do not put `@12` in the tool description.** That sentence would freeze a public grammar in the essential schema before Q2/H4 close.

### 5.4 How the model *learns* names without injection

DCP teaches names by writing a tag onto every user/assistant/tool part. That costs tokens, requires `stripHallucinations`, and still orphans after compaction.

ACM teaches names by **inspect tools** (`acm_scan`, `acm_info`, `acm_search`). QOL already does this for advisors (`list` / `get` / `status`).

v1 discovery path:

1. `context op=list` / `status` walks **`getBranch()`** and returns addressable units: `sessionId`, `entryId` or `toolCallId`, optional `m:`/`t:` prefix, role, token estimate, pin/block state. H4: include canonical ids in the envelope; if a short alias is shown, mark it display-only.
2. `context op=get` resolves one ref or fails with known refs (advisor `get` + slug hint).
3. Mutate ops accept the same ref strings and persist the resolved `(sessionId, entryId)` / `toolCallId` on the overlay event.

Optional later: inject presentation tags. That is a prompt/eval experiment, not a prerequisite. If injected, strip model-authored fakes the way vault does at `message_end`.

### 5.5 Q2 callback

For **agent UX**, hybrid is enough to start and matches H4’s working law:

- model sees and types `m:<entryId>` / `t:<toolCallId>` / `b:<blockId>` (typed canonical ids);
- overlay events store `(sessionId, entryId)` / `toolCallId` / `blockId`;
- `list` is sourced from `getBranch()`, never from indexing the `context` clone;
- a host `ContextRecord` seam can later label outbound slots without changing the tool envelope or freezing `@N`.

That is an implementation order, not a freeze of public `@syntax`.

---

## 6. Tool description vs skill (heuristics only)

**Recommendation:** the tool description is the **mechanical contract**. A skill (or optional instruction pack) is the **when/why** layer. The plugin must remain correct if the skill is absent.

Current QOL has **no** skill files (`plugin/` has no `SKILL.md`). ICM would be the first QOL skill. That is allowed by InitiativeSummary (“启发性质的 skill/instruction”) and by PROGRAM Phase 7. It is not required for the tool to function.

### 6.1 What belongs in the tool description

Copy advisor’s density, not DCP’s philosophy prompt.

| Include | Example (intent, not final copy) |
|---|---|
| `[qol]` marker + one-sentence job | Manage this session’s overlay: compress/expand ranges, pin/unpin, inspect pressure |
| Op list with read vs write | `list/get/status/preview` read; `compress/expand/pin/unpin` write |
| Required params per mutate | `compress` needs a range + agent-authored `summary` |
| Protocol-safety sentence | Unsafe ranges are **rejected** with a suggested closed range; the tool will not compress extra messages on its own |
| Envelope sentence | Results are JSON: `ok`, `op`, `warnings`, `pressure`, `exactExpandAvailable` |
| Seal / expand honesty | After native seal, `exactExpandAvailable` is false; expand is not a silent paraphrase |
| Self-footprint sentence | `summary` is stored on the overlay block; later projections should not keep the full summary in the historical tool arguments |
| Tree sentence (when enabled) | `tree_inspect` shows current path + siblings only |

Advisor already warns that granting `bash`/`write` to an advisor is unattended mutation. ICM’s equivalent warning is: **write ops change the next model request and can move the cache frontier.**

### 6.2 What belongs in a skill (heuristics only)

| Include | Do not include |
|---|---|
| When a long `read`/`bash` result is a good compress target | “At 70% context you must call compress” |
| How to write a high-fidelity summary vs a one-line stub | A plugin-chosen stub string (ACM `[Old tool result content cleared]`) |
| Prefer compressing superseded tool results before user instructions | Auto-dedup of same-args tools |
| Pin a user major command or a just-read invariant; unpin when the leaf changes | Auto-pin of every MKP-like load |
| After `status` shows high **native** pressure, consider `seal` *if* C is the product | Injected turn/iteration/context-limit nudges |
| Tree: march when the workflow step changes | Hidden pin-set changes the plugin applies on its own |

DCP’s `lib/prompts/system.ts` + `injectCompressNudges` + message-mode “clean up old compress calls” is the anti-pattern: philosophy and timing live in the **always-on prompt**, so the plugin is deciding *when*. Pi-DCP’s bundled `skills/pi-dcp/SKILL.md` is closer to the allowed layer — documentation the agent can read — but that port still fires `before_agent_start` nudges. Steal the skill file idea; leave the nudge hook off by default.

### 6.3 What must not live in either, as silent behavior

- Default-on same-args dedup (`dcp-opencode.md` §4.1, `pi-dcp.md` §6.3).
- Default-on error-input purge.
- Threshold text injected into the last user/assistant message or system prompt.
- ACM default-on `<runtime-telemetry>` / heartbeat mutation of user text.

If a future setting turns any of those on, they must appear in `status` as **inspectable policy**, with a disable path, and they still must not choose a range the agent did not name.

---

## 7. Approval tiers (read vs write)

**Recommendation:** advisor’s function form, not goal/mode’s static `"read"`.

```text
READ_OPS  = list | get | status | preview | tree_inspect
WRITE_OPS = compress | expand | pin | unpin | seal | tree_march | tree_jump
approval(args) = READ_OPS.has(args.op) ? "read" : "write"
```

### 7.1 Why this split

| Op class | Side effect | Tier |
|---|---|---|
| Inspect | None (or compute-only) | `read` |
| `preview` | Plan only; no `appendEntry` | `read` |
| `compress` / `expand` / `pin` / `unpin` | Overlay events; next `context` projection changes | `write` |
| `seal` | Native compaction boundary (product C) | `write` |
| Tree march/jump | Changes active pin set | `write` |

Goal/mode used static `"read"` because the native goal tool is ungated and plan/vibe are session flags the user can also flip with `/plan` `/vibe`. ICM writes are new durable overlay (and possibly a seal). Treating them as `"read"` would skip the host approval prompt on the first mutation of what the model will see next.

Unknown / missing `op` → `"write"` (advisor does this: only listed read ops return `"read"`). That fails closed.

### 7.2 What approval is not

Approval is not a substitute for protocol-safety. A user who clicks through a write still must not get a silently widened range.

`dump`-like payloads (full block summary, full pin text) stay `read` if they only reveal overlay state, same as advisor `dump`. They can be large; the description should say so, as advisor’s `raw` flag does.

---

## 8. Failure texts that preserve freedom

**Recommendation:** refuse the unsafe or unknown request, show the normalized alternative, do not apply it. This is the advisor anti-clobber / exclusive-mode pattern applied to ranges.

### 8.1 Tension with 2026-08-09 overlay language

`07-CONTEXT-OVERLAY-ENGINE.md` §6 said a planner may expand the internal closure and **report** extra protocol records covered, and that a good response reports both requested and normalized ranges.

That text is compatible with two UX policies:

- **A.** Apply the closure, return `ok: true` plus `warnings` (“also covered the sibling tool result”).
- **B.** Reject, return `ok: false` plus `suggested`, wait for a second call.

InitiativeSummary plus the U1 brief choose **B**. Silent extra coverage is the plugin deciding *what* to compress. Advisor already refused the silent path when `scope=effective` is used as a write target, when a file is unparsable, and when goal/plan/vibe occupy the slot: `error` + `action`, no mutation.

Pi-DCP’s useful bit here is **preflight refuse** (`protectedByRecency` / overlap) instead of a silent no-op (`pi-dcp.md` §6.1 item 11). Steal refuse; do not steal silent skip.

### 8.2 Failure catalog (intent, not frozen copy)

| Case | `error` (intent) | `action` (intent) | Mutate? |
|---|---|---|---|
| Unknown ref | No unit matching `"…"`. | Known refs from `op=list`: `m:…`, `t:…`, `b:…` | No |
| Ambiguous partial id | `"abc"` matches N units. | Retry with a full provisional ref | No |
| Protocol-unsafe range | Requested `m:A..m:C` would orphan tool pair `t:…` / split a multi-call assistant turn. | Retry `compress` with suggested `{ start, end }` (the closed range), or shrink to a pair-safe subset listed in `suggested` | No |
| Pair-delete one side | Cannot drop `toolResult` and keep the `toolCall` as live protocol (or the reverse). | Stub both, or collapse the pair to text, or include both in the range | No |
| Overlap / shadowed block | Range intersects active block `b:…`. | Expand that block, or pass an explicit nest/replace op once designed | No |
| Sealed expand | `exactExpandAvailable: false`. Block `b:…` was sealed to compaction `c:…`. | `rehydrate` (provider-neutral excerpt) or `branch` (pre-seal chronology). Not `expand` | No |
| Native / bridge missing | Same class as `BRIDGE_UNAVAILABLE` / `NATIVE_UNAVAILABLE`. | User path (`/…`) or retry when a session is live | No |
| Cancelled | Tool call aborted before persist. | Retry; journal unchanged | No |

On protocol-unsafe reject, include **both** `requested` and `suggested` in the JSON body (overlay-engine §6’s “report both ranges”), with `ok: false`. The model keeps freedom: it may accept the larger closure, pick a smaller pair-safe subset, or do nothing.

Do **not** implement v1 `acceptNormalized: true` as a hidden default. If eval later shows models stall after honest rejects, that flag is an explicit second call, still authored by the agent.

### 8.3 What “never silently compress something else” means

| Plugin behavior | Allowed? |
|---|---|
| Refuse, suggest the closed range | Yes |
| Apply exactly the requested range when it is already pair-safe | Yes |
| Widen the range to include a sibling call/result and persist that as success | No |
| Swap the target to a “better” old error or duplicate tool the strategy liked | No (DCP auto-dedup / purge) |
| After seal, return a paraphrase and call it `expand` | No |
| Scrub historical `compress` arguments on the **wire** after the agent already authored the summary | Yes — that is canonicalizing a projection, not choosing a new target (`dcp-opencode.md` §5.3; overlay-engine §9) |

The last row is the one place the plugin may rewrite without a new agent decision: the summary already exists on the block. Journal keeps the original tool call.

---

## 9. Tension: DCP auto-nudge vs pillar “agent decides”

**Recommendation:** do not ship threshold nudges, turn nudges, or iteration nudges as core product. Put pressure in the envelope. Put timing advice in an optional skill. If a user later wants a “context advisor” note, it is off by default, visible in `status`, and it still must not pick targets.

### 9.1 What DCP actually does

OpenCode DCP (`dcp-opencode.md` §4.2): `injectCompressNudges` when not in manual mode.

- Over max context: periodic context-limit nudge.
- Between min and max: turn nudge after user text; iteration nudge after N assistant/tool messages (default 15).
- Soft vs strong wording.
- Cleared when the last assistant message contains a completed `compress`.

Pi-DCP: same idea on `before_agent_start` (system-prompt append). Vault: stronger, in-message reminders. ACM: no compact-on-pressure, but default-on telemetry XML and optional heartbeat mutation of user text.

DCP `manualMode` still allows `automaticStrategies` to run **inside** `compress` (dedup + purge). That is a second, quieter policy: the agent asked to compress a range, and the plugin also stubbed other tools.

### 9.2 What the pillar allows

InitiativeSummary allows **启发性质** skill/instruction. It does not allow the plugin to decide whether a given message “should” be summarized, or when.

So the split is:

| Mechanism | Pillar fit |
|---|---|
| Agent calls `context` after reading `pressure` | Fit |
| Skill says “when projected is high, consider compressing old tool results” | Fit (heuristic, off if skill unused) |
| Setting `icmNudges=true` injects a reminder that only says “inspect `context op=status`” | Gray — inspectable, disableable, still must not name targets |
| Threshold text that says “call compress on m0003–m0012” | Not fit |
| Auto-dedup / auto-purge without an agent range | Not fit |
| Nudge that clears only after the model compresses | Not fit (plugin is training the when) |

Hypothesis 2 is the practical replacement: **every** `status` / mutate result already carries `pressure.raw`, `pressure.projected`, and `pressure.native`. DCP needed nudges partly because the model had no structured meter and decompress was not a tool. QOL can do better without injecting system reminders.

### 9.3 Q5 callback

Q5 offered: auto heuristics off by default and disableable, **or** never auto.

This report leans **never auto in v1**, with an optional skill. Off-by-default auto-dedup remains a later experiment only if it is agent-triggered (`op=suggest` that returns candidates without applying them) and still requires a second `compress` with an authored summary.

`suggest` is **not** recommended for v1. It is the honest form of DCP strategies if someone later wants them: candidates in JSON, no projection change.

---

## 10. Impact on other tracks

| Track | What this report assumes / asks |
|---|---|
| H1 / Q1 | Envelope must expose native floor even if overlay shrinks the wire. Do not let UX imply overlay owns headroom |
| H2 | Tool execute appends overlay events; `pi.on("context")` projects. Handler order still open — do not document “we are first” in the tool description |
| H4 / Q2 | Closed: persist `(sessionId, entryId)`; list from `getBranch()`; do not key off `context` clones. U1 uses `m:<entryId>` as a typed prefix on that id, not as `@N` or `m0001` |
| Q3 C vs D | `seal` op and `exactExpandAvailable: false` are required for C. D may keep expand stronger; the field still belongs in the envelope |
| Q4 | `exactExpandAvailable` is the model-visible bit; `rehydrate` / `branch` stay named alternatives, not silent expand |
| Q7 / Q8 | Pin placement and cache arms are not tool-shape. `warnings` may later mention first-divergence; do not invent a cache number in v1 UX |
| H6 | Kill switch `contextToolEnabled`; overlay/seal/tree switches stay separate so the tool can exist while the engine is off (honest `error` + `action`) |

### Eval that would support or overturn the bets

- **E3:** fixture calls `preview` then `compress` on a pair-unsafe range → `ok: false`, journal unchanged, `suggested` is the closed range; second call applies only that range.
- **E3:** `expand` after a custom `CompactionResult` seal → `exactExpandAvailable: false`, no raw replay claimed.
- **E4:** model discovers refs via `list`/`status` without injected `@` / `<dcp-message-id>` and still completes a compress+expand cycle.
- **E4:** with no skill and no nudges, the model still *can* compress (freedom). Skill-on vs skill-off is a quality metric, not a gate.
- **E5:** compare DCP-style nudge-on vs envelope-only on the same task: task score, extra compress calls, cache frontier, native compact count.

---

## 11. What this report does not freeze

- Public `@message` grammar.
- Product target C vs D.
- Whether `seal` is a v1 op.
- Whether sequential short aliases (`m0001`) exist as a *display* cache.
- Whether an off-by-default `suggest` op is ever added.
- Pin default placement (Q7) and cache fixture design (Q8).
- Exact op strings (`tree_march` vs `tree_advance`).

`DECISIONS.md` should stay unchanged until the author accepts a subset of these bets.

---

## 12. Sources

| Kind | Path |
|---|---|
| Pillars (read-only) | `docs/ssot/pillars/initiative-context-management/{InitiativeSummary,InitiativePin,PinStateTree}.md` |
| Workspace laws | `docs/workspaces/initiative-context-management/{INVARIANTS,PROGRAM,questions/open-questions}.md` |
| QOL tools | `plugin/src/{advisor-tool,goal-tool,mode-tool,main}.ts` |
| DCP transcripts | `docs/researches/dcp/{omp_dcp_research_transcript,dcp_tool_call_result_compression_supplement_transcript,OMP_DCP_message_id_supplement_transcript}.md` |
| Neighbor reports | `research/{dcp-opencode,pi-dcp,opencode-acm,plugin-seams,host-compaction}.md` |
| 2026-08-09 prior | `docs/researches/OMP-QOL-Complete-Research-Handoff-2026-08-09/02-foundation-research/07-CONTEXT-OVERLAY-ENGINE.md`, `01-FOUNDATION-REPORT.md` |

DCP clone working tree was not required for this UX pass; mechanism claims defer to D1 @ `85b6f5ceba144fee9e65eb28dc36cab1b960e418`.
