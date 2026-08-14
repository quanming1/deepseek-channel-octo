/**
 * Octo 通道 daemon 启动（C2/FR4）：配置加载 → agent/adapter/WS 装配 → 常驻 → 优雅退出。
 *
 * 形态：常驻进程（复用 C1 的 octo-sdk profile 与 SdkDshAdapter），
 * SIGINT/SIGTERM 触发优雅退出（adapter.dispose 回收 dsh 子进程 + WS 断开）。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 RunOcto.xxx 访问
export * as RunOcto from './run-octo.js'
import { SdkDshAdapter } from '../adapters/dsh/sdk-adapter.js'
import { SdkProfile } from '../agent/sdk-profile.js'
import { OctoChannelBridge } from './octo-channel.js'
import { OctoApi } from './octo/index.js'
import { Errors } from '../agent/errors.js'

/** daemon 配置（来自环境变量，见 loadOctoConfig） */
export interface OctoDaemonConfig {
  apiUrl: string
  botToken: string
  botUid: string
  /** 可选：群白名单（逗号分隔） */
  allowedGroups?: string[]
  /** 账号标识（默认取 botUid） */
  accountId?: string
  /** WS 地址（默认由 apiUrl 推导 ws(s)://<host>/ws） */
  wsUrl?: string
  /** dsh 模型（默认由 runtime 决定） */
  model?: string
}

/** 从环境变量加载配置（缺失必填项抛 CliError；值统一 trim 防 cmd 尾随空格污染） */
export function loadOctoConfig(env: NodeJS.ProcessEnv = process.env): OctoDaemonConfig {
  const apiUrl = env.OCTO_API_URL?.trim()
  const botToken = env.OCTO_BOT_TOKEN?.trim()
  const botUid = env.OCTO_BOT_UID?.trim()
  if (!apiUrl || !botToken || !botUid) {
    throw new Errors.CliError(
      '缺少 Octo 配置：请设置环境变量 OCTO_API_URL / OCTO_BOT_TOKEN / OCTO_BOT_UID',
    )
  }
  return {
    apiUrl,
    botToken,
    botUid,
    accountId: env.OCTO_ACCOUNT_ID?.trim() || botUid,
    allowedGroups: env.OCTO_ALLOWED_GROUPS
      ? env.OCTO_ALLOWED_GROUPS.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    wsUrl: env.OCTO_WS_URL?.trim() || undefined,
    model: env.DSH_MODEL?.trim() || undefined,
  }
}

/** 由 apiUrl 推导 WuKongIM WS 地址：http(s)://host → ws(s)://host/ws */
export function deriveWsUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, '')
  if (base.startsWith('https://')) return base.replace('https://', 'wss://') + '/ws'
  if (base.startsWith('http://')) return base.replace('http://', 'ws://') + '/ws'
  return base + '/ws'
}

/** WS 地址优先级：显式配置（OCTO_WS_URL）> 服务端 register 返回的 ws_url > 由 apiUrl 推导 */
export function resolveWsUrl(
  configWsUrl: string | undefined,
  serverWsUrl: string | undefined,
  apiUrl: string,
): string {
  return configWsUrl ?? serverWsUrl ?? deriveWsUrl(apiUrl)
}

/** 启动 daemon；resolve 时表示已正常退出（信号触发） */
export async function runOctoDaemon(config: OctoDaemonConfig): Promise<void> {
  // 1. 环境：dsh 可用 + SDK profile 就绪（复用 C1 资产）
  const dshBin = SdkProfile.resolveDshBin()
  if (!dshBin) {
    throw new Errors.CliError('未找到 dsh CLI。请先安装：npm install -g @deepseek-ai/dsh@0.1.0-rc.6')
  }
  await SdkProfile.ensureSdkProfile()

  // 2. bot 上线：register 换取 WS 认证凭据（bf_ token 不能直接做 WS 握手）
  const credentials = await OctoApi.registerBot({
    apiUrl: config.apiUrl,
    botToken: config.botToken,
    agentPlatform: 'dsh',
  })
  if (config.botUid !== credentials.robot_id) {
    throw new Errors.CliError(
      `OCTO_BOT_UID 与注册返回的 robot_id 不一致：${config.botUid} ≠ ${credentials.robot_id}`,
    )
  }
  const wsUrl = resolveWsUrl(config.wsUrl, credentials.ws_url, config.apiUrl)

  // 3. 装配 adapter（harness 按 cwd 常驻；model 缺省由 dsh runtime 决定）
  const launch = SdkProfile.dshLaunchSpec(dshBin)
  const adapter = new SdkDshAdapter({
    launch,
    provider: 'deepseek-official',
    model: config.model,
  })

  // 4. 装配 Octo bridge（WS 接入 + 消息 → agent）
  const bridge = new OctoChannelBridge({
    accountId: config.accountId ?? credentials.robot_id,
    botUid: credentials.robot_id,
    allowedGroups: config.allowedGroups,
    cwd: process.cwd(),
    adapter,
    apiUrl: config.apiUrl,
    botToken: credentials.im_token,
    wsUrl,
  })

  console.log(`[octo] 启动 daemon：api=${config.apiUrl} bot=${credentials.robot_id} ws=${wsUrl}`)
  bridge.start()

  // 5. 常驻：信号触发优雅退出
  await new Promise<void>((resolve) => {
    let stopped = false
    const shutdown = (): void => {
      if (stopped) return
      stopped = true
      console.log('[octo] 收到退出信号，优雅关闭...')
      bridge.stop()
      void adapter.dispose().finally(() => resolve())
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}
