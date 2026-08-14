# PRD-C1-AgentAdapter 抽象与 SDK runtime 桥接

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | C1 |
| 名称 | AgentAdapter 抽象 + SDK runtime 桥接（含 server 侧 resume） |
| 状态 | approved |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | （待填） |
| 关联文档 | docs/TODO.yaml 阶段 C1；docs/prd/PRD-B1-cli-messaging.md（B1 资产）；demo/demo-resume.mjs（可行性验证） |

## 1. 背景与目标

- **背景**：B1 已用官方 `@deepseek-ai/dsh-sdk-client` 打通 CLI 单轮收发，但调用链是 CLI 专用的
  （`runSend → createHarness → sendPrompt`，每次新建进程、无会话概念）。C 阶段要把 dsh agent 桥接进
  Octo IM，需要一层**渠道无关的 agent 桥接抽象**。调研（`docs/dsh-lark-bot-analysis.md`）与实测
  （`demo/demo-resume.mjs`）确认两个关键事实：
  1. **SDK 协议无跨进程 resume**：`run({sessionId})` 在新 harness 进程复用旧 id 报 id collision
     （dsh-sdk-protocol 无 resumeSessionId 字段）；而 dsh 核心有完整恢复链路
     （`ctx.agents.resume({resumeSessionId})` + `sessionPersistence` 双分支，见 dsh-host-apiproxy 的
     `ensureSession`）。DEMO 场景 B 已验证自研双分支插件可跨进程恢复上下文。
  2. **Octo 会话 key 可直接当 dsh sessionId**（dsh 对 id 无格式校验，DEMO 已实证），无需映射表
     也能保证会话隔离；daemon 形态下续跑在 harness 内存完成。
- **目标**：交付渠道无关的 AgentAdapter 层 + 常驻 runtime 桥接 + 自研 resume server——C2 的
  Octo WebSocket 通道只需面向 AgentAdapter 编程，不再触碰 dsh 细节。
- **非目标**：不做 Octo WS 接入（C2）；不做 scope→sessionId 持久化映射、并发锁（C3）；
  不做审批/ACP；不改 CLI 的既有单轮行为语义（只加 `--session` 选项透传）。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：**AgentAdapter 契约**（`src/adapters/types.ts`）——最小异步迭代器风格：
  - `AgentEvent`：判别联合（`system` 携带 sessionId / `text` 流式增量 / `thinking` 增量 /
    `final_text` 完整回答 / `error` 含原因 / `done` 含 terminationReason）。
  - `AgentRunOptions`：`{ runId, prompt, cwd, sessionId?, model?, stopGraceMs? }`——sessionId
    是一等参数（缺省由 adapter 生成）。
  - `AgentRun`：`{ runId, events: AsyncIterable<AgentEvent>, stop(): Promise<void>, waitForExit(timeoutMs?): Promise<boolean> }`。
  - `AgentAdapter` 接口：`{ id, displayName, run(options): AgentRun, dispose?(): Promise<void> }`。
- [ ] FR2：**SdkDshAdapter 实现**（`src/adapters/dsh/sdk-adapter.ts`）——常驻形态：
  harness 按 cwd 缓存（`Map<cwd, {harness}>`，参照 dsh-lark-bot `runtimeFor`）；`run()` 把 SDK
  notification 翻译为 `AgentEvent`（复用 B1 的 textDeltaOf/reasoningDeltaOf/turnErrorOf 语义）；
  `stop()` 关闭对应 runtime；`dispose()` 全量回收。sessionId 缺省生成 `session-<uuid>`（对齐 lark-bot 惯例）。
- [ ] FR3：**自研 SDK server 插件**（`src/adapters/dsh/server-plugin/` 或独立目录，装进我们
  自管的 octo-sdk profile）——替换官方 `@deepseek-ai/dsh-sdk-jsonrpc-server` 的 create-only 行为：
  `getOrCreateSession(sessionId)` 改双分支——磁盘存档命中（`sessionPersistence.list()` 含该 id）
  → `agents.resume({resumeSessionId, agentOptions, setup})`；未命中 → `agents.create({sessionId, ...})`。
  JSON-RPC 方法面（initialize/prompt/notifications）与官方 server 保持兼容，SDK client 零改动。
  实现直接移植 DEMO 验证过的双分支逻辑（cwd 匹配校验沿用核心约束）。
- [ ] FR4：**CLI `send --session <id>` 选项**——`runSend`/`sendPrompt` 透传 sessionId
  （`harness.run(prompt, {sessionId})`），作为 FR3 的实机验收入口（两次独立进程同 id 续跑）。
- [ ] FR5：**profile 管理扩展**——`sdk-profile.ts` 生成的 octo-sdk profile 的 patch 层从引用官方
  server 包改为引用自研 server（bundle 化：`dsh.bundle` 声明 + patch insert），保留 llm-deepseek
  官方端点覆盖与 user-questions/hmr 禁用。

