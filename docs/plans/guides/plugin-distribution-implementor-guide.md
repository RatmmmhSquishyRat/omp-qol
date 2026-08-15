# Implementation Guide: omp-qol npm 默认分发

**date**: 2026-08-15
**clarification report**: `docs/plans/routes/plugin-distribution-clarification-report.md`

## 1. Route Lock Summary

- Clarification report reference: 上记重做报告
- Selected route: A — 用户头条 `omp plugin install omp-qol-plugin`；`plugin/` 发到 npm
- Locked stack and versions: omp 17.3.4 安装行为；Bun 加载 `./src/main.ts`；GitHub Actions bun 1.3；`npm publish` 在 `v*` tag
- Accepted tradeoffs: `--scope project` 对 npm 无效；删除 `.omp-plugin/marketplace.json`；第一次发布走 tag `v0.3.1`
- Deferred risks: packed tarball 的扩展校验须实测；trusted publisher 可后配，`NPM_TOKEN` 走仓库密钥

## 2. Project Constraints Snapshot

- Repository shape: monorepo。可发布单元是 `plugin/`。根上没有 package.json。
- Runtime and deployment constraints: 密封 omp 二进制用 Bun import 缓存里的 TS。不要自建编译步。
- Compliance and security constraints: 不提交 token；不改根 `WATCHDOG.yml`；不 `git init` test-workspace；不杀非本进程 omp。
- Performance and reliability constraints: 默认 CI 只跑插件测试与插件-only tsc。L6 真模型 e2e 不进默认 CI。
- Team constraints: Windows PowerShell。多行 commit 用临时文件 + `git commit -F`。

## 3. Technology Instruction Cards

### npm 包（`plugin/package.json`）

- Intro: 这是宿主 `PluginManager.install` 认的身份。`omp plugin list` / `config` / `uninstall` 都用 `name`。
- Implementation instruction:
  - Setup sequence: 保持 `name: omp-qol-plugin`；补 `publishConfig`；`files` 含 `src`、`README.md`、`LICENSE`
  - Required patterns: `omp.extensions: ["./src/main.ts"]`；`omp.settings` 与现网一致
  - Forbidden patterns: 不要改成 scoped 名，除非 `omp-qol-plugin` 被抢且有证据；不要把 `private: true` 写进将发布的包
- Key configurations:
  - Mandatory settings: `name`、`version`、`license`、`repository.directory: plugin`、`omp.extensions`
  - Recommended defaults: `publishConfig.access: public`；`publishConfig.registry: https://registry.npmjs.org/`
- Project-specific non-trivial example:
```json
{
  "name": "omp-qol-plugin",
  "version": "0.3.1",
  "files": ["src", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "omp": {
    "extensions": ["./src/main.ts"]
  }
}
```
- Pitfalls and diagnostics:
  - Symptom: `omp plugin config` 报 Plugin not found
  - Root cause: 用户装的是旧市场 ID，`PluginManager.list` 跳过市场 symlink
  - Fix: 改用 `omp plugin install omp-qol-plugin`，或卸载 `omp-qol@omp-qol`
- Verification:
  - Command or test: `npm pack` 在 `plugin/`；tarball 内含 `src/main.ts`，不含 `test/`
  - Expected result: pack 成功；`npm view omp-qol-plugin` 在 publish 前仍 404
- Escalation triggers:
  - `npm publish` 报 403 / 409
  - 宿主不再用 `bun install` 装 npm 插件
- Official verification links (when escalated):
  - https://docs.npmjs.com/cli/v11/commands/npm-publish （查 publishConfig / trusted publisher）
  - https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md
- Query methods (when escalated):
  - `npm publish trusted publisher GitHub Actions`
  - `oh-my-pi PluginManager.install bun install`
- Sources:
  - `ref_repos/oh-my-pi/packages/coding-agent/src/extensibility/plugins/manager.ts` 2026-08-15
  - `npm view omp-qol-plugin` 404 2026-08-15

### omp PluginManager / CLI

- Intro: 用户命令的运行时。分类器决定 npm vs 市场 vs 本地。
- Implementation instruction:
  - Setup sequence: README 只写 npm 头条；可选写 `omp install omp-qol-plugin`
  - Required patterns: 升级写成 `omp plugin install omp-qol-plugin@<version>`
  - Forbidden patterns: 不要把 `marketplace add` 写成默认；不要宣称 `omp plugin install <npm> --scope project` 会写项目目录
