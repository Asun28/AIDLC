---
id: T0-TAKEOVER-FOREIGN-LINE-2
title: A card takeover reads only the journals of the goals that run the card, so a line the journal schema refuses in an unrelated goal no longer crashes the takeover of every card
status: todo
branch: T0-TAKEOVER-FOREIGN-LINE-2
worktree: D:\wt\AIDLC\T0-TAKEOVER-FOREIGN-LINE-2
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/takeover-foreign-line.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-TAKEOVER-FOREIGN-LINE.md
  - specs/tasks/T0-TAKEOVER-FOREIGN-LINE-2.md
dod_command: npm run typecheck && node --test tests/scenarios/takeover-foreign-line.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `CardRunner.takeover` (`src/loop/card-runner.ts`) looks up the handoff intent or the acquisition by resource and generation, it shall read the journal of the goal it runs under and the journal of each other goal that holds a run of the card (`GoalStore.getCardRun` returns one), and no other journal.
  - R2. A line `JournalEvent` refuses in a journal that R1 reads shall still make the takeover throw: `Journal.readAll`, `JournalEvent` and `JournalEventType` stay as they are at 2c95325.
  - R3. `docs/OPERATIONS.md`, at the end of the Sessions bullet that describes `aidlc card takeover <card> --goal <id>`, shall carry the OPERATIONS sentence of the Doc text section.
  - R4. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/scenarios/takeover-foreign-line.test.ts` - goal A runs the card, its lease expired under win-A; goal B holds no run of the card and its journal holds a line of type `BOUND_FIRED`. `takeover` under goal A as win-B returns; the lease is win-B's at generation 1, the stored run carries `ownerGeneration` 1, and goal A's journal holds exactly one `card-takeover-intent` NOTE and exactly one `LEASE_ACQUIRED` for generation 1. At 2c95325 the call throws a ZodError after the lease write. [R1] [dod arm 2]
  - 2. Same file - the same two goals, with the takeover interrupted after its lease write (the lease is win-B's at generation 1, the intent is journaled, the run carries generation 0): `takeover` run again returns `completed: true` with `previousOwner` win-A and `previousGeneration` 0, the run carries generation 1, and goal A's journal gains one `LEASE_ACQUIRED` for generation 1. [R1] [dod arm 2]
  - 3. Same file - goal C holds a run of the card and its journal holds a `BOUND_FIRED` line: `takeover` under goal A throws a ZodError, so a line the schema refuses in a journal of the card still stops the takeover. [R2] [dod arm 2]
  - 4. Same file - goal C holds a run of the card and its journal holds the `LEASE_ACQUIRED` of generation 1 for the card's resource; the interrupted takeover of acceptance 2 completed under goal A appends no second `LEASE_ACQUIRED` to goal A's journal and appends one `card-takeover-completed` NOTE, so the lookup still reads every goal that runs the card. [R1] [dod arm 2]
  - 5. Same file - `docs/OPERATIONS.md` holds the OPERATIONS sentence and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R3] [R4] [dod arm 2]
depends_on: []
budget: 200
tdd: true
sweep: "git grep -n 'listGoals()' over src on main 2c95325: card-runner.ts:700 is the only caller that reads a journal per goal; the others (cli/main.ts:93, 105, 113, 265, 806, 996, hooks/index.ts:429, 548, card-runner.ts:431) read goal or run records, and cli/main.ts:996 builds a journal per id for `audit verify --all`, which reports one goal at a time and is not a takeover."
forbid: [weakening or skipping a test to go green, a change to `Journal.readAll`, `JournalEvent` or `JournalEventType` (R2 keeps the strict parse that T0-UNWRITTEN-EVENT-TYPES R1 requires), declaring `BOUND_FIRED`, a tolerant or skipping journal read, an edit of any file under `.aidlc/`, a change to the order of the takeover's writes]
non_goals: [repairing the journal of goal g-20260927164040-039db8 (state is never edited by hand and that goal is cancelled), the takeover of a card run in that goal, T1-BOUND-TELEMETRY, the other cross-goal readers of the sweep]
diagnosis:
  root_cause: "`CardRunner.takeover` (card-runner.ts:700) reads every goal's journal through the strict `Journal.readAll` to find the intent and the acquisition of the card lease. The journal of cancelled goal g-20260927164040-039db8 holds five `BOUND_FIRED` lines (lines 74, 109, 152, 188, 193), written on 2026-10-04 and 2026-10-05 by an unmerged T1-BOUND-TELEMETRY build through the state directory all worktrees share; main never declared the type (`git log -S BOUND_FIRED -- src/core/types.ts` is empty). So every `aidlc card takeover` on this repository throws a ZodError after its lease write and before its run update, at the `LEASE_ACQUIRED` lookup."
  same_class: "See the sweep: no other `listGoals()` caller reads a journal per goal."
hygiene: "This card replaces T0-TAKEOVER-FOREIGN-LINE, whose ship stopped on `[SHIP-PUSH-FAIL]` after its R2 and R3 passes (STOP/tool, final for that card; the same `git push` run by hand exited 0 and the ship kept no stderr), and carries its candidate cb4ddd8 unchanged. A takeover already stopped by this defect holds its lease at the next generation with its intent journaled, which is the interrupted takeover R1's lookup must complete; T0-JOURNAL-FAULT-EVENTS is in that state on this repository (journal g-20261023193429-707c23 holds one `card-takeover-intent`). Every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8); the doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
---

# T0-TAKEOVER-FOREIGN-LINE-2

## Deliverable
`aidlc card takeover` works on this repository again: it reads the journal of the goal it runs under and of each other goal that holds a run of the card, so a line the schema refuses in an unrelated goal cannot stop it, and a line the schema refuses in a journal of the card still does.

## Doc text
OPERATIONS sentence:

A takeover reads the journal of the goal it runs under and of each other goal that holds a run of the card, no other journal, so a line the journal schema refuses stops only the takeover of a card run in that line's goal.

CHANGELOG entry:

- T0-TAKEOVER-FOREIGN-LINE (bugfix): `aidlc card takeover` reads the journal of the goal it runs under and of each other goal that holds a run of the card, no other journal, so a line the journal schema refuses in an unrelated goal (five `BOUND_FIRED` lines an unmerged build wrote) no longer crashes the takeover of every card after its lease write. A takeover already stopped that way completes when run again.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/takeover-foreign-line.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence
- Carried: candidate cb4ddd8 of T0-TAKEOVER-FOREIGN-LINE, RED at 54c5010 and the mutation check are in that card's Attempt evidence. Its R2 (deepseek-v4-pro) and R3 (codex) both passed; the ship then failed at `git push -u origin T0-TAKEOVER-FOREIGN-LINE`, stderr not retained, and the same command by hand exited 0.
