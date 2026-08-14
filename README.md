# deepseek-channel-octo

把 [DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/reference/)
Agent 桥接进 [Octo IM](https://github.com/Mininglamp-OSS)——dsh agent 成为 Octo 中的
bot/队友：收发消息、执行任务、流式卡片、审批交互。

> **状态**：原型前阶段。项目骨架与工作流已就位；桥接实现按 `docs/TODO.yaml` 的阶段计划推进。

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

## 许可证

Apache-2.0（计划中；提交 Mininglamp-OSS 前确认）。
