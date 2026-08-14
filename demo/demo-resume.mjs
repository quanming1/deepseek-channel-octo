/**
 * dsh 跨进程会话恢复验证 DEMO
 * ============================================================
 * 目的：回答"dsh 的 session 在进程退出/电脑重启后，还能不能记住上下文？"
 *
 * 结论预览（两个场景对照）：
 *   场景 A：SDK 路线（dsh-sdk-client，即 dsh-octo-bot 所用）
 *           → 跨进程续跑失败，报 id collision（SDK 协议未暴露恢复能力）
 *   场景 B：dsh 核心 resume（ctx.agents.resume）
 *           → 跨进程恢复成功，模型记住上下文（官方能力，SDK 未透传）
 *
 * 运行方式：node demo/demo-resume.mjs
 * 前置条件：项目 node_modules 已安装（pnpm install 过）；本机可访问 DeepSeek API
 *           （~/.dsh/.credentials.yaml 有有效 key，dsh 凭据系统读取）
 *
 * 注意：场景 B 首次运行会创建临时 profile 并 pnpm install（约 1-3 分钟，需网络）。
 *       涉及真实 API 调用，消耗少量 token。
 * ============================================================
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

// 本脚本所在目录（demo/）——场景 B 的 dsh 子进程将以此为工作目录，
// 两次运行 cwd 一致，满足 dsh resume 的 cwd 匹配校验。
const HERE = dirname(fileURLToPath(import.meta.url))
// dsh 全局会话存档根目录（session 按 cwd 分组落盘）
const DSH_SESSIONS = join(homedir(), '.dsh', 'sessions')
// 场景 B 的临时 profile 名（dsh 加载：dsh --profile resume-demo）
const PROFILE = 'resume-demo'
const PROFILE_ROOT = join(homedir(), '.dsh', 'profiles', PROFILE)
// 两个场景各自用的固定 sessionId（可改成任何字符串，dsh 不做格式校验）
const SID_A = 'demo-a-session123'
const SID_B = 'demo-b-session122332'

const log = (msg) => console.log(msg)

/** 删除某个 sessionId 的磁盘存档（保证每次 DEMO 从干净状态开始） */
function cleanSession(id) {
  if (!existsSync(DSH_SESSIONS)) return
  for (const cwdDir of readdirSync(DSH_SESSIONS, { withFileTypes: true })) {
    const p = join(DSH_SESSIONS, cwdDir.name)
    if (!cwdDir.isDirectory()) continue
    if (existsSync(join(p, id))) rmSync(join(p, id), { recursive: true, force: true })
  }
}

/** 启动一个全新 dsh 子进程（等价于"一次新的 send / 进程重启"） */
function launchHarness() {
  const isWin = process.platform === 'win32'
  return new DeepSeekHarness({
    launch: {
      // Windows 上 dsh 是 .cmd 脚本，需经 cmd.exe /c 包装才能 spawn
      command: isWin ? process.env.ComSpec ?? 'cmd.exe' : 'dsh',
      args: isWin ? ['/c', 'dsh', '--profile', 'octo-sdk'] : ['--profile', 'octo-sdk'],
      cwd: HERE,
    },
    cwd: HERE,
    provider: 'deepseek-official',
  })
}

/** 从通知流里抓取轮次错误（SDK 的失败不抛异常，藏在 turn/end 事件里） */
function collectTurnErrors() {
  const errors = []
  const onNotification = (n) => {
    if (n.method !== 'session.event') return
    const ev = n.params.event
    if (ev?.type === 'turn/end' && ev.data?.reason?.kind === 'error') {
      errors.push(ev.data.reason.error?.message ?? '(未知错误)')
    }
  }
  return { errors, onNotification }
}

// ============================================================
// 场景 A：SDK 路线跨进程续跑（预期失败：id collision）
// ============================================================
async function scenarioA() {
  log('\n========== 场景 A：SDK 路线（dsh-sdk-client）跨进程续跑 ==========')
  cleanSession(SID_A)

  // 第一次 run（进程 1）：让模型记住一个秘密词
  const h1 = launchHarness()
  await h1.start()
  const r1 = await h1.run('记住一个秘密词：紫罗兰。回复只需两个字：记住了。', { sessionId: SID_A })
  log(`[进程1] sessionId=${r1.sessionId} 回答=${JSON.stringify(r1.finalResponse)}`)
  await h1.close() // 进程 1 结束（等价于电脑重启前最后一次 send）

  // 第二次 run（进程 2，全新 dsh 子进程）：用同一个 sessionId 追问
  const h2 = launchHarness()
  await h2.start()
  const { errors, onNotification } = collectTurnErrors()
  const r2 = await h2.run('秘密词是什么？', { sessionId: SID_A, onNotification })
  await h2.close()
  log(`[进程2] sessionId=${r2.sessionId} 回答=${JSON.stringify(r2.finalResponse)}`)
  log(`[进程2] 捕获到的错误=${JSON.stringify(errors)}`)

  if (errors.length > 0) {
    log('结论 A：SDK 路线跨进程恢复【失败】——id collision（SDK 协议没有暴露 resume 能力，符合预期）')
  } else if (r2.finalResponse.includes('紫罗兰')) {
    log('结论 A：意外，SDK 路线跨进程恢复【成功】了？')
  } else {
    log('结论 A：SDK 路线跨进程恢复【失败】——空回答')
  }
  cleanSession(SID_A)
}

