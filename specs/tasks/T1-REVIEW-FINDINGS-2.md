---
id: T1-REVIEW-FINDINGS-2
title: Review findings with stable ids and dispositions, an unchanged blocked candidate re-reviewed only when every finding is disputed, deadlocks named, every card-run write serialized through one lock (replacement of T1-REVIEW-FINDINGS after its two R3 decisions)
status: todo
branch: T1-REVIEW-FINDINGS-2
worktree: C:\wt\T1-REVIEW-FINDINGS-2
allow_paths:
  - src/core/types.ts
  - src/core/review-policy.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - src/state/goal-store.ts
  - tests/infra/goal-store.test.ts
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
  - specs/tasks/T1-REVIEW-FINDINGS-2.md
dod_command: npm run typecheck && node --test tests/core/review-policy.test.ts tests/core/types.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/infra/goal-store.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a pre-review round or a formal decision ends in a block, the loop shall record one finding with a stable id per cited reason and record a reason that references an earlier finding as a re-raise of that finding.
  - R2. The loop shall let the author dispute an open finding with a note, withdraw a dispute, and list the findings of a card, each journaled.
  - R3. WHEN a review prompt is built after a block, the loop shall list every open finding as one to verify and every disputed finding with its note as one to re-raise only with evidence the note does not answer.
  - R4. IF the current candidate was blocked by the same stage and any finding of that block is open, THEN the loop shall refuse a new round or decision on that candidate.
  - R5. WHILE a candidate holds a pre-review pass from any cycle, the loop shall accept it as pre-reviewed for the formal review.
  - R6. WHEN a finding is re-raised after two disputes, the loop shall name it as a deadlock in the stop detail or in the residual findings handed to R3.
acceptance:
  - 1. `recordFindings` gives every cited reason of a block (root list and both axes of the verdict document, advisory blocks marked `advisory`) a sequential id `F<n>` with stage, cycle, round, perspective (from the structured panel result, a single-angle panel included), cited file and candidate sha; a reason carrying `re:F<k>` (optional space after the colon) is a re-raise of F<k>, resolved against the findings that existed before the round, keeps every re-raise reason with its angle, returns F<k> to open (a resolved F<k> included) and records the index of the dispute it answered; an unknown id makes a new finding; a decided later round of the same stage resolves the findings it received, unchanged since (`revision`) and raised or re-raised in a strictly earlier round (review-policy.test.ts). [R1] [dod arm 1]
  - 2. `aidlc review dispute <card> <id> --note` sets `disputed` and stores the note; one dispute per re-raise, a withdrawn one included; `aidlc review accept <card> <id>` returns the finding to open; `aidlc review findings <card>` lists id, disposition, disputes, re-raises and resolution, on a stopped run too, through an existing run only (an explicit `--goal` when the card runs in several goals; it never creates a run); `FINDING_DISPUTED` and `FINDING_ACCEPTED` are journaled; dispute and accept refuse a stopped run (t0-flow.test.ts). [R2] [dod arm 1]
  - 3. `buildReviewPrompt` renders `## Prior findings` with the `re:F<n>` instruction, open findings as ones to verify and disputed findings as ones to re-raise only with evidence the note does not answer, a deadlocked finding marked as such; the prior reason, every author note and the latest re-raise reason are quoted as one JSON string each under a never-instructions statement; the R2 panel prompts and the R3 prompt are built from the persisted run read under the card-run lock (pre-review.test.ts, t0-flow.test.ts). [R3] [dod arm 1]
  - 4. `review pre` and `review r3` refuse a dirty candidate and refuse a candidate whose last decided round or decision of the same stage (any reviewer, keyed by the candidate sha, advisory blocks included) was a block while a finding of that block is open, naming the open ids and the two moves, and run when every one is disputed, reusing the DoD receipt the block cleared for the unchanged candidate (consumed on restoration, dropped by any later check failure); a pre-review pass for the candidate from an earlier cycle satisfies the formal review and the SHIP gate; without `formalReview.command` a disputed formal block stays pending until the candidate changes (t0-flow.test.ts, review-block.test.ts). [R4] [R5] [dod arm 1]
  - 5. Two distinct disputes answered by re-raises are a deadlock: a third dispute is refused; the STOP detail of the R3 second block and of exhausted R2 rounds, and the residual handed to R3 under `onExhausted: ship` (journaled once per cycle and candidate by the gate and by `review r3` alike, and the R3 prompt line), name it (review-block.test.ts, t0-flow.test.ts, pre-review.test.ts). [R6] [dod arm 1]
  - 6. `CardRun.findings` defaults to `[]` so runs written before this change parse; every `PRE_REVIEW_DECIDED` and `REVIEW_DECIDED` event carries the `findings`, `reraised` and `resolved` id lists; a ledger replay or an artifact re-read records no finding; the ship-path reviewer, which receives no prompt, delivers an empty snapshot (types.test.ts, t0-flow.test.ts, review-block.test.ts). [R1] [dod arm 1]
  - 7. Every card-run write goes through `GoalStore.updateCardRun`: an exclusive lock file with an ownership-checked write and release, a deadline checked on every wait, non-recoverable takeover errors propagated, a stale lock taken over through a serialized marker; a review completion recomputes its findings against the locked record; the R2 round is reserved as `pending` under the lock and the gate waits on it (goal-store.test.ts, t0-flow.test.ts). [R2] [dod arm 1]
  - 8. `docs/OPERATIONS.md` gains the findings and dispositions section, `docs/ARCHITECTURE.md` the persisted fields and the lock, both `card-loop.md` copies name the dispute command within the byte cap, and CHANGELOG.md Unreleased carries the entry (templates.test.ts, mirror.test.ts). [dod arm 1]
  - 9. `extractVerdict` lets the last JSON-looking line of the reviewer output decide alone: a document cut short is malformed (no verdict), never replaced by a draft earlier in the reasoning; prose after the document is still ignored (pre-review.test.ts). [R1] [dod arm 1]
