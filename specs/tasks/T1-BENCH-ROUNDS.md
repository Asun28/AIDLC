---
id: T1-BENCH-ROUNDS
title: aidlc review bench run --rounds reviews a blocked candidate again inside one decision with the found reasons marked not to repeat, while a round adds a new P0 or P1 reason, and scores every round
status: todo
branch: T1-BENCH-ROUNDS
worktree: D:\wt\AIDLC\T1-BENCH-ROUNDS
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/review/bench.ts
  - src/review/pre-review.ts
  - src/cli/main.ts
  - tests/surface/review-bench-rounds.test.ts
  - docs/OPERATIONS.md
  - specs/tasks/T1-BENCH-ROUNDS.md
dod_command: npm run typecheck && node --test tests/surface/review-bench-rounds.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts tests/surface/lesson-match.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/edge-scope.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review bench run` shall take `--rounds <n>`, an integer from 1 to 3, default 1. Any other value, and a value above 1 with `--stage pre`, are refused before any review with the option named. With `--rounds 1` every prompt and case score is as on main.
  - R2. With `--stage formal` and `--rounds` n above 1, each group and trial (src/review/bench.ts:166-188) shall review round 1 as on main; round r+1 (r < n) runs on the same checkout when round r's bound verdict is a block (`bindToCandidate`, :318-325) that adds at least one new cited reason (`citedReasonsOf`) and at least one of its new reasons has `findingSeverity` P0 or P1 (T1-REVIEW-SEVERITY); every cited reason of round 1 is new. A reason is new when its `findingIdentity` (T1-FINDING-IDENTITY), with lines read from the checkout's working tree, differs from the identity of every cited reason of an earlier round, or, when it or an earlier reason has no identity, when its trimmed text differs from every earlier cited reason's. A round ending in no verdict or a quota hold stops the rounds of that group; a quota hold also holds the rest of the run as on main (:176).
  - R3. `buildReviewPrompt` (src/review/pre-review.ts:393-478) shall take `foundInDecision` (optional list of reasons). When it is not empty, the prompt shall hold, directly after the `## Prior findings` section, a section `## Found earlier in this decision` with one line per reason, the reason as a JSON string after `- `, preceded by the sentences: "These defects are already reported for this candidate in this decision. Do not report them again and do not re-raise them with re:F<n>. Review the whole diff for defects they do not cover. Block only on a defect not listed here; pass when you find none." The bench passes every cited reason of rounds 1 to r to round r+1. When the list is absent or empty the prompt is byte-identical to main; the card runner never passes it.
  - R4. With `--rounds` above 1, a bug case's `outcome` and `matched` shall be scored on the cited reasons of every round run, in round order; a clean case is `false-block` when any round blocked. Each case result shall carry `rounds`, one entry per round run with `outcome` (the score on rounds 1 to r), `durationMs` (that round's panel wall time) and `cited` (the count of that round's cited reasons); the report shall carry `roundTotals`, the trial-1 totals after rounds 1 to r for r from 1 to n, a case with fewer rounds keeping its last score.
  - R5. Every report shall carry `options` with `rounds` (the value used).
  - R6. docs/OPERATIONS.md (Reviewer bench, at the `aidlc review bench run` paragraph) shall state R1 to R5.
acceptance:
  - 1. `tests/surface/review-bench-rounds.test.ts` (new), "T1-BENCH-ROUNDS acceptance 1: rounds run while a block adds a new P0 or P1 reason and the found reasons reach the next prompt". Scripted reviewer (the `runner` option): round 1 blocks with a `[P1]` miss, round 2 blocks with a new `[P0]` hit, round 3 is not run at `--rounds 2`; round 2's prompt holds the section of R3 with round 1's reason. Fails on main (option refused). [R1] [R2] [R3] [R4] [dod arm 1]
  - 2. Same file, "T1-BENCH-ROUNDS acceptance 2: no further round after a pass, after a block with only repeated or only P2 new reasons, or after no verdict". Repeated covers same identity with other text, and same text with no identity. Fails on main. [R2] [dod arm 1]
  - 3. Same file, "T1-BENCH-ROUNDS acceptance 3: rounds and roundTotals score each round on the union of cited reasons, and a clean case blocked in round 2 is a false block". Fails on main. [R4] [R5] [dod arm 1]
  - 4. Same file, "T1-BENCH-ROUNDS acceptance 4: --rounds outside 1 to 3, or above 1 with --stage pre, is refused before any review, and --rounds 1 prompts as main does". Fails on main for the refusals. [R1] [R3] [dod arm 1]
  - 5. tests/surface/review-bench.test.ts, pre-review.test.ts, lesson-match.test.ts, r2-pass-notes.test.ts, edge-scope.test.ts and prose.test.ts pass with no line changed. [R1] [R3] [dod arm 1]
  - 6. The OPERATIONS.md paragraph is as R6 states (reviewer-verified against the diff). [R6]
depends_on: [T1-REVIEW-SEVERITY-3, T1-FINDING-IDENTITY]
budget: 230
tdd: true
sweep: "Main at 0f28b51e. bench.ts: `runReviewBench` :147-188 (stage config :153, groups :166-170, trials :173-179, quota hold :176 and :294), `reviewGroup` :199-215 (detached checkout), `reviewIn` :257-300 (prompt `common` with `priorFindings: []` and `round: 1` at :278; formal :287-292), `bindToCandidate` :318-325, `score` :327-338, `totalsOf` :340-356, `ReviewBenchReport` :69-85, `BenchCaseResult` :35-49. pre-review.ts: `buildReviewPrompt` :393-478 (Prior findings at :450), `renderPriorFindings` :264-290. CLI: `review bench run` src/cli/main.ts:1167-1187 (`--rules` checked :1179, `--trials` :1180)."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test, other than an expected literal that pins the exact text of a document line this card's requirements change, updated to the new text and nothing else, each such line named in the Attempt evidence with the requirement that changes it (a test file outside allow_paths needs a recorded amendment first)
  - a change to the prompt, schema or verdict handling of the card runner's R2 or R3
  - writing aidlc.config.json or any configuration file from the bench
non_goals: [rounds in the card loop, the verdict field order and an R2 reviewer argv (T1-BENCH-ORDER-PRE), running the arms, a change to CHANGELOG.md]
hygiene: "Run `npm run check` (typecheck and the full suite, as CI runs it) in the worktree before recording the attempt and put its totals in the Attempt evidence (lesson of T1-REVIEW-SEVERITY-2, CI run 43757539597). Line numbers are from main at 0f28b51e and move with T1-REVIEW-SEVERITY and T1-FINDING-IDENTITY; read them again at PREPARE."
doc_sync: docs/OPERATIONS.md (Reviewer bench)
---

# T1-BENCH-ROUNDS

## Deliverable
`aidlc review bench run --rounds 3` measures how many more of a candidate's defects R3 finds when a blocked candidate is reviewed again inside one decision with what it already found marked "do not repeat".

## Why
33.3% of cards with a formal decision had two or more blocks and 45.2% passed at decision 1 (docs/reliability/baseline.md). OCR runs a second round inside one decision with the confirmed findings marked "do not repeat" and stops when a round finds nothing new; the outside review of 2026-11-15 ranks it first, to be measured on the recall baseline before the loop uses it. Owner's keep rule and the P0/P1 trigger: intent/review-recall.md, Decisions 2026-11-16.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/review-bench-rounds.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts tests/surface/lesson-match.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/edge-scope.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.
