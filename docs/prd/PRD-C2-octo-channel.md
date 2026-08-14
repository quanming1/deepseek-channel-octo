# PRD-C2-Octo WebSocket 通道（最小 MVP）

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | C2 |
| 名称 | Octo WebSocket 通道（最小 MVP） |
| 状态 | 已验收 |
| 创建日期 | 2026-08-14 |
| 定稿日期 | 2026-08-14 |
| 验收日期 | 2026-08-14 |
| 关联文档 | docs/TODO.yaml 阶段 C2；docs/prd/PRD-C1-agent-adapter.md（复用契约/Adapter/server）；docs/deepseek-ecosystem.md（openclaw 蓝本） |

## 1. 背景与目标

- **背景**：C1 已交付渠道无关的 AgentAdapter 层（`src/adapters/`）+ 常驻 harness + 跨进程 resume
  server。C2 把 dsh agent 真正接进 Octo IM：一个常驻 daemon 连上 octo-server 的 WebSocket，
  群里的消息经 bridge 转给 dsh agent，回答以文本发回群里。这是项目终极目标
  （"dsh agent 作为 Octo 中的 bot/队友收发消息"）的第一条端到端通路。
- **目标**：最小 MVP——一个 bot 账号、一个群，群里 `@bot 消息` → dsh 回答（纯文本）→ 追问
  记住上下文（多轮续跑）。参考蓝本：openclaw-channel-octo（WS 接入/消息模型/认证）。
- **非目标**（MVP 明确不做，二期再做）：流式卡片（message/edit）、审批卡片、多 bot 账号、
  权限/成员缓存、历史消息同步、线程/话题、@提及白名单之外的复杂触发策略。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：**Octo API 客户端最小集**（`src/bridge/octo/api.ts`）——`Bearer ${botToken}` 认证
  （bf_...），端点：`POST /v1/bot/sendMessage`（文本回复）、`POST /v1/bot/heartbeat`（REST 心跳）。
- [x] FR2：**WS 接入层**（`src/bridge/octo/ws.ts`）——连接 octo-server WebSocket，参考 openclaw
  WKSocket：加密握手（DH 密钥交换 + AES，细节以 octo-server 源码为准）、60s 心跳、
  指数退避重连、消息帧解析（提取 Octo 入站消息事件）。
- [x] FR3：**bridge 核心**（`src/bridge/octo-channel.ts`）——
  - 收到群消息 → 判断触发（`@bot` 提及；消息模型含 mention 字段则按 mention，否则按配置）
  - 提取文本 → `adapter.run({ runId, prompt, cwd, sessionId })`
  - sessionId 映射：`octo:<accountId>:<groupNo>`（channel_id 直接复用为会话 key，C1 已实证可行）
  - 事件流渲染：`text`/`thinking` 聚合 → 回合结束 `final_text` → `POST sendMessage` 文本回复；
    `error`/`done(interrupted)` → 回复错误提示（不静默）
- [x] FR4：**daemon 启动**（`src/bridge/run-octo.ts` + CLI `octo run` 子命令）——配置加载
  （apiUrl / botToken / 可选 groupNo 白名单）、复用 C1 的 octo-sdk profile 与 SdkDshAdapter、
  生命周期（SIGINT/SIGTERM 优雅退出：adapter.dispose + WS close）。

### 2.2 非功能需求

- 常驻：daemon 形态（进程常驻，harness 缓存复用——C1 资产），WS 断线自动重连。
- 安全：botToken 只从环境变量/本地配置读，绝不入库（AGENTS.md §8）。
- 可测性：WS 层用可注入 transport（fake）；bridge 用 fake adapter；不依赖真实 Octo 环境的单测全覆盖。
- 兼容性：版本锁定沿用 `dsh-compat.ts`；Octo API 以 openclaw 蓝本（v1.3.0）为参照。

## 3. 技术方案

