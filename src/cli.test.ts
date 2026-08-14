import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DshCompat } from './config/dsh-compat.js'
import { SdkProfile } from './agent/sdk-profile.js'
import { DshClient } from './agent/dsh-client.js'
import { Errors } from './agent/errors.js'

/**
 * B1 单测：版本一致性、profile 生成、SDK 通知翻译。
 * 真实 dsh 握手/模型调用依赖 DEEPSEEK_API_KEY，由手动验证覆盖（PRD AC4）。
 */

describe('dsh-compat 版本一致性', () => {
  it('sdk-client 锁定版本与 package.json 一致（防漂移）', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'),
    ) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@deepseek-ai/dsh-sdk-client']).toBe(DshCompat.SDK_CLIENT_VERSION)
  })
})

describe('sdk-profile 路径', () => {
  it('profile 根目录解析到 $DSH_HOME/profiles/octo-sdk', () => {
    const root = SdkProfile.sdkProfileRoot({ DSH_HOME: '/tmp/dsh-home' })
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
    expect(DshClient.textDeltaOf(notification as never)).toBe('你好')
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
    expect(DshClient.reasoningDeltaOf(notification as never)).toBe('思考中')
  })

  it('非文本事件返回 null', () => {
    const notification = { method: 'session.event', params: { event: { type: 'tool/call', data: {} } } }
    expect(DshClient.textDeltaOf(notification as never)).toBeNull()
  })

  it('turn/end 错误提取轮次失败信息', () => {
    const notification = {
      method: 'session.event',
      params: {
        event: {
          type: 'turn/end',
          data: { reason: { kind: 'error', error: { message: 'AUTH: Invalid API key' } } },
        },
      },
    }
    expect(DshClient.turnErrorOf(notification as never)).toBe('AUTH: Invalid API key')
  })
})

describe('结构化错误（TS-STYLE-GUIDE §8）', () => {
  it('DshError 带 tag 且 isInstance 收窄', () => {
    const error = new Errors.DshError('dsh 轮次失败')
    expect(error.tag).toBe('DshError')
    expect(Errors.DshError.isInstance(error)).toBe(true)
    expect(Errors.DshError.isInstance(new Error('普通错误'))).toBe(false)
  })

  it('CliError 带 tag 且 isInstance 收窄', () => {
    const error = new Errors.CliError('缺少 API key')
    expect(error.tag).toBe('CliError')
    expect(Errors.CliError.isInstance(error)).toBe(true)
    expect(Errors.CliError.isInstance(new Error('普通错误'))).toBe(false)
  })

  it('异步失败路径可被 toMatchObject 按 tag 断言', async () => {
    // 模拟 CLI 失败路径抛结构化错误（与 send 无 key 路径一致）
    const fail = async () => {
      throw new Errors.CliError('缺少 DeepSeek API key')
    }
    await expect(fail()).rejects.toMatchObject({ tag: 'CliError' })
  })
})
