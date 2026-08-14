import { describe, expect, it } from 'vitest'
import { deriveWsUrl, loadOctoConfig } from './run-octo.js'

/** Octo daemon 配置加载单测 */

describe('loadOctoConfig', () => {
  it('缺失必填环境变量 → 抛 CliError', () => {
    expect(() => loadOctoConfig({})).toThrow('OCTO_API_URL')
    expect(() => loadOctoConfig({ OCTO_API_URL: 'https://x' })).toThrow('OCTO_BOT_TOKEN')
    expect(() => loadOctoConfig({ OCTO_API_URL: 'https://x', OCTO_BOT_TOKEN: 'bf_t' })).toThrow('OCTO_BOT_UID')
  })

  it('完整配置 → 默认值填充（accountId=botUid、wsUrl 由 apiUrl 推导）', () => {
    const config = loadOctoConfig({
      OCTO_API_URL: 'https://octo.example.com',
      OCTO_BOT_TOKEN: 'bf_t',
      OCTO_BOT_UID: 'bot-1',
      OCTO_ALLOWED_GROUPS: ' g1, g2 ',
    })
    expect(config.accountId).toBe('bot-1')
    expect(config.allowedGroups).toEqual(['g1', 'g2'])
    expect(config.wsUrl).toBe('wss://octo.example.com/ws')
  })
})

describe('deriveWsUrl', () => {
  it('https → wss，http → ws，尾部斜杠归一', () => {
    expect(deriveWsUrl('https://octo.example.com')).toBe('wss://octo.example.com/ws')
    expect(deriveWsUrl('https://octo.example.com/')).toBe('wss://octo.example.com/ws')
    expect(deriveWsUrl('http://localhost:8080')).toBe('ws://localhost:8080/ws')
  })
})
