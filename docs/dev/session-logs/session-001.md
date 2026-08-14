# Session 001: QOL-004 advisor docs

**date**: 2026-08-15
**commits**:

## Turn 1

### User

> 用户要求实现 advisor 向 agent 暴露。
>
> Build 执行该 plan

（完整 Build 消息按作者指示简记；对象为 `advisor_agent_interface_d5d38882.plan.md` Execution Plan 第 1 步：只写文档，不改 plugin 源码，不改支柱原文。）

### Agent Actions

- 读计划、`qol-001`/`qol-002-003` design、TDD、ADR-001/004、Foundation `06-ADVISOR-WATCHDOG`、ApplyResult 矩阵、pillar 原文（只读）、TUI Save 与 `AgentSession` advisor 公开方法。
- 确认 `docs/dev/session-logs/` 此前未落地，本会话编号为 `001`。
- 写出 `docs/plans/designs/qol-004-advisor-tool-design.md`（Track A 通路 / Track B 便利性分章）。
- 写出 `docs/plans/TDDs/qol-004-advisor-tool-tests.md`（Foundation F1–F8 映射 + L1/L3/L4 门）。
- 写出 `docs/ssot/adrs/ADR-005-advisor-thin-driver.md`（薄驱动、不仿真、enable≠discover、默认 project、显式 user）。
- 未改 `plugin/`、未改 `docs/ssot/pillars/`、未写 impl-notes（计划规定实现中写）、未建 journal（无 commit）。

## Turn 2

### User

> 执行计划 c:\Users\15480\.cursor\plans\advisor_agent_interface_d5d38882.plan.md 的步骤 3–8：实现 + L1/L3 测试 + verify-workspace + impl-notes。
>
> 设计/TDD/ADR 已写好，按它们实现，不要重开路线：
> - docs/plans/designs/qol-004-advisor-tool-design.md
> - docs/plans/TDDs/qol-004-advisor-tool-tests.md
> - docs/ssot/adrs/ADR-005-advisor-thin-driver.md
>
> 仓库：C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol
> 宿主：C:\Users\15480\Desktop\AIWorkshop\ref_repos\oh-my-pi
>
> ## 探针已锁定（必须遵守）
>
> 1. Import 只用：
> ```ts
> import { loadWatchdogConfigFile, saveWatchdogConfigFile, discoverAdvisorConfigs, resolveAdvisorConfigEditPath, type AdvisorConfig, type WatchdogConfigDoc } from "@oh-my-pi/pi-coding-agent/advisor/config";
> import { getAgentDir, repo } from "@oh-my-pi/pi-coding-agent";
> ```
> 不要 `.../advisor` barrel。不要自写 YAML serializer。密封 import 失败则诚实报错。
>
> 2. `getAgentDir()` 同步；`projectDir = (await repo.root(cwd)) ?? cwd`。
>
> 3. 真 AgentSession 已有：applyAdvisorConfigs, setAdvisorEnabled, isAdvisorEnabled, isAdvisorActive, getAdvisorStats, formatAdvisorStatus, formatAdvisorHistoryAsText。
> - apply 在 disabled 时返回 0 且 stats.advisors 空，不是失败；enable 后才有 live roster。
> - enable/disable 绝不 discover。
>
> 4. host-bridge：扩展 LiveHostSession 加 advisor 方法。advisor sanity **独立**，不要并进现有 plan/vibe gate（否则会误杀 mode）。resolveHostBridge 已能拿到同一 live session。
>
> 5. 测试隔离：PI_CONFIG_DIR / 临时 agentDir，禁止写真实 ~/.omp。
>
> （完整消息已省略部分细节）

### Agent Actions

- 读 plan 文件、design、TDD、ADR-005、现有 host-bridge.ts / settings.ts / main.ts / mode-tool.ts / integration-real-session.test.ts、宿主 advisor/config.ts 和 session-advisors.ts、probe-advisor-qol004.body.ts（确认探针结论）。
- 确认 `@oh-my-pi/pi-coding-agent/advisor/config` 通过 tsconfig paths 和 `./*` wildcard export 均可解析；`getAgentDir()` 模块加载时捕获 env（不可在 import 后重设）。
- 扩展 `plugin/src/lib/host-bridge.ts`：`LiveHostSession` 新增 advisor 方法类型 + `sessionHasAdvisorSurface()` 独立 helper；`sessionManager` 添加 `getCwd?()` 字段。
- 创建 `plugin/src/lib/advisor-native.ts`：6 个 thin wrapper 函数，锁定 import 路径，无 YAML 自写。
- 创建 `plugin/src/advisor-tool.ts`：`registerAdvisorTool`，10 ops（list/get/upsert/remove/set_shared/apply/enable/disable/status/dump），`ApplyResult` shape，split sanity，shadow/disabled 警告，abort 检查。
- 更新 `plugin/src/lib/settings.ts`：添加 `advisorToolEnabled` (default true)；更新 `plugin/package.json`：设置 schema + 串行追加新测试文件；更新 `plugin/src/main.ts`：注册 advisor tool。
- 创建 `plugin/test/advisor-tool.test.ts`（L1，28 用例，A1–A18，全绿）。
- 创建 `plugin/test/advisor-integration.test.ts`（L3，10 用例，I1–I9 + bridge 验证）：首次运行 I1/I4 失败，原因 `getAgentDir()` 模块加载时已固化；修复：改为 `resolveNative: async () => makeIsolatedNative(agentDir)` 注入隔离 agentDir，保留真实 YAML 序列化逻辑，全绿。
- 更新 `.sandbox/verify-workspace.ts`：L4 增加 `advisor` 工具识别 + 10-op schema 检查。
- 全套 `bun run test`：85 pass 0 fail（28 L1 + 10 L3 + 47 已有）。
- 写出 `docs/plans/impls/qol-004-impl-notes.md`（测试结果、F1–F7 门禁覆盖、SSOT amend 决策：不改 pillar）。
- 更新 `docs/dev/session-logs/session-001.md`（本 Turn）。
