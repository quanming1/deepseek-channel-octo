/**
 * Octo 通道 daemon 启动（C2/FR4 + C3/FR2）：配置加载 → 多 bot 装配 → 常驻 → 优雅退出。
 *
 * 形态：常驻进程（复用 C1 的 octo-sdk profile 与 SdkDshAdapter）。
 * C3 起支持多 bot：每个 bot 独立 register + 独立 WS 连接（OctoChannelBridge 实例），
 * **共享同一个 SdkDshAdapter**（harness 按 cwd 缓存）；会话 key `octo:<accountId>:<chatId>`
 * 按 accountId 隔离。配置来源见 src/config/octo-config.ts（文件优先，环境变量回退）。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 RunOcto.xxx 访问
export * as RunOcto from './run-octo.js'
import { SdkDshAdapter } from '../adapters/dsh/sdk-adapter.js'
import { SdkProfile } from '../agent/sdk-profile.js'
import { OctoChannelBridge } from './octo-channel.js'
import { OctoApi } from './octo/index.js'
import { Errors } from '../agent/errors.js'
import type { AgentAdapter } from '../adapters/types.js'
import type { BotConfig, DaemonConfig } from '../config/octo-config.js'

export type { DaemonConfig } from '../config/octo-config.js'

/** 由 apiUrl 推导 WuKongIM WS 地址：http(s)://host → ws(s)://host/ws */
export function deriveWsUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, '')
  if (base.startsWith('https://')) return base.replace('https://', 'wss://') + '/ws'
  if (base.startsWith('http://')) return base.replace('http://', 'ws://') + '/ws'
  return base + '/ws'
}

/** WS 地址优先级：显式配置 > 服务端 register 返回的 ws_url > 由 apiUrl 推导 */
export function resolveWsUrl(
  configWsUrl: string | undefined,
  serverWsUrl: string | undefined,
  apiUrl: string,
): string {
  return configWsUrl ?? serverWsUrl ?? deriveWsUrl(apiUrl)
}

/** 单个 bot 装配的依赖（可注入测试替身） */
export interface BotBridgeDeps {
  apiUrl: string
  /** 可选：显式 WS 地址（优先级最高） */
  wsUrl?: string
  /** dsh adapter（多 bot 共享同一实例） */
  adapter: AgentAdapter
  /** 工作目录（dsh 会话 cwd） */
  cwd: string
  /** 可注入 register（默认 OctoApi.registerBot） */
  registerImpl?: (params: { apiUrl: string; botToken: string }) => Promise<OctoApi.RegisterBotResult>
  /** 可注入 bridge 工厂（默认 new OctoChannelBridge） */
  bridgeFactory?: (opts: ConstructorParameters<typeof OctoChannelBridge>[0]) => OctoChannelBridge
}

/**
 * 单个 bot 装配：register 换 WS 凭据 → 校验 robot_id → 构建 OctoChannelBridge。
 * 抽成独立函数便于单测（register 注入 mock、bridge 工厂注入 fake）。
 */
export async function createBotBridge(bot: BotConfig, deps: BotBridgeDeps): Promise<OctoChannelBridge> {
  const register = deps.registerImpl ?? ((params) => OctoApi.registerBot({ ...params, agentPlatform: 'dsh' }))
  const credentials = await register({ apiUrl: deps.apiUrl, botToken: bot.botToken })
  if (bot.botUid !== credentials.robot_id) {
    throw new Errors.CliError(
      `botUid 与注册返回的 robot_id 不一致：${bot.botUid} ≠ ${credentials.robot_id}`,
    )
  }
  const wsUrl = resolveWsUrl(deps.wsUrl, credentials.ws_url, deps.apiUrl)
  const factory = deps.bridgeFactory ?? ((opts) => new OctoChannelBridge(opts))
  const bridge = factory({
    accountId: bot.accountId ?? credentials.robot_id,
    botUid: credentials.robot_id,
    allowedGroups: bot.allowedGroups,
    cwd: deps.cwd,
    adapter: deps.adapter,
    apiUrl: deps.apiUrl,
    botToken: credentials.im_token,
    wsUrl,
  })
  console.log(`[octo] 装配 bot：${bot.name ?? credentials.robot_id}（uid=${credentials.robot_id} ws=${wsUrl}）`)
  return bridge
}

/** 启动 daemon；resolve 时表示已正常退出（信号触发） */
export async function runOctoDaemon(config: DaemonConfig): Promise<void> {
  // 1. 环境：dsh 可用 + SDK profile 就绪（复用 C1 资产）
  const dshBin = SdkProfile.resolveDshBin()
  if (!dshBin) {
    throw new Errors.CliError('未找到 dsh CLI。请先安装：npm install -g @deepseek-ai/dsh@0.1.0-rc.6')
  }
  await SdkProfile.ensureSdkProfile()

  // 2. 装配共享 adapter（harness 按 cwd 常驻；model 缺省由 dsh runtime 决定）
  const launch = SdkProfile.dshLaunchSpec(dshBin)
  const adapter = new SdkDshAdapter({
    launch,
    provider: 'deepseek-official',
    model: config.model,
  })

  // 3. 每个 bot 独立装配（register + WS 连接），共享同一 adapter
  const cwd = process.cwd()
  const bridges = await Promise.all(
    config.bots.map((bot) =>
      createBotBridge(bot, { apiUrl: config.apiUrl, wsUrl: config.wsUrl, adapter, cwd }),
    ),
  )
  console.log(`[octo] 启动 daemon：api=${config.apiUrl} bots=${bridges.length}`)
  bridges.forEach((bridge) => bridge.start())

  // 4. 常驻：信号触发优雅退出（全部 bot 断开 + adapter 回收）
  await new Promise<void>((resolve) => {
    let stopped = false
    const shutdown = (): void => {
      if (stopped) return
      stopped = true
      console.log('[octo] 收到退出信号，优雅关闭...')
      bridges.forEach((bridge) => bridge.stop())
      void adapter.dispose().finally(() => resolve())
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}
