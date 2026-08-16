# DCP Tool Call / Tool Result Compression — Supplementary Research Transcript

## User

关于DCP, 另外几个比较重要的议题就是, tool call&result消息本身是否能够被单独压缩, 以及压缩之后的信息应当是什么形态的. 我这里主要想问的是技术层面的支持, 不是设计问题, 如果技术层面支持, 那么我们肯定设计空间是宽敞的, 肯定希望能够做到尽善尽美. 但是首先是技术规格上面支持到什么程度.

## Assistant

我会把这个问题严格拆成“**OMP/模型协议到底允许我们改到哪一层**”，而不是先讨论应该怎么设计。重点会核对三件事：tool call 与 tool result 在内部消息模型里是不是独立对象、送进模型前能否分别重写/删除、以及各家模型协议对 call/result 配对与内容形态有哪些硬约束。

## Assistant

目前已经有一个很关键的技术信号：OpenCode 自己的 compaction 代码就会**只把已完成 tool part 的 `state.output` 标记为 compacted**，而不是把整轮 assistant 消息一起删掉；这说明“只压 tool result 内容”在 OpenCode 的内部表示层本来就是一等能力。接下来要确认的是：插件 hook 能否做到同样粒度，以及“tool call 参数”是否也能单独改。

## Assistant

这里需要补一个关键区分：**OpenCode-DCP 本身能做到什么**，和你现在要移植/重做的 **OMP 插件接口能做到什么**不是同一个问题。我会把 OMP 的消息结构与发送前 transform/hook 一起对照；真正决定你设计空间的是后者。

## Assistant

现在 OMP 这一层基本可以定性了：`context` hook 收到的是“**即将发给 LLM 的消息深拷贝，明确标注 safe to modify**”，返回值又可以直接替换整个 `Message[]`；而且文档明确说**不会修改原 session history**。这实际上给 DCP 提供了非常接近理想的“wire-time 虚拟压缩层”。

## Assistant

还有一个边界我正在确认：**“插件能改掉已经进入上下文的 result”不等于“插件一定能看到工具最初产生的完整原始输出”**。如果 OMP 在更早阶段已经因为单条输出上限把数据截掉了，那么 DCP 再晚介入也无法恢复；这会决定哪些能力纯插件即可，哪些若追求无损压缩就真的需要 core 支持。

## Assistant

是的。把 OMP 当前 `main` 的消息类型、extension hook、provider transform 和 compaction 逻辑对下来以后，结论比我之前预想的还要宽：

**普通 tool call / tool result 在技术上完全可以成为 DCP 的独立压缩对象。**  
但要区分两个概念：

- **内容独立压缩：支持得很好。**
- **结构上只删 call 或只删 result：不应当这么做，因为 provider 有 call/result 配对约束。**

而且最关键的是，**这些操作基本都可以只发生在“送给 LLM 的虚拟 context”里，不修改真实 session history。** OMP 的 `context` event 就是为这种事情准备的：每次 LLM 调用之前给插件一份 `AgentMessage[]` 的 deep copy，明确写着 “safe to modify”，插件可以返回一整套替换后的 messages；原始 session messages 不变。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts))

## 1. 先把 OMP 里面 tool call / result 的真实结构说清楚

这里有个很重要的细节：

**`toolResult` 是独立 message；`toolCall` 不是独立 message，而是 `assistant` message 里的一个 content block。**

也就是大致：

```text id="1xuhm3"
AssistantMessage
  content:
    - text
    - thinking
    - toolCall A
    - toolCall B
    ...

ToolResultMessage A

ToolResultMessage B
```

`ToolCall` 当前核心字段是：

```ts id="3te4hs"
{
  type: "toolCall"
  id: string
  name: string
  arguments: Record<string, unknown>
  ...
}
```

而 `ToolResultMessage` 是：

```ts id="e9cmr4"
{
  role: "toolResult"
  toolCallId: string
  toolName: string
  content: (TextContent | ImageContent)[]
  isError: boolean
  ...
}
```

因此从 OMP 数据结构上，**result 是天然的 message-level compression unit；call 则是 block-level compression unit。** 一个 assistant message 即使同时有普通文字、thinking 和三个 calls，我们也可以只改其中一个 call block。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/types.ts))

