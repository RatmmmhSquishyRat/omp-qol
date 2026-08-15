# L6 multi-advisor real-traffic acceptance — run 20260815-170912

- **Verdict**: PASS — all CRUD steps green under the new envelope; Alpha and Beta independently Built(running, distinct models) → Fed(user>=1) → Streamed(assistant>=1, tokens>0); paused Gamma silent; transcripts on disk
- **Config root**: isolated (`~\.omp-qol-e2e-20260815-170912`; copied: agent.db, agent.db-wal, agent.db-shm, models.db, models.db-wal, models.db-shm, models.yml, .env, kimi-device-id)
- **Advisor-role neutralization**: modelRoles.advisor pinned to `omp-qol-e2e-blocked/no-such-model` (unset role falls back to the host's expensive "slow" chain)
- **Primary model**: zai/glm-4.5-air
- **Advisors**: Alpha=`zai/glm-4.5-air` · Beta=`deepseek/deepseek-v4-flash` · Gamma (paused control) pins `zai/glm-4.5-air`
- **Timings**: crud=55s · live=64s
- **Baseline repaired**: false
- **PING reply**: "PING"
- **Session file**: `C:\Users\15480\.omp-qol-e2e-20260815-170912\agent\sessions\-Desktop-AIWorkshop-repos-omp-qol-.sandbox-scratch-e2e-advisor-ws-20260815-170912-live\2026-08-15T09-10-19-606Z_01a004af-b6d6-7000-bc99-51169a4a8b22.jsonl`

## CRUD lifecycle (envelope-asserted)

- step 1 `status`: OK
- step 2 `enable`: OK
- step 3 `upsert`: OK
- step 4 `list`: OK
- step 5 `remove`: OK
- step 6 `status`: OK
- step 7 `upsert`: OK
- step 8 `remove`: OK
- step 9 `disable`: OK

## Per-advisor evidence (Built → Fed → Streamed)

- **Alpha** (zai/glm-4.5-air): baseline user=0 assistant=0 tokens=0 → post user=5 assistant=3 tokens=11500 cost=$0.001616
- **Beta** (deepseek/deepseek-v4-flash): baseline user=0 assistant=0 tokens=0 → post user=5 assistant=3 tokens=11595 cost=$0.000128
- **Gamma** (paused control): all-zero throughout, no transcript file
- **Transcripts**: alpha=true beta=true gammaAbsent=true

## Live checks

- OK — T1-T3 roster stored while disabled
- OK — baseline: Alpha+Beta running distinct models, all counters zero; Gamma paused
- OK — per-advisor deltas: Alpha & Beta independently Fed+Streamed; Gamma all-zero (Alpha {"user":5,"assistant":3,"tokensTotal":11500,"cost":0.0016158000000000001} · Beta {"user":5,"assistant":3,"tokensTotal":11595,"cost":0.00012806080000000002})
- OK — dump shows both advisors' history
- OK — transcripts: alpha+beta persisted with assistant records; gamma absent

## Product issues found

- none

## Notes / deviations

- none

## Artifact index

- `frames-*.jsonl` — every raw RPC frame, both directions, with ms offsets
- `crud-step-*.json` / `live-T*.json` — advisor tool envelopes per step (parsed + raw)
- `status-baseline.json` / `status-post-*.json` — op=status evidence (zero baseline, settled deltas)
- `dump.json` — op=dump envelope with both advisors' history
- `advisor-transcript.{alpha,beta}.jsonl` — on-disk advisor transcripts (copies)
- `watchdog-final.yml` — final scratch WATCHDOG.yml (Alpha/Beta/Gamma roster)
- `get-state.json` / `session-stats.json` — session file path + primary session stats
- `models-available-*.json` — the host's model listing under the e2e config root
- `verdict.json` — this run's full machine-readable evidence
