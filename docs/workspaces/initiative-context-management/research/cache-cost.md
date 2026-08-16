# E1: Prompt-cache economics and price-impact measurement

**Track:** E1 (`research/00-index.md` Q8)  
**Date:** 2026-08-16  
**Scope:** Provider cache rules (2026), how OMP records `cacheRead` / `cacheWrite`, mapping onto `AppendOnlyContextManager`, a QOL measurement fixture, hypotheses, and L6 isolation. No product code.  
**Host:** `docs/ref_repos/oh-my-pi-main` @ `de6b7974a0` (17.3.4)  
**Companion:** H3 [`host-cache.md`](./host-cache.md) owns digest / first-divergence source. This file owns **price** and **how to measure**.  
**Evidence:** host Usage / stats = **E2**. Provider pricing/TTL = **E1** from official docs retrieved 2026-08-16. Fixture / hypotheses = **E0** until an L6 run lands.

---

## Executive summary

Provider prompt caches charge a **prefix**. A hit requires the rendered prefix through a breakpoint (or a persisted cache unit) to stay **byte-identical**. OMP already records the four billable buckets on every assistant message — `input`, `output`, `cacheRead`, `cacheWrite` — and rolls them into session stats, advisor stats, and `calculateCost`. Cache cost is therefore **first divergence + changed suffix**, not “rewrote history = lost all cache.”

That host claim is closed on 17.3.4 in H3. What this track still needs is a **USD fixture**: four arms (`native` / `overlay` / `overlay+seal` / `overlay+pin`), per-turn `cacheRead` / `cacheWrite` / `input` / `output`, native pressure, first-divergence index, and a catalog-backed dollar estimate. An L6 run can collect those numbers without touching live `~/.omp` if it copies the existing advisor e2e isolation (`PI_CONFIG_DIR=.omp-qol-e2e-<id>`, credentials only).

---

## 1. Provider rules: what must stay byte-stable for a cache hit

All of the providers OMP actually bills against share one rule: **cache is a prefix match**. Anything that changes earlier in the rendered request invalidates everything after that point. The differences are TTL, write premium, minimum length, and whether the client must mark breakpoints.

Rates below are **USD per 1M tokens**, retrieved 2026-08-16. They move. The fixture should price from the **live model catalog** (`model.cost`) and keep an official-rate overlay only when the catalog is stale.

### 1.1 Anthropic Claude

