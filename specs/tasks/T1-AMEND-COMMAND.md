---
id: T1-AMEND-COMMAND
title: "`aidlc card amend` records the owner's amendment from the command line, and the hard limit on a started card names both recorded acts"
status: todo
branch: T1-AMEND-COMMAND
worktree: D:\wt\AIDLC\T1-AMEND-COMMAND
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/cli/main.ts
  - tests/scenarios/card-amend-command.test.ts
  - CLAUDE.md
  - templates/CLAUDE.aidlc.md
  - docs/OPERATIONS.md
  - changelog.d/T1-AMEND-COMMAND.md
  - specs/tasks/T1-AMEND-COMMAND.md
dod_command: npm run typecheck && node --test tests/scenarios/card-amend-command.test.ts tests/scenarios/card-amend.test.ts tests/surface/claude-md-size.test.ts tests/surface/command-lines.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The command `aidlc card amend <cardId> --by <who> --reason <text> [--goal <id>]` shall call `CardRunner.amendCard` on the existing run of the card with the card of the main checkout, and start no run.
  - R2. The command shall run on a goal in any state, as `aidlc card ci-reconcile` does.
  - R3. IF the runner's act refuses, THEN the command shall exit non-zero with the cause and leave the card-run record and the journal as they were.
  - R4. The command's JSON output and its human line shall each hold the run's state and the whole amendment (`at`, `by`, `reason`, `revision`, `changed`, `invalidated`) and, for a run in STOP for `review` or `ci`, name `aidlc card continue`.
  - R5. The Hard limits of `CLAUDE.md` and of `templates/CLAUDE.aidlc.md` shall say, in place of the item "After a card run starts, do not edit the card's requirements, acceptance or budget", that a session does not change the contract of a started card on its own, that the owner's amendment is recorded with `aidlc card amend` and a stopped run continues with `aidlc card continue`, each only on the owner's instruction in the session or under a delegation the owner gave and the record names, and that a point the card does not cover and the owner does not amend becomes a follow-up issue.
  - R6. The paragraph on the command in `docs/OPERATIONS.md` shall state R1 to R4 and R7, each refusal of the runner's act, the table of the evidence each contract field touches, what the act keeps, and that after an amendment that invalidated the review decisions a stop for review is lifted by `aidlc card continue`, since `aidlc review rule` refuses a decision of the candidate before the amendment; `changelog.d/T1-AMEND-COMMAND.md` says in one entry what the command does and what the hard limit now says.
  - R7. WHEN the runner's act throws after its write, because the append of its owed `NOTE` event failed, the command shall exit non-zero with the cause and undo nothing, so that the amendment stays recorded and the event stays owed for the next `aidlc card next`.
acceptance:
  - 1. `tests/scenarios/card-amend-command.test.ts`, a one-card goal that is stopped for review with its card in STOP for review, after the `requirements` of the card changed on disk. The command, through the CLI, exits 0; the run holds the amendment, the stop and its state; the JSON output and the human line (`--no-json`) each hold the run's state, every field of the amendment by value and `aidlc card continue`; no run of another card exists afterwards. [R1] [R2] [R4] [dod arm 2]
  - 2. Same file. On a run that is not stopped the JSON output and the human line each hold the run's state and every field of the amendment by value, and neither names `aidlc card continue`. [R4] [dod arm 2]
  - 3. Same file. A card with no run, a contract equal to the card's and a blank `--by` each exit non-zero with the runner's cause and leave the card-run file, where one exists, and the journal byte-identical. [R3] [dod arm 2]
  - 4. Both rule files hold the text of R5 and no longer hold the replaced item, `CLAUDE.md` stays within 200 lines, and `tests/surface/claude-md-size.test.ts`, `command-lines.test.ts`, `mirror.test.ts` and `templates.test.ts` pass. [R5] [dod arm 2]
  - 5. `tests/scenarios/card-amend.test.ts` passes with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 6. Each of the two texts holds what R6 assigns to it and no more is required of it (reviewer-verified against the diff). [R6]
  - 7. `tests/scenarios/card-amend-command.test.ts`. With `fs.appendFileSync` onto the goal journal throwing once at the amendment's `NOTE` append, the command exits non-zero with the cause, the run holds the amendment and owes the event, and the journal holds no `NOTE` event with `amendment`; one `aidlc card next` then leaves exactly one such event in the journal, and the command run again is refused because the contract equals the card's. [R7] [dod arm 2]
depends_on: [T1-CARD-AMEND]
budget: 160
sweep: "On main at 212ff184. src/cli/main.ts:776-785 (`ci-reconcile`) is the command line that runs on a stopped goal (`guard` false), and :719-750 (`withdraw`, `adopt-merge`) a command that reads an existing run and starts none. CLAUDE.md:168-170 and templates/CLAUDE.aidlc.md:50 hold the item R5 replaces; CLAUDE.md has 192 of 200 lines, and the section 'AI-native SDLC (aidlc)' of CLAUDE.md is the template's text (tests/surface/mirror.test.ts). CHANGELOG.md:29 says the item came by the owner's instruction of 2026-11-13: sessions wrote rulings into card text. git grep -n -i 'after a card run starts' finds no other copy."
forbid: [weakening or skipping a test to go green, a rule text that lets a session change a started card on its own, editing a card file from the command, a change to `CardRunner.amendCard`, a change to .claude/skills/aidlc-loop/, editing .aidlc state by hand]
non_goals: [the runner's act (T1-CARD-AMEND), a gate or a report when the card differs from the recorded contract, a record or a check of the owner's delegation, a change to `aidlc goal amend`]
hygiene: "A requirement on the command's output covers the human line and the JSON output, each asserted by value (docs/LESSONS.md, T1-CONTINUE-COMMAND). `ruleFinding` (src/core/review-policy.ts) refuses a ruling when the run's candidate digest is not the stopping decision's, which is the case after an amendment that invalidated the review decisions. Line numbers are from main at 212ff184; read them again at PREPARE. Edit CLAUDE.md and templates/CLAUDE.aidlc.md together. Run every test file that reads CLAUDE.md, templates/CLAUDE.aidlc.md or docs/OPERATIONS.md before the attempt is recorded. The DoD runs the loop benchmark after the build. R3 and R7 keep two cases apart, as T1-CONTINUE-GOAL-2 does: a refusal is decided before the runner's write and leaves every record as it was; a failure after the write is not undone (R3 decision 3 on T1-CONTINUE-GOAL refused a restore of the run record: older owed events stay appended and a concurrent record can be mistaken for this call's)."
doc_sync: docs/OPERATIONS.md (the command), CLAUDE.md, templates/CLAUDE.aidlc.md
---

# T1-AMEND-COMMAND

## Deliverable
The command line of the amendment, and one rule text for a card whose run has started: who may change it, by which commands, and what a session may not do.

## Why
`specs/card-continuation.md`, R11, R16, R17 and R18. Two rule texts disagree today about whether a started card may be amended at all. Split from T1-CARD-AMEND to keep each card within the size limit.

## Rules that decide edge cases
- The command starts no card work and lifts no stop.
- The rule text keeps the owner's rule of 2026-11-13: a session does not write a ruling into a started card.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-amend-command.test.ts tests/scenarios/card-amend.test.ts tests/surface/claude-md-size.test.ts tests/surface/command-lines.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the six files passes, the build succeeds and every benchmark count is within its ceiling.
