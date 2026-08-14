/**
 * Octo REST API 客户端最小集（C2/FR1）。
 *
 * 端点：
 * - POST /v1/bot/register   —— bot 上线，换取 WS 认证凭据（im_token/robot_id/ws_url）
 * - POST /v1/bot/sendMessage —— 发文本消息（bot 回复）
 * - POST /v1/bot/heartbeat   —— REST 心跳（WS 之外的保活信号）
 * 认证：Authorization: Bearer ${botToken}（bf_ 前缀，octo-server 签发）。
 * fetch 可注入（测试替身）。
 *
 * 注意：bf_ token 不能直接做 WuKongIM WS 握手——Octo 要求先 register（上线），
 * 再用返回的 im_token + robot_id 连接 WS（实机验证 C2 补缺）。
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

/** register 响应：WS 连接凭据（服务端权威） */
export interface RegisterBotResult {
  robot_id: string
  im_token: string
  ws_url: string
  api_url: string
  owner_uid: string
  owner_channel_id: string
}

/**
 * bot 上线注册：bf_ token → WS 认证凭据。
 * Octo 要求连接 WuKongIM WS 前先 register（im_token/robot_id/ws_url 以服务端返回为准）。
 */
export async function registerBot(
  params: {
    apiUrl: string
    botToken: string
    agentPlatform?: string
    agentVersion?: string
    pluginVersion?: string
  },
  fetchImpl: FetchLike = fetch,
): Promise<RegisterBotResult> {
  const body: Record<string, string> = {}
  if (params.agentPlatform) body.agent_platform = params.agentPlatform
  if (params.agentVersion) body.agent_version = params.agentVersion
  if (params.pluginVersion) body.plugin_version = params.pluginVersion
  return postJson<RegisterBotResult>(fetchImpl, params.apiUrl, params.botToken, '/v1/bot/register', body)
}

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
