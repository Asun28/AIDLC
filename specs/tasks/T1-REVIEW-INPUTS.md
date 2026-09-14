---
id: T1-REVIEW-INPUTS
title: Review inputs are bounded and traceable; a diff above the byte cap is never sent, every verdict carries the policy hash, later rounds receive the delta with first-round misses labelled, questions and suggestions never block
status: todo
branch: T1-REVIEW-INPUTS
worktree: C:\wt\T1-REVIEW-INPUTS
allow_paths:
  - src/core/types.ts
  - src/core/review-policy.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - REVIEW.md
  - templates/REVIEW.md
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/core/review-policy.test.ts
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/surface/templates.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-REVIEW-INPUTS.md
dod_command: npm run typecheck && node --test tests/core/review-policy.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
dod_exit: 0
requirements:
  - R7. IF the committed diff exceeds the stage's byte cap, THEN the loop shall refuse the review before dispatch, with no round, decision or model call recorded.
  - R8. The loop shall record the hash of the applied review policy on every round, decision, retained verdict document and journal event, and name it in the prompt together with any rule file the candidate changes.
  - R9. WHEN a round or decision follows an earlier one of the same stage, the loop shall include the delta since the last reviewed candidate in the prompt and mark a new finding outside that delta as a first-round miss.
  - R10. The loop shall treat reasons tagged `[question]` or `[suggestion]` as advisory in both stages and pass the pre-review's advisory notes to the formal review.
acceptance:
  - 1. `review pre` and `review r3` refuse a committed diff above the stage's `maxDiffBytes` before any dispatch, naming the size and the cap; no round, decision, receipt or journal event is recorded; the truncation note leaves the prompt builder (t0-flow.test.ts, pre-review.test.ts). [R7] [dod arm 1]
  - 2. `policyHash` is the sha256 of the applied policy text; it is recorded on every `PreReviewRound` and `ReviewInvocation`, as `policy_hash` in every retained verdict document, in `PRE_REVIEW_DECIDED` and `REVIEW_DECIDED`, and named in the prompt's policy heading; a candidate that changes `REVIEW.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/` or `templates/claude/` gets the rule-files note (pre-review.test.ts, t0-flow.test.ts). [R8] [dod arm 1]
  - 3. A round or decision that follows an earlier decided one of the same stage collects `git diff <lastSha>...<head>` and renders `## Delta since the last reviewed candidate`, or the no-change note when the shas are equal; `ReviewInvocation.candidateSha` is recorded; a new finding whose cited file is outside the delta's paths carries `outsideDelta: true`, and every new finding does when the delta is empty (review-policy.test.ts, pre-review.test.ts, t0-flow.test.ts). [R9] [dod arm 1]
  - 4. Reasons tagged `[question]` or `[suggestion]` are advisory in R2 and R3; the prompt contract and REVIEW.md say so; the R3 prompt lists the latest R2 round's advisory notes for the candidate as non-blocking; the `review pre` summary prints advisory notes (pre-review.test.ts, t0-flow.test.ts, templates.test.ts). [R10] [dod arm 1]
  - 5. `REVIEW.md` and `templates/REVIEW.md` stay identical and both configs carry `reviewPolicyVersion: REVIEW.md@3`; `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and CHANGELOG.md record the truncation rule, the hash, the delta and the tags (templates.test.ts, mirror.test.ts). [dod arm 1]
depends_on: [T1-REVIEW-FINDINGS-2]
plan_ref: plans/review-findings.md#7
budget: 350
tdd: true
sweep: "grep -rn 'truncated\|reviewPolicy()\|priorFindings\|advisory' src tests: pre-review.ts collectCandidateDiff, buildReviewPrompt and finalizeReview, card-runner.ts preReview and formalReview, main.ts review pre summary, pre-review.test.ts prompt and panel tests"
non_goals: [splitting an oversized diff into several reviewer calls, a repository-reading R2, statistics (T1-REVIEW-STATS), new fields in the verdict JSON schema, a human ruling command]
doc_sync: docs/OPERATIONS.md (Pre-review, Formal review), docs/ARCHITECTURE.md (review module), CHANGELOG.md
---

# T1-REVIEW-INPUTS

## Deliverable
Three review inputs are unbounded or untraceable today: a diff cut at `maxDiffBytes` can still pass, the policy a verdict was judged under is a hand-maintained version string, and round two re-reads the whole diff with no delta, so a second decision is spent on findings in code unchanged since the first. This card refuses a diff above the cap before dispatch, records the sha256 of the applied REVIEW.md on every round, decision, retained verdict and journal event and names it in the prompt (with the rule files the candidate changes), adds the delta since the last reviewed candidate to later prompts and labels a new finding outside that delta as a first-round miss, and gives questions and suggestions their own tags that never block, with R2's advisory notes handed to R3.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/review-policy.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
```
- Expected exit code: 0
- Assertion: the review-policy, pre-review, scenario, template and mirror tests named above pass, including the new assertions on the truncation refusal, the policy hash, the delta section, `outsideDelta` and the advisory tags.
