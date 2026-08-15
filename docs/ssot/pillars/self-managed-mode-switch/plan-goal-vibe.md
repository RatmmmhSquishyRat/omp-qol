# Plan Goal Vibe

这三个模式的功能都是已经完整存在于omp中, 且能够被用户直接调用的.
而我们希望的, 只是agent能够像用户一样自由调用这些模式的进出, 从而自行控制自己的计划, 目标, 以及vibe模式.

## 2026-08-15 用户决策（verbatim，禁止改写）

> 行吧我大概明白了, 我的决策是当前规则应当和用户侧进行对齐, 因为这些功能都是作者自己管理的, 随意放开限制之后造成混乱我们自己没有办法进行处理. 因此规则还是和用户侧对齐吧, 也就是暂停情况下的模式也算作互斥.
>
> 另外一个问题在于, 我们竟然不是使用作者提供的互斥判断机制而是自己实现吗? 这本身不太正常, 你完整调查看看究竟是完全无法复用, 还是我们没有发现, 自己多余实现了.

### 本决策的落地（不是改写上文三行）

「像用户一样」= 规则与用户侧对齐，不是比用户更自由。暂停态（plan paused / goal paused）与 active 一样占互斥位。作者管这些功能；插件放开会乱，且我们自己处理不了。

### 与旧设计稿的张力（禁止悄悄改旧文）

- **QOL-001**（`docs/plans/designs/qol-001-agent-goal-tool-design.md`）写过：agent 随时能管 goal，且 **create 不会开界面续跑**（续跑看 TUI 的 `goalModeEnabled`）。本决策不推翻「不擅自开续跑」，也不授权叠态；它要求 `create` / `resume` 在 plan 或 vibe 占位时，像用户 `/goal` 一样拒绝。
- **ADR-004**（`docs/ssot/adrs/ADR-004-thin-driver-no-emulation.md`）把 plan 进法写成薄驱动 ACP：`setPlanModeState`，并写明会话层/ACP 本身无门。调查结论是：作者的互斥只活在 InteractiveMode 的 enter/handle 里，插件拿不到那个实例，**不是**「有现成判断函数我们绕开了」。本决策要求自造门补齐到用户侧同一张表（含暂停），而不是假装走了 ACP 无门，也不是假装调用了用户 `/plan`。
- **plan 暂停状态拿得到。** 界面上的 `planModePaused` 是内存旗子，不是唯一副本。作者把当前模式写在会话日记 `mode_change` 里，并用 `sessionManager.buildSessionContext().mode` 投影（InteractiveMode 恢复会话时自己读 `plan_paused`）。`getEntries()` 是 SessionManager 的公开方法。先前把「拿不到界面旗子」写成「拿不到状态」是退缩，已纠正。
