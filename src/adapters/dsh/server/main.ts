/**
 * 自研 SDK JSON-RPC server 插件（C1/FR3）：带跨进程 resume 双分支。
 *
 * 为什么自研：官方 @deepseek-ai/dsh-sdk-jsonrpc-server 的 getOrCreateSession 只有
 * create 路径——新进程复用旧 sessionId 必报 id collision（dsh-sdk-protocol 无
 * resumeSessionId 字段，client 永远触发不了 resume）。而 dsh 核心有完整恢复链路
 * （dsh-host-apiproxy 的 ensureSession 双分支：磁盘存档命中 → ctx.agents.resume）。
 * 本插件以官方 server 为对照移植全部协议方法，仅把会话创建改为双分支——
 * SDK client 零改动即可跨进程续跑（可行性已由 demo/demo-resume.mjs 场景 B 实证）。
 *
 * 部署形态：tsup 打包为 dist/octo-sdk-server.js，由 sdk-profile.ts 拷贝进
 * octo-sdk profile 的 plugins/ 目录，以 file: 依赖 + bundle 形式加载。
 *
 * 注意：本文件是 Cordis 插件部署入口（与 src/index.ts 同类），遵循框架约定
 * 只导出 name/inject/Config/apply（named exports，无默认导出），不加 Self-Export。
 */
import Schema from '@deepseek-ai/schemastery'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { resolve } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import type { Context } from '@deepseek-ai/cordis'

// ============================================================
// 局部类型窄化：dsh 核心服务的声明合并只存在于 dsh-base 运行时里，
// 主包 typecheck 看不到（devDeps 没有全家桶）。这里按需声明用到的方法面，
// 运行时由 profile 内的 dsh-base 插件提供真实实现。
// ============================================================

/** 会话句柄：agents.create / agents.resume 的返回（对齐官方 server 的 rec.handle 用法） */
interface SessionHandle {
  agent: AgentLike
  dispose?: () => Promise<void>
}

/** agent 的最小表面（prompt 路径只用到 followup） */
interface AgentLike {
  session: { id: unknown }
  followup(message: unknown): unknown
}

/** ctx.agents 的最小表面（含官方协议未暴露的 resume） */
interface AgentsService {
  create(options: {
    sessionId: ReturnType<typeof SessionId>
    meta: { cwd: string }
    agentOptions: AgentOptions
  }): Promise<SessionHandle>
  resume(options: {
    resumeSessionId: string
    agentOptions: AgentOptions
    setup?: (agentCtx: Context) => void
  }): Promise<SessionHandle>
  get(agentId: unknown): AgentLike | undefined
}

/** sessionPersistence 的最小表面（双分支判据） */
interface SessionPersistenceService {
  list(): Promise<Array<{ id: string; cwd: string }>>
}

/** llm 注册表的最小表面（initialize 判 provider 可用性） */
interface LlmService {
  listProviders(): Array<{ id: string }>
}

/** 本插件视角的 ctx（cordis Context + 窄化服务） */
type PluginContext = Context & {
  agents: AgentsService
  on(event: string, listener: (...args: never[]) => void): () => void
  get(service: 'sessionPersistence'): SessionPersistenceService | undefined
  get(service: 'llm'): LlmService | undefined
}

/** JSON-RPC 传输的最小表面 */
interface TransportLike {
  notify(method: string, payload: unknown): void
  onRequest(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>): void
  start(): void
  close(): void
  flush(): Promise<void>
}

/** agent 轮次选项（create 与 resume 共用） */
interface AgentOptions {
  provider: string
  model: string
  maxTokens?: number
}

/** subagent/end 事件的负载形状（通知转发用，按需子集） */
interface SubagentEndInfo {
  provider: string
  id: unknown
  local: boolean
  stopReason: string
  lastAssistantMessage?: unknown
}

/** 把轮次结果映射为 subagent.finished 的 status（对齐官方语义） */
function successStatus(reason: string, options: { maxTokensAsSuccess: boolean }): string {
  if (reason === 'completed') return 'ok'
  return reason === 'max-tokens' && options.maxTokensAsSuccess ? 'ok' : 'error'
}

/** 从服务作用域恢复 subagent 的父会话（官方同款手法） */
function subagentParentOf(carrier: unknown): { session: { id: unknown } } {
  return carrierKeyOf(carrier as never) as { session: { id: unknown } }
}

/**
 * 带双分支的 SDK server：协议面与官方 HarnessSdkJsonRpcServer 完全兼容。
 * 唯一差异在 createSession——先查磁盘存档，命中且 cwd 匹配走 agents.resume。
 */
