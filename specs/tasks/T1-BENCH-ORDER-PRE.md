---
id: T1-BENCH-ORDER-PRE
title: aidlc review bench run takes --order analysis-first, which puts the reasons before the verdict in the schema and contract, and --pre-command, an R2 reviewer argv for one run that writes no configuration
status: todo
branch: T1-BENCH-ORDER-PRE
worktree: D:\wt\AIDLC\T1-BENCH-ORDER-PRE
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/review/bench.ts
  - src/review/pre-review.ts
  - src/cli/main.ts
  - tests/surface/review-bench-order-pre.test.ts
  - docs/OPERATIONS.md
  - specs/tasks/T1-BENCH-ORDER-PRE.md
dod_command: npm run typecheck && node --test tests/surface/review-bench-order-pre.test.ts tests/surface/review-bench-rounds.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review bench run` shall take `--order <verdict-first|analysis-first>`, default `verdict-first`, and `--pre-command <file>`. Any other `--order` value, and `--pre-command` with `--stage formal`, are refused before any review with the option named. With the default order and no `--pre-command`, every prompt, schema file and case score is as on main.
  - R2. With `--order analysis-first`, `materialiseVerdictSchema` (src/review/pre-review.ts:333-338) shall write `verdict.schema.analysis-first.json` whose `properties` and `required` list `reasons`, `axes`, `verdict` in that order, and the contract line of the prompt (`verdictContract`, :308-310) shall list `"reasons"` and `"axes"` before `"verdict"`, followed by the line `Write the reasons before the verdict.` Both stages accept it; the card runner keeps the default and its schema file name.
  - R3. `--pre-command <file>` (resolved against the checkout root) shall name a JSON file with `command` (non-empty array of non-blank strings), `reviewer` (non-blank), and optional `answerMarker`, `timeoutMs` and `maxDiffBytes`; with `--stage pre` the run shall use these in place of the same keys of `preReview` and keep `preReview`'s `perspectives`, `rounds` and `coverage`, so an empty `preReview.command` no longer refuses the run (src/review/bench.ts:154). A missing or malformed file is refused before any review. No configuration file is written.
  - R4. The report's `options` (T1-BENCH-ROUNDS R5) shall also carry `order` and `preCommand` (the file's `command`, or null); with `--pre-command` the report's `reviewer` is the file's `reviewer`.
  - R5. docs/OPERATIONS.md (Reviewer bench, at the `aidlc review bench run` paragraph) shall state R1 to R4.
acceptance:
  - 1. `tests/surface/review-bench-order-pre.test.ts` (new), "T1-BENCH-ORDER-PRE acceptance 1: analysis-first writes the schema and contract with reasons before verdict, and the default writes them as on main". Compares the default prompt and schema byte for byte with `VERDICT_SCHEMA` and the main contract. Fails on main (option refused). [R1] [R2] [dod arm 1]
  - 2. Same file, "T1-BENCH-ORDER-PRE acceptance 2: --pre-command runs R2 with the given argv and reviewer while preReview.command is empty and writes no configuration". Scripted runner; aidlc.config.json byte-identical after the run. Fails on main. [R3] [R4] [dod arm 1]
  - 3. Same file, "T1-BENCH-ORDER-PRE acceptance 3: a missing or malformed --pre-command file, --pre-command with --stage formal, and an unknown --order are refused before any review". Fails on main. [R1] [R3] [dod arm 1]
  - 4. tests/surface/review-bench-rounds.test.ts, review-bench.test.ts, pre-review.test.ts, r2-pass-notes.test.ts and prose.test.ts pass with no line changed. [R1] [R2] [dod arm 1]
  - 5. The OPERATIONS.md paragraph is as R5 states (reviewer-verified against the diff). [R5]
depends_on: [T1-BENCH-ROUNDS]
budget: 180
tdd: true
sweep: "Main at 0f28b51e; lines move with T1-BENCH-ROUNDS. pre-review.ts: `VERDICT_CONTRACT` :298-299, `verdictContract` :308-310, `VERDICT_SCHEMA` :313-330 (properties `verdict`, `reasons`, `axes`; `required` in that order; `additionalProperties: false`), `materialiseVerdictSchema` :333-338 writes `<reviewDir>/verdict.schema.json`, called by the loop at card-runner.ts:2001 and by the bench at bench.ts:290. bench.ts: reviewer config chosen at :153, refused when its command is empty at :154; pre dispatch :282-286 (no fallback). `PreReviewFallback` src/config.ts:19-28 has the keys R3 names. The DeepSeek CLI the arms run uses reads its prompt from stdin and prints `=== answer ===` before the answer, which is the `answerMarker` of aidlc.config.json."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test, other than an expected literal that pins the exact text of a document line this card's requirements change, updated to the new text and nothing else, each such line named in the Attempt evidence with the requirement that changes it (a test file outside allow_paths needs a recorded amendment first)
  - a change to the prompt, schema or verdict handling of the card runner's R2 or R3
  - writing aidlc.config.json or any configuration file from the bench
non_goals: [R2 switched on in the loop, a spend cap inside the bench (the arms run reads the DeepSeek balance between batches), running the arms, a change to CHANGELOG.md]
hygiene: "Run `npm run check` (typecheck and the full suite, as CI runs it) in the worktree before recording the attempt and put its totals in the Attempt evidence (lesson of T1-REVIEW-SEVERITY-2, CI run 43757539597). Line numbers are from main at 0f28b51e and move with T1-BENCH-ROUNDS; read them again at PREPARE."
doc_sync: docs/OPERATIONS.md (Reviewer bench)
---

# T1-BENCH-ORDER-PRE

## Deliverable
Two bench options: one asks the reviewer for its reasons before its verdict, the other runs R2 with a reviewer given for one run, so a DeepSeek prefilter can be measured while R2 stays off in the loop.

## Why
The outside review of 2026-11-15 keeps one cheap test of the verdict field order and proposes a cheap first pass before R3; R2 is off in this repository (`preReview.command` is empty) and the bench refuses an empty command. Owner's keep rules: intent/review-recall.md, Decisions 2026-11-16.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/review-bench-order-pre.test.ts tests/surface/review-bench-rounds.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.
