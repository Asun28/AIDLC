---
id: T0-BENCH-INPUTS
title: "A reviewer bench report records what each review received (the commit and state of the checkout, the hash of each case file, and per dispatched review the command, the effort, the lesson hash and the prompt hashes)"
status: todo
branch: T0-BENCH-INPUTS
worktree: D:\wt\AIDLC\T0-BENCH-INPUTS
allow_paths:
  - src/review/bench.ts
  - tests/surface/review-bench.test.ts
  - docs/OPERATIONS.md
  - evals/review/README.md
  - changelog.d/T0-BENCH-INPUTS.md
  - specs/tasks/T0-BENCH-INPUTS.md
dod_command: npm run typecheck && node --test tests/surface/review-bench.test.ts tests/surface/review-bench-rounds.test.ts tests/surface/review-bench-order-pre.test.ts tests/surface/review-bench-formal-command.test.ts tests/surface/review-bench-export.test.ts tests/surface/bench-drafts-ignore.test.ts tests/surface/outcome-panel.test.ts tests/surface/test-temp.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The report `runReviewBench` returns shall hold the key `inputs` directly after `policyHash`, with `checkoutCommit`, `checkoutClean`, `cases` and `reviews`.
  - R2. `inputs.checkoutCommit` shall be the object name that `git rev-parse HEAD` prints for the root of the run, read through the run's git runner before the first review, when that command exits 0 and prints 40 or 64 hexadecimal characters, and `null` in every other case, a runner that throws included.
  - R3. `inputs.checkoutClean` shall be `true` when `git status --porcelain` in that root exits 0 and prints nothing, `false` when it exits 0 and prints at least one line, and `null` when it does not exit 0 or the runner throws, read through the same runner before the first review.
  - R4. `inputs.cases` shall hold one entry per selected case, a case the bench cannot score included, in the order of the report's `cases`, with `id` and `sha256`, the SHA-256 in hexadecimal of the bytes of its case file as they were read when the cases were loaded, and shall be an empty list when the run selects no case.
  - R5. `inputs.reviews` shall hold one entry per review the run dispatched, in dispatch order, with `trial` (from 1), `cases` (the ids of that group's cases the bench can score, in the order of the report's `cases`), `command` (the stage command as configured for the run, before any placeholder is replaced), `lessonsSha256` (the SHA-256 of the lines of the lesson selection that review's prompts carry, joined by line feeds, which is the run's selection under `--rules newest` and the selection made for that review under `--rules matched`) and `promptsSha256` (the SHA-256 of each prompt rendered for it, by round and inside a round in the order of the configured perspectives).
  - R6. An entry of `inputs.reviews` shall hold `effort`, the effort selected for that review's diff, only at the formal stage and only when the formal command holds the `{effort}` placeholder.
  - R7. A review that was dispatched shall have its entry whatever it returned, a result with no verdict and the quota hold that stops the run included, and a group for which no review is dispatched (a checkout that cannot be made, a card file that is absent, resolves outside the checkout or does not parse, no committed diff, a group none of whose cases can be scored, a group after a quota hold) shall have none.
  - R8. The Reviewer bench section of `docs/OPERATIONS.md` shall state R1 to R7 in one paragraph, and say that `checkoutCommit` names the checkout whose `REVIEW.md`, configuration and lessons the run read and does not establish which code built the prompts, that a dirty checkout is flagged and its changed bytes are not recorded, and that the hashes identify equal text without keeping it.
  - R9. `evals/review/README.md` and `changelog.d/T0-BENCH-INPUTS.md` shall each say that a report records, under `inputs`, the commit and state of the checkout, the hash of each case file and, per dispatched review, the command, the effort, the lesson hash and the prompt hashes.
