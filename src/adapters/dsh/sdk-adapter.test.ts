import { describe, expect, it, vi } from 'vitest'
import type { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { SdkDshAdapter } from './sdk-adapter.js'

/**
 * C1 单测：SdkDshAdapter 的事件翻译与 runtime 缓存。
 * 用 fake harnessFactory 注入替身（真实 dsh 子进程留给实机验收）。
 */

/** 构造一个可编程的 fake harness（start/run/close 打桩） */
function fakeHarness(behavior: {
  onNotification?: (notification: unknown) => void
  result?: { sessionId: string; finalResponse: string }
  error?: Error
}) {
  const close = vi.fn(async () => {})
  const run = vi.fn(async (prompt: string, options: Record<string, unknown>) => {
    if (behavior.onNotification) behavior.onNotification(options.onNotification)
    if (behavior.error) throw behavior.error
    return behavior.result ?? { sessionId: 's1', finalResponse: '你好' }
  })
  const harness = { start: vi.fn(async () => {}), run, close }
  return { harness, close }
}

/** 把 fake harness 注入 factory：类型断言收在注入边界，harness 的 mock 方法保持可见 */
const asHarnessFactory = (h: ReturnType<typeof fakeHarness>['harness']) =>
  (() => h) as unknown as (cwd: string) => DeepSeekHarness

/** 收集事件流的辅助：把 AsyncIterable 全部拉出来 */
async function drain(events: AsyncIterable<{ type: string }>): Promise<string[]> {
  const types: string[] = []
  for await (const event of events) types.push(event.type)
  return types
}

/** 一条 text-delta 通知 */
const textNotification = { method: 'session.event', params: { event: { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '你好' } } } } }
const thinkingNotification = { method: 'session.event', params: { event: { type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: '思考中' } } } } }
const errorNotification = { method: 'session.event', params: { event: { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'AUTH: Invalid API key' } } } } } }

function makeAdapter(harness: ReturnType<typeof fakeHarness>['harness']) {
  const factory = vi.fn(asHarnessFactory(harness))
  const adapter = new SdkDshAdapter({
    launch: { command: 'dsh', args: [] },
    provider: 'deepseek-official',
    model: 'deepseek-official',
    harnessFactory: factory,
  })
  return { adapter, factory }
}

describe('SdkDshAdapter 事件翻译', () => {
  it('事件流顺序：system → text → thinking → final_text → done(normal)', async () => {
    const { harness } = fakeHarness({})
    harness.run.mockImplementation(
      async (_p: string, opts: Record<string, unknown>) => {
        ;(opts.onNotification as (n: unknown) => void)(textNotification)
        ;(opts.onNotification as (n: unknown) => void)(thinkingNotification)
        return { sessionId: 's1', finalResponse: '你好' }
      },
    )
    const { adapter } = makeAdapter(harness)
    const run = adapter.run({ runId: 'r1', prompt: 'x', cwd: process.cwd(), sessionId: 's1' })
    const events = []
    for await (const event of run.events) events.push(event)
    expect(events.map((e) => e.type)).toEqual(['system', 'text', 'thinking', 'final_text', 'done'])
    expect(events[0]).toMatchObject({ type: 'system', sessionId: 's1', cwd: process.cwd() })
    expect(events[3]).toMatchObject({ type: 'final_text', content: '你好' })
    expect(events[4]).toMatchObject({ type: 'done', terminationReason: 'normal' })
  })

  it('sessionId 缺省生成 session- 前缀；显式传入则原样透传给 harness.run', async () => {
    const { harness } = fakeHarness({})
    const { adapter } = makeAdapter(harness)
    await drain(adapter.run({ runId: 'r1', prompt: 'x', cwd: process.cwd() }).events)
    expect(harness.run.mock.calls[0]![1]).toMatchObject({ sessionId: expect.stringMatching(/^session-/) })

    const { harness: h2 } = fakeHarness({})
    const { adapter: adapter2 } = makeAdapter(h2)
    await drain(adapter2.run({ runId: 'r2', prompt: 'x', cwd: process.cwd(), sessionId: 'octo:acct:g1' }).events)
    expect(h2.run.mock.calls[0]![1]).toMatchObject({ sessionId: 'octo:acct:g1' })
  })

  it('turn/end error → error 事件 + done(interrupted)，不产生 final_text', async () => {
    const { harness } = fakeHarness({})
    harness.run.mockImplementation(
      async (_p: string, opts: Record<string, unknown>) => {
        ;(opts.onNotification as (n: unknown) => void)(errorNotification)
        return { sessionId: 's1', finalResponse: '' }
      },
    )
    const { adapter } = makeAdapter(harness)
    const events = []
    for await (const event of adapter.run({ runId: 'r1', prompt: 'x', cwd: process.cwd() }).events) {
      events.push(event)
    }
    expect(events.map((e) => e.type)).toEqual(['system', 'error', 'done'])
    expect(events[1]).toMatchObject({ type: 'error', message: 'AUTH: Invalid API key' })
  })

  it('空响应 → error 事件（防静默失败）', async () => {
    const { harness } = fakeHarness({})
    harness.run.mockResolvedValue({ sessionId: 's1', finalResponse: '' })
    const { adapter } = makeAdapter(harness)
    const events = []
    for await (const event of adapter.run({ runId: 'r1', prompt: 'x', cwd: process.cwd() }).events) {
      events.push(event)
    }
    expect(events.map((e) => e.type)).toEqual(['system', 'error', 'done'])
  })
})

describe('SdkDshAdapter runtime 缓存与生命周期', () => {
  it('同 cwd 复用同一 harness；不同 cwd 各建一个', async () => {
    const { harness } = fakeHarness({})
    const { adapter, factory } = makeAdapter(harness)
    await drain(adapter.run({ runId: 'r1', prompt: 'x', cwd: '/a' }).events)
    await drain(adapter.run({ runId: 'r2', prompt: 'x', cwd: '/a' }).events)
    await drain(adapter.run({ runId: 'r3', prompt: 'x', cwd: '/b' }).events)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('stop() 关闭当前 cwd 的 runtime；下一次 run 重建', async () => {
    const { harness, close } = fakeHarness({})
    const { adapter, factory } = makeAdapter(harness)
    const run = adapter.run({ runId: 'r1', prompt: 'x', cwd: '/a' })
    await run.stop()
    await drain(adapter.run({ runId: 'r2', prompt: 'x', cwd: '/a' }).events)
    expect(close).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('dispose 后 run 抛结构化错误', async () => {
    const { harness } = fakeHarness({})
    const { adapter } = makeAdapter(harness)
    await adapter.dispose()
    expect(() => adapter.run({ runId: 'r1', prompt: 'x', cwd: '/a' })).toThrow('已释放')
  })
})
