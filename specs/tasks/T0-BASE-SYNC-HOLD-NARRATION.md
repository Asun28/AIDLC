---
id: T0-BASE-SYNC-HOLD-NARRATION
title: A quota hold of the base-sync reviewer is narrated as that reviewer's hold alone, never as a hold of both the primary and the fallback
status: merged
branch: T0-BASE-SYNC-HOLD-NARRATION
worktree: D:\wt\AIDLC\T0-BASE-SYNC-HOLD-NARRATION
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/base-sync-review.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-BASE-SYNC-HOLD-NARRATION.md
dod_command: npm run typecheck && node --test tests/scenarios/base-sync-review.test.ts tests/scenarios/r3-fallback.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the SHIP gate waits on a quota hold of the base-sync reviewer (the reviewer `formalReviewerNow` resolves for a due base-sync decision), the wait directive's narration shall name that reviewer alone as the held base-sync reviewer, whether or not `formalReview.fallback` is configured, and shall name neither the primary nor the fallback as held.
  - R2. The other wait narrations of the gate shall stay as they are: with a fallback, both formal reviewers held is narrated as a hold of both; without one, a held primary is narrated as that reviewer's hold.
  - R3. `CHANGELOG.md` Unreleased shall carry the fix under this card id.
acceptance:
  - 1. `tests/scenarios/base-sync-review.test.ts`: with a fallback configured and without one, a quota hold of the base-sync reviewer on a base-sync candidate gives a `wait` on `review-quota` whose narration begins `Base-sync reviewer codex-bs reported a quota/rate limit` and names neither the primary nor the fallback reviewer; once the hold clears the base-sync reviewer runs. [R1] [dod arm 1]
  - 2. `tests/scenarios/r3-fallback.test.ts`: both reviewers held gives a narration that begins `Formal reviewers primary and fallback backup both reported a quota/rate limit`, and a held primary with no fallback configured gives one that begins `Formal reviewer primary reported a quota/rate limit`. [R2] [dod arm 1]
  - 3. `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads the exact sentence this card adds and fails with it removed. [R3] [dod arm 1]
depends_on: []
budget: 100
tdd: true
sweep: "grep -rn 'both reported\\|reported a quota' src/ tests/ docs/: card-runner.ts:1207 is the one narration of a formal-review quota wait; it tests primary.fallback and ignores that formalReviewerNow (card-runner.ts:1303-1311) resolved the base-sync reviewer for a due base-sync decision. No test reads the narration: base-sync-review.test.ts:161-208 (acceptance 3, the base-sync hold, with no fallback in its fixture atBaseSync :50) and r3-fallback.test.ts:262 (both held) assert the directive kind and poll only. docs/OPERATIONS.md does not quote the narration."
forbid: [weakening or skipping a test to go green, changing which reviewer the gate resolves or how long it waits]
non_goals: [the JSDoc of formalPool, formalReviewerFor and CandidateInfo.baseSync (issue #65 item 2), a no-verdict retry of the base-sync decision's own (issue #65 item 3), the ship-path quota narration]
diagnosis:
  root_cause: "The wait narration of formalReviewGate was written for the primary-and-fallback layout: it names both reviewers whenever a fallback is configured, from the configuration alone, not from the reviewer formalReviewerNow resolved. T0-BASE-SYNC-REVIEW added a third reviewer that the resolver returns alone for a due base-sync decision, and the narration was not taught about it."
  same_class: "formalReviewGate has one wait narration; the review directives after it already name cfg.reviewer, the resolved reviewer."
hygiene: "Filed from issue #65 item 1 (R2 and R3 advisory on T0-BASE-SYNC-REVIEW). Live in this repository since T0-R3-CODEX-ASTRA configured a fallback beside the base-sync reviewer. Run the mutation sweep over the new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: CHANGELOG.md
---

# T0-BASE-SYNC-HOLD-NARRATION

## Deliverable
When the base-sync reviewer holds a quota, `aidlc card next` says so: the wait names the base-sync reviewer as held. It no longer claims that the primary and the fallback both reported a quota, which with this repository's configuration (Codex primary, Opus 5.5 fallback, `codex-base-sync`) was false.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/base-sync-review.test.ts tests/scenarios/r3-fallback.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
