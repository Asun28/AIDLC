---
id: T1-AFFECTED-REPORT
title: bench/outcome/affected.ts runs affectedTests over the committed red CI runs of bench/outcome/affected-cases.json, against the test files of each candidate commit, and docs/reliability/affected.md reports the hit rate and the median selection share against the keep rule, recomputed by a test
status: todo
branch: T1-AFFECTED-REPORT
worktree: D:\wt\AIDLC\T1-AFFECTED-REPORT
plan_ref: plans/execution-gate.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - bench/outcome/affected.ts
  - bench/outcome/affected-cases.json
  - docs/reliability/affected.md
  - tests/surface/outcome-affected.test.ts
  - specs/tasks/T1-AFFECTED-REPORT.md
dod_command: npm run typecheck && node --test tests/surface/outcome-affected.test.ts tests/core/affected.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `report(cases, readTests)` (new, exported from new bench/outcome/affected.ts, no I/O of its own) shall return, for each case in order, `{ commit, failedTest, testFiles, selected, hit }`, where `readTests(commit)` gives the `{ path, text }` of every test file of that commit or `undefined`, `testFiles` is their count, `selected` is the length of `affectedTests(case.changedPaths, files)` and `hit` is whether that result holds `failedTest`; `hit` is null when `failedTest` is null, and `testFiles`, `selected` and `hit` are all null when `readTests` gives `undefined`.
  - R2. `summarise(rows)` (new, exported) shall return `{ cases, leftOut, measured, testCaused, hits, hitRate, medianShare, keep }` - `leftOut` the rows with a null `testFiles`, `measured` the others, `testCaused` the measured rows with a `failedTest`, `hits` those of them with `hit` true, `hitRate` `hits / testCaused` (null when `testCaused` is 0), `medianShare` the median of `selected / testFiles` over the measured rows (the mean of the two middle values for an even count, null with no measured row), and `keep` true only when `hitRate` is at least 0.7 and `medianShare` is at most 0.25.
  - R3. `node bench/outcome/affected.ts [--cases <file>] [--write]` shall read the case file (default bench/outcome/affected-cases.json beside the script), read the test files of each case's commit from the git repository of the invocation directory (the paths `git ls-tree -r --name-only <commit> -- tests` prints that end in `.test.ts`, each text from `git show <commit>:<path>`), print one JSON line per row and then the summary as one JSON line, and exit 0; with `--write` it then writes the case file again with `testFiles`, `selected` and `hit` set on every case, as `[`, one case per line and `]`.
  - R4. IF the case file is absent, is not JSON, is not an array, or holds an entry that is not `{ commit, changedPaths, failedTest }` with a 40-hex lower-case `commit`, an array of non-empty strings and a string or null (the three computed keys allowed beside them, no other key), THEN the command shall print `affected: <file>: <problem>` on stderr, naming the index of a bad entry, write nothing and exit 1.
  - R5. IF `git ls-tree` or a `git show` of a case does not exit 0 within 120 seconds, THEN that case shall be left out (`readTests` gives `undefined`), and the command goes on to the next case.
  - R6. docs/reliability/affected.md shall hold the sections and the seven table rows of Acceptance detail 2, each value equal to the value `summarise` gives for the committed case file, and the one verdict sentence that matches `keep`.
