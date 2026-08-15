# Phase 007: Redo distribution on npm default

**commit**: `ca4f512` `feat: switch default install to npm and add tag publish job`
**date**: 2026-08-15

## Problem / Background

Phase 006 把仓内 `.omp-plugin/marketplace.json` 当成用户安装通道，并用「npm 没有 project scope」以及「没有 npm token」否决 npm。作者否决该路线，要求全量重做。

## Decision

Route A：默认用户命令 `omp plugin install omp-qol-plugin`。`--scope` 对 npm 被宿主忽略是代码事实，不拿来选路。单插件作者不维护 marketplace catalog。tag 工作流留下 `npm-publish` 作业，等作者粘贴 `NPM_TOKEN` 或配置 trusted publisher。

## Output

删除 catalog；`publishConfig`；README 头条改 npm；release.yml 增加 npm-publish；重做调研 / 选路报告 / 实现指引；支柱第二条澄清原文。

## Verification

`bun test` 118/118；plugin typecheck 0；隔离 HOME 下 packed tarball 官方安装得到 `omp-qol-plugin@0.3.0`；`--scope project` 警告 Ignoring；未 npm publish。
