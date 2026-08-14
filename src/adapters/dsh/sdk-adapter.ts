/**
 * SdkDshAdapter：基于官方 @deepseek-ai/dsh-sdk-client 的 AgentAdapter 实现（C1/FR2）。
 *
 * 常驻形态：harness（dsh 子进程）按 cwd 缓存——进程活着期间，同一工作目录
 * 的多次 run 复用同一 harness，session 续跑在子进程内存中完成（不依赖跨进程
 * resume，也不触发 id collision）。run() 把 SDK notification 翻译为 AgentEvent
 * 流，消费者（渠道层）只面向契约编程。
 *
 * 事件翻译复用 B1 资产：textDeltaOf / reasoningDeltaOf / turnErrorOf（src/agent/dsh-client.ts）。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 DshAdapter.xxx 访问
export * as DshAdapter from './sdk-adapter.js'
import { randomUUID } from 'node:crypto'
import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type {
  AgentAdapter,
  AgentEvent,
  AgentRun,
  AgentRunOptions,
} from '../types.js'
import { DshClient } from '../../agent/dsh-client.js'
import { Errors } from '../../agent/errors.js'

/** 单个 cwd 的 runtime 缓存条目 */
interface RuntimeEntry {
  harness: DeepSeekHarness
}

/** 事件通道：onNotification 推入、async iterator 消费（适配 SDK 回调 → AsyncIterable） */
class EventChannel {
  private readonly queue: AgentEvent[] = []
  private pending: ((value: IteratorResult<AgentEvent>) => void) | undefined
  private closed = false

  push(event: AgentEvent): void {
    if (this.closed) return
    if (this.pending) {
      const resolve = this.pending
      this.pending = undefined
      resolve({ value: event, done: false })
      return
    }
    this.queue.push(event)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.pending) {
      const resolve = this.pending
      this.pending = undefined
      resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: (): Promise<IteratorResult<AgentEvent>> => {
        if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift()!, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => {
          this.pending = resolve
        })
      },
    }
  }
}

/** adapter 选项 */
export interface SdkAdapterOptions {
  /** dsh 子进程启动规格（resolveDshBin + dshLaunchSpec 的产物） */
  launch: { command: string; args: string[] }
  /** 模型路由提供方（与 dsh profile 的 llm 配置一致） */
  provider: string
  /** 默认模型（run 未指定 model 时使用） */
  model: string
  /** 每轮最大 token 数（可选） */
  maxTokens?: number
  /** 可注入 harness 工厂（测试替身） */
  harnessFactory?: (cwd: string) => DeepSeekHarness
}

/**
 * dsh SDK 适配器：一个 cwd 一个常驻 harness，run 事件流翻译。
 * dispose() 回收全部 runtime（daemon 停机时调用）。
 */
export class SdkDshAdapter implements AgentAdapter {
  readonly id = 'dsh-sdk'
  readonly displayName = 'DeepSeek Harness (SDK)'

  private readonly launch: SdkAdapterOptions['launch']
  private readonly provider: string
  private readonly model: string
  private readonly maxTokens: number | undefined
  private readonly harnessFactory: (cwd: string) => DeepSeekHarness
  private readonly runtimes = new Map<string, RuntimeEntry>()
  private disposed = false

  constructor(options: SdkAdapterOptions) {
    this.launch = options.launch
    this.provider = options.provider
    this.model = options.model
    this.maxTokens = options.maxTokens
    this.harnessFactory = options.harnessFactory ?? ((cwd) => this.createHarness(cwd))
  }

  /** 发起一次 run：事件流以 system 开头、done 结尾；失败经 error 事件显式暴露（不静默）。 */
  run(options: AgentRunOptions): AgentRun {
    if (this.disposed) throw new Errors.DshError('SdkDshAdapter 已释放')
    const cwd = options.cwd
    const sessionId = options.sessionId ?? `session-${randomUUID().replaceAll('-', '')}`
    const harness = this.runtimeFor(cwd).harness
    const channel = new EventChannel()
    const stopRequested = { value: false }

    // 异步驱动：harness.run 的结果经事件通道流出
    void this.drive(harness, options, sessionId, channel, stopRequested)

    return {
      runId: options.runId,
      events: channel,
      stop: async () => {
        stopRequested.value = true
        await this.closeRuntime(cwd)
      },
      waitForExit: async (timeoutMs?: number) => {
        const settled = new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), timeoutMs ?? 5_000)
          // done 事件到达即视为 run 结束
          void (async () => {
            for await (const event of channel) {
              if (event.type === 'done') {
                clearTimeout(timer)
                resolve(true)
                return
              }
            }
            clearTimeout(timer)
            resolve(true)
          })()
        })
        return settled
      },
    }
  }

  /** 回收全部 runtime（daemon 停机）。 */
  async dispose(): Promise<void> {
    this.disposed = true
    const entries = [...this.runtimes.values()]
    this.runtimes.clear()
    await Promise.allSettled(entries.map((entry) => entry.harness.close()))
  }

  /** 一次 run 的完整驱动：翻译 notification → 事件通道；settle 后发 final_text + done。 */
  private async drive(
    harness: DeepSeekHarness,
    options: AgentRunOptions,
    sessionId: string,
    channel: EventChannel,
    stopRequested: { value: boolean },
  ): Promise<void> {
    channel.push({ type: 'system', sessionId, cwd: options.cwd })
    let turnError: string | null = null

    try {
      await harness.start()
      const result = await harness.run(options.prompt, {
        sessionId,
        onNotification: (notification: HarnessNotification) => {
          const text = DshClient.textDeltaOf(notification)
          if (text !== null) {
            channel.push({ type: 'text', delta: text })
            return
          }
          const reasoning = DshClient.reasoningDeltaOf(notification)
          if (reasoning !== null) {
            channel.push({ type: 'thinking', delta: reasoning })
            return
          }
          const error = DshClient.turnErrorOf(notification)
          if (error !== null) turnError = error
        },
      })

      // 轮次错误（如认证失败）显式暴露——绝不返回空回答假装成功
      if (turnError !== null) {
        channel.push({ type: 'error', message: turnError, terminationReason: 'interrupted' })
        channel.push({ type: 'done', sessionId, terminationReason: 'interrupted' })
        return
      }
      if (!result.finalResponse) {
        channel.push({ type: 'error', message: 'dsh 未返回回答（空响应）', terminationReason: 'interrupted' })
        channel.push({ type: 'done', sessionId, terminationReason: 'interrupted' })
        return
      }
      channel.push({ type: 'final_text', content: result.finalResponse })
      channel.push({ type: 'done', sessionId, terminationReason: stopRequested.value ? 'interrupted' : 'normal' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      channel.push({ type: 'error', message, terminationReason: 'interrupted' })
      channel.push({ type: 'done', sessionId, terminationReason: 'interrupted' })
    } finally {
      channel.close()
    }
  }

  private createHarness(cwd: string): DeepSeekHarness {
    return new DeepSeekHarness({
      launch: { command: this.launch.command, args: this.launch.args, cwd },
      cwd,
      provider: this.provider,
      model: this.model,
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
    })
  }

  private runtimeFor(cwd: string): RuntimeEntry {
    const existing = this.runtimes.get(cwd)
    if (existing) return existing
    const entry: RuntimeEntry = { harness: this.harnessFactory(cwd) }
    this.runtimes.set(cwd, entry)
    return entry
  }

  private async closeRuntime(cwd: string): Promise<void> {
    const entry = this.runtimes.get(cwd)
    if (!entry) return
    this.runtimes.delete(cwd)
    await entry.harness.close()
  }
}
