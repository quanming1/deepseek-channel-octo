# PRD-A1-开源仓库与项目脚手架

> 状态：approved（用户 2026-08-14 指令立项：先做 dsh Hello World 插件 MVP）

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A1 |
| 名称 | GitHub 开源仓库 + 项目脚手架 |
| 状态 | approved |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml A1 |

## 1. 背景与目标

- **背景**：为 deepseek-channel-octo 建立可开源、可安装、可测试的工程基座。当前仓库只有规范文件（Rondo 方法工作流），没有实际工程产物。第一步目标是让项目成为公开仓库，并具备 TypeScript 插件开发的完整脚手架。
- **目标**：GitHub 公开仓库（用户账号下 `deepseek-channel-octo`）+ 完整 TypeScript ESM 脚手架（构建 / 类型检查 / 测试 / lint），许可证 Apache-2.0。
- **非目标**：本阶段不写插件业务逻辑（A2 做 Hello World 插件）；不做 dsh runtime 集成（B 阶段）；不做 Octo 通道（C 阶段）。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：在用户 GitHub 账号下创建公开仓库 `deepseek-channel-octo`，本地 `project/` 作为其工作树，配置远程 `origin`。
- [ ] FR2：`package.json`：ESM（`"type": "module"`）、`name: deepseek-channel-octo`、engines `node >= 22.19`、scripts（`build` / `typecheck` / `test` / `lint`）、packageManager pnpm。
- [ ] FR3：TypeScript 配置（`tsconfig.json`，strict + NodeNext 解析）+ tsup 构建 + vitest 测试框架 + ESLint。
- [ ] FR4：`LICENSE`（Apache-2.0 全文）+ `README.md`（项目简介、安装、工作流引用）。
- [ ] FR5：脚手架自带一个冒烟测试（如 `src/smoke.ts` 导出常量 + 对应测试），验证工具链全链路可用。

### 2.2 非功能需求

- 性能：构建产物可被 Node >= 22.19 直接运行（ESM）。
- 兼容性：Windows / Linux / macOS 三平台可安装依赖与运行测试。
- 安全：仓库不含 secrets；`.gitignore` 覆盖 `.env`、`node_modules`、`dist`。

## 3. 技术方案

- 目录布局：
  ```
  project/
  ├── package.json          # ESM、engines、scripts
  ├── tsconfig.json         # strict、NodeNext
  ├── tsup.config.ts        # 构建入口 src/index.ts -> dist
  ├── vitest.config.ts      # 测试配置
  ├── eslint.config.js      # ESLint flat config
  ├── src/
  │   ├── index.ts          # 插件入口（A2 填充业务，A1 先放冒烟导出）
  │   └── index.test.ts     # 冒烟测试
  ├── LICENSE               # Apache-2.0
  └── README.md
  ```
- 依赖选型（全部声明在 `package.json`）：
  - dev: `typescript`、`tsup`、`vitest`、`eslint`、`@types/node`
  - 运行时依赖：A1 不引入（A2 引入 `@deepseek-ai/cordis`）
- 构建：`tsup src/index.ts --format esm`，产物 `dist/`。

## 4. 接口定义

- 无公开 CLI/HTTP 接口（A1 是工程基座）。冒烟导出：
  ```ts
  export const PKG_NAME = 'deepseek-channel-octo'
  ```

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` 通过，无错误。
- [ ] AC2：`pnpm lint` 通过，无警告。
- [ ] AC3：`pnpm test` 通过（冒烟测试断言 `PKG_NAME` 值）。
- [ ] AC4：`pnpm build` 产出 `dist/index.js`，Node 可 import。
- [ ] AC5：GitHub 仓库公开可见，`git remote -v` 指向它，`main` 分支已推送。
- [ ] AC6：`LICENSE` 为 Apache-2.0 全文；`README.md` 含项目简介与工作流引用。

## 6. 测试计划

- 冒烟测试：`PKG_NAME` 导出值断言。
- 手动：三平台（至少本机 Windows）跑 `pnpm install && pnpm typecheck && pnpm test`。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| package.json + tsconfig + tsup + vitest + eslint 引导 | 1 |
| 冒烟源码 + 测试 | 0.5 |
| LICENSE + README | 0.5 |
| GitHub 仓库创建 + 推送 | 0.5 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| gh CLI 未认证 / 无权限建库 | 退化为手动建库指引（README 说明），或询问用户提供 token |
| pnpm 未安装 | 引导 `corepack enable` 或 npm 替代 |

## 9. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿（approved） | 用户指令：先做 dsh Hello World 插件 MVP，本阶段为工程基座 |
| 2026-08-14 | 开发完成：脚手架落地，typecheck/lint/test/build/import 全绿 | 记录 A1 开发收尾（AC1-AC6 已验证） |
