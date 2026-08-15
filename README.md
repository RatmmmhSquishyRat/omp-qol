# omp-qol

Quality-of-life plugin for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi).

## Install

Requires a working `omp` (this repo is verified against 17.3.4).

```bash
omp plugin marketplace add RatmmmhSquishyRat/omp-qol
omp plugin install omp-qol@omp-qol
```

Project-only (does not install into other projects):

```bash
omp plugin marketplace add RatmmmhSquishyRat/omp-qol
omp plugin install --scope project omp-qol@omp-qol
```

Then start `omp` and restart the session if it was already open. `/plugins` and `omp plugin list` should show `omp-qol@omp-qol`.

Upgrade:

```bash
omp plugin marketplace update omp-qol
omp plugin upgrade omp-qol@omp-qol
```

Uninstall:

```bash
omp plugin uninstall omp-qol@omp-qol
```

Settings use the **package name**, not the marketplace id:

```bash
omp plugin config set omp-qol-plugin greeting "omp-qol ready."
```

There is no npm package published yet. `omp plugin install omp-qol-plugin` will fail until a human configures npm publishing. The marketplace commands above are the supported user path.

## What it does

- **QOL-001** `goal` tool — the agent drives the native session goal (shadow + `ctx.invokeTool`).
- **QOL-002/003** `mode` tool — agent-controlled plan and vibe modes (thin driver, ADR-004).
- **QOL-004** `advisor` tool — the agent reads and edits WATCHDOG advisors the same way a user can in the CLI (thin driver, ADR-005).

## Layout

```text
plugin/          # installable plugin (package name omp-qol-plugin)
.omp-plugin/     # marketplace catalog the host reads
docs/
test-workspace/  # in-repo launch folder for developers
.sandbox/        # dev installers / probes / e2e (not the user install path)
```

## In-repo development

This path is for people working in this git checkout. It copies MarketplaceManager-shaped artifacts under `test-workspace/.omp/plugins/` and does not write the developer’s `~/.omp`.

```powershell
bun .sandbox/install-plugin.ts
cd test-workspace
omp
```

Do not `git init` `test-workspace` unless the author asks: it has no `.git`, so a project-scope advisor write from inside it resolves to this repo’s production `WATCHDOG.yml`.

## Verify (developers)

```powershell
cd plugin
bun run typecheck
bun run test
cd ..
bun .sandbox/link-dev-deps.ts
bun .sandbox/check-distribution-metadata.ts
bun .sandbox/install-plugin.ts
bun .sandbox/verify-workspace.ts
```

L6 real-model e2e stays out of default CI. Full pyramid: `docs/plans/TDDs/qol-delivery-test-plan.md`.

## Hard rules

- User install uses the official omp marketplace commands above.
- In-repo acceptance still must not write the author’s `~/.omp` (use the sandbox installer or an isolated `PI_CONFIG_DIR`).
- The plugin only adds entry points onto host functionality; no emulation (ADR-004 / ADR-005).
- Research lands in `docs/` before implementation.
