/**
 * SDK profile 管理：确保 dsh 的 JSON-RPC runtime profile 存在并可启动。
 *
 * 原理：dsh 的 SDK 路线 = 启动一个带 `dsh-sdk-jsonrpc-server` 插件的 profile，
 * dsh 子进程以 JSON-RPC 服务模式运行，stdout 专门承载协议帧。
 * 本模块负责生成 profile 文件（package.json + cordis.patch.yml）并执行 pnpm install。
 *
 * 目录：$DSH_HOME/profiles/<SDK_PROFILE>（DSH_HOME 默认 ~/.dsh，可用环境变量覆盖）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { SDK_PROFILE, SDK_SERVER_VERSION } from '../config/dsh-compat.js'

/** SDK profile 根目录（$DSH_HOME/profiles/<SDK_PROFILE>） */
export function sdkProfileRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', SDK_PROFILE)
}

/** profile 的 package.json：声明 sdk server 依赖 + dsh-base bundle */
function packageJsonFor(): string {
  return `${JSON.stringify(
    {
      name: `dsh-profile-${SDK_PROFILE}`,
      private: true,
      dependencies: {
        '@deepseek-ai/dsh-sdk-jsonrpc-server': SDK_SERVER_VERSION,
      },
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-base'],
        },
      },
    },
    null,
    2,
  )}\n`
}

/**
 * profile 的 patch 层：插入 sdk-jsonrpc-server 插件；禁用交互提问与 HMR。
 * 为什么禁用：CLI 无人值守场景，交互式提问无人应答（默认拒绝更安全）；
 * HMR 与协议模式冲突且 stdout 是协议帧通道，任何额外日志都会污染。
 */
function patchYamlFor(): string {
  return [
    '# deepseek-channel-octo SDK JSON-RPC runtime overlay (managed by dsh-octo-bot).',
    '# stdout 保留给 JSON-RPC 帧；不得加载任何往 stdout 打日志的插件。',
    '- insert:',
    '    - id: sdk-jsonrpc-server',
    "      name: '@deepseek-ai/dsh-sdk-jsonrpc-server'",
    '      config:',
    '        maxTokensAsSuccess: true',
    '',
    '# 无人值守：交互式用户提问不可用，默认拒绝',
    '- id: user-questions',
    '  disabled: true',
    '',
    '- id: hmr',
    '  disabled: true',
    '',
  ].join('\n')
}

/** profile 是否完整（package.json + patch + 依赖已安装） */
export function isProfileReady(profileRoot: string): boolean {
  return (
    existsSync(join(profileRoot, 'package.json')) &&
    existsSync(join(profileRoot, 'cordis.patch.yml')) &&
    existsSync(join(profileRoot, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server'))
  )
}

/**
 * 确保 profile 就绪：缺失时生成文件并执行 pnpm install。
 * @returns 就绪后的 profile 根目录
 */
export async function ensureSdkProfile(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const root = sdkProfileRoot(env)
  if (isProfileReady(root)) return root

  // 生成 profile 文件（幂等：已存在则不覆盖）
  mkdirSync(root, { recursive: true })
  if (!existsSync(join(root, 'package.json'))) {
    await writeFile(join(root, 'package.json'), packageJsonFor(), 'utf-8')
  }
  if (!existsSync(join(root, 'cordis.patch.yml'))) {
    await writeFile(join(root, 'cordis.patch.yml'), patchYamlFor(), 'utf-8')
  }

  // 安装依赖（pnpm；失败时给出明确错误）
  const result = spawnSync('pnpm', ['install'], { cwd: root, stdio: 'inherit', encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`SDK profile 依赖安装失败（${root}），请检查 pnpm 与网络`)
  }
  return root
}

/** 在 PATH 中解析 dsh 可执行文件路径 */
export function resolveDshBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pathEntries = (env.PATH ?? '').split(';')
  for (const dir of pathEntries) {
    if (!dir) continue
    for (const name of ['dsh', 'dsh.cmd', 'dsh.exe']) {
      const candidate = resolve(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}
