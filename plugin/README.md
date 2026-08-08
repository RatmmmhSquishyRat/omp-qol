# omp-qol-plugin

Quality-of-life **plugin** for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi).
Full plugin semantics: it installs as a proper omp plugin (runtime loading
AND the UI surfaces — `/plugins` panel, `/marketplace installed`,
`omp plugin list`) at **project scope**, with zero writes to the global
`~/.omp`.

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
src/lib/host-bridge.ts  # live AgentSession resolution via the injected host namespace
src/lib/settings.ts # plugin settings loader (host API + lockfile fallback)
test/goal-tool.test.ts  # bun test harness (12 cases)
test/mode-tool.test.ts  # bun test harness (22 cases, incl. T1–T6 sealed-host path)
test/host-bridge.test.ts # real AgentRegistry edge cases (8 cases)
test/integration-real-session.test.ts # real host session + scripted model (7 cases)
```

## Install (project scope, zero global writes)

The deterministic installer replicates the project-side artifacts of the
host's own `MarketplaceManager.installPlugin(scope:"project")` under
`../test-workspace/.omp/plugins/` (content cache copy + node_modules
junction + lockfile + `installed_plugins.json`):

```powershell
bun ../.sandbox/install-plugin.ts          # idempotent; re-run after source changes
```

Then launch omp from `../test-workspace` — the plugin is enabled and listed
(`omp plugin list` → `omp-qol-plugin@local (0.3.0) (project)`). Mechanism
and source evidence: `../docs/researches/omp-project-scoped-plugins.md` §5.4.

## Plugin settings

Declared in `package.json#omp.settings`; managed with
`omp plugin config set omp-qol-plugin <key> <value>`:

| Key                    | Type    | Default          |
| ---------------------- | ------- | ---------------- |
| `greeting`             | string  | `omp-qol ready.` |
| `notifyOnSessionStart` | boolean | `true`           |
| `goalToolEnabled`      | boolean | `true`           |
| `modeToolEnabled`      | boolean | `true`           |

## Verify

Full pyramid (see the delivery test plan for exact commands):

```powershell
bun run typecheck                              # tsc --noEmit, src clean
bun ../.sandbox/link-dev-deps.ts               # one-time: monorepo junctions for the integration tests
bun run test                                   # 49 cases, run serially per file
bun ../.sandbox/install-plugin.ts              # refresh delivery artifacts
bun ../.sandbox/registry-probe.ts              # runtime + UI registry dual assertion
bun ../.sandbox/verify-workspace.ts            # delivery-form RPC dumpTools (also --control / --source)
bun ../.sandbox/e2e-workspace-mode.ts          # real LLM drives ALL 5 mode ops
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