- 模块设计：
  ```
  src/bridge/octo/api.ts           REST 最小集（sendMessage / heartbeat）
  src/bridge/octo/ws.ts            WS 接入（加密握手 / 心跳 / 重连 / 帧解析）
  src/bridge/octo/messages.ts      入站消息解析（文本提取 / mention / 来源判断）
  src/bridge/octo-channel.ts       bridge 核心（事件 → adapter.run → 回复）
  src/bridge/run-octo.ts           daemon 启动（配置 / 生命周期）
  src/cli.ts                       octo run 子命令
  ```
- 关键数据结构：
  ```ts
  interface OctoConfig { apiUrl: string; botToken: string; allowedGroups?: string[] }
  interface InboundMessage { chatId: string; text: string; mentioned: boolean }
  ```
- 依赖：WS 客户端——优先 Node 内置（Node 22 无内置 WS 客户端）→ 需引入 `ws` 包（openclaw 用的
  也是 ws）。加 dependencies `ws` + devDeps `@types/ws`。
- 复用资产：`SdkDshAdapter`（adapters/dsh/sdk-adapter.ts）、`AgentAdapter` 契约、octo-sdk
  profile（sdk-profile.ts）、`Errors`。
- 设计决策记录：
  - **纯文本回复，不做流式卡片**：MVP 目标是把通路打通；message/edit 流式是二期（对齐
    openclaw 的 card-* 系列）。
  - **sessionId 直接用 channel_id**：`octo:<accountId>:<groupNo>` 可推导、可持久，无需映射表
    （C1 DEMO 实证 dsh 接受任意字符串 id）。
  - **@bot 触发**：Octo 消息模型若有 mention 字段则用之；否则 MVP 先响应所有群文本（配置开关）。

## 4. 接口定义

- CLI：`dsh-octo-bot octo run [--config <path>]`——启动 Octo daemon。
- 配置（环境变量或配置文件，二选一）：
  ```
  OCTO_API_URL=https://octo.example.com
  OCTO_BOT_TOKEN=bf_...
  OCTO_ALLOWED_GROUPS=  # 可选，逗号分隔的 groupNo 白名单
  ```

## 5. 验收标准

- [x] AC1：`pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` 全绿（退出码 0）。
- [x] AC2：单测覆盖——api 认证头/URL 拼接、WS 心跳调度与重连退避（fake transport）、
  消息解析（mention/文本提取）、bridge 事件→adapter 调用链与 sessionId 映射、
  error 路径显式回复（不静默）。
- [x] AC3：实机（依赖 Octo 测试环境）——群里 `@bot 你好` → dsh 回答；追问 → 记住上下文
  （多轮续跑）；断线重连后仍可对话。
- [x] AC4：环境缺失时的兜底——单测全绿 + 提供实机验证清单（待 Octo 环境就绪执行）。

## 6. 测试计划

- 单元测试：`src/bridge/octo/*.test.ts`（fake transport / fetch mock）、
  `src/bridge/octo-channel.test.ts`（fake adapter 事件断言）。
- 手动验证：AC3 实机清单（群创建、拉 bot、@触发、多轮、断网重连）。
- 现有 29 条测试保持通过。

## 7. 里程碑与估算

| 子任务 | 预估 |
|---|---|
| 研读 openclaw 接入层（socket/inbound/api-fetch）确认协议 | 0.5 天 |
| octo 客户端 + WS 接入层 | 1-1.5 天 |
| bridge 核心 + daemon 启动 | 1 天 |
| 测试补齐 + 实机联调（依赖环境） | 1-2 天 |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| Octo 测试环境缺失，AC3 无法执行 | 单测全绿 + 实机清单留档（AC4）；环境就绪后补验 |
| WS 加密握手细节（DH+AES）与 octo-server 版本不一致 | 以 openclaw socket.ts 为参考 + 读 octo-server 源码核对；协议细节记录在代码注释 |
| Octo API 字段漂移（mention/payload 结构） | 消息解析集中在一个模块（messages.ts），字段变化只改一处 |

## 9. 变更记录

