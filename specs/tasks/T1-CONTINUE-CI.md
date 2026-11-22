---
id: T1-CONTINUE-CI
title: "`aidlc card continue` returns a run stopped for ci to BUILD on the same card with a counted repair attempt, and its goal is re-admitted"
status: todo
branch: T1-CONTINUE-CI
worktree: D:\wt\AIDLC\T1-CONTINUE-CI
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/core/continuation.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/core/continuation.test.ts
  - tests/scenarios/card-continue-ci.test.ts
  - tests/scenarios/card-continue.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CONTINUE-CI.md
  - specs/tasks/T1-CONTINUE-CI.md
dod_command: npm run typecheck && node --test tests/core/continuation.test.ts tests/scenarios/card-continue-ci.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-command.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. WHEN `CardRunner.continueStop` is called on a run in STOP with stop reason `ci`, the runner shall, in one locked update, apply `afterShipFailure` to the run's effort episode with the cause `continuation by <by>: <reason>`, and write the episode it returns, state BUILD, no `stop`, no `blocker`, no `dodReceipt`, no `blockedReceipt` and a continuation with stop reason `ci` and neither `decisions` nor `admits`.
  - R2. The update shall leave `ci`, `review`, `findings`, `candidate`, `redReceipt` and `deadline` as they were.
  - R3. IF the run has no effort episode, the step `afterShipFailure` returns is a stop, `decisions` is given, or `by` or `reason` is blank after trimming, THEN the runner shall throw with the cause, the ladder's reason included where it has one, and write nothing.
  - R4. The update shall owe, beside the `CARD_STATE` event of the continuation, the `ATTEMPT_FINISHED` event of the refuted success (`outcome` `fail`, the cause, `refutedBy` `continuation`) and, when the step promoted a running repair, its `ATTEMPT_STARTED`, with the data a refuted ship journals for them.
  - R6. The description of `aidlc card continue` shall name both stop reasons, and its JSON output and its human line for a continuation of a ci stop shall hold the run's state, the whole continuation with no `decisions` and no `admits`, whether this call recorded it, whether the goal was re-admitted and the next command.
  - R5. The command's paragraph of `docs/OPERATIONS.md` shall state R1 to R4 and R6 and say that this is the way back to BUILD that issue 326 asks for; the STOP reasons row `ci` of that file names `aidlc card continue`; `docs/ARCHITECTURE.md` names the ci branch of `CardRunner.continueStop` and what it writes; `changelog.d/T1-CONTINUE-CI.md` says in one entry what the command does for a ci stop and when it refuses.
