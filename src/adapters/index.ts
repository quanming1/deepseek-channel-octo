/**
 * adapters 模块目录聚合（TS-STYLE-GUIDE §3.2）：透传各模块命名空间。
 * 消费者从本入口统一引用：`import { Types, DshAdapter } from "./adapters/index.js"`。
 */
export * as Types from './types.js'
export * as DshAdapter from './dsh/sdk-adapter.js'
export * as DshResumeServer from './dsh/server/index.js'
