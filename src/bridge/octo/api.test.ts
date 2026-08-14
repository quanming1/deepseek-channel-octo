import { describe, expect, it, vi } from 'vitest'
import { generateClientMsgNo, registerBot, sendMessage } from './api.js'

/** Octo REST 客户端单测（fake fetch） */

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<unknown>) {
  return vi.fn(async (url: string, init: RequestInit) => handler(url, init)) as unknown as typeof fetch
}

describe('sendMessage', () => {
  it('Bearer 认证 + 正确 URL + 请求体（channel_id/payload/client_msg_no）', async () => {
    const fetchImpl = fakeFetch(async (url, init) => {
      expect(url).toBe('https://octo.example.com/v1/bot/sendMessage')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bf_token')
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(body.channel_id).toBe('g123')
      expect(body.channel_type).toBe(2)
      expect(body.payload).toEqual({ type: 1, content: '你好' })
      expect(typeof body.client_msg_no).toBe('string')
      return new Response(JSON.stringify({ message_id: 'm1', client_msg_no: 'c1', message_seq: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const result = await sendMessage(
      { apiUrl: 'https://octo.example.com/', botToken: 'bf_token', channelId: 'g123', channelType: 2, content: '你好' },
      fetchImpl,
    )
    expect(result.message_id).toBe('m1')
  })

  it('空 channelId 直接抛错（不发请求）', async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new Error('不应发起请求')
    })
    await expect(
      sendMessage({ apiUrl: 'x', botToken: 't', channelId: '  ', channelType: 2, content: 'hi' }, fetchImpl),
    ).rejects.toThrow('channelId is required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('非 2xx → 抛错含状态码', async () => {
    const fetchImpl = fakeFetch(async () => new Response('bad', { status: 500 }))
    await expect(
      sendMessage({ apiUrl: 'https://x', botToken: 't', channelId: 'g1', channelType: 2, content: 'hi' }, fetchImpl),
    ).rejects.toThrow('HTTP 500')
  })
})

describe('registerBot', () => {
  it('POST /v1/bot/register + Bearer 认证 + 返回凭据（robot_id/im_token/ws_url）', async () => {
    const fetchImpl = fakeFetch(async (url, init) => {
      expect(url).toBe('https://octo.example.com/v1/bot/register')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bf_token')
      expect(JSON.parse(String(init.body))).toEqual({ agent_platform: 'dsh', agent_version: '0.1.0' })
      return new Response(
        JSON.stringify({
          robot_id: 'bot-1',
          name: 'BlueWhale',
          im_token: 'bf_token',
          ws_url: 'wss://octo.example.com/ws',
          api_url: 'https://octo.example.com',
          owner_uid: 'u1',
          owner_channel_id: 'u1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    const result = await registerBot(
      { apiUrl: 'https://octo.example.com/', botToken: 'bf_token', agentPlatform: 'dsh', agentVersion: '0.1.0' },
      fetchImpl,
    )
    expect(result.robot_id).toBe('bot-1')
    expect(result.im_token).toBe('bf_token')
    expect(result.ws_url).toBe('wss://octo.example.com/ws')
  })

  it('可选元数据不传时请求体为空对象', async () => {
    const fetchImpl = fakeFetch(async (_url, init) => {
      expect(JSON.parse(String(init.body))).toEqual({})
      return new Response(
        JSON.stringify({
          robot_id: 'bot-1',
          im_token: 't',
          ws_url: '',
          api_url: '',
          owner_uid: '',
          owner_channel_id: '',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    const result = await registerBot({ apiUrl: 'https://octo.example.com', botToken: 'bf_token' }, fetchImpl)
    expect(result.robot_id).toBe('bot-1')
  })

  it('非 2xx → 抛错含状态码', async () => {
    const fetchImpl = fakeFetch(async () => new Response('nope', { status: 401 }))
    await expect(
      registerBot({ apiUrl: 'https://x', botToken: 'bf_bad' }, fetchImpl),
    ).rejects.toThrow('HTTP 401')
  })
})

describe('generateClientMsgNo', () => {
  it('生成无横线的 uuid', () => {
    expect(generateClientMsgNo()).toMatch(/^[0-9a-f]{32}$/)
  })
})
