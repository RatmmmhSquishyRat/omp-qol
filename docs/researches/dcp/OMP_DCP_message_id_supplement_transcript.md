# OMP DCP Message ID 补充研究 Transcript

## User

另外一个很重要的问题就是, 你之前说OMP中没有显式的message编号, 这可能会导致DCP实现困难.
我们除了直接更改core以外, 还有别的方式能够在在插件中进行自行解决这个问题吗? 我建议你继续深入完整调查.

## Assistant

我会把这个问题拆成两层查：**OMP 插件实际能看到什么 message/session 结构**，以及**插件是否能在不改 core 的前提下建立一个稳定、可回放、可用于 DCP 替换/压缩的“逻辑消息编号层”**。重点会查 extension hooks、session persistence、message serialization、context transform/compaction 路径，而不是只看文档。

## Assistant

这里已经出现一个很关键的修正：**OMP 并不是底层“完全没有 ID”**。它的 session journal 里每个非 header entry 都有稳定的 `id` 和 `parentId`；缺的是类似 OpenCode/DCP 那种**直接暴露给模型、按消息顺序编号的 message index**。这意味着“不改 core”比之前判断的可行性高很多。

## Assistant

更重要的是：我查到**已经有人把 OpenCode DCP 直接移植到了 Pi extension API（`@davecodes/pi-dcp`）**。它完全不改 session history，而是在每次 `context` 事件里改即将发给模型的 payload；其 `compress` 甚至直接用 `toolCallId` / 起止 `toolCallId` 来寻址，并通过 `sessionManager.getBranch()` 解析范围。也就是说，至少对 **tool-call/result DCP**，这个问题已经有现成的插件级 proof-of-concept。

## Assistant

现在可以把“编号”分清楚了：**DCP 需要的其实不是 core 原生的连续整数编号，而是一个模型可引用的、插件能反查到真实历史对象的稳定 alias。** OpenCode-DCP 自己就是这么做的：底层拿 `message.info.id`，插件维护 `rawId ↔ m0001` 双向表，再把 `<dcp-message-id>m0001</...>` 注入模型上下文。它并不是依赖 OpenCode core 给它一个 `#123`。

## Assistant

是的。经过这轮把 **OMP 当前源码、extension API、session journal、context transform，以及 OpenCode DCP 和现成 Pi-DCP 移植**都对起来之后，我需要修正之前的判断：

> **OMP 确实没有一个直接挂在 `AgentMessage` 上、天然给模型使用的连续 message 编号；但这并不意味着 DCP 必须修改 core。**
>
> OMP 已经有足够的底层身份信息和插件钩子，完全可以在 extension 内自己构造一层 **DCP Address Layer**。我现在反而建议：**先不要改 core。**

### 1. OMP 其实有“真正的消息身份”，只是它不在 `AgentMessage` 上

OMP 的 session journal 是 append-only tree。所有非 header 的 `SessionEntry` 都有自己的 `id`、`parentId` 和 timestamp；普通对话只是：

```text id="z9hj9q"
SessionEntry
├─ id: "a1b2c3d4"
├─ parentId: ...
└─ message: AgentMessage
```

所以之前说“OMP 没 message ID”严格来说不准确。正确说法应该是：

**`AgentMessage` 本身没有 OpenCode `message.info.id` 那样的 ID，但包裹它的 `SessionEntry` 有稳定 ID。**

更关键的是 extension 得到的只读 `sessionManager` 并没有把这些东西藏起来：它直接暴露 `getSessionId()`、`getLeafId()`、`getEntry()`、`getBranch()`、`getEntries()`、`getTree()`。也就是说插件能够自行读取当前 branch 的完整 `SessionEntry.id` 体系。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/session.md?utm_source=chatgpt.com))

这一下其实已经解决了 **80% 的“编号缺失问题”**。

---

## 2. 而且 OpenCode DCP 本身也不是依赖 core 给它 `m0001`

这是这次调查里我认为最重要的发现之一。

OpenCode DCP 的 `m0001`、`m0002` 根本不是 OpenCode core 原生 message number。它实际上是：

```text id="canywc"
OpenCode 原始 message.info.id
          ↓
DCP 插件维护映射
rawMessageId ↔ m0001
rawMessageId ↔ m0002
          ↓
把 <dcp-message-id>m0001</dcp-message-id>
注入给模型
```

当前源码的 `assignMessageRefs()` 明确读取 `message.info.id`，然后维护 `byRawId` 和 `byRef` 两张表；`m0001` 只是给模型看的短 alias。([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/message-ids.ts))

换句话说，**DCP 真正要求的是 stable identity，而不是 core-native sequence number。**

OMP 已经有 stable identity：

