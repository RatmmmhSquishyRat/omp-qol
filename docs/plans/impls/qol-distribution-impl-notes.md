# QOL distribution implementation notes（2026-08-15 重做）

**date**: 2026-08-15
**route**: A — npm 默认（`omp plugin install omp-qol-plugin`）
**supersedes**: 同日第一版 Route B notes

## What landed

- 删除 `.omp-plugin/marketplace.json`。不维护仓内 catalog。
- `plugin/package.json` 增加 `publishConfig.access=public` 与 `registry=https://registry.npmjs.org/`。包名保持 `omp-qol-plugin@0.3.0`。
- 根 README 与 `plugin/README.md` 头条改为 `omp plugin install omp-qol-plugin`。sandbox 安装器仍标 in-repo。
- `.github/workflows/release.yml`：tag `v*` 上 verify → `npm-publish`（`id-token: write` + `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`）与独立的 GitHub Release。
- `.sandbox/check-distribution-metadata.ts` 只对账 package + 可选 tag；若 catalog 文件还在则失败。
- CI push/PR 作业未改测试范围：`bun test` + plugin-only typecheck + 元数据检查。

## Verification

| Check | Result |
| --- | --- |
| `cd plugin && bun test` | 118 pass, 597 expect, 0 fail |
| `cd plugin && bun run typecheck` | exit 0 |
| `bun .sandbox/check-distribution-metadata.ts` | PASS `omp-qol-plugin@0.3.0` |
| CI/Release YAML | `python` PyYAML 解析 OK |
| `npm view omp-qol-plugin` | 404（名字可用；未 publish） |
| 隔离官方 install | PASS（见下） |
| npm publish | 本轮未跑 |

### Isolated official install (2026-08-15)

Scratch HOME: `C:\Users\15480\AppData\Local\Temp\omp-qol-dist-verify-20260815-182657`（`USERPROFILE` + `HOME`）。本机 `omp/17.3.4`。

1. `npm pack` → `omp-qol-plugin-0.3.0.tgz`（10 files：`src/**/*.ts`、`package.json`、`README.md`、`LICENSE`；无 `test/`）。
2. `omp plugin install omp-qol-plugin --scope project --dry-run` → stderr `Warning: --scope is only supported for marketplace installs (name@marketplace). Ignoring for omp-qol-plugin.`；stdout `[dry-run] Would install omp-qol-plugin`。
3. `omp plugin install omp-qol-plugin@file:<tgz> --scope project` → 同一句 Ignoring 警告，然后 `Installed omp-qol-plugin@0.3.0`。
4. `omp plugin list --json` → `npm[0].name=omp-qol-plugin`，`version=0.3.0`，`path=...\.omp\plugins\node_modules\omp-qol-plugin`，`marketplace=[]`。没有 `(project)`。
5. scratch `plugins/package.json` 的 dependency 是 `file:<tgz>`。作者 `C:\Users\15480\.omp\plugins\package.json` 仍然不存在。仓库根没有出现 `.omp/plugins`。
6. scratch 目录已删。未 npm publish。

## Remaining human step

paste `NPM_TOKEN` / 配置 npm trusted publisher，然后打 `v0.3.0`（或下一个版本）tag。

## Host-doc vs code tensions (carried)

- 现场 `omp plugin --help` 把 `--scope` 写成通用 flag；`handleInstall` 对 npm 忽略它。
- `printPluginHelp()` 写明 scope 仅市场，但 17.3.4 没有调用点。
- 市场 catalog 的 npm source 文档与代码都说尚未支持。
