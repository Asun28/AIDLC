---
id: T0-R3-STOP-DISPUTED
title: R3 stops for a ruling on a re-raise only when the author disputed the finding; an undisputed re-raise gets a repair round, and the stop at decision 4 stays
status: todo
branch: T0-R3-STOP-DISPUTED
worktree: D:\wt\AIDLC\T0-R3-STOP-DISPUTED
allow_paths:
  - src/core/review-policy.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - tests/core/review-policy.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - CLAUDE.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - README.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - CHANGELOG.md
  - specs/tasks/T0-R3-STOP-DISPUTED.md
dod_command: npm run typecheck && node --test tests/core/review-policy.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/review-block.test.ts tests/scenarios/base-sync-review.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `heldFindings` shall return the findings the reviewer received that carry at least one recorded dispute, whatever their current disposition, and shall no longer add a finding because an earlier R3 decision raised it.
  - R2. WHEN a command reviewer's block on decision 2 or later re-raises a held finding, the policy shall return `stop-review`, with the existing detail text.
  - R3. WHEN a command reviewer's block re-raises only findings that are not held, and fewer than `MAX_R3_DECISIONS` decisions are recorded, the policy shall return `review-fix`.
  - R4. A block on decision 4, a ship-path reviewer's block and a base-sync decision shall stop exactly as they do on main.
  - R5. The stop rule shall read the same in `README.md`, the `core/` paragraph of `docs/ARCHITECTURE.md`, the formal review paragraph and the `review` row of `docs/OPERATIONS.md`, both `card-loop.md` copies and the comments of `src/core/review-policy.ts` and `src/core/types.ts`, and the CHANGELOG Unreleased section shall have an entry naming this card.
  - R6. A finding the previous R3 decision raised or re-raised shall still reach the next R3 prompt after an R2 pass resolved it, as on main, and shall not be held by that alone.
acceptance:
  - 1. `tests/core/review-policy.test.ts`: `heldFindings` over a formal finding re-raised and open, a resolved formal finding and a disputed R2 finding returns the disputed one alone; a finding disputed earlier and no longer in the disputed disposition is returned. [R1] [dod arm 2]
  - 2. `tests/core/review-policy.test.ts`: decision 2 re-raising an undisputed finding returns `review-fix` with two decisions left; decision 2 re-raising a disputed finding returns `stop-review`; a block on decision 4 returns `stop-review`. [R2] [R3] [R4] [dod arm 2]
  - 3. `tests/scenarios/t0-flow.test.ts`, the test at line 1428 passes with no change: a finding disputed twice and re-raised twice is still named as a deadlock in the STOP detail. [R1] [dod arm 2]
  - 4. `tests/scenarios/t0-flow.test.ts` 1991, 2016 and 2066 and `tests/scenarios/r3-fallback.test.ts` 190 dispute the finding before the re-raise and keep their stop assertions; 2033 asserts that an undisputed re-raise after an R2 pass returns the card to REVIEW_FIX. [R2] [R3] [dod arm 2]
  - 5. `tests/scenarios/base-sync-review.test.ts` and `tests/scenarios/review-block.test.ts` pass with no change, and the Q6 ship-path tests in `tests/core/review-policy.test.ts` keep their assertions. [R4] [dod arm 2]
  - 6. `git grep 'previous R3 decision raised\|disputed/held\|disputed or held\|each block raises new'` finds nothing outside CHANGELOG.md and specs/, both `card-loop.md` copies stay within 6500 bytes and match, and the CHANGELOG entry exists. [R5] [dod arm 2]
  - 7. `tests/scenarios/t0-flow.test.ts` 2033 keeps its assertion that the prompt names F1, and `tests/core/review-policy.test.ts` reads the prompt set of decisions 2 and 3 over the findings of acceptance 1. [R6] [dod arm 2]
