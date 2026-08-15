# omp-qol-plugin

Quality-of-life **plugin** for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi).

## Install (users)

```bash
omp plugin install omp-qol-plugin
```

`omp install omp-qol-plugin` is the same command. Settings, list, and
uninstall all use the package name `omp-qol-plugin`.

The published package is `omp-qol-plugin@0.3.1`. Do not reuse tag
`v0.3.0`: that tag points at a commit with no workflows.

`--scope project` is marketplace-only in omp 17.3.4. Passing it with this
npm spec prints a warning and still writes `~/.omp/plugins`.

## What it does

- **QOL-001: agent-facing goal tool.** The main agent can always view and
  manipulate the session goal (`create` / `get` / `complete` / `resume` /
  `drop`) without the user entering goal mode first. Implemented by
  shadowing the hidden built-in `goal` tool and delegating every op to the
  native implementation (`ctx.invokeTool`), so state, persistence, budget
  accounting, and `goal_updated` events stay 100% native.
  `pause` remains a user operation (`/goal pause`) by design — see
  `../docs/ssot/adrs/ADR-001-goal-tool-shadow-delegate.md`.
- **QOL-002/003: agent-controlled plan & vibe modes.** One `mode` tool with
  `plan_enter` / `plan_exit` / `vibe_enter` / `vibe_exit` / `status` —
  a **thin driver only** (ADR-004): nothing the host already does is
  re-implemented. Plan ops mirror the host's own non-TUI plan switch
  (ACP `#applyModeChange`); vibe ops mirror InteractiveMode's enter/exit.
  The live `AgentSession` is resolved through the host-injected module
  namespace (`ExtensionAPI.pi` → `AgentRegistry.global()`), so every op
  works on **every host form**, including the sealed installed binary
  (vibe exit there drives the host's own live `VibeListTool`/`VibeKillTool`
  classes — research `../docs/researches/omp-plan-vibe-modes.md` §7).
  Only when neither surface exists does the tool refuse honestly.
  - Diagnostics: `OMP_QOL_PROBE=1` logs host-bridge reach
    (`../.sandbox/probe-host-bridge.ts`).
- **QOL-004: agent-facing advisor tool.** One `advisor` tool gives the main
  agent the same control over WATCHDOG advisors that a user has in the CLI —
  a **thin driver** (ADR-005) over the host's own `advisor/config` helpers
  and live-session methods; no YAML serializer or advisor logic re-implemented.
  - **Ops (10)**: `list` / `get` read rosters (scope `project` file (default),
    `user` file, or `effective` merged view — the one the host actually
    runs); `upsert` / `remove` / `set_shared` edit a `WATCHDOG.yml` then
    auto-run discover + live-apply; `apply` re-discovers now; `enable` /
    `disable` flip the session flag (never discover); `status` reports live
    per-advisor evidence (status / model / tokens / cost / messages /
    contextTokens / sessionId + `activeCount`); `dump` returns advisor
    conversation history.
  - **Envelope**: every result is ONE JSON body, plain `JSON.parse(text)` on
    every op — success `{ok, tool, op, summary?, …, warnings}` (the human
    one-liner rides inside as `summary`), failure `{ok: false, error, action?}`
    with `isError`; the same body is attached as `details`. The goal and mode
    tools speak the SAME envelope — one parsing rule for all three.
  - **Approval tiers** (dynamic, per op): `list/get/status/dump` = `read`;
    `upsert/remove/set_shared/apply/enable/disable` = `write` — mutate ops
    write/delete files and enable starts billable runtimes (ADR-005 §D5
    amendment, 2026-08-15).
  - **Implicit default**: with zero configured advisors the host runs an
    implicit `default` advisor on the advisor-role model. The tool shows it
    live in `status`, lists it as a synthetic `{name: "default",
    implicit: true}` entry in empty effective views, and manages it like any
    other advisor (`upsert name=default` materializes overrides; `remove`
    restores the implicit one) — a user-clarified pillar requirement.
  - **Safety**: advisors are billable background models that watch every
    primary turn; granting one `bash`/`write`/`edit` tools grants unattended
    mutation power. Mutates REBUILD all advisor runtimes (in-flight advisor
    turns abort; the result warns when that happened). An anti-clobber guard
    refuses mutates that would silently overwrite an unparsable-but-nonempty
    `WATCHDOG.yml` (the native loader maps those to an empty doc, and saving
    an empty doc DELETES the file — `persisted`/`fileDeleted` report what
    actually happened on disk). Same-path mutates are serialized; duplicate
    slugs follow host last-wins semantics with warnings (also: rename,
    CJK-slug fallback, unknown-tool → default read/grep/glob subset,
    no_model, shadowed-entry warnings).
