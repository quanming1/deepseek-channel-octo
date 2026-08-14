/**
 * CLI 入口：dsh-octo-bot 命令定义（commander）。
 *
 * B1 阶段只有一个子命令 send：向本地 dsh 发送一条消息并流式接收回答。
 */
import { Command } from 'commander'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHarness, sendPrompt } from './agent/dsh-client.js'
import { ensureSdkProfile, resolveDshBin } from './agent/sdk-profile.js'
import { VERIFIED_AT } from './config/dsh-compat.js'
import { CliError, DshError } from './agent/errors.js'

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
    .action(async (prompt: string, opts: { model?: string }) => {
      try {
        await runSend(prompt, opts.model)
      } catch (error) {
        // 按结构化错误 tag 分支显示；未知错误冒泡为通用失败
        if (CliError.isInstance(error)) {
          console.error(`[错误] ${error.message}`)
          process.exitCode = 1
          return
        }
        if (DshError.isInstance(error)) {
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
    // 提取 DEEPSEEK_API_KEY 的值，非空即可用
    const match = /DEEPSEEK_API_KEY:\s*(.+)/.exec(content)
    return match !== null && match[1]!.trim().length > 0
  } catch {
    return false
  }
}

/** send 子命令执行体：失败时抛结构化错误（CliError / DshError），由 action 统一处理 */
export async function runSend(prompt: string, model?: string): Promise<number> {
  // 1. 检查环境：dsh 是否可用
  const dshBin = resolveDshBin()
  if (!dshBin) {
    throw new CliError('未找到 dsh CLI。请先安装：npm install -g @deepseek-ai/dsh@0.1.0-rc.6')
  }

  // 2. 检查凭据：环境变量 或 dsh 凭据文件（dsh 的 credentials 服务优先读凭据文件）
  if (!apiKeyAvailable()) {
    throw new CliError('缺少 DeepSeek API key。两种方式任选：\n       ① 环境变量：set DEEPSEEK_API_KEY=sk-xxx\n       ② dsh 凭据文件：写入 ~/.dsh/.credentials.yaml 的 DEEPSEEK_API_KEY')
  }

  // 3. 确保 SDK profile 就绪（首次会自动生成 + pnpm install）
  await ensureSdkProfile()

  // 4. 启动 harness + 握手（DshError 由 action 统一处理）
  const cwd = process.cwd()
  const harness = await createHarness(dshBin, cwd, model)

  // 5. 发送消息，流式输出
  try {
    // 思考增量以灰色风格输出到 stderr（不污染 stdout 的回答正文）
    const result = await sendPrompt(harness, prompt, (delta) => {
      process.stderr.write(`\u001b[2m${delta}\u001b[0m`)
    })
    process.stdout.write('\n')
    console.log(`\n[dsh-octo-bot] session=${result.sessionId} 兼容验证日期=${VERIFIED_AT}`)
    return 0
  } finally {
    // 6. 关闭 harness（回收子进程）
    await harness.close()
  }
}
