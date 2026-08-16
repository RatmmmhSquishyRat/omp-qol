# Overlay engine (draft, not frozen)

**date:** 2026-08-16
**keeps:** 2026-08-09 `07-CONTEXT-OVERLAY-ENGINE.md` as the starting design
**adds:** 17.3.4 lock + I1 inherit list. Schema still unfrozen (OV13).

## Layers

```text
canonical journal (lossless)
        ↓
QOL overlay: compress / expand / pin   (context hook)
        ↓
when native pressure requires a boundary
        ↓
seal via session_before_compact.compaction   (architecture C)
```

Do not let overlay-only pretend to own headroom.

## Persistence

`appendEntry` custom events on the active branch. Tombstones, no in-place edits, no sidecar DB.

## Projection order (inside one handler)

native journal walk → replay overlay → valid blocks → protocol-safe closure → summaries → self-footprint scrub → pins → sanitizer → return `AgentMessage[]`.

Host then: steering wrap → `convertToLlm` → provider normalize.

## Block states

`active-overlay` | `disabled` | `shadowed` | `sealed-native-compaction` | `invalid-source`

Independent of `CompactionEntry` so C can migrate to D.

## Still to freeze before code

- Overlay event schema and non-overlap / shadow rules
- Protocol-safe closure + reject UX (U1: never silent extra compress)
- Sealed expand: `rehydrate` / `branch` / `exactExpandAvailable: false` (must be visible)