- Key configurations:
  - Mandatory settings: 无仓库内配置。隔离验证须改 `USERPROFILE`/`HOME`，不要只改 `PI_CONFIG_DIR`（那是目录名，默认 `.omp`）
  - Recommended defaults: 验证用 scratch HOME
- Project-specific non-trivial example:
```powershell
$scratch = Join-Path $env:TEMP "omp-qol-install-scratch"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$env:USERPROFILE = $scratch
$env:HOME = $scratch
omp plugin install omp-qol-plugin --scope project --dry-run
```
- Pitfalls and diagnostics:
  - Symptom: dry-run 之后作者 `~/.omp/plugins/package.json` 多了骨架
  - Root cause: `install` 在 dry-run 前仍调用 `#ensurePackageJson()`（`manager.ts:425-436`）
  - Fix: 验证必须隔离 homedir
- Verification:
  - Command or test: 上记 dry-run
  - Expected result: stderr 有 `Warning: --scope is only supported for marketplace installs`；stdout 有 Would install / Installed
- Escalation triggers:
  - 警告文案消失或 `--scope` 开始写入项目根
- Official verification links (when escalated):
  - `docs/plugin-manager-installer-plumbing.md`
  - `docs/marketplace.md`
- Query methods (when escalated):
  - `oh-my-pi --scope only supported for marketplace installs`
- Sources:
  - `plugin-cli.ts:429-440` 2026-08-15
  - 本机 `omp/17.3.4` `omp plugin --help`

### GitHub Actions（CI + Release）

- Intro: push/PR 验证插件；tag 发布 npm 并切 GitHub Release。
- Implementation instruction:
  - Setup sequence: 保留 `ci.yml` 的 plugin job；`release.yml` 增加 `npm-publish` job
  - Required patterns: working-directory `plugin`；`bun run typecheck` 用 `tsconfig.plugin.json`；publish 用 `setup-node` 的 `registry-url` + `NODE_AUTH_TOKEN`
  - Forbidden patterns: 不要在 push 上 publish；不要把 L6 / 真模型测试放进默认 CI；不要为了绿而跳过 `bun test`
- Key configurations:
  - Mandatory settings: `secrets.NPM_TOKEN` 或 npm trusted publisher；`permissions.id-token: write`
  - Recommended defaults: bun-version `1.3`，与现网 CI 一致
- Project-specific non-trivial example: 见 §7 Recipe 2
- Pitfalls and diagnostics:
  - Symptom: tag 推上去之后 publish job 红
  - Root cause: 密钥名不是 `NPM_TOKEN`，或 tag 与 `package.json` version 不一致
  - Fix: 对照 `docs/researches/github-actions-npm-publish-default-2026.md`，不要改回市场通道
- Verification:
  - Command or test: 用 GitHub 的 workflow 语法检查，或至少 YAML 可解析 + 本地复现 `bun test` / `typecheck`
  - Expected result: CI job 与本地同构命令绿
- Escalation triggers:
  - npm 报 OIDC 与 token 都不被接受
- Official verification links (when escalated):
  - https://docs.npmjs.com/trusted-publishers
  - 宿主 `.github/workflows/ci.yml` `release_native_leaves`（OIDC + `NODE_AUTH_TOKEN` 回退）
- Query methods (when escalated):
  - `npm trusted publishers GitHub Actions id-token`
- Sources:
  - 宿主 `ci.yml` 约 670–713 行 2026-08-15

### 仓内 marketplace catalog（删除）

- Intro: 上一轮主通道。本路线不维护。
- Implementation instruction:
  - Setup sequence: 删除 `.omp-plugin/marketplace.json`；元数据检查不再读它
  - Required patterns: 研究文保留「市场是 catalog 作者用的」说明
  - Forbidden patterns: 不要再把 `marketplace add RatmmmhSquishyRat/omp-qol` 写进 README 头条；不要投稿社区市场
- Key configurations: 无
- Project-specific non-trivial example: 无（删除）
- Pitfalls and diagnostics:
  - Symptom: 旧用户仍执行上一轮 README
  - Root cause: origin 上还曾推过 catalog
  - Fix: 新 README 覆盖；需要时卸载 `omp-qol@omp-qol`
- Verification:
  - Command or test: 仓库根不再有 `.omp-plugin/marketplace.json`
  - Expected result: git 不再跟踪该文件