export class ResumeSdkJsonRpcServer {
  private readonly ctx: PluginContext
  private readonly transport: TransportLike
  private readonly options: { maxTokensAsSuccess: boolean }
  private cwd = process.cwd()
  private provider = 'deepseek-official'
  private model = 'deepseek-official'
  private maxTokens: number | undefined
  private llmFiber: { dispose?: () => Promise<void> } | undefined
  private readonly sessions = new Map<string, { handle: SessionHandle }>()
  private readonly sessionCreations = new Map<string, Promise<{ handle: SessionHandle }>>()
  private readonly disposers: Array<() => void> = []
  private shutdownTask: Promise<Record<string, never>> | undefined
  private shuttingDown = false

  constructor(
    ctx: Context,
    transport: TransportLike,
    options: { maxTokensAsSuccess?: boolean } = {},
  ) {
    this.ctx = ctx as PluginContext
    this.transport = transport
    this.options = { maxTokensAsSuccess: options.maxTokensAsSuccess ?? false }
    const serverOptions = this.options

    // 会话事件 → session.event 通知（流式 token 的来源）
    this.disposers.push(
      this.ctx.on('session/event', ((session: { id: unknown }, event: unknown) => {
        this.transport.notify('session.event', { sessionId: String(session.id), event })
      }) as never),
    )
    // agent 状态 → session.status 通知
    this.disposers.push(
      this.ctx.on('agent/status', ((payload: { agent: AgentLike; status: unknown }) => {
        this.transport.notify('session.status', {
          sessionId: String(payload.agent.session.id),
          status: payload.status,
        })
      }) as never),
    )
    // subagent 会话创建 → subagent.started 通知
    this.disposers.push(
      this.ctx.on('session/created', ((session: { id: unknown; header: { parentSession?: unknown } }) => {
        const parentSession = session.header.parentSession
        if (parentSession === undefined) return
        this.transport.notify('subagent.started', {
          parentSessionId: String(parentSession),
          childSessionId: String(session.id),
        })
      }) as never),
    )
    // subagent 结束 → subagent.finished 通知
    this.disposers.push(
      this.ctx.on('subagent/end', (function (this: unknown, info: SubagentEndInfo) {
        const parent = subagentParentOf(this)
        if (!info.local) return
        transport.notify('subagent.finished', {
          provider: info.provider,
          agentId: String(info.id),
          parentSessionId: String(parent.session.id),
          childSessionId: String(info.id),
          status: successStatus(info.stopReason, serverOptions),
          stopReason: info.stopReason,
          ...(info.lastAssistantMessage === undefined ? {} : { lastAssistantMessage: info.lastAssistantMessage }),
        })
      }) as never),
    )
  }

