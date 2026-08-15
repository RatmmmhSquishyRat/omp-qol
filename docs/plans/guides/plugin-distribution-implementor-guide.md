# Implementation Guide: 仓内 marketplace 分发（Route B）

**date**: 2026-08-15
**clarification report**: `docs/plans/routes/plugin-distribution-clarification-report.md`

## 1. Route Lock Summary

- Clarification report reference: `docs/plans/routes/plugin-distribution-clarification-report.md`
- Selected route: B — 仓库根 `.omp-plugin/marketplace.json`，插件 `source: "./plugin"`
- Locked stack and versions:
  - 宿主行为按 omp 17.3.4
  - 市场名 `omp-qol`，目录插件名 `omp-qol`，包名 `omp-qol-plugin`
  - 当前版本 `0.3.0`（与现有 package.json 对齐，本轮不无故 bump）
  - GitHub：`RatmmmhSquishyRat/omp-qol`（public）
- Accepted tradeoffs: 用户两条命令（add + install）；catalog version 双写；npm 不作为已发布通道
- Deferred risks: GitHub Actions 首次跑宿主源码链接；隔离根下的官方 install 验证

## 2. Project Constraints Snapshot

- Repository shape: 单 git 根；插件在 `plugin/`；验收在 `test-workspace/`；研究/支柱在 `docs/`
- Runtime and deployment constraints: 扩展入口保持 TS；密封二进制用 Bun 加载缓存副本。不要把根变成插件包。
- Compliance and security constraints: 不提交 token；不改根 `WATCHDOG.yml`；不杀外来 omp；不 `git init` test-workspace
- Performance and reliability constraints: 默认 CI 必须便宜、无模型密钥
- Team constraints: Windows 开发机；CI 用 ubuntu-latest + Bun 1.3

## 3. Technology Instruction Cards

### Marketplace catalog（`.omp-plugin/marketplace.json`）

- Intro: 宿主发现第三方插件的目录文件。用户 `marketplace add` 之后，`install name@marketplace` 才成立。
- Implementation instruction:
  - Setup sequence: 在仓库根建 `.omp-plugin/marketplace.json`（优先于 `.claude-plugin/`）
  - Required patterns: `name`、`owner.name`、`plugins[]` 含 `name` + `source` + `version`
  - Forbidden patterns: 市场 npm source；相对路径不带 `./`；把 source 指到仓库根
- Key configurations:
  - Mandatory: `"source": "./plugin"`；`version` 与 `plugin/package.json` 相同
  - Recommended: `homepage` / `repository` / `license` / `category`
- Project-specific non-trivial example:

```json
{
  "name": "omp-qol",
  "owner": { "name": "RatmmmhSquishyRat" },
  "metadata": {
    "description": "Quality-of-life plugins for omp",
    "version": "1"
  },
  "plugins": [
    {
      "name": "omp-qol",
      "description": "Agent goal, plan/vibe mode, and advisor tools",
      "version": "0.3.0",
      "source": "./plugin",
      "homepage": "https://github.com/RatmmmhSquishyRat/omp-qol",
      "repository": "https://github.com/RatmmmhSquishyRat/omp-qol",
      "license": "MIT",
      "category": "productivity"
    }
  ]
}
```

- Pitfalls and diagnostics:
  - Symptom: `Relative plugin source paths must start with "./"`
  - Root cause: source 写成 `plugin` 或 `/plugin`
  - Fix: 用 `./plugin`
- Verification:
  - Command: 隔离 `PI_CONFIG_DIR` 下 `omp plugin marketplace add <repo>` 然后 `omp plugin install omp-qol@omp-qol`
  - Expected: list 出现 `omp-qol@omp-qol`，缓存目录是 `plugin/` 的拷贝（有 `src/main.ts`）
- Escalation triggers: catalog 被拒、相对路径在 URL 市场里失败
- Official verification links:
  - https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md （2026-08-15）
  - https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-marketplaces.md （2026-08-15）
- Query methods:
  - `oh-my-pi marketplace.json .omp-plugin authoring`
  - `site:github.com/can1357/oh-my-pi npm plugin sources are not yet supported`
