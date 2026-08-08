# OMP 项目级插件安装机制(Project-scoped plugins)

Date: 2026-08-06 · 目的:让 omp-qol 插件能从项目内的测试文件夹随 `omp` 启动
自动启用,不改动用户全局 `~/.omp`。

> **补记(2026-08-07 仓库重整)**:正文为插件名 `omp-qol-extension`、源码位于
> `repos/omp-qol-extension` 时期的历史记录。现状:插件正名
> **`omp-qol-plugin`**(v0.3.0,完整插件语义),源码位于仓库根 **`plugin/`**,
> 全仓单一 git(仓库根),无向前兼容。各章机制结论不变(名字/路径代入
> 即可),复现以 `docs/plans/TDDs/qol-delivery-test-plan.md` §9 为准。

## 1. 宿主原生机制(源码证据)

- CLI:`omp plugin install <target> --scope=<user|project>`(`omp plugin --help`
  输出;默认 user)。`--scope project` 即项目级安装。
- 项目根解析 `resolveActiveProjectRegistryPath(cwd)`
  (`src/discovery/helpers.ts:813+`),注释即契约:
  1. 从 cwd 向上找最近的 `.omp/` 目录(遇到 homedir 停止,`~/.omp` 不算
     项目根)→ 注册表为 `<dir>/.omp/plugins/installed_plugins.json`;
  2. 无 `.omp/` 则向上找 `.git`,以 git 根为锚点;
  3. 都没有 → null(无项目上下文)。
