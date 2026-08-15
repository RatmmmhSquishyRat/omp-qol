# Session 002: QOL-004 rework build phase 1

**date**: 2026-08-15
**commits**: `336d0ab`

## Turn 1

### User

> You are Build Phase 1 of a 3-phase rework pipeline for the omp-qol plugin.
>
> Repo: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol (Windows, PowerShell shell — NO heredoc; for multi-line commit messages write a temp file and use `git commit -F <file>`, then delete it).
>
> Read the approved plan first: c:\Users\15480\.cursor\plans\qol-004_rework_loop_3a82b944.plan.md
> It contains the consolidated findings of a 6-model adversarial review and the full rework spec.
>
> YOUR SCOPE — execute plan phases A, B (including the three decision points, all approved as recommended), C, and E:
> - Phase A: evidence surface in plugin/src/advisor-tool.ts (+ plugin/src/lib/host-bridge.ts types): status/verification pass-through of the host's PerAdvisorStat (messages/tokens/cost/contextTokens/sessionId), activeCount, drop misleading `configured`, dump JSON-first, enable returns roster summary + no_model guidance.
> - Phase B: safety/correctness fixes (anti-clobber guard for unparsable-but-nonempty WATCHDOG.yml, reuse host slugifyAdvisorName via plugin/src/lib/advisor-native.ts re-export + collision/rename/CJK-fallback warnings + duplicate-slug last-wins alignment, per-path mutate serialization, truthful persisted/fileDeleted/effectiveAt semantics, unknown-tool/no_model/runtime-restart warnings) and the three decisions: (1) approval tiering + ADR amendment, (2) synthetic implicit-default entry `{name:"default", implicit:true}` in empty effective list/get, (3) unified JSON envelope across advisor/mode/goal tools.
> - Phase C: test-integrity repair (A9 tautological regex, A17 real kill-switch via lockfile advisorToolEnabled:false + factory, I2/I3/I5 strengthen to isAdvisorActive/stats-containment/verification assertions, I6 assert the new unknown-tool warning per probed semantics, I10 exact "running") + preload isolation root pid-scoping (plugin/test/setup.ts + bunfig; kill-switch tests in goal-tool.test.ts/mode-tool.test.ts read env in beforeAll — env is stable after preload) + stale-root sweep at preload; NEW I11 (two advisors via two tool upserts + enable → activeCount===2, both exactly "running", distinct models; Promise.all parallel upserts both survive) and a NEW L3 streaming test (real AgentSession with `advisorStreamFn` scripted streams + a persistent SessionManager — NOT inMemory, its getSessionFile() is null so transcript recorders don't write; two advisors each emit a unique-marker advise; assert both markers reach the primary, both `__advisor.<slug>.jsonl` transcripts exist with assistant records, and a paused advisor produces no transcript).
> - Phase E: full agent-facing text rewrite per the plan (description, parameter .describe(), warnings, refusal strings, IMPLICIT_DEFAULT_NOTE correction, envelope consistency across the three tools). Mode/goal envelope changes WILL break their existing test assertions — update those tests accordingly.
>
> DO NOT touch: .sandbox/e2e-workspace-advisor.ts (Phase 2 owns it), docs/ (Phase 3 owns docs; EXCEPT the ADR amendment below), plugin/README.md, plugin/package.json description.
>
> EMPIRICAL PROBES FIRST (reviewers disagreed; resolve before writing warning text/tests):
> 1. Host semantics of advisor `tools: []` vs a list of only-unknown names: read ref_repos/oh-my-pi/packages/coding-agent/src/advisor/config.ts (normalizeadvisor/filterAdvisorTools paths) and if needed write a tiny throwaway probe under .sandbox/ (delete after) that calls the native helpers directly. Determine: does `[]` persist and mean "no tools"? Does an all-unknown list become undefined→default subset at discovery?
> 2. Duplicate same-slug entries within one file: confirm host discovery is last-wins (advisors.set(slug,...) in file order). Align the tool's upsert/remove/get to effective semantics and warn on duplicates.
> 3. Host approval mechanism: read ref_repos/oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts (ToolDefinition.approval) and any host precedent for per-call/dynamic approval. If per-op approval is possible, implement: list/get/status/dump = read; upsert/remove/set_shared/apply/enable/disable = write. If ONLY a single static tier is supported, set the whole advisor tool to "write" and record the tradeoff. Either way, AMEND docs/ssot/adrs/ADR-005-advisor-thin-driver.md §Decision 5: mark it as an amendment with date 2026-08-15 and rationale (6-model review consensus: mutate ops write/delete files and enable starts billable runtimes; host contract reserves "read" for read-only ops). Do NOT silently rewrite the original decision text — append the amendment. Update the L1 tests that pin approval ("read" assertions in advisor-tool.test.ts A16 and the factory test).
>
> Ground-truth host source: C:\Users\15480\Desktop\AIWorkshop\ref_repos\oh-my-pi\packages\coding-agent\src\ (session/session-advisors.ts, advisor/config.ts, advisor/runtime.ts, session/agent-session.ts — advisorStreamFn seam claimed near line 1400, modes/components/advisor-config.ts). Verify claims against this source; reviewers' line numbers are approximate.
>
> INTEGRITY RULES (non-negotiable):
> - NEVER weaken an assertion to make a test green. If something cannot be honestly asserted (e.g. the advisorStreamFn seam doesn't work as reviewers claimed), STOP that test, document the blocker in the handoff file, and report it — do not fake-pass. Fake-pass is the exact failure mode this rework exists to eliminate.
> - The user's production file C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\WATCHDOG.yml (repo root, 6 advisors) must NEVER be modified, deleted, or targeted by any test. All test writes stay in tmp dirs / pid-scoped isolation roots.
> - Never kill any omp process you did not spawn.
>
> VERIFICATION before you finish:
> - Full `bun test` (from plugin/ dir) green in a single process; spot-check per-file runs of goal-tool and mode-tool still green.
> - `bunx tsc --noEmit -p .` from plugin/: plugin src/ and test/ files must have ZERO errors (errors from ref_repos .md imports are known-environmental and acceptable).
>
> HANDOFF: write .sandbox/rework-notes.md containing: probe outcomes (tools:[] semantics, duplicate-slug, approval mechanism found), decisions taken, the new status/verification JSON shape (exact field names — Phase 2's e2e will assert them), new/changed warnings and their trigger conditions, final test counts, and any honest blockers. Phases 2 and 3 will read this file.
>
> COMMIT (do not push): stage only files you changed (plus .sandbox/rework-notes.md), one commit, style matches repo history (imperative single-line summary + short body; recent examples: "feat: manage the host's implicit default advisor through the advisor tool"). Repo git identity is already configured.
>
> Report back: per-phase summary of what changed, probe outcomes, final test counts, the new JSON envelope shape, commit hash, and any deviations from the plan with reasons. The task is large but internally sequential on shared files — if you use internal subagents keep all edits to plugin/src, plugin/test in your own hands to avoid conflicts; only delegate read-only research.

### Agent Actions

- Probes against host source resolved all three disputes: `tools: []`
  persists and means "no tools" while an all-unknown list collapses to
  undefined → default read/grep/glob subset at discovery; duplicate slugs
  are last-wins (`advisors.set(slug, …)` in walk order); `ToolApproval`
  accepts a per-call function → per-op tiering implemented (read ops
  "read", mutate/runtime ops "write") and ADR-005 §Decision 5 amended
  (appended, original preserved).
- Phase A: `LiveAdvisorStat`/`LiveAdvisorStats` in `host-bridge.ts` now
  mirror the host's `PerAdvisorStat` (tokens/cost/messages/contextTokens/
  sessionId); `configured` dropped; status/mutate verification pass the
  full entries through with `model` as "provider/id"; enable returns the
  roster + no_model guidance; dump is JSON-first.
- Phase B: anti-clobber guard (raw-disk-bytes vs parsed-empty check) blocks
  mutates on unparsable-but-nonempty files; host `slugifyAdvisorName`/
  `normalizeToolNames`/`BUILTIN_TOOL_NAMES` re-exported through
  `advisor-native.ts`; duplicate/rename/CJK-fallback/unknown-tool/no_model/
  restart/shadow/stored warnings; per-path mutate serialization
  (`mutateChains`); truthful `persisted`/`fileDeleted` from pre-save
  `fs.access` (empty save on a nonexistent file persists nothing);
  synthetic `{name:"default", implicit:true}` for empty effective list/get.
- Phase E: unified `{ok, tool, op, …}` envelope across advisor/mode/goal;
  all descriptions, `.describe()` texts, warnings and refusals rewritten;
  mode/goal tests updated for the envelope.
- Phase C: pid-scoped preload root (`.omp-qol-test-root-<pid>`) + stale-root
  sweep; A9 regex fixed; A17 real lockfile kill-switch via the factory;
  I2/I3/I5/I6/I10 strengthened (exact "running", stats containment,
  verification evidence, probed unknown-tool warning); NEW I11 (parallel
  upserts survive; two runtimes, distinct models, activeCount 2); NEW I12
  (scripted advisor streams via `advisorStreamFn`, persistent
  SessionManager: blocker markers steer into the primary transcript,
  `__advisor.alpha/beta.jsonl` written with assistant records, paused
  advisor produces no transcript).
- The strengthened L3 caught a real truthfulness bug (bare-default upsert
  claimed `persisted:true` with no file on disk) — fixed in source, and L1
  A19/A23 were re-aligned to the truthful semantics (A23 now seeds a real
  temp file so `fileDeleted:true` is honestly observable).
- Verification: `bun test` single-process 118/118 green (597 asserts);
  per-file goal 12, mode 22, advisor L1 55 green; plugin tsc clean.
  Production `WATCHDOG.yml` untouched (still untracked, never staged).
- Handoff written to `.sandbox/rework-notes.md` (probe outcomes, exact
  envelope field names, warning trigger table, test counts, caveats).

**commit**: `336d0ab`
