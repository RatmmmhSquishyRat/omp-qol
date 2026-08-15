# Design: omp-qol 官方分发面（2026-08-15 重做）

**date**: 2026-08-15
**route**: A（`docs/plans/routes/plugin-distribution-clarification-report.md`）
**guide**: `docs/plans/guides/plugin-distribution-implementor-guide.md`
**supersedes**: 同日第一版（Route B / 仓内 catalog）

## 要改什么

在不移动 `plugin/`、不改工具行为、不碰生产 `WATCHDOG.yml` 的前提下，把默认用户路径改到宿主给第三方的 npm 通道：

1. 删除 `.omp-plugin/marketplace.json`
2. `plugin/package.json` 补齐 `publishConfig`，保持 `omp.extensions` / `files` / `repository`
3. README：头条 `omp plugin install omp-qol-plugin`；sandbox 标成 in-repo
4. GitHub Actions：push/PR 测试不变；tag 上增加 npm publish 作业（本轮不执行真实 publish）
5. 元数据检查不再对账 catalog
6. 保留 `.sandbox/install-plugin.ts` 为开发/验收路径

## 不改什么

- advisor / goal / mode 工具代码
- test-workspace 是否拥有自己的 `.git`
- 根 `WATCHDOG.yml`
- L6 e2e 进入默认 CI
- 包名 `omp-qol-plugin`、版本 `0.3.0`（直到有意 bump）

## 名字

| 面 | 值 | 谁读 |
| --- | --- | --- |
| npm / 运行时 / settings | `omp-qol-plugin` | `PluginManager`、`omp plugin config`、`node_modules` |
| git tag | `v<version>` | Release 工作流 |

不再维护市场 ID `omp-qol@omp-qol`。

## 开发约束 vs 用户安装

仓内验收仍不得写作者 `~/.omp`。官方用户安装写**该用户**的 `~/.omp/plugins`。这是宿主对 npm 插件的设计，不是项目 scope。

## 剩余人工步骤

paste `NPM_TOKEN` / 配置 npm trusted publisher，然后打 `v0.3.0`（或下一个版本）tag。本设计不把「今天不能 publish」写成通道问题。
