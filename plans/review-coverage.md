---
slug: review-coverage
title: Reviewers check the learned invariants and account for every acceptance item
spec: specs/review-coverage.md
size: T1
status: accepted
created: 2026-09-18T02:15:00Z
---

# Plan: Reviewers check the learned invariants and account for every acceptance item (from specs/review-coverage.md)

## 1. Goal and boundaries
Absorb the three parts of the GPT6 checked-graph card pack that the repository's own review history supports: the learned lessons reach the reviewers (brief 06), the `ac-coverage` angle accounts for every acceptance item in a record the loop keeps (briefs 02-04 as one card, shadow only), and `aidlc review stats` reports the coverage so a later decision on a required mode has evidence (brief 10). In scope: R1-R12. Cut: a required mode, coverage from R3 or a `{schema}` reviewer, an invariant catalogue beyond `docs/LESSONS.md`, timing spans, a traceability projection, a planning preflight, a measured overlap (spec non-goals). Success: three cards merge through the loop's own R2, R3 and GitHub ship; the R2 rounds of the second and third card themselves carry a coverage record, and `aidlc review stats` prints it.

## 2. Minimal acceptable loop
An R2 round in shadow: the `ac-coverage` prompt asks for the coverage list, the verdict carries it, the round record shows `coverage: 3/4 accounted; unaccounted 4`, the outcome is the one the reasons decide, and `aidlc review stats` counts the round.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- src/artifacts/lessons.ts: `reviewLessons(file, maxBytes)`: the NEVER and ALWAYS lines newest first under a byte cap, with the omitted count.
- src/review/pre-review.ts: `lessons` on the prompt input and the `## Learned invariants` section; the `ac-coverage` contract line in shadow; `joinCoverage(results, expected)`; `PanelResult.coverage`; the round document carries it.
- src/core/types.ts: `CoverageEntry`, `Verdict.coverage`, `RoundCoverage`, `PreReviewRound.coverage`.
- src/config.ts: `PreReviewConfig.coverage` with the `{schema}` refinement.
- src/loop/card-runner.ts: reads the lessons with the other prompt inputs for both stages; passes the coverage request to the `ac-coverage` angle; records `coverage` on the round and in `PRE_REVIEW_DECIDED`.
- src/cli/main.ts: `preReviewSummaryText` prints the coverage line.
- src/review/stats.ts: `CoverageStats` per card and in the family totals; the formatter line.

## 5. Data model and state machine
none this version (optional fields on `Verdict` and `PreReviewRound`; card states unchanged)

## 6. Contracts and core interfaces
See the spec section Interfaces and contracts. Frozen: `VERDICT_SCHEMA` (the Codex output schema), the R3 prompt, the outcome precedence of `aggregateVerdicts`, the findings ledger.

## Files that change
- src/artifacts/lessons.ts
- src/review/pre-review.ts
- src/core/types.ts
- src/config.ts
- src/loop/card-runner.ts
- src/cli/main.ts
- src/review/stats.ts
- aidlc.config.json
- templates/aidlc.config.json
- tests/surface/lessons.test.ts
- tests/surface/pre-review.test.ts
- tests/core/types.test.ts
- tests/core/config.test.ts
- tests/scenarios/t0-flow.test.ts
- tests/surface/stats.test.ts
- tests/surface/templates.test.ts
- docs/ARCHITECTURE.md
- docs/OPERATIONS.md
- CHANGELOG.md

## Order of work
1. T1-REVIEW-INVARIANTS: `reviewLessons`, the prompt section for both stages, the runner reading the file with the other inputs; prompt and scenario tests; docs.
2. T1-REVIEW-COVERAGE: the config setting and its refinement, the `Verdict.coverage` schema, the `ac-coverage` contract in shadow, `joinCoverage`, the round record, the journal event and the R2 summary line; both configs; unit and scenario tests; docs.
3. T1-REVIEW-COVERAGE-STATS: `CoverageStats` in `summarizeReviews`, the family totals, the formatter line; stats tests; docs. Runs after T1-REVIEW-STATS (merged as PR #22 under goal g-20260917214550-c76e7f) and T1-REVIEW-COVERAGE.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-REVIEW-INVARIANTS | MUST | the R2 and R3 prompts carry the NEVER and ALWAYS lessons as a checklist with one finding per site | - | W1 | - |
| T1-REVIEW-COVERAGE | MUST | the `ac-coverage` verdict carries a coverage entry per acceptance item; the panel joins them; the round retains the result in shadow | T1-REVIEW-INVARIANTS | W2 | - |
| T1-REVIEW-COVERAGE-STATS | MUST | `aidlc review stats` reports coverage completeness per card and family and the R3 spec findings that followed an incomplete round | T1-REVIEW-COVERAGE, T1-REVIEW-STATS | W3 | - |

## Risks
- All three cards touch `src/review/pre-review.ts` or `src/review/stats.ts` and the docs; they run one at a time so no card starts on a moved base.
- A reviewer that ignores the coverage request produces a round with every item unaccounted; shadow records it and changes nothing, which is the measurement this goal exists for.
- The learned-invariants section adds about 3 KB to every prompt; the cap keeps it bounded when the lessons file grows, and the newest lines win.
- The lessons instruct the reviewer to report one finding per site; a family of ten sites is ten findings with ids, which the disposition CLI already handles.
- `aidlc.config.json` gains a field the deployed template sets to `off`; a downstream repository is unchanged until it opts in.
- The `{schema}` refinement rejects a configuration that used to parse only when it also sets `shadow`, so no existing configuration breaks.

## Proof
- lessons tests: NEVER and ALWAYS selected, NOTE excluded, newest first, the cap and the omitted count, absent file.
- pre-review tests: the section in both stages, quoted data, `none`; the `ac-coverage` contract in shadow and the unchanged prompts in `off`; `extractVerdict` with and without `coverage`; `VERDICT_SCHEMA` deep-equals its pre-change value; `joinCoverage` fixtures for accounted, unaccounted, conflicted, malformed, inconsistent, `supported` without locations.
- config tests: `shadow` with `{schema}` rejected, without accepted, default `off`.
- scenario tests: the lesson line in the R2 and R3 prompts; a shadow round persists `coverage` on the record and in the journal, prints it in the summary, and matches the `off` round on outcome, findings, R3 prompt and allowances.
- stats tests: coverage fields per card, the family totals, `r3SpecFindingsAfterIncomplete` from a fixture, zeros and `coverage: not requested` for a card without coverage rounds.
- templates tests: both configs parse; the template stays `off`.

## 10. After merge
none this version (development-only target)
