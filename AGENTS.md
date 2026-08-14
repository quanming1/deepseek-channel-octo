# deepseek-channel-octo Development Rules (AGENTS.md)

> This file is the behavioral contract for **all AI agents** (Claude Code / Cursor /
> other collaborating agents) and human contributors. Anyone working in this repo
> MUST read and follow this file before touching anything.
>
> Workflow reference: Rondo Method (PRD-driven × agent-constrained pairing).
> See https://quanming1.github.io/minimal-blog/posts/rondo-method/

## 1. Project Overview

- **deepseek-channel-octo**: Bridge DeepSeek Harness (dsh) agents into Octo IM so a
  dsh agent can act as a bot/teammate in Octo (message exchange, task execution,
  streaming cards, approvals).
- Current phase: <current TODO phase, e.g. A1> — see `docs/TODO.yaml` for status markers.
- Key documents:
  - `docs/TODO.yaml` — structured TODO list (**the sole execution basis**)
  - `docs/PROCESS.md` — process management (six-step loop)
  - `docs/prd/` — phase PRDs (one per phase; PRD is the sole basis for development)

## 2. Working Style

1. **Strictly follow the phase order in `docs/TODO.yaml`; never skip phases or
   overstep scope** — each step only does the tasks in its own checklist.
2. Phase completion criteria: code + tests + docs + independently verifiable
   acceptance (against the `acceptance` entry in TODO).
3. Read relevant docs and existing code before touching anything; follow existing
   patterns and style; do not create a parallel set of patterns.
4. Do not introduce undeclared dependencies; before using any library, confirm it
   is declared in the dependency manifest (`package.json`).
5. Only modify files within the task scope; no extra changes the user did not ask for.
6. If the same problem keeps failing to fix, stop, return to the initial
   assumptions and evidence, and change direction.

## 3. Code Style

- **TypeScript + Node.js >= 22.19**, ESM (`"type": "module"`), full type annotations.
- Formatting/lint: ESLint (project config), import sorting per project config.
- Naming: camelCase for variables/functions, PascalCase for classes/types.
- Every module file has a header comment stating its responsibility.
- **Comments**: complex logic must be commented; comments explain **why**, not
  **what** (signatures/types express the "what").
- **Language**: all comments, commit messages, and documentation in **English**;
  code identifiers stay English.
- **No emoji** in code, comments, docs, commit messages, or terminal output; use
  text or ASCII markers ([x] / [ ]) for status.

## 4. Git Flow (Mandatory)

### 4.1 Branch Model (single-main)

```
main            ← only releaseable versions (protected: never commit directly)
  └─ feature/<name>    new feature / new task (cut from main)
  └─ release/<ver>     release prep (version freeze, regression)
  └─ hotfix/<name>     production hotfix (cut from main, merged back to main via PR)
```

### 4.2 Branch Rules

- Default working branch is **main**; main never receives direct commits.
- **Full-PR flow**: every change entering main goes through a GitHub PR/MR
  (Code Review). Locally only push feature branches; never merge into main locally
  (enforced by pre-push hook, see §4.7).
- Every task/feature opens its own branch: `git checkout -b feature/<phase-id>-<short-name> main`,
  **feat/fix branch names must reference a TODO phase id** (e.g. `feature/A1-config`).
- **Cross-check**: the scope of feat/fix commits must match the phase id in the
  branch name (enforced by commit-msg hook).
- Planning branches: `prd-update` (PRD document commits), `todos-update` (TODO
  document commits), see §4.3.

### 4.3 Commit Convention (Conventional Commits)

```
<type>(<scope>): <subject>
```

Examples:
```
feat(A1): scaffold CLI and config system
fix(B2): session resume race condition
docs(roadmap): clarify C1 acceptance criteria
refactor(adapter): extract agent factory from sdk-runtime
```

- **subject in English** (type/scope stay English).
- type: `feat` / `fix` / `prd` / `todos` / `docs` / `refactor` / `test` / `style` / `chore` / `perf`
- **scope has three categories**:
  - `feat` / `fix` / `prd` / `todos`: scope **must** be a TODO phase id (e.g. `A1` / `C2`),
    and **must exist in `docs/TODO.yaml`** (enforced by commit-msg hook).
  - `feat` additionally: the staged changes must include the phase PRD
    (`docs/prd/PRD-<scope>-*.md`) — behavior changes must sync the PRD change log.
  - `prd` / `todos`: only on their dedicated branches, and staged files must all
    be under `docs/`.
  - other types: scope uses module names (see `MODULE_SCOPES` in
    `.githooks/check_commit_msg.py`).
- **One commit, one concern**; no meaningless messages like `fix stuff` / `update` / `misc`.
- **Local enforcement**: `.githooks/commit-msg` hook rejects non-conforming commits.
- Before committing: `git status` to confirm no stray files; `git diff` to review changes.

### 4.4 Merge Strategy

- `feature/*` → `main`: **always via GitHub PR/MR (Code Review)** — push the branch,
  open the PR; **local `git merge --no-ff` into main is forbidden** (enforced by
  pre-push hook).
