# Design: omp-qol 官方分发面

**date**: 2026-08-15
**route**: B（`docs/plans/routes/plugin-distribution-clarification-report.md`）
**guide**: `docs/plans/guides/plugin-distribution-implementor-guide.md`

## 要改什么

在不移动 `plugin/`、不改工具行为、不碰生产 `WATCHDOG.yml` 的前提下，补上宿主真正会读的分发面：

1. 仓库根 marketplace catalog
2. 插件包元数据与 LICENSE
3. README：官方安装在前，sandbox 标成 in-repo 开发路径
4. GitHub Actions：push/PR 测试 + tag Release（无自动 npm）
5. 插件-only typecheck，避开宿主 `.md` import
6. 保留 `.sandbox/install-plugin.ts`

## 不改什么

- advisor / goal / mode 工具代码
- test-workspace 是否拥有自己的 `.git`
- 根 `WATCHDOG.yml`
- L6 e2e 进入默认 CI

## 名字

| 面 | 值 | 谁读 |
| --- | --- | --- |
| 市场名 | `omp-qol` | `marketplace add` 之后的 catalog.name |
| 目录插件名 | `omp-qol` | `omp plugin install omp-qol@omp-qol` |
| npm/运行时包名 | `omp-qol-plugin` | `node_modules`、`omp plugin config`、sandbox 的 `PLUGIN_ID` 左段 |

两套名字并存是宿主模型，不是疏忽。README 两处都写清。

## 开发约束 vs 用户安装

旧 README「Never write to the global ~/.omp」继续约束**本仓库验收**：sandbox 安装器、verify-workspace、e2e 不得写作者 `~/.omp`。

官方用户安装（默认 user scope）会写**该用户**的配置根。这是宿主设计，也是其他用户能用起来的路径。project scope 写该用户当前项目的 `.omp/plugins/`。

验证官方路径时用 `PI_CONFIG_DIR=.omp-qol-dist-verify-*`，不要用 test-workspace 做 project-scope 写入。

## CI 形状

```text
push/PR → checkout 本仓
        → plugin bun install --frozen-lockfile
          （lockfile 含 peer @oh-my-pi/pi-coding-agent@17.3.4，供集成测试）
        → bun run typecheck（tsconfig.plugin.json，不走进宿主 .md）
        → bun test
        → bun .sandbox/check-distribution-metadata.ts

tag v*  → 校验 tag / package / catalog 版本
        → gh release create（GITHUB_TOKEN）
        → 不 npm publish
```

本地开发仍可用 `bun .sandbox/link-dev-deps.ts` 把 `plugin/node_modules/@oh-my-pi/*` 指回 `ref_repos` 源码。CI 不依赖那条路径。

## 剩余人工步骤（实现时若仍成立则照实写）

- 无 npm token：不发布 npm，README 不把 `omp plugin install omp-qol-plugin` 写成已可用
- 若要第二条 npm 通道：配置 trusted publisher 或 `NPM_TOKEN` 后再加工作流
- 不向第三方社区市场代为投稿
