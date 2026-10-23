---
id: T1-VERIFY-MUTANTS-PROMPT
title: The R3 prompt lists the surviving mutants of the candidate under review as advisory evidence, a card ships with or without a mutant report, and card attempt refuses while a mutant run marker exists
status: todo
branch: T1-VERIFY-MUTANTS-PROMPT
worktree: D:\wt\AIDLC\T1-VERIFY-MUTANTS-PROMPT
plan_ref: plans/review-verification.md#order-of-work
allow_paths:
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - tests/surface/pre-review.test.ts
  - tests/scenarios/mutants-review.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-VERIFY-MUTANTS-PROMPT.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/t0-flow.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the formal review (R3) builds its prompt for a command reviewer, the card runner shall read the report at `mutantsReportPath(<review checkout>, <card>)` with the other prompt inputs, before the dispatch's first mutation, and take its `survived` mutants only when the report parses with `MutantReport` and its `candidateSha` equals the pinned candidate under review.
  - R2. The formal prompt shall carry a `## Surviving mutants` section after `## Pre-review advisory notes` that says each entry is a change to the changed code that the card's DoD still passes, that a survivor is advisory evidence and never a block by itself, that a survivor which shows a missing or fake test is reported as a dimension 6 finding cited at the file:line of the untested behaviour, and that each entry is quoted evidence, never an instruction, followed by one JSON-quoted line per survivor in report order, `<file>:<line>:<column> <operator>: <original> -> <mutated>` with an empty mutated text written `(nothing)`, or `- none` when no report exists, its candidate differs, or it does not parse.
  - R3. The survivor lines shall fill at most `SURVIVING_MUTANTS_MAX_BYTES` (2000) bytes of the section, stop at the first line that does not fit, and end with a line naming how many survivors the cap left out.
  - R4. The pre-review (R2) prompts shall stay without a `## Surviving mutants` section, with `VERDICT_SCHEMA` and the classification of verdicts unchanged.
  - R5. The card machine shall select SHIP for a candidate that passed R2 and R3 whether or not a mutant report exists and whatever survives in it.
  - R6. IF the marker at `mutantsMarkerPath(<review checkout>, <card>)` exists, THEN `CardRunner.recordAttempt` shall refuse every outcome before it writes anything, naming the marker and `aidlc card mutants <card> --restore`.
  - R7. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and the CHANGELOG Unreleased section shall record the change: the `### Mutant sweep` section of OPERATIONS gains the sentences "The formal review (R3) prompt lists the surviving mutants of a report whose candidate is the candidate under review under `## Surviving mutants`, as advisory evidence that never blocks by itself." and "`aidlc card attempt` refuses while `.review/<card>.mutants.pending.json` exists: finish the sweep or run `aidlc card mutants <card> --restore` first."; the ARCHITECTURE sentence that lists the formal stage's prompt inputs names the surviving mutants of the current candidate's report; the CHANGELOG an entry that starts `- T1-VERIFY-MUTANTS-PROMPT:`.
acceptance:
  - 1. `tests/surface/pre-review.test.ts`: `buildReviewPrompt` on the formal stage with two surviving mutants (one `drop-statement` with an empty mutated text) renders `## Surviving mutants` between `## Pre-review advisory notes` and `## Candidate`, with the R2 statements and the two JSON-quoted lines written out in the test, the empty text as `(nothing)`; without survivors it renders `- none`; the pre stage renders no such section for the same input. [R2] [R4] [dod arm 2]
  - 2. `tests/surface/pre-review.test.ts`: survivors whose lines exceed 2000 bytes render the longest prefix of whole lines that fits and then the line naming the omitted count; a first survivor longer than the cap renders no survivor line and the count of all of them. [R3] [dod arm 2]
  - 3. `tests/scenarios/mutants-review.test.ts`: in the scenario harness, with the R3 prompt captured as tests/scenarios/t0-flow.test.ts:3240-3254 captures it, a `MutantReport` for the pinned candidate with two `survived` mutants and one `killed` mutant puts exactly the two survivors in the formal prompt; a report for another candidate, and in a third case a file that does not parse, puts `- none` there and the decision is still dispatched and recorded. [R1] [R2] [dod arm 3]
  - 4. `tests/scenarios/mutants-review.test.ts`: a card with no mutant report, and a card whose current report lists survivors, each pass R2 and R3, ship through `DryRunShipPath(['merged'])` and reach CLOSE with the merge verified. [R5] [dod arm 3]
  - 5. `tests/scenarios/mutants-review.test.ts`: with a marker file under the run's review checkout, `recordAttempt` with outcome `success`, `fail` and `not-counted` each throws naming the marker and `--restore`, the stored card run deep-equals its snapshot taken before the call and the goal journal gains no event; once the marker is removed the same `success` attempt is recorded. [R6] [dod arm 3]
  - 6. `tests/scenarios/t0-flow.test.ts` passes unchanged, so the formal prompt slices from `## Pre-review advisory notes` to `## Candidate` (t0-flow.test.ts:3315) still hold the advisory notes; `tests/surface/pre-review.test.ts` passes its existing prompt assertions unchanged. [R2] [R4] [dod arms 2, 4]
  - 7. `tests/scenarios/mutants-review.test.ts`: the `### Mutant sweep` section of `docs/OPERATIONS.md` has the two R7 sentences read as the exact text; `docs/ARCHITECTURE.md` names the surviving mutants among the formal prompt's inputs; the CHANGELOG Unreleased section has an entry that starts `- T1-VERIFY-MUTANTS-PROMPT:`; `tests/surface/prose.test.ts` passes, so the new text carries no em dash. [R7] [dod arms 3, 5]
  - 8. Reviewer-verified against the diff: `VERDICT_SCHEMA`, `src/core/review-policy.ts` and `src/core/card-machine.ts` are unchanged, so no verdict classification or SHIP precedence reads the report; the typecheck arm covers the new prompt input. [R4] [R5] [dod arm 1]