这对 DCP 非常好。

---

## 2. Tool Result：几乎是完全开放的

这是支持最好的地方。

你完全可以保留：

```text id="sa9vx4"
role = toolResult
toolCallId = 原 ID
toolName = 原工具名
isError = 原状态
```

然后把：

```text id="56w96s"
content = 原始几万 token 输出
```

替换成：

```text id="bchoqm"
content = 几十 token 的 DCP 表示
```

例如技术上这些全部成立：

```text id="mm7twd"
[DCP: result compressed]
```

或者：

```text id="ekx3tm"
[DCP compressed: 18,420 tokens → 31 tokens; summary already retained]
```

或者：

```text id="79zsa4"
{"dcp":"compressed","ref":"#142","tokens":18420}
```

甚至完整的小型结构化摘要、CSV、索引、引用、hash，都没有问题，因为 OMP 的 `ToolResultMessage.content` 本来就是 text/image block 数组。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/types.ts))

这甚至不是我们在“钻接口漏洞”。**OMP core 自己已经这么干。**

当前 compaction 的 `pruneToolOutputs` 会直接把某个单独 tool result 的内容改成类似：

```text id="7jk4t8"
[Output truncated - N tokens]
```

对于 `useless` result 则会变成：

```text id="bva2be"
[Uneventful result elided]
```

同时保留 call/result 的结构和 pairing。文档还明确解释，这么做就是为了让 provider-native history replay 和 tool-call/result pairing 保持有效。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/compaction.md))

所以：

> **Tool Result 独立压缩：不是“理论上可以”，而是 OMP 已经原生采用这种表示方式。**

我们只不过能做得比现有的 `[Output truncated]` 精细得多。

---

# 3. Tool Call 也能独立压缩，但约束比 Result 多

Tool call 最占空间的一般是：

```ts id="aeu27d"
arguments
```

OMP 的 outbound transform 本身已经存在**重写历史 toolCall.arguments** 的代码：例如 credential redaction 会遍历 assistant content，找到单独的 `toolCall` block，重写 `arguments`，其余 assistant 内容保持不变。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/providers/transform-messages.ts))

所以这样的 DCP 操作，从 OMP abstraction 来说没有问题：

```text id="7sw0ys"
原：

toolCall
  id: call_123
  name: bash
  arguments:
    command: "一个 12000 token 的巨大命令..."
    ...

压缩：

toolCall
  id: call_123
  name: bash
  arguments:
    ...small representation...
```

也就是说：

**call 与 result 不但可以分别压，而且可以使用完全不同的压缩策略。**

不过 call 有几个硬约束。

### 第一，`arguments` 在 OMP 类型里必须还是 object

它是：

```ts id="hxy2iy"
Record<string, unknown>
```

所以不能保持 `type: "toolCall"`，却直接写：

```text id="909w9f"
arguments = "[compressed]"
```

这种裸字符串。

可以是：

```json id="avsifb"
{
  "dcp": "compressed",
  "summary": "...",
  "ref": "..."
}
```

至少在 OMP internal type 层这是合法的。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/types.ts))

但是我要把“**OMP 类型允许**”和“**所有 provider 都保证接受一个已经不符合原工具 schema 的历史 arguments**”分开。后者没有一个跨 provider 的统一强保证。

因此，如果追求最保险的 provider compatibility，call 有两条路线：

**A. 保持 ToolCall 形态，只缩 arguments。**  
适合可以保留合法结构的压缩。

**B. 不再假装它是 ToolCall：把整个旧 call/result pair 一起移除，然后用普通 context 文本表达压缩结果。**  
这时自由度基本无限。

后面这条其实非常重要。

---

# 4. 真正的硬规则不是“不能压”，而是 pairing

OMP 的 provider transform 明确有一整个 repair pass：

> 每一个仍然存在的 assistant tool call，后面必须恰好存在一个对应 result。

如果找不到 result，OMP 会主动补一个：

```text id="v0rzwk"
No result provided
```

而且 Anthropic 明确不允许存在一个没有先前 `tool_use` 的孤立 `tool_result`，OMP 注释直接写明这种情况会导致 HTTP 400。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/providers/transform-messages.ts))

