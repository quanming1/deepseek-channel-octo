# PRD-A1-项目骨架

> 草稿，待用户评审。未 approved 前不开发。

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A1 |
| 名称 | 项目骨架 + CLI + 配置系统 |
| 状态 | 草稿 |
| 创建日期 | 2026-08-14 |
| 定稿日期 | — |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml A1 |

## 1. 背景与目标

- **背景**：deepseek-channel-octo 把 DeepSeek Harness（dsh）Agent 桥接进 Octo IM。在写任何桥接逻辑之前，仓库需要一个类型化、可测试的骨架：包清单、CLI 入口、配置系统，以及 dsh 版本锁定的单一事实来源（抗漂移基线，见 `docs/dsh-lark-bot-analysis.md` 兼容策略）。
- **目标**：一个干净的 TypeScript ESM 包，CLI（`dsh-octo-bot`）暴露管理命令面（`start / status / restart / stop / doctor`），配置层从 env/文件加载并校验，dsh 版本固定在一个文件（`dsh-compat.ts`）。
- **非目标**：本阶段不写桥接逻辑（不起 dsh runtime、不连 Octo WebSocket）；不做守护进程监管；不覆盖 adapter 测试（后续阶段）。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：`package.json` 声明 ESM（`"type": "module"`）、TypeScript、engines `node >= 22.19`、scripts（`build` / `typecheck` / `test` / `lint`）、`bin` 入口 `dsh-octo-bot` 指向 CLI 启动器。
- [ ] FR2：CLI `dsh-octo-bot --help` 列出子命令 `start / status / restart / stop / doctor` 及简短说明；未知命令以非零退出并打印用法。
- [ ] FR3：配置层（`src/config/`）提供：`env` 解析（可选 `OCTO_*` 覆盖）、`app-paths`（基于 `os.homedir()` 相对默认值的配置/home 解析）、`dsh-compat.ts`——保存锁定的 `@deepseek-ai/*` 版本 + `verifiedAt` 日期的单一事实来源。
- [ ] FR4：配置值经 schema 校验（zod 或手写校验器）；非法值加载时响亮失败，报错点名出错键。
- [ ] FR5：`dsh-octo-bot doctor` 打印环境检查（node 版本、配置路径）并按结果退出 0/1。

### 2.2 非功能需求

- 性能：CLI 启动 < 500ms（模块顶层不引入重依赖）。
- 安全：配置输出不含 secrets；`doctor` 不得打印凭据值。
- 兼容性：路径一律 `node:path`；LF 换行；UTF-8 读写显式声明。

## 3. 技术方案

- 布局：
  - `bin/dsh-octo-bot.mjs` — 薄启动器（shebang，import `src/cli.ts`）。
  - `src/cli.ts` — commander 程序：子命令 + 选项解析。
  - `src/cli/commands/{start,status,restart,stop,doctor}.ts` — start/stop 在 A1 返回"未实现"桩，doctor 做真实检查。
  - `src/config/env.ts` — env 解析辅助。
  - `src/config/app-paths.ts` — home 相对路径解析。
  - `src/config/dsh-compat.ts` — 锁定版本矩阵 + `verifiedAt`。
  - `src/config/index.ts` — 校验与组合。
- 构建：`tsup`（esbuild）产出 `dist/`；`tsc --noEmit` 做类型检查。
- 依赖选型（必须在 `package.json` 声明）：
  - `commander` — CLI 解析。
  - zod（或轻量手写校验器，评审时定）— 配置校验。
  - `tsup`、`typescript`、`vitest` — 开发工具链。

## 4. 接口定义

```bash
dsh-octo-bot --help
dsh-octo-bot start [--foreground]
dsh-octo-bot status
dsh-octo-bot restart
dsh-octo-bot stop
dsh-octo-bot doctor
```

配置（env / `~/.dsh-octo/config.yaml`）：
```yaml
# 示例
octo:
  serverUrl: wss://octo.example.com
  botTokenEnv: OCTO_BOT_TOKEN
```

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` 通过，无错误。
- [ ] AC2：`pnpm lint` 通过，无警告。
- [ ] AC3：`pnpm test` — vitest 配置校验套件通过（合法/非法用例，响亮失败报错点名出错键）。
- [ ] AC4：`node bin/dsh-octo-bot.mjs --help` 列出全部五个子命令；未知命令非零退出并打印用法。
- [ ] AC5：`dsh-octo-bot doctor` 在 node 版本正确时退出 0 并打印解析后的配置路径；node < 22.19 时退出 1 并给出明确信息。
- [ ] AC6：`dsh-compat.ts` 精确锁定 `@deepseek-ai/dsh-sdk-client`（不用 `^`）；单测断言该锁定与 `package.json` 版本一致。

## 6. 测试计划

- 单元：配置解析 + 校验（env 覆盖、文件加载、响亮失败）。
- 单元：`doctor` 输出/退出码（mock env）。
- 手动：在 Windows 与（可行时）Linux 上运行 `--help`、`doctor`。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| package.json + tsconfig + tsup + vitest 引导 | 1 |
| CLI 骨架（commander + 5 个子命令桩） | 1 |
| 配置层（env / paths / dsh-compat + 校验） | 2 |
| doctor 实现 + 测试 | 1 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| dsh 上游变更破坏锁定版本 | 精确锁定 + `verifiedAt`；按 PROCESS.md 变更路径更新 |
| Windows 路径怪癖 | 全用 `node:path`；E1 阶段 CI 矩阵覆盖 |

## 9. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始草稿 | — |
