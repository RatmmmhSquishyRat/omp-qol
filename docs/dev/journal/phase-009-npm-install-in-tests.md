# Phase 009: Official npm install in tests

**commit**: `3325706` `feat: switch test install to isolated official npm command`
**date**: 2026-08-15

## Problem / Background

`omp-qol-plugin@0.3.1` 已上架。用户命令是 `omp plugin install omp-qol-plugin`。测试与 e2e 仍默认拷贝 `plugin/src` 到假 marketplace 缓存。全局与 test-workspace 的 omp 有活任务，不能热换 live `.omp`。

## Decision

默认测试安装改为隔离根上的同一条官方命令。`install-plugin.ts` 无隔离则拒绝。`--from-source` 仅作未发布本地树的 opt-in。live test-workspace 等会话结束后再有意重装。

## Output

计划 `qol-npm-install-in-tests.md`；支柱第四条澄清原文；harness / README / TDD 改走官方命令。

## Verification

`cd plugin && bun test`：120 pass / 0 fail。无隔离安装器退出 2。隔离 HOME 官方安装 + registry-probe + verify-workspace 全绿（`omp-qol-plugin@0.3.1`）。作者 `~/.omp/plugins/package.json` 仍不存在。`test-workspace/.omp/plugins` mtime 未变。证据 `.sandbox/official-install-smoke-20260815.md`。未重装 live test-workspace。
