# Reference Repos

All clones live in `docs/ref_repos/` and are gitignored.

| Dir | Upstream | Role | Lock |
|---|---|---|---|
| `oh-my-pi` | junction → `C:\Users\15480\Desktop\AIWorkshop\ref_repos\oh-my-pi` | Shared local host checkout. **Do not pull/move; other work may use it.** | `ffd53ff92a` 17.3.4 (2026-08-14) |
| `oh-my-pi-main` | worktree of the same repo, detached | Current host source for ICM research | `de6b7974a0` 17.3.4 (2026-08-16) |
| `opencode-dynamic-context-pruning` | `Opencode-DCP/opencode-dynamic-context-pruning` | Original DCP | `85b6f5ceba144fee9e65eb28dc36cab1b960e418` (2026-06-25) |
| `pi-dcp` | `Davidcreador/pi-dcp` | Pi extension port (`@davecodes/pi-dcp`) | shallow HEAD |
| `pi-dcp-vault` | `pi-vault/pi-dcp` | Another Pi-DCP port | shallow HEAD |
| `opencode-acm` | `rickross/opencode-acm` | OpenCode active context + pin | shallow HEAD |
| `opencode-btw` | `kldzj/opencode-btw` | Persistent/transient hint pin | shallow HEAD |
| `prime-agent` | `PrimeIntellect-ai/prime-agent` | Adjacent PrimeStyle prior | shallow HEAD |

## Refresh

```text
# current host worktree only
git -C <workshop>/ref_repos/oh-my-pi fetch origin
git -C docs/ref_repos/oh-my-pi-main checkout --detach origin/main

# shallow comparison repos
git -C docs/ref_repos/<name> pull --ff-only
```

Never `git pull` the junctioned `oh-my-pi` from this project unless the author says the shared checkout is idle.

## Not cloned (too large or secondary)

- `anomalyco/opencode` — use GitHub for PR `#9097` (native pin after compaction) rather than a full clone.
- `badlogic/pi-mono` / `earendil-works/pi` — only if OMP extension API diverges enough to need upstream Pi.

## Host lock file

Write `HOST-LOCK.md` after the H5 delta report lands.
