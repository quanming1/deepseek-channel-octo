# deepseek-channel-octo 项目开发规则（AGENTS.md）

> 本文件是对**所有 AI agent**（Claude Code / Cursor / 其他协作 agent）以及人类协作者的行为规范。
> 任何人在仓库动手前，必须完整阅读并遵守本文件。
>
> 工作流参考：Rondo 方法（PRD 驱动 × Agent 约束的 AI 结对开发）。
> 见 https://quanming1.github.io/minimal-blog/posts/rondo-method/

## 1. 项目概况

- **deepseek-channel-octo**：把 DeepSeek Harness（dsh）Agent 桥接进 Octo IM——让 dsh agent 能作为 Octo 中的 bot/队友收发消息、执行任务（流式卡片、审批、会话路由）。
- 当前阶段：A1（GitHub 开源仓库 + 项目脚手架）——详见 `docs/TODO.yaml` 的状态标记
- 关键文档：
  - `docs/TODO.yaml` — 结构化 TODO 清单（**开发的唯一执行依据**）
  - `docs/PROCESS.md` — 推进管理办法（六步闭环）
  - `docs/prd/` — 阶段 PRD（每个阶段一份，PRD 是开发的唯一依据）

## 2. 工作方式

1. **严格按 `docs/TODO.yaml` 的阶段顺序推进，不跳步、不越权**——每步只做该步清单内的任务。
2. 每阶段完成标准：代码 + 测试 + 文档 + 可独立验收（对照 TODO 中的「验收」条目）。
3. 动手前先读相关文档与现有代码，遵循已有模式与风格；不另起一套并行模式。
4. 不引入未声明的依赖；用任何库前先确认已在 `package.json` 声明。
5. 只改任务范围内的文件；不做用户没要求的额外改动。
6. 同一问题反复改不好就停下，回到初始假设与失败证据重新判断，换方向。

## 3. 代码风格（TS-STYLE-GUIDE）

> 本仓库 TypeScript 风格基线蒸馏自 opencode，完整规范见 `E:/opencode-src/TS-STYLE-GUIDE.md`。
> 以下为核心规则；冲突时以本节为准，未覆盖处回源文档。

### 3.1 核心原则

- **类型是设计工具**：数据模型先于实现；跨边界数据（存储、网络、配置）先定义类型，再写逻辑。
- **错误是类型的组成部分**：可预期的失败用结构化错误（判别联合），不可预期的缺陷直接抛出。
- **注释解释「为什么」，不解释「是什么」**：代码本身说明做什么；注释只记录约束、动机和非显然行为。

### 3.2 模块组织：Self-Export 命名空间

- ALWAYS 每个模块文件顶部导出自己的命名空间：`export * as ModuleName from "./self"`（如 `dsh-client.ts` 顶部 `export * as DshClient from "./dsh-client"`）。
- ALWAYS 消费者通过 `ModuleName.Member` 访问，禁止 `import { foo as bar }` 别名导入。
- NEVER 使用 `import * as Foo from "..."` 星号导入——模块自己导出命名空间（eslint 强制禁止星号导入）。
- ALWAYS 目录内建 `index.ts` 聚合透传各模块命名空间（`export * as X from "./x"`），消费者从目录入口统一引用。
- 命名空间名 = 文件路径语义名（`agent/dsh-client.ts` → `DshClient`）。

### 3.3 命名规范

| 对象 | 风格 | 示例 |
|---|---|---|
| 文件/模块 | camelCase | `dsh-client.ts`、`sdk-profile.ts` |
| 类型/接口/类 | PascalCase | `SendResult`、`DshError` |
| 常量 | camelCase | `const SDK_PROFILE = 'octo-sdk'` |
| 函数/方法 | camelCase 动词开头 | `createHarness()`、`sendPrompt()` |
| 服务接口 | 固定名 `Interface` | `export interface Interface { ... }` |
| 服务实现 | 固定名 `Service` | `export class Service implements Interface { ... }` |
| 错误类 | `XxxError` 后缀 + `tag` 字段 | `DshError`、`CliError` |
| 标称类型 | `XxxID` 或类型值同名 | `type ID = string & { readonly __brand: "..." }` |