所以可以把技术规格归纳成这样：

| 操作 | 支持情况 |
|---|---|
| 只缩 `toolResult.content` | **✅ 非常安全** |
| 只缩 `toolCall.arguments` | **✅ 支持，但 provider/schema 要谨慎** |
| call 保持原样，result 变成一句 marker | **✅ 非常安全** |
| result 保持原样，call arguments 缩小 | **✅ 技术支持** |
| 只删除 result，call 留着 | **❌ 不应做** |
| 只删除 call，result 留着 | **❌ 不应做** |
| call + result 一起删除 | **✅ 可以** |
| call + result 一起替换成普通摘要文本 | **✅ 可以，而且自由度最大** |

所以可以用一句比较准确的话概括：

> **OMP 支持 tool call/result 的“独立内容压缩”，但如果要做“结构删除”，call/result 应视为一个原子 pair。**

这其实正好符合 DCP 的需要。

---

# 5. 这意味着我们可以有三层压缩粒度

从**纯技术规格**看，不谈设计优劣，我们实际上已经拥有：

### Level 1：Result-only compression

```text id="w2qjx6"
assistant:
  toolCall(name=read, args=完整)

toolResult:
  [DCP compressed result #91]
```

这是最保守的。

---

### Level 2：Call / Result 分别压缩

```text id="8b3sio"
assistant:
  toolCall(
    id=原ID
    name=read
    args=压缩表示
  )

toolResult:
  压缩表示
```

OMP internal model 支持。

特别适合你之前指出的情况：

> **DCP 自己执行的 tool call 很可能参数非常大，但 summary 已经存在于 context 里，因此没有理由让 DCP 的调用参数和返回值永久重复存在。**

从 OMP 能力上说，确实可以在**下一次 LLM request 前**把那次 DCP call 的 arguments 和 result 分别瘦身。

---

### Level 3：Whole-pair collapse

甚至不用继续保留“这是一个工具调用”的 illusion。

原来：

```text id="1pw4pb"
assistant:
  ...
  toolCall DCP(
      enormous arguments...
  )

toolResult:
  enormous result...
```

在之后的 outbound context 中可以整个 pair 消失，换成普通压缩信息。

因为 `context` handler 最终返回的是整个：

```ts id="xh9top"
Message[]
```

而不是只能编辑某个预设字段。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts))

换句话说，**在 session storage 中它仍然是完整真实 tool call；但模型下一轮看到的 history，可以已经完全没有那个 tool protocol pair。**

这是我认为最关键的一项能力。

---

# 6. 甚至不需要用 `tool_call` / `tool_result` hook 来做 DCP

这一点也需要纠正一个很容易产生的实现误区。

OMP 有：

```text id="vlm9s5"
tool_call
tool_result
```

hook，但 DCP 历史压缩**不应该主要依赖这两个**。

因为目前 `tool_call` 是发生在执行前，它修改的是**真的要被工具执行的参数**；文档现在明确说，model-issued call 的修改会被重新 validation，之后 scheduling、execution、persisted assistant message、approval 都看到修改后的 input。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md?utm_source=chatgpt.com))

也就是说：

```text id="xpf258"
tool_call hook
```

更像：

> “把模型刚刚要求执行的 `rm -rf x` 改成另一个参数再真正执行。”

这不是 DCP 想要的。

`tool_result` 也是 tool 刚执行完成之后的 middleware，可以直接 patch actual output。([github.com](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md?utm_source=chatgpt.com))

而我们真正想要的是：

```text id="jdrul6"
真实历史：
    原 ToolCall
    原 ToolResult

             ↓ context hook

给模型的历史：
    compressed ToolCall
    compressed ToolResult
```

**session 数据保持无损，LLM context 虚拟压缩。**

而 `context` hook 正好就是这个语义。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts))

所以这一部分我现在可以很明确地说：

> **DCP 的主体不需要侵入 OMP core 的 message storage，就可以做到 per-call / per-result / per-pair 的虚拟压缩。**

---

# 7. 唯一比较值得警惕的是 provider-native tool

这里不是所有 tool 都完全一样。

普通的：