  /** SDK 握手：路由配置（cwd/provider/model）。provider 无注册且非官方时挂 DeepSeek 兜底（官方同款）。 */
  async initialize(params: {
    cwd: string
    provider: string
    model: string
    maxTokens?: number
  }): Promise<{ serverInfo: { name: string; version: string } }> {
    if (params.maxTokens !== undefined && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    this.cwd = resolve(params.cwd)
    this.provider = params.provider
    this.model = params.model
    this.maxTokens = params.maxTokens
    if (!this.hasAdapterFor(this.provider)) {
      if (this.provider !== 'deepseek-official') {
        throw new Error(`no adapter registered for provider "${this.provider}"`)
      }
      this.llmFiber = (await (this.ctx as unknown as Context).plugin(LlmDeepSeek as never, {} as never)) as {
        dispose?: () => Promise<void>
      }
    }
    return { serverInfo: { name: 'deepseek-harness-sdk-runtime-octo', version: '0.0.1' } }
  }

  /** 发送一条 prompt 到目标会话（不等待回合完成——完成经 session.event 通知观察）。 */
  async prompt(params: { sessionId: string; contentBlocks: unknown[] }): Promise<{ messageId: unknown }> {
    const rec = await this.getOrCreateSession(params.sessionId)
    if (this.ctx.agents.get((rec.handle.agent as { id?: unknown }).id ?? rec.handle.agent.session.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${params.sessionId}`)
    }
    const message = createUserMessage({
      content: params.contentBlocks as Parameters<typeof createUserMessage>[0]['content'],
      source: { kind: 'user' },
    })
    rec.handle.agent.followup(message)
    return { messageId: (message as { id: unknown }).id }
  }

  /** 关闭：释放 server 持有的 agent、订阅与兜底 adapter（幂等）。 */
  shutdown(): Promise<Record<string, never>> {
    this.shutdownTask ??= this.performShutdown()
    return this.shutdownTask
  }

  private async performShutdown(): Promise<Record<string, never>> {
    this.shuttingDown = true
    const pendingCreations = [...this.sessionCreations.values()]
    await Promise.allSettled(pendingCreations)
    this.sessionCreations.clear()
    const records = [...this.sessions.values()]
    this.sessions.clear()
    const failures: unknown[] = []
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardownResults = await Promise.allSettled([
      ...records.map((rec) => Promise.resolve().then(() => rec.handle.dispose?.())),
      ...(this.llmFiber === undefined
        ? []
        : [Promise.resolve().then(() => this.llmFiber?.dispose?.())]),
    ])
    this.llmFiber = undefined
    failures.push(...teardownResults.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'SDK server teardown failed')
    return {}
  }

  /** JSON-RPC 方法分发（与官方完全一致的三方法面）。 */
  async handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params as never)
      case 'session/prompt':
        return this.prompt(params as never)
      case 'shutdown':
        return this.shutdown()
      default:
        throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`)
    }
  }

  /** 会话获取：内存缓存 → 并发去重 → 双分支创建。 */
  async getOrCreateSession(sessionId: string): Promise<{ handle: SessionHandle }> {
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const pending = this.sessionCreations.get(sessionId)
    if (pending) return pending
    const creation = this.createSession(sessionId)
    this.sessionCreations.set(sessionId, creation)
    creation.then(
      () => {
        this.sessionCreations.delete(sessionId)
      },
      () => {
        this.sessionCreations.delete(sessionId)
      },
    )
    return creation
  }

  /**
   * 双分支会话创建（本插件的核心增量）：
   *   磁盘存档命中且 cwd 匹配 → agents.resume（跨进程恢复上下文）
   *   未命中 / 无持久化服务   → agents.create（官方行为）
   * resume 失败（存档损坏、版本不符等）显式抛错——绝不静默降级为空回答。
   */
  async createSession(sessionId: string): Promise<{ handle: SessionHandle }> {
    const agentOptions: AgentOptions = {
      provider: this.provider,
      model: this.model,
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
    }

    const persistence = this.ctx.get('sessionPersistence')
    const stored = persistence === undefined ? undefined : (await persistence.list()).find((h) => h.id === sessionId)

    if (stored !== undefined) {
      if (stored.cwd !== this.cwd) {
        throw new Error(
          `session "${sessionId}" is persisted at a different cwd (persisted: ${stored.cwd}, requested: ${this.cwd}); ` +
            'cross-workspace resume is rejected to protect context integrity (id collision)',
        )
      }
      const handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions })
      const rec = { handle }
      this.sessions.set(sessionId, rec)
      return rec
    }

    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: this.cwd },
      agentOptions,
    })
    const rec = { handle }
    this.sessions.set(sessionId, rec)
    return rec
  }

  private hasAdapterFor(provider: string): boolean {
    return this.ctx.get('llm')?.listProviders().some((entry) => entry.id === provider) ?? false
  }
}

/** 插件名（profile patch 以此 id 引用） */
export const name = 'octo-sdk-server'

/** 依赖 agents 服务（会话注册表） */
export const inject = ['agents']

/** 插件配置：maxTokens 轮次是否按成功对待（对齐官方 server） */
export const Config = Schema.object({ maxTokensAsSuccess: Schema.boolean().default(false) })

/**
 * 挂载插件：stdio JSON-RPC 传输 + 请求分发 + 优雅退出。
 * stdout 保留给协议帧（加载树不得有 stdout logger——与官方一致的约束）。
 */
export function apply(ctx: Context, config: { maxTokensAsSuccess?: boolean }): void {
  const resolvedConfig = config
  const rootFiber = (ctx as Context).root.fiber
  const input = process.stdin
  const output = process.stdout
  const exit = (code: number): void => {
    process.exit(code)
  }

  const transport = new JsonRpcLineTransport(input, output)
  const server = new ResumeSdkJsonRpcServer(ctx, transport as unknown as TransportLike, {
    maxTokensAsSuccess: resolvedConfig.maxTokensAsSuccess,
  })

  let exitTask: Promise<void> | undefined
  const disposeAndExit = (): void => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())])
      exit(0)
    })()
  }

  transport.onRequest(async (method: string, params: Record<string, unknown>) => {
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') {
      setImmediate(() => {
        disposeAndExit()
      })
    }
    return result
  })

  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve')
}
