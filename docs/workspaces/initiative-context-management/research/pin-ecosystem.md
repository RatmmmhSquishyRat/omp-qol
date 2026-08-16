# D4: Pin ecosystem — btw, OpenCode native pin PR, and other evidenced pin systems

**Track:** D4 (`research/00-index.md`)  
**Date:** 2026-08-16  
**Scope:** Evidence for InitiativePin / PinStateTree neighbors. No product code. Pillars unread-as-rewrite (cited only).  
**Local clone:** `docs/ref_repos/opencode-btw` → [kldzj/opencode-btw](https://github.com/kldzj/opencode-btw)  
**HEAD:** `b6386a3d48f6c2b96526bf712b6015dba6d95d71` — *chore: remove latest version pin from installation instructions* (2026-03-27)  
**Package:** `opencode-btw@0.4.0`

Neighbor locks used in this report:

| Source | Lock | Role |
|---|---|---|
| `opencode-btw` | `b6386a3` / 0.4.0 | Transient vs `/btw pin` persistent hint |
| `opencode-acm` | `6ca26461` / 0.5.57 | Message pin + head re-inject (see D3) |
| `oh-my-pi-main` | `de6b7974a0` / 17.3.4 | Host has **no** context-pin product |
| `pi-dcp` | `7ae24be` | Prune/compress, not pin |
| `pi-dcp-vault` | `d9b7569` | Same |
| anomalyco/opencode PR `#9097` | closed, **not merged**, head `a146871` | Native user-message pin after compact |
| anomalyco/opencode issue `#8932` | closed stale 2026-03-28 | Feature request that `#9097` claimed to close |

---

## 1. Executive summary

There is **no shipped native “pin this session message so it survives compaction”** in OpenCode, Claude Code, Cursor, Codex, or oh-my-pi as of this research date. What exists is a small set of **plugin-owned** or **file-backed** substitutes, plus one **unmerged** OpenCode host PR.

| System | What it actually pins | Placement | Survives compact? | Kind vs foundation |
|---|---|---|---|---|
| **opencode-btw** | Authored hint text (not a journal message) | Default: **system prepend + last-user append** | Yes, accidentally — sidecar re-applied every LLM call | **instruction** only |
| **OpenCode `#9097`** | `UserMessage.pinned` flag on a **user** journal message | Re-insert **immediately after** the compaction checkpoint | Designed yes; **never merged** | **source** (raw user message replay) |
| **opencode-acm** | Any session message ID in `acm.db` | **Head `unshift`** of full message + banner | Yes, via transform re-inject | **source** (raw parts replay) |
| **Claude Code** | Disk files (`CLAUDE.md`, unscoped rules, `MEMORY.md`, invoked skills) | System / startup re-load | File-backed yes; in-chat instructions **no** | File-backed **instruction**, not session pin |
| **Cursor** | Rules / AGENTS.md (config). Old “pin context” **removed** | System / rules channel | Config yes; chat history no | Not a message pin |
| **Codex** | Thread `isPinned` in SQLite | Session **picker** only | Pin flag survives archive; **does not change model context** | **Not a context pin** |
| **oh-my-pi / Pi-DCP** | None found | — | — | Host `/session pin` is **OAuth account** lock |

**PinStateTree has no neighbor.** Closest shapes are btw’s stacked hint list, ACM’s named knowledge-package swap, and Claude’s file-scoped rules — all flat, none a leaf-path pin machine.

Foundation kinds (`source` / `snapshot` / `instruction`) and placements (`tail` / `system` / `mid`) from `docs/researches/OMP-QOL-Complete-Research-Handoff-2026-08-09/02-foundation-research/08-PIN.md` still classify this ecosystem cleanly. No product shipped that combination.

---

## 2. opencode-btw: transient hint vs `/btw pin`

### 2.1 Product

btw is an OpenCode plugin that injects **user-authored hint text** into the next LLM call **without creating a new user turn**. `/btw` is registered as a slash command and then **cancelled** (`throw` `BTW_HANDLED`) so OpenCode does not send the command text to the model ([`src/core.ts`](../../ref_repos/opencode-btw/src/core.ts) `cancelCommand`, comment citing [anomalyco/opencode#9306](https://github.com/anomalyco/opencode/issues/9306)).

README (`docs/ref_repos/opencode-btw/README.md`) and `parseCommand` agree:

| Command | Stored flag | Lifetime |
|---|---|---|
| `/btw <hint>` | `pinned: false` (unless `defaultPinned: true`) | **Transient** — removed on `session.idle` and/or `question` tool |
| `/btw pin <hint>` | `pinned: true` | **Persistent** until `/btw clear` / `clear last` / `clear N` |
| `/btw` (no args) | — | Status toast only |
| `/btw clear…` | — | Delete file or splice list |

Hints **stack**. Transient and pinned share one array; `removeTransient` keeps only `pinned: true` entries ([`src/core.ts`](../../ref_repos/opencode-btw/src/core.ts) L133–138).

This is **not** pinning a `SessionEntry`. There is no message ID, no source range, no snapshot of prior tool output. The payload is always new instruction text. That maps to foundation kind **`instruction`**.

### 2.2 Storage (session-scoped sidecar, not journal)

```text
~/.cache/opencode/btw/<md5(projectDir)[0:12]>/<sanitizedSessionID>.json
```

- Project hash: `createHash("md5").update(directory)` ([`src/core.ts`](../../ref_repos/opencode-btw/src/core.ts) `projectHash` / `btwDir`).
- File shape: `{ hints: [{ text, pinned }] }`, with a legacy single-object `{ text, pinned }` reader.
- `session.deleted` deletes the hint file.
- **Not** written into OpenCode’s session DB. Compaction, undo, and fork of the transcript do not see these rows.

Implication for QOL: btw “survives compact” because it **never lived in the compacted journal**. That is a different contract from InitiativePin’s overlay-on-journal.

### 2.3 Placement: system prepend + last-user append

Default config ([`src/config.ts`](../../ref_repos/opencode-btw/src/config.ts) `DEFAULT_CONFIG`):

```text
injection.target              = "both"
injection.systemPromptPosition = "prepend"
injection.userMessagePrefix    = "BTW, "
```

Two OpenCode experimental hooks run on **every** subsequent LLM call, including tool loops (README §How it works; tests in [`src/plugin.test.ts`](../../ref_repos/opencode-btw/src/plugin.test.ts)):

1. **`experimental.chat.system.transform`**  
   Builds one block: framing (`DEFAULT_SYSTEM_INSTRUCTIONS` or override) + `### Current Preferences` + numbered hint list.  
   Default: `output.system.unshift(block)` — **first** system segment.  
   Optional: `append` → `output.system.push(block)`.  
   Skipped when `target === "user"`.

2. **`experimental.chat.messages.transform`**  
   Finds the **last** `role === "user"` message, pushes a **synthetic** text part (`synthetic: true`, id `btw-${Date.now()}`).  
   Single hint: `"BTW, <text>"`. Multiple: `"BTW:\n1. …\n2. …"`.  
   Skipped when `target === "system"`.

Tests confirm: earlier user messages are untouched; only the last user message grows a part; system + messages transforms read the **same** hint file (no inject-once). Transient hints stay until idle/question, not until first transform.

### 2.4 Cache implications (evidence + inference)

btw does **not** measure `cacheRead` / `cacheWrite`. The following is mechanism-derived, not a billed eval.

| Injection | First likely divergence | Why |
|---|---|---|
| **system prepend** (default) | Start of **system prefix** | `unshift` changes the first system block. Provider prefix cache (Anthropic-style) typically cannot reuse any later messages. |
| **system append** | End of system / start of first message | Better than prepend if the stable system prefix is cached as a unit, still a system-channel mutation. |
| **user-only last-append** | **Last user message** | History before that user turn can stay cached. ACM’s own heartbeat comment in `opencode-acm/src/index.ts` L203–206 states the same idea: a few tokens on the last user message “sit outside the cached prefix.” |
| **both** (default) | System prefix | Dual write. User append is redundant for cache *and* for authority. Worst of the three. |

Additional cache-relevant facts:

- Transforms run **every LLM call**, including mid-tool-loop. Adding/clearing a hint mid-turn moves the frontier again.
- Transient clear on idle/question **removes** the system block on the next call → another full prefix rewrite.
- Synthetic part id uses `Date.now()`. If a provider/cache key includes part ids (OpenCode-internal vs wire content), this could add noise; wire text is stable while the hint set is stable.
- No first-divergence instrumentation. QOL should not copy “both” as a default.

### 2.5 What btw is not

- Not a source pin of an existing message.
- Not a snapshot of tool/file output.
- Not compaction-aware (no `session.compacting` / summarizer guidance).
- Not a tree. Stack order is list order, not ancestor-path policy.
- User-driven slash command only — the **agent** cannot `/btw` itself unless it shells out, which the plugin does not expose as a tool.

---

## 3. OpenCode native pin PR `#9097` and issue `#8932`

### 3.1 Status (do not treat as shipped)

| Item | Evidence |
|---|---|
| Issue `#8932` | Opened 2026-01-16 by Killusions. Ask: per-session pin of important instructions/messages, **re-inserted after compaction**, analogous to `AGENTS.md` but session-scoped. Also: “encourage the model to check open tasks after compaction.” Closed **2026-03-28** by 90-day stale bot. |
| PR `#9097` | `feat(agent): allow pinning messages to keep them after compaction`. +598/−99, 17 files. Author Killusions. `merged: false`, `merged_at: null`. Closed **2026-05-15** by `rekram1-node` **Automated PR Cleanup** (age > 1 month, &lt; 2 positive reactions). Head SHA `a1468715966ea511e13e2b7c5fd9a2a4e793e8de`. |
| Current `dev` | Fetched `packages/opencode/src/session/message-v2.ts` on `anomalyco/opencode` `dev` (2026-08-16): **no `pinned` field** on `UserMessage`. Native pin did not land later under this name. |

Killusions’ clarification on `#8932` (2026-01-21): this is **not** “keep the system prompt”; it is **user-selected pinned prompts**.

Related unshipped OpenCode designs (not this PR, same problem class):

- `#4659` (rickross, 2025-11-23): “inception messages” with `preserve: true` that travel with a sliding window. Closed. Same author later shipped **ACM** as a plugin instead of host inception.
- `#940`: preload instructions after `/compact`.
- `#15432`: session-level / plan-level **rules** that must be re-injected after compact (explicitly complementary to `#8932`).
- `#16960`: compaction loses `AGENTS.md` / `CLAUDE.md` instruction context.

### 3.2 Mechanism (from the PR patch, not from merged main)

**Storage.** Optional `pinned?: boolean` on `MessageV2.User` (Zod + SDK `UserMessage`). `Session.pinMessage({ sessionID, messageID, pinned })` loads the message, **rejects non-user roles** (`"Only user messages can be pinned"`), writes the flag via `updateMessage`.

**API.** `PATCH /session/:sessionID/message/:messageID/pin` with `{ pinned: boolean }`. SDK: `session.message2.pin(...)`. Prompt create can set `pinned` on the new user message (`--pin` with `--prompt` pins **only the first** message).

**UX.** TUI: message dialog “Pin / Unpin”, command palette “Pin/Unpin last message”, web `/pin` on last visible user message, `PINNED` badge.

**Re-insert after compact — `filterCompacted`.** This is the load-bearing change ([`packages/opencode/src/session/message-v2.ts`](https://github.com/anomalyco/opencode/blob/a1468715966ea511e13e2b7c5fd9a2a4e793e8de/packages/opencode/src/session/message-v2.ts) in the PR):

Original `filterCompacted` walked the newest-first stream, collected until the completed compaction user message, then reversed to chronological active window.

PR behavior:

1. Walk the stream. When a completed compaction user message is found, record it and **do not break**.
2. After that point, collect only **user** messages with `pinned === true` (these are **older** than the boundary if the stream is newest-first).
3. Reverse the pre-boundary `result` as before.
4. If any pinned-before-boundary messages exist, **splice them immediately after the compaction message** in the chronological list.

So placement is **mid-window, post-checkpoint**: `[…active tail before compact…][compaction checkpoint][pinned user messages][remainder of filter]`. It is **not** a tail pin zone and **not** a system prepend.

**Limits vs InitiativePin:**

- Assistant, tool, and system messages **cannot** be pinned.
- Re-insert is **raw message replay**, not a provider-neutral `<pinned-context>` record.
- Compaction **prompt** is not clearly taught to preserve pins. The added test `includes pinned messages in compaction prompt` only asserts the flag is stored on two messages — it does **not** exercise `filterCompacted` splice.
- No snapshot kind, no instruction-without-a-user-message, no tree.

### 3.3 Lesson

`#9097` is the closest **host-native** design to “source pin survives compact”: persist a flag on the journal row, then **project** those rows back into the post-compact window. QOL should treat it as a **placement sample** (post-checkpoint mid-list) and a **negative** on role restriction and raw replay — not as an API to wait for. It is closed and unmerged.

---

## 4. Other evidenced pin-adjacent systems

### 4.1 opencode-acm (shipped plugin; full writeup in D3)

Local: `docs/ref_repos/opencode-acm` @ `6ca26461` (v0.5.57).

- **Kind:** source pin of an existing OpenCode message ID. `acm_load` creates a message then `setMkp` pins it (`pinned=1`, optional `mkp_name`) — this is the pillar’s “pin skill/doc so it stays in effect” neighbor.
- **Storage:** sidecar `acm.db` `acm_metadata(message_id, session_id, pinned, compacted, mkp_name)`. Pin **clears** compacted (`CASE WHEN pinned = 1 THEN compacted stays 0`).
- **Projection:** `experimental.chat.messages.transform` computes `pinnedIds \ presentIds`, loads full messages, wraps with synthetic `[Pinned context re-injected by ACM]`, **`output.messages.unshift(...)`** ([`src/index.ts`](../../ref_repos/opencode-acm/src/index.ts) L179–199). Head of the **active** list, not tail.
- **Cache:** head unshift + stub rewrites move first divergence to the start of the message list. Contrast ACM heartbeat, which **intentionally** appends ~3 tokens to the last user message “outside the cached prefix.” ACM already knows tail is cheaper — and still puts **pins** at the head.
- **PinStateTree:** none. Flat ID set + named MKP swap.

### 4.2 Claude Code — requested `/pin`, shipped file re-inject

**Not shipped as message pin.**

- [anthropics/claude-code#32874](https://github.com/anthropics/claude-code/issues/32874) — pin/bookmark messages; “ideally survive compaction.” Stale.
- [anthropics/claude-code#44598](https://github.com/anthropics/claude-code/issues/44598) — session-scoped `/pin` / `/pinned` / `/unpin`; re-inject **after** compact, not into the summary; never write CLAUDE.md. Closed as duplicate/stale; later referenced by `#61973` (session-pinned **memory file**).

**What Anthropic documents instead** ([What survives compaction](https://code.claude.com/docs/en/context-window#what-survives-compaction), also linked from [memory troubleshooting](https://docs.anthropic.com/en/docs/claude-code/memory)):

| Mechanism | After `/compact` |
|---|---|
| System prompt and output style | Unchanged (not history) |
| Project-root `CLAUDE.md` and **unscoped** rules | Re-injected **from disk** |
| Auto memory (`MEMORY.md`) | Re-injected from disk |
| Rules with `paths:` frontmatter | **Lost** until a matching file is read again |
| Nested `CLAUDE.md` | **Lost** until a file in that subdirectory is read again |
| Invoked skill bodies | Re-injected, 5k tokens/skill, 25k total; oldest dropped; truncate from the **top** |
| Skill **descriptions** (startup listing) | **Not** re-injected |
| In-conversation instructions | Folded into the summary (lossy) |

`InstructionsLoaded` hook documents load reason `compact` ([hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)) — the re-inject path is real, and it is **file/memory reload**, not a user-marked journal pin.

**Design lesson:** Claude’s surviving layer is **source-of-truth on disk**, re-projected after compact. Session-only verbal constraints have no first-class pin. That is exactly the gap `#44598` named, and it is still a gap.

### 4.3 Cursor — pin-context removed; message pin is a forum request

**Removed product (file pin, not message pin).** Staff (danperks) on [forum #13197](https://forum.cursor.com/t/pin-context-feature-is-gone/13197) (2025-01-21 / 2025-02-11): “pin context” (pin `@file` so it is re-attached every turn) was **removed** because it re-extracted the same file slices every prompt and filled the window with repeated code. Recommendation: Project Rules.

**Not shipped:** [forum #55392](https://forum.cursor.com/t/persistent-conversation-preferences-pinning-key-facts-for-better-ai-consistency/55392) (pin facts / pin any prompt, sticky at top); [forum #151575](https://forum.cursor.com/t/pin-messages-in-ai-chat-window-supports-handy-messages-reduces-model-hallucination/151575) (pin messages so they are not summarised).

**Official adjacent behavior** ([cursor.com/docs/agent/prompting](https://cursor.com/docs/agent/prompting.md); staff on [forum #164491](https://forum.cursor.com/t/whats-the-best-practice-coding-with-cursor-agent/164491/10)):

- Compaction summarises **conversation** (messages, tools, results), not the system prompt.
- Rules / `AGENTS.md` are pulled from **config**, so they are more resilient than chat-only instructions.
- Context ring categories include System, Rules, Skills, Summarized conversation, Conversation — no “Pinned messages” bucket.

Cursor’s old pin was a **source-file always-reattach** and was withdrawn for cache/token reasons. That is a warning against naive “re-inject the whole file every turn.”

### 4.4 Codex — thread pin is a picker favorite

Official: [openai/codex#34840](https://github.com/openai/codex/pull/34840) (merged 2026-07-22, `400ee190`):

- `isPinned` on thread metadata.
- `thread/metadata/update` can set pin.
- `thread/list` can filter `isPinned`.
- Persist in **SQLite without modifying rollout files**.
- Preserve through reconciliation and archive.

That is **which thread appears at the top of the session list**, not which messages stay in the model window. Third-party writeups that say “pinned threads survive compaction cycles” describe **metadata survival**, not context re-insert. Do not import that sentence as InitiativePin evidence.

`AGENTS.md` (user / repo / cwd merge) is Codex’s file-backed instruction channel — same class as Claude `CLAUDE.md` / Cursor rules, not a message pin.

[openai/codex#26233](https://github.com/openai/codex/issues/26233) is about restoring an assistant-callable **thread** pin tool (`set_thread_pinned`). Still not context pin.

### 4.5 oh-my-pi and Pi extensions — no context pin found

Searched `docs/ref_repos/oh-my-pi-main` @ `de6b7974a0`, `pi-dcp` @ `7ae24be`, `pi-dcp-vault` @ `d9b7569`, plus public npm/GitHub for pi pin extensions.

**Host “pin” words that are not InitiativePin:**

| Surface | What it locks |
|---|---|
| `/session pin [account]` | OAuth **credential** for this session (`packages/coding-agent/src/slash-commands/builtin-session.ts`, `helpers/session-pin.ts`) |
| `--prompt-cache-key` | Provider prompt-cache **identity** (`docs/session-operations-export-share-fork-resume.md`) |
| “skill pinning override” | Explicitly **absent**: “there is no per-task skill pinning override” (`docs/skills.md` L140) |
| DCP `protectedTools` / recency keep | Prune **exemption**, not a salience pin |

Extension **seams** that would let QOL build a pin (not a product): `pi.on("context")` message rewrite, `pi.appendEntry`, `session_before_compact` / `session.compacting`, `sendMessage` / `sendUserMessage`. See H6 `plugin-seams.md` and host docs `docs/hooks.md`.

Public Pi extensions in this problem space are **DCP ports** (compress/prune/nudge). No oh-my-pi or pi-coding-agent extension was found that implements `/pin` or persistent message salience.

### 4.6 OpenCode `#4659` inception (design only)

rickross’s sliding-window writeup names **inception messages**: `preserve: true`, never pruned, travel with the window. Unshipped in OpenCode core. ACM’s pin+reinject is the plugin-shaped descendant. Useful vocabulary; not a runtime.

---

## 5. Design lessons for OMP-QOL InitiativePin / PinStateTree

Foundation kinds and placements (`08-PIN.md`) remain the right vocabulary. Ecosystem evidence maps as follows.

### 5.1 Kinds

| Kind | Who has it | Steal / reject |
|---|---|---|
| **instruction** | btw (`/btw pin`), Claude/Cursor/Codex **files**, `#15432` session-rules (unshipped) | Steal: session-scoped authored text distinct from journal rows. Reject: btw’s silent dual injection and user-only authorship. QOL pillar wants the **agent** to pin/unpin. |
| **source** | ACM (any message ID), `#9097` (user messages only) | Steal: address by stable ID; survive compact by **projection**, not by keeping the row in the native window. Reject: raw tool/assistant replay; ACM sidecar DB; `#9097` user-only. Pillar: any role may need a pin; render provider-neutral text. |
| **snapshot** | **Nobody shipped this.** Closest: ACM `acm_snapshot` (session repair dump, not a pin kind); Claude invoked-skill re-inject (reload file, not freeze-at-pin-time) | Still needed. Source pins follow a moving journal; snapshots freeze “what mattered then.” |

Do not collapse “pin skill” into “install lock.” The pillar’s OpenCode prior art is ACM **MKP / `acm_pin` of a loaded skill-or-doc message** — a **source** pin of a tool/file result — not `plugin@version`.

### 5.2 Placement

| Placement | Who | Cache / behavior |
|---|---|---|
| **System prepend** | btw default | Highest authority, **prefix-cache destroyer**. Foundation: only standing instruction-class pins, explicit. |
| **System append** | btw option | Slightly less prefix-hostile; still system-channel. |
| **Head of message list** | ACM re-inject | Easy on `messages.transform`. First divergence at list start. Foundation **does not** recommend this as default. |
| **Last-user append** | btw user half; ACM heartbeat | Recency + small suffix miss. Risk: mutates the user’s actual request; tool-loop “last user” may be stale. Foundation tail-zone is **before the current turn frontier**, not glued onto the user utterance. |
| **Post-compact mid-list** | `#9097` splice after checkpoint | Natural for “this was before the boundary, bring it back.” Mid-history cost: earlier divergence than a tail block. |
| **Tail pin zone** | Foundation v1 default; **no shipped neighbor** | Hypothesis still to measure (E1). |

QOL should treat **placement as a projection policy**, not as the definition of a pin. ACM and btw both **define pin as “how we inject.”** Foundation defines pin as **salience intent**; injection is derived.

### 5.3 Compaction survival (three different contracts)

Ecosystem products confuse these. QOL must name them separately (foundation §8):

1. **Request salience** — appear in the next provider request (btw every call; ACM transform; Claude file reload).
2. **Summarizer guidance** — tell compact *what to keep* (`session.compacting` extra context). Almost nobody does this as a pin. OpenCode blog/plugins append Keep: lines to the compact prompt; that is **not** a pin object.
3. **Post-boundary re-insert** — after native compact drops old rows from the active window, put designated content back (`#9097` splice; ACM unshift of missing IDs).

btw gets (1) for free and **ignores** (2) and (3).  
`#9097` implements (3) for user messages and barely tests it.  
ACM implements (1)+(3) via sidecar + transform, and uses pin to **block prune** (a fourth contract: **exemption from stubbing**).  
Claude implements (1) for **disk** sources after compact (`InstructionsLoaded` reason `compact`).

Because OMP journal is lossless, a source pin can still render after native compact **from canonical entries** (foundation §8). Do not require the native `buildSessionContext()` window to still contain the source. That is the ACM/`#9097` lesson without their storage choices.

### 5.4 PinStateTree

No evidenced system has:

- multiple trees,
- one active leaf per tree,
- ancestor-path union of pin specs,
- sibling-only display,
- leaf = message pins **or** custom instructions.

btw stack ≠ tree (no deactivate-on-leave). ACM MKP names ≠ tree (swap is manual unload/load). Claude path-scoped rules ≠ tree (file glob, not agent-marched leaf).

Invariant #10 stands: implement flat Pin first. Tree is policy over PinSpecs.

### 5.5 Agent freedom vs user slash

| Who may pin | Systems |
|---|---|
| User slash / TUI only | btw, `#9097` `/pin`, Claude `/pin` proposals, Cursor requests |
| Agent tools | ACM `acm_pin` / `acm_load` |
| Automatic heuristics | Claude `#44598` phase-2 auto-pin (unshipped); DCP recency protect (not pin) |

Pillar: **agent** gets maximum pin/unpin freedom. ACM’s tool shape is the only shipped match. btw and `#9097` are user-steering products.

### 5.6 Storage

| Store | Who | QOL stance (from D3 + this track) |
|---|---|---|
| Sidecar JSON under `~/.cache` | btw | Session-scoped but **outside** journal → fork/undo/export blind |
| Sidecar SQLite | ACM, Codex thread pin | Reject for pin **state**; Codex shows sidecar is correct for **UI** metadata |
| Flag on journal row | `#9097` | Mutates the user message in place; not append-only |
| File on disk | Claude/Cursor/Codex instructions | Correct for **project** harness resources; wrong as the only session pin |
| Append-only custom entries | Foundation / H6 | No neighbor shipped this for pin. That is QOL’s differentiator. |

---

## 6. What is NOT a pin

These uses of “pin” must not leak into InitiativePin / PinStateTree design or tool names without a qualifier.

| Homonym | Evidence | Why it is not InitiativePin |
|---|---|---|
| **Package / plugin version pin** | npm `pkg@1.2.3`; OpenCode `"plugin": ["opencode-btw@0.4.0"]`; auth-plugin docs (“pin the plugin to a version”); btw’s own HEAD commit *“remove latest version pin from installation instructions”* | Install lock. No session salience. |
| **`omp-plugins.lock.json`** | `docs/researches/ops/omp-plugin-packaging-and-distribution.md`, `omp-project-scoped-plugins.md` | Host-written enablement + version lock for plugins. |
| **Skill pinning as install / catalog lock** | OMP `docs/skills.md`: “there is no per-task skill pinning override”; OpenCode skill permissions `allow/deny/ask` | Which skills exist or may be invoked — not “keep this skill **body** in the working context.” The pillar’s “pin skill doc” example is ACM-style **source pin of a loaded message**, not this. |
| **OAuth / account pin** | OMP `/session pin`; Codex/Anthropic session credential pin in `auth-storage.ts` | Sticky **credential**, for cache/routing. |
| **Prompt-cache-key pin** | OMP `--prompt-cache-key` | Cache **identity**, not content salience. |
| **Thread / chat pin in a picker** | Codex `#34840` `isPinned`; Cursor sidebar favorites (if present) | UX sort order. Rollout/transcript unchanged. |
| **DCP protect / recency keep** | Pi-DCP `protectedTools`, recency-N | Prune exemption. No pin identity, no agent pin/unpin of arbitrary messages. |
| **Thinking-signature / model pin** | OMP provider tests “pin session as signing” | Protocol quirk, not context policy. |

If a tool is named `pin`, its help text must say **context salience**. Version/account/thread locks keep their existing names.

---

## 7. Comparative matrix (compact)

| Question | btw | OC `#9097` | ACM | Claude | Cursor | Codex | OMP host |
|---|---|---|---|---|---|---|---|
| Pin a journal message? | No | User only | Yes | No | No | No | No |
| Pin authored instruction? | Yes | Only if it is a user msg | Via `acm_load` text | Via files | Via rules | Via AGENTS.md | No |
| Pin tool result / skill body? | No | No | Yes (source replay) | Invoked skills re-injected from disk | No | No | No |
| Snapshot kind? | No | No | No | No | No | No | No |
| Default placement | System head + last user | After compact checkpoint | Message-list head | Disk → system/startup | Rules channel | n/a | n/a |
| Compact survival | Sidecar re-apply | Designed splice | Sidecar + unshift | File reload | Config reload | n/a | n/a |
| Agent-initiated? | No | No | Yes | No (`/pin` unshipped) | No | No | No |
| Tree of pin states? | No | No | No | No | No | No | No |
| Shipped? | Yes | **No** | Yes | Files yes; `/pin` no | Rules yes; pin-context **removed** | Thread pin yes; context pin no | No |

---

## 8. Steal vs reject (D4 only)

**Steal**

- Separate **transient nudge** vs **standing pin** (btw lifetime), but persist standing pins in the **journal overlay**, not `~/.cache`.
- Compaction survival = **re-project after the boundary**, not “hope the summarizer remembered” (`#9097`, ACM, Claude `#44598`).
- File-backed project instructions stay **harness resources**, not session pins (Claude/Cursor/Codex).
- Tail/suffix injection is the cheap cache move (ACM heartbeat comment; foundation tail-zone). Measure it (E1); do not assume.
- Agent-facing pin tools (ACM), not only user slash (btw / `#9097`).
- Named loads (ACM MKP) as optional **display names** on instruction/source pins — not a second store.

**Reject**

- Default **system prepend + last-user dual write** (btw).
- Head `unshift` as the only pin render (ACM).
- User-message-only pins (`#9097`).
- Raw provider-message replay for tool/assistant (ACM, `#9097`).
- Sidecar DB/JSON as source of truth (ACM, btw).
- Waiting for OpenCode to merge `#9097` (closed by cleanup; current `dev` has no `pinned`).
- Importing Codex/OMP “pin” APIs as context features.
- Building PinStateTree before flat Pin has behavioral evidence.

---

## 9. Open questions this track does not close

1. **H3 / E1:** Measure first-divergence for tail-zone vs ACM head vs btw system-prepend on OMP providers. Ranking in `08-PIN.md` is still a hypothesis.
2. **H4:** Can `(sessionId, entryId)` replace ACM message-id + btw cache files without a sidecar?
3. **Native `#9097` vs overlay:** If OpenCode later ships a user-message `pinned` flag, QOL overlay must not fight it. Today there is nothing to integrate.
4. **Skill-body pin:** Claude re-injects invoked skills from disk with caps. QOL source-pin of a skill **tool result** is a different object (session-local, agent-controlled, uncapped unless the agent says so). Do not silently copy Claude’s 5k/25k caps.

---

## 10. Sources

### Local

- `docs/ref_repos/opencode-btw` @ `b6386a3` — `README.md`, `src/plugin.ts`, `src/core.ts`, `src/config.ts`, `src/plugin.test.ts`
- `docs/ref_repos/opencode-acm` @ `6ca26461` — `src/index.ts` L179–199, `src/store.ts` `pinMessage` / `getPinnedMessages`
- `docs/ref_repos/oh-my-pi-main` @ `de6b7974a0` — `docs/skills.md` L140; `packages/coding-agent/src/slash-commands/builtin-session.ts`
- `docs/workspaces/initiative-context-management/research/opencode-acm.md` (D3)
- `docs/researches/OMP-QOL-Complete-Research-Handoff-2026-08-09/02-foundation-research/08-PIN.md` (kinds/placement; not a pillar rewrite)
- Pillars (read-only): `InitiativePin.md`, `PinStateTree.md`

### Web (fetched 2026-08-16)

- https://github.com/anomalyco/opencode/pull/9097 and `GET /repos/anomalyco/opencode/pulls/9097` + `/files`
- https://github.com/anomalyco/opencode/issues/8932
- https://github.com/anomalyco/opencode/issues/4659
- https://github.com/anomalyco/opencode/issues/15432
- https://github.com/anthropics/claude-code/issues/44598
- https://github.com/anthropics/claude-code/issues/32874
- https://code.claude.com/docs/en/context-window#what-survives-compaction
- https://docs.anthropic.com/en/docs/claude-code/memory
- https://docs.anthropic.com/en/docs/claude-code/hooks (`InstructionsLoaded` reason `compact`)
- https://forum.cursor.com/t/pin-context-feature-is-gone/13197
- https://forum.cursor.com/t/persistent-conversation-preferences-pinning-key-facts-for-better-ai-consistency/55392
- https://forum.cursor.com/t/pin-messages-in-ai-chat-window-supports-handy-messages-reduces-model-hallucination/151575
- https://cursor.com/docs/agent/prompting.md
- https://github.com/openai/codex/pull/34840
- https://github.com/openai/codex/issues/26233
