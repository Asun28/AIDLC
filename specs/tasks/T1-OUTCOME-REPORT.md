---
id: T1-OUTCOME-REPORT
title: docs/reliability/baseline.md reports the numbers of bench/outcome/summary.json, labels.jsonl and replay-main.json, each in a table row that names its source and is checked against it, with the measured gaps and no target, and CHANGELOG.md carries the one entry of goal reliability-baseline-2
status: todo
branch: T1-OUTCOME-REPORT
worktree: D:\wt\AIDLC\T1-OUTCOME-REPORT
plan_ref: plans/reliability-baseline-2.md#order-of-work
allow_paths:
  - docs/reliability/baseline.md
  - tests/surface/outcome-baseline.test.ts
  - CHANGELOG.md
dod_command: npm run typecheck && node --test tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. `docs/reliability/baseline.md` (new) shall begin with the line `# Reliability baseline`, have exactly these level-2 headings in this order, `Method`, `Sources and gaps`, `Outcome`, `Review convergence`, `Cost`, `Finding labels`, `Replay baseline`, `Verdict instability`, `What these numbers do not show`, and hold no em dash and no corner bracket (tests/surface/prose.test.ts does not read docs/reliability/). These are the sections of T1-OUTCOME-BASELINE R6 without `Repeat blocks`, `Reviewer value` and `Rulings`, which need T1-OUTCOME-HISTORY, with `Replay baseline` added before `Verdict instability`.
  - R2. Every number the document reports shall stand in a table row of the form `| <measure> | <value> | <source> |` under the header `| Measure | Value | Source |`; every table of the document has that header. The source cell is a code span holding `summary.json`, `labels.jsonl` or `replay-main.json` (each under bench/outcome/), a space, and a code span holding an expression of body section Source expressions. The value is a decimal number, a decimal number followed by `%` (the source value times 100), or `null`, and it equals the source value to the decimal places it shows, within half a unit of its last place. Outside the tables the text holds no number other than dates, the commit, card and goal ids and file names (reviewer-verified).
  - R3. The tables shall hold at least the rows of body section Required rows: from summary.json, the five columns of `summary_review_convergence` and the outcome, lead time, CI, cost and gap figures listed there; from labels.jsonl, the rows, the cards, the rows and cards of each `group` value, the rows whose `labelA` equals `labelB`, the rows with `ownerRuled` true, the rows whose `final` is null and the rows of each final label of the closed set; from replay-main.json, the cases of the baseline arm, the trial cases whose three reviewer verdicts agree (the row of Verdict instability), the trial cases whose three bench outcomes agree (named as score agreement, not verdict agreement), and the labelled findings left out because their candidate commit could not be read.
  - R4. Method shall name the `commit` of summary.json in full, the date of the run (the first 10 characters of its `ranAt`) and the command that wrote it (`node bench/outcome/run.ts --summary`, T1-OUTCOME-SUMMARY), and name labels.jsonl and replay-main.json as the files of T1-OUTCOME-LABELS and T1-OUTCOME-REPLAY.
  - R5. Sources and gaps shall state each gap with its size from a row of R3: usage attributed to no card; usage with no price; cost at list price that no invoice reconciles (the reviewer runs on a subscription); labelled findings whose candidate commit is gone; the row counts of the three error tables. It shall state as not measured in this goal, since T1-OUTCOME-HISTORY did not run, the repeat blocks, the findings followed by a fix (reviewer value) and the ruling set. What these numbers do not show shall state the limits of the numbers with no target, threshold or recommendation for a later phase (reviewer-verified).
  - R6. CHANGELOG.md shall carry the entry of body section Acceptance detail, item 4, as one line directly below the line `## Unreleased` and the blank line under it, followed by one blank line; no other line of CHANGELOG.md changes. The entry then stands in the part of the file between `## Unreleased` and the next heading, which is `## 0.2.0 - 2026-11-14` once T0-RELEASE-0-2-0 has merged and `## 0.1.0 - 2026-09-11` before.
  - R7. A new test file `tests/surface/outcome-baseline.test.ts` shall check R1, R2 for every table row, R3, the commit, date and command of R4, and R6, as body section Acceptance detail states.
