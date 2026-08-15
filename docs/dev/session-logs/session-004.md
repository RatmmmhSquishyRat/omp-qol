# Session 004: goal/plan/vibe 互斥互溶调查

**date**: 2026-08-15
**commits**:

## Turn 1

### User

> 1. 完整调查, 目前qol插件给出的 goal, plan, vibe这三个状态的互斥互溶开关关系, 是否已经和用户侧原本互斥互溶状态完整对齐, 还是有差异, 
> 2. 以及我们是否可能尽量减少互斥, 让agent更加自由使用状态.

### Agent Actions

- 先读 pillar `docs/ssot/pillars/self-managed-mode-switch/plan-goal-vibe.md`（全文仅 3 行：要 agent「像用户一样自由调用」进出；未规定互斥矩阵）。未改写 pillar。
- 插件侧读完 `plugin/src/mode-tool.ts`、`goal-tool.ts`、`advisor-tool.ts`、相关测试与 ADR-001/004/002：mode 对 plan↔vibe 与「active goal」做硬拒绝；goal 工具无 plan/vibe 守卫，只委托原生 GoalRuntime。
- 用户侧对照宿主 `ref_repos/oh-my-pi`：TUI `#enter*` / `handle*Command` 对 **active 且 paused** 的 plan/goal 互斥；官方 `docs/vibe-mode.md` 写明 vibe 与 paused plan/goal 互斥。会话层 setter 与 ACP `#applyModeChange`、GoalRuntime.createGoal **本身不互斥**。
- 还原矩阵后结论为**有差异 / 部分对齐**：active plan↔vibe 与 active goal→plan/vibe 对齐；paused 态、goal create 反向、status 二值化、TUI 旗标未同步、ACP 无守卫均不对齐。
- 评估减少互斥：plan↔vibe 与 active goal 叠态是产品语义，不宜拆；插件相对 TUI 已经更松。再松会与 pillar「像用户一样」及宿主文档冲突，须显式表面张力。只写本 session log，不改业务代码，不 commit。

## Turn 2

### User

> 听不懂你的汇报, 自行查看你的系统提示词学学怎么汇报, 重新汇报

### Agent Actions

- 按系统提示重写：先答两个问题，用用户已有词（互斥/互溶/goal/plan/vibe），不用内部层名堆砌。
- 结论不变：未完整对齐；插件比用户侧更松、更不对称；先对齐再谈减少互斥。

## Turn 3

### User

> 那这个互斥, 是只是作者的观点规定, 还是就是机制上面有冲突, 那比如我们现在在暂停时候开另外一个模式, 会发生什么, 会报错, 崩溃, 还是无事发生什么?
> 你要首先明白我们的调查目标, 我不是让你简单查看文档告诉我怎么回事, 而是你要能够在汇报时候说出, 如果突破这个限制bug同时打开三个模式, 那么OMP中具体会发生什么情况, 去自己深入的了解代码.

### Agent Actions

- 跟宿主执行路径，不跟文档：`setPlanModeState` / `setVibeModeState` / `createGoal` 互不检查；互斥只在用户 slash 的 enter 函数和插件 `mode` 工具门口。
- 暂停：用户再开另一个 = `showWarning` 后 return，状态不变。TUI 暂停 plan 时会话 plan 已清空；插件因此能在「界面还显示暂停」时把 vibe 工具集换上。
- 三开不会崩。下一轮 `prompt()` 会并排注入 plan/goal/vibe 三段指令；vibe 换工具集会拿走 plan 要的 write/edit；plan 写守卫只挡 write/edit，不挡 bash、也不挡 vibe worker；goal 续跑看的是界面旗标，插件开的 plan 挡不住它。
- 会话日记只有一个 mode 槽，后写覆盖；状态栏也只显示一个（plan 优先）。`/new` 在 vibe 会话旗标下会 throw。

## Turn 4

### User

