import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfigFromEnv, loadConfigFromFile, loadDaemonConfig, resolveConfigPath } from './octo-config.js'

/** Octo 配置加载单测（YAML 解析/默认值/校验/回退） */

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'octo-config-'))
}

describe('resolveConfigPath', () => {
  it('OCTO_CONFIG 指定路径优先（不检查存在性，由加载时处理）', () => {
    const cwd = tempDir()
    try {
      expect(resolveConfigPath({ OCTO_CONFIG: 'custom/octo.yaml' }, cwd)).toMatch(/custom[/\\]octo\.yaml$/)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('无 OCTO_CONFIG 但默认文件存在 → 默认路径', () => {
    const cwd = tempDir()
    try {
      writeFileSync(join(cwd, 'octo.config.yaml'), 'apiUrl: x\n', 'utf-8')
      expect(resolveConfigPath({}, cwd)).toBe(join(cwd, 'octo.config.yaml'))
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('都不存在 → undefined（触发环境变量回退）', () => {
    const cwd = tempDir()
    try {
      expect(resolveConfigPath({}, cwd)).toBeUndefined()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('loadConfigFromFile', () => {
  it('正常 YAML：apiUrl + 多 bot（name/accountId/allowedGroups 数组）', () => {
    const cwd = tempDir()
    const file = join(cwd, 'octo.config.yaml')
    try {
      writeFileSync(
        file,
        [
          'apiUrl: https://octo.example.com/api',
          'wsUrl: wss://octo.example.com/ws',
          'model: deepseek-v4-flash',
          'bots:',
          '  - name: testbot',
          '    botUid: bot-1',
          '    botToken: bf_token1',
          '    accountId: acct-1',
          '    allowedGroups:',
          '      - g1',
          '      - g2',
          '  - botUid: bot-2',
          '    botToken: bf_token2',
        ].join('\n'),
        'utf-8',
      )
      const config = loadConfigFromFile(file)
      expect(config.apiUrl).toBe('https://octo.example.com/api')
      expect(config.wsUrl).toBe('wss://octo.example.com/ws')
      expect(config.model).toBe('deepseek-v4-flash')
      expect(config.bots).toHaveLength(2)
      expect(config.bots[0]).toEqual({
        name: 'testbot',
        botUid: 'bot-1',
        botToken: 'bf_token1',
        accountId: 'acct-1',
        allowedGroups: ['g1', 'g2'],
      })
      expect(config.bots[1]).toEqual({
        name: undefined,
        botUid: 'bot-2',
        botToken: 'bf_token2',
        accountId: undefined,
        allowedGroups: undefined,
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('allowedGroups 支持逗号分隔字符串写法', () => {
    const cwd = tempDir()
    const file = join(cwd, 'octo.config.yaml')
    try {
      writeFileSync(
        file,
        'apiUrl: https://x\nbots:\n  - botUid: b1\n    botToken: t1\n    allowedGroups: g1, g2\n',
        'utf-8',
      )
      const config = loadConfigFromFile(file)
      expect(config.bots[0]!.allowedGroups).toEqual(['g1', 'g2'])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('缺失 apiUrl → 抛错指明字段', () => {
    const cwd = tempDir()
    const file = join(cwd, 'octo.config.yaml')
    try {
      writeFileSync(file, 'bots:\n  - botUid: b1\n    botToken: t1\n', 'utf-8')
      expect(() => loadConfigFromFile(file)).toThrow('apiUrl')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('bots 为空/缺失 → 抛错', () => {
    const cwd = tempDir()
    const file = join(cwd, 'octo.config.yaml')
    try {
      writeFileSync(file, 'apiUrl: https://x\n', 'utf-8')
      expect(() => loadConfigFromFile(file)).toThrow('bots')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('bot 项缺 botToken → 抛错指明索引与字段', () => {
    const cwd = tempDir()
    const file = join(cwd, 'octo.config.yaml')
    try {
      writeFileSync(file, 'apiUrl: https://x\nbots:\n  - botUid: b1\n', 'utf-8')
      expect(() => loadConfigFromFile(file)).toThrow('bots[0].botToken')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('YAML 语法错误 → 抛错含文件路径', () => {
    const cwd = tempDir()
    const file = join(cwd, 'octo.config.yaml')
    try {
      writeFileSync(file, 'apiUrl: [unclosed\n', 'utf-8')
      expect(() => loadConfigFromFile(file)).toThrow(/YAML 解析失败/)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('文件不存在 → 抛错', () => {
    expect(() => loadConfigFromFile(join(tempDir(), 'nope.yaml'))).toThrow('不存在')
  })
})

describe('loadConfigFromEnv', () => {
  it('缺失必填 → 抛 CliError（逐级）', () => {
    expect(() => loadConfigFromEnv({})).toThrow('OCTO_API_URL')
    expect(() => loadConfigFromEnv({ OCTO_API_URL: 'https://x' })).toThrow('OCTO_BOT_TOKEN')
    expect(() => loadConfigFromEnv({ OCTO_API_URL: 'https://x', OCTO_BOT_TOKEN: 'bf_t' })).toThrow('OCTO_BOT_UID')
  })

  it('完整环境变量 → 单 bot 配置（trim 防尾随空格；allowedGroups 拆分；可选字段缺省）', () => {
    const config = loadConfigFromEnv({
      OCTO_API_URL: ' https://octo.example.com/api ',
      OCTO_BOT_TOKEN: ' bf_t ',
      OCTO_BOT_UID: ' bot-1 ',
      OCTO_ALLOWED_GROUPS: ' g1, g2 ',
    })
    expect(config.apiUrl).toBe('https://octo.example.com/api')
    expect(config.bots).toHaveLength(1)
    expect(config.bots[0]).toEqual({
      botUid: 'bot-1',
      botToken: 'bf_t',
      accountId: undefined,
      allowedGroups: ['g1', 'g2'],
    })
    expect(config.wsUrl).toBeUndefined()
  })
})

describe('loadDaemonConfig', () => {
  it('默认路径存在 → 文件配置优先', () => {
    const cwd = tempDir()
    try {
      writeFileSync(join(cwd, 'octo.config.yaml'), 'apiUrl: https://file.example.com\nbots:\n  - botUid: b1\n    botToken: t1\n', 'utf-8')
      const config = loadDaemonConfig({ OCTO_API_URL: 'https://env.example.com', OCTO_BOT_TOKEN: 't', OCTO_BOT_UID: 'b' }, cwd)
      expect(config.apiUrl).toBe('https://file.example.com')
      expect(config.bots).toHaveLength(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('无配置文件 → 环境变量回退', () => {
    const cwd = tempDir()
    try {
      const config = loadDaemonConfig(
        { OCTO_API_URL: 'https://env.example.com', OCTO_BOT_TOKEN: 'bf_t', OCTO_BOT_UID: 'bot-1' },
        cwd,
      )
      expect(config.apiUrl).toBe('https://env.example.com')
      expect(config.bots[0]!.botUid).toBe('bot-1')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('OCTO_CONFIG 指向的路径存在 → 用之（即使默认路径不存在）', () => {
    const cwd = tempDir()
    const custom = join(cwd, 'custom.yaml')
    try {
      writeFileSync(custom, 'apiUrl: https://custom.example.com\nbots:\n  - botUid: b1\n    botToken: t1\n', 'utf-8')
      const config = loadDaemonConfig({ OCTO_CONFIG: custom }, cwd)
      expect(config.apiUrl).toBe('https://custom.example.com')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
