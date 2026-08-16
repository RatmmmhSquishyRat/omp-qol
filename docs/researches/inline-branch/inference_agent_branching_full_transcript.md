# Inference Agent / Tool-call Branching Discussion — Full Transcript

> Scope: all visible user/assistant messages in the technical discussion immediately preceding the export request. Message bodies are preserved verbatim; speaker headings and separators are added only for navigation.

## User

我有一个想法, 现在model在思考过程中不是可以进行工具调用么, 我在想这时候工具调用的情况下, 能否改变之前的消息, 并将思考的tool call作为普通消息纳入, 来切换agent的role面具, 作为一个单独的request发送, 让这个请求中的模型单独处理这个tool call, 最后再返回原请求的tool call.

---

## Assistant (progress update)

这个思路在 **harness 层面是可行的**，而且关键不是“模型能不能在同一次推理里改历史”，而是：**把一次 tool call 当成暂停点，fork 出一个新的模型 request，并在这个 fork 中重写 transcript / system role，再把结果接回原来的 tool call。** 我先把“真正可行的边界”和“看起来像可行但协议上其实不是一回事”的部分拆开。

---

## Assistant (progress update)

目前最关键的边界已经很清楚了：**不要把“角色切换后的子请求”真的插入原 request 的 canonical message chain。** 原链应当停在 tool call 上；子请求是一条旁路 branch。等 branch 做完，只把它的最终产物伪装成原 tool call 的 `tool_result` 接回去。这样协议最干净，也不会破坏原模型的 reasoning continuation。OpenAI 也明确把 tool calling 定义成“模型返回调用 → 应用执行 → 第二次请求携带结果继续”的循环。

---

## Assistant

可以，而且我认为你这个思路在 harness 层面是一个相当干净的抽象。

更准确地说，它不是“在一次正在运行的 inference 中修改历史消息”，而是：

> **主模型在 reasoning 中产生一个 tool call → 主 inference 在这里暂停 → harness fork 一个新的 LLM request → 在这个 request 中改写历史、切换 role mask，并把刚才的 tool call 序列化成普通输入 → specialist 模型处理 → 将 specialist 的最终输出作为原 tool call 的 result 返回 → 主模型继续原来的 reasoning。**

这本质上是一个 **LLM-backed tool / dynamic role fork**。

### 1. 最干净的结构

假设主 Agent 当前是：

```text id="s91o1l"
Main request A

[system: Main Agent]
[user: ...]
[assistant/reasoning: ...]
[tool_call:
    role_delegate(
        role="reviewer",
        task="检查刚才这个设计"
    )
]
```

此时不要真正执行一个普通工具。

Harness 捕获 `role_delegate` 后，建立 **完全独立的 request B**：

```text id="y3beqh"
Forked request B

[system:
    You are Reviewer Agent.
    ... reviewer role mask ...
]

[经过选择/修改后的历史消息]

[user:
    Parent agent issued the following request:

    role_delegate({
        "role": "reviewer",
        "task": "检查刚才这个设计"
    })

    Handle this delegated request.
]
```

B 可以使用：

- 同一个模型；
- 不同模型；
- 不同 tools；
- 不同 system/developer prompt；
- 不同历史窗口；
- 压缩后的历史；
- 甚至完全不同的 message-role mapping。

然后 B 得出：

```text id="l5ofd2"
Reviewer result:
"..."
```

Harness **不把 B 的完整 conversation 塞回 A**。

而只是：

```text id="c5sxd9"
Main request A continuation

[原来的 reasoning item]
[原来的 role_delegate tool_call]
[tool_result:
    "...Reviewer result..."
]
```

然后 Main Agent 接着想。

