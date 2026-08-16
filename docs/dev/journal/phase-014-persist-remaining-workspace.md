# Phase 014: persist remaining workspace files

**commit**: `41bcdc9` `docs: persist remaining workspace files and topic-sort researches`
**date**: 2026-08-16

## Problem / Background

The ICM opening program was already on `origin/master` (`13b58b5`). The working tree still held unsaved material: a topic-folder move of `docs/researches/` (deleted at old paths, untracked at new paths — a data-loss risk), `WATCHDOG.yml`, and a small demo fixture.

## Decision

Commit those leftovers. Do not swallow `test-workspace/mc-web/` (nested independent git repo) or `.sandbox/e2e-artifacts/` (runtime frames).

## Output

18 files: 11 exact researches renames, one new DCP message-id supplement, `WATCHDOG.yml`, `test-workspace/demo-mini-app/`, session-005 turn 12.

## Verification

`git status` after push: branch even with `origin/master`; only the two intentional leftovers remain untracked.
