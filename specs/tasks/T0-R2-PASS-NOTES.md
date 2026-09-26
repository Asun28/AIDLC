---
id: T0-R2-PASS-NOTES
title: Every review prompt asks that a pass with notes list each note once, in the top-level reasons, and that the verdict line be checked as one complete JSON document before it is sent (issue #82), with the reader unchanged
status: todo
branch: T0-R2-PASS-NOTES
worktree: D:\wt\AIDLC\T0-R2-PASS-NOTES
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/r2-pass-notes.test.ts
  - tests/surface/pre-review.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-R2-PASS-NOTES.md
dod_command: npm run typecheck && node --test tests/surface/r2-pass-notes.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `buildReviewPrompt` shall add two lines to every review prompt (R2 and R3, a single pass and each angle, coverage on or off), each on its own line right after the line on `[question]` and `[suggestion]` reasons, in this order. The first says that a pass that carries notes lists each note once, in the top-level `reasons`, and leaves the `reasons` of both axes empty, so the verdict line stays short. The second asks the reviewer, before it sends the verdict line, to check that the line is one complete JSON document (every `{` and `[` closed, the line ending with the `}` that closes the document), and says that a line one closing brace short does not parse and returns no verdict. The verdict contract line and every other line of the prompt stay byte for byte as they are.
  - R2. The reader (`answerSection`, `readVerdict`, `extractVerdict`, `enforceCitations`, `finalizeReview`) shall stay unchanged. The two answers issue #82 retained still read as `no-verdict` / `malformed`, and are never repaired; the same notes written as R1 asks (each once, in the top-level `reasons`, both axes empty) read as a pass whose advisory notes are those notes.
  - R3. `docs/OPERATIONS.md` (the end-of-turn paragraph) and the CHANGELOG Unreleased section shall state R1 and R2, and that the `deepseek` command has no JSON output mode to hold R2 to the verdict schema.
acceptance:
  - 1. `tests/surface/r2-pass-notes.test.ts`: every pre and formal prompt, a single pass and each angle of `PERSPECTIVES`, with coverage on and off, has the two lines of R1 as its own lines, the notes line directly after the `[question]`/`[suggestion]` line and the balance line directly after it. [R1] [dod arm 1]
  - 2. `tests/surface/pre-review.test.ts`: the pre-change hash pins still hold with exactly the two lines of R1 removed, as they do with the T1-OPUS55-PROMPTS sentences removed, so no other byte of any prompt changed. [R1] [dod arm 1]
  - 3. `tests/surface/r2-pass-notes.test.ts`: each of the two retained answers of issue #82, after a reasoning section and the `=== answer ===` marker, is read by `finalizeReview` as `no-verdict` / `malformed` with no verdict (the reader is unchanged; this is the expected result), does not parse with `JSON.parse`, and parses with one `}` appended, which the test does and the reader never does. [R2] [dod arm 1]
  - 4. The same file: the notes of each retained answer written as R1 asks read as `pass` / `success`, with the advisory notes equal to those notes in order, and the line is shorter than the retained one. [R2] [dod arm 1]
  - 5. The same file reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section, and fails with any one removed; `tests/surface/prose.test.ts` passes over the new prompt lines. [R3] [dod arm 1]
depends_on: []
budget: 170
tdd: true
sweep: "grep -n 'VERDICT_CONTRACT\\|is advisory in both stages\\|reasons. is empty on pass' src/review/pre-review.ts; deepseek --help: the prompt line at pre-review.ts:258 says `reasons` is empty on pass and then that a pass may carry tagged reasons, without saying where; both retained edge-cases answers of issue #82 (goal g-20260926103738-6d05ad, evidence T0-GOAL-CARD-COUNT.pre.0.1.1.3e172325.edge-cases-log and T0-GOAL-CARD-COUNT.pre.1.1.1.e111e31b.edge-cases-log) carry each note twice, in the root reasons and in axes.standards.reasons, on one line of 1798 and 1912 characters that ends `.\"]}}`, one brace short. The `deepseek` wrapper (argv `deepseek --model deepseek-v4-pro`) has only --model, --system, --prompt, --max-tokens, --temperature, --think and --effort: no JSON output mode or response schema, so the contract goes in the prompt. REVIEW.md keeps its output contract: a change there changes the policy hash of every review. The hash pin test (pre-review.test.ts, T1-REVIEW-COVERAGE F2) strips the sentences a card adds on purpose and pins the rest."
forbid: [a reader change that repairs, closes or re-balances a truncated verdict document (docs/LESSONS.md 2026-09-18 T0-VERDICT-PROSE), editing REVIEW.md or templates/REVIEW.md, editing src/core/review-policy.ts or src/loop/card-runner.ts (the T1-STORE-CAS line), editing src/delivery/github-ship.ts, a change to the verdict contract line or VERDICT_SCHEMA]
non_goals: ["a JSON output mode for R2: the deepseek wrapper lives outside this repository (~/.claude/bin) and offers none", "an `advisory` field in the verdict document: VERDICT_SCHEMA refuses extra keys for R3 and the reader already takes the top-level reasons of a pass as advisory notes", "the reviewer agent files (.claude/agents/reviewer.md and its template), which no R2 or R3 command reads"]
hygiene: "Filed from issue #82. Proof: a test that every prompt carries the contract lines, the hash pins with exactly those lines removed, and a replay of both retained answers, which stay malformed because the reader is unchanged (expected). Mutation sweep before the first review (docs/LESSONS.md 2026-09-24); the RED run fails on its assertions, since the new test imports only names that exist."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-R2-PASS-NOTES

## Deliverable
An R2 or R3 reviewer that has notes on a pass writes each note once, in the top-level `reasons`, and checks that its verdict line is one complete JSON document before sending it, so a pass with notes no longer arrives one closing brace short and spends a no-verdict retry. The reader stays as it is and never repairs a truncated document.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/r2-pass-notes.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
