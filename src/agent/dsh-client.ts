/**
 * dsh 客户端封装：基于官方 @deepseek-ai/dsh-sdk-client。
 *
 * 职责：
 * 1. 启动 dsh 子进程（带 SDK profile，stdout 为 JSON-RPC 帧通道）
 * 2. initialize 握手（provider/model/cwd 路由）
 * 3. run 发送 prompt，把 session.event 通知翻译为流式文本输出
 */
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { SDK_PROFILE } from '../config/dsh-compat.js'
import type { DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client'
import { dshLaunchSpec } from './sdk-profile.js'

/** 一次 send 的执行结果 */
export interface SendResult {
  sessionId: string
  finalResponse: string
  /** 是否有错误发生 */
  ok: boolean
}

/** 解析 notification 中的文本增量（assistant/chunk text-delta），无则返回 null */
export function textDeltaOf(notification: HarnessNotification): string | null {
  if (notification.method !== 'session.event') return null
  const event = notification.params.event as { type?: string; data?: { chunk?: { type?: string; text?: string } } } | undefined
  if (event?.type !== 'assistant/chunk') return null
  const chunk = event.data?.chunk
  if (chunk?.type !== 'text-delta' || !chunk.text) return null
  return chunk.text
}

/** 解析 notification 中的思考增量（reasoning-delta），用于展示处理中状态 */
export function reasoningDeltaOf(notification: HarnessNotification): string | null {
  if (notification.method !== 'session.event') return null
  const event = notification.params.event as { type?: string; data?: { chunk?: { type?: string; text?: string } } } | undefined
  if (event?.type !== 'assistant/chunk') return null
  const chunk = event.data?.chunk
  if (chunk?.type !== 'reasoning-delta' || !chunk.text) return null
  return chunk.text
}

/** 解析 notification 中的轮次错误（turn/end kind=error），无则返回 null */
export function turnErrorOf(notification: HarnessNotification): string | null {
  if (notification.method !== 'session.event') return null
  const event = notification.params.event as {
    type?: string
    data?: { reason?: { kind?: string; error?: { message?: string } } }
  } | undefined
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
  const launch = dshLaunchSpec(dshBin)
  const options: DeepSeekHarnessOptions = {
    // 启动 dsh 子进程：--profile 加载 SDK runtime（stdout 是协议帧通道）
    launch: {
      command: launch.command,
      args: [...launch.args, '--profile', SDK_PROFILE],
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
 * 发送一条 prompt，流式打印文本增量到 stdout，返回最终回答。
 * @param harness 已启动的 harness
 * @param prompt 用户消息
 * @param onThinking 思考增量回调（可选，如 CLI 展示处理中状态）
 */
export async function sendPrompt(
  harness: DeepSeekHarness,
  prompt: string,
  onThinking?: (delta: string) => void,
): Promise<SendResult> {
  // 收集轮次错误：dsh 静默失败（如认证失败）必须显式暴露，不能返回空回答假装成功
  let turnError: string | null = null

  const result = await harness.run(prompt, {
    // 通知观察者：把 token 级增量翻译为流式输出；捕获轮次错误
    onNotification: (notification) => {
      const text = textDeltaOf(notification)
      if (text !== null) {
        process.stdout.write(text)
        return
      }
      const reason = reasoningDeltaOf(notification)
      if (reason !== null && onThinking) {
        onThinking(reason)
        return
      }
      const error = turnErrorOf(notification)
      if (error !== null) turnError = error
    },
  })

  // 轮次失败：抛错让 CLI 以非零退出（防静默失败）
  if (turnError !== null) {
    throw new Error(turnError)
  }
  // 无错误但也没有回答：同样是异常
  if (!result.finalResponse) {
    throw new Error('dsh 未返回回答（空响应）')
  }

  return {
    sessionId: result.sessionId,
    finalResponse: result.finalResponse,
    ok: true,
  }
}
