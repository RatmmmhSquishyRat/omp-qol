# Session 005: initiative-context-management workspace

**date**: 2026-08-16
**commits**: `7bee9cc`, `fbb80c7`, `6f57c47`

## Turn 1

### User

> 接下来我们要继续开发了. 这个qol中最重要也是最核心的内容, 同时也是难度最高的模块, 那就是主动上下文管理.
> initiative-context-management. 包含两个基础部分, 那就是主动压缩和主动pin, 以及一个qol功能pin tree.
>
> 接下来, 我的建议是, 先大量fan-out subagents, 进行充分地搜索调查研究, 我应该在research文件夹中给出了一部分初步研究资料, 具体实现细节还需要进行大量的研究和细节确认, 机制规划, 源码研究等等来进行技术选型和决策固定. 主动上下文管理, 完全不同于omp-qol中的其他部分, 是因为它本身功能不存在, 而且极为复杂繁琐, 并且需要从头进行架构设计和规划, 以及完整的实现规划, 还有给予实际使用的验证, 甚至还需要对于缓存率, 价格影响等等指标进行验证和分析 - 这些都是量很大的工作.
>
> 因此我们需要在doc文件夹中的合适路径上面, 建立对于这个模块的完整工作区文件夹, 以进行长期, 庞大, 分模块解耦, 复杂的研究规划设计工作, 来保证我们真的能够实现这个功能模块. 另外我还建议你对于任何你认为相关的仓库, 于C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ref_repos中进行clone和参考.
>
> 你需要完整理解, 并建立你自己的工作流, 各个计划和相关文档, 以及todo, 然后积极使用subagents进行不同方向和粒度的任务, 来完整工作. 请你不要犹豫地进行工作完整拓展延伸和深挖, use as much token&fan-out subagents as you can , the more subagents you use, the linearly more token intelligence we will get. Dont hesitate to plan and march thoroughly, expand widely, dive in deeply.

### Agent Actions

- Read ICM pillars and the 2026-08-09 foundation handoff (overlay/seal C vs D, provenance gap, cache-as-frontier, pin kinds, tree deferred).
- Append 2026-08-16 author scope verbatim to the pillar README; did not rewrite existing proposal text; marked PrimeStyle as adjacent, not this v1.
- Created living workspace at `docs/workspaces/initiative-context-management/`.
- Junctioned shared `oh-my-pi` (17.3.4 `ffd53ff92a`); added detached worktree `oh-my-pi-main` @ `de6b7974a0`; cloned DCP, pi-dcp, pi-dcp-vault, opencode-acm, opencode-btw, prime-agent. Gitignored `docs/ref_repos/`.
- Opening fan-out research tracks against current host and comparison repos. No product code in this pass.

## Turn 2

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...

### Agent Actions

- Ingested H6 `plugin-seams.md`: current plugin has no context/compaction hooks; ADR-004 does not block a new overlay engine; reuse JSON envelope / approval / kill switches.
- Launched remaining research tracks: OpenCode DCP, Pi-DCP ports, ACM, pin ecosystem, cache/cost, agent UX, 2026-08-09 ingest matrix.
- Updated workspace STATUS/TODO. Still no product code.

## Turn 3

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...
> (H1 host-compaction, D1 OpenCode DCP, D2 Pi-DCP, D3 ACM landed in the same window)

### Agent Actions

- Closed Q1: 17.3.4 still floors native compaction by stored estimate (E2). Architecture A rejected. Custom `CompactionResult` still seals and skips snapcompact.
- Recorded steal/reject from D1/D2/D3: overlay + blocks + appendEntry + inspect tools; no sidecar, no auto-dedup defaults, no fixed stubs, deterministic self-footprint scrub.
- Partial `refs/HOST-LOCK.md`. Waiting on H2–H5, D4, E1, U1, I1. No product code.

## Turn 4

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...
> (H2 context, H3 cache, H4 addressing, H5 delta, plus D1/D3 second passes)

### Agent Actions

