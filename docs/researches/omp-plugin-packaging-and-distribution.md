# OMP 第三方插件：打包、安装、市场与发布（2026-08-15）

Date: 2026-08-15 · 宿主实测 `omp/17.3.4` · 源码对照 `ref_repos/oh-my-pi` · 访问日 2026-08-15

本文回答的问题：仓库外的用户今天要怎样安装一个第三方 omp 插件，以及 omp-qol 现有的 `.sandbox/install-plugin.ts` 和这条官方路径差在哪里。

## 1. 背景

仓库里已经有一份 `docs/researches/omp-project-scoped-plugins.md`。那份文档解决的是**本仓库开发/验收**：在不动作者 `~/.omp` 的前提下，把插件塞进 `test-workspace/.omp/plugins/`。它明确写过：`omp plugin install <本地路径> --scope project` 会被宿主忽略，所以验收只能手搭 MarketplaceManager 的项目侧产物。

那不是给陌生人的安装说明。当前根 README 的 Quick start 仍是 `bun .sandbox/install-plugin.ts`，仓库没有 npm publish、没有 GitHub Actions。支柱要求把「其他用户能正常使用」这一面补全。

## 2. 猜想

1. 2026 年宿主对第三方插件有一条官方 CLI，而不是「把文件拷进 `.omp`」。
2. 这条官方 CLI 同时认识 npm、git、本地路径、以及 `name@marketplace`，但 `--scope user|project` 只对市场安装生效。
3. 不存在一个我们能投稿的官方中央市场；用户自己 `marketplace add` 一个 Git 目录/仓库。
4. 市场目录里的 npm source 现在装不上。
5. 本仓库把插件放在 `plugin/` 子目录、根上没有 `package.json`，因此 `omp plugin install github:owner/repo` 这条 git/npm 路径对当前布局不成立。
6. 第三方插件 2026 年更常见的做法，是仓库自带 `.omp-plugin/marketplace.json`，用户先 add 再 install。

## 3. 官方终端用户安装命令

`omp plugin --help`（本机 17.3.4）列出的 action 是：

`install | uninstall | list | link | doctor | features | config | enable | disable | marketplace | discover | upgrade`

没有 `update` 这个子命令。

`printPluginHelp()` 把 install 的 source 写成四类（`plugin-cli.ts:965-970`）：

| Source | 例子 | 实际分发 |
| --- | --- | --- |
| npm 包名 | `pkg`、`pkg@1.2.3`、`@oh-my-pi/exa[search]` | `PluginManager.install` → 在用户插件根跑 `bun install` |
| git | `github:user/repo[#ref]`、`https://github.com/user/repo` | 同上，git spec 走 `validateGitSpec` |
| 市场 | `name@marketplace` | `MarketplaceManager.installPlugin`，`--scope` 生效 |
| 本地目录 | `./path`、`../path`、`/abs`、`~/path` | `PluginManager.link()`，与 `omp plugin link` 相同 |

分类器是 `classifyInstallTarget`（`classify-install-target.ts:55-76`），顺序固定：

0. 看起来像文件系统路径 → `local`
1. 以 `@` 开头 → 永远当 scoped npm
2. 中间有 `@`：右侧是已知市场名则走市场，否则当 npm 版本
3. 没有 `@` → npm

帮助文本里的 `--scope` 写的是「Install scope: user (default) or project」，但代码只在市场分支使用它。本地路径和 npm/git 都会打印：

`--scope is only supported for marketplace installs (name@marketplace). Ignoring for …`

证据：`plugin-cli.ts:390-395`（local）、`429-435`（npm/git）。这和 `omp-project-scoped-plugins.md` 的旧结论一致，2026-08-15 对照 17.3.4 源码仍成立。

因此，对陌生人可用的「一条命令」取决于我们选哪条通道：

- 市场：`omp plugin marketplace add <owner/repo>`，然后 `omp plugin install omp-qol@omp-qol`（可选 `--scope project`）
- git/npm：`omp plugin install github:owner/repo` 或 `omp plugin install <npm-name>`，只能进用户插件根
- 本地：`omp plugin install ./plugin` 或 `omp plugin link ./plugin`，同样进用户根，Windows 上 symlink 可能要特权

