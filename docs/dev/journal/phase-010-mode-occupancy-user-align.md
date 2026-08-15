# Phase 010: Align plan/goal/vibe occupancy with the user-side table

**commit**: pending
**date**: 2026-08-15

## Problem / Background

插件 `mode` / `goal` 自造互斥只认 active。用户侧 `/plan` `/vibe` `/goal` 对暂停也占位。作者的互斥只活在 InteractiveMode 进出函数里，插件调不到。先前把「拿不到 `planModePaused` 内存旗子」写成「拿不到暂停状态」。

## Decision

规则与用户侧对齐，暂停也互斥。互斥判断仍自造（宿主没有导出 canEnter）。plan 暂停读作者自己的投影：`sessionManager.buildSessionContext().mode`（恢复会话时同一条路），`getEntries` 仅回退。插件 `plan_enter` / `plan_exit` 写入同一本 `mode_change` 日记。

## Output

用户决策记入 `docs/ssot/pillars/self-managed-mode-switch/plan-goal-vibe.md`（原文三行未改）。占用表抽到 `plugin/src/lib/mode-exclusivity.ts`；`mode` / `goal` 工具按该表拒绝；session-004 记录调查。

## Verification

`cd plugin && bun test test/mode-exclusivity.test.ts test/mode-tool.test.ts test/goal-tool.test.ts test/integration-real-session.test.ts`：56 pass / 0 fail。真实会话 I5c：`appendModeChange("plan_paused")` 后 `buildSessionContext().mode === "plan_paused"`，`vibe_enter` 被拒。
