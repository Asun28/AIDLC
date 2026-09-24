---
slug: review-followups
title: Close the five follow-ups the Opus 5.5 goal left open in the review loop, the rename path handling and the prompt check
spec: specs/review-followups.md
size: T1
status: draft
created: 2026-09-24T05:20:00Z
---

# Plan: Close the five Opus 5.5 follow-ups (from specs/review-followups.md)

## 1. Goal and boundaries
Three small cards, one PR each, closing the five follow-ups of goal
g-20260923224425-e5e886. Cut: verdict schema, review allowances, copy
detection.

## 2. Minimal acceptable loop
Each card merges on its own PR. The three share `CHANGELOG.md` and
`docs/OPERATIONS.md`, so they run in sequence, not because one needs
another's code.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- `src/loop/card-runner.ts`: the RED receipt guard on success attempts.
- `src/review/pre-review.ts`: fenced verdicts; rename-aware name listing.
- `src/probes/git.ts`, `src/core/review-effort.ts`: rename-aware listing, `renameSources` removed.
- `tests/surface/prose.test.ts`, `docs/OPERATIONS.md`, `CHANGELOG.md`: wording and patterns.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
none this version

## Files that change
- src/loop/card-runner.ts
- src/review/pre-review.ts
- src/probes/git.ts
- src/core/review-effort.ts
- tests/scenarios/t0-flow.test.ts
- tests/surface/pre-review.test.ts
- tests/core/review-effort.test.ts
- tests/scenarios/r3-fallback.test.ts
- tests/infra/git.test.ts
- tests/surface/prose.test.ts
- docs/OPERATIONS.md
- CHANGELOG.md

## Order of work
1. T1-REVIEW-LOOP-GUARDS: RED receipt guard, fenced verdicts.
2. T1-RENAME-PATHS: rename-aware name listing for the scope gate and the effort path rule.
3. T1-PROMPT-CHECK-2: end-of-turn wording and wider removed-instruction patterns.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-REVIEW-LOOP-GUARDS | SHOULD | a success without a RED receipt on a tdd card is refused; a fenced verdict is read | - | W1 | - |
| T1-RENAME-PATHS | SHOULD | renamed files listed by both paths, unquoted, for the scope gate and the effort path rule | T1-REVIEW-LOOP-GUARDS | W2 | - |
| T1-PROMPT-CHECK-2 | SHOULD | end-of-turn wording matches the verdict reader; wider removed-instruction patterns | T1-RENAME-PATHS | W3 | - |

The three cards share `CHANGELOG.md` and `docs/OPERATIONS.md`, so they
run one at a time.

## Risks
- `--no-renames` changes the changed-path list every R2 and R3 prompt
  carries; a rename now shows as a deletion and an addition.
- Unfencing must not accept a fence that is not the last document.

## Proof
- tests/scenarios/t0-flow.test.ts: the refused success attempt.
- tests/surface/pre-review.test.ts: fenced verdict; rename listing.
- tests/core/review-effort.test.ts, tests/scenarios/r3-fallback.test.ts: effort path rule on rename sources.
- tests/surface/prose.test.ts: wording and patterns.

## 10. After merge
none this version (development-only target)
