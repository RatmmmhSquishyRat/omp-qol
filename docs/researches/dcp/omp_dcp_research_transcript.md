# OMP DCP 实现机制研究：完整对话 Transcript

> 说明：以下按本次对话中的可见消息原顺序记录。用户与助手正文均保持原文，不做摘要、改写或内容删减。工具调用、内部检索输出与隐藏推理不属于可见对话正文，因此未纳入 transcript。

---

## User

实际上Opencode的DCP插件本身的toolcall产生的上下文就有可能很大, 这种情况下, dcp的消息本身也应当被压缩. 那么, DCP插件中是如何处理这类tool call的呢? 是系统自动压缩不显示调用参数? 还是原样显示作为记录? 帮我完整调查源码作答

---

## Assistant

我会直接从 **OpenCode 的 DCP 插件源码**往下追，重点不是看文档怎么宣传，而是确认三件事：tool call 在会话里到底以什么结构保存、DCP 在 prune/compact 时是否会处理 tool 参数与 tool 输出、以及 UI 里“显示/不显示”是否和真正送给模型的上下文是两套逻辑。

---

## Assistant

已经能先确认一个关键点：**DCP 的 `compress` 调用参数本身确实可能非常大**，因为 `summary` 就直接作为 tool arguments 传进去；而且源码专门记录了这次 `compress` 的 `messageID` 和 `callID`。这强烈说明作者意识到了“压缩工具自己也会污染上下文”，下一步我正在追这两个 ID 最终在哪里被剔除/替换。

---

## Assistant

现在源码结构已经很明确了：DCP 并不是“把历史数据库里的消息改短”，而是在 OpenCode **每次准备下一次 LLM 请求时**，拿 `output.messages` 做一次 transform，再把被压缩的原消息替换成 synthetic summary。也就是说，“历史记录/UI 里存什么”和“下一轮真正喂给模型什么”必须分开看。

---

## Assistant

这里还有一个很重要、而且有点反直觉的发现：**message 模式专门把“包含 `compress` tool call 的 assistant message”强制标成 `high` priority**，哪怕它本身很短；对应 prompt 还明确命令模型：之前的 compress-tool 结果只要出现在上下文里，就应在后续更大的 cleanup pass 中做最小化压缩。也就是说它不是“调用完立刻自动抹掉参数”，而是把自己的历史调用列为后续优先清理对象。

---

## Assistant

对，你抓到的这个问题确实存在，而且 DCP 的源码里**专门考虑过“压缩工具自己的调用也会膨胀上下文”**。不过它的处理方式不是我原先可能会直觉猜测的“`compress` 调用完成后，系统立刻把它的 arguments 隐掉”。

**先给结论：**

> **DCP 的 `compress` tool call 参数会真实、完整地进入 OpenCode 的消息记录；OpenCode 下一轮给模型构造上下文时，默认也会把这些 `input` 带进去。DCP 不会在这次 `compress` 执行完以后立刻自动把自己的 arguments 删掉。**
>
> DCP 真正采用的是一种**延迟自清理**机制：后续再把“包含先前 `compress` tool call 的整条 assistant message”本身纳入压缩，于是这条巨大的 tool call 最终从发给模型的上下文中消失，只留下一个很短的 summary。尤其在实验性的 `message` 模式里，这件事是**明确专门设计过的**。

而且当前默认的 `range` 模式与 `message` 模式，在这方面差别还挺大。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/README.md))

### 1. DCP 的 compress 参数确实可能很大，而且它就是普通 tool argument

看 `lib/compress/range.ts`，`compress` 的 schema 本身就是：

```ts id="h4mnnd"
content: [
  {
    startId,
    endId,
    summary: string
  }
]
```

这里的 `summary` 定义就是“替换整个 range 的完整技术摘要”。也就是说，假设一次压了 40K token 的历史，模型生成了一个 6K token 的高保真 summary，那么这 **6K token summary 首先就是一次普通 function/tool call 的 argument**。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/compress/range.ts))

`message` 模式也一样，只不过参数是：

```ts id="sb75ys"
content: [
  {
    messageId,
    topic,
    summary
  }
]
```

而且可以一次 batch 很多个 message。源码甚至鼓励一次 compress 多条消息，所以这个 tool call 的 argument 完全可能达到数千甚至上万 token。 fileciteturn4file0

因此你的前提完全正确：

**DCP 压缩历史所节省的 token，有一部分会立刻以“compress tool arguments”的形式重新出现在历史里。**

---

### 2. OpenCode 本身不会偷偷把这些 arguments 隐掉

这是我专门继续往 OpenCode core 里查后确认的。

现在 OpenCode 的 `MessageV2.toModelMessages()` 对 completed tool part 做的是：

```ts id="qffjq5"
assistantMessage.parts.push({
    type: "tool-" + part.tool,
    state: "output-available",
    toolCallId: part.callID,
    input: part.state.input,
    output,
})
```

然后这东西直接进入 `convertToModelMessages()`。

也就是说，只要这条 tool message 仍然存在于待发送上下文：

**`part.state.input`——也就是 DCP 那个巨大的 `summary` argument——是真的会再次被发给模型。** ([github.com](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts))

这里还有个容易产生误解的细节。

OpenCode 原生 pruning 确实有：

```ts id="84wn6c"
part.state.time.compacted
    ? "[Old tool result content cleared]"
    : part.state.output
```

也就是 OpenCode 可以自动清掉**旧 tool output**。但是注意上面：

```ts id="hzm2vf"
input: part.state.input
```

仍然保留。

而 DCP 的情况恰恰反过来：

- `compress` **output 很短**，类似 “Compressed N messages ...”
- 真正巨大的东西是 **input.summary**

所以 OpenCode 原生那套 tool-output pruning **解决不了这个问题**。当前 OpenCode 原生 compaction/pruning 也是针对 completed tool 的 `output` 计算和标记 `compacted`。 ([github.com](https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/compaction.ts?utm_source=chatgpt.com))

---

## 3. 那么一次 compress 完成后，紧接着的下一轮模型调用发生什么？

这个过程值得完整画出来：

```text id="anpx4e"
原上下文
│
├─ message A       10K
├─ message B       15K
├─ message C       10K
│
└─ model 决定调用 compress
      │
      └─ tool input:
          startId=A
          endId=C
          summary="......"    ← 假设 5K token
```

DCP 执行以后：

```text id="bhl3au"
DCP state:
A/B/C → compression block b1
b1.summary = 5K summary
```

然后 OpenCode 准备**紧接着的下一次 LLM 请求**。

DCP 的 `chat.messages.transform` 会运行：

```ts id="v859l6"
syncCompressionBlocks(...)
syncToolCache(...)
buildToolIdList(...)
prune(...)
...
buildPriorityMap(...)
injectCompressNudges(...)
injectMessageIds(...)
```

也就是说它是在**发送模型之前拿一份 messages 做变换**。 fileciteturn32file0

`prune()` 中，A/B/C 会被跳过：