- Closed host substrate at E2: appendEntry, context provenance gap, serial handlers, longest-prefix cache, persist `(sessionId, entryId)`.
- Working decisions: hybrid address layer; v1 target C; cache = divergence+suffix; tail-zone pin default (host-side).
- Drafted `designs/address-layer.md`. Completed `refs/HOST-LOCK.md`. Still waiting D4/E1/U1/I1. No product code.

## Turn 5

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...
> (D2 Pi-DCP second pass + D4 pin ecosystem)

### Agent Actions

- D2 second pass: neither Pi-DCP port uses `(sessionId, entryId)` or `session_before_compact` — reinforces address-layer + C.
- D4: no shipped InitiativePin. Recorded working pin defaults and drafted `designs/pin.md`. Q7/Q8 not frozen. Still waiting E1/U1/I1. No product code.

## Turn 6

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...
> (E1 cache-cost)

### Agent Actions

- Ingested E1: two-layer cache/price model; fixture contract drafted as `designs/eval-metrics.md`. Q8 = designed, not run. Tail-cheap still a hypothesis. Waiting U1/I1. No product code.

## Turn 7

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...
> (D4 second pass + I1 ingest; U1 also on disk)

### Agent Actions

- I1: no 2026-08-09 ICM host finding overturned on 17.3.4. False assumptions O1–O16 stay dead.
- D4 second pass: OMP `/session pin` is OAuth — recorded as a name collision.
- U1: one `context` multi-op tool + pressure envelope; drafted `designs/agent-ux.md` and `designs/overlay-engine.md`.
- Opening fan-out marked complete. Remaining freezes: overlay schema, sealed-expand UX. No product code.

## Turn 8

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...
> (E1 cache-cost second pass)

### Agent Actions

- Second E1 pass did not change the four-arm contract. Added to `designs/eval-metrics.md`: isolation prefix `.omp-qol-e2e-*`, Z.AI/GLM `cacheWrite=0` + table-priced cached input, dual `usdHost`/`usdOfficial` when catalog lags DeepSeek peak. No product code.

## Turn 9

### User

> Perform any necessary follow-up actions in response to the subagent completion above. ...
> (U1 agent-ux second pass)

### Agent Actions

- Aligned address layer with U1: model types `m:<entryId>` / `t:<toolCallId>` / `b:<blockId>`, not sequential `m0001`. Updated `designs/address-layer.md`, `designs/agent-ux.md`, Q2, DECISIONS. No product code.

## Turn 2

### User

