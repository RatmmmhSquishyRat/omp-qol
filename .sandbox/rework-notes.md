# QOL-004 Rework — Phase 1 handoff notes

Date: 2026-08-15 · Scope: plan phases A, B (all three decisions approved as
recommended), C, E of `qol-004_rework_loop_3a82b944.plan.md`.
Audience: Phase 2 (e2e) and Phase 3 (docs). Everything below is verified
against host source (`ref_repos/oh-my-pi/packages/coding-agent/src`) and by
the test suite (118 pass / 0 fail, single-process `bun test`).

---

## 1. Probe outcomes

### P1 — advisor `tools: []` vs all-unknown tool list

Host: `advisor/config.ts` (`normalizeAdvisorEntry` → `filterAdvisorTools`,
using `tools/builtin-names.ts` `normalizeToolNames` + `BUILTIN_TOOL_NAMES`).

- `tools: []` **persists in the file and survives discovery as `[]`** —
  meaning "no tools" (advisor gets only the `advise` tool at runtime;
  `session-advisors.ts` builds the toolset as `adviseTool + configured∩available`).
- A list with ONLY unknown names: unknown names are dropped at discovery and
  the field **collapses to `undefined`**, which at runtime means the DEFAULT
  advisor subset (`ADVISOR_DEFAULT_TOOL_NAMES` = read/grep/glob). So an
  all-unknown list does NOT mean "no tools" — it means "default subset".
- The FILE always keeps whatever names were written (verbatim, normalized
  case/aliases); dropping happens at discovery, not at save.
- Tool behavior: upsert warns on unknown names (two variants — all-unknown
  explains the default-subset fallback; partially-unknown lists dropped vs
  kept names). Names are still persisted verbatim (host semantics, not ours).

### P2 — duplicate same-slug entries in one file

Host discovery (`discoverAdvisorConfigs`) does `advisors.set(slug, cfg)` in
file order → **last-wins per slug** (across scopes: later-walked, more
specific file wins; within one file: the last entry wins).

- Tool alignment: `get` returns the LAST match (with a warning when several
  match); `upsert` edits the LAST matching entry; `remove` deletes ALL
  entries sharing the slug (reporting `removed: n` and a warning when n>1);
  `list` warns once per slug that appears on multiple entries.

### P3 — approval mechanism

Host `ToolApproval` (`packages/agent/src/types.ts`):
`ToolApprovalDecision | ((args: unknown) => ToolApprovalDecision)` —
**dynamic per-call approval is a first-class host contract.**

- Implemented: `approval: (args) => READ_OPS.has(op) ? "read" : "write"`
  with `READ_OPS = {list, get, status, dump}`; `upsert/remove/set_shared/
  apply/enable/disable` → `"write"`.
- ADR-005 §Decision 5 amended (2026-08-15, appended — original text
  preserved). L1 tests A16 + factory test assert the split tiering.

### P4 (incidental, drove the anti-clobber guard) — native loader silently
returns an empty doc (`{advisors: []}`) for missing, unparsable, or
schema-foreign files, and `saveWatchdogConfigFile` with an empty doc DELETES
the target file. Without a guard, "load → edit → save" on an unparsable but
non-empty file would destroy user data.

### P5 (incidental) — `PerAdvisorStat` / `AdvisorStats`

`session-advisors.ts getAdvisorStats()`: `{configured, active, advisors:[
{name, status, model (Model object), contextWindow?, contextTokens?,
tokens {input,output,reasoning,cacheRead,cacheWrite,total}, cost,
messages {user,assistant,total}, sessionId?}]}`. `configured` merely mirrors
the enable flag → dropped from the tool's surface (the tool reports
`enabled` from `isAdvisorEnabled()`). There is NO `tools` field per stat.

### P6 (incidental) — advisor streaming seam

