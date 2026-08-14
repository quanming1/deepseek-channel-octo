/**
 * WuKongIM 二进制协议编解码（Octo 的 WebSocket 底层协议，C2/FR2）。
 *
 * 协议要点（研读 openclaw-channel-octo socket.ts + octo-server 确认）：
 * - 帧格式：header（packetType<<4 | flags）+ 变长 body 长度 + body
 * - 握手：CONNECT（含 curve25519 DH 公钥）→ CONNACK（服务端公钥 + salt）
 *   → DH 共享密钥 → Md5(secretBase64) 前 16 位 = AES key；salt 前 16 = AES IV
 * - 消息：RECV 帧（明文头 + AES-128-CBC 加密 payload）→ 回 RECVACK 确认
 * - 心跳：PING（60s）→ PONG
 *
 * 本模块只做协议编解码与加解密（与 Octo 服务端协议对齐的功能性公共代码），
 * 不包含任何渠道业务逻辑。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 Protocol.xxx 访问
export * as Protocol from './protocol.js'
import { generateKeyPair, sharedKey } from 'curve25519-js'
import CryptoJS from 'crypto-js'
import { Md5 } from 'md5-typescript'

/** WuKongIM 包类型 */
export enum PacketType {
  CONNECT = 1,
  CONNACK = 2,
  SEND = 3,
  SENDACK = 4,
  RECV = 5,
  RECVACK = 6,
  PING = 7,
  PONG = 8,
  DISCONNECT = 9,
}

/** 协议版本（与 octo-server 对齐） */
export const PROTO_VERSION = 4

/** 心跳间隔（毫秒，与 WuKongIM SDK 默认一致） */
export const HEARTBEAT_INTERVAL_MS = 60_000

// ─── UTF-8 编解码（替代 openclaw 的 unescape/encodeURIComponent 技巧）─────────