- Escalation triggers: 宿主把 npm 从 `omp plugin install` 里拿掉（当前没有这种信号）
- Official verification links (when escalated): `docs/skills/authoring-marketplaces.md`
- Query methods (when escalated): `oh-my-pi authoring marketplaces vs authoring extensions`
- Sources: 作者第二条澄清 2026-08-15；重做调研 §D

## 4. Module Blueprint

### plugin 包

- Responsibility: 可发布的 omp 插件
- Owner: 本仓
- Location: `plugin/`
- Public interfaces: `package.json#name`、`omp.extensions`、`omp.settings`
- Schema ownership: settings schema 在 `package.json`
- In scope: 源码、测试、LICENSE、README 安装段
- Out of scope: 隔离官方安装包装器（`.sandbox/install-plugin.ts`）
- Allowed dependencies: peer `@oh-my-pi/pi-coding-agent`；dev bun/typescript/zod
- Forbidden dependencies: 不要把宿主 `ref_repos` 写进 published `dependencies`

### CI / Release

- Responsibility: 验证与发布
- Owner: 本仓 `.github/workflows/`
- Location: `ci.yml`、`release.yml`
- Public interfaces: GitHub Actions 作业名；npm 包
- Schema ownership: tag `v<plugin.version>`
- In scope: bun test、plugin tsc、npm publish、GitHub Release
- Out of scope: L6、对 `ref_repos` 的 tsc
- Allowed dependencies: checkout / setup-bun / setup-node
- Forbidden dependencies: 向默认 CI 注入需要付费模型密钥的步骤

### 用户文档

- Responsibility: 陌生人能复制的命令
- Owner: 根 `README.md`、`plugin/README.md`
- Location: 仓库根与 `plugin/`
- Public interfaces: 安装 / 升级 / 卸载 / config
- Schema ownership: 命令字符串必须与宿主 17.3.4 一致
- In scope: npm 头条；sandbox 标明 in-repo
- Out of scope: 社区市场投稿说明
- Allowed dependencies: 指向重做调研
- Forbidden dependencies: 把 sandbox 写成用户安装

### 元数据检查脚本

- Responsibility: 包字段与 tag 对齐
- Owner: `.sandbox/check-distribution-metadata.ts`
- Location: `.sandbox/`
- Public interfaces: 无参检查；`--tag vX.Y.Z`
- Schema ownership: 包名、license、repository、extensions、files、publishConfig
- In scope: `plugin/package.json`
- Out of scope: marketplace catalog
- Allowed dependencies: 只读 JSON
- Forbidden dependencies: 网络 publish

## 5. Coupling Contract Matrix

| Source -> Target | Coupling type | Allowed path | Forbidden path | Failure behavior | Versioning policy |
| --- | --- | --- | --- | --- | --- |
| README -> 宿主 CLI | API | `omp plugin install omp-qol-plugin` | `marketplace add` 当头条 | 命令失败即文档错 | 随 17.3.4 行为，宿主改分类器再改文档 |
| plugin/package.json -> PluginManager | schema | `name` + `omp.extensions` | 根 package.json 冒充插件 | 装得上但加载跳过，或校验失败回滚 | semver；tag `v` + version |
| release.yml -> npm | API | tag job + `NPM_TOKEN` / OIDC | push 自动 publish | job 红；GitHub Release 等 npm 成功 | 同一 version 不可重复 publish |
| sandbox installer -> 用户 README | none | 隔离根上跑同一条官方命令 | 无隔离写入 `~/.omp` / test-workspace | 验收污染 live 根 | 不随 npm version 改机制 |
| 已删除 catalog -> 宿主 MarketplaceManager | none | 不提交 | 再加回当默认通道 | 无 | n/a |

## 6. Key Config Atlas

