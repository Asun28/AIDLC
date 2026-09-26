---
id: T0-RUNNING-REPAIR-STOP
title: A repair attempt still running when a ship failure stops the effort ladder can no longer be recorded as a success over the stop, and a running repair the ladder promotes to the escalation is journaled as escalated
status: merged
branch: T0-RUNNING-REPAIR-STOP
worktree: D:\wt\AIDLC\T0-RUNNING-REPAIR-STOP
allow_paths:
  - src/core/effort.ts
  - src/loop/card-runner.ts
  - tests/core/effort.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-RUNNING-REPAIR-STOP.md
dod_command: npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHILE an effort episode's terminal is a stop reason (`same-cause-stop`, `exhausted`, `escalation-unavailable` or `escalation-failed`), `finishAttempt` shall refuse to finish its running attempt with any outcome, naming the terminal, so `aidlc card attempt` records nothing (no attempt outcome, no receipt, no candidate, no journal event) and the episode keeps its stop; an episode with no terminal finishes its running attempt as it does today.
  - R2. WHEN a ship failure refutes the success that bound the candidate and the ladder step changes the effort of a repair attempt that is already running (the promotion to the one justified escalation), the card runner shall journal an `ATTEMPT_STARTED` event for that attempt's number with the new effort, `escalated: true`, `promoted: true`, the effort it was started at as `from` and `reason: 'ship-failure'`, so the journal's latest start of the attempt matches the episode; a step that leaves the running attempt's effort unchanged journals no start.
  - R3. `docs/OPERATIONS.md` (the ship repair attempt paragraph) and `CHANGELOG.md` shall state both rules.
acceptance:
  - 1. `tests/core/effort.test.ts`: for each stop terminal, `finishAttempt` on an episode holding a running attempt throws an error naming the terminal for the outcomes success, fail and not-counted, and the episode is unchanged; an episode with no terminal finishes the same running attempt; `afterShipFailure` that stops with a repair running returns the stop terminal and leaves the running attempt as it was. [R1] [dod arm 1]
  - 2. `tests/scenarios/t0-flow.test.ts`: a card whose repair attempt is running (opened by a review fix) when a ship failure stops the ladder (the third refuted success without progress) stays in STOP: `recordAttempt` with a success, a DoD receipt and a candidate sha throws naming the stop, the stored run keeps state STOP, the stop terminal, the candidate and the receipts it had, the journal gains no `ATTEMPT_FINISHED`, and `card next` returns the stop. [R1] [dod arm 1]
  - 3. `tests/scenarios/t0-flow.test.ts`: with two refuted successes with progress and a repair running at medium, the third ship failure with progress promotes the running repair to high; the journal holds one new `ATTEMPT_STARTED` for that attempt's number with effort `high`, `escalated: true`, `promoted: true`, `from: 'medium'` and `reason: 'ship-failure'`, after the refuted attempt's `ATTEMPT_FINISHED`; a ship failure whose step keeps the running repair at medium journals no `ATTEMPT_STARTED`. [R2] [dod arm 1]
  - 4. `docs/OPERATIONS.md` (the paragraph that begins "A ship that fails on the candidate's own code is a failed attempt") and `CHANGELOG.md` Unreleased carry the two rules under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R3] [dod arm 1]
depends_on: []
budget: 220
tdd: true
sweep: "grep -n 'finishAttempt\\|afterShipFailure\\|terminal\\|ATTEMPT_STARTED' src/core/effort.ts src/loop/card-runner.ts: effort.ts:119-134 afterShipFailure persists a stop as the terminal and leaves a running repair running (:126), and promotes a running repair to the ladder's effort without a journal entry (:127-132); effort.ts:159-189 finishAttempt sets terminal succeeded on any success (:179) with no check of an existing stop; card-runner.ts:847-867 recordAttempt skips nextEffortAction when an attempt is running and calls finishAttempt; card-runner.ts:2297-2310 refutePatch and refuteDirective journal the refuted attempt's ATTEMPT_FINISHED only. Other ATTEMPT_STARTED writers: card-runner.ts:600 (review-fix), :814 (build), :864 (implicit). The one journal reader of ATTEMPT_STARTED, src/audit/verifier.ts:89 and :104, counts it as a mutation event, which a promotion inside a live goal is. Tests: tests/core/effort.test.ts:262-330 (afterShipFailure), tests/scenarios/t0-flow.test.ts:4181-4320 (T0-SHIP-REPAIR-ATTEMPT, the running repair case at :4229)."
forbid: [weakening or skipping a test to go green, a fifth counted attempt, clearing or rewriting a stop terminal, a new journal event type, a new not-counted reason]
non_goals: [settling the running attempt with an outcome of its own (no not-counted reason fits a stop), the same-cause rule on a constant ship detail (issue #67 item 1), the narration and attempt number when nothing was refuted (issue #67 item 4), the R2 notes of issue #67 items 5-7, reopenAfterReviewBlock on a stopped episode]
diagnosis:
  root_cause: "afterShipFailure persists a ladder stop as the episode terminal but leaves a repair that a review fix opened in state running, and finishAttempt sets the terminal to succeeded on any success without looking at an existing stop; recordAttempt skips the ladder check whenever an attempt is running, so a success recorded after the stop overwrites it. Separately, afterShipFailure changes the running repair's effort when the ladder escalates, and refuteDirective journals only the refuted attempt, so the journal keeps the repair's first ATTEMPT_STARTED with escalated false."
  same_class: "The REVIEW_FIX and build stop paths (card-runner.ts:592-595, :804-806) stop only when no attempt is running, and a recordAttempt with no running attempt already refuses a stopped episode through nextEffortAction (card-runner.ts:858-861); afterShipFailure is the one writer that stops an episode with a running attempt, and the one that changes a running attempt's effort."
hygiene: "Filed from issue #67 items 2 and 3 (R3 decision 1 on T0-SHIP-REPAIR-ATTEMPT, candidate 2267e14). Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (ship repair attempt paragraph), CHANGELOG.md
---

# T0-RUNNING-REPAIR-STOP

## Deliverable
A ship failure that stops the effort ladder while a review-fix repair is running keeps the card stopped: `aidlc card attempt` refuses to record that repair, so its success can no longer turn the stopped episode back into a succeeded one. When the ladder instead promotes the running repair to the escalated effort, the journal records the promotion, so the journal and the episode agree on the effort the repair runs at.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
