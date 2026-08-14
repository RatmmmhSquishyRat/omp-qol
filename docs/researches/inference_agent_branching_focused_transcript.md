# Inference Agent / Tool-call Branching Discussion — Focused Transcript

> This is a transcript cut, not a rewrite. Selected passages are kept verbatim; omitted material is simply absent. The selection focuses on the user-defined requirements, the branch/resume question, cache/latency constraints, and the remaining experiment target.

## User — Initial idea

我有一个想法, 现在model在思考过程中不是可以进行工具调用么, 我在想这时候工具调用的情况下, 能否改变之前的消息, 并将思考的tool call作为普通消息纳入, 来切换agent的role面具, 作为一个单独的request发送, 让这个请求中的模型单独处理这个tool call, 最后再返回原请求的tool call.

---

## User — Core performance constraint

让我来澄清一下, 这里的工程不是问题, 谁都知道这是一个LLM backend tool. 
而真正的问题, 在于多次大量使用情况下的缓存失效问题, 以及调用速度问题, 我的期待是agent在推理或者输出过程中, 大量地调用这种tool, 以至于将其无感作为自己的输出的一部分存在. 因此, 这种调用必须是廉价快速的, 并且其效果还不能够低于主agent的原始输出形式.

---

## Assistant — Cache / latency constraints

**如果“切换 role”需要重写已经存在的历史 prefix，那么这个方案基本不适合你设想的高频调用。**  
但如果把它改成 **KV-preserving、append-only 的 role fork**，那么它是有机会做到你要的量级的，而且现在几家 provider 已经分别提供了非常接近这个方向的基础设施。

关键区别就在这里：

```text id="5rr1or"
错误方向：
[system=A][大量历史 H]...
        ↓
改 system=A → system=B
        ↓
整个 H 后面的 KV 基本重新算

正确方向：
[稳定 system][大量历史 H][当前状态]
                         ↑ cache frontier
                         │
                         ├─ [role_delta=B][request] → branch
                         │
                         └─ [tool_result]           → main
```

你真正需要舍弃的是“**修改旧消息实现换脸**”这个动作，而不是换脸本身。

**因此 cache 与 role switching 本身并不冲突；“修改旧 prefix”才与 cache 冲突。**

不过注意：cached input 即使便宜，也不是免费。真正最后占主导的会逐渐变成：

> **branch 的 output tokens + 每次 inference 固有启动延迟。**

而不是历史 context。

**Prompt caching 解决的是 prefill，不解决 decode，也不能完全消灭 request boundary。**

真正可能成立的是：

> **把 specialist call 本身直接作为最终输出的一段，而不是 specialist 生成完以后再让 main model 重述一遍。**

这样 specialist 的 300 output tokens **替代了**本来 Main 要生成的 300 output tokens。

你新增的成本就主要不是：

```text id="0q9jfd"
300 specialist output
+
300 main output
```

而是：

```text id="cdqy5s"
原本就要生成的 300 output
+
一次 fork 固有 latency
+
cached-context read
```

这才是你所说的：

> “无感作为自己输出的一部分”

在经济上能够成立的关键。

### 真正会降低质量的是 reasoning-state loss

连续 Main inference 原本拥有：

```text id="lglzuh"
visible transcript
+
当前 hidden reasoning state
+
刚刚形成但未外显的工作状态
```

如果 branch 只能看到：

```text id="dgm3ss"
visible transcript
+
tool args
```

那么你实际上把 Main 的内部 state 投影丢了一部分。

这种情况下，**你无法保证 branch ≥ Main continuation。**

所以理想 branch 应该拿到：

```text id="3jj3nc"
P = visible context
  + persisted/opaque reasoning state
  + current partial output
  + current tool invocation
```

然后只增加：

```text id="sxtdoh"
role_delta
```

而不是重新从 transcript 猜 Main 刚才脑子里在想什么。

---

## User — Four explicit requirements

还是让我们来收束一下吧:

1. main agent的主要大量上下文应当被保留
2. inference agent本身应该是main agent以外的单独请求, 在main tool阻塞时候执行
3. inference agent在有main agent上下文基础上, 应该知道自己的着重点是什么, 或者负责BERT的部分是什么, 还有也就是自己要输出什么. 如果我们的做的非常还原流程的话, 那么很可能就是取下一个输出返回. 如果不能够很流畅, 那么也就只能要求输出tool call作为yield返回
4. inference agent添加的消息, 肯定不可能在大量消息上面啊, 肯定是要在最下面, 也就是紧接着main agent思考的消息的上面一条. 关键就在于我能不能在思考因为tool调用而阻塞的时候, 进行branch, 也就是说本身可能是完全一致的思考location, 只有前面的一条消息的面具不同, 从而形成最流畅的inference agent调用.

---

## Assistant — Exact fork point

