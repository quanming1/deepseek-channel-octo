import { describe, expect, it, vi, afterEach } from 'vitest'
import WebSocket from 'ws'
import { deriveAesMaterial, generateDhKeyPair, PacketType } from './protocol.js'
import { OctoWsClient, type OctoWsOptions } from './ws.js'
import { type InboundMessage } from './messages.js'

/** Octo WS 客户端单测（fake WebSocket + 手工构造 CONNACK/RECV 帧） */

/** 可编程 fake WebSocket（ws 包接口的最小实现） */
class FakeWebSocket {
  readyState: number = WebSocket.CONNECTING
  binaryType: string = 'arraybuffer'
  sent: Uint8Array[] = []
  private readonly listeners = new Map<string, (...args: unknown[]) => void>()

  constructor(public readonly url: string) {}

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, listener)
  }

  send(data: Uint8Array | ArrayBuffer): void {
    this.sent.push(new Uint8Array(data as ArrayBuffer))
  }

  close(): void {
    this.readyState = WebSocket.CLOSED
    this.listeners.get('close')?.()
  }

  // ─── 测试辅助 ───
  emitOpen(): void {
    this.readyState = WebSocket.OPEN
    this.listeners.get('open')?.()
  }

  emitMessage(data: Uint8Array): void {
    this.listeners.get('message')?.(data as unknown as ArrayBuffer)
  }

  emitError(): void {
    this.listeners.get('error')?.(new Error('fake ws error'))
  }
}

/** 帧封装：header(type<<4 | flags) + 变长长度 + body */
function frame(packetType: number, body: number[], flags = 0): Uint8Array {
  const lengthBytes: number[] = []
  let len = body.length
  do {
    let digit = len % 0x80
    len = Math.floor(len / 0x80)
    if (len > 0) digit |= 0x80
    lengthBytes.push(digit)
  } while (len > 0)
  return new Uint8Array([(packetType << 4) | flags, ...lengthBytes, ...body])
}

/** 字符串字段编码：int16 长度 + utf8 字节 */
function str(s: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(s))
  return [(bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes]
}

