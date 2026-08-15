# OMP 第三方插件分发重做（2026-08-15）

Date: 2026-08-15 · 宿主实测 `omp/17.3.4` · 源码 `C:\Users\15480\Desktop\AIWorkshop\ref_repos\oh-my-pi` · 访问日 2026-08-15

上一份同日调研（`omp-plugin-packaging-and-distribution.md`）和 Route B 实现已被作者否决。本文按宿主源码和本机 CLI 重答调查题，并把上一轮的判断当成待证假说。

## 背景

支柱要求仓库外的用户能按官方 `omp plugin` 流程安装本插件。上一轮选了仓内 `.omp-plugin/marketplace.json`，README 头条写成：

```text
omp plugin marketplace add RatmmmhSquishyRat/omp-qol
omp plugin install omp-qol@omp-qol
```

作者的三条约束是：不要为了发这一个插件去维护 marketplace；不要把 npm 包和 project scope 绑成选路理由；不要把尚未提供的 npm token 当成通道否决条件。

`.sandbox/install-plugin.ts` 仍是仓内开发/验收拷贝器，不是用户安装命令。

## 猜想

1. 独立作者在 2026 年的默认安装命令是 `omp plugin install <npm-package-name>`，市场是给「维护一份插件目录」的人用的。
2. `omp plugin install <npm-name> --scope project` 会被接受，但 `--scope` 在 npm 分支上被忽略，插件仍写入用户插件根。
3. npm 包身份和 marketplace 的 `--scope` 是两套机制，上一轮用后者否决前者，站不住。
4. 仓内 `marketplace.json` 对「只发一个插件」没有必要；它服务的是 catalog 作者，以及想 `--scope project` 的用户。

## A. 独立作者的默认安装命令

宿主 CLI 把 install 目标分成三类（`classify-install-target.ts:55-76`）：

0. 文件系统路径 → `PluginManager.link()`
1. 以 `@` 开头 → scoped npm
2. 中间有 `@`：右侧是已知市场名则走市场，否则当 npm 版本
3. 没有 `@` → npm

`handleInstall` 在目标为空时打印的第一条例子是 `omp plugin install @oh-my-pi/exa`（`plugin-cli.ts:353`）。`printPluginHelp()` 的 Sources 第一行也是 `pkg, pkg@1.2.3`（`plugin-cli.ts:966`）。TUI 空状态写的是 `omp plugin install <package>` 与 `omp plugin install <name>@<marketplace>` 并列（`plugin-settings.ts:121-123`）。

顶层还有 `omp install <target>`，文档写它是 `plugin install` / `plugin link` 的别名（`commands/install.ts:1-18`）。npm / 市场 spec 都转到 `plugin install`。

官方作者指南 `docs/skills/authoring-extensions.md` 讲的是：在 `package.json` 里写 `omp.extensions`，把扩展打成可安装插件。`docs/skills/authoring-marketplaces.md` 讲的是另一件事：怎样写一份 catalog，让别人 `marketplace add owner/repo`。

社区里已经按 npm 头条安装的第三方插件包括：