`AgentSession` config accepts `advisorStreamFn` (agent-session.ts ~line
1400, threaded into `SessionAdvisors` options as `streamFn`): one function
serves ALL advisor runtimes. Advisor transcripts are written by
`AdvisorTranscriptRecorder` to `<sessionFile minus .jsonl>/__advisor.<slug>.jsonl`,
derived from `sessionManager.getSessionFile()` — **null for in-memory
managers, so transcript tests need a persistent SessionManager**. Blocker
advisories from an idle primary are steered via
`sendCustomMessage({deliverAs:"steer", triggerTurn:true})` into the primary
transcript. `advisor.syncBacklog="1"` makes the primary turn await advisor
catch-up (30s cap).

---

## 2. Decisions taken (all three approved as recommended)

1. **Approval tiering**: dynamic per-op (see P3). ADR-005 amended.
2. **Synthetic implicit-default entry**: `list scope=effective` with an
   empty merged roster returns `advisors: [{name:"default", implicit:true}]`
   plus `implicitDefault: true` and `note` (IMPLICIT_DEFAULT_NOTE).
   `get name=default scope=effective` on an empty roster returns
   `advisor: {name:"default", implicit:true}`, `implicitDefault: true`, `note`.
3. **Unified JSON envelope** across advisor/mode/goal (§3 below). Mode/goal
   test assertions were updated for the new envelope.

---

## 3. JSON envelope (exact shapes — Phase 2 e2e can assert these)

Every result's `content[0].text` is: an OPTIONAL one-line summary, then a
pretty-printed JSON object. Parse: `JSON.parse(text.slice(text.indexOf("{")))`.
The same object is also returned as `details`.

### Common

- Success: `{ ok: true,  tool: "advisor"|"mode"|"goal", op, ...fields, warnings: [] }`
- Failure: `{ ok: false, tool, op, error, action? }` with `isError: true`.

### advisor — per-advisor stat entry (used in status/enable/verification)

```json
{
  "name": "Alpha",
  "status": "running",
  "model": "anthropic/claude-haiku-4-5",
  "tokens": { "input": 0, "output": 0, "reasoning": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
  "cost": 0,
  "messages": { "user": 0, "assistant": 0, "total": 0 },
  "contextTokens": 0,
  "contextWindow": 200000,
  "sessionId": "…"
}
```

`model` is serialized as `"provider/id"`. Skeleton entries (`paused`,
`no_model`, `quota_exhausted`) omit `model`/`sessionId` and zero the
counters (host behavior, passed through). Statuses observed from the host:
`running | paused | no_model | quota_exhausted | error`.

### advisor op bodies

