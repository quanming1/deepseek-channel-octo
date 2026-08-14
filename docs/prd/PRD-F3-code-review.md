# PRD-F3-代码审查优化

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | F3 |
| 名称 | 冗余与死代码审查优化 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | 2026-08-14 |
| 关联文档 | docs/TODO.yaml 阶段 F3 |

## 1. 背景与目标

- **背景**：F2（Self-Export 命名空间）合入后，对 `src/` 全量审查发现一批代码质量问题：
  死字段（`SendResult.ok` 恒为 true 且无消费者）、未消费返回值（`runSend` 返回 `0` 被 action
  忽略）、重复逻辑（两个错误类同构、CLI catch 双分支、三个通知解析函数重复事件类型断言）、
  一致性缺口（`cli.ts` / `cli.test.ts` 绕过 F2 建立的目录聚合 `index.ts` 直连子模块、
  `src/index.ts` apply 注释声称「返回清理函数」但实现返回 void）、一个潜伏跨平台 bug
  （`resolveDshBin` 的 PATH 一律按 `;` 分割，POSIX 上失效）、以及测试中的 `as never`
  类型卫生问题。此外 `apiKeyAvailable` 使用了 non-null 断言（`match[1]!`）。
- **目标**：消除死代码与重复、修复跨平台 bug、统一消费者走目录聚合入口、修正注释与实现
  不一致；**外部行为不变**（CLI 命令签名、插件行为、错误输出格式均保持）。
- **非目标**：不引入新功能（B2 HTTP / C 阶段不动）；不做性能优化；不改 `send` 命令的参数
  与输出契约；不引入新依赖。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：删除死字段 `SendResult.ok`（恒为 true 且无消费者；失败一律 throw，ok 是冗余信号）。
      保留 `finalResponse`（真实数据字段，B2 HTTP 非流式消费者需要）。
- [x] FR2：抽取 `TaggedError` 错误基类（统一 cause 链 + tag 匹配），`DshError` / `CliError`
      只声明唯一 tag/name；新增 `isKnownError(error)` 统一判别（类型谓词收窄到 `DshError | CliError`），
      CLI catch 由双分支收敛为单分支。
- [x] FR3：SDK 通知解析收敛——定义 `ChunkEvent` / `TurnEndEvent` 事件负载类型，
      抽私有 `chunkDeltaOf(notification, type)` 共享 `textDeltaOf` / `reasoningDeltaOf` 的
      chunk 增量提取；三个解析函数的外部签名与语义不变。
- [x] FR4：`sendPrompt` 的 IO 与纯函数分离——改为接收 `SendOptions { onText?, onThinking? }`
      回调，模块内不再直接写 `process.stdout`；CLI 层决定输出目的地。
- [x] FR5：`cli.ts` / `cli.test.ts` 的导入改走目录聚合入口（`./agent/index.js` + `./config/index.js`），
      落实 AGENTS.md §3.2「消费者从目录入口统一引用」。
- [x] FR6：修复 `resolveDshBin` 跨平台 bug——PATH 分隔符按平台（Windows `;` / POSIX `:`），
      抽纯函数 `pathSeparatorOf(isWindows)` 便于单测。
- [x] FR7：注释与实现一致性修正（`src/index.ts` apply 注释、`sendPrompt` JSDoc 等）；
      `apiKeyAvailable` 去掉 non-null 断言；`ensureSdkProfile` 错误信息附加 spawnSync 根因。

### 2.2 非功能需求

- 兼容性：Windows / Linux / macOS 三平台行为正确（PATH 分隔符、dsh 启动路径）。
- 可维护性：注释解释「为什么」；错误收敛为单一判别入口，未来新增错误类（如 C 阶段
  ChannelError）只改 `errors.ts` 一处。
- 测试：现有 12 条测试保持通过；为 bug 修复与新增判别补回归测试。

## 3. 技术方案

- 模块改动：
  - `src/agent/errors.ts`：`abstract class TaggedError`（不导出，模块私有）+ 子类 + `isKnownError`。
  - `src/agent/dsh-client.ts`：`ChunkEvent` / `TurnEndEvent` 类型、私有 `chunkDeltaOf`、
    `SendOptions` 接口、`sendPrompt(harness, prompt, options?)` 签名、删 `SendResult.ok`、
    同源导入合并为单行。
  - `src/agent/sdk-profile.ts`：`pathSeparatorOf(isWindows)` 纯函数 + `resolveDshBin` 使用；
    `ensureSdkProfile` 错误信息含 `result.error?.message`。
  - `src/cli.ts`：目录聚合导入、`Errors.isKnownError` 单分支 catch、`runSend` 返回 `void`、
    `sendPrompt` 新签名调用（onText→stdout / onThinking→stderr 灰字）。
  - `src/index.ts`：apply 注释改为「无需清理，返回 void」。
  - `src/cli.test.ts` / `src/index.test.ts`：聚合导入、`as never` 改显式类型断言、补回归测试。
