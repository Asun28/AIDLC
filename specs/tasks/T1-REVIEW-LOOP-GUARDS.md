---
id: T1-REVIEW-LOOP-GUARDS
title: A success attempt on a tdd card without a RED receipt is refused before it binds the candidate, and a reviewer verdict wrapped in a Markdown code fence is read as the verdict
status: merged
branch: T1-REVIEW-LOOP-GUARDS
worktree: D:\wt\AIDLC\T1-REVIEW-LOOP-GUARDS
allow_paths:
  - src/loop/card-runner.ts
  - src/review/pre-review.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/surface/pre-review.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-REVIEW-LOOP-GUARDS.md
dod_command: npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/surface/pre-review.test.ts
dod_exit: 0
requirements:
  - R1. IF a success attempt is recorded for a `tdd: true` card whose run and input carry no RED receipt, THEN `aidlc card attempt` shall refuse it with an error naming the missing receipt and record nothing.
  - R2. WHEN a reviewer's output wraps its verdict JSON in a Markdown code fence, the verdict reader shall read the fenced document as the verdict.
acceptance:
  - 1. `CardRunner.recordAttempt` with `outcome: 'success'` on a `tdd: true` card whose run has no `redReceipt` and whose input carries none throws an error naming the RED receipt; the stored run, its effort episode and its candidate are unchanged, and a following success attempt that carries `redReceipt` is accepted; a `tdd: false` card and a run that already holds a RED receipt are unaffected (t0-flow.test.ts). [R1] [dod arm 1]
  - 2. `readVerdict` and `extractVerdict` return the verdict for an output whose last document is a verdict inside a ```json fence, and inside a bare ``` fence; a fenced verdict followed by a later unfenced verdict still yields the later one; a fenced non-verdict JSON document stays a non-verdict; an unterminated fence stays malformed (pre-review.test.ts). [R2] [dod arm 1]
  - 3. `docs/OPERATIONS.md` states both rules and `CHANGELOG.md` Unreleased carries the entry; a test reads the exact sentences this card adds and fails with any one removed (pre-review.test.ts). [R1] [R2] [dod arm 1]
depends_on: []
plan_ref: plans/review-followups.md#7
budget: 200
tdd: true
sweep: "grep -rn 'recordAttempt(\|redReceipt\|topLevelDocuments\|readVerdict' src/: recordAttempt at card-runner.ts:845, the buildIncomplete gate at card-runner.ts:540 that needs the RED receipt, topLevelDocuments at pre-review.ts:413, readVerdict at pre-review.ts:328"
non_goals: [changing the verdict schema, accepting a fence that is not the last document, changing the no-verdict retry allowance]
forbid: [weakening the fail-closed verdict rule]
hygiene: "Follow-ups 3 and 5 of goal g-20260923224425-e5e886: T1-OPUS55-R3-3 recorded a success without a RED receipt and the card stayed in BUILD until the receipt was patched through aidlc card report; T1-OPUS55-PROMPTS lost an R2 round to a fenced verdict the reader called malformed. Run the mutation sweep before the first review (docs/LESSONS.md)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-REVIEW-LOOP-GUARDS

## Deliverable
Two loop guards. A success attempt on a `tdd: true` card that carries no RED receipt is refused before it binds the candidate, instead of leaving the card stuck in BUILD with every later attempt refused. A reviewer verdict wrapped in a ```json or ``` fence is read as the verdict, instead of costing a no-verdict round.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/surface/pre-review.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