depends_on: []
budget: 200
tdd: true
sweep: "Line numbers checked on main at 111a1c7. The stop reads `heldFindings` at src/core/review-policy.ts:439 and `repeatedFindings` at 452, decided at 186. Callers: src/loop/card-runner.ts:1772 and 2120. With the `lastByR3` arm gone, the `decision` parameter is unused, so strict tsc needs it removed from both callers. `ReviewInvocation.held` (src/core/types.ts:335) keeps its name and shape; only its comment changes. Stated in CLAUDE.md:96-97, docs/OPERATIONS.md:319 and 446, both card-loop.md copies at line 83-84 (6475 of 6500 bytes; this edit shortens them), review-policy.ts 6-8, 182-184 and 431-438. Tried in a scratch copy of 713dee1. Keeping only `disposition === 'disputed' && !resolved` loses the deadlock stop: t0-flow.test.ts:1428 ends REVIEW_FIX, and it still does with `f.disputes.length > 0 && !received.resolved`. `received && f.disputes.length > 0` keeps it, and leaves six failing tests, which are the ones naming the old rule: review-policy.test.ts:184, r3-fallback.test.ts:190, t0-flow.test.ts 1991, 2016, 2033, 2066."
forbid:
  - changing `MAX_R3_DECISIONS`, `MAX_SUBSTANTIVE_REVIEW_DECISIONS`, the deadlines or the no-verdict retry
  - changing `describeDeadlock`, `nonAcceptanceRounds` or the rule that a finding disputed twice cannot be disputed a third time
  - changing the ReviewFinding or ReviewInvocation schema
  - weakening or skipping a test beyond the six named under sweep, whose subject is the rule this card changes
non_goals:
  - a recorded ruling on the same card in place of a replacement card
  - comparing the cited sites of a re-raise to judge progress
  - any R2 change
hygiene: "Source: Anthropic, Building effective agents: an evaluator-optimizer loop is worth running while refinement adds value, and a maximum iteration count is a normal stopping condition. This reverses part of T1-EFF-R3-PROGRESS R1, which added the arm for a finding R3 raised; intent/loop-efficiency.md states the approved constraint as a finding the author disputed and the reviewer raises again, and the CLAUDE.md hard limit says mutual non-acceptance. `src/loop/card-runner.ts` is covered by verify-card-run-writes: run it at SHIP; this card adds no store write. T0-REVIEW-CANDIDATE-PINS and T1-VERIFY-MUTANTS-PROMPT also edit card-runner.ts, and PR 204 edits CLAUDE.md: whichever lands second merges the base."
---

# T0-R3-STOP-DISPUTED

## Deliverable
`heldFindings` keeps only findings the author disputed at any point. A repair that misses a site gets another repair round. `MAX_R3_DECISIONS` remains the iteration cap, and the 3 h card deadline remains the time cap.

`priorFindingsFor` (src/loop/card-runner.ts:346) also reads `held`, to send a finding that an R2 pass resolved. With the `lastByR3` arm gone, an undisputed finding of that kind would leave the next R3 prompt and R3 could not cite it, so the re-raise of acceptance 4 could not happen. The arm moves to a set the prompt alone reads, and no finding leaves the prompt.

PR 204 removed the stop rule from `CLAUDE.md` and points to `docs/OPERATIONS.md`, so R5 no longer names `CLAUDE.md` and this card leaves that file as main has it.

## Why
Measured from the journal, 2026-10-20 to 2026-11-06, 52 cards with an R3 decision:

| Fact | Count |
|---|---|
| STOP/review decisions | 14 |
| Stops that re-raised a finding | 12 |
| Of those, re-raising a finding the author had disputed | 0 |
| Stops followed by a replacement card | 14 |
| Median time from stop to the replacement's dispatch | about 17 h |

R3 pass rate by decision number:

| Decision | Pass | Block |
|---|---|---|
| 1 | 23 | 29 |
| 2 | 12 | 21 |
| 3 | 6 | 4 |
| 4 | 2 | 0 |

In none of the 12 had the author disputed the finding. In the five stops sampled, the block says the repair was incomplete or added a new defect, which is not the mutual non-acceptance the deadlock rule describes.

## Limits
- Decisions 3 and 4 were reached only by blocks of new findings, so those pass rates may not hold for re-raises.
- Several of the 14 rulings cut scope, which is useful human judgement. Under this card such a ruling arrives at decision 4, after up to two more repairs and R3 rounds. T0-REVIEW-IMPACT-BAR removes the most repeated of those rulings.