| Area | File path | Key | Required value/pattern | Rationale | Risk if wrong |
| --- | --- | --- | --- | --- | --- |
| 包名 | `plugin/package.json` | `name` | `omp-qol-plugin` | list/config/uninstall | 用户命令对不上 |
| 入口 | 同上 | `omp.extensions` | `["./src/main.ts"]` | 密封二进制 Bun import | 安装校验失败 |
| 发布文件 | 同上 | `files` | 含 `src` | 用户拿到源码入口 | pack 后缺入口 |
| 注册表 | 同上 | `publishConfig.registry` | `https://registry.npmjs.org/` | 避免发到错误 registry | publish 发错地方 |
| 仓库指针 | 同上 | `repository.directory` | `plugin` | npm 页链到子目录 | 源码链接进根 |
| CI typecheck | `plugin/package.json` scripts | `typecheck` | `tsc --noEmit -p tsconfig.plugin.json` | 避开宿主 `.md` import | CI 被 ref_repos 噪声打死 |
| Release tag | `.github/workflows/release.yml` | `on.push.tags` | `v*` | 与 version 对账 | 错 tag 发错版本 |
| 元数据 | `.sandbox/check-distribution-metadata.ts` | `--tag` | `v${version}` | 防止 tag 与包不一致 | 发错版本 |

## 7. Implementation Recipes

### Recipe 1: 把 package.json 收成可 publish

- Preconditions: 现有 `plugin/package.json` 已有 name/version/omp
- Steps:
  1. 加入 `publishConfig`
  2. 确认 `files` 含 `src`、`README.md`、`LICENSE`
  3. 不要改 `omp.extensions`
- Key code snippet: 见 §3 npm 卡
- Validation checks: `bun .sandbox/check-distribution-metadata.ts`；`cd plugin && npm pack --dry-run`
- Common failure and fix: 漏 LICENSE → pack 警告；把 `plugin/LICENSE` 留在 files 里

### Recipe 2: tag 上的 npm publish 作业

- Preconditions: `ci.yml` 已能跑 plugin 测试
- Steps:
  1. `release.yml` 拆 verify / npm-publish / github-release
  2. npm-publish：`id-token: write` + `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` + `--provenance --access public`
  3. github-release `needs: [verify, npm-publish]`（用户安装是 npm，Release 不能单独成功）
- Key code snippet:
```yaml
npm-publish:
  needs: verify
  permissions:
    id-token: write
    contents: read
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: "24"
        registry-url: https://registry.npmjs.org
    - working-directory: plugin
      env:
        NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      run: npm publish --provenance --access public
```
- Validation checks: YAML 可解析；作业存在于 tag 工作流
- Common failure and fix: tag 必须是 `v${version}` 且打在带 workflow 的提交上。不要 force-move `v0.3.0`

### Recipe 3: 隔离根证明 `--scope` 对 npm 的真实行为

- Preconditions: 本机 `omp` 17.3.4；不要动作者 `~/.omp`
- Steps:
  1. 新建 scratch 目录，设置 `USERPROFILE` 与 `HOME`
  2. `omp plugin install omp-qol-plugin --scope project --dry-run`
  3. 记录警告
  4. 若要装本包：`npm pack` 后用官方 npm spec 安装（见验证节），再 `omp plugin list`
  5. 确认 scratch 外的 `~/.omp` 没有新文件
- Key code snippet:
```powershell
omp plugin install omp-qol-plugin --scope project --dry-run
```
- Validation checks: 警告文本含 `Ignoring`；list 若真装则出现 `omp-qol-plugin@` 且无 `(project)`
- Common failure and fix: 只设 `PI_CONFIG_DIR` 仍会写到 `%USERPROFILE%\<name>\plugins`

## 8. Pitfall Catalog

| Pitfall | Trigger | Symptom | Root cause | Fix | Prevention |
| --- | --- | --- | --- | --- | --- |
| 用 token 缺失否决 npm | 选路 | 又回到 marketplace | 把密钥当成通道条件 | 作业留下，等作者粘贴 | 支柱第二条 |
| 把 `--scope` 写成 npm 能力 | README | 用户以为项目目录会有插件 | oclif 帮助没写「仅市场」 | 以 `plugin-cli.ts:429-436` 为准 | 头条不写 `--scope` |
| 验证污染 `~/.omp` | dry-run / install | 作者用户根多出 package.json | dry-run 仍 `#ensurePackageJson` | 隔离 HOME | 验证清单写明 |
| 市场安装后 config 失败 | 旧用户 | Plugin not found | `list()` 跳过市场 symlink | 改走 npm 安装 | 删除 catalog |
| CI 跑宿主 tsc | 改 typecheck 脚本 | 大量 `.md` import 错 | `tsconfig` 含 ref_repos | 只用 `tsconfig.plugin.json` | ci.yml 跑 `bun run typecheck` |
| git URL 当头条 | 想绕过 npm | `Invalid package name` 或装整仓 | 根上无 package.json | 不走 C | 布局保持 `plugin/` |

