# Advisor WatchDog

## 机制讲解

Advisor 实际上在OMP中是以文件为基础, 可以进行文件修改, 以及命令调用来创建自定义advisor的功能.
文件本身应该是叫做WATCHDOG.yml.
然后advisor本身也可以名称, 自定义提示词来说明职责, 工具权限, 使用的特定模型等等.
并且advisor profile还有用户域和项目域的区分. 可以说advisor的自定义机制是非常全面了.

但是唯一的问题就是, omp agent自己不会主动感知到这些advisor的配置方法, 配置文件, 不会主动自己去根据项目需求和通用需求配置advisors. 更新配置以后, 新的advisor也可能不会立刻启动或者改变, 还没有实验过.

## 期望

因此, 这里的期望就是agent, 能够像OMP用户一样, 自由且轻松便捷地对于advisor进行配置和操作, advisor实际上也算是一种特殊的内置subagent.
