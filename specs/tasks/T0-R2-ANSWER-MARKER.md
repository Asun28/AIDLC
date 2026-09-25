---
id: T0-R2-ANSWER-MARKER
title: A pre-review reviewer that prints its reasoning before its answer is read only after a configured answer marker, so a code fence its reasoning leaves open no longer voids the verdict line
status: merged
branch: T0-R2-ANSWER-MARKER
worktree: D:\wt\AIDLC\T0-R2-ANSWER-MARKER
allow_paths:
  - src/config.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/surface/pre-review.test.ts
  - tests/surface/config.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-R2-ANSWER-MARKER.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/config.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHERE `preReview.answerMarker` is a non-empty string, the pre-review reader shall read the verdict only from the stdout text after the last line that equals the marker once the line's surrounding whitespace is trimmed, so fence lines and JSON-looking text before that line never decide the verdict.
  - R2. WHERE the marker is set and no stdout line equals it, the angle shall be a no-verdict `malformed` round, even when the last line is a verdict document (an output cut before its answer never passes); the fence rule and the last-document rule still apply to the text after the marker.
  - R3. WHERE the marker is empty or absent (the default), the pre-review reader shall be unchanged, and the formal review (R3) reader shall be unchanged whatever the setting.
acceptance:
  - 1. An output shaped like the four retained outputs (a `=== reasoning ===` section whose fence lines leave a fence open, then `=== answer ===`, a line of prose and a pass verdict line) is read as a pass with the marker `=== answer ===`, and as no verdict (`malformed`) without the marker (tests/surface/pre-review.test.ts). [R1] [R3] [dod arm 1]
  - 2. With the marker set: an output without a marker line whose last line is a pass verdict is `malformed`; a fence opened after the marker and never closed makes it `malformed`; a pass verdict before the marker followed by an answer with no verdict is `malformed`; with two marker lines only the text after the last one is read (tests/surface/pre-review.test.ts). [R1] [R2] [dod arm 1]
  - 3. `ProjectConfig` accepts `preReview.answerMarker` (a string, default empty), `aidlc.config.json` sets `=== answer ===` for this repository's DeepSeek pre-reviewer, `templates/aidlc.config.json` carries it empty, and the formal review reader ignores the setting (tests/surface/config.test.ts, tests/surface/pre-review.test.ts). [R1] [R3] [dod arm 1]
  - 4. A pre-review round run through `CardRunner` with the marker configured and a scripted reviewer that returns the output of acceptance 1 on every angle is a pass round, and the same round without the marker is a no-verdict round (tests/scenarios/t0-flow.test.ts). [R1] [R3] [dod arm 1]
  - 5. `docs/OPERATIONS.md` states the answer marker rule next to the fence rule; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [R3] [dod arm 1]
depends_on: []
budget: 180
tdd: true
sweep: "grep -n \"readVerdict\\|finalizeReview\\|runReviewPanel\" src/review/pre-review.ts src/loop/card-runner.ts: finalizeReview (pre-review.ts:758) reads every angle with readVerdict(receipt.stdout) (pre-review.ts:759); runReviewPanel calls finalizeReview per angle (pre-review.ts:996); CardRunner runs R2 through runReviewPanel at card-runner.ts:2017 (cfg = preReview) and R3 at card-runner.ts:1494 (cfg = formalReview), so the marker has to reach finalizeReview through the panel options of the R2 call only. PreReviewConfig is src/config.ts:11."
forbid: [reading a verdict from before the marker when the marker is set, passing an output that has no marker line when the marker is set, changing the fence rule or the last-document rule, changing the R3 reader, weakening or deleting an existing reader test]
non_goals: [the DeepSeek CLI itself (it has no option to leave its reasoning out of stdout), an answer marker for the formal review, the quota stream rule (quota detection reads the receipt as before)]
diagnosis:
  root_cause: "The DeepSeek CLI prints `=== reasoning ===`, the model's reasoning, then `=== answer ===` and the answer, all on stdout, and readVerdict reads the whole stdout. The reasoning quotes diffs and code with a closing fence line but no opening one, so its fence lines are unbalanced; the last fence it opens stays open to the end of the output, and under the fence rule of T1-REVIEW-LOOP-GUARDS the verdict line after `=== answer ===` is inside an unclosed fence, so the angle is malformed. Evidence (goal g-20260925101837-61f56b): four angle outputs that each end on a parsing pass verdict line and read as no verdict: T0-SHIP-QUOTA-WAIT R2 cycle 0 round 1 edge-cases (receipt acc1516d5290, 25 fence lines, unclosed opener at stdout line 516, answer at 624), round 2 ac-coverage (a8066c6d6b75, 21, 644, 785), T0-SHIP-QUOTA-WAIT-2 round 1 ac-coverage (9a8f8747b9b5, 45, 1135, 1177) and its retry spec-deviations (2ded75c6863f, 15, 555, 739). In all four every fence line is before `=== answer ===` and none after it. Four of five R2 rounds that day lost an angle this way, and two cards stopped for tool."
  same_class: "The formal review (R3) reader is the same readVerdict, but this repository's R3 reviewer is Claude Opus 5.5, which prints no reasoning section; no R3 output lost a verdict this way."
hygiene: "Found while running T0-SHIP-QUOTA-WAIT and T0-SHIP-QUOTA-WAIT-2. This card's own R2 runs the reader on main, without the marker, so it can lose an angle the same way. Build the test fixture from the shape of the four retained outputs (a closing fence with no opener inside the reasoning), not only from a fence left open on its last line (docs/LESSONS.md 2026-09-25 T0-QUOTA-FALSE-HOLD-2). Run the mutation sweep over the new branch before the first review."
doc_sync: docs/OPERATIONS.md (the fence rule paragraph and Pre-review configuration), CHANGELOG.md
---

# T0-R2-ANSWER-MARKER

## Deliverable
With `preReview.answerMarker` set to `=== answer ===`, a DeepSeek pre-review angle is read from its answer section alone, so unbalanced fence lines in its reasoning no longer turn a pass verdict into a no-verdict round.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/config.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
