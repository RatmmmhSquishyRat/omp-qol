# test-workspace — 启动文件夹

在本目录启动 `omp` 只是给开发者一个 cwd（`demo-mini-app/` 等）。插件的默认安装不再是本目录下的假 marketplace 拷贝。

用户与测试的默认命令都是：

```bash
omp plugin install omp-qol-plugin
```

宿主对 npm 忽略 `--scope project`，写入的是用户插件根（`~/.omp/plugins`，或 `PI_CONFIG_DIR` 指向的同级根）。

## 活会话红线（2026-08-15）

本机全局 omp 和这个测试工作区里的 omp **可能正在跑任务**。不要在会话还活着的时候：

- 对本目录或 `~/.omp` 跑 `omp plugin install` / `upgrade` / `uninstall`
- 重写 `.omp/plugins/**` 的 cache / junction / lock
- `git init` 本目录

脚本验收走隔离根：`bun ../.sandbox/install-plugin.ts --isolated-root .omp-qol-<id>`。那条命令不会写本目录的 `.omp`。

本目录若还留着旧的 `.omp/plugins`（`omp-qol-plugin@local`、junction、lockfile），那是上一轮拷贝器的 leftover。默认 `PI_CONFIG_DIR=.omp` 时，项目侧旧拷贝会 shadow 用户根里的 npm 包。活会话结束后再有意处理：先官方安装到用户根，再停用或删掉这棵 leftover。本轮不热换。

## 会话结束后的下一次有意重装

```powershell
# 等本目录和全局 ~/.omp 上的 omp 都停干净之后
omp plugin install omp-qol-plugin
```

不要再跑无隔离参数的 `bun ../.sandbox/install-plugin.ts`：那个入口现在会拒绝写入 live 根。

## 不要从这里做 project-scope advisor 写入

本目录没有自己的 `.git`。宿主 `repo.root()` 会上溯到 omp-qol 仓库根，project-scope advisor 写会打到仓库根的生产 `WATCHDOG.yml`。advisor 写操作只用 git-init 的 scratch 工作区。
