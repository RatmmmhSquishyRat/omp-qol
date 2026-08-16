# Phase 013: ICM schema/compress freezes and E3 substrate proof

**commit**: `6f57c47` `docs: freeze ICM overlay schema and compress design, prove substrate at E3`
**date**: 2026-08-16

## Problem / Background

Phase 012 closed the ICM host facts at E2 (source-read) and left three gaps before implementation: the overlay event schema freeze, the compress closure spec, and runtime proof that the three load-bearing hooks actually behave as the research claims. All three were driven in parallel this phase.

## Decision

- **Overlay event schema working freeze** (`designs/overlay-schema.md`): one customType `omp-qol.icm.overlay`; versioned 8-op event union; plugin-generated `eventId` (required — `appendEntry` returns `void`); pure `fold(getBranch())` reducer; `shadowed`/`invalid-source` derived per-path; v1 forbids active-block overlap and nesting; pins always win visibility; skip-and-warn + `staleSchema` mutation freeze.
- **Compress design accepted with integration fixes** (`designs/compress.md`): closure computed on the reconstructed projection plan; zero-widening tolerance with `preview` as the free discovery path; projection-only self-footprint scrub; positional seal maturity with verbatim `firstKeptEntryId`. Three draft-vs-schema conflicts arbitrated in the schema's favor (no nesting, pins accept+warn, straddling→`shadowed`), marked inline.
- **Sealed-expand proposal** (`designs/sealed-expand.md`, phase 012 commit) extended with the schema's rehydrate-as-pin mapping; DECISIONS carries the full author ratification package: Q4 + rehydrate-as-pin (schema T2) + seal gap verbatim inlining (compress T2).
- **Address layer amended**: `sessionId` is provenance-only, never a resolution key — host `fork()` preserves entry ids under a new session id.

## Output

13 files, +1566: two new design freezes, E3 probe script (`plugin/scripts/icm-substrate-probe.ts`, standalone bun script outside the test suite) and its evidence report, control-plane updates, session-log mapping.

## Verification

`bun scripts/icm-substrate-probe.ts` from `plugin/`: 40/40 checks PASS against real host 17.3.4 under isolated `PI_CONFIG_DIR` — appendEntry persistence/invisibility/reload, context clone/transform/journal-intact, custom CompactionResult seal with `fromExtension:true` and zero summarizer calls, plus the `{cancel:true}` arm. Re-run personally by the main agent (exit 0, isolation dirs cleaned, live `~/.omp` untouched). Probe nuances recorded in DECISIONS: movable cut is capability-not-policy, clone mutation is wire-visible when returned, harnesses must wire coding-agent `convertToLlm`, `PI_CONFIG_DIR` is a home-relative name.
