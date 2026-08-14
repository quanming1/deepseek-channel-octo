import { describe, expect, it, vi } from 'vitest'
import { createBotBridge, deriveWsUrl, resolveWsUrl } from './run-octo.js'
import type { OctoChannelBridge } from './octo-channel.js'
import type { BotConfig } from '../config/octo-config.js'
import type { AgentAdapter } from '../adapters/types.js'

/** Octo daemon 装配单测：WS 地址推导 + 单 bot 装配（register → bridge） */

const FAKE_CREDENTIALS = {
  robot_id: 'bot-1',
  im_token: 'bf_im_token',
  ws_url: 'wss://server.example.com/ws',
  api_url: 'https://octo.example.com/api',
  owner_uid: 'u1',
  owner_channel_id: 'u1',
}

function fakeAdapter(): AgentAdapter {
  return {
    id: 'fake',
    displayName: 'fake',
    run: vi.fn(() => ({
      runId: 'r1',
      events: {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done' as const, sessionId: 's1', terminationReason: 'normal' as const }
        },
      },
      stop: vi.fn(async () => {}),
      waitForExit: vi.fn(async () => true),
    })),
  }
}

function botConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return { botUid: 'bot-1', botToken: 'bf_token', ...overrides }
}

describe('deriveWsUrl', () => {
  it('https → wss，http → ws，尾部斜杠归一', () => {
    expect(deriveWsUrl('https://octo.example.com')).toBe('wss://octo.example.com/ws')
    expect(deriveWsUrl('https://octo.example.com/')).toBe('wss://octo.example.com/ws')
    expect(deriveWsUrl('http://localhost:8080')).toBe('ws://localhost:8080/ws')
  })
})

describe('resolveWsUrl', () => {
  it('优先级：显式配置 > 服务端 ws_url > 由 apiUrl 推导', () => {
    const apiUrl = 'https://octo.example.com/api'
    expect(resolveWsUrl(undefined, 'wss://server.example.com/ws', apiUrl)).toBe('wss://server.example.com/ws')
    expect(resolveWsUrl('wss://custom.example.com/ws', 'wss://server.example.com/ws', apiUrl)).toBe(
      'wss://custom.example.com/ws',
    )
    expect(resolveWsUrl(undefined, undefined, 'https://octo.example.com')).toBe('wss://octo.example.com/ws')
  })
})

describe('createBotBridge', () => {
  it('register 成功 → bridge 以 robot_id/im_token/服务端 ws_url 构造（accountId 默认 robot_id）', async () => {
    let captured: unknown
    const bridgeFactory = (opts: unknown) => {
      captured = opts
      return { start: vi.fn(), stop: vi.fn() } as unknown as OctoChannelBridge
    }
    await createBotBridge(botConfig(), {
      apiUrl: 'https://octo.example.com/api',
      adapter: fakeAdapter(),
      cwd: '/tmp',
      registerImpl: async () => FAKE_CREDENTIALS,
      bridgeFactory,
    })
    const capturedOpts = captured as {
      botUid: string
      botToken: string
      accountId: string
      wsUrl: string
      apiUrl: string
      allowedGroups?: string[]
    }
    expect(capturedOpts.botUid).toBe('bot-1')
    expect(capturedOpts.botToken).toBe('bf_im_token')
    expect(capturedOpts.accountId).toBe('bot-1')
    expect(capturedOpts.wsUrl).toBe('wss://server.example.com/ws')
    expect(capturedOpts.apiUrl).toBe('https://octo.example.com/api')
  })

  it('显式 wsUrl 优先于服务端返回', async () => {
    let captured: unknown
    const bridgeFactory = (opts: unknown) => {
      captured = opts
      return { start: vi.fn(), stop: vi.fn() } as unknown as OctoChannelBridge
    }
    await createBotBridge(botConfig(), {
      apiUrl: 'https://octo.example.com/api',
      wsUrl: 'wss://custom.example.com/ws',
      adapter: fakeAdapter(),
      cwd: '/tmp',
      registerImpl: async () => FAKE_CREDENTIALS,
      bridgeFactory,
    })
    expect((captured as { wsUrl: string }).wsUrl).toBe('wss://custom.example.com/ws')
  })

  it('accountId/allowedGroups 透传（配置提供时）', async () => {
    let captured: unknown
    const bridgeFactory = (opts: unknown) => {
      captured = opts
      return { start: vi.fn(), stop: vi.fn() } as unknown as OctoChannelBridge
    }
    await createBotBridge(
      botConfig({ accountId: 'acct-x', allowedGroups: ['g1'] }),
      {
        apiUrl: 'https://octo.example.com/api',
        adapter: fakeAdapter(),
        cwd: '/tmp',
        registerImpl: async () => FAKE_CREDENTIALS,
        bridgeFactory,
      },
    )
    const opts = captured as { accountId: string; allowedGroups: string[] }
    expect(opts.accountId).toBe('acct-x')
    expect(opts.allowedGroups).toEqual(['g1'])
  })

  it('robot_id 与配置 botUid 不一致 → 抛 CliError', async () => {
    await expect(
      createBotBridge(botConfig({ botUid: 'other-bot' }), {
        apiUrl: 'https://octo.example.com/api',
        adapter: fakeAdapter(),
        cwd: '/tmp',
        registerImpl: async () => FAKE_CREDENTIALS,
      }),
    ).rejects.toThrow('robot_id 不一致')
  })
})
