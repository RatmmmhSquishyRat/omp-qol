# omp-qol

QoL plugin for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi) —
research, implementation, delivery, and verification in one repo
(single git root; no nested repos).

## Layout

```text
plugin/          # the plugin itself (omp-qol-plugin, full plugin semantics)
docs/
  researches/    # host mechanism research with source evidence (docs-first)
  plans/         # designs / TDDs / impls
  ssot/adrs/     # architecture decision records
test-workspace/  # launch omp here -> plugin enabled at PROJECT scope
.sandbox/        # deterministic installers / probes / live verifiers / e2e
```

## Features

- **QOL-001** `goal` tool — the agent drives the native session goal
  (shadow + `ctx.invokeTool` delegation, zero reimplementation).
- **QOL-002/003** `mode` tool — agent-controlled plan & vibe modes, a thin
  driver over the host's own primitives (works on every host form,
  including the sealed installed binary; ADR-004: entry points only).

## Quick start

```powershell
bun .sandbox/install-plugin.ts      # project-local install into test-workspace (zero global writes)
cd test-workspace
omp                                 # /plugins lists omp-qol-plugin@local (project scope)
```

## Verify

```powershell
cd plugin
bun run typecheck
bun run test                        # 49 cases (run serially per file)
cd ..
bun .sandbox/link-dev-deps.ts       # dev junctions for the integration tests (one-time)
bun .sandbox/registry-probe.ts      # runtime + UI registry dual assertion
bun .sandbox/verify-workspace.ts    # RPC dumpTools (also --control / --source)
bun .sandbox/e2e-workspace-mode.ts  # real LLM drives all 5 mode ops on the installed host
```

Full test pyramid and evidence: `docs/plans/TDDs/qol-delivery-test-plan.md`.

## Hard rules

- Never write to the global `~/.omp` — project-local enablement only.
- The plugin only ADDS ENTRY POINTS onto host functionality; no emulation,
  no hardcoding, no reimplementation (ADR-004).
- Research findings are persisted into `docs/` BEFORE implementation.
