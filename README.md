# deepseek-channel-octo

把 [DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/reference/)
Agent 桥接进 [Octo IM](https://github.com/Mininglamp-OSS)——dsh agent 成为 Octo 中的
bot/队友：收发消息、执行任务、流式卡片、审批交互。

> **状态**：原型阶段。Octo WebSocket 通道 MVP 已实机跑通（C2）；bot 配置化与多 bot 支持（C3）。
> 实现按 `docs/TODO.yaml` 的阶段计划推进。

## Quick start

Connect an Octo bot to a dsh agent in three steps.

### 1. Install

```bash
npm install -g @deepseek-ai/dsh@0.1.0-rc.6   # dsh CLI
npm install -g deepseek-channel-octo          # this package
```

### 2. Create a bot and configure it

Create a bot in the Octo admin console — you get a **Bot ID** and a **Bot Token** (`bf_` prefix).

Copy the config template and fill in your credentials:

```bash
cp octo.config.example.yaml octo.config.yaml
```

```yaml
# octo.config.yaml
apiUrl: https://your-octo-server.example/api
bots:
  - name: my-bot
    botUid: xxxxxxxxxxxxx_bot
    botToken: bf_your_bot_token_here
```

Add one entry per bot under `bots` to connect multiple bots — each gets its own
WebSocket connection and shares the same dsh harness. `octo.config.yaml` is
git-ignored (it contains secrets); the path can be overridden with `OCTO_CONFIG`.

No config file? Legacy env vars are used as fallback:
`OCTO_API_URL` / `OCTO_BOT_TOKEN` / `OCTO_BOT_UID`.

### 3. Run

```bash
dsh-octo-bot octo run
```

Add the bot to a group and @mention it — the agent replies with the dsh answer.
Each group maps to its own dsh session (`octo:<accountId>:<chatId>`), so the bot
remembers the conversation per group (restart-safe).

## 工作流（Rondo 方法）

本仓库运行 PRD 驱动、Agent 约束的工作流。动手前先读这些文件：

| 文件 | 用途 |
|---|---|
| `AGENTS.md` | 对所有 AI agent 与人类的行为契约（**必须最先读**） |
| `docs/TODO.yaml` | 按阶段展开的结构化任务清单——**开发的唯一执行依据** |
| `docs/PROCESS.md` | 六步闭环推进办法（立项 → 评审 → 开发 → 验证 → 收尾 → 发布） |
| `docs/prd/PRD-<阶段>-*.md` | 阶段 PRD——**开发的唯一依据** |
| `.githooks/` | 本地机器强制：commit-msg（提交规范）+ pre-push（main 保护） |

## 启用 Hooks

```bash
git config core.hooksPath .githooks
```

## 分支模型

单 main 全 PR 流：feature 分支从 `main` 切出，仅经 GitHub PR 合入。见 `AGENTS.md` §4。

## 开发

```bash
pnpm install        # 安装依赖（pnpm 11，Node >= 22.19）
pnpm typecheck      # 类型检查（tsc --noEmit）
pnpm lint           # ESLint
pnpm test           # vitest 单元测试
pnpm build          # tsup 构建 -> dist/
```

## 许可证

Apache-2.0。
