---
id: T0-MUTANT-STATE-BENCH
title: "docs/reliability/mutant-state-bench.md records the reviewer bench comparison of the formal review prompt before and after PR 464, with the two bench reports beside it"
status: todo
branch: T0-MUTANT-STATE-BENCH
worktree: D:\wt\AIDLC\T0-MUTANT-STATE-BENCH
allow_paths:
  - docs/reliability/mutant-state-bench.md
  - docs/reliability/mutant-state-bench.before.json
  - docs/reliability/mutant-state-bench.after.json
  - specs/tasks/T0-MUTANT-STATE-BENCH.md
dod_command: npm run typecheck && node bin/aidlc.js review bench compare docs/reliability/mutant-state-bench.before.json docs/reliability/mutant-state-bench.after.json && node --test tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The two report files shall be the unedited output of `aidlc review bench run --stage formal --trials 3 --json`, the first from a checkout of fcd56d0e9786e5778f46d2a22a5fe4a2bfb6c06b, the parent of the merge commit of PR 464, and the second from a checkout of 50008e4d56493b84593929a12ad2f83fa89a64cc, that merge commit, each with the SHA-256 that the receipt of its run holds.
  - R2. The record shall give for each report its reviewer, its policy hash, its count of cases, its count of trials, the median, minimum and maximum of its recall and of its false-block rate, and its counts of no-verdict and error results, each equal to the value in the report file.
  - R3. The record shall quote the verdict and the reason that `aidlc review bench compare` prints for the two report files.
  - R4. The record shall state the consequence that the practice of `docs/OPERATIONS.md` gives the verdict, namely that the change of PR 464 stays on `better` or `no-measurable-difference`, that a card to reword or revert it follows `worse`, and that `inconclusive` is reported with the cause the command names and decides nothing.
  - R5. The record shall reproduce the receipt of each run, namely the path of the checkout, the output of `git rev-parse HEAD` in it, that `git status --porcelain` printed nothing there, the command, the start and the end of the run, its exit code and the SHA-256 of the saved report, and say that each completed run was made once.
acceptance:
  - 1. The two report files are in `docs/reliability/`, each with `stage` `formal`, three entries in `trialResults`, and as its `cases` exactly the 30 case files at the top level of `evals/review/` at 50008e4d56493b84593929a12ad2f83fa89a64cc, 20 of kind `bug` and 10 of kind `clean`, which fcd56d0e9786e5778f46d2a22a5fe4a2bfb6c06b holds unchanged. The two reports hold the same `reviewer`, `policyHash`, `rules` and `options`. No result of either report is a `no-verdict` that a quota hold caused: the report of a run that a quota hold stopped is not accepted. `aidlc review bench compare` on the two files exits 0 and prints one verdict. [R1] [dod arm 2]
  - 2. Doc text (reviewer-verified against the diff). `docs/reliability/mutant-state-bench.md`, a new file, gives the fields of R2 for each report, each value equal to the one in the report file. [R2]
  - 3. Doc text (reviewer-verified against the diff). The record quotes the verdict and the reason as the DoD run prints them. [R3] [dod arm 2]
  - 4. Doc text (reviewer-verified against the diff). The record states R4 for the verdict it quotes and reproduces the receipt of each run with every fact of R5. Each receipt names the commit of R1 for its run, and the SHA-256 of each report file in `docs/reliability/` equals the digest in its receipt. [R1] [R4] [R5]
  - 5. The typecheck is clean and `tests/surface/prose.test.ts` passes with no line changed. [dod arms 1, 3]
depends_on: []
budget: 5000
tdd: false
sweep: "On main at 923cb739. At 50008e4d the top level of evals/review holds 30 case files, all confirmed (20 bug, 10 clean), and fcd56d0e holds the same 30; evals/review/clean holds 41 case files, 40 of them confirmed, and evals/review/replay 124, all confirmed, which a run without `--dir` does not read, since the bench lists the files of one directory (src/review/bench.ts:125). `git diff fcd56d0e 50008e4d -- REVIEW.md aidlc.config.json docs/LESSONS.md evals` is empty, so the two runs differ in the prompt code alone, and `--trials` is in docs/OPERATIONS.md at fcd56d0e. 394 formal decisions since 2026-11-07 carry a duration, median 1.4 minutes and p90 2.8 (`_local/uncle-bob-consensus/r3-duration.ts`, not tracked): 180 reviews are about 4.3 hours one after another. One journal event since 2026-11-07 names a quota hold. A saved report of one trial of 15 clean cases holds 393 lines (`_local/arms/order-clean.json`); the size of a report of three trials of 30 cases is not known before the runs, and the budget is an estimate. A report holds `stage`, `reviewer`, `rules`, `options` and `policyHash` and no commit, and the policy hash is of the review policy, not of the prompt code, so the receipt of each run carries the commit. A run that a quota hold stops still writes three trials, with `no-verdict` and the detail `not reviewed: a quota hold stopped the run` for each case it did not review (src/review/bench.ts:207). A reading of the kept formal reviews at 2026-11-24T10:56Z (`_local/uncle-bob-consensus/watch-facts.ts`, not tracked): 16 prompts on 8 cards hold the statement of PR 464 in the section, 14 open it with `- no mutant report` and 2 with `- the mutant report is for another candidate`, none with `- none`; 13 verdicts pass and 3 block, and no reason or advisory note names a mutant, a sweep or a survivor. `tests/surface/prose.test.ts` reads specs/ and the top level of docs/, not docs/reliability/. No test and no document lists the files of docs/reliability/."
forbid:
  - network
  - "an edit of a report file by hand"
