# Phase 006: Official plugin packaging, marketplace install, and CI

**commit**: `4f688a2` `feat: add marketplace catalog, CI, and official user install path`（docs-mapping 同回合随后一枚）
**date**: 2026-08-15

## Problem / Background

The project had no npm publish, no GitHub Actions, and no official user install path. The only install was `.sandbox/install-plugin.ts`, a developer copy of MarketplaceManager artifacts under `test-workspace/.omp/plugins/`. The 2026-08-15 pillar requires distribution completeness so other users can install the plugin.

## Decision

Route B: in-repo `.omp-plugin/marketplace.json` with `source: "./plugin"`. Selected over npm-only (no token; no project scope) and git-URL/Release-tarball (repo root is not a plugin package). User commands are `omp plugin marketplace add RatmmmhSquishyRat/omp-qol` then `omp plugin install omp-qol@omp-qol`. Sandbox installer stays as the in-repo dev path. Default CI runs `bun test` + plugin-only typecheck; L6 stays out; no auto npm publish.

## Output

Catalog, package metadata, LICENSE, CI/release workflows, README rewrite, distribution research/route/guide/design, pillar `docs/ssot/pillars/distribution-delivery/`.

## Verification

`bun test` 118/118; `bun run typecheck` exit 0; metadata check PASS; isolated `PI_CONFIG_DIR` marketplace install listed `omp-qol@omp-qol (0.3.0) (user)` and left `~/.omp/marketplaces.json` untouched. Nothing was published to npm.
