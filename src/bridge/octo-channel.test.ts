import { describe, expect, it, vi } from 'vitest'
import { OctoChannelBridge } from './octo-channel.js'
import type { AgentAdapter, AgentEvent } from '../adapters/types.js'
import type { InboundMessage } from './octo/messages.js'
import type { OctoWsClient, OctoWsOptions } from './octo/ws.js'
import type { FetchLike } from './octo/api.js'

/** Octo bridge 单测：消息 → adapter.run → 回复（fake adapter / fake ws / fake fetch） */

/** fake adapter：可编程事件流 */
function fakeAdapter(events: () => AsyncIterable<AgentEvent>): AgentAdapter {
  return {
    id: 'fake',
    displayName: 'fake',
    run: vi.fn(() => ({
      runId: 'r1',
      events: events(),
      stop: vi.fn(async () => {}),
      waitForExit: vi.fn(async () => true),
    })),
  }
}

function eventsFrom(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

/** fake WS 客户端：记录 onMessage 回调，供测试触发 */
class FakeWsClient {
  onMessageCb!: (m: InboundMessage) => void
  connect = vi.fn()
  disconnect = vi.fn()

  constructor(opts: OctoWsOptions) {
    this.onMessageCb = opts.onMessage
  }

  // 测试辅助：模拟收到一条入站消息
  deliver(message: InboundMessage): void {
    this.onMessageCb(message)
  }
}

function groupMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'm1',
    fromUid: 'user1',
    chatId: 'g123',
    channelType: 2,
    text: '@bot 你好',
    mentionUids: ['bot-1'],
    ...overrides,
  }
}

function makeBridge(overrides: {
  adapter?: AgentAdapter
  onSend?: (channelId: string, content: string) => void
  allowedGroups?: string[]
} = {}) {
  const adapter = overrides.adapter ?? fakeAdapter(() => eventsFrom([
    { type: 'system', sessionId: 'octo:acct:g123', cwd: '/tmp' },
    { type: 'text', delta: '你好' },
    { type: 'final_text', content: '你好，世界' },
    { type: 'done', sessionId: 'octo:acct:g123', terminationReason: 'normal' },
  ]))
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { channel_id: string; payload: { content: string } }
    overrides.onSend?.(body.channel_id, body.payload.content)
    return new Response(JSON.stringify({ message_id: 'm1', client_msg_no: 'c1', message_seq: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as FetchLike

  let wsClient: FakeWsClient | undefined
  const wsFactory = (opts: OctoWsOptions) => {
    wsClient = new FakeWsClient(opts)
    return wsClient as unknown as OctoWsClient
  }

  const bridge = new OctoChannelBridge({
    accountId: 'acct',
    botUid: 'bot-1',
    allowedGroups: overrides.allowedGroups,
    cwd: '/tmp',
    adapter,
    wsUrl: 'ws://octo/ws',
    apiUrl: 'https://octo.example.com',
    botToken: 'bf_t',
    wsFactory,
    fetchImpl,
  })
  return { bridge, adapter, wsClient: () => wsClient! }
}

describe('OctoChannelBridge', () => {
  it('@bot 消息 → adapter.run（sessionId=octo:acct:<chatId>）→ 回复只用 final_text（不重复拼接 text 增量）', async () => {
    const sent: Array<{ channelId: string; content: string }> = []
    const { bridge, adapter, wsClient } = makeBridge({ onSend: (channelId, content) => sent.push({ channelId, content }) })
    bridge.start()
    wsClient().deliver(groupMessage())
    // 等待事件循环完成异步 run + send
    await vi.waitFor(() => {
      expect(adapter.run).toHaveBeenCalledOnce()
    })
    const runOptions = (adapter.run as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(runOptions).toMatchObject({ prompt: '@bot 你好', sessionId: 'octo:acct:g123', cwd: '/tmp' })
    await vi.waitFor(() => {
      expect(sent.length).toBe(1)
    })
    // 事件流含 text 增量('你好') + final_text('你好，世界')——只应发 final_text，避免双份拼接
    expect(sent[0]).toEqual({ channelId: 'g123', content: '你好，世界' })
    bridge.stop()
  })

  it('非 @bot 消息 → 不触发 run', async () => {
    const { bridge, adapter, wsClient } = makeBridge()
    bridge.start()
    wsClient().deliver(groupMessage({ mentionUids: ['other'] }))
    await new Promise((r) => setTimeout(r, 50))
    expect(adapter.run).not.toHaveBeenCalled()
    bridge.stop()
  })

  it('群白名单外 → 不触发 run', async () => {
    const { bridge, adapter, wsClient } = makeBridge({ allowedGroups: ['g-other'] })
    bridge.start()
    wsClient().deliver(groupMessage())
    await new Promise((r) => setTimeout(r, 50))
    expect(adapter.run).not.toHaveBeenCalled()
    bridge.stop()
  })

  it('error 事件 → 回复错误提示（不静默）', async () => {
    const sent: Array<{ channelId: string; content: string }> = []
    const adapter = fakeAdapter(() => eventsFrom([
      { type: 'system', sessionId: 'octo:acct:g123', cwd: '/tmp' },
      { type: 'error', message: 'AUTH: Invalid API key', terminationReason: 'interrupted' },
      { type: 'done', sessionId: 'octo:acct:g123', terminationReason: 'interrupted' },
    ]))
    const { bridge, wsClient } = makeBridge({
      adapter,
      onSend: (channelId, content) => sent.push({ channelId, content }),
    })
    bridge.start()
    wsClient().deliver(groupMessage())
    await vi.waitFor(() => {
      expect(sent.length).toBe(1)
    })
    expect(sent[0]).toMatchObject({ channelId: 'g123', content: expect.stringContaining('AUTH: Invalid API key') })
    bridge.stop()
  })
})
