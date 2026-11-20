---
id: T1-TEST-CLI-INPROC
title: A test helper runs main of src/cli/main.ts in the test process and returns the exit code, stdout and stderr that bin/aidlc.js returns, restoring cwd, env, exit and the streams after each call
status: todo
superseded_by: T1-TEST-CLI-INPROC-2
branch: T1-TEST-CLI-INPROC
worktree: D:\wt\AIDLC\T1-TEST-CLI-INPROC
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - tests/infra/cli-inprocess.ts
  - tests/infra/cli-inprocess.test.ts
  - changelog.d/T1-TEST-CLI-INPROC.md
  - specs/tasks/T1-TEST-CLI-INPROC.md
dod_command: npm run typecheck && node --test tests/infra/cli-inprocess.test.ts
dod_exit: 0
requirements:
  - R1. `tests/infra/cli-inprocess.ts` shall export `runCliInProcess(argv, { cwd, env?, input? })` returning `Promise<{ status: number; stdout: string; stderr: string }>`; it shall run `main(['node', 'aidlc', ...argv])` of `src/cli/main.ts` in the test process with `cwd` as the working directory and `env` (default `process.env`) as the environment for the call.
  - R2. `status` shall be the code passed to `process.exit`, else `process.exitCode` after `main` settles, else 0; a rejection of `main` shall give status 1 and the stderr line `bin/aidlc.js` prints for it (read the printing in `bin/aidlc.js`, do not restate it from memory).
  - R3. After every call, also one that throws or exits, `process.cwd()`, `process.env`, `process.exitCode`, `process.exit`, `process.stdout.write` and `process.stderr.write` shall be the values they had before the call. A call made while another call runs shall reject with an error naming the helper.
  - R4. The helper shall feed `input` to a command that reads standard input as a child process would read it, or, if `main` reads stdin in a way that cannot be fed in-process, reject when `input` is given with an error saying the case must stay a child process.
acceptance:
  - 1. `tests/infra/cli-inprocess.test.ts` (new), "T1-TEST-CLI-INPROC acceptance 1: in-process and bin/aidlc.js give the same status, stdout and stderr" over at least five calls in a temp git repository and temp `AIDLC_STATE_DIR`: `--help`, an unknown command, `cards validate` (exit 0), a command refusal that exits 1, and a command whose action throws. Fails on main (the helper does not exist). [R1] [R2] [dod arm 1]
  - 2. Same file, "T1-TEST-CLI-INPROC acceptance 2: cwd, env, exitCode, exit and the streams are restored after a passing, an exiting and a throwing call". [R3] [dod arm 1]
  - 3. Same file, "T1-TEST-CLI-INPROC acceptance 3: a nested call rejects naming the helper". [R3] [dod arm 1]
  - 4. Same file, "T1-TEST-CLI-INPROC acceptance 4: input" shows R4 either way (fed and equal to the child, or rejected with the stay-a-child message). [R4] [dod arm 1]
depends_on: []
budget: 90
tdd: true
forbid:
  - a change under src/ or bin/
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
non_goals: [converting any existing test file (T1-TEST-INPROC-A, T1-TEST-INPROC-B), running `watch` in-process]
hygiene: "Changelog entry in changelog.d/T1-TEST-CLI-INPROC.md (form: changelog.d/README.md)."
---

# T1-TEST-CLI-INPROC

## Deliverable
Tests can run a CLI command in-process and get the same result as through `bin/aidlc.js`, without leaking process state.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/cli-inprocess.test.ts
```
- Expected exit code: 0
- Assertion: the four acceptance tests pass; they fail on main because the helper does not exist.
