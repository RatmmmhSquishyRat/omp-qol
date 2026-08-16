# Eval / cache-cost fixture (draft)

**date:** 2026-08-16
**source of truth:** `research/cache-cost.md` (E1)
**status:** measurement contract. Not a placement freeze. No live billed run yet (those cells stay E0/E1).

## Two layers

Do not collapse host prefix stability and provider billed cache.

```text
journal → overlay projection → AppendOnlyContextManager (divergence)
        → provider cache (TTL / breakpoint / routing)
        → usage.cacheRead / cacheWrite / input → host calculateCost
```

Do not score with the TUI cache-miss banner (`cacheWrite > 0` only, Anthropic-shaped).

## Arms

| Arm | Isolates |
|---|---|
| native | baseline |
| overlay | wire rewrite vs stored-history floor |
| overlay+seal | C seal vs second LLM summary |
| overlay+pin | pin cost on top of compress |

`overlay+pin` runs **three** variants, never averaged: `pin-tail`, `pin-system`, `pin-mid`.

Later: architecture D. B stays diagnostic.

## Per-turn metrics

`raw`, `projected`, `provider`, `nativePressure = max(provider, stored)`, `cacheRead`, `cacheWrite`, `$` via host `calculateCost`, `firstDivergence { index, kind, tokenOffset, changedSuffix }`.

`$` uses host `usage.cost.total` (`calculateCost`) at run time. Keep a second `usdOfficial` column when the bundled catalog lags (DeepSeek peak/off-peak from 2026-08-16 16:00 UTC).

`cacheWrite = 0` is expected on DeepSeek, Gemini implicit, and Z.AI/GLM (OMP maps hits to `cacheRead` only). GLM price table is ~15–20% of input for cached tokens — use the table, not the “usually 50%” prose. Record UTC hour.

L6 in this repo has already used GLM; include that family in the first billed run, not only Anthropic.

## Isolation

`PI_CONFIG_DIR=.omp-qol-e2e-cache-<runId>` (the `.omp-qol-` prefix is what `official-install.ts` allows under the live homedir). Credentials only. Do not write live `~/.omp` or live `test-workspace/.omp`.

## Fail the fixture, not the ranking

Fail if a required metric is missing, if pressure is reported as provider-only, if prices are hand-written, if pin placements are collapsed, or if cache is a boolean. Do **not** fail because tail lost to system on one provider — that is a result.

## Still unknown without a billed run

Hit rates, TTL expiry, DeepSeek persist-turn, Gemini implicit misses, whether a shortened overlay array still hits after the host log clear.
