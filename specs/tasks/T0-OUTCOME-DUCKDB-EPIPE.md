---
id: T0-OUTCOME-DUCKDB-EPIPE
title: "bench/outcome/run.ts reports that the DuckDB binary cannot be started only when no process started; a binary that exited before its input was written is a failed query with its exit code"
status: todo
branch: T0-OUTCOME-DUCKDB-EPIPE
worktree: D:\wt\AIDLC\T0-OUTCOME-DUCKDB-EPIPE
allow_paths:
  - bench/outcome/duckdb.ts
  - bench/outcome/run.ts
  - bench/outcome/README.md
  - tests/surface/outcome-duckdb.test.ts
  - changelog.d/T0-OUTCOME-DUCKDB-EPIPE.md
  - specs/tasks/T0-OUTCOME-DUCKDB-EPIPE.md
dod_command: npm run typecheck && node --test tests/surface/outcome-duckdb.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-summary.test.ts tests/surface/outcome-github.test.ts tests/surface/outcome-baseline.test.ts tests/surface/outcome-usage.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `bench/outcome/duckdb.ts`, a new file, shall export the class `NoDuckdb` and `queryDuckdb(bin, cwd, sql, label, spawn)`, which runs `<bin> -json -bail` in `cwd` with `sql` on standard input through `spawn` (default `spawnSync`), with `encoding: 'utf8'`, `windowsHide: true` and a `maxBuffer` of 256 MiB as the call in `run.ts` has today, and returns the rows of the JSON array on standard output, none when that output is empty or white space.
  - R2. `queryDuckdb` shall throw `NoDuckdb`, with the message of the spawn error, only when `spawn` returns an error with no exit code and no signal, which is a process that did not start.
  - R3. For every other failure (an error, or an exit code other than 0) `queryDuckdb` shall throw an `Error` that is not `NoDuckdb`, with the message `<bin> failed on "<label>" (exit <status>): <detail>`. For a process that exited on its own (a status that is not null) the detail is its stderr, trimmed, then the message of the error when there is one, joined by `; ` with an empty part left out. For a status of null it is the message of the error, else the stderr, trimmed, as today.
  - R4. `bench/outcome/run.ts` shall run each query through `queryDuckdb` and keep its exit codes, 2 with the install hint on `NoDuckdb` and 1 on any other error.
  - R5. `bench/outcome/README.md`, after its sentence on the exit codes, and `changelog.d/T0-OUTCOME-DUCKDB-EPIPE.md` shall state that a binary that started and exited, also before its input was written, is exit 1 with its exit code.
acceptance:
  - 1. `tests/surface/outcome-duckdb.test.ts`, real process. With the node binary as `bin` (it rejects `-json` and exits 9 without reading its input) and an input of 1 MiB, `queryDuckdb` throws an error that is not `NoDuckdb`; its message is `<bin> failed on "<label>" (exit 9): `, then a text that holds `bad option: -json`, then `; spawnSync <bin> EPIPE` or `; spawnSync <bin> EOF` at its end. RED on the rule of main (`r.error && r.signal === null`), under which this call throws `NoDuckdb`. [R2] [R3] [dod arm 2]
  - 2. Same file, real process. A path that names no file throws `NoDuckdb` whose message holds `ENOENT`. The node binary with a one-line input throws an error that is not `NoDuckdb`, whose message begins `<bin> failed on "<label>" (exit 9): ` and holds `bad option: -json`, whichever of its exit and the write of the input came first. [R2] [R3] [dod arm 2]
  - 3. Same file, a scripted `spawn`. It receives `bin`, `-json` and `-bail`, and the options of R1 with `cwd` and `sql`. A JSON array on standard output returns its rows; an empty output and one of white space return none. An error with status 9 gives the message of R3 with both parts, and with an empty stderr the error part alone. An error with no status and no signal throws `NoDuckdb`. An error with no status and the signal `SIGTERM` is not `NoDuckdb` and carries the message of the error. Status 1 without an error carries the stderr, trimmed. [R1] [R2] [R3] [dod arm 2]
  - 4. The tests that start `run.ts` pass with no change: acceptance 4 (a missing binary: exit 2 and the install hint) and acceptance 10 (the node binary: exit 1, no install hint) of `tests/surface/outcome-ingest.test.ts`, and `outcome-summary`, `outcome-github`, `outcome-baseline` and `outcome-usage`. [R4] [dod arms 3, 4, 5, 6, 7]
  - 5. The README sentence and the fragment say what R5 says (reviewer-verified against the diff); the fragment has the form of `changelog.d/README.md` and the prose test passes. [R5] [dod arms 8, 9]
