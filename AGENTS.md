# deepseek-channel-octo 项目开发规则（AGENTS.md）

> 本文件是对**所有 AI agent**（Claude Code / Cursor / 其他协作 agent）以及人类协作者的行为规范。
> 任何人在仓库动手前，必须完整阅读并遵守本文件。
>
> 工作流参考：Rondo 方法（PRD 驱动 × Agent 约束的 AI 结对开发）。
> 见 https://quanming1.github.io/minimal-blog/posts/rondo-method/

## 1. 项目概况

- **deepseek-channel-octo**：把 DeepSeek Harness（dsh）Agent 桥接进 Octo IM——让 dsh agent 能作为 Octo 中的 bot/队友收发消息、执行任务（流式卡片、审批、会话路由）。
- 当前阶段：A1（项目骨架 + CLI + 配置系统）——详见 `docs/TODO.yaml` 的状态标记
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

## 3. 代码风格

- **TypeScript + Node.js >= 22.19**，ESM（`"type": "module"`），类型注解完整。
- 格式化/lint：ESLint（项目配置），导入排序按项目配置。
- 命名：变量/函数 camelCase，类/类型 PascalCase。
- 每个模块文件头部有注释说明职责。
- **注释要求**：复杂逻辑必须写注释，注释写「为什么」而非「是什么」（签名/类型表达「是什么」）。
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