## 4. 插件包必须带什么

`PluginManifest`（`extensibility/plugins/types.ts:27-49`）从 `package.json` 的 `omp` 读取，没有则回退 `pi`，再没有则 `{ version: package.version }`。

运行时 `getEnabledPlugins` 会跳过没有 `omp`/`pi` 的包（`plugin-manager-installer-plumbing.md`「Malformed/missing manifest」）。装得上、列得出，但不会当插件加载。

本插件已经具备、且宿主会读的字段：

- `name` / `version`：锁文件和 `node_modules/<name>` 用包名
- `omp.extensions`：入口数组，可为 `.ts` / `.js` / `.mjs` / `.cjs`；目录则找 `index.*`
- `omp.settings`：设置 schema，供 `omp plugin config set`

宿主安装后会校验扩展入口能 import 出 factory（`PluginManager.#validateInstalledExtensions`，`manager.ts:358-391`）。市场安装走另一条：拷目录、写注册表、再 junction 到 scope 的 `node_modules`。

**编译 JS 还是原始 TS。** 官方作者指南和 mini-marketplace 例子都直接声明 `./src/main.ts` / `./index.ts`。扩展加载器注释写的是「using native Bun import」（`extensions/loader.ts:1-2`）。密封安装版二进制通过 `loadLegacyPiModule` 加载缓存里的 TS 副本，并改写对宿主包的 import（`legacy-pi-compat.ts` 开头说明 compiled binary 的 bundled host modules）。不需要先编一版 JS。

**lockfile。** 用户/项目插件根的 `omp-plugins.lock.json` 由宿主写入，不是插件作者提交的文件。插件自己的 `plugin/bun.lock` 只服务本仓库测试依赖。

**市场拷贝范围。** `cachePlugin`（`marketplace/cache.ts:63-88`）对插件目录做 `fs.cp(..., { recursive: true })`，没有按 `package.json#files` 过滤。git clone 下来的 `plugin/` 里有什么，缓存里就有什么。`files` 只对以后的 npm pack 有意义。

## 5. 插件怎样进入宿主会读的市场

宿主没有「投稿 API」，也没有官方中央索引。`docs/marketplace.md` 的模型是：用户把一个市场源加进自己的 `marketplaces.json`。

`/marketplace add` / `omp plugin marketplace add` 接受的源（`marketplace.md`「Marketplace sources」）：

- `owner/repo` GitHub 简写
- `https://...*.json` 直接目录 URL（只缓存 JSON；相对路径插件源不可用）
- 其他 http(s)/ssh git URL
- 本地目录

Git/本地源必须在仓库根提供 `.omp-plugin/marketplace.json`（优先）或 `.claude-plugin/marketplace.json`（Claude 兼容回退）。

官方文档举例是 `anthropics/claude-plugins-official`，那是 Claude Code 的市场，不是 oh-my-pi 自己的插件索引。社区侧 2026-08-15 能查到的做法：

- `DarkPhilosophy/omp-marketplace`：目录仓库，插件源是 `{ "source": "github", "repo": "DarkPhilosophy/omp-headroom" }`
- `omp-headroom` README：仓库自己也是市场，`omp plugin marketplace add DarkPhilosophy/omp-headroom` 然后 `omp plugin install omp-headroom@darkphilosophy`

`@oh-my-pi/*` 出现在 CLI 例子里（`@oh-my-pi/exa`），那是 **PluginManager 的 npm 通道**，不是市场目录。市场目录里的 npm source 会被 `source-resolver.ts:125-126` 拒绝：`npm plugin sources are not yet supported`。文档和代码在这一点上一致。

我们写不进别人的市场，也不该假装已经上架。可以提交的是：本仓库自己的 catalog。用户 add 这个 GitHub 仓库即可。

## 6. `omp plugin install <local-path>` 实际做什么

`classifyInstallTarget` 判为 local 之后，`handleInstall` 调用 `manager.link(target.path)`（`plugin-cli.ts:386-413`）。

`PluginManager.link`（`manager.ts:720-777`）：

