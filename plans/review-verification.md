---
slug: review-verification
title: Verify the card-run write protocol and measure the reviewers, from the code-review study
spec: specs/review-verification.md
size: T1
status: draft
created: 2026-10-19T10:00:00Z
---

# Plan: Verify the card-run write protocol and measure the reviewers, from the code-review study (from specs/review-verification.md)

## 1. Goal and boundaries
Eleven cards, one PR each, that act on the findings of the code-review study:
a fault-point check over the card-run write protocol and the project skill
that keeps it in step with the code (from the cursor formal-verification
skills); a reviewer bench that scores the configured reviewers against
recorded candidates (from the article's incidents-become-evals loop); a
defect class on each block with a sweep of every site (the article's
"flag the bug class"); response kinds on disputes (the article's noise
measurement); a pre-existing tag (the article's Pre-existing label); and a mutant
report for R3 (the lesson that asks for a mutation sweep). Cut, with
evidence: a tier path that skips R2 (0 of 156 cards had docs-only allowed
paths), verifier voting (precision is not the measured problem), a TLA+
model (needs Java, which the development machine lacks). Deferred: a
second verified area (the lease and review-queue protocol across two
sessions). Success: each card merged with its DoD green, CI green and its
review passed; the goal's integrated checks pass on the final SHA.

## 2. Minimal acceptable loop
The goal starts after the loop-efficiency goal is DONE. The fault-point
check merges first, then the skill that wraps it. The bench merges before
the two cards that change what a reviewer is asked (class sweep, response
kinds), so each of those PRs can be scored before and after. The mutant
command goes last. Every card edits `CHANGELOG.md`, so the cards run one
at a time.

## 3. Tech stack
none this version

## 4. Directory structure
- `.claude/skills/verify-card-run-writes/` (new): the project verify skill.
- `evals/review/` (new): reviewer bench cases, outside the `evals/*.json`
  set that `aidlc evals run` reads.

## 4.5 Module design
- `tests/scenarios/fault-points.test.ts` (new): the enumerator, the
  invariants and the broken-order self-test, over the real `CardRunner`,
  with each fault injected at the `node:fs` calls every card-run write and
  journal append passes through (`renameSync`, `appendFileSync`); then the
  liveness check with its pinned known violations.
- `.claude/skills/verify-card-run-writes/SKILL.md` (new): property, harm,
  coverage record, sync commit, run command, bounds, modelling error
  versus bug, extension steps, upkeep after drift.
- `src/review/bench.ts` (new): case loading, temporary checkouts, scoring;
  reuses `buildReviewPrompt` and `runReviewPanel`. Export from the ledgers
  and candidate pinning.
- `src/core/review-policy.ts`, `src/review/pre-review.ts`,
  `src/loop/card-runner.ts`: the class tag, the repair directive's class
  list, the pre-existing tag with its changed-line check, the mutant
  section of the R3 prompt.
- `src/review/mutant-gen.ts` (new): an in-house scanner and the mutation
  operators over the changed source lines of a candidate.
- `src/review/mutants.ts` (new): one mutant at a time under the DoD,
  restore, run marker, report bound to the candidate commit.
- `src/review/stats.ts`: responses and the pre-existing count.

## 5. Data model and state machine
Optional fields only: `ReviewFinding.class`, `ReviewFinding.disputes[].kind`.
A new `ReviewBenchCase` file format. The card machine's precedence is
unchanged.

## 6. Contracts and core interfaces
The CLI surface and prompt sections in the spec's Interfaces section;
`VERDICT_SCHEMA` frozen; `reviewPolicyVersion` raised by each card that
changes REVIEW.md's output contract.

## Files that change
- tests/scenarios/fault-points.test.ts (new)
- docs/OPERATIONS.md
- CHANGELOG.md
- .claude/skills/verify-card-run-writes/SKILL.md (new)
- .claude/skills/aidlc-loop/card-loop.md
- templates/claude/skills/aidlc-loop/card-loop.md
- tests/surface/templates.test.ts
- tests/surface/mirror.test.ts
- CLAUDE.md
- src/review/bench.ts (new)
- src/core/types.ts
- src/cli/main.ts
- tests/surface/review-bench.test.ts (new)
- evals/review/README.md (new)
- evals/README.md
- templates/evals/README.md
- docs/ARCHITECTURE.md
- tests/surface/review-bench-export.test.ts (new)
- src/core/review-policy.ts
- src/review/pre-review.ts
- src/loop/card-runner.ts
- REVIEW.md
- templates/REVIEW.md
- .claude/agents/reviewer.md
- templates/claude/agents/reviewer.md
- aidlc.config.json
- templates/aidlc.config.json
- tests/core/review-policy.test.ts
- tests/core/types.test.ts
- tests/surface/pre-review.test.ts
- tests/scenarios/review-block.test.ts
- src/review/stats.ts
- tests/scenarios/dispute-kind.test.ts (new)
- tests/surface/stats.test.ts
- tests/scenarios/pre-existing.test.ts (new)
- src/review/mutant-gen.ts (new)
- tests/surface/mutant-gen.test.ts (new)
- src/review/mutants.ts (new)
- tests/surface/mutants.test.ts (new)
- tests/scenarios/mutants-review.test.ts (new)

## Order of work
1. T1-VERIFY-FAULT-POINTS: fail each covered card-run command at every store write and journal append in turn, recover, check the invariants; self-test on a broken-order component.
2. T1-VERIFY-LIVENESS: after recovery from each fault the run reaches the fault-free end state; each violation the current code shows is pinned with its counterexample and filed as a T0-bugfix card.
3. T1-VERIFY-SKILL: the project verify skill for that check, with its coverage record, sync commit and recorded real-code break; one card-loop rule for project verify skills.
4. T1-REVIEW-BENCH: `aidlc review bench run` scores a stage's reviewer on confirmed cases in temporary checkouts and reports recall and false blocks.
5. T1-REVIEW-BENCH-EXPORT: `aidlc review bench export` drafts unconfirmed cases from the card-run ledgers, with a clean mode, and pins their candidates.
6. T1-REVIEW-CLASS-SWEEP: `(class: <slug>)` on block reasons, recorded on the finding, listed with its sites in the repair directive and checked by the next review.
7. T1-REVIEW-RESPONSES: dispute kinds (`wrong`, `intentional`, `not-worth-fixing`) and the responses in `aidlc review stats`.
8. T1-REVIEW-PRE-EXISTING: the `[pre-existing]` tag, advisory only on a line the candidate did not change, and its count in `aidlc review stats`.
9. T1-VERIFY-MUTANT-GEN: the in-house scanner and mutation operators over the changed source lines of a candidate.
10. T1-VERIFY-MUTANTS: `aidlc card mutants` runs the DoD per mutant, restores each file, and writes the report bound to the candidate commit.
11. T1-VERIFY-MUTANTS-PROMPT: R3 receives the surviving mutants of the current candidate as advisory evidence; `card attempt` refuses while a mutant run is in progress.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-VERIFY-FAULT-POINTS | MUST | fault-point test over the card-run write protocol | - | W1 | - |
| T1-VERIFY-LIVENESS | MUST | liveness check with pinned known violations | T1-VERIFY-FAULT-POINTS | W2 | - |
| T1-VERIFY-SKILL | MUST | project verify skill and the card-loop rule | T1-VERIFY-FAULT-POINTS | W3 | - |
| T1-REVIEW-BENCH | MUST | reviewer bench run | - | W3 | - |
| T1-REVIEW-BENCH-EXPORT | MUST | bench case export and candidate pins | T1-REVIEW-BENCH | W4 | - |
| T1-REVIEW-CLASS-SWEEP | SHOULD | class tag, class list in the repair directive | - | W5 | - |
| T1-REVIEW-RESPONSES | SHOULD | dispute kinds and responses in stats | - | W6 | - |
| T1-REVIEW-PRE-EXISTING | SHOULD | pre-existing tag with the changed-line check | T1-REVIEW-RESPONSES | W7 | - |
| T1-VERIFY-MUTANT-GEN | SHOULD | scanner and operators over changed lines | - | W8 | - |
| T1-VERIFY-MUTANTS | SHOULD | mutant runner, restore and report | T1-VERIFY-MUTANT-GEN | W9 | - |
| T1-VERIFY-MUTANTS-PROMPT | SHOULD | surviving mutants in the R3 prompt | T1-VERIFY-MUTANTS | W10 | - |

The cards share `CHANGELOG.md`, so they run one at a time in the order above.

## Risks
- Eleven cards at the measured 2.7 wall hours per card (about 30 h) exceed
  the 12 h arc deadline; extend it with `aidlc goal extend` when the goal
  starts, or move the SHOULD cards to a follow-up goal.
- The loop-efficiency goal merged before this goal starts (main at cc97b99)
  and changed `card-runner.ts`, `review-policy.ts` and `pre-review.ts`; line
  references in these cards are from main at 597e9a2 and are re-read at
  PREPARE. Its R3 rule holds every disputed finding, so a dispute of any
  kind still stops R3 when re-raised.
- The CI `bench` job (T0-LOOP-BENCH) gates the CLI start counts; a card that
  changes `src/cli/main.ts` runs `npm run bench -- --check` before its first
  review.
- The fault-point check may fail on the current code. The card then stops
  with the counterexample for a T0-bugfix card; the property is not
  weakened.
- A reviewer may mark a real defect `[pre-existing]`; the changed-line
  check keeps a defect on a changed line blocking.
- A mutant run edits files in the card worktree; it refuses a dirty tree
  and restores each file before the next mutant.
- Pinned bench refs keep old commits; they are local refs under
  `refs/aidlc/bench/` and never pushed.

## Proof
- tests/scenarios/fault-points.test.ts: every write of each covered command failed in turn; the broken-order self-test fails; the liveness check passes apart from the pinned violations, and a removed pin fails it.
- tests/surface/templates.test.ts: the verify skill's sections and the card-loop rule in both copies under the byte cap.
- tests/surface/review-bench.test.ts: scripted hit, miss, clean pass, clean block and no-verdict; temporary checkouts removed.
- tests/surface/review-bench-export.test.ts: unconfirmed cases written, no overwrite, candidates pinned, no write under the state directory.
- tests/core/review-policy.test.ts, tests/surface/pre-review.test.ts, tests/scenarios/review-block.test.ts: class recording and the repair directive.
- tests/scenarios/dispute-kind.test.ts, tests/surface/stats.test.ts: dispute kinds and responses in the stats.
- tests/scenarios/pre-existing.test.ts: the pre-existing rule on the command path and the ship path.
- tests/surface/mutant-gen.test.ts: each operator, and no mutant inside a string, template, regex or comment.
- tests/surface/mutants.test.ts: a survivor and a killed mutant, the dirty-tree refusal, the cap, the restore after a runner throw.
- tests/scenarios/mutants-review.test.ts: the R3 section lists survivors for the current candidate only; `card attempt` refuses while a run marker exists; a card ships with no report.

## 10. After merge
none this version (development-only target)