acceptance:
  - 1. tests/surface/outcome-affected.test.ts, new test "T1-AFFECTED-REPORT acceptance 1 - report gives the test file count, the selection size and the hit of each case, null hit for a red that was no test, and nulls for a commit that cannot be read". Three hand-written cases and an in-memory `readTests` (Acceptance detail 1); the rows deep-equal the listed rows. Fails on main (no module). [R1] [dod arm 2]
  - 2. Same file, new test "T1-AFFECTED-REPORT acceptance 2 - summarise counts, divides and takes the median as R2 states, and keep is true only at or inside both limits". The rows of Acceptance detail 1 give the listed summary; four further row sets give `keep` true at `hitRate` 0.7 with `medianShare` 0.25, false at 0.69, false at a median of 0.26, and `hitRate` null with `keep` false when no measured row has a `failedTest`; an even count of measured rows gives the mean of the two middle shares. Fails on main. [R2] [dod arm 2]
  - 3. Same file, new test "T1-AFFECTED-REPORT acceptance 3 - the command refuses a case file that is absent, not JSON, not an array or holds a bad entry, with exit 1 and nothing written". The script started with `process.execPath` and `--cases <file> --write` in a temporary directory of the test (`tmpDir`), once per input form of R4 (absent; `{`; `{}`; an entry with a 39-hex commit; an entry with an empty changed path; an entry with a numeric `failedTest`; an entry with an unknown key); each exits 1, stderr starts with `affected: `, and the file is byte-identical afterwards (still absent in the first case). Fails on main. [R4] [dod arm 2]
  - 4. Same file, new test "T1-AFFECTED-REPORT acceptance 4 - the command leaves out a case whose commit git cannot read, prints its row with nulls and exits 0, and --write stores the nulls". The script started in a temporary directory that is no git repository, with a one-case file and `--write`; exit 0; stdout line 1 is the row with three nulls, line 2 the summary with `cases` 1 and `leftOut` 1; the file is `[`, one line holding the case with the three null keys, `]`. Fails on main. [R3] [R5] [dod arm 2]
  - 5. Same file, new test "T1-AFFECTED-REPORT acceptance 5 - affected.md states the numbers that summarise gives for bench/outcome/affected-cases.json, and its verdict sentence matches keep". The test parses the committed case file (each case carries the three computed keys, `[` and `]` on their own lines and one case per line between), builds the rows from the stored keys, calls `summarise`, and compares each of the seven table values of docs/reliability/affected.md (Acceptance detail 2) with it; the document holds exactly one of the two verdict sentences, the one for `keep`; its headings are the four of detail 2 in order. Fails on main (no document). [R6] [dod arm 2]
  - 6. tests/core/affected.test.ts and tests/surface/prose.test.ts (its "tracked prose carries no em dash and no corner brackets" reads the new document) pass unchanged. [R1] [R6] [dod arm 2]
  - 7. The Attempt evidence section of this card file holds the command line of the `--write` run, the commit of the main checkout it ran in, its stdout, and the number of cases the coordinator handed over (reviewer-verified against the diff). [R3]
depends_on: [T1-AFFECTED-SELECT]
budget: 200
tdd: true
sweep: "Main at 35de54fe. `git grep -n -i affected -- bench docs tests` finds nothing, so the script, the case file, the document and the test are new. House pattern read for this card - bench scripts export their pure functions and run `main` only when `process.argv[1]` resolves to the file (bench/outcome/clean.ts:63, replay.ts:132, adjudicate.ts:167); a report whose numbers a test recomputes from committed files only is docs/reliability/baseline.md with tests/surface/outcome-baseline.test.ts (:132 compares every table value with its source file), and nothing there reads the state directory or git. tests/surface/prose.test.ts:58 scans tracked prose for an em dash and corner brackets, so it is in the DoD. `git grep -n 'reliability/' -- tests` finds only outcome-baseline.test.ts, which reads baseline.md alone, so a second file under docs/reliability fails nothing. tsconfig.test.json includes `bench/**/*.ts`, so dod arm 1 typechecks the script. The 204 test files of 35de54fe are `tests/**/*.test.ts` (scratch count). docs/reliability/baseline.md reports 9 labelled findings whose candidate commit could not be read, so a red run whose commit is gone is expected, hence R5 and the `leftOut` count."
forbid:
  - a number in docs/reliability/affected.md that the test does not recompute from bench/outcome/affected-cases.json
  - a call of `affectedTests` from src or bin, a loop gate on the report, or a change to src/core/affected.ts or tests/core/affected.test.ts
  - a network call, a `gh` call or a read of the state directory by the script or the test; the script's git calls are `git ls-tree` and `git show` only, argv arrays, no shell string
  - editing the cases the coordinator handed over (commit, changedPaths, failedTest) other than their layout
  - changing the keep rule (hit rate at least 70 percent, median selection at most 25 percent of the test files), which intent/execution-gate.md fixed before the report
  - a change to the R3 policy, REVIEW.md, the review allowances or the card state precedence in src/core/card-machine.ts
  - `Date.now()` or a temporary directory outside `tmpDir` in the test, or a process left running
