---
id: T1-CARD-READER-REPORT
title: bench/outcome/reader-results.json holds the reader's stored result for each of the 45 cases, or the reason there is none, and docs/reliability/card-reader.md reports the two keep-rule numbers with their counts and the number a random naming would give; a surface test recomputes every reported number from the results file, the case file and the hit rule
status: todo
branch: T1-CARD-READER-REPORT
worktree: D:\wt\AIDLC\T1-CARD-READER-REPORT
plan_ref: plans/card-preflight.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - bench/outcome/reader-report.ts
  - bench/outcome/reader-results.json
  - docs/reliability/card-reader.md
  - tests/surface/outcome-reader.test.ts
  - specs/tasks/T1-CARD-READER-REPORT.md
dod_command: npm run typecheck && node --test tests/surface/outcome-reader.test.ts
dod_exit: 0
requirements:
  - R1. `bench/outcome/reader-report.ts` (new) shall export `collectResults(cases, read)`, which returns, for each case in order, `{ id, result }` with `result` of `{ unsupported }` when `read(id)` returns a text that parses as a JSON object with `ok` true, `card` equal to the id and an `unsupported` list for which `CardReaderResult` (src/review/card-reader.ts, card T1-CARD-READER) accepts `{ unsupported }`, and otherwise `{ id, result: null, reason }` with `reason` `missing` when `read(id)` returns undefined and `invalid` in every other case.
  - R2. The module shall export `keepNumbers(cases, results)`, which returns the eight numbers of body section Numbers, counting a hit with `isHit` of bench/outcome/reader-cases.ts and counting a case without a result as no hit and as naming nothing.
  - R3. Run as `node bench/outcome/reader-report.ts <dir> <out>`, the script shall read `bench/outcome/reader-cases.json` beside itself, read `<dir>/<id>.json` for each case, write `JSON.stringify({ results }, null, 2)` and one line feed to `<out>`, both paths resolved against the process directory, print `JSON.stringify(keepNumbers(...))` and one line feed on stdout and exit 0; an argument count other than two, a `<dir>` that is not a directory, or a case file that is absent or is not `{ cases: [...] }` exits 1 with one line on stderr and writes nothing.
  - R4. `bench/outcome/reader-results.json` shall be the file of one run of the script over the directory the coordinator filled, with one row per case of `bench/outcome/reader-cases.json`, in its order.
  - R5. `docs/reliability/card-reader.md` (new) shall report each of the eight numbers in exactly one table row of the form of docs/reliability/baseline.md (`| Measure | Value | Source |`), whose Source cell is `keepNumbers` and the key, each in a code span, and whose Value is the number as body section Numbers writes it; the document states the text of body section Document.
acceptance:
  - 1. `tests/surface/outcome-reader.test.ts`, new test "T1-CARD-READER-REPORT acceptance 1: collectResults keeps a valid stored result and records a missing or an invalid one". One row each: a valid document with two entries, kept as `{ unsupported }` without `ok` and `card`; a valid document with an extra top-level key, kept; `read` returns undefined (`missing`); text that is not JSON; a JSON array; `ok` false; `card` of another id; no `unsupported`; an entry with the item `R0`; an entry with a sixth key (each `invalid`). Fails on main (no module). [R1] [dod arm 1]
  - 2. Same file, new test "T1-CARD-READER-REPORT acceptance 2: keepNumbers counts hits, named first-pass cases, cases without a result and the number expected from random naming". Over hand-written cases and results the eight numbers deep-equal the literal object the test states. The cases include: a replaced case hit through `acceptance 3`; one that names only `body` (no hit, chance 0); one with `items` 4, `changed` of two and one named reference outside them (no hit, chance 0.5); one with `items` 4, `changed` of two and three named references (chance 1); one with the same reference named twice (counted once); one without a result; a first-pass case that names one entry; one that names none; one without a result. Fails on main. [R2] [dod arm 1]
  - 3. Same file, new test "T1-CARD-READER-REPORT acceptance 3: reader-results.json has one row per case, in the case file's order, each a valid result or a reason". The ids of the rows equal the ids of the cases of `bench/outcome/reader-cases.json`; each row has either a `result` that `CardReaderResult` accepts and no `reason`, or `result` null and a `reason` of `missing` or `invalid`. Fails on main (no file). [R4] [dod arm 1]
  - 4. Same file, new test "T1-CARD-READER-REPORT acceptance 4: every table row of card-reader.md names one key of keepNumbers and states its value, and every key has one row". `keepNumbers` over the two committed files; every line of the document that starts with `|` is the header, its separator or a row of the form of R5; the keys of the rows are the eight keys, each once; each Value equals the number in the written form of body section Numbers. The test also changes one Value in a copy of the text and expects its own check function to report that row. Fails on main (no document). [R5] [dod arm 1]
  - 5. Same file, new test "T1-CARD-READER-REPORT acceptance 5: the script writes one row per case from a directory of stored results, and a wrong argument count or a missing directory exits 1 with nothing written". In a directory from `tmpDir` of tests/infra/helpers.ts the test stores a valid document for the first case id and the text `x` for the second; `node bench/outcome/reader-report.ts <dir> <out in that directory>` exits 0, stdout parses to `keepNumbers` of what was written, and the written file has 45 rows, the first with a result, the second `invalid`, the other 43 `missing`. With one argument, with three, and with a `<dir>` that does not exist it exits 1, prints one stderr line and writes no file. Fails on main. [R3] [dod arm 1]
  - 6. The tests of card T1-CARD-READER-CASES in the same file pass with no line of them changed. [dod arm 1]
  - 7. docs/reliability/card-reader.md holds the sentences of body section Document, among them that a hit counts an item the successor changed for any reason. (reviewer-verified against the diff) [R5]
  - 8. `bench/outcome/reader-results.json` is the file the script writes from `_local/reader` under the main checkout: the worker runs `node bench/outcome/reader-report.ts <main checkout>/_local/reader <scratch file>` at the candidate and records in the Attempt evidence that the scratch file parses to the same value as the committed file. (reviewer-verified against the diff) [R4]
