/**
 * CLI 入口：dsh-octo-bot 命令定义（commander）。
 *
 * B1 阶段只有一个子命令 send：向本地 dsh 发送一条消息并流式接收回答。
 */
import { Command } from 'commander'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DshClient, Errors, SdkProfile } from './agent/index.js'
import { DshCompat } from './config/index.js'

/** 构建 CLI 程序（供 bin 调用与测试复用） */
export function buildProgram(): Command {
  const program = new Command()

  program
    .name('dsh-octo-bot')
    .description('DeepSeek Harness 桥接工具：向本地 dsh 发送消息并接收回答')
    .version('0.1.0')

  program
    .command('send')
    .description('向 dsh 发送一条消息并流式接收回答')
    .argument('<prompt>', '要发送给 dsh 的消息内容')
    .option('-m, --model <model>', '模型名（默认由 dsh 决定）')
    .option('--session <sessionId>', '续跑指定会话（不传则新建会话）')
    .action(async (prompt: string, opts: { model?: string; session?: string }) => {
      try {
        await runSend(prompt, opts.model, opts.session)
      } catch (error) {
        // 已知业务错误：打印信息后非零退出；未知错误冒泡为通用失败
        if (Errors.isKnownError(error)) {
          console.error(`[错误] ${error.message}`)
          process.exitCode = 1
          return
        }
        throw error
      }
    })

  program
    .command('octo')
    .description('Octo 通道 daemon')
    .command('run')
    .description('启动 Octo 桥接 daemon（环境变量 OCTO_API_URL/OCTO_BOT_TOKEN/OCTO_BOT_UID）')
    .action(async () => {
      try {
        const { RunOcto } = await import('./bridge/index.js')
        const config = RunOcto.loadOctoConfig()
        await RunOcto.runOctoDaemon(config)
      } catch (error) {
        // 与 send 相同的错误分支：已知错误打印后非零退出
        if (Errors.isKnownError(error)) {
          console.error(`[错误] ${error.message}`)
          process.exitCode = 1
          return
        }
        throw error
      }
    })

  return program
}

/** 检查 DeepSeek API key 是否可用：环境变量 或 dsh 凭据文件（~/.dsh/.credentials.yaml）任一存在 */
function apiKeyAvailable(): boolean {
  if (process.env.DEEPSEEK_API_KEY) return true
  try {
    const credFile = join(homedir(), '.dsh', '.credentials.yaml')
    if (!existsSync(credFile)) return false
    const content = readFileSync(credFile, 'utf-8')
    // 提取 DEEPSEEK_API_KEY 的值（非空白 token），非空即可用
    const value = /DEEPSEEK_API_KEY:\s*(\S+)/.exec(content)?.[1] ?? ''
    return value.length > 0
  } catch {
    return false
  }
}

/** send 子命令执行体：失败时抛结构化错误（CliError / DshError），由 action 统一处理 */
export async function runSend(prompt: string, model?: string, sessionId?: string): Promise<void> {
  // 1. 检查环境：dsh 是否可用
  const dshBin = SdkProfile.resolveDshBin()
  if (!dshBin) {
    throw new Errors.CliError('未找到 dsh CLI。请先安装：npm install -g @deepseek-ai/dsh@0.1.0-rc.6')
  }

  // 2. 检查凭据：环境变量 或 dsh 凭据文件（dsh 的 credentials 服务优先读凭据文件）
  if (!apiKeyAvailable()) {
    throw new Errors.CliError('缺少 DeepSeek API key。两种方式任选：\n       ① 环境变量：set DEEPSEEK_API_KEY=sk-xxx\n       ② dsh 凭据文件：写入 ~/.dsh/.credentials.yaml 的 DEEPSEEK_API_KEY')
  }

  // 3. 确保 SDK profile 就绪（首次会自动生成 + pnpm install）
  await SdkProfile.ensureSdkProfile()

  // 4. 启动 harness + 握手（DshError 由 action 统一处理）
  const cwd = process.cwd()
  const harness = await DshClient.createHarness(dshBin, cwd, model)

  // 5. 发送消息，流式输出
  try {
    const result = await DshClient.sendPrompt(harness, prompt, {
      // 回答正文输出到 stdout；思考增量以灰色风格输出到 stderr（不污染正文）
      onText: (delta) => process.stdout.write(delta),
      onThinking: (delta) => process.stderr.write(`\u001b[2m${delta}\u001b[0m`),
    }, sessionId)
    process.stdout.write('\n')
    console.log(`\n[dsh-octo-bot] session=${result.sessionId} 兼容验证日期=${DshCompat.VERIFIED_AT}`)
  } finally {
    // 6. 关闭 harness（回收子进程）
    await harness.close()
  }
}
