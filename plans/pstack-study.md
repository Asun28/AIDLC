---
slug: pstack-study
title: Adopt the review, validation and eval practices of the cursor pstack skills where they beat the loop's
spec: specs/pstack-study.md
size: T1
status: accepted
created: 2026-11-07T09:55:00Z
---

# Plan: Adopt the review, validation and eval practices of the cursor pstack skills where they beat the loop's (from specs/pstack-study.md)

## 1. Goal and boundaries
Four changes taken from pstack 0.15.36: a bench verdict with trials, evals
graded from the agent's tool calls, a repro record per review finding, and an
A/B variant run for agent configuration. Success: the four cards merged with
DoD, R3 and CI green. Cut and deferred practices, including
T1-VERDICT-PATCH-ID (dropped 2026-11-08, goal revision 1):
`intent/pstack-study.md`.

## 2. Minimal acceptable loop
The compare verdict first, since the later cards report numbers that need it:
`aidlc review bench run --trials 3` twice and `aidlc review bench compare` on
the two reports.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- `src/core/trial-compare.ts` (new, pure): median and range over trials, and the four-way verdict. Read by the bench and by the variant evals.
- `src/review/repro.ts` (new): runs a repro argv in temporary checkouts of two commits, reusing the bench's checkout code.
- `src/evals/runner.ts`: the tool-call checks, the temporary checkout, the prompt word check, the variant run.

## 5. Data model and state machine
none this version. Optional record fields only (spec, Data model).

## 6. Contracts and core interfaces
Spec, Interfaces and contracts. The verdict JSON schema and REVIEW.md output
contract are frozen.

## Files that change
- T1-BENCH-TRIALS: `src/core/trial-compare.ts` (new), `src/review/bench.ts`, `src/cli/main.ts`, `tests/core/trial-compare.test.ts` (new), `tests/surface/review-bench.test.ts`, docs.
- T1-FINDING-REPRO: `src/review/repro.ts` (new), `src/core/types.ts` (`ReviewFinding.repro`), `src/review/pre-review.ts` (prior findings section), `src/review/stats.ts`, `src/loop/card-runner.ts` (REVIEW_FIX narration), `src/cli/main.ts`, `tests/scenarios/finding-repro.test.ts` (new), `tests/surface/stats.test.ts`, docs.
- T1-EVAL-TRANSCRIPT: `src/providers/claude-code.ts`, `src/providers/types.ts`, `src/evals/runner.ts`, `src/cli/main.ts`, `evals/agent/*.json` (new), `evals/README.md`, `tests/surface/evals.test.ts`, `tests/surface/providers.test.ts`, docs.
- T1-EVAL-VARIANT: `src/evals/runner.ts`, `src/cli/main.ts`, `tests/surface/evals.test.ts`, `evals/README.md`, docs.
- Every card: `CHANGELOG.md`, `docs/OPERATIONS.md`, its own card file.

## Order of work
1. T1-BENCH-TRIALS: `--trials` on the bench and `aidlc review bench compare` with the pure verdict.
2. T1-EVAL-TRANSCRIPT: tool calls from the provider, the four tool-call checks, the temporary checkout, the prompt word check, and the first agent evals under `evals/agent/`. Second because a model-backed eval runs in the main checkout today, with the repository's `.aidlc/` in reach.
3. T1-FINDING-REPRO: `aidlc review repro`, the record on the finding, the R3 prompt line, the stats counts, the REVIEW_FIX narration.
4. T1-EVAL-VARIANT: `--variant <ref> --trials <n>` with the verdict from card 1. Depends on 1 and 2. With three agent cases it detects only a change that fails a case in every trial.

One worker: every card edits `CHANGELOG.md`.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-BENCH-TRIALS | MUST | bench trials and the compare verdict | - | W1 | - |
| T1-EVAL-TRANSCRIPT | MUST | tool-call checks, temporary checkout, prompt word check, first agent evals | - | W2 | - |
| T1-FINDING-REPRO | MUST | repro record per finding, in the R3 prompt and stats | - | W3 | - |
| T1-EVAL-VARIANT | SHOULD | A/B variant eval run with the verdict | T1-BENCH-TRIALS, T1-EVAL-TRANSCRIPT | W4 | - |

## Risks
- A repro argv is run by the loop on the author's say-so. It runs in a temporary checkout with the same process environment as the DoD, never in the main checkout, and its output is data in the R3 prompt.
- Switching the provider to `stream-json` changes how the final text is read; `tests/surface/providers.test.ts` pins the old payload shape and must keep the quota and `is_error` behaviour.
- `evals/agent/` cases call a model; `aidlc evals run` in CI reads only `evals/*.json`, so they never reach the CI threshold.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `aidlc review bench run --stage formal --trials 3` twice on the confirmed cases and `aidlc review bench compare` on the two reports; the verdict is `no-measurable-difference` or `inconclusive` with its cause.
- Arc: `aidlc evals run --dir evals/agent --provider claude-code` passes the agent evals, and `--variant HEAD~1 --trials 3` prints both sides.

## 10. After merge
none this version (development-only target)