function int64(n: number): number[] {
  const hi = Math.floor(n / 0x100000000)
  const lo = n >>> 0
  return [
    (hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
    (lo >> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff,
  ]
}

function int32(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** 构造 CONNACK 帧（reasonCode=1 成功 + serverKey + salt）；flags bit0 = hasServerVersion */
function connackFrame(serverKeyB64: string, salt: string, hasServerVersion = true): Uint8Array {
  const body = [
    ...(hasServerVersion ? [4] : []), // serverVersion
    ...int64(0), // timeDiff
    1, // reasonCode success
    ...str(serverKeyB64),
    ...str(salt),
    ...int64(1), // nodeId (version>=4)
  ]
  return frame(PacketType.CONNACK, body, hasServerVersion ? 1 : 0)
}

/** 构造加密 RECV 帧（payload 用给定 aes key/iv 加密） */
function recvFrame(opts: {
  aesKey: string
  aesIV: string
  fromUid: string
  channelId: string
  payload: Record<string, unknown>
}): Uint8Array {
  const encrypted = Buffer.from(
    // 用 protocol 的 decryptPayload 逆操作不现实，这里直接用 crypto-js 加密
    encryptPayload(JSON.stringify(opts.payload), opts.aesKey, opts.aesIV),
    'utf8',
  )
  const body = [
    0x00, // settingByte（topic=0）
    ...str(''), // msgKey
    ...str(opts.fromUid),
    ...str(opts.channelId),
    0x02, // channelType Group
    ...int32(0), // expire
    ...str(''), // clientMsgNo
    ...int64(7), // messageID
    ...int32(1), // messageSeq
    ...int32(1000), // timestamp
    ...Array.from(encrypted), // base64 密文
  ]
  return frame(PacketType.RECV, body)
}

// 加密 helper（与 protocol.aesDecrypt 逆操作；仅供测试构造数据）
import CryptoJS from 'crypto-js'
function encryptPayload(plain: string, aesKey: string, aesIV: string): string {
  return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plain), CryptoJS.enc.Utf8.parse(aesKey), {
    keySize: 128 / 8,
    iv: CryptoJS.enc.Utf8.parse(aesIV),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString()
}

/** 生成一对"客户端私钥 + 服务端公钥"的测试 DH 材料（用于加密 RECV payload） */
function makeTestCrypto() {
  const server = generateDhKeyPair(new Uint8Array(32).fill(9))
  const client = generateDhKeyPair(new Uint8Array(32).fill(1))
  const material = deriveAesMaterial(client.privateKey, server.publicKeyBase64, '0123456789abcdef0123456789abcdef')
  return { client, server, material }
}

function makeClient(overrides: Partial<OctoWsOptions> = {}) {
  const messages: InboundMessage[] = []
  const onConnected = vi.fn()
  const onDisconnected = vi.fn()
  const client = new OctoWsClient({
    wsUrl: 'ws://octo/ws',
    uid: 'bot-1',
    token: 'bf_t',
    onMessage: (m) => messages.push(m),
    onConnected,
    onDisconnected,
    wsFactory: (url) => new FakeWebSocket(url) as unknown as WebSocket,
    ...overrides,
  })
  return { client, messages, onConnected, onDisconnected }
}

function lastWs(client: OctoWsClient): FakeWebSocket {
  // 通过注入工厂拿到实例
  return (client as unknown as { ws: FakeWebSocket }).ws as unknown as FakeWebSocket
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OctoWsClient 握手', () => {
  it('connect → 发送 CONNECT 包（首字节 = CONNECT<<4）', () => {
    const { client } = makeClient()
    client.connect()
    const ws = lastWs(client)
    ws.emitOpen()
    expect(ws.sent.length).toBe(1)
    expect(ws.sent[0]![0]! >> 4).toBe(PacketType.CONNECT)
    client.disconnect()
  })

  it('收到 CONNACK 成功 → connected + onConnected 回调', () => {
    const { client, onConnected } = makeClient()
    client.connect()
    const ws = lastWs(client)
    ws.emitOpen()
    const { server } = makeTestCrypto()
    ws.emitMessage(connackFrame(server.publicKeyBase64, '0123456789abcdef0123456789abcdef'))
    expect(client.isConnected()).toBe(true)
    expect(onConnected).toHaveBeenCalledOnce()
    client.disconnect()
  })

  it('收到 CONNACK 拒绝（reasonCode≠1）→ 不进入 connected 且不重连', () => {
    const { client, onConnected } = makeClient()
    client.connect()
    const ws = lastWs(client)
    ws.emitOpen()
    // reasonCode=2（连接被拒）；flags bit0=1（hasServerVersion）
    const body = [4, ...int64(0), 2, ...str('key'), ...str('salt'), ...int64(1)]
    ws.emitMessage(frame(PacketType.CONNACK, body, 1))
    expect(client.isConnected()).toBe(false)
    expect(onConnected).not.toHaveBeenCalled()
    // 不应调度重连（needReconnect=false）
    expect((client as unknown as { reconnectTimer: unknown }).reconnectTimer).toBeNull()
  })

  it('RECV 消息解密 → onMessage 收到 InboundMessage（群文本）', () => {
    const { server, client, material } = makeTestCrypto()
    const { client: octoClient, messages } = makeClient({ dhKeyGen: () => client })
    octoClient.connect()
    const ws = lastWs(octoClient)
    ws.emitOpen()
    ws.emitMessage(connackFrame(server.publicKeyBase64, '0123456789abcdef0123456789abcdef'))
    ws.emitMessage(
      recvFrame({
        aesKey: material.aesKey,
        aesIV: material.aesIV,
        fromUid: 'user1',
        channelId: 'g123',
        payload: { type: 1, content: '你好', mention: { uids: ['bot-1'] } },
      }),
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ chatId: 'g123', text: '你好', mentionUids: ['bot-1'] })
    // 收到消息后回 RECVACK
    const recvack = ws.sent.find((p) => p[0]! >> 4 === PacketType.RECVACK)
    expect(recvack).toBeDefined()
    octoClient.disconnect()
  })
})
