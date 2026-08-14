# PRD-C3-Bot 配置化与多 Bot 支持

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | C3 |
| 名称 | Bot 配置化与多 Bot 支持 |
| 状态 | 立项中 |
| 创建日期 | 2026-08-14 |
| 关联文档 | docs/TODO.yaml 阶段 C3；docs/prd/PRD-C2-octo-channel.md（单 bot MVP 基线）；docs/deepseek-ecosystem.md（openclaw 蓝本 account 机制） |

## 1. 背景与目标

- **背景**：C2 实机跑通单 bot 通路，但 bot 配置挂在临时 bat 的环境变量上
  （`OCTO_API_URL/OCTO_BOT_TOKEN/OCTO_BOT_UID`），换 bot 要改脚本重启、多 bot 完全无法并行。
  用户提出把 bot 配置正式化为**插件的配置文件**，支持配置多个 bot。
- **目标**：新增 `octo.config.yaml` 配置文件（apiUrl + bots 列表），daemon 按配置启动——
  **每个 bot 独立 register + 独立 WS 连接，共享同一个 dsh 大脑（SdkDshAdapter）**；
  无配置文件时回退现有环境变量（兼容 C2 启动方式）。
- **非目标**：bot 热加载/运行时动态增删、bot 管理命令、配置文件加密存储、
  每 bot 独立模型/独立 cwd（共享 adapter 的前提下）。

## 2. 需求范围

### 2.1 功能需求

- **FR1 配置文件**：`octo.config.yaml`（默认当前工作目录；`OCTO_CONFIG` 环境变量可覆盖路径）。
  结构：`apiUrl`（必填）+ `bots` 列表（≥1，每项 `botUid`/`botToken` 必填，
  `name`/`accountId`/`allowedGroups` 可选，accountId 默认 botUid）。
  字段缺失或列表为空 → 启动报错（CliError，指明缺什么）。
- **FR2 多 bot 装配**：daemon 遍历 bots，每个 bot 独立执行 register → 独立 WS 连接
  （uid=robot_id、token=im_token、wsUrl 三级优先级）→ 独立 OctoChannelBridge；
  **共享同一个 SdkDshAdapter**（harness 按 cwd 缓存）；会话 key `octo:<accountId>:<chatId>`
  按 accountId 隔离；任一 bot 断开不影响其他 bot。
- **FR3 环境变量兼容回退**：配置文件不存在（且 OCTO_CONFIG 未指定）→ 回退现有
  `OCTO_API_URL/OCTO_BOT_TOKEN/OCTO_BOT_UID` 单 bot 模式（C2 行为不变）。

### 2.2 非功能需求

- 配置文件不提交仓库（`.gitignore` 排除 `octo.config.yaml`——含 botToken secrets）。
- 新增依赖仅 `yaml`（轻量解析器，dsh 生态 YAML 惯例）。

## 3. 技术方案

- **配置模块** `src/config/octo-config.ts`（新）：`loadOctoConfigFromFile(path?)` 读 YAML →
  `OctoConfig`（apiUrl + bots[]）；`loadOctoConfig(env)`（现有）保留为环境变量回退；
  顶层 `loadDaemonConfig()` 决策：OCTO_CONFIG 指定路径 → 文件加载；无 → 检查默认路径
  `./octo.config.yaml`；仍无 → 环境变量回退。
- **daemon 装配** `src/bridge/run-octo.ts`：`runOctoDaemon` 改造——按配置生成
  `Array<{botUid, botToken, wsUrl, accountId, allowedGroups}>`，for 循环：
  register → 校验 robot_id 与配置一致 → new OctoChannelBridge（共享同一 adapter）；
  `bridge[]` 统一 start；SIGINT/SIGTERM → 遍历 stop + adapter.dispose。
- **OctoChannelBridge 不改构造**（已支持单 bot 参数；多实例即多 bot）。
- 日志：每 bot 启动/连接/断开分别打印（`[octo] bot=<uid> 已连接`）。

## 4. 接口定义

```yaml
# octo.config.yaml（示例）
apiUrl: https://im.deepminer.com.cn/api
# wsUrl: wss://im.deepminer.com.cn/ws   # 可选，默认服务端 register 返回
bots:
  - name: testbot                        # 可选，仅日志
    botUid: 27z6vjqzpke0153fcb1_bot
    botToken: bf_xxx
    # accountId: my-account              # 可选，默认 botUid（会话 key 前缀）
    # allowedGroups: [g1, g2]            # 可选群白名单
```

环境变量（回退模式，与 C2 一致）：`OCTO_API_URL` / `OCTO_BOT_TOKEN` / `OCTO_BOT_UID`。

## 5. 验收标准

- [ ] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` 全绿。
- [ ] AC2：单测覆盖——YAML 解析（结构/默认值/缺失必填抛错）、OCTO_CONFIG 路径覆盖、
  默认路径探测、无配置文件回退环境变量、多 bot 装配（每 bot register + bridge 独立、共享 adapter）。
- [ ] AC3：实机——用 `octo.config.yaml` 启动 daemon 跑通（@bot 发消息 → 回答，行为同 C2）。

## 6. 测试计划

- 单元测试：`src/config/octo-config.test.ts`（fake fs/路径）、`run-octo.test.ts` 扩展
  （多 bot 装配断言：bridge 数量/register 次数/共享 adapter 引用相等）。
- 手动验证：AC3 实机清单（配置文件启动 → 群 @bot → 回答）。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| 配置模块（YAML 解析/校验/回退） | 0.5 天 |
| run-octo 多 bot 装配改造 | 0.5 天 |
| 测试补齐 + 实机验证 | 0.5 天 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| yaml 依赖引入与 pnpm 版本冲突 | 锁定 `yaml@^2`；装完跑四件套回归 |
| 多 bot 共享 adapter 的并发（同 cwd 同 harness 串行 run） | MVP 接受串行（同 cwd 同时只跑一个 run）；并发队列属 C4 会话路由范畴 |
| 配置文件 token 泄漏入库 | `.gitignore` 排除 + README 说明（.env.example 式文档示例） |

## 9. 变更记录

> **本小节是需求变更的审计轨迹（强制）**：任何对正文 FR / AC / 技术方案的修改，
> MUST 在此追加一行（日期 + 变更内容 + 理由），并重核受影响 AC（结果留痕）。

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿 | 用户指令「先做这个事情 支持配置Bot」（C2 实机后 Bot 配置正式化诉求） |
