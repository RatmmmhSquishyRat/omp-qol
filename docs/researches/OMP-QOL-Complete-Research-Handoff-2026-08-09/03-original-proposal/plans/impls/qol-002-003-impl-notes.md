# QOL-002/003 Implementation Notes

Date: 2026-08-05 · Companion to the design doc and ADR-002/ADR-003/ADR-004.

## v4 delivery testing (same day): full pyramid + one real defect caught

User: 薄驱动不等于可以少测 —— 自行完整设计交付级测试。产出与结果：

- 策略文档：`docs/plans/TDDs/qol-delivery-test-plan.md`（L1–L5 金字塔、
  矩阵、复现命令、已知边界）。
- 新增 L2：`test/host-bridge.test.ts`（H1–H6），在真实 AgentRegistry 上
  覆盖 resolver 边界（sub-only/parked/sanity-gate/稳定解析/facade）。
- 新增 L3：`test/integration-real-session.test.ts`（I1–I7），配方取自主
  自己的测试：真实 AgentSession + SessionManager.inMemory + 宿主的
  createMockModel 脚本化模型；生产 resolver 不注入替身。I2/I4 在真实
  agent 循环里调 mode 工具并断言宿主真实状态；I7 证明我们写的状态驱动
  宿主自己的 enforcePlanModeWrite（plan 开启写工作树报错，退出放行）。
- 新增 L5：真实 LLM 端到端（隔离根 ~/.omp-qol + 第三方中转网关 +
  其廉价 flash 模型；具体 provider 名称属个人配置，已从仓库剔除）。plan 场景与 vibe 场景的真实模型转录证据在策略文档 §6。
  环境要点：models.yml 的 apiKey 字段是环境变量名（非 ${VAR} 语法）；
  retry 等宿主配置属于 config.yml，混入 models.yml 会令严格 schema 静默
  禁用 provider；部分网关被网络中间设备替换证书（bun 校验失败），弃用，
  改用 TLS 正常的网关。
- **真实缺陷**：L5 首跑发现 vibe_enter 后宿主 director 工具集整体替换
  活动集，`mode` 工具被踢出，agent 失去退出开关（模型报告 Tool mode
  not found）。修复：base 集合保留 `mode`（仅当原本在活动集中），其余
  序列仍逐字对齐 InteractiveMode；成功文案同步提示工具集变化。单元/集成
  层均不可见，只有真实模型驱动能暴露。
- 活体矩阵修正：verify-live.ts 此前 --source 实际靠会话残留的
  OMP_SOURCE_CLI 伪通过；补上真 --source 旗标（默认 monorepo 路径）与
  跨宿主形态的 schema 断言（参数或描述中可见全部 5 个 op）。干净环境
  下四组矩阵重新全 PASS。
- 门禁：`bun run typecheck`（paths 映射修复后真实启用，src 零错误；顺带
  修掉 tsconfig 已废弃的 baseUrl）；`bun run test` 40/40（12+15+6+7）。

## v3 rework (same day, final): thin driver only — see ADR-004

User principle: TUI 用户已经能用这些功能，插件只是增加调用入口，不允许任何
hardcode。因此删除全部自造逻辑（v2 的 emulated 后端、写守卫白名单、逐轮注入、
appendEntry 持久化与重建、goal_updated 追踪、director-lite 工具集切换），
`src/mode-tool.ts` 从 370 行减到 112 行：

- plan ops 与宿主自己的非 TUI 开关逐行同形（ACP `#applyModeChange`）；
- vibe ops 与 InteractiveMode 的进入/退出序列逐行同形；
- 守卫仅读活会话状态（getPlanModeState/getVibeModeState/getGoalModeState）；
- 无 bridge（密封 dist 宿主）→ 如实报错并指引文档，不再模拟。
- 关键佐证：宿主在 ACP 侧本就如此驱动 plan 模式（acp-agent.ts:1651-1673），
  注释自述 "Mirror InteractiveMode.#enterPlanMode"——会话调用序列是宿主的
  跨表面契约，不是 TUI 私货。
- 测试重写：N1–N12（15 例）覆盖 ACP 形状、幂等重入、双向互斥、registry
  缺失、无 bridge、注册形状、kill switch。合计 goal 12 + mode 15 = 27/27。
- 活体：installed 与 source 两种宿主的 dumpTools qol/control 四场全 PASS；
  WRITE-PROOF（plan 状态往返 + vibe 五件套装卸）此前已在 source 宿主通过；
  doctor 4 ok。

## v2 rework (same day): dual backend — see ADR-003

User challenged the "unreachable" claim; probes proved the live session IS
reachable when the extension shares the host's module instance. Rework:

- New `src/lib/host-bridge.ts`: root-import + `AgentRegistry` resolution of
  the live `AgentSession` (+ `VibeSessionRegistry`), sanity-gated.
- `src/mode-tool.ts` rewritten: per-op bridge resolution; NATIVE backend
  mirrors `#enterPlanMode/#exitPlanMode/#enterVibeMode/#exitVibeMode`
  sequences incl. `appendModeChange` host persistence; EMULATED backend
  (this doc's v1 content) as fallback for sealed dist hosts.
- Probe preserved as `.sandbox/probe-host-bridge.ts` (env `OMP_QOL_PROBE=1`).
- Tests: +N1–N8 native-backend cases (fake live session/registry); emulation
  suites kept hermetic via injected `resolveBridge: async () => null`.
  Total 38. Test script runs files serially: the two kill-switch suites
  mutate `PI_CONFIG_DIR`, and bun executes test files concurrently in one
  process — parallel env flapping made M10a read the wrong lockfile.
- Live: RPC dumpTools PASS on BOTH hosts (installed + source-link via
  `OMP_SOURCE_CLI`) + controls; WRITE-PROOF on source host: plan state
  round-trip and vibe toolset install `[read, vibe_spawn, vibe_send,
  vibe_wait, vibe_kill, vibe_list]` then restore; doctor clean.
- Infra: monorepo deps installed (`bun install` in ref_repos/oh-my-pi);
  `repos/omp-qol/node_modules` junction → monorepo node_modules routes
  plugin imports onto the same module graph as the source host; native
  addon `.node` copied from the installed pi-natives package.

## v1 content (now the EMULATED backend spec)

## What shipped

- `src/mode-tool.ts` — `registerModeTool(pi)`: single `mode` tool
  (`plan_enter | plan_exit | vibe_enter | vibe_exit | status`),
  `loadMode: "essential"`, `approval: "read"`, `[qol]` description marker.
- Plan guard: `tool_call` handler blocks `write`/`ast_edit` while plan mode
  is active unless the target is `local://*`, `PLAN.md`, or `*-plan.md`
  (case-insensitive, Windows separators handled) — mirrors the native
  `enforcePlanModeWrite` allowlist; `bash` intentionally ungated (parity).
- Vibe-lite: snapshot + `setActiveTools(["read","todo","task","goal","mode"])`
  (filtered to registry), restore on exit (filtered again against the
  registry at restore time).
- Per-turn reminders via `before_agent_start` (`qol-plan-mode-context` /
  `qol-vibe-mode-context`, `display: false`, `attribution: "agent"`).
- Persistence: `appendEntry("com.omp-qol.mode", {mode, objective?, enteredAt?})`;
  rebuild on `session_start` / `session_branch` / `session_tree` from the
  latest matching branch entry.
- Goal exclusion: tracks `goal_updated` events; plan/vibe enter refused
  while a non-terminal goal is known.
- Kill switch: plugin setting `modeToolEnabled` (default true), factory-time
  load — same pattern as QOL-001.
- `package.json` bumped to 0.2.0; `/qol-config` + settings log line updated.

## Verification record

1. Offline: `bun test` — 30/30 pass (12 goal + 18 mode; M1–M10 matrix).
2. Live RPC (isolated root): `dumpTools` = 13 tools incl. `goal` and `mode`
   both carrying the `[qol]` marker; control `--no-extensions` run = 11
   tools, neither present. Both PASS via `.sandbox/verify-live.ts`.
3. Kill-switch round trip: `plugin config set ... modeToolEnabled false` →
   dumpTools 12 tools (`mode` absent, `goal` kept); set back `true` → 13
   tools again.
4. `omp plugin doctor`: 4 ok, 0 warnings, 0 errors (v0.2.0).
5. Provider visibility: both tools registered with `loadMode: "essential"`,
   the same property QOL-001 proved carries extension tools into the model
   schema (dumpTools reflects it).

## Edge cases handled

- Double-enter / cross-enter / wrong-exit / exit-without-mode → specific
  `isError` messages (M4).
- Guard ignores non-write tools and ungated `bash` (native parity) (M2).
- Snapshot restore filters names dropped from the registry mid-session (M5b).
- Rebuild honors entry ordering (latest wins), ignores foreign customTypes,
  treats `{mode: null}` as off (M7).
- Persist failures degrade to `logger.warn` without breaking transitions.
- Pre-aborted signal → "Cancelled" without state change.
- Subagents: `restrictToolNames` hosts ignore extension tools; the gate
  only acts on per-session state, so subagent sessions are unaffected.

## Known limits (documented, by design)

- Native `/plan` proposal-review UI and native `/vibe` persistent workers
  remain user-only; the tool result texts say so explicitly (ADR-002).
- Native mode state is not observable from extensions; `status` reports
  QoL-tracked state only.
