# 更新日志

本项目所有重要变更记录于本文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

### 新增

- Rondo 方法工作流：`AGENTS.md` 行为契约、`docs/TODO.yaml` 阶段计划（A 地基 / B 桥接核心 /
  C Octo 通道 / D 会话与并发 / E 收尾）、`docs/PROCESS.md` 六步闭环、
  `docs/prd/PRD-TEMPLATE.md` 与阶段 A1 PRD（草稿）。
- Git Hooks：`.githooks/commit-msg` + `check_commit_msg.py`（按 TODO 阶段 id 校验提交规范）
  与 `.githooks/pre-push`（单 main 保护），经 `core.hooksPath` 启用。
- 初始提交：`docs(project): initialize Rondo method workflow files`。