- **No rebase of already-pushed history**; resolve conflicts and pass tests before merging.

### 4.5 Versioning & Tags

- Semantic versioning `MAJOR.MINOR.PATCH`.
- Tag `v<version>` on main at each release.
- Version declared in `package.json`.

### 4.6 Forbidden

- Direct commit/push to main.
- **Local `git merge` of any branch into main** (main only accepts PR merges).
- Long-lived branches with unmerged work.
- Committing secrets / API keys / config files into the repo.
- Leaving temp files, debug code, `.bak` files, dead code.

### 4.7 Local Protection (pre-push hook)

- The repo ships `.githooks/pre-push`:
  - **Forbids pushing a non-main branch directly to main** (release push excepted;
    forbids deleting remote main).
  - **Forbids pushing main with local commits ahead of remote that include local
    merges** — main only accepts PR merges.
- Run once after clone: `git config core.hooksPath .githooks`.
- GitHub free private repos cannot enable server-side branch protection; this hook
  is the local enforcement replacement; **AI agents and humans follow the same rules**.

### 4.8 Standard Flow (per task)

```bash
git checkout main && git pull              # 1. sync base
git checkout -b feature/<phase-id>-<task>  # 2. open task branch
# ... develop + local tests (lint / test) ...
git add <changed files>                    # 3. commit (conventional)
git commit -m "feat(A1): <subject>"
git push origin feature/<phase-id>-<task>  # 4. push feature branch (pre-push allows)
# ... open PR on GitHub: feature/<phase-id>-<task> → main (Code Review) ...
git checkout main && git pull              # 5. sync after PR merge
```

## 5. Testing

- Test framework: **vitest** (`test/` directory, mirroring package structure).
- Every new feature needs tests; every bug fix needs a regression test.
- Before commit/merge locally: `pnpm test` + `pnpm lint` + `pnpm typecheck` must pass.
- Tests must not depend on real external credentials — use mocks/fakes.

## 6. Documentation

- New modules / commands / behavior changes must sync `docs/` and `README.md`.
- **Changelog (mandatory)**: every feature / fix / behavior change appends to
  `CHANGELOG.md` under `[Unreleased]`.
- Major architecture decisions recorded in the phase PRD's "Change Log" (date + decision + reason).
- Commit history is the project's execution log: commit messages must be traceable
  to TODO entries.

## 7. PRD-Driven Development (Mandatory)

- **PRD first, code later**: before starting any TODO phase, create its PRD in
  `docs/prd/` (copied from `docs/prd/PRD-TEMPLATE.md`), and only after review and
  approval (status `approved`) may development begin.
- **PRD is the sole basis for development**: requirements, implementation, tests,
  and acceptance all reference the PRD; developing content not defined in the PRD
  is forbidden; scope changes go through the PRD "Change Log".
- **Acceptance against PRD criteria**: each phase completes only when every
  acceptance criterion in the PRD passes.
- **Lifecycle state machine (mandatory)**: PRD status flows in real time —
  `draft → approved → in-development → accepted`; no jumps (approved / accepted
  must record dates). TODO marks `in_progress` at kickoff, `done` only after acceptance.
- **Three-way closure (mandatory)**: phase closure = PRD marked `accepted` +
  TODO marked `done` + CHANGELOG appended; all three, none optional.
- **Change dual-path**: on requirement changes, first judge — within the original
  PRD scope (same phase/topic, refinement of existing FR/AC) → edit the body +
  **MUST append a "Change Log" entry (date + change + reason)** + re-verify affected
  ACs; out of scope / new phase / new topic → new PRD through the full loop.
- See `docs/PROCESS.md` for the management process.

## 8. Security & Boundaries

- Never introduce/record secrets; API keys live only in local config files
  (gitignored) or environment variables.
- Credential values never enter settings, chat logs, or commit messages — reference
  environment variables by name (`apiKeyEnv` style) instead of literals.

## 9. Compatibility (Mandatory)

### 9.1 Cross-platform (Windows / Linux / macOS)

- Paths use `node:path` join/resolve; no hardcoded separators or drive letters.
- No platform-specific commands or shell syntax; spawn subprocesses with explicit
  argument arrays.
- Source files use LF line endings.

### 9.2 Encoding

- File reads/writes explicitly specify `utf-8`.
- When reading user-supplied files, tolerate common encodings (UTF-8 / BOM / GBK)
  with fallback.
- No mojibake in terminal or file output.

### 9.3 Testing & CI

- CI covers major platforms (ubuntu + windows + macos matrix, `.github/workflows/ci.yml`).
- Features touching paths, encoding, or subprocesses need cross-platform test cases.
- No temp files left in the workspace; debug artifacts go to the system temp dir
  and are cleaned up.

> Core principle: **constraints live in the repo, are readable, and are enforced by
> machine — AI and humans follow the same rules.** Scale the details to the project;
> the rules are guardrails, not a maze.
