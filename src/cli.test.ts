import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SDK_CLIENT_VERSION } from './config/dsh-compat.js'
import { sdkProfileRoot } from './agent/sdk-profile.js'
import { textDeltaOf, reasoningDeltaOf } from './agent/dsh-client.js'

/**
 * B1 单测：版本一致性、profile 生成、SDK 通知翻译。
 * 真实 dsh 握手/模型调用依赖 DEEPSEEK_API_KEY，由手动验证覆盖（PRD AC4）。
 */

describe('dsh-compat 版本一致性', () => {
  it('sdk-client 锁定版本与 package.json 一致（防漂移）', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'),
    ) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@deepseek-ai/dsh-sdk-client']).toBe(SDK_CLIENT_VERSION)
  })
})

describe('sdk-profile 路径', () => {
  it('profile 根目录解析到 $DSH_HOME/profiles/octo-sdk', () => {
    const root = sdkProfileRoot({ DSH_HOME: '/tmp/dsh-home' })
    expect(root.replace(/\\/g, '/')).toBe('/tmp/dsh-home/profiles/octo-sdk')
  })
})

describe('SDK 通知翻译', () => {
  it('assistant/chunk text-delta 提取文本增量', () => {
    const notification = {
      method: 'session.event',
      params: {
        event: {
          type: 'assistant/chunk',
          data: { chunk: { type: 'text-delta', text: '你好' } },
        },
      },
    }
    expect(textDeltaOf(notification as never)).toBe('你好')
  })

  it('reasoning-delta 提取思考增量', () => {
    const notification = {
      method: 'session.event',
      params: {
        event: {
          type: 'assistant/chunk',
          data: { chunk: { type: 'reasoning-delta', text: '思考中' } },
        },
      },
    }
    expect(reasoningDeltaOf(notification as never)).toBe('思考中')
  })

  it('非文本事件返回 null', () => {
    const notification = { method: 'session.event', params: { event: { type: 'tool/call', data: {} } } }
    expect(textDeltaOf(notification as never)).toBeNull()
  })
})