acceptance:
  - 1. `tests/surface/outcome-baseline.test.ts` "T1-OUTCOME-REPORT acceptance 1: baseline.md has the title, the nine headings in order and no banned character". Fails on main by assertion (the file does not exist, asserted with `existsSync`). [R1] [R7] [dod arm 1] Detail in the body section Acceptance detail, item 1.
  - 2. Same file, "T1-OUTCOME-REPORT acceptance 2: every table row of baseline.md names its source and its value equals it". Fails on main by assertion. [R2] [R7] [dod arm 1] Detail item 2.
  - 3. Same file, "T1-OUTCOME-REPORT acceptance 3: baseline.md holds the required rows and names the commit, date and command of the run". Fails on main by assertion. [R3] [R4] [R7] [dod arm 1] Detail item 3.
  - 4. Same file, "T1-OUTCOME-REPORT acceptance 4: CHANGELOG.md carries the goal entry once, between the Unreleased heading and the next heading". Fails on main by assertion. It passes with the cut of T0-RELEASE-0-2-0 and without it. [R6] [R7] [dod arm 1] Detail item 4.
  - 5. tests/surface/prose.test.ts and tests/surface/templates.test.ts pass unchanged. They pass on main and with this card. [R6] [dod arm 1]
  - 6. The prose rule of R2, the measure each replay-main.json row names (R3), the gap statements and limits of R5 with no target, and the entry's place directly under the Unreleased heading (R6) are as stated (reviewer-verified against the diff). [R2] [R3] [R5] [R6]
depends_on: [T1-OUTCOME-SUMMARY, T1-OUTCOME-REPLAY]
budget: 240
tdd: true
sweep: "On main at e6566c68. No file under docs/reliability/. `git grep -n \"docs/reliability\\|baseline\\.md\" -- docs README.md bench tests src` prints nothing; the path is named only in intent/, plans/ and specs/. tests/surface/prose.test.ts reads docs/*.md one level deep (its `SCOPE`, :38-48), so the new test checks the banned characters of baseline.md itself. CHANGELOG.md: 77 test files read it (T0-RELEASE-0-2-0, diagnosis); a line added directly under `## Unreleased` changes no adjacency of two entries they pin; tests/surface/templates.test.ts ends seven slices at the first `## 0.1.0` (the entry holds no such text) and tests/surface/prose.test.ts refuses an em dash. The sections dropped from T1-OUTCOME-BASELINE R6 need the views `summary_repeat_blocks`, `summary_true_defects` and `summary_rulings` of T1-OUTCOME-HISTORY (its R8), which no merged view file defines. Field names of labels.jsonl are those of the spec and of T1-OUTCOME-BASELINE R4 (`cardId`, `findingId`, `group`, `labelA`, `labelB`, `final`, `ownerRuled`); replay-main.json is read only through the expressions the report writes, so the test names none of its fields."
forbid:
  - weakening, skipping or deleting a test to go green, or changing an existing test file
  - a number in baseline.md that is not in a table row with its source, other than the exceptions of R2
  - editing bench/outcome/summary.json, bench/outcome/labels.jsonl, bench/outcome/replay-main.json or anything under evals/review
  - a target, threshold or recommendation for a later phase in baseline.md
  - a change to any line of CHANGELOG.md other than the two lines of R6
  - a change under src, templates or .claude, to REVIEW.md or package.json, or to docs/OPERATIONS.md or docs/ARCHITECTURE.md
non_goals:
  - repeat blocks, findings followed by a fix and the ruling set, which need T1-OUTCOME-HISTORY (stated as gaps, R5)
  - the 30-run instability set of T1-OUTCOME-BASELINE R3, replaced by the three trials of T1-OUTCOME-REPLAY, and the 2026-11-07 replay under `_local/bench-step4/`, which is not committed and so is no source
  - reconciling cost with invoices (stated as a gap with its size)
  - the next release cut after 0.2.0, which moves the entry under a release heading and changes the test of acceptance 4 as T0-RELEASE-0-2-0 changes the 69 tests that pin an entry
  - a group value of labels.jsonl that holds a comma, `]` or `|`, which an expression cannot name
