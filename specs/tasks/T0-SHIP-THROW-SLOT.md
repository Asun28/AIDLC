---
id: T0-SHIP-THROW-SLOT
title: A ship that throws frees its review slot and leaves its operation UNKNOWN, an unreadable check-run read is a pending read of the CI gate, and `aidlc review release` frees the slot of a process that died
status: todo
branch: T0-SHIP-THROW-SLOT
worktree: D:\wt\AIDLC\T0-SHIP-THROW-SLOT
allow_paths:
  - src/delivery/github-ship.ts
  - src/delivery/ship.ts
  - src/loop/card-runner.ts
  - src/coordination/review-queue.ts
  - src/state/store.ts
  - src/cli/main.ts
  - tests/infra/github-ship.test.ts
  - tests/scenarios/ship-throw.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-THROW-SLOT.md
dod_command: npm run typecheck && node --test tests/scenarios/ship-throw.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/infra/review-queue.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/two-windows.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `this.gh.checkRuns` throws any value in the CI gate of `GitHubShipPath.ship`, the gate shall count the read as pending: it logs a `[CI-GATE-WAIT]` line naming the unreadable read with its message encoded by `encodeUntrusted`, waits the poll interval and reads again, and at the gate's deadline returns `[CI-GATE-TIMEOUT]` as a pending gate does. `checkRuns` itself and the handling of a read that returns stay as they are.
  - R2. WHEN `this.shipPath.ship` throws any value in `CardRunner.ship`, `CardRunner.ship` shall record on the card run, in `journalOwed`, an owed `OPERATION_RESULT` naming the operation with status `UNKNOWN` and outcome `ship-threw`, mark the merge operation `UNKNOWN` with `ship threw: <text>`, cancel the review request of that ship with the same text, which frees its pool slot, append the owed event as R2 of T0-JOURNAL-FAULT-EVENTS does, and rethrow the value it caught. Each of those steps runs whatever the others do, a failed step never replaces the thrown value, and when the record write failed the event is appended directly. `<text>` is the message of an `Error` and the string form of any other value, and never itself throws. A ship that returns is handled as before.
  - R3. `ReviewQueue.release(key, reason, now)` shall cancel a request in state `running` whose `slotOwner` names this host and a process that is gone, which frees its slot, and shall throw, writing nothing, for an unknown key, for any other state, for a `slotOwner` of another host or with no usable pid, and for an owner process still alive. The check and the write are one section of the request record's lock (`updateJson`), so a second release that read the request before the first one landed re-reads it and refuses. `ReviewQueue.releasable(key)` makes the same check on the stored request and returns it, writing nothing.
  - R4. `aidlc review release <key> --reason <text>` shall check `releasable`, append, before it frees the slot, a `NOTE` of kind `review-slot-released` with the key, the request's `seq` and the reason to the journal of each goal among the request's requesters that holds no such `NOTE` for that key and `seq`, then call R3 and print the released request. A refusal exits non-zero, and a failed append exits non-zero with the slot still held, so running the command again finishes the release with one `NOTE` per goal.
  - R5. `docs/OPERATIONS.md`, at the end of the `aidlc review status` bullet of Sessions, shall carry the OPERATIONS sentences of the Doc text section.
  - R6. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/infra/github-ship.test.ts`: the check-runs read fails with exit 1 once and then returns green: the ship merges, and its output holds one `[CI-GATE-WAIT]` line naming the unreadable read. At df5f50d the call throws `GhProbeError`. [R1] [dod arm 2]
  - 2. Same file: the check-runs read always fails, with a zero CI timeout: the ship returns outcome `ci-timeout` with `[CI-GATE-TIMEOUT]`, runs no `gh pr merge` and does not throw. [R1] [dod arm 2]
  - 3. `tests/scenarios/ship-throw.test.ts`: a ship path whose `ship` throws at SHIP: `card next` throws that same error, the operation is `UNKNOWN` with an error starting `ship threw: `, the review request is `cancelled`, `pool.active` is empty, the goal journal holds one `OPERATION_RESULT` with status `UNKNOWN` and outcome `ship-threw`, and a request of another card is then admitted. [R2] [dod arm 2]
  - 4. Same file: after that throw `card next` returns `wait` and dispatches no ship; once `aidlc ops reconcile` records the operation `failed`, `card next` dispatches the ship once more, under a new request and operation, and a ship that returns merged takes the card to CLOSE. [R2] [dod arm 2]
  - 5. Same file: `ReviewQueue.release` frees a running request of this host whose owner process is gone (`pool.active` empty, state `cancelled`, the reason as `lastError`); it throws and leaves the request and the pool unchanged for an unknown key, for a `queued`, `completed` or `cancelled` request, for a `slotOwner` naming another host, for a pid that is not a positive integer, and for an owner process that is alive. [R3] [dod arm 2]
  - 6. Same file, by spawning the CLI from the sources: `aidlc review release <key> --reason <text>` on a dead owner exits 0, prints the released request and journals one `review-slot-released` NOTE in the requester goal; on a live owner it exits non-zero and journals nothing. [R4] [dod arm 2]
  - 7. Same file: `docs/OPERATIONS.md` holds the OPERATIONS sentences and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R5] [R6] [dod arm 2]
  - 8. `tests/scenarios/ship-throw.test.ts` and `tests/infra/github-ship.test.ts`: a ship that throws `null`, and one that throws a string: `card next` rethrows that same value, the operation's error is `ship threw: null` and `ship threw: <the string>`, and the slot is free; a check-run read that throws `null` is a pending read. [R1] [R2] [dod arm 2]
  - 9. `tests/scenarios/ship-throw.test.ts`: with the ledger write failing, the slot is free, the value rethrown and the owed event still on the run; with the request cancel failing, the operation is `UNKNOWN`, the event journaled and the value rethrown; with the record write failing, the operation is `UNKNOWN`, the slot free, the event journaled once and the value rethrown. [R2] [dod arm 2]
  - 10. Same file: with the `OPERATION_RESULT` append failing, the ship's value is rethrown and the event stays owed; the next `card next` appends it once, marked `completed: true`; and an `aidlc ops reconcile` that lands first leaves it unappended. [R2] [dod arm 2]
  - 11. Same file: a second `release` of the same key while the first holds its section refuses with `LOCKED`; after a first release frees a dead owner and the same key is admitted for a live owner, a second release refuses and the request stays `running`. By the CLI: a request of two goals whose second journal cannot be written exits non-zero with the slot held and one NOTE, and the same command run again, with the journal writable, exits 0 with one NOTE per goal and the slot free. [R3] [R4] [dod arm 2]
depends_on: []
budget: 260
tdd: true
sweep: "git grep -n 'this.gh\\.' src/delivery/github-ship.ts on main 34c8363: resolvePr (:288) and prMergeState (:389) are guarded, login (:259), checkRuns (:333), prView (:371), jobRecord and jobLog (:551, :552) are not. R1 covers the poll, the one read a transient outage hits for minutes; R2 is the catch-all for the others, since each runs inside `shipPath.ship`. `git grep -n 'queue.cancel\\|queue.complete'` over src: no CLI path settles a running request. `this.shipPath.ship` has one caller, card-runner.ts:1140."
forbid: [weakening or skipping a test to go green, a change to `GhProbe` or to `src/probes/gh.ts`, a retry of the merge or of any write of the ship, a release of a request whose owner is alive or of another host, a change to the state a ship that returns leaves, a new journal event type, a change to the order of the ship's writes before the `ship` call, an edit of any file under `.aidlc/`]
non_goals: [an expiry for running requests, a request whose pid was reused or whose process is a zombie (`processAlive` counts it as alive, so the release refuses, which fails closed), a reconcile of the operation by `review release` (`aidlc ops reconcile` stays the one way), guarding each other `gh` call of the ship (R2 covers them), a process killed on another host, the `lost` state of a request]
diagnosis:
  root_cause: "`GitHubShipPath.ship` calls `this.gh.checkRuns` unguarded in its CI poll (github-ship.ts:333), and `GhProbe.json` throws on a non-zero exit. On 2026-11-04 an HTTP 502 from `gh api .../check-runs` threw out of `shipPath.ship`, which `CardRunner.ship` also does not guard (card-runner.ts:1140), so the process exited with the merge operation `issued` and the review request `running`. `ReviewQueue.admit` keeps a running request in `pool.active` for ever, and with `maxConcurrent` 1 that stopped every R3 and ship of every session for 9 hours, until the user approved a one-off `ReviewQueue.cancel`, since no CLI command settles a running request. A process killed outside any catch leaves the same state, which only R3 and R4 can clear."
  same_class: "See the sweep: every unguarded `gh` call inside `shipPath.ship` has the same effect, and R2 covers them all."
hygiene: "Evidence: PR 189 (`T0-TAKEOVER-FOREIGN-LINE-2`), operation op-20261104102908-8839e494, request digest 99c93e5e, pid 44224. A throw is UNKNOWN and not `failed`, since `prView` runs after the merge: the outcome is looked up, and `aidlc ops reconcile` records it. `src/state/store.ts` changes only to export `processAlive`. Run the verify-card-run-writes check before SHIP (CardRunner.ship is covered) and move its sync commit at CLOSE. Every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8); the doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
superseded_by: T0-SHIP-THROW-SLOT-2
---

# T0-SHIP-THROW-SLOT

## Deliverable
A GitHub outage during a ship no longer stops every review in the repository. An unreadable check-run read is a pending read of the CI gate; any other throw of a ship frees its slot and leaves the operation UNKNOWN for `aidlc ops reconcile`; and `aidlc review release` frees the slot of a process that died outside any catch, refusing while that process is alive.

## Doc text
OPERATIONS sentences:

A ship that throws frees its review slot and leaves its merge operation `UNKNOWN`, since a merge may have landed: look the outcome up and record it with `aidlc ops reconcile <opId> --status <s>`, and `card next` ships again.

`aidlc review release <key> --reason <text>` frees the slot of a `running` request whose owner process is gone from this host, which is how a process killed outside any catch leaves the pool; it refuses while that process is alive or when the owner is on another host, and journals a `review-slot-released` NOTE in each requester goal before it frees the slot, so running it again finishes a release that failed part way.

CHANGELOG entry:

- T0-SHIP-THROW-SLOT (bugfix): a GitHub outage during a ship no longer stops every review in the repository. An unreadable check-run read is now a pending read of the CI gate, retried until the gate's timeout; any other throw of a ship frees its review slot and leaves its merge operation `UNKNOWN` for `aidlc ops reconcile`; and `aidlc review release <key> --reason <text>` frees the slot of a process that died outside any catch, refusing while that process is alive. Before, an HTTP 502 from the check-runs read left a `running` request in the pool that no command could clear.

## Amendments
- 2026-11-05, planner (session lead), after R3 decision 1 and before R3 decision 2, from its findings (classes: release-owner-race, unsafe-thrown-value, cleanup-masks-ship-error, unrecoverable-journal-gap): R1 and R2 cover any thrown value, R2 runs each settlement step on its own and carries the result through `journalOwed`, R3 checks and writes in one section of the request's lock, R4 journals before it frees the slot and finishes on a retry; acceptance 8 to 11; `src/delivery/ship.ts` in allow_paths for the shared text of a thrown value.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/ship-throw.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/infra/review-queue.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/two-windows.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