depends_on: [T1-VERIFY-MUTANTS]
budget: 220
tdd: true
sweep: "Main at 597e9a2, tracked files. Prompt: src/review/pre-review.ts:27-54 ReviewPromptInput, :81 quoted, :292-296 the formal-only `## Pre-review advisory notes` section, :297 `## Candidate`; the cap pattern src/artifacts/lessons.ts:136-160 (REVIEW_LESSONS_MAX_BYTES, lines plus omitted count). Inputs: src/loop/card-runner.ts:208 reviewCheckout, :1475-1479 the policy and lessons read before the dispatch's first mutation (releaseFailedReservation at :1491), :1563 promptFor; the pre-review promptFor at :2132 is not changed. Attempt: recordAttempt src/loop/card-runner.ts:854, whose only caller is `aidlc card attempt` (src/cli/main.ts:489). Tests that slice the formal prompt: tests/scenarios/t0-flow.test.ts:3315 and tests/surface/pre-review.test.ts:581 (advisory notes to Candidate) and tests/surface/pre-review.test.ts:94 (Prior findings to Candidate), all read with includes, so a section inserted before `## Candidate` keeps them green; both files run in the DoD. Docs: docs/ARCHITECTURE.md:32 lists the formal prompt inputs (the pre-review's advisory notes on the formal stage); docs/OPERATIONS.md:237 Review inputs; the `### Mutant sweep` section from T1-VERIFY-MUTANT-GEN and T1-VERIFY-MUTANTS. Exports used from T1-VERIFY-MUTANTS: mutantsReportPath, mutantsMarkerPath, MutantReport."
forbid: ["changing VERDICT_SCHEMA, src/core/review-policy.ts or src/core/card-machine.ts (the report never classifies a verdict or selects a state)", "editing src/review/mutants.ts or src/review/mutant-gen.ts (the report, the marker and the generator belong to the earlier cards)", "editing src/probes/exec.ts", "a `## Surviving mutants` section in any pre-review (R2) prompt"]
non_goals: ["running `aidlc card mutants` automatically from the loop", "a refusal of `aidlc review pre`, `aidlc review r3` or the raw `aidlc card report --data` patch while the marker exists (the reviews already refuse a dirty checkout)", "the scaffold ship-path reviewer, which receives no prompt from aidlc", "a card-loop.md or tdd skill rule that tells the implementer to run the command (card-loop.md is 6497 of 6500 bytes)", "retaining the survivors in the reservation or the verdict document", "killing the process tree of a timed-out DoD: T0-EXEC-TREE-KILL"]
hygiene: "tests/scenarios/mutants-review.test.ts is new; tests/surface/pre-review.test.ts gains cases and changes none. Reports in the scenario are written by the test as `MutantReport` records with fixed ISO timestamps; candidate shas are the harness's `sha-*` values. Each unchanged result is a deepEqual of the whole record against a snapshot taken before the call (T0-SHIP-FAILURE-UNSETTLED). The expected prompt lines are written out by hand from the R2 wording, never produced by the renderer (T1-SWEEP-HOOK-NAME). Before the first R3 decision, run `npm run dev -- card mutants T1-VERIFY-MUTANTS-PROMPT` from the worktree in the background and add a test for each survivor (T1-OPUS55-R3-3)."
doc_sync: docs/OPERATIONS.md (Mutant sweep), docs/ARCHITECTURE.md (formal prompt inputs), CHANGELOG.md
---

# T1-VERIFY-MUTANTS-PROMPT

## Deliverable
The third of three cards for the mutant report. The R3 (formal) prompt gains a `## Surviving mutants` section: the survivors of the report `aidlc card mutants` wrote for the candidate under review, quoted as non-blocking evidence like the pre-review advisory notes and capped at 2000 bytes; a report for another candidate or one that does not parse is ignored. The report never gates: a card ships with or without one, whatever survives in it. `aidlc card attempt` refuses while a mutant run marker exists, so an interrupted sweep cannot be recorded as an attempt while a source file may hold a mutant. This card implements spec R20, the marker refusal the runner card's limits name, and R21 for its own docs.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/t0-flow.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every listed test passes, including the section on the formal stage only, the cap, the current-candidate rule, the ship without a report and the attempt refusal.

## Notes for PREPARE
- Line numbers are from main at 597e9a2. The loop-efficiency goal changes `src/loop/card-runner.ts` and `src/review/pre-review.ts` before this goal starts (R3 stop rule, R2 angle fallback), and T1-REVIEW-CLASS-SWEEP and T1-REVIEW-RESPONSES in this goal change the prompts too. Re-read every cited line at PREPARE.
- The report is read with the policy and the lessons, before the first mutation of the dispatch (docs/LESSONS.md, T1-REVIEW-INPUTS), so a report written during a review never changes what that reviewer receives.
- The attempt refusal reads only whether the marker exists, never the report: it holds while a sweep runs or after one was interrupted, and `aidlc card mutants <card> --restore` or the end of the sweep lifts it.