depends_on: []
plan_ref: plans/review-findings.md#7
budget: 2100
tdd: true
sweep: "grep -rn 'saveCardRun\|this.save(\|priorFindings\|blockAnswered\|reusableReceipt\|answeredDispute' src tests: card-runner.ts every write site and guard, goal-store.ts, review-policy.ts, pre-review.ts prompt section, t0-flow.test.ts and review-block.test.ts scenarios, goal-store.test.ts"
non_goals: [a human ruling command or a card resume, fuzzy matching of a re-raised finding without a re:F<n> reference, the delta section and the policy hash (T1-REVIEW-INPUTS), statistics (T1-REVIEW-STATS), changing the R2 rounds cap or the R3 decision allowance, an OS-held file lock, lock fencing that stays valid across a process suspension between the ownership read and the write or the release (R3 decision 1 finding 8), serializing normal lock acquisition and release through the takeover marker (finding 9), a journal outbox that reconciles event delivery for the residual hand-off marker (finding 19)]
doc_sync: docs/OPERATIONS.md (Findings and dispositions), docs/ARCHITECTURE.md (persisted-state table, state layer), CHANGELOG.md
---

# T1-REVIEW-FINDINGS-2

## Deliverable
Replacement of T1-REVIEW-FINDINGS, which stopped after its two R3 decisions on branch T1-REVIEW-FINDINGS (937e62f). Decision 1 (13 findings) and decision 2 (16 findings) were repaired on that branch and on this one, each with a failing test first; this card carries the same change through a fresh R2 cycle and two fresh R3 decisions.

A block gives the author free-text reasons and the only recorded response is a repaired candidate; the same candidate can be re-reviewed after a block without new information. This card makes every cited block reason a finding with a stable id on the card run, lets the author dispute or accept a finding with a recorded note, renders the findings with their dispositions and quoted history in the next prompt (`re:F<n>` marks a re-raise), refuses to re-review an unchanged blocked candidate until every finding of that block is disputed, keeps a pre-review pass valid across cycles, names two rounds of mutual non-acceptance as a deadlock, binds every round to the findings it received at dispatch, and serializes every card-run write through one lock. The R2 rounds cap and the two R3 decisions stay the only budgets.

Acceptance 9 was added after R2 round 2 of this card: an angle's final document lost a closing brace, the extractor fell back to the placeholder draft in the reasoning, and two `...` reasons blocked the round.

Excluded after R3 decision 1 of this card (19 findings; 16 repaired with a failing test first): findings 8 and 9 ask for lock transitions that hold across an arbitrary process suspension between two file operations, which a lock file on a local filesystem cannot give without an OS-held lock (already a non-goal); the stale takeover now requires the owner process to be gone, which closes the crash case the lock exists for. Finding 19 asks for a journal outbox with delivery reconciliation for one marker; the marker is persisted before its event and the event is emitted once per insertion, and an outbox is a journal-wide change outside this card.

RED evidence for the transitions: the retained `.review/T1-REVIEW-FINDINGS-2.red-seeded.log` runs the transition tests against a baseline where the identity interface creates findings and the transitions (dispute, accept, re-raise, resolution, the same-candidate rule, the deadlock) have no behaviour, so every failure is an assertion on a transition; the repair REDs of decision 2 fail on their assertions against the previous sources.

Budget 2100: the reviewed branch T1-REVIEW-FINDINGS was 1650 net changed lines after the repairs of three R2 rounds and one R3 decision; the sixteen findings of decision 2 add the lock on every write, the pending R2 round, finding revisions, dispute indices and their scenarios.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/review-policy.test.ts tests/core/types.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/infra/goal-store.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
```
- Expected exit code: 0
- Assertion: the review-policy, types, pre-review, scenario, store, template and mirror tests named above pass, including the assertions on finding ids, re-raises, dispositions, the prior-findings prompt section, the same-candidate guard, the pass valid across cycles, the deadlock naming, the dispatch snapshot and the card-run lock.
