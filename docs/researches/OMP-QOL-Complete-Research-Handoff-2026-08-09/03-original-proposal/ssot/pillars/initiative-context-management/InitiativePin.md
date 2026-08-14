# InitiativePin

之前Opencode生态中, 已经有人实现过可以让agent主动pin skill文档, 来让skill稳定生效的插件.

pin本身也有两种方式: 传统方式pin到system_prompt中效果肯定更明显, 但是全部cache都会被摧毁, 导致价格价高; 更流行的pin方式, 是在model request消息列表的最下面, 开一个pin区, 也就是将pin的消息放到消息列表的最底部, 这样对于cache损失微小(pin区在下次还是无法cache住), 但是效果同样不差, 因为是本身就是最后几条消息.

当然, 如果我们敢于想象, 也能够想到, 将这些消息稍微提前一点, pin插入到某些历史消息中间, 也是可以的, 效果可能类似于重新读一遍文件等等.

pin本身还有另外一层语义, 那就是影响summary, pin的消息就可以要求在压缩总结时候聚焦注意力进行处理, 或者干脆要求保留等等.

另外, 我们看最上面的这个pin skill例子, 实际上skill只是一种tool result嘛 - 实际上一个session中的任意消息, 都有可能需要被pin: user major command, system reminder, tool result, file result, 甚至是agent自己的重要msg.

因此, 就单纯的pin系统来说, 可以做的设计实际上有非常多, 最终的完美形态, 也是值得商榷的. 但是总体原则不会变化 - 那就是给agent尽可能大的自由度来对于自己的上下文进行pin/unpin操作.
