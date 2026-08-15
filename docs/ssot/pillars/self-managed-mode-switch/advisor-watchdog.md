# Advisor WatchDog

## 机制讲解

Advisor 实际上在OMP中是以文件为基础, 可以进行文件修改, 以及命令调用来创建自定义advisor的功能.
文件本身应该是叫做WATCHDOG.yml.
然后advisor本身也可以名称, 自定义提示词来说明职责, 工具权限, 使用的特定模型等等.
并且advisor profile还有用户域和项目域的区分. 可以说advisor的自定义机制是非常全面了.

但是唯一的问题就是, omp agent自己不会主动感知到这些advisor的配置方法, 配置文件, 不会主动自己去根据项目需求和通用需求配置advisors. 更新配置以后, 新的advisor也可能不会立刻启动或者改变, 还没有实验过.

## 期望

因此, 这里的期望就是agent, 能够像OMP用户一样, 自由且轻松便捷地对于advisor进行配置和操作, advisor实际上也算是一种特殊的内置subagent.

## 用户澄清 (2026-08-15, 原文)

> 有一个问题啊, 主agent使用的默认advisor也需要能够被看到和配置以及开关啊, 这些用户在cli里面是都能够做到的, 和其他advisor操作没有区别

（范围澄清：上述"像OMP用户一样"的期望明确包含宿主的隐式 default advisor——零配置时 SessionAdvisors 的 legacy 回退。它必须与其他 advisor 一样可见、可配置、可开关，不允许成为工具能力的盲区。）

## 用户判定 (2026-08-15, 原文)

（原消息以 `/multi-model-review` 命令为前缀）

> 对于上述这部分的功能完整性, 我持怀疑态度, 因为我现在还是没有看到你们的汇报中, 有有关真实使用模型进行测试, 并得到多个advisor均正常运行的这个结果. 因此我判定结果为不合格, 需要重新返回对于代码和功能测试进行完整review-redesign-rework loop. 另一方面, 对于当前插件侧给到agent的各种提示, 指南, 说明, 工具输出和描述等等, 这些看上去好像也没有进行过整体review-refine, 因此也属于隐患点. 完整理解, 全量充分review, 并记录到plan中, 最后再简要汇报.

（范围注：acceptance bar = 真实模型 + 多个 advisor 均正常运行（Built→Fed→Streamed 分级证据），文本面需整体 review-refine。）
