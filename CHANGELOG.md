# 更新日志

本项目所有重要变更记录于本文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

### 新增

- A1（已验收）：GitHub 公开仓库 `quanming1/deepseek-channel-octo` + TypeScript ESM 脚手架
  （tsconfig / tsup / vitest / ESLint），Apache-2.0 LICENSE，冒烟测试全链路验证通过。
- A2（已验收）：Hello World 插件——Cordis bundle（`dsh.bundle` + `cordis.patch.yml`），
  注册 `/hello` 命令（中文注释），已通过 `dsh plugin add` 真实安装进本地 profile，
  启动日志确认 `[hello-plugin] plugin loaded!`。
- B1（已验收）：CLI 消息收发 MVP——`dsh-octo-bot send <prompt>` 经官方
  `@deepseek-ai/dsh-sdk-client`（JSON-RPC）向本地 dsh 发消息并流式接收回答；
  版本锁定单一事实来源 `dsh-compat.ts`；AC4 实机验证通过（真实中文回答）。
  排障沉淀：settings.yaml 第三方代理 baseURL + credentials 优先文件，见 `docs/PITFALLS.md`。
- Rondo 方法工作流：`AGENTS.md` 行为契约、`docs/TODO.yaml` 阶段计划（A dsh 接入 MVP /
  B 消息收发 MVP / C Octo 通道）、`docs/PROCESS.md` 六步闭环、`docs/prd/` 阶段 PRD。
- Git Hooks：`.githooks/commit-msg` + `check_commit_msg.py`（按 TODO 阶段 id 校验提交规范）
  与 `.githooks/pre-push`（单 main 保护），经 `core.hooksPath` 启用。