```ts id="iyrb3w"
const pruneEntry = state.prune.messages.byMessageId.get(msgId)

if (pruneEntry && pruneEntry.activeBlockIds.length > 0) {
    continue
}
```

并在 anchor 位置插进去 synthetic summary：

```ts id="h83xzp"
createSyntheticUserMessage(
    userMessage,
    summaryContent,
    summarySeed
)
```

所以 A/B/C 不再进模型，只剩 b1 summary。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/messages/prune.ts))

**但是刚刚产生 b1 的那条 `compress(...)` assistant message 本身并不属于 A/B/C。**

所以紧接着这一轮会近似变成：

```text id="226lar"
[b1 compressed summary]          ~5K

assistant:
  tool_call compress({
      startId: A,
      endId: C,
      summary: "......"           ~5K 再出现一次！
  })

tool_result:
  "Compressed 3 messages ..."
```

也就是说，在**刚压完的下一轮**，这个 summary 很可能实际上出现了两份：

1. 新插入的 compressed summary；
2. 前一轮 `compress` tool call 的 input.summary。

这正是你指出的那个问题。

---

# 4. DCP 怎么解决自己的这份重复？——靠后续再次压掉 `compress` message

这里是这次源码调查最重要的发现。

DCP 新的实验性 **message mode 明确给所有包含 `compress` tool call 的 assistant message 强制设为 `high` priority**。

源码 `lib/messages/priority.ts`：

```ts id="0jg5g8"
priority:
    messageHasCompress(message)
        ? "high"
        : classifyMessagePriority(tokenCount)
```

普通 message 是：

- ≥ 500 token → medium
- ≥ 5000 token → high

但是只要 `messageHasCompress(message)`，**哪怕这条 message 很短，也无条件 high**。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/messages/priority.ts))

而 `messageHasCompress()` 判断的就是：

```ts id="e94cnx"
role === "assistant"
&& part.type === "tool"
&& part.tool === "compress"
&& part.state.status === "completed"
```

fileciteturn24file0

这不是偶然行为。测试里甚至有一个专门的 case：

> `message mode marks compress tool messages as high priority even when short`

并验证它最终得到：

```xml id="jy4f02"
<dcp-message-id priority="high">m0002</dcp-message-id>
```

fileciteturn29file0

所以这里已经可以确定：**作者确实专门想到了 DCP 自己产生的 compress history 需要被回收。**

---

# 5. 更直接的证据在 prompt：模型被明确命令“清理以前的 compress 调用”

`lib/prompts/compress-message.ts` 写得非常明确。

它告诉主 agent：

- high-priority message 在不再需要全文时必须压缩；
- 如果上下文中存在先前的 `compress` tool result，应当在一次更大的 compression pass 中把它们**最小化总结**；
- 不要为了一个旧 compress result 单独再开一次 compress；
- general cleanup 时优先清理 medium/high priority message。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/prompts/compress-message.ts))

所以预期循环实际上是：

```text id="lai8pp"
第一次：

[A B C 原文 35K]
       ↓
compress(A-C, summary=5K)

下一轮暂时：

[b1 summary 5K]
[compress(A-C, summary=5K)]   ← 冗余


过一阵 cleanup：

compress(
    messageId = 上面这条 compress assistant message,
    summary = "Earlier context compressed into b1."  ← 极短
)


以后：

[b1 summary 5K]
["Earlier compression created b1." ~几十 token]
```

于是 DCP 自己产生的“压缩日志”也最终被 DCP 吃掉。

这是一个相当典型的 **recursive / self-cleaning context management**。

---

# 6. 但是要特别注意：这是 `message` mode 做得最好，默认 `range` mode 没这么精确

当前 DCP 默认配置仍然是：

```json id="dzevcc"
"compress": {
    "mode": "range"
}
```

而 `message` mode 被 README 明确标为 experimental。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/README.md))

更关键的是，`buildPriorityMap()` 开头直接：

```ts id="pluqyh"
if (config.compress.mode !== "message") {
    return new Map()
}
```

所以：

**“compress tool message 自动 high priority”这一套，只存在于 message mode。** ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/messages/priority.ts))

在默认 `range` mode 下，没有：

```text id="90p1ft"
这是一条 DCP 自己的 compress message
→ 特殊标 high
→ 优先压掉
```

这种逻辑。

它采用的是更粗粒度的办法：

> **等以后又有一个 range compression 覆盖到这条旧 `compress` assistant message 时，整条 message 跟着那个 range 一起被压掉。**

`resolveSelection()` 遍历 range 内所有 raw message，同时收集其中所有 tool call；它并没有排除 `compress` message。 fileciteturn16file0

而一旦该 message 进入 compression state，下一次 `filterCompressedRanges()` 就整条：

```ts id="vu1pha"
continue
```

于是里面无论：

- reasoning；
- text；
- compress tool name；
- `startId/endId`；
- **巨大的 `summary` input**；
- 小型 result；

都会一起从 **LLM-bound context** 中消失，由新的 summary 替代。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/messages/prune.ts))

所以两种模式可以概括成：

| | 默认 `range` | 实验性 `message` |
|---|---|---|
| compress arguments 初次是否完整记录 | 是 | 是 |
| 下一轮是否还会进入模型 | **是** | **是** |
| 是否立即特殊删除 arguments | 否 | 否 |
| 以后能否压掉该 compress call | 是，等未来 range 覆盖 | 是 |
| 是否特殊识别为 DCP 自身负担 | 没有专门 priority | **有，强制 high** |
| prompt 是否专门指导清理旧 compress | 较间接 | **明确有** |

---

## 7. generic tool pruning 反而不会帮你清掉 `compress`

这一点也很重要。

DCP 有普通的 automatic strategies：

- deduplication；
- purge errors；
- tool-output pruning。

但是默认的 globally protected tools 里面**明确包括 `compress`**：

```ts id="wsd8qe"
const DEFAULT_PROTECTED_TOOLS = [
  "task",
  "skill",
  "todowrite",
  "todoread",
  "compress",
  "batch",
  "plan_enter",
  "plan_exit",
  "write",
  "edit",
]
```

([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/config.ts))

README 也明确列出了这份默认 protected list。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/README.md))

所以它不是：

```text id="0t2x5s"
compress call 很大
→ dedup/purge 自动抹掉 input
```

事实上 `pruneToolInputs()` 对 completed tool 的 input **目前只特殊处理 `question` tool**：

```ts id="898ben"
if (part.tool !== "question") continue
part.state.input.questions = ...
```

错误 tool 才会清除 string inputs。对正常 completed `compress` 根本没有：

```ts id="umoza9"
part.state.input.summary = "[removed]"
```

之类的逻辑。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/messages/prune.ts))

甚至曾经存在的 `pruneFullTool()` 当前还是：

```ts id="y1tefm"
// pruneFullTool(...)
```

直接注释掉了。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/messages/prune.ts))

因此可以非常确定地排除：

**DCP 没有一个隐藏的“compress tool 执行完就 scrub 它自己的 arguments”机制。**

---

# 8. 那么“显示”呢？UI 里看到什么和模型实际看到什么是两件事

