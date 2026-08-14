# PRD-B1-CLI 消息收发 MVP

> 状态：approved（用户 2026-08-14 指令立项：第二步做 CLI/HTTP 向 dsh 发消息拿回答）

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | B1 |
| 名称 | CLI 向 dsh 发送消息并接收回答 |
| 状态 | 已验收（AC4 待 DEEPSEEK_API_KEY 实机补验） |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | 2026-08-14 |
| 关联文档 | docs/TODO.yaml B1 |

## 1. 背景与目标

- **背景**：A 阶段已完成 dsh 接入 MVP（Hello World 插件可安装加载）。第二步要让项目具备真正的消息收发能力——通过 CLI 向 DeepSeek Harness 发送 prompt 并拿到模型回答。这是后续 Octo 通道（C 阶段）的骨架：官方 SDK client（JSON-RPC）路线已由 dsh-lark-bot 验证。
- **目标**：`dsh-octo-bot send "<prompt>"` 在终端输出 dsh 的正常回答（流式），退出码反映成功/失败。
- **非目标**：不做 Octo WebSocket 接入（C 阶段）；不做会话持久化/多会话（C/D 阶段）；不做守护进程；HTTP 接口留 B2（可选）。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：CLI 入口 `dsh-octo-bot`（bin），子命令 `send <prompt>`，选项 `--model`（默认读配置/环境）。
- [ ] FR2：SDK profile 管理：确保 `~/.dsh/profiles/octo-sdk` 存在——声明 `@deepseek-ai/dsh-sdk-jsonrpc-server`（精确锁定版本）与 `dsh-base` bundle，`cordis.patch.yml` 插入 SDK server 插件并禁用交互提问（无人值守）。
- [ ] FR3：客户端集成：`@deepseek-ai/dsh-sdk-client` 的 `HarnessClient`/`DeepSeekHarness` 启动 dsh 子进程，`initialize({ cwd, provider, model })` 握手。
- [ ] FR4：`run(prompt, { sessionId })` 发送消息，把 `assistant/chunk` 的 text-delta 流式打印到 stdout；结束后退出 0。
- [ ] FR5：失败处理：无 dsh / 无 `DEEPSEEK_API_KEY` / 握手失败时打印明确错误并退出非 0。
- [ ] FR6：版本锁定：`dsh-compat.ts` 单一事实来源（dsh / sdk-client / sdk-server 精确版本），单测断言与 package.json 一致。

### 2.2 非功能需求

- 性能：CLI 启动 < 1s（不含 dsh 启动）。
- 兼容性：Windows / Linux / macOS（子进程参数数组显式传入）。
- 安全：API key 只从环境变量读取，绝不打印/记录。

## 3. 技术方案

- 布局：
  ```
  bin/dsh-octo-bot.mjs        # CLI 入口（shebang + commander）
  src/cli.ts                  # 命令定义
  src/config/dsh-compat.ts    # 版本单一事实来源（dsh/sdk-client/sdk-server + verifiedAt）
  src/agent/sdk-profile.ts    # SDK profile 生成/确保（package.json + patch + pnpm install）
  src/agent/dsh-client.ts     # DeepSeekHarness 封装（握手 + run + 流式）
  ```
- 依赖：`@deepseek-ai/dsh-sdk-client`（精确 `0.1.0-rc.6`）、`commander`；dev：现有工具链。
- SDK profile 结构（参照 dsh 官方 bundle/profile 机制）：
  ```json
  { "name": "dsh-profile-octo-sdk", "private": true,
    "dependencies": { "@deepseek-ai/dsh-sdk-jsonrpc-server": "0.1.0-rc.6" },
    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base"] } } }
  ```
  ```yaml
  - insert:
      - id: sdk-jsonrpc-server
        name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
  - id: user-questions
    disabled: true
  ```
- 客户端启动：`HarnessClient({ command: 'dsh', args: ['--profile', 'octo-sdk'], cwd })`，`initialize({ cwd, provider: 'deepseek-official', model })`，`run(prompt, { sessionId, onNotification })`。
- 流式翻译：`session.event` → `assistant/chunk`（text-delta）逐段输出；`assistant/message` 输出 token 用量（可选）。

## 4. 接口定义

```bash
dsh-octo-bot send "用一句话介绍你自己" [--model deepseek-chat]
# 输出：模型流式回答 + 空行 + 用量摘要
echo $?  # 0 成功 / 1 失败
```

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿。
- [ ] AC2：`pnpm build` 产出 dist，`node bin/dsh-octo-bot.mjs --help` 列出 `send`。
- [ ] AC3：单测覆盖：`dsh-compat.ts` 版本与 package.json 一致；SDK profile 生成的文件内容正确；无 key 时错误信息明确。
- [ ] AC4：配置 `DEEPSEEK_API_KEY` 后，`dsh-octo-bot send "你好"` 返回 dsh 正常中文回答（流式输出，退出 0）。

## 6. 测试计划

- 单元：profile 生成（package.json/patch 内容断言）、版本一致性、参数组装。
- 手动：真实 key 跑 `send`；无 key / 无 dsh 的失败路径。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| dsh-compat + profile 生成 | 1.5 |
| dsh-client 封装（握手 + 流式） | 2 |
| CLI send 命令 + 测试 | 1 |
| 真实 key 手动验证 | 1 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| dsh-sdk-client rc 版本 API 漂移 | 精确锁定；以 dsh-lark-bot 实测用法为准 |
| 本地无 DEEPSEEK_API_KEY | AC4 手动项标注"需 key"；单元测试不依赖真实凭据 |
| profile 安装需网络/pnpm | 首次 install 由 CLI 自动执行并给出进度 |

## 9. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿（approved） | 用户指令：第二步做 CLI/HTTP 消息收发最简 MVP |
| 2026-08-14 | 开发完成：AC1-AC3 已验证（8 tests 全绿、--help 正常、无 key 失败路径明确）；AC4 待 DEEPSEEK_API_KEY 实机补验 | 记录 B1 开发收尾 |