> **本小节是需求变更的审计轨迹（强制）**：任何对正文 FR / AC / 技术方案的修改，
> MUST 在此追加一行（日期 + 变更内容 + 理由），并重核受影响 AC（结果留痕）。

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-14 | 初始定稿 | 用户指令「立项 START」；MVP 裁剪依据 openclaw-channel-octo 接入层研读（api-fetch.ts / socket.ts），复用 C1 全部 agent 层资产 |
| 2026-08-14 | 补充接入层技术要点（研读 openclaw 蓝本确认，FR1/FR2 实现依据）：**Octo WS = WuKongIM 二进制协议**（非 JSON WS）——① 帧格式：header（packetType<<4\|flags）+ 变长 body 长度 + body；② CONNECT 包（version=4/deviceFlag=0/deviceID=uuid+"W"/uid/token/clientTimestamp/clientKey=curve25519 DH 公钥 base64）；③ CONNACK → `sharedKey(私钥, serverKey)` → `Md5(secretBase64)` 前 16 位=aesKey，salt 前 16=aesIV，AES-128-CBC/PKCS7 加解密（crypto-js）；④ RECV 消息帧：settingByte/fromUID/channelID/channelType/messageID/messageSeq/timestamp/加密 payload → 回 RECVACK → 解密 JSON；⑤ 心跳 PING 60s（3 次无 PONG 重连）、指数退避重连（3s base/60s max/±25% jitter/3 次快速断连报错）。**消息模型**：BotMessage{message_id/from_uid/channel_id/channel_type(Group=2/DM=1)/payload{type(Text=1)/content/mention{uids/entities[offset,length]}}}。**发消息**：POST /v1/bot/sendMessage（body: channel_id/channel_type/payload{type:1,content}/client_msg_no，Bearer bf_）。依赖新增 ws/curve25519-js/crypto-js/md5-typescript | FR2 技术方案细化（原 PRD 只写"参考 WKSocket"）；不影响 FR/AC 结论 |
| 2026-08-14 | 验收：AC1 四件套全绿（typecheck/lint/test **55 passed**（新增 26 条）/build 无循环警告）；AC2 单测覆盖协议编解码（帧/粘包/握手/DH 派生）、消息解析（Text/RichText/非群/mention）、API（认证/URL/非 2xx）、WS 握手与 RECV 解密分发、bridge 调用链（sessionId 映射/白名单/@bot 触发/error 回复）、配置加载；AC3 实机**待 Octo 环境**（无 apiUrl/botToken/botUid 可用，按 AC4 兜底）：CLI `octo run` 接线已验证（缺失配置报 CliError） | 全部 FR 落地（api 客户端/WS 接入层/bridge/daemon/CLI 子命令）；实机验证清单：① 设环境变量 ② `dsh-octo-bot octo run` ③ 群里 @bot 发消息 → 回答 ④ 追问记住上下文 ⑤ 断网重连恢复 |
| 2026-08-14 | **实机补缺（Octo 测试环境就绪，bot dsh_octo_testbot_BlueWhale @ im.deepminer.com.cn）**：① FR1 增加 `registerBot`（POST /v1/bot/register）——Octo 要求 WS 连接前先 register 上线，返回 `robot_id/im_token/ws_url`（bf_ token 不能直接做 WuKongIM 握手，实机 1006 拒连确认）；② WS 地址以服务端 ws_url 权威（`wss://im.deepminer.com.cn/ws`），显式配置 > 服务端 > deriveWsUrl 三级优先级；③ `loadOctoConfig` 环境变量值统一 trim（cmd `set` 尾随空格污染 apiUrl → URL 含 `%20` → nginx 405）；④ SdkDshAdapter 补 `--profile`（与 DshClient 共用 `withSdkProfileArgs`）+ model 改可选（缺省由 runtime 决定，原默认值 `deepseek-official` 是 provider 名非模型名）；⑤ collectRun 去重（text 增量与 final_text 内容相同，双份拼接 → 只发 final_text）；⑥ CONNACK 拒绝路径补日志 | FR1 认证流程与 openclaw 对齐（register→WS）；FR4 daemon 装配顺序补 register 步骤；AC3 实机③ 已跑通（@bot → dsh 回答），④ 多轮记忆待补验；测试 61 passed（+6：registerBot×3/resolveWsUrl/trim/withSdkProfileArgs/collectRun 去重）；坑记录见 PITFALLS 1.5/5.4/5.5/5.6/5.7 |
