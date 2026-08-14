/**
 * Octo WebSocket 客户端（C2/FR2）：WuKongIM 二进制协议的连接管理。
 *
 * 职责：建立 WS 连接 → CONNECT 握手（DH）→ 心跳保活 → RECV 消息解密分发 →
 * 断线指数退避重连。可注入 WebSocket 工厂与时钟（测试替身）。
 * 协议编解码见 ./protocol.ts，本模块只管连接生命周期。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 OctoWs.xxx 访问
export * as OctoWs from './ws.js'
import { randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  decryptPayload,
  deriveAesMaterial,
  encodeConnectPacket,
  encodePingPacket,
  encodeRecvackPacket,
  generateDhKeyPair,
  HEARTBEAT_INTERVAL_MS,
  PacketType,
  parsePacket,
  parseRecvHeader,
  PROTO_VERSION,
  tryUnpackFrame,
} from './protocol.js'
import { parseInboundMessage, type InboundMessage } from './messages.js'

/** WS 连接选项 */
export interface OctoWsOptions {
  /** WuKongIM gateway 地址（ws:// 或 wss://） */
  wsUrl: string
  /** bot 账号 uid（CONNECT 握手用，也是群里 @bot 的判定依据） */
  uid: string
  /** bot 认证 token（CONNECT 握手用） */
  token: string
  /** 收到一条入站消息（已解密、已解析为 InboundMessage） */
  onMessage: (message: InboundMessage) => void
  /** 连接成功（CONNACK 通过）回调 */
  onConnected?: () => void
  /** 连接断开回调 */
  onDisconnected?: () => void
  /** 可注入 WebSocket 构造器（测试替身） */
  wsFactory?: (url: string) => WebSocket
  /** 可注入 DH 密钥生成器（测试替身；默认 CSPRNG 32 字节种子） */
  dhKeyGen?: () => { privateKey: Uint8Array; publicKeyBase64: string }
}

/** 连接状态 */
export type WsState = 'idle' | 'connecting' | 'connected' | 'closed'

/** 重连参数（可配置，便于测试） */
export interface ReconnectPolicy {
  baseDelayMs: number
  maxDelayMs: number
  /** 快速断连阈值：连接存活 < 此值算一次快速断连 */
  rapidThresholdMs: number
  /** 连续快速断连次数达到此值触发 onError（可能 token 失效） */
  rapidLimit: number
}

const DEFAULT_RECONNECT: ReconnectPolicy = {
  baseDelayMs: 3_000,
  maxDelayMs: 60_000,
  rapidThresholdMs: 5_000,
  rapidLimit: 3,
}

/**
 * WuKongIM 连接客户端。生命周期：connect() → connected → disconnect()。
 * 断线自动重连（指数退避 + jitter）；心跳 PING 3 次无响应强制重连。
 */
export class OctoWsClient {
  private ws: WebSocket | null = null
  private state: WsState = 'idle'
  private needReconnect = true
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartTimer: ReturnType<typeof setInterval> | null = null
  private pingRetryCount = 0
  private reconnectAttempts = 0
  private rapidDisconnectCount = 0
  private lastConnectTime = 0
  private readonly wsFactory: (url: string) => WebSocket
  private readonly reconnect: ReconnectPolicy

  // 加密会话状态（CONNACK 后设置）
  private aesKey = ''
  private aesIV = ''
  private dhPrivateKey: Uint8Array | null = null
  private serverVersion = PROTO_VERSION

