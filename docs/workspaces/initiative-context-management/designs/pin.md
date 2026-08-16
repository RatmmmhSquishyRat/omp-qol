# Initiative Pin (draft, not frozen)

**date:** 2026-08-16
**depends on:** D3, D4, H3, `08-PIN.md`, pillars
**status:** working defaults for design/eval. Q7/Q8 stay open until provider-measured E4/E5.

No shipped product is InitiativePin. Each neighbor occupies one cell. Do not copy them as a template.

## Working defaults

| Knob | v1 default | Do not copy |
|---|---|---|
| Kinds | Spec has source / snapshot / instruction. Ship instruction + source first; snapshot when the agent asks to freeze. | PR 9097 user-only; btw instruction-only |
| Render | One provider-neutral block (`<pinned-context>` or equivalent). Tool results are text, not raw `toolResult`. | ACM/PR 9097 raw `unshift` |
| Placement | **tail-zone / turn-frontier** (after completed history, before current user/steer) | btw system+last-user dual inject; ACM **head**; PR 9097 after compaction marker |
| System | Off unless instruction-class and explicit `placement: "system"` | btw / CLAUDE.md / Rules as the only pin |
| Mid / anchor | Experimental, eval-gated | Ship as default |
| Scope | **branch** + tombstone. Session-wide only if explicit. | `acm.db` / btw sidecar |
| Compaction | Default **request-only**. Opt-in `salient` (host compact extra-context). Opt-in `preserve` (re-project from journal after seal). | Pin ⇒ never compact |
| Driver | Agent pin/unpin/list/preview. User may also pin. | Slash-only btw |
| File follow | Pointer + bounded render, or snapshot | Cursor-style re-embed live file chunks every turn |
| Tree | **Deferred.** Flat pin first. | Tree as pin storage |

```text
kind:        caller chooses (no silent default)
scope:       branch
placement:   tail
compaction:  request-only
priority:    0
```

## Identity

Pins persist as overlay events citing `EntryAddress` / `RangeAddress` (`designs/address-layer.md`). A pin is a salience **intent**, not a copied provider message.

## PinStateTree

Depends on this API. Not in v1. First experiment after flat pin E4: one workflow tree (3–5 steps) + one profile tree vs manual pin/unpin.

## Name collisions — not this pin

| Name | What it actually is |
|---|---|
| OMP `/session pin` | OAuth **account** lock for the session |
| Codex `isPinned` | Thread **picker** favorite; does not change model context |
| npm / plugin `@version` | Install lock |
| DCP “protect” | Auto-policy keep, not a salience intent |

## Overturn

See `research/pin-ecosystem.md` §7. If OpenCode (or OMP) ships a native **context** pin, wrap it (ADR-004) instead of emulating the same flag.