1. 相对 manager cwd 解析路径
2. 要求该目录有 `package.json` 且带 `name`
3. 在**用户**插件根 `~/.omp/plugins/node_modules/<pkg.name>` 建 symlink（Windows 上是 symlink，不是 junction；与 MarketplaceManager 的 junction 不同）
4. 写用户根 `omp-plugins.lock.json`，`enabled: true`，`enabledFeatures: null`
5. 不写 `installed_plugins.json`（那是市场注册表）

`--scope` 被忽略。没有项目级 `plugin link`。

git/npm 的 `PluginManager.install` 同样只写用户根：在 `getPluginsDir()` 里 `bun install <spec>`（`manager.ts:476`）。`getPluginsDir()` 默认是 `~/.omp/plugins`（`dirs.ts:531-536`）。

项目 scope 只出现在 `MarketplaceManager.installPlugin(..., { scope })`（`marketplace/manager.ts:239-246`，默认 `"user"`）。

文档/代码张力：CLI flag 说明写得像所有 install 都认 `--scope`；实现只认市场。以代码为准。

## 7. 版本、升级、卸载、doctor

| 动作 | 市场插件 | npm/git/link 插件 |
| --- | --- | --- |
| 安装后再装同一版本 | 需 `--force`，否则 already installed | git 再装会 `bun update`；npm 再装改 pin |
| 升级 | `omp plugin upgrade [name@marketplace]`；全量升级只比较 catalog 里声明了 `version` 的条目，semver 必须更新（`marketplace.md`） | 没有 `plugin update`；再跑 `install` 新 spec（`plugin-manager-installer-plumbing.md`） |
| 刷新目录 | `omp plugin marketplace update [name]` 只拉 catalog，不重装插件 | 无 |
| 卸载 | `omp plugin uninstall name@marketplace`，可带 `--scope` | `omp plugin uninstall <packageName>` |
| 启用/停用 | `/plugins enable\|disable --scope … name@marketplace` | `omp plugin enable\|disable <pkg>`，改 lockfile |
| doctor | `omp plugin doctor` 主要扫用户根 npm/link 树；市场 runtime symlink 会被跳过（`manager.ts:930-932`） | 查 plugins dir、package.json、node_modules、各包 manifest/入口 |

市场版本解析顺序（`marketplace/manager.ts:409-439`）：catalog `version` → `.claude-plugin/plugin.json` 或 `package.json` 的 version → source SHA 前 7 位 → `0.0.0`。要让 `upgrade` 比较 semver，catalog 条目必须带 `version`，并与 `plugin/package.json` 对齐。

设置：`omp plugin config set <packageName> <key> <value>` 写 lockfile `settings`。包名是 `omp-qol-plugin`，不是市场 ID `omp-qol@omp-qol`。

## 8. 宿主自己的 CI / 发布，以及我们该门什么

宿主 `.github/workflows/ci.yml`：push/PR 跑 lint、typecheck、分桶测试；npm/GitHub Release 只在 HEAD 带 `v*` 或版本 bump commit 时走 release 链；`skip_npm` 可关发布。发布用 OIDC + `NPM_TOKEN` 兜底。这是宿主发行 `omp` 自己的规模，不是第三方插件模板。

更接近第三方插件的是 `omp-headroom` 的 CI（2026-08-15 读取）：push/PR 上 bun install、typecheck、`bun test`、pack smoke；另外有一次 `omp plugin install` 装打包结果。没有「每次 push 都 npm publish」。

对本仓库的默认门禁：

- 要进默认 CI：`plugin/` 下 `bun test`（当前 118+）、只检查插件 `src` 的 typecheck（不要顺着 `ref_repos` 的 `.md` import 一起炸）
- 不要进默认 CI：L6 e2e（真模型、密钥、费用）
- 发布：跟所选通道走。市场通道的「发布」是 push catalog + 打 tag；不要在每次 push 自动 npm publish
- 不要改仓库根 `WATCHDOG.yml`；不要杀不是自己拉起的 omp；不要给 `test-workspace` 擅自 `git init`

## 9. 文档与代码不一致的地方

