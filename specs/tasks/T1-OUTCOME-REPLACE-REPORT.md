---
id: T1-OUTCOME-REPLACE-REPORT
title: docs/reliability/replacement.md reports every total of bench/outcome/replace-cause.json in a table row that names its source, in the style of the reliability baseline, and a surface test compares each value with the file
status: todo
branch: T1-OUTCOME-REPLACE-REPORT
worktree: D:\wt\AIDLC\T1-OUTCOME-REPLACE-REPORT
plan_ref: plans/card-preflight.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - docs/reliability/replacement.md
  - tests/surface/outcome-replace-cause.test.ts
  - specs/tasks/T1-OUTCOME-REPLACE-REPORT.md
dod_command: npm run typecheck && node --test tests/surface/outcome-replace-cause.test.ts
dod_exit: 0
requirements:
  - R1. `docs/reliability/replacement.md` (new) shall report every key of the `totals` of `bench/outcome/replace-cause.json` in exactly one table row of the form of docs/reliability/baseline.md (`| Measure | Value | Source |`), whose Source cell is `replace-cause.json` and the pointer `/totals/` followed by the key, each in a code span, and whose Value is the integer at that pointer.
  - R2. The document shall have the title, the four headings and the text of body section Document, and no line with an em dash or a corner bracket.
acceptance:
  - 1. `tests/surface/outcome-replace-cause.test.ts`, new test "T1-OUTCOME-REPLACE-REPORT acceptance 1: every table row of replacement.md names one total and states its value, and every total has one row". Every line of the document that starts with `|` is the header `| Measure | Value | Source |`, a separator or a row of the form of R1; the pointers of the rows are the keys of `totals`, each once; each Value equals the integer of the committed file. The test also changes one Value in a copy of the text, removes one row from another copy and adds a row for a key the file lacks to a third, and expects its own check function to report each. Fails on main (no document). [R1] [dod arm 1]
  - 2. Same file, new test "T1-OUTCOME-REPLACE-REPORT acceptance 2: replacement.md has its title and its four headings in order and no banned character". The first line is `# Why cards were replaced`; the lines that start with two hashes and a space are `## Method`, `## What the successor changed`, `## Paths the successor added` and `## What these numbers do not show`, in that order; no line holds an em dash or a corner bracket (the characters of tests/surface/prose.test.ts:14, which does not read this directory). Fails on main. [R2] [dod arm 1]
  - 3. The tests of card T1-OUTCOME-REPLACE-CAUSE in the same file pass with no line of them changed. [dod arm 1]
  - 4. The document holds the sentences of body section Document, with the commit and the date of the run filled in, and states no number outside a table row other than that commit, that date and card ids. (reviewer-verified against the diff) [R2]
depends_on: [T1-OUTCOME-REPLACE-CAUSE]
budget: 100
tdd: true
sweep: "Main at 35de54fe. `git grep -n 'replacement\\.md\\|reliability' -- tests`: only tests/surface/outcome-baseline.test.ts, which reads docs/reliability/baseline.md (:9) and no other file of the directory. tests/surface/prose.test.ts:39-49 lists `docs/*.md` one level deep (:41, not recursive), so the banned-character check does not reach docs/reliability/, hence acceptance 2. docs/reliability/baseline.md shows the table form: the header line, a separator line and rows of three cells whose third names a file and an expression in two code spans (lines 9-22); tests/surface/outcome-baseline.test.ts:14-16 and :70-80 show how a test reads such rows. `bench/outcome/replace-cause.json` and tests/surface/outcome-replace-cause.test.ts do not exist at 35de54fe; T1-OUTCOME-REPLACE-CAUSE creates both, and its body section Totals lists the 22 keys: read the merged file at PREPARE and take the keys from it. Stop reasons: bench/outcome/summary.json holds them as totals per reason (`/views/summary_stop_reasons`, seven rows of `stopReason` and `runs` at the commit the file names), with no card id. Budget estimate from the row list: 22 rows, three table headers of two lines, the title and four headings, and about ten lines of text are about 45 lines of document; the two tests about 35."
forbid:
  - a value typed from a new run or from the planner's scratch totals; every Value is the integer of the committed file
  - a change to bench/outcome/replace-cause.json, bench/outcome/replace-cause.ts or a line of an existing test
  - a second file as a source of a row, and a row that names no source
  - a sentence about why cards were replaced that the table does not carry; the document reports what changed, not why
  - editing docs/reliability/baseline.md, CHANGELOG.md, docs/OPERATIONS.md or any card file but this one
non_goals:
  - shares and percentages; the table holds the integers of the file, and the reader of the document divides
  - the stop reason of each replaced card; the committed summary holds stop reasons as totals per reason and not per card, and the document says so
  - a CHANGELOG.md entry; the report changes no behaviour
  - regeneration when the registry gains replaced cards; the document names the command, and a regenerated file fails acceptance 1 until the table is updated in the same change
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Tests first: both new tests fail while the document is absent. Write the table from the committed file, not from memory. Revert rows, each a scratch change restored afterwards: one Value changed (acceptance 1 red); one row removed (1 red); the order of two headings swapped (2 red)."
---

# T1-OUTCOME-REPLACE-REPORT

## Deliverable
The report of what successors changed, as a document whose every number a test compares with the committed run of `bench/outcome/replace-cause.ts`.

## Why
Spec specs/card-preflight.md R2 asks for a report of the totals that a test recomputes. T1-OUTCOME-REPLACE-CAUSE commits the totals and checks them against the registry; this card reports them. The two are separate cards because the script, its tests and a table of 22 rows do not fit one budget of 200 lines (docs/LESSONS.md, T1-OUTCOME-REPORT: size the budget from the list of required rows).

## Document
docs/reliability/replacement.md has the title `# Why cards were replaced` and these sections.

`## Method`: the numbers come from `bench/outcome/replace-cause.json`, written by `node bench/outcome/replace-cause.ts --out bench/outcome/replace-cause.json` on the registry at a commit and on a date the section names; the comparison reads five fields as the card parser returns them, with the two card ids replaced by one token; `tests/surface/outcome-replace-cause.test.ts` compares each table value with the file and each settled pair of the file with the registry; to regenerate, run the command and update the table in the same change.

`## What the successor changed`: the rows for `cards`, `parseErrors`, `pairs`, `successorMissing`, the five fields, `budgetRaised`, `budgetLowered`, `unchanged`, `pairsWithChangedItem`, `items` and `changedItems`.

`## Paths the successor added`: the rows for `pairsWithAddedPath`, `pairsAddingTest`, `pairsAddingSrc`, `pairsAddingDoc`, `pairsAddingOther`, `addedPaths` and `addedPathsNamed`, and one sentence that `addedPathsNamed` counts an added path that the replaced card's own text already contained.

`## What these numbers do not show`: a list with these four points. A changed field says that the text differs, not why. The stop reason of each replaced card is not reported, because `bench/outcome/summary.json` holds stop reasons as totals per reason and not per card. A card amended in place without a successor is in no pair. A pair whose successor is still open is counted as it stood at the run.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-replace-cause.test.ts
```
- Expected exit code: 0
- Assertion: both new tests pass, and the tests of T1-OUTCOME-REPLACE-CAUSE in the file pass unchanged.
