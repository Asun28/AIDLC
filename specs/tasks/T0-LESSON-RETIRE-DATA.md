---
id: T0-LESSON-RETIRE-DATA
title: "Retire the five lessons that later lessons name as superseded or replaced, and the close hint names `aidlc lessons retire`"
status: todo
branch: T0-LESSON-RETIRE-DATA
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/lesson-dup.test.ts
  - tests/surface/lesson-retire-data.test.ts
  - docs/LESSONS.md
  - docs/LESSONS-RETIRED.md
  - changelog.d/T0-LESSON-RETIRE-DATA.md
  - specs/tasks/T0-LESSON-RETIRE-DATA.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/lesson-retire-data.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/lessons.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The close directive's lesson hint (`src/loop/card-runner.ts:3836`) shall add one sentence after its current text: a lesson that supersedes or replaces an earlier line is followed, in the closure commit, by `aidlc lessons retire --line <old> --by <new> --reason "<why>"` run in the main checkout. `LESSON_HINT` of `tests/scenarios/lesson-dup.test.ts:18` changes with it and nothing else in that file changes.
  - R2. `docs/LESSONS.md` shall gain exactly one line, at its end, with the date of the card's run in place of `<date>`: - <date> T0-LESSON-RETIRE-DATA: ALWAYS treat `aidlc card next` at SHIP as the action that pushes, opens the PR, waits for CI and merges after R3 passes; this supersedes the 2026-11-25 T0-BENCH-INPUTS ALWAYS lesson, whose advice to retain the command's whole output did not preserve the refused merge's failure text (source: PR 482, issue 489)
  - R3. `docs/LESSONS-RETIRED.md` shall be created by `aidlc lessons retire` run in the card's worktree and hold five entries: line 30 by 105, 32 by 239, 33 by 109, 194 by 225, 247 by the R2 line. No other line of `docs/LESSONS.md` shall change.
  - R4. One changelog fragment shall record the card.
acceptance:
  - 1. `tests/scenarios/lesson-dup.test.ts` passes with the new `LESSON_HINT`; RED on main for the hint. [R1] [dod arm 3]
  - 2. `tests/surface/lesson-retire-data.test.ts`, new: `lessonRetirements` over this checkout's `docs/LESSONS.md` and `docs/LESSONS-RETIRED.md` reports no problem, and its `entries` include `{ old: [30], by: 105 }`, `{ old: [32], by: 239 }`, `{ old: [33], by: 109 }`, `{ old: [194], by: 225 }` and `{ old: [247], by: <the line number of the R2 line> }`, the R2 line found by its exact text after the date. A later retirement adds entries and does not break the test. RED on main (no retired file). [R2] [R3] [dod arm 3]
  - 3. `git diff origin/main -- docs/LESSONS.md` adds one line and removes none (reviewer-verified against the diff). [R2] [R3]
  - 4. The changelog fragment holds one line in the form of `changelog.d/README.md`. [R4] [dod arm 3]
  - 5. The typecheck and `npm run check:tree` are clean. [dod arm 1] [dod arm 2]
depends_on: [T0-LESSON-RETIRE]
budget: 60
tdd: true
sweep: "On main at fc3b8684. The close hint is pinned exactly by `tests/scenarios/lesson-dup.test.ts:18`, used at `:92` and `:98`. Lines 30, 32, 33, 105, 109, 194, 225, 239, 247 and 248 of `docs/LESSONS.md` keep their numbers: the file is append-only. Line 248 supersedes line 247 only in its remedy and issue 489 is closed, so 247 is retired by the R2 line, whose text Codex wrote in round 2 of the discussion. The ten newest lessons were checked as for T0-LESSON-ACTIVE-VIEW."
forbid: [network]
non_goals:
  - "retiring any line other than the five of R3"
  - "README.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md text"
hygiene: "P0 card 3 of 3 of the agreed result of 2026-11-28. A base sync can conflict at the end of docs/LESSONS.md when another card's close appends a line on main: keep both lines; the entries name lines by hash, so they stay valid when the R2 line moves down, and the test finds that line by its text. RED first: acceptance 1 and 2 on main."
---

# T0-LESSON-RETIRE-DATA

## Why
Five lessons are named by a later lesson as superseded or replaced: 32 by 239, 33 by 109, 194 by 225, 30 by 105, and 247 in its remedy by 248. Cards T0-LESSON-ACTIVE-VIEW and T0-LESSON-RETIRE make delivery honour a retirement and write one; this card retires these five and tells the close step to retire the line a new lesson supersedes, so a supersession does not leak again.

## Deliverable
One sentence in the close hint, one new lesson line that keeps the valid SHIP warning of line 247, and five entries.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/lesson-retire-data.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/lessons.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the five lines are retired by their named replacements with no problem; `docs/LESSONS.md` only gains one line; the close hint names the command.

## PR summary

### What
This change retires five lessons that later lessons supersede. It adds one lesson line and one sentence to the close hint.

### Why / Intent
Superseded lessons still went to sessions as active advice. The close hint now tells the session to retire a superseded line, so the problem does not occur again.

### How / Behaviour
`aidlc lessons retire` wrote the five entries in `docs/LESSONS-RETIRED.md`. The new lesson at line 268 keeps the SHIP warning of line 247. The close directive names the retire command.

### System impact
Delivery no longer shows lines 30, 32, 33, 194 and 247. No other line of `docs/LESSONS.md` changes.

### Security
No secret, network call or permission changes.

### Tests and review
A new surface test checks the five entries with the validator and finds no problem. The lesson-dup scenario pins the new hint text.

### Risk
Low. A base sync can move the new lesson down; the entries name lines by hash, and the test finds the line by its text.

### Ownership
The aidlc loop maintainers own the lesson files and the close directive.

### Docs
The changelog fragment records the change. The card changes no text in README.md, docs/OPERATIONS.md or docs/ARCHITECTURE.md.

## Attempt evidence

| Acceptance | Evidence |
|---|---|
| 1 | RED ef8ae66a: `T0-LESSON-DUP acceptance 3` failed on the narration without the retire sentence; green after `src/loop/card-runner.ts` adds it. |
| 2 | RED ef8ae66a: `T0-LESSON-RETIRE-DATA acceptance 2` failed on `docs/LESSONS-RETIRED.md exists`; green after five `aidlc lessons retire` runs (30 by 105, 32 by 239, 33 by 109, 194 by 225, 247 by 268). Sweep: with the 247 entry removed, the test fails on `an entry retires line 247 by line 268`. |
| 3 | `git diff origin/main --numstat -- docs/LESSONS.md` prints `1 0`: one line added at line 268, none removed. |
| 4 | `changelog.d/T0-LESSON-RETIRE-DATA.md` holds one line; `tests/surface/changelog-fragments.test.ts` passes. |
| 5 | `npm run typecheck` and `npm run check:tree` exit 0 in the DoD run. |

Guard sweep: the change adds no guard in `src/`; the hint is one literal sentence, pinned exactly by acceptance 1.
