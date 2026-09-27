---
id: T0-SHIP-QUOTA-RESET
title: A quota wait of the formal review or of the ship path names the later reset the reviewer's review pool already keeps, not its own hold or now plus 15 minutes (issue 54)
status: merged
branch: T0-SHIP-QUOTA-RESET
worktree: D:\wt\AIDLC\T0-SHIP-QUOTA-RESET
allow_paths:
  - src/coordination/review-queue.ts
  - src/loop/card-runner.ts
  - tests/infra/review-queue.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-QUOTA-RESET.md
dod_command: npm run typecheck && node --test tests/infra/review-queue.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/r3-fallback.test.ts
dod_exit: 0
requirements:
  - R1. `ReviewQueue.heldUntil(pool, hold, now)` (`src/coordination/review-queue.ts`) shall return the later of `hold` and the reset the pool keeps (the reset `hold()` saves as the later of the pool's reset and a new hold), and `hold` when the pool keeps none.
  - R2. The quota wait of the ship path (`src/loop/card-runner.ts`, about lines 2272-2276) shall name, in its `pollSeconds` and its narration, `heldUntil` of the goal's review pool and its 15-minute hold, instead of that hold alone.
  - R3. The quota wait of the formal review (about line 1211, the primary, the fallback and the base-sync reviewer) shall name `heldUntil` of the held reviewer's own pool (`formalPool`) and the hold `formalReviewerNow` chose, never another reviewer's pool.
  - R4. `docs/OPERATIONS.md` and the CHANGELOG Unreleased section shall state R2 and R3.
acceptance:
  - 1. `tests/infra/review-queue.test.ts`: the helper `heldUntil` returns the pool's reset when it is later than the hold, and the hold when the pool keeps an equal reset, an earlier one or none. [R1] [dod arm 1]
  - 2. `tests/scenarios/t0-flow.test.ts`: with another request of the goal's pool held until now plus 20 minutes and half a second while the ship runs, a ship-path quota wait has `pollSeconds` 1201 and names that reset; without it the wait is still 900 seconds (T0-SHIP-QUOTA-WAIT-3 acceptance 1). [R2] [dod arm 1]
  - 3. `tests/scenarios/r3-fallback.test.ts`: with the reviewer's pool held 90 seconds by another request while the review runs, a formal-review quota wait on a 60-second hold polls 90 seconds and names that reset; with both reviewers held (60 and 120 seconds, their pools held 90 and 150 seconds), the wait names the primary and its own pool's 90 seconds, never the other pool's 150. [R3] [dod arm 1]
  - 4. `tests/scenarios/t0-flow.test.ts` reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section. [R4] [dod arm 1]
depends_on: []
budget: 120
tdd: true
diagnosis:
  root_cause: "ReviewQueue.hold saves the pool's reset as the later of the existing reset and the new hold, but returns only the request. The ship path computes its quota wait from its own now plus 15 minutes, and the formal review from the invocation's recorded hold (formalReviewerNow), so a pool held longer by another request is named too early; the next card next then meets a pool that is still held."
  same_class: "Every quota WAIT: the ship path (card-runner.ts about 2272-2276, fixed here), the formal review (about 1211, primary, fallback and base-sync reviewer, fixed here; formalReviewerNow picks the earlier of two holds, and the wait now raises that one to its own pool's reset), and the pre-review (about 1156-1160: checked and correct, since R2 has no review pool and its wait reads the round's recorded hold)."
sweep: "grep -n \"on: 'review-quota'\\|on: 'pre-review-quota'\" src/loop/card-runner.ts gives the three quota waits (about 1160, 1221, 2398); grep -n 'queue.hold' src/loop/card-runner.ts gives the holds they follow (settlePoolRequest and the ship path)."
forbid: [changing how a hold is recorded or when a pool admits a review, editing src/loop/card-runner.ts outside about lines 1211-1213 and 2272-2276, the pre-review wait]
non_goals: ["the pre-review wait: R2 has no review pool", "the 15-minute length of the ship-path hold", "the provider's retry-after reading"]
hygiene: "Issue 54 (the R3 decision 1 advisory on PR 53). Scoped read-only on main 8f470d9 and approved by the coordinating session, which added the same-class sweep and the edges pinned here. card-runner.ts hunks: about line 1211 (1 line to 3) and 2272-2276 (const to let, 2 lines added); the directives (about 1216 and 2398) read the same variables and are unchanged. Clear of aidlc-a6's T1-AUDIT-FACTS-2 (21, 2309-2322) and aidlc-94's T0-BASE-SYNC-CHANGELOG-EDGES (2491, 2494); aidlc-a6's T1-BOUND-TELEMETRY may later land near 1156-1221. Built RED first on a local branch (88cbf60, 4 assertion failures) and GREEN (4c87a6d) while main was on hold; mutation sweep 8/8, the equal-reset comparison (> against >=) left out as equivalent."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-SHIP-QUOTA-RESET

## Deliverable
A quota wait tells the actor when the review pool really admits a review again: the later of the wait's own hold and the reset the pool already keeps.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/review-queue.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/r3-fallback.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
