/**
 * Octo 通道配置加载（C3/FR1）：octo.config.yaml → DaemonConfig；无文件回退环境变量。
 *
 * 配置形态（文件与环境变量都归一为 DaemonConfig）：
 * - 文件：默认 ./octo.config.yaml（OCTO_CONFIG 覆盖路径），支持多 bot（bots 列表）
 * - 环境变量：OCTO_API_URL/OCTO_BOT_TOKEN/OCTO_BOT_UID 单 bot 回退（C2 兼容）
 *
 * 设计：解析/校验集中在本模块，daemon 装配只面向 DaemonConfig，
 * 不知道配置来源是文件还是环境变量。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 OctoConfig.xxx 访问
export * as OctoConfig from './octo-config.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { Errors } from '../agent/errors.js'

/** 默认配置文件路径（相对当前工作目录） */
export const DEFAULT_CONFIG_FILE = 'octo.config.yaml'

/** 单个 bot 配置 */
export interface BotConfig {
  /** 可选：显示名（仅日志） */
  name?: string
  /** bot id（Octo 平台创建时给出；也是 @bot 判定依据） */
  botUid: string
  /** bot token（bf_ 前缀；register 换 WS 凭据用） */
  botToken: string
  /** 可选：账号标识（会话 key 前缀 `octo:<accountId>:<chatId>`；默认 botUid） */
  accountId?: string
  /** 可选：群白名单（只处理这些群的 @bot） */
  allowedGroups?: string[]
}

/** daemon 配置（文件与环境变量统一形态） */
export interface DaemonConfig {
  /** Octo API 地址（如 https://im.deepminer.com.cn/api） */
  apiUrl: string
  /** 可选：WS 地址（显式配置 > 服务端 register 返回 > 由 apiUrl 推导） */
  wsUrl?: string
  /** 可选：dsh 模型名（缺省由 runtime 决定） */
  model?: string
  /** bot 列表（≥1） */
  bots: BotConfig[]
}

/** 配置文件路径决策：OCTO_CONFIG 指定 > 默认路径存在 > 无（回退环境变量） */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string | undefined {
  const explicit = env.OCTO_CONFIG?.trim()
  if (explicit) return resolve(cwd, explicit)
  const defaultPath = resolve(cwd, DEFAULT_CONFIG_FILE)
  return existsSync(defaultPath) ? defaultPath : undefined
}

/** 读取并解析配置文件 → DaemonConfig（缺失/非法字段抛 CliError） */
export function loadConfigFromFile(path: string): DaemonConfig {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    throw new Errors.CliError(`Octo 配置文件不存在：${path}`)
  }
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    throw new Errors.CliError(
      `Octo 配置文件 YAML 解析失败（${path}）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const obj = (raw ?? {}) as Record<string, unknown>
  return normalizeConfig(obj, path)
}

/** 环境变量回退（C2 兼容）：OCTO_API_URL/OCTO_BOT_TOKEN/OCTO_BOT_UID 单 bot */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const apiUrl = env.OCTO_API_URL?.trim()
  const botToken = env.OCTO_BOT_TOKEN?.trim()
  const botUid = env.OCTO_BOT_UID?.trim()
  if (!apiUrl || !botToken || !botUid) {
    throw new Errors.CliError(
      '缺少 Octo 配置：请设置环境变量 OCTO_API_URL / OCTO_BOT_TOKEN / OCTO_BOT_UID（或提供 octo.config.yaml）',
    )
  }
  return {
    apiUrl,
    wsUrl: env.OCTO_WS_URL?.trim() || undefined,
    model: env.DSH_MODEL?.trim() || undefined,
    bots: [
      {
        botUid,
        botToken,
        accountId: env.OCTO_ACCOUNT_ID?.trim() || undefined,
        allowedGroups: env.OCTO_ALLOWED_GROUPS
          ? env.OCTO_ALLOWED_GROUPS.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      },
    ],
  }
}

/** 顶层决策：配置文件（OCTO_CONFIG 或默认路径）→ 文件；否则环境变量回退 */
export function loadDaemonConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): DaemonConfig {
  const path = resolveConfigPath(env, cwd)
  return path ? loadConfigFromFile(path) : loadConfigFromEnv(env)
}

/** 统一校验：apiUrl 必填、bots 非空、每个 bot 的 uid/token 必填 */
function normalizeConfig(raw: Record<string, unknown>, source: string): DaemonConfig {
  const apiUrl = stringField(raw.apiUrl, 'apiUrl', source)
  const botsRaw = raw.bots
  if (!Array.isArray(botsRaw) || botsRaw.length === 0) {
    throw new Errors.CliError(`Octo 配置文件（${source}）缺少 bots 列表（至少配置一个 bot）`)
  }
  const bots = botsRaw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Errors.CliError(`Octo 配置文件（${source}）bots[${index}] 必须是对象`)
    }
    const bot = entry as Record<string, unknown>
    const botUid = stringField(bot.botUid, `bots[${index}].botUid`, source)
    const botToken = stringField(bot.botToken, `bots[${index}].botToken`, source)
    return {
      name: optionalString(bot.name),
      botUid,
      botToken,
      accountId: optionalString(bot.accountId),
      allowedGroups: optionalStringList(bot.allowedGroups, `bots[${index}].allowedGroups`, source),
    }
  })
  return {
    apiUrl,
    wsUrl: optionalString(raw.wsUrl),
    model: optionalString(raw.model),
    bots,
  }
}

/** 必填字符串字段：缺失/空/非字符串 → 抛错 */
function stringField(value: unknown, field: string, source: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Errors.CliError(`Octo 配置文件（${source}）字段 ${field} 必填`)
  }
  return value.trim()
}

/** 可选字符串字段 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** 可选字符串数组（逗号/数组两种写法都收） */
function optionalStringList(value: unknown, field: string, source: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    return items.length > 0 ? items : undefined
  }
  if (typeof value === 'string') {
    const items = value.split(',').map((s) => s.trim()).filter(Boolean)
    return items.length > 0 ? items : undefined
  }
  throw new Errors.CliError(`Octo 配置文件（${source}）字段 ${field} 必须是数组或逗号分隔字符串`)
}
