/**
 * agent 模块目录聚合（TS-STYLE-GUIDE §3.2）：透传各模块命名空间。
 * 消费者从本入口统一引用：`import { Errors, SdkProfile, DshClient } from "./agent/index.js"`。
 */
export * as Errors from './errors.js'
export * as SdkProfile from './sdk-profile.js'
export * as DshClient from './dsh-client.js'