```text id="ulv705"
OpenCode DCP:
message.info.id
      ↓
m0001

OMP DCP:
SessionEntry.id
      ↓
我们自己生成的 mXXXX
```

因此整个机制可以原封不动地上移到插件层。

---

# 3. 甚至已经有现成 proof-of-concept：Pi-DCP 根本绕开了 generic message ID

我又找到一个更直接的证据：现在已经存在 `@davecodes/pi-dcp`，作者明确说它是 OpenCode DCP 到 Pi extension API 的移植。

它的核心结构就是：

```text id="j2yic0"
pi.on("context", ...)
    ↓
取得即将发送给 LLM 的 messages
    ↓
runPipeline(...)
    ↓
return { messages: result.messages }
```

而不是修改 session history。Pi 官方 package 页面也明确写着，on-disk session 不动，所有 pruning 都只发生在 outbound request。([pi.dev](https://pi.dev/packages/%40davecodes/pi-dcp?utm_source=chatgpt.com))

最有意思的是它的 `compress` 实现甚至**没有复制 OpenCode 那套 generic message number**。

它定义了两种：

```text id="lyjfk4"
message mode:
    toolCallIds[]

range mode:
    start toolCallId
    end toolCallId
```

也就是直接把 **`toolCallId` 当地址空间**。源码注释明确写着 message-mode 使用 `toolCallIds[]`，range-mode 使用 `start + end`。([github.com](https://github.com/Davidcreador/pi-dcp/blob/main/index.ts))

所以至少：

**tool output pruning、tool-call compression、连续 tool-call range compression，这三类 DCP 根本不需要 message 编号。**

这是已经存在的插件级实现，不是理论推测。

不过这个包目前 import 的是 `@earendil-works/pi-coding-agent`，OMP 当前 extension API 是 `@oh-my-pi/pi-coding-agent`，所以我不会建议你直接把它装进 OMP 当成 drop-in solution；它更适合作为**现成实现参考/移植底座**。([github.com](https://github.com/Davidcreador/pi-dcp/blob/main/index.ts))

---

# 4. 我认为我们应该把 DCP 的“地址”设计成两层，而不是模仿 message number

这比简单给所有消息编号更合理：

| 对象 | Canonical ID | 给模型看的 ID | 是否需要改 core |
|---|---|---|---|
| 普通 user/assistant message | `SessionEntry.id` | `m:a1b2c3d4` 或短 alias | 否 |
| tool call/result | `toolCallId` | `t:...` / `t001` | 否 |
| DCP compressed block | 插件自己的 block ID | `b1` | 否 |
| compaction/branch summary | 对应 `SessionEntry.id` | `b:xxxx` | 否 |

这里我甚至**不建议第一版使用 `m0001`**。

OMP 的 entry ID 本来就只有很短的形式，例如文档示例中的：

```text id="vr3d1u"
a1b2c3d4
```

直接暴露成：

```text id="33iq8o"
m:a1b2c3d4
```

就完了。

这样：

```text id="n6b2lv"
模型看到       m:a1b2c3d4
                    │
                    ▼
插件直接解析       a1b2c3d4
                    │
                    ▼
sessionManager.getEntry("a1b2c3d4")
```

**不需要任何 alias database。**

这比 OpenCode DCP 当前的 `m0001 → rawId` 映射反而更加健壮。

---

# 5. 为什么我不建议复制 OpenCode 的 `m0001` 设计

因为 OpenCode DCP 自己已经踩到两个非常典型的坑。

它当前把 message alias 固定成四位数：

```text id="nclnil"
m0001 ... m9999
```

源码有明确的 `MESSAGE_REF_MAX_INDEX = 9999`，超过就直接抛 `Message ID alias capacity exceeded`。目前仓库里真的还有用户报告长 session 超过 9999 条之后整个 alias 系统出问题。([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/message-ids.ts))

另一个当前仍然 open 的问题更加相关：**auto-compaction 后 compress 的 boundary ID orphaned**。也就是你以 `mXXXX` 为边界记录一个压缩范围，core compaction 改了可见上下文之后，这些 presentation-level ID 和真实上下文之间出现脱节。([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/issues?utm_source=chatgpt.com))

所以最好从根上避免：

```text id="3xorrh"
BAD:
array position
   ↓
m0037
   ↓
真实身份

GOOD:
SessionEntry.id
   ↓
可选 presentation alias
```

**Canonical ID 永远不能是“第几条消息”。**

编号只能是 UI/prompt 表示层。

---

# 6. OMP 的 `context` hook 已经足够完成真正的 DCP

OMP 当前 extension API 有我们需要的整条链：

```text id="1xhz9j"
Session Journal
    │
    │ getBranch()
    ▼
SessionEntry.id / toolCallId
    │
    ▼
DCP internal state
    │
    ▼
pi.on("context")
    │
    ├─ prune
    ├─ compress
    ├─ replace tool results
    ├─ inject DCP refs
    └─ inject compressed blocks
    │
    ▼
LLM request
```

当前源码甚至明确规定：

> `context` 在每次 LLM call 前发生；

而且传进去的是 **deep copy, safe to modify**，插件返回 replacement 只改变送往 LLM 的消息，**不会修改原始 session messages**。这几乎就是为 DCP 这类 non-destructive context transform 准备的接口。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts))

OMP 同时还有 `tool_call`、`tool_result`、`session_start`、`session_branch`、`session_tree`、`session_compact`、`before_provider_request` 等 lifecycle。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md))

而官方 extension 文档给出的持久状态推荐模式恰好就是：

```text id="k8j0so"
pi.appendEntry(custom state)

session_start / session_branch / session_tree
        ↓
ctx.sessionManager.getBranch()
        ↓
重建插件状态
```

这对于 branch-aware DCP 非常合适。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md))

