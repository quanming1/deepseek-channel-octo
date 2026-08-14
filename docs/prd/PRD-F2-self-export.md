# PRD-F2-Self-Export 命名空间引入

> 状态：approved（用户 2026-08-14 指令：引入 TS-STYLE-GUIDE 的 Self-Export 命名空间模式）
> 前置：F1 裁剪决策修正——已在 tsup ESM 下实验验证可行（typecheck/build 通过、无循环警告）

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | F2 |
| 名称 | Self-Export 命名空间引入 |
| 状态 | approved |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml F2；E:\opencode-src\TS-STYLE-GUIDE.md §3 |

## 1. 背景与目标

- **背景**：F1 引入 TS-STYLE-GUIDE 时裁剪了 Self-Export 命名空间模式（担忧 tsup ESM 循环引用）。用户明确要求引入。已在 `feature/F2-self-export` 分支实验验证：文件内 `export * as X from "./self"` 在 tsc + tsup 下 typecheck/build 均通过，无循环警告，运行时正常——裁剪理由不成立，正式引入。
- **目标**：项目所有模块文件采用 Self-Export 模式（文件顶部导出自己的命名空间），消费者通过 `ModuleName.Member` 访问；目录加 `index.ts` 聚合导出；AGENTS.md §3 补 Self-Export 规则。
- **非目标**：不改功能行为；不引入 Bun 等其他工具链（维持 F1 裁剪）。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：`src/config/dsh-compat.ts` 文件顶部加 `export * as DshCompat from "./dsh-compat"`。
- [ ] FR2：`src/agent/errors.ts` 加 `export * as Errors from "./errors"`；`src/agent/sdk-profile.ts` 加 `export * as SdkProfile from "./sdk-profile"`；`src/agent/dsh-client.ts` 加 `export * as DshClient from "./dsh-client"`。
- [ ] FR3：消费者（`src/cli.ts`、`src/cli.test.ts`、`src/index.test.ts`）改为通过命名空间访问：`DshCompat.SDK_CLIENT_VERSION`、`SdkProfile.resolveDshBin`、`DshClient.sendPrompt`、`Errors.DshError` 等。
- [ ] FR4：目录级聚合：新增 `src/agent/index.ts`（`export * as Errors/SdkProfile/DshClient from "./..."`）与 `src/config/index.ts`（`export * as DshCompat from "./dsh-compat"`）。
- [ ] FR5：AGENTS.md §3 补 Self-Export 规则：ALWAYS 每个模块文件顶部 `export * as ModuleName from "./self"`；消费者用 `ModuleName.Member`；NEVER `import * as X`（模块自己导出命名空间）。

### 2.2 非功能需求

- 兼容性：CLI/插件行为不变；typecheck/lint/test/build 全绿。
- 可维护性：命名空间名 = 文件路径语义名。

## 3. 技术方案

- Self-Export 写法（已验证）：
  ```ts
  // src/agent/dsh-client.ts 文件顶部
  export * as DshClient from "./dsh-client"
  ```
- 消费者：
  ```ts
  import { DshClient } from "./agent/dsh-client.js"
  const result = await DshClient.sendPrompt(harness, prompt)
  ```
- 目录聚合（§3.2）：
  ```ts
  // src/agent/index.ts
  export * as Errors from "./errors"
  export * as SdkProfile from "./sdk-profile"
  export * as DshClient from "./dsh-client"
  ```
- tsup/tsc 验证结论：文件内自我引用导出被正确处理，无循环依赖警告（F2 分支实验证据）。

## 4. 接口定义

- 无公开接口变更。模块导出面从扁平命名变为命名空间（对外包入口 `dist/index.js` 不变——`src/index.ts` 是插件入口，非模块库入口）。

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿（12+ tests）。
- [ ] AC2：`pnpm build` 成功，无循环依赖警告。
- [ ] AC3：所有模块文件顶部有 `export * as X from "./self"`；消费者无扁平导入 `import { createHarness } from "..."` 直接访问模块内部函数（聚合命名空间访问）。
- [ ] AC4：AGENTS.md §3.2 含 Self-Export 规则（ALWAYS/NEVER）。
- [ ] AC5：`dsh-octo-bot send` 功能回归正常。

## 6. 测试计划

- 现有 12 tests 保持通过（import 路径更新后）。
- 新增：命名空间访问冒烟断言（如 `DshCompat.SDK_CLIENT_VERSION` 与扁平值一致）。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| 各模块加 self-export + index 聚合 | 0.5 |
| 消费者改命名空间访问 | 1 |
| AGENTS.md 补规则 + 测试 | 0.5 |
| 验证 + 回归 | 0.5 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 命名空间访问引入导入路径错误 | typecheck 兜底；逐一验证消费者 |
| tsup 打包树摇掉命名空间导出 | 实验已验证 dist 正常；回归 build + import 冒烟 |

## 9. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿（approved） | 用户指令：引入 Self-Export 命名空间；F1 裁剪修正 |