depends_on: [T1-CARD-READER, T1-CARD-READER-CLI, T1-CARD-READER-CASES]
budget: 200
tdd: true
sweep: "Main at 35de54fe. None of this card's inputs exists there: `bench/outcome/reader-cases.json`, `isHit` and tests/surface/outcome-reader.test.ts come from T1-CARD-READER-CASES, `CardReaderResult` from T1-CARD-READER, and the stored results from the coordinator's run of the option of T1-CARD-READER-CLI (plans/card-preflight.md, Order of work, step 4); read all four at PREPARE, as merged. `git grep -n 'reader-results\\|reader-report\\|card-reader\\.md' -- tests src bench docs README.md CHANGELOG.md`: no hit. docs/reliability/ holds baseline.md only, and tests/surface/outcome-baseline.test.ts:9 reads that one file; tests/surface/prose.test.ts:39-49 lists `docs/*.md` one level deep and does not read docs/reliability/. `_local/` is ignored by git (.gitignore:10), so the stored results are not in a card worktree: the script takes their directory as an argument and the worker passes the main checkout's. The stored form is the stdout of `aidlc cards validate --card <id> --reader --json` on exit 0, which T1-CARD-READER-CLI fixes as `{ ok: true, card, unsupported }`; a run that exited 1 printed nothing on stdout, so its case has no file. Base rate from the scratch run of 2026-11-16 at 35de54fe on the registry text: 496 of 1491 referenced items of replaced cards changed; in the 81 pairs with a changed item a card has 15.5 referenced items on average, of which 6.1 changed, and one reference named at random hits in 42% of those pairs on average, two in 56%, three in 65%. The 40% threshold alone therefore does not show reading, which is why the report carries the chance number. The required check `Gitleaks (committed history)` (aidlc.config.json, github.requiredChecks) scans the committed history, the results file included."
forbid:
  - a model call, a network call or a run of the reader in this card; a missing result is recorded as missing
  - a result written, corrected or removed by hand in bench/outcome/reader-results.json, and a case left out of it
  - a hit decided by anything but `isHit`, and a label from a model used as truth
  - a gate, a card state, a stop, a review rule or a ship rule that reads the results; the reader gates nothing in this goal
  - a new CLI command or option of `aidlc`
  - a sentence in the document that says the reader is kept or dropped; the document states the numbers and the keep rule, and the owner decides
  - a number in the document outside a table row, other than the two thresholds of the keep rule, the interval sentence, the case counts 30 and 15, dates, commits and card ids
  - a change to bench/outcome/reader-cases.ts, bench/outcome/reader-cases.json, src/, or a line of an existing test
  - in the tests `Date.now()`, a temporary directory that does not come from `tmpDir`, or a process left running
