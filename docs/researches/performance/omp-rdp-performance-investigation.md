# Research: OMP TUI Performance Under Remote Desktop (RDP) (v17.2.4 installed / source @ v17.2.8)

Date: 2026-08-08 · Source: `ref_repos/oh-my-pi` (packages/tui + packages/coding-agent)

## 0. Symptom

OMP feels extremely laggy when run inside a Remote Desktop session (Windows Terminal over RDP),
while native sessions are fine. It reads like a recent regression: shimmer is only *one* of several
animation sources, there is no master animation-reduction setting, and **even scrolling the
terminal** stutters while OMP is running.

Verdict up front: **not a single bug — OMP's workload is the worst case for every layer of the
RDP terminal pipeline, while video/Electron take entirely different pipelines.** Since 2026-05-21
OMP accrued ≥5 concurrent 30fps-class animation sources; each frame is a `WriteFile` through
ConPTY into Windows Terminal, whose Atlas renderer drops to CPU-bound Direct2D "remote" mode over
RDP (microsoft/terminal#13816/#13079); the resulting animated truecolor glyph deltas defeat RDP's
text caching and never qualify for the fast AVC path; and OMP's throttling only measures its own
JS frame cost, never the terminal's drain latency — so the 30fps cadence persists under
congestion, ConPTY pipe backpressure queues writes (the very scenario OMP's 64 MiB
`OutputBacklogGuard` exists for, #6854), and input/scroll handling starves. Video plays fine
because RDP redirects or AVC-encodes it; Electron is fine because it is event-driven and
cache-friendly — neither touches ConPTY/VT/text-codec lanes at all.

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

## 5. Why RDP specifically — and why video/Electron don't lag while OMP does

The premise "RDP handles video and Electron fine" is correct, and it is the key clue: those
workloads **use different pipelines**, not that RDP is generally fast. OMP's workload is the
worst case for every layer in its specific pipeline:

### 5.1 What video and Electron actually do over RDP

- **Video playback** mostly never traverses the remote rendering path at all: RDP multimedia
  redirection ships the compressed bitstream to the client for local decode/render (Microsoft
  docs: "Graphics encoding over the Remote Desktop Protocol"); failing that, the frame classifier
  detects video content and routes it to the high-framerate AVC/H.264 path. No ConPTY, no VT
  parsing, no glyph rasterization on the server.
- **Electron/Chromium UI** renders large, contiguous blits, is event-driven (no writes while
  idle), self-paces via rAF, and produces cache-friendly deltas — exactly what RDP's delta
  detection + caching and text/image codecs are optimized for.

### 5.2 What OMP does instead — worst case at four layers

1. **Server-side Windows Terminal rendering degrades to CPU.** In remote/GPU-less sessions,
   `D3D11CreateDevice` returns a software or remote device, and WT's Atlas engine switches to a
   Direct2D mode that "send[s] draw commands across RDP instead of rendering the data on the
   server" (microsoft/terminal PR #13816, fixing #13079). The pre-fix bug pegged a CPU core on
   *a blank terminal with a blinking cursor* inside a VM. Terminal repaints over RDP are
   fundamentally CPU-expensive — unlike the GPU path video/Electron content rides.
2. **RDP's encoding is optimized for cacheable text deltas, not animated truecolor glyphs.**
   Mixed-mode encodes ~80% text content with a custom text codec + delta detection + caching.
   Shimmer/streaming defeats all three: every frame mints fresh HSL gradient colors (new RGB per
   cell per frame → glyph/text cache misses), dirty regions are small moving bands (never large
   enough for the classifier to promote them to the fast AVC "video" path), and 30fps cadence
   re-encodes them losslessly every frame. Small scattered text deltas are precisely the
   documented slow lane of RDP graphics.
3. **ConPTY flow control turns slow consumption into event-loop stalls.** ConPTY transports over
   pipes that historically lack overlapped I/O (microsoft/terminal#262; overlapped support landed
   only via #17510 in recent builds): when WT — busy CPU-rendering per point 1 — drains slowly,
   the pipe backpressures; `process.stdout.write` then returns `false` (bytes queue in Bun's
   writable buffer) or blocks in `WriteFile`. OMP's own code documents this failure mode:
   `OutputBacklogGuard` with `MAX_STDOUT_BACKLOG_BYTES = 64 MiB` (terminal.ts L143-200, #6854) —
   "cosmetic frames (the `hub wait` spinner, 500 ms progress snapshots)" pile onto a
   "stalled-but-alive" PTY consumer until OMP declares it disconnected. Long before the 64 MiB
   cap, that queued growth + Bun's write-path work is what starves stdin handling → input lag.
   OMP's throttling (§2) never observes this: it measures JS compose cost only.
4. **Every input event pays compounded latency.** Keystroke: RDP client → server → WT → ConPTY →
   OMP stdin; if OMP's loop is busy composing frame N / queueing writes, the event waits;
   OMP's reply write then traverses ConPTY → WT CPU render → RDP encode. Animation frames
   inserted at 30fps continuously contend for the same CPU and pipe the input response needs.

### 5.3 Summary table

| Layer | Video | Electron | OMP/terminal |
|---|---|---|---|
| Server render | bypassed (redirection) or GPU encode | GPU/SW compositor, idle-quiet | Atlas D2D software/remote mode (CPU-heavy, #13816) |
| RDP encode path | AVC high-framerate / client-side | delta+cache friendly blits | lossless text codec on uncacheable animated glyphs, small dirty rects |
| Transport pacing | 30-60fps coherent frames | event-driven | 30fps × N concurrent sources, 16 KiB-chunked WriteFiles |
| Backpressure | none relevant | Chromium self-paced | ConPTY pipe → Bun queue (#6854 guard), OMP throttle blind to drain |

ConPTY is always in the loop for OMP (`isConPTYHosted()`, writes capped at 16 KiB per
`WriteFile`, `chunkForConPTY`), and the `WT_SESSION`-gated extras (forced truecolor §4, DEC 2026,
OSC 11 polling) all fire in exactly this environment.

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

## 7. Why typing stutters even when OMP is idle (per-keystroke path audit)

Exclusion constraint from the field: typing in a **completely idle** OMP still lags over RDP.
At idle there are zero animation repaints (§3.2), so the cause lives in the per-keystroke
pipeline itself:

### 7.1 Input side — before OMP even sees the key

- RDP input channel RTT, then WT → ConPTY input pipe (synchronous-pipe heritage, #262).
- `StdinBuffer` holds (stdin-buffer.ts): **Enter is held up to 10 ms** for raw-paste
  classification (`RAW_PASTE_CLASSIFICATION_TIMEOUT_MS`, L70); **printables up to 25 ms** Kitty
  double-report dedup window (`KITTY_PRINTABLE_DEDUP_WINDOW_MS`, L32) whenever the Kitty
  keyboard protocol is active; **partial ESC up to 150 ms** (`PARTIAL_HOLD_MAX_MS`, L45).

### 7.2 Processing side — OMP JS work per key

- `editor.ts #handleInputChunk`: one `parseKey` + ~35 keybinding probes per key (comment L1152).
- `CustomEditor.decorateText` runs on every render: magic-keyword probes, three gradient
  highlight passes, queue-shorthand parse (custom-editor.ts L469-504).
- Scoped compose re-renders the editor subtree — which includes the status-line top border
  (interactive-mode.ts L780 `setTopBorderProvider`) — then diffs the whole frame row buffer.
- **Echo is deliberately frame-throttled**: `#scheduleRender` (tui.ts L2367) imposes up to 33 ms
  cadence delay (`MIN_RENDER_INTERVAL_MS`) plus an adaptive floor of up to 200 ms when the
  previous frame was costly (L2374). The typed character waits up to a 30fps frame interval
  before OMP even starts painting its echo — invisible natively, stacked on top of 2×RTT over
  RDP.
- **ConPTY post-full-paint settle**: after ANY full paint, throttled renders are deferred up to
  150 ms (`#CONPTY_POST_FULL_PAINT_SETTLE_MS = 150`, tui.ts L994, L2281-2311). A resize, Ctrl+O,
  or display reset mid-typing silently absorbs the next keystrokes' echoes into the settle
  window.

### 7.3 Output side — what one keystroke writes

- Not just the typed glyph: the **entire composer row(s) are rewritten as full styled
  truecolor lines** + `\x1b[K`, wrapped in the PAINT_BEGIN/END frame (cursor hide, DEC 2026
  begin/end, autowrap toggles). That is O(row-width) styled content per key vs a plain shell's
  O(1) echo — WT must re-rasterize the row's glyph runs and present a frame, over RDP in the
  Atlas D2D software/remote mode (§5.2).

### 7.4 Idle background work that can still contend

- Magic-keyword composer shimmer: typing `ultrathink` / `orchestrate` / `workflowz` into the
  focused composer starts a **70 ms repaint loop** (custom-editor.ts L447-452, L471-473;
  setting `magicKeywords.enabled`, settings-schema.ts L1871).
- OSC 11 appearance poll (30 s, WT): query + stdin reply parsing.
- LSP idle check (`lsp/client.ts`), memories heartbeat, telemetry flush — light, but they share
  the event loop with input handling.
- Git branch segment is `fs.watch`-driven (status-line component.ts L647-690), not a poll timer.

### 7.5 Built-in diagnostic OMP ships

- `LoopWatchdog` (loop-watchdog.ts) logs `ui.loop-blocked` with a loop-phase tag whenever the
  event loop stalls >250 ms (tui.ts L1110 note; agent-session.ts L2110). **Checking the OMP log
  for `ui.loop-blocked` entries during an RDP session attributes stalls to their phase** — the
  cheapest way to confirm which layer is blocking while typing.

### 7.6 Bottom line for idle-typing lag

Per-keystroke echo latency over RDP ≈ RTT_in + StdinBuffer holds (0–25 ms) + JS handling +
render-throttle hold (up to 33–200 ms) + write + WT software-render frame + RDP text encode +
RTT_out. With even a 30 ms network RTT, each character lands ≥150 ms late, before any §5 CPU
contention. Video/Electron keystrokes pay none of this: no frame-throttled terminal repaint
stands between key event and pixels.

## 8. Can GPU rendering be enabled? (requested follow-up, 2026-08-09)

Short answer: **OMP itself has no GPU rendering to enable — it never renders pixels at all.
The only pixel renderer in the chain is the terminal emulator (Windows Terminal here), and WT's
GPU/software choice is not a setting you can flip; it is decided by whether the RDP session
exposes a hardware graphics adapter.**

### 8.1 OMP has zero GPU pipeline (verified)

- Full-tree grep for GPU/WebGL/WebGPU/canvas rasterization paths: none. The only "canvas" is
  `packages/utils/src/vendor/mermaid-ascii/` — a pure *text-cell* grid, no graphics API.
- `pi-tui` architecture (packages/tui/README.md L1-8, L509-537): differential rendering that
  emits ANSI/VT strings via `Terminal.write(data: string)`. Pixel rasterization is delegated to
  whatever terminal hosts it. There is no OMP setting, env var, or code path that changes this.
- So "enable GPU rendering for OMP" reduces to "make the hosting terminal render on GPU".

### 8.2 How Windows Terminal actually picks GPU vs software (Atlas engine)

- Atlas creates a D3D11 device at startup. **If `D3D11CreateDevice` picks a *software or remote*
  device (WARP / Microsoft Basic Render Driver / remote display adapter), Atlas switches to
  `d2dMode`: a Direct2D backend that sends draw commands across RDP instead of rendering on the
  server** (microsoft/terminal PR #13816, merged for WT 1.16, 2022-08). Pre-fix, the same
  scenario pegged a CPU core on a *blank* terminal (#13079).
- The decision is made once, at device creation, and does not re-evaluate on session changes
  (author stated in the PR discussion that automatic per-display switching was not implemented).
- WT's settings surface offers **no option to force GPU**: the only renderer-related setting is
  `experimental.useAtlasEngine` (Atlas vs the legacy engine), plus an internal debug `useWARP`
  (which forces the *software* direction, not hardware).
- Consequence: **in an RDP session without a hardware graphics adapter, Atlas can never run on
  GPU regardless of terminal choice or configuration.** Default RDP sessions use the Microsoft
  Basic/Remote Display Adapter → software D3D device → `d2dMode`.
- Note for the current environment: Win11 25H2 ships post-#13816 WT, so server-side CPU pegging
  is fixed; the remaining cost of `d2dMode` is that every repaint generates draw commands that
  traverse the RDP channel — latency-bound per frame, which matches §7's idle-typing lag shape
  even without server CPU contention.

### 8.3 The only real way to "enable GPU rendering" for the terminal over RDP

Give the RDP session a hardware graphics adapter so `D3D11CreateDevice` returns a hardware
device; Atlas then uses its GPU backend automatically, and RDP itself can move to
hardware-accelerated AVC/H.264 encoding:

1. On the **remote machine**: `gpedit.msc` → Computer Configuration → Administrative Templates →
   Windows Components → Remote Desktop Services → Remote Desktop Session Host → Remote Session
   Environment → **"Use hardware graphics adapters for all Remote Desktop Services sessions"** →
   Enabled. (Equivalent policy key also cited in Microsoft docs for RDS GPU usage.)
2. The machine must have a physical GPU with a WDDM driver present; restart/reconnect the
   session. Verify inside the session: `dxdiag` Display tab should show the real GPU instead of
   "Microsoft Basic Render Driver".
3. Caveats: RemoteFX vGPU is retired on Win10/11 (security); on desktop hosts the policy above
   suffices (session shares the physical GPU with the console); VMs/cloud need GPU passthrough,
   GPU-P, vGPU, or an N-class instance — a GPU-less VM will stay on software no matter what.

### 8.4 Honest expectation setting

GPU rendering removes exactly one amplifier — server-side rasterization / software-device draw
commands (§5.2 point 1) — and can additionally unlock hardware RDP encode. It does **not**
change: OMP's 30fps frame cadence and per-keystroke full-row truecolor rewrites (§2/§7.3), the
RDP text-codec cache misses on animated glyphs (§5.2 point 2), ConPTY backpressure (§5.2 point
3), or the frame-throttle + RTT echo latency (§7.6). Prediction: meaningful improvement under
animation/heavy output, residual lag for idle typing — consistent with "都不是真实原因" only if
the session currently runs on a software device; `dxdiag` in the RDP session settles that in
one step.

## 9. Why the `display.shimmer` setting only partially helps

Shimmer is one of ≥5 concurrent sources (§3.1). Turning it off downgrades the loader to 80ms
glyph steps but leaves: 30fps smooth streaming (`display.smoothStreaming`, default **true**,
since 2026-07-01 also animating streamed tool-call args), 80ms tool spinners, 70–230ms thinking
dots/pulse, animated pending previews. (The 5/31 animated exec-block border was removed 6/8 and
is not a factor.) There is **no master "reduce motion" setting** — confirmed against
`settings-schema.ts` (`display.*` contains only `shimmer`, `smoothStreaming` L1010,
`hideToolActivity` L1021, `showHardwareCursor`).

## 10. Mitigations available today (settings/env, no code change)

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
| `magicKeywords.enabled: false` | removes the 70 ms composer shimmer trigger while typing | settings.json (L1871) |
| Check OMP log for `ui.loop-blocked` | attributes event-loop stalls to their phase | diagnostics |
| RDS GPU policy (§8.3) | Atlas renders on hardware GPU + RDP can use HW AVC encode | gpedit on remote host, needs physical GPU |

Realistic best config for RDP: `shimmer=disabled` + `smoothStreaming=false` + `hideToolActivity=true`.
This removes essentially all continuous repaints during a turn (spinners/dots remain, event-driven).

## 11. Proposed fix directions (for upstream / omp-qol work)

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

## 12. Evidence index (files)

- `packages/tui/src/tui.ts` L940/L947/L2367/L2374 — render tiers, `#MIN_RENDER_INTERVAL_MS`,
  `#MAX_ADAPTIVE_RENDER_MS`, adaptive backpressure; `requestDirectWrite`; append-only scrollback
  model, ED3 replay.
- `packages/tui/src/components/loader.ts` L5-8, L102 — 30fps/80ms cadences, backpressure constants.
- `packages/tui/src/terminal.ts` L33-66 — WT appearance poll gating, `MAX_CONPTY_WRITE_CHUNK_BYTES`,
  `chunkForConPTY`, `isConPTYHosted`.
- `packages/tui/src/terminal.ts` L143-200, L1682-1731 — `OutputBacklogGuard` / 64 MiB stalled-consumer
  cap (#6854), `#safeWrite` write semantics (`write()` returns false → Bun queues; drain event resets).
- `packages/tui/src/terminal.ts` L804-814 — xterm 1010/1011 scroll-to-bottom deliberately disabled
  while OMP owns the TTY (scroll-into-history is not forced back to tail).
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
- `packages/tui/src/stdin-buffer.ts` L27-70 — per-key input holds (10 ms paste classification,
  25 ms Kitty dedup, 150 ms partial-ESC hold).
- `packages/tui/src/tui.ts` L994, L2281-2311, L2354-2389 — 150 ms ConPTY post-full-paint settle,
  render scheduling/throttle math; L2403-2469 `#handleInput` scoped-render fast path.
- `packages/tui/src/loop-watchdog.ts` — `ui.loop-blocked` event-loop stall diagnostics.
- `packages/coding-agent/src/modes/components/custom-editor.ts` L447-545 — magic-keyword
  composer shimmer (70 ms frames, `magicKeywords.enabled` gate).
- `packages/coding-agent/src/modes/magic-keywords.ts` — keyword list
  (`ultrathink`/`orchestrate`/`workflowz`).
- `packages/coding-agent/src/modes/components/status-line/component.ts` L642-690 — fs.watch-based
  git branch watcher (no poll timer); interactive-mode.ts L733/L780 — editor scoped input render,
  status-line top border inside editor render.
- `packages/coding-agent/CHANGELOG.md` (smoothStreaming entries L3604, L4112),
  `packages/tui/CHANGELOG.md` (17.1.4 #4863, 17.2.4 #7290) — animation feature dates.
- External: microsoft/terminal#13079 + PR #13816 (Atlas switches to Direct2D draw-command-over-RDP
  mode when D3D picks a software/remote device; pre-fix CPU pegging in VMs; decision made once at
  device creation, no user-facing GPU override — PR body + review thread fetched 2026-08-09), microsoft/terminal#262
  + PR #17510 (ConPTY pipes historically synchronous, no overlapped I/O), Microsoft Learn "Graphics
  encoding over the Remote Desktop Protocol" (mixed-mode text codec + caching vs AVC video path,
  multimedia redirection), `packages/tui/README.md` (VT-string-only rendering architecture, no
  GPU surface), Microsoft Learn profile-advanced settings (`experimental.useAtlasEngine` is the
  only renderer setting), RDS group policy "Use hardware graphics adapters for all Remote Desktop
  Services sessions" (Remote Session Environment node).
