# PinStateTree

agent既然能够使用命令来pin, 就能够将这些命令整理成为tree structure, 在agent处于不同leaf node的时候, 遍历祖先路径获得当前状态下需要的所有pin状态, 相当于自动执行了一系列的pin/unpin指令.

- 每个tree本身同一时间只能处于一个leaf node上面
- 允许任意多个tree同时存在
- 在查看时候仅展示当前path的每个层级的sibling nodes, 而不是完全展开
- agent自己自由驱动状态march或者jump
- leaf本身可以指定pin消息, 也可以指定pin自定义instruction
- tree本身可以表述任意类型语义: workflow, todo tree, steps, state nodes, 甚至单纯的profile set(via jump)

这样, agent就能够在运行时, **自由且自动**地对于自己的上下文进行管理.