---

# 7. 真正有一点难度的地方：`context.messages[]` 和 `SessionEntry.id` 如何一一对应

这才是这个问题剩余的技术核心。

因为 `context` event 给你的仍然是：

```ts id="d3z99o"
AgentMessage[]
```

不是：

```ts id="y76n1z"
{
    entryId,
    message
}[]
```

所以不能简单：

```ts id="q0ifwc"
event.messages[i].id
```

来拿 journal ID。

但是这也完全不要求改 core。

### 对 tool call / result

这里基本没有问题。

直接用：

```text id="ubeh86"
toolCallId
```

关联即可。

它天然存在于 tool-call / tool-result pair，而且 `tool_result` extension event 也直接提供 `event.toolCallId`。现成 pi-dcp 就是这样做 error tracking 和 compression addressing 的。([github.com](https://github.com/Davidcreador/pi-dcp/blob/main/index.ts))

所以我们早期主要 pruning 的最大头——**巨大的 tool outputs**——甚至完全不存在映射困难。

### 对普通 user / assistant message

则在 `context` handler 内同时做：

```text id="b61utg"
ctx.sessionManager.getBranch()
               │
               ▼
按照 OMP buildSessionContext 语义
构造 active visible entries
               │
               ▼
和 event.messages 对齐
```

OMP 自己的 `buildSessionContext` 规则是公开而且相当明确的：沿当前 `parentId` chain 找 active branch；普通 `message` 直接出现在 context；`custom_message` 转成 custom AgentMessage；`branch_summary` 转 summary message；存在 compaction 时从 compaction summary 和 `firstKeptEntryId` 重新构造可见上下文。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/session.md?utm_source=chatgpt.com))

因此我们可以写一个很小的：

```text id="5l7a6k"
DcpAddressIndex
```

来复现**“哪些 SessionEntry 对应当前 model-visible messages”**这一部分，而不需要复制整个 SessionManager。

---

# 8. 不过我会进一步缩小问题：其实不要试图让“每一种 context message”都有编号

这一点很重要。

我认为一个正确的 OMP DCP 应该只给**可安全寻址的对象** ID。

例如：

```text id="yubh6e"
user message          → m:<entryId>
assistant message     → m:<entryId>

assistant tool call
     └─ tool call      → t:<toolCallId>

tool result            → 同一个 t:<toolCallId>

compaction summary     → c:<compactionEntryId>
DCP summary            → b:<pluginBlockId>

临时 extension context → 不编号
provider 临时注入     → 不编号
```

这样我们根本不需要强行解决：

> “所有最终 provider payload 中的 item 都必须和 journal entry 一一对应。”

没有必要。

DCP 只需要：

> **模型能够准确指出“我要移除/压缩哪个可压缩 context unit”。**

而不是给整个 provider request 做数据库 primary key。

---

# 9. compaction 也可以在插件层妥善处理

这个问题是必须专门设计的，但还是不需要改 core。

