# test-workspace — 启动 omp 即启用 omp-qol 完整插件

在本文件夹内启动 omp,`omp-qol-plugin` 以**项目级插件**身份生效:
既在运行时加载(goal / mode 工具全功能),也在插件列表 UI 可见
(`/plugins` 面板、`omp plugin list` 显示 `omp-qol-plugin@local (0.3.0) (project)`),
全程不改动你的全局 `~/.omp`。

## 原理(宿主原生插件机制,两条独立通路)

1. **运行时加载**:`getEnabledPlugins(cwd)` 枚举用户根 `~/.omp/plugins` 与
   项目根 `<锚点>/.omp/plugins`(锚点 = 从 cwd 向上最近的 `.omp/`),
   读 `package.json` deps ∪ `omp-plugins.lock.json`,经 node_modules 加载。
2. **UI 列表**:`/plugins`、`/marketplace installed`、`omp plugin list` 读
   `installed_plugins.json`(project 注册表 = 本目录
   `.omp/plugins/installed_plugins.json`;源码:`resolveActiveProjectRegistryPath`)。

官方 `MarketplaceManager.installPlugin(scope:"project")` 会同时写两边,
但其前置(市场登记)必须写全局 `~/.omp/marketplaces.json`。本目录的产物
是该安装流程**项目侧产物的忠实复刻**,零全局写入;整个 `.omp/` 树由
`bun ../.sandbox/install-plugin.ts` 生成(不入库):

```
.omp/
└── plugins/
    ├── installed_plugins.json            # UI 可见面(scope=project)
    ├── omp-plugins.lock.json             # 运行时启用状态
    ├── package.json                      # 插件根 deps 钉住版本
    ├── node_modules/
    │   └── omp-qol-plugin                # junction → 下方 cache 副本
    └── cache/local/omp-qol-plugin/0.3.0  # 插件内容副本(installPath 指向它)
```

installPath 必须指向 cache 副本而非源码仓库:宿主 `uninstallPlugin` 会
`fs.rm(installPath)`。源码依据:
`../../docs/researches/omp-project-scoped-plugins.md` §5(含 §5.4)。

## 用法

```powershell
cd test-workspace
omp    # /plugins 可见;goal / mode 全功能(含安装版宿主:桥经 ExtensionAPI.pi)
```

验证(在 repos/omp-qol 下执行):

```powershell
bun .sandbox/install-plugin.ts       # 安装/刷新(幂等,复刻宿主安装产物)
bun .sandbox/registry-probe.ts       # 宿主自身函数断言双面:runtime + UI 注册表
bun .sandbox/verify-workspace.ts     # 交付形态 RPC dumpTools(不覆盖全局根)
bun .sandbox/e2e-workspace-mode.ts   # 交付形态真实 LLM e2e:全部 5 个 mode op
```

## 调整行为

- **源码改动后刷新**:重跑 `bun .sandbox/install-plugin.ts`(运行时加载的
  是 cache 副本,不是仓库实时源码)。
- 禁用/启用:`/plugins` 面板内直接切换(宿主 `setPluginEnabled` 只改两个
  注册表文件),或把 `installed_plugins.json` / lockfile 的 `enabled` 置 false。
- 卸载:删掉上面树中四件产物即可,或 `/marketplace uninstall
  omp-qol-plugin@local --scope project`(只会删 cache 副本,安全)。
- 改设置:lockfile 的 `settings` 段或项目 `.omp/plugin-overrides.json`
  (如 `{ "settings": { "omp-qol-plugin": { "modeToolEnabled": false } } }`)。

## 已知边界

- `/marketplace upgrade` 找不到市场 `local` 的目录(无全局市场登记),
  版本刷新走 install-plugin.ts。
- `omp plugin list`/`doctor` 的 **npm 插件**部分写死用户根;本插件以
  marketplace(project)条目呈现,不受影响。
- junction 目标在文件系统沙箱外时,沙箱内进程无法穿越——需在沙箱外启动 omp。
- 不要改用 `omp plugin link`:它无视 `--scope`,会链接到全局用户根,
  且 Bun symlink 在 Windows 需特权(EPERM)。