depends_on: []
budget: 150
tdd: true
sweep: "On main at a72f2ff8. `git grep -n -E 'NoDuckdb|cannot be started|winget' -- bench tests docs README.md`: the class and the two messages stand in `bench/outcome/run.ts` (lines 26, 27, 82, 83, 102, 103) and nowhere else in code; `bench/outcome/README.md:24` states the exit codes; `winget install` is asserted in tests/surface/outcome-ingest.test.ts (acceptance 4 and 10) and tests/surface/outcome-summary.test.ts. `git grep -l 'outcome/run.ts' -- tests docs`: the tests that start `run.ts` are outcome-ingest, outcome-summary, outcome-github, outcome-baseline and outcome-usage, all in the DoD; docs/reliability/baseline.md names the command and no exit code."
forbid: [a change to an existing test file, a change under src/, a change to the views or to another file under bench/]
non_goals:
  - "`bench/journeys.ts:121`, which throws any spawn error of a journey and names no missing binary"
  - a timeout on the DuckDB process
  - an early exit made on purpose in acceptance 10 of tests/surface/outcome-ingest.test.ts; with the 23 KB input of `run.ts` the order of the exit and the write is the scheduler's, and the test passes in both orders once R2 holds
diagnosis:
  root_cause: "`bench/outcome/run.ts:82` reads every `spawnSync` error without a signal as a binary that did not start. An error beside an exit code is a binary that started: `spawnSync` reports `EPIPE` (`EOF` on Windows) when the child exits before the parent has written its input. The node binary that acceptance 10 of outcome-ingest.test.ts uses in place of DuckDB exits 9 without reading. With the 23 KB input of `run.ts` the write usually completes first; in CI run 45090049641 (PR 434) the exit came first, `run.ts` exited 2 with the install hint, and the test, which expects exit 1, failed. Reproduced on Windows with a 1 MiB input, 2 of 2: `error EOF, status 9, signal null`; 200 runs with a 23 KB input gave no error; a missing binary gives `ENOENT` with status null."
  same_class: "`git grep -n 'spawnSync(' -- bench src` finds four other calls. `bench/journeys.ts:119` passes an input and throws any spawn error at line 121, with no claim that a binary is missing (non_goals). `src/cli/main.ts:963` and `src/state/paths.ts:40` pass no input. `src/probes/exec.ts` reports a spawn error as `[spawn error]` in the receipt and names no missing binary."
hygiene: "Issue 435, found by the first CI run of PR 434 (card T0-CARD-PHASE-DOC). The 1 MiB input of acceptance 1 is larger than a pipe buffer, so the child's exit always comes before the end of the write: the RED does not depend on scheduling. Acceptance 3 covers the outcomes no real process gives on demand (a signal, a parsed result without a DuckDB binary)."
doc_sync: changelog.d/T0-OUTCOME-DUCKDB-EPIPE.md
---

# T0-OUTCOME-DUCKDB-EPIPE

From issue 435.

## Diagnosis
`run.ts` exits 2 with "the DuckDB binary cannot be started" and the install hint for any `spawnSync` error without a signal. `EPIPE` is such an error and means the opposite: the binary started and exited before its input was written. The test that uses node in place of DuckDB hits it when the exit comes before the write, which depends on scheduling, so CI fails on it now and then.

## Deliverable
The DuckDB call moves to `queryDuckdb` in `bench/outcome/duckdb.ts`, where a test can give it an input large enough to make the early exit certain. It reports a missing binary only when no process started, and a process that exited on its own as a failed query with its exit code, its stderr and the error of the write.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-duckdb.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-summary.test.ts tests/surface/outcome-github.test.ts tests/surface/outcome-baseline.test.ts tests/surface/outcome-usage.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the tests of the new file pass, the tests that start `run.ts` pass unchanged, and the changelog fragment is well formed.
