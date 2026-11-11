---
id: T1-R3-MISS-ADVISORY
title: With `formalReview.missAdvisory` on, from R3 decision 2 a new block reason on lines the delta did not change is advisory unless it is on dimensions 1 to 5
status: todo
branch: T1-R3-MISS-ADVISORY
worktree: D:\wt\AIDLC\T1-R3-MISS-ADVISORY
plan_ref: plans/review-convergence.md#order-of-work
allow_paths:
  - src/config.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - src/review/stats.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - REVIEW.md
  - templates/REVIEW.md
  - tests/scenarios/miss-advisory.test.ts
  - tests/surface/pre-review.test.ts
  - tests/surface/stats.test.ts
  - tests/surface/config.test.ts
  - tests/surface/templates.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-R3-MISS-ADVISORY.md
dod_command: npm run typecheck && node --test tests/scenarios/miss-advisory.test.ts tests/scenarios/pre-existing.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts tests/surface/pre-review.test.ts tests/surface/stats.test.ts tests/surface/config.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. `formalReview.missAdvisory` shall default to false in `src/config.ts`, be false in `templates/aidlc.config.json` and be true in this repository's `aidlc.config.json`.
  - R2. WHEN `missAdvisory` is true and an R3 decision by the configured command is decision 2 or later, is not a second pass and is not a base-sync decision, THEN a block reason shall be advisory when it references no finding the run held before the decision with `re:F<n>`, cites at least one file with a line or a line range, has no cited line inside a changed hunk of the delta since the last reviewed candidate (context lines included), and names a dimension number from 6 to 17.
  - R3. IF the delta cannot be read or is above the diff cap, or the reason has no cited line, has no dimension number, or cites a file the delta deletes or renames, THEN the reason shall be classified as it is with `missAdvisory` false.
  - R4. WHEN the last reviewed candidate is the candidate under review and the decision is not a second pass, the delta shall be read as changing no line.
  - R5. A decision whose block reasons are all advisory under R2 shall be recorded as a pass, and a decision with one or more other block reasons shall be a block that hands the author those reasons only.
  - R6. Each reason made advisory under R2 shall be retained in the `advisory` list of its review invocation with a mark that names it a first-round miss, and `aidlc review stats` shall count those reasons per card and in the totals.
  - R7. WHEN `missAdvisory` is true, the delta section of the R3 prompt shall hold one sentence that states R2; when it is false the prompt shall be the prompt of main at bcdc0665 for the same input.
  - R8. `REVIEW.md` and `templates/REVIEW.md` shall state R2 after the `[pre-existing]` rule, `reviewPolicyVersion` shall be `REVIEW.md@7` in both configuration files, and `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state R1 to R7, the figures of `specs/review-convergence.md` and its check after 15 cards.
acceptance:
  - 1. `tests/scenarios/miss-advisory.test.ts`: with the key off, a decision 2 whose one reason is `[standards] 9 error handling (class: c) @ src/a.ts:10: ...`, with line 10 outside every hunk of the delta, returns REVIEW_FIX with `substantiveBlocks` 2. [R1] [dod arm 1]
  - 2. Same file: with the key on, the same decision is recorded as a pass (`substantiveDecisions` 2, `substantiveBlocks` 1), the invocation's `advisory` holds the reason with the first-round-miss mark, the run gains no finding, and `card next` returns what it returns after a pass at decision 2. [R2] [R5] [R6] [dod arm 1]
  - 3. Same file, key on, each of these decision 2 reasons blocks: the reason of item 1 on dimension 2; on dimension 5; with `re:F1` where F1 is a finding of decision 1; citing a changed line of the delta; citing a context line of a changed hunk; citing two locations of which one is in a changed hunk. A reason with `re:F9`, where the run has no F9, on an unchanged line is advisory. [R2] [dod arm 1]
  - 4. Same file, key on, each of these blocks as with the key off: a reason citing `src/a.ts` with no line; a reason with no dimension number; a delta whose git command fails; a delta above `formalReview.maxDiffBytes`; a reason citing a file the delta deletes; a reason citing the source path of a rename in the delta. [R3] [dod arm 1]
  - 5. Same file, key on: a decision 2 with the reason of item 1 and one reason on a changed line is a block whose reasons, as the REVIEW_FIX directive lists them, hold the second reason only, and the first is in `advisory`. [R5] [dod arm 1]
  - 6. Same file, key on: after every finding of a decision 1 block is disputed, the same commit reviewed again with one new dimension 9 reason on any line is recorded as a pass with that reason advisory. [R4] [dod arm 1]
  - 7. Same file, key on: the reason of item 1 blocks at decision 1, on a second pass and on a base-sync decision. [R2] [dod arm 1]
  - 8. `tests/surface/pre-review.test.ts`: with the key on the delta section of the formal prompt holds the sentence of R7; with the key off the prompt equals the one built before this card for the same input, and the pre-review prompt never holds the sentence. [R7] [dod arm 5]
  - 9. `tests/surface/stats.test.ts`: `aidlc review stats` reports 2 advisory first-round misses for a run that holds two and 0 for a run that holds none, per card and in the totals; a `[pre-existing]` advisory reason is not counted as one. [R6] [dod arm 6]
  - 10. `tests/surface/config.test.ts`: the default is false, the template's `formalReview` keys include `missAdvisory: false`, and a non-boolean value is refused. [R1] [dod arm 7]
  - 11. `tests/surface/templates.test.ts` passes: `REVIEW.md` and `templates/REVIEW.md` are identical and both configuration files name `REVIEW.md@7`. [R8] [dod arm 8]
  - 12. `tests/scenarios/pre-existing.test.ts` and `tests/scenarios/second-pass.test.ts` pass unchanged, and `tests/scenarios/fault-points.test.ts` passes with no pin added. At CLOSE, `.claude/skills/verify-card-run-writes/SKILL.md` moves its sync commit to the merge commit on main. [dod arm 2] [dod arm 3] [dod arm 4]
  - 13. The documents state R1 to R7 with the figures and the check (reviewer-verified against the diff). [R8]
depends_on: [T0-R3-SECOND-PASS-ROOM]
budget: 250
sweep: "git grep -l 'pre-existing\\]' and git grep -l -i 'first-round miss' on main at bcdc0665, specs/tasks, evals and plans left out. Changed here: `enforceCitations` and the delta section in src/review/pre-review.ts (:790, :459), the formal dispatch in src/loop/card-runner.ts (:1830 to :1843, where the diff's changed lines and the delta are collected), src/review/stats.ts (:302, :521), REVIEW.md and its template (:88). Read and not changed: src/core/review-policy.ts:411 (`outsideDelta` stays a path mark on a recorded finding), src/core/types.ts:547, src/cli/main.ts:921 (`review findings` lists findings, and an advisory reason is not one), the ship path :2611 to :2630, tests/scenarios/t0-flow.test.ts, tests/core/review-policy.test.ts, tests/surface/review-bench.test.ts (the bench reviews a candidate once, so no decision 2 exists there), tests/scenarios/narration-quote.test.ts."
forbid: [weakening or skipping a test to go green, a change to `MAX_R3_DECISIONS` or to `src/core/review-policy.ts`, a change to what blocks at decision 1, on a second pass, in the pre-review or on the ship path, editing .aidlc state by hand]
non_goals: [dimension 6 as a blocking dimension for a first-round miss (it is advisory under R2 by the owner's decision of 2026-11-11, which names dimensions 1 to 5), recording an advisory miss as a finding or listing it in `aidlc review findings`, a step that turns advisory reasons into cards, a replay of stored verdicts, a reason whose cited line moved without changing (it is read by the delta's hunks, so a moved line counts as changed and blocks), a verdict whose axes disagree with its root (handled before this rule as on main)]
hygiene: "Line numbers are from main at bcdc0665; read them again at PREPARE. The rule reuses `changedLineRanges` with the delta's diff; it adds no second parser. The first-round-miss mark is text in the retained reason, so `ReviewInvocation` gains no field and `src/core/types.ts` does not change. This card changes files the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE. `REVIEW.md` changes the policy hash; a review in flight at the merge is dispatched again by the existing rule."
doc_sync: docs/OPERATIONS.md (Review, Review after 15 cards), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-R3-MISS-ADVISORY

## Deliverable
With the key on, a later R3 decision blocks on an earlier finding left unfixed, on a defect in the lines the repair changed, and on a dimension 1 to 5 finding anywhere. Any other new reason is kept on the decision as an advisory first-round miss.

## Why
Between 2026-10-22 and 2026-11-11, 57 R3 blocks came at decision 2 or later, second passes not counted. 17 held only new findings on lines the repair had not changed, and 12 of those held no finding on dimensions 1 to 5. Each of the 12 cost a repair round and a review for a defect the first review could have raised. The figures and what the rule gives up are in `specs/review-convergence.md`. Owner's decision of 2026-11-11: `intent/review-convergence.md`.

## Rules that decide edge cases
- The second pass is exempt: it reviews the whole diff by design and has no delta.
- A reason is judged by the hunks of the delta, context lines included, as the `[pre-existing]` rule judges it by the hunks of the whole diff. The reviewer writes no tag.
- Whatever the loop cannot place blocks: no line, no dimension, no readable delta, a deleted or renamed file.
- A pass made by this rule is a pass for everything that follows it, the second pass included.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/miss-advisory.test.ts tests/scenarios/pre-existing.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts tests/surface/pre-review.test.ts tests/surface/stats.test.ts tests/surface/config.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes, the two existing scenario files pass unchanged, and the fault-point check adds no pin.