non_goals:
  - assembling the red runs; the coordinator does it before the card starts (plans/execution-gate.md, Order of work, item 6)
  - a red run whose commit the local repository does not hold; it is left out and counted, and no fetch is made for it
  - a test file outside `tests/` or not ending in `.test.ts`; it is not read, so a `failedTest` of that form is a miss
  - a case file entry in another form (an upper-case sha, a missing key); the command refuses the file, as R4 states
  - bench/outcome/README.md, CHANGELOG.md and a `summary_*` view; the document's Method section names the command
  - wiring the selection into the loop, whatever the verdict; a met keep rule is the input of a later goal
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Before the card starts, the coordinator's file must exist at `_local/affected/red-runs.json` under the main checkout (gitignored, so not in the card worktree) - a JSON array of `{ commit, changedPaths, failedTest }`. If it is absent, or holds no case, stop and ask; do not assemble cases in this card. Copy it to bench/outcome/affected-cases.json as `[`, one case per line, `]`, in a commit of its own after the RED commit, then run `node bench/outcome/affected.ts --write` from the card worktree (a worktree shares the object store of the main checkout, so the candidate commits it holds are readable) and commit the file as written. The sample is small (the plan expects 10 to 15 runs), so the document gives every count beside each rate. Revert table before the first review, each a scratch change restored afterwards - `hit` true for a null `failedTest` (1 red); the median taken as the lower middle value (2 red); `keep` with `>` in place of `>=` (2 red); a value changed in affected.md (5 red); the unknown-key check dropped (3 red)."
---

# T1-AFFECTED-REPORT

## Deliverable
A dev-only script that applies `affectedTests` to each recorded red CI run, a committed case file with the result of each case, and `docs/reliability/affected.md`, which states the two numbers of the keep rule with their counts and whether the rule is met.

## Why
Intent `intent/execution-gate.md`, proposed outcome 3: the loop changes only if a selection by changed path would have run the failed test in at least 70% of the test-caused red runs while selecting at most 25% of the test files at the median. On the tree of 35de54fe the rule of T1-AFFECTED-SELECT selects 47 of 204 files for `src/loop/card-runner.ts` (23%), 72 for `docs/OPERATIONS.md` (35%) and 84 for `CHANGELOG.md` (41%), so the outcome is open and has to be measured on the real red runs. Spec `specs/execution-gate.md` R11 and acceptance 8.

Shape. The numbers are recomputed in CI from the committed case file alone, as `docs/reliability/baseline.md` is from `bench/outcome/summary.json`: CI has no state directory and may not hold the candidate commits. The git reads happen once, in the `--write` run, and the case file keeps what they gave.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-affected.test.ts tests/core/affected.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every acceptance test above passes.

## Acceptance detail

### 1. The cases of acceptance 1 and 2
`readTests` knows two commits. Commit `a` (40 `a`) has four test files: `tests/x/one.test.ts` with text `'../../src/loop/card-runner.ts'`, `tests/x/two.test.ts` with text `read('docs/OPERATIONS.md')`, and `tests/x/three.test.ts` and `tests/x/four.test.ts` with text `// nothing`. Commit `b` (40 `b`) is unknown (`undefined`).

| case | commit | changedPaths | failedTest | row |
|---|---|---|---|---|
| 1 | a | `['src/loop/card-runner.ts']` | `tests/x/one.test.ts` | `testFiles` 4, `selected` 1, `hit` true |
| 2 | a | `['docs/OPERATIONS.md']` | `tests/x/three.test.ts` | `testFiles` 4, `selected` 1, `hit` false |
| 3 | a | `['src/loop/card-runner.ts', 'docs/OPERATIONS.md']` | null | `testFiles` 4, `selected` 2, `hit` null |
| 4 | b | `['src/a.ts']` | `tests/x/one.test.ts` | three nulls |

Summary: `cases` 4, `leftOut` 1, `measured` 3, `testCaused` 2, `hits` 1, `hitRate` 0.5, `medianShare` 0.25, `keep` false.

### 2. docs/reliability/affected.md
Title `# Test selection by changed path`. Headings, in order: `## Method`, `## Result`, `## Keep rule`, `## What this does not show`.

Method names the rule (`affectedTests` of src/core/affected.ts), the case file, the command `node bench/outcome/affected.ts --write`, the commit of the main checkout it ran in, and that tests/surface/outcome-affected.test.ts recomputes every value of the table.

Result holds one table with the header `| Measure | Value |` and these seven rows, in this order, each value as stated:

| Measure | Value |
|---|---|
| Red runs in the case file | `cases` |
| Left out, commit not readable | `leftOut` |
| Measured | `measured` |
| Red runs caused by a test | `testCaused` |
| Failed test file selected | `hits` |
| Hit rate | `hitRate` as a percentage with one decimal place and a percent sign, or `none` when it is null |
| Median selection, share of the test files | `medianShare` in the same form |

Keep rule holds exactly one of these sentences:
- `The keep rule is met: the hit rate is at least 70% and the median selection is at most 25% of the test files.`
- `The keep rule is not met, so the selection is recorded and not wired into the loop.`

What this does not show names at least the sample size, the runs left out, and that a test reached only through another file is not selected.