hygiene: "This card replaces T1-OUTCOME-BASELINE (budget 1500, above the owner's card size of 2026-11-14); the coordinator marks that card superseded. Tests first, in two commits. Commit 1 holds tests/surface/outcome-baseline.test.ts whole and records acceptance 1 to 4 failing by assertion. Commit 2 adds docs/reliability/baseline.md and the CHANGELOG entry. Write the numbers from the three committed files only; never from a new run of bench/outcome or the state directory. When CHANGELOG.md conflicts at a base sync (T0-RELEASE-0-2-0 adds a heading under `## Unreleased`), keep this entry directly under `## Unreleased` and above the release heading (merge-conflicts skill). Before the first review the coordinator runs every test file that reads CHANGELOG.md, tests/surface/release-version.test.ts included when it exists. Revert table, each row a scratch change restored afterwards: one value changed by one unit of its last place beyond the rounding (fails acceptance 2); a `%` removed from a share (fails acceptance 2); a required row removed (fails acceptance 3); a heading renamed or two headings swapped (fails acceptance 1); the entry moved below the next heading, and the entry written twice (each fails acceptance 4); and, when T0-RELEASE-0-2-0 has not merged, the line `## 0.2.0 - 2026-11-14` and a blank line inserted below the entry as that card inserts them (acceptance 4 still passes)."
doc_sync: CHANGELOG.md, docs/reliability/baseline.md
---

# T1-OUTCOME-REPORT

## Deliverable
`docs/reliability/baseline.md`: the loop's numbers from the committed snapshot, the finding labels and the replay baseline, every number in a table row with the file and expression it comes from, the measured gaps, and no target. A surface test resolves each source and compares the value. CHANGELOG.md gets the goal's one entry, covering its five cards.

## Why
Spec R5 of plans/reliability-baseline-2.md. T1-OUTCOME-BASELINE planned this report with three data files in one card of 1500 lines; this card keeps its section list and its rule that every number traces to a source, without the sections that need T1-OUTCOME-HISTORY. The next goal (plans/loop-evidence.md) and the owner judge later changes against these numbers, so each one is checked against its file by the test, not by reading.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Source expressions
An expression is a JSON pointer, then an optional filter, then an optional tail, read against the file's JSON. labels.jsonl is read as the array of its parsed non-blank lines (split at `\n` with a trailing `\r` removed) and its expressions have no pointer.
- Pointer: RFC 6901 (`~1` for `/`, `~0` for `~`), its tokens holding no `[`, `]`, `.` or `#`; empty for the whole document.
- A number or null at the pointer is the source value; such an expression has no filter and no tail.
- An array at the pointer: the filter `[<field>=<v>, ...]` keeps the elements for which every condition holds (no filter, or `[]`, keeps all). `<v>` `null` holds when the field is null or absent; `<v>` that starts with `$` holds when the field is strictly equal to the element's field named by the rest; any other `<v>` holds when `String` of the field equals it. With no tail the value is the count of kept elements; with `.<column>` it is the sum of that column over them, null when every one is null, and at least one element must be kept; with `#<column>` it is the number of distinct values of that column, compared as JSON text.
- Anything else fails the row: a pointer that does not resolve, an object, a filter or tail on a number, a sum over a value that is not a number.

