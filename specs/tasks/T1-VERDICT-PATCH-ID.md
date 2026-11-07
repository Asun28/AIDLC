---
id: T1-VERDICT-PATCH-ID
title: A CHANGELOG-only base-sync merge whose code patch has the same patch id as the candidate R3 passed keeps that pass, so the merge commit needs only its DoD before the ship
status: todo
branch: T1-VERDICT-PATCH-ID
worktree: D:\wt\AIDLC\T1-VERDICT-PATCH-ID
plan_ref: plans/pstack-study.md#order-of-work
allow_paths:
  - src/probes/git.ts
  - src/loop/card-runner.ts
  - src/core/types.ts
  - src/review/stats.ts
  - tests/scenarios/verdict-patch-id.test.ts
  - tests/infra/git-patch-id.test.ts
  - tests/scenarios/fault-points.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-VERDICT-PATCH-ID.md
dod_command: npm run typecheck && node --test tests/infra/git-patch-id.test.ts tests/scenarios/verdict-patch-id.test.ts tests/scenarios/base-sync-committed.test.ts tests/scenarios/base-sync-review.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. `GitProbe.patchId(cwd, base, head, exclude)` shall return the `git patch-id --stable` of `git diff <base> <head>` with each excluded path left out, and the list of changed paths, or `undefined` when either git call fails, the diff is empty, or patch-id prints no id; argv only, never a shell pipe.
  - R2. WHEN the ship returns `[SHIP-BASE-SYNC-MERGED]`, the last formal decision on the shipped candidate is a pass, the code patch of the merge commit against its new merge base has the same patch id and the same changed paths as the code patch of the shipped candidate against its own merge base (`CHANGELOG.md` excluded on both sides), and no changed path of that patch differs between the two merge bases, THEN the repair the runner opens shall record the carried pass (the reviewed candidate's sha and digest, the merge sha, the patch id).
  - R3. WHEN the attempt that clears that repair records the merge sha as its candidate with a DoD receipt, the SHIP gate shall treat the carried pass as the formal pass of the new candidate: no R3 decision, no second pass, no decision or allowance spent, and the canonical `.review/<card>.json` published for the merge sha with a field naming the sha it was carried from.
  - R4. IF the patch ids or the changed paths differ, a changed path differs between the two merge bases, either id cannot be computed, the merge resolved a path other than `CHANGELOG.md`, the outcome is `[SHIP-BASE-SYNC-COMMITTED]` or a conflict for the merge-conflicts skill, or the recorded candidate is not the merge sha, THEN the merge commit shall be a new candidate exactly as before this card.
  - R5. With `preReview.command` set, the pre-review gate shall run on the merge commit as before; only the formal pass is carried.
  - R6. The carry shall be journaled with both shas and the patch id, and `aidlc review stats` shall count carried passes per card and in the totals.
  - R7. The directive narration after a carried merge shall say that the R3 pass was kept and why, in place of "it costs an R2 round and, once R3 has decided, the second R3 decision".
acceptance:
  - 1. `tests/infra/git-patch-id.test.ts`: on a temporary repository, the same code change on two bases with different CHANGELOG.md lines gives equal patch ids with `CHANGELOG.md` excluded and different ids without the exclusion; an empty diff and a bad ref give `undefined`. [R1] [dod arm 1]
  - 2. `tests/scenarios/verdict-patch-id.test.ts`: a card whose candidate passed R3 hits a CHANGELOG-only base-sync merge with an equal code patch; after the DoD attempt on the merge sha the next directive is the ship, the review invocations hold no new decision, `substantiveDecisions` is unchanged, and the canonical document names the merge sha and the sha it was carried from. [R2] [R3] [R6] [R7] [dod arm 2]
  - 3. Same file: a base whose own change edits a file the card's code patch also changes, in lines the patch does not touch, gets an R3 decision on the merge commit although the patch ids are equal. [R4] [dod arm 2]
  - 4. Same file: an attempt recording a sha other than the merge sha gets an R3 decision. [R4] [dod arm 2]
  - 5. Same file: with `preReview.command` set, the merge commit gets an R2 round and then ships on the carried R3 pass. [R5] [dod arm 2]
  - 6. `tests/scenarios/base-sync-committed.test.ts` and `tests/scenarios/base-sync-review.test.ts` pass unchanged. [R4] [dod arms 3 and 4]
  - 7. `tests/scenarios/fault-points.test.ts` covers the new write or records it as not covered in the verify skill's coverage record, and the sync commit moves at CLOSE on main. [R6] [dod arm 5]
  - 8. The docs and CHANGELOG state R1 to R7 (reviewer-verified against the diff). [R2] [R4]
depends_on: []
budget: 600
sweep: "Sites on main at 01dd308: the `[SHIP-BASE-SYNC-MERGED]` step src/loop/card-runner.ts:2919 to :2924 (the repair and its narration); `formalReviewGate` :1475, which finds the pass by `lastFormalInvocation(run.review.invocations, digest)` :1481 and repairs the canonical document :1484; `secondPassDue`; the merge sentinel src/delivery/github-ship.ts:538; `clearsPendingRepair` src/loop/card-runner.ts:3171. Not sites: the `[SHIP-BASE-SYNC-COMMITTED]` branch :2921 and the conflict branch :2923, which keep their behaviour; the base-sync reviewer (formalReview.baseSync), which decides only a candidate past the allowance."
forbid: [weakening or skipping a test to go green, carrying a pass across any merge but the CHANGELOG-only one, carrying a block or an R2 pass, skipping the DoD on the merge commit, a change to `src/core/review-policy.ts`, editing .aidlc state by hand]
non_goals: [rebase, a patch id across a merge-conflicts-skill resolution, a carry for the ship-path reviewer (`formalReview.command` empty), changing CI, a carry across goals or card runs]
hygiene: "Line numbers are from main at 01dd308; read them again at PREPARE. This is the protocol docs/LESSONS.md warns about most (T1-REVIEW-FINDINGS-4: recover from the artifact that names every binding): the carried pass names the reviewed sha, its digest, the merge sha and the patch id, and the gate admits it only when all match the run. `git patch-id` ignores whitespace and line numbers, so requirement R2 also refuses a carry when the base changed any file the card's patch changes. The carry rides in the persisted event data, never in `extra` (T0-REVIEW-CANDIDATE-PINS). Narration text that names a sha or a ship detail follows T0-NARRATION-QUOTE. Run the verify-card-run-writes skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (Base sync, Review), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-VERDICT-PATCH-ID

## Deliverable
When the base moved only in `CHANGELOG.md`, the ship path's own merge keeps the R3 pass of the code it merged: the merge commit runs its DoD and ships, with no new R3 decision.

## Why
pstack's `shipping` playbook step 3: "A verdict covers a patch, and a chain rebase moves every PR above it to a new SHA without failing any check. Compare `git patch-id` at the verdict SHA with the current head before trusting an older verdict." 18 card runs under `.aidlc/cards/` record a `[SHIP-BASE-SYNC-MERGED]` outcome in their notes. Each merge commit then ran the DoD, an R3 decision and, with the second pass on, possibly a second R3, on code R3 had already passed. Every card edits `CHANGELOG.md` (plan constraint), so this merge recurs whenever two cards ship close together.

## Rules that decide edge cases
- The code patch is the diff from the merge base to the commit, `CHANGELOG.md` excluded. Equal patch id, equal changed paths and no base change to those paths all hold, or nothing is carried.
- A base change to a file the card also changes stops the carry even when the patch id is equal, since patch-id ignores line numbers and R3 read that file as it was. A base change to a caller in another file does not stop it; the DoD on the merge commit and CI on the PR check that case, as in pstack's autopilot-full playbook step 5.
- The card's own CHANGELOG entry is not part of the compared patch; the resolver keeps it byte for byte (T0-BASE-SYNC-CHANGELOG-2), and acceptance 2 asserts the entry is unchanged in the merge.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/git-patch-id.test.ts tests/scenarios/verdict-patch-id.test.ts tests/scenarios/base-sync-committed.test.ts tests/scenarios/base-sync-review.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the fault-point check covers or records the new write.