**Docs:** [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (retrieved 2026-08-16).

**How a hit is decided**

- Cache covers the full prefix in order: `tools` → `system` → `messages`, up to and including the `cache_control` breakpoint.
- The write hash is **cumulative**. Changing any block at or before the breakpoint produces a new hash.
- Reads walk backward at most **20 blocks** from the current breakpoint looking for a **prior write**, not for “stable-looking” content. If the conversation grew by ≥20 blocks since the last write, a single trailing breakpoint misses the old entry.
- Maximum **4** breakpoints per request. Automatic (top-level) `cache_control` consumes one slot.
- Default TTL is **5 minutes**, sliding: a hit refreshes the timer. Optional `"ttl": "1h"`. Lifetime is measured from the **start** of the request that wrote or read the entry; a 4-minute stream leaves ~1 minute for the next turn on a 5m cache.
- Minimum cacheable prefix (Claude API / Platform / Vertex / Foundry): 512 (Opus 5 / Fable 5 / Mythos 5), 1024 (Sonnet 5 / 4.6 / 4.5, Opus 4.8), 2048 (Opus 4.7, Haiku 3.5), 4096 (Opus 4.6 / 4.5, Haiku 4.5). Below the minimum, both `cache_creation_input_tokens` and `cache_read_input_tokens` stay 0 and there is no error.

**What must stay byte-stable**

| Layer | Must be identical | Typical ICM bust |
|---|---|---|
| Tool definitions (name, description, parameters, order) | Entire cache | Registering / renaming an ICM tool mid-session; `intentTracing` / prune-descriptions flip |
| Top-level `system` | System + messages | System pin; AGENTS / skills rewrite; web-search or citations toggle |
| Messages through the breakpoint | Messages from the change onward | Mid-history pin; deep compress; in-place tool-result rewrite |
| Images / documents in user turns | Message cache | Image strip / vision fallback |
| `tool_choice` | Messages only | Forcing a tool on one turn |
| Thinking / effort | Messages always; tools+system on some models | Thinking-level change mid-session |

Thinking blocks cannot carry `cache_control` themselves, but prior-turn thinking **does** sit in the cached prefix when the provider keeps it. Empty text blocks cannot be cached. `cache_control` on generated reasoning is rejected (OMP skips those blocks when placing markers).

**Pricing multipliers** (same across current Claude models)

| Bucket | Multiplier vs base input |
|---|---|
| Uncached input | 1.00× |
| 5m cache write | 1.25× |
| 1h cache write | 2.00× |
| Cache read / refresh | 0.10× |

Examples from the same page: Sonnet 4.6 is $3 / $3.75 / $6 / $0.30 (input / 5m write / 1h write / read). Opus 5 is $5 / $6.25 / $10 / $0.50.

**OMP wire behavior** (`packages/ai/src/providers/anthropic.ts`)

- Default retention is `"short"` → `{ type: "ephemeral" }` (5m). `"long"` adds `ttl: "1h"` when `compat.supportsLongCacheRetention`.
- `applyPromptCaching` stamps `cache_control` on the last one or two **ordinary** content blocks (skips thinking / redacted_thinking / fallback). That is a **rolling trailing breakpoint**, not a system-only breakpoint.
- `usage.cttl` splits 5m vs 1h writes. `calculateCost` prices 5m at `rates.cacheWrite` and 1h at `2 × rates.input`. Residual unattributed writes use the 5m rate so they are never free.

**Implication for ICM:** a tail pin or tail scrub that leaves `tools` + `system` + earlier messages identical should produce a large `cacheRead` and a write only on the new suffix. A system pin, tool-schema change, or mid-history rewrite moves the hash to the change point and re-pays write premium on the whole suffix.

### 1.2 OpenAI / Responses API

**Docs:** [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) (retrieved 2026-08-16).

OpenAI now has **two** cache regimes. OMP talks to both (Chat Completions, Responses, Codex).

**GPT-5.6 and later**

- Exact match at eligible breakpoints. Default implicit breakpoint is the **latest user or tool message**.
- Explicit breakpoints: `prompt_cache_breakpoint: { mode: "explicit" }` on `input_text` / `input_image` / `input_file`. Top-level Responses `instructions` **cannot** hold a breakpoint.
- Minimum prefix through the breakpoint: **1024 tokens**.
- Cache write billed at **1.25×** uncached input; read at **0.1×**; tokens neither read nor written at 1.0×. The 1.25× rate **is** the write charge, not an extra on top of another full input charge.
- TTL: `prompt_cache_options.ttl` — only `"30m"`, sliding on reuse. No extra write charge for a refresh.
- Up to **4 new writes** per request; up to **50** earlier breakpoints are readable. Implicit mode spends one write slot on the latest message.
- `prompt_cache_key` is required for the more reliable matching. OMP sends `prompt_cache_key` from `promptCacheKey ?? sessionId` (normalized, `pc_` prefix, 64 chars) unless `cacheRetention === "none"`.
- Keep traffic per key around **15 rpm** or some requests miss.

**Earlier models (4o / 5.x before 5.6)**

- Automatic best-effort prefix reuse. No write fee. Read discount varies by model (often 50–90%).
- Minimum 1024–2048 tokens; hits in **128-token** increments.
- In-memory retention typically 5–10 minutes idle, max ~1 hour. Some models accept `prompt_cache_retention: "24h"`.
- Still exact prefix: tools, schemas, images, and order must match. Use `allowed_tools` rather than shrinking the `tools` array.

**What must stay byte-stable**

- Instructions, tool definitions, tool **order**, structured-output schemas, images + detail, files, audio.
- Conversation history: append; do not rewrite, delete, or reorder earlier messages if those messages sit before the breakpoint.
- Compaction / summarization **resets** the reusable prefix (OpenAI’s own guidance).
- A timestamp or per-request user blob **before** the implicit breakpoint writes a new prefix every turn. Put changing content after an explicit breakpoint, or the write meter stays high.

**OMP wire behavior**

- Responses: `prompt_cache_key`, optional `prompt_cache_retention: "24h"` when `cacheRetention === "long"` and the model supports it, optional `prompt_cache_options` when `compat.supportsPromptCacheBreakpoints`.
- Codex Responses: same key path.
- Chat Completions: `prompt_cache_key` for official / kimi-code paths; Anthropic-compat endpoints get a trailing `cache_control` on the last text part.
- OpenRouter Anthropic-upstream: top-level `cache_control` with 5m or `ttl: "1h"`.
- Usage: `cached_tokens` → `cacheRead`; `cache_write_tokens` (GPT-5.6+ / OpenRouter) → `cacheWrite`.

**Implication for ICM:** overlay that **appends** (tail pin, new summary message after a stable prefix) matches implicit caching. Overlay that **rewrites** mid-history matches “changing content prevents reuse.” On GPT-5.6+, that rewrite is a **paid write** of the new suffix, not a free miss.

### 1.3 DeepSeek

**Docs:** [Context Caching](https://api-docs.deepseek.com/guides/kv_cache), [Pricing](https://api-docs.deepseek.com/quick_start/pricing) (retrieved 2026-08-16).

Automatic disk KV cache. No `cache_control`. Best-effort; construction takes seconds; unused entries clear in hours to days.

**Hit rule (2026 Sliding Window Attention)**

A later request hits only if it **fully matches a persisted cache-prefix unit**. Units are created at:

1. End of user input and end of model output (request boundaries).
2. Detected common prefixes across requests (persisted after the second request that shares them).
3. Fixed token intervals on long inputs/outputs.

Example from the docs: request `A+B` then `A+C` does **not** hit on `A`. The system then persists `A`. A third request `A+D` can hit `A`. Multi-turn `A+B` then `A+B+C` hits `A+B` immediately.

**What must stay byte-stable:** the entire prefix unit. A mid-history edit that yields `A+X+…` does not hit `A+B`. DeepSeek is stricter than “longest common prefix” on the first rewrite; the common prefix may only become hittable on the **next** turn.

**Pricing (official, USD / 1M)**

Through **2026-08-16 15:59 UTC** (OMP catalog @ `de6b7974a0` matches this):

| Model | Cache hit (`cacheRead`) | Cache miss (`input`) | Output | `cacheWrite` in OMP |
|---|---|---|---|---|
| `deepseek-v4-flash` | $0.0028 | $0.14 | $0.28 | **0** (not a billed write) |
| `deepseek-v4-pro` | $0.003625 | $0.435 | $0.87 | **0** |

From **2026-08-16 16:00 UTC**, official peak / off-peak (peak = 01:00–04:00 and 06:00–10:00 UTC):

| Model | Off-peak hit / miss / out | Peak hit / miss / out |
|---|---|---|
| `deepseek-v4-flash` | $0.007 / $0.22 / $0.66 | $0.014 / $0.44 / $1.32 |
| `deepseek-v4-pro` | $0.022 / $0.66 / $1.98 | $0.044 / $1.32 / $3.96 |

OMP mapping (`calculateOpenAIUsageAccounting` in `packages/ai/src/providers/openai-shared.ts`): `prompt_cache_hit_tokens` → `cacheRead`; miss → `input`; **`cacheWrite` forced to 0** so uncached tokens are not double-charged as writes. `shouldEnableAppendOnlyContext` **auto-on** for `provider === "deepseek"`.

**Implication for ICM:** DeepSeek is the cheapest place to **see** prefix stability (auto append-only + huge hit/miss spread). It is a weak place to measure Anthropic-style **write premium**. A deep compress that breaks unit `A+B` may show a full miss on the compress turn and only recover `A` on the following turn.

### 1.4 Z.AI / GLM (used in current QOL L6)

**Docs:** [Context caching](https://docs.z.ai/guides/capabilities/cache), [Pricing](https://docs.z.ai/guides/overview/pricing) (retrieved 2026-08-16).

Automatic implicit cache. Reported as `usage.prompt_tokens_details.cached_tokens`. Official copy says the system looks for identical or “highly similar” repeated context — treat **similarity** as undocumented; the fixture should assume **prefix identity** until a run proves otherwise.

Official GLM-4.5-Air (the model the 2026-08-15 advisor L6 used): input $0.20, cached input $0.03, output $1.10, storage “limited-time free.” GLM-5.2: $1.40 / $0.26 / $4.40. Docs page also says cache hits are “usually 50% of standard”; the price table is closer to **~15–20%** of input. Price from the table, not the prose.

OMP maps OpenAI-compat `cached_tokens` → `cacheRead`. No cache-write bucket.

### 1.5 Other providers OMP already normalizes

| Provider | Host mapping | Stability rule (as documented / implemented) |
|---|---|---|
| **Google Gemini** | `cachedContentTokenCount` → `cacheRead`; `input = promptTokenCount - cached`; `cacheWrite = 0` (`google-shared.ts`) | Implicit prefix cache on current Gemini; changing system/tools/history prefix drops `cacheRead`. |
| **Amazon Bedrock** | Anthropic-style `cache_control` when `promptCacheMode !== "automatic"`; long TTL if supported | Same prefix hierarchy as Anthropic, platform-specific minima. |
| **OpenRouter / Vercel gateway** | `input_cache_read` / `input_cache_write`; optional `caching: "auto"` + `cache_ttl` | Upstream-dependent. Do not treat gateway `cacheRead` as a single vendor’s TTL. |
| **GitHub Copilot / Codex OAuth** | Same OpenAI usage fields + `premiumRequests` | Cache $ and premium-request counters are different meters. Record both. |
| **Local (ollama / llama.cpp / LM Studio)** | Often `cacheRead=0` in Usage; append-only still matters for **KV prefill** | Byte-stable prefix avoids a full ~40k re-prefill (#3406). Price impact is latency / electricity, not USD. |

---

## 2. How OMP records tokens

Three surfaces already expose the same four buckets. An L6 fixture should read them, not invent a parallel meter.

### 2.1 Canonical `Usage` (`packages/catalog/src/types.ts`)

```text
input        non-cached / miss bucket (NOT “all prompt tokens”)
output       completion, including thinking when the provider folds it in
cacheRead    tokens read from prompt cache
cacheWrite   tokens written / created in prompt cache
totalTokens  input + output + cacheRead + cacheWrite (+ orchestration if reported)
cost.{input,output,cacheRead,cacheWrite,total}   USD from calculateCost
```

Optional: `reasoningTokens` (subset of `output`), `contextTokens` (occupancy when billed buckets lie), `cttl.{ephemeral5m,ephemeral1h}` (Anthropic writes), `orchestration` (billed, not in the conversation prefix).

**Prompt occupancy** (what the model saw):

```text
promptTokens = input + cacheRead + cacheWrite
```

`calculatePromptTokens` / `hasContextTokenUsage` in `packages/agent/src/compaction/compaction.ts` use that sum. Telemetry and `run-collector.ts` use the same formula for `inputTokens`.

Persisted on every `AssistantMessage.usage` in the session JSONL (`docs/session.md`).

### 2.2 Session stats

`SessionStatsTracker.getSessionStats()` (`packages/coding-agent/src/session/session-stats.ts`) walks `agent.state.messages`:

- Sums `usage.input` / `output` / `cacheRead` / `cacheWrite` / `totalTokens` / `cost.total` on every assistant message.
- Also folds `task` tool-result `details.usage` when present (subagent spend).
- Returns `SessionStats.tokens` plus `cost`, `premiumRequests`, and `contextUsage`.

RPC: `get_session_stats` → `session.getSessionStats()` (`packages/coding-agent/src/modes/rpc/rpc-mode.ts`). The 2026-08-15 advisor L6 already saves this as `session-stats.json`.

`getContextBreakdown()` is the **display** meter (last successful assistant usage + estimated tail). Native **compaction pressure** is a different number: `max(providerUsage, storedConversationEstimate)` (H1). Record both.

### 2.3 Advisor stats

`AdvisorStats` / `PerAdvisorStat` (`packages/coding-agent/src/session/session-advisors.ts`):

```text
tokens: { input, output, reasoning, cacheRead, cacheWrite, total }
cost: number
contextTokens, contextWindow
```

`#computeAdvisorStat` sums the same `AssistantMessage.usage` fields on that advisor’s own agent. Top-level `getAdvisorStats()` adds the live roster. QOL already types this as `LiveAdvisorTokenTotals` in `plugin/src/lib/host-bridge.ts`.

Advisors are **side channels**. They do not share the main session’s `AppendOnlyContextManager` log. `anthropicCacheRefresh` is documented as main-loop-only. Do not mix advisor `cacheRead` into the main-arm cache curve unless the fixture is explicitly measuring advisor cost.

### 2.4 USD estimate

`calculateCost` (`packages/catalog/src/models.ts`):

```text
rates = long-context tier if promptInputTokens > inputThreshold else base
cost.input      = rates.input     / 1e6 * (usage.input + orchestration.input)
cost.output     = rates.output    / 1e6 * (usage.output + orchestration.output)
cost.cacheRead  = rates.cacheRead / 1e6 * (usage.cacheRead + orchestration.cacheRead)
cost.cacheWrite = 5m rate * (ephemeral5m + residual) + (2 * input rate) * ephemeral1h
                = rates.cacheWrite / 1e6 * usage.cacheWrite   when cttl absent
```

Prefer **`usage.cost.total` already on the message** (host applied the catalog). Keep a second “official overlay” column for DeepSeek after 16:00 UTC 2026-08-16, because the bundled catalog still has the pre-peak flat rates.

---

## 3. Mapping onto `AppendOnlyContextManager`

H3 is the source close-out. This section is the **price mapping**. If H3 and this file disagree on digest fields, H3 wins.

### 3.1 Two layers that must stay stable

```text
StablePrefix     systemPrompt[] + normalizeTools()     fingerprint change → whole tools+system miss
AppendOnlyLog    provider Message[]                    first digest mismatch → suffix miss from that index
```

Digest fields (H3 / `append-only-context.ts`): `role`, `content`, `providerPayload`, `toolCalls`/`tool_calls`, `toolCallId`/`tool_call_id`, `toolName`/`name`, `isError`, assistant `id`.

Compaction **shrink** (`normalized.length < lastSyncCount`) **clears** the log. Overlay+seal that returns a shorter native history is a full client-side prefix reset even if the provider could have matched a shorter unit.

Append-only is **auto-on** for DeepSeek, local llama.cpp-family, Xiaomi, loopback, and `compat.supportsStore === true`. Anthropic / many cloud models run **without** it unless `provider.appendOnlyContext: on`. Provider-side cache still applies; OMP just does not freeze object identity.

### 3.2 Pipeline position (why overlay can be measured)

```text
Agent.state.messages
  → transformContext()          ← ICM overlay (pi.on("context"))
  → convertToLlm()
  → normalizeMessagesForProvider()
  → AppendOnlyContextManager.syncMessages()   ← sees projected bytes
  → transformProviderContext()  ← can still bust cache without changing digests
  → provider
```

A `context` handler rewrite is visible to the cache manager. A late `transformProviderContext` rewrite is **not**. Fixture snapshots must be taken from the **provider-bound** message list after normalize, or first-divergence will disagree with `cacheRead`.

### 3.3 Operation → expected frontier

| ICM action | Host layer that moves | Expected provider effect |
|---|---|---|
| Tail pin (append / replace last message) | Digest at `n-1` | Prefix `[0, n-1)` readable; write/miss on pin + new user turn |
| Compress-tool self-footprint scrub (tail args only) | Near-tail digest | Same as tail pin if the large summary sat at the end |
| Deep compress replacing messages from index `k` | Digest at `k`; suffix replay | Read `[0, k)`; write/miss `k..end`. DeepSeek may miss the whole unit on that turn |
| System pin / system-prompt edit | `StablePrefix` fingerprint | Tools+system miss; message log stability does not save the system block |
| Mid-history pin at `i` | Digest at `i` | Read `[0, i)`; write/miss the rest. Cost ≈ suffix tokens, not full history |
| Overlay+seal (custom `CompactionResult`, shorter array) | Compaction shrink → `log.clear()` | Client prefix gone. Provider may still hit a new short prefix next turn |
| Native compaction (LLM / snapcompact) | Same shrink path | Same as seal for cache; plus extra summarizer tokens/USD |
| Tool schema / `intentTracing` / prune-descriptions | `StablePrefix` | Entire cache, including messages |

### 3.4 Dependencies this file does not re-close

- Exact digest / fingerprint algorithm, object-identity tests, `#3406` cases → H3.
- Pressure floor `max(provider, stored estimate)` and seal hook → H1.
- `context` event copies and handler order → H2.
- Whether overlay+seal is the v1 product target → `DECISIONS.md` (working: C).

---

## 4. Proposed measurement fixture (QOL, not product)

Goal: produce an E5 table that can confirm or overturn the four cache hypotheses **in USD**, on real models, without writing live `~/.omp`.

### 4.1 Arms

Same workload, four isolated sessions (one process each):

| Arm | What the model sees | What native compaction does |
|---|---|---|
| **A native** | Canonical journal only | Host default (`snapcompact` on 17.3.4) |
| **B overlay** | `pi.on("context")` projection (compress ranges; no seal) | Host default still sees stored-history floor |
| **C overlay+seal** | Same projection, plus `session_before_compact` custom `CompactionResult` | One native boundary, no second LLM summary |
| **D overlay+pin** | Overlay + tail-zone pin of a seeded fact | Host default; pin must survive projection |

`overlay+pin` is **three variants, never averaged**: `pin-tail`, `pin-system`, `pin-mid` (same split as `designs/eval-metrics.md`). Optional later: **B-deep** (compress from an early anchor).

Do not add a “tree” arm until flat pin has E4/E5. Condensed contract: [`designs/eval-metrics.md`](../designs/eval-metrics.md).

### 4.2 Shared script (the independent variable)

One frozen transcript, not a free agent:

1. Seed a long, **byte-stable** prefix: system-sized instructions + N tool-result blobs (enough to exceed Anthropic/OpenAI minima; target ≥8k prompt tokens before the first intervention).
2. Turn T0–T2: identical user pings so every arm writes a warm cache (`cacheRead` should leave 0 on T0 and rise on T1/T2).
3. Intervention turn Ti: arm-specific action (no-op / compress last K / compress+seal / tail-pin a unique token).
4. Turn Ti+1–Ti+3: ask for a fact that lives **before** the intervention and a fact that lives **in** the compressed range.
5. Stop. No extra tools, no model-chosen compress.

Same `provider/model`, same `cacheRetention`, same `appendOnlyContext` setting, same time-of-day window (DeepSeek peak). Record the catalog `model.cost` snapshot in the artifact.

### 4.3 Metrics (per turn and session totals)

| Metric | Source | Notes |
|---|---|---|
| `input` | `AssistantMessage.usage.input` | Miss / uncached bucket |
| `output` | `usage.output` | Includes thinking when folded in |
| `cacheRead` | `usage.cacheRead` | Hit tokens |
| `cacheWrite` | `usage.cacheWrite` | 0 on DeepSeek/Z.AI/Gemini by mapping |
| `promptTokens` | `input+cacheRead+cacheWrite` | Occupancy |
| `hitRatio` | `cacheRead / promptTokens` | Not a boolean hit/miss |
| `nativePressure` | `compactionContextTokens(provider, storedEstimate)` | H1 floor; overlay-only must **not** drop this |
| `contextDisplay` | `getContextBreakdown().usedTokens` | Display only |
| `firstDivergence` | digest index vs previous turn’s normalized messages | Host does not export this; port H3 `#messageDigest` in the harness |
| `suffixTokens` | estimate from index `d` to end | Expected write/miss mass |
| `usdHost` | `usage.cost.total` | Catalog `calculateCost` |
| `usdOfficial` | same tokens × official table | Use when catalog lags (DeepSeek peak) |
| `latencyMs` | RPC / assistant timestamps | Secondary |
| `taskScore` | seeded-fact recall + no info-loss | Behavioral, not cache |

Session rollup: `get_session_stats` tokens + cost. If advisors are off (they should be), `getAdvisorStats().tokens` stays zero.

### 4.4 How to compute first divergence in the harness

OMP does not put `d` on `Usage` (H3 gap 1). The harness should:

1. On each `context` event (or `before_provider_request` if that is what H2 freezes), clone the **normalized** messages actually passed to `syncMessages`.
2. Run the H3 digest over consecutive clones.
3. Store `{ turn, d, stableCount, suffixEstimate }`.

Until ICM exists, arm A still works: snapshot `sessionManager.getEntries()` / `buildSessionContext` messages and digest those. Arms B–D need the projected list or the number is the journal index, not the wire index.

### 4.5 Pass / fail shape (not a product gate)

The fixture **records**. It does not fail the build because DeepSeek missed a unit. Suggested read of the table:

- Arm A is the baseline USD and `hitRatio` after T2.
- Arm B should drop `promptTokens` and **not** drop `nativePressure` (Q1 / H1).
- Arm C should drop both `promptTokens` and `nativePressure` after seal, with a one-time cache reset (divergence 0 or log clear).
- Arm D should keep `hitRatio` near A on Ti+1 if the pin was tail-only, and recall the pinned fact after later compress.

Reject a design that buys overlay savings by collapsing `cacheRead` so hard that `usdHost` exceeds native on a 3-turn tail.

### 4.6 Recommended first models

| Model | Why |
|---|---|
| `deepseek/deepseek-v4-flash` | Auto append-only; hit/miss spread is large; `cacheWrite=0`; already used in QOL L6 |
| `zai/glm-4.5-air` | Cheap implicit cache; second L6 provider |
| One Anthropic Sonnet (4.6 or 5) with `appendOnlyContext: on` | Only way to see **write premium** + `cttl` |
| Optional GPT-5.6+ Responses | Only way to see OpenAI **1.25× writes** vs older free writes |

Do not mix providers inside one arm. A four-arm × two-provider matrix is enough for v1.

---

## 5. Hypotheses to test

These are the 2026-08-09 / H3 structural claims, restated as **measurable** statements. A later L6 run should mark each confirmed / overturned / provider-specific.

### H-tail — tail pin is cheap

After a warm prefix, replacing or appending only the last message keeps `firstDivergence >= n-1` (or `n` if pure append). `cacheRead` on Ti+1 stays within a small band of the pre-pin hit. Extra USD ≈ `rate_write_or_miss * (pinTokens + newUserTokens)`, not `* fullPrompt`.

**Would overturn:** pin renderer injects at list head (ACM default; rejected in D3) or rewrites system/tools.

### H-system — system pin is expensive

Editing `systemPrompt` (or adding a system-kind pin that is spliced into the frozen prefix) changes `StablePrefix` fingerprint. Next turn: `cacheRead` near 0 on tools+system, `cacheWrite` (Anthropic/GPT-5.6+) or `input` (DeepSeek/Z.AI) ≈ full prefix. USD step is visible in `cost.cacheWrite` or `cost.input`.

**Would overturn:** provider treats system as a separate independently hashed segment that survives tool-identical requests **and** OMP keeps the old system bytes on the wire (contradicts current StablePrefix).

### H-mid — mid-history pin is expensive

A pin inserted or rewritten at index `i` in a long suffix yields `firstDivergence == i` and `suffixTokens ≈ promptTokens - prefixTokens`. `cacheRead` ≈ prefix only. Cost scales with **depth**, not with “we touched history.”

**Would overturn:** provider longest-prefix match ignores the mutated middle (DeepSeek’s unit rule already says it will **not** on the first rewritten turn).

### H-deep — deep compress invalidates from the anchor

Compressing `[k, m]` and leaving `[0, k)` byte-identical yields `firstDivergence == k`. `[0, k)` remains cache-readable on Anthropic/OpenAI/OMP-append-only. The suffix including the synthetic summary is a write/miss. Native seal after that **clears** the append-only log (shrink), so the next turn is a new prefix write even if the sealed summary is short.

**Would overturn:** `syncMessages` still cleared the whole log (pre-#3406). H3 says it does not, except on shrink.

### Secondary hypotheses (same fixture)

| Id | Claim |
|---|---|
| H-floor | Arm B `nativePressure` stays ≈ stored estimate; only C drops it. Already E2 in H1; re-check with live usage. |
| H-scrub | Scrubbing compress-tool args at the tail costs a near-tail rewrite; leaving the full summary in the projected tool call costs a larger suffix. |
| H-ttl | Idle ≥5 min on Anthropic short retention: next turn `cacheRead=0` and a 1.25× write of the whole prefix. Idle ≥30 min on OpenAI 5.6: same with 1.25×. DeepSeek may still hit hours later. |
| H-ds-unit | On DeepSeek, `A+B` → `A+X` is a full miss on that turn; `A` becomes hittable only on the following request. |

---

## 6. How an L6 e2e should record cost without killing live `~/.omp`

Copy the advisor L6 isolation. Do not invent a second config-root story.

### 6.1 Isolation contract (already proven)

`PI_CONFIG_DIR` is a **directory name under homedir**, frozen at process start (`plugin/test/setup.ts`, host `DirResolver`). Live user root is `~/.omp`. A name that is not `.omp` writes to `~/<name>/`.

Required:

| Rule | How |
|---|---|
| Never write `~/.omp` | `PI_CONFIG_DIR=.omp-qol-e2e-cache-<runId>` (prefix `.omp-qol-` is what `official-install.ts` allows under the live homedir) |
| Never write `test-workspace/.omp` | Scratch git workspace under `.sandbox/scratch/`; `assertSafeIsolation` already refuses the live test-workspace tree |
| Never copy live sessions / WATCHDOG / user `config.yml` | Seed **only** credential + model-registry files into `<isolated>/agent/` |
| Still able to call real models | Copy `agent.db` (+wal/shm), `models.db` (+wal/shm), `models.yml`/`models.yaml`, `.env`, `kimi-device-id` from `~/.omp/agent` — same list as `.sandbox/e2e-workspace-advisor.ts` |
| Neutralize advisors | Generated scratch `config.yml`: `setupVersion: 1`, `modelRoles.advisor` pinned to an unresolvable selector, `advisor.syncBacklog` unset or `"0"` unless the arm needs advisors |
| Plugin install | `omp plugin install omp-qol-plugin` **inside** that env; never `~/.omp/plugins` |
| Process hygiene | Kill only the omp the harness spawned; EBUSY-tolerant scratch delete; leave-behind on failure is acceptable |
| Artifact home | `.sandbox/e2e-artifacts/run-<stamp>/` — frames, per-turn usage, `session-stats.json`, isolation manifest, `EVIDENCE.md` |

Unit tests keep using pid-scoped `.omp-qol-test-root-<pid>` via `plugin/test/setup.ts`. L6 must **not** reuse that root (it is wiped on preload).

Fallback if credential seed cannot resolve models: real config root **plus** a project-scope neutralization overlay, recorded as inconclusive-risk in evidence — same as advisor L6. Prefer not to take it.

### 6.2 What to record each turn

```text
rpc prompt
  → wait for assistant stop
  → get_session_stats                          # cumulative
  → delta = post.tokens.* - pre.tokens.*       # per-turn buckets
  → read last assistant usage from session file or dump
  → harness firstDivergence(prevNorm, nextNorm)
  → nativePressure from getContextBreakdown + stored estimate if exposed
  → append row to cache-cost.jsonl
```

Do not scrape the developer’s `~/.omp/agent/sessions`. The isolated root has its own `agent/sessions` after the first turn; that is the only journal the harness may read.

### 6.3 Cost without burning the author’s session

- New session id every arm (fresh `omp` in a fresh git scratch).
- Cheap models first (Flash / Air). Anthropic/OpenAI write-premium arms are opt-in and short (warm + one intervention + two probes).
- Cap: abort an arm if `usdHost` exceeds a harness constant (suggest $0.50 unless overridden).
- Advisors off so side-channel tokens do not pollute `get_session_stats` (task-tool usage is also folded in — do not enable `task` on this fixture).

### 6.4 What this L6 is not

- Not a live `test-workspace` session.
- Not a write into the author’s WATCHDOG or advisor roster.
- Not a substitute for H3 unit tests (those already prove prefix object identity without USD).
- Not product code in `plugin/src`. Harness belongs under `.sandbox/` when someone implements it.

---

## 7. What would change the fixture

| Change | Effect |
|---|---|
| Host exports `#longestStablePrefix` / a public divergence helper | Drop the harness digest port; read `d` from the host |
| Catalog picks up DeepSeek peak/off-peak | `usdHost` becomes trustworthy again; drop the official overlay |
| Anthropic default TTL or minima change | Warm-up length and idle hypothesis change |
| GPT-5.6 write charges appear on the models QOL actually uses | Overlay+pin vs mid-pin USD gap gets larger |
| H2 shows `context` handlers run after another extension | Fixture must pin plugin order or first-divergence is not ICM’s |

---

## Sources

**Host @ `de6b7974a0`**

- `packages/catalog/src/types.ts` — `Usage`
- `packages/catalog/src/models.ts` — `calculateCost`, `cttl` 5m/1h
- `packages/catalog/src/models.json` — `deepseek/deepseek-v4-flash` $0.14 / $0.0028 / $0.28, `cacheWrite: 0`
- `packages/coding-agent/src/session/session-stats.ts` — session rollup
- `packages/coding-agent/src/session/session-advisors.ts` — `AdvisorStats` / `#computeAdvisorStat`
- `packages/coding-agent/src/session/agent-session-types.ts` — `SessionStats`
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts` — `get_session_stats`
- `packages/coding-agent/src/config/append-only-context-mode.ts` — auto-on DeepSeek/local
- `packages/agent/src/append-only-context.ts` — prefix + first divergence
- `packages/agent/src/compaction/compaction.ts` — `calculatePromptTokens`
- `packages/agent/src/compaction/pruning.ts` — `cacheWarmSuffixTokens`, 8k / 30 min guards
- `packages/ai/src/providers/openai-shared.ts` — DeepSeek hit/miss, `prompt_cache_key`
- `packages/ai/src/providers/anthropic.ts` — `cache_control` placement
- `packages/ai/src/providers/openai-responses.ts` — Responses cache key / breakpoints
- `docs/session.md` — persisted `usage.cacheRead` / `cacheWrite`

**QOL isolation already shipped**

- `.sandbox/e2e-workspace-advisor.ts`, `.sandbox/lib/official-install.ts`
- `plugin/test/setup.ts`
- `docs/dev/journal/phase-004-l6-multi-advisor-e2e.md`

**Provider docs (retrieved 2026-08-16)**

- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://api-docs.deepseek.com/guides/kv_cache
- https://api-docs.deepseek.com/quick_start/pricing
- https://docs.z.ai/guides/capabilities/cache
- https://docs.z.ai/guides/overview/pricing

**Workspace**

- [`host-cache.md`](./host-cache.md) (H3)
- [`host-compaction.md`](./host-compaction.md) (H1)
- `questions/open-questions.md` Q8