> Inventory the current omp-qol plugin for what ICM can reuse.
>
> REPO: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol
> Read plugin/src/**, plugin/types/**, ADR-004, ADR-005, host-bridge.ts, main.ts, advisor-tool.ts (envelope/UX only).
>
> WRITE report to:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\plugin-seams.md
>
> Answer:
> 1. What live session fields exist today (sessionManager.buildSessionContext, getEntries, applyAdvisorConfigs, ...)?
> 2. Is there any context event handler? (expect no)
> 3. How tools register, approval tiers, pure-JSON envelope — what ICM should copy
> 4. What host-bridge pattern ICM should reuse vs what new reach is required (appendEntry, context hook, session_before_compact)
> 5. Tension: ADR-004 forbids emulating host features that exist; ICM features do not exist. How to apply the law without blocking the overlay engine.
> 6. Settings kill-switch pattern for a future context tool
>
> No product code. Do not edit pillars. Thoroughness: medium-high.
> Return a short summary after writing the file.

### Agent Actions

- Read `plugin/src/**`, `plugin/types/**`, ADR-004, ADR-005, host-bridge, main, advisor-tool (envelope), mode/goal tools, settings.
- Confirmed: no `context`, `session_before_compact`, or `appendEntry` usage; only `session_start` event.
- Wrote H6 report `docs/workspaces/initiative-context-management/research/plugin-seams.md` covering session fields, tool patterns, bridge reuse vs ICM gaps, ADR-004 framing, kill-switch template.
- Linked report from `research/00-index.md`.

## Turn 3

### User

> Deep-dive OpenCode DCP for omp-qol ICM comparison.
>
> REPO: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ref_repos\opencode-dynamic-context-pruning
> Also read existing transcripts (do not edit them):
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\dcp\omp_dcp_research_transcript.md
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\dcp\dcp_tool_call_result_compression_supplement_transcript.md
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\dcp\OMP_DCP_message_id_supplement_transcript.md
>
> WRITE report to:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\dcp-opencode.md
>
> Cover:
> - Architecture: transform-on-request vs mutate history
> - Address layer (m0001 / message IDs / range)
> - compress tool schema (range vs message), agent UX
> - Auto policies: dedup same-args, error purge, nudges — contrast with pillar "agent decides everything"
> - Self-footprint of compress tool arguments (does it scrub immediately or delay-compress the compress call?)
> - Persistence of compression blocks; expand/decompress
> - Protocol safety for tool call/result pairs
> - What QOL should steal vs reject
> - Record cloned HEAD commit
>
> Pillar to respect (do not rewrite): agent may compress any messages into any content at any time, or expand any summary. Plugin maximizes freedom; auto-policy is not the product.
>
> No product code. Very thorough.
> Return a short summary after writing the file.

### Agent Actions

- Checked out DCP ref repo working tree; recorded HEAD `85b6f5ceba144fee9e65eb28dc36cab1b960e418`.
- Read three DCP transcripts verbatim (unchanged); inspected DCP source: hooks, prune, compress tools, strategies, persistence, decompress, prompts, message-ids.
- Wrote D1 report `docs/workspaces/initiative-context-management/research/dcp-opencode.md` (architecture, addressing, auto-policy vs pillar, self-footprint, persistence/expand, protocol safety, steal/reject matrix).
- Updated `research/00-index.md` and `refs/INDEX.md` with DCP commit lock.

## Turn 4

### User

> Research rickross/opencode-acm as a near-neighbor product for omp-qol pin + compress.
> ... (write report to research/opencode-acm.md; 7 topics; cite files; no product code)

### Agent Actions

- Checked out `docs/ref_repos/opencode-acm` working tree @ `6ca26461` (v0.5.57).
- Read `src/index.ts`, `store.ts`, `client.ts`, `tools.ts`, `README.md`, `package.json`.
- Wrote/refreshed D3 report `docs/workspaces/initiative-context-management/research/opencode-acm.md`: pin model, head reinject vs telemetry/heartbeat placement, prune vs boundary compact, 17-tool UX, acm.db + opencode.db persistence/repair, OMP seam mapping (`context`, `appendEntry`, `CompactionEntry`), InitiativePin vs PinStateTree lessons.

## Turn 5

### User

> Diff OMP ICM-relevant source from the 2026-08-09 lock to current main.
>
> OLD LOCK: can1357/oh-my-pi 45e12e5bb758198a920c6070e7e64cb33b21beac (coding-agent 17.2.12)
> NEW: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ref_repos\oh-my-pi-main @ de6b7974a0 (17.3.4)
> The parent full clone is C:\Users\15480\Desktop\AIWorkshop\ref_repos\oh-my-pi — use git diff / git log there (full history). Do NOT git pull or move that checkout.
>
> WRITE report to:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\host-delta-17.3.md
>
> Diff at least: (11 listed paths)
> Also list coding-agent version history 17.2.12 → 17.3.4.
> For each ICM-relevant change: keep / strengthen / overturn / new seam.
> Call out anything that changes C-vs-D, provenance, cache, or appendEntry.
> Do not edit pillars/handoff. No product code. Very thorough.
> Return a short summary after writing the file.

### Agent Actions

- Ran `git diff` / `git log` on full clone `ref_repos/oh-my-pi` from `45e12e5` → `de6b7974a0` across all 11 required paths.
- Confirmed **no diff** on: `compaction.ts`, `append-only-context.ts`, `session-context.ts`, `docs/compaction.md`.
- Material diffs in: `agent-loop.ts`, `session-maintenance.ts`, `session-manager.ts`, `extensions/types.ts`, `runner.ts`, `shared-events.ts`, `sdk.ts`.
- Mapped coding-agent version bumps 17.2.12 → 17.3.4 with ICM-adjacent commits per window.
- Wrote H5 report `docs/workspaces/initiative-context-management/research/host-delta-17.3.md`: verdict matrix, C-vs-D/provenance/cache/appendEntry cross-cut, 2026-08-09 reverify checklist, adjacent seams (`omp compress`, late tool registration, anthropicCacheRefresh).

## Turn 6

### User

> Compare Pi-DCP ports for omp-qol ICM. These are the closest existing implementations on a Pi-like extension API.
>
> SOURCES:
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ref_repos\pi-dcp   (Davidcreador / @davecodes/pi-dcp)
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ref_repos\pi-dcp-vault  (pi-vault/pi-dcp)
>
> WRITE report to:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\pi-dcp.md
>
> Answer from SOURCE: (9 topics listed)
>
> Cite paths. No product code. Do not edit pillars. Very thorough.
> Return a short summary after writing the file.

### Agent Actions

- Checked out both Pi-DCP ref trees: Davecodes @ `7ae24be` (v0.2.0), pi-vault @ `d9b7569` (v0.5.0).
- Read extension wiring, pipeline, compress tools, persistence, strategies, nudges, sweep/decompress commands from both ports.
- Wrote D2 report `docs/workspaces/initiative-context-management/research/pi-dcp.md`: context hook, addressing (toolCallId vs m0001/bN), sidecar vs appendEntry, operator surfaces, compaction/headroom, self-footprint, protocol safety, reuse vs freedom-pillar conflicts, port diff matrix.

## Turn 7

### User

> Create the inherit / re-verify / overturn matrix for the 2026-08-09 ICM foundation package.
>
> READ (do not edit these):
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\OMP-QOL-Complete-Research-Handoff-2026-08-09\01-FOUNDATION-REPORT.md
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\OMP-QOL-Complete-Research-Handoff-2026-08-09\02-foundation-research\03-UNCERTAINTY-REGISTER.md
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\OMP-QOL-Complete-Research-Handoff-2026-08-09\02-foundation-research\14-P0-CLOSURE-NOTES.md
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\OMP-QOL-Complete-Research-Handoff-2026-08-09\02-foundation-research\07-CONTEXT-OVERLAY-ENGINE.md
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\INVARIANTS.md
> - C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\questions\open-questions.md
> - If already present, also read any of:
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\plugin-seams.md
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\host-*.md
>
> WRITE:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\ingest-2026-08-09.md
>
> Table every architecture-changing claim:
> - claim
> - 2026-08-09 status
> - inherit as working law / must re-verify on 17.3.4 / already overturned / out of v1 scope
> - which research file will close it
> - notes
>
> Be complete for ICM (compress/pin/tree/provenance/cache/headroom). Mark advisor/PrimeStyle rows as adjacent/out of this program.
> No product code. Do not edit the handoff files.
> Return a short summary after writing the file.

### Agent Actions

- Read the 2026-08-09 foundation report, uncertainty register, P0 closure notes, overlay engine, pin/tree notes, INVARIANTS, open questions, and all landed H1–H6 host/plugin reports.
- Wrote I1 ingest matrix `docs/workspaces/initiative-context-management/research/ingest-2026-08-09.md`: overturned originals, headroom, overlay, provenance, protocol, cache, pin, tree, UX, adjacent Advisor/PrimeStyle.
- No 2026-08-09 ICM host finding overturned on 17.3.4; C vs D / sealed expand / public `@message` stay open. Handoff files not edited.

## Turn 7

### User

> Research pin-adjacent systems for omp-qol InitiativePin / PinStateTree.
>
> Local clone: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ref_repos\opencode-btw
> Also web-research (use WebSearch/WebFetch as needed):
> - anomalyco/opencode PR 9097 and issue 8932 (native pin after compaction)
> - Claude Code / Cursor / Codex any "pin message" or sticky instruction features you can evidence
> - Any oh-my-pi or pi extension that already pins
>
> WRITE report to:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\pin-ecosystem.md
>
> Cover:
> 1. opencode-btw: transient hint vs `/btw pin` persistent hint; placement (system prepend + last user append); cache implications
> 2. OpenCode native pin PR: mechanism, status, re-insert after compact
> 3. Other evidenced pin systems
> 4. Design lessons for OMP-QOL: kinds (source/snapshot/instruction), placement (tail/system/mid), compaction survival
> 5. What is NOT a pin (version pinning, skill pinning as install lock)
>
> Be evidence-backed. No product code. Do not edit pillars.
> Return a short summary after writing the file.

### Agent Actions

- Read btw @ `b6386a3` (0.4.0): sidecar hints, transient vs `/btw pin`, default dual inject (system unshift + last-user append).
- Fetched OpenCode PR `#9097` (closed unmerged 2026-05-15) and issue `#8932`; confirmed current `dev` has no `UserMessage.pinned`.
- Web-evidenced Claude `/pin` requests vs official file re-inject; Cursor pin-context removed; Codex thread `isPinned` is picker-only; no OMP/Pi context-pin extension.
- Wrote D4 `research/pin-ecosystem.md`. No pillars edited, no product code.

## Turn 8

### User

> Design-research the agent-facing UX for omp-qol ICM tools. Do not implement.
>
> Read:
> - Pillars (do not edit):
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ssot\pillars\initiative-context-management\InitiativeSummary.md
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ssot\pillars\initiative-context-management\InitiativePin.md
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ssot\pillars\initiative-context-management\PinStateTree.md
> - Current QOL tool UX (copy patterns, do not change code):
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\plugin\src\advisor-tool.ts
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\plugin\src\goal-tool.ts
>   C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\plugin\src\mode-tool.ts
> - DCP transcripts under C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\dcp\
> - Workspace questions: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\questions\open-questions.md
>
> WRITE report to:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\agent-ux.md
>
> Recommend, with rationale, not a freeze:
> 1. One `context` multi-op tool vs separate compress/pin/tree tools
> 2. Pure JSON envelope fields (ok, op, warnings, raw vs projected vs native pressure, exactExpandAvailable)
> 3. How the model names messages before public @syntax is frozen
> 4. What belongs in tool description vs a skill (heuristics only)
> 5. Approval tiers (read vs write)
> 6. Failure texts that preserve freedom (reject protocol-unsafe ranges with normalized alternative, never silently compress something else)
> 7. Tension: DCP auto-nudge vs pillar "agent decides"
>
> No product code. Do not edit pillars.
> Return a short summary after writing the file.

### Agent Actions

- Read ICM pillars (unchanged), QOL `advisor`/`goal`/`mode` tools, DCP transcripts, open questions, and sibling reports (D1/D2/D3, H1, H6, overlay-engine prior).
- Wrote U1 `research/agent-ux.md`: one `context` tool; advisor envelope + pressure + `exactExpandAvailable`; provisional `m:`/`t:`/`b:`/`c:`; skill=when/why; dynamic approval; reject-don't-widen; no default nudges.
- Linked from `research/00-index.md` and `STATUS.md`. No pillars or product code edited.

## Turn 3

### User

> Research prompt-cache and price-impact measurement for omp-qol ICM.
>
> OMP host for how tokens are recorded:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\ref_repos\oh-my-pi-main
> Look at cacheRead/cacheWrite in session stats / advisor stats / provider usage types.
>
> Also web-research current (2026) prompt caching pricing/behavior for:
> - Anthropic Claude prompt cache (cache write vs read, TTL, what invalidates)
> - OpenAI / Responses API prompt cache if applicable
> - DeepSeek / other providers OMP commonly uses, if documented
>
> WRITE report to:
> C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\workspaces\initiative-context-management\research\cache-cost.md
>
> Must include:
> 1. Provider rules: what must stay byte-stable for a cache hit
> 2. Mapping onto OMP AppendOnlyContextManager (you may not have that file memorized; if you can read host-cache later it's ok to state dependencies)
> 3. Proposed measurement fixture for QOL: arms native / overlay / overlay+seal / overlay+pin; metrics cacheRead, cacheWrite, input, output, native pressure, first divergence, USD estimate
> 4. Hypotheses to test: tail pin cheap; system pin expensive; mid-history pin expensive; deep compress invalidates from anchor
> 5. How an L6 e2e should record cost without killing live ~/.omp sessions (use PI_CONFIG_DIR isolation like existing plugin tests)
>
> No product code. Do not edit pillars.
> Return a short summary after writing the file.

### Agent Actions

- Read host `Usage`, `SessionStatsTracker`, `AdvisorStats`, `calculateCost`, `AppendOnlyContextManager`, and existing advisor L6 isolation (`PI_CONFIG_DIR=.omp-qol-e2e-*`, credentials only).
- Retrieved 2026-08-16 official cache docs: Anthropic (5m/1h, 1.25×/2× write, 0.1× read), OpenAI Responses (GPT-5.6+ 1.25× write / 30m TTL; earlier free writes), DeepSeek (hit/miss, no write; peak rates from 16:00 UTC today), Z.AI GLM cached input.
- Wrote E1 `research/cache-cost.md`. Cited H3 for digest details; did not edit pillars or product code.

## Turn 10

### User

> continue

### Agent Actions

- Drafted Q4 sealed-expand proposal (`designs/sealed-expand.md`): pre-seal = overlay-disable (exact); post-seal default = journal rehydrate with `exactExpandAvailable: false`; branch as explicit escape. Pillar tension surfaced, marked NEEDS AUTHOR RATIFICATION — not silently closed.
- Updated Q4 in `questions/open-questions.md`, added proposed entry to `DECISIONS.md`, refreshed `TODO.md` / `STATUS.md` blockers.
- Committed the workspace opening (34 files: control plane + 13 research reports + 7 design drafts + verbatim pillar + gitignore for `docs/ref_repos/`). User-side `docs/researches/` reorganization and `test-workspace/` content left untouched.
- Launched three background subagents: overlay event schema freeze draft (`designs/overlay-schema.md`), compress closure/scrub/seal design (`designs/compress.md`), and an E3 runtime probe of `appendEntry` / `context` / `session_before_compact` on the real 17.3.4 host under an isolated `PI_CONFIG_DIR`.
- **Schema landed** → reviewed with three host-source spot-checks (all passed: `appendEntry` void return, `fork()` id preservation, block-state names); accepted as **working freeze**. T2 (rehydrate-as-pin) tied into the Q4 ratification package; T4 folded into `address-layer.md` as the sessionId-provenance-only amendment.
- **Compress landed** → arbitrated three conflicts with the schema freeze, all in the schema's favor, marked inline as integration fixes: no nesting (containment rejects, `b:` endpoints illegal), pins accept+warn (removed `pinned_conflict`), straddling blocks fold `shadowed` (draft's truncated-active overridden). New ratification item: seal gap verbatim inlining under `min(4096, 20%)` budget.
- **E3 probe landed** → 40/40 PASS on real host 17.3.4; main agent re-ran the probe personally (exit 0, isolation dirs cleaned, `~/.omp` untouched). Key nuances recorded in DECISIONS: movable `firstKeptEntryId` is capability not constraint; context-clone mutation is journal-safe but wire-visible; harnesses must wire coding-agent `convertToLlm`; `PI_CONFIG_DIR` is a home-relative name.
- Updated DECISIONS (+3 entries), STATUS (only gate left: author ratification package), TODO, designs index, `eval-metrics.md` isolation nuance.

**commit**: `7bee9cc`, `6f57c47`
