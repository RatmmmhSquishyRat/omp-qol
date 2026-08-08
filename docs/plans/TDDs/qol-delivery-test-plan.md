# omp-qol 交付级测试策略(QOL-001/002/003)

状态:已执行完毕(2026-08-05)。本文是交付本项目的完整测试设计与证据记录,
与 `qol-002-003-mode-tool-tests.md`(用例级 TDD)互补:后者是单元用例清单,
本文是分层金字塔与运行规程。

## 0. 测试对象与质量目标

交付物 = omp-qol-plugin(goal 工具 + mode 薄驱动)。质量目标按用户原则:

> **2026-08-07 仓库重整**:插件正名 `omp-qol-extension` → `omp-qol-plugin`
> v0.3.0(完整插件语义),源码位于仓库根 `plugin/`(不再是嵌套的
> `repos/omp-qol-extension`),全仓单一 git(仓库根),无向前兼容。
> 下文中旧名/旧路径均为历史记录,复现一律以 §9 命令为准。

1. **只加入口,不复刻宿主行为** —— 测试必须证明我们驱动的是宿主自己的机制,
   而不是我们自己的仿真(ADR-004)。
2. **活体可用** —— 不只是单测通过,必须在真实宿主进程中可见、可调用、产生
   真实宿主状态变化。
3. **诚实降级** —— 桥不可用(密封 dist 宿主)时明确报错,绝不伪造行为。

## 1. 测试金字塔

```
L6  交付形态真实 LLM e2e(安装版宿主 + test-workspace)  全部 5 个 op 依次执行,用户路径原样
L5  真实 LLM 端到端(源码宿主 + 中转网关)          2 场景,真实模型自主调用
L4  活体接线(RPC dumpTools,4 组:安装/源码 × 扩展/对照)  注册+schema+对照隔离
L3  真实会话集成(真 AgentSession + 脚本化模型)       I1–I7
L2  宿主侧单元(真 AgentRegistry 上的边界)            H1–H8
L1  逻辑单元(mock 会话,行为矩阵)                    goal 12 + mode 16
```

原则:越往上越接近交付现场,越往下越能精确定位缺陷。L3/L5 是本次补齐的
关键层 —— 薄驱动代码量小,但"入口是否真的接到宿主机体上"只能在真实会话
与真实模型上证明。

## 2. L1 逻辑单元(test/goal-tool.test.ts, test/mode-tool.test.ts)

- goal 工具 12 例(D 系列):委托、预算校验、错误透传、kill switch 等。
- mode 工具 16 例(N 系列):ACP 形状状态、幂等、互斥守卫、vibe 工具集形状、
  不可信注册表拒绝(N7b)、诚实降级、注册形状、kill switch。
- 运行:`bun test`(单进程全量,43 例)。
  历史坑:两个 kill-switch 套件曾各自用独立配置根,宿主 XDG DirResolver
  首次使用即固定配置根,先跑的文件会把后跑文件的 lockfile 位置定格到
  已被删除的目录 —— 现共享同一 testRoot 解决(见 mode-tool.test.ts 注释)。

## 3. L2 宿主侧单元(test/host-bridge.test.ts,H1–H8)

对 `resolveHostBridge`/`buildVibeParentSession` 在**真实** `AgentRegistry.global()`
上的边界测试:

| 用例 | 场景 | 断言 |
|---|---|---|
| H1 | 只有 sub-kind 注册 | 返回 null |
| H2 | main 但 session 为 null(parked) | 返回 null |
| H3 | session 缺必需方法(sanity gate) | 拒绝,null |
| H4 | 完整 session | 解析成功,vibeRegistry 附着且 trusted |
| H5 | 重复解析 | 稳定(模块缓存) |
| H6 | parent facade | 读穿透到活会话访问器 |
| H7 | 注入命名空间优先于自导入 | 注入面 wins(自导入会得 null 的构造) |
| H8 | 注入面无 AgentRegistry | 回退自导入 |

## 4. L3 真实会话集成(test/integration-real-session.test.ts,I1–I7)

配方借鉴宿主自己的测试(`agent-session-plan-mode-convergence.test.ts`):
真实 `AgentSession` + `SessionManager.inMemory()` + 宿主自带的
`createMockModel`(脚本化模型,离线、确定性、无 API key)。扩展以生产
resolver 注册(不注入 resolveBridge),并像宿主一样注册进 `AgentRegistry`。

| 用例 | 证明 |
|---|---|
| I1 | 生产 resolver 找到活会话(同一实例) |
| I2 | **真实 agent 循环**中脚本化模型调用 `mode plan_enter` → 宿主 plan 状态生效(ACP 形状) |
| I3 | `plan_exit` 清除宿主状态 |
| I4 | `vibe_enter` 在**真实会话**中安装真实 vibe 五件套,`vibe_exit` 恢复;`mode` 自身保持可调用 |
| I5 | 真实 `goalRuntime.createGoal` 阻断 `plan_enter`(真实互斥) |
| I6 | 未注册 → 诚实报错(真实 resolver 路径) |
| I7 | 我们设置的状态驱动**宿主自己的** `enforcePlanModeWrite`:plan 开启时写工作树抛错,退出后放行 |

I7 是"入口接到宿主机体"的因果证明:写保护是宿主代码,只读我们写的状态。

## 5. L4 活体接线(.sandbox/verify-workspace.ts)

> 2026-08-07 起统一走交付形态(cwd=test-workspace,项目级插件,不动全局根);
> 早期隔离根版本 `verify-live.ts` 已删除。

RPC 模式启动真实宿主,`get_state` → `dumpTools`,断言:

- goal/mode 带 `[qol]` 标记出现;
- mode 的模型侧 schema 携带全部 5 个 op;
- 对照运行(`--no-extensions`)证明工具来自本扩展而非宿主。

矩阵:安装宿主×{扩展,对照} + 源码宿主×{扩展,对照} = 4 组全 PASS。

## 6. L5 真实 LLM 端到端(源码宿主 + 隔离根 provider)

环境(可复现):
- 隔离配置根 `~/.omp-qol`,`PI_CONFIG_DIR=.omp-qol`;
- `agent/models.yml`:自定义中转网关(anthropic-messages,apiKey 读环境
  变量;密钥仅存在于隔离根的 `.env` 与进程环境,不入仓库;具体 provider
  名称属个人配置,已从仓库剔除);
- 模型:网关的廉价 flash 模型;宿主:monorepo 源码(`bun src/cli.ts`)。
- 注:部分网关被本机网络中间设备替换证书(bun 校验失败),已弃用;
  仅保留 TLS 正常的网关。

| 场景 | 提示 | 证据(会话转录) |
|---|---|---|
| E2E-plan | 依次 status → plan_enter → status | `plan: off…` → ACTIVE → `plan: on | vibe: off | goal: none` |
| E2E-vibe | 依次 vibe_enter → status → vibe_exit → status | ACTIVE → `vibe: on` → exited → `vibe: off` |

**缺陷捕获**:E2E-vibe 首跑暴露真实缺陷 —— 宿主 vibe 激活会用 director
工具集整体替换活动集,`mode` 工具被踢出,agent 失去自己的退出开关
(模型如实报告 "Tool mode not found")。修复:vibe_enter 的 base 集合
在宿主序列之外保留 `mode`(仅当它原本就在活动集中),其余行为仍逐字
对齐 InteractiveMode。修复后完整循环一次通过。这是单元/集成层都看不到、
只有真实模型驱动才能暴露的缺陷 —— L5 存在的理由。

## 7. 静态与回归门禁

- `bun run typecheck`(tsc --noEmit):本仓库 src 零错误(宿主 monorepo
  的 `.md` 文本导入告警属 Bun 专属特性,非本仓库问题)。
- `bun run test`:43/43 全绿(12+16+8+7)。
- `omp plugin doctor`:4 ok, 0 warnings, 0 errors。

## 8. 已知边界(诚实记录,非缺口)

1. ~~安装版 omp 密封 dist 形态拿不到活会话~~ **已解决(2026-08-06)**:
   宿主经 `ExtensionAPI.pi` 注入自身模块命名空间,桥改走注入面后,
   安装版宿主的 plan/vibe/status 全部可用 —— L6 交付形态 e2e 实证
   (见 `.sandbox/e2e-workspace-mode.ts` 与 omp-plan-vibe-modes.md §6)。
   ~~密封宿主的 vibe 操作曾被 `vibeRegistryTrusted` 守卫拒绝~~
   **已解决(2026-08-07,CORRECTION-2)**:根 barrel 不导出
   `VibeSessionRegistry`,但经 `./tools` 注入活体 `VibeListTool`/
   `VibeKillTool` 类;密封宿主的 vibe 退出改走“list→逐 id kill”
   (不碰 `#terminatedScopes`,重入无锁)。L6 实证 5 个 op 全部通过,
   单测 T1–T6 覆盖该路径;仅当两面均缺失时才诚实拒绝
   (见 omp-plan-vibe-modes.md §7)。
2. `/plan`、`/vibe`、`/goal` 为宿主 handleTui-only 命令,无官方非 TUI
   派发;本扩展走会话调用契约(ACP 同路),不触碰命令派发。
3. E2E 的 provider 依赖外部网关可用性;离线时 L1–L4 完整覆盖交付质量。
   注:用户默认模型可能配额耗尽(usage_limit_reached),L6 脚本会自动
   切换到 `OMPQOL_RELAY_PROVIDERS` 指定中转池的最廉价模型。
4. 插件可见性有两条独立通路:运行时加载(`getEnabledPlugins`)与
   UI 列表(`installed_plugins.json`,喂 `/plugins` 面板与 `omp plugin list`)。
   交付形态两者均写入并经 `registry-probe.ts`(宿主自身函数)双面断言;
   机制与源码证据见 omp-project-scoped-plugins.md §5.4。

## 9. 复现命令一览

```powershell
cd repos/omp-qol/plugin
bun run typecheck
bun run test                                  # L1+L2+L3,49 例(含 T1–T6 密封宿主 vibe 工具类路径)

cd ..
bun .sandbox/link-dev-deps.ts                 # 开发依赖:monorepo 包 junction 进 plugin/node_modules(仅 bun test 需要)
bun .sandbox/install-plugin.ts                # 安装/刷新交付形态(幂等,零全局写入)
bun .sandbox/registry-probe.ts                # 双面断言:runtime + UI 注册表(project scope)
bun .sandbox/verify-workspace.ts              # 交付形态接线(cwd=test-workspace,不动全局根)
bun .sandbox/verify-workspace.ts --control    # 安装宿主+对照(--no-extensions)
bun .sandbox/verify-workspace.ts --source     # 源码宿主+插件
bun .sandbox/verify-workspace.ts --source --control  # 源码宿主+对照
bun .sandbox/e2e-workspace-mode.ts            # L6:安装版 omp + test-workspace,真实 LLM 依次执行全部 5 个 op
                                              # status→plan_enter→plan_exit→vibe_enter→vibe_exit→status
                                              # 需 OMPQOL_RELAY_PROVIDERS=<provider 池,按优先级>（个人配置,不入仓库）

cd test-workspace
omp plugin list                               # UI 面实证:omp-qol-plugin@local (0.3.0) (project)
```