- `omp plugin install omp-notify-tool@0.2.4`（[pi.dev/packages/omp-notify-tool](https://pi.dev/packages/omp-notify-tool)，2026-08-15）
- `omp plugin install omp-typescript-complexity-evaluator`（npm 页，2026-08-15）
- `omp plugin install omp-mode-switch`（npm.io，2026-08-15）
- `omp plugin install omp-model-profile`（[tlarevo/omp-model-profile](https://github.com/tlarevo/omp-model-profile)，2026-08-15；该 README 把 marketplace 写成可选，并写明 catalog 的 typed npm source 现在装不上）

`DarkPhilosophy/omp-marketplace` 是一份**只含目录、插件各住自己仓库**的 catalog。它回答的是「怎样收集别人的插件」，不是「一个插件作者必须自带市场」。

**结论：** 独立作者的默认命令是 `omp plugin install <npm-name>`。需要时也可以 `omp install <npm-name>`。

## B. `omp plugin install <npm-name>` 是否工作？`--scope project` 是否生效？

第一问：工作。分类器把无 `@` 的名字标成 `{ type: "npm", spec }`，然后 `PluginManager.install` 在用户插件根执行 `bun install <spec>`（`manager.ts:416-476`）。

第二问：`--scope project` **不会**让 npm 安装进项目目录。代码路径如下。

1. oclif 把 `--scope` 收进 flags（`commands/plugin.ts:49-52`）。描述只写 `"user" (default) or "project"`，没有写「仅市场」。
2. `handleInstall` 在 marketplace 分支把 `flags.scope` 传给 `MarketplaceManager.installPlugin`（`plugin-cli.ts:368-373`）。
3. 走到 npm 分支时，同一文件先警告再丢掉 scope（`plugin-cli.ts:429-440`）：

```429:440:C:/Users/15480/Desktop/AIWorkshop/ref_repos/oh-my-pi/packages/coding-agent/src/cli/plugin-cli.ts
		// --scope only applies to marketplace installs; warn when it would be silently no-op'd for npm.
		if (flags.scope) {
			console.error(
				chalk.yellow(
					`Warning: --scope is only supported for marketplace installs (name@marketplace). Ignoring for ${spec}.`,
				),
			);
		}

		// npm path
		try {
			const result = await manager.install(spec, { force: flags.force, dryRun: flags.dryRun });
```

`manager.install` 的 options 类型只有 `force` / `dryRun`，没有 scope。

本地路径分支有同一句警告（`plugin-cli.ts:390-395`）。

**对上一轮的处理：** 「`--scope` 对 npm 不生效」这个**代码事实**成立，应保留。用它来否决 npm 主通道，应撤回。

## C. npm + `--scope project` 写到哪里？

`PluginManager.install` 始终使用 `getPluginsDir()` / `getPluginsPackageJson()` / `getPluginsNodeModules()`（`manager.ts:437-476`）。`getPluginsDir()` 的注释和实现是用户数据根：`~/.omp/plugins`，或 Linux 上已迁移的 `$XDG_DATA_HOME/omp/plugins`（`packages/utils/src/dirs.ts:521-535`）。

运行时加载器**会**读项目根 `<projectAnchor>/.omp/plugins`（`loader.ts:164-170`）。往这个根里写东西的，是 `MarketplaceManager.installPlugin(..., { scope: "project" })`，不是 `PluginManager.install`。

因此：`omp plugin install <npm-name> --scope project` 若继续执行，写入的仍是用户插件根。警告出现在 stderr。不会出现项目侧 `installed_plugins.json`。

## D. 为什么要维护仓内 `.omp-plugin/marketplace.json`？

宿主把 marketplace 定义成「一份 catalog」：Git/本地/URL 源里有 `.omp-plugin/marketplace.json`（或 Claude 回退路径），用户把它加进自己的 `marketplaces.json`，再按 `name@marketplace` 安装（`docs/marketplace.md`）。`authoring-marketplaces.md` 的主语是「创建新的 omp marketplace」。

上一轮把这份 catalog 当成**我们自己的发布通道**：用户必须先 add 本仓，再 `install omp-qol@omp-qol`。这样做的直接原因，是当时假设 npm 被 token 和「没有 project scope」挡住了。

诚实回答：

- 发**一个**第三方插件，宿主已经给了 npm / git / local-link。不需要自带 catalog。
- catalog 是给「维护一份插件列表」的人用的。`DarkPhilosophy/omp-marketplace` 是这类仓库。
- 相对路径 `source: "./plugin"` 对「本仓是 monorepo、根上没有 package.json」有用：用户可以不经 npm、从 git 树里只取 `plugin/`。这是可选能力，不是默认用户路径。
- `--scope project` 只挂在市场安装上。若为了这一项去维护 catalog，就是在用 marketplace 补 npm 没有的 scope。作者不接受把这两件事绑在一起。

本轮删除 `.omp-plugin/marketplace.json`。需要从本仓 git 树安装、且不走 npm 时，clone 之后用 `omp plugin install ./plugin` / `omp plugin link ./plugin`（写入用户插件根）。不投稿任何社区市场。

## E. npm 和市场都可用时，默认选哪条？

按作者给的三条偏好：

1. 宿主给第三方的文档/例子：npm 包名。
2. 不要强迫每个用户 `marketplace add` 我们的 git 仓。
3. 覆盖用户真正需要的 scope。宿主给 npm 的默认 scope 就是用户全局；project scope 是市场功能。

默认选 npm。市场不作为头条，也不再提交 catalog。

## F. 安装之后，list / config / upgrade 用什么名字？

| 动作 | npm / git / link | 市场 |
| --- | --- | --- |
| `omp plugin list` | `name@version`（`PluginManager.list`） | `name@marketplace (version) (scope)`（`MarketplaceManager.listInstalledPlugins`） |
| `omp plugin config *` | `package.json#name`。`handleConfig` 只在 `PluginManager.list()` 里查找（`plugin-cli.ts:738-744`） | list **会跳过**市场 runtime symlink（`manager.ts:681-683`），因此市场安装后 `config set omp-qol-plugin` 可能报 Plugin not found |
| 升级 | 没有 `plugin update`。再跑 `omp plugin install pkg@newVersion`（`plugin-manager-installer-plumbing.md`「Update semantics」） | `omp plugin upgrade name@marketplace`（`handleUpgrade` 只走 MarketplaceManager，`plugin-cli.ts:308-330`） |
| 卸载 | `omp plugin uninstall <packageName>` | `omp plugin uninstall name@marketplace` |

本插件 npm / 运行时 / settings 键统一为 `omp-qol-plugin`。

## 密封二进制与 TS 入口

扩展加载器文件头写的是「using native Bun import」（`extensions/loader.ts:1-2`）。安装后的入口经 `loadLegacyPiModule` 动态 import，并改写对宿主包的 specifier（`extension-loading.md`「Module import and factory contract」）。`authoring-extensions.md` 的清单例子是 `"./src/main.ts"`。

不需要先编一版 JS。`package.json#files` 带上 `src` 即可。安装校验会 import factory（`manager.ts:358-391`）；密封二进制通过同一套 shim 加载缓存里的 TS。

## 包必须带什么

`PluginManifest` 读 `package.json.omp`，回退 `pi`，再回退 `{ version }`。没有 `omp`/`pi` 的包装得上、列得出，但 `getEnabledPlugins` 会跳过。

本插件需要：`name`、`version`、`license`、`repository`、`files`（含 `src`）、`omp.extensions`（`./src/main.ts`）、`omp.settings`。`publishConfig.registry` 指向 npm。引擎写 `bun`，与宿主 `bun install` 一致。

`npm view omp-qol-plugin` 与 `npm view omp-qol` 在 2026-08-15 均为 404。沿用已有名字 `omp-qol-plugin`：仓库是 `omp-qol`，包是插件。

## 宿主文档 / 帮助文本 / 代码不一致的地方

1. **现场 `omp plugin --help`（oclif）** 把 `--scope` 写成对 install 通用的 `user|project`，把 `-l/--local` 写成 `Operate on local plugin directory`。`commands/plugin.ts:45-52` 与这份帮助一致。
2. **源码 `printPluginHelp()`** 写 `--scope` 只用于 `name@marketplace`，`-l` 是 project-local overrides（`plugin-cli.ts:979-985`）。全仓没有调用点，现场 CLI 看不到这段。
3. **`handleInstall`** 对 npm/git/local 忽略 `--scope` 并警告。以代码为准。
4. **`docs/marketplace.md`** 的 CLI 表只示范 `omp plugin install [--scope] name@marketplace`，不示范 npm。和 `printPluginHelp` 的 Sources 表、以及 `handleInstall` 的 `@oh-my-pi/exa` 例子并排放时，容易让人以为市场才是「正式」通道。读分类器和 `PluginManager.install` 后，npm 是一等通道。
5. **网页检索摘要**（[omp.sh/docs/plugins](https://omp.sh/docs/plugins)，2026-08-15）出现过 `omp update`、以及用 `-l` 做 project-scoped install。本机 17.3.4 没有 npm 的 `plugin update`；`-l` 进的是 `flags.local`，`handleInstall` 不用它。该页本次抓取返回「loading docs…」，不把它当现行规范。
6. **市场 catalog 的 `{ source: "npm" }`** 能解析，安装时抛 `npm plugin sources are not yet supported`（`source-resolver.ts:125-126`，`marketplace.md:199-209`）。文档和代码在「尚未支持」这一点上一致。

## 默认最佳实践（本仓库）

用户头条：

```bash
omp plugin install omp-qol-plugin
```

升级：`omp plugin install omp-qol-plugin@<version>`。卸载：`omp plugin uninstall omp-qol-plugin`。设置：`omp plugin config set omp-qol-plugin <key> <value>`。

发布：把 `plugin/` 发到 npm；GitHub Actions 在 `v*` tag 上跑 publish 作业。本轮不执行真实 publish。剩余人工步骤：配置 `NPM_TOKEN` 或 npm trusted publisher，然后打 tag。

仓内开发/验收继续用 `.sandbox/install-plugin.ts`，并标明不是用户路径。
