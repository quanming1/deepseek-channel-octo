import { describe, expect, it } from 'vitest'
import { apply, HELLO_MESSAGE, inject, name } from './index.js'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'

/**
 * A2 单测：验证插件元数据与命令注册行为。
 * 用 fake ctx 替代真实 cordis 上下文（真实上下文需完整插件树，留给 e2e）。
 */

/** 构造一个只实现 commands.register 的 fake ctx */
function makeFakeCtx(): { ctx: never; registered: CommandDefinition[] } {
  const registered: CommandDefinition[] = []
  const ctx = {
    commands: {
      register: (def: CommandDefinition) => {
        registered.push(def)
        return () => {}
      },
    },
  }
  return { ctx: ctx as never, registered }
}

describe('hello-plugin 插件', () => {
  it('插件名与依赖声明正确', () => {
    expect(name).toBe('hello-plugin')
    expect(inject).toContain('commands')
  })

  it('apply 注册 hello 命令', () => {
    const { ctx, registered } = makeFakeCtx()
    apply(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe('hello')
  })

  it('hello 命令返回预期问候语', async () => {
    const { ctx, registered } = makeFakeCtx()
    apply(ctx)
    const result = await registered[0]!.handler({} as never)
    expect(result).toEqual({ kind: 'success', text: HELLO_MESSAGE })
  })
})
