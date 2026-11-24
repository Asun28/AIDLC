---
id: T0-REVIEW-NO-RUN-2
title: (replaces T0-REVIEW-NO-RUN and carries its candidate) aidlc review r3 and aidlc review pre refuse a card that has no card run in the goal, or whose run holds no successful attempt, before any reviewer runs, without creating a card run and naming the next command (issue 328)
status: merged
branch: T0-REVIEW-NO-RUN-2
worktree: D:\wt\AIDLC\T0-REVIEW-NO-RUN-2
allow_paths:
  - src/cli/main.ts
  - tests/scenarios/review-no-run.test.ts
  - tests/scenarios/card-goal.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-NO-RUN-2.md
dod_command: npm run typecheck && node --test tests/scenarios/review-no-run.test.ts tests/scenarios/review-r3-wait.test.ts tests/scenarios/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review r3 <card>` and `aidlc review pre <card>` shall read the card run of the goal they resolve without creating it (no `ensureCardRun`). WHEN that goal holds no run for the card, each shall exit 1 with one `aidlc: ` line on stderr that names the card and the goal and says to run `aidlc card next <card> --goal <goal>` first, before any reviewer runs: no card run is created, no journal event is appended, no review queue request and no file under `.review/` is written, and no deadline starts. The goal checks that refuse today (unknown goal, terminal goal, a card no goal projects) keep their place before this check and their messages.
  - R2. WHEN the run exists, no attempt of its effort record (`run.effort.attempts`) has the outcome `success` and the run holds no pending `withdrawn` repair, each command shall exit 1 in the same way with one line that names the card and says to record a successful attempt first (`aidlc card attempt <card> --outcome success ...`), before any reviewer runs, and shall change nothing: the run record is byte-for-byte unchanged, no invocation or decision is recorded, no journal event is appended and no review queue request is written. A run whose candidate was withdrawn (`card withdraw`) gets the runner's withdrawn-candidate refusal as today.
  - R3. A run with a successful attempt shall be reviewed as today: every existing refusal of `CardRunner.formalReview` and `CardRunner.preReview` (stopped run, withdrawn candidate, checkout not at the pinned candidate, dirty candidate, empty diff, allowance used) keeps its order and message, and `CardRunner` itself is not changed.
  - R4. `docs/OPERATIONS.md` shall state R1 and R2 where it describes running `aidlc review r3` and `aidlc review pre`, and `CHANGELOG.md` Unreleased shall carry the change under this card id and issue 328.
acceptance:
  - 1. tests/scenarios/review-no-run.test.ts, through bin/aidlc.js in a temporary git repository whose config sets a formal reviewer and a pre-reviewer whose commands write a marker file when run - `review r3` and `review pre` on a card of the goal with no card run, from a checkout whose HEAD holds a committed diff against the base, each exit 1 with one `aidlc: ` stderr line naming `aidlc card next <card> --goal <goal>`; afterwards no card run file exists for the card, the goal journal has the same lines as before, the review queue directory holds no request, no `.review/` file exists and the marker file does not exist. On main the same `review r3` call runs the reviewer (the marker exists) and records a decision. [R1] [dod arm 1]
  - 2. tests/scenarios/review-no-run.test.ts - after `card next` twice (PREPARE, then BUILD) and no attempt, and again after one failed attempt and one not-counted attempt, `review r3` and `review pre` each exit 1 with one line naming `aidlc card attempt <card> --outcome success`; the card run file, the journal and the review queue are byte-for-byte unchanged and the marker file does not exist. After a successful attempt withdrawn with `card withdraw`, `review r3` exits 1 with the runner's withdrawn-candidate message and the marker file does not exist. [R2] [dod arm 1]
  - 3. tests/scenarios/review-no-run.test.ts - after a successful attempt with `--candidate-sha`, `review r3` runs the reviewer (the marker exists) and records its decision. tests/scenarios/card-goal.test.ts - in the test "T0-CARD-GOAL-RESOLVE acceptance 3: review pre, r3, dispute and accept without --goal act on the goal that projects the card, never on the newer goal", the rows of `review pre` and `review r3` assert that the stderr names the older goal and not the newer one and that neither goal holds a run for the card (the command resolved the older goal and created nothing), in place of the assertion that the older goal holds a run; the rows of `review dispute` and `review accept` and every other test of the file are unchanged. tests/scenarios/review-r3-wait.test.ts and tests/scenarios/card-terminal-goal.test.ts pass unchanged. [R1] [R3] [dod arm 1]
  - 4. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "As T0-REVIEW-NO-RUN. In addition: grep -rn \"getCardRun(older.id, 'T1-OLD')\" tests/scenarios/card-goal.test.ts: the acceptance 3 test of T0-CARD-GOAL-RESOLVE uses the run that `review pre` and `review r3` created as its proof that they resolved the older goal; with R1 the refusal line naming the older goal is that proof. grep -n \"pendingRepair?.kind === 'withdrawn'\" src/loop/card-runner.ts: `card withdraw` refutes the success (outcome fail) and sets the pending `withdrawn` repair, and `pinnedCandidate` refuses with the withdrawn-candidate message."
forbid: [weakening or skipping a test to go green, a change to src/loop/card-runner.ts or src/loop/controller.ts, a change to the order or text of an existing refusal, a change to `card next` or `card attempt`, a change to card-goal.test.ts beyond the two rows of acceptance 3, editing a released CHANGELOG section]
non_goals: [other card commands that create a run through cardCtx (card attempt and card red and card withdraw), a refusal inside CardRunner for callers other than the CLI, the review of a run whose success bound no candidate sha on the dry-run path (it reviews the checkout HEAD as today)]
diagnosis:
  root_cause: "As T0-REVIEW-NO-RUN: the `review r3` and `review pre` actions resolve the run through `cardCtx`, whose `runCtx` calls `ensureCardRun`, so a card with no run gets one and `formalReview` reviews the checkout HEAD. T0-REVIEW-NO-RUN required tests/scenarios/card-goal.test.ts to pass unchanged, but that file's T0-CARD-GOAL-RESOLVE acceptance 3 test asserts that both commands create the run in the goal that projects the card, which R1 forbids; its implementer stopped on that contradiction with candidate 487ad5b5 (DoD 27 of 28, the one failure that assertion) and recorded no attempt. Its R2 also met the withdrawn-candidate refusal its R3 kept."
  same_class: "As T0-REVIEW-NO-RUN."
hygiene: "Issue 328. Decided by the coordinating session on 2026-11-17 while working the open issues through the loop at the owner's (asun28) request: the contradiction is in the card text the same session wrote, so the successor changes only allow_paths (card-goal.test.ts), acceptance 2 and 3 and R2 for the withdrawn case, and carries candidate 487ad5b5. The carried candidate is 257 changed lines; fit the budget of 250 by making tests/scenarios/review-no-run.test.ts more compact (shared helpers, table rows), not by dropping an assertion. Run every test file that reads docs/OPERATIONS.md or CHANGELOG.md before the first R3 (docs/LESSONS.md 2026-11-11 T0-RELEASE-OP-REISSUE); give each guard its own failing-when-removed test (docs/LESSONS.md 2026-11-17 T1-OUTCOME-ESCAPED)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-REVIEW-NO-RUN-2

## Deliverable
`aidlc review r3` and `aidlc review pre` refuse a card that has no card run, or whose run holds no successful attempt, before any reviewer runs and without writing anything, and name the command to run first. A withdrawn candidate keeps its own refusal.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-no-run.test.ts tests/scenarios/review-r3-wait.test.ts tests/scenarios/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence

Attempt 1, effort medium. Carried RED aab85514 (T0-REVIEW-NO-RUN): on main the four refusal tests exited 0 (the reviewer ran and recorded a decision). RED commit 386409d9 (tests only): the withdrawn case failed on the carried candidate with the R2 line in place of the runner's refusal, and the card-goal row of `review pre` failed on main (no line names the older goal; the run is created).

| Item | Test | Result |
| --- | --- | --- |
| 1 | review-no-run.test.ts "acceptance 1: review r3 / review pre on a card with no run ..." (one line naming `aidlc card next`, cards, journal and queue unchanged, no `.review/`, no marker) | pass; on main exit 0, reviewer ran |
| 2 | review-no-run.test.ts "acceptance 2: review r3 / review pre with no attempt, then after a failed and a not-counted attempt ..." and "after a successful attempt withdrawn with card withdraw ..." | pass; withdrawn row fails on 487ad5b5 |
| 3 | review-no-run.test.ts "acceptance 3: after a successful attempt ..."; card-goal.test.ts "T0-CARD-GOAL-RESOLVE acceptance 3: review pre, r3, dispute and accept ..." (pre and r3 rows); review-r3-wait.test.ts and card-terminal-goal.test.ts unchanged | pass |
| 4 | review-no-run.test.ts "acceptance 4: ..." (OPERATIONS_SENTENCES, CHANGELOG_SENTENCES) | pass |

Revert check (each guard of `reviewCtx` in src/cli/main.ts reverted alone, review-no-run.test.ts run, source restored): `getCardRun` replaced by `ensureCardRun` fails both acceptance 1 tests; the success check removed fails both acceptance 2 tests; the withdrawn exemption removed fails the withdrawn test.
