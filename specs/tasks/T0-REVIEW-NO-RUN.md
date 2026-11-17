---
id: T0-REVIEW-NO-RUN
title: aidlc review r3 and aidlc review pre refuse a card that has no card run in the goal, or whose run holds no successful attempt, before any reviewer runs, without creating a card run and naming the next command (issue 328)
status: todo
branch: T0-REVIEW-NO-RUN
worktree: D:\wt\AIDLC\T0-REVIEW-NO-RUN
allow_paths:
  - src/cli/main.ts
  - tests/scenarios/review-no-run.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-NO-RUN.md
dod_command: npm run typecheck && node --test tests/scenarios/review-no-run.test.ts tests/scenarios/review-r3-wait.test.ts tests/scenarios/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review r3 <card>` and `aidlc review pre <card>` shall read the card run of the goal they resolve without creating it (no `ensureCardRun`). WHEN that goal holds no run for the card, each shall exit 1 with one `aidlc: ` line on stderr that names the card and the goal and says to run `aidlc card next <card> --goal <goal>` first, before any reviewer runs: no card run is created, no journal event is appended, no review queue request and no file under `.review/` is written, and no deadline starts. The goal checks that refuse today (unknown goal, terminal goal, a card of another goal) keep their place before this check and their messages.
  - R2. WHEN the run exists but no attempt of its effort record (`run.effort.attempts`) has the outcome `success`, each command shall exit 1 in the same way with one line that names the card and says to record a successful attempt first (`aidlc card attempt <card> --outcome success ...`), before any reviewer runs, and shall change nothing: the run record is byte-for-byte unchanged, no invocation or decision is recorded, no journal event is appended and no review queue request is written.
  - R3. A run with a successful attempt shall be reviewed as today: every existing refusal of `CardRunner.formalReview` and `CardRunner.preReview` (stopped run, withdrawn candidate, checkout not at the pinned candidate, dirty candidate, empty diff, allowance used) keeps its order and message, and `CardRunner` itself is not changed.
  - R4. `docs/OPERATIONS.md` shall state R1 and R2 where it describes running `aidlc review r3` and `aidlc review pre`, and `CHANGELOG.md` Unreleased shall carry the change under this card id and issue 328.
acceptance:
  - 1. tests/scenarios/review-no-run.test.ts, through bin/aidlc.js in a temporary git repository whose config sets a formal reviewer and a pre-reviewer whose commands write a marker file when run - `review r3` and `review pre` on a card of the goal with no card run, from a checkout whose HEAD holds a committed diff against the base, each exit 1 with one `aidlc: ` stderr line naming `aidlc card next <card> --goal <goal>`; afterwards no card run file exists for the card, the goal journal has the same lines as before, the review queue directory holds no request, no `.review/` file exists and the marker file does not exist. On main the same `review r3` call runs the reviewer (the marker exists) and records a decision. [R1] [dod arm 1]
  - 2. tests/scenarios/review-no-run.test.ts - after `card next` twice (PREPARE, then BUILD) and no attempt, and again after one failed attempt and one not-counted attempt, `review r3` and `review pre` each exit 1 with one line naming `aidlc card attempt <card> --outcome success`; the card run file, the journal and the review queue are byte-for-byte unchanged and the marker file does not exist. [R2] [dod arm 1]
  - 3. tests/scenarios/review-no-run.test.ts - after a successful attempt with `--candidate-sha`, `review r3` runs the reviewer (the marker exists) and records its decision; tests/scenarios/review-r3-wait.test.ts, tests/scenarios/card-goal.test.ts and tests/scenarios/card-terminal-goal.test.ts pass unchanged (their goal refusals come first). [R1] [R3] [dod arm 1]
  - 4. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 200
tdd: true
sweep: "grep -n 'const runCtx\\|const cardCtx' src/cli/main.ts: runCtx calls `c.controller.ensureCardRun(goalRec, cardId)` (src/loop/controller.ts:748), which creates the run, journals CARD_DISPATCHED and starts its deadline. grep -n \"cardCtx(c, cardId\" src/cli/main.ts: `review pre` (line 1033) and `review r3` (line 1045) take it; `CardRunner.formalReview` reads `pinnedCandidate`, which returns the checkout HEAD when no candidate is pinned (src/loop/card-runner.ts:409). grep -rn \"preReview(\\|formalReview(\" src: only those two CLI actions call them. `review findings` uses `findRun` and creates nothing (main.ts:1067); `review repro` refuses a card with no run or no current candidate (src/review/repro.ts:205-211)."
forbid: [weakening or skipping a test to go green, a change to src/loop/card-runner.ts or src/loop/controller.ts, a change to the order or text of an existing refusal, a change to `card next` or `card attempt`, editing a released CHANGELOG section]
non_goals: [other card commands that create a run through cardCtx (card attempt and card red and card withdraw), a refusal inside CardRunner for callers other than the CLI, the review of a run whose success bound no candidate sha on the dry-run path (it reviews the checkout HEAD as today)]
diagnosis:
  root_cause: "The `review r3` and `review pre` actions resolve the run through `cardCtx`, whose `runCtx` calls `ensureCardRun`: a card with no run gets one (PREPARE, deadline started, CARD_DISPATCHED journaled), and `formalReview` then pins no candidate and reviews the checkout HEAD (`pinnedCandidate` returns `pinned ?? head` in a git repository), so a reviewer runs on whatever the checkout holds and its result is recorded as a decision. Found by the implementer of T0-R3-POOL-WAIT (issue 318), whose test avoided it by running from main with no diff."
  same_class: "Every command that takes `cardCtx` creates a run when none exists: card next (by design), card attempt, card red, card withdraw, review dispute, review pre, review r3. Only the two review commands dispatch an external reviewer on the result; the others are left to their own issues (non_goals)."
hygiene: "Issue 328. Pins: review-r3-wait.test.ts acceptance 3 runs `review r3` on a card with no run and asserts exit 1 with one `aidlc: ` line, which R1 keeps (docs/LESSONS.md 2026-11-15 T1-REPLAY-CLEAN). Run every test file that reads docs/OPERATIONS.md or CHANGELOG.md before the first R3 (docs/LESSONS.md 2026-11-11 T0-RELEASE-OP-REISSUE)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-REVIEW-NO-RUN

## Deliverable
`aidlc review r3` and `aidlc review pre` refuse a card that has no card run, or whose run holds no successful attempt, before any reviewer runs and without writing anything, and name the command to run first.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-no-run.test.ts tests/scenarios/review-r3-wait.test.ts tests/scenarios/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
