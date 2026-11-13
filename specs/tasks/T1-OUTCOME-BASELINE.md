---
id: T1-OUTCOME-BASELINE
title: "`docs/reliability/baseline.md` reports the Phase 0 numbers from a run of the outcome bench on this repository, with the committed ruling set, the 30-run verdict-instability result and the two-model finding labels"
status: todo
branch: T1-OUTCOME-BASELINE
worktree: D:\wt\AIDLC\T1-OUTCOME-BASELINE
superseded_by: T1-OUTCOME-REPORT
plan_ref: plans/reliability-baseline.md#order-of-work
allow_paths:
  - docs/reliability/baseline.md
  - bench/outcome/rulings.jsonl
  - bench/outcome/labels.jsonl
  - bench/outcome/instability.json
  - bench/outcome/summary.json
  - tests/surface/outcome-baseline.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-OUTCOME-BASELINE.md
dod_command: npm run typecheck && node --test tests/surface/outcome-baseline.test.ts
dod_exit: 0
requirements:
  - R1. `bench/outcome/summary.json` shall hold the output of every `summary_*` view of one run of `node bench/outcome/run.ts` on the main checkout, with the commit of main, the run's timestamp and the row count of each table and each error table.
  - R2. `bench/outcome/rulings.jsonl` shall be the `ruling_set.jsonl` of that run.
  - R3. `bench/outcome/instability.json` shall hold, for 10 cases of `evals/review/` tracked by git (the first five `clean` and the first five `bug` cases in file-name order whose card has `superseded_by`, filled with the next `bug` cases in file-name order when fewer than five have it), the three outcomes of `aidlc review bench run --stage formal --trials 3 --case <id>`, the reviewer, the commit and date of the run, and per case whether the three agree.
  - R4. `bench/outcome/labels.jsonl` shall hold one row per formal finding raised by a merge-blocking block on 30 cards with `superseded_by` and 15 merged cards with neither `superseded_by` nor a predecessor (each group the first cards in ascending order of the sha256 of the card id that have such a finding), with `cardId`, `findingId`, `group`, `labelA`, `labelB`, `final` and `ownerRuled`.
  - R5. Each of `labelA` (Claude) and `labelB` (a model of another vendor, given the finding's reason, the cited file at the reviewed commit and the card's requirements, and not `labelA`) shall be one of `true-defect`, `out-of-card-scope`, `speculative`, `reviewer-misread` and `ambiguous-card`; `final` is their value when they are equal, the owner's value with `ownerRuled` true when the owner has ruled, and null otherwise.
  - R6. `docs/reliability/baseline.md` shall have the sections `Method`, `Sources and gaps`, `Outcome`, `Review convergence`, `Cost`, `Repeat blocks`, `Reviewer value`, `Verdict instability`, `Finding labels`, `Rulings` and `What these numbers do not show`, in that order.
  - R7. Every number in `baseline.md` that comes from a view shall name the view and equal its value in `summary.json`, and the document shall state the commit and date of the run, the count of every error table, the unattributed and unpriced usage, the label agreement rate with the count of rows whose `final` is null, and the 2026-11-07 replay in `_local/bench-step4/` as an earlier, separate measurement of verdict instability.
  - R8. `baseline.md` shall state each gap of `intent/reliability-baseline.md` with its measured size and shall give no target for a later phase.
  - R9. `CHANGELOG.md` (Unreleased) shall carry one entry for `bench/outcome/` and `docs/reliability/baseline.md` under this card id.
acceptance:
  - 1. `tests/surface/outcome-baseline.test.ts`: `summary.json` parses, names a 40-hex commit and an ISO timestamp, and holds at least the views `summary_successor_rate`, `summary_review_convergence`, `summary_lead_time`, `summary_stop_reasons`, `summary_cost_by_stage`, `summary_superseded_spend`, `summary_cache_share`, `summary_unattributed`, `summary_pr_success`, `summary_reconcile`, `summary_repeat_blocks`, `summary_true_defects` and `summary_rulings`. [R1] [dod arm 2]
  - 2. Same file: every line of `rulings.jsonl` parses with a 40-hex `sha` and a `subject`, and the file has at least 23 lines. [R2] [dod arm 2]
  - 3. Same file: `instability.json` holds 10 cases, five of kind `clean`, each with exactly three outcomes from `pass`, `block` and `no-verdict` and an `agree` boolean that equals whether the three are the same. [R3] [dod arm 2]
  - 4. Same file: every line of `labels.jsonl` parses; `labelA` and `labelB` are in the closed set; `final` equals them when they are equal, is in the closed set when `ownerRuled` is true and is null otherwise; the rows cover 30 distinct cards of group `superseded` and 15 of group `clean`, or the README-stated smaller number when fewer cards have such a finding, which `baseline.md` then states. [R4] [R5] [dod arm 2]
  - 5. Same file: `baseline.md` has the eleven headings of R6 in order, and each backticked `summary_*` name in it is a key of `summary.json`. [R6] [R7] [dod arm 2]
  - 6. The numbers of `baseline.md` equal `summary.json`, each gap carries its measured size, and no later-phase target is stated (reviewer-verified against the diff). [R7] [R8]
  - 7. `CHANGELOG.md` Unreleased carries the entry; `git diff --numstat origin/main...HEAD -- src templates .claude REVIEW.md package.json` is empty. [R9]
depends_on: [T1-OUTCOME-USAGE-2, T1-OUTCOME-GITHUB-2, T1-OUTCOME-HISTORY]
budget: 1500
sweep: "New files and one CHANGELOG entry. The data files are generated by the merged scripts of the four cards before this one, on the main checkout's own state, and are too long to hand-write: `rulings.jsonl` about 23 rows, `labels.jsonl` one row per finding on 45 cards. `evals/review/` has 31 tracked files; the 490 untracked exports are not used."
forbid: [any change under src/ templates/ or .claude/, editing a generated data file by hand except the `final` and `ownerRuled` fields of a row the owner ruled on, a number in baseline.md not computed from summary.json or the three data files, a target or recommendation for Phases 1 to 4, dropping a case or a card from the fixed selections]
non_goals: [waiting for the owner's rulings on label disagreements (rows stay with a null `final` and are counted; a later card records the rulings), reruns of R2 (`preReview.command` is empty here), external labelled data sets]
hygiene: "The 30 reviewer reruns use the Codex subscription and take about 50 minutes; run them once, keep the raw report under `_local/outcome/`, and do not rerun to get a tidier result. Budget for the labels: at most 50 USD in total for this goal."
doc_sync: CHANGELOG.md
---

# T1-OUTCOME-BASELINE

## Deliverable
The baseline report and the three data files behind it. No behaviour change and no targets.

## Why
The targets for Phases 1 to 4 are set from this report and approved by the owner before any review rule changes. A number in it has to be traceable to a view, and the labels and rulings are the data later changes are replayed against.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-baseline.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