- Sources: 同上 + `source-resolver.ts`

### `plugin/package.json` 元数据

- Intro: 运行时包名、版本、扩展入口、设置 schema。市场 ID 不替代这些字段。
- Implementation instruction:
  - Setup sequence: 补 `repository`、`homepage`、`bugs`、`files`、`peerDependencies`
  - Required patterns: `omp.extensions: ["./src/main.ts"]`；`license: MIT` 且仓库有 LICENSE
  - Forbidden patterns: 把 `name` 改成与市场 ID 强行同一而打断已装的 `omp-qol-plugin` lockfile
- Key configurations:
  - Mandatory: `name=omp-qol-plugin`，`version` 与 catalog 对账
  - Recommended: `files: ["src", "README.md", "LICENSE"]`（给未来 npm pack；市场拷贝不读这个字段）
- Project-specific non-trivial example: 见实现后的 `plugin/package.json`
- Pitfalls and diagnostics:
  - Symptom: `omp plugin config set omp-qol ...` 找不到包
  - Root cause: config 用的是 package name，不是 `omp-qol@omp-qol`
  - Fix: `omp plugin config set omp-qol-plugin <key> <value>`
- Verification: `node`/`bun` 读 JSON，断言字段存在；CI 对账脚本
- Escalation triggers: 宿主开始强制新必填字段
- Official verification links: `docs/skills/authoring-extensions.md` package.json 段（2026-08-15）
- Query methods: `oh-my-pi package.json omp.extensions`
- Sources: `types.ts` PluginManifest

### GitHub Actions

- Intro: push/PR 验证；tag 只做 Release 说明，不自动 npm publish
- Implementation instruction:
  - Setup sequence: `.github/workflows/ci.yml` + `release.yml`
  - Required patterns: `plugin/` 下 `bun test`；`tsc -p tsconfig.plugin.json`；lockfile 钉住 `@oh-my-pi/pi-coding-agent@17.3.4` 供集成测试
  - Forbidden patterns: 默认工作流跑 L6；push 自动 `npm publish`；把 `NPM_TOKEN` 写进仓库
- Key configurations:
  - Mandatory: `permissions.contents: read`（CI）；Release 工作流才 `contents: write`
  - Recommended: bun 1.3；frozen lockfile
- Project-specific non-trivial example: 见 `.github/workflows/ci.yml`
- Pitfalls and diagnostics:
  - Symptom: typecheck 报一堆 `.md` 模块
  - Root cause: tsc 顺着 ref_repos / 宿主源码 import
  - Fix: `tsconfig.plugin.json` 用本地 host stub，只 include `src`
- Verification: 本地复现 CI 脚本；若有 `actionlint` 则跑它
- Escalation triggers: bun 版本或宿主 tag 不存在
- Official verification links: 宿主 `ci.yml`（对照「测试与发布分开」）；omp-headroom ci.yml（2026-08-15）
- Query methods: `oh-my-pi github actions skip_npm`；`omp-headroom ci.yml bun test`
- Sources: github-master skill（验证门与依赖刷新）

### 隔离 `PI_CONFIG_DIR` 验证

- Intro: `PI_CONFIG_DIR` 是相对 home 的配置根名字，默认 `.omp`。改成 `.omp-qol-dist-verify-*` 就不会写作者 `~/.omp`。
- Implementation instruction:
  - Setup sequence: 设环境变量 → marketplace add 本仓路径或 GitHub shorthand → install → list → 删隔离根
  - Required patterns: 验证目录用 scratch；不要用 test-workspace 做 project-scope 写入
  - Forbidden patterns: 验证时 `git init` test-workspace；验证后留下隔离根不管
- Key configurations:
  - Mandatory: `PI_CONFIG_DIR=.omp-qol-dist-verify-<ts>`
  - Recommended: project-scope 验证另开带 `.git` 的 scratch 目录
- Project-specific non-trivial example:

```powershell
$env:PI_CONFIG_DIR = ".omp-qol-dist-verify"
omp plugin marketplace add C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol
omp plugin install omp-qol@omp-qol
omp plugin list
```

