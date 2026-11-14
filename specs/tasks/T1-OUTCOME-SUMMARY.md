---
id: T1-OUTCOME-SUMMARY
title: node bench/outcome/run.ts --summary writes the main checkout's commit, the run time, the row count of every table and the rows of every summary view to one JSON file once every view has run, and bench/outcome/summary.json is that file from one full run on the main checkout
status: merged
branch: T1-OUTCOME-SUMMARY
worktree: D:\wt\AIDLC\T1-OUTCOME-SUMMARY
plan_ref: plans/reliability-baseline-2.md#order-of-work
allow_paths:
  - bench/outcome/run.ts
  - bench/outcome/ingest.ts
  - bench/outcome/README.md
  - bench/outcome/summary.json
  - tests/surface/outcome-summary.test.ts
dod_command: npm run typecheck && node --test tests/surface/outcome-summary.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
dod_exit: 0
requirements:
  - R1. `bench/outcome/run.ts` shall take the string option `--summary` (a file path). A run without it does what it does on main at e6566c68. `--summary` adds exactly one git call, the one of R2, to the calls a run makes on main. `--no-github` still leaves out the GitHub tables and their `gh` and git calls; it never stopped the resolution of the main checkout (`resolveRepoIdentity`, src/state/paths.ts:66-73, one `git rev-parse` when a default path or `--summary` needs the main checkout), and it does not now.
  - R2. With `--summary`, the run shall, after reading its inputs and before `writeTables` creates anything, resolve the path against the invocation directory and then, in this order, stop with exit 1 and no file written when either check fails. First, it runs `git rev-parse --verify HEAD^{commit}` once through `runSync` (src/probes/exec.ts) with `cwd` the main checkout (`resolveRepoIdentity().mainRoot`, as run.ts resolves it) and `timeoutMs` 120000; when the receipt's exit code is not 0 or its trimmed stdout is not 40 lower-case hex characters, the run prints `outcome: --summary: git rev-parse in <main checkout> exited <exit code>: <first line of stderr>` on stderr. Second, the directory of the path must not be the state directory, the registry, a Claude directory or the Codex directory or lie under one, decided by `assertWritable` of `bench/outcome/ingest.ts` (exported for this, its body unchanged) with the read-only directories run.ts passes to `writeTables`; a refusal prints its `refusing to write` message.
  - R3. The summary file shall be written only after every `summary_*` view has been queried and printed, so a run that exits 1 or 2 before the replacement begins (a refusal of R2, a view that fails after earlier views printed, a DuckDB binary that cannot be started) leaves the path as it was. Its directory is created when absent; the entry at the path is removed and the file created exclusively (`flag: 'wx'`), as `writeTables` writes a table, so a link at the path is replaced and not written through. A failure of that removal or write (a full disk) exits 1 and may leave the summary absent or partial. The text is `JSON.stringify(doc, null, 2)` followed by one line feed.
  - R4. The document shall be `{ commit, ranAt, tables, views }` in that key order. `commit` is the hash of R2. `ranAt` is `new Date().toISOString()` read once at the start of `main`. `tables` maps each table name the run wrote, in the key order of the `tables` object of run.ts, to its row count (the counts of the stderr line of run.ts:61 at e6566c68). `views` maps each `summary_*` view name, in the order run.ts queries them (`ORDER BY view_name`), to the array of its rows as printed on stdout.
  - R5. `bench/outcome/summary.json` shall be the file of R4 from one run of `node bench/outcome/run.ts --summary bench/outcome/summary.json --out <scratch directory>` started in the card worktree with no other option (`--duckdb` only when no `duckdb` is on PATH), so it reads the state directory, the registry, the session logs and GitHub of the main checkout and holds the 15 tables and the 13 views; the main checkout is then at a commit of main that holds T1-OUTCOME-FIRST-DECISION, and `git diff <commit> HEAD -- bench/outcome/views` is empty in the worktree. The file is committed as written and not edited.
  - R6. `bench/outcome/README.md` shall state `--summary` in the Command block and the option list (what it writes, that it writes only after every view has run, its one additional git call, also under `--no-github`, and the two refusals of R2), say in the `--no-github` bullet that it leaves out the GitHub tables and their `gh` and git calls while the main checkout may still be resolved through git (the bullet says today that no git call is made), describe `bench/outcome/summary.json` as one such run, and name `tests/surface/outcome-summary.test.ts` in its Tests section.
