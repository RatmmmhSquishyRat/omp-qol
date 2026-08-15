# omp-qol

Quality-of-life plugin for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi).

## Install

Requires a working `omp` (this repo is verified against 17.3.4).

```bash
omp plugin install omp-qol-plugin
```

`omp install omp-qol-plugin` is the same command. Restart an already-open session (or `/reload-plugins` for skills; restart for tools/extensions). `omp plugin list` should show `omp-qol-plugin@<version>` under npm plugins. The published package is `omp-qol-plugin@0.3.1`.

Upgrade:

```bash
omp plugin install omp-qol-plugin@<version>
```

Uninstall:

```bash
omp plugin uninstall omp-qol-plugin
```

Settings use the package name:

```bash
omp plugin config set omp-qol-plugin greeting "omp-qol ready."
```

`--scope project` is a marketplace-only host flag. `omp plugin install omp-qol-plugin --scope project` prints a warning and still writes the user plugin root (`~/.omp/plugins`). That is host behavior, not a second install channel we maintain.

## What it does

- **QOL-001** `goal` tool — the agent drives the native session goal (shadow + `ctx.invokeTool`).
- **QOL-002/003** `mode` tool — agent-controlled plan and vibe modes (thin driver, ADR-004).
- **QOL-004** `advisor` tool — the agent reads and edits WATCHDOG advisors the same way a user can in the CLI (thin driver, ADR-005).

## Layout

```text
plugin/          # npm package omp-qol-plugin
docs/
test-workspace/  # in-repo launch folder for developers
.sandbox/        # dev installers / probes / e2e (not the user install path)
```

## In-repo development

Tests and e2e use the same official command, pointed at an isolated config root so they cannot write the developer’s `~/.omp` or the live `test-workspace/.omp` tree.

```powershell
bun .sandbox/install-plugin.ts --isolated-root .omp-qol-dev
```

That runs `omp plugin install omp-qol-plugin` with `PI_CONFIG_DIR=.omp-qol-dev`. Unpublished local edits are opt-in only:

```powershell
bun .sandbox/install-plugin.ts --isolated-root .omp-qol-dev --from-source
```

`--from-source` is `omp plugin install <repo>/plugin` (host local path, still user-scope under the isolated root). Do not treat the old copy/junction into `test-workspace/.omp/plugins` as the default.

`test-workspace/` is a launch folder. While a session is running there, do not reinstall or rewrite `test-workspace/.omp`. After those sessions end, the next intentional install is `omp plugin install omp-qol-plugin` (writes `~/.omp/plugins`). Leftover `test-workspace/.omp/plugins` from the old copier can shadow that user-scope package if `PI_CONFIG_DIR` is the default `.omp` — remove or stop using that leftover tree after sessions end. This checkout does not do that hot-swap.

Do not `git init` `test-workspace` unless the author asks: it has no `.git`, so a project-scope advisor write from inside it resolves to this repo’s production `WATCHDOG.yml`.

## Verify (developers)

```powershell
cd plugin
bun run typecheck
bun run test
cd ..
bun .sandbox/link-dev-deps.ts
bun .sandbox/check-distribution-metadata.ts
bun .sandbox/install-plugin.ts --isolated-root .omp-qol-dev
bun .sandbox/registry-probe.ts --isolated-root .omp-qol-dev
bun .sandbox/verify-workspace.ts --isolated-root .omp-qol-dev
```

L6 real-model e2e stays out of default CI. Full pyramid: `docs/plans/TDDs/qol-delivery-test-plan.md`.

## Hard rules

- User install is `omp plugin install omp-qol-plugin`.
- In-repo acceptance must not write the author’s `~/.omp` (isolated `PI_CONFIG_DIR` or isolated HOME).
- The plugin only adds entry points onto host functionality; no emulation (ADR-004 / ADR-005).
- Research lands in `docs/` before implementation.
