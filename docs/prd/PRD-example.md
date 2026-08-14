# REFERENCE ONLY — reverse-engineering sample (Chinese original from Rondo assets). Do not copy Chinese content into project PRDs; use PRD-TEMPLATE.md for new phases.
# PRD-A1-cli-config

> 【示例 PRD】展示一份定稿并已验收的 PRD 长什么样——含已勾选的 FR/AC 与变更记录。
> 复制为模板参考（虚构项目：一个待办清单 CLI 工具）。新阶段从 PRD-TEMPLATE.md 开始。

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A1 |
| 名称 | CLI 骨架 + 配置系统 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-01 |
| 定稿日期 | 2026-08-02 |
| 验收日期 | 2026-08-05 |
| 关联文档 | docs/TODO.yaml A1；docs/ROADMAP.md §Step 1 |

## 1. 背景与目标

- **背景**：项目需要一个可执行入口与用户配置能力——所有后续阶段（数据处理、输出、服务化）都依赖统一的 CLI 与配置基座。
- **目标**：`todo` 命令可运行（`todo --version` / `todo add` / `todo list`），配置读写可用，为后续阶段提供稳定基座。
- **非目标**（防止范围蔓延）：
  - 不做数据持久化（数据格式留到 A2）
  - 不做交互式 TUI（留到 E4）
  - 不做认证 / 多用户

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：`todo` 根命令，支持 `--version` 输出版本号
- [x] FR2：配置系统——`~/.todo/config.yaml` 读写（load / save / get / set）
- [x] FR3：`todo add "<内容>"` 添加待办（输出成功提示）
- [x] FR4：`todo list` 列出全部待办
- [x] FR5：Provider 抽象——配置可切换后端（默认 file 本地存储，为后续扩展预留接口）

### 2.2 非功能需求

- 性能：命令启动 < 200ms
- 安全：配置文件含敏感字段时提示权限；不输出明文 secrets
- 兼容性：Windows / Linux / macOS；路径用 pathlib

## 3. 技术方案

- 模块：
  - `src/cli.py`——click 命令组（根命令 + add/list 子命令）
  - `src/config.py`——`~/.todo/config.yaml` 读写（load / save / get / set）
  - `src/storage.py`——存储抽象（file 实现，JSON 文件）
- 依赖：click（CLI）、PyYAML（配置解析）、pytest（测试）

## 4. 接口定义

```bash
todo --version              # 输出 v0.1.0
todo add "买牛奶"            # 添加待办
todo list                   # 列出全部待办
```

```yaml
# ~/.todo/config.yaml
storage:
  type: file
  path: ~/.todo/todos.json
```

## 5. 验收标准

- [x] AC1：`todo --version` 输出 `v0.1.0`
- [x] AC2：`todo add "买牛奶"` 后 `todo list` 显示该待办
- [x] AC3：`pytest tests/` 全部通过（18 用例）
- [x] AC4：`ruff check .` 无警告
- [x] AC5：配置文件读写端到端验证（含 Windows 路径兼容）

## 6. 测试计划

- 单元测试：CLI 命令解析、配置读写（tmp_path 隔离）、存储增删查
- 手动验证：真实 `todo add / list` 端到端、配置缺失时默认值兜底

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| CLI 骨架（click 命令组） | 0.5 天 |
| 配置系统（load/save/get/set） | 0.5 天 |
| 存储抽象（file 实现） | 0.5 天 |
| 测试 + 端到端验证 | 0.5 天 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 配置路径在 Windows/Linux 差异 | pathlib + `~` 展开统一处理，跨平台测试覆盖 |
| 存储格式变更导致旧数据不兼容 | 版本字段 + 迁移说明（A2 处理） |

## 9. 变更记录

> 本小节是需求变更的审计轨迹（强制）。每条修改 MUST 追加一行并重核受影响 AC。

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-02 | 初始定稿 | 需求评审通过，冻结 |
| 2026-08-03 | FR5 补充"默认 file 本地存储"表述 | 开发中发现后端抽象若无默认实现，空接口无法验收；补默认实现并更新 AC2 关联存储 |
| 2026-08-04 | AC2 改为"add 后 list 显示" | 原 AC2 只验 add 不验闭环；改为 add → list 全链路可验收。AC2 已重跑通过 |
| 2026-08-05 | 勾选 FR1-FR5 与 AC1-AC5 | 全部验收通过（18 用例 + ruff 全过 + 端到端） |