acceptance:
  - 1. `tests/surface/outcome-summary.test.ts` "T1-OUTCOME-SUMMARY acceptance 1: bench/outcome/summary.json holds the commit, the run time, the row count of every table and every summary view of one full run". Fails on main by assertion (the file does not exist). Runs everywhere. [R4] [R5] [dod arm 1] Detail in the body section Acceptance detail, item 1.
  - 2. Same file, "T1-OUTCOME-SUMMARY acceptance 2: run.ts --summary writes the document after every view has run, and a view that fails after others printed leaves an existing summary as it was". Fails on main by assertion (exit 1 on the unknown option where 0 is expected; its second part passes on main). Skipped with the reason `no duckdb binary` where no DuckDB binary is found. [R1] [R2] [R3] [R4] [dod arm 1] Detail item 2.
  - 3. Same file, "T1-OUTCOME-SUMMARY acceptance 3: a DuckDB binary that cannot be started leaves an existing summary as it was, and either refusal writes neither a summary nor a table". Fails on main by assertion (first case: exit 1 where 2 is expected). Runs everywhere. [R2] [R3] [dod arm 1] Detail item 3.
  - 4. tests/surface/outcome-ingest.test.ts, tests/surface/outcome-usage.test.ts and tests/surface/outcome-github.test.ts pass unchanged, with and without a DuckDB binary. They pass on main and with this card. [R1] [dod arm 1]
  - 5. The README states R1 to R6 (reviewer-verified against the diff). [R6]
  - 6. The run of R5 is recorded in the attempt evidence: the command, its working directory, its exit code, its stderr line of row counts and `duckdb --version`; the `tables` of the committed file equal that line, and `git diff <commit> HEAD -- bench/outcome/views` printed nothing (reviewer-verified from the receipt). [R5]
depends_on: [T1-OUTCOME-FIRST-DECISION]
budget: 200
tdd: true
sweep: "On main at e6566c68. run.ts cannot write this file today: it prints each view as one JSON line on stdout (:75-76), the row counts as one text line on stderr (:61), and no commit or time; so a flag is the smallest change. `git grep -n \"summary\\.json\\|--summary\\|assertWritable\" -- bench tests docs README.md`: bench/outcome/ingest.ts:148 and :165 only (tests/surface/review-bench.test.ts:884 names a file `j-summary.json` of the reviewer bench, unrelated). The tests that start run.ts (tests/surface/outcome-ingest.test.ts `runOutcome` :138-144 and `spawnRun` :178-182, tests/surface/outcome-usage.test.ts, tests/surface/outcome-github.test.ts) pass no `--summary` and run as before. `bench/outcome/summary.json` is generated by the run of R5 and does not count against the budget. Views at e6566c68: 4 in views/10-cards.sql, 5 in views/20-cost.sql, 4 in views/30-github.sql; tables: 7 of `COLUMNS`, 2 of `USAGE_COLUMNS`, 6 of `GITHUB_COLUMNS` (bench/outcome/ingest.ts:9-35). No summary view holds a path, a session text or a cwd (they hold counts, sums, card ids, model names, stages and kinds)."
forbid:
  - weakening, skipping or deleting a test to go green, or changing an existing test file
  - editing bench/outcome/summary.json by hand, or committing it from a run with `--no-usage`, `--no-github`, `--state`, `--cards` or a session directory option
  - a change to the body of `assertWritable` or `writeTables`, to a table column or to a view file
  - a git call that main does not make, other than the one of R2 with `--summary`
  - a change under src, templates or .claude, to REVIEW.md or package.json, or to CHANGELOG.md, docs/OPERATIONS.md or docs/ARCHITECTURE.md
  - a new dependency, or `Date.now()` in the new test file
non_goals:
  - the ruling set (`ruling_set.jsonl` of T1-OUTCOME-BASELINE R2): T1-OUTCOME-HISTORY, which would have produced it, is not in this goal
  - a `--summary` path that names a table file of `--out` (the summary then replaces that table file) or a directory (the removal fails and the run exits 1)
  - a partial summary file left by a process ended during its one write; the committed file is checked by acceptance 1
  - a state with no card run, on which `summary_successor_rate` prints `NaN` and run.ts exits 1 after three views have printed, as on main; acceptance 2 uses that failure and changes when it is fixed
  - uncommitted files of the main checkout (a card file not yet committed is read as it stands), and rows added to the state after the run
  - the CHANGELOG entry, which T1-OUTCOME-REPORT writes for the whole goal
hygiene: "Line numbers are from main at e6566c68; find each place by its content. Tests first, in three commits. Commit 1 holds tests/surface/outcome-summary.test.ts whole and records acceptance 1, 2 (with a DuckDB binary present) and 3 failing by assertion. Commit 2 changes run.ts, the export of ingest.ts and the README; the DoD passes except acceptance 1. Commit 3 adds bench/outcome/summary.json from the run of R5, after `git -C <main checkout> status --short -- specs/tasks` and `git -C <main checkout> rev-parse HEAD` are recorded. The run reads GitHub through `gh` with the read-only calls of bench/outcome/README.md; when its `github_errors` count is not 0 the file is still committed and T1-OUTCOME-REPORT reports the count. Every run.ts child of the new tests gets an environment without the variables whose upper-cased name starts with `AIDLC_` or `GIT_` and without `NODE_OPTIONS`, as `runOutcome` filters it; each temporary directory comes from `tmpDir` of tests/infra/helpers.ts and is removed with `cleanup` in an `after` hook. Revert table before the first review, each row a scratch change restored afterwards: the summary written before the views (fails acceptance 3, first case); the summary rewritten after each view (fails acceptance 2, second part); the git check after `writeTables` (fails the third case: `cards.jsonl` exists); the `assertWritable` check left out (fails the second case); `ranAt` read at the end (no test; reviewer row); keys in another order (fails acceptance 2); the `wx` write replaced by a plain write (no test; reviewer row)."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-SUMMARY