### 3.3 函数式优先（纯 TS）

- ALWAYS `const`；需要重赋值时用三元或提前 return，**不用 `let`**（eslint 强制）。
- ALWAYS 提前 return，**避免 `else`**（eslint 强制）。
- ALWAYS 用 `map` / `filter` / `flatMap` / `find` / `some` / `every`，不手写 for 循环收集。
- NEVER 为单次使用的逻辑抽 helper；helper 被复用或有清晰命名时才抽取，放在**主函数下方**（主函数保持 happy path）。
- NEVER 无上下文解构（`const { a, b } = obj` 丢失来源）；保留 `obj.a` / `obj.b`。
- 纯函数与 IO 分离：有副作用的函数与纯同步 helper 分开。

### 3.4 错误处理（结构化错误）

- ALWAYS 业务错误用带 `tag` 字段的 Error 子类定义（`src/agent/errors.ts` 为模板）：
  ```ts
  export class DshError extends Error {
    readonly tag = 'DshError' as const
    constructor(message: string, cause?: unknown) { super(message); this.name = 'DshError'; if (cause !== undefined) this.cause = cause }
    static isInstance(error: unknown): error is DshError { /* 按 tag 判断 */ }
  }
  ```
- ALWAYS 同一模块的错误收敛为类型联合（`export type Error = DshError | CliError`）。
- ALWAYS 期望内处理：先判定是否业务错误（`isInstance`），按 `tag` 分支；未知错误冒泡。
- NEVER 用裸 `try/catch` 包裹可预期逻辑；异步边界包装底层异常为业务错误（带 `cause`）。

### 3.5 导入规范

- ALWAYS 静态导入在顶部；重型模块只在需要处动态 `await import(...)`，且放最窄作用域。
- NEVER 别名导入（`import { foo as bar }`，eslint 强制）；NEVER 星号导入（`import * as X`）。
- ALWAYS 类型导入用 `import type` 或 inline `type` 修饰符。

### 3.6 注释规范

- ALWAYS 为**非显然的约束和意外行为**写注释；不为显而易见的赋值/控制流写注释。
- JSDoc（`/** */`）用于模块级常量、类型、公共方法——一句话说明意图；有副作用/抛错标注 `@throws`。
- `//` 注释解释「为什么」：动机、取舍、历史原因、上游 bug 规避。
- TODO 注释说明未来方向和判断标准，不写空泛 TODO。

### 3.7 反模式清单（NEVER）

- NEVER `import * as Foo` 或 `import { foo as bar }`。
- NEVER 用 `any`（含隐式）；用 `unknown` + 收窄，或标称类型。
- NEVER 裸 `try/catch` 处理可预期业务错误——抛结构化错误，按 `tag` 分支。
- NEVER 为单次使用抽 helper；NEVER 让主函数像面条而细节藏在别处。
- NEVER 用 `let` 配合重赋值写可被三元/提前 return 替代的逻辑。
- NEVER 用 `else`；NEVER 无谓解构。
- NEVER 用默认导出；全部命名导出。
- NEVER 留下死代码、空函数、占位 TODO；旧结构被替代后彻底删除（含回退分支、兼容标记）。
- NEVER 用裸 `string` / `number` 表示有领域的值——标称类型或枚举。
- NEVER 提交 secrets / keys。

### 3.8 技术栈与语言

- **TypeScript + Node.js >= 22.19**，ESM（`"type": "module"`），类型注解完整。
- 格式化/lint：ESLint（规则见 `eslint.config.js`）。
- **语言规范**：代码注释、提交信息、文档统一使用**中文**；type/scope 保持英文；代码标识符保持英文。
- **禁用 emoji**：代码、注释、文档、提交信息、终端输出一律不使用 emoji；状态用文字或 ASCII 标记（[x] / [ ]）。

## 4. Git Flow 规范（强制）

### 4.1 分支模型（单 main）