1. **`--scope` 文案 vs 实现。** Flag 帮助写成通用 install scope；实现只用于 `name@marketplace`。本地/npm/git 会警告后忽略。以代码为准。
2. **`omp plugin update`。** 部分旧叙述容易让人以为有 update。17.3.4 帮助和 `plugin.ts` action 列表都没有 `update`。市场刷新 catalog 叫 `marketplace update`；市场重装叫 `upgrade`；npm/git 靠再 `install`。
3. **`omp plugin list` / doctor 与项目插件。** `omp-project-scoped-plugins.md` §5.3 曾写 list/doctor 写死用户根、项目 npm 插件不可见；§5.4 又改口：CLI `omp plugin list` 通过 `makeMarketplaceManager()` 能列出项目市场插件。对照 17.3.4：`handleList` 合并 `PluginManager.list()`（用户 npm/link）和 `MarketplaceManager.listInstalledPlugins()`（会读项目注册表）。项目级**市场**插件在 `omp plugin list` 可见；项目级手工 lockfile/junction（本仓库 sandbox 产物）只有同时写了 `installed_plugins.json` 才进 UI。两条通路仍然分开。
4. **市场 npm source。** schema 收得进，安装拒绝。文档已写明，代码一致。
5. **本仓库旧硬规则「Never write to the global ~/.omp」。** 这是开发/验收约束，避免污染作者全局配置。官方用户安装（user scope）本来就会写该用户的 `~/.omp`。两条规则作用域不同，不能把开发约束写成对终端用户的安装禁令。

## 10. 本仓库现状 vs 终端用户需要的路径

`.sandbox/install-plugin.ts` 做的事（脚本头注释 + 实现）：

- 把 `plugin/package.json` 和 `plugin/src` 拷到 `test-workspace/.omp/plugins/cache/local/omp-qol-plugin/<version>/`
- 建 `node_modules/omp-qol-plugin` junction
- 写 `omp-plugins.lock.json` 和 `installed_plugins.json`（`omp-qol-plugin@local`，scope=project）
- 不写 `~/.omp`，不登记 `marketplaces.json`

这是开发机上的验收夹具。陌生人没有这份脚本，也不该被要求跑它。

终端用户需要的是宿主自己的命令，并且仓库里要有宿主会读的 catalog / 包元数据。当前缺：

- `.omp-plugin/marketplace.json`
- 根/插件 README 上的官方安装段
- `package.json` 的 `repository` / `files` / `homepage` 等
- GitHub Actions
- 与 catalog 版本对齐的发布说明

根上没有 `package.json`。`PluginManager.install` 对 git spec 执行 `bun install github:owner/repo`，Bun 读的是仓库根清单。对当前布局，这条命令装不到 `plugin/`。不要为了迁就 git install 把整个仓库（含 `WATCHDOG.yml`、`test-workspace`、docs）当成插件包。

## 11. 第三方插件在 2026 年的默认做法

综合宿主作者指南（`docs/skills/authoring-marketplaces.md`）、mini-marketplace 例子、以及 omp-headroom / DarkPhilosophy 市场的公开 README：

1. 插件目录自带 `package.json`，`omp.extensions` 指向 TS 入口，设置写在 `omp.settings`。
2. 同一 Git 仓库根放 `.omp-plugin/marketplace.json`，插件 `source` 用 `./plugin` 这类相对路径（或指向独立插件仓的 github/git-subdir）。
3. README 第一条安装指令是 `omp plugin marketplace add owner/repo` + `omp plugin install name@marketplace`。需要只对当前项目生效时加 `--scope project`。
4. catalog 条目带 semver `version`，与 `package.json` 对齐，这样 `omp plugin upgrade` 有比较依据。
5. 开发仍用 `omp plugin link ./plugin` 或本仓库的 sandbox 安装器；不要把开发夹具写成用户安装。
6. CI：push/PR 跑测试和插件 typecheck；发布用 tag / 手打 Release。没有 npm token 就不要假装 publish 到 npm。
7. npm 可以作为第二条通道（`omp plugin install <name>`），但是可选，且市场目录的 npm source 现在不可用。

本仓库的适配：catalog 放在仓库根，`source: "./plugin"`，只发布 `plugin/` 这一棵树，不把 docs / test-workspace / 生产 `WATCHDOG.yml` 拷进用户缓存。
