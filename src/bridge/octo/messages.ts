/**
 * Octo 入站消息解析（C2/FR2）：WuKongIM RECV 帧解密后的 payload → 业务消息。
 *
 * MVP 只处理群聊（channel_type=2）的文本消息（Text=1 / RichText=14 的 plain 字段），
 * 其余类型（图片/文件/卡片等）返回 null 丢弃。mention 判定由调用方按 botUid 判断。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 OctoMessages.xxx 访问
export * as OctoMessages from './messages.js'

/** Octo 频道类型（与 octo-server 对齐） */
export enum ChannelType {
  DM = 1,
  Group = 2,
  CommunityTopic = 5,
}

/** Octo 消息内容类型（MVP 只关心文本） */
export enum MessageType {
  Text = 1,
  RichText = 14,
}

/** 解密后的 RECV 消息原始形状（对应 WuKongIM RECV 帧解出的 BotMessage） */
export interface RawInboundMessage {
  message_id: string
  message_seq: number
  from_uid: string
  channel_id?: string
  channel_type?: number
  timestamp: number
  payload: Record<string, unknown>
}

/** 解析后的业务消息（bridge 消费） */
export interface InboundMessage {
  messageId: string
  fromUid: string
  /** 群号（channel_id），也是会话 key 的来源 */
  chatId: string
  channelType: number
  text: string
  /** 消息里 @ 的所有 uid（payload.mention.uids） */
  mentionUids: string[]
}

/** 从解密 payload 提取文本（Text=1 用 content；RichText=14 用 server 权威 plain） */
function extractText(payload: Record<string, unknown>): string | null {
  const type = payload.type
  if (type === MessageType.Text) {
    return typeof payload.content === 'string' ? payload.content : null
  }
  if (type === MessageType.RichText) {
    return typeof payload.plain === 'string' ? payload.plain : null
  }
  return null
}

/** 提取 mention uid 列表（payload.mention.uids，可能不存在） */
function extractMentionUids(payload: Record<string, unknown>): string[] {
  const mention = payload.mention
  if (typeof mention !== 'object' || mention === null) return []
  const uids = (mention as Record<string, unknown>).uids
  return Array.isArray(uids) ? uids.filter((u): u is string => typeof u === 'string') : []
}

/**
 * 解析入站消息：只接受群聊文本消息；其余返回 null（丢弃）。
 * mention 命中判断不在此处——由调用方用 botUid 比较 mentionUids（或 @all 标志）。
 */
export function parseInboundMessage(raw: RawInboundMessage): InboundMessage | null {
  // MVP 只处理群聊（DM/话题后续阶段）
  if (raw.channel_type !== ChannelType.Group) return null
  const chatId = raw.channel_id
  if (!chatId || !chatId.trim()) return null
  const text = extractText(raw.payload)
  if (!text || !text.trim()) return null
  return {
    messageId: raw.message_id,
    fromUid: raw.from_uid,
    chatId,
    channelType: raw.channel_type,
    text: text.trim(),
    mentionUids: extractMentionUids(raw.payload),
  }
}

/** 是否 @ 了 bot：mention.uids 含 botUid，或 @all 类标志（humans/ais/all） */
export function isMentioned(message: InboundMessage, botUid: string): boolean {
  if (message.mentionUids.includes(botUid)) return true
  return false
}
