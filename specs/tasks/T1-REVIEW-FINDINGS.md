---
id: T1-REVIEW-FINDINGS
title: Review findings with stable ids and dispositions; the next prompt carries them; an unchanged blocked candidate is re-reviewed only when every finding is disputed; deadlocks are named
status: todo
branch: T1-REVIEW-FINDINGS
worktree: C:\wt\T1-REVIEW-FINDINGS
allow_paths:
  - src/core/types.ts
  - src/core/review-policy.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/core/review-policy.test.ts
  - tests/core/types.test.ts
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/surface/templates.test.ts
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-REVIEW-FINDINGS.md
dod_command: npm run typecheck && node --test tests/core/review-policy.test.ts tests/core/types.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a pre-review round or a formal decision ends in a block, the loop shall record one finding with a stable id per cited reason and record a reason that references an earlier finding as a re-raise of that finding.
  - R2. The loop shall let the author dispute an open finding with a note, withdraw a dispute, and list the findings of a card, each journaled.
  - R3. WHEN a review prompt is built after a block, the loop shall list every open finding as one to verify and every disputed finding with its note as one to re-raise only with evidence the note does not answer.
  - R4. IF the current candidate was blocked by the same stage and any finding of that block is open, THEN the loop shall refuse a new round or decision on that candidate.
  - R5. WHILE a candidate holds a pre-review pass from any cycle, the loop shall accept it as pre-reviewed for the formal review.
  - R6. WHEN a finding is re-raised after two disputes, the loop shall name it as a deadlock in the stop detail or in the residual findings handed to R3.
acceptance:
  - 1. `recordFindings` gives every cited reason of a block a sequential id `F<n>` with stage, cycle, round, perspective, cited file and candidate sha; a reason carrying `re:F<k>` (optional space after the colon) is recorded as a re-raise on F<k> and returns it to open; an unknown id makes a new finding; a decided later round of the same stage that does not re-raise an open or disputed finding resolves it (review-policy.test.ts). [R1] [dod arm 1]
  - 2. `aidlc review dispute <card> <id> --note` sets `disputed` and stores the note; a second dispute without a re-raise in between is refused; `aidlc review accept <card> <id>` returns the finding to open; `aidlc review findings <card>` lists id, disposition, disputes, re-raises and resolution; `FINDING_DISPUTED` and `FINDING_ACCEPTED` are journaled; all three refuse a stopped run (t0-flow.test.ts). [R2] [dod arm 1]
  - 3. `buildReviewPrompt` renders `## Prior findings` with the `re:F<n>` instruction, open findings as ones to verify and disputed findings with the note as ones to re-raise only with evidence the note does not answer; the R2 panel prompts and the R3 prompt receive the run's findings (pre-review.test.ts, t0-flow.test.ts). [R3] [dod arm 1]
  - 4. `review pre` and `review r3` refuse a candidate whose last decided round or decision of the same stage was a block while any finding of that block is open, naming the open ids and the two moves (repair to a new candidate, or dispute each), and run when every one is disputed; a pre-review pass for the candidate from an earlier cycle satisfies the formal review's eligibility and the SHIP gate goes to the formal review (t0-flow.test.ts, review-block.test.ts). [R4] [R5] [dod arm 1]
  - 5. The STOP detail of the R3 second block and of exhausted R2 rounds, and the residual handed to R3 under `onExhausted: ship`, name every finding disputed twice and re-raised twice as a deadlock (review-block.test.ts, t0-flow.test.ts). [R6] [dod arm 1]
  - 6. `CardRun.findings` defaults to `[]` so runs written before this change parse; `PRE_REVIEW_DECIDED` and `REVIEW_DECIDED` carry the `findings` and `reraised` id lists (types.test.ts, t0-flow.test.ts). [R1] [dod arm 1]
  - 7. `docs/OPERATIONS.md` gains the findings and dispositions section, `docs/ARCHITECTURE.md` the persisted field, both `card-loop.md` copies name the dispute command within the byte cap, and CHANGELOG.md Unreleased carries the entry (templates.test.ts, mirror.test.ts). [dod arm 1]
depends_on: []
plan_ref: plans/review-findings.md#7
budget: 1050
tdd: true
sweep: "grep -rn 'priorFindings\|Findings to verify\|lastVerdict?.reasons\|residual' src tests: pre-review.ts prompt section and ReviewPromptInput, card-runner.ts preReview, formalReview, preReviewGate, formalReviewGate and preReviewEligibility, t0-flow.test.ts pre-review gate and formal review tests, review-block.test.ts second-block test, pre-review.test.ts prompt test"
non_goals: [a human ruling command or a card resume, fuzzy matching of a re-raised finding without a re:F<n> reference, the delta section and the policy hash (T1-REVIEW-INPUTS), statistics (T1-REVIEW-STATS), changing the R2 rounds cap or the R3 decision allowance]
doc_sync: docs/OPERATIONS.md (Findings and dispositions), docs/ARCHITECTURE.md (persisted-state table), CHANGELOG.md
---

# T1-REVIEW-FINDINGS

## Deliverable
A block today hands the author free-text reasons and the only recorded response is a repaired candidate; the same candidate can be re-reviewed after a block, which spends a round or the last decision without new information. This card makes every cited block reason a finding with a stable id on the card run, lets the author dispute or accept a finding with a recorded note, renders the findings with their dispositions in the next prompt (`re:F<n>` marks a re-raise), refuses to re-review an unchanged blocked candidate until every finding of that block is disputed, keeps a pre-review pass valid for the formal review across cycles, and names a finding disputed twice and re-raised twice as a deadlock in the existing stop details and residuals. The R2 rounds cap and the two R3 decisions stay the only budgets.

Budget 1050, raised from 450 before the first review: the reviewed branch is 1037 net changed lines, of which about 400 are the scenario, policy and prompt tests the seven acceptance items name and about 130 are the two byte-capped `card-loop.md` copies, where the added sentence forced equal cuts and re-wrapped lines.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/review-policy.test.ts tests/core/types.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
```
- Expected exit code: 0
- Assertion: the review-policy, types, pre-review, scenario, template and mirror tests named above pass, including the new assertions on finding ids, re-raises, dispositions, the prior-findings prompt section, the same-candidate guard, the pass valid across cycles and the deadlock naming.
