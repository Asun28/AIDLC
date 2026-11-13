---
id: T1-DOD-RECORD
title: A successful card attempt runs the card's dod_command in the card worktree through the DoD call of the mutant sweep and records commit, clean, exit or timeout, expected exit, duration, output sha256 and output tail on the attempt; the record changes no state and card status shows it
status: todo
branch: T1-DOD-RECORD
worktree: D:\wt\AIDLC\T1-DOD-RECORD
plan_ref: plans/loop-evidence.md#order-of-work
allow_paths:
  - src/review/mutants.ts
  - src/loop/card-runner.ts
  - src/core/types.ts
  - src/cli/main.ts
  - tests/scenarios/dod-record.test.ts
dod_command: npm run typecheck && node --test tests/scenarios/dod-record.test.ts tests/surface/mutants.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/dirty-success.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/fault-points.test.ts tests/core/types.test.ts tests/surface/test-temp.test.ts
dod_exit: 0
requirements:
  - R1. src/review/mutants.ts shall export `dodCall(card, worktree, timeoutMs)`, which returns `[card.dod_command, [], { cwd: worktree, shell: true, timeoutMs }]`, and `runMutants` shall run each DoD as `deps.dod(...dodCall(card, worktree, timeoutMs))` in place of the call at mutants.ts:179 at 5b9fa3fc, with the same arguments and options as before.
  - R2. WHEN `recordAttempt` (src/loop/card-runner.ts) records `--outcome success` and every existing refusal has passed (after the DoD receipt check at :1161, before the save at :1166, at 5b9fa3fc), it shall run the card's DoD once, if the run names a worktree that is a directory (`pathKind` gives `directory`), as `this.runner(command, args, { ...options, killTree: true })` with `[command, args, options]` from `dodCall(card, run.worktree, timeoutMs)`. `timeoutMs` is the new exported constant `LOOP_DOD_TIMEOUT_MS = 540_000` (9 minutes, so the attempt fits in one 10-minute shell call of the worker) unless the new optional dependency `dodTimeoutMs` of `CardRunnerDeps` gives another value. The command inherits the environment of the aidlc process, and no card-run lock is held while it runs.
  - R3. The attempt this call finishes shall carry the new optional field `loopDod` of `Attempt` (zod schema `LoopDod` in src/core/types.ts) with `ran: true` and `command` (the card's dod_command), `worktree`, `commit` and `clean` (the sha and `!dirty` of the candidate probe of the same call, card-runner.ts:1137; both absent when no probe read them, on the dry-run ship path or after a probe that threw), `exitCode` (the receipt's; null when the receipt has none and when `timedOut` is true), `timedOut`, `expectedExit` (`card.dod_exit`), `timeoutMs`, `durationMs` (the receipt's), `outputSha256` (sha256 of the UTF-8 bytes of stdout, one 0x00 byte, then stderr, the digest exec.ts gives every receipt, computed from stdout and stderr) and `outputTail` (the last 4096 bytes of the UTF-8 bytes of stdout followed by stderr, decoded as UTF-8, so a character cut at the start becomes U+FFFD).
  - R4. WHEN the run names no worktree, or nothing or no directory is at its path, THEN the attempt shall carry `loopDod` `{ ran: false, command, reason: 'no-worktree' }` or `{ ran: false, command, reason: 'no-directory', worktree }`, and no command shall be run for it.
  - R5. IF the DoD does not end within `timeoutMs`, THEN it shall be ended by the existing tree kill and nothing else (runSync with `killTree` runs it under src/probes/exec-tree-helper.ts, which calls `run`, the runner of the sweep, and `run` calls `killProcessTree`, exec.ts:251-280 at 5b9fa3fc, at the timeout), and the record shall hold `timedOut: true` and `exitCode: null` (the receipt of a timed-out command can carry the exit code the tree kill left, as on Windows; the record replaces it). When that tree kill succeeds, no process of the DoD shall remain; when taskkill or ps fails, `killProcessTree` ends the root alone (exec.ts:255, :258-268), unchanged by this card.
  - R6. The record shall change no card state, attempt outcome, episode terminal, allowance, receipt or candidate. The worker's `--dod-receipt` stays required; the refusals keep their order, so a refused success (a dirty worktree, a missing receipt, a mutant marker) runs no DoD and records no attempt and no DoD record; the delivery of previously owed journal events by `deliverOwed` (card-runner.ts:1114, before the dirty and receipt refusals) is unchanged; the record adds no store write, journal append or owed event and rides on the one existing save.
  - R7. `aidlc card status <card>` shall print, in its text output, the line of acceptance detail 1 directly after the `lease=` line (src/cli/main.ts:746 at 5b9fa3fc), for the last attempt that carries `loopDod`, and `loopDod=-` when no attempt does; the `--json` output carries the record inside `effort.attempts` as it prints the run today.
  - R8. A card-run record written before this card, whose attempts carry no `loopDod`, shall parse and keep its state as before, and `card status` shall print `loopDod=-` for it.
acceptance:
  - 1. tests/scenarios/dod-record.test.ts "a passing DoD is recorded on the success through the DoD call of the sweep": the record, the one non-git runner call and the status line of acceptance detail 2. Fails on main by assertion (no `loopDod`). [R1] [R2] [R3] [R7] [dod arm 1]
  - 2. Same file, "a failing DoD is recorded and changes nothing else": dod_command `node dod.mjs 3`; `exitCode` 3, `expectedExit` 0; the projection of acceptance detail 2 equals that of the passing run; the status line holds `exit=3 dod_exit=0 DIFFERS`. Fails on main by assertion. [R3] [R6] [R7] [dod arm 1]
  - 3. Same file, "a DoD past the timeout is ended with its process tree": acceptance detail 3. Fails on main by assertion (no record). [R2] [R5] [R6] [dod arm 1]
  - 4. Same file, "a dirty worktree refuses the success before any DoD": `git status` gives ` M src/a.ts`; `recordAttempt` throws the refusal of T0-DIRTY-SUCCESS (`uncommitted or untracked changes`, `nothing was recorded`), the runner saw no command other than git, and the card-run file is byte-identical. Passes on main and with this card. [R6] [dod arm 1]
  - 5. Same file, "a run with no worktree directory records the DoD as not run and starts nothing": three runs whose `worktree` is unset, a path where nothing is, and a path where a file is (the last is probed and binds the scripted HEAD); each success, recorded with `candidateSha`, is recorded (`effort.terminal` `succeeded`), carries the `loopDod` of R4 (`no-worktree`, then `no-directory` twice), and the runner saw no command other than git. Fails on main by assertion. [R4] [R6] [dod arm 1]
  - 6. Same file, "a record written before the card parses and shows loopDod=-": a run set up and recorded as in acceptance 1, its stored file then rewritten with `loopDod` removed from every attempt; `fx.store.getCardRun` parses it with state and terminal unchanged and no `loopDod` key, and `card status` prints the line `loopDod=-`. Fails on main by assertion (no such line). [R7] [R8] [dod arm 1]
  - 7. tests/surface/mutants.test.ts (its :225 pins the sweep's options `{ cwd, shell: true, timeoutMs: 120000 }`), tests/scenarios/mutants-review.test.ts, tests/scenarios/dirty-success.test.ts (its `git status` call counts), tests/scenarios/dod-receipt-required.test.ts, tests/scenarios/fault-points.test.ts (the writes of `card attempt`), tests/core/types.test.ts and tests/surface/test-temp.test.ts pass unchanged. They pass on main and with this card. [R1] [R6] [R8] [dod arm 1]
  - 8. Same file as 1, "commit and clean are absent when no probe of this call read them": two runs set up as in detail 2 with dod_command `node dod.mjs 0` and a prior candidate on the run (`sha` 40 `b`, `dirty: false`), one on the github path whose `git status` exits 128 (the probe throws and the prior candidate is kept, card-runner.ts:1132-1141), one on the dry-run ship path recorded with `candidateSha`; in each the DoD runs (`ran: true`, `exitCode: 0`, one non-git call) and `loopDod` has no `commit` key and no `clean` key. Fails on main by assertion (no record). [R3] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "On main at 5b9fa3fc. `git grep -n dod_command -- src`: a DoD runs only at src/review/mutants.ts:179 (`deps.dod(card.dod_command, [], { cwd: worktree, shell: true, timeoutMs })`) with `dod: run` from src/cli/main.ts:790. `run` (src/probes/exec.ts:289-391) runs through the platform shell (cmd.exe on Windows, /bin/sh elsewhere), passes no env (the caller's is inherited), ends the tree at the timeout with `killProcessTree` (taskkill /T /F on Windows, one ps table read elsewhere) and has no output bound in that call. `recordAttempt` (src/loop/card-runner.ts:1096-1169) is synchronous and `git grep -l 'recordAttempt(' -- tests` lists 48 files, so it cannot await `run`; `runSync` with `killTree` and a timeout (exec.ts:183-188) runs the command under exec-tree-helper.ts, which calls `run` with the 64 MiB output bound, so the loop gets the sweep's process handling synchronously. tests/surface/mutants.test.ts:225 deep-equals the sweep's options, so `dodCall` returns no `killTree` and the loop adds it. tests/scenarios/dirty-success.test.ts:323, :336, :350, :365 and :381 count `git status` calls, so the record takes commit and clean from the existing probe and runs no git command of its own. Write protocol: tests/scenarios/fault-points.test.ts drives `card attempt` (:81, :128) on a run with no worktree directory and compares attempts as `[n, outcome]` (:495); .claude/skills/verify-card-run-writes/SKILL.md covers `CardRunner.recordAttempt`; the record adds no write and moves none, so neither needs a change (the skill's outcome is in sync; its sync commit moves on main, not in this card). A fixture run on the dry-run ship path has no worktree directory, so it records `ran: false` and starts nothing."
forbid:
  - weakening, skipping or deleting a test to go green, or changing an existing test file
  - a card state, attempt outcome, episode terminal, allowance, stop, review or SHIP rule that reads `loopDod`
  - removing or relaxing the `--dod-receipt` requirement, or moving the DoD run before any refusal of `recordAttempt`
  - a second store write, a journal append or an owed event for the record
  - a configuration key, CLI option or environment variable for the DoD timeout
  - a call of `dod_command` whose arguments and options do not come from `dodCall`
  - a git command run for the record
  - editing .claude/skills/verify-card-run-writes/SKILL.md, CHANGELOG.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md, src/probes/exec.ts, src/core/effort.ts or a new file under src
  - in the new test file `Date.now()`, a temporary directory outside the fixture's own (`makeFixture`, `tmpDir`), or a process left running
non_goals:
  - a SHIP gate on the record, and dropping the worker's DoD receipt (a later goal, on this goal's data)
  - CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md, which T1-EVIDENCE-DOCS updates
  - telling the worker that a success now runs the DoD again for up to 9 minutes; the BUILD narration and the aidlc-loop skill are unchanged
  - a dod_command written for one shell; the loop runs it through the platform shell as the sweep does and records the exit that shell gives
  - filtering the environment of the DoD; it inherits the aidlc process environment, as in the sweep
  - whether the DoD changed the worktree (no status is read after the run), and a mutant sweep started on the same worktree while the DoD runs
  - a write by another command while the DoD runs; the save then fails with CARD_RUN_STALE as every snapshot write does, nothing is recorded, and the next success runs the DoD again
  - an injected runner that throws; `runSync` returns a receipt (exit code null) for a spawn error, a helper error and an output over 64 MiB, and a throw propagates with nothing recorded
  - renewing the card lease while the DoD runs (lease TTL 10 minutes); the owner's next claim renews it
  - a `card attempt` process ended while the DoD runs; nothing is recorded, as for any command ended before its write
  - stronger cleanup when taskkill, ps or the tree helper fails; the existing fallback ends the root alone (exec.ts:245-268), and a process that outlives it is not looked for
  - a record on a failed or not-counted attempt, or the record in the journal
hygiene: "Tests first, in two commits. The first adds tests/scenarios/dod-record.test.ts alone. It imports no runtime export this card adds (the status line through the CLI, the timeout as the literal 540000, `dodTimeoutMs` in the deps object, `LoopDod` as a type only), so on main `node --test tests/scenarios/dod-record.test.ts` loads the file (the typecheck fails there, as expected), acceptance 1, 2, 3, 5, 6 and 8 fail by assertion and 4 passes; record that run. The second adds the code. Before the first review run once every test file that calls `recordAttempt` (`git grep -l 'recordAttempt(' -- tests`) and record the counts, since each success there now passes the DoD step. Revert table, each row a scratch change restored afterwards: the DoD run moved above the dirty refusal (4 red); `killTree` dropped (3 red, a pid alive); the timed-out exit code kept (3 red where the tree kill leaves one, as on Windows); the tail cut in UTF-16 units (1 red); stderr before stdout in the digest (1 red); `existsSync` in place of `pathKind` (5 red); commit and clean taken from the bound candidate (8 red); the status line dropped (1, 2 and 6 red)."
doc_sync: none in this card; T1-EVIDENCE-DOCS updates CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md
---

# T1-DOD-RECORD

## Deliverable
`aidlc card attempt <card> --outcome success` runs the card's `dod_command` in the card worktree, as the mutant sweep runs it, and stores on the attempt the commit, whether the worktree was clean, the exit code or a timeout, the expected exit, the duration, the output sha256 and the last 4 KB of output. Nothing reads the record to decide anything in this goal; `aidlc card status` prints it and says when the exit differs from `dod_exit`.

## Why
Audit of 2026-11-13, confirmed by the panel on 2026-11-14: the loop never runs a card's DoD (only the advisory mutant sweep does), and a success needs only the worker's non-blank `--dod-receipt` text (card-runner.ts:1161). Owner decision of 2026-11-14: record only in this goal, so the next goal can measure how often the pasted receipt and the real run disagree before any gate reads it. Spec specs/loop-evidence.md R1 to R3, plan plans/loop-evidence.md, order of work item 1.

Shape. `recordAttempt` is synchronous and the sweep's runner `run` is async, so the shared part is the call (`dodCall`), and the loop runs it with `runSync` and `killTree`, whose helper process runs the same `run`. Because T0-DIRTY-SUCCESS refuses a dirty success before the DoD, a recorded `clean` is `true` or absent, never `false`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/dod-record.test.ts tests/surface/mutants.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/dirty-success.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/fault-points.test.ts tests/core/types.test.ts tests/surface/test-temp.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Acceptance detail

### 1. The status line
For a record with `ran: true`, one line:

`loopDod=attempt <n> exit=<e> dod_exit=<x> <verdict> timedOut=<t> commit=<c> clean=<k> durationMs=<d> sha256=<h>`

`<n>` is the attempt's `n`; `<e>` is `exitCode`, or `none` when it is null; `<x>` is `expectedExit`; `<verdict>` is `matches` when `timedOut` is false and `exitCode` equals `expectedExit`, else `DIFFERS`; `<t>` is `true` or `false`; `<c>` is `commit`, or `-`; `<k>` is `true`, `false`, or `-`; `<d>` is `durationMs`; `<h>` is `outputSha256`. For `ran: false` the line is `loopDod=attempt <n> not run: no-worktree` or `loopDod=attempt <n> not run: no-directory <worktree>`. With no record on any attempt it is `loopDod=-`.

### 2. The fixture and the passing record
`makeFixture`, the card written with `writeCard` and the given dod_command, driven to BUILD by `fx.runner()`; the worktree directory is made, and a `CardRunner` is built as at tests/scenarios/dirty-success.test.ts:84 (config `shipPath: 'github'`, `repository: 'o/r'`, `DryRunShipPath(['merged'])`) with a runner that records each call, answers git commands from a `scriptedRunner` (`git rev-parse --verify HEAD` gives 40 `c`, `git status --porcelain=v1 --untracked-files=all` gives empty output) and passes every non-git command to the real `runSync`. The test writes `dod.mjs` into the worktree: it writes `é` and then 4091 `x` to stdout, `tail` to stderr, and sets `process.exitCode` to `Number(process.argv[2])`. The success is recorded with `dodReceipt` and `redReceipt`.

With dod_command `node dod.mjs 0` the attempt's `loopDod` is `ran: true`, `command: 'node dod.mjs 0'`, `worktree` the run's, `commit` 40 `c`, `clean: true`, `exitCode: 0`, `timedOut: false`, `expectedExit: 0`, `timeoutMs: 540000`, an integer `durationMs`, `outputSha256` the sha256 of the UTF-8 bytes of `é` and 4091 `x`, one 0x00 byte and `tail`, and `outputTail` U+FFFD, 4091 `x` and `tail` (the output is 4097 bytes; the last 4096 begin inside `é`). The one non-git call deep-equals `['node dod.mjs 0', [], { cwd: <worktree>, shell: true, timeoutMs: 540000, killTree: true }]`. `card status <card> --goal <id>`, run as at tests/scenarios/card-terminal-goal.test.ts:19 without `--json`, prints a line that begins `loopDod=attempt 1 exit=0 dod_exit=0 matches timedOut=false commit=` and matches the form of detail 1. The projection compared in acceptance 2 is `[state, effort.terminal, attempts as [n, outcome], dodReceipt, candidate]`.

### 3. The timeout
dod_command `node "<absolute path of tests/infra/exec-tree.child.ts>" stay tree.pid` (its root writes `tree.pid.root`, starts a sleeper through a shell that writes `tree.pid`, and sleeps 60 s) and `dodTimeoutMs: 10000`. After `recordAttempt` returns: `timedOut: true`, `exitCode: null`, `durationMs` at least 10000, and the success recorded as in detail 2 (`effort.terminal` `succeeded`, the `dodReceipt` kept). Both pid files in the worktree hold a pid, and for each, `process.kill(pid, 0)` polled every 50 ms, at most 200 times, ends with ESRCH. Cleanup ends both pids by pid (SIGKILL, errors ignored).
