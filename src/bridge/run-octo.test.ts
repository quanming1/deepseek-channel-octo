import { describe, expect, it } from 'vitest'
import { deriveWsUrl, loadOctoConfig, resolveWsUrl } from './run-octo.js'

/** Octo daemon 配置加载单测 */

describe('loadOctoConfig', () => {
  it('缺失必填环境变量 → 抛 CliError', () => {
    expect(() => loadOctoConfig({})).toThrow('OCTO_API_URL')
    expect(() => loadOctoConfig({ OCTO_API_URL: 'https://x' })).toThrow('OCTO_BOT_TOKEN')
    expect(() => loadOctoConfig({ OCTO_API_URL: 'https://x', OCTO_BOT_TOKEN: 'bf_t' })).toThrow('OCTO_BOT_UID')
  })

  it('完整配置 → 默认值填充（accountId=botUid、allowedGroups 拆分、wsUrl 留给装配时 resolve）', () => {
    const config = loadOctoConfig({
      OCTO_API_URL: 'https://octo.example.com',
      OCTO_BOT_TOKEN: 'bf_t',
      OCTO_BOT_UID: 'bot-1',
      OCTO_ALLOWED_GROUPS: ' g1, g2 ',
    })
    expect(config.accountId).toBe('bot-1')
    expect(config.allowedGroups).toEqual(['g1', 'g2'])
    expect(config.wsUrl).toBeUndefined()
  })

  it('环境变量值统一 trim（防 cmd set 尾随空格污染 URL）', () => {
    const config = loadOctoConfig({
      OCTO_API_URL: ' https://octo.example.com/api ',
      OCTO_BOT_TOKEN: ' bf_t ',
      OCTO_BOT_UID: ' bot-1 ',
      OCTO_ACCOUNT_ID: ' acct ',
    })
    expect(config.apiUrl).toBe('https://octo.example.com/api')
    expect(config.botToken).toBe('bf_t')
    expect(config.botUid).toBe('bot-1')
    expect(config.accountId).toBe('acct')
  })
})

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
    // 服务端未给 ws_url 时回退推导（注意 apiUrl 带 /api 路径时推导结果可能不对——由服务端权威兜底）
    expect(resolveWsUrl(undefined, undefined, 'https://octo.example.com')).toBe('wss://octo.example.com/ws')
  })
})