non_goals:
  - a stored result in any other form (a file of another name, a log, the reader's raw stdout with prose before the document); it is `missing` or `invalid`
  - why a run has no result; the coordinator's notes are not read, and the document states only the counts
  - a rerun of a case without a result
  - a verdict on the keep rule, and a change of the keep rule; intent/card-preflight.md set it before the run
  - whether a named item was a real defect of the card; a hit says only that the successor changed that item
  - a CHANGELOG.md entry; the report changes no behaviour
  - a section in bench/outcome/README.md; the document's Method section gives the command
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. PREPARE: `<main checkout>/_local/reader/` must exist and hold the coordinator's files; if it does not, stop with a deviation and do not run the reader. Tests first: acceptance 1, 2 and 5 fail on main for the missing module. Generate the results file last with `node bench/outcome/reader-report.ts <main checkout>/_local/reader bench/outcome/reader-results.json`, then write the table from the numbers it prints. The JSON file is generated and is not counted in the budget; estimate for the rest: the script about 70 lines, the tests about 90, the document about 28. Before the attempt, scan the results file with the pinned gitleaks (.github/workflows/security-scanners.yml); a finding is a stop for the owner, not an edit of the data (docs/LESSONS.md, T0-GITLEAKS-LESSON-FP). Revert rows, each a scratch change restored afterwards: a case without a result left out of the denominator (acceptance 2 red); `body` counted as a named reference for the chance number (2 red); a repeated reference counted twice (2 red); one Value of the table changed (4 red); one row of the results file removed (3 red)."
---

# T1-CARD-READER-REPORT

## Deliverable
The reader's stored results as one committed file, a script that builds it and computes the keep-rule numbers, and the report the owner decides from.

## Why
intent/card-preflight.md sets the keep rule before the run: the reader names an item the successor changed in at least 40% of the replaced cards, and names anything in at most 3 of the 15 first-pass cards. Spec specs/card-preflight.md R7 asks for both numbers from the results. The plan's success condition is that the owner can decide from the report whether a later goal gates registration on the reader; nothing gates on it here.

One number is added to the two of the keep rule. A hit is a named item that the successor changed, and at 35de54fe a third of all referenced items of replaced cards changed, so that one reference named at random hits in 42% of the eligible pairs on average (sweep). The report therefore also gives the number of hits expected if each result had named the same number of references at random.

## Numbers
`keepNumbers` returns these keys. A case has a result when its row's `result` is not null.

| Key | Meaning | Written in the document as |
|---|---|---|
| `replaced` | cases of kind `replaced` | integer |
| `replacedWithResult` | of those, cases with a result | integer |
| `replacedHit` | replaced cases with a result for which `isHit` is true | integer |
| `replacedHitShare` | `replacedHit` divided by `replaced` | percent with one decimal, in the form `36.7%` |
| `replacedHitByChance` | the sum, over replaced cases with a result, of the chance below | one decimal, in the form `11.4` |
| `firstPass` | cases of kind `first-pass` | integer |
| `firstPassWithResult` | of those, cases with a result | integer |
| `firstPassNamed` | first-pass cases with a result whose `unsupported` is not empty | integer |

The chance of a replaced case: with `n` the case's `items`, `m` the length of its `changed`, and `k` the number of distinct items of the result that are not `body`, limited to `n`: 0 when `k` is 0, 1 when `k` is larger than `n - m`, else 1 minus the product, for `i` from 0 to `k - 1`, of `(n - m - i) / (n - i)`. This is the probability that `k` references drawn without repeat from the `n` include one of the `m`. The test compares the share and the chance sum with the document after rounding to the written decimals.

## Document
docs/reliability/card-reader.md has the title `# Card reader on replaced and first-pass cards` and these sections.

`## Method`: the cases are those of `bench/outcome/reader-cases.json` (30 replaced cards and 15 first-pass cards, each read at the commit that first added the card); the coordinator ran `aidlc cards validate --card <id> --reader` once per case from a detached worktree at that commit, on a date the section names, with the reader command of this repository's `aidlc.config.json`; `bench/outcome/reader-results.json` holds what each run printed, or that it printed no valid result; a hit is decided in code by `isHit`; `tests/surface/outcome-reader.test.ts` recomputes every table value; the command that rebuilds the results file.

`## Result`: the eight rows, and after the table: the keep rule as intent/card-preflight.md states it, with its two thresholds; the sentence that with 30 replaced cards the 95% interval of the share is about 18 points either way; the sentence that a case without a valid result counts as no hit and as naming nothing, so the two keep-rule numbers are read together with the two `WithResult` rows.

`## What these numbers do not show`: a list with these points. A hit counts an item the successor changed for any reason, so the share overstates what the reader would have prevented. `replacedHitByChance` is what naming the same number of references at random would give; a share near it shows no reading. A first-pass card with nothing named is not shown to be correct. The first-pass cards T0-BENCH-DRAFTS-IGNORE-2, T0-HOOK-CLASSIFIER-3 and T0-INTAKE-TARGET-2 are successors of replaced cards, so their text had already been corrected once. One run per case: the results do not show how much a second run differs. The reader's sentences and reasons were not checked by a person.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-reader.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes, and the tests of T1-CARD-READER-CASES in the file pass unchanged.