这正好符合标准 tool calling 的天然暂停/恢复模型：模型发出调用，application 执行，之后用关联到该 `call_id` 的 tool output 继续。([developers.openai.com](https://developers.openai.com/api/docs/guides/function-calling))

---

## 2. 你所说的“改变之前的消息”，实际上也可以

但这里要把 **branch 的历史** 和 **main 的历史** 分开。

你完全可以：

```text id="1ngor2"
Main history H
       │
       │ tool call
       ▼
   ┌─────────┐
   │  Fork   │
   └─────────┘
       │
       ▼
Transform(H)
```

比如原历史：

```text id="yq7ejj"
System: general coding agent

User
Assistant
Tool
Assistant
Tool
User
...
```

给 reviewer fork 时可以变成：

```text id="b6d5ef"
System: adversarial architecture reviewer

Context:
<压缩过的相关历史>

Parent-agent state:
<当前任务>

Delegated operation:
<原来的 tool call>
```

**这个 request 是你自己新构造的，因此当然可以任意改变之前的 message representation。**

这和修改已经提交给 provider 的那个 request 是两件完全不同的事情。

后者做不到：

```text id="dylr4d"
request 已经在服务器里跑
        ↓
模型开始 reasoning
        ↓
突然要求 provider：
“把前面第三条 message 改一下”
```

一般不存在这种 API。

但 tool call 已经天然给了你一个 request boundary，因此：

```text id="qqpg33"
Request A
   ↓
reasoning
   ↓
tool call
   ↓
──────── API boundary ────────
   ↓
你的 harness 获得控制权
```

从这里开始，你想发多少个新的 request 都可以。

---

# 3. 而且你的“role mask”甚至比我一开始想的更容易实现

以当前 OpenAI Responses API 为例，有一个非常适合你这个设计的性质：

**`instructions` 是 request-local 的。**

即便使用 `previous_response_id`，前一个 response 的 top-level instructions 也不会自动继承，所以后续 request 可以换另一套 system/developer instructions。官方甚至明确说这样可以方便地 swap system/developer messages。([developers.openai.com](https://developers.openai.com/api/docs/guides/migrate-to-responses?utm_source=chatgpt.com))

所以从模型 API 的视角来看：

```text id="kpng2o"
Request 1:
instructions = Main Agent mask

        ↓ tool call

Request 2:
instructions = Specialist mask
```

这种东西本身完全合理。

不过**我仍然不建议直接拿 Request 2 取代 Main 的 continuation**。

因为那会变成：

```text id="t4xcjg"
Main → Specialist → Specialist → Specialist...
```

而不是：

```text id="e0ktdg"
                  ┌→ Specialist →┐
Main → tool call ─┤              ├→ Main continues
                  └──────────────┘
```

你想要的明显是第二种。

---

# 4. 一个非常重要的细节：不要把 branch 插进原 tool-call chain

这是我认为这个设计最需要定死的 invariant：

> **Fork conversation 是 ephemeral / out-of-band 的。**

主 conversation 中只留下：

```text id="x67kw1"
assistant reasoning
assistant tool_call
tool_result
assistant reasoning
```

而不是：

```text id="35rqs7"
assistant reasoning
assistant tool_call

system: Reviewer
user: ...
assistant: ...
assistant: ...

tool_result
```

后者会污染甚至直接违反 provider 的 tool protocol。

例如 Anthropic 明确要求 client tool 的：

```text id="q70j54"
assistant: tool_use
```

之后必须紧跟对应的：

```text id="773ixw"
user: tool_result
```

中间不能插入别的 conversation message。([docs.anthropic.com](https://docs.anthropic.com/ko/docs/agents-and-tools/tool-use/implement-tool-use?utm_source=chatgpt.com))

所以 **side branch + 单一 result 回填** 是跨 provider 最稳妥的实现。

---

# 5. 还有一个非常重要的限制：不能真正拿到“思考内容”

如果你说：

> “将思考的 tool call 作为普通消息纳入”

这个没问题。

因为：

```text id="hgmnza"
tool name
tool arguments
call id
```

都是 harness 可以看到的。

但是如果你的意思还包括：

```text id="85qawz"
模型在调用 tool 前面的完整 private CoT
```

那通常拿不到。

比如 OpenAI reasoning model 返回的是 opaque reasoning state / reasoning items，而不是完整 raw chain-of-thought；这些 reasoning items主要用于让后续 inference 保持推理连续性。([developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning?utm_source=chatgpt.com))

因此 branch 能得到：

```text id="1ipya5"
history
+
visible context
+
tool_call(name,args)
+
可选 reasoning summary
```

而不是：

```text id="spya9c"
完整的隐藏思考过程
```

但实际上**这并不妨碍你的机制成立**。

因为 tool call 本身就是主 agent 主动生成的 delegation interface。

---

# 6. 真正需要小心的是“修改主 Agent 的历史”

这里我要进一步区分两种东西。

### A. 只修改 Fork 的历史

**完全没问题。**

```text id="cqu8xe"
H_main

    ├──── Transform(H_main) → Specialist
    │
    └──── H_main unchanged → Main
```

这是我推荐的。

### B. Specialist 回来以后，同时修改 Main 的旧历史

例如：

```text id="y5ylq8"
H_main(original)
       ↓
tool call
       ↓
Specialist
       ↓
产生新的 H_main'
       ↓
拿 H_main' 恢复原 reasoning
```

这个就危险很多。

特别对于 persisted reasoning model，因为：

```text id="9qyxob"
R = reasoning(H_original)
```

你却让它继续：

```text id="8klg8e"
H_modified + R
```

于是 reasoning state 和它原来看到的 context 不再一致。

OpenAI 对 reasoning + function calling 的当前建议恰好也说明了这个边界：做高级 context trimming/optimization 时，应当至少保持**从最近 user message 到 function-call output 之间的 items 原样不动**，这样模型才能正确延续先前 reasoning。([developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning?utm_source=chatgpt.com))

所以如果以后拿这个机制做 DCP，我会定义一个 **protected current reasoning span**：

```text id="dst3a7"
──── 可以重写/压缩 ────
old history
old history
old history

════════ PROTECTED ════════
latest user
reasoning item
tool call
tool result
═══════════════════════════
```

这样技术上会非常漂亮。

---

# 7. 还有一个非常容易走错的地方：Specialist 不应该“返回一个新的 main tool call”

比如：

```text id="vo8e2c"
Main:
    call delegate_reviewer()

Reviewer:
    我认为现在应该调用 bash(...)
```

你不能简单地把 Reviewer 的：

```text id="jz669m"
tool_call bash(...)
```

硬塞成 Main 当初生成的 tool call。

因为 Main provider 当前实际上是在等待：

```text id="mg95xe"
delegate_reviewer(call_id=abc)
             ↓
function_call_output(call_id=abc)
```

它不是在等待另一个：

```text id="q4c7at"
assistant -> bash(call_id=xyz)
```

OpenAI 的 function output 也是通过 `call_id` 与原调用对应的。([developers.openai.com](https://developers.openai.com/api/docs/guides/function-calling))

因此有两个正确选择。

**最推荐：**

```text id="5nsrut"
Main
 ↓
delegate()
 ↓
Reviewer
 ↓
Reviewer 自己调用 bash
 ↓
Reviewer 完成
 ↓
delegate result
 ↓
Main
```

所有 secondary tools 都封装在 branch 内。

或者 Reviewer 可以返回：

```text id="eppgj3"
{
  "recommend_tool": "bash",
  "arguments": {...}
}
```

作为普通数据给 Main，由 Main 自己决定是否再次 call。

---

# 8. 所以它实际上可以成为一种很强的 Agent primitive

我甚至不会把工具设计成：

```text id="v3zjtf"
switch_role(...)
```

而更倾向于把核心 primitive 定义成类似：

```text id="3k3nwc"
delegate(
    mask,
    task,
    context_policy,
    tool_policy,
    return_schema
)
```

内部语义：

```text id="ql0scl"
                    ┌──────────────────────────┐
                    │ Fork context             │
                    │ Transform history        │
                    │ Install role mask        │
                    │ Run another inference    │
                    │ Resolve its nested tools │
                    └────────────┬─────────────┘
                                 │
Main reasoning → delegate() ─────┤
                                 │
                    result ◄─────┘
                        │
                        ▼
                 Main reasoning
```

这样就出现了几个很有意思的东西：

```text id="h0yy43"
delegate("critic")
delegate("planner")
delegate("researcher")
delegate("compressor")
delegate("memory-manager")
delegate("tool-specialist")
delegate("coding-executor")
```

而它们**甚至不一定是真正独立、长期存在的 subagent**。

它们可以只是：

> **同一个 foundation model，在一次 tool boundary 上重新戴了一张 role mask，并读取一个经过重新投影的 conversation。**

我觉得这恰好抓住了你这个想法最有价值的地方。

---

## 结论

所以如果你问的是纯技术可行性，我会给得相当明确：

**可以，而且不需要模型/API 提供什么神奇的“mid-reasoning role switching”能力。Tool call 本身已经提供了你需要的 suspension point。**

真正的实现应该是：

```text id="5k1uyl"
Main inference
      │
      ▼
tool call
      │
      ├── save original continuation state
      │
      ├── fork transcript
      │
      ├── rewrite/filter/compress old messages
      │
      ├── serialize tool call as normal input
      │
      ├── replace role mask
      │
      ├── run independent model request
      │
      └── resolve all branch-local tools
      │
      ▼
tool_result(original call_id)
      │
      ▼
resume Main inference
```

**Main chain 原样保留，Branch 任意改造，最终只通过 tool result 这个窄接口重新汇合。**

如果你是想把这个机制加入我们最近讨论的 **OMP/DCP proposal**，那我认为它的意义其实比普通“subagent”更大：它可以成为一种通用的 **context projection + role projection + nested inference** 原语，DCP compression、advisor、critic、memory processing 甚至 specialized tool execution 都能建立在同一个 primitive 上。([developers.openai.com](https://developers.openai.com/api/docs/guides/tools))

---

## User

让我来澄清一下, 这里的工程不是问题, 谁都知道这是一个LLM backend tool. 
而真正的问题, 在于多次大量使用情况下的缓存失效问题, 以及调用速度问题, 我的期待是agent在推理或者输出过程中, 大量地调用这种tool, 以至于将其无感作为自己的输出的一部分存在. 因此, 这种调用必须是廉价快速的, 并且其效果还不能够低于主agent的原始输出形式.

---

## Assistant (progress update)

对，你现在问的已经不是“能不能做”，而是这个 primitive **能不能做到接近一次连续生成的单位成本和体感延迟**。这里决定成败的其实有三个量：**prefix/KV cache 能复用到哪里、每次 fork 固有的 TTFT/调度开销、以及新 request 丢失主模型隐式 reasoning state 后的质量损失**。我会按这三个量来判断，而不是再讨论 agent 工程结构。

---

## Assistant (progress update)

有一个当前 API 细节对这个设想非常关键：到 GPT-5.6 这一代，OpenAI 已经支持**显式 prompt-cache breakpoint**，也就是说“后面的 role/tool-call 内容不断变化，但前面的稳定历史继续命中缓存”已经不只是理论 workaround，而是官方支持的模式；breakpoint 之后变化不会使之前的 cache 失效。反过来，如果你真的去改 breakpoint **之前**的旧消息，KV cache 仍然必然从第一个变化处失效。

---

## Assistant

对。按你现在这个约束，结论会明显收紧：

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

### 1. Cache 问题实际上已经可以解决得相当漂亮

Transformer KV cache 有一个硬约束：**从第一处 token 变化开始，后面的 KV 就不能正确复用。** 所以如果每调用一次 tool 就把最前面的 system prompt 换掉：

```text id="tkrp0j"
system: coder
→
system: critic
```

那么历史再长也没有意义，后面基本全部 cache miss。

但现在已经有两种很强的办法。

OpenAI GPT‑5.6 支持显式 `prompt_cache_breakpoint`：可以把大量稳定历史锁在 breakpoint 前，后面的 suffix 不断变化，而不使前面的 cached prefix 失效。缓存仍然要求 breakpoint 以前严格相同，但这恰好适合你的场景。~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

更有意思的是 Anthropic 已经直接做出了与你这里几乎同构的功能：**mid-conversation system messages**。官方给出的用途甚至直接包括 session 中途改变 policy/persona，而且明确说这样做的目的之一就是**避免修改顶部 system prompt 导致 cached prefix 失效**。后加入的 system message 仍然具有 system-level priority。([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages))

所以你可以把 role mask 写成：

```text id="obtn7k"
Stable prefix P
────────────────────────────────── cache frontier

system/developer:
For the following delegated operation,
act as <ROLE B>.
<role delta>

user/tool-like message:
<delegated request>
```

而不是：

```text id="uj5e4o"
rewrite(P)
```

OpenAI 虽然机制没有 Anthropic 这个功能那么直接，但 Responses 的 conversation input 可以包含 developer messages，而同级后出现的 instruction 可以 supersede 前面的 instruction，所以同样可以构造一种 append-only developer-level role delta。([developers.openai.com](https://developers.openai.com/api/docs/guides/text))

**因此 cache 与 role switching 本身并不冲突；“修改旧 prefix”才与 cache 冲突。**

---

## 2. 成本问题：cache 可以让 input 几乎不再是主要矛盾

假设：

- `H` = 100K token 历史
- `d` = 200 token 新 role/request
- `y` = 300 token specialist 输出

每次 branch 不应该付：

```text id="pbbvbp"
100K uncached input
+ 200
+ 300 output
```

而应该近似变成：

```text id="hh4fwo"
100K cached input
+ 200 fresh input
+ 300 output
```

当前 GPT‑5.6 的标准短上下文价格里，cached input 是普通 input 的 **1/10**；Anthropic prompt-cache read 同样大致是基础 input 价格的 **1/10**。([developers.openai.com](https://developers.openai.com/api/docs/pricing?utm_source=chatgpt.com))

更重要的是，对于这种**重复 fork 同一历史**的模式，cache write 的额外成本只需要摊一次。

Anthropic 的 Advisor 文档甚至专门讨论了这种 workload：

```text id="23b0fu"
call 1: P + branch1
call 2: P + branch1 + branch2
call 3: P + branch1 + branch2 + branch3
...
```

后面的调用直接读之前的 cache，只计算新增 suffix；他们给出的经验是，大约从 **3 次 advisor 调用左右**开始 caching 就已经能达到成本 break-even，之后调用越多越合算。([docs.anthropic.com](https://docs.anthropic.com/en/agents-and-tools/tool-use/advisor-tool))

所以如果你说：

> 一个 response 里面不是 call 一次，而是 call 10 次、20 次甚至更多。

**这反而比偶尔 call 一次更符合 cache 的经济性。**

不过注意：cached input 即使便宜，也不是免费。真正最后占主导的会逐渐变成：

> **branch 的 output tokens + 每次 inference 固有启动延迟。**

而不是历史 context。

---

# 3. 真正难办的是 latency，而不是 cache

这一点不能绕过去。

假设原本模型连续输出：

```text id="m1wle6"
AAAA BBBB CCCC DDDD
```

你变成：

```text id="hmw1yb"
AAAA
  ↓ fork
BBBB
  ↓ resume
CCCC
  ↓ fork
DDDD
```

即使 `AAAA...` 的 KV 全部命中，每一次 fork 仍然至少有：

```text id="tqp5lf"
request scheduling
+
branch TTFT
+
branch decoding
+
parent resume
```

所以它永远不可能和“同一个 decoder 连续吐下一个 token”具有完全相同的物理成本。

**Prompt caching 解决的是 prefill，不解决 decode，也不能完全消灭 request boundary。**

OpenAI 自己的 latency guide 也把“减少请求次数”列为降低延迟的重要方法，同时指出生成 token 往往是延迟的最大来源。([developers.openai.com](https://developers.openai.com/api/docs/guides/latency-optimization))

因此你的目标应该不是：

> 每 5 个 token 都免费换一次 agent。

这个在普通云 API 上基本不现实。

真正可能成立的是：

> **把 specialist call 本身直接作为最终输出的一段，而不是 specialist 生成完以后再让 main model 重述一遍。**

例如：

```text id="hq7evu"
Main generates:
"对于这个问题，我认为——"

       ↓ specialist tool call

Specialist streams directly to user:
"真正关键的是缓存边界……"

       ↓ specialist result returned

Main resumes:
"除此之外，还有第二个问题……"
```

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

---

## 4. 实际上 Anthropic Advisor 已经证明这种 execution model 是现实存在的

这一点我觉得非常值得你注意。

Anthropic 现在的 Advisor tool 并不是普通 client-side tool。

流程实际上是：

```text id="s4qajz"
Executor model generating
        │
        ▼
server_tool_use: advisor
        │
        ▼
Anthropic server 内部
启动另一次模型 inference
        │
        ▼
advisor_tool_result
        │
        ▼
Executor 原地继续生成
```

而且 advisor 会得到 executor 的完整 transcript，包括：

- system prompt；
- tools；
- previous turns；
- tool results；
- **当前这个 turn 中 executor 已经生成出来的 text**。

全部发生在**一个 `/v1/messages` 请求内部**，没有额外 client round-trip。([docs.anthropic.com](https://docs.anthropic.com/en/agents-and-tools/tool-use/advisor-tool))

这其实已经非常接近你描述的：

> reasoning/output 中把另一个 LLM inference 当成 tool 无缝调用。

而且默认一个 request 中 advisor 可以调用多次；advisor 的 context 本身也是 append-only cacheable。([docs.anthropic.com](https://docs.anthropic.com/en/agents-and-tools/tool-use/advisor-tool))

但它暴露出的瓶颈也正好证明我上面说的东西：

**Advisor inference 本身不会 streaming。Executor stream 会暂停，等 advisor 完整跑完，再继续。**([docs.anthropic.com](https://docs.anthropic.com/en/agents-and-tools/tool-use/advisor-tool))

也就是说即便 provider 把：

- network RTT；
- client orchestration；
- request serialization；

这些几乎全部消掉了，

**你仍然逃不掉另一个模型真正 decode 的时间。**

这就是这个方案最底层的 latency floor。

---

# 5. 所以“无感”的关键是 branch 必须非常短

如果你的 role call 是：

```text id="fmbk04"
critic → 输出 1500 tokens
```

那用户一定感知得到暂停。

但如果是：

```text id="kwh9th"
phrase-editor → 50 tokens
fact-checker → 80 tokens
reasoning-specialist → 100 tokens
planner → 120 tokens
```

就完全是另外一回事。

Anthropic 自己在 Advisor 上做过一个很有意思的小规模实验：限制 advisor `max_tokens=2048` 后，平均 advisor output 大约下降 **7×**，在他们那组 hard-reasoning eval 中没有检测到明显质量下降；限制到 1024 则更短，但开始出现较明显截断。这个实验规模不大，不能直接外推到你的 workload，但它很好地说明了：**sub-inference 的 output budget 是这种设计最关键的速度旋钮。** ([docs.anthropic.com](https://docs.anthropic.com/en/agents-and-tools/tool-use/advisor-tool))

所以我会把你的 primitive 设计目标定成：

```text id="jir71f"
role-call ≠ 一个完整 subagent task

role-call = 一个非常短的 cognitive segment
```

例如：

```text id="3e8gva"
delegate(writer, next_paragraph)
delegate(critic, identify_one_issue)
delegate(coder, produce_patch_fragment)
delegate(reasoner, resolve_this_decision)
```

这和现在那些“启动 subagent → 工作几十秒 → 返回一篇报告”的概念完全不同。

---

# 6. 第三个问题：质量能不能至少等于 Main 原本自己生成？

这个问题比 cache 更微妙。

### Cache 本身不会降低质量

如果只是 KV reuse：

```text id="qw3ldk"
same tokens
same model
same KV
```

那它和重新 prefill 是数学等价的；vLLM 对 Automatic Prefix Caching 也明确说明 prefix cache 不改变 model output。([docs.vllm.ai](https://docs.vllm.ai/en/stable/design/prefix_caching/))

所以 cache 不需要担心。

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

这不是 prompt 技巧可以彻底解决的问题。

但现在 reasoning API 已经开始能够解决它。

OpenAI 明确建议 reasoning model 在 function-call loop 中把 reasoning items 一起传回，以保持 reasoning continuity；GPT‑5.6 还支持 persisted reasoning/context across turns。([developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning))

Anthropic 同样要求 tool-use loop 中保持 thinking blocks，并明确把它与 reasoning continuity 和 cache optimization 联系起来。([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/thinking))

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

这样它才真正有机会成为：

> **同一认知过程换一张 mask**

而不是：

> “叫另一个失忆的 agent 重新理解一遍”。

---

# 7. 甚至 transport 层还有一个值得利用的优化

OpenAI 目前的 Responses WebSocket mode 就是专门针对**长时间、tool-call-heavy workflow**优化的。官方称在 20+ tool calls 的 rollout 中，端到端大约可以快 **40%**；其机制之一是最近一个 response 会保持在 connection-local 的 warm state 中。([developers.openai.com](https://developers.openai.com/api/docs/guides/websocket-mode))

但这里对你的架构有一个重要推论：

```text id="r9e2s5"
Main WS:
M0 → M1 → M2 → M3
```

最好不要变成：

```text id="g8powd"
M0
 ↓
Branch B1   ← 把它变成 WS 最新 response
 ↓
再回来找 M0
```

因为一个 WebSocket connection 只保持**最近 response**的这种低延迟 continuation state。([developers.openai.com](https://developers.openai.com/api/docs/guides/websocket-mode))

所以更合理的实现很可能是：

```text id="8zqxg6"
connection A
Main chain
M0 ────────────────→ resume
       │
       │ fork
       ▼
connection B
Branch B1 → result
```

Branch 用共享 prompt cache / persisted reasoning state，但**不破坏 Main connection 的 warm continuation**。

这是我根据当前 WebSocket 行为做出的架构推论，不是 OpenAI 文档直接推荐的模式。

---

# 8. 因而我现在会这样判断你的目标

如果粒度是：

| 调用频率 | 我目前判断 |
|---|---|
| 每个 response 2–5 次 | **完全现实** |
| 10–30 次短 role-call | **很有希望**，值得专门优化 |
| 每句话一次，50+ 次 | **云 API latency 开始成为严重问题** |
| 每几个 token 一次 | **普通 API 架构基本不可行** |
| provider-native / self-hosted in-process KV fork | **理论上可以继续往极细粒度推进** |

这里不是 token 成本首先把你杀死。

真正逐渐把你杀死的是：

```text id="egz19s"
N × inference-start / scheduling latency
```

因此如果这是我们要认真推进的 primitive，我觉得它应该被定义为：

## **KV-preserving role fork**

而不是普通 LLM tool。

它有四个硬 invariant：

```text id="etxril"
1. Stable prefix 永远不改
2. Role switch 只能 append 在 cache frontier 后
3. Branch 尽量继承 parent reasoning state
4. Branch output 直接成为最终输出的一部分，绝不让 Main 再生成一遍
```

在这四条成立以后，你最开始期待的东西——

> **Main 在 reasoning / output 中大量换 mask，让这些调用从使用体验上近似于它自己的内部生成 primitive**

——我认为是**真实可追求的**，而不是一个被缓存成本直接否掉的想法。

尤其值得重视的是，目前 OpenAI 的 **explicit cache breakpoint + persisted reasoning + WebSocket continuation**，以及 Anthropic 的 **mid-conversation system message + server-side Advisor**，实际上已经分别把这个方案需要的几块基础设施做出来了。([developers.openai.com](https://developers.openai.com/api/docs/guides/prompt-caching))

现在真正还缺的，不是协议能力，而是**把一次 role fork 的固定 latency 压到什么程度**。这是这个 idea 是否能从“偶尔调用的高级 subagent”跃迁成“模型输出中的高频认知算子”的决定性指标。

---

## User

还是让我们来收束一下吧:

1. main agent的主要大量上下文应当被保留
2. inference agent本身应该是main agent以外的单独请求, 在main tool阻塞时候执行
3. inference agent在有main agent上下文基础上, 应该知道自己的着重点是什么, 或者负责BERT的部分是什么, 还有也就是自己要输出什么. 如果我们的做的非常还原流程的话, 那么很可能就是取下一个输出返回. 如果不能够很流畅, 那么也就只能要求输出tool call作为yield返回
4. inference agent添加的消息, 肯定不可能在大量消息上面啊, 肯定是要在最下面, 也就是紧接着main agent思考的消息的上面一条. 关键就在于我能不能在思考因为tool调用而阻塞的时候, 进行branch, 也就是说本身可能是完全一致的思考location, 只有前面的一条消息的面具不同, 从而形成最流畅的inference agent调用.

---

## Assistant (progress update)

对，这次问题已经可以收束成一个非常具体的技术判断：**能不能从 Main 已经产生 tool call 的那个“推理断点”原地 fork，两条分支共享断点之前的全部上下文/推理状态，只在断点附近换一条 role instruction。** 我去确认当前 reasoning/tool continuation API 对这个“同一 parent 多分支 continuation”的支持边界。

---

## Assistant (progress update)

目前最关键的边界已经很清楚了：**“fork 同一个已完成的 reasoning/tool-call state”是支持的；“在这个已经生成的 state 里面，把 tool call 前面再插一条不同 role 的消息，然后还认为是同一个 KV/reasoning location”则不是。** 这两者差一小步，但正是你这里最重要的一步。

---

## Assistant

对，按你这四点收束以后，我认为现在可以把问题精确成一句话：

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

OpenAI 当前 Responses API 正好允许 reasoning items 跟随 function-call continuation 被保留下来；官方甚至要求 function calling 时把 reasoning/function-call items 原样保留，从而让下一次 sample 延续刚才的 reasoning。`previous_response_id` 或手工 replay 都可以传递这些 reasoning items。([developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning))

所以第 1、2 点都没问题：

**Main 的大量上下文不复制性重构；Inference 是一个新的 sample/request；两者共享同一个逻辑 parent state。**

---

### 关键是你第 4 点需要稍微改一个位置

你现在描述的可能是：

```text id="o5k7p8"
P
↓
[Inference mask]       ← 新插入
↓
R                     ← Main 已经产生的 reasoning
↓
tool_call
↓
Inference continue
```

**这个严格意义上不能叫“完全相同的 reasoning location”。**

原因很简单：

`R` 本来是由：

```text id="sm5jrd"
P → R
```

算出来的。

一旦变成：

```text id="3ymori"
P + mask → R
```

那么从 mask 之后的 KV state 理论上就已经不同了。

也就是说你不能同时要求：

1. mask 出现在 `R` 之前；
2. `R` 的 hidden/KV state 与 Main 完全一致。

这两个要求在 transformer 层面是矛盾的。

即便 Responses 允许你把 opaque reasoning item replay 回去，它提供的是**reasoning continuity**，而不是让你修改这个 reasoning item 的前置 token 后，还声称内部计算状态完全没有变化。官方对高级 context manipulation 的要求恰恰是：function calling 周围的 reasoning/function items 应保持 untouched。([developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning))

---

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

这就非常接近你真正想要的东西。

**两个模型一直到 `inference_tool_call` 都位于完全相同的位置。**

真正分叉发生在：

```text id="gkgpr2"
                  ┌→ inference mask → inference next tokens
P → R → tool_call ┤
                  └→ inference result → main next tokens
```

这才是真正意义上的 prefix fork。

而且 cache 性质是最好的，因为 **从 conversation 开头一直到 tool call 都 byte-identical**。

---

### Anthropic 现在甚至明确支持几乎就是这个摆放方式

Claude 当前的 mid-conversation system message 可以在 agentic loop 中动态加入新的 system-level instruction，同时不修改之前 cached prefix；但是有一个很有意思的硬限制：

> system message **不能插在 `tool_use` 和 `tool_result` 中间**，必须放在 tool result 后，再开始下一次 assistant generation。([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages))

也就是：

```text id="zfrqcx"
assistant:
    thinking...
    tool_use(inference)

user:
    tool_result(...)

system:
    You are now the <X> inference role.
    Produce only the next ...

assistant:
    <Inference generation>
```

这其实和我们刚才推导出来的最合理结构完全一致。

它还明确保证：这种后置 system message 不改变之前的 cached prefix，只处理新增 suffix。([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages))

所以不是：

```text id="iz7xqj"
mask
↓
旧 reasoning
```

而是：

```text id="taefc3"
旧 reasoning
↓
tool boundary
↓
mask
↓
新 reasoning / output
```

---

## 这样第 3 点也会变得非常自然

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

甚至 tool call 本身就已经包含：

```text id="x97uat"
inference(
    mask="architect",
    yield="next"
)
```

那么 branch-specific fresh tokens 可能只有几十个。

Inference 模型不是：

> “这是一个任务，请你重新做。”

而是：

> **“你刚才就在这里思考；现在，从这个 token location 开始，你负责这一段。”**

这两个语义差异非常大。

如果模型能很好地服从 `yield=next`，它直接吐：

```text id="4h8ahx"
下一段 reasoning / prose / code
```

然后这部分可以直接成为 Main 最终输出的一部分。

如果做不到稳定的“next continuation”，你的备选才是：

```text id="0slgsb"
yield = tool_call
```

即让 inference agent只产生：

```text id="tyf3n8"
tool_call(...)
```

再把这个调用返回给 Main。

我同意你的排序：

**自然 continuation > structured yield/tool call**。

---

## 还有最后一个边界要讲清楚

如果你说的“完全一致的思考 location”是非常严格的：

> **两个 decoder 真正共享同一套 GPU KV blocks，然后从某个 sequence position clone/fork，分别继续 sampling。**

那么**公共 LLM API 通常没有把这种底层 `fork(sequence_id)` primitive 暴露给客户端。**

OpenAI Responses 暴露的是更高一层的东西：

```text id="hppf33"
reasoning item
previous_response_id
function_call
continuation
```

它能提供非常好的逻辑 reasoning continuity；GPT‑5.6 还可以在后续 sample 中继续利用 persisted reasoning。([developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning))

Prompt caching 则能重用完全相同的 prefix 计算。([developers.openai.com](https://developers.openai.com/cookbook/examples/prompt_caching_201?utm_source=chatgpt.com))

但这和客户端直接拿到：

```text id="1anaot"
KV_handle = fork(parent_kv, token_index=...)
```

还是两回事。

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

### 所以我现在会把你的设计精确画成这样

```text id="rtm9a0"
                         ┌────────────────────────────┐
                         │       INFERENCE SAMPLE     │
                         │                            │
                         │   role/focus delta         │
                         │          ↓                 │
                         │   generate next segment    │
                         └────────────┬───────────────┘
                                      │
                                      │ result
                                      ▼
H ── Main reasoning ── inference_call ── tool_result ── Main reasoning
│                     ▲
│                     │
└──── identical cached/reasoning prefix ─────────────┘
```

**真正的 branch location 就是 `inference_call`。**

我甚至认为这是比“在 Main reasoning 前插 mask”更好的定义，因为它没有任何状态悖论：

- fork 之前 **100% 相同**；
- fork 之后才改变角色；
- 大上下文 cache 全部保留；
- 当前 reasoning item 保留；
- inference 知道 Main 刚刚为什么主动调用它；
- 新增 instruction 极短；
- inference 返回后 Main 又从同一个 tool boundary 继续。

所以，你最核心的设想没有问题。需要调整的只有一句：

> **不是“在当前 reasoning 前插一个不同面具，然后从相同 reasoning location 继续”，而是“以 reasoning 产生的 tool call 本身作为 exact fork point，在该 point 后给 branch 加面具”。**

这两者从 Agent 使用体验看几乎一样，但从 **KV/cache/reasoning-state 一致性**来看，后者才是干净且真正可实现的形式。

---

## User

OK我认为你说的没有问题, mask和instruction既可以就放到inference agent的tool result, 也可以终止thinking的情况下放一个system msg, 各有千秋, 虽然我认为第一种可能更自然;

然后, inference agent只需要捕捉其下次对应的tool call, 或者直接捕捉紧接着的thinking block(这里需要parser一下吗? 怎么保证输出内容符合BERT填空?), 就能够拿到填空结果返回.

这些不管怎么说都是小问题. 但是由于我的认知能力限制, 我现在最担心的是, thinking中途阻塞的tool call, 是否能够被branch同时运行, 且还能回到之前的main agent阻塞位置, 给出result重新运行. 也就是大模型普遍的服务端的状态化, 具体会到什么程度, 是不是thinking过了这段, 就不能回来调用了. 还是说他们只认每次的request, 只要格式对就行, 并且request信息自身是完整的.

这个是现在调查重点吧

---

## Assistant (progress update)

对，这就是现在真正需要确认的核心：**provider 到底把“正在 thinking 的那次生成”保存成一个可恢复的服务端 continuation，还是 tool call 一出来，这次生成已经结束，之后只是你拿着一个完整的 response state 再发新 request。**  
如果是后者，那么 branch 天然成立；如果是前者，而且 continuation 只能单消费，就会成为硬障碍。

---

## Assistant (progress update)

目前三个主流 API 的方向其实高度一致，而且这对你的担心是好消息：**client-side tool call 并不是服务端把某个 decoder 永久挂起、等你回来继续那块 GPU 状态。** Anthropic 和 Gemini 甚至直接把 Messages/GenerateContent 称为 stateless；OpenAI 也明确说每次 text-generation request 本身独立，所谓 stateful Responses 是通过保存 response/items 再引用来实现。

---

## Assistant

对，**现在调查重点就是这个，而且我查完以后，这一层基本可以放心了。**

最重要的结论是：

> **对于主流的 client-side tool calling，模型并不是在服务端维持一个“正在 thinking、停在某个程序计数器上等待 tool result”的不可复制执行实例。**
>
> tool call 出来以后，这一轮模型生成实际上已经形成了一个 response；之后所谓“继续原来的 thinking”，本质上是**另发一次 inference request，把刚才那段状态重新提供/引用进去，再加上 tool result。**

所以你担心的：

> “模型已经 thinking 到这里了，我拿它去 branch 一次之后，还能不能回来？”

答案目前是：**能。这个 branch 在 API 抽象上没有根本障碍。**

---

## 1. 最直接的证据其实来自 OpenAI 自己

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

---

# 2. 那为什么它还能“接着刚才思考”？

因为 provider 把 continuation 所需要的状态，以某种 **可重放 representation** 暴露/保存了。

这点非常关键。

OpenAI 对 stateless reasoning 请求明确要求：

> 保存并重新发送 response `output` 数组里的所有 items。

当前 Responses 甚至默认返回 encrypted reasoning items；支持 persisted reasoning 的模型还可以通过 `reasoning.context` / `previous_response_id` 让前面 reasoning 在后面的 sample 中继续发挥作用。([developers.openai.com](https://developers.openai.com/api/docs/guides/conversation-state?utm_source=chatgpt.com))

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

你不需要知道 provider 内部究竟是：

```text id="2rdjcu"
重新 prefill
```

还是：

```text id="1cihbg"
命中 prompt KV cache
```

还是：

```text id="4ju52q"
从 persisted reasoning state 恢复
```

还是混合做法。

API 已经保证：

```text id="iae9rc"
S + tool_result
```

是合法的 continuation。

---

# 3. Anthropic 的证据甚至更加直白

Claude Messages API 官方直接说：

> **The Messages API is stateless.**

每个请求都携带完整 conversation history。([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/working-with-messages?utm_source=chatgpt.com))

Claude 使用 extended thinking + tool use 时，则要求：

```text id="btj7nc"
assistant:
    thinking block
    tool_use

user:
    tool_result
```

然后重新请求。

Anthropic 的解释虽然在语义上说：

> Claude 调用工具时“pauses construction of its response”，收到工具结果以后继续构造这个 response。

但紧接着明确说明，这个连续性实际上横跨 **multiple API calls**，因此必须把之前的 thinking blocks **完整、未经修改地传回来**。([platform.claude.com](https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking?utm_source=chatgpt.com))

换句话说：

```text id="3dy6pa"
“pause”
```

是**逻辑上的 pause**，不是：

```text id="3pz1w1"
“这块 GPU 上还有一个不可复制的 Claude process 睡眠着”
```

这一点对我们非常重要。

---

# 4. Gemini 更彻底：官方直接称 API stateless

Google 当前文档：

> Gemini API is stateless.

其 thinking model 使用 `thought_signature` 来让下一次 request 恢复 tool-use 前后的 reasoning context。([ai.google.dev](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en&utm_source=chatgpt.com))

比如：

```text id="7922ot"
Turn A output:

thought
functionCall
thoughtSignature = XYZ
```

下一次你必须送回：

```text id="0lv2pb"
thought
functionCall
thoughtSignature = XYZ
functionResponse
```

模型才知道如何正确延续。([ai.google.dev](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures?utm_source=chatgpt.com))

所以 OpenAI / Anthropic / Gemini 三家虽然 representation 不一样：

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

---

# 5. 这就意味着你的 Branch 完全可以这样做

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

Inference request 的生成不会把 S₀ 变成：

```text id="ucvfd7"
S₀ = invalid
```

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

---

# 6. 而且理论上甚至可以 fan-out 多个 Branch

因为对于 Anthropic/Gemini 这种明确 stateless 的接口来说：

```text id="c6z6q4"
S₀
```

就是一份输入数据。

所以完全可以：

```text id="216ehi"
             ┌→ Branch A
             │
             ├→ Branch B
S₀ ──────────┤
             ├→ Branch C
             │
             └→ Main resume later
```

四个独立 inference request。

谁也不会把 S₀ “消费”。

OpenAI 如果你为了绝对控制而使用 **manual state replay**，同样成立：官方明确支持把之前完整 output 重新作为下一请求 input。([developers.openai.com](https://developers.openai.com/api/docs/guides/conversation-state?utm_source=chatgpt.com))

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

---

# 7. `previous_response_id` 和完整 replay 要稍微区别一下

OpenAI 有两个办法：

### 方法 A：服务端 state pointer

```text id="9uq1e1"
previous_response_id = resp_xxx
```

于是 OpenAI 自己恢复之前 context。([developers.openai.com](https://developers.openai.com/api/docs/guides/conversation-state?utm_source=chatgpt.com))

概念上：

```text id="a2lbo0"
resp_xxx
   ├→ child A
   └→ child B
```

文档没有把它正式定义成一套 Git 式的“branch API”，所以如果我们的实现强烈依赖**同一个 parent 并发产生很多 children**，我不会仅凭这个接口性质下结论说 provider 保证所有内部优化都是 branch-friendly。

### 方法 B：手工 replay

这是更强的保证：

```text id="jyj5vl"
input = [
    original input,
    ...response.output
]
```

然后：

```text id="w2kwk4"
request A(input = S₀ + XA)
request B(input = S₀ + XB)
```

OpenAI 官方明确支持这种 stateless conversation management。([developers.openai.com](https://developers.openai.com/api/docs/guides/conversation-state?utm_source=chatgpt.com))

因此即使未来发现：

```text id="0hidlz"
previous_response_id
```

在某种场景存在并发限制，

**也不会动摇整个设计。**

最坏不过是：

```text id="iqnn5x"
逻辑状态我们自己保存
+
prompt cache / encrypted reasoning item
```

来重建 branch。

---

# 8. 唯一不能保证的是“物理上同一 KV snapshot”

这个区分很重要。

我们现在已经可以确认：

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

这又回到了我们上一轮讲的 latency/cache 问题，而不是“能不能回来”的正确性问题。

---

# 9. 对我们的 inference-tool 具体意味着什么

Main：

```text id="ozkz00"
P
R1
R2
R3
inference_call(id=42)
```

这时候建立 immutable checkpoint：

```text id="diwa5u"
K42 =
    P
    R1
    R2
    R3
    inference_call(id=42)
```

然后：

```text id="9ye94k"
Inference request:

K42
+ function_result(
      id=42,
      "You are now BERT-slot-X.
       Yield the next continuation."
  )
```

拿到：

```text id="jvavgm"
I42
```

**不要修改 K42。**

然后：

```text id="ryriq8"
Main request:

K42
+ function_result(
      id=42,
      I42
  )
```

继续。

也就是说从 harness 的数据结构上都应该明确：

```text id="yrnjxs"
Checkpoint = immutable
```

而不是：

```text id="3dgvee"
Conversation.append(...)
Conversation.undo(...)
Conversation.append(...)
```

前一种形式非常适合 branch。

---

## 所以现在可以把这个风险项基本降级了

你担心的情况：

> “thinking 一旦执行过去，服务端状态不可逆，所以 branch inference 用掉之后就没办法再回到 Main 的 tool call。”

**至少对于当前 OpenAI、Anthropic、Gemini 的普通 client-tool API，不是这样。**

它们的 tool loop 都是由**多次 API inference request**组成；维持 reasoning continuity 所需的数据，要么显式返回给你，要么通过 response ID / signature 等形式暴露成可以再次使用的 continuation state。([developers.openai.com](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com))

因此我现在会把项目中的核心假设写成：

```text id="nyd0rs"
Tool call is not a mutable suspended decoder.
Tool call is an immutable inference checkpoint.
```

而这个假设目前有很强的官方 API 语义支撑。

**下一步真正值得调查/实测的就只剩一个大问题了：同一个 `K42` 连续/并发 fork 时，OpenAI / Anthropic / Gemini 各自的实际 cache-hit、TTFT 和 reasoning continuity 成本到底是多少。** 这才会决定这种 inference primitive 能不能高频到像普通输出一样使用。

---
