/**
 * dsh 版本兼容性单一事实来源（anti-drift 基线）。
 *
 * 为什么单独成文件：dsh 处于 developer preview、几乎每日发版且有破坏性变更，
 * 所有 @deepseek-ai/* 依赖必须精确锁定（不用 ^）。本文件是唯一事实来源，
 * 测试会断言它与 package.json 一致（防漂移）。
 *
 * 升级流程：见 docs/PROCESS.md 变更路径——改这里 → 同步 package.json → 全量回归 → 更新 verifiedAt。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 DshCompat.xxx 访问，不必记忆扁平导出名
export * as DshCompat from './dsh-compat.js'

/** 锁定的 DeepSeek Harness CLI 版本（全局安装 / npx 用） */
export const DSH_CLI_VERSION = '0.1.0-rc.6'

/** 锁定的 SDK 客户端版本（必须与 package.json dependencies 一致，单测断言） */
export const SDK_CLIENT_VERSION = '0.1.0-rc.6'

/** SDK profile 名称（~/.dsh/profiles/<此值>） */
export const SDK_PROFILE = 'octo-sdk'

/** 自研 octo-sdk-server 插件的部署版本（升级 profile 结构时递增，触发幂等重建） */
export const SERVER_PLUGIN_VERSION = '2'

/** 最后真实验证日期（升级后更新） */
export const VERIFIED_AT = '2026-08-14'