// ============================================================
// 场景 B：dsh 核心 resume（ctx.agents.resume）跨进程恢复
// ============================================================

/** 最小 resume runner 插件源码（装进临时 profile 的 bundle） */
const PLUGIN_CODE = `
/**
 * resume-demo-runner —— 最小会话恢复验证插件。
 * 与官方 headless-runner 的唯一差异：headless 每次硬编码新建随机 session，
 * 本插件从环境变量读 sessionId，并在磁盘有存档时走 agents.resume 恢复路径。
 * 参考：dsh-host-apiproxy 的 ensureSession（create/resume 双分支）。
 */
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'resume-demo-runner'
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'sessionPersistence']

/** 汇总最后一次 assistant 文本与轮次结果（抄官方 headless） */
function summarize(events, firstSeq) {
  let started = false
  let text = ''
  let reason
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') { started = true; continue }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter((b) => b.type === 'text').map((b) => b.text).join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

async function run(ctx, io) {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  if (!agents || !defaultModel || !sessions) return

  const task = process.env.RESUME_DEMO_TASK
  const sessionId = process.env.RESUME_DEMO_SESSION_ID
  if (!task) { io.stderr.write('[resume-demo] 缺少环境变量 RESUME_DEMO_TASK\\n'); io.exit(2); return }
  if (!sessionId) { io.stderr.write('[resume-demo] 缺少环境变量 RESUME_DEMO_SESSION_ID\\n'); io.exit(2); return }

  const selection = defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: void 0 })
  }

  // 判断磁盘是否已有该 session 的存档（决定 create 还是 resume）
  const stored = persistence
    ? (await persistence.list()).find((h) => h.id === sessionId)
    : void 0

  let agent
  if (stored !== void 0) {
    // 存档命中 → 跨进程恢复路径（这就是官方支持恢复的机制）
    io.stderr.write('[resume-demo] 磁盘命中存档 → agents.resume(' + sessionId + ')\\n')
    ;({ agent } = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup }))
  } else {
    // 无存档 → 新建 session
    io.stderr.write('[resume-demo] 无存档 → agents.create(' + sessionId + ')\\n')
    ;({ agent } = await agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
    }))
  }

  // 发送任务并等待回合结束（与官方 headless 相同的驱动方式）
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  await sessions.flush(agent.session)

  const outcome = summarize(agent.session.events, firstSeq)
  io.stdout.write(outcome.text + '\\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write('dsh: ' + outcome.reason.error.code + ': ' + outcome.reason.error.message + '\\n')
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

export function apply(ctx) {
  const exit = ctx.get('appExit')
  if (exit === void 0) throw new Error('resume-demo-runner: 启动器必须提供 ctx.appExit')
  run(ctx, { stdout: process.stdout, stderr: process.stderr, exit }).catch((error) => {
    process.stderr.write('resume-demo: ' + (error instanceof Error ? error.message : String(error)) + '\\n')
    exit(1)
  })
}
`

