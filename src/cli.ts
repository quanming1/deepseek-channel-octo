/**
 * CLI 入口：dsh-octo-bot 命令定义（commander）。
 *
 * B1 阶段只有一个子命令 send：向本地 dsh 发送一条消息并流式接收回答。
 */
import { Command } from 'commander'
import { createHarness, sendPrompt } from './agent/dsh-client.js'
import { ensureSdkProfile, resolveDshBin } from './agent/sdk-profile.js'
import { VERIFIED_AT } from './config/dsh-compat.js'

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
      await runSend(prompt, opts.model)
    })

  return program
}

/** send 子命令执行体 */
export async function runSend(prompt: string, model?: string): Promise<number> {
  // 1. 检查环境：dsh 是否可用
  const dshBin = resolveDshBin()
  if (!dshBin) {
    console.error('[错误] 未找到 dsh CLI。请先安装：npm install -g @deepseek-ai/dsh@0.1.0-rc.6')
    return 1
  }

  // 2. 检查凭据：DEEPSEEK_API_KEY 必须存在（provider deepseek-official 读取）
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('[错误] 缺少 DEEPSEEK_API_KEY 环境变量（dsh 的 deepseek-official provider 需要）')
    return 1
  }

  // 3. 确保 SDK profile 就绪（首次会自动生成 + pnpm install）
  try {
    await ensureSdkProfile()
  } catch (error) {
    console.error(`[错误] SDK profile 准备失败：${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  // 4. 启动 harness + 握手
  const cwd = process.cwd()
  let harness: Awaited<ReturnType<typeof createHarness>> | undefined
  try {
    harness = await createHarness(dshBin, cwd, model)
  } catch (error) {
    console.error(`[错误] dsh 握手失败：${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  // 5. 发送消息，流式输出
  try {
    // 思考增量以灰色风格输出到 stderr（不污染 stdout 的回答正文）
    const result = await sendPrompt(harness, prompt, (delta) => {
      process.stderr.write(`\u001b[2m${delta}\u001b[0m`)
    })
    process.stdout.write('\n')
    if (!result.finalResponse && !result.ok) {
      console.error('[错误] dsh 未返回回答')
      return 1
    }
    console.log(`\n[dsh-octo-bot] session=${result.sessionId} 兼容验证日期=${VERIFIED_AT}`)
    return 0
  } catch (error) {
    console.error(`\n[错误] 消息发送失败：${error instanceof Error ? error.message : String(error)}`)
    return 1
  } finally {
    // 6. 关闭 harness（回收子进程）
    await harness.close()
  }
}
