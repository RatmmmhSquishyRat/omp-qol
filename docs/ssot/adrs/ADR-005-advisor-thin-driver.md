# ADR-005: Advisor thin driver — no SessionAdvisors emulation

Date: 2026-08-15 · Status: accepted · Context: QOL-004 · Continues ADR-004
("the plugin only adds an entry point; nothing the host already implements
may be re-implemented").

## What this decides

The user already operates advisors through `/advisor on|off|status|dump`
and TUI configure Save (`saveWatchdogConfigFile` →
`discoverAdvisorConfigs` → `session.applyAdvisorConfigs`). Foundation
`06-ADVISOR-WATCHDOG.md` showed that live apply already exists and that
toggle is not refresh. QOL-004 adds a main-agent tool onto that same
contract. It does not grow a second advisor runtime.

## Decision 1 — Thin driver over the host's own call surface

The TUI Save path and the public `AgentSession` advisor methods
(`applyAdvisorConfigs`, `setAdvisorEnabled`, `isAdvisorEnabled`,
`isAdvisorActive`, `getAdvisorStats`, `formatAdvisorStatus`,
`formatAdvisorHistoryAsText`, `getAdvisorAvailableToolNames`) are the
host contract. The plugin:

- extends `LiveHostSession` / host-bridge so those methods are visible;
- imports native `advisor/config` helpers for load / save / discover /
  resolvePath;
- sequences them exactly as `selector-controller.ts` does on Save.

This is a fourth entry point (TUI slash, TUI editor, ACP-less session
calls, now the `advisor` tool) onto the same primitives — the same
substance as ADR-004 for plan/vibe.

Rejected alternatives:

- *Route A — write files only, refresh by `/advisor on|off`*: Foundation
  closed this. Toggle does not call `discoverAdvisorConfigs`.
- *Route C — add a host `refreshAdvisors` action first*: the public
  apply method already exists; a host patch is surplus unless a sealed
  host later proves `advisor/config` is unimportable.
- *Reimplement `SessionAdvisors` in the plugin*: duplicates merge
  precedence, model resolution, recorder lifecycle, and runtime
  construction — the exact hardcoding ADR-004 forbids.

Fallback: if the sealed host cannot `import` `advisor/config`, fail
honestly. Only after e2e evidence may we ask oh-my-pi for a minimal
`./advisor` export. Do not invent a YAML writer in the meantime.

## Decision 2 — Do not emulate SessionAdvisors

No plugin-owned roster, no homemade merge, no forged `<advisory>`
events, no advisor-turn scheduler. File bytes go through native
`saveWatchdogConfigFile` / `serializeWatchdogConfig`. Live roster
changes go through `applyAdvisorConfigs`. Readback goes through
`getAdvisorStats` / `isAdvisorActive`. Tests that need roster truth
ask the session or native discover, not a plugin shadow copy.

## Decision 3 — `enable` ≠ `discover`

`/advisor on|off` only calls `setAdvisorEnabled`. The tool's `enable` /
`disable` ops must do the same and **must not** call
`discoverAdvisorConfigs` or `applyAdvisorConfigs`.

Roster refresh after a file change is `apply` (or the automatic
save→discover→apply tail of `upsert` / `remove` / `set_shared`).
Combining enable and apply into one "refresh" is rejected: it teaches
the model the wrong host fact and desyncs from the user command.

## Decision 4 — Default `project`, explicit `user`

Autonomous writes default to `scope=project` (repo-root `WATCHDOG.yml`,
`projectDir = repo.root(cwd) ?? cwd`). `scope=user` is valid only when
the caller sets it. `scope=effective` is a read view (discover merge),
never a write target.

Rationale: project changes are the smallest inspectable mutation.
User-scope files affect other projects and future sessions; they must
be deliberate.

README "Never write to the global `~/.omp`" is a **test/ops** rule
(do not pollute the developer's real global OMP while debugging). It is
not a product ban on user-scope advisor files. Tests isolate with
`PI_CONFIG_DIR` and a temporary `agentDir`.

## Decision 5 — One tool, ten ops, no `invoke`

Single tool `advisor`, `loadMode: "essential"`, `approval: "read"`,
kill switch `advisorToolEnabled` (default true). Ops:

`list | get | upsert | remove | set_shared | apply | enable | disable | status | dump`

Mutate ops internally load the scope doc, edit memory, then
save→discover→apply. The model never submits a YAML string.

No `invoke` / "run advisor now" op. Advisor is a bypass observer
(`advise` notes on the primary turn), not a `task` target. Pillar
wording ("special built-in subagent") and this code fact remain
side by side; this ADR does not rewrite
`docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md`.
SSOT amend, if any, waits for this ADR **plus** implementation
evidence, and must mark the old hot-apply uncertainty as superseded
rather than silently editing the pillar.

### Amendment (2026-08-15) — per-op approval tiering replaces `approval: "read"`

The original decision text above declared `approval: "read"` for the
whole tool. That is superseded (the text above is preserved, not
rewritten, per SSOT rules).

- **What changed**: the tool now declares a *dynamic* approval —
  `approval: (args) => READ_OPS.has(args.op) ? "read" : "write"`.
  Read-only ops (`list`, `get`, `status`, `dump`) stay `"read"`;
  mutate and runtime ops (`upsert`, `remove`, `set_shared`, `apply`,
  `enable`, `disable`) are `"write"`.
- **Mechanism evidence**: the host's `ToolApproval` type
  (`packages/agent/src/types.ts`) is
  `ToolApprovalDecision | ((args: unknown) => ToolApprovalDecision)` —
  per-call dynamic tiering is a first-class host contract, so no
  static-tier tradeoff was needed.
- **Rationale** (6-model adversarial review consensus, 2026-08-15):
  mutate ops write or delete `WATCHDOG.yml` files and `enable` starts
  billable advisor runtimes; the host contract reserves `"read"` for
  read-only operations. A blanket `"read"` tier let file writes and
  runtime starts ride through approval gates that auto-approve reads.
- **Test impact**: L1 registration tests (advisor-tool.test.ts A16 and
  the factory registration test) now assert the split tiering instead
  of pinning `"read"`.

## Decision 6 — Advisor sanity is independent of plan/vibe

`resolveHostBridge` today refuses a session that lacks plan/vibe
methods (nulls the whole bridge). Advisor ops must not ride that
gate. A live session that can drive plan/vibe but lacks advisor
methods refuses **advisor** only. A session that lacks plan/vibe
must not lose mode because advisor checks were folded into the same
predicate. Partial recognition of advisor methods is still refuse
(no half-driven apply).

## Verification

Pre-implementation contract: `docs/plans/TDDs/qol-004-advisor-tool-tests.md`
(L1 mock pairing + enable≠discover; L3 Foundation gates 1–7; L4
`dumpTools`). Evidence lands in `docs/plans/impls/qol-004-impl-notes.md`
after the code exists.

## Consequences

- `LiveHostSession` grows advisor method types; `advisor-native.ts`
  is a pass-through, not a parser.
- Plugin settings / `package.json` gain `advisorToolEnabled`.
- Pillars stay verbatim until a later, evidence-backed SSOT amend.