这里必须分成三个层级：

```text id="jx27dl"
A. OpenCode canonical session history
B. OpenCode TUI/UI 渲染
C. 下一轮实际发给 LLM 的 transformed messages
```

DCP README 明确说它是 **non-destructive** 的：

> session history 不会被 DCP 修改；DCP 是在向 LLM 发请求之前替换被 prune 的内容。

([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/README.md))

所以 canonical history 中，原始：

```json id="1drpi2"
{
  "tool": "compress",
  "state": {
    "input": {
      "content": [{
        "summary": "巨大的 summary ..."
      }]
    }
  }
}
```

仍然存在。

DCP 自己的 TUI 模块也没有注册什么特殊 `compress` tool-call renderer，它只是注册 `/dcp` panel。 fileciteturn20file0

因此如果 OpenCode 的某个 UI 把 arguments 折叠成：

```text id="fw0xbn"
▸ Compress Range: xxx
```

那只是**视觉渲染/折叠**，不能说明模型没吃到这些 token。

另外 DCP 配置里的：

```json id="pbu2yr"
"showCompression": false
```

也**不是**“不要向模型展示 compress arguments”。

README 对这个字段的定义就是：

> Show compression content in a chat notification

也就是控制 DCP 的**通知展示**。 ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/README.md))

它与 tool-call arguments 是否进入 LLM context 没关系。

---

# 最终，我认为这个机制可以这样准确理解

**DCP 没有实现“零开销压缩事务”。**

一次 compression 在刚完成时会产生一个明显的**暂时性重复开销**：

```text id="0yaw26"
compressed summary
+
produced-that-summary 的 compress tool arguments
```

其中后者可能和前者几乎一样大。

DCP 的解决思想是：

```text id="hgtych"
压旧历史
    ↓
产生新的 compress bookkeeping message
    ↓
暂时留在上下文
    ↓
继续推进任务
    ↓
下一次/后续 compression cleanup
    ↓
把旧 compress bookkeeping message 也压掉
```

**message mode 已经把这个“context-management garbage collection”正式做成了一等机制：compress message 强制 high priority + prompt 明确要求后续最小化处理。**

但**当前默认 range mode 仍然比较粗糙**：它并不会立即识别并单独回收 DCP 自己的 compress message，而是等它自然落进后续某个 compressed range。

所以，如果你的核心问题其实是：

> **“DCP 会不会由于 summary 同时作为 tool input 和 compressed block 出现，导致一次压缩后的即时 context 并没有想象中缩小那么多？”**

答案是：

**会。完全会，而且源码能直接证明。尤其刚执行完 compress 的下一次 agent iteration，这种 duplication 是结构性存在的。DCP 是靠后续自压缩来摊销掉，而不是当场避免它。** ([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/blob/master/lib/compress/range.ts))

这其实还引出一个很值得继续研究的问题：**为什么作者不在 `chat.messages.transform` 里直接把已完成的历史 `compress` tool input.summary 替换成一个几十 token 的引用，例如 `[compression block b7 created]`？** 从现在的架构看，这在技术上完全可做，而且会比现有的“等待下一次 LLM 主动再次压缩它”更省 token、更确定。我可以接着顺源码评估一下：**这是不是 DCP 一个真实可修的设计缺陷，以及改成即时 scrub 会不会破坏 OpenCode tool-call/tool-result 协议或 prompt cache。** memcite

---

## User

但是实际上, 我是可以任意改变模型给出的tool调用参数和给出任意结果, 不必在这里忠诚复现对吗?
这主要是一个缓存相关的机制问题. 如果是的话, 那么我们实际上调用那一次就可以直接compress为简单的tool call info, 因为summary已经存在于上下文中了, 这里没必要重复.

---

## Assistant

对，你这个思路在架构上是成立的。我再确认一个关键边界：**可以改的是“下一轮送给模型的历史 tool-call 表示”，不是必须去篡改 OpenCode 的 canonical session record**。这样既能保留 DCP 用 `messageID/callID` 维持 block 生命周期，又能把重复 summary 从实际上下文里抹掉。

---

## Assistant

而且从缓存角度看，你这个方案比现实现更干净：**压缩本身已经改写了更早的历史前缀，所以这一轮的 prompt cache 从那个更早位置起本来就已经失效了。此时再把后面的 `compress(summary=...)` 改成几十 token 的记录，通常不会额外损失任何可用 cache prefix；反而从下一轮开始，这个精简表示会稳定地进入新缓存前缀。**

---

## Assistant

对，而且我认为你这里已经抓到了比 DCP 当前实现更合理的处理方式。

不过需要把一句话稍微修正：

