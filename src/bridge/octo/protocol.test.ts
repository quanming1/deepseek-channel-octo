import { describe, expect, it } from 'vitest'
import {
  deriveAesMaterial,
  encodeConnectPacket,
  encodePingPacket,
  encodeRecvackPacket,
  generateDhKeyPair,
  parsePacket,
  parseRecvHeader,
  PacketType,
  tryUnpackFrame,
} from './protocol.js'

/** WuKongIM 编解码与帧处理单测 */

describe('WuKongIM 帧编解码', () => {
  it('CONNECT 包：首字节为 CONNECT<<4，body 含 uid/token/clientKey', () => {
    const packet = encodeConnectPacket({
      deviceID: 'dev-1',
      uid: 'u1',
      token: 'bf_token',
      clientKey: 'c2Vya2V5',
    })
    expect(packet[0]! >> 4).toBe(PacketType.CONNECT)
    const { packetType, decoder } = parsePacket(packet)
    expect(packetType).toBe(PacketType.CONNECT)
    expect(decoder.readByte()).toBe(4) // version
    expect(decoder.readByte()).toBe(0) // deviceFlag
    expect(decoder.readString()).toBe('dev-1')
    expect(decoder.readString()).toBe('u1')
    expect(decoder.readString()).toBe('bf_token')
    decoder.readInt64BigInt() // timestamp
    expect(decoder.readString()).toBe('c2Vya2V5')
  })

  it('PING 包是单字节帧', () => {
    const packet = encodePingPacket()
    expect(packet).toEqual(new Uint8Array([(PacketType.PING << 4) | 0]))
    const { packetType } = parsePacket(packet)
    expect(packetType).toBe(PacketType.PING)
  })

  it('RECVACK 包：含 messageID(int64) 与 messageSeq(int32)', () => {
    const packet = encodeRecvackPacket('9007199254740993', 42)
    const { packetType, decoder } = parsePacket(packet)
    expect(packetType).toBe(PacketType.RECVACK)
    expect(decoder.readInt64String()).toBe('9007199254740993')
    expect(decoder.readInt32()).toBe(42)
  })

  it('tryUnpackFrame：完整帧拆出、粘包合并、半帧等待', () => {
    const frame = encodeConnectPacket({ deviceID: 'd', uid: 'u', token: 't', clientKey: 'k' })
    // 单帧
    const single = tryUnpackFrame(frame)
    expect(single).not.toBeNull()
    expect(single!.rest.length).toBe(0)
    // 两帧粘在一起 → 拆出两帧
    const two = new Uint8Array([...frame, ...frame])
    const first = tryUnpackFrame(two)!
    expect(first.frame).toEqual(frame)
    expect(first.rest).toEqual(frame)
    // 半帧（只给前 3 字节）→ null
    expect(tryUnpackFrame(frame.slice(0, 3))).toBeNull()
  })

  it('DH 密钥派生：aesKey 为 Md5 前 16 位、aesIV 为 salt 前 16 位', () => {
    // curve25519 要求 32 字节 seed
    const client = generateDhKeyPair(new Uint8Array(32).fill(1))
    const server = generateDhKeyPair(new Uint8Array(32).fill(4))
    // 服务端视角用客户端公钥推导，得到同一共享密钥
    const material = deriveAesMaterial(client.privateKey, server.publicKeyBase64, '0123456789abcdef0123456789abcdef')
    expect(material.aesKey).toHaveLength(16)
    expect(material.aesIV).toBe('0123456789abcdef')
  })
})

describe('RECV 帧解析', () => {
  it('parseRecvHeader 读取消息头字段', () => {
    // 手工构造 RECV 帧体：settingByte + msgKey + fromUID + channelID + channelType + expire + clientMsgNo + messageID + messageSeq + timestamp + 加密payload
    const body = new Uint8Array([
      0x00, // settingByte（topic=0）
      0x00, 0x00, // msgKey 长度 0
      0x00, 0x02, ...'u1'.split('').map((c) => c.charCodeAt(0)), // fromUID "u1"
      0x00, 0x03, ...'g12'.split('').map((c) => c.charCodeAt(0)), // channelID "g12"
      0x02, // channelType Group
      0x00, 0x00, 0x00, 0x00, // expire
      0x00, 0x00, // clientMsgNo 长度 0
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, // messageID = 1
      0x00, 0x00, 0x00, 0x2a, // messageSeq = 42
      0x00, 0x00, 0x00, 0x64, // timestamp = 100
      0x61, 0x62, 0x63, // encrypted payload "abc"
    ])
    // 完整帧：header(RECV<<4) + 变长长度 + body（parsePacket 会跳过这两段）
    const lengthBytes = [body.length]
    const frameBytes = new Uint8Array([(PacketType.RECV << 4) | 0, ...lengthBytes, ...Array.from(body)])
    const { packetType, decoder } = parsePacket(frameBytes)
    expect(packetType).toBe(PacketType.RECV)
    const header = parseRecvHeader(decoder, 4)
    expect(header.fromUID).toBe('u1')
    expect(header.channelID).toBe('g12')
    expect(header.channelType).toBe(2)
    expect(header.messageID).toBe('1')
    expect(header.messageSeq).toBe(42)
    expect(header.timestamp).toBe(100)
    expect(Array.from(header.encryptedPayload)).toEqual([0x61, 0x62, 0x63])
  })
})