### 2.2 非功能需求

- 兼容性：版本继续锁定 0.1.0-rc.6（`dsh-compat.ts` 单一事实来源，测试断言一致性）。
- 健壮性：server 双分支的 resume 失败（如存档损坏）要有明确错误出口，不允许静默降级为空回答。
- 可测性：adapter 用可注入 harnessFactory（lark-bot 同款手法）；server 双分支用 fake persistence 单测。

## 3. 技术方案

- 模块设计：
  ```
  src/adapters/types.ts            AgentAdapter / AgentRun / AgentEvent 契约
  src/adapters/dsh/sdk-adapter.ts  SdkDshAdapter（harness 缓存 + 事件翻译）
  src/adapters/dsh/server/         自研 JSON-RPC server 插件（双分支 getOrCreateSession）
  src/agent/dsh-client.ts          B1 资产微调（sendPrompt 已支持回调化，sessionId 透传）
  src/cli.ts                       --session 选项
  src/agent/sdk-profile.ts         profile patch 改挂自研 server
  ```
- 关键数据结构：`AgentEvent` 判别联合（tag 字段 + 类型收窄，对齐 errors.ts 风格）。
- 依赖：无新增运行时依赖（server 插件依赖 @deepseek-ai/dsh-agent / dsh-session，以 profile
  内 file: 依赖安装，主包不加）。
- 设计决策记录：
  - **不走 SDK client 打补丁**，而是替换 server 侧——协议面不动、client 零改动、升级面最小。
  - **SessionStore（scope→sessionId 持久化）推迟到 C3**：C1 先保证"同一 sessionId 跨进程可续"
    （FR3/FR4 验收），映射策略与 Octo scope 粒度在 C2/C3 定型。

## 4. 接口定义

- CLI：`dsh-octo-bot send <prompt> [--session <sessionId>] [-m <model>]`。
- Adapter（消费者视角，C2 将面向此编程）：
  ```ts
  const run = adapter.run({ runId, prompt, cwd, sessionId })
  for await (const ev of run.events) { /* 渲染 */ }
  ```

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` 全绿（退出码 0）。
- [ ] AC2：单测覆盖——AgentEvent 翻译（text/thinking/final/error/done）、sessionId 缺省生成与透传、
  server 双分支（fake persistence：有存档走 resume / 无存档走 create / 存档 cwd 不匹配报错）。
- [ ] AC3：实机跨进程续跑——`dsh-octo-bot send "记住一个秘密词：X" --session demo-c1` 成功后，
  **新终端进程** `dsh-octo-bot send "秘密词是什么？" --session demo-c1` 答出 X（FR3+FR4 端到端证据，
  等价于 DEMO 场景 B 但走完整 CLI 链路）。
- [ ] AC4：不传 `--session` 时行为与 B1 完全一致（回归，随机新会话单轮）。

## 6. 测试计划

- 单元测试：`src/adapters/dsh/*.test.ts`（fake harnessFactory 注入翻译断言）；server 双分支
  fake persistence 用例；`sdk-profile` patch 生成含自研 server 的断言；cli --session 参数解析。
- 手动验证：AC3 跨进程续跑、AC4 回归（各一次实机）。
- 现有 15 条测试保持通过。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| AgentAdapter 契约 + 类型 | 0.5 天 |
| SdkDshAdapter（harness 缓存 + 翻译） | 1 天 |
| 自研 server 插件（双分支） + profile 挂载 | 1 天 |
| CLI --session + 回归 | 0.5 天 |
| 测试补齐 + 实机验收 | 1 天 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| `agents.resume` API 无公开类型声明（DEMO 直调成功） | server 插件内局部类型窄化；rc.6 版本锁定 + 兼容性测试兜底 |
| 官方 server 有未覆盖的协议方法（如 subagent 通知） | 移植时以官方 server 源码为对照清单逐方法核对 |
| resume 遇到存档损坏/版本不符 | 双分支内 catch 转结构化错误，CLI 显式报错（不静默） |
| profile 结构升级导致已装环境漂移 | `ensureSdkProfile` 幂等重建（版本号变化时强制刷新） |

## 9. 变更记录

> **本小节是需求变更的审计轨迹（强制）**：任何对正文 FR / AC / 技术方案的修改，
> MUST 在此追加一行（日期 + 变更内容 + 理由），并重核受影响 AC（结果留痕）。

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿 | 用户确认推进 C1（「demo 收尾（提交 demo/ + 踩坑记录 && 跟进进 PRD-C1」）；resume 双分支设计源自 demo/demo-resume.mjs 实测验证（场景 A 失败 / 场景 B 成功），踩坑记录见工作区 docs/PITFALLS.md 2.9 |
