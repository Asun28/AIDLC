---
id: T1-REVIEW-COVERAGE
title: The ac-coverage angle's verdict carries one coverage entry per acceptance item, the panel joins them per item and the round retains the result in shadow without changing its outcome
status: todo
branch: T1-REVIEW-COVERAGE
worktree: D:\wt\AIDLC\T1-REVIEW-COVERAGE
allow_paths:
  - src/core/types.ts
  - src/config.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/core/types.test.ts
  - tests/core/config.test.ts
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/surface/templates.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-REVIEW-COVERAGE.md
dod_command: npm run typecheck && node --test tests/core/types.test.ts tests/core/config.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R4. WHERE pre-review coverage is `shadow`, the `ac-coverage` angle's contract shall ask for one coverage entry per acceptance item, each an item number, a status of `supported`, `violated` or `unknown`, and the implementation and test locations it names.
  - R5. The verdict parser shall accept a verdict document with or without a `coverage` list, with the Codex output schema unchanged.
  - R6. WHEN a panel round decides, the loop shall join the coverage entries per acceptance item across the angles that reported any: an item no angle reported is `unaccounted`, an item reported both `supported` and `violated` is `conflicted`, an entry marked `supported` without both locations counts as `unknown`, and an entry outside the acceptance list or repeated for the same item by one angle counts as malformed.
  - R7. WHEN an angle's verdict is `pass` and its coverage marks an item `violated`, the round coverage shall list the item as inconsistent.
  - R8. The loop shall retain the round coverage on the pre-review round record and in the decision journal event, and print it in the R2 summary, without changing the round's outcome, the findings it records, the R3 prompt or any allowance.
  - R9. WHERE pre-review coverage is `off`, the pre-review prompt, the verdict document, the round record and the R2 summary shall be as they were before this change.
  - R10. IF pre-review coverage is `shadow` and the pre-review command carries the `{schema}` placeholder, THEN the configuration parser shall reject the configuration.
acceptance:
  - 1. `PreReviewConfig.coverage` parses `off` (the default) and `shadow`; `ProjectConfig` rejects `shadow` when `preReview.command` carries `{schema}` and accepts it without; `templates/aidlc.config.json` parses with `off` and `aidlc.config.json` with `shadow` (config.test.ts, templates.test.ts). [R9] [R10] [dod arm 1]
  - 2. With coverage `shadow`, `buildReviewPrompt` for the `ac-coverage` angle carries the contract line with `"coverage":[{"item":1,"status":"supported|violated|unknown","impl":"file:line","test":"file:line"}]` and the angle text asks for one entry per numbered acceptance item; the other angles' prompts, the single-pass prompt and the R3 prompt are byte-equal to the `off` prompts, and `off` prompts are byte-equal to the pre-change prompts (pre-review.test.ts). [R4] [R9] [dod arm 1]
  - 3. `Verdict` parses a document with `coverage` (item a positive integer, status one of the three, optional string locations) and without it; `extractVerdict` returns the list when present; `VERDICT_SCHEMA` deep-equals its pre-change value (types.test.ts, pre-review.test.ts). [R5] [dod arm 1]
  - 4. `joinCoverage(results, expected)` over fixtures reports `expected`, `accounted`, `unaccounted`, `conflicted`, `inconsistent`, `malformed` and `angles`: an item no angle reported is unaccounted; supported by one angle and violated by another is conflicted; `supported` without both locations counts as unknown and is accounted; an item outside `1..expected` or repeated by one angle counts as malformed and joins nothing; a passing angle that marked an item violated lists it as inconsistent; an angle with no `coverage` list is absent from `angles` (pre-review.test.ts). [R6] [R7] [dod arm 1]
  - 5. In a scenario in `shadow`, the decided round record and the `PRE_REVIEW_DECIDED` event carry `coverage`, the aggregated round document written under `.review/` carries it, and `preReviewSummaryText` prints `coverage: <accounted>/<expected> accounted` with the unaccounted, conflicted and inconsistent item numbers when any; the round's outcome, its findings, the reasons, the R3 prompt and every allowance equal those of the same scripted round in `off`, whose record carries no `coverage` (t0-flow.test.ts). [R8] [R9] [dod arm 1]
  - 6. `docs/OPERATIONS.md` documents the setting, the contract line, the round field and the summary line, `docs/ARCHITECTURE.md` names `joinCoverage` and the two schemas, CHANGELOG.md Unreleased carries the entry (templates.test.ts). [dod arm 1]
depends_on: [T1-REVIEW-INVARIANTS]
plan_ref: plans/review-coverage.md#7
budget: 620
tdd: true
sweep: "grep -rn 'VERDICT_CONTRACT\|VERDICT_SCHEMA\|aggregateVerdicts\|PreReviewRound\b\|preReviewSummaryText\|PRE_REVIEW_DECIDED' src/ templates/: the one contract line and the frozen schema, the one join, the round schema and its writer in card-runner, the summary printer in the CLI, the journal event; templates/aidlc.config.json mirrors the repository config"
forbid: [a change to VERDICT_SCHEMA or to the R3 prompt, a coverage effect on the round outcome or the findings, a new model call]
non_goals: [a required mode, coverage from R3 or from a schema-enforced reviewer, coverage from angles other than ac-coverage, matching findings to items by text, statistics]
doc_sync: docs/OPERATIONS.md (Pre-review coverage), docs/ARCHITECTURE.md (review module, types), CHANGELOG.md
superseded_by: T1-REVIEW-COVERAGE-2
---

# T1-REVIEW-COVERAGE

## Deliverable
The `ac-coverage` angle is asked in prose to name the code and the test for each acceptance item and to block on a gap; its verdict is `pass|block` plus reasons, so an item it skipped looks the same as one it verified, and R3 then spends a decision on the next untested claim of the same list (T0-ARC-EXTERN-DEP-2 lesson). This card adds `preReview.coverage: off|shadow`: in shadow the angle's contract asks for one `{item, status, impl, test}` entry per acceptance item, the zod `Verdict` accepts the optional list, `joinCoverage` labels every item across the angles (accounted, unaccounted, conflicted, inconsistent, malformed) and the round record, the journal event, the round document and the R2 summary carry the result. The outcome, the findings, the R3 prompt, the allowances and the Codex output schema are unchanged; the statistics over these records are T1-REVIEW-COVERAGE-STATS, and a required mode waits for them.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/types.test.ts tests/core/config.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the types, config, pre-review, t0-flow and templates tests pass, including the frozen schema, the contract line in shadow, the join fixtures and the scenario round that retains coverage with an unchanged outcome.
