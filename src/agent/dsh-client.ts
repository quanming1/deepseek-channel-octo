/**
 * dsh 客户端封装：基于官方 @deepseek-ai/dsh-sdk-client。
 *
 * 职责：
 * 1. 启动 dsh 子进程（带 SDK profile，stdout 为 JSON-RPC 帧通道）
 * 2. initialize 握手（provider/model/cwd 路由）
 * 3. run 发送 prompt，把 session.event 通知翻译为流式文本输出
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 DshClient.xxx 访问
export * as DshClient from './dsh-client.js'
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
} from '@deepseek-ai/dsh-sdk-client'
import { DshCompat } from '../config/dsh-compat.js'
import { SdkProfile } from './sdk-profile.js'
import { Errors } from './errors.js'

/** 一次 send 的执行结果 */
export interface SendResult {
  sessionId: string
  /** 完整回答文本（非流式消费者用；CLI 已流式输出可忽略） */
  finalResponse: string
}

/** sendPrompt 的回调选项：增量输出目的地由调用方决定（本模块不直接写 stdout） */
export interface SendOptions {
  /** 文本增量回调（回答正文） */
  onText?: (delta: string) => void
  /** 思考增量回调（用于展示处理中状态） */
  onThinking?: (delta: string) => void
}

/** session.event 通知中 assistant/chunk 事件的负载形状（按需子集） */
type ChunkEvent = {
  type?: string
  data?: { chunk?: { type?: string; text?: string } }
}

/** session.event 通知中 turn/end 事件的负载形状（按需子集） */
type TurnEndEvent = {
  type?: string
  data?: { reason?: { kind?: string; error?: { message?: string } } }
}

/** 从 assistant/chunk 通知提取指定类型的增量文本；非目标通知返回 null */
function chunkDeltaOf(notification: HarnessNotification, deltaType: 'text-delta' | 'reasoning-delta'): string | null {
  if (notification.method !== 'session.event') return null
  const event = notification.params.event as ChunkEvent | undefined
  if (event?.type !== 'assistant/chunk') return null
  const chunk = event.data?.chunk
  if (chunk?.type !== deltaType || !chunk.text) return null
  return chunk.text
}

/** 解析 notification 中的文本增量（assistant/chunk text-delta），无则返回 null */
export function textDeltaOf(notification: HarnessNotification): string | null {
  return chunkDeltaOf(notification, 'text-delta')
}

/** 解析 notification 中的思考增量（reasoning-delta），用于展示处理中状态 */
export function reasoningDeltaOf(notification: HarnessNotification): string | null {
  return chunkDeltaOf(notification, 'reasoning-delta')
}

/** 解析 notification 中的轮次错误（turn/end kind=error），无则返回 null */
export function turnErrorOf(notification: HarnessNotification): string | null {
  if (notification.method !== 'session.event') return null
  const event = notification.params.event as TurnEndEvent | undefined
  if (event?.type !== 'turn/end') return null
  const reason = event.data?.reason
  if (reason?.kind !== 'error') return null
  return reason.error?.message ?? 'dsh 轮次失败（未知错误）'
}

/**
 * 创建并启动 dsh harness（子进程 + 握手）。
 * @param dshBin dsh 可执行文件路径（resolveDshBin 的结果）
 * @param cwd 工作目录（会话的 workspace）
 * @param model 模型名（可选，默认由 runtime 决定）
 */
export async function createHarness(
  dshBin: string,
  cwd: string,
  model?: string,
): Promise<DeepSeekHarness> {
  // Windows 上 dsh 是 .cmd 批处理，需经 cmd.exe /c 包装才能 spawn（dshLaunchSpec 处理）
  const launch = SdkProfile.dshLaunchSpec(dshBin)
  const options: DeepSeekHarnessOptions = {
    // 启动 dsh 子进程：--profile 加载 SDK runtime（stdout 是协议帧通道）
    launch: {
      command: launch.command,
      args: [...launch.args, '--profile', DshCompat.SDK_PROFILE],
      cwd,
    },
    cwd,
    provider: 'deepseek-official',
    ...(model === undefined ? {} : { model }),
  }
  const harness = new DeepSeekHarness(options)
  await harness.start() // 握手失败会抛错，由调用方捕获并提示
  return harness
}

/**
 * 发送一条 prompt，把 token 级增量翻译为回调输出，返回最终回答。
 * @param harness 已启动的 harness
 * @param prompt 用户消息
 * @param options 回调选项（onText / onThinking，输出目的地由调用方决定）
 * @throws DshError 轮次失败或空响应（防静默失败）
 */
export async function sendPrompt(
  harness: DeepSeekHarness,
  prompt: string,
  options: SendOptions = {},
): Promise<SendResult> {
  // 收集轮次错误：dsh 静默失败（如认证失败）必须显式暴露，不能返回空回答假装成功
  let turnError: string | null = null

  const result = await harness.run(prompt, {
    // 通知观察者：把 token 级增量翻译为回调；捕获轮次错误
    onNotification: (notification) => {
      const text = textDeltaOf(notification)
      if (text !== null) {
        options.onText?.(text)
        return
      }
      const reason = reasoningDeltaOf(notification)
      if (reason !== null) {
        options.onThinking?.(reason)
        return
      }
      const error = turnErrorOf(notification)
      if (error !== null) turnError = error
    },
  })

  // 轮次失败：抛结构化错误让 CLI 以非零退出（防静默失败）
  if (turnError !== null) {
    throw new Errors.DshError(turnError)
  }
  // 无错误但也没有回答：同样是异常
  if (!result.finalResponse) {
    throw new Errors.DshError('dsh 未返回回答（空响应）')
  }

  return {
    sessionId: result.sessionId,
    finalResponse: result.finalResponse,
  }
}
