/**
 * Octo bridge 核心（C2/FR3）：Octo 群消息 → AgentAdapter.run → 文本回复。
 *
 * 会话映射：sessionId = `octo:<accountId>:<chatId>`（channel_id 直接复用为会话 key，
 * C1 已实证 dsh 接受任意字符串 id；同一群永远续同一会话 → 多轮记忆）。
 * 触发策略：群白名单（可选）+ @bot 提及。
 * 渲染：MVP 不流式——聚合 text 增量，回合结束（final_text/done）一次性 sendMessage。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 OctoBridge.xxx 访问
export * as OctoBridge from './octo-channel.js'
import { randomUUID } from 'node:crypto'
import type { AgentAdapter, AgentEvent } from '../adapters/types.js'
import { OctoApi, type SendMessageResult } from './octo/api.js'
import type { InboundMessage } from './octo/messages.js'
import { OctoWsClient, type OctoWsOptions } from './octo/ws.js'
import type { FetchLike } from './octo/api.js'

/** bridge 选项 */
export interface OctoBridgeOptions {
  /** WuKongIM WS 地址（ws:// 或 wss://） */
  wsUrl: string
  /** 账号标识（会话 key 前缀，多账号隔离用） */
  accountId: string
  /** bot uid（@bot 判定 + WS 握手用） */
  botUid: string
  /** 可选：只处理这些群的 groupNo（白名单）；不配则处理所有群 */
  allowedGroups?: string[]
  /** 工作目录（dsh 会话的 cwd；daemon 统一用启动目录） */
  cwd: string
  adapter: AgentAdapter
  /** 构造 WS 客户端（可注入测试替身） */
  wsFactory?: (opts: OctoWsOptions) => OctoWsClient
  /** 发消息用 fetch（可注入测试替身） */
  fetchImpl?: FetchLike
}

/** 一次 run 的渲染结果 */
interface RunOutcome {
  text: string
  error: string | null
}

/**
 * Octo 通道桥：持有 WS 连接与 adapter，把群消息转成 agent run 并回发结果。
 * 生命周期：start()（连接 WS）→ stop()（断开）。
 */
export class OctoChannelBridge {
  private readonly ws: OctoWsClient
  private readonly accountId: string
  private readonly botUid: string
  private readonly allowedGroups: ReadonlySet<string> | null
  private readonly cwd: string
  private readonly adapter: AgentAdapter
  private readonly fetchImpl: FetchLike
  private readonly apiUrl: string
  private readonly botToken: string

  constructor(options: OctoBridgeOptions & { apiUrl: string; botToken: string }) {
    this.accountId = options.accountId
    this.botUid = options.botUid
    this.allowedGroups = options.allowedGroups ? new Set(options.allowedGroups) : null
    this.cwd = options.cwd
    this.adapter = options.adapter
    this.fetchImpl = options.fetchImpl ?? fetch
    this.apiUrl = options.apiUrl
    this.botToken = options.botToken

    const wsFactory = options.wsFactory ?? ((opts: OctoWsOptions) => new OctoWsClient(opts))
    this.ws = wsFactory({
      wsUrl: options.wsUrl,
      uid: options.botUid,
      token: options.botToken,
      onMessage: (message) => void this.handleInbound(message),
      onConnected: () => console.log(`[octo] 已连接（bot=${this.botUid}）`),
      onDisconnected: () => console.log('[octo] 连接断开，等待重连...'),
    })
  }

  /** 启动：连接 WuKongIM WS */
  start(): void {
    this.ws.connect()
  }

  /** 优雅停止：断开 WS（不重连） */
  stop(): void {
    this.ws.disconnect()
  }

  /** 会话 key：octo:<accountId>:<chatId>（群号直接复用） */
  sessionKeyFor(chatId: string): string {
    return `octo:${this.accountId}:${chatId}`
  }

  /** 是否应处理该消息：群白名单（若有）+ @bot */
  private shouldHandle(message: InboundMessage): boolean {
    if (this.allowedGroups && !this.allowedGroups.has(message.chatId)) return false
    return message.mentionUids.includes(this.botUid)
  }

  /** 入站消息处理：触发 agent run，完成后回发文本 */
  private async handleInbound(message: InboundMessage): Promise<void> {
    if (!this.shouldHandle(message)) return
    console.log(`[octo] 群 ${message.chatId} 收到：${message.text.slice(0, 50)}`)

    const run = this.adapter.run({
      runId: randomUUID(),
      prompt: message.text,
      cwd: this.cwd,
      sessionId: this.sessionKeyFor(message.chatId),
    })

    const outcome = await this.collectRun(run.events)
    const reply = outcome.error !== null ? `⚠️ agent 执行失败：${outcome.error}` : outcome.text
    if (!reply.trim()) {
      console.log('[octo] 空回复，跳过发送')
      return
    }
    try {
      const result = await OctoApi.sendMessage(
        {
          apiUrl: this.apiUrl,
          botToken: this.botToken,
          channelId: message.chatId,
          channelType: message.channelType,
          content: reply,
        },
        this.fetchImpl,
      )
      console.log(`[octo] 已回复 ${message.chatId}（msg=${result.message_id}）`)
    } catch (error) {
      console.error('[octo] 发送回复失败:', error instanceof Error ? error.message : String(error))
    }
  }

  /** 消费事件流：聚合 text 增量，捕获 error，等 done 结束 */
  private async collectRun(events: AsyncIterable<AgentEvent>): Promise<RunOutcome> {
    const textParts: string[] = []
    let error: string | null = null
    for await (const event of events) {
      switch (event.type) {
        case 'text':
          textParts.push(event.delta)
          break
        case 'final_text':
          textParts.push(event.content)
          break
        case 'error':
          error = event.message
          break
        case 'thinking':
        case 'system':
        case 'done':
          break
      }
    }
    return { text: textParts.join('').trim(), error }
  }
}

// 类型再导出：让消费者不需要直接 import octo/api（回复结果类型）
export type { SendMessageResult }
