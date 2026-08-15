# Session 003: QOL-004 rework build phase 2 — L6 e2e acceptance

**date**: 2026-08-15
**commits**: `91f670b`

## Turn 1

### User

> You are Build Phase 2 of a 3-phase rework pipeline for the omp-qol plugin. Phase 1 (product code + tests) is complete and committed as 336d0ab.
>
> Repo: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol (Windows, PowerShell — no heredoc; multi-line commit messages via temp file + `git commit -F`).
>
> Read these first:
> 1. The approved plan, section "D. L6 多 advisor 真实流量验收（用户验收线）": c:\Users\15480\.cursor\plans\qol-004_rework_loop_3a82b944.plan.md
> 2. The Phase 1 handoff: C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\.sandbox\rework-notes.md — it documents the NEW unified JSON envelope `{ok, tool, op, …}`, the exact status/verification field names (LiveAdvisorStat with tokens/cost/messages/contextTokens/sessionId, activeCount), warning triggers, and streaming preconditions (emission-guard-safe markers, severity "blocker", `advisor.syncBacklog:"1"`).
> 3. The existing harness you will extend: .sandbox/e2e-workspace-advisor.ts (its assertions still expect the OLD pre-envelope output shapes — they must be updated to the new envelope regardless).
>
> YOUR SCOPE — plan phase D only (todo "L6 双 advisor 双模型真实流量验收"):
> Extend .sandbox/e2e-workspace-advisor.ts (or restructure it into clearly named sections) so one run delivers BOTH:
> (a) the existing scripted CRUD lifecycle (status/enable/upsert/list/remove/implicit-default steps), with assertions updated to the new `{ok, tool, op, …}` envelope, and
> (b) the NEW multi-advisor real-traffic acceptance:
>   1. Isolated config root: point the spawned omp at a scratch config root (PI_CONFIG_DIR) so the dev machine's ~/.omp WATCHDOG/advisor-role defaults cannot leak in. CRITICAL PRACTICALITY: an empty config root has no credentials → every model resolves to no_model and the run is worthless. Probe how the host resolves auth/models (ref_repos\oh-my-pi\packages\coding-agent\src\config or settings loading) and copy ONLY the credential/model-registry material (e.g. auth/keys/models files) from the real config root into the scratch root — never the WATCHDOG.yml, never session state. If full isolation proves incompatible with auth, fall back to the real config root but neutralize advisor leakage explicitly (document which fallback you used in the evidence).
>   2. Via the advisor TOOL only (no hand-written YAML): upsert advisors A and B pinned to TWO DIFFERENT cheap/flash models (pick from what the harness's model-listing shows actually resolves; prior run showed zai/deepseek providers reliable, Anthropic resolvable in-process; avoid cursor/gpt-5.4-nano which 404'd), plus a third advisor C with enabled=false as the paused control. Give A and B instructions to reply with at most one short advise note per review (cost cap).
>   3. Baseline assertion via op=status: A and B exactly "running" with distinct models, all counters zero; C "paused".
>   4. Drive ONE real primary turn (cheap primary model too): a trivial prompt like "Reply with exactly: PING". Set `advisor.syncBacklog:"1"` (or timed polling of op=status) so advisor turns settle before assertions.
>   5. Per-advisor delta assertions, independently for A and B: `messages.assistant >= 1` AND `tokens.total > 0` (delta from the zero baseline). C stays all-zero. op=dump shows both advisors' history. Session dir contains `__advisor.<slugA>.jsonl` and `__advisor.<slugB>.jsonl` with assistant records, none for C.
>   6. Artifact persistence (the old run's 9/9 evidence was not post-hoc reviewable — fix that): archive to a timestamped dir under .sandbox/e2e-artifacts/: all raw RPC frames, the final scratch WATCHDOG.yml, every op=status JSON (baseline + post-turn), and copies of the advisor transcripts. The artifact dir must survive the run (only the scratch workspace gets cleaned).
>   7. Cost/safety controls: hard global timeout (reuse/adjust the 720s pattern), minimal turns, single advise cap. If credentials/quota are missing or a provider is down, the verdict is INCONCLUSIVE — print it as such and DO NOT claim pass. Never weaken an assertion to go green; a genuine product bug found here should be reported back, not patched around silently (you may fix harness bugs freely — clearly separate "harness fix" from "product issue" in your report; if a small product fix is unavoidable to complete acceptance, make it, note it explicitly, and keep plugin tests green).
> SAFETY: never modify/delete the repo-root C:\...\omp-qol\WATCHDOG.yml (user production file, 6 advisors); never kill omp processes you didn't spawn; unique timestamped scratch dirs (EBUSY-tolerant cleanup, leave-behind on failure is acceptable).
>
> Also: the plugin was reworked in Phase 1, so the harness's plugin-install step must pick up the CURRENT plugin source (check how the harness installs it — local cache version bump may be needed if the host caches by version; plugin/package.json version is 0.3.0 — if stale-cache risk exists, bump patch version or clear the scratch cache).
>
> RUN IT until you get a defensible verdict: all CRUD steps green under the new envelope AND both advisors independently prove Built→Fed→Streamed with per-advisor deltas, transcripts on disk, paused control silent. Iterate on harness defects as needed. Expect ~10–20 min per run; use generous shell timeouts and monitor.
>
> VERIFY before finishing: `bun test` in plugin/ still green (you likely touched nothing there, but confirm); harness typechecks (`bunx tsc --noEmit` on the sandbox file if practical, or rely on bun's runtime).
>
> COMMIT (do not push): the updated harness + a curated evidence set (artifact dir with status JSONs, final WATCHDOG.yml, advisor transcript files, and a short EVIDENCE.md index inside the artifact dir summarizing the run: models used, timings, per-advisor deltas, verdict). Keep raw frame logs out of the commit only if enormous (>1 MB); otherwise include. One commit, repo style.
>
> APPEND to .sandbox/rework-notes.md a "Phase 2 / L6" section: verdict, models used, per-advisor delta numbers, artifact dir path, commit hash, any product issues found, any fallback taken (e.g. config-root isolation compromise). Phase 3 reads this.
>
> Report back: verdict (pass/inconclusive/fail + why), per-advisor evidence numbers, artifact location, commit hash, deviations.

### Agent Actions

- Probed host semantics before writing: `PI_CONFIG_DIR` is a dir NAME
  resolved against homedir (`packages/utils/src/dirs.ts`); project plugin
  registry AND WATCHDOG discovery both follow `getConfigDirName()`; an
  UNSET `modelRoles.advisor` falls back to the expensive "slow" chain, so
  the scratch config.yml pins it to an unresolvable selector; credentials
  live in `~/.omp/agent` (`agent.db`, `models.db`, `models.yml`, `.env`,
  `kimi-device-id`).
- Rewrote `.sandbox/e2e-workspace-advisor.ts` end-to-end: isolated-root
  builder (credential-only copy + neutralized bootstrap config, real-root
  fallback path kept but unused), per-run plugin install from CURRENT
  source into `<ws>/<configDirName>/plugins` (no stale cache), OmpRpc
  frame pump with full frame logging, envelope-based CRUD assertions
  (9 steps), LIVE section (3 tool upserts, enable+status in ONE turn for a
  clean zero baseline with an apply+status repair path, one PING turn,
  delta/dump/transcript/disable assertions), timestamped artifact dir with
  EVIDENCE.md/verdict.json writers, spawned-process kill registry, skip
  flags forced to INCONCLUSIVE.
- First full run PASSED in ~182 s: CRUD 9/9 green; Alpha (zai/glm-4.5-air)
  delta assistant=6 tokens=28097, Beta (deepseek/deepseek-v4-flash) delta
  assistant=3 tokens=11442, Gamma paused all-zero with no transcript file;
  isolation held (401 models in scratch root, no fallback, repo-root
  WATCHDOG.yml mtime predates the run).
- Verified: plugin `bun test` 118/118 green; harness `bunx tsc --noEmit`
  clean; committable artifacts secret-scanned clean.
- Committed harness + curated evidence (31 files; the two >1 MB raw frame
  logs excluded by the size policy); appended "Phase 2 / L6" section to
  `.sandbox/rework-notes.md` for Phase 3.
- Surfaced (not committed, not authored here): pre-existing working-tree
  edit to `docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md`
  that alters a verbatim user quote (two "啊" removed) — flagged to the
  author per the pillar-verbatim rule; left untouched in the working tree.

**commit**: `91f670b`