function stringToUint8(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function uint8ToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

// ─── 二进制编码器 / 解码器 ────────────────────────────────────────────────────

/** 大端序二进制写入器 */
class Encoder {
  private readonly w: number[] = []

  writeByte(b: number): void {
    this.w.push(b & 0xff)
  }

  writeBytes(bytes: number[]): void {
    this.w.push(...bytes)
  }

  writeInt16(b: number): void {
    this.w.push((b >> 8) & 0xff, b & 0xff)
  }

  writeInt32(b: number): void {
    this.w.push((b >> 24) & 0xff, (b >> 16) & 0xff, (b >> 8) & 0xff, b & 0xff)
  }

  writeInt64(n: bigint): void {
    this.writeInt32(Number(n >> 32n))
    this.writeInt32(Number(n & 0xffffffffn))
  }

  writeString(s: string): void {
    if (s && s.length > 0) {
      const arr = stringToUint8(s)
      this.writeInt16(arr.length)
      this.w.push(...arr)
    } else {
      this.writeInt16(0)
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.w)
  }
}

/** 大端序二进制读取器 */
class Decoder {
  private offset = 0

  constructor(private readonly data: Uint8Array) {}

  readByte(): number {
    return this.data[this.offset++]!
  }

  readInt16(): number {
    const v = (this.data[this.offset]! << 8) | this.data[this.offset + 1]!
    this.offset += 2
    return v
  }

  readInt32(): number {
    const v =
      (this.data[this.offset]! << 24) |
      (this.data[this.offset + 1]! << 16) |
      (this.data[this.offset + 2]! << 8) |
      this.data[this.offset + 3]!
    this.offset += 4
    return v >>> 0
  }

  readInt64BigInt(): bigint {
    let n = 0n
    for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(this.data[this.offset + i]!)
    this.offset += 8
    return n
  }

  readInt64String(): string {
    return this.readInt64BigInt().toString()
  }

  readString(): string {
    const len = this.readInt16()
    if (len <= 0) return ''
    const slice = this.data.slice(this.offset, this.offset + len)
    this.offset += len
    return uint8ToString(slice)
  }

  readRemaining(): Uint8Array {
    const d = this.data.slice(this.offset)
    this.offset = this.data.length
    return d
  }

  /** MQTT 风格变长长度（帧体的长度字段） */
  readVariableLength(): number {
    let multiplier = 0
    let rLength = 0
    for (;;) {
      const b = this.readByte()
      rLength = rLength | ((b & 127) << multiplier)
      if ((b & 128) === 0) break
      multiplier += 7
    }
    return rLength
  }
}

/** MQTT 风格变长长度编码 */
function encodeVariableLength(len: number): number[] {
  const ret: number[] = []
  let value = len
  do {
    let digit = value % 0x80
    value = Math.floor(value / 0x80)
    if (value > 0) digit |= 0x80
    ret.push(digit)
  } while (value > 0)
  return ret
}

// ─── AES-128-CBC 加解密（密钥派生见 deriveAesMaterial）────────────────────────

function aesDecrypt(data: Uint8Array, aesKey: string, aesIV: string): Uint8Array {
  // data 是 base64 编码的密文文本；CryptoJS 的 OpenSSL 格式超过 64 字符会折行插 \n，
  // 先去除所有空白再解密（真实服务端同样可能折行）
  const b64 = uint8ToString(data).replace(/\s+/g, '')
  const decrypted = CryptoJS.AES.decrypt(b64, CryptoJS.enc.Utf8.parse(aesKey), {
    keySize: 128 / 8,
    iv: CryptoJS.enc.Utf8.parse(aesIV),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  })
  return stringToUint8(decrypted.toString(CryptoJS.enc.Utf8))
}

// ─── 握手与包编码 ─────────────────────────────────────────────────────────────

/** CONNECT 包：携带 DH 公钥，开启加密会话 */
export function encodeConnectPacket(opts: {
  deviceID: string
  uid: string
  token: string
  clientKey: string
}): Uint8Array {
  const body = new Encoder()
  body.writeByte(PROTO_VERSION)
  body.writeByte(0) // deviceFlag: 0 = app/bot
  body.writeString(opts.deviceID)
  body.writeString(opts.uid)
  body.writeString(opts.token)
  body.writeInt64(BigInt(Date.now()))
  body.writeString(opts.clientKey)
  return frame(PacketType.CONNECT, body.toUint8Array())
}

/** PING 心跳包（单字节，无 body） */
export function encodePingPacket(): Uint8Array {
  return new Uint8Array([(PacketType.PING << 4) | 0])
}

/** RECVACK 确认包：收到消息后回执，防止服务端重发 */
export function encodeRecvackPacket(messageID: string, messageSeq: number): Uint8Array {
  const body = new Encoder()
  body.writeInt64(BigInt(messageID))
  body.writeInt32(messageSeq)
  return frame(PacketType.RECVACK, body.toUint8Array())
}

/** 包封装：header（type<<4）+ 变长长度 + body */
function frame(packetType: PacketType, body: Uint8Array): Uint8Array {
  const out = new Encoder()
  out.writeByte((packetType << 4) | 0)
  out.writeBytes(encodeVariableLength(body.length))
  out.writeBytes(Array.from(body))
  return out.toUint8Array()
}

// ─── 帧解析（粘包处理）────────────────────────────────────────────────────────

/** 尝试从缓冲中拆出第一个完整帧；不足则返回 null（等待更多数据） */
export function tryUnpackFrame(buffer: Uint8Array<ArrayBufferLike>): { frame: Uint8Array<ArrayBufferLike>; rest: Uint8Array<ArrayBufferLike> } | null {
  if (buffer.length === 0) return null
  const packetType = buffer[0]! >> 4
  // PING/PONG 是单字节帧
  if (packetType === PacketType.PING || packetType === PacketType.PONG) {
    return { frame: buffer.slice(0, 1), rest: buffer.slice(1) }
  }
  // 解析 MQTT 风格变长长度（可能跨多个字节，需等待长度字节收齐）
  let pos = 1
  let remLength = 0
  let multiplier = 1
  for (;;) {
    if (pos >= buffer.length) return null // 长度字节未收齐
    const digit = buffer[pos++]!
    remLength += (digit & 127) * multiplier
    if ((digit & 128) === 0) break
    multiplier *= 128
  }
  const total = pos + remLength
  if (buffer.length < total) return null // 帧体未收齐
  return { frame: buffer.slice(0, total), rest: buffer.slice(total) }
}

// ─── 帧体解析 ─────────────────────────────────────────────────────────────────

/** 已拆帧后的完整包：header + 变长长度 + body */
export interface ParsedPacket {
  packetType: PacketType
  /** 帧首字节的低位 flags（CONNACK 用 bit0 判断是否有 serverVersion） */
  flags: number
  /** body 读取器（已跳过 header 与长度字节） */
  decoder: Decoder
}

/** 解析一个完整帧 → 包类型 / flags / body 读取器 */
export function parsePacket(frameBytes: Uint8Array): ParsedPacket {
  const firstByte = frameBytes[0]!
  const packetType = (firstByte >> 4) as PacketType
  const dec = new Decoder(frameBytes)
  dec.readByte()
  if (packetType !== PacketType.PING && packetType !== PacketType.PONG) {
    dec.readVariableLength()
  }
  return { packetType, flags: firstByte & 0x0f, decoder: dec }
}

// ─── DH 密钥协商 ──────────────────────────────────────────────────────────────

/** 生成 DH 密钥对（curve25519），返回私钥与公钥（base64） */
export function generateDhKeyPair(seed: Uint8Array): { privateKey: Uint8Array; publicKeyBase64: string } {
  const keyPair = generateKeyPair(seed)
  return { privateKey: keyPair.private, publicKeyBase64: Buffer.from(keyPair.public).toString('base64') }
}

/** 由 DH 共享密钥派生 AES 材料：key = Md5(secretBase64) 前 16 位；iv = salt 前 16 位 */
export function deriveAesMaterial(
  privateKey: Uint8Array,
  serverKeyBase64: string,
  salt: string,
): { aesKey: string; aesIV: string } {
  const serverPubKey = Uint8Array.from(Buffer.from(serverKeyBase64, 'base64'))
  const secret = sharedKey(privateKey, serverPubKey)
  const secretBase64 = Buffer.from(secret).toString('base64')
  const aesKeyFull = Md5.init(secretBase64)
  return {
    aesKey: aesKeyFull.substring(0, 16),
    aesIV: salt && salt.length > 16 ? salt.substring(0, 16) : salt,
  }
}

/** RECV 帧的消息头字段（明文部分；payload 需解密后 JSON.parse） */
export interface RecvHeader {
  settingByte: number
  fromUID: string
  channelID: string
  channelType: number
  messageID: string
  messageSeq: number
  timestamp: number
  encryptedPayload: Uint8Array
}

/** 解析 RECV 帧（已拆帧的 body）→ 消息头 + 加密 payload */
export function parseRecvHeader(decoder: Decoder, serverVersion: number): RecvHeader {
  const settingByte = decoder.readByte()
  decoder.readString() // msgKey
  const fromUID = decoder.readString()
  const channelID = decoder.readString()
  const channelType = decoder.readByte()
  if (serverVersion >= 3) decoder.readInt32() // expire
  decoder.readString() // clientMsgNo
  const messageID = decoder.readInt64String()
  const messageSeq = decoder.readInt32()
  const timestamp = decoder.readInt32()
  // topic 标志（MVP 不处理话题，见 parseSettingByte）
  const topic = ((settingByte >> 3) & 0x01) > 0
  if (topic) decoder.readString()
  const encryptedPayload = decoder.readRemaining()
  return { settingByte, fromUID, channelID, channelType, messageID, messageSeq, timestamp, encryptedPayload }
}

/** 解密 RECV 的 payload → JSON 对象 */
export function decryptPayload(encrypted: Uint8Array, aesKey: string, aesIV: string): Record<string, unknown> {
  const decrypted = aesDecrypt(encrypted, aesKey, aesIV)
  return JSON.parse(uint8ToString(decrypted)) as Record<string, unknown>
}
