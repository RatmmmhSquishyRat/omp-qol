# InitiativeSummary

OMP中只有最简单的自动Compact和图片compact等机制, 以及一些手动的shake命令, 这对于上下文管理来说是完全不够的.

Motivation: 详见插件[Opencode-DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)

那么, DCP的机制是否完美, 现状如何, 又如何在OMP中进行复现呢? 见此[DCP-OMP 调查行动启动文档](C:\Users\15480\Desktop\AIWorkshop\repos\omp-qol\docs\researches\omp_dcp_research_transcript.md)

但是实际上, 只有DCP也是不够的, 或者说DCP是不完美的:

- DCP中有一些对于同参数工具调用的自动标记机制, 以及对于报错工具调用参数的自动标记机制
- DCP中Agent可以在上下文不那么够用时候被提醒, 然后压缩总结任意消息

但是实际上, 这些内容是否应该被总结压缩, 应该在什么时候被压缩, 压缩为何等形式, 这些问题本身应该是由agent进行自主决定的, 而不是插件来决定.

也就是说, 我们可以给一些启发性质的skill/instruction实践, 但是, **agent应当能够在任意时刻将任意条消息总结成为任意内容, 或展开任意总结.**, 如何使用, 使用效果如何, 完全取决于模型自己, 而插件负责的是给予模型最高的自由度.