acceptance:
  - 1. `tests/surface/review-bench.test.ts`, new tests through `runReviewBench` with the scripted reviewer and an injected git runner. With `rev-parse HEAD` printing 40 hexadecimal characters and an empty `status --porcelain`, `inputs.checkoutCommit` is that name and `checkoutClean` is `true`; a name of 64 hexadecimal characters is recorded as given; a `status --porcelain` that prints one line gives `false`; a `rev-parse` that exits 1 gives `null` and a `status` that exits 1 gives `null`; a `rev-parse` that exits 0 and prints text that is not an object name gives `null`; a runner that throws for either command gives `null` for that field and the run goes on. RED on main, where the report has no `inputs`. [R1] [R2] [R3] [dod arm 2]
  - 2. Same file. `inputs.cases` lists the selected cases in report order, each `sha256` equal to the SHA-256 of that case file's bytes on disk; a selected case the bench cannot score is listed; an unconfirmed case that the run leaves out is not; a case file rewritten after the run started does not change the recorded hash; a run that selects no case gives `cases` and `reviews` as empty lists. [R4] [dod arm 2]
  - 3. Same file. Two groups (two candidates) and `--trials 2` give four entries in dispatch order with `trial` 1, 2, 1, 2 (the groups are the outer loop, `src/review/bench.ts:204-209`) and each group's case ids. `command` is the configured argv with its placeholders unreplaced. At the formal stage a command that holds `{effort}` gives each entry the `effort` selected for its diff and a command that does not gives no entry the key; at the pre stage no entry holds the key, also when the pre command holds the placeholder. With `--rules matched` and lessons that match one group only, the two groups' `lessonsSha256` differ, and each equals the SHA-256 of the lines `matchedLessons` gives for that group joined by line feeds; with `--rules newest` they are equal. `--rounds 2` at the formal stage, on a candidate blocked with a new P1 reason, gives two entries in `promptsSha256`; the pre stage with two perspectives gives two for its single round (`--rounds` above 1 is refused at the pre stage, line 170); each equals the SHA-256 of the prompt the reviewer received, read from the injected runner. [R5] [R6] [dod arm 2]
  - 4. Same file. A group whose card file cannot be read, a group none of whose cases can be scored, and every group after a quota hold have no entry. A group with one case the bench can score and one it cannot has an entry whose `cases` holds the first id only. A dispatched review that returns no verdict has its entry, and so does the review whose quota hold stops the run. [R5] [R7] [dod arm 2]
  - 5. Same file, line 768 on main. The list of the report's keys gains `inputs` after `policyHash` and nothing else of that test changes. `aidlc review bench compare` on two reports that hold `inputs` gives the verdict it gives without them (one case added to the test of line 831). Every other assertion of the file, and the five other bench test files of the DoD, and `tests/surface/outcome-panel.test.ts`, pass with no line changed. [R1] [dod arms 2 to 8]
  - 6. Doc text (reviewer-verified against the diff). `docs/OPERATIONS.md` states R8 in the Reviewer bench section; `evals/review/README.md` and the fragment state R9, the fragment in the form of `changelog.d/README.md`. [R8] [R9] [dod arms 10, 11]
  - 7. The typecheck is clean and `tests/surface/test-temp.test.ts` passes. [dod arms 1, 9]
depends_on: []
budget: 180
tdd: true
sweep: "A clone of main at dc0bea82 in which every report carries an `inputs` key after `policyHash` and `compareBenchReports` returns one more key (a stand-in, not tracked) was run against tests/core/trial-compare.test.ts, the five tests/surface/review-bench*.test.ts files, and tests/surface/outcome-panel.test.ts, outcome-replay.test.ts, outcome-clean.test.ts and outcome-baseline.test.ts: 101 tests, 2 failures, both in tests/surface/review-bench.test.ts: line 768 (`Object.keys(report)`) and line 798 (the whole JSON of `bench compare`). This card changes line 768 and leaves `compareBenchReports` as it is, so line 798 stays. The line numbers are those of main at 9bdcf00b, where both files are unchanged since the clone. `SavedReport` (src/review/bench.ts:752) is not a strict object, so `bench compare` reads a report with the new key today."
forbid: [network, "a model or reviewer command in the DoD"]
non_goals:
  - "`aidlc review bench compare` naming the inputs that differ between two reports: a later card, and until then two `inputs` objects are compared by reading them"
  - "the same fields on the review invocation of a card run (`src/loop/card-runner.ts`, `src/core/types.ts`)"
  - "a revision of the code that built the prompts: the CLI runs sources or compiled output (`bin/resolve-entry.js`), so the commit of the checkout does not establish it; the prompt hashes show whether two reviews received equal text"
  - "the text of a prompt, of the lessons or of a case in the report: hashes only"
  - "a new bench run, a comparison with the baseline of 2026-11-15, or a gate"
  - "a report written before this card: it has no `inputs`, and nothing fills it in"
