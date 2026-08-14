/**
 * deepseek-channel-octo 插件入口。
 *
 * 这是一个 Cordis 插件（dsh 的插件体系）：导出 name + inject + apply。
 * - name：插件唯一标识（加载器按此 id 引用）
 * - inject：声明依赖的服务键，框架保证服务就绪后才调用 apply
 * - apply：注册能力（本插件注册一条 /hello 用户命令）
 *
 * 为什么用命令而不是工具：命令直接由 UI 分派、不需要模型轮次，
 * 适合做"插件已生效"的最小可验证行为；工具注册留给后续阶段。
 */
import type { Context } from '@deepseek-ai/cordis'
// 副作用导入：触发 dsh-commands 对 cordis Context 的声明合并（注入 ctx.commands 类型）
import '@deepseek-ai/dsh-commands'

/** 插件名：加载器与 patch 文件按此引用 */
export const name = 'hello-plugin'

/** 依赖命令服务（ctx.commands），就绪后才执行 apply */
export const inject = ['commands']

/** Hello World 命令的返回文案（测试断言依赖此常量） */
export const HELLO_MESSAGE = 'Hello from deepseek-channel-octo!'

/**
 * 插件初始化：注册能力。
 * 无需返回清理函数——命令注册由框架管理，本插件没有需要手动释放的资源。
 */
export function apply(ctx: Context): void {
  // 加载日志：验证插件被 dsh 实际加载（stdout 约定，供启动日志观察）
  console.log('[hello-plugin] plugin loaded!')

  // 注册 /hello 命令：不经过模型，直接返回问候语
  ctx.commands.register({
    name: 'hello',
    description: 'Hello World 命令：验证 deepseek-channel-octo 插件已生效',
    input: { hint: '无需参数' },
    // handler 直接构造结果，UI 层原样呈现
    handler: () => ({ kind: 'success', text: HELLO_MESSAGE }),
  })
}
