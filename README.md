# omp-qol

Quality-of-life plugin for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi).

## Install

Requires a working `omp` (this repo is verified against 17.3.4).

```bash
omp plugin install omp-qol-plugin
```

`omp install omp-qol-plugin` is the same command. Restart an already-open session (or `/reload-plugins` for skills; restart for tools/extensions). `omp plugin list` should show `omp-qol-plugin@<version>` under npm plugins.

The first publish tag is `v0.3.1`. Do not reuse `v0.3.0`: that tag points at a commit with no workflows. The first Actions publish signed provenance, then npm returned 403 — the `NPM_TOKEN` secret must be a granular access token with bypass 2FA, or the package needs a trusted publisher. Re-run Release on `v0.3.1` after that. Do not treat a failed install before the package is on the registry as a reason to add a git marketplace.

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

This path is for people working in this git checkout. It copies MarketplaceManager-shaped artifacts under `test-workspace/.omp/plugins/` and does not write the developer’s `~/.omp`.

```powershell
bun .sandbox/install-plugin.ts
cd test-workspace
omp
```

From a clone, `omp plugin install ./plugin` (or `omp plugin link ./plugin`) also loads the local tree into the **user** plugin root. That is a host local-link path, not npm, and not project scope.

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

- User install is `omp plugin install omp-qol-plugin`.
- In-repo acceptance still must not write the author’s `~/.omp` (use the sandbox installer or an isolated homedir).
- The plugin only adds entry points onto host functionality; no emulation (ADR-004 / ADR-005).
- Research lands in `docs/` before implementation.
