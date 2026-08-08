# Research: OMP TUI Performance Under Remote Desktop (RDP) (v17.2.4 installed / source @ v17.2.8)

Date: 2026-08-08 · Source: `ref_repos/oh-my-pi` (packages/tui + packages/coding-agent)

## 0. Symptom

OMP feels extremely laggy when run inside a Remote Desktop session (Windows Terminal over RDP),
while native sessions are fine. It reads like a recent regression: shimmer is only *one* of several
animation sources, there is no master animation-reduction setting, and **even scrolling the
terminal** stutters while OMP is running.

Verdict up front: **not a single bug — a cost stack.** Since 2026-05-21 OMP accrued ≥5 concurrent
30fps-class animation sources; each animation frame is a `WriteFile` through ConPTY into Windows
Terminal, whose renderer degrades over RDP (software/Atlas path, see microsoft/terminal#13079);
every write forces a WT repaint + RDP re-encode; OMP's throttling only measures its own JS frame
cost and never the terminal's drain latency, so the 30fps cadence persists under congestion and
writes queue up until the event loop stalls. Scroll lag follows from the same pipeline (writes keep
landing while the host reconciles scroll position, plus unbounded full-transcript replays).

## 1. Regression timeline (git history + changelogs)

Before 2026-05-21 the TUI had no continuous animations — redraws were event-driven only.

| Date | Change | Ref |
|---|---|---|
| 2026-05-21 | Shimmer animation introduced (loader + progress sweeps) | `dca24b61b` ✓ |
| 2026-05-22 | `display.shimmer` setting added (classic/kitt/disabled) + loader cadence tuning | `e39b48c40` ✓ |
| 2026-05-31 | Animated pending border for bash/eval blocks — **removed again 2026-06-08** (`fe5d27c4a`); lived 8 days | `ebb927639` ✓ |
| 2026-06-07 | **Smooth streaming: 30fps streaming-reveal, `display.smoothStreaming` default `true`** | `b65851d50` ✓ |
| 2026-06-12 | Shimmer extended to running jobs / detached task rows | `cfeaee010`, `23a1e244b` |
| 2026-06-14 | Magic-keyword glow + focused editor shimmer; phase-locked parallel tool spinners | `784fd5650`, `b85f59991` |
| 2026-06-15 | Animated thinking pulse for hidden thinking blocks | `6b1ba425d` |
| 2026-06-19 | Rainbow-animated `NEW!` tags | `9f30e241b` ✓ |
| 2026-07-01 | Smooth streaming extended to streamed tool-call args (write/edit/bash previews) | `19f3058c5` + changelog L3604 |
| 2026-07-03 | Perf: scoped renders + shimmer band fast-path — upstream already chasing this cost | `31ac7e27e` (#4383) |
| 2026-07-11 | Vibe mode "TV wall" (per-worker live screens, 500ms ticks) | vibe tools ✓ |
| tui 17.1.4 (2026-07-26) | **#4863: user-driven `resetDisplay()` (Ctrl+O expand, toggles) now replays the *entire* transcript** — intentional fix of #2115 over-truncation; on ConPTY/RDP it is an unbounded re-encode burst. Biggest single post-17.0 output increase | #4863, commits `0f385b243`/`432e54dfd`/`cc89868cb` |
| 17.0.9 | `mcp.renderMarkdownResults` default true (larger MCP payloads) | changelog |
| tui 17.2.4 (2026-08-01) | #7290 Loader "cost-aware cadence backpressure … while preserving 30fps on cheap frames" — **cost = JS frame cost only, not terminal drain** (commit `b1b6d9962`, verified in tags v17.2.4+) | #7290 |

User has 17.2.4 installed; reference repo is 17.2.8 — all of the above are present in both.
(✓ = commit hash re-verified via `git show` in this workspace.)

## 2. Render pipeline & throttling (packages/tui/src/tui.ts)

Three render tiers, cheapest→costliest:

- `requestDirectWrite(component)` — in-place rewrite of changed rows only
  (`PAINT_BEGIN` + cursor moves + line-rewrite + `\x1b[K`). Animations mostly use this.
- `requestComponentRender(component)` — re-render one subtree (tool spinners use this).
- `requestRender()` — full compose + viewport diff. Most expensive.

Throttling:

- `static readonly #MIN_RENDER_INTERVAL_MS = 1000 / 30` — hard 30fps cap (tui.ts L940).
- `static readonly #MAX_ADAPTIVE_RENDER_MS = 200` (tui.ts L947).
- Adaptive backpressure (tui.ts L2367, L2374):
  `adaptiveFloor = Math.min(#MAX_ADAPTIVE_RENDER_MS, #lastFrameCostMs * 2)` (~50% duty cycle).
- **Blind spot:** `#lastFrameCostMs` is `performance.now()` around compose+write *issue*, i.e.
  JS cost only. `process.stdout.write` is buffered; on a congested ConPTY the terminal consumes
  bytes slowly but the JS side returns fast → frame cost stays low → 30fps persists → writes pile
  up in the ConPTY pipe → eventual event-loop stall → keyboard/scroll input lag.

Loader (`packages/tui/src/components/loader.ts` L5-8, verified):

```ts
const RENDER_INTERVAL_MS = 1000 / 30;          // L5
const SPINNER_ADVANCE_MS = 80;                 // L6
const MAX_RENDER_BACKPRESSURE_MS = 200;        // L7
const RENDER_BACKPRESSURE_MULTIPLIER = 9;      // L8
```

L102: 30fps only when `messageColorFn.animated === true` (i.e. shimmer on); otherwise the plain
spinner steps at 80ms. So `display.shimmer: "disabled"` does downgrade the loader from 30fps to
80ms — but every other source in §3.1 keeps its own cadence.

Same blind spot: backpressure scales with measured *render* cost, never with stdout drain latency.

## 3. Exhaustive animation / redraw source inventory

### 3.1 While the agent is working (the usual RDP pain window)

| Source | Cadence | Trigger | Notes |
|---|---|---|---|
| Loader (thinking line) | 30fps + 80ms glyph step | active turn | shimmer band sweep, 30 cells/s |
| Streaming reveal | 30fps (`STREAMING_REVEAL_FRAME_MS = 1000/30`) | token stream, default ON | `display.smoothStreaming` |
| Tool-args reveal | 30fps w/ backlog | tool call streaming | same controller family |
| Tool spinner | 80ms (`SPINNER_RENDER_INTERVAL_MS`, tool-execution.ts L260) | per running tool | `requestComponentRender`; parallel spinners phase-locked (`b85f59991`) |
| Animated pending preview | per-tool opt-in (`animatedPendingPreview`, tool-execution.ts L673) | pending tool rows | distinct from the removed exec-block border |
| Todo strike-through | 65ms (tool-execution.ts L786) | todo tool updates | one-shot animation |
| Thinking dots/pulse | eased dwell 70–230ms, 8-frame raised cosine (assistant-message.ts L93, L100-101) | assistant thinking, incl. hidden thinking blocks (`6b1ba425d`) | self-rescheduling timeout |
| Vibe TV wall | 500ms (`WAIT_PROGRESS_INTERVAL_MS`, vibe.ts L148) | vibe_wait active | multi-screen re-snapshot |
| Welcome intro | 33ms (~30fps, `INTRO_TICK_MS`, welcome.ts L553, timer L183) | startup, one-shot | first seconds after launch |

### 3.2 At idle

TUI is essentially still (0 repaints). Only periodic activity:

- OSC 11 appearance poll every 30s on win32 + `WT_SESSION` without mode-2031 support
  (`WINDOWS_TERMINAL_OSC11_POLL_MS`, terminal.ts) — a query, not a paint.
- Editor shimmer only while the magic keyword sits in the composer.

### 3.3 Overlays (only while open)

Pause-screen 1s full `requestRender()`; agent-hub 5s full; countdown 1s full; model-hub 80ms full.
Not implicated unless the user keeps overlays open.

## 4. Byte volume & truecolor amplification

- `detectColorMode()` (theme.ts L1285-1301): truecolor whenever `COLORTERM=truecolor|24bit` **or
  `WT_SESSION` is set**; otherwise truecolor unless `TERM` is `dumb|""|linux`.
  → In an RDP+Windows-Terminal session truecolor is effectively forced, and there is **no setting
  to disable it**. The only env escape hatch: unset `WT_SESSION` *and* set `TERM=dumb`.
  (Unsetting `COLORTERM` alone does nothing — the `WT_SESSION` branch still forces truecolor.)
- Truecolor costs ~22 bytes of SGR per styled segment (`\x1b[38;2;R;G;Bm` … `\x1b[0m`) vs ~8 bytes
  for 256-color. Shimmer repaints whole tiered runs per tick, so per-tick cost is dominated by SGR.
- Measured shapes (subagent audit): shimmer tick ≈ 200–300 B → **6–9 KB/s sustained** for the whole
  turn; streaming peaks 15–30 KB/s; a full viewport repaint is 8–32 KB (truecolor, 80-col lines
  ≈ 100–150 B/line) — i.e. a single frame can cross `MAX_CONPTY_WRITE_CHUNK_BYTES = 16 KiB` and
  split into multiple `WriteFile`s (terminal.ts L38-66, #2034/#2095 parked-viewport workaround).
- Bandwidth itself is tiny for RDP — the cost is per-write *repaint + re-encode* latency, not bytes.

## 5. Why RDP specifically (the amplification chain)

1. **ConPTY is always in the loop.** `isConPTYHosted()` is true for every win32/WSL session. Every
   frame = ≥1 `WriteFile` → ConPTY state machine → WT render. Writes are capped at 16 KiB
   (`chunkForConPTY`, newline-preferred cuts), so big frames become several WriteFiles, each with
   per-write viewport tracking.
2. **WT over RDP renders slowly.** The Atlas/DirectX renderer degrades under remote-session GPU
   constraints (microsoft/terminal#13079: sluggishness in VMs/remote; software fallback paths).
   A repaint that costs ~1ms natively can cost an order of magnitude more over RDP.
3. **Every repaint re-encodes for the wire.** RDP ships changed screen regions; an animated
   30fps region (shimmer band, streaming line, spinner) forces continuous dirty-region encode +
   transport even though the byte volume is small.
4. **`WT_SESSION`-gated extras** all fire in exactly this environment: truecolor forced (§4),
   DEC 2026 synchronized output enabled by default (`shouldEnableSynchronizedOutputByDefault`,
   terminal-capabilities.ts — `if (env.WT_SESSION) return true`), OSC 11 appearance polling 30s.
5. **Backpressure never sees the congestion** (§2). Native = write returns fast, animations
   self-throttle; RDP = write still returns fast, terminal is behind, animations don't throttle,
   pipe queues grow, input handling starves.

## 6. Why scrolling the terminal also lags

OMP uses an **append-only native-scrollback model** (tui.ts header, L1-14): committed rows are
immutable; live rows repaint in place at the viewport bottom. Consequences while the user scrolls
through history:

- OMP keeps emitting writes (animations, streaming) at the bottom while WT is trying to hold the
  user's scroll position; ConPTY's per-`WriteFile` viewport tracking (#2034/#2095) must reconcile
  every write with the parked viewport — the exact scenario the 16 KiB chunking comment describes.
- **#4863**: Ctrl+O / `resetDisplay` replays the *entire* transcript (ED3 `CSI 3 J` erase + full
  re-paint). On ConPTY this is unbounded bytes; on RDP it's also a multi-MB re-encode burst. This
  is the most likely single contributor to the discrete "freeze when I scroll/switch views" spikes.
- Full replays (resume, resize, session replace) also go through ED3 + full paint.
- WT over RDP paying per-repaint cost (§5) turns all of the above into visible stutter.

Mouse tracking (`1000h/1003h/1006h`) is only enabled for fullscreen overlays, not normal mode, so
scroll events are handled by the terminal host — OMP adds no mouse-report traffic during scroll;
the lag is purely the repaint/write interference above.

## 7. Why the `display.shimmer` setting only partially helps

Shimmer is one of ≥5 concurrent sources (§3.1). Turning it off downgrades the loader to 80ms
glyph steps but leaves: 30fps smooth streaming (`display.smoothStreaming`, default **true**,
since 2026-07-01 also animating streamed tool-call args), 80ms tool spinners, 70–230ms thinking
dots/pulse, animated pending previews. (The 5/31 animated exec-block border was removed 6/8 and
is not a factor.) There is **no master "reduce motion" setting** — confirmed against
`settings-schema.ts` (`display.*` contains only `shimmer`, `smoothStreaming` L1010,
`hideToolActivity` L1021, `showHardwareCursor`).

## 8. Mitigations available today (settings/env, no code change)

| Mitigation | Effect | How |
|---|---|---|
| `display.shimmer: "disabled"` | loader drops 30fps→80ms, no band sweep | settings.json |
| `display.smoothStreaming: false` | kills the 30fps streaming reveal + tool-args reveal — **biggest single win** | settings.json (L1010) |
| `display.hideToolActivity: true` | removes per-tool activity lines | settings.json (L1021) |
| `tui.hyperlinks: "off"` | drops OSC 8 framing bytes | settings.json (L959) |
| `terminal.showImages: false` | no image protocol payloads | settings.json (L834) |
| `TERM=dumb` + unset `WT_SESSION` | forces 256-color (~⅔ SGR size) — ugly, also loses WT feature detection | launcher env |
| `PI_NO_SYNC_OUTPUT=1` (or `PI_TUI_SYNC_OUTPUT=0`) | disables DEC 2026 synchronized output (verified terminal-capabilities.ts L261-265; `PI_FORCE_SYNC_OUTPUT=1` forces on) | env |
| `terminal.showProgress` | OSC 9;4 taskbar progress, default `false` — leave off | settings.json (~L901) |

Realistic best config for RDP: `shimmer=disabled` + `smoothStreaming=false` + `hideToolActivity=true`.
This removes essentially all continuous repaints during a turn (spinners/dots remain, event-driven).

## 9. Proposed fix directions (for upstream / omp-qol work)

1. **Remote-session detection → auto-degrade.** RDP sessions are detectable
   (`SESSIONNAME`/`WT_SESSION` + RDP env, or slow-drain heuristics); auto-disable smooth streaming
   + shimmer, widen render interval when remote.
2. **Drain-aware backpressure.** Measure stdout *consumption* (write callback latency / buffered
   byte watermark), not just JS frame cost; scale render interval on drain latency in
   `tui.ts` adaptive floor and `loader.ts` backpressure.
3. **Master `display.reduceMotion`** setting gating all animation sources at once.
4. **Bound the #4863 replay** — cap replay bytes or page it on ConPTY; replay is what turns
   "scroll" into a multi-MB re-encode on RDP.
5. Optional: offer a settings-driven color-mode override (truecolor → 256) instead of env hacks.

## 10. Evidence index (files)

- `packages/tui/src/tui.ts` L940/L947/L2367/L2374 — render tiers, `#MIN_RENDER_INTERVAL_MS`,
  `#MAX_ADAPTIVE_RENDER_MS`, adaptive backpressure; `requestDirectWrite`; append-only scrollback
  model, ED3 replay.
- `packages/tui/src/components/loader.ts` L5-8, L102 — 30fps/80ms cadences, backpressure constants.
- `packages/tui/src/terminal.ts` L33-66 — WT appearance poll gating, `MAX_CONPTY_WRITE_CHUNK_BYTES`,
  `chunkForConPTY`, `isConPTYHosted`.
- `packages/tui/src/terminal-capabilities.ts` — DEC 2026 default-on under `WT_SESSION`, mouse
  tracking only for overlays.
- `packages/coding-agent/src/modes/theme/theme.ts` L1285-1301 — `detectColorMode` truecolor forcing.
- `packages/coding-agent/src/modes/theme/shimmer.ts` — shimmer engine, 30 cells/s, settings read.
- `packages/coding-agent/src/modes/controllers/streaming-reveal.ts` — `STREAMING_REVEAL_FRAME_MS`.
- `packages/coding-agent/src/modes/components/tool-execution.ts` L260, L673, L786 — spinner 80ms,
  animated pending preview, todo strike 65ms.
- `packages/coding-agent/src/modes/components/assistant-message.ts` L89-101, L391-396 — thinking
  dots 8-frame eased dwell 70–230ms.
- `packages/coding-agent/src/config/settings-schema.ts` L834, L901, L959, L1010, L1021 — setting
  surface (`terminal.showImages`, `terminal.showProgress`, `tui.hyperlinks`,
  `display.smoothStreaming`, `display.hideToolActivity`).
- `packages/coding-agent/src/tools/vibe.ts` L148, L170-183 — TV wall 500ms progress timer.
- `packages/coding-agent/src/modes/components/welcome.ts` L183, L553 — startup intro 33ms ticks.
- `packages/tui/src/terminal-capabilities.ts` L261-265 — sync-output env overrides.
- `packages/coding-agent/CHANGELOG.md` (smoothStreaming entries L3604, L4112),
  `packages/tui/CHANGELOG.md` (17.1.4 #4863, 17.2.4 #7290) — animation feature dates.
- External: microsoft/terminal#13079 (Atlas renderer sluggishness in VM/remote sessions).
