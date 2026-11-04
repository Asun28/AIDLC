---
id: T0-SHIP-THROW-SLOT-2
title: A ship that throws any value frees its review slot and leaves its operation UNKNOWN, and an unreadable check-run read is a pending read of the CI gate
status: todo
branch: T0-SHIP-THROW-SLOT-2
worktree: D:\wt\AIDLC\T0-SHIP-THROW-SLOT-2
allow_paths:
  - src/delivery/github-ship.ts
  - src/delivery/ship.ts
  - src/loop/card-runner.ts
  - tests/infra/github-ship.test.ts
  - tests/scenarios/ship-throw.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-THROW-SLOT-2.md
dod_command: npm run typecheck && node --test tests/scenarios/ship-throw.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/two-windows.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `this.gh.checkRuns` throws any value in the CI gate of `GitHubShipPath.ship`, the gate shall count the read as pending: it logs a `[CI-GATE-WAIT]` line naming the unreadable read with its text encoded by `encodeUntrusted`, waits the poll interval and reads again, and at the gate's deadline returns `[CI-GATE-TIMEOUT]` as a pending gate does. `checkRuns` itself and the handling of a read that returns stay as they are.
  - R2. WHEN `this.shipPath.ship` throws any value in `CardRunner.ship`, `CardRunner.ship` shall record on the card run, in `journalOwed`, an owed `OPERATION_RESULT` naming the operation with status `UNKNOWN` and outcome `ship-threw`, mark the merge operation `UNKNOWN` with `ship threw: <text>`, cancel the review request of that ship with the same text, which frees its pool slot, append the owed event as R2 of T0-JOURNAL-FAULT-EVENTS does, and rethrow the value it caught. Each of those steps runs whatever the others do, a failed step never replaces the thrown value, and when the record write failed the event is appended directly. A ship that returns is handled as before.
  - R3. `thrownText(thrown)` (`src/delivery/ship.ts`) shall return a primitive string for any value and shall never throw: the message of an `Error`, the string form of any other value, and a fixed text when reading either throws, as it does for a revoked proxy, an `Error` whose `message` getter throws, and a value with no string form.
  - R4. `docs/OPERATIONS.md`, at the end of the `aidlc review status` bullet of Sessions, shall carry the OPERATIONS sentence of the Doc text section.
  - R5. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/infra/github-ship.test.ts`: the check-runs read fails with exit 1 once and then returns green: the ship merges, it slept once, and its output holds one `[CI-GATE-WAIT]` line naming the unreadable read. [R1] [dod arm 2]
  - 2. Same file: the check-runs read always fails, with a zero CI timeout: the ship returns outcome `ci-timeout` with `[CI-GATE-TIMEOUT]`, runs no `gh pr merge` and does not throw. [R1] [dod arm 2]
  - 3. `tests/scenarios/ship-throw.test.ts`: a ship path whose `ship` throws at SHIP: `card next` throws that same error, the operation is `UNKNOWN` with an error starting `ship threw: `, the review request is `cancelled`, `pool.active` is empty, the goal journal holds one `OPERATION_RESULT` with status `UNKNOWN` and outcome `ship-threw`, and a request of another card is then admitted. [R2] [dod arm 2]
  - 4. Same file: after that throw `card next` returns `wait` and dispatches no ship; once the operation is reconciled `failed`, `card next` dispatches the ship once more, under a new request and operation, and a ship that returns merged takes the card to CLOSE. [R2] [dod arm 2]
  - 5. Same file: a ship that throws `null`, a string, a value with no string form, a revoked proxy and an `Error` whose `message` getter throws: `card next` rethrows that same value, the operation's error is `ship threw: <the value's text>`, and the slot is free. [R2] [R3] [dod arm 2]
  - 6. `tests/infra/github-ship.test.ts`: a check-run read that throws each of those five values once is a pending read and the ship merges after it; one that always throws a revoked proxy ends in `ci-timeout`. [R1] [R3] [dod arm 2]
  - 7. `tests/scenarios/ship-throw.test.ts`: with the ledger write failing, the slot is free, the value rethrown and the owed event still on the run; with the request cancel failing, the operation is `UNKNOWN`, the event journaled and the value rethrown; with the record write failing, the operation is `UNKNOWN`, the slot free, the event journaled once and the value rethrown. [R2] [dod arm 2]
  - 8. Same file: with the `OPERATION_RESULT` append failing, the ship's value is rethrown and the event stays owed; the next `card next` appends it once, marked `completed: true`; and a reconcile that lands first leaves it unappended. [R2] [dod arm 2]
  - 9. Same file: `docs/OPERATIONS.md` holds the OPERATIONS sentence and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R4] [R5] [dod arm 2]
