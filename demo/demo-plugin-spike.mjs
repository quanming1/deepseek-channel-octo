/**
 * C4 M1 Spike — in-process ctx.agents + heartbeat coexistence proof.
 * ============================================================
 * Goal: prove the pure-plugin architecture is viable BEFORE the rebuild:
 *   1. ctx.agents.create + followup + whenIdle (one full agent turn) runs
 *      inside a dsh plugin (in-process, no SDK client / JSON-RPC).
 *   2. ctx.agents.resume continues the same session (in-process).
 *   3. A heartbeat timer (simulating the Octo WS keepalive) keeps ticking
 *      while the agent is running — i.e. a long-lived WS connection can
 *      coexist with agent execution in the same dsh process.
 *
 * Run: node demo/demo-plugin-spike.mjs
 * Prereq: project node_modules installed (pnpm install done); DeepSeek API key
 *         available (~/.dsh/.credentials.yaml, dsh credential system reads it).
 *
 * Note: first run creates a temp profile and runs pnpm install (1-3 min, needs network).
 *       Real API calls consume a little token.
 * ============================================================
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROFILE = 'spike-plugin-demo'
const PROFILE_ROOT = join(homedir(), '.dsh', 'profiles', PROFILE)
// dsh session archive root (sessions grouped by cwd)
const DSH_SESSIONS = join(homedir(), '.dsh', 'sessions')
const SID = 'spike-session-1'
const log = (msg) => console.log(msg)

/** Delete a sessionId's disk archive (spike must start from a clean state). */
function cleanSession(id) {
  if (!existsSync(DSH_SESSIONS)) return
  for (const cwdDir of readdirSync(DSH_SESSIONS, { withFileTypes: true })) {
    const p = join(DSH_SESSIONS, cwdDir.name)
    if (!cwdDir.isDirectory()) continue
    if (existsSync(join(p, id))) rmSync(join(p, id), { recursive: true, force: true })
  }
}

/** Minimal spike plugin: heartbeat timer + create/resume one turn each. */
const PLUGIN_CODE = `
/**
 * spike-runner — C4 M1 spike plugin.
 * Runs inside the dsh process: starts a heartbeat timer (simulating Octo WS
 * keepalive), then drives agents.create → followup → whenIdle → summarize,
 * then agents.resume → followup → whenIdle → summarize. Records the heartbeat
 * tick count at each milestone to prove the timer kept running during agent
 * execution (no event-loop blocking).
 */
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'spike-runner'
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Collect last assistant text + turn result (same as official headless). */
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
  if (!agents || !defaultModel || !sessions) return

  const selection = defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: void 0 })
  }

  const sessionId = 'spike-session-1'
  const tick = { count: 0 }
  // Heartbeat every 500ms — simulates the Octo WS keepalive (60s in production).
  const heart = setInterval(() => { tick.count++ }, 500)

  const t0 = Date.now()
  const mark = (label) => {
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    io.stdout.write(\`[spike] \${label} @\${secs}s heartbeatTicks=\${tick.count}\\n\`)
  }

  // 1. create + teach a secret word (no flush between turns — flush may
  //    alter the session lifecycle and break a second in-process followup)
  const { agent } = await agents.create({
    sessionId: SessionId(sessionId),
    meta: { cwd: process.cwd() },
    agentOptions,
    setup,
  })
  mark('created')
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: '记住一个词：翡翠。只回复：记住了' }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  const r1 = summarize(agent.session.events, firstSeq)
  mark('turn1-done')

  // 2. in-process continuation: same live agent, ask the secret word again.
  //    (Cross-process resume is NOT exercised here: a live session cannot be
  //    resumed in-process — \`cannot prepare session while it is live\`; that is
  //    expected. Cross-process resume was proven by demo/demo-resume.mjs.)
  const firstSeq2 = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: '刚才让你记的词是什么？' }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  const r2 = summarize(agent.session.events, firstSeq2)
  mark('turn2-done')

  clearInterval(heart)
  io.stdout.write(\`[spike] turn1=\${JSON.stringify(r1.text)} turn2=\${JSON.stringify(r2.text)}\\n\`)
  const pass =
    r1.reason?.kind === 'completed' && r1.text.includes('记住了') &&
    r2.reason?.kind === 'completed' && r2.text.includes('翡翠')
  io.stdout.write(
    pass
      ? '[spike] PASS: in-process agents.create + continuation OK; heartbeat kept ticking during agent runs\\n'
      : '[spike] FAIL: check output above\\n',
  )
  io.exit(pass ? 0 : 1)
}

export function apply(ctx) {
  const exit = ctx.get('appExit')
  if (exit === void 0) throw new Error('spike-runner: launcher must provide ctx.appExit')
  run(ctx, { stdout: process.stdout, stderr: process.stderr, exit }).catch((error) => {
    process.stderr.write('spike: ' + (error instanceof Error ? error.message : String(error)) + '\\n')
    exit(1)
  })
}
`

/** Generate the temp profile (plugin bundle + profile manifest), idempotent. */
function ensureProfile() {
  const pluginRoot = join(PROFILE_ROOT, 'plugins', 'spike-runner')
  const files = {
    [join(pluginRoot, 'index.js')]: PLUGIN_CODE,
    [join(pluginRoot, 'package.json')]: JSON.stringify(
      {
        name: 'spike-runner',
        version: '0.0.0',
        private: true,
        type: 'module',
        main: 'index.js',
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
    [join(pluginRoot, 'cordis.patch.yml')]: '- insert:\n' + "    - id: spike-runner\n      name: 'spike-runner'\n",
    [join(PROFILE_ROOT, 'package.json')]: JSON.stringify(
      {
        name: 'dsh-profile-spike-plugin-demo',
        private: true,
        dependencies: {
          '@deepseek-ai/dsh-base': '0.1.0-rc.6',
          'spike-runner': 'file:./plugins/spike-runner',
        },
        dsh: {
          profile: { bundles: ['@deepseek-ai/dsh-base', 'spike-runner'] },
        },
      },
      null,
      2,
    ),
    [join(PROFILE_ROOT, 'cordis.yml')]: '[]\n',
    [join(PROFILE_ROOT, 'cordis.patch.yml')]: '[]\n',
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
  if (!existsSync(join(PROFILE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-base'))) {
    log('[spike] first run: pnpm install temp profile deps (1-3 min)...')
    // Windows: pnpm is a .cmd — must wrap via cmd.exe /c (PITFALLS 5.2)
    const isWin = process.platform === 'win32'
    const r = spawnSync(
      isWin ? process.env.ComSpec ?? 'cmd.exe' : 'pnpm',
      isWin ? ['/c', 'pnpm', 'install'] : ['install'],
      { cwd: PROFILE_ROOT, stdio: 'inherit', encoding: 'utf8' },
    )
    if (!existsSync(join(PROFILE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-base'))) {
      throw new Error(`pnpm install failed (exit ${String(r.status)}), check network and retry`)
    }
  }
}

log('C4 M1 Spike — in-process ctx.agents + heartbeat coexistence')
log('working dir =', HERE)
log('API key = ~/.dsh/.credentials.yaml (dsh credential system)')

try {
  cleanSession(SID)
  ensureProfile()
  const args = ['--profile', PROFILE]
  const cmd = process.platform === 'win32' ? ['/c', 'dsh', ...args] : ['dsh', ...args]
  const r = spawnSync(process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'dsh', cmd, {
    cwd: HERE,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  log(`\n[spike] dsh exit code = ${r.status}`)
  process.exitCode = r.status ?? 1
} catch (error) {
  log('[spike] aborted:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
