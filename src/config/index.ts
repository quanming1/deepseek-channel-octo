/**
 * config 模块目录聚合（TS-STYLE-GUIDE §3.2）：透传各模块命名空间。
 * 消费者从本入口统一引用：`import { DshCompat, OctoConfig } from "./config/index.js"`。
 */
export * as DshCompat from './dsh-compat.js'
export * as OctoConfig from './octo-config.js'