  // 粘包缓冲
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0)

  constructor(private readonly opts: OctoWsOptions, reconnect: Partial<ReconnectPolicy> = {}) {
    this.wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url))
    this.reconnect = { ...DEFAULT_RECONNECT, ...reconnect }
  }

  get currentState(): WsState {
    return this.state
  }

  /** 建立连接（幂等：已连接/连接中则忽略） */
  connect(): void {
    if (this.state === 'connecting' || this.state === 'connected') return
    this.needReconnect = true
    this.doConnect()
  }

  /** 优雅断开（不重连） */
  disconnect(): void {
    this.needReconnect = false
    this.teardown()
    this.state = 'closed'
  }

  /** 是否已通过 CONNACK（可承载业务流量） */
  isConnected(): boolean {
    return this.state === 'connected'
  }

  // ─── 内部连接逻辑 ──────────────────────────────────────────────────────────

  private doConnect(): void {
    this.clearHeart()
    this.clearReconnectTimer()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.buffer = new Uint8Array(0)
    this.state = 'connecting'

    const ws = this.wsFactory(this.opts.wsUrl)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.on('open', () => {
      if (this.ws !== ws) return // 陈旧连接守卫
      // curve25519 要求 32 字节 CSPRNG seed；测试可注入固定密钥
      const { privateKey, publicKeyBase64 } =
        this.opts.dhKeyGen?.() ?? generateDhKeyPair(randomBytes(32))
      this.dhPrivateKey = privateKey
      ws.send(encodeConnectPacket({
        deviceID: randomUUID() + 'W',
        uid: this.opts.uid,
        token: this.opts.token,
        clientKey: publicKeyBase64,
      }))
    })

    ws.on('message', (data: ArrayBuffer | Buffer) => {
      if (this.ws !== ws) return
      const bytes: Uint8Array = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)
      this.handleRawData(bytes)
    })

    ws.on('close', () => {
      if (this.ws !== ws) return
      const wasConnected = this.state === 'connected'
      this.teardown()
      if (wasConnected) this.opts.onDisconnected?.()
      this.trackRapidDisconnect()
      if (this.needReconnect) this.scheduleReconnect()
    })

    ws.on('error', () => {
      // close 事件随后触发，由 close 处理重连
    })
  }

  private teardown(): void {
    this.clearHeart()
    this.clearReconnectTimer()
    this.state = 'closed'
  }

  private trackRapidDisconnect(): void {
    if (this.lastConnectTime > 0) {
      const duration = Date.now() - this.lastConnectTime
      this.rapidDisconnectCount = duration < this.reconnect.rapidThresholdMs ? this.rapidDisconnectCount + 1 : 0
      this.lastConnectTime = 0
    }
    if (this.rapidDisconnectCount >= this.reconnect.rapidLimit) {
      this.needReconnect = false
      this.rapidDisconnectCount = 0
      return
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    const exponential = Math.min(
      this.reconnect.baseDelayMs * 2 ** this.reconnectAttempts,
      this.reconnect.maxDelayMs,
    )
    // ±25% jitter 防惊群
    const delay = Math.floor(exponential * (0.75 + Math.random() * 0.5))
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.needReconnect) this.doConnect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ─── 心跳 ──────────────────────────────────────────────────────────────────

  private restartHeart(): void {
    this.clearHeart()
    this.pingRetryCount = 0
    this.heartTimer = setInterval(() => {
      this.pingRetryCount++
      if (this.pingRetryCount > 3) {
        // 3 次无 PONG：判定死链，强制重连
        this.clearHeart()
        if (this.ws) {
          try {
            this.ws.close()
          } catch {
            /* ignore */
          }
        }
        return
      }
      this.sendRaw(encodePingPacket())
    }, HEARTBEAT_INTERVAL_MS)
  }

  private clearHeart(): void {
    if (this.heartTimer) {
      clearInterval(this.heartTimer)
      this.heartTimer = null
    }
  }

  private sendRaw(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
  }

  // ─── 数据接收与帧解析 ──────────────────────────────────────────────────────

  private handleRawData(data: Uint8Array<ArrayBufferLike>): void {
    this.buffer = concatBytes(this.buffer, data)
    for (;;) {
      const unpacked = tryUnpackFrame(this.buffer)
      if (!unpacked) break
      this.buffer = unpacked.rest
      this.handleFrame(unpacked.frame)
    }
  }

  private handleFrame(frameBytes: Uint8Array): void {
    const { packetType, flags, decoder } = parsePacket(frameBytes)
    switch (packetType) {
      case PacketType.CONNACK:
        this.handleConnack(flags, decoder)
        break
      case PacketType.RECV:
        this.handleRecv(decoder)
        break
      case PacketType.PONG:
        this.pingRetryCount = 0
        break
      case PacketType.PING:
        // 服务端 ping（罕见），忽略
        break
      case PacketType.SENDACK:
      case PacketType.SEND:
      case PacketType.RECVACK:
      case PacketType.DISCONNECT:
      case PacketType.CONNECT:
        break
    }
  }

  private handleConnack(flags: number, decoder: ReturnType<typeof parsePacket>['decoder']): void {
    const hasServerVersion = (flags & 0x01) > 0
    if (hasServerVersion) this.serverVersion = decoder.readByte()
    decoder.readInt64BigInt() // timeDiff
    const reasonCode = decoder.readByte()
    const serverKey = decoder.readString()
    const salt = decoder.readString()
    if (this.serverVersion >= 4) decoder.readInt64BigInt() // nodeId

    if (reasonCode !== 1) {
      // 连接被拒（token 无效等）：不自动重连，交给上层处理
      this.needReconnect = false
      this.state = 'closed'
      if (this.ws) {
        try {
          this.ws.close()
        } catch {
          /* ignore */
        }
      }
      return
    }

    const material = deriveAesMaterial(this.dhPrivateKey!, serverKey, salt)
    this.aesKey = material.aesKey
    this.aesIV = material.aesIV
    this.state = 'connected'
    this.lastConnectTime = Date.now()
    this.reconnectAttempts = 0
    this.rapidDisconnectCount = 0
    this.restartHeart()
    this.opts.onConnected?.()
  }

  private handleRecv(decoder: ReturnType<typeof parsePacket>['decoder']): void {
    const header = parseRecvHeader(decoder, this.serverVersion)
    // 先回执再解密（确认已收到，防重发）
    this.sendRaw(encodeRecvackPacket(header.messageID, header.messageSeq))
    try {
      const payload = decryptPayload(header.encryptedPayload, this.aesKey, this.aesIV)
      const inbound = parseInboundMessage({
        message_id: header.messageID,
        message_seq: header.messageSeq,
        from_uid: header.fromUID,
        channel_id: header.channelID,
        channel_type: header.channelType,
        timestamp: header.timestamp,
        payload,
      })
      if (inbound) this.opts.onMessage(inbound)
    } catch (error) {
      // 解密/解析失败：丢弃该帧（回执已发，服务端不会重发）
      console.error('[octo-ws] 消息解密/解析失败:', error instanceof Error ? error.message : String(error))
    }
  }
}

/** 字节拼接（Uint8Array 无内置 concat） */
function concatBytes(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
