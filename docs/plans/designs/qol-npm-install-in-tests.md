# Design: 测试与验收改走官方 npm 安装

**date**: 2026-08-15
**route**: 沿用 Route A（`omp plugin install omp-qol-plugin`）
**pillar**: `docs/ssot/pillars/distribution-delivery/user-installable-plugin.md` 第四条澄清

## 背景

`omp-qol-plugin@0.3.1` 已在 npm。用户头条命令是 `omp plugin install omp-qol-plugin`。宿主对 npm 目标忽略 `--scope project`，写入仍是用户插件根（`~/.omp/plugins`，或 `PI_CONFIG_DIR` 指向的同级根）。

作者要求：上架之后，测试工作区与 e2e 也走这条命令。仓内拷贝 `plugin/src`、伪造 `local` marketplace、junction 到 `test-workspace/.omp/plugins/`，不再当默认安装故事。

现场约束：本机有活着的 `omp`（读到 pid 49744、65868）。不得杀、停、重启非本脚本进程；不得对 `~/.omp` 或 `test-workspace` 跑 `omp plugin install` / `upgrade` / `uninstall`；不得热换 `test-workspace/.omp/plugins/**`。

## 现状

对照 `.sandbox/`、`test-workspace/README.md`、交付 TDD、两端 README 之后，默认测试安装仍是两套并行故事：

1. 用户文档头条已经是 `omp plugin install omp-qol-plugin`。
2. 验收脚本默认仍是 `.sandbox/install-plugin.ts` 复刻 MarketplaceManager 项目侧产物（`omp-qol-plugin@local`、scope=project），`e2e-workspace-advisor.ts` 的 `makeWorkspace()` 再手写一份同样的拷贝/junction。

`registry-probe.ts` 断言 `@local` + project；`verify-workspace.ts` / `e2e-workspace-mode.ts` 默认 cwd=`test-workspace` 且不设 `PI_CONFIG_DIR`。在活会话还在读那棵树的时候，重跑旧安装器会改 junction / lock。

## 猜想

1. 隔离根上跑官方 `omp plugin install omp-qol-plugin`，插件会出现在 `<home>/<PI_CONFIG_DIR>/plugins` 的 npm 段，而不是项目侧 `@local`。
2. `PI_CONFIG_DIR` 是相对 home 的目录名（`dirs.ts` `getConfigDirName`）。名字不是 `.omp` 时，写入落在 `~/<name>/plugins`，不会进作者的 `~/.omp`。
3. 活着的 `test-workspace/.omp` 只能在会话结束后再有意重装；本轮只改脚本和文档。

## 决策

| 项 | 选择 |
| --- | --- |
| 测试默认命令 | `omp plugin install omp-qol-plugin` |
| 隔离 | 必填 `--isolated-root .omp-qol-*`（改 `PI_CONFIG_DIR`）或 `--isolated-home <abs>`（改 `HOME`/`USERPROFILE`） |
| 旧拷贝器 | 删除默认路径；`.sandbox/install-plugin.ts` 改成官方命令的薄包装，无隔离则退出 |
| 未发布本地改动 | `--from-source` → `omp plugin install <repo>/plugin`，明示 opt-in |
| live test-workspace | 不重装、不删 `.omp`；文档写明操作红线 |
| fallback-real-root（e2e） | 不在 live `~/.omp` 上跑官方 install；若用户根里已有包则沿用，否则 inconclusive |

不恢复已删除的 `.omp-plugin/marketplace.json`。

## 影响面

- 改：`.sandbox/install-plugin.ts`、`registry-probe.ts`、`verify-workspace.ts`、`e2e-workspace-advisor.ts`、`e2e-workspace-mode.ts`，以及 README / 交付 TDD / 实现指引里仍把拷贝器当默认的段落。
- 不改：`plugin/src/**`、`plugin/test/**`（单测已用 pid 级 `PI_CONFIG_DIR`，不装交付插件）、`.github/workflows/**`、根 `WATCHDOG.yml`、`test-workspace/.omp/**`、历史 journal 正文。
- 历史调研只加「现行默认已改」条，不改写当时的调查记录。

## 操作红线（live 根）

活会话结束后，若要把启动目录对齐官方用户根：

```powershell
omp plugin install omp-qol-plugin
```

这条命令写的是**该用户**的 `~/.omp/plugins`，不是 `test-workspace/.omp`。`--scope project` 对 npm 无效。届时应停用或删掉 leftover 的 `test-workspace/.omp/plugins`，否则默认 `PI_CONFIG_DIR=.omp` 时，项目侧旧拷贝会 shadow 用户根里的 npm 包。本轮不执行这一步。
