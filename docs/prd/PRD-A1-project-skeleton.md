# PRD-A1-Project-Skeleton

> Draft for user review. Do not start development until approved.

## Meta

| Field | Value |
|---|---|
| Phase | A1 |
| Name | Project skeleton + CLI + config system |
| Status | draft |
| Created | 2026-08-14 |
| Approved | — |
| Accepted | — |
| Related | docs/TODO.yaml A1 |

## 1. Background & Goals

- **Background**: deepseek-channel-octo bridges DeepSeek Harness (dsh) agents into
  Octo IM. Before any bridge logic, the repository needs a typed, testable skeleton:
  package manifest, CLI entry, and a config system with a single source of truth for
  the pinned dsh versions (anti-drift baseline, see `docs/dsh-lark-bot-analysis.md`
  compatibility strategy).
- **Goal**: a clean TypeScript ESM package whose CLI (`dsh-octo-bot`) exposes the
  management command surface (`start / status / restart / stop / doctor`) and whose
  config layer loads validated values from env/file, with dsh version pinning in one
  file (`dsh-compat.ts`).
- **Non-goals**: no bridge logic yet (no dsh runtime launch, no Octo WebSocket);
  no daemon supervision; no test coverage of adapters (later phases).

## 2. Requirements Scope

### 2.1 Functional Requirements

- [ ] FR1: `package.json` declares ESM (`"type": "module"`), TypeScript, engines
  `node >= 22.19`, scripts (`build` / `typecheck` / `test` / `lint`), and a `bin`
  entry `dsh-octo-bot` pointing at the CLI launcher.
- [ ] FR2: CLI `dsh-octo-bot --help` lists subcommands `start / status / restart /
  stop / doctor` with short descriptions; unknown commands exit non-zero with a
  usage message.
- [ ] FR3: Config layer (`src/config/`) provides: `env` parsing (optional `OCTO_*`
  overrides), `app-paths` (config/home resolution via `os.homedir()`-relative
  defaults), and `dsh-compat.ts` — the single source of truth holding pinned
  `@deepseek-ai/*` versions + `verifiedAt` date.
- [ ] FR4: Config values are validated by a schema (zod or hand-rolled validator);
  invalid values fail loud at load with a clear error naming the offending key.
- [ ] FR5: `dsh-octo-bot doctor` prints environment checks (node version, config
  paths) and exits 0/1 accordingly.

### 2.2 Non-Functional Requirements

- Performance: CLI startup < 500ms (no heavy imports at module top-level).
- Security: no secrets in config output; `doctor` must not print credential values.
- Compatibility: paths via `node:path`; LF line endings; UTF-8 read/write explicit.

## 3. Technical Design

- Layout:
  - `bin/dsh-octo-bot.mjs` — thin launcher (shebang, import `src/cli.ts`).
  - `src/cli.ts` — commander program: subcommands + option parsing.
  - `src/cli/commands/{start,status,restart,stop,doctor}.ts` — stubs returning
    "not implemented in A1" for start/stop (real supervision in later phases), real
    checks for doctor.
  - `src/config/env.ts` — env parsing helpers.
  - `src/config/app-paths.ts` — home-relative path resolution.
  - `src/config/dsh-compat.ts` — pinned version matrix + `verifiedAt`.
  - `src/config/index.ts` — validation + composition.
- Build: `tsup` (esbuild) producing `dist/`; `tsc --noEmit` for typecheck.
- Dependency choices (all must be declared in `package.json`):
  - `commander` — CLI parsing.
  - zod (or lightweight hand-rolled validator, decide in review) — config validation.
  - `tsup`, `typescript`, `vitest` — dev toolchain.

## 4. Interfaces

```bash
dsh-octo-bot --help
dsh-octo-bot start [--foreground]
dsh-octo-bot status
dsh-octo-bot restart
dsh-octo-bot stop
dsh-octo-bot doctor
```

Config (env / `~/.dsh-octo/config.yaml`):
```yaml
# example
octo:
  serverUrl: wss://octo.example.com
  botTokenEnv: OCTO_BOT_TOKEN
```

## 5. Acceptance Criteria

- [ ] AC1: `pnpm typecheck` passes with no errors.
- [ ] AC2: `pnpm lint` passes with no warnings.
- [ ] AC3: `pnpm test` — vitest suite for config validation passes (valid/invalid
  cases, fail-loud errors name the offending key).
- [ ] AC4: `node bin/dsh-octo-bot.mjs --help` lists all five subcommands; unknown
  command exits non-zero with usage.
- [ ] AC5: `dsh-octo-bot doctor` exits 0 with correct node-version check and prints
  resolved config paths; exits 1 with a clear message when node < 22.19.
- [ ] AC6: `dsh-compat.ts` pins `@deepseek-ai/dsh-sdk-client` (exact version, no `^`);
  a unit test asserts the pin matches the version in `package.json`.

## 6. Test Plan

- Unit: config parsing + validation (env overrides, file load, fail-loud errors).
- Unit: `doctor` output/exit codes with mocked env.
- Manual: run `--help`, `doctor` on Windows and (when available) Linux.

## 7. Milestones & Estimates

| Subtask | Estimate |
|---|---|
| package.json + tsconfig + tsup + vitest bootstrap | 1 |
| CLI skeleton (commander + 5 subcommand stubs) | 1 |
| config layer (env / paths / dsh-compat + validation) | 2 |
| doctor implementation + tests | 1 |

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| dsh upstream changes break pinned versions | pin exact + `verifiedAt`; update via PROCESS.md change path |
| Windows path quirks | `node:path` everywhere; CI matrix from phase E1 |

## 9. Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-14 | Initial draft | — |