depends_on: []
budget: 260
tdd: true
sweep: "git grep -n 'this.gh\\.' src/delivery/github-ship.ts on main 90b8da5: resolvePr and prMergeState are guarded, login, checkRuns, prView, jobRecord and jobLog are not. R1 covers the poll, the one read a transient outage hits for minutes; R2 is the catch-all for the others, since each runs inside `shipPath.ship`, which has one caller. `git grep -n '(err as Error).message'` in src/delivery/github-ship.ts: the other catches read a `GhProbe` error, which is always an `Error`, and stay."
forbid: [weakening or skipping a test to go green, a change to `GhProbe` or to `src/probes/gh.ts`, a retry of the merge or of any write of the ship, a change to the state a ship that returns leaves, a new journal event type, a change to the order of the ship's writes before the `ship` call, a change to `src/coordination/review-queue.ts` or `src/cli/main.ts` (the release command is card T0-REVIEW-RELEASE), an edit of any file under `.aidlc/`]
non_goals: [`aidlc review release`, which needs one lock over every request and pool mutation (card T0-REVIEW-RELEASE), an expiry for running requests, guarding each other `gh` call of the ship (R2 covers them), a double fault where the record write and the direct append both fail (the ledger still says `UNKNOWN`, and `aidlc ops reconcile` journals the outcome)]
diagnosis:
  root_cause: "`GitHubShipPath.ship` calls `this.gh.checkRuns` unguarded in its CI poll, and `GhProbe.json` throws on a non-zero exit. On 2026-11-04 an HTTP 502 from `gh api .../check-runs` threw out of `shipPath.ship`, which `CardRunner.ship` also does not guard, so the process exited with the merge operation `issued` and the review request `running`. `ReviewQueue.admit` keeps a running request in `pool.active` for ever, and with `maxConcurrent` 1 that stopped every R3 and ship of every session for 9 hours."
  same_class: "See the sweep: every unguarded `gh` call inside `shipPath.ship` has the same effect, and R2 covers them all."
hygiene: "This card replaces T0-SHIP-THROW-SLOT by the user's ruling of 2026-11-05, after R3 decision 2 stopped that card re-raising F1, F2, F3 and F6: the crash fix ships here, with `thrownText` non-throwing across its whole body (F2, F3), and the release command, where F1, F6 and F13 sit, moves to card T0-REVIEW-RELEASE. It ports the settlement of that card's a59721e, whose R3 decision 1 repair of the cleanup and the owed result R3 decision 2 did not re-raise. A throw is UNKNOWN and not `failed`, since `prView` runs after the merge: the outcome is looked up, and `aidlc ops reconcile` records it. Run the verify-card-run-writes check before SHIP (`CardRunner.ship` is covered) and move its sync commit at CLOSE. Every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8); the doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
superseded_by: T0-SHIP-THROW-SLOT-3
---

# T0-SHIP-THROW-SLOT-2

## Deliverable
A GitHub outage during a ship no longer stops every review in the repository. An unreadable check-run read is a pending read of the CI gate, and any other throw of a ship frees its slot and leaves the operation UNKNOWN for `aidlc ops reconcile`, whatever value was thrown.

## Doc text
OPERATIONS sentence:

A ship that throws frees its review slot and leaves its merge operation `UNKNOWN`, since a merge may have landed: look the outcome up and record it with `aidlc ops reconcile <opId> --status <s>`, and `card next` ships again.

CHANGELOG entry:

- T0-SHIP-THROW-SLOT-2 (bugfix): a GitHub outage during a ship no longer stops every review in the repository. An unreadable check-run read is now a pending read of the CI gate, retried until the gate's timeout, and any other throw of a ship frees its review slot and leaves its merge operation `UNKNOWN` for `aidlc ops reconcile`. Before, an HTTP 502 from the check-runs read left a `running` request in the pool that no command could clear.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/ship-throw.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/two-windows.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence
- Ported from a59721e of T0-SHIP-THROW-SLOT, whose RED and mutation check are on that branch; the release command and its tests stayed behind. `thrownText` is new: the whole body is inside its `try`.
- RED: commit 33def94 (the tests, the source fix set aside). The tests of `tests/infra/github-ship.test.ts` that exercise the gate fail, and a revoked proxy that reaches node:test unhandled also fails the rest of that file, which is why tests of other cards show as failed in that run; `tests/scenarios/ship-throw.test.ts` fails on every acceptance item it holds.
- GREEN: `node --test tests/scenarios/ship-throw.test.ts tests/infra/github-ship.test.ts`: 68 tests, 68 passed, 0 failed; the typecheck is clean.
- Mutation check, by hand, each restored and none committed; each fails one of the two files: `instanceof` and `message` outside the `try`, `message` not made a string (added case), no catch in `thrownText`, one catch for all the settlement steps, no owed write, no direct append when the record write failed, no cancel, no `UNKNOWN`, the settlement skipped, another value thrown, no wait between unreadable reads, and no deadline on them.