/** 生成临时 profile（插件 bundle + profile 清单），幂等 */
function ensureProfile() {
  const pluginRoot = join(PROFILE_ROOT, 'plugins', 'resume-demo-runner')
  const files = {
    [join(pluginRoot, 'index.js')]: PLUGIN_CODE,
    [join(pluginRoot, 'package.json')]: JSON.stringify(
      {
        name: 'resume-demo-runner',
        version: '0.0.0',
        private: true,
        type: 'module',
        main: 'index.js',
        // dsh.bundle 声明：profile bundle 必须有（dsh-app-boot 加载校验）
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        dependencies: {
          '@deepseek-ai/cordis': '^4.0.1',
          '@deepseek-ai/dsh-agent': '^0.1.0-rc.6',
          '@deepseek-ai/dsh-llm': '^0.1.0-rc.6',
          '@deepseek-ai/dsh-session': '^0.1.0-rc.6',
        },
      },
      null,
      2,
    ),
    [join(pluginRoot, 'cordis.patch.yml')]: '- insert:\n' + "    - id: resume-demo-runner\n      name: 'resume-demo-runner'\n",
    [join(PROFILE_ROOT, 'package.json')]: JSON.stringify(
      {
        name: 'dsh-profile-resume-demo',
        private: true,
        dependencies: {
          '@deepseek-ai/dsh-base': '0.1.0-rc.6',
          'resume-demo-runner': 'file:./plugins/resume-demo-runner',
        },
        dsh: {
          profile: { bundles: ['@deepseek-ai/dsh-base', 'resume-demo-runner'] },
        },
      },
      null,
      2,
    ),
    [join(PROFILE_ROOT, 'cordis.yml')]: '[]\n',
    [join(PROFILE_ROOT, 'cordis.patch.yml')]: '[]\n',
    // 放行原生依赖的构建脚本，否则 pnpm 以 ERR_PNPM_IGNORED_BUILDS 拒绝完成（见 docs/PITFALLS.md 3.1）
    [join(PROFILE_ROOT, 'pnpm-workspace.yaml')]: [
      'onlyBuiltDependencies:',
      "  - '@deepseek-ai/dsh-subprocess-local'",
      "  - '@google/genai'",
      '  - koffi',
      '  - node-pty',
      '  - protobufjs',
      '',
    ].join('\n'),
  }
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(p), { recursive: true })
    if (!existsSync(p)) writeFileSync(p, content, 'utf8')
  }
  // 依赖已安装则跳过（幂等）；pnpm 在 ignored-builds 场景会返回非 0 但实际已完成安装，
  // 所以成功判定以"dsh-base 装上没有"为准，而不是退出码
  if (!existsSync(join(PROFILE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-base'))) {
    log('[场景B] 首次运行：pnpm install 临时 profile 依赖（约 1-3 分钟）...')
    const r = spawnSync('pnpm', ['install'], { cwd: PROFILE_ROOT, stdio: 'inherit', encoding: 'utf8' })
    if (!existsSync(join(PROFILE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-base'))) {
      throw new Error(`pnpm install 失败（exit ${String(r.status)}），请检查网络后重跑`)
    }
  }
}

/** 调用 dsh CLI（独立进程），返回 { stdout, stderr, status } */
function runDsh(task) {
  const env = { ...process.env, RESUME_DEMO_TASK: task, RESUME_DEMO_SESSION_ID: SID_B }
  const args = ['--profile', PROFILE, task]
  // Windows 的 dsh 是 .cmd，需要 cmd.exe 包装
  const cmd = process.platform === 'win32' ? ['/c', 'dsh', ...args] : ['dsh', ...args]
  return spawnSync(process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'dsh', cmd, {
    cwd: HERE,
    env,
    encoding: 'utf8',
  })
}

async function scenarioB() {
  log('\n========== 场景 B：dsh 核心 resume（agents.resume）跨进程恢复 ==========')
  cleanSession(SID_B)
  ensureProfile()

  // 第一次调用（进程 1）：create 新 session，记住秘密词
  log('[进程1] dsh --profile resume-demo "记住：紫罗兰..."（create 分支）')
  const r1 = runDsh('记住一个秘密词：绿翡翠。回复只需两个字：记住了。')
  log(`[进程1] 退出码=${r1.status}`)
  log(`[进程1] stdout=${JSON.stringify(r1.stdout.trim())}`)
  if (r1.status !== 0) log(`[进程1] stderr=${JSON.stringify(r1.stderr.trim())}`)

  // 第二次调用（进程 2，全新 dsh 进程）：resume 恢复，追问秘密词
  log('\n[进程2] dsh --profile resume-demo "秘密词是什么？"（resume 分支）')
  const r2 = runDsh('秘密词是什么？')
  log(`[进程2] 退出码=${r2.status}`)
  log(`[进程2] stdout=${JSON.stringify(r2.stdout.trim())}`)
  if (r2.status !== 0) log(`[进程2] stderr=${JSON.stringify(r2.stderr.trim())}`)

  const answer = r2.stdout ?? ''
  if (r2.status === 0 && answer.includes('绿翡翠')) {
    log('\n结论 B：dsh 核心 resume 跨进程恢复【成功】——第二个进程记住了第一个进程教它的秘密词')
  } else {
    log('\n结论 B：resume 未恢复出预期答案，请检查上方 stderr 输出')
  }
}

// ============================================================
// 主流程
// ============================================================
log('dsh 跨进程会话恢复验证 DEMO')
log('工作目录 =', HERE)
log('API key 来源 = ~/.dsh/.credentials.yaml（dsh 凭据系统）')

try {
  await scenarioA()
  // await scenarioB()
  log('\n========== DEMO 结束 ==========')
} catch (error) {
  log('\nDEMO 异常终止：', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