- Pitfalls and diagnostics:
  - Symptom: 装进了 `~/.omp`
  - Root cause: 忘记设 `PI_CONFIG_DIR`，或 DirResolver 已在进程里冻过
  - Fix: 新开进程；先设环境变量
- Verification: 隔离根下出现 `plugins/installed_plugins.json`；`~/.omp/marketplaces.json` 无本市场新条目
- Escalation triggers: XDG 变量把路径拐走（本机 Windows 默认不走 XDG）
- Official verification links: `packages/utils/src/dirs.ts` `getConfigDirName` / `getPluginsDir`（2026-08-15）
- Query methods: `PI_CONFIG_DIR getPluginsDir oh-my-pi`
- Sources: `dirs.ts:205-207`、`531-536`

## 4. Module Blueprint

### Catalog

- Responsibility: 声明市场名与插件源
- Owner: 分发面
- Location: `.omp-plugin/marketplace.json`
- Public interfaces: 宿主 catalog schema
- Schema ownership: 宿主 MarketplaceCatalog
- In scope: 一条插件、相对 source、semver
- Out of scope: 多插件生态、Claude 双目录（非必须）
- Allowed dependencies: 无代码依赖
- Forbidden dependencies: 指向仓库根或 `test-workspace`

### Plugin package

- Responsibility: 运行时清单与入口
- Owner: `plugin/`
- Location: `plugin/package.json`、`plugin/src/`
- Public interfaces: `omp.extensions`、`omp.settings`、包名
- Schema ownership: 本插件 settings
- In scope: 元数据补全、LICENSE
- Out of scope: 改工具行为
- Allowed dependencies: 现有 zod devDep；peer `@oh-my-pi/pi-coding-agent`
- Forbidden dependencies: 把宿主 monorepo 写进 runtime dependencies

### Dev installer

- Responsibility: 本仓 test-workspace 验收
- Owner: `.sandbox/install-plugin.ts`
- Location: 不变
- Public interfaces: 开发者脚本
- In scope: 保持幂等拷贝
- Out of scope: 当作用户安装
- Allowed dependencies: 无
- Forbidden dependencies: 被 README 第一段引用为官方安装

### CI

- Responsibility: push/PR 门禁；tag Release
- Owner: `.github/workflows/`
- Location: `ci.yml`、`release.yml`
- Public interfaces: GitHub Checks
- In scope: bun test、插件 typecheck、version 对账
- Out of scope: L6、自动 npm
- Allowed dependencies: checkout oh-my-pi@v17.3.4
- Forbidden dependencies: 仓库密钥

## 5. Coupling Contract Matrix

| Source -> Target | Coupling type | Allowed path | Forbidden path | Failure behavior | Versioning policy |
| --- | --- | --- | --- | --- | --- |
| catalog -> plugin/ | schema | `source: "./plugin"` | 指到仓根 / docs | install 找不到目录 | catalog.version === package.version |
| README -> 宿主 CLI | API | marketplace add/install | 教用户跑 sandbox | 命令失败即文档错 | 随 17.3.4 行为 |
| CI -> plugin tests | API | `bun test` in plugin/ | 改断言迁就 CI | CI 红则修测试环境 | 不降断言 |
| sandbox installer -> test-workspace | filesystem | 项目侧四件套 | 写 ~/.omp | 开发者重跑脚本 | 与 package.version 同步 |
| 用户安装 -> ~/.omp 或项目 .omp | filesystem | 宿主官方 scope | 本仓生产 WATCHDOG.yml | 宿主报错 | 宿主 lockfile |

## 6. Key Config Atlas