> 我想知道这套工具覆盖机制, 是否是revertable且atomic的, 也就是之后我反复重叠开关和覆盖, 最后用某个模式的时候, 会导致状态未被考虑处理而错乱, 还是能够保持正确的工具状态, 只是这个工具本身状态在plan/goal/vibe重叠的时候会拧巴而已.

### Agent Actions

- 跟 `applyActiveToolsByName` / `activateVibeTools` / 三个 `#*PreviousTools` 以及插件闭包 `vibePreviousTools`：单次套用名字列表在提示重建失败时会回滚；模式层是各一格进入前名单，不是栈。
- 只走同一条路径、不重叠进出时，退出能回到进入前。重叠后再关、或插件与界面交叉进出，后关的快照会写回过时名单；vibe 卸注册表后那些名字会被静默丢掉。
- 结论：不是可叠加可还原的原子覆盖。重叠当时拧巴；叠完再「只用一个」也可能留下错的工具集。

## Turn 5

### User

> 行吧我大概明白了, 我的决策是当前规则应当和用户侧进行对齐, 因为这些功能都是作者自己管理的, 随意放开限制之后造成混乱我们自己没有办法进行处理. 因此规则还是和用户侧对齐吧, 也就是暂停情况下的模式也算作互斥.
>
> 另外一个问题在于, 我们竟然不是使用作者提供的互斥判断机制而是自己实现吗? 这本身不太正常, 你完整调查看看究竟是完全无法复用, 还是我们没有发现, 自己多余实现了.

### Agent Actions

- 未改写 pillar 原文 3 行；在 `plan-goal-vibe.md` 文末追加 2026-08-15 用户决策 verbatim，并写明暂停占互斥位，以及与 QOL-001「create 不开续跑」、ADR-004「薄驱动 ACP 无门」的张力。
- 跟宿主代码：互斥只在 InteractiveMode 的 `#enter*` / `handle*Command` 里 `if + showWarning + return`；没有 `canEnter*` / `assertModesExclusive` / `isModeBlocked`。会话 setter、ACP `#applyModeChange`、GoalRuntime.create/resume 都不互斥。
- AgentRegistry 只给 AgentSession；`new InteractiveMode` 只活在 `main.ts` 局部变量。host-bridge / ExtensionAPI 都拿不到 handle/enter。结论：**完全无法复用**，只能自造门补齐。
- 实现：共享占用判断（goal `enabled` 或 `status==="paused"`；plan session `.enabled` 或日记最后一条 `mode_change==="plan_paused"`；vibe session `.enabled`）。plan/vibe 进出与 goal create/resume 按这张表拒绝；status 能报 goal paused；文案写明暂停不腾位。
- 摊开：TUI 的 `planModePaused` 旗标插件够不到；日记 `plan_paused` 是能做的近似。未改工具覆盖机制，未 commit。

## Turn 6

### User

> 我不认为你上述说的这个plan的问题是无法解决的, 状态自己实现也就算了, 状态怎么可能拿不到?
> 重新完整进行你的任务, 不要退缩, 要激进大胆调查.

### Agent Actions

- 重新跟宿主：`planModePaused` 只是 InteractiveMode 内存旗子；作者把暂停写进 `mode_change`，恢复时读 `sessionManager.buildSessionContext().mode === "plan_paused"`。真实 SessionManager 上 `getEntries` / `buildSessionContext` / `appendModeChange` 都是公开方法。
- 纠正先前「拿不到状态」：占用判断改为优先 `buildSessionContext().mode`，`getEntries` 仅作回退；删掉 N2e「known gap」。
- 插件 `plan_enter` / `plan_exit` 同步写入同一本日记，避免我们自己进出后日记仍停在 `plan_paused`。
- 真实会话测试 I5c 断言 `buildSessionContext().mode === "plan_paused"`。未 commit。

## Turn 7

### User

> 执行管理你的内容的commit

### Agent Actions

- 只暂存本次互斥对齐：占用模块、mode/goal 工具与测试、pillar、session-004、phase-010 journal。不纳入 sandbox 产物、WATCHDOG.yml、demo-mini-app、mc-web。