```text id="mxk2w6"
bash
read
grep
MCP JSON tool
custom JSON function tool
```

这种我们有很大的处理空间。

但 OMP 现在还有 provider-native metadata，例如：

```ts id="eo3e6t"
customWireName
providerMetadata
providerPayload
thoughtSignature
```

其中 `customWireName` 就是为了让 OpenAI Responses 的 custom tool 能在 history replay 时重新发成对应的 native wire item；`providerPayload` 甚至明确被定义成“用于重建 transport-native history 的 opaque payload”。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/types.ts))

Anthropic server-side tools 更严格：OMP 源码直接写着，native server-tool call/result 在同 provider replay 时要求保持 unchanged；换 provider 则直接 drop。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/providers/transform-messages.ts))

因此我们最后实现时应该把技术对象分成两类：

```text id="6h643f"
normal JSON ToolCall / ToolResult
        ↓
DCP fully manageable

provider-native replay objects
        ↓
special handling / exemption / provider-specific adapter
```

**不是 DCP 做不了，而是不能把所有 provider-native payload 当普通 JSON function call 粗暴处理。**

另外，OMP 自己一旦修改 `ToolCall.arguments`，credential-redaction 实现会主动清掉 `thoughtSignature`，这也是个很好的提示：修改 call 内容后，签名类 provider metadata 不能盲目保留。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/providers/transform-messages.ts))

---

# 8. 真正可能迫使我们改 core 的地方，反而不是 message compression

我刚才特别去追了这个边界。

目前 OMP 存在一个**更早的 tool output inline cap**，默认是 **50 KB**。超过上限的 output 在进入后面的 request-time transform 之前就可能已经进行 head/tail truncation，并尽可能留下 `artifact://` recovery path。现有 #5338 proposal 对这一点说得非常明确：

> request-time extension 可以处理仍完整抵达 transform 层的结果，但**无法恢复在 50 KB cap 阶段已经被丢掉的 bytes**。([github.com](https://github.com/can1357/oh-my-pi/issues/5338))

因此：

```text id="ggj8lu"
Tool executes
    ↓
OMP output cap / truncation     ← 原始数据可能已经丢失
    ↓
session/context
    ↓
DCP context hook               ← 可以随意改剩下的数据
    ↓
provider
```

如果 DCP 的目标只是：

> “压缩模型本来就能看到的历史 tool result”

**纯插件完全够。**

但如果目标进一步变成：

> “我希望 DCP 在 OMP 自动截断一个 300 KB tool result 之前，就先拿到完整 300 KB，智能地做 lossless/retrieval-aware compression。”

那么这个点，**extension 的 context hook 太晚了**。要么介入更早的 cap site，要么 core 给扩展暴露 pre-cap hook。#5338 本身提出的 staged implementation 也是这个思路。([github.com](https://github.com/can1357/oh-my-pi/issues/5338))

这才是目前我看到的最实质性的 core boundary。

---

# 最后把技术边界压成一句话

当前 OMP 对 DCP 实际给我们的能力大概是：

> **只要 tool 数据已经进入 OMP message history，DCP 基本拥有完整的 outbound-context 编辑权：可以单独压 result，可以单独改 call arguments，也可以原子删除整个 call/result pair，再换成任意合法的上下文表示；真实 session 可以完全不动。**

不能随便做的只有两件事：

1. **不能破坏 provider 所要求的 call/result pairing 后还期待它继续作为 tool protocol history 使用。**
2. **不能在 context 阶段恢复 OMP 更早已经因为 50 KB cap 丢掉的数据。**

所以这方面我认为可以把原先的担忧大幅降低。**普通 tool call/result 的 DCP 我现在看不到需要修改 core 的理由；而且不仅能做到“result 替换成 `[compressed]`”，实际上设计空间一直开放到 pair-level arbitrary rewrite。**

下一步真正值得继续深挖的，反而是两个更尖锐的问题：**OpenAI Responses/Codex 的 `providerPayload` 是否会绕过我们改过的 logical message content 继续 replay 原始 tool bytes**，以及 **DCP 应当如何在 50 KB pre-cap 之前取得完整 tool output**。这两个才可能决定最终有没有那一小部分必须进入 OMP core。([github.com](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/types.ts))
