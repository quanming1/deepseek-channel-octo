/**
 * SDK profile 管理：确保 dsh 的 JSON-RPC runtime profile 存在并可启动。
 *
 * 原理：dsh 的 SDK 路线 = 启动一个带 SDK server 插件的 profile，
 * dsh 子进程以 JSON-RPC 服务模式运行，stdout 专门承载协议帧。
 * C1 起改挂自研 octo-sdk-server（带跨进程 resume 双分支，见 server/main.ts），
 * 替代官方 dsh-sdk-jsonrpc-server 的 create-only 行为。
 *
 * 本模块负责生成 profile 文件（package.json + cordis.patch.yml + pnpm-workspace.yaml）、
 * 拷贝插件 bundle（dist → profile）、并执行 pnpm install。
 * 幂等重建：SERVER_PLUGIN_VERSION 变化时强制刷新全部生成物（兼容旧环境升级）。
 *
 * 目录：$DSH_HOME/profiles/<SDK_PROFILE>（DSH_HOME 默认 ~/.dsh，可用环境变量覆盖）
 */

// Self-Export 命名空间（TS-STYLE-GUIDE §3）：消费者用 SdkProfile.xxx 访问
export * as SdkProfile from './sdk-profile.js'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVER_PLUGIN_VERSION, SDK_PROFILE } from '../config/dsh-compat.js'
import { Errors } from './errors.js'

/** SDK profile 根目录（$DSH_HOME/profiles/<SDK_PROFILE>） */
export function sdkProfileRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', SDK_PROFILE)
}

/** 主包 dist 目录（构建产物 octo-sdk-server.js 所在地；源码运行时回退 src 编译路径不存在则报错） */
function distDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/** profile 的 package.json：dsh-base bundle + 自研 server 插件（file: 链接） */
function packageJsonFor(): string {
  return `${JSON.stringify(
    {
      name: `dsh-profile-${SDK_PROFILE}`,
      private: true,
      dependencies: {
        '@deepseek-ai/dsh-base': '0.1.0-rc.6',
        'octo-sdk-server': 'file:./plugins/octo-sdk-server',
      },
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-base', 'octo-sdk-server'],
        },
      },
    },
    null,
    2,
  )}\n`
}

/**
 * 插件的 package.json：运行时依赖与 dsh-base 同版本线（pnpm 会与 dsh-base 的树去重共享）。
 * dsh.bundle 声明是 dsh-app-boot 的硬校验——缺失直接拒绝加载 profile。
 */
function pluginPackageJsonFor(): string {
  return `${JSON.stringify(
    {
      name: 'octo-sdk-server',
      version: `0.1.0-rc.6+server.${SERVER_PLUGIN_VERSION}`,
      private: true,
      type: 'module',
      main: 'main.js',
      dsh: {
        bundle: {
          patch: './cordis.patch.yml',
        },
      },
      dependencies: {
        '@deepseek-ai/schemastery': '^3.18.1',
        '@deepseek-ai/dsh-sdk-protocol': '0.1.0-rc.6',
        '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
        '@deepseek-ai/dsh-llm-deepseek': '0.1.0-rc.6',
        '@deepseek-ai/dsh-scope': '0.1.0-rc.6',
        '@deepseek-ai/dsh-session': '0.1.0-rc.6',
        '@deepseek-ai/cordis': '^4.0.1',
      },
    },
    null,
    2,
  )}\n`
}

/**
 * 插件的 patch 层：insert 自研 server（替代官方 sdk-jsonrpc-server 的 insert）。
 * stdout 保留给 JSON-RPC 帧；不得加载任何往 stdout 打日志的插件。
 */
function pluginPatchYamlFor(): string {
  return [
    `# octo-sdk-server bundle（自研，v${SERVER_PLUGIN_VERSION}）：JSON-RPC server + resume 双分支`,
    '- insert:',
    "    - id: octo-sdk-server",
    "      name: 'octo-sdk-server'",
    '      config:',
    '        maxTokensAsSuccess: true',
    '',
  ].join('\n')
}

/**
 * profile 的 patch 层：无人值守约束 + llm-deepseek 官方端点强制。
 * 头部版本标记用于幂等重建判定（isProfileReady 检查）。
 */
