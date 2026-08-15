# Phase 002: Implicit "default" advisor — first-class visibility, config, toggle

**commit**: `643e513` `feat: manage the host's implicit default advisor through the advisor tool`
**date**: 2026-08-15

## Problem / Background

User clarification (recorded verbatim in the pillar
`docs/ssot/pillars/self-managed-mode-switch/advisor-watchdog.md` §用户澄清):
the default advisor the main agent runs under must be visible, configurable,
and toggleable through the agent tool — in the CLI the user can do all of
this, with no difference from other advisor operations.

Host mechanism: with zero configured advisors, `SessionAdvisors` runs one
implicit advisor `{ name: "default" }` on the advisor-role model (legacy
fallback in `#resolveAdvisorRuntimeDescriptors`). It exists in no WATCHDOG
file. The TUI configure editor seeds a `default` row when the doc is empty
and normalizes a bare `default` entry back to an empty roster on Save
(`advisor-config.ts #ensureRosterVisible` / `#isBareDefaultDoc`).

Gaps found in the tool: empty `list`/`get scope=effective` views did not
mention the implicit default at all (the model would conclude no advisor
exists while one is running), and `upsert` lacked the TUI's bare-default
Save normalization (a no-op file entry would shadow the implicit default).

## Decision

Thin-driver-compliant additions only (both mirror existing TUI behavior):

- `list`/`get` `scope=effective` on an empty merge annotate the body with
  `implicitDefault: true` and a note naming the management path
  (`status` live view; `upsert name="default"` materializes;
  `upsert name="default" enabled=false` pauses only it;
  `remove name="default"` restores the implicit one).
- Mutate save mirrors the TUI bare-default normalization (bare `default`
  doc → `{ advisors: [] }`), with an explicit warning; the shadow warning
  is skipped in that case.
- Tool description documents the implicit-default semantics.
- impl-notes correction: earlier e2e narrative called the resurfacing
  `default` a "user-scope advisor" — wrong (no user WATCHDOG exists);
  corrected with markers, not silently rewritten.

Also fixed a pre-existing test-infra defect exposed while verifying: bare
single-process `bun test` was never green — the host's pi-utils
`DirResolver` freezes the config root at first module load, before the
kill-switch tests could redirect `PI_CONFIG_DIR`. A bun test preload
(`test/setup.ts` + `bunfig.toml`) now freezes an isolated root before any
import; the `package.json` test script is a plain `bun test` again.

## Output

- `plugin/src/advisor-tool.ts` — implicit-default note, bare-default Save
  normalization, description update.
- `plugin/test/advisor-tool.test.ts` — A19 (6 cases); isolation via preload.
- `plugin/test/advisor-integration.test.ts` — I10 (2 real-session cases).
- `plugin/test/setup.ts`, `plugin/bunfig.toml` — preload isolation root.
- `plugin/test/goal-tool.test.ts`, `plugin/test/mode-tool.test.ts` —
  kill-switch tests target the preload root.
- `.sandbox/e2e-workspace-advisor.ts` — 3 new default-lifecycle steps,
  one-word reply instruction, 720s timeout.
- Docs: pillar §用户澄清 (verbatim), design Track A clarification,
  impl-notes Decision 8 + corrections + new test table (95) + L6 9-step
  section, session-001 Turn 9.

## Verification

- L1+L3: 46/46 advisor tests; full suite **95/95** in one `bun test`
  process (previously-failing D2/N12a green; also green per-file).
- Typecheck: plugin `src/` + `test/` zero errors (host `.md` import
  errors unchanged, environmental).
- L6 e2e: **9/9 PASS** on `zai/glm-4.5-flash` — status shows implicit
  `default` (running, `kimi-code/k3`), `upsert name="default"
  enabled=false` → `paused` / `activeCount: 0`, `remove name="default"`
  → implicit `default` back to `running`. Untruncated evidence in run log.
- test-workspace reinstalled; L4 verify PASS (10 advisor ops exposed).
