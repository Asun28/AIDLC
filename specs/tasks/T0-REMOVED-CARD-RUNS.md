---
id: T0-REMOVED-CARD-RUNS
title: "The goal's wait and arc-stop directives and the Stop-hook DoD reminder skip the run of a card that a goal revision removed or superseded"
status: todo
branch: T0-REMOVED-CARD-RUNS
worktree: D:\wt\AIDLC\T0-REMOVED-CARD-RUNS
allow_paths:
  - src/loop/controller.ts
  - src/hooks/index.ts
  - src/core/amendments.ts
  - tests/scenarios/amendment.test.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REMOVED-CARD-RUNS.md
dod_command: npm run typecheck && node --test tests/scenarios/amendment.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc next` returns a `wait` directive for a goal in RUN or WAIT, its `on` field and its narration shall name only runs of cards in the goal's current projection (`goal.cards`), the set the arc decides on.
  - R2. WHEN the arc has no admissible work and the goal stops, the controller shall take the stop reason and the next action only from STOP runs of cards in the current projection; with none, the reason is `card` and the next action `inspect the board and the dependency graph`, as before this card.
  - R3. The Stop hook `verify-before-done` shall not list a run whose card a revision of its goal removed (`revisions[].removedCards`) or superseded (a key of `revisions[].supersededCards`), unless the goal's current projection lists that card again. Every other run shall be listed by the rules in force before this card, including a run whose goal lists no cards.
  - R4. The change shall write nothing: the run of a removed or superseded card keeps its record, state and lease, and `aidlc next` and the hook add no write to it.
  - R5. `docs/OPERATIONS.md` (the `goal amend` sentence under T2 and the `verify-before-done` row of the hook table) and the CHANGELOG Unreleased section shall state R1 to R4.
acceptance:
  - 1. `tests/scenarios/amendment.test.ts`: a goal of T1-A and T1-B with both runs in BUILD; a revision drops T1-B and `cards-projected` lists T1-A; `next` returns `wait` whose `on` is `T1-A:BUILD` and whose narration does not contain `T1-B`. Fails before the fix. [R1] [dod arm 1]
  - 2. Same file: the projected card's run is in STOP and a removed card's run, listed first by the store, is in STOP with a different reason; the goal stop carries the projected run's reason, and its next action names the projected card and not the removed one. Fails before the fix. [R2] [dod arm 1]
  - 3. Same file: the removed card's run record is deep-equal before and after the `next` calls of acceptance 1 and 2. [R4] [dod arm 1]
  - 4. `tests/surface/hooks.test.ts`: a goal whose revision 1 removed T1-OLD and superseded T1-SUP by T1-NEW, with BUILD runs and no DoD receipt for all three and no card leases; the Stop context names T1-NEW only. A goal whose revision 2 lists T1-OLD again names it. Fails before the fix. [R3] [dod arm 2]
  - 5. `tests/surface/hooks.test.ts` and `tests/surface/hook-lazy.test.ts` pass with no assertion or fixture changed (reviewer-verified against the diff): their goals list no cards, and their runs keep the reminder. [R3] [dod arm 2] [dod arm 3]
  - 6. The docs and CHANGELOG state R1 to R4 (reviewer-verified against the diff). [R5]
depends_on: []
budget: 220
tdd: true
diagnosis:
  root_cause: "A revision drops a card from `goal.cards` and keeps its run as evidence (`computeRevision`, src/loop/controller.ts:738). `nextInRun` decides the arc on the projection (`cardOutcomes`, :306 to :313) but builds the wait list `running` (:348) and the stop cause `stopped` (:338) from `runs`, every run of the goal; `verifyBeforeDone` (src/hooks/index.ts:598) lists every BUILD, SHIP or REVIEW_FIX run of every active goal. Observed 2026-11-08: after revision 1 of g-20261107095106-c08940 removed T1-VERDICT-PATCH-ID, whose run was in BUILD, `aidlc next` returned `on: T1-BENCH-TRIALS:BUILD,...,T1-VERDICT-PATCH-ID:BUILD`."
  same_class: "Already filtered by the projection: `extendDeadline` (src/loop/controller.ts:788 to :790), `run-driver` (src/loop/run-driver.ts:30 and :102), `renderBoard` (src/state/board.ts:46, rows from `cards`), `nextInClose` (src/loop/controller.ts:413, loops `goal.cards`). Every run on purpose: `review stats` and `review bench export` (src/cli/main.ts:901 and :937, history), worktree reclaim (src/loop/worktree-reclaim.ts:120, keeps a removed card's worktree until its goal is terminal)."
sweep: "grep -rn \"listCardRuns\" src: the sites above. Lines are from main at 05db3eb; read them again at PREPARE."
forbid: [weakening or skipping a test to go green, changing an assertion or fixture of an existing test in tests/surface/hooks.test.ts or tests/surface/hook-lazy.test.ts, stopping or rewriting the run of a removed card, releasing its lease, editing .aidlc state by hand]
non_goals: [a command that stops or withdraws the run of a removed card, changing what worktree reclaim, review stats or the bench export read, listing removed runs elsewhere in the directive]
hygiene: "The hook rule is fail-safe: it skips only a card a revision recorded as removed or superseded, so a goal without a projection keeps every reminder. A card id in a narration stays a plain identifier, as before."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-REMOVED-CARD-RUNS

## Deliverable
After `aidlc goal amend` drops a card whose run is in progress, `aidlc next` waits on and stops for the projected cards only, and the Stop hook stops reminding about the dropped card's DoD. The dropped run stays on record as evidence.

## Attempt evidence
RED, commit efdc536: the DoD test files give tests 66, pass 59, fail 3, skipped 4. Acceptance 1 fails with `on` = `T1-A:BUILD,T1-B:BUILD`; acceptance 2 with reason `card` (the removed run's) for `review`; acceptance 4 with `T1-OLD` and `T1-SUP` listed beside `T1-NEW`. The 4 skips are skipped on main too.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/amendment.test.ts`, "acceptance 1 and 3": `on` is `T1-A:BUILD` and the narration has no `T1-B`, for the directive of `cards-projected` and for a second `next` | pass; failed at efdc536 |
| 2 | same file, "acceptance 2 and 3": the store lists removed T1-A first; the goal stop reason is `review` and its next action names T1-B and `adjudicate`, not T1-A | pass; failed at efdc536 |
| 3 | both tests above: the removed run is deep-equal before `cards-projected` and after the `next` calls | pass |
| 4 | `tests/surface/hooks.test.ts`, "acceptance 4": Stop lists `T1-NEW` only; after revision 2 lists T1-OLD again, `T1-NEW` and `T1-OLD` | pass; failed at efdc536 |
| 5 | `tests/surface/hooks.test.ts` and `tests/surface/hook-lazy.test.ts`: the diff only appends one test to hooks.test.ts and does not touch hook-lazy.test.ts | pass |
| 6 | `docs/OPERATIONS.md` (`goal amend` sentence under T2, `verify-before-done` row) and the CHANGELOG Unreleased entry state R1 to R4 | done, reviewer-verified |

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/amendment.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the typecheck is clean.
