# 更新日志

本项目所有重要变更记录于本文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

### 新增

- C2（已验收）：Octo WebSocket 通道最小 MVP——`src/bridge/octo/`（WuKongIM 二进制协议编解码 +
  WS 连接管理（DH+AES 握手/60s 心跳/指数退避重连/粘包解析）+ REST 最小集 registerBot/sendMessage/heartbeat +
  入站消息解析）；`octo-channel.ts` bridge（群 @bot 消息 → AgentAdapter.run → 文本回复，
  sessionId=`octo:<account>:<chatId>` 直接复用群号，多轮续跑）；`run-octo.ts` daemon（register 换 WS 凭据/
  配置加载/生命周期/优雅退出）+ CLI `octo run` 子命令。单测 61 条全绿。
  **实机已跑通**（2026-08-14，bot `dsh_octo_testbot_BlueWhale` @ im.deepminer.com.cn）：
  群里 @bot 发消息 → dsh 回答；多轮记忆待补验。实机暴露并修复：
  `registerBot` 补缺（bf_ token 不能直接 WS 握手，必须先 register 上线换 im_token/robot_id/ws_url）、
  WS 地址以服务端权威（显式配置 > 服务端 > 推导三级优先级）、环境变量 trim（cmd set 尾随空格 → URL 405）、
  `withSdkProfileArgs` 统一双链路 `--profile`（SdkDshAdapter 曾漏传）、SdkDshAdapter.model 改可选
  （缺省由 runtime 决定，原默认值 `deepseek-official` 是 provider 名）、collectRun 去重
  （text 增量与 final_text 双份拼接，只发 final_text）。坑记录见 PITFALLS 1.5/5.4/5.5/5.6/5.7。
- C1（已验收）：AgentAdapter 抽象 + SDK runtime 桥接——
  `src/adapters/types.ts` 渠道无关契约（AgentEvent 判别联合 / AgentRunOptions 含 sessionId 一等参数）；
  `SdkDshAdapter`（harness 按 cwd 常驻缓存 + notification→AgentEvent 翻译，可注入 harnessFactory）；
  **自研 octo-sdk-server 插件**（替代官方 dsh-sdk-jsonrpc-server：getOrCreateSession 双分支——
  磁盘存档命中走 `agents.resume`，跨进程恢复上下文，SDK client 零改动）；
  `sdk-profile.ts` 改挂自研 server（版本化幂等重建 `SERVER_PLUGIN_VERSION`）；
  CLI `send --session <id>` 选项。实机验证：两次独立进程同 session 续跑成功（第二次答出秘密词），
  根治 PITFALLS 5.2（Windows spawnSync pnpm ENOENT → cmd.exe /c 包装）。测试 29 条。
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
