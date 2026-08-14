# Changelog

All notable changes to this project are recorded in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- C3 (accepted): Bot configuration & multi-bot support — `src/config/octo-config.ts`
  (`octo.config.yaml` parsing: apiUrl + bots list; `OCTO_CONFIG` path override; falls back
  to `OCTO_API_URL` / `OCTO_BOT_TOKEN` / `OCTO_BOT_UID` env vars when no config file);
  `run-octo.ts` multi-bot assembly (`createBotBridge`: each bot registers independently and
  opens its own WS connection, **sharing one SdkDshAdapter**, session keys isolated by
  accountId); `octo.config.example.yaml` template + README Quick start (install → copy
  template → run, giving installers a clear on-ramp); `.gitignore` excludes the config
  file (bot tokens never committed). New dependency `yaml`. 77 tests green (+16).
  Live: daemon started from `octo.config.yaml`, bot BlueWhale assembled + WS connected.
- C2 (accepted): Octo WebSocket channel MVP — `src/bridge/octo/` (WuKongIM binary
  protocol codec + WS connection management (DH+AES handshake / 60s heartbeat / exponential
  backoff reconnect / packet deframing) + minimal REST registerBot/sendMessage/heartbeat +
  inbound message parsing); `octo-channel.ts` bridge (group `@bot` → AgentAdapter.run →
  text reply, sessionId=`octo:<account>:<chatId>` reuses the group id directly, multi-turn
  resume); `run-octo.ts` daemon (register → WS credentials / config / lifecycle / graceful
  shutdown) + CLI `octo run`. 61 tests green.
  **Live-verified** (2026-08-14, bot `dsh_octo_testbot_BlueWhale` @ im.deepminer.com.cn):
  group `@bot` → dsh reply; multi-turn memory pending final check. Live fixes:
  `registerBot` added (bf_ token cannot handshake directly — must register first to get
  im_token/robot_id/ws_url), WS URL is server-authoritative (explicit config > server >
  derivation), env var trimming (cmd `set` trailing space → URL 405),
  `withSdkProfileArgs` unifies `--profile` across both paths (SdkDshAdapter used to omit
  it), SdkDshAdapter.model optional (runtime decides; the old default `deepseek-official`
  is a provider name), collectRun dedup (text deltas + final_text double-joined; only
  final_text is sent). Pitfalls in PITFALLS 1.5/5.4/5.5/5.6/5.7.
- C1 (accepted): AgentAdapter abstraction + SDK runtime bridge —
  `src/adapters/types.ts` channel-agnostic contract (AgentEvent discriminated union /
  AgentRunOptions with sessionId as a first-class param); `SdkDshAdapter` (harness cached
  per cwd + notification→AgentEvent translation, injectable harnessFactory);
  **custom octo-sdk-server plugin** (replaces the official dsh-sdk-jsonrpc-server:
  getOrCreateSession dual-branch — disk archive hit goes `agents.resume`, cross-process
  context recovery, SDK client untouched); `sdk-profile.ts` mounts the custom server
  (versioned idempotent rebuild via `SERVER_PLUGIN_VERSION`); CLI `send --session <id>`.
  Live: two independent processes resume the same session (second answers the secret word
  taught by the first); fixed PITFALLS 5.2 (Windows spawnSync pnpm ENOENT → cmd.exe /c).
  29 tests.
- F3 (accepted): redundancy & dead code review — removed dead field `SendResult.ok` and
  the unused `runSend` return; extracted `TaggedError` base class + `isKnownError`
  (CLI catch collapses to one branch); converged SDK notification parsing
  (`ChunkEvent`/`TurnEndEvent` + private `chunkDeltaOf`); `sendPrompt` switched to
  callback output (`SendOptions.onText/onThinking`, IO separated from pure functions);
  consumers unified on directory aggregate entries; fixed `resolveDshBin` cross-platform
  PATH separator (Windows `;` / POSIX `:`, `pathSeparatorOf` pure function); comment vs
  implementation consistency fixes (apply return semantics etc.). +3 regression tests
  (15 passed). Later: module-internal cross-module references unified to namespace object
  access (`DshCompat.*`/`Errors.*`/`SdkProfile.*`, removing 5 flat member imports).
- A1 (accepted): GitHub public repo `quanming1/deepseek-channel-octo` + TypeScript ESM
  scaffold (tsconfig / tsup / vitest / ESLint), Apache-2.0 LICENSE, smoke test verified
  end to end.
- A2 (accepted): Hello World plugin — Cordis bundle (`dsh.bundle` + `cordis.patch.yml`),
  registers `/hello` command, installed via `dsh plugin add` into a local profile,
  startup log confirms `[hello-plugin] plugin loaded!`.
- B1 (accepted): CLI messaging MVP — `dsh-octo-bot send <prompt>` sends to local dsh via
  official `@deepseek-ai/dsh-sdk-client` (JSON-RPC) and streams the reply;
  version-pinned single source of truth `dsh-compat.ts`; AC4 live verification passed
  (real Chinese answer). Troubleshooting: settings.yaml third-party proxy baseURL +
  credentials-file priority, see `docs/PITFALLS.md`.
- F1 (accepted): TS-STYLE-GUIDE adopted — AGENTS.md §3 rewritten (naming/functional/
  structured errors/imports/comments/anti-pattern list), eslint strengthened
  (prefer-const / no-else-return / no star imports), existing code migrated to structured
  errors (`DshError`/`CliError` + tag + isInstance).
- F2 (accepted): Self-Export namespaces introduced — each module exports its own
  namespace at the top (`export * as X from "./self"`), directory aggregate `index.ts`,
  consumers use namespace access (`DshClient`/`SdkProfile`/`Errors`/`DshCompat`);
  verified no circular deps under tsup ESM.
- Rondo workflow: `AGENTS.md` behavior contract, `docs/TODO.yaml` staged plan
  (A dsh onboarding MVP / B messaging MVP / C Octo channel), `docs/PROCESS.md` six-step
  closed loop, `docs/prd/` stage PRDs.
- Git Hooks: `.githooks/commit-msg` + `check_commit_msg.py` (validates commits against
  TODO stage ids) and `.githooks/pre-push` (single-main protection), enabled via
  `core.hooksPath`.
