---
id: T1-REVIEW-COVERAGE-STATS
title: aidlc review stats reports coverage completeness per card and family and the R3 spec findings that followed an R2 round with unaccounted items
status: todo
branch: T1-REVIEW-COVERAGE-STATS
worktree: C:\wt\T1-REVIEW-COVERAGE-STATS
allow_paths:
  - src/review/stats.ts
  - tests/surface/stats.test.ts
  - tests/surface/templates.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-REVIEW-COVERAGE-STATS.md
dod_command: npm run typecheck && node --test tests/surface/stats.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R11. The review statistics shall report, per card and in the family totals, the rounds that requested coverage, the rounds whose coverage was complete, the unaccounted, conflicted and inconsistent item counts, and the R3 spec-axis findings raised on a candidate whose last decided R2 round left an item unaccounted.
  - R12. WHEN a card has no round with coverage, the review statistics shall report zeros and the text `coverage: not requested`.
acceptance:
  - 1. `summarizeReviews` returns per card `coverage` with `roundsRequested` (decided rounds carrying a `coverage` record), `roundsComplete` (of those, rounds with no unaccounted, conflicted or inconsistent item and no malformed entry), `unaccounted`, `conflicted` and `inconsistent` (item counts summed over the rounds) and `r3SpecFindingsAfterIncomplete` (formal findings on the spec axis whose `candidateSha` equals that of a decided R2 round with an unaccounted item and no later decided R2 round on that candidate, the rounds ordered by the decision each one landed: the artifact the run retained for it, and, where a candidate has no such artifact on any of its rounds, the measured end), read off the round records, the findings and those decision artifacts only (stats.test.ts). [R11] [dod arm 1]
  - 2. The family totals sum the coverage fields over the members and the card (stats.test.ts). [R11] [dod arm 1]
  - 3. A card whose rounds carry no `coverage` reports zeros in every field, and `formatReviewStats` prints `coverage: not requested` for it and `coverage: <roundsComplete>/<roundsRequested> complete, unaccounted <n>, conflicted <n>, inconsistent <n>, r3 spec findings after incomplete <n>` otherwise (stats.test.ts). [R11] [R12] [dod arm 1]
  - 4. `docs/OPERATIONS.md` documents the fields under Review statistics and CHANGELOG.md Unreleased carries the entry (templates.test.ts). [dod arm 1]
sweep: "grep -rn 'summarizeReviews\|formatReviewStats\|CardReviewStats\|FamilyStats\|RoundCoverage' src/: the summary and its family totals, the formatter, the exported shapes the CLI prints, and the round field the coverage numbers are read from"
depends_on: [T1-REVIEW-COVERAGE-2, T1-REVIEW-STATS]
plan_ref: plans/review-coverage.md#7
budget: 260
tdd: true
non_goals: [matching a finding to an acceptance item by its text, a required mode, an adoption decision, persisting the summary]
doc_sync: docs/OPERATIONS.md (Review statistics), CHANGELOG.md
---

# T1-REVIEW-COVERAGE-STATS

## Deliverable
T1-REVIEW-COVERAGE retains, in shadow, which acceptance items the `ac-coverage` angle accounted for; nothing reports it, so the question a required mode depends on ("how often does an R2 round leave items unaccounted, and how often does an R3 spec finding follow") has no answer. This card adds the coverage fields to `summarizeReviews`, the family totals and the formatter, read off the round records and the findings the loop persists, never from a counter or a request time (T1-REVIEW-STATS lesson).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/stats.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the stats and templates tests pass, including the per-card coverage fields, the family totals, the R3-after-incomplete fixture and the `not requested` line.
