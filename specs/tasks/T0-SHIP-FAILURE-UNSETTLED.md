---
id: T0-SHIP-FAILURE-UNSETTLED
title: A ship failure on an effort episode with no settled attempt returns the episode unchanged through an explicit guard, and a refuted attempt keeps the finishedAt of its success, as documented
status: merged
branch: T0-SHIP-FAILURE-UNSETTLED
worktree: D:\wt\AIDLC\T0-SHIP-FAILURE-UNSETTLED
allow_paths:
  - src/core/effort.ts
  - tests/core/effort.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-FAILURE-UNSETTLED.md
dod_command: npm run typecheck && node --test tests/core/effort.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a ship failure reaches an effort episode with no settled attempt (no attempt recorded, or only running and not-counted ones), `afterShipFailure` shall return through an explicit guard before any refutation or ladder step, with the episode unchanged (its attempts, their efforts, its terminal and `escalationUsed`), no refuted attempt and no promotion, and as the next step the running attempt at its own effort and number when one runs, else the ladder's next attempt on the unchanged episode.
  - R2. A refuted attempt shall keep the `startedAt` and `finishedAt` its success recorded; the time of the refutation stays the `ATTEMPT_FINISHED` journal event with `refutedBy`.
  - R3. The JSDoc of `afterShipFailure`, `docs/OPERATIONS.md` (the ship repair attempt paragraph) and `CHANGELOG.md` shall state R1 and R2.
acceptance:
  - 1. `tests/core/effort.test.ts`: for an empty episode, an episode with only a running attempt, one with only not-counted records and one with not-counted records and a running attempt, `afterShipFailure` returns the episode deep-equal to its input, with `refuted` and `promoted` undefined, and the action is the running attempt's effort and number, or the ladder's first attempt when none runs; a running attempt at an effort other than the baseline keeps that effort and `escalationUsed` is unchanged. [R1] [dod arm 1]
  - 2. `tests/core/effort.test.ts`: the refuted attempt keeps the `startedAt` and `finishedAt` of the success it replaces. [R2] [dod arm 1]
  - 3. `tests/core/effort.test.ts` reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section and fails with any one removed; the JSDoc of `afterShipFailure` states both rules. [R3] [dod arm 1]
depends_on: []
budget: 140
tdd: true
sweep: "grep -n 'afterShipFailure\\|findLastIndex\\|finishedAt' src/core/effort.ts src/loop/card-runner.ts docs/OPERATIONS.md: effort.ts:121-137 afterShipFailure finds the last settled attempt (:122); with none (idx -1) it refutes nothing but still runs the ladder step (:127) and re-derives a running attempt's effort from it (:132), setting promoted when the effort differs (:135). The refuted attempt is built by spreading the success (:124), so it keeps startedAt and finishedAt. card-runner.ts:2303 calls afterShipFailure(latest.effort, cause, justification) and is not changed: the guard keeps the signature and the ShipFailureStep shape. OPERATIONS.md:46 is the ship repair attempt paragraph."
forbid: [weakening or skipping a test to go green, editing src/loop/card-runner.ts, rewriting an attempt's recorded evidence or times, a new journal event or schema field]
non_goals: [issue #67 item 1 (same-cause on a constant ship detail, waits for T0-CI-RED-LOGS-2), item 6 (a shipped candidate always having an episode, a card-runner assertion), the ship narration when nothing is refuted (T0-SHIP-NOTHING-REFUTED)]
hygiene: "Filed from issue #67 items 5 and 7 (R2 cycle 0 round 1 edge-cases notes on T0-SHIP-REPAIR-ATTEMPT). Item 7 decision: document that finishedAt stays, not record the refutation time. finishedAt minus startedAt is the implementer attempt's own duration, and the ship failure is a later event about the candidate, which the journal already records (ATTEMPT_FINISHED with refutedBy and its own timestamp); T0-SHIP-REPAIR-ATTEMPT forbids rewriting an attempt's recorded evidence; and recording the time would need a clock afterShipFailure does not take, passed from card-runner.ts, which another session's cards are changing. Run the mutation sweep over the new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (ship repair attempt paragraph), CHANGELOG.md
---

# T0-SHIP-FAILURE-UNSETTLED

## Deliverable
`afterShipFailure` says what it does when there is nothing to refute: an episode with no settled attempt comes back exactly as it went in, and the next step is the attempt already running, at the effort it runs at, or the ladder's first. It no longer re-derives a running attempt's effort when no ladder step happened. The refuted attempt keeping its success's `finishedAt` becomes a documented rule with its reason.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/effort.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