- `status`: `{ok, tool, op, enabled, active, activeCount, advisors: [statEntry], statusLine, warnings}`
- `dump`: `{ok, tool, op, raw, empty, history, warnings}` (JSON-first; history is the host's formatted text)
- `list` (project/user): `{ok, tool, op, scope, source, advisors, instructions?, warnings?}`
- `list` (effective): `{ok, tool, op, scope, advisors, sharedInstructions?, implicitDefault?, note?, warnings?}`
- `get`: `{ok, tool, op, scope, source, advisor, warnings?}` (+ implicit-default variant, §2.2)
- `upsert`/`remove`/`set_shared`/`apply` (ApplyResult): 

```json
{
  "ok": true, "tool": "advisor", "op": "upsert",
  "persisted": true,
  "fileDeleted": false,
  "applied": true,
  "effectiveAt": "immediate",
  "source": "C:\\path\\to\\WATCHDOG.yml",
  "removed": 0,
  "verification": { "enabled": true, "active": true, "activeCount": 1, "advisors": [statEntry] },
  "warnings": []
}
```

  - `persisted`: the file was actually written — or actually deleted. An
    empty save against a NONEXISTENT file is truthfully `persisted: false`.
  - `fileDeleted`: save emptied the doc AND the file existed (native
    empty-doc-deletes-file semantics).
  - `effectiveAt`: `"immediate"` (flag on, runtimes rebuilt now) /
    `"stored"` (flag off; takes effect at op=enable) / `"none"` (no-op,
    e.g. remove-miss).
  - remove-miss returns `ok:true` with `persisted:false, applied:false,
    effectiveAt:"none", removed:0` + warning ("…left untouched").
- `enable`: `{ok, tool, op, enabled, active, running, discovered: false, activeCount, advisors: [statEntry], warnings}`
- `disable`: `{ok, tool, op, enabled, active, running, discovered: false, warnings}`

### mode

- succeed: `{ok, tool: "mode", op, message, ...fields, warnings: []}` with
  fields: `plan_enter/plan_exit` → `{mode:"plan", active, alreadyActive?}`;
  `vibe_enter/vibe_exit` → `{mode:"vibe", active, killed?, alreadyActive?}`;
  `status` → `{plan: boolean, vibe: boolean, goal: "active"|"none"}`.

### goal

- succeed: `{ok, tool: "goal", op, message, details?, warnings: []}` where
  `message` is the native goal tool's text and `details` the native record.

---

## 4. New/changed warnings and their triggers (advisor tool)

| Warning (prefix/keyword) | Trigger |
|---|---|
| `duplicate slug "<slug>" in <path>: entries … last one … (last-wins)` | list/get/mutate sees ≥2 entries in one file normalizing to one slug |
| `"<name>" matches N entries … returning the LAST one` | get with multiple slug matches |
| `removed N entries sharing slug "<slug>"` | remove deleted >1 duplicate |
| rename warning (upsert matched an existing entry under a different spelling) | upsert name ≠ stored name but same slug |
| CJK/generic-slug fallback warning | slugify(name) === "advisor" (no ascii letters/digits) |
| `unknown tools: … falls back to the DEFAULT read/grep/glob subset` | upsert `tools` list entirely unknown |
| `unknown tools dropped at discovery: … keeps: …` | upsert `tools` partially unknown |
| `normalized: a bare "default" entry … not persisted` + (`was deleted` \| `does not exist, so nothing was written`) | upsert of bare default (mirrors TUI Save) |
| `<path> became empty and was deleted (native semantics…)` | mutate emptied the doc and the file existed |
| `no entry matching … left untouched` | remove-miss |
| `applied: this <op> rebuilt ALL advisor runtimes (N before, M now)` | mutate while runtimes were active |
| `no_model: <names> — no model resolved…` | post-apply roster contains no_model entries |
| `shadow: "<name>" was written to scope=… but is absent from the effective roster` | upserted entry loses to a more specific file |
| `shadow: the project file … also defines slug …` | user-scope upsert shadowed by project entry |
| `stored: the advisor session flag is OFF … op=enable starts the roster` | mutate/apply while disabled |
| `enable turned the session flag ON, but no advisor runtime started…` | enable with empty roster / no resolvable model |
| Anti-clobber REFUSAL (isError, not warning): `blocked … would overwrite` | native parse yields empty doc but raw file bytes are non-empty and not benign (comments-only / empty advisors+instructions) |

---

## 5. Safety fixes in this phase

- **Anti-clobber guard**: before any mutate, the raw file is read from disk;
  if native load returned an empty doc while the raw content is non-empty and
  not benign-empty, the mutate is refused (file untouched). Real-file L1
  tests: A20 (garbage YAML, foreign schema, benign comment-only, `advisors: []`).
- **Truthful `persisted`/`fileDeleted`**: computed from pre-save file
  existence (`fs.access`), not assumed. Found and fixed via L3: the earlier
  code claimed `persisted:true, fileDeleted:true` for a bare-default upsert
  when NO file existed (nothing happened on disk).
- **Per-path mutate serialization**: all mutate ops on the same resolved
  file path are chained (`mutateChains` map) — `Promise.all` concurrent
  upserts cannot lose updates (L1 A24; L3 I11 proves it on a real file).
- **Slug alignment**: the tool re-exports the HOST's `slugifyAdvisorName` /
  `normalizeToolNames` / `BUILTIN_TOOL_NAMES` through `advisor-native.ts` —
  no drift possible between tool matching and discovery.

---

## 6. Test integrity repairs + new tests

- A9: tautological regex (`/no live|advisor/i` style) replaced with envelope
  parse + exact error assertion.
- A17/A18: kill switch is now REAL — lockfile `advisorToolEnabled:false`
  under the pid-scoped isolation root + the production factory; asserts the
  advisor tool is absent while goal/mode remain, and the default registers it.
- A16 + factory test: assert dynamic approval — `"read"` for
  list/get/status/dump, `"write"` for all mutate/runtime ops.
- Preload (`test/setup.ts`): PI_CONFIG_DIR root is **pid-scoped**
  (`~/.omp-qol-test-root-<pid>`) with a stale-root sweep (pid-liveness
  probe) at preload; kill-switch tests read `process.env.PI_CONFIG_DIR` in
  `beforeAll`.
- I2: now asserts `isAdvisorActive()`, stats containment (`LiveBot` present,
  status exactly `"running"`), and envelope verification (activeCount,
  entry model/status).
- I3: proves runtime REPLACEMENT — haiku runtime before, sonnet after, exactly
  one stats entry, file has one entry, envelope verification shows the new
  model. (Deviation: plan example used `openai/gpt-4o-mini`; only anthropic
  models resolve in the harness, so the change is haiku→sonnet. Same claim,
  stronger evidence — the "changed" model actually RUNS.)
- I5: asserts `effectiveAt:"stored"`, `verification.active:false`,
  `activeCount:0` + stored warning while disabled; after enable asserts
  `isAdvisorActive()`, stats entry exactly `"running"`, and the enable
  envelope roster.
- I6: asserts the probed unknown-tool warning (all-unknown → default-subset
  fallback), verbatim persistence of the unknown name in the file, and both
  advisors `"running"` (live roster unaffected).
- I10: exact `"running"` for the implicit default (legs 1 and 3), synthetic
  entry deep-equality in list/get, paused leg unchanged; bare-default leg now
  asserts truthful `persisted:false`.
- **NEW I11**: `Promise.all` parallel upserts (Alpha=haiku, Beta=sonnet) both
  survive in the file; enable → `activeCount === 2`, both stats entries
  exactly `"running"` with distinct models; status envelope carries both.
- **NEW I12 (L3 streaming)**: real AgentSession + persistent SessionManager
  (`SessionManager.open`, NOT inMemory — its `getSessionFile()` is null so
  recorders skip writes) + `advisorStreamFn` dispatching two scripted
  MockModels by advisor model id. Alpha and Beta each emit ONE
  `advise{severity:"blocker"}` with a unique marker; Gamma is `enabled:false`.
  Asserts: both markers reach the primary transcript
  (`session.agent.state.messages`, delivered via steer + triggered turns),
  both mocks were actually called, `<sessionStem>/__advisor.alpha.jsonl` and
  `__advisor.beta.jsonl` exist with assistant records, and NO
  `__advisor.gamma.jsonl` exists (paused advisor never runs).
  Notes for Phase 2: markers must be content-bearing sentences (the host's
  `AdvisorEmissionGuard` suppresses content-free filler like "ok"/"no
  issues"); severity `"blocker"` guarantees delivery (non-blockers are
  withheld for in-progress updates); `advisor.syncBacklog: "1"` makes
  `prompt()` await advisor catch-up.

## 7. Final test counts

`bun test` (single process, from `plugin/`): **118 pass / 0 fail**,
597 expect() calls, 6 files.

- advisor-tool.test.ts (L1): 55
- advisor-integration.test.ts (L3): 14 (I1–I12 + bridge-surface)
- goal-tool.test.ts: 12 · mode-tool.test.ts: 22
- host-bridge.test.ts: 8 · integration-real-session.test.ts: 7

Per-file spot checks (goal 12/12, mode 22/22, advisor L1 55/55) green.
`bunx tsc --noEmit -p .` from `plugin/`: ZERO errors in plugin src/test
(remaining errors are the known-environmental ref_repos `.md` imports).

## 8. Honest blockers / caveats

- None blocking. All planned assertions landed without weakening.
- L1 `fileDeleted` tests describe the native CONTRACT (the fake native does
  not delete real files); the real deletion behavior is covered by L3
  (I10 leg 3, I12 teardown) where the native saver actually runs.
- I12 asserts marker delivery into `session.agent.state.messages` (steer
  path). It does not pin WHICH message role carries the advisory
  (`<advisory>` custom message) — the host may batch both advisors' notes
  into one custom message or steer them separately; the test accepts both.
- The advisor `status` op includes `statusLine` (host `formatAdvisorStatus()`)
  verbatim; Phase 2 should not regex-pin its wording (host-owned).

---

# Phase 2 / L6 — multi-advisor real-traffic acceptance (2026-08-15)

**Verdict: PASS** (first full run, exit 0). All 9 CRUD lifecycle steps green
under the `{ok, tool, op, …}` envelope, and both live advisors independently
proved Built → Fed → Streamed with a paused control staying silent.

## Run facts

- Harness: `.sandbox/e2e-workspace-advisor.ts` (fully rewritten; sections
  CRUD + LIVE, one spawned installed-omp process and one throwaway git
  workspace per section).
- Artifact dir (committed, minus the two >1 MB raw frame logs):
  `.sandbox/e2e-artifacts/run-20260815-164307/` — see its `EVIDENCE.md`
  index. `frames-crud.jsonl` (1.65 MB) and `frames-live.jsonl` (1.84 MB)
  exist only in the working tree, excluded from the commit by size policy.
- Work commit: `91f670b` "test: land L6 multi-advisor real-traffic e2e with
  isolated-root evidence" (this note itself rides the follow-up docs commit).
- Timings: CRUD 68 s · LIVE 96 s · whole run ≈ 182 s (well under the
  720 s/phase deadline).

## Config-root isolation (NO fallback needed)

- Spawned omp ran with `PI_CONFIG_DIR=.omp-qol-e2e-<runId>` (host resolves
  the value relative to homedir — same mechanism the unit-test preload
  uses). 401 models resolved inside the isolated root on the first probe.
- Copied from `~/.omp/agent` (credential/model-registry material ONLY):
  `agent.db(+wal/shm)`, `models.db(+wal/shm)`, `models.yml`, `.env`,
  `kimi-device-id`. NEVER copied: user `config.yml`, `WATCHDOG.*`,
  sessions, history, extensions, memories (asserted by
  `isolation-manifest.json`).
- Scratch `agent/config.yml` written instead: `setupVersion: 1`,
  `advisor.syncBacklog: "1"`, and `modelRoles.advisor:
  omp-qol-e2e-blocked/no-such-model`. The advisor-role pin matters: with the
  role UNSET, the host's implicit default advisor falls back to the "slow"
  priority chain (a strong, expensive model). CRUD step 2 (enable on an
  empty roster) asserts exactly this neutralization: `running===false` +
  `no_model:` warning.
- The isolated root is deleted on success; scratch workspaces are swept at
  the next run's start (leave-behind for inspection on failure).

## Models used

- Primary (both phases): `zai/glm-4.5-air`.
- Alpha: `zai/glm-4.5-air` · Beta: `deepseek/deepseek-v4-flash` (distinct
  providers chosen automatically from the host's `get_available_models`
  listing; cursor/* and gpt-5.4-nano excluded per prior 404 evidence).
- Gamma (paused control, `enabled: false`) pins `zai/glm-4.5-air` but never
  ran.

## Per-advisor deltas (baseline → post-turn, from op=status JSONs)

| advisor | baseline | post-turn | gates |
|---|---|---|---|
| Alpha | user 0 · assistant 0 · tokens 0 · $0 | user 5 · assistant 6 · tokens 28 097 · $0.003796 | assistant ≥ 1 ✓ · tokens > 0 ✓ · still "running" ✓ |
| Beta | user 0 · assistant 0 · tokens 0 · $0 | user 5 · assistant 3 · tokens 11 442 · $0.000623 | assistant ≥ 1 ✓ · tokens > 0 ✓ · still "running" ✓ |
| Gamma | all-zero, "paused" | all-zero, "paused" | zero tokens ✓ · zero messages ✓ · no transcript file ✓ |

- `op=dump` history mentions both Alpha and Beta (`dump.json`).
- On-disk transcripts: `__advisor.alpha.jsonl` + `__advisor.beta.jsonl`
  exist with assistant records (copies committed as
  `advisor-transcript.{alpha,beta}.jsonl`); NO `__advisor.gamma.jsonl`.
- `user=5` per advisor: advisors are fed every completed primary turn after
  enable (T4's own turn end, the PING turn, and the settle-poll turns —
  plus per-turn context records), not just the PING. The acceptance gates
  are deltas ≥ thresholds, which this comfortably satisfies; the PING turn
  itself is the only "real work" turn.

## Baseline-hygiene mechanism (why the zero baseline is trustworthy)

`enable` and `status` are requested in ONE primary turn (single message,
two tool calls). Advisors only receive a turn AFTER it ends
(`onPrimaryTurnEnd`), so the in-turn `status` reads genuinely zero counters.
The harness carries a repair path (apply+status re-baseline, recorded as
`baselineRepaired`) for the case where the model splits the combo across
turns — NOT needed this run (`baselineRepaired: false`, no re-pins).

## CRUD lifecycle (scripted, envelope-asserted) — 9/9

status(disabled quiet) → enable(empty roster: no_model + no-runtime
warnings, running===false) → upsert(Watchful: verification.enabled===true,
effectiveAt==="session") → list(file+effective rosters) → remove(implicit
default resurfaces as `{name:"default", implicit:true}`) → status(running
default suppressed… asserted enabled+active with the neutralized role
keeping it at no_model) → upsert(implicit default materialization warning)
→ remove → disable(enabled===false). Every mutate's `envelope.source` is
asserted to live INSIDE the scratch workspace (production WATCHDOG.yml
safety canary; the repo-root file's mtime predates the run).

## Product issues found

- **None.** No product code was touched in Phase 2. The one candidate
  anomaly (advisor `user` message count > number of primary turns) is
  documented feed semantics (context records), not a defect.

## Harness fixes (all harness-side, none product-side)

- Assertions rewritten from OLD pre-envelope regex shapes to the unified
  envelope (`crud-step-*.json` show the exact asserted payloads).
- Plugin install now goes under `<ws>/<PI_CONFIG_DIR value>/plugins/…`
  (project-registry discovery follows `getConfigDirName()`, not a
  hardcoded `.omp`), and copies the CURRENT plugin source per run into a
  timestamped scratch cache — no stale-cache risk.
- Frame pump, per-turn tool capture, transient-error primary rotation
  (`glm-4.5-air` was healthy; no rotation fired), spawned-process registry
  killed even on deadline breach, `OMPQOL_E2E_SKIP_*` debug flags force an
  INCONCLUSIVE verdict (never a fake pass).

## For Phase 3 (docs)

- The committed evidence set under
  `.sandbox/e2e-artifacts/run-20260815-164307/` is the user-facing proof of
  the L6 acceptance line: `EVIDENCE.md` is the index; `status-baseline.json`
  / `status-post-1.json` carry the exact LiveAdvisorStat shapes documented
  in §3 of this file.
- Exit-code contract of the harness: 0 pass · 1 fail · 2 harness error ·
  3 inconclusive; INCONCLUSIVE is used for missing credentials/quota or
  provider outage — it never claims pass.
