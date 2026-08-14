import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ResumeSdkJsonRpcServer } from './main.js'

/**
 * C1 单测：自研 server 的双分支会话创建。
 * 用 fake ctx/transport 替代完整 Cordis 上下文（真实上下文需完整插件树）。
 */

/** fake 会话句柄（agents.create/resume 的返回值 = 官方 handle 结构：{ agent, dispose }） */
function fakeHandle(agentOverrides: Record<string, unknown> = {}) {
  return {
    agent: { session: { id: 'a1' }, followup: vi.fn(), ...agentOverrides },
    dispose: vi.fn(async () => {}),
  }
}

/** 构造 fake ctx：agents.create/resume 打桩 + sessionPersistence 可控 */
function makeCtx(overrides: {
  stored?: Array<{ id: string; cwd: string }>
  createImpl?: () => Promise<unknown>
  resumeImpl?: () => Promise<unknown>
}) {
  // 共享同一个 agent 实例：prompt 的 get() 校验要求引用相等（与真实 agents 注册表语义一致）
  const sharedAgent = { session: { id: 'a1' }, followup: vi.fn() }
  const makeHandle = () => ({ agent: sharedAgent, dispose: vi.fn(async () => {}) })
  const create = vi.fn(overrides.createImpl ?? (async () => makeHandle()))
  const resume = vi.fn(overrides.resumeImpl ?? (async () => makeHandle()))
  const ctx = {
    on: () => () => {},
    get: (key: string) => {
      if (key === 'sessionPersistence') {
        return overrides.stored ? { list: async () => overrides.stored } : undefined
      }
      if (key === 'llm') return { listProviders: () => [{ id: 'deepseek-official' }] }
      return undefined
    },
    agents: { create, resume, get: () => sharedAgent },
    // fake 只实现测试所需的最小表面，其余 Context 成员用类型断言补齐
  } as unknown as Context
  return { ctx, create, resume }
}

/** fake JSON-RPC 传输（仅记录通知） */
function makeTransport() {
  return { notify: vi.fn(), onRequest: vi.fn(), start: vi.fn(), close: vi.fn(), flush: vi.fn(async () => {}) }
}

const PROMPT_PARAMS = { sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hi' }] }

describe('octo-sdk-server 双分支会话创建', () => {
  it('无存档 → agents.create（不调 resume）', async () => {
    const { ctx, create, resume } = makeCtx({})
    const server = new ResumeSdkJsonRpcServer(ctx, makeTransport())
    await server.initialize({ cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-official' })
    await server.prompt(PROMPT_PARAMS)
    expect(create).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
  })

  it('磁盘存档命中且 cwd 匹配 → agents.resume（不调 create）', async () => {
    const { ctx, create, resume } = makeCtx({ stored: [{ id: 's1', cwd: process.cwd() }] })
    const server = new ResumeSdkJsonRpcServer(ctx, makeTransport())
    await server.initialize({ cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-official' })
    await server.prompt(PROMPT_PARAMS)
    expect(resume).toHaveBeenCalledOnce()
    expect((resume.mock.calls[0] as unknown[])[0]).toMatchObject({ resumeSessionId: 's1' })
    expect(create).not.toHaveBeenCalled()
  })

  it('存档存在但 cwd 不匹配 → 显式抛错（拒绝跨工作目录恢复）', async () => {
    const { ctx, resume } = makeCtx({ stored: [{ id: 's1', cwd: '/other/workspace' }] })
    const server = new ResumeSdkJsonRpcServer(ctx, makeTransport())
    await server.initialize({ cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-official' })
    await expect(server.prompt(PROMPT_PARAMS)).rejects.toThrow(/id collision/)
    expect(resume).not.toHaveBeenCalled()
  })

  it('同一 sessionId 二次 prompt → 走内存缓存，create 只调一次', async () => {
    const { ctx, create } = makeCtx({})
    const server = new ResumeSdkJsonRpcServer(ctx, makeTransport())
    await server.initialize({ cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-official' })
    await server.prompt(PROMPT_PARAMS)
    await server.prompt(PROMPT_PARAMS)
    expect(create).toHaveBeenCalledOnce()
  })

  it('initialize 校验非法 maxTokens', async () => {
    const { ctx } = makeCtx({})
    const server = new ResumeSdkJsonRpcServer(ctx, makeTransport())
    await expect(
      server.initialize({ cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-official', maxTokens: 0 }),
    ).rejects.toThrow('maxTokens')
  })

  it('构造时订阅会话/代理生命周期事件（转发为 JSON-RPC 通知）', () => {
    const on = vi.fn(() => () => {})
    const ctx = {
      on,
      get: (key: string) => (key === 'llm' ? { listProviders: () => [] } : undefined),
      agents: { create: async () => fakeHandle(), resume: async () => fakeHandle(), get: () => undefined },
    } as unknown as Context
    new ResumeSdkJsonRpcServer(ctx, makeTransport())
    // 订阅了 session/event、agent/status、session/created、subagent/end 四个转发源
    expect(on).toHaveBeenCalledTimes(4)
  })
})