- 关键数据结构：
  ```ts
  interface SendOptions {
    onText?: (delta: string) => void
    onThinking?: (delta: string) => void
  }
  interface SendResult { sessionId: string; finalResponse: string }
  ```
- 依赖：无新增。

## 4. 接口定义

- CLI 命令签名不变：`dsh-octo-bot send <prompt> [-m <model>]`。
- `sendPrompt` 签名变更（内部 API，唯一调用方 cli.ts 同步改造）：
  `sendPrompt(harness, prompt, options?: SendOptions): Promise<SendResult>`。

## 5. 验收标准

- [x] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` 全部通过（退出码 0）。
- [x] AC2：grep 验证——`src/` 无 `SendResult.ok` / `ok: true` / `as never` / 直连
      `./agent/*.js`、`./config/*.js` 子模块导入残留（cli.ts、cli.test.ts 消费走 index）。
- [x] AC3：实机回归——`node bin/dsh-octo-bot.mjs send "你好"` 返回正常中文回答，
      流式正文在 stdout、思考增量灰色在 stderr、末尾 session 行正常。
- [x] AC4：新增回归测试通过——`isKnownError` 收窄、`pathSeparatorOf` 平台分隔、
      `resolveDshBin` 在 PATH 中解析 `dsh.cmd`（Windows）。

## 6. 测试计划

- 单元测试：
  - `cli.test.ts`「结构化错误」段追加 `isKnownError` 判别用例（DshError/CliError 为 true、
    普通 Error 为 false）。
  - `cli.test.ts` 或 `sdk-profile` 段追加 `pathSeparatorOf(true/false)` 与
    `resolveDshBin({ PATH: tmpDir })` 找到 `dsh.cmd` 的用例（Windows 分支）。
  - 现有通知翻译 4 用例保持通过（验证 chunkDeltaOf 收敛后语义不变）。
- 手动验证：实机 send 回归（AC3）。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| 立项（TODO + PRD） | 10 分钟 |
| errors.ts 重构 | 15 分钟 |
| dsh-client.ts 重构 | 20 分钟 |
| sdk-profile.ts 修复 | 10 分钟 |
| cli.ts 改造 | 15 分钟 |
| 测试与注释对齐 | 20 分钟 |
| 验证 + 实机回归 | 20 分钟 |
| 收尾（三联动 + PR） | 15 分钟 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 目录聚合 index 引入循环依赖（tsup ESM） | F2 已验证无循环；改动前后跑 build 确认无警告 |
| sdk 通知负载结构在重构中断言错位 | 解析逻辑保持不变，仅类型定义收敛；测试覆盖三种事件 |
| `sendPrompt` 签名变更漏改调用方 | 唯一调用方 cli.ts，typecheck 兜底 |

## 9. 变更记录

> **本小节是需求变更的审计轨迹（强制）**：任何对正文 FR / AC / 技术方案的修改，
> MUST 在此追加一行（日期 + 变更内容 + 理由），并重核受影响 AC（结果留痕）。

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿 | 用户直接指令启动代码审查优化（「审查冗余代码 死代码 优化代码 && 注释！开始！！」），视同批准 |
| 2026-08-14 | 验收：AC1 四件套全绿（typecheck/lint/test 15 passed/build 无循环警告）；AC2 grep 无 `SendResult.ok` / `as never` / 直连子模块导入残留；AC3 实机 send 回归正常（中文回答 + 流式 + session）；AC4 新增 isKnownError / pathSeparatorOf / resolveDshBin 回归测试通过 | 全部 FR 落地，验收标准逐条核验通过 |
| 2026-08-14 | 补全：模块内部跨模块引用改命名空间对象访问——sdk-profile/dsh-client 共 5 处扁平成员导入（`SDK_PROFILE`/`SDK_SERVER_VERSION`/`DshError`/`dshLaunchSpec`）改为 `DshCompat.*`/`Errors.*`/`SdkProfile.*`；import 来源保持源文件（不走目录聚合，避免 index 模块级循环） | Self-Export 一致性补全（评审发现内部引用绕过命名空间，§3.2 要求消费者一律 `ModuleName.Member` 访问）；重核 AC1（四件套全绿、build 无循环警告）、AC2（grep 无扁平成员导入残留）均通过 |