| Area | File path | Key | Required value/pattern | Rationale | Risk if wrong |
| --- | --- | --- | --- | --- | --- |
| 市场名 | `.omp-plugin/marketplace.json` | `name` | `omp-qol` | 合法 name segment | add 后 ID 对不上 README |
| 插件目录名 | 同上 | `plugins[0].name` | `omp-qol` | 组成 `omp-qol@omp-qol` | install 找不到条目 |
| 源 | 同上 | `plugins[0].source` | `./plugin` | 只发布插件树 | 整仓或空目录 |
| 版本 | 同上 + `plugin/package.json` | `version` | 相同 semver | upgrade 比较 | 升级静默跳过 |
| 包名 | `plugin/package.json` | `name` | `omp-qol-plugin` | node_modules / config | 已有 lockfile 断裂 |
| 入口 | `plugin/package.json` | `omp.extensions` | `["./src/main.ts"]` | 宿主加载 | 装上但不注册工具 |
| CI typecheck | `plugin/tsconfig.plugin.json` | `include` | `["src"]` | 避开宿主 .md | CI 被 ref_repos 噪声打死 |
| 宿主 pin | `plugin/bun.lock` | `@oh-my-pi/pi-coding-agent` | `17.3.4` | 与本机 omp 对齐 | 测试 API 漂移 |

## 7. Implementation Recipes

### Recipe 1: 让陌生人能 marketplace install

- Preconditions: 仓 public；`plugin/package.json` 已有 `omp.extensions`
- Steps:
  1. 写 `.omp-plugin/marketplace.json`
  2. 补 LICENSE 与 package 元数据
  3. README 第一段改成 add + install
  4. sandbox 段改标 Dev / in-repo
- Key code snippet: 见 §3 catalog 例子
- Validation checks: 隔离根 install；`omp plugin list` 见 `omp-qol@omp-qol`
- Common failure and fix: add 本地路径时把 `plugin/node_modules` 拷进缓存 — git 安装无此问题；本地验证后删隔离根

### Recipe 2: 插件-only typecheck

- Preconditions: 现有 `tsconfig.json` 的 paths 指向仓外 `ref_repos`
- Steps:
  1. 新增 `plugin/types/host-ambient.d.ts` 声明本插件 src 用到的宿主模块
  2. 新增 `tsconfig.plugin.json`：include 仅 `src`，paths 指向 stub
  3. `package.json` 的 `typecheck` 改跑这份 config