acceptance:
  - 1. `tests/scenarios/card-continue-ci.test.ts`, a one-card goal whose ship ended with an unclassified CI failure, so the run is in STOP for `ci` and `aidlc next` stopped the goal for `ci`. `aidlc card continue --by <who> --reason <text>` exits 0: the run is in BUILD, the success that bound the candidate is a failed attempt with the cause of R1, the run holds no DoD receipt and one continuation with stop reason `ci`; `ci`, `review`, `findings`, `candidate`, `redReceipt` and `deadline` are deep-equal to their values before; the goal is in CARDS with one `GOAL_STATE` event that carries `continuation`. [R1] [R2] [dod arm 2]
  - 2. Same file. `aidlc card next` returns a `build` directive that names the attempt number the ladder gives; after a recorded repair attempt with a new candidate `aidlc card next` returns a `review` directive; `aidlc audit verify` then reports no `WORK_AFTER_TERMINAL`. [R1] [dod arm 2]
  - 3. Same file. A second unclassified CI failure, of the repaired candidate, stops the run for `ci` again, and `ci.reruns` holds every entry it held before the continuation. [R2] [dod arm 2]
  - 4. Same file. Each refusal names its cause and leaves the card-run file, the goal file and the journal byte-identical: a run whose ladder admits no further attempt (the message holds the ladder's reason), `--decisions 1` on a ci stop, a run with no effort episode. [R3] [dod arm 2]
  - 5. Same file. The journal gains exactly one `CARD_STATE` event with `continuation` whose stop reason is `ci` and one `ATTEMPT_FINISHED` with `refutedBy` `continuation`. Fault rows: a throw from `fs.renameSync` onto the card-run record leaves the card-run file and the journal byte-identical; a throw from `fs.appendFileSync` onto the goal journal leaves the continuation in the run, and after one `aidlc card next` the journal holds each owed event exactly once. [R4] [dod arm 2]
  - 6. `tests/core/continuation.test.ts` holds the rows of the ci rule (the patch of R1 and each refusal of R3) beside the rows of T1-CONTINUE-CORE, which pass unchanged except the row that expected a refusal for stop reason `ci`. `tests/scenarios/card-continue.test.ts` passes and changes only its row that expected a run stopped for `ci` to be refused. `tests/scenarios/card-continue-goal.test.ts`, `ci-rerun.test.ts` and `fault-points.test.ts` pass with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 7. Each of the four texts holds what R5 assigns to it and no more is required of it (reviewer-verified against the diff). [R5]
  - 8. `tests/scenarios/card-continue-ci.test.ts`. For the continuation of acceptance 1 the JSON output and the human line (`--no-json`) each hold the state BUILD, the continuation's `at`, `by`, `reason` and lifted stop with reason `ci`, `continued` true, `readmitted` true and `aidlc card next <card>`; neither holds `decisions`, `admits` or the word `undefined`; `aidlc card continue --help` names `review` and `ci`. `tests/scenarios/card-continue-command.test.ts` passes with no line changed. [R6] [dod arm 2]
depends_on: [T1-CONTINUE-COMMAND]
budget: 250
sweep: "Line numbers of src/loop/card-runner.ts are from main at f51534d2 and have moved; find each site again at PREPARE. src/cli/main.ts:752-768 on main at 804f26f0 is the command line of T1-CONTINUE-COMMAND: its description names review only, and its human line prints `decisions` and `admits`, which a continuation of a ci stop does not hold. src/loop/card-runner.ts:3238-3255 makes the ci stop; :3167-3172 (`refutePatch`) and :3173-3184 (`refuteDirective`) are what a CI code defect does and journals, inside the closure of `applyShipResult`; :1404 (`withdrawCandidate`) is the other caller of `afterShipFailure` outside a ship. src/core/effort.ts:150 defines `afterShipFailure`. `CardRunner.continueStop` and `src/core/continuation.ts` come from T1-CONTINUE-REVIEW-2 and T1-CONTINUE-CORE and are read again at PREPARE. The goal re-admission of T1-CONTINUE-GOAL-2 and the audit rule of T1-CONTINUE-AUDIT already take the stop reason `ci`, and the command line is T1-CONTINUE-COMMAND's."
forbid: [weakening or skipping a test to go green, removing or changing an entry of `ci.reruns`, a rerun of the stopped candidate's CI, lifting a `risk` stop, moving a deadline, a change to tests/scenarios/fault-points.test.ts, editing .aidlc state by hand]
non_goals: [a ci stop of class `security` (it is a `risk` stop and stays), a continuation that ships the unchanged candidate again, a change to `card ci-reconcile` or to the CI classifier, a ci continuation among the commands tests/scenarios/fault-points.test.ts drives]
hygiene: "A requirement on the command's output covers the human line and the JSON output, each asserted by value (docs/LESSONS.md, T1-CONTINUE-COMMAND). A refusal is decided before the runner's write; a failure after it is not undone (docs/LESSONS.md, T1-CONTINUE-GOAL-2). Read the lines again at PREPARE. `limitsPermit` is `checkAdmission(run.deadline, now).phase === 'open'`, as in `refutePatch`. This card changes a file the verify-card-run-writes coverage record names, so that skill runs before SHIP and at CLOSE; the record already names `CardRunner.continueStop`. The DoD runs the loop benchmark after the build. Run every test file that reads docs/OPERATIONS.md or docs/ARCHITECTURE.md before the attempt is recorded."
doc_sync: docs/OPERATIONS.md (the command, STOP reasons), docs/ARCHITECTURE.md
---

# T1-CONTINUE-CI

## Deliverable
A run stopped for `ci` goes back to BUILD on the same card by the owner's recorded act, with the diagnosed failure counted as a failed attempt.

## Why
`specs/card-continuation.md`, R8 and R9, and issue 326: once a person has diagnosed an unclassified CI failure, the only way on today is a successor card, with a new card file, repointed `depends_on` and a commit on main.

## Rules that decide edge cases
- The act does what a CI failure of class `code-defect` does to the run, and nothing to the CI ledger.
- When the ladder admits no repair attempt the act refuses. It makes no `card` stop.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/continuation.test.ts tests/scenarios/card-continue-ci.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-command.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the seven files passes, the build succeeds and every benchmark count is within its ceiling.

## Attempt evidence
RED db1b0d11 (tests alone): `card-continue-ci.test.ts` "acceptance 1, 2, 3 and 5: card continue on a ci stop ..." failed with `the stop reason ci is not review`; the ci rows of `continuation.test.ts` failed with `continueCiStop is not a function`.

| Item | Evidence |
|---|---|
| 1 | card-continue-ci test 1: BUILD, attempt 1 `fail` with `continuation by the owner: diagnosed: a fixture leak`, no stop/blocker/receipts, one ci continuation, R2 fields deep-equal, goal CARDS, one `GOAL_STATE` with `continuation` |
| 2 | test 1: CLI `card next` gives `build` attempt 2; after the repair (sha-2) CLI `card next` gives `review`; `audit verify` has no `WORK_AFTER_TERMINAL` |
| 3 | test 1: second unclassified failure of sha-2 stops for ci; `ci.reruns` starts with the one entry held before |
| 4 | test 2 (CLI): same-cause ladder stop, escalation past the deadline, `--decisions 1`, no effort episode; exit 1, cause matched, three files byte-identical |
| 5 | test 1: exact `CARD_STATE` and `ATTEMPT_FINISHED` data, one each; test 3: rename fault leaves bytes, append fault keeps the continuation and one `card next` appends each event once |
| 6 | continuation.test.ts: 8 ci rows; card-continue.test.ts changed only its ci row (now a ci stop with no effort episode, refused); continueReviewStop's ci row unchanged (that rule still refuses ci); other files unchanged |
| 7 | OPERATIONS.md Continuations paragraph and STOP row `ci`, ARCHITECTURE.md `continueStop` bullet, changelog.d/T1-CONTINUE-CI.md |
| 8 | test 5: JSON and `--no-json` fields by value, no `decisions`/`admits`/`undefined`; `--help` names review and ci |

Guard sweep (each loosened, its file run, a test failed, restored): ci dispatch always (card-continue.test.ts acc 1); state/stop, reason ci, blank by, blank reason removed (continuation.test.ts); decisions, no effort, ladder stop removed and limitsPermit true (card-continue-ci acc 4); limitsPermit false and refuted always (card-continue-ci guard rows); promoted always (card-continue-ci acc 1). Equivalent: dropping `state === 'STOP'` from the runner's dispatch, since both rules refuse a run out of STOP with the same message.