## 9. Implementor Cheat Sheets

### Command Cheat Sheet

| Task | Command | Expected signal |
| --- | --- | --- |
| 用户安装 | `omp plugin install omp-qol-plugin` | `Installed omp-qol-plugin@<ver>` |
| 顶层别名 | `omp install omp-qol-plugin` | 同上 |
| 升级 | `omp plugin install omp-qol-plugin@<ver>` | 新 version |
| 卸载 | `omp plugin uninstall omp-qol-plugin` | Uninstalled |
| 设置 | `omp plugin config set omp-qol-plugin greeting "..."` | Set greeting |
| 列表 | `omp plugin list` | `omp-qol-plugin@<ver>` 在 npm Plugins 段 |
| 插件测试 | `cd plugin && bun test` | 118+ pass |
| 插件 tsc | `cd plugin && bun run typecheck` | exit 0 |
| 元数据 | `bun .sandbox/check-distribution-metadata.ts` | PASS |
| 测试/验收安装 | `bun .sandbox/install-plugin.ts --isolated-root .omp-qol-<id>` | 隔离根执行 `omp plugin install omp-qol-plugin` |
| 未发布本地树 | 同上加 `--from-source` | `omp plugin install <repo>/plugin`（opt-in） |

### File Placement Cheat Sheet

| Artifact type | Allowed location | Forbidden location |
| --- | --- | --- |
| 可发布插件 | `plugin/` | 仓库根冒充包 |
| npm 工作流 | `.github/workflows/release.yml` | push 工作流里 publish |
| 用户安装说明 | 根 README 与 `plugin/README.md` 顶部 | 只写在 journal |
| marketplace catalog | 不提交 | `.omp-plugin/marketplace.json` 当默认通道 |
| 隔离官方安装器 | `.sandbox/install-plugin.ts` | 用户 Quick start；无隔离参数的旧拷贝器 |
| 支柱原文 | `docs/ssot/pillars/distribution-delivery/` | 改写用户原话 |

## 10. Task Packages and Acceptance Gates

| Task ID | Objective | Modules | Key actions | Definition of Done | Required tests |
| --- | --- | --- | --- | --- | --- |
| T1 | 包可 publish | plugin 包 | 加 publishConfig；元数据脚本去 catalog | 检查脚本绿；`npm pack` 含 src | check-distribution-metadata |
| T2 | 去掉无必要市场 | catalog | 删 `.omp-plugin/marketplace.json` | 文件不在 git | 搜索不到头条依赖 |
| T3 | README 头条 | 用户文档 | 改成 npm 命令；sandbox 标开发 | 根与 plugin README 一致 | 人工对照 |
| T4 | CI 保持 | CI | 不跑宿主 tsc；不跑 L6 | push/PR 仍测 plugin | `bun test` / typecheck |
| T5 | tag publish 作业 | Release | verify → npm-publish → github-release；tag `v0.3.1` | Actions Release 绿；npm 有 `0.3.1` | 不本机 `npm publish` |
| T6 | 官方路径取证 | 验证 | 隔离 HOME；dry-run scope；能则 pack+install | 警告与 list 证据写入 impl-notes | 不碰 `~/.omp` |

## 11. Sources and Confidence

| Claim area | Source type | URL | Accessed at | Query used (if escalated) | Confidence |
| --- | --- | --- | --- | --- | --- |
| npm 分类 | Primary code | `classify-install-target.ts:55-76` | 2026-08-15 | | H |
| scope 忽略 | Primary code | `plugin-cli.ts:429-440` | 2026-08-15 | | H |
| 用户根路径 | Primary code | `dirs.ts:521-535` | 2026-08-15 | | H |
| TS 入口 | Official docs | `docs/skills/authoring-extensions.md` | 2026-08-15 | `oh-my-pi omp.extensions ts` | H |
| 第三方 npm 头条 | Community | omp-notify-tool / omp-mode-switch | 2026-08-15 | `omp plugin install npm third party` | H |
| trusted publisher | Official docs | 宿主 `ci.yml` + npm trusted publishers | 2026-08-15 | `npm trusted publishers GitHub Actions` | M |
| 现场 help 与代码不一致 | Live CLI | `omp plugin --help` 17.3.4 | 2026-08-15 | | H |
