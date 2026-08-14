# Project Advancement Process (PROCESS.md)

> This file defines how development moves forward: **PRD first, then develop**. No stage
> starts without a finalized PRD.

## 1. Core principles

1. **PRD first, then develop**: before a TODO stage starts, its PRD must exist and be
   finalized (status `approved`).
2. **One stage, one PRD**: each TODO stage maps to one PRD under `docs/prd/`.
3. **The PRD is the contract**: implementation, tests, and acceptance all follow the PRD;
   never silently expand or shrink scope during development.

## 2. Six-step closed loop

| Step | Action | Artifact / status |
|---|---|---|
| 1. Kickoff | Pick a stage from `docs/TODO.yaml`, mark it **`in_progress`**, write the PRD | `docs/prd/PRD-<stage>-<name>.md` (status: draft) |
| 2. Review | Check requirements and acceptance criteria item by item, finalize | PRD status: `approved` (frozen after finalization; changes go through the change log) |
| 3. Develop | Implement per the PRD; Git flow: `feature/<stage>-<task>` branch | code + tests; PRD status: in development |
| 4. Verify | Run every PRD acceptance criterion (lint / test / build / manual) | all pass → closeout; failure → back to development |
| 5. Closeout | **Three-way, no exceptions**: PRD marked `accepted` + TODO marked `done` + CHANGELOG appended under `[Unreleased]` | push feature branch → GitHub PR into main (no local merge) |
| 6. Release | release branch + version freeze + regression + tag | `release/<ver>` → main + tag `vX.Y.Z` |

## 3. PRD document rules

- **Naming**: `PRD-<stage>-<name>.md`, name matches the TODO stage.
- **Template**: `docs/prd/PRD-TEMPLATE.md` (every new stage copies from the template).
- **Status lifecycle**: `draft → review → approved (finalized) → in development → accepted`;
  no skipping (approved / accepted must record dates).
- **Two change paths**:
  - Within the original PRD scope (same stage / same topic / refinements of the original
    FR·AC) → edit the body + **MUST append to the change log at the end
    (date + change + rationale)** + re-verify affected ACs (record the result, e.g.
    "original ACs unaffected" or "AC3 re-run passed");
  - Out of scope / new stage / brand-new topic → open a new PRD (copy the template, run
    the full loop).

## 4. Status linkage

| Document | Field | When it transitions |
|---|---|---|
| `docs/TODO.yaml` | `status: in_progress` | at kickoff (stage selected) |
| `docs/TODO.yaml` | `status: done` | at closeout (acceptance passed) |
| `docs/prd/PRD-*.md` | meta "status" | updated in real time through the six-step loop (MUST transition, no skipping) |
| `docs/prd/PRD-*.md` change log | major architecture decisions / requirement changes | when decided; MUST re-verify affected ACs afterward |
| `CHANGELOG.md` | append to `[Unreleased]` | every feature / fix / behavior change |

## 5. Acceptance

- Three gates: `<test command>` (automated tests) + `<lint command>` (code rules) + the
  PRD's manual acceptance items.
- Do not mark done when below standard; repeated failures mean going back to the original
  assumptions and re-judging.

## 6. Cooperation with Git flow

- Each PRD maps to one feature branch: `feature/<stage>-<short-name>`.
- The PRD doc itself is committed at kickoff (`prd(<stage>): add <stage> PRD`);
  development starts after the PRD is finalized.
- Stage merge: push feature branch → GitHub PR/MR into main (all-PR flow, no local merge,
  per AGENTS.md §4).

## 7. Retro-fitting existing projects (no PRD/TODO yet)

When a project is already in development but never had PRD/TODO, retrofit before takeover:

1. **Trace evolution**: `git log --oneline --date=short` (group by feature/version).
2. **Split into stages**: cut N stages by milestone (past features marked `done`,
   future plans marked `todo`).
3. **Fill TODO**: one row per stage (modules + acceptance + status).
4. **Fill PRD**: copy the template, infer FR/AC from current code + CHANGELOG + README;
   mark status as actually `accepted` / `approved` (note "retro-fitted, pending review").

Retro-fit discipline: analyze before changing; do not break existing functionality
(lint/test/build stay green after each step); ask before key decisions; retro-fitting is
not fabrication (mark unwritable acceptance criteria as "pending review").

## 8. Full reference

- Complete flow diagrams (six-step loop + two change paths + retrofit entry): Rondo
  method article §3 / §5 — https://quanming1.github.io/minimal-blog/posts/rondo-method/
- Commit rules: AGENTS.md §4.