- Session greeting + `/qol-config` command, and per-tool kill switches.

Docs: research `../docs/researches/omp-goal-system.md`,
`omp-plan-vibe-modes.md`, `omp-project-scoped-plugins.md`; designs under
`../docs/plans/designs/`; delivery test plan `../docs/plans/TDDs/qol-delivery-test-plan.md`.

## Layout

```text
package.json        # omp.extensions entry + omp.settings schema
src/main.ts         # plugin factory (ExtensionAPI, async)
src/goal-tool.ts    # QOL-001 goal tool (shadow + native delegation)
src/mode-tool.ts    # QOL-002/003 mode tool (thin driver over host primitives)
src/advisor-tool.ts # QOL-004 advisor tool (thin driver over native advisor/config)
src/lib/host-bridge.ts  # live AgentSession resolution via the injected host namespace
src/lib/advisor-native.ts # locked imports of the host's advisor/config helpers
src/lib/settings.ts # plugin settings loader (host API + lockfile fallback)
test/setup.ts       # bun preload: pid-scoped PI_CONFIG_DIR isolation root
test/goal-tool.test.ts  # bun test harness (12 cases)
test/mode-tool.test.ts  # bun test harness (22 cases, incl. T1–T6 sealed-host path)
test/advisor-tool.test.ts # L1 advisor unit tests (55 cases, A1–A25)
test/advisor-integration.test.ts # L3 real-AgentSession advisor tests (14 cases, I1–I12)
test/host-bridge.test.ts # real AgentRegistry edge cases (8 cases)
test/integration-real-session.test.ts # real host session + scripted model (7 cases)
```

## In-repo development install (not a second user path)

Tests use the official command inside an isolated config root:

```powershell
bun ../.sandbox/install-plugin.ts --isolated-root .omp-qol-dev
```

That is `omp plugin install omp-qol-plugin` with `PI_CONFIG_DIR=.omp-qol-dev`.
Unpublished local edits: add `--from-source` (`omp plugin install ../plugin`).
Do not copy `src` into `test-workspace/.omp/plugins` as the default.

While a live session is using `test-workspace/`, do not rewrite that
folder’s `.omp` tree. After sessions end, the next intentional install
is the official user command (writes `~/.omp/plugins`). Official
packaging research: `../docs/researches/omp-plugin-packaging-and-distribution-2026-08-15-redo.md`.

## Plugin settings

Declared in `package.json#omp.settings`; managed with
`omp plugin config set omp-qol-plugin <key> <value>`:

| Key                    | Type    | Default          |
| ---------------------- | ------- | ---------------- |
| `greeting`             | string  | `omp-qol ready.` |
| `notifyOnSessionStart` | boolean | `true`           |
| `goalToolEnabled`      | boolean | `true`           |
| `modeToolEnabled`      | boolean | `true`           |
| `advisorToolEnabled`   | boolean | `true`           |

## Verify

Full pyramid (see the delivery test plan for exact commands):

```powershell
bun run typecheck                              # tsc -p tsconfig.plugin.json (plugin src only)
bun ../.sandbox/link-dev-deps.ts               # one-time: monorepo junctions for the integration tests
bun run test                                   # 118 cases, single process (pid-scoped isolation preload)
bun ../.sandbox/install-plugin.ts --isolated-root .omp-qol-dev
bun ../.sandbox/registry-probe.ts --isolated-root .omp-qol-dev
bun ../.sandbox/verify-workspace.ts --isolated-root .omp-qol-dev
bun ../.sandbox/e2e-workspace-mode.ts          # real LLM; isolated official install (do not run against live test-workspace)
bun ../.sandbox/e2e-workspace-advisor.ts       # L6: isolated official install + scratch git workspaces
```

## Development notes

- Registration only during factory load; runtime actions (`sendMessage`,
  `exec`, ...) must run inside event handlers / commands / tools.
- `tool_call` handlers are fail-closed: a thrown error blocks the tool.
- Tools must declare `loadMode: "essential"` to appear in the LLM schema.
- Tests mutate `PI_CONFIG_DIR` and the process-global AgentRegistry; the
  test script runs all four files serially (bun runs test files
  concurrently in one process; the host's DirResolver pins the config root
  on first use per process).

## Reference

- OMP docs: `ref_repos/oh-my-pi/docs/extensions.md`, `extension-loading.md`,
  `plugin-manager-installer-plumbing.md`, `marketplace.md`.