> **能不能把 Main 的 `tool_call` 当成一个 fork point，让 Inference request 继承“截至这个 tool_call 为止完全相同的上下文 + reasoning state”，只在 fork point 之后追加极短的 role mask，然后直接生成下一段？**

答案是：**可以做到非常接近，而且这应该是正确实现；但不要试图把 mask 插到已经生成的 reasoning 前面。**

最理想的实际形态应该是：

```text id="11arsg"
Main request:

P = 所有历史上下文
R = 当前 Main reasoning
C = inference_tool_call

P ── R ── C
          │
          │  Main 暂停
          │
          ├──────────────────────────────┐
          │                              │
          ▼                              ▼
      Main continuation             Inference branch
                                   
                              P ── R ── C
                                       │
                                       + tiny branch/mask
                                       │
                                       ▼
                                  next output
```

这里 **`P + R + C` 应该逐 item 完全一致**。

所以第 1、2 点都没问题：

**Main 的大量上下文不复制性重构；Inference 是一个新的 sample/request；两者共享同一个逻辑 parent state。**

## 所以真正漂亮的 fork point 应该是 **tool call 后**

即：

```text id="8qsqt2"
Main:

P
↓
R
↓
inference_tool_call
──────────────────── fork boundary
```

Inference branch：

```text id="mu9uqx"
P
↓
R
↓
inference_tool_call
↓
[极短 branch activation / tool result]
↓
[Inference role mask]
↓
assistant generates NEXT
```

Main 最后则是：

```text id="fizp5z"
P
↓
R
↓
inference_tool_call
↓
[inference output as tool_result]
↓
Main continues
```

**两个模型一直到 `inference_tool_call` 都位于完全相同的位置。**

真正分叉发生在：

```text id="gkgpr2"
                  ┌→ inference mask → inference next tokens
P → R → tool_call ┤
                  └→ inference result → main next tokens
```

这才是真正意义上的 prefix fork。

而且 cache 性质是最好的，因为 **从 conversation 开头一直到 tool call 都 byte-identical**。

我认为 Inference agent **不应该收到一个“重新理解任务”的 prompt**。

它收到的应当只有极薄的一层：

```text id="yygn19"
<shared Main context>
<shared Main reasoning up to tool call>
<shared inference tool call>

ROLE:
You are now responsible for X.

YIELD:
Generate exactly the next continuation segment.
```

Inference 模型不是：

> “这是一个任务，请你重新做。”

而是：

> **“你刚才就在这里思考；现在，从这个 token location 开始，你负责这一段。”**

如果模型能很好地服从 `yield=next`，它直接吐：

```text id="4h8ahx"
下一段 reasoning / prose / code
```

如果做不到稳定的“next continuation”，你的备选才是：

```text id="0slgsb"
yield = tool_call
```

我同意你的排序：

**自然 continuation > structured yield/tool call**。

如果你说的“完全一致的思考 location”是非常严格的：

> **两个 decoder 真正共享同一套 GPU KV blocks，然后从某个 sequence position clone/fork，分别继续 sampling。**

那么**公共 LLM API 通常没有把这种底层 `fork(sequence_id)` primitive 暴露给客户端。**

因此应该区分：

```text id="ciw9ch"
逻辑 inference fork
    当前 API：可以

prefix KV reuse
    当前 API：可以通过 cache 获得

persisted reasoning continuity
    当前 reasoning API：可以

客户端显式 clone 当前 decoder KV state
    当前公共 API：没有这种 primitive
```

---

## User — Current implementation view and actual risk

OK我认为你说的没有问题, mask和instruction既可以就放到inference agent的tool result, 也可以终止thinking的情况下放一个system msg, 各有千秋, 虽然我认为第一种可能更自然;

然后, inference agent只需要捕捉其下次对应的tool call, 或者直接捕捉紧接着的thinking block(这里需要parser一下吗? 怎么保证输出内容符合BERT填空?), 就能够拿到填空结果返回.

这些不管怎么说都是小问题. 但是由于我的认知能力限制, 我现在最担心的是, thinking中途阻塞的tool call, 是否能够被branch同时运行, 且还能回到之前的main agent阻塞位置, 给出result重新运行. 也就是大模型普遍的服务端的状态化, 具体会到什么程度, 是不是thinking过了这段, 就不能回来调用了. 还是说他们只认每次的request, 只要格式对就行, 并且request信息自身是完整的.

这个是现在调查重点吧

---

## Assistant — Core answer to the actual risk

最重要的结论是：

> **对于主流的 client-side tool calling，模型并不是在服务端维持一个“正在 thinking、停在某个程序计数器上等待 tool result”的不可复制执行实例。**
>
> tool call 出来以后，这一轮模型生成实际上已经形成了一个 response；之后所谓“继续原来的 thinking”，本质上是**另发一次 inference request，把刚才那段状态重新提供/引用进去，再加上 tool result。**

所以你担心的：

