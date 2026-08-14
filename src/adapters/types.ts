/**
 * AgentAdapter 契约：渠道无关的 agent 桥接抽象（C1）。
 *
 * 为什么需要这层：Octo 通道（C2）、CLI、未来的其他渠道都只面向本契约编程，
 * 不触碰 dsh 细节——换 agent 后端（如 ACP）时渠道层零改动。
 * 契约形态对齐 dsh-lark-bot 的 AgentAdapter（AsyncIterable 事件流 + stop），
 * 事件类型收敛为判别联合（对齐 errors.ts 的 tag 风格）。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 Adapters.Types 访问
export * as Types from './types.js'

/** run 的终止原因：正常完成 / 被用户中断（stop）/ 超时 */
export type TerminationReason = 'normal' | 'interrupted' | 'timeout'

/** 事件流：system（会话标识）——首个事件，携带实际使用的 sessionId */
export interface SystemEvent {
  readonly type: 'system'
  readonly sessionId: string
  readonly cwd: string
}

/** 事件流：text——回答正文的流式增量（token 级） */
export interface TextEvent {
  readonly type: 'text'
  readonly delta: string
}

/** 事件流：thinking——思考过程的流式增量（可选展示） */
export interface ThinkingEvent {
  readonly type: 'thinking'
  readonly delta: string
}

/** 事件流：final_text——本轮回合的完整回答（末尾一次性发出） */
export interface FinalTextEvent {
  readonly type: 'final_text'
  readonly content: string
}

/** 事件流：error——run 失败终止（含人类可读原因） */
export interface ErrorEvent {
  readonly type: 'error'
  readonly message: string
  readonly terminationReason: 'interrupted' | 'timeout'
}

/** 事件流：done——run 结束（成功或失败后必然发出，作为流的终止哨兵） */
export interface DoneEvent {
  readonly type: 'done'
  readonly sessionId: string | undefined
  readonly terminationReason: TerminationReason
}

/** Agent 事件判别联合：消费者按 type 分支处理 */
export type AgentEvent =
  | SystemEvent
  | TextEvent
  | ThinkingEvent
  | FinalTextEvent
  | ErrorEvent
  | DoneEvent

/** 一次 run 的输入选项 */
export interface AgentRunOptions {
  /** 调用方生成的 run 标识（透传回 AgentRun.runId） */
  readonly runId: string
  /** 用户消息（prompt 正文） */
  readonly prompt: string
  /** 工作目录（会话的 workspace；dsh 按 cwd 隔离 runtime 与存档） */
  readonly cwd: string
  /**
   * 会话 id：续跑既有会话的钥匙。
   * 传入 = 续跑该会话（磁盘有存档时从存档恢复）；缺省 = adapter 生成新 id（新会话）。
   * Octo 场景直接用渠道会话 key（如 octo:<accountId>:<groupNo>），dsh 对 id 无格式校验。
   */
  readonly sessionId?: string
  /** 模型名（缺省用 adapter 默认） */
  readonly model?: string
}

/** 一次运行中的 run 句柄 */
export interface AgentRun {
  /** 调用方传入的 runId（回显） */
  readonly runId: string
  /** 事件流：按序 yield AgentEvent，以 done 事件结束 */
  readonly events: AsyncIterable<AgentEvent>
  /** 请求中断：尽力停止当前 run（触发 done interrupted） */
  stop(): Promise<void>
  /** 等待结束；超时返回 false（不中断 run） */
  waitForExit(timeoutMs?: number): Promise<boolean>
}

/** agent 后端适配器接口 */
export interface AgentAdapter {
  /** 适配器标识（如 'dsh-sdk'） */
  readonly id: string
  /** 展示名（UI 用） */
  readonly displayName: string
  /** 发起一次 run：立即返回句柄，事件经 events 流出 */
  run(options: AgentRunOptions): AgentRun
  /** 可选：释放全部资源（常驻 runtime 回收） */
  dispose?(): Promise<void>
}