non_goals:
  - "the two bench runs: a session makes them before the goal is opened (Preconditions), since 180 reviews take about 4.3 hours and a card has 3"
  - "the pre stage: `preReview.command` is empty in `aidlc.config.json`"
  - "the case sets `evals/review/replay/` (124 confirmed cases) and `evals/review/clean/` (40 confirmed cases of 41)"
  - "a change to the prompt, to `REVIEW.md` or to the bench"
  - "a bench run beyond the kept pair of completed runs; the comparison of the two kept reports may be repeated"
  - "a changelog fragment: no file of the package changes"
hygiene: "From `intent/agent-quality-study.md`, the decision left to the owner. Recorded on 2026-11-25 after the owner asked whether a card holds the comparison as a todo for later; none did. Codex gpt-6-astra advised the full comparison at once, and the coordinator advised reading the kept reviews first (the sweep field holds that reading). Registering the card runs nothing: the two runs of Preconditions spend about 180 reviews, and making them is the owner's decision. tdd false: the card adds a record and two data files and no code. The implementer copies the two files unchanged and takes every number of the record from them. A report does not say which commit ran it, so the receipt of each run attests it and the record reproduces the receipt. Checked against the ten newest lessons of docs/LESSONS.md on 2026-11-25, the line of T0-MUTANT-EVIDENCE-STATE the newest: the two commits are named by the full ids `git rev-parse` gives (T1-REVIEW-FOLLOWUP-CORE), and each requirement gives the record the whole of its clause (T0-PR-SUMMARY-REUSED). Not verified before the card runs: the size of a report of three trials, and that a run of 90 reviews ends without a quota hold."
doc_sync: docs/reliability/mutant-state-bench.md
---

# T0-MUTANT-STATE-BENCH

From `intent/agent-quality-study.md`, Decisions left to the owner.

## Why
PR 464 (card T0-MUTANT-EVIDENCE-STATE) changed text that every formal review receives: the `## Surviving mutants` section opens with the state of the mutant report, and its statement says that a missing, unusable or other-candidate report is not a finding. The paragraph of `docs/OPERATIONS.md` that begins "The reviewer bench stays outside the loop" asks for a reviewer bench comparison before a change to a review prompt. The main checkout holds no record of one for PR 464.

## Preconditions (before the goal is opened)
The two bench runs are not part of the card run: 30 confirmed cases, 3 trials and 2 versions are 180 reviews, about 4.3 hours one after another, and a card has 3 hours. A session makes them when no card run needs the reviewer.

1. Two detached checkouts outside the repository, one of fcd56d0e9786e5778f46d2a22a5fe4a2bfb6c06b and one of 50008e4d56493b84593929a12ad2f83fa89a64cc (`git worktree add --detach <directory> <commit>`), each with `node_modules` linked to the main checkout's.
2. In each, one after the other, from Git Bash, so that standard output reaches the file byte for byte: `node bin/aidlc.js review bench run --stage formal --trials 3 --json > <report>`. The reports are `_local/mutant-state-bench/before.json` for the first commit and `_local/mutant-state-bench/after.json` for the second, in the main checkout.
3. Each run gets a receipt, written when the run ends and before its checkout is removed: `_local/mutant-state-bench/before.receipt.txt` and `after.receipt.txt`. A receipt holds the path of the checkout, the output of `git rev-parse HEAD` in it, the output of `git status --porcelain` there (nothing), the command, the start and the end of the run in UTC, the exit code, and the SHA-256 of the saved report (`sha256sum`).
4. A run that a quota hold stopped is not a result: its report and its receipt are discarded and the run is made again. A run that completed is kept as it is, whatever it shows.
5. The two checkouts are removed, the `node_modules` link of each first.

The card copies the two reports to `docs/reliability/` unchanged and reproduces the two receipts in the record. When a report or a receipt is missing at BUILD, or a digest differs, the card stops and names it.

## Deliverable
One record, `docs/reliability/mutant-state-bench.md`, and the two reports it reads.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node bin/aidlc.js review bench compare docs/reliability/mutant-state-bench.before.json docs/reliability/mutant-state-bench.after.json && node --test tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the two reports are well formed and comparable, the record gives their figures and the verdict of the comparison, and the prose check passes.
