# PRD-A2-Hello-World 插件

> 状态：approved（用户 2026-08-14 指令立项：先做 dsh Hello World 插件 MVP）

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A2 |
| 名称 | Hello World 插件（在 dsh 上安装运行） |
| 状态 | approved |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml A2 |

## 1. 背景与目标

- **背景**：A1 脚手架就绪后，写第一个真实的 dsh 插件——Hello World。目标是在本地 dsh（DeepSeek Harness）上**安装并运行**该插件，验证插件从开发到加载的完整链路（对应 dsh 官方"第一个 Harness 插件"教程）。
- **目标**：一个中文注释齐全的 Cordis 插件，能被 dsh 以 bundle 形式安装，启动时打印 Hello 信息，并提供一条 `/hello` 用户命令或 `hello` 工具作为可验证行为。
- **非目标**：不写任何 Octo 桥接逻辑（C 阶段）；不做消息收发（B 阶段）；不做复杂工具注册。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：`src/index.ts` 导出 Cordis 插件：`name`、`inject`（如 `['commands']`）、`apply(ctx)`；全部注释用中文，解释"为什么"。
- [ ] FR2：插件加载时打印 `[hello-plugin] plugin loaded!`（中文注释说明 stdout 约定）。
- [ ] FR3：注册一条用户命令 `hello`：执行后向用户返回"Hello from deepseek-channel-octo!"（dsh 命令注册走 `ctx.commands`，无需模型轮次即可分派）。
- [ ] FR4：bundle 分发声明：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`；patch 内以包名引用插件行。
- [ ] FR5：单测覆盖：插件名正确、apply 可执行不抛错、命令注册回调返回预期文案。

### 2.2 非功能需求

- 兼容性：与 dsh `0.1.0-rc` 系列 cordis API 兼容（以 `@deepseek-ai/cordis` 版本为准）。
- 安全：不读取/打印任何凭据。

## 3. 技术方案

- 依赖：`@deepseek-ai/cordis`（peerDependency + dev，与 dsh 官方包一致）、`@deepseek-ai/dsh-command`（命令注册类型，如适用）。
- 插件形态（参照 dsh 官方"第一个 Harness 插件"教程）：
  ```ts
  import type { Context } from '@deepseek-ai/cordis'
  export const name = 'hello-plugin'
  export const inject = ['commands']   // 依赖命令服务，就绪后才 apply
  export function apply(ctx: Context) {
    ctx.commands.register('hello', '...')
  }
  ```
- bundle 声明（`package.json`）：
  ```json
  { "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
  ```
- `cordis.patch.yml`：
  ```yaml
  - insert:
      - id: hello
        name: deepseek-channel-octo
  ```
- 安装方式（本地验证）：`dsh plugin --profile demo add <本地路径>` 或 `--patch` overlay。

## 4. 接口定义

- 命令：`/hello` → 返回 `Hello from deepseek-channel-octo!`
- 加载日志：`[hello-plugin] plugin loaded!`

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿。
- [ ] AC2：`pnpm build` 产出 `dist/`；插件可作为 npm 包被解析。
- [ ] AC3：在本地 dsh 上安装成功（`dsh plugin add` 或 `--patch` 加载），启动日志出现 `[hello-plugin] plugin loaded!`。
- [ ] AC4：在 dsh 会话中执行 `hello` 命令返回预期文案（如环境无法交互，则以单测断言为准并记录）。

## 6. 测试计划

- 单元：插件名、apply 不抛错、命令回调文案。
- 手动：本地 dsh 安装 + 启动观察日志 + 会话内执行 `/hello`。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| 插件源码（中文注释） | 1 |
| 单测 | 1 |
| bundle 声明 + patch | 0.5 |
| 本地 dsh 安装验证 | 1 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 本地无 dsh CLI / 未配置 DeepSeek key | 安装 `@deepseek-ai/dsh`；无 key 时命令回路可用（命令无需模型） |
| cordis API 版本漂移 | 锁定 `@deepseek-ai/cordis` 版本；以安装时的 dsh 版本为准 |

## 9. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿（approved） | 用户指令：第一步完成 Hello World 插件并安装运行 |