hygiene: "From `intent/anthropic-practices-study.md`, P1 of the two-party result of 2026-11-24. A report records `policyHash`, the argv of a `--pre-command` override and the path and hash of a `--formal-command` file today, and not the command each dispatched review ran with; the panel report (`docs/reliability/panel.md`, What these numbers do not show) had to reconstruct the commit and the lesson count of two runs from other records, and three commits changed what the reviewer receives since the arms run of 2026-11-16. RED first: the new tests of acceptance 1 to 4 and the changed line of acceptance 5, committed before the source change. Take each hash from the bytes or the text at the moment the run uses them, not by reading the file again after the reviews. New fixtures make their directories with `tmpDir` of tests/infra/helpers.ts. T1-R3-PANEL allows `src/review/bench.ts` too: run this card beside no card that allows it or `docs/OPERATIONS.md`, and read the line numbers again at PREPARE. Checked against the newest lessons of docs/LESSONS.md on 2026-11-24: the expected sequences and the supported option combinations of acceptance 3 were checked against `runReviewBench` before registration (trials inside groups, lines 204 to 209; no rounds above 1 at the pre stage, line 170; no effort in the pre branch, lines 374 to 384; T0-DOD-VENV), an absent `effort` is a missing key and not an empty text (T0-PR-SUMMARY), a process that exits 0 with unexpected text is a case of its own beside a process that fails (T0-OUTCOME-DUCKDB-EPIPE), the record an 'unchanged' assertion compares is taken before the act (T0-AMEND-CONTINUE-TEST), temporary directories go through `tmpDir` with the guard in the DoD (T0-PREFETCH-TIMEOUT), each document gets the whole rule (T0-PR-SUMMARY-REUSED), and the two lessons of 2026-11-24 do not apply (the new tests call `runReviewBench` in process with injected runners and the compare case uses the helper of that test unchanged, so this card introduces no environment-dependent behaviour, T0-INIT-CLI-PATH; no code here reads `review.invocations`, T0-ADVISORY-WITHDRAW)."
doc_sync: docs/OPERATIONS.md, evals/review/README.md, changelog.d/T0-BENCH-INPUTS.md
---

# T0-BENCH-INPUTS

From `intent/anthropic-practices-study.md` (P1).

## Why
A bench report says which reviewer scored which cases under which `REVIEW.md` hash, and carries the argv of a `--pre-command` override and the path and hash of a `--formal-command` file. It does not say which commit the run read, which lessons each prompt carried, which command and effort each dispatched review ran with, or whether a case file changed since. Two reports with one policy hash can differ in all four, and `docs/reliability/panel.md` says so of its own inputs. The sources of the study ask that a reviewer be scored again whenever its prompts, tools or model change; the first step is a report that says what it measured.

## Deliverable
`inputs` in every report `aidlc review bench run` writes. No review, no score and no command line changes.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/review-bench.test.ts tests/surface/review-bench-rounds.test.ts tests/surface/review-bench-order-pre.test.ts tests/surface/review-bench-formal-command.test.ts tests/surface/review-bench-export.test.ts tests/surface/bench-drafts-ignore.test.ts tests/surface/outcome-panel.test.ts tests/surface/test-temp.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the report holds the checkout commit and state, the case hashes and one entry per dispatched review with its command, effort, lesson hash and prompt hashes; the key list of line 768 holds `inputs`; the other bench tests and the temp-directory, changelog and prose checks pass.