```
main            ← 仅存放可发布版本（受保护语义：永不直接提交）
  └─ feature/<name>   新功能 / 新任务（从 main 切出）
  └─ release/<ver>    发布准备（版本号冻结、回归测试）
  └─ hotfix/<name>    生产紧急修复（从 main 切出，PR 合入 main）
```

### 4.2 分支规则

- 默认工作分支是 **main**；main 永不直接提交代码。
- **全 PR 流**：进入 main 的每笔改动一律走 GitHub PR/MR（Code Review）——本地只 push feature 分支，禁止本地 merge 进 main（pre-push hook 强制，见 §4.7）。
- 每个任务/功能开独立分支：`git checkout -b feature/<阶段id>-<short-name> main`，**feat/fix 分支名必须关联 TODO 阶段 id**（如 `feature/A1-config`）。
- **交叉校验**：feat/fix 提交的 scope 必须与分支名中的阶段 id 一致（commit-msg hook 强制）。
- 规划类专用分支：`prd-update`（PRD 文档提交）、`todos-update`（TODO 文档提交），见 §4.3。

### 4.3 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>
```

示例：
```
feat(A1): 搭建 CLI 骨架与配置系统
fix(B2): 修复会话续跑竞态
docs(roadmap): 明确 C1 验收标准
refactor(adapter): 从 sdk-runtime 抽取 agent 工厂
```

- **subject 使用中文**（type/scope 保持英文）。
- type：`feat` / `fix` / `prd` / `todos` / `docs` / `refactor` / `test` / `style` / `chore` / `perf`
- **scope 分三类**：
  - `feat` / `fix` / `prd` / `todos`：scope **必须**是 TODO 阶段标识（如 `A1` / `C2`），且**必须真实存在于 `docs/TODO.yaml`**（commit-msg hook 强制校验）。
  - `feat` 额外强制：暂存必须包含对应阶段 PRD（`docs/prd/PRD-<scope>-*.md`）——行为变更必须同步 PRD 变更记录。
  - `prd` / `todos`：只在专用分支提交，且暂存文件必须全部在 `docs/` 下。
  - 其他 type：scope 用模块名（见 `.githooks/check_commit_msg.py` 顶部「裁剪点」）。
- **一条提交只做一件事**；禁止 `fix stuff`、`update`、`misc` 这类无意义 message。
- **本地强制**：`.githooks/commit-msg` hook 校验上述规则，不符合直接拒绝提交。
- 提交前自查：`git status` 确认无多余文件；`git diff` 通读改动。

### 4.4 合并策略

- `feature/*` → `main`：**一律走 GitHub PR/MR（Code Review）**——push 分支后提 PR，**禁止本地 `git merge --no-ff` 合并回 main**（pre-push hook 强制）。
- **禁止 rebase 重写已推送历史**；合并前必须解决冲突且测试通过。

### 4.5 版本与 tag

- 语义化版本 SemVer：`MAJOR.MINOR.PATCH`。
- 每次发布在 main 打 tag：`v<version>`。
- 版本号集中管理：`package.json`。

### 4.6 禁止事项

- 直接向 main 提交 / 推送代码。
- **本地 `git merge` 任何分支到 main**（main 只接受 PR 合入）。
- 在 main 之外堆积长期未合并的分支工作。
- 把 secrets / API key / 配置文件提交进仓库。
- 遗留临时文件、调试代码、`.bak`、未使用的死代码。

### 4.7 本地保护（pre-push hook）

- 仓库内置 `.githooks/pre-push`：
  - **禁止把非 main 分支直接 push 到 main**（发布推送除外；禁止删除远程 main）。
  - **禁止 main 的本地领先提交中含本地 merge**——main 只接受 PR 合入。
- clone 后执行一次：`git config core.hooksPath .githooks`。
- 说明：GitHub free 账号 private 仓库无法开启服务端 branch protection，此 hook 是本地强制替代；**AI agent 与人同规则**。

### 4.8 标准流程（每次任务）

```bash
git checkout main && git pull              # 1. 同步基底
git checkout -b feature/<阶段id>-<task>    # 2. 开任务分支
# ... 开发 + 本地测试（lint / test）...
git add <改动文件>                          # 3. 提交（conventional）
git commit -m "feat(A1): <描述>"
git push origin feature/<阶段id>-<task>    # 4. 推送 feature 分支（pre-push hook 放行）
# ... 在 GitHub 上提 PR：feature/<阶段id>-<task> → main（Code Review）...
git checkout main && git pull              # 5. PR 合入后同步
```

## 5. 测试

- 测试框架：**vitest**（`test/` 目录，镜像包结构）。
- 每个新功能必须配测试；每个 bug 修复必须配回归测试。
- 提交/合并前本地必须通过：`pnpm test` + `pnpm lint` + `pnpm typecheck`。
- 测试不依赖真实外部凭据——用 mock / fake。

## 6. 文档

- 新模块 / 新命令 / 行为变更必须同步更新 `docs/` 与 `README.md`。
- **日志与变更记录（强制）**：
  - 每次功能 / 修复 / 行为变更完成，必须同步更新 `CHANGELOG.md`（追加到 `[未发布]` 对应小节）。
  - 重大架构决策记入对应阶段 PRD 的「变更记录」（日期 + 决策 + 理由）。
  - 提交历史是项目的执行日志：commit message 必须可追溯（对应 TODO 条目）。

## 7. PRD 驱动开发（强制）

- **先 PRD，后开发**：每个 TODO 阶段开工前，必须先在 `docs/prd/` 创建对应 PRD（从 `docs/prd/PRD-TEMPLATE.md` 复制），评审定稿（状态 `approved`）后才能开发。
- **PRD 是开发的唯一依据**：需求、实现、测试、验收全部对照 PRD；禁止开发 PRD 未定义的内容；范围变更必须走 PRD「变更记录」。
- **验收按 PRD 标准**：每阶段完成必须按 PRD「验收标准」逐条核对，全部通过才算完成。
- **生命周期状态机（强制）**：PRD 状态必须随流程实时流转——`草稿 → approved（评审定稿） → 开发中 → 已验收`，禁止跳变（approved / 已验收必须留档日期）。TODO.yaml 立项即标 `in_progress`，验收通过才 `done`。
- **收尾三联动（强制）**：阶段收尾 = PRD 标 `已验收` + TODO 标 `done` + CHANGELOG 追加，三者缺一不可。
- **变更双路径**：需求变更先判断——属于原 PRD 范围（同阶段/同主题/对原 FR·AC 的修正细化）→ 修改正文 + **MUST 在末尾「变更记录」追加（日期+变更+理由）** + 重核受影响 AC；超出范围 / 新阶段 / 全新主题 → 新开 PRD 走完整闭环。
- 推进管理办法详见 `docs/PROCESS.md`。

## 8. 安全与边界

- 不引入 / 记录 secrets；API key 只存本地配置文件（已 .gitignore）或环境变量。
- 凭据值绝不进入配置、聊天记录或提交信息——用环境变量名引用（`apiKeyEnv` 风格），不写字面密钥。

## 9. 兼容性要求（强制）

### 9.1 跨平台（Windows / Linux / macOS）

- 路径一律用 `node:path` 的 join/resolve 处理，禁止硬编码分隔符与盘符。
- 禁止依赖平台特有命令或 shell 语法；执行子进程用参数列表显式传入。
- 源文件统一 LF 换行。

### 9.2 编码

- 所有文件读写显式指定 `encoding="utf-8"`。
- 读取用户输入文件时兼容常见编码（UTF-8 / BOM / GBK 等），失败回退。
- 禁止向终端 / 文件输出乱码。

### 9.3 测试与 CI

- CI 必须覆盖主要平台（ubuntu + windows + macos 矩阵，见 `.github/workflows/ci.yml`）。
- 涉及路径、编码、子进程的功能必须有跨平台测试用例。
- 不在工作区留临时文件；调试产物放系统临时目录，用完即清。

> 核心原则只有一条：**约束写进仓库、能被读取、能被强制，AI 与人类同规则**。
> 细节按项目规模裁剪——规范是护栏，不是迷宫。
