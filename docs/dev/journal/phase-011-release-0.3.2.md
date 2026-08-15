# Phase 011: Release 0.3.2 (occupancy refine)

**commit**: `8e254d6` `chore: bump plugin to 0.3.2 for the occupancy refine release`
**date**: 2026-08-16

## Problem / Background

`c4dee55` 已把 plan/goal/vibe 占用表与用户侧暂停互斥对齐。包仍停在已上架的 `0.3.1`。

## Decision

审过占用表与测试后发 `0.3.2`。不复用 `v0.3.1`。走既有 tag Release（verify → npm publish → GitHub Release）。

## Output

`plugin/package.json` 与用户向 README 版本钉到 `0.3.2`。

## Verification

`cd plugin && bun test`：133 pass / 0 fail。