- 插件加载 `loadPlugins`(`src/extensibility/plugins/loader.ts:195+`):
  用户根 `getPluginsDir(home)` 收集 user 插件;**另从项目注册表所在目录
  (`projectRoot = dirname(registryPath)`)收集 project 插件**;同名时
  project 条目优先(`marketplace/types.ts:181-191` "project entry takes
  precedence")。
- 项目级覆盖 `.omp/plugin-overrides.json`(可禁用/覆盖插件,
  `types.ts:149+`、`loader.ts loadProjectOverrides`,同时检查 `.omp` 与
  `.pi`)。
- 项目级设置:`getPluginSettings` 应用项目级 overrides(此前 QOL-001 调查
  已确认)。

## 2. 结论与实装方案

首选方案(被证伪):在测试文件夹内执行
`omp plugin install <扩展路径> --scope project`。实测:宿主对本地路径安装
忽略 `--scope`(警告 "--scope is only supported for marketplace installs"),
仍走 user 级 symlink(Windows 上 EPERM)。`--scope project` 仅对市场安装有效。

实际方案A(被方案B取代):手工搭建与宿主同形的项目插件根。`.omp/plugins/`
下放 `package.json`、`omp-plugins.lock.json`、`node_modules/<插件名>`
(junction 指向扩展仓库)。可用但过重。

**实际方案B(最终采纳,opencode 式)**:项目 `.omp/settings.json` 的
`extensions:` 数组直接指定本地路径,
`builtin.ts loadExtensionModules`(L461+)会把它作为入口模块加载:
- 条目可为文件或目录;相对路径按 cwd 解析(`path.resolve(ctx.cwd, raw)`,
  支持 `~` 展开);
- 文件条目:读取成功即直接作为模块加载;
- 目录条目:走 `discoverExtensionModulePaths` 扫描,规则为顶层 `*.{ts,js}`
  文件、`*/index.{ts,js}`、`*/package.json`(读 `omp`/`pi` 清单的
  `extensions` 字段);
- **坑1**:指向仓库根无效——根级 package.json 不在 `*/package.json` 匹配
  范围(只下钻一层);
- **坑2**:指向 `src/` 会把每个顶层 .ts 都当独立入口(重复注册);
- **坑3(命名)**:Extension Module 的名字纯路径派生
  (`getExtensionNameFromPath`,helpers.ts:704):普通文件取文件名去后缀
  (`main.ts` → `/status` 里显示 `main`);**仅 `index.ts` 取父目录名**。
  修复:仓库根加 `index.ts` 转发入口,配置改指仓库根目录——目录条目经
  `preferredIndexBySubdir` 补全为 `<根>/index.ts`,名字即 `omp-qol-extension`;
- **正确写法(最终)**:`"extensions": ["../repos/omp-qol-extension"]`(仓库根,
  含根级 `index.ts`);
- **与 `omp plugin list` 的关系**:settings 路径加载的是 Extension Module,
  不进插件注册表,`omp plugin list`/`doctor` 不显示属预期;可见处为
  `/status` 的 "Extension Modules" 段(origin: via OMP (Project))与工具面
  (`goal`/`mode`)。要在 plugin list 可见只能走 `.omp/plugins/node_modules`
  注册表形态(方案A,已验证但较重);
- 同级机制:项目 `.omp/extensions/` 目录自动扫描(同规则);CLI
  `--extension`/`-e` 标志。
- 设置来源差异:此路径下插件设置不走 `omp-plugins.lock.json`,而是包内
  `omp.settings` 默认值 + `.omp/plugin-overrides.json` 的 `settings` 覆盖
  (`getPluginSettings`,loader.ts:527)。

注意事项:
- 向上查找"最近 `.omp` 优先",测试文件夹自身的 `.omp` 天然胜出;但需确保
  父目录链上没有更近的 `.omp`(repos/omp-qol 链上没有)。
- 安装版宿主(密封 dist)下插件可加载:goal 工具经 `ctx.invokeTool` 全功能;
  mode 工具因桥不可用会如实报错(见 omp-plan-vibe-modes.md §4)。从源码跑
  (`bun <monorepo>/src/cli.ts`)则两者全功能。
- `plugin-overrides.json` 非必需,默认全部启用。

## 3. 测试文件夹位置

`repos/omp-qol/test-workspace/` —— 最终形态(2026-08-07 起):项目插件根
`.omp/plugins/`(package.json + omp-plugins.lock.json + node_modules
junction),完整插件形态,见 §5.2。中期的单文件 `.omp/settings.json`
扩展形态(方案B)已移除 —— 它只是 Extension Module,不进插件注册表,
不符合"完整插件"的交付要求。

## 4. 运行时验证结果(2026-08-06)

用 `.sandbox/verify-workspace.ts`(RPC 启动 + `dumpTools` 断言,cwd=
test-workspace,**不设** PI_CONFIG_DIR,全局用户根保持原样)四象限全绿。
两种形态各验一轮:先是 `.omp/plugins/` 手工根,改为单文件
`.omp/settings.json` 后重跑,结果不变:

| 组合 | 结果 |
| --- | --- |
| 安装版宿主 | PASS:`goal`/`mode` 均带 `[qol]` 标记 |
| 安装版宿主 `--control`(`--no-extensions`) | PASS:两工具缺席 |
| 源码宿主(`--source`) | PASS:两工具均带 `[qol]` 标记 |
| 源码宿主 `--control` | PASS:两工具缺席 |

旁证排除了用户根污染:`~/.omp/plugins/node_modules` 为空(无 lock 文件);
从无 `.omp/` 的兄弟目录启动 omp,`dumpTools` 中无 `goal`/`mode` ——
加载确实只由 test-workspace 的项目配置触发。`--no-extensions` 同样压制
settings 路径加载(控制组两次均缺席)。

已知盲区:`omp plugin doctor` / `omp plugin list` 只检查用户根,不显示
项目级插件;运行时 `getEnabledPlugins(cwd)` 才是权威路径,故以上用 RPC
实载验证。

## 5. CORRECTION:交付形态必须是完整插件(2026-08-07)

用户从项目第一天起要求的就是**完整插件**(进 `omp plugin list`/`doctor`、
带 manifest 的可安装包),而非单扩展文件。§2 把方案A(项目插件根)判为
"过重"并以方案B(settings.json 扩展)顶替,是错误的取舍:方案B 交付的
只是 Extension Module,不在插件体系内可见。本节补全插件形态的宿主机制
证据并恢复方案A 为最终交付形态。

### 5.1 完整插件的定义(源码证据)

- **清单**:`package.json` 的 `omp`(或 `pi`)字段 = `PluginManifest`
  (`extensibility/plugins/types.ts:27`):`name?/version/description` +
  入口 `tools?/hooks?/extensions?: string[]/commands?` + `features?` +
  `settings?` schema。我们的 `omp-qol-extension/package.json` 早已符合。
- **发现**:`getEnabledPlugins(cwd)`(loader.ts:176)枚举两个根:
  用户根 `~/.omp/plugins` ∪ 项目根 `<锚点>/.omp/plugins`(锚点 = 从 cwd
  向上最近的 `.omp/`,回退 `.git/`,`resolveActiveProjectRegistryPath`)。
  每根要求:存在 `node_modules/`;名字 = `package.json#dependencies` ∪
  `omp-plugins.lock.json#plugins`;每个名字须有
  `node_modules/<名字>/package.json` 且带 `omp`/`pi` 清单;
  lockfile `enabled:false` 或项目 overrides `disabled` 可禁用;同名时
  project 遮蔽 user。
- **运行时加载**:插件根经 `listInstalledPluginRoots`
  (`discovery/omp-extension-roots.ts:249`)汇入 `listOmpExtensionRoots`,
  与 settings.json 扩展走**同一个**扩展加载器 —— 同样的 factory 契约,
  因此 `ExtensionAPI.pi` 注入面同样适用(mode 修复在插件形态下自动生效)。
- **CLI 限制**:`omp plugin install <本地路径>`/`link` 一律链接到
  **用户根**(`manager.link()` → `getPluginsNodeModules()`),本地路径
  忽略 `--scope`(plugin-cli.ts:390 警告);Windows 上 Bun symlink 需
  特权(EPERM)。故不动全局的唯一途径 = 手工搭建项目插件根。

### 5.2 项目插件根形态(最终交付)

`test-workspace/.omp/plugins/` 三件套:

```
.omp/plugins/package.json           {"dependencies":{"omp-qol-extension":"file:..."}}
.omp/plugins/omp-plugins.lock.json  {"plugins":{"omp-qol-extension":{"version":"0.2.0","enabledFeatures":null,"enabled":true}},"settings":{}}
.omp/plugins/node_modules/omp-qol-extension  → junction 到扩展仓库
```

要点:
- settings.json 的 `extensions:` 数组**移除**——两条路径指向不同绝对路径
  (仓库根 vs junction),不去重,会双载重复注册。
- junction 目标在沙箱外时,沙箱内进程无法穿越(已知坑);验证命令须
  在沙箱外跑。
- 插件形态下设置来源回到 lockfile `settings` + 项目 overrides
  (与方案B 的包内默认值路径不同)。
- 插件名 = 包名 `omp-qol-extension`(不再受路径派生命名规则影响,
  §2 坑3 在此形态下不存在)。

### 5.3 验证结果(2026-08-07,插件形态)

| 检查 | 结果 |
| --- | --- |
| `registry-probe.ts`(宿主自身 `getEnabledPlugins(cwd)`) | PASS:`omp-qol-extension@0.2.0 scope=project enabled=true`,manifest.extensions 正确 |
| `verify-live.ts`(安装版宿主 RPC dumpTools) | PASS:`goal`/`mode` 均带 `[qol]` 标记,schema 含全部 5 个 op |
| `e2e-workspace-mode.ts`(交付形态真实 LLM e2e) | PASS:`mode op=status` 返回 `plan: off \| vibe: off \| goal: none`,`isError:false` |

另确认的宿主限制(源码证据,非可修项):`omp plugin list`/`doctor` 的
`PluginManager`(`manager.ts list()/doctor()`)写死用户根
(`getPluginsPackageJson()`/`getPluginsDir()`,不带 cwd),项目级 **npm 插件**
在这两个子命令中不可见。
e2e 期间遇到中转池配额波动(部分 provider 403 预扣费不足),脚本已改为
按 `OMPQOL_RELAY_PROVIDERS` 指定顺序逐 provider 选最廉价模型(provider 名单属个人配置,不入仓库)。

### 5.4 CORRECTION-2:UI 插件列表的数据源与 installed_plugins.json(2026-08-07)

§5.3 末句"`/status` 与运行时注册表才是可见面"**错误**。用户实测
`/plugins` 显示 "No plugins installed"。源码复查(全部带证据):

- **所有插件列表 UI 的数据源只有两个**:
  1. `PluginManager.list()` → 用户根 `~/.omp/plugins/package.json`
     (`manager.ts:664`,写死用户根);
  2. `MarketplaceManager.listInstalledPlugins()` →
     **installed_plugins.json 注册表**(`marketplace/manager.ts:512`),
     user 注册表 = `~/.omp/plugins/installed_plugins.json`,
     **project 注册表 = `<项目>/.omp/plugins/installed_plugins.json`**
     (`resolveActiveProjectRegistryPath`,`discovery/helpers.ts:821`,
     从 cwd 向上找最近 `.omp/`)。
- 覆盖的 UI 面:`/plugins` 面板(`modes/components/plugin-settings.ts:643`)、
  `/plugins` 与 `/marketplace installed` slash 命令
  (`slash-commands/builtin-registry.ts:2531/2608`)、
  **CLI `omp plugin list`**(`cli/plugin-cli.ts:507`,其
  `makeMarketplaceManager()` 在 :200 传入 project 注册表,故 CLI 也能
  显示 project 级 marketplace 插件)、enable/disable/uninstall/upgrade。
- **运行时加载与 UI 列表是两条独立通路**:运行时走
  `getEnabledPlugins`(插件根三件套),UI 走 installed_plugins.json。
  只有 `MarketplaceManager.installPlugin`(`manager.ts:239`)同时写两边:
  ① 复制插件内容到缓存目录;② 写 installed_plugins.json(scope=project);
  ③ `#registerRuntimePlugin`(manager.ts:820)在项目插件根建
  `node_modules/<包名>` junction→缓存副本并写 `omp-plugins.lock.json`。
- 官方 `installPlugin` 的前提是市场条目登记在全局
  `~/.omp/marketplaces.json`(`addMarketplace`),违反"不动全局"约束。

**最终交付形态(全项目本地、零全局写入)**:忠实复刻 installPlugin 的
项目侧产物,共四件,全部位于 `test-workspace/.omp/plugins/`:

1. `cache/local/omp-qol-extension/<version>/` —— 插件内容副本
   (installPath 指向它;绝不指向源码仓库,否则宿主 `uninstallPlugin`
   的 `fs.rm(installPath)` 会删掉仓库);
2. `node_modules/omp-qol-extension` junction → 该副本(运行时加载面);
3. `omp-plugins.lock.json` 条目(运行时启用状态);
4. `installed_plugins.json`(`version:2`,`plugins:
   {"omp-qol-extension@local":[{scope:"project", installPath, version,
   installedAt, lastUpdated, enabled:true}]}`)—— **UI 可见面**,
   插件 ID 须通过 `parsePluginId`(`name@marketplace` 双段小写)。

已知取舍(如实记录):`/marketplace upgrade` 找不到市场 `local` 的目录
会跳过/报错(无全局市场登记),版本刷新 = 重跑
`.sandbox/install-plugin.ts`(确定性安装脚本,幂等)。
`MarketplacePluginDetailComponent` 的启停走
`setPluginEnabled`(只改两个注册表文件),无市场依赖,可用。

**验证结果(2026-08-07,均针对安装版宿主 v17.2.4)**:

| 检查 | 结果 |
| --- | --- |
| `registry-probe.ts`(宿主自身函数读双面) | PASS:runtime `scope=project enabled=true` + UI 注册表 `omp-qol-extension@local v0.2.0 scope=project` |
| `omp plugin list`(cwd=test-workspace) | PASS:输出 `omp-qol-extension@local (0.2.0) (project)` —— `/plugins` 面板同源同数据 |
| `verify-live.ts --control` / `verify-live.ts` | PASS:control 11 工具无 goal/mode;qol 13 工具,`[qol]` 标记与 5 op schema 齐全(运行时已改为从 cache 副本加载) |
| `e2e-workspace-mode.ts`(真实 LLM) | PASS:中转池廉价模型调 `mode op=status` → `plan: off \| vibe: off \| goal: none`,`isError:false` |
| `bun test`(扩展仓库全量) | PASS:43/43 |
