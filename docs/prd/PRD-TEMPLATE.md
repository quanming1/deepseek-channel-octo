# PRD-<phase>-<name>

> Copy this template to `docs/prd/PRD-<phase>-<name>.md` and fill it in. All content
> in English.
> Status lifecycle: draft → review → approved → in-development → accepted

## Meta

| Field | Value |
|---|---|
| Phase | TODO phase id (e.g. A1) |
| Name | short description (e.g. CLI + config system) |
| Status | draft / approved / in-development / accepted |
| Created | YYYY-MM-DD |
| Approved | YYYY-MM-DD (fill when approved) |
| Accepted | YYYY-MM-DD (fill when accepted) |
| Related | docs/TODO.yaml phase; docs/ROADMAP.md (if any) |

## 1. Background & Goals

- **Background**: why this phase exists (which roadmap step, what problem it solves).
- **Goal**: the deliverable state after this phase (one sentence).
- **Non-goals**: explicitly out of scope (prevent scope creep).

## 2. Requirements Scope

### 2.1 Functional Requirements

Each requirement checkable and acceptable:

- [ ] FR1: describe requirement 1 (input / output / behavior)
- [ ] FR2: describe requirement 2

### 2.2 Non-Functional Requirements

- Performance: ...
- Security: ...
- Compatibility: ...

## 3. Technical Design

- Module design (directories / files / responsibilities)
- Key data structures (dataclass / config shape)
- Dependency choices (must be declared in the manifest)

## 4. Interfaces

- CLI command signatures (args / options / output)
- Config structure (YAML example)

## 5. Acceptance Criteria

Each executable (command / assertion / checkbox):

- [ ] AC1: running `xxx` should produce `yyy`
- [ ] AC2: `<test command>` all pass
- [ ] AC3: `<lint command>` no warnings

## 6. Test Plan

- Unit test coverage points
- Manual verification steps

## 7. Milestones & Estimates

| Subtask | Estimate |
|---|---|
| ... | ... |

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| ... | ... |

## 9. Change Log

> **This section is the audit trail for requirement changes (mandatory)**: any edit
> to the FR / AC / technical design MUST append a row here (date + change + reason)
> and re-verify affected ACs (record the result).
> Without a change log the PRD silently drifts, code and docs diverge again, and the
> whole system fails.

| Date | Change | Reason |
|---|---|---|
| YYYY-MM-DD | Initial draft | — |