## Deliverable
`node bench/outcome/run.ts --summary <file>` writes one JSON document with the main checkout's commit, the run's start time, the row count of every table it wrote and the rows of every `summary_*` view, and only once every view has run. `bench/outcome/summary.json` is that document from one full run on the main checkout, committed with a surface test of its shape.

## Why
Spec R2 of plans/reliability-baseline-2.md: the report of T1-OUTCOME-REPORT and the arc proof read one committed snapshot of every summary view, with the commit and time of its run and the size of every table and error table. The card that held this file before, T1-OUTCOME-BASELINE (budget 1500), is replaced by five cards of about 200 lines. Its ruling set needs T1-OUTCOME-HISTORY, which is not in this goal (non_goals).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-summary.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes, with no test skipped on the machine that records the receipt.

## Acceptance detail

### 1
`bench/outcome/summary.json` exists (asserted with `existsSync` before it is read) and parses. Its keys, in order, are `commit`, `ranAt`, `tables`, `views`. `commit` matches `/^[0-9a-f]{40}$/`. `ranAt` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` and `new Date(ranAt).toISOString()` equals it. The keys of `tables`, sorted, equal the sorted keys of `COLUMNS`, `USAGE_COLUMNS` and `GITHUB_COLUMNS` (15 names, imported from bench/outcome/ingest.ts), and each value is a safe integer of 0 or more. The keys of `views`, in order, are `summary_cache_share`, `summary_ci`, `summary_cost_by_stage`, `summary_cost_per_card`, `summary_lead_time`, `summary_lead_time_pr`, `summary_pr_success`, `summary_reconcile`, `summary_review_convergence`, `summary_stop_reasons`, `summary_successor_rate`, `summary_superseded_spend`, `summary_unattributed`; each value is an array of objects that are neither null nor arrays. `summary_review_convergence` is one row whose keys, in order, are `cards`, `first_decision_pass_share`, `two_or_more_blocks_share`, `mean_decisions_to_pass`, `stop_review_share`. `card_attempts` of `summary_successor_rate` equals `card_attempts` of `summary_pr_success` (both count the rows of `card_attempts`). No string anywhere in `views` holds `/` or `\`.

### 2
Fixture, under a directory from `tmpDir`: a registry holding one card file `T1-A.md` (the `cardText` form of tests/surface/outcome-ingest.test.ts:28, status `todo`), and a state directory holding one card run `cards/g-a/T1-A.json` (the `run` form of :29, state `BUILD`, `startedAt` `2026-01-01T00:00:00Z`) and an empty `journal` directory. A state with no card run cannot serve: `summary_successor_rate` divides 0 by 0, DuckDB prints `NaN`, and run.ts exits 1 on main as well (probed by the drafter on 2026-11-14). The child is `process.execPath` with the absolute path of run.ts and `--state <state> --cards <registry> --out <out> --duckdb <binary> --no-usage --no-github --summary <tmp>/new/summary.json`, working directory the repository root. Expected: exit 0; the directory `new` was created; the file text equals `JSON.stringify(doc, null, 2)` and one line feed; `Object.entries(doc.tables)` deep-equals `[['cards', 1], ['card_runs', 1], ['review_decisions', 0], ['findings', 0], ['state_spans', 0], ['attempts', 0], ['ingest_errors', 0]]`; `Object.entries(doc.views)` deep-equals the `[view, rows]` pairs of the stdout lines in their order (the four views of views/10-cards.sql); `doc.commit` equals the trimmed stdout of `git rev-parse --verify HEAD^{commit}` run by the test in `resolveRepoIdentity(root).mainRoot` (src/state/paths.ts); `doc.ranAt` matches the pattern of item 1.

Second part: an empty state directory and an empty registry directory, a file `<tmp>/keep.json` holding `old` and a line feed, and the same options with `--summary <tmp>/keep.json`. Expected: exit 1; stdout holds three lines, the views `summary_lead_time`, `summary_review_convergence` and `summary_stop_reasons`, printed before `summary_successor_rate` fails on `NaN`; the file still holds `old` and a line feed.

### 3
Three cases over the fixture of item 2, each with `--no-usage --no-github`; none needs a DuckDB binary. The first fails after the tables are written (as acceptance 4 of tests/surface/outcome-ingest.test.ts requires); the other two are refused before any write.
- A file `<tmp>/keep.json` holding `old` and a line feed, and `--duckdb <tmp>/missing-duckdb.exe --summary <tmp>/keep.json`: exit 2, and the file still holds `old` and a line feed.
- `--summary <state>/summary.json`: exit 1, stderr matches `/refusing to write/`, and neither `<state>/summary.json` nor `<out>/cards.jsonl` exists.
- Working directory a new directory from `tmpDir` outside any repository, with `GIT_CEILING_DIRECTORIES` set to its parent and `--summary <tmp>/s.json`: exit 1, stderr matches `/outcome: --summary: git rev-parse in /`, and neither `<tmp>/s.json` nor `<out>/cards.jsonl` exists.