## Required rows
summary.json, each expression once at least:
- `/views/summary_review_convergence/0/` followed by `cards`, `first_decision_pass_share`, `mean_decisions_to_pass`, `two_or_more_blocks_share`, `stop_review_share`
- `/views/summary_successor_rate/0/` followed by `card_attempts`, `failed`, `successor_rate`; `/views/summary_pr_success/0/` followed by `accepted`, `pr_success_rate`, `accepted_strict`, `pr_success_rate_strict`
- `/views/summary_lead_time[measure=lead_p50].hours`, `/views/summary_lead_time[measure=lead_p90].hours`, `/views/summary_lead_time_pr/0/p50_hours`, `/views/summary_lead_time_pr/0/p90_hours`, `/views/summary_ci/0/rerun_share`, `/views/summary_ci/0/first_attempt_failed_share`
- `/views/summary_cost_by_stage[cards=merged].cost_usd`, `/views/summary_cost_by_stage[cards=superseded].cost_usd`, `/views/summary_superseded_spend/0/cost_usd`, `/views/summary_cost_per_card/0/p50_usd`, `/views/summary_cost_per_card/0/p90_usd`
- gaps: `/views/summary_unattributed[measure=unattributed].requests`, `/views/summary_unattributed[measure=unattributed].token_share`, `/views/summary_unattributed[measure=unpriced].requests`, `/views/summary_cost_by_stage.cost_usd` (both groups, a card in both counted in each, which the row's measure says), `/tables/ingest_errors`, `/tables/usage_errors`, `/tables/github_errors`

labels.jsonl: `[]`, `#cardId`, `[labelA=$labelB]`, `[ownerRuled=true]`, `[final=null]`, `[final=true-defect]`, `[final=out-of-card-scope]`, `[final=speculative]`, `[final=reviewer-misread]`, `[final=ambiguous-card]`, and for each distinct `group` value `g` of the file, `[group=g]` and `[group=g]#cardId`.

replay-main.json (the fields of R9 of T1-OUTCOME-REPLAY): `/run/cases` (the cases of the baseline arm), `/trials[verdictAgree=true]` (the trial cases whose three normalized reviewer verdicts are equal; the row of Verdict instability), `/trials[agree=true]` (the trial cases whose three bench outcomes are equal, which a pass and a block that misses the expected site share; its measure says score agreement), `/leftOut/candidateGone` (the labelled findings left out because their candidate commit could not be read).

## Acceptance detail

### 1
The text of docs/reliability/baseline.md, split at line feeds with a trailing `\r` removed: the first line is `# Reliability baseline`; the lines that start with `## ` deep-equal the nine headings of R1 with that prefix, in order; no line matches `/[\u2014\u300c\u300d]/`.

### 2
Every line that starts with `|` is the header `| Measure | Value | Source |`, its separator row, or a row of three cells whose third cell matches ``/^`(summary\.json|labels\.jsonl|replay-main\.json)` `([^`]*)`$/``. For each row the expression is resolved in that file and the value cell compared by R2: `null` matches only null; otherwise the cell matches `/^-?\d+(\.\d+)?%?$/`, the source value is a number, and the absolute difference between the cell's number and the value (times 100 with `%`) is at most half a unit of the cell's last decimal place plus 1e-9. A failure names the row. At least one row exists for each of the three files.

### 3
Each expression of Required rows is the source of at least one row, for the file it is listed under, and at least three rows name replay-main.json. The document holds the `commit` of summary.json, the first 10 characters of its `ranAt` and the text `run.ts --summary`.

### 4
The lines of CHANGELOG.md (split at line feeds, a trailing `\r` removed) hold exactly one line `## Unreleased` and exactly one line equal to the entry below; a line that starts with `## ` follows `## Unreleased`; the entry stands between them. The entry, one line:

"- reliability-baseline-2 (T1-OUTCOME-FIRST-DECISION, T1-OUTCOME-LABELS, T1-OUTCOME-SUMMARY, T1-OUTCOME-REPLAY and T1-OUTCOME-REPORT, in place of T1-OUTCOME-BASELINE): `summary_review_convergence` (bench/outcome/views/10-cards.sql) counts a card's first formal decision and its decisions to a pass in date order and leaves out second passes and base-sync decisions; it counted every merge-blocking block of the card before, so a second-pass or base-sync block made a first decision that passed count as a block. `node bench/outcome/run.ts --summary <file>` writes the main checkout's commit, the run time, the row count of every table and the rows of every summary view once every view has run, and `bench/outcome/summary.json` is one such run on the main checkout. `bench/outcome/labels.jsonl` holds a label from Claude, a label from a model of another vendor and a final label for each merge-blocking formal finding of a fixed selection of replaced cards, clean cards and second-pass blocks; the confirmed cases made from the final labels are under `evals/review/`, and `bench/outcome/replay-main.json` is the bench run of the formal stage on main's reviewer. `docs/reliability/baseline.md` reports these numbers, each with its source, and the measured gaps, with no target. No behaviour of the loop changes."
