---
id: T1-PARSE-GUARD
title: Control decisions read from text come from a declared structured field first or fail closed; one parse guard module replaces the scattered quota matchers and NUL splits, blank gating config values are refused, and aidlc doctor reports a config error with exit 1 (issues 39, 41, 45, 52)
status: todo
branch: T1-PARSE-GUARD
worktree: D:\wt\AIDLC\T1-PARSE-GUARD
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/parse-guard.ts
  - src/core/review-policy.ts
  - src/review/pre-review.ts
  - src/providers/claude-api.ts
  - src/providers/claude-code.ts
  - src/probes/git.ts
  - src/delivery/github-ship.ts
  - src/delivery/ops.ts
  - src/loop/card-runner.ts
  - src/config.ts
  - src/cli/main.ts
  - src/index.ts
  - tests/core/parse-guard.test.ts
  - tests/core/review-policy.test.ts
  - tests/core/config.test.ts
  - tests/surface/config.test.ts
  - tests/surface/pre-review.test.ts
  - tests/surface/providers.test.ts
  - tests/surface/prose.test.ts
  - tests/infra/git.test.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/ops.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-PARSE-GUARD.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. The config schemas shall refuse a whitespace-only value in every field that gates behaviour, and an empty value in every such field except `preReview.answerMarker` and `worktreeRoot`, with the issue at the field's path.
  - R2. WHEN `aidlc.config.json` does not parse, `aidlc doctor` shall print `config: ERROR` with the failing path and exit 1.
  - R3. Every `-z` name listing in src/ shall be split on NUL only, through `nulList`.
  - R4. WHEN a provider reports a numeric error status, the quota decision shall come from that status alone, else from the text rule, and the result shall name the path that decided (`structured` or `text`).
  - R5. Every quota matcher in src/ shall live in `src/core/parse-guard.ts`, the originals deleted.
  - R6. The candidate shall remove more src/ lines than it adds, tests excluded.
