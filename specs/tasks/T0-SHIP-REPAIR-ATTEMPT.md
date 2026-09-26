---
id: T0-SHIP-REPAIR-ATTEMPT
title: A ship that fails on the candidate's own code (a CI code defect, dod-failed, verify-failed, scope-blocked, budget-over) counts as a failed attempt and reopens the effort episode, so the repair can be recorded instead of card next asking for an attempt that card attempt refuses
status: merged
branch: T0-SHIP-REPAIR-ATTEMPT
worktree: D:\wt\AIDLC\T0-SHIP-REPAIR-ATTEMPT
allow_paths:
  - src/loop/card-runner.ts
  - src/core/effort.ts
  - tests/core/effort.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-REPAIR-ATTEMPT.md
dod_command: npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a ship ends in a code-side repair after the attempt that bound the candidate succeeded (a CI failure classified as a code defect, or the outcomes `dod-failed`, `verify-failed`, `scope-blocked` and `budget-over`), the card runner shall record that the candidate failed as a counted failure on the effort ladder, with a cause naming the ship outcome, and reopen the effort episode, so `aidlc card attempt` records the repair attempt.
  - R2. The next step after such a failure shall be the one `nextEffortAction` chooses on the reopened episode: a repair attempt, the one justified escalation, or STOP/card when the ladder is spent or the same cause repeats without progress; `aidlc card next` shall never return a build directive for an attempt that `aidlc card attempt` would refuse.
  - R3. The repairs that are not the code's fault keep their rules: a base-sync merge conflict and a rejected RED receipt reopen the episode without a counted failure, a review block reopens it through `reopenAfterReviewBlock` without spending an attempt, and a transient CI failure takes its rerun.
acceptance:
  - 1. After a CI failure classified as a code defect on a candidate whose attempt succeeded, `card attempt --outcome success` with a new candidate is recorded and the card ships it; the episode shows a failed attempt with the code-defect cause before the repair (tests/scenarios/ci-rerun.test.ts). [R1] [dod arm 1]
  - 2. The same holds for each of `dod-failed`, `verify-failed`, `scope-blocked` and `budget-over`; the assertion of the R3 skills test that these leave the episode `succeeded` (tests/scenarios/t0-flow.test.ts, "episode kept") is replaced by one that the episode is reopened with a counted failure (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 3. Repeated code-side ship failures follow the ladder: after the counted attempts are spent the next one is STOP/card naming the ladder, and the same normalised cause twice without progress stops early, each returned by `card next` instead of a build directive (tests/core/effort.test.ts and tests/scenarios/ci-rerun.test.ts). [R2] [dod arm 1]
  - 4. For every build directive a ship outcome returns, a success recorded with `card attempt` right after it is accepted (no "episode already succeeded"); a base-sync conflict and a rejected RED receipt still record no counted failure, and a review block still spends no attempt (tests/scenarios/t0-flow.test.ts). [R2] [R3] [dod arm 1]
  - 5. `docs/OPERATIONS.md` (the effort ladder and the ship outcome map) states which ship failures count and that they reopen the episode; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [R3] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "grep -n 'reopenEpisode\\|buildWith(\\|code-defect\\|episode already succeeded' src/loop/card-runner.ts src/core/effort.ts: card-runner.ts:2354 and :2360 send a CI code defect to BUILD with the episode left succeeded; card-runner.ts:2369-2373 send dod-failed, verify-failed, scope-blocked and budget-over to BUILD through buildWith with no effort change; card-runner.ts:2375-2388 (red-missing) and :2421 (merge-conflict) reopen with reopenEpisode (:2591) and count nothing; effort.ts:37 reopenAfterReviewBlock reopens after a review block; recordAttempt refuses with 'episode already succeeded; ship the candidate instead' when nextEffortAction on a succeeded episode admits no attempt. Tests: t0-flow.test.ts:822-845 asserts effort.terminal succeeded for scope-blocked and budget-over ('the episode is not reopened by this card'); ci-rerun.test.ts 'Q7: a code-defect CI failure...' stops at the BUILD directive and never records the repair."
forbid: [weakening or skipping a test to go green, counting a merge conflict, a rejected RED receipt, a review block or a transient CI failure as a failed attempt, a fifth counted attempt, rewriting an attempt's recorded evidence]
non_goals: [the CI classifier itself, the rerun allowance, the effort ladder's size, the ship adapters]
diagnosis:
  root_cause: "applyShipResult sends five code-side ship failures to BUILD without touching the effort episode, which is still succeeded from the attempt that bound the candidate. nextEffortAction then admits no attempt, so recordAttempt refuses the repair ('episode already succeeded; ship the candidate instead') while card next keeps returning a build directive for 'Attempt 2': a livelock that only the card deadline ends. Reproduced on main a64b626 for a CI code defect and for dod-failed (a scenario records a success, ships into the failure, then records the repair: refused, and card next returns build again); found while writing T0-BASE-SYNC-REVIEW acceptance 4 (issue #65 item 4)."
  same_class: "The five outcomes above are the whole class: every other BUILD transition of applyShipResult (review-blocked, red-missing, merge-conflict) already reopens the episode."
hygiene: "Filed from issue #65. The counted-failure rule follows the effort ladder's own rule that DoD failures count (aidlc-loop SKILL.md, Effort); run the mutation sweep over the new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (effort ladder, ship outcome map), CHANGELOG.md
---

# T0-SHIP-REPAIR-ATTEMPT

## Deliverable
A ship that fails on the candidate's own code no longer livelocks the card: the failure is a counted failed attempt, the effort episode reopens, and the repair is recorded and shipped, or the ladder stops the card when it is spent. Repairs that are not the code's fault (a base-sync conflict, a rejected RED receipt, a review block, a transient CI failure) keep their rules.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
