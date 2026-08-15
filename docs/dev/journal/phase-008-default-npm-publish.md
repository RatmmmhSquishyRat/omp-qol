# Phase 008: Default GitHub Actions npm publish

**commit**: `dc23362` `fix: align tag release with default npm publish practice`；docs-mapping 见同回合后续 hash
**date**: 2026-08-15

## Problem / Background

作者否决把 CI/npm publish 拆成一长串琐碎项。要求先查开源社区默认实践，再只补对照表里的缺口。`v0.3.0` 打在无 `.github/` 的 `5392aef` 上，复用该 tag 不会跑 Release。

## Decision

默认取 npm 文档的 `v*` tag 线（用户安装是 npm），而不是 GitHub 教程的 `on.release` 先切 Release。对照后只改：权限、`--provenance`、GitHub Release 等 npm、tag env-pass、timeout、Release concurrency、`workflow_dispatch`、版本 `0.3.1`。仓库密钥名 `NPM_TOKEN`。不 SHA-pin、不加 Windows 矩阵、不抽 reusable workflow。

## Output

调研 `docs/researches/github-actions-npm-publish-default-2026.md`；`release.yml` / `ci.yml` 按上表；`plugin/package.json` `0.3.1`；支柱第三条澄清原文。

## Verification

`bun test` 118/118；plugin typecheck 0；`npm pack --dry-run` 10 文件、无 test / 无密钥；`gh secret list` 可见 `NPM_TOKEN`（只记名字）。本机不 `npm publish`。