> “模型已经 thinking 到这里了，我拿它去 branch 一次之后，还能不能回来？”

答案目前是：**能。这个 branch 在 API 抽象上没有根本障碍。**

OpenAI 当前文档写得非常明确：

> **each text generation request is independent and stateless**

同时 Responses API 提供 `previous_response_id`、Conversation object 等机制，帮助你保存/引用之前的状态。([developers.openai.com](https://developers.openai.com/api/docs/guides/conversation-state?utm_source=chatgpt.com))

而 function calling 的官方流程就是：

```text id="809ly8"
Request A
   ↓
model generates
   ↓
function_call
   ↓
Request A 结束

你的程序执行工具

Request B
   input =
       previous context
       previous model output
       function_call_output
   ↓
model continues
```

官方明确叫它 **“Make a second request to the model with the tool output”**。([developers.openai.com](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com))

所以这里首先要纠正一个很容易产生的心智模型：

```text id="zihzpt"
并不是：

GPU decoder
   ↓
thinking thinking thinking
   ↓
tool_call
   ↓
[服务端线程 sleep 等你]
   ↓
tool_result
   ↓
原线程醒来继续
```

更接近：

```text id="kve1ci"
Inference #1
P → R → ToolCall
              │
              ▼
          response 完成

--------------- API boundary ---------------

Inference #2
P → R → ToolCall → ToolResult → continuation
```

**“阻塞”主要是 agent harness 层面的概念。**

因为 provider 把 continuation 所需要的状态，以某种 **可重放 representation** 暴露/保存了。

所以从你的角度可以把：

```text id="2x6onf"
S =
{
    messages,
    reasoning_items,
    function_call,
    call_id,
    ...
}
```

看成这个逻辑断点的 **continuation representation**。

API 已经保证：

```text id="iae9rc"
S + tool_result
```

是合法的 continuation。

OpenAI / Anthropic / Gemini 三家虽然 representation 不一样：

```text id="5a87sf"
OpenAI:
reasoning items / previous_response_id

Anthropic:
thinking blocks

Gemini:
thought signatures
```

但基本思想高度一致：

> **tool boundary 上的 reasoning continuation 被序列化成了 API 可再次引用的状态。**

假设 Main 得到了：

```text id="uzqpu7"
STATE S₀

[huge context P]
[main reasoning R]
[inference_tool_call C]
```

注意到这里，**Main inference 已经结束**。

现在 harness 可以保存：

```text id="8tp6es"
S₀
```

然后从它发出一个 Inference 请求：

```text id="896ail"
                 ┌──── Inference request
                 │
S₀ ──────────────┤ + inference pseudo-result
                 │ + role mask
                 │
                 └→ inference output I
```

这个过程中 **S₀ 没有被消费掉**。

然后你完全可以再次拿原始的：

```text id="49pwzc"
S₀
```

发 Main continuation：

```text id="pjzvys"
S₀
+
function_call_output(C, I)
    ↓
Main continuation
```

也就是：

```text id="49r86l"
                         Branch inference
                       ┌──────────────────→ I
                       │
P → R → ToolCall C ────┤
                       │
                       └──────────────────→ ToolResult(I)
                                                   ↓
                                             Main continues
```

**这就是我们想要的 fork。**

因此我甚至建议我们的底层抽象不要依赖：

```text id="5puu8l"
mutable Conversation object
```

做 branch。

而应该是：

```text id="vpekaz"
immutable checkpoint / parent state
```

比如：

```text id="eiuoer"
Checkpoint K37
    ↓
    ├── request(branch=A)
    ├── request(branch=B)
    └── request(main-resume)
```

这样语义最干净。

### 可以保证

```text id="45wmh7"
same logical reasoning checkpoint
        ↓
multiple future inference requests
```

### 不能从公共 API 保证

```text id="34s5a2"
GPU KV block #1234
      ↓ clone()
      ├→ decoder A
      └→ decoder B
```

Provider 可能：

- 真正 clone/reference KV；
- prompt cache 命中；
- 重新 prefill 一部分；
- 使用 opaque reasoning state；
- 将 state 迁移到另一台 worker。

这些是服务端实现细节。

所以：

> **正确性上的 branch 已经基本成立。**

现在剩下需要实验确认的是：

> **这种 branch 在物理执行上到底多快、多大概率命中 cache。**

因此我现在会把项目中的核心假设写成：

```text id="nyd0rs"
Tool call is not a mutable suspended decoder.
Tool call is an immutable inference checkpoint.
```

而这个假设目前有很强的官方 API 语义支撑。

**下一步真正值得调查/实测的就只剩一个大问题了：同一个 `K42` 连续/并发 fork 时，OpenAI / Anthropic / Gemini 各自的实际 cache-hit、TTFT 和 reasoning continuity 成本到底是多少。** 这才会决定这种 inference primitive 能不能高频到像普通输出一样使用。

---