- Key code snippet:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@oh-my-pi/pi-coding-agent": ["./types/host-ambient.d.ts"],
      "@oh-my-pi/pi-coding-agent/*": ["./types/host-ambient.d.ts"]
    }
  },
  "include": ["src"]
}
```

- Validation checks: `bun run typecheck` 退出 0；输出不含 `.md`
- Common failure and fix: stub 漏了 `getAgentDir` / `repo` — 按 `advisor-native.ts` 补

### Recipe 3: CI 跑 118 测试

- Preconditions: `plugin/package.json` 把 `@oh-my-pi/pi-coding-agent` 标成 peer；lockfile 已生成
- Steps:
  1. `cd plugin && bun install --frozen-lockfile`
  2. `bun run typecheck`
  3. `bun test`
  4. 仓库根 `bun .sandbox/check-distribution-metadata.ts`
- Key code snippet: CI 工作目录设为 `plugin`，不要在默认 job 里跑 L6
- Validation checks: 118 pass；typecheck 0；对账 PASS
- Common failure and fix: lockfile 未提交导致 frozen-lockfile 失败 — 提交 `plugin/bun.lock`

## 8. Pitfall Catalog

| Pitfall | Trigger | Symptom | Root cause | Fix | Prevention |
| --- | --- | --- | --- | --- | --- |
| 把 sandbox 当官方安装 | 沿用旧 README | 陌生人没有脚本 | 验收夹具被写成产品入口 | README 分段 | 指南 §4 禁止 |
| git URL 装整仓 | 想少一条命令 | bun 找不到根清单或装错树 | 根上无插件 package.json | 不要宣传 git URL | 路线报告已否决 C |
| --scope 以为对 link 有效 | 抄 CLI flag 文案 | 警告后仍进 ~/.omp | 代码忽略 scope | 只在市场 install 写 --scope | 调研 §9 |
| catalog 漏 version | 只改 package.json | upgrade 不更新 | 全量 upgrade 只看 catalog version | CI 对账 | check-distribution-metadata |
| test-workspace project install | 图省事 | 写到生产 WATCHDOG.yml | 无 .git，repo.root 上溯仓根 | 官方路径验证用 scratch git | 支柱安全约束 |
| typecheck 进宿主 .md | 用旧 tsconfig paths | 267+ 错 | Bun 专属 md import | tsconfig.plugin.json | CI 只跑 plugin config |

## 9. Implementor Cheat Sheets

### Command Cheat Sheet

| Task | Command | Expected signal |
| --- | --- | --- |
| 用户安装（user） | `omp plugin marketplace add RatmmmhSquishyRat/omp-qol` 然后 `omp plugin install omp-qol@omp-qol` | list 见 `omp-qol@omp-qol` |
| 用户安装（project） | 同上 install 加 `--scope project` | list 带 `(project)` |
| 升级 | `omp plugin marketplace update omp-qol` 然后 `omp plugin upgrade omp-qol@omp-qol` | 新 version |
| 卸载 | `omp plugin uninstall omp-qol@omp-qol` | 列表消失 |
| 设置 | `omp plugin config set omp-qol-plugin greeting hi` | config get 回显 |
| 开发重装 test-workspace | `bun .sandbox/install-plugin.ts` | `VERDICT: PASS` |
| 插件测试 | `cd plugin && bun test` | 118+ pass |
| 插件 typecheck | `cd plugin && bun run typecheck` | 0 errors |
| 元数据对账 | `bun .sandbox/check-distribution-metadata.ts` | PASS |

### File Placement Cheat Sheet

| Artifact type | Allowed location | Forbidden location |
| --- | --- | --- |
| marketplace catalog | `.omp-plugin/marketplace.json` | `plugin/.omp-plugin/`（宿主读仓根） |
| 插件源码 | `plugin/src/` | 仓根 |
| CI | `.github/workflows/` | 用户文档里贴 YAML 当安装步骤 |
| 开发安装器 | `.sandbox/install-plugin.ts` | README 第一段 |
| host stub | `plugin/types/host-ambient.d.ts` | 改宿主 ref_repos |
| vendor checkout | `.vendor/`（gitignore） | 提交 oh-my-pi 源码 |

## 10. Task Packages and Acceptance Gates

| Task ID | Objective | Modules | Key actions | Definition of Done | Required tests |
| --- | --- | --- | --- | --- | --- |
| T1 | catalog + 元数据 | Catalog, package | 写 marketplace.json、LICENSE、package 字段 | 对账脚本绿 | check-distribution-metadata |
| T2 | README 官方入口 | README | 用户命令置顶；sandbox 标 dev | 陌生人只看 README 能装 | 人工读 + 隔离 install |
| T3 | typecheck 去 .md 噪声 | tsconfig.plugin | stub + 改 npm script | `bun run typecheck` 0 | 本地跑 |
| T4 | CI | workflows, linker | push/PR 测试；tag Release 无 npm | YAML 合法；本地复现测试步 | bun test 118+ |
| T5 | 官方路径验证 | 隔离 PI_CONFIG_DIR | add + install + list | 证据写入 impl-notes；不碰 ~/.omp | 命令输出 |
| T6 | 文档协议 | session-001, journal phase-006 | 原文入 log；work+docs 提交 | 哈希回填 | 无 |

## 11. Sources and Confidence

| Claim area | Source type | URL | Accessed at | Query used (if escalated) | Confidence |
| --- | --- | --- | --- | --- | --- |
| catalog 路径与字段 | Official docs | https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md | 2026-08-15 | `oh-my-pi marketplace.json .omp-plugin` | H |
| 作者发布步骤 | Official docs | https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-marketplaces.md | 2026-08-15 | `authoring marketplaces publishing workflow` | H |
| --scope 仅市场 | Host code | `packages/coding-agent/src/cli/plugin-cli.ts` | 2026-08-15 | n/a | H |
| 第三方 README 主路径 | GitHub | https://github.com/DarkPhilosophy/omp-headroom | 2026-08-15 | `omp-headroom marketplace install` | H |
| PI_CONFIG_DIR 语义 | Host code | `packages/utils/src/dirs.ts` | 2026-08-15 | `PI_CONFIG_DIR getConfigDirName` | H |
