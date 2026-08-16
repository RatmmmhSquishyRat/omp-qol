# GitHub Actions + npm publish 默认实践（2026）

Date: 2026-08-15 · 访问日 2026-08-15

对照对象：一个公开 npm 包、PR 上跑测试、版本 tag 上发布。官方文档优先；宿主 `oh-my-pi` 与社区插件只用来确认「默认长什么样」，不把它们的规模或加固项写进默认。

## 1. 2026 年的默认形态

官方材料里有两条都能成立的触发线：

1. GitHub 教程 [Publishing Node.js packages](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages) 与 [actions/starter-workflows `ci/npm-publish.yml`](https://github.com/actions/starter-workflows/blob/main/ci/npm-publish.yml)：`on.release`（`published` / `created`）→ 先测再 `npm publish`。
2. npm [Trusted publishing](https://docs.npmjs.com/trusted-publishers)：`on.push.tags: ['v*']` → `npm ci` / test → `npm publish`。

两条线共享同一张作业图。本仓库用户安装走 npm，包版本与 git tag 必须对账（`tag === v${version}`），所以默认取第 2 条：CI 看分支，Release 看 `v*` tag。不把 GitHub Release 当成 publish 触发器。

规范作业图：

```text
CI (push/PR)     : checkout → 安装 → test
Release (v* tag) : verify（安装 / test / 元数据）
                 → npm-publish（registry-url + NODE_AUTH_TOKEN + --access public）
                 → 若还要 GitHub Release：needs: [verify, npm-publish]
```

starter-workflow 已是「build 绿了才 publish-npm」。GitHub 教程把 `--provenance --access public` 和 `permissions: { contents: read, id-token: write }` 写进同一作业。[Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements) 要求 GitHub-hosted runner + `id-token: write` + `--provenance`。Trusted publishing 配好之后 provenance 会自动生成；本包尚未在 npm 上存在，第一次发布仍走 `NPM_TOKEN`，因此按 GitHub 教程显式加 `--provenance`。

其余默认值：

| 项 | 默认 | 出处 |
| --- | --- | --- |
| 权限 | 工作流 `contents: read`；publish 作业加 `id-token: write`；只有创建 GitHub Release 的作业加 `contents: write` | [Automatic token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)；教程 YAML |
| 密钥名 | 仓库密钥 `NPM_TOKEN` → 环境变量 `NODE_AUTH_TOKEN` | 教程；[setup-node 发布例](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md) |
| registry | `actions/setup-node` 的 `registry-url: https://registry.npmjs.org` | 同上 |
| 工作目录 | 包不在仓库根时，publish / install 设 `working-directory`（本仓是 `plugin/`） | 工作流语法；包在 `plugin/package.json` |
| tag | `v` + `package.json` version；已公开的 tag 不 force-move | npm 身份是 name+version；metadata 脚本要求 `tag === v${version}` |
| 内联脚本 | `run:` 里的值先写入 `env:`，再引用环境变量 | [Security hardening — intermediate environment variable](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) |
| 动作引用 | 官方例用主版本标签（`actions/checkout@v4` 或更新的 `@v6`，`actions/setup-node@v4` 或 `@v7`，`oven-sh/setup-bun@v2`） | 教程 / starter-workflow / [setup-bun](https://github.com/oven-sh/setup-bun) |
| 作业时限 | `timeout-minutes` 是一等语法；默认 360 分钟。单包测试+发布 15 分钟足够 | [Workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions) |
| 并发 | `concurrency` 防止同一工作流叠跑；发布作业不要 `cancel-in-progress: true`（会打断进行中的 publish） | [Concurrency](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#concurrency) |
| 重试 | `workflow_dispatch` 可从同一 tag 再跑 | npm trusted publishing 排障；GitHub 事件文档 |

社区对照（只当证据，不当加项）：

- `oh-my-pi` 把测试、多平台二进制、npm、GitHub Release 收进同一条超大 CI，并 SHA-pin 动作。那是宿主规模，不是单包默认。
- [`omp-notify-tool` release.yml](https://github.com/jiwangyihao/omp-notify-tool/blob/master/.github/workflows/release.yml)：`on.release.published` → bun test → `npm publish --access public`，`id-token: write` + `registry-url`。走的是 GitHub 教程那条触发线。
- [`omp-hooks` publish.yml](https://github.com/ZeR020/omp-hooks/blob/main/.github/workflows/publish.yml)：`on.push.tags: v*` → bun 检查 → `npm publish --access public --provenance`。走的是 npm 文档那条触发线。

## 2. 明确不是默认的东西

下面这些在加固指南或大型仓库里常见，官方「发一个 npm 包」例都不要求。当作 **optional hardening, not default**：

- Windows / 多 OS / 多 Node 矩阵
- 把每个 action pin 到完整 SHA（教程与 starter-workflow 用主版本标签；`oh-my-pi` 的 pin 是宿主加固）
- 抽 reusable workflow
- 给 solo 仓库加 deploy environment + required reviewers（npm 文档写过，标成额外措施）
- 把 CI 和 Release 合成一条宿主级流水线
- 发布前 `npm pack --dry-run`、查「版本是否已发布」再跳过（`omp-notify-tool` 有；官方例没有）
- 为对齐教程而把 `checkout@v4` / `setup-node@v4` 升到 `@v6` / `@v7`（功能上不是缺口）
- 改 `peerDependencies`、typecheck 桩、host-bridge

## 3. 默认实践 vs 当前仓库（只列真缺口）

`ci.yml` 已是默认 CI：`contents: read`、concurrency、ubuntu、`plugin/` 下 bun install / typecheck / test。直播 CI 已绿 118 测（run `31879694728`、`31878792350`），不再把「CI 在不在」当研究题。

`origin` 的 `v0.3.0` 指向 `5392aef`（`git ls-remote --tags origin`；剥注后无 `.github/`）。再推同一个 tag 不会跑 Release。默认做法是 bump 包版本并打新 tag，不 force-move 已公开 tag。

| 项 | 默认 | 当前 | 缺口 |
| --- | --- | --- | --- |
| Release 权限 | 工作流 `contents: read`；仅 GitHub Release 作业 `contents: write`；publish 作业 `id-token: write` | 工作流级 `contents: write`，verify / publish 也带着写权限 | 是 |
| `npm publish` 参数 | `--access public`；有 `id-token: write` 时加 `--provenance` | 只有 `--access public` | 是 |
| GitHub Release 顺序 | 用户安装是 npm，Release 不能在 publish 失败时单独成功 | `github-release` 只 `needs: verify` | 是 |
| tag 传入 `run:` | 先 `env:` 再引用 | `--tag ${{ github.ref_name }}` 与 `gh release create "${{ github.ref_name }}"` 写在脚本字符串里 | 是 |
| `timeout-minutes` | 语法一等；单包 15 分钟 | CI / Release 都没写 | 是 |
| Release concurrency | 有；发布不要取消进行中的作业 | 无 | 是 |
| `workflow_dispatch` | 同一 tag 可重试 | Release 没有 | 是 |
| 密钥 `NPM_TOKEN` | 仓库密钥存在 | 调研时 `gh secret list` 为空 | 是（人工步骤，不进 YAML） |
| 可触发的 tag | 新 tag 打在带 `.github/` 的提交上 | `v0.3.0` 打在无 workflow 的 `5392aef`；`package.json` 仍是 `0.3.0` | 是：升到 `0.3.1` 并打 `v0.3.1` |

`plugin/package.json` 的 name / `publishConfig` / `files` / `repository` 已够发布。不把 peerDependency、Windows 矩阵、SHA-pin 写进本表。
