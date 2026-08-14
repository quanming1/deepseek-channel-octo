# 更新日志

本项目所有重要变更记录于本文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

### 新增

- F3（已验收）：冗余与死代码审查优化——删除死字段 `SendResult.ok`、`runSend` 未消费返回值；
  错误类抽 `TaggedError` 基类并新增 `isKnownError` 统一判别（CLI catch 收敛单分支）；
  SDK 通知解析收敛（`ChunkEvent`/`TurnEndEvent` 类型 + 私有 `chunkDeltaOf`）；
  `sendPrompt` 改回调式输出（`SendOptions.onText/onThinking`，IO 与纯函数分离）；
  消费者统一走目录聚合入口；修复 `resolveDshBin` 跨平台 PATH 分隔符
  （Windows `;` / POSIX `:`，抽 `pathSeparatorOf` 纯函数）；注释与实现一致性修正
  （apply 返回语义等）。新增 3 条回归测试（共 15 passed）。
  后续补全：模块内部跨模块引用统一为命名空间对象访问
  （`DshCompat.*`/`Errors.*`/`SdkProfile.*`，消除 5 处扁平成员导入）。
- A1（已验收）：GitHub 公开仓库 `quanming1/deepseek-channel-octo` + TypeScript ESM 脚手架
  （tsconfig / tsup / vitest / ESLint），Apache-2.0 LICENSE，冒烟测试全链路验证通过。
- A2（已验收）：Hello World 插件——Cordis bundle（`dsh.bundle` + `cordis.patch.yml`），
  注册 `/hello` 命令（中文注释），已通过 `dsh plugin add` 真实安装进本地 profile，
  启动日志确认 `[hello-plugin] plugin loaded!`。
- B1（已验收）：CLI 消息收发 MVP——`dsh-octo-bot send <prompt>` 经官方
  `@deepseek-ai/dsh-sdk-client`（JSON-RPC）向本地 dsh 发消息并流式接收回答；
  版本锁定单一事实来源 `dsh-compat.ts`；AC4 实机验证通过（真实中文回答）。
  排障沉淀：settings.yaml 第三方代理 baseURL + credentials 优先文件，见 `docs/PITFALLS.md`。
- F1（已验收）：TS-STYLE-GUIDE 规范引入——AGENTS.md §3 重写（命名/函数式/结构化错误/
  导入/注释/反模式清单），eslint 强化（prefer-const / no-else-return / 禁星号导入），
  现有代码错误处理改为结构化错误（`DshError`/`CliError` + tag + isInstance）。
- F2（已验收）：Self-Export 命名空间引入——各模块文件顶部 `export * as X from "./self"`，
  目录聚合 `index.ts`，消费者改命名空间访问（`DshClient`/`SdkProfile`/`Errors`/`DshCompat`）；
  tsup ESM 下验证无循环依赖。
- Rondo 方法工作流：`AGENTS.md` 行为契约、`docs/TODO.yaml` 阶段计划（A dsh 接入 MVP /
  B 消息收发 MVP / C Octo 通道）、`docs/PROCESS.md` 六步闭环、`docs/prd/` 阶段 PRD。
- Git Hooks：`.githooks/commit-msg` + `check_commit_msg.py`（按 TODO 阶段 id 校验提交规范）
  与 `.githooks/pre-push`（单 main 保护），经 `core.hooksPath` 启用。
