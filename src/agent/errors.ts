/**
 * 结构化业务错误（TS-STYLE-GUIDE §8）。
 *
 * 为什么用带 tag 的 Error 子类：错误是类型的组成部分——可序列化、可匹配、
 * 可跨进程传输。调用方用 isInstance 收窄按 tag 分支处理，未知错误冒泡。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 Errors.DshError 访问
export * as Errors from './errors.js'

/** dsh 运行时错误：握手失败、轮次失败、依赖安装失败等 */
export class DshError extends Error {
  readonly tag = 'DshError' as const

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DshError'
    // 保留底层错误链（异步边界包装时必传 cause）
    if (cause !== undefined) this.cause = cause
  }

  static isInstance(error: unknown): error is DshError {
    return typeof error === 'object' && error !== null && (error as { tag?: string }).tag === 'DshError'
  }
}

/** CLI 使用错误：缺 dsh、缺凭据、参数错误等（提示用户如何修复） */
export class CliError extends Error {
  readonly tag = 'CliError' as const

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'CliError'
    if (cause !== undefined) this.cause = cause
  }

  static isInstance(error: unknown): error is CliError {
    return typeof error === 'object' && error !== null && (error as { tag?: string }).tag === 'CliError'
  }
}

/** 本模块错误联合：调用方按 tag 分支处理 */
export type Error = DshError | CliError
