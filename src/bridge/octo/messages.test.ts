import { describe, expect, it } from 'vitest'
import { isMentioned, parseInboundMessage, type RawInboundMessage } from './messages.js'

/** Octo 入站消息解析单测 */

function rawMessage(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    message_id: 'm1',
    message_seq: 1,
    from_uid: 'user1',
    channel_id: 'g123',
    channel_type: 2, // Group
    timestamp: 1000,
    payload: { type: 1, content: '你好' },
    ...overrides,
  }
}

describe('parseInboundMessage 入站解析', () => {
  it('群聊 Text 消息 → 提取文本与频道信息', () => {
    const msg = parseInboundMessage(rawMessage())
    expect(msg).toEqual({
      messageId: 'm1',
      fromUid: 'user1',
      chatId: 'g123',
      channelType: 2,
      text: '你好',
      mentionUids: [],
    })
  })

  it('非群聊（DM=1）→ null 丢弃', () => {
    expect(parseInboundMessage(rawMessage({ channel_type: 1 }))).toBeNull()
  })

  it('空文本 → null 丢弃', () => {
    expect(parseInboundMessage(rawMessage({ payload: { type: 1, content: '   ' } }))).toBeNull()
  })

  it('RichText(14) 用 server 权威 plain 字段提取文本', () => {
    const msg = parseInboundMessage(rawMessage({ payload: { type: 14, plain: '图文消息的纯文本' } }))
    expect(msg?.text).toBe('图文消息的纯文本')
  })

  it('mention.uids 提取与 isMentioned 判定', () => {
    const msg = parseInboundMessage(
      rawMessage({ payload: { type: 1, content: '@bot 你好', mention: { uids: ['bot-1', 'user1'] } } }),
    )
    expect(msg?.mentionUids).toEqual(['bot-1', 'user1'])
    expect(isMentioned(msg!, 'bot-1')).toBe(true)
    expect(isMentioned(msg!, 'other-bot')).toBe(false)
  })
})
