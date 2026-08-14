# deepseek-channel-octo

Bridge [DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/reference/)
agents into [Octo IM](https://github.com/Mininglamp-OSS) — a dsh agent becomes a
bot/teammate in Octo: message exchange, task execution, streaming cards, approvals.

> **Status**: pre-prototype. Project skeleton and workflow are in place; bridge
> implementation follows the phase plan in `docs/TODO.yaml`.

## Workflow (Rondo Method)

This repository runs on a PRD-driven, agent-constrained workflow. Read these before
touching anything:

| File | Purpose |
|---|---|
| `AGENTS.md` | Behavioral contract for all AI agents and humans (MUST read first) |
| `docs/TODO.yaml` | Structured task list by phase — **the sole execution basis** |
| `docs/PROCESS.md` | Six-step loop (kickoff → review → develop → verify → close → release) |
| `docs/prd/PRD-<phase>-*.md` | Phase PRDs — **the sole basis for development** |
| `.githooks/` | Local enforcement: commit-msg (commit convention) + pre-push (main protection) |

## Enabling Hooks

```bash
git config core.hooksPath .githooks
```

## Branch Model

Single-main full-PR flow: feature branches cut from `main`, merged via GitHub PR
only. See `AGENTS.md` §4.

## License

Apache-2.0 (planned; confirmed before contributing to Mininglamp-OSS).