function patchYamlFor(): string {
  return [
    `# deepseek-channel-octo SDK JSON-RPC runtime overlay (managed by dsh-octo-bot, server v${SERVER_PLUGIN_VERSION}).`,
    '# stdout 保留给 JSON-RPC 帧；不得加载任何往 stdout 打日志的插件。',
    '',
    '# 覆盖 llm-deepseek：强制官方端点（用户全局 settings 可能指向第三方代理，',
    '# 导致认证失败）；apiKeyEnv 指向 dsh 凭据系统（credentials 服务优先于进程环境变量）',
    '- id: llm-deepseek',
    '  config:',
    '    apiKeyEnv: DEEPSEEK_API_KEY',
    '    baseURL: https://api.deepseek.com',
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

/**
 * 放行原生依赖构建脚本：dsh-base 全家桶含 node-pty/koffi 等，
 * 无此文件 pnpm 以 ERR_PNPM_IGNORED_BUILDS 拒绝完成安装（见 docs/PITFALLS.md 3.1）。
 */
function pnpmWorkspaceYamlFor(): string {
  return [
    'onlyBuiltDependencies:',
    "  - '@deepseek-ai/dsh-subprocess-local'",
    "  - '@google/genai'",
    '  - koffi',
    '  - node-pty',
    '  - protobufjs',
    '',
  ].join('\n')
}

/** profile 是否就绪且为当前部署版本（旧版本/缺件 → false，触发重建） */
export function isProfileReady(profileRoot: string): boolean {
  const pluginRoot = join(profileRoot, 'plugins', 'octo-sdk-server')
  const pluginMain = join(pluginRoot, 'main.js')
  const patchPath = join(profileRoot, 'cordis.patch.yml')
  if (!existsSync(pluginMain) || !existsSync(patchPath)) return false
  // 版本标记缺失 = 旧结构或已损坏 → 整体重建
  const patch = readFileSync(patchPath, 'utf-8')
  if (!patch.includes(`server v${SERVER_PLUGIN_VERSION}`)) return false
  return existsSync(join(profileRoot, 'node_modules', 'octo-sdk-server'))
}

/** 写文件辅助：目录保证 + 幂等内容比对（内容相同不重写，避免无谓 mtime 变化） */
async function writeIfChanged(path: string, content: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path, 'utf-8') === content) return
  await writeFile(path, content, 'utf-8')
}

/**
 * 确保 profile 就绪：按当前版本重新生成全部文件（幂等）、拷贝插件、安装依赖。
 * @returns 就绪后的 profile 根目录
 * @throws DshError 插件 bundle 缺失（未 build）或依赖安装失败（含底层根因）
 */
export async function ensureSdkProfile(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const root = sdkProfileRoot(env)
  if (isProfileReady(root)) return root

  // 拷贝源：tsup 产物 dist/octo-sdk-server.js（与 sdk-profile.js 同目录）
  const serverBundle = join(distDir(), 'octo-sdk-server.js')
  if (!existsSync(serverBundle)) {
    throw new Errors.DshError(
      `自研 server 插件未构建（${serverBundle} 不存在）。请先在包目录执行 pnpm build`,
    )
  }

  const pluginRoot = join(root, 'plugins', 'octo-sdk-server')
  await writeIfChanged(join(root, 'package.json'), packageJsonFor())
  await writeIfChanged(join(root, 'cordis.patch.yml'), patchYamlFor())
  await writeIfChanged(join(root, 'pnpm-workspace.yaml'), pnpmWorkspaceYamlFor())
  await writeIfChanged(join(pluginRoot, 'package.json'), pluginPackageJsonFor())
  await writeIfChanged(join(pluginRoot, 'cordis.patch.yml'), pluginPatchYamlFor())
  copyFileSync(serverBundle, join(pluginRoot, 'main.js'))

  // 安装依赖（pnpm；失败时给出明确错误，含底层根因）
  // 注意：Windows 上 pnpm 是 .cmd，spawnSync 直接 spawn 会 ENOENT（PITFALLS 5.2 根治），
  // 需经 cmd.exe /c 包装；且 pnpm 在 ignored-builds 场景可能返回非 0 但实际已完成安装，
  // 所以成功判定以"插件依赖装上没有"为准，而不是退出码（见 PITFALLS 2.9 衍生坑）
  const installSpec =
    process.platform === 'win32'
      ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/c', 'pnpm', 'install'] }
      : { command: 'pnpm', args: ['install'] }
  spawnSync(installSpec.command, installSpec.args, { cwd: root, stdio: 'inherit', encoding: 'utf-8' })
  if (!existsSync(join(root, 'node_modules', 'octo-sdk-server'))) {
    const probe = spawnSync(installSpec.command, installSpec.args, { cwd: root, encoding: 'utf-8' })
    const cause = probe.error?.message ?? `pnpm 退出码 ${String(probe.status)}`
    throw new Errors.DshError(`SDK profile 依赖安装失败（${root}）：${cause}，请检查 pnpm 与网络`)
  }
  return root
}

/** PATH 条目分隔符：Windows 为分号、POSIX 为冒号（参数化便于跨平台单测） */
export function pathSeparatorOf(isWindows: boolean): string {
  return isWindows ? ';' : ':'
}

/** 在 PATH 中解析 dsh 可执行文件路径（Windows 优先 .cmd/.exe；POSIX 用无扩展名脚本） */
export function resolveDshBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const isWindows = process.platform === 'win32'
  // Windows：npm 生成的 dsh 是无扩展名的 sh 脚本（不可执行），必须用 dsh.cmd
  const names = isWindows ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh']
  const pathEntries = (env.PATH ?? '').split(pathSeparatorOf(isWindows))
  for (const dir of pathEntries) {
    if (!dir) continue
    for (const name of names) {
      const candidate = resolve(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * 把 dsh 可执行路径转换为 Node spawn 可执行的 command+args。
 * Windows 的 .cmd 无法被 node spawn 直接执行，需经 cmd.exe /c 包装。
 */
export function dshLaunchSpec(dshBin: string): { command: string; args: string[] } {
  if (process.platform === 'win32' && dshBin.toLowerCase().endsWith('.cmd')) {
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/c', dshBin] }
  }
  return { command: dshBin, args: [] }
}
