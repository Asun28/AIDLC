---
slug: pstack-study
title: Adopt the review, validation and eval practices of the cursor pstack skills where they beat the loop's
intent: intent/pstack-study.md
status: accepted
created: 2026-11-07T09:55:00Z
skills_applied: []
---

# Spec: Adopt the review, validation and eval practices of the cursor pstack skills where they beat the loop's
From intent: intent/pstack-study.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1. The reviewer bench shall run every selected case `--trials <n>` times and report, per stage, the median, minimum and maximum of recall and of false-block rate over the trials, with the no-verdict and error counts of every trial.
- R2. WHEN `aidlc review bench compare <before> <after>` reads two bench reports, the CLI shall print one verdict: `better`, `worse`, `no-measurable-difference` or `inconclusive`, with the reason.
- R3. IF the two reports cover different case sets, either has fewer than 3 trials, or either has a no-verdict or an error in any trial, THEN the compare verdict shall be `inconclusive` naming that cause.
- R4. WHEN the author records a repro for a finding (`aidlc review repro <card> F<n> --argv <json> --files <paths>`), the loop shall run the argv in a temporary checkout of the finding's reviewed candidate with the named files taken from the current candidate, and in a temporary checkout of the current candidate, and record both exit codes on the finding.
- R5. The next R3 prompt shall list each prior finding's repro result as data, and `aidlc review stats` shall count fixed findings with a reproduced repro (non-zero on the reviewed candidate, zero on the current one) and answered-wrong findings with a repro.
- R6. WHEN a base-sync merge resolves only `CHANGELOG.md` and the code patch of the merge commit against its new merge base has the same `git patch-id --stable` and the same changed paths as the code patch of the candidate whose R3 decision passed, excluding `CHANGELOG.md` on both sides, and the base changed none of those paths, the loop shall keep that pass for the merge commit and require only its DoD before the ship.
- R7. IF either patch id cannot be computed, the ids or the changed paths differ, or the base changed one of those paths, THEN the merge commit shall be a new candidate as before.
- R8. The claude-code provider shall record the agent's tool calls (tool name and input) when asked, and evals shall support checks on them: a file the agent read, a command the agent ran, a command it did not run, and a path it did not write.
- R9. WHEN an eval case calls the model, the runner shall run it in a temporary detached checkout of HEAD with an empty temporary state directory, and remove both afterwards.
- R10. IF an eval prompt contains a word that names the measurement (eval, evals, judge, rubric, grader, benchmark, experiment, score) as a whole word in any letter case, THEN loading it shall fail naming the case and the word; the system prompt the runner sends shall not name the measurement either.
- R11. WHEN `aidlc evals run --variant <ref> --trials <n>` runs, the runner shall run the selected cases n times on HEAD and n times on a checkout of `<ref>` and print, per case and in total, the pass rate of each side, and the R2/R3 verdict computed over the pass rates.

## Design
Five independent changes, one card each, in the order of the plan. The compare
verdict (R2, R3) is one pure function in `src/core/` used by the bench and by
the variant evals. The repro runner reuses the bench's temporary-checkout code.
The patch-id check is a git probe the ship path calls only on a
`[SHIP-BASE-SYNC-MERGED]` outcome.

## Interfaces and contracts
- New commands: `aidlc review bench compare <before.json> <after.json>`,
  `aidlc review repro <cardId> <findingId> --argv <json> [--files <paths>]`.
- New options: `aidlc review bench run --trials <n>`, `aidlc evals run
  --variant <ref> --trials <n>`.
- New eval check types: `read-file`, `ran-command`, `not-ran-command`, `not-wrote-path`.
- Frozen: the verdict JSON schema, the `.review/<card>.json` shape apart from
  an optional field naming a carried pass, the REVIEW.md output contract.

## Data model and migration impact
Optional fields only: `ReviewFinding.repro`, a carried-pass marker on the
review invocation or the run, `CompletionResult.toolCalls`. Records written
before this goal parse unchanged. No migration.

## Flagged concerns (route to policy owners)
- R6 changes what the SHIP gate admits: a merge commit ships on the pass of
  the candidate it merged. The engineer can drop T1-VERDICT-PATCH-ID without
  affecting the other cards.

## Non-goals
- A gate on repro results or on a bench or eval verdict.
- Carrying a pass across a merge that resolves any file other than
  `CHANGELOG.md`, or across a rebase.
- A model-graded eval or a judge model.
- Running the bench, the repros or model-backed evals in CI.

## Acceptance
- 1. A bench run with `--trials 3` on a scripted reviewer reports the median and range, and compare returns each of the four verdicts on built reports. [R1] [R2] [R3]
- 2. A repro recorded on a scripted card run reports non-zero on the reviewed candidate and zero on the repair; the next R3 prompt and `review stats` show it. [R4] [R5]
- 3. A scenario with a CHANGELOG-only base-sync merge and an equal patch id ships after the DoD with no further R3; an unequal patch id runs R3 again. [R6] [R7]
- 4. An eval with a `read-file` check passes on a scripted stream that reads the file and fails on one that does not, and runs in a removed temporary checkout; a prompt with "rubric" is refused. [R8] [R9] [R10]
- 5. `evals run --variant` on two scripted refs prints both pass rates and the verdict. [R11]