> **不是“历史 tool call 可以完全任意伪造”，而是“给下一次模型看的历史 tool-call 表示不必忠实复现原始参数/结果”。**
>
> 只要保持 provider/AI SDK 所要求的**结构一致性**——例如 tool 名称、call ID、tool-call ↔ tool-result 对应关系、合法消息结构——参数和结果的具体文本完全可以被 DCP 改写成精简表示。OpenCode 的 `experimental.chat.messages.transform` 本来就是在实际 LLM 请求前修改 model-visible history 的。([github.com](https://github.com/anomalyco/opencode/issues/27364?utm_source=chatgpt.com))

### 你提出的方案实际上可以直接消除重复

现在 DCP 是这样：

```text id="r3g2ts"
第 N 次 LLM request
────────────────────
旧历史 40K

模型输出：
compress({
    startId: m1,
    endId: m20,
    summary: "5K token summary..."
})
```

这一步 **5K summary 必须真的生成**，因为 DCP 要从 tool arguments 中取得它。这个成本没法避免。

tool 执行完成之后，DCP 已经把这 5K summary 存到了：

```text id="271ere"
CompressionBlock.summary
```

并建立：

```text id="v1h21z"
compressMessageId
compressCallId
blockId
anchorMessageId
```

这些映射。fileciteturn6file0

那么到了**紧接着的下一次 LLM iteration**，根本没有理由继续送：

```text id="u15ynl"
[Compressed conversation section]
5K summary
...

assistant:
compress({
    ...
    summary: 同样的 5K summary
})

tool:
Compressed 20 messages...
```

完全可以在 `chat.messages.transform` 中变成：

```text id="wtjh9x"
[Compressed conversation section]
5K summary
...

assistant:
compress({
    topic: "...",
    content: [
        {
            startId: "...",
            endId: "...",
            summary: "[stored in compressed block b7]"
        }
    ]
})

tool:
Compression completed: b7.
```

甚至还可以更激进，只要 OpenCode/AI SDK 对 historical tool input 不做 schema validation：

```text id="g3dm11"
assistant:
compress({
    result: "b7"
})

tool:
Compression completed: b7.
```

但我**更推荐前一种：保持原 tool schema 的合法形状，只缩短数据**。这样 provider、AI SDK 或 OpenCode 将来增加 validation 时也不会炸。

---

## 而且缓存上几乎没有理由不这么做

这是这里最关键的一点。

LLM prompt cache 通常依赖**精确前缀匹配**。DCP 自己的 README 也明确说明：一旦 pruning 改变历史消息，从第一个变化的位置开始，旧 cache prefix 就失效。([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning?utm_source=chatgpt.com))

假设原请求是：

```text id="m0odf4"
A
B
C
D
E
compress(summary=S)
```

压缩以后下一请求已经是：

```text id="mj8nfu"
SUMMARY(A-C)       ← 这里已经变化了
D
E
compress(summary=S)
```

缓存从 `SUMMARY(A-C)` 这里开始已经不可能继续命中上一轮：

```text id="vo9dtb"
A B C ...
```

所以再把**更靠后的**：

```text id="x4eo9t"
compress(summary=S)
```

改成：

```text id="zy3gks"
compress(summary="[stored:b7]")
```

不会再造成一次新的有效 cache 损失。

旧缓存：

```text id="rop0yz"
A B C D E ...
↑
这里已经断了
```

后面 compress 参数是 5K 还是 20 token，对这一轮旧 prefix cache 都没有区别。

反而新的请求一旦完成，以后缓存的稳定前缀变成：

```text id="l7rgnc"
SUMMARY(A-C)
D
E
compress("[stored:b7]")
```

于是后续请求都只需要携带那个几十 token 的 compact record。

所以从 cache 的角度其实是：

**即时 scrub 基本是严格优于 DCP 现在“留着完整 compress call，等以后再压一次”的办法。**

---

### 甚至不应该等“下一次 cleanup”

DCP 当前 message mode 的：

```text id="nfzi0m"
compress message
    ↓
标记 high priority
    ↓
以后提醒模型
    ↓
模型再调用 compress
    ↓
把旧 compress message 压掉
```

本质上是在让 LLM 做一次完全可以 deterministic 完成的垃圾回收。源码甚至明确把含有 `compress` 的 message 强制列为 high priority。fileciteturn23file0turn24file0

这其实没有必要。

因为 DCP **已经知道**：

```text id="gphksz"
这个 callID
    ↓
生成了哪些 block
    ↓
summary 已经存在哪里
```

`CompressionBlock` 本身就保存：

```ts id="7qd5zy"
compressMessageId
compressCallId
blockId
summary
```

fileciteturn6file0

所以完全可以 deterministic：

```text id="ofxedf"
if completed tool == "compress"
and DCP state contains compressCallId == part.callID:

    part.state.input =
        compactCompressionReference(blockIds)

    part.state.output =
        compactCompressionResult(blockIds)
```

根本不需要 LLM 再判断一次。

---

## 我只会保留三个东西

如果让我改 DCP，我不会“任意伪造”，而是定义一个明确的 **historical representation**：

```text id="cdc73i"
compress tool call
├── callID        保留
├── tool name     保留
├── topic         可保留
├── block IDs     保留
├── summary       删除
├── boundaries    可选，通常删除
└── result        缩成一句
```

例如一个 batch compression：

```json id="uwg6ur"
{
  "topic": "Auth refactor cleanup",
  "content": [
    {
      "startId": "m0041",
      "endId": "m0068",
      "summary": "[stored as b7]"
    },
    {
      "startId": "m0081",
      "endId": "m0095",
      "summary": "[stored as b8]"
    }
  ]
}
```

result：

```text id="99gwdy"
Compressed into blocks b7, b8.
```

真正的信息：

```text id="wgyc5k"
b7 → 完整 summary
b8 → 完整 summary
```

已经通过 synthetic compressed blocks **单独存在于 model context 中**，所以 tool-call history 没有任何理由再复制一遍。

甚至 `startId/endId` 我认为最终也可以不要；它们只是执行压缩时需要的**命令参数**，不是压缩完成以后模型继续解决任务所需要的语义信息。

---

### 有一个重要边界

你说“调用那一次就直接 compress”需要区分两个时刻：

**模型正在生成 `compress(...)` 的那一次输出不能缩。**

因为：

```text id="0o238j"
模型
  ↓ 生成
summary=5K
  ↓
DCP.execute(args)
  ↓
DCP 才第一次得到 summary
```

所以这 5K output-generation token 是必须产生的。

但是 **tool 执行结束之后的下一次 agent iteration**：

```text id="r9ekuj"
LLM call
→ compress tool call
→ execute
→ DCP state saved
→ 下一次 LLM call
```

就在这个箭头处：

```text id="5exb8a"
execute
     ↓
experimental.chat.messages.transform
     ↓
下一次 LLM request
```

就可以立刻 scrub。OpenCode 当前的生命周期也是 message transform 在每次 LLM dispatch 前运行。([github.com](https://github.com/anomalyco/opencode/issues/28901?utm_source=chatgpt.com))

所以从模型视角看，完整 tool call 参数实际上只需要存在**一次**：

```text id="1yeehh"
生成它的时候
```

之后永远只看到：

```text id="7vq2b5"
compress → b7
```

而 summary 本身只看到：

```text id="mfzle1"
[Compressed conversation section]
...
```

**这应该才是正确设计。**

换句话说，你的判断是对的：**DCP 当前的“让历史 compress call 带着完整 summary 继续存在，再等待未来自我压缩”并不是协议要求，更不是缓存要求；它更像是当前实现没有做这一层 deterministic canonicalization。** 而且从现有源码结构看，这个改动非常局部，基本就应该放在 `chat.messages.transform` 的 `prune()` 附近完成。([github.com](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning?utm_source=chatgpt.com)) memcite

---

## User

然后实际上我们是想要在OMP中实现这个功能的, 你现在需要进行OMP的具体机制调查, 对于canonical session record, 缓存处理, 消息替换, 内存内session维护等等机制做完整调查, 看看是否实现条件齐全

---

## Assistant

这次我会把问题按“能不能落地”而不是“有没有类似接口”来查：先锁定 OMP 的 **session 真正存储模型**，再追一条消息从 canonical record → 内存 session → provider request 的完整路径，最后单独确认 **prompt/cache key 是否依赖原始 tool-call bytes**。只要这三层之间有一个稳定的 transform seam，我们这个“执行后立即 canonicalize compress tool call”方案就基本成立。

---

## Assistant

先汇报一个已经非常关键的结果：OMP **比 OpenCode 更适合做这件事**。它不是只有一个不可控的“历史=请求”数组，而是已经明确分成了三层：持久化的 append-only `SessionEntry` journal、`Agent.state.messages` 的运行时消息状态、以及每次 provider call 前的 `transformContext → convertToLlm → transformProviderContext` 边界。也就是说我们甚至不必修改 canonical session record，就有现成的 provider-boundary seam 可以做即时瘦身。

---

## Assistant

还差两个决定“能否作为 OMP 扩展直接做，而不是改 core”的关键点我正在补：一是 extension API 有没有暴露 provider-bound context hook；二是 OMP 的 **OpenAI Responses stateful chain / append-only cache mode** 在发现历史被改写后会怎样退化。前者决定改动侵入性，后者决定我们的即时 scrub 会不会破坏已有缓存/链式请求。

---

## Assistant

扩展层这一点现在也确认了：**不需要先改 OMP core 才能截获 model context**。官方 extension API 就有 `context` 事件，而且源码注释写得非常直白——事件拿到的是“即将发给 LLM 的 deep copy”，handler 返回 replacement 只影响 LLM，**原始 session messages 不修改**；仓库自带 `plan-mode` 示例已经用它删除历史上下文。 

这基本就是我们需要的 DCP prune seam。剩下真正要小心的不是“能不能替换”，而是 **tool-call/result pairing、provider-native replay metadata，以及 OpenAI `previous_response_id` 链**。

---

## Assistant

还有一个我不想含糊带过的特殊情况：OMP 对普通 OpenAI Responses 已经会比较 **wire-form history prefix**，一旦发现历史变了就自动丢弃 `previous_response_id` 链并 full replay；但 Codex transport 还有自己独立的 session/websocket 状态。我要把 Codex 这条也核完，否则“扩展无需 core 改动”这个结论还不够稳。

---

## Assistant

目前看来“压缩本身”作为 extension 已经成立；我现在在查一个更细但实际很重要的问题：**DCP 的 block 应该绑定什么稳定 ID**。OMP 的 `context` hook 给的是 `AgentMessage[]` deep copy，不保证直接带 `SessionEntry.id`。如果这里没有现成 ID，我们仍然能像 DCP 一样注入自己的 `m0001`，但恢复 session 后必须能从 append-only journal 可靠重建映射，这决定实现是“纯扩展 100% 干净”还是“最好给 core 补一个 entry-id metadata seam”。

---

## Assistant

可以。把 OMP 当前这套 session、agent-loop、provider replay、prompt cache、extension API 全部串起来之后，我的结论相当明确：

> **在 OMP 中实现我们刚才讨论的 DCP，核心条件已经齐全，而且 OMP 的架构实际上比 OpenCode 更适合做。**
>
> 最合理的实现不是修改 canonical session history，而是建立一个 **“原始会话 + compression overlay → LLM-visible context”** 的投影视图。压缩执行后，下一次请求立刻把 `compress` 自己那份巨大 summary 参数缩成几十 token 的引用。
>
> **功能层面可以纯 Extension 实现。**  
> 但如果要做到我认为“可以长期合入 OMP、branch/resume/provider 全面稳健”的质量，我建议给 core 补两个很小的 seam：**把稳定 `SessionEntry.id` 暴露给 context projection；提供统一的 rewritten-assistant replay sanitizer。**

下面我按实际数据流说。

---

## 1. OMP 的 canonical session record 和模型上下文，本来就是两回事

OMP 的 durable session 是一棵 **`SessionEntry` append-only journal/tree**。

核心 entry 结构是：

```ts id="qkfslw"
interface SessionEntryBase {
    type: string
    id: string
    parentId: string | null
    timestamp: string
}

interface SessionMessageEntry extends SessionEntryBase {
    type: "message"
    message: AgentMessage
}
```

所以真正 canonical 的身份是 **SessionEntry.id + parentId**，不是 provider messages 数组下标。`SessionEntryIndex` 又单独维护 `id → entry`、parent/children、active leaf 等派生索引。fileciteturn124file0 fileciteturn99file0

更重要的是，OMP 已经原生区分了：

```text id="282ltw"
Session journal
    ↓
buildSessionContext()
    ↓
AgentMessage[]
    ↓
provider-bound transform
    ↓
Message[]
    ↓
API request
```

例如已有 native compaction 时，disk 上早期原始 history **仍然存在**，但 `buildSessionContext()` 给模型的是：

```text id="1ewchy"
CompactionSummary
+ firstKeptEntryId 之后的 kept messages
+ compaction 之后的新消息
```

而 transcript/display 模式仍然可以保留完整历史。也就是说 OMP 自己已经采用了：

> **Canonical history ≠ model-visible history**

这个思想。fileciteturn125file0

这正是 DCP 最理想的基础。

---

# 2. 我们根本不应该修改原始 compress tool call

这是这次调查之后我最推荐的架构。

OMP 专门提供了 `CustomEntry`：

```ts id="tzylws"
interface CustomEntry<T> {
    type: "custom"
    customType: string
    data?: T
}
```

源码说明得非常明确：

> 用来让 Extension 持久化自己的状态；reload 后扫描这些 entry 恢复状态；**不参与 LLM context**。

与之相对，`CustomMessageEntry` 才是会参与模型上下文的东西。fileciteturn124file0

Extension API 又直接开放了：

```ts id="5e6wx3"
pi.appendEntry(customType, data)
```

而 runtime 实际实现就是：

```ts id="xp3iw5"
session.sessionManager.appendCustomEntry(customType, data)
```

fileciteturn103file0 fileciteturn132file0

所以我们的 compression state 完全可以这么存：

```text id="2anrli"
Canonical journal

m1 user
m2 assistant
m3 toolResult
...
m20 assistant
m21 assistant:
    compress({
        start: ...,
        end: ...,
        summary: 巨大的 5K summary
    })
m22 toolResult:
    "compressed ..."

custom:
    omp-dcp-block {
        blockId: b7,
        coveredEntryIds: [...],
        anchorEntryId: ...,
        compressToolCallId: ...,
        summary: 5K summary
    }
```

**原始 compress call 一字不动。**

这样：

- TUI 可以显示真实发生过什么；
- session export 是完整的；
- debugging/audit 完整；
- branch/time travel 不丢历史；
- decompress 不需要恢复被破坏的数据；
- DCP 自己只是一层 overlay。

这和去 rewrite JSONL 是两个完全不同的复杂度等级。

---

# 3. OMP 已经有我们需要的“只改模型上下文、不改 session”的正式接口

这是最关键的发现。

Extension API 有：

```ts id="vcdw8e"
pi.on("context", ...)
```

结果类型就是：

```ts id="2lqkdj"
interface ContextEventResult {
    messages?: AgentMessage[]
}
```

fileciteturn102file0

它的 runner 实现尤其关键：

```ts id="kdszsk"
async emitContext(messages: AgentMessage[]) {
    currentMessages = structuredClone(messages)

    ...

    if (handlerResult.messages) {
        currentMessages = handlerResult.messages
    }

    return currentMessages
}
```

也就是说 context handler 的返回值直接成为下一阶段的模型消息，但是原来的 runtime messages 不改。fileciteturn111file0

SDK 又把它直接接到了：

```ts id="dijloz"
const transformContext = async (messages) => {
    const withContext = await extensionRunner.emitContext(messages)
    return wrapSteeringForModel(withContext)
}
```

fileciteturn122file0

而 agent core 对 `transformContext` 的定义本身就明确说用途包括：

> Context window management / pruning old messages / injecting external context.

fileciteturn106file0

因此 DCP 不需要钻任何内部空子。

它几乎就是为这种功能准备的。

---

# 4. 实际 provider pipeline 更漂亮

OMP 的真正调用顺序是：

```text id="4uzp76"
Agent.state.messages
        │
        ▼
transformContext()
        │
        │   ← Extension DCP 在这里
        ▼
convertToLlm()
        │
        ▼
normalizeMessagesForProvider()
        │
        ▼
AppendOnlyContextManager.syncMessages()
        │
        ▼
transformProviderContext()
        │
        ▼
provider
```

源码明确是：

```ts id="hgv2qq"
let messages = context.messages

if (config.transformContext) {
    messages = await config.transformContext(messages, signal)
}

const llmMessages = await config.convertToLlm(messages)

const normalizedMessages =
    normalizeMessagesForProvider(llmMessages, model)
```

fileciteturn81file0

随后才：

```ts id="hghog8"
config.appendOnlyContext.syncMessages(normalizedMessages)
```

fileciteturn81file0

再往后才是：

```ts id="yao543"
transformProviderContext()
```

fileciteturn81file0

这意味着 **DCP 的变换发生在 cache manager 之前**。

这是非常重要的。

如果 DCP 是在最后 raw JSON request hook 里偷偷改内容，OMP 自己的 cache tracking 可能不知道历史已经变了。

但我们走 `context`：

> OMP 的 cache manager 会看到**压缩后的真实消息**。

这是正确的层级。

---

# 5. 更关键：OMP 的 AppendOnly cache 已经原生支持这种历史重写

这里我原本最担心，结果 OMP 已经专门实现了。

`AppendOnlyContextManager` 的注释直接列出了三种情况：

1. 正常 append；
2. compaction 导致 message array 变短；
3. **in-place rewrite**。

第三种源码甚至明确点名：

> `per-turn pruning, transformContext re-render, image strip, etc.`

它不是历史变化以后粗暴清空整个 KV/cache。

它保存上一轮每条 normalized message 的 digest，然后计算：

```text id="l86qvq"
old:
A B C D E F G

new:
A B C X Y Z
      ↑
      first divergence
```

于是：

```text id="xqyd9i"
A B C    保持 byte-stable
D E F G  truncate
X Y Z    重新 append
```

也就是保留 **longest stable prefix**。fileciteturn80file0

而 digest 包含：

```ts id="fhpn6l"
role
content
providerPayload
toolCalls / tool_calls
toolCallId
toolName
isError
assistant id
```

所以连我们修改 `compress` 的 tool arguments，它都会正确检测到。fileciteturn80file0

这基本可以说：

> **OMP 的 cache infrastructure 已经原生为 DCP 这种 transformContext history rewriting 做好了支持。**

---

# 6. 所以你刚才提出的“compress 完以后立即把自己缩掉”，在 OMP 中尤其合理

假设：

```text id="gwltbo"
m1 ... m20                  40K
```

模型产生：

```text id="gjnzgk"
compress({
    start: m1,
    end: m20,
    summary: S              5K
})
```

这一次的 5K 输出没法避免，因为模型确实需要生成 S。

tool 成功以后：

```text id="ldxalv"
DCP state:
b7.summary = S
b7 covers m1...m20
```

到了**下一次 LLM request**，我们的 `context` hook 直接投影为：

```text id="4hef9x"
[b7]
[Compressed conversation section]
S
```

然后原来的：

```text id="uvy17d"
assistant:
compress({
    start: m1,
    end: m20,
    summary: S
})
```

变成：

```text id="ua6sk2"
assistant:
compress({
    start: "m1",
    end: "m20",
    summary: "[stored as b7]"
})
```

result：

```text id="k9jewn"
Compression completed: b7.
```

于是 S 在实际 context 中只有 **一份**。

---

## 7. 这不会额外破坏 prompt cache

这是我们前面推论在 OMP 源码上得到的直接验证。

压缩本身已经造成：

```text id="8dv4bf"
old:

A B C D E ... compress(S)
^

new:

SUMMARY(A...E) ... compress(ref)
^
```

最早 divergence 已经发生在被压缩 range 的起点。

所以后面再把：

```text id="5d2m8n"
compress(summary=S)
```

变成：

```text id="11oux3"
compress(summary="[b7]")
```

不会把“本来还能命中的更长 prefix”毁掉。

**那个 prefix 在更前面的 summary replacement 位置就已经断了。**

OMP 的 `longestStablePrefix()` 正好会在那个最早 divergence 截断。fileciteturn80file0

之后这一版：

```text id="8045om"
A B [b7 summary] ... compress(ref)
```

成为新的稳定 prefix。

下一轮开始继续正常命中。

所以这里我现在可以非常有把握地说：

> **立即 scrub compress call 不仅不会比现有 DCP 更伤缓存，反而是更合理的 cache steady-state。**

---

# 8. OMP 自己的 pruning 代码也证明开发者采用的就是这种 cache economics

这不是我们对 cache 的主观理解。

OMP 自带的 tool-result pruning 已经专门计算：

```text id="ik259o"
candidate 后面还有多少 tokens
```

因为：

> 修改一个已经位于 warm cache prefix 深处的 tool result，会迫使 provider 重写它后面的整个 suffix。

所以它有：

```ts id="gay30f"
cacheWarmSuffixTokens
```

这个保护参数。fileciteturn84file0

coding-agent 当前 per-turn guard 是：

```text id="agi1xw"
8,000 tokens
```

超过这个 warm suffix，就暂时不修改，等 compaction/shake。

它甚至还设置了 **90 分钟 idle flush**，注释说明这是为了等 Anthropic long cache 的 1h retention 过期以后再重写深历史。fileciteturn85file0

也就是说 OMP 的作者自己已经把：

```text id="6qy2f2"
token savings
vs
cache invalidation cost
```

作为 context maintenance 的一等设计约束了。

我们的 DCP 应该沿用这个思路。

---

# 9. OpenAI Responses 的 stateful `previous_response_id` 也不是阻碍

OMP 的 OpenAI Responses 有自己的 stateful chaining：

```text id="6p27om"
previous_response_id
+
只发送新增 delta
```

但它并不是盲目沿用旧 response。

构造 chained request 时会比较当前 history 和上一轮 baseline；只有 prefix/options 仍然一致才生成 delta。

否则就放弃 `previous_response_id`，full replay 当前 transcript。fileciteturn54file0

所以：

```text id="dfqjo8"
DCP 修改历史
      ↓
history prefix mismatch
      ↓
previous_response_id chain break
      ↓
full replay compacted history
      ↓
建立新的 chain baseline
```

这是正确行为。

---

# 10. Codex WebSocket 这条我也专门追到底了：同样安全

Codex transport 更复杂，因为它也维护：

```ts id="amkmn3"
lastRequest
lastResponseId
lastResponseItems
canAppend
turnState
...
```

fileciteturn89file0

但是 `buildCodexChainedRequestBody()` 明确写道：

> 只有“same options, strict history prefix”成立才用 `previous_response_id + delta-only input`。

如果：

```text id="8nrksc"
history mutated
or
options changed
```

它会：

```ts id="gjp6ss"
resetCodexWebSocketAppendState(state)
```

然后 full transcript replay。fileciteturn89file0

所以 DCP 的 model-context rewrite **不会偷偷接在一个不兼容的 Codex previous_response_id 后面**。

这一点没有问题。

---

# 11. 真正需要特别处理的是 `providerPayload`

这是第一处真正的坑。

OpenAI Responses / Codex 的 assistant message 不只有普通：

```text id="2hf02c"
content:
    toolCall(...)
```

它还可能保存一份 provider-native：

```ts id="55bvw1"
providerPayload = {
    type: "openaiResponsesHistory",
    items: [...]
}
```

下一次 replay 时，Codex provider 会优先检查这份 native history。

如果存在，它会重新 replay native items；否则才调用：

```ts id="in1tfr"
convertResponsesAssistantMessage(...)
```

从普通 `assistantMsg.content` 重建。fileciteturn89file0

所以如果我们只是：

```text id="w0ptor"
content.toolCall.arguments:
S → "[stored b7]"
```

却留下：

```text id="zbjuqy"
providerPayload:
原来的 function_call(summary=S)
```

那就会发生：

> **我们以为改短了，provider 实际上仍然 replay 原始 5K arguments。**

所以任何被 DCP 改写过的 assistant message，在 model-visible copy 中必须：

```ts id="4v40ga"
providerPayload = undefined
```

强制 provider 从我们修改后的 logical blocks 重建 wire history。

注意：

**只改 context copy。canonical session 中原始 providerPayload 仍然完整保留。**

---

# 12. Anthropic signed thinking 是第二处坑，但 OMP 已经有成熟解法

如果历史 assistant message 带：

```text id="3fv676"
thinkingSignature
redactedThinking
```

而你修改同一 assistant turn 的 tool call，某些 provider 会认为：

> signed assistant turn 已经被篡改。

OMP 自己在处理 dangling tool call 历史重写时已经碰到这个问题。

源码明确说明：

> modified assistant turn 携带 signed thinking/redacted thinking 会被 Anthropic 拒绝。

OMP 的解决方法是：

```text id="269zqn"
redactedThinking       → drop
thinkingSignature      → clear
plaintext thinking     → 保留
```

fileciteturn125file0

而 `sanitizeAssistantForReparentedHistory()` 已经有非常接近的逻辑：

- 删除 replay-bound provider state；
- thinking 保留文本但去 signature；
- 丢弃 redactedThinking；
- `providerPayload = undefined`。

fileciteturn114file0

所以这里不是未知问题。

**我们只需要复用/抽象 OMP 已经存在的 sanitizer。**

---

# 13. tool-call/result 不能随便删，但可以随便“缩”

这里和我们上一轮的判断完全一致。

OMP 在恢复 branch 时会专门清理：

```text id="n61mdq"
toolCall 没有 matching toolResult
```

的 dangling call，因为 dangling pair 会被 provider/transform 层重新补成 synthetic failure，甚至重新污染模型上下文。fileciteturn125file0

所以正确做法不是：

```text id="2059ue"
删掉 compress tool call
留下 result
```

或者反过来。

而是始终保留：

```text id="ae3rat"
assistant
  toolCall:
      id = ORIGINAL_ID
      name = "compress"
      arguments = compact representation

toolResult
  toolCallId = SAME_ID
  toolName = "compress"
  content = compact result
```

这样结构完全合法。

---

# 14. 参数最好不要改成完全不同 schema

虽然理论上 historical tool arguments 往往不会重新经过 execution schema validation，我还是不建议：

```json id="0rsmof"
{"block":"b7"}
```

如果原 schema 根本没有 `block`。

最好保持合法 shape：

```json id="jmzgnp"
{
  "topic": "auth exploration",
  "content": [
    {
      "startId": "m0010",
      "endId": "m0034",
      "summary": "[compressed as b7]"
    }
  ]
}
```

这样：

- provider serializer 不意外；
- future OMP validation 不意外；
- debugging 更容易；
- tool protocol 语义完整；
- token 仍然只有几十个。

真正的 summary 在：

```text id="7srhr0"
DCP block b7
```

里只有一份。

---

# 15. 内存 session 也不需要被 replace

这是另一个非常好的地方。

我不建议 DCP 每次压缩以后：

```ts id="bplcf8"
agent.replaceMessages(...)
```

相反，应当保持：

```text id="rtr5cx"
Agent.state.messages
=
canonical live conversation
```

DCP 自己只维护：

```text id="9yctg3"
CompressionOverlayState
```

然后：

```text id="8rhfbf"
raw AgentMessage[]
        +
CompressionOverlayState
        ↓
context hook
        ↓
projected AgentMessage[]
```

这样不会出现：

```text id="ah4ta4"
disk 一套
Agent.state.messages 一套
DCP state 一套
```

三套 mutable source-of-truth 相互同步的问题。

实际上 OMP 的 Extension `context` API 就是为这种 projection 模式设计的。fileciteturn111file0

---

# 16. Compression state 本身如何恢复

这个也已经有现成基础。

每生成一个 block：

```text id="43h9zm"
b7
```

Extension 调：

```ts id="aar54v"
pi.appendEntry("dcp-block", {
    version: 1,
    blockId: "b7",
    ...
})
```

它最终走：

```ts id="bgiedk"
sessionManager.appendCustomEntry(...)
```

fileciteturn132file0

而 `CustomEntry` 的官方设计目的本身就是：

> extension reload 后扫描 session entries 重建 internal state。

fileciteturn124file0

所以：

```text id="960u71"
session_start
session_switch
session_branch
session_tree
```

时：

```text id="jvrg8b"
scan active branch
    ↓
collect dcp-block entries
    ↓
resolve active/deactivated blocks
    ↓
rebuild in-memory overlay
```

即可。

甚至连我们在 OpenCode DCP 里看到的 sidecar JSON state 文件都没必要另搞。

---

# 17. 唯一明显欠缺的 core 能力：`context` message 没直接携带 `SessionEntry.id`

这是真正值得改 OMP core 的地方。

`ContextEvent` 暴露的是：

```ts id="mvaz98"
messages: AgentMessage[]
```

fileciteturn102file0

而 canonical stable identity 在：

```ts id="1rqkem"
SessionEntry.id
```

fileciteturn124file0

两者没有直接绑在一起。

这意味着如果我们希望模型看到：

```xml id="s2hwnm"
<dcp-message-id>m0042</dcp-message-id>
```

然后执行：

```text id="kizqp8"
compress(m0042 ... m0067)
```

Extension 需要自己把：

```text id="btig64"
AgentMessage
↔
SessionMessageEntry.id
```

对应起来。

**这不是做不到。**

因为 ExtensionContext 有 read-only `sessionManager`，custom tool 官方例子也明确建议通过：

```ts id="o29l9p"
ctx.sessionManager.getEntries()
```

来恢复状态。fileciteturn126file0

可以按：

```text id="3grb7t"
branch order
role
timestamp
toolCallId
content fingerprint
```

进行匹配。

但我不喜欢把生产级 DCP 建立在这种“重新识别”上。

---

# 18. 我建议给 OMP 增加一个非常小的 seam

不要污染 provider message。

可以是内部 symbol：

```ts id="09jeo9"
const kSessionEntryId = Symbol(...)
```

context deep copy 中继续带着：

```text id="yjrwkb"
AgentMessage
    [kSessionEntryId] = "01K..."
```

但：

```text id="j2ncz5"
convertToLlm
provider serializer
JSONL message body
```

都不发送这个字段。

或者 ContextEvent 直接变：

```ts id="ldzqoy"
{
    messages,
    entries: [
        { messageIndex: 0, entryId: "..." },
        ...
    ]
}
```

我更倾向于后者。

这样 DCP 可以直接：

```text id="6aqot4"
m0001 → SessionEntry UUID
m0002 → SessionEntry UUID
...
```

没有任何猜测。

**这是我认为唯一真正值得为了 DCP 补的 core API。**

---

# 19. 第二个建议补进 core 的不是必要功能，而是统一 sanitizer

我们会频繁做：

```text id="n3dd9w"
rewrite historical assistant turn
```

现在 OMP 已经在好几个地方处理：

```text id="y9ev98"
providerPayload
thinkingSignature
redactedThinking
native Responses replay
```

fileciteturn114file0 fileciteturn125file0

我会把它抽成一个明确公共函数，例如：

```ts id="4gqfqj"
sanitizeAssistantForHistoryRewrite(message)
```

然后 DCP：

```ts id="dypvfa"
const rewritten =
    sanitizeAssistantForHistoryRewrite(original)

replaceCompressArguments(rewritten)
```

这样不会让 DCP 自己维护一份 provider quirks。

---

# 20. 还有一个容易忽视的实现细节：绝对不要直接 mutate `event.messages`

通常 runner 会：

```ts id="30i7fy"
structuredClone(messages)
```

但如果某条 message 中含有不能 structured-clone 的 `details/providerPayload`，源码有 fallback：

```ts id="nzmegd"
currentMessages = [...messages]
```

也就是只 shallow-copy array。fileciteturn111file0

因此 DCP context handler 必须使用：

```text id="fljgvd"
immutable projection
```

即：

```ts id="858mme"
return {
    messages: event.messages.map(...)
}
```

需要修改的 message/block 都重新 clone。

不要：

```ts id="997phq"
event.messages[i].content[...] = ...
```

否则极端情况下真有可能污染 runtime canonical `Agent.state.messages`。

这一点我要列为硬约束。

---

# 21. 与 OMP 原生 compaction 如何共存

OMP 原生 compaction 也只是 journal 上一个：

```ts id="1ia7ul"
CompactionEntry {
    summary
    firstKeptEntryId
    ...
}
```

然后 `buildSessionContext()` 投影。fileciteturn124file0 fileciteturn125file0

所以 DCP 不应该试图“战胜”它。

比较干净的规则是：

```text id="0e44ne"
Native compaction
    ↓
决定目前 canonical model-visible tail

DCP overlay
    ↓
只继续压这个 tail 中仍可见的 raw messages
```

一旦 native compaction 吞掉某个 DCP block 覆盖的区域：

```text id="14x7st"
DCP block → inactive
```

Extension 已经有：

```text id="obtax0"
session_before_compact
session_compact
auto_compaction_start/end
```

生命周期事件。fileciteturn102file0

所以这也不存在架构缺口。

---

# 最后的实现条件评估

我现在会这样打分：

| 能力 | OMP 当前状态 | 判断 |
|---|---|---|
| 自定义 `compress` tool | Extension 原生支持 | **齐全** |
| 拿到每次即将发给 LLM 的 context | `context` event | **齐全** |
| 只改 LLM context、不改 session | 官方设计如此 | **齐全** |
| 保存 compression block | `appendEntry/custom` | **齐全** |
| reload / branch 后恢复 DCP state | session journal + lifecycle | **齐全** |
| canonical history 保留原 tool call | 天然支持 | **齐全** |
| 即时缩短历史 compress args/result | context projection | **齐全** |
| tool-call/result pairing | AgentMessage 层可完整控制 | **齐全** |
| prompt prefix cache rewrite | longest-stable-prefix | **齐全，而且非常适配** |
| OpenAI `previous_response_id` | prefix mismatch 自动 full replay | **齐全** |
| Codex websocket append | strict prefix mismatch 自动 reset | **齐全** |
| Responses native replay | 需 scrub `providerPayload` | **可实现，需注意** |
| Anthropic signed thinking | OMP 已有 sanitizer 思路 | **可实现，需复用** |
| context message → canonical entry 精确 ID | 没有直接暴露 | **唯一明显的小缺口** |

所以不是“勉强能做”。

**OMP 的核心架构实际上已经给 DCP 提供了几乎所有底层原语。**

我甚至认为在 OMP 中最正确的 DCP 架构应该明确写成：

```text id="yiqdb1"
                 ┌─────────────────────┐
                 │ Canonical Session   │
                 │ append-only journal │
                 │ RAW / lossless      │
                 └──────────┬──────────┘
                            │
                    build live context
                            │
                 ┌──────────▼──────────┐
                 │ AgentMessage[]      │
                 │ canonical runtime   │
                 └──────────┬──────────┘
                            │
             ┌──────────────▼──────────────┐
             │ DCP context projection      │
             │                             │
             │ raw range → block summary   │
             │ compress(S) → compress(ref) │
             │ result → tiny result        │
             │ strip replay signatures     │
             └──────────────┬──────────────┘
                            │
                    convertToLlm
                            │
                 AppendOnly cache sync
                            │
                     Provider request
```

而不是 OpenCode DCP 当前那种：

```text id="qchhvu"
压缩
→ 留下巨大 compress tool call
→ 以后再提醒模型
→ 再调用一次 compress
→ 清理上一次 compress
```

后者属于**让 LLM 做 deterministic garbage collection**。

在 OMP 里完全没有必要。

### 我的最终判断

**如果目标是做一个能跑的 OMP-DCP Extension：现在就可以开工，不需要先修改 OMP core。**

**如果目标是做一个我愿意长期维护、最终 PR 进 OMP 的 production implementation：我建议先给 core 加两个非常小的通用能力：**

1. `context` projection 暴露只读的 `SessionEntry.id ↔ AgentMessage` identity；
2. 把 OMP 现有的 providerPayload / signed-thinking 清理逻辑抽成统一的 `sanitizeAssistantForHistoryRewrite()`。

除了这两点，**session persistence、内存态、model-context projection、cache invalidation、OpenAI/Codex stateful replay、extension persistence 全部已经就位。**

而且这次调查以后，我会明确建议：**不要实现“修改 canonical session record 的 DCP”作为第一版。保持 canonical raw history 永远无损，DCP 只是一个持久化的 model-context overlay。** 这会让 undo、decompress、branch、debug、UI 和未来算法升级都简单一个数量级。 memcite

---

## User

great, 你将我们上述对于这个问题的完整研究对话transcript, 原文无损完整逐字记录到文档, 给出链接供我下载给到本地agent作为DCP实现机制的研究基础.