acceptance:
  - 1. `ProjectConfig.parse` refuses `"   "` in each field the sweep lists, with an issue at that path; `preReview.answerMarker` and `worktreeRoot` accept `""`; `aidlc.config.json` and `templates/aidlc.config.json` still parse; the `aidlc.ops.json` schema refuses a whitespace-only `successPattern`, `failurePattern` and `operationIdPattern` (tests/surface/config.test.ts, tests/infra/ops.test.ts). [R1] [dod arm 1]
  - 2. `aidlc doctor` with `preReview.answerMarker` `"   "` exits 1 and prints `config: ERROR` naming `preReview.answerMarker`, with no stack trace (tests/surface/config.test.ts). [R2] [dod arm 1]
  - 3. `collectCandidateDiff` returns `docs/line\nbreak.md` as one path; a test reads every src/ file and finds no split of a `-z` listing outside `nulList` (tests/surface/pre-review.test.ts, tests/core/parse-guard.test.ts). [R3] [dod arm 1]
  - 4. `detectQuotaHold`: status 429 and 529 hold with `via: "structured"`; status 500 with quota words in the text does not hold; with no status the word rule decides and returns `via: "text"` with the matched word (tests/core/parse-guard.test.ts). [R4] [dod arm 1]
  - 5. `ClaudeCodeProvider`: a payload with `is_error` and `api_error_status: 429` is `quota` whatever the exit code, and an `is_error` payload with exit 0 is never `ok`; `ClaudeApiProvider`: 429 and 529 are `quota`, 500 is `error` (tests/surface/providers.test.ts). [R4] [dod arm 1]
  - 6. A quota-hold R2 round persists `via text: <word>` in its reasons (tests/surface/pre-review.test.ts). [R4] [dod arm 1]
  - 7. Each of the six items of issue #45 has a test with the decided outcome (a timeout with quota text on stderr stays `timeout`), and the #41 cases (capitalised abbreviations, the numbered-list branch, capitalised With and Subagent, opening quotes) have prose-lint tests (tests/core/parse-guard.test.ts, tests/surface/prose.test.ts). [R4] [dod arm 1]
  - 8. A test reads every src/ file and finds no quota word pattern outside `src/core/parse-guard.ts`, and `src/core/parse-guard.ts` is at most 30 lines (tests/core/parse-guard.test.ts). [R5] [dod arm 1]
  - 9. `git diff --numstat origin/main...HEAD -- src` sums to fewer added than deleted lines; the close-out states the delta. [R6]
  - 10. `docs/OPERATIONS.md` states the structured-first quota rule, the recorded path and the doctor config error; `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads each exact sentence and fails with any one removed (tests/surface/config.test.ts, tests/surface/pre-review.test.ts). [R1] [R2] [R4] [dod arm 1]
  - 11. Issue filed for plan finding F5 (hook config fallback to an empty frozenPaths, CI log classes, exit 0 as merged), named in the close-out. [R4]
depends_on: []
budget: 600
tdd: true
sweep: "Survey of main at 5983a1e. Quota matchers: review-policy.ts:37-68 (word, QUOTA_PATTERNS, asWords, quotaOutput, detectQuotaHold, 32 lines), review-policy.ts:108-121 classifyVerdict (a timeout branch equal to the fallthrough), pre-review.ts:693-694 and :931, claude-code.ts:178 (substring regex), claude-api.ts:113-121 (status 429/529, already structured). -z splits: pre-review.ts:721-723 splits on NUL or newline (#39); git.ts:154 and github-ship.ts:342 split on NUL only. #52: pre-review.ts:750-756 answerSection trims a whitespace marker to empty; config.ts:27. #41: tests/surface/prose.test.ts:74-112, not src/. Gating config fields: base, reviewPool, reviewPolicyVersion, reviewer, repository, cardsDir, archiveDir, intentDir, specsDir, plansDir, evalsDir, preReview.reviewer, formalReview.reviewer, formalReview.fallback.reviewer, preReview.answerMarker and worktreeRoot (empty allowed), elements of preReview.command, formalReview.command, formalReview.fallback.command, preReview.perspectives, github.requiredChecks, hooks.frozenPaths, hooks.testPathPatterns, hooks.productionPatterns, tierPaths.tierS, tierPaths.tier0, tierPaths.frozen; ops.ts successPattern, failurePattern, operationIdPattern. doctor: main.ts:170 ctx() throws a ZodError through bin/aidlc.js. Structured fields: SDK APIError .status (claude-api), claude -p --output-format json is_error and api_error_status (claude-code); R2 DeepSeek wrapper and R3 plain-text claude -p declare none. Tests with newline-separated git diff --name-only stubs: t0-flow.test.ts (53), pre-review.test.ts:165, r3-fallback.test.ts:54."
forbid: [treating a quota hold as a pass, a change to the verdict schema or the review allowances, a new config key, shipping a candidate whose src/ net is 0 or above]
non_goals: [the CI log classes, the ship sentinel map and the hook config fallback (issue for finding F5), citation tags, router text rules, moving the #41 prose lint into src/]
hygiene: "Lessons 2026-09-25 T1-PROMPT-CHECK-2 and T0-QUOTA-FALSE-HOLD-2 apply: compare the merged word rule with the rules it replaces over a corpus built from real output forms (camelCase, snake_case, all-capitals, acronym-prefixed, plurals) and name every class that changes before the first review. Run the mutation sweep over every new branch (2026-09-24)."
doc_sync: docs/OPERATIONS.md (Pre-review quota paragraph, Setup config keys), docs/ARCHITECTURE.md (review-policy and providers), CHANGELOG.md
---

# T1-PARSE-GUARD

## Deliverable
One parse guard, `src/core/parse-guard.ts`, owns every quota decision and every NUL listing split; a provider's numeric error status decides before any text rule, and each hold records which path decided. Config values that gate behaviour cannot be blank, and `aidlc doctor` reports a bad config as an error with exit 1. src/ gets shorter.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.
