# PRD-F1-TS-STYLE-GUIDE 规范引入

> 状态：approved（用户 2026-08-14 指令立项：引入 TS-STYLE-GUIDE 作为项目规范指导并开发）

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | F1 |
| 名称 | TS-STYLE-GUIDE 规范引入项目 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | 2026-08-14 |
| 关联文档 | docs/TODO.yaml F1；E:\opencode-src\TS-STYLE-GUIDE.md |

## 1. 背景与目标

- **背景**：项目已具备功能（A2 Hello World 插件 + B1 CLI 消息收发），但代码风格尚未有系统性规范。`E:/opencode-src/TS-STYLE-GUIDE.md` 是从 opencode 蒸馏的 TS 风格模板（类型先行、命名空间模块、结构化错误、函数式优先、反模式清单），将其引入作为项目开发规范指导。
- **目标**：规范落到 AGENTS.md 代码风格章节 + ESLint 规则；现有代码按**核心规范**对齐（重点：结构化错误）；不强行引入与项目规模不匹配的模式（Self-Export 命名空间、Bun 工具链）。
- **非目标**：不做大规模模块重组；不引入 Bun/oxlint/Prettier（项目已用 Node/pnpm/vitest/ESLint）；不重构 B/C 阶段功能行为。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：`AGENTS.md` §3 代码风格按 TS-STYLE-GUIDE 重写——命名规范（`XxxError` 后缀、`Interface`/`Service` 固定名、标称类型同名导出）、函数式优先（const/提前 return/禁 else/函数式方法）、导入规范（禁别名/星号导入、`import type`）、注释规范（JSDoc 意图 + `//` 解释为什么）、反模式 NEVER 清单。
- [ ] FR2：`eslint.config.js` 强化与规范对应的可机检规则（`@typescript-eslint/prefer-const`、`no-else-return`、`@typescript-eslint/no-import-type-side-effects` 等）；TS-STYLE-GUIDE 引用写入 AGENTS.md。
- [ ] FR3：现有代码错误处理按**结构化错误**对齐——业务错误用带 `tag` 的 Error 子类 + `isInstance` 收窄 + 模块错误联合；`src/agent/` 与 `src/cli.ts` 的 `new Error("message")` 改为结构化错误（`DshError`、`CliError`）。
- [ ] FR4：测试对齐——失败路径用 `rejects.toMatchObject({ tag: ... })` 断言结构化错误（现有错误相关测试补充）。
- [ ] FR5：核心原则写入 AGENTS.md（类型是设计工具、错误是类型的一部分、注释解释为什么）。

### 2.2 非功能需求

- 兼容性：规范不改变功能行为（B1 send 流程照旧）；typecheck/lint/test 保持全绿。
- 可维护性：新代码从 F 阶段起强制符合 AGENTS.md §3；旧代码按结构化错误优先对齐。

## 3. 技术方案

- **裁剪决策**（按项目规模）：
  - 引入：命名规范、函数式优先、导入规范、注释规范、结构化错误、反模式清单
  - 不引入：Self-Export 命名空间（文件内自导出在 tsup ESM 构建下有循环引用风险，且项目规模小）、Bun 工具链（项目为 Node/pnpm）、Drizzle 建模（无数据库）
- 错误建模（`src/agent/errors.ts`）：
  ```ts
  export class DshError extends Error {
    readonly tag = "DshError" as const
    constructor(message: string, public readonly cause?: unknown) { super(message); this.name = "DshError" }
    static isInstance(error: unknown): error is DshError { ... }
  }
  export type Error = DshError
  ```
- eslint 追加规则：`@typescript-eslint/prefer-const`、`no-else-return`、`@typescript-eslint/no-restricted-imports`（禁 `import * as` 与别名导入，如适用）。
- AGENTS.md §3 替换为规范核心 + 反模式清单 + TS-STYLE-GUIDE 引用路径。

## 4. 接口定义

- 无公开接口变更（CLI/插件行为不变）。
- 内部错误类型：`DshError`（dsh 运行时错误）、`CliError`（CLI 使用错误）——带 `tag` 字段。

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿。
- [ ] AC2：`AGENTS.md` §3 含 TS-STYLE-GUIDE 核心规则与反模式清单，并引用源文档路径。
- [ ] AC3：`src/` 下不再有裸 `new Error("...")` 处理业务失败（改用 `DshError`/`CliError` 结构化错误）。
- [ ] AC4：错误路径测试用 `rejects.toMatchObject({ tag })` 断言。
- [ ] AC5：`dsh-octo-bot send` 功能行为不变（失败路径错误消息仍清晰）。

## 6. 测试计划

- 单元：错误类 `isInstance` 收窄、CLI 失败路径（无 dsh / 无 key）返回结构化错误。
- 回归：现有 8 tests 保持通过；`send` 实机或 mock 路径不回归。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| AGENTS.md §3 重写（规范核心 + 反模式） | 1 |
| eslint 规则强化 | 0.5 |
| 结构化错误（errors.ts + 各模块改造） | 1.5 |
| 测试对齐 + 验证 | 1 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 结构化错误改造引入回归 | 保持错误消息文本不变（仅换类型）；测试覆盖失败路径 |
| eslint 新规则误伤现有代码 | 规则先在现有代码上试跑，冲突处按规范修代码而非关规则 |

## 9. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿（approved） | 用户指令：引入 TS-STYLE-GUIDE 作为项目规范指导并开发 |
