# Isolated official install smoke (2026-08-15)

Throwaway HOME: `C:\Users\15480\AppData\Local\Temp\omp-qol-official-install-smoke-20260815-203345`  
Command: `bun .sandbox/install-plugin.ts --isolated-home <scratch>` → `omp plugin install omp-qol-plugin`  
Host: installed `omp`. Scratch deleted after this note.

## Results

| Check | Result |
| --- | --- |
| official install | `Installed omp-qol-plugin@0.3.1` |
| `omp plugin list --json` (registry-probe) | `npm[0].name=omp-qol-plugin` `version=0.3.1` `enabled=true`; path under scratch `.omp/plugins/node_modules` |
| scratch `plugins/package.json` | `"omp-qol-plugin": "^0.3.1"` |
| L4 verify-workspace | PASS — goal/mode/advisor `[qol]`, 5 mode ops, 10 advisor ops |
| author `~/.omp/plugins/package.json` | ABSENT before and after |
| `test-workspace/.omp/plugins` mtime | `2026-08-07T14:57:40.6961008Z` before and after |
| live `omp` pids | 49744, 65868 still running (not killed, not reinstalled) |

Bare `bun .sandbox/install-plugin.ts` (no isolation) exits 2.  
`cd plugin && bun test`: 120 pass / 0 fail / 617 expect.  
`bun .sandbox/check-distribution-metadata.ts`: PASS `omp-qol-plugin@0.3.1`.

Live test-workspace was **not** reinstalled.
