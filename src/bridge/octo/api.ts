/**
 * Octo REST API 客户端最小集（C2/FR1）。
 *
 * MVP 只需两个端点：
 * - POST /v1/bot/sendMessage —— 发文本消息（bot 回复）
 * - POST /v1/bot/heartbeat   —— REST 心跳（WS 之外的保活信号）
 * 认证：Authorization: Bearer ${botToken}（bf_ 前缀，octo-server 签发）。
 * fetch 可注入（测试替身）。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 OctoApi.xxx 访问
export * as OctoApi from './api.js'
import { randomUUID } from 'node:crypto'

/** 发消息请求体 */
export interface SendMessageParams {
  apiUrl: string
  botToken: string
  channelId: string
  channelType: number
  content: string
  clientMsgNo?: string
}

/** 发消息响应 */
export interface SendMessageResult {
  message_id: string
  client_msg_no: string
  message_seq: number
}

/** 可注入 fetch（测试替身；默认用全局 fetch） */
export type FetchLike = typeof fetch

/** 生成客户端消息号（幂等去重用，服务端按此去重重复发送） */
export function generateClientMsgNo(): string {
  return randomUUID().replaceAll('-', '')
}

/** REST 请求封装：Bearer 认证 + JSON 解析 + 非 2xx 抛错 */
async function postJson<T>(
  fetchImpl: FetchLike,
  apiUrl: string,
  botToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`octo api ${path} 失败：HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/**
 * 发送文本消息到频道（群）。
 * @throws 空 channelId 或 API 非 2xx
 */
export async function sendMessage(
  params: SendMessageParams,
  fetchImpl: FetchLike = fetch,
): Promise<SendMessageResult> {
  if (!params.channelId || !params.channelId.trim()) {
    throw new Error('octo: channelId is required to send a message')
  }
  return postJson<SendMessageResult>(fetchImpl, params.apiUrl, params.botToken, '/v1/bot/sendMessage', {
    channel_id: params.channelId,
    channel_type: params.channelType,
    payload: { type: 1, content: params.content },
    client_msg_no: params.clientMsgNo ?? generateClientMsgNo(),
  })
}

/** REST 心跳：上报 bot 在线状态（WS 之外的保活信号） */
export async function heartbeat(params: {
  apiUrl: string
  botToken: string
}): Promise<void> {
  await postJson<Record<string, never>>(fetch, params.apiUrl, params.botToken, '/v1/bot/heartbeat', {})
}
