# Project Management Process (PROCESS.md)

> This file defines the development mechanism: **PRD first, code later**. No phase
> starts without an approved PRD.

## 1. Core Principles

1. **PRD first, code later**: before starting any TODO phase, a corresponding PRD
   must exist and be finalized (status `approved`).
2. **One phase, one PRD**: each TODO phase maps to one PRD in `docs/prd/`.
3. **PRD is a contract**: implementation, tests, and acceptance all follow the PRD;
   scope is not expanded or shrunk during development without a change record.

## 2. Six-Step Loop

| Step | Action | Artifact / Status |
|---|---|---|
| 1. Kickoff | Pick a phase from `docs/TODO.yaml`, mark it `in_progress`, write the PRD | `docs/prd/PRD-<phase>-<name>.md` (status: draft) |
| 2. Review | Check requirements and acceptance criteria line by line, finalize | PRD status: `approved` (frozen after finalization; changes need a change record) |
| 3. Develop | Implement per the PRD; Git Flow: `feature/<phase>-<task>` branch | code + tests; PRD status: in-development |
| 4. Verify | Execute each acceptance criterion in the PRD (lint / test / build / manual) | all pass → closure; fail → back to develop |
| 5. Close | **Three-way closure, none optional**: PRD `accepted` + TODO `done` + CHANGELOG appended | push feature branch → GitHub PR into main (no local merge) |
| 6. Release | release branch + version freeze + regression + tag | `release/<ver>` → main + tag `vX.Y.Z` |

## 3. PRD Document Rules

- **Naming**: `PRD-<phase>-<name>.md`, name matching the TODO phase.
- **Template**: `docs/prd/PRD-TEMPLATE.md` (new phases always copy the template).
- **Status lifecycle**: `draft → review → approved → in-development → accepted`;
  no jumps (approved / accepted must record dates).
- **Change dual-path**:
  - Within the original PRD scope (same phase/topic, refinement of existing FR/AC)
    → edit the body + **MUST append a "Change Log" entry (date + change + reason)**
    + re-verify affected ACs (record the result, e.g. "original ACs unaffected" or
    "AC3 re-run passed");
  - Out of scope / new phase / new topic → new PRD (copy template, full loop).

## 4. Status Linkage

| Document | Field | Transition point |
|---|---|---|
| `docs/TODO.yaml` | `status: in_progress` | kickoff (phase selected) |
| `docs/TODO.yaml` | `status: done` | closure (acceptance passed) |
| `docs/prd/PRD-*.md` | meta "Status" | real-time with the six-step loop (MUST flow, no jumps) |
| `docs/prd/PRD-*.md` "Change Log" | major architecture decisions / requirement changes | at decision time; MUST re-verify affected ACs after change |
| `CHANGELOG.md` | `[Unreleased]` append | every feature / fix / behavior change completed |

## 5. Acceptance

- Acceptance steps: `<test command>` (automated tests) + `<lint command>` (code
  standards) + PRD manual acceptance items.
- Do not mark complete if standards are not met; if repeatedly failing, return to
  the initial assumptions and re-judge.

## 6. Git Flow Integration

- Each PRD maps to one feature branch: `feature/<phase>-<short-name>`.
- The PRD document itself is committed at kickoff (`prd(A1): add phase A1 PRD`);
  development starts after the PRD is approved.
- Phase merge: push feature branch → GitHub PR/MR into main (full-PR flow; local
  merge forbidden; see AGENTS.md §4).

## 7. Reverse-Engineering Existing Projects (no PRD/TODO)

When a project is already in development and never had PRD/TODO, reverse-engineer
before taking over:

1. **Map evolution**: `git log --oneline --date=short` (group by feature/version).
2. **Segment into phases**: cut into N phases by milestone (history = `done`, future = `todo`).
3. **Fill TODO**: one row per phase (modules + acceptance + status).
4. **Fill PRDs**: copy the template; derive FR/AC from current code + CHANGELOG +
   README; status by reality (`accepted` / `approved` with note "reverse-engineered, pending review").

Reverse-engineering discipline: analyze before changing; do not break existing
functionality (lint/test/build stay green after each step); key decisions are
confirmed with the user first; reverse-engineering is not fabrication (mark
unverifiable acceptance criteria as "pending review").

## 8. References

- Full flowchart (six-step loop + change dual-path + reverse-engineering entry):
  Rondo Method article §3, §5 — https://quanming1.github.io/minimal-blog/posts/rondo-method/
- Commit rules: AGENTS.md §4.