现成 Pi-DCP 已经明确处理了它：收到 `session_compact` 后，它会清理基于旧 `toolCallId` 的 tracking，因为这些旧 call ID 已经不再存在于当前 message stream；已有 semantic compression records 则可以保留，让之后 pipeline 对不存在的 ID no-op。([github.com](https://github.com/Davidcreador/pi-dcp/blob/main/index.ts))

我们可以做得更完整一些：

```text id="wby2ib"
session_compact
      ↓
重新读取 getBranch()
      ↓
重建 active address index
      ↓
标记：
  active
  compacted-away
  summarized-into:<compactionEntryId>
```

也就是说旧 ID 不必“失效到无法解释”，而可以变成 tombstone：

```text id="wibqu4"
m:a1b2c3d4
  status = compacted
  representedBy = c:e1f2a3b4
```

这样模型如果误引用旧 ref，我们甚至可以正确告诉它：

```text id="v1f23y"
That message is already represented by compressed block c:e1f2a3b4.
```

这反而比 OpenCode DCP 当前那种 alias orphaning 更健壮。

---

# 10. DCP state 怎么存：我也不建议“每产生一个 message ID 就 appendEntry”

OMP extension 有 `appendEntry()`，但如果每条 message 都 append：

```text id="vsfttr"
DCP alias m0001 -> xxxx
DCP alias m0002 -> yyyy
...
```

会平白制造一堆 custom SessionEntry。

没有必要。

如果我们采用：

```text id="790231"
m:<SessionEntry.id>
```

**message addressing 完全零状态。**

真正需要持久化的只有：

```text id="3zhcjm"
CompressionRecord {
    blockId
    sourceRefs
    summary
    createdAt
    ...
}
```

这种发生 DCP action 才产生的状态。

这时候可以：

```text id="mxuabr"
pi.appendEntry(
  "your.dcp.compression",
  compressionRecord
)
```

然后 branch/switch/resume 时：

```text id="lznd0c"
ctx.sessionManager.getBranch()
```

重建当前 branch 的 DCP state。

这也正符合 OMP 官方推荐的 extension-state pattern。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md))

---

# 11. 我现在建议我们的实现分两层

这个是我目前最推荐的路线：

**第一层：Tool DCP。**

直接以 `toolCallId` 为 canonical address。先实现 dedup、superseded write/edit/read pruning、error payload purge，以及：

```text id="a974qr"
compress({
    startToolCallId,
    endToolCallId,
    summary
})
```

这条路线已经被 Pi-DCP 实际证明，而且覆盖了 agent context 中最容易爆炸、也是 DCP 最有价值的部分。([pi.dev](https://pi.dev/packages/%40davecodes/pi-dcp?utm_source=chatgpt.com))

**第二层：Generic Message DCP。**

加入：

```text id="mhl2v8"
m:<SessionEntry.id>
c:<CompactionEntry.id>
b:<DcpBlockId>
```

然后允许：

```text id="bkhx3a"
compress({
    start: "m:a1b2c3d4",
    end:   "m:e4f5a6b7",
    ...
})
```

内部永远解析回 canonical journal ID。

这样最终架构实际上是：

```text id="ljr0bt"
                OMP Session Journal
                       │
          ┌────────────┴────────────┐
          │                         │
   SessionEntry.id              toolCallId
          │                         │
          └────────────┬────────────┘
                       ▼
                DCP Address Layer
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
       m:xxxx                     t:xxxx
     generic msg                   tool
          │                         │
          └────────────┬────────────┘
                       ▼
                 CompressionRecord
                       │
                       ▼
                 b1 / b2 / b3
                       │
                       ▼
                  context hook
                       │
                       ▼
                      LLM
```

这已经是一个完整的插件级方案。

---

## 最后的判断

所以我会把之前的结论正式修改成：

**“OMP 没有显式 model-facing message number”是对的；“因此 DCP 很可能需要改 core”这个推论是不对的，至少明显过于悲观。**

OMP 当前已经有三样非常关键的东西：

**SessionEntry stable ID + toolCallId + 可替换 outbound `context` 的 extension hook。** 再加上 branch-aware `sessionManager.getBranch()` 和 `appendEntry()`，实际上足够把完整 DCP 做在插件里。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/session.md?utm_source=chatgpt.com))

我现在会把 **修改 core 降级为最后的 ergonomic optimization**：只有将来我们非常希望 `AgentMessage` 原生携带 `entryId`、让多个 extension 都统一使用同一套 message metadata、或者想让 OMP 自己的 UI/core features 也认识 DCP refs 时，才值得 patch core。

**如果只是为了实现我们现在讨论的 DCP，我认为没有必要。**

而且更进一步，我甚至认为 OMP 这里的 `SessionEntry.id` 模型使我们有机会做出一个**比当前 OpenCode DCP 的 `m0001~m9999` 更简单、更不容易被 compaction/branch 搞坏的实现**。([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/issues?utm_source=chatgpt.com))

下一步真正值得深入的就不再是“有没有 ID”了，而是 **如何精确复现 OMP `buildSessionContext` 的 entry→AgentMessage mapping，使 `m:<entryId>` 在 compaction、branch、custom_message、retry 这些情况下百分之百可靠**。这部分我认为才是实现 full-message DCP 前最后一个需要源码级验证的关键点。
