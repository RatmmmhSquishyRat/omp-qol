# QOL distribution implementation notes

**date**: 2026-08-15
**route**: B — in-repo marketplace catalog (`./plugin`)

## What landed

- `.omp-plugin/marketplace.json` — market `omp-qol`, plugin `omp-qol`, source `./plugin`, version `0.3.0`
- `plugin/package.json` — repository, homepage, bugs, files, engines, peer `@oh-my-pi/pi-coding-agent`
- `LICENSE` (repo root + `plugin/LICENSE`)
- `plugin/tsconfig.plugin.json` + `plugin/types/host-ambient.d.ts` — typecheck does not walk host `.md` imports
- `.github/workflows/ci.yml` — push/PR: bun install, typecheck, `bun test`, metadata check
- `.github/workflows/release.yml` — tag `v*` creates a GitHub Release; no npm publish
- `.sandbox/check-distribution-metadata.ts` — catalog version === package version
- `.sandbox/link-dev-deps.ts` — honors `OMP_HOST_ROOT` (local source-link still available)
- README (root + plugin) — official marketplace commands first; sandbox labeled in-repo only

## Verification

| Check | Result |
| --- | --- |
| `cd plugin && bun test` | 118 pass, 597 expect, 0 fail |
| `cd plugin && bun run typecheck` | exit 0 (`tsconfig.plugin.json`) |
| `bun .sandbox/check-distribution-metadata.ts` | PASS |
| Isolated official install | PASS (see below) |
| npm publish | not run; no token |
| GitHub Release | not created this turn (no version bump / tag) |

### Isolated official install (2026-08-15)

`PI_CONFIG_DIR=.omp-qol-dist-verify-20260815b`. Staging tree = catalog + `plugin/{package.json,src,README,LICENSE}` (no `node_modules`, same shape as a git clone).

```
✔ Added marketplace: <temp stage>
✔ Installed omp-qol from omp-qol (0.3.0)
omp plugin list → omp-qol@omp-qol (0.3.0) (user)
cache file present: …/omp-qol___omp-qol___0.3.0/src/main.ts
```

`~/.omp/marketplaces.json` was absent before and after. Isolation root deleted after the run.

First attempt that pointed `marketplace add` at the **working tree** failed with Windows `EPERM` while `cachePlugin` copied `plugin/node_modules/@oh-my-pi/browser-relay`. Host `fs.cp` copies the whole plugin directory. GitHub installs do not include `node_modules`. Do not `marketplace add` a dirty working tree that has plugin `node_modules`.

`--scope project` on a TEMP git scratch: CLI printed `Installed` and `omp plugin list` showed `(project)`. A follow-up dump of that scratch tree did not show `installed_plugins.json` (project-root resolution under TEMP + isolated config was not fully pinned). User-scope path is the one with file evidence.

`actionlint` is not installed on this machine. Workflows were checked by reading them and by reproducing the CI script locally (`bun install` already done, typecheck, test, metadata).

## Remaining human steps

1. No npm token / trusted publisher in this repo. Do not tell users `omp plugin install omp-qol-plugin` until someone publishes.
2. After this push, strangers can `omp plugin marketplace add RatmmmhSquishyRat/omp-qol` against origin (repo is public).
3. Tag `v0.3.0` (or the next version) when a GitHub Release is wanted. Release workflow does not publish npm.
4. Do not submit this plugin to a third-party marketplace on the author’s behalf.

## Host doc vs code (carried from research)

- `--scope` help text reads like a general install flag; implementation only honors it for `name@marketplace`.
- There is no `omp plugin update`. Catalog refresh is `marketplace update`; marketplace reinstall is `upgrade`.
