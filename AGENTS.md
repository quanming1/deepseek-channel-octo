# deepseek-channel-octo Development Rules (AGENTS.md)

> This file is the behavior contract for **all AI agents** (Claude Code / Cursor / other
> collaborative agents) and human contributors. Anyone touching this repository must read
> and follow this file in full before starting.
>
> Workflow reference: the Rondo method (PRD-driven × agent-constrained AI pair development).
> See https://quanming1.github.io/minimal-blog/posts/rondo-method/

## 1. Project overview

- **deepseek-channel-octo**: bridges DeepSeek Harness (dsh) agents into Octo IM — a dsh
  agent becomes an Octo bot/teammate that sends/receives messages and executes tasks
  (streaming cards, approvals, session routing).
- Current stage: see the status markers in `docs/TODO.yaml`.
- Key documents:
  - `docs/TODO.yaml` — structured TODO list (**the single source of execution truth**)
  - `docs/PROCESS.md` — how to move a stage forward (six-step closed loop)
  - `docs/prd/` — stage PRDs (one per stage; a PRD is the single source of truth for development)

## 2. Working style

1. **Follow `docs/TODO.yaml` strictly, in stage order — no skipping, no overstepping**:
   each step does only the tasks in its own checklist.
2. Stage completion criteria: code + tests + docs + independently verifiable acceptance
   (check against the stage's «acceptance» entry in TODO).
3. Read the relevant docs and existing code before changing anything; follow existing
   patterns and style; do not introduce a parallel set of patterns.
4. Do not introduce undeclared dependencies; confirm a library is declared in
   `package.json` before using it.
5. Change only files in scope; do not make extra changes the user did not ask for.
6. If the same problem keeps failing, stop — go back to the original assumptions and the
   failure evidence, re-judge, and change direction.

## 3. Code style (TS-STYLE-GUIDE)

> This repo's TypeScript style baseline is distilled from opencode; the full spec is at
> `E:/opencode-src/TS-STYLE-GUIDE.md`. The rules below are the core; in case of conflict
> this section wins, and anything not covered here falls back to the source doc.

### 3.1 Core principles

- **Types are a design tool**: model data before implementation; define types for
  cross-boundary data (storage, network, config) before writing logic.
- **Errors are part of the type system**: use structured errors (discriminated unions)
  for expected failures; throw directly for unexpected defects.
- **Comments explain "why", not "what"**: the code says what it does; comments record
  only constraints, motivations, and non-obvious behavior.

### 3.2 Module organization: Self-Export namespaces

- ALWAYS export a namespace at the top of each module file:
  `export * as ModuleName from "./self"` (e.g. `dsh-client.ts` exports
  `export * as DshClient from "./dsh-client"`).
- ALWAYS access via `ModuleName.Member`; NEVER alias-import (`import { foo as bar }`).
- NEVER use `import * as Foo from "..."` — the module exports its own namespace
  (eslint forbids star imports).
- ALWAYS add an `index.ts` per directory that re-exports each module namespace
  (`export * as X from "./x"`); consumers import from the directory entry.
- Namespace name = the file's path-semantic name (`agent/dsh-client.ts` → `DshClient`).

### 3.3 Naming conventions

| Object | Style | Example |
|---|---|---|
| File / module | camelCase | `dsh-client.ts`, `sdk-profile.ts` |
| Type / interface / class | PascalCase | `SendResult`, `DshError` |
| Constant | camelCase | `const SDK_PROFILE = 'octo-sdk'` |
| Function / method | camelCase, verb-first | `createHarness()`, `sendPrompt()` |
| Service interface | fixed name `Interface` | `export interface Interface { ... }` |
| Service implementation | fixed name `Service` | `export class Service implements Interface { ... }` |
| Error class | `XxxError` suffix + `tag` field | `DshError`, `CliError` |
| Nominal type | `XxxID` or same name as type value | `type ID = string & { readonly __brand: "..." }` |

### 3.4 Functional-first (pure TS)

- ALWAYS use `const`; when reassignment is needed use a ternary or early return —
  **no `let`** (eslint-enforced).
- ALWAYS return early; **avoid `else`** (eslint-enforced).
- ALWAYS use `map` / `filter` / `flatMap` / `find` / `some` / `every`; do not hand-write
  for-loop collectors.
- NEVER extract a helper for single-use logic; extract only when a helper is reused or
  has a clear name, and place it **below the main function** (keep the main function on
  the happy path).
- NEVER destructure without context (`const { a, b } = obj` loses the source); keep
  `obj.a` / `obj.b`.
- Separate pure functions from IO: side-effecting functions and pure synchronous helpers
  stay apart.

### 3.5 Error handling (structured errors)

- ALWAYS model business errors as `Error` subclasses with a `tag` field
  (`src/agent/errors.ts` is the template):
  ```ts
  export class DshError extends Error {
    readonly tag = 'DshError' as const
    constructor(message: string, cause?: unknown) { super(message); this.name = 'DshError'; if (cause !== undefined) this.cause = cause }
    static isInstance(error: unknown): error is DshError { /* judge by tag */ }
  }
  ```
- ALWAYS converge a module's errors into a type union (`export type Error = DshError | CliError`).
- ALWAYS handle within expectations: first decide whether it is a business error
  (`isInstance`), branch on `tag`; let unknown errors bubble up.
- NEVER wrap expected logic in bare `try/catch`; at async boundaries wrap low-level
  exceptions into business errors (with `cause`).

### 3.6 Import rules

- ALWAYS put static imports at the top; dynamically `await import(...)` heavy modules
  only where needed, in the narrowest scope.
- NEVER alias-import (`import { foo as bar }`, eslint-enforced); NEVER star-import
  (`import * as X`).
- ALWAYS use `import type` or the inline `type` modifier for type-only imports.

### 3.7 Comment rules

- ALWAYS comment non-obvious constraints and surprising behavior; do not comment
  self-evident assignments/control flow.
- Use JSDoc (`/** */`) for module-level constants, types, and public methods — one
  sentence stating intent; annotate `@throws` when there are side effects / throws.
- `//` comments explain "why": motivation, trade-offs, historical reasons, upstream bug
  workarounds.
- TODO comments state future direction and the criterion for deciding; no vague TODOs.

### 3.8 Anti-patterns (NEVER)

- NEVER `import * as Foo` or `import { foo as bar }`.
- NEVER use `any` (including implicit); use `unknown` + narrowing, or nominal types.
- NEVER handle expected business errors with bare `try/catch` — throw structured errors,
  branch on `tag`.
- NEVER extract a helper for single-use; NEVER let the main function turn into spaghetti
  with details hidden elsewhere.
- NEVER use `let` for reassignment that a ternary / early return could replace.
- NEVER use `else`; NEVER destructure without context.
- NEVER use default exports; always named exports.
- NEVER leave dead code, empty functions, or placeholder TODOs; when an old structure is
  replaced, delete it completely (including fallback branches and compat markers).
- NEVER use bare `string` / `number` for domain values — use nominal types or enums.
- NEVER commit secrets / keys.

### 3.9 Tech stack and language

- **TypeScript + Node.js >= 22.19**, ESM (`"type": "module"`), complete type annotations.
- Formatting/lint: ESLint (rules in `eslint.config.js`).
- **Language policy**: code comments, commit messages, and documentation use **English**;
  types/scopes stay English; identifiers stay English.
- **No emoji**: never use emoji in code, comments, docs, commit messages, or terminal
  output; use text or ASCII markers ([x] / [ ]) for status.

## 4. Git flow (mandatory)

### 4.1 Branch model (single main)

```
main            ← holds only releasable versions (protected semantics: never commit directly)
  └─ feature/<name>   new feature / new task (cut from main)
  └─ release/<ver>    release preparation (version freeze, regression tests)
  └─ hotfix/<name>    production hotfix (cut from main, PR into main)
```

### 4.2 Branch rules

- The default working branch is **main**; never commit code directly to main.
- **All-PR flow**: every change entering main goes through a GitHub PR/MR (code review) —
  push feature branches only; local merges into main are forbidden (enforced by the
  pre-push hook, see §4.7).
- Open a dedicated branch per task/feature:
  `git checkout -b feature/<stage-id>-<short-name> main`; **feat/fix branch names must
  reference a TODO stage id** (e.g. `feature/A1-config`).
- **Cross-check**: the scope of a feat/fix commit must match the stage id in the branch
  name (enforced by the commit-msg hook).
- Planning-only branches: `prd-update` (PRD doc commits), `todos-update` (TODO doc
  commits), see §4.3.

### 4.3 Commit rules (Conventional Commits)

```
<type>(<scope>): <subject>
```

Examples:
```
feat(A1): scaffold CLI skeleton and config system
fix(B2): fix session resume race
docs(roadmap): clarify C1 acceptance criteria
refactor(adapter): extract agent factory from sdk-runtime
```

- **Subject in English** (type/scope stay English).
- type: `feat` / `fix` / `prd` / `todos` / `docs` / `refactor` / `test` / `style` / `chore` / `perf`
- **Three scope classes**:
  - `feat` / `fix` / `prd` / `todos`: scope **must** be a TODO stage id (e.g. `A1` / `C2`)
    and **must actually exist in `docs/TODO.yaml`** (enforced by the commit-msg hook).
  - `feat` additionally requires: the staged set must include the matching stage PRD
    (`docs/prd/PRD-<scope>-*.md`) — behavior changes must be reflected in the PRD
    change log.
  - `prd` / `todos`: commit only on the dedicated branches, and every staged file must
    live under `docs/`.
  - Other types: scope uses a module name (see the «cut point» at the top of
    `.githooks/check_commit_msg.py`).
- **One commit does one thing**; no meaningless messages like `fix stuff`, `update`, `misc`.
- **Local enforcement**: the `.githooks/commit-msg` hook validates the above and rejects
  non-conforming commits.
- Before committing: `git status` to confirm no stray files; `git diff` to review the changes.

### 4.4 Merge strategy

- `feature/*` → `main`: **always via GitHub PR/MR (code review)** — push the branch,
  open a PR; local `git merge --no-ff` back into main is **forbidden**
  (enforced by the pre-push hook).
- **No rebase that rewrites pushed history**; resolve conflicts and pass tests before merging.

### 4.5 Versions and tags

- Semantic Versioning: `MAJOR.MINOR.PATCH`.
- Tag releases on main: `v<version>`.
- Version is managed centrally in `package.json`.

### 4.6 Prohibited

- Committing / pushing code directly to main.
- **Local `git merge` of any branch into main** (main only accepts PR merges).
- Accumulating long-lived unmerged branches outside main.
- Committing secrets / API keys / config files into the repository.
- Leaving temp files, debug code, `.bak`, or unused dead code behind.

### 4.7 Local protection (pre-push hook)

- The repo ships `.githooks/pre-push`:
  - **Forbids pushing a non-main branch directly to main** (except release pushes;
    forbids deleting remote main).
  - **Forbids local merge commits in main's local lead** — main only accepts PR merges.
- After cloning, run once: `git config core.hooksPath .githooks`.
- Note: GitHub free private repos cannot enable server-side branch protection; this hook
  is the local enforcement substitute. **AI agents follow the same rules as humans.**

### 4.8 Standard flow (per task)

```bash
git checkout main && git pull              # 1. sync base
git checkout -b feature/<stage-id>-<task>  # 2. open task branch
# ... develop + local checks (lint / test) ...
git add <changed files>                    # 3. commit (conventional)
git commit -m "feat(A1): <description>"
git push origin feature/<stage-id>-<task>  # 4. push feature branch (pre-push hook allows)
# ... open a PR on GitHub: feature/<stage-id>-<task> → main (code review) ...
git checkout main && git pull              # 5. sync after PR merge
```

## 5. Testing

- Framework: **vitest** (`test/` directory, mirroring the package structure).
- Every new feature ships tests; every bug fix ships a regression test.
- Local gate before commit/merge: `pnpm test` + `pnpm lint` + `pnpm typecheck`.
- Tests never depend on real external credentials — use mocks / fakes.

## 6. Documentation

- New modules / commands / behavior changes must update `docs/` and `README.md`.
- **Logs and change records (mandatory)**:
  - Every feature / fix / behavior change must append to `CHANGELOG.md`
    (under the matching `[Unreleased]` section).
  - Major architecture decisions go into the stage PRD's change log
    (date + decision + rationale).
  - Commit history is the project's execution log: commit messages must be traceable
    (link to TODO entries).

## 7. PRD-driven development (mandatory)

- **PRD first, then develop**: before a TODO stage starts, create its PRD under
  `docs/prd/` (copy from `docs/prd/PRD-TEMPLATE.md`); development may start only after
  review and finalization (status `approved`).
- **The PRD is the single source of truth for development**: requirements, implementation,
  tests, and acceptance all follow the PRD; never develop anything the PRD does not
  define; scope changes must go through the PRD change log.
- **Acceptance per PRD**: each stage closes only after every acceptance criterion in the
  PRD is verified.
- **Lifecycle state machine (mandatory)**: PRD status must transition in real time —
  `draft → approved (reviewed/finalized) → in development → accepted`; no skipping
  (approved / accepted must record dates). TODO marks `in_progress` at kickoff and
  `done` only after acceptance.
- **Three-way closeout (mandatory)**: stage closeout = PRD marked `accepted` + TODO
  marked `done` + CHANGELOG appended — all three, no exceptions.
- **Two change paths**: for requirement changes, first decide — if within the original
  PRD scope (same stage / same topic / refinements of the original FR·AC), edit the body
  + **MUST append to the change log at the end (date + change + rationale)** + re-verify
  affected ACs; if out of scope / new stage / brand-new topic, open a new PRD and run the
  full loop.
- For the full process, see `docs/PROCESS.md`.

## 8. Security and boundaries

- Do not introduce / record secrets; API keys live only in local config files
  (git-ignored) or environment variables.
- Credential values never enter configs, chat logs, or commit messages — reference
  environment variable names (`apiKeyEnv` style), never literal keys.

## 9. Compatibility requirements (mandatory)

### 9.1 Cross-platform (Windows / Linux / macOS)

- Use `node:path` join/resolve for all paths; no hardcoded separators or drive letters.
- Do not depend on platform-specific commands or shell syntax; pass arguments
  explicitly when spawning subprocesses.
- Source files use LF line endings.

### 9.2 Encoding

- All file reads/writes specify `encoding="utf-8"` explicitly.
- When reading user-supplied files, tolerate common encodings (UTF-8 / BOM / GBK etc.),
  fall back on failure.
- Never output mojibake to terminal / files.

### 9.3 Testing and CI

- CI must cover the main platforms (ubuntu + windows + macos matrix, see
  `.github/workflows/ci.yml`).
- Path-, encoding-, and subprocess-related functionality must have cross-platform tests.
- Do not leave temp files in the workspace; debug artifacts go to the system temp dir,
  cleaned up after use.

> The core principle is one: **constraints live in the repo, are readable, and are
> enforceable — AI and humans follow the same rules.**
> Trim details to project size — rules are guardrails, not a maze.
