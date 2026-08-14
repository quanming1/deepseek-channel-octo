/**
 * 结构化业务错误（TS-STYLE-GUIDE §8）。
 *
 * 为什么用带 tag 的 Error 子类：错误是类型的组成部分——可序列化、可匹配、
 * 可跨进程传输。调用方用 isInstance 收窄按 tag 分支处理，未知错误冒泡。
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 Errors.DshError 访问
export * as Errors from './errors.js'

/**
 * 带 tag 的错误基类：统一 cause 链保留与 tag 匹配逻辑。
 * 子类只需声明唯一 tag/name 并转发构造；为什么抽基类——多个错误类共享同一套
 * cause 处理与 tag 判别，未来新增错误类（如 C 阶段 ChannelError）只声明差异。
 */
abstract class TaggedError extends Error {
  abstract readonly tag: string

  constructor(message: string, cause?: unknown) {
    super(message)
    // 保留底层错误链（异步边界包装时必传 cause）
    if (cause !== undefined) this.cause = cause
  }

  /** 按 tag 匹配错误实例（供子类 isInstance 复用；未知错误匹配 false） */
  protected static matches(error: unknown, tag: string): boolean {
    return typeof error === 'object' && error !== null && (error as { tag?: string }).tag === tag
  }
}

/** dsh 运行时错误：握手失败、轮次失败、依赖安装失败等 */
export class DshError extends TaggedError {
  readonly tag = 'DshError' as const

  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'DshError'
  }

  static isInstance(error: unknown): error is DshError {
    return TaggedError.matches(error, 'DshError')
  }
}

/** CLI 使用错误：缺 dsh、缺凭据、参数错误等（提示用户如何修复） */
export class CliError extends TaggedError {
  readonly tag = 'CliError' as const

  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'CliError'
  }

  static isInstance(error: unknown): error is CliError {
    return TaggedError.matches(error, 'CliError')
  }
}

/** 本模块错误联合：调用方按 tag 分支处理 */
export type Error = DshError | CliError

/** 已知业务错误统一判别：CLI 据此按已知错误处理（打印信息后非零退出），未知错误冒泡 */
export function isKnownError(error: unknown): error is Error {
  return DshError.isInstance(error) || CliError.isInstance(error)
}
