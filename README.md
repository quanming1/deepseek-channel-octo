# deepseek-channel-octo

Bridge [DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/reference/)
agents into [Octo IM](https://github.com/Mininglamp-OSS) — a dsh agent becomes an Octo
bot/teammate: send/receive messages, execute tasks, stream cards, and handle approvals.

> **Status**: prototype. The Octo WebSocket channel MVP is live-verified (C2);
> config-driven multi-bot support is done (C3). Implementation follows the staged plan
> in `docs/TODO.yaml`.

## Quick start

Connect an Octo bot to a dsh agent in three steps.

### 1. Install

```bash
npm install -g @deepseek-ai/dsh@0.1.0-rc.6   # dsh CLI
npm install -g deepseek-channel-octo          # this package
```

### 2. Create a bot and configure it

Create a bot in the Octo admin console — you get a **Bot ID** and a **Bot Token** (`bf_` prefix).

Copy the config template and fill in your credentials:

```bash
cp octo.config.example.yaml octo.config.yaml
```

```yaml
# octo.config.yaml
apiUrl: https://your-octo-server.example/api
bots:
  - name: my-bot
    botUid: xxxxxxxxxxxxx_bot
    botToken: bf_your_bot_token_here
```

Add one entry per bot under `bots` to connect multiple bots — each gets its own
WebSocket connection and shares the same dsh harness. `octo.config.yaml` is
git-ignored (it contains secrets); the path can be overridden with `OCTO_CONFIG`.

No config file? Legacy env vars are used as fallback:
`OCTO_API_URL` / `OCTO_BOT_TOKEN` / `OCTO_BOT_UID`.

### 3. Run

```bash
dsh-octo-bot octo run
```

Add the bot to a group and @mention it — the agent replies with the dsh answer.
Each group maps to its own dsh session (`octo:<accountId>:<chatId>`), so the bot
remembers the conversation per group (restart-safe).

## Workflow (Rondo method)

This repository runs a PRD-driven, agent-constrained workflow. Read these files before
touching anything:

| File | Purpose |
|---|---|
| `AGENTS.md` | Behavior contract for all AI agents and humans (**read first**) |
| `docs/TODO.yaml` | Staged, structured task list — **the single source of execution truth** |
| `docs/PROCESS.md` | How to move a stage forward (six-step closed loop) |
| `docs/prd/PRD-<stage>-*.md` | Stage PRD — **the single source of truth for development** |
| `.githooks/` | Local enforcement: commit-msg (commit rules) + pre-push (main protection) |

## Enable hooks

```bash
git config core.hooksPath .githooks
```

## Branch model

Single-main, all-PR flow: feature branches are cut from `main` and merged only via
GitHub PRs. See `AGENTS.md` §4.

## Development

```bash
pnpm install        # install deps (pnpm 11, Node >= 22.19)
pnpm typecheck      # type check (tsc --noEmit)
pnpm lint           # ESLint
pnpm test           # vitest unit tests
pnpm build          # tsup build -> dist/
```

## License

Apache-2.0.
