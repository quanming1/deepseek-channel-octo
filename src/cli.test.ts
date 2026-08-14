import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { DshClient, Errors, SdkProfile } from './agent/index.js'
import { DshCompat } from './config/index.js'

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

describe('sdk-profile 路径与平台', () => {
  it('profile 根目录解析到 $DSH_HOME/profiles/octo-sdk', () => {
    const root = SdkProfile.sdkProfileRoot({ DSH_HOME: '/tmp/dsh-home' })
    expect(root.replace(/\\/g, '/')).toBe('/tmp/dsh-home/profiles/octo-sdk')
  })

  it('pathSeparatorOf 按平台返回 PATH 分隔符', () => {
    expect(SdkProfile.pathSeparatorOf(true)).toBe(';')
    expect(SdkProfile.pathSeparatorOf(false)).toBe(':')
  })

  // resolveDshBin 的 Windows 分支：npm 生成的 dsh 无扩展名不可执行，必须解析 dsh.cmd
  it.skipIf(process.platform !== 'win32')('resolveDshBin 在 PATH 中解析 dsh.cmd（Windows）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-octo-bin-'))
    try {
      writeFileSync(join(dir, 'dsh.cmd'), '@echo off\n', 'utf-8')
      const found = SdkProfile.resolveDshBin({ PATH: dir })
      expect(found).toBe(join(dir, 'dsh.cmd'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
    expect(DshClient.textDeltaOf(notification as unknown as HarnessNotification)).toBe('你好')
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
    expect(DshClient.reasoningDeltaOf(notification as unknown as HarnessNotification)).toBe('思考中')
  })

  it('非文本事件返回 null', () => {
    const notification = { method: 'session.event', params: { event: { type: 'tool/call', data: {} } } }
    expect(DshClient.textDeltaOf(notification as unknown as HarnessNotification)).toBeNull()
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
    expect(DshClient.turnErrorOf(notification as unknown as HarnessNotification)).toBe('AUTH: Invalid API key')
  })
})

describe('sendPrompt 会话透传', () => {
  it('传 sessionId 原样透传给 harness.run；不传则省略', async () => {
    const recorded: Array<{ sessionId?: string }> = []
    const fakeHarness = {
      run: async (_prompt: string, options: { sessionId?: string }) => {
        recorded.push(options)
        return { sessionId: options.sessionId ?? 's-new', finalResponse: 'ok' }
      },
    }
    await DshClient.sendPrompt(fakeHarness as never, 'x', {}, 'octo:acct:g1')
    await DshClient.sendPrompt(fakeHarness as never, 'x', {})
    expect(recorded[0]?.sessionId).toBe('octo:acct:g1')
    expect(recorded[1]?.sessionId).toBeUndefined()
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

  it('isKnownError 统一判别已知业务错误', () => {
    expect(Errors.isKnownError(new Errors.DshError('x'))).toBe(true)
    expect(Errors.isKnownError(new Errors.CliError('x'))).toBe(true)
    expect(Errors.isKnownError(new Error('普通错误'))).toBe(false)
  })

  it('异步失败路径可被 toMatchObject 按 tag 断言', async () => {
    // 模拟 CLI 失败路径抛结构化错误（与 send 无 key 路径一致）
    const fail = async () => {
      throw new Errors.CliError('缺少 DeepSeek API key')
    }
    await expect(fail()).rejects.toMatchObject({ tag: 'CliError' })
  })
})
