---
id: T0-SHIP-NOTHING-REFUTED
title: A ship failure that refutes no recorded success no longer says it counts as a failed attempt, and the build directive a ship failure returns names the attempt number the ladder admits, the one the next build directive names
status: todo
branch: T0-SHIP-NOTHING-REFUTED
worktree: D:\wt\AIDLC\T0-SHIP-NOTHING-REFUTED
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-NOTHING-REFUTED.md
dod_command: npm run typecheck && node --test tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a ship fails on the candidate's own code (a CI failure classified as a code defect, `dod-failed`, `verify-failed`, `scope-blocked` or `budget-over`) and no recorded success is refuted (the run has no effort episode, or its episode's last evaluated attempt is not a success), the card runner shall narrate in the build directive that the ship failure refuted no recorded success and counts no attempt on the effort ladder, and not that the failure counts as a failed attempt; a ship failure that refutes a success keeps the sentence "The failure counts as a failed attempt on the effort ladder."
  - R2. WHEN such a ship failure returns a build directive, the directive's attempt number shall be the number of the ladder step (`nextEffortAction`'s `n`, which is the running repair's number when a repair is running), the number the build directive of the following `aidlc card next` names, also when the episode holds not-counted attempts; a run with no effort episode names attempt 1.
  - R3. `docs/OPERATIONS.md` (the ship repair attempt paragraph) and `CHANGELOG.md` shall state both rules.
acceptance:
  - 1. `tests/scenarios/t0-flow.test.ts`: a card whose run has no effort episode when the ship fails with `dod-failed` gets a build directive whose narration ends with the new no-refutation sentence and does not contain "counts as a failed attempt", names attempt 1, leaves the run without an episode, and the following `card next` build directive names attempt 1; a card whose episode's only evaluated attempt is a failure gets the same narration, an unchanged episode and attempt 2 in both directives; a card whose ship failure refutes a success keeps "The failure counts as a failed attempt on the effort ladder." [R1] [R2] [dod arm 1]
  - 2. `tests/scenarios/t0-flow.test.ts`: a card whose episode holds a not-counted attempt before the success that bound the candidate gets, on a `dod-failed` ship and on a CI code-defect ship, a build directive naming attempt 2 (the ladder's number, not the record count plus one), and the following `card next` build directive names the same attempt 2. [R2] [dod arm 1]
  - 3. `docs/OPERATIONS.md` (the paragraph that begins "A ship that fails on the candidate's own code is a failed attempt") and `CHANGELOG.md` Unreleased carry the two rules under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R3] [dod arm 1]
depends_on: []
budget: 160
tdd: true
sweep: "grep -n 'refuteDirective\\|buildDirective\\|counts as a failed attempt\\|attempts.length' src/loop/card-runner.ts: card-runner.ts:2291 buildDirective falls back to `(next.effort?.attempts.length ?? 0) + 1`, which counts not-counted records; :2303-2312 refuteDirective passes only the running attempt's n and appends 'The failure counts as a failed attempt on the effort ladder.' whether or not `step.refuted` is set; :2297-2302 refutePatch leaves `refutation` undefined for a run with no effort episode; :801-814 build() names `action.n` from nextEffortAction (nextAttemptNumber excludes not-counted records, effort.ts:32). Callers of refuteDirective: the CI code-defect branch (:2380) and dod-failed/verify-failed/scope-blocked/budget-over (:2393). Other buildDirective callers (buildWith, red-missing, merge-failed) are not ship refutations and keep their numbering."
forbid: [weakening or skipping a test to go green, a change to the effort ladder or to afterShipFailure, a new journal event type, counting a ship failure that refuted nothing]
non_goals: [the same-cause rule on a constant ship detail (issue #67 item 1), an explicit guard in afterShipFailure for an episode with nothing settled (issue #67 item 5), asserting that a shipped candidate always has an episode (issue #67 item 6: a run from before effort episodes, or with its episode cleared, still ships and repairs), the refutation time on the refuted attempt (issue #67 item 7), the stored attempt number startAttempt assigns (the record count plus one) versus the ladder's number when not-counted records exist]
diagnosis:
  root_cause: "refuteDirective appends the counted-failure sentence unconditionally, though afterShipFailure refutes nothing when the run has no effort episode or the episode's last evaluated attempt is not a success; and when no repair is running it passes no attempt number, so buildDirective falls back to the episode's record count plus one, which counts not-counted records that nextEffortAction's number (the one build() names) excludes."
  same_class: "build() (card-runner.ts:801-814) and the REVIEW_FIX opening (:590-600) name nextEffortAction's n; buildWith's other callers (red-missing, merge-failed) reopen the episode without a ladder step and are outside this card; refuteDirective is the one ship-failure directive that states a counted failure."
hygiene: "Filed from issue #67 items 4 and 6 (R3 decision 1 and R2 edge-cases on T0-SHIP-REPAIR-ATTEMPT, candidate 2267e14). Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24); the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: docs/OPERATIONS.md (ship repair attempt paragraph), CHANGELOG.md
---

# T0-SHIP-NOTHING-REFUTED

## Deliverable
The build directive a code-side ship failure returns tells the truth about the effort ladder: it says the failure counts as a failed attempt only when a recorded success was refuted, and says nothing was counted when the run had no effort episode or no success to refute. Its attempt number is the ladder's, so it matches the build directive `aidlc card next` returns right after, also when not-counted attempts (a quota wait, a tool outage) came before the refuted success.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
