---
id: T0-JOURNAL-APPEND-LOCK
title: Journal.append reads the head and appends under one per-journal lock, so concurrent appenders in separate processes keep one hash chain, and a refused append leaves state each command recovers
status: todo
branch: T0-JOURNAL-APPEND-LOCK
worktree: D:\wt\AIDLC\T0-JOURNAL-APPEND-LOCK
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 15 source lines in src/state/journal.ts; the rest is the lock test file with its eleven input classes, the child script, the three refusal scenarios of acceptance 9, the docs that list each refused append and its recovery, and about 25 lines of attempt evidence; raised from 450 to 680 by the coordinator on the candidate 11017fd6, which is 650 changed lines: 48 source lines in src/state/journal.ts, 540 lines of the lock, child-process and refusal tests, 44 lines of attempt evidence, the rest docs"
allow_paths:
  - src/state/journal.ts
  - tests/infra/journal-lock.test.ts
  - tests/infra/journal-lock.child.ts
  - tests/scenarios/journal-lock-refusal.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-JOURNAL-APPEND-LOCK.md
dod_command: npm run typecheck && node --test tests/infra/journal-lock.test.ts tests/scenarios/journal-lock-refusal.test.ts tests/infra/journal.test.ts tests/infra/update-json.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/ship-throw.test.ts tests/scenarios/review-admit-strand.test.ts tests/scenarios/candidate-pins.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/side-write-faults.test.ts tests/scenarios/candidate-withdraw.test.ts
dod_exit: 0
requirements:
  - R1. `Journal.append` (src/state/journal.ts) shall resolve the actor (`input.actor ?? currentActor()`, which can write `session-default`, journal.ts:36-46) before it takes the lock, and then, inside one section of `updateJson` (src/state/store.ts) on the record path `<journal file>.append`, which is never written (the change returns the record it received, undefined, the pattern `ReviewQueue.section` uses at src/coordination/review-queue.ts:67-80), read the head (`seq`, `hash`), read `ts` (`input.ts ?? nowIso()`; no caller in src/ passes `ts`) and append the event line; the lock file is `<journal file>.append.lock`, `seq` and `prevHash` come only from the head read inside the section, and an event appended without `input.ts` never has a `ts` earlier than the event before it: inside the section the clock reading is compared with the `ts` of the head event, and when the clock reads earlier (the system clock moved back) the head's `ts` is used; an `input.ts` a caller passes is recorded as given.
  - R2. WHILE another writer holds the journal lock, `Journal.append` shall wait and refuse exactly as the unchanged `updateJson` does, with its default deadline of 2 s, and append nothing. An exclusive create refused with EEXIST, or with EPERM while the lock path exists (Windows, a lock being deleted), is retried every 10 ms until the deadline, then refused with `StoreError` `LOCKED` whose message names the record path and, for a live owner, the owner text of the lock (`locked by another writer (pid=<n> at=<iso> nonce=<hex>); run the command again`), and, only when the owner process is gone, the lock file and the process id (store.ts:201-206). An exclusive create refused with EPERM while the lock path does not exist (audit item F3, the owner's open decision; 2 in 3,000 contended appends in the probe) propagates as that EPERM at once. The lock of the other writer is left as it is.
  - R3. IF the head read or the append throws inside the section (a last line that is not JSON or that the journal schema refuses, an `appendFileSync` failure such as EIO), THEN `Journal.append` shall release its own lock and rethrow that error, so that the next append takes the lock.
  - R4. The journal lock shall be the innermost lock: `Journal.append` takes no other lock while it holds it, and the lock is not reentrant (store.ts:159), so an append reached from inside another append of the same process waits and is refused with `LOCKED`. A caller that holds an outer lock takes it first and the journal lock second: the card-run lock, a card or goal lease lock, the review-queue lock, and the evidence manifest lock of card T0-MANIFEST-LOCK (manifest, then journal).
  - R5. A journal lock left by a process that ended inside the section shall stay until the operator deletes it (store.ts:188-193 removes only the writer's own lock): every later append on that journal waits 2 s and throws `LOCKED` with the message `<lock file> is locked by pid <n>, which is no longer running; delete <lock file> only once pid <n> is confirmed dead, then run the command again`, and nothing is appended to that journal until the operator deletes the file.
  - R6. A refusal of R2 or R5 shall leave the writes the caller made before the append as they are, exactly as an append that throws EIO does on main: this card adds a cause of a failed append and changes no caller's handling of one. Three cases are stated and tested (acceptance 9): the delivery of an owed event after `card attempt` (the event stays owed and the next card command delivers it once); the `OPERATION_ISSUED` append of the ship (the operation is `issued` and the pool request `running`, the state tests/scenarios/fault-points.test.ts pins; `aidlc ops reconcile <opId> --status cancelled` and `aidlc review release <key>` recover it and the next `card next` ships once); and the `OPERATION_INTENT` append of a release step (the operation is `intended`, `aidlc release next` gives the wait of T0-RELEASE-OP-REISSUE, `aidlc ops reconcile` settles the step from the recorded outcome, and a deploy that never ran is retried by a new release attempt after `aidlc goal resume <goalId> --reason <text>`). Every other append site keeps the behaviour a failed append has there on main.
  - R7. `Journal.readAll`, `head`, `verify`, `filter` and `exists` shall take no lock, as on main, and the record path `<journal file>.append` never exists on disk.
  - R8. `docs/OPERATIONS.md` (Audit) shall state R1, R2, R5 and R6 (the rule, and its three tested cases each with its recovery command) and shall make no claim about what a failed append leaves at any other site; `docs/ARCHITECTURE.md` names `<goalId>.jsonl.append.lock` in the journal row of the persisted-state table (line 184 at 6c1a6cfd) and state R4 in the `journal.ts` sentence of the `src/state/` paragraph; and `CHANGELOG.md` Unreleased states R1 to R6.
acceptance:
  - 1. `tests/infra/journal-lock.test.ts` "four processes appending to one journal keep one hash chain" starts four `node` processes on `tests/infra/journal-lock.child.ts`, each appending 150 events to one journal in a temporary directory and printing as JSON how many appends returned and the error code of each append that threw; after all four exit, `verify()` is ok, `verify().events` equals the sum of the appends that returned, every thrown code is `LOCKED` or the absent-path `EPERM` (nothing appended for either), and at least 300 appends returned. Fails on main (a probe of the same shape on 92796d4f gave 348 verify problems in 600 appends). [R1] [R2] [dod arm 1]
  - 2. Same file, "an append started while another holds the lock between its head read and its append is refused": with `fs.readFileSync` patched so that during the head read of append A the test starts a child process (spawnSync) that appends one event to the same journal, the child exits with `LOCKED` after its 2 s deadline and appends nothing, A's event has `seq` one more than the head A read, and `verify()` is ok; this ordering is deterministic. Fails on main (the child appends the same `seq` and `verify()` reports a sequence gap). [R1] [R2] [dod arm 1]
  - 3. Same file, "a held journal lock refuses with LOCKED after the deadline and is left in place": with the lock file naming a live owner (this process), `append` throws `LOCKED` after 2 s, the message names the record path and the owner text, the journal is byte for byte unchanged and the lock file keeps its text. A lock naming a process that is not running (pid 999999999) gives the R5 message naming the lock file and that pid, and is still there afterwards. [R2] [R5] [dod arm 1]
  - 4. Same file, "an EPERM on the lock path is retried while the path exists and propagates at once while it is absent": with `fs.openSync` patched for the `wx` open of the lock path, two EPERM refusals while a lock file exists (deleted after the second) are followed by a successful append; an EPERM while the lock path is absent is thrown in less than 1 s and the journal is unchanged. [R2] [dod arm 1]
  - 5. Same file, "a malformed head releases the journal lock": with a last line that is not JSON, and with one the schema refuses, `append` throws, no lock file is left, and after the line is removed the next `append` succeeds. Regression control, "a failed append releases the journal lock": with `fs.appendFileSync` throwing EIO once, `append` throws, no lock file is left, and the next `append` returns the next `seq` with a chain that verifies (green on main). [R3] [dod arm 1]
  - 6. Same file, "an append reached from inside another append of the same process is refused": with `fs.appendFileSync` patched to call `append` on the same journal before the real append, the inner call throws `LOCKED`, the outer append succeeds, and the journal holds one event. [R4] [dod arm 1]
  - 7. Same file, "the actor is resolved before the lock and ts is read inside it": with `currentActor` resolution observed (a fresh state directory without `session-default`), `session-default` is written before the lock file is created; ten appends without `ts` have non-decreasing `ts` along `seq`; after any append no `<journal file>.append` file exists. [R1] [R7] [dod arm 1]
  - 8. `tests/infra/journal.test.ts`, `tests/scenarios/two-windows.test.ts` (whose T1-STORE-CAS-2 acceptance 6 is refused at the lease lock and does not reach the journal lock), `tests/infra/update-json.test.ts` ("one lock primitive in src" and acceptance 15), `tests/scenarios/fault-points.test.ts` (no pin added) and the seven suites that inject append faults (op-intent-dup, ship-throw, review-admit-strand, candidate-pins, second-pass, side-write-faults, candidate-withdraw) pass unchanged. [R3] [R4] [R7] [dod arm 1]
  - 9. `tests/scenarios/journal-lock-refusal.test.ts`: a lock refusal injected (the absent-path EPERM at the `wx` open of the lock path, armed for the append of one event type) at (a) an owed-event delivery after `card attempt` records a success: the attempt is recorded, `ATTEMPT_FINISHED` is still owed, and the next `card next` delivers it once marked `completed: true`; (b) the ship's `OPERATION_ISSUED`: the operation is `issued`, the pool request `running`, the ship path ran no ship, the next `card next` returns `wait` attached to the running operation and runs no ship, and after `aidlc ops reconcile <opId> --status cancelled` and `aidlc review release <key>` the next `card next` ships once; (c) a release step's `OPERATION_INTENT`: the operation is `intended`, the deploy command did not run, the next `aidlc release next` returns the wait of T0-RELEASE-OP-REISSUE naming `aidlc ops reconcile` and runs no command, and after `aidlc ops reconcile <opId> --status cancelled` the next `aidlc release next` settles the step as failed from that record (T0-RELEASE-OP-REISSUE R7: a recorded outcome becomes the step and nothing is issued again), stops the attempt with `release-health` and runs no command, so the ledger holds the one `cancelled` operation; the recovery of a deploy that never ran is a new attempt (`aidlc goal resume`), which the docs list of R6 says. The first text of this item, "after the reconcile it runs the command once", was written before T0-RELEASE-OP-REISSUE merged and was amended by the planner on 2026-11-11 after the build showed it. [R6] [dod arm 1]
  - 10. The two documents and the CHANGELOG state R8 (reviewer-verified against the diff). [R8]
depends_on: [T0-RELEASE-OP-REISSUE]
budget: 680
tdd: true
diagnosis:
  root_cause: "`Journal.append` (src/state/journal.ts:126-144 at 6c1a6cfd, unchanged since 92796d4f) calls `head()`, which reads the whole file, builds the event from that head and then calls `appendFileSync`, with no lock between the read and the append. Two processes that read the same head append two events with the same `seq` and `prevHash`, and every later event chains to one of them, so `verify()` reports sequence gaps and previous-hash mismatches."
  repro: "On 92796d4f, four node processes running the audit probe (child.ts of the audit scratchpad directory jr, 150 appends each to one file): verify() ok false, 600 events, 348 problems, the first a sequence gap (expected 13, found 9) at line 14. The second review reproduced it on the same commit."
  same_class: "Other read-modify-writes of state outside `updateJson`: the evidence manifest (card T0-MANIFEST-LOCK) and the incident ledger (card T0-INCIDENT-INTENT-LEDGER). `Journal.append` is the only writer of journal files."
sweep: "git grep -n '.append(' -- src at 6c1a6cfd: 91 sites in four files, all `Journal.append`. Locks held at each call (TypeScript AST of the call and its enclosing callbacks, then the callers of each method read by hand). Card-run lock: src/loop/card-runner.ts:590 (`deliverOwed`, inside the `updateCardRun` change) and src/loop/controller.ts:724 (`ensureCardRun`, inside the `within` of `saveCardRun` at 722, after the write). Card lease lock: card-runner.ts:861 (`takeover`, inside the `leases.update` change). Card-run lock, then the card lease lock: card-runner.ts:894 and 895 (`takeover`, the `holding` section inside the `within` of `updateCardRun`). Goal lease lock: controller.ts:493 (`completeTakeover`, called inside `leases.update` at 500 and 507) and 501. Review-queue lock: src/cli/main.ts:891 (`aidlc review release`, the `before` callback inside the queue section). Manifest lock after T0-MANIFEST-LOCK: main.ts:1296 and 1321. No lock: card-runner.ts:356, 482, 489, 614, 620, 634, 649, 710, 920, 1210, 1220, 1235, 1262, 1284, 1301, 1334, 1431, 1614, 1617, 1886, 2050, 2234, 2378, 2703, 2713, 2748, 2800, 2815, 2831, 2833, 2884, 2914, 2996, 3021, 3029, 3040, 3092, 3124; controller.ts:190, 191, 302, 357, 362, 439, 465, 526, 533, 538, 554, 577, 600, 609, 623, 633, 655, 678, 685, 772, 778, 838, 846, 870, 871; release-runner.ts:135, 189, 201, 219, 222, 241, 273, 296, 314, 317, 325, 337, 347; main.ts:381, 400, 1086, 1106. R6 (amended 2026-11-11 after R3 decision 1): a refused append leaves what an append that throws EIO leaves at that site on main, and this card changes no caller's handling of a failed append; the three cases acceptance 9 tests are stated in R6 and in docs/OPERATIONS.md (Audit), and the per-site catalogue that stood here is a non-goal. Tests that pin the behaviour touched: tests/infra/update-json.test.ts:192-205 and 296-304; tests/scenarios/two-windows.test.ts:1076-1119; tests/scenarios/fault-points.test.ts:579-593 (pin H9, the state of R6 at :1301); tests/surface/prose.test.ts:340-361 (the Sessions lock sentence, not edited); the append fault injections of the seven suites in the DoD."
forbid:
  - weakening or skipping a test to go green
  - a change to src/state/store.ts or to any file under src/state/ other than journal.ts, so `createExclusive` and `updateJson` stay as they are and the EPERM decision F3 stays open
  - a lock primitive (an exclusive create, `sleepSync`, `Atomics.wait`) outside src/state/store.ts
  - a change to the Sessions section of docs/OPERATIONS.md or to the README Multi-session paragraph, whose lock sentence tests/surface/prose.test.ts pins
  - a new `mkdtempSync` call in a test; create a temporary directory with `tmpDir` of tests/infra/helpers.ts and remove it with `cleanup` in an `after` hook
  - editing .aidlc state by hand
non_goals:
  - a per-site catalogue of what a failed append leaves at each caller of the journal and how each is recovered (the first text of R6 and R8 asked for it; R3 decision 1 of 2026-11-11 found the drafted list incomplete in twelve places and wrong in four, and the planner narrowed both requirements to the rule and the three tested cases, because those states are the ones any failed append leaves on main and are not changed by this card; the catalogue is a documentation card of its own)
  - a retry of the absent-path EPERM (audit item F3, the owner's open decision)
  - a configurable journal lock deadline
  - automatic removal of a lock left by a process that ended; R5 names the operator step
  - a lock for the journal readers
  - the unapplied ship outcome after a lost append at card-runner.ts:2815 or 2884, which exists on main for any append failure there and needs its own card
  - repair of a journal that is already broken
hygiene: "Line numbers are from main at 6c1a6cfd; read them again at PREPARE, after T0-RELEASE-OP-REISSUE has merged (it changes release-runner.ts). This card changes src/state/journal.ts, which the verify-card-run-writes coverage record names (`Journal.append`), so run that skill before SHIP and at CLOSE; at CLOSE move its sync commit to the merge commit on main and add to its Bounds list that a journal append runs under the journal lock. The child processes of acceptance 1 and 2 run with `process.execPath` on the sources (type stripping), each with its own `AIDLC_SESSION`, get the journal path as an argument, and run without `NODE_TEST_CONTEXT`. Insert the CHANGELOG entry directly above the entry that begins `- T1-BOUND-STATS:`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict."
doc_sync: docs/OPERATIONS.md (Audit), docs/ARCHITECTURE.md (persisted-state table and `src/state/` paragraph), CHANGELOG.md, .claude/skills/verify-card-run-writes/SKILL.md (sync commit and Bounds line at CLOSE)
---

# T0-JOURNAL-APPEND-LOCK

## Deliverable
Two processes that append to the same goal journal at the same time no longer break its hash chain: `Journal.append` reads the head and appends under one lock per journal file, taken through `updateJson` and held only for that read and that append. A refused append leaves the caller's earlier writes as they are, and docs/OPERATIONS.md names the command that recovers each.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/journal-lock.test.ts tests/scenarios/journal-lock-refusal.test.ts tests/infra/journal.test.ts tests/infra/update-json.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/ship-throw.test.ts tests/scenarios/review-admit-strand.test.ts tests/scenarios/candidate-pins.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/side-write-faults.test.ts tests/scenarios/candidate-withdraw.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the fault-point check adds no pin.

## Attempt evidence

Attempt 1 (effort high). RED commit `e0c5aaab` (tests only); fix commit `af92d983`. Source change: `src/state/journal.ts` only (`Journal.append`); `src/state/store.ts` is unchanged.

| Acceptance | Test or command | Result |
|---|---|---|
| 1 | journal-lock.test.ts "four processes appending to one journal keep one hash chain" | pass; on main fails "the chain verifies" (sequence gaps from line 9) |
| 2 | journal-lock.test.ts "an append started while another holds the lock between its head read and its append is refused" | pass; on main fails: the child returned 1 append, no `LOCKED` |
| 3 | journal-lock.test.ts "a held journal lock refuses with LOCKED after the deadline and is left in place" | pass; on main fails "LOCKED: undefined" (the append returned) |
| 4 | journal-lock.test.ts "an EPERM on the lock path is retried while the path exists and propagates at once while it is absent" | pass; on main fails "the create was retried after each EPERM" (2 !== -1) |
| 5 | journal-lock.test.ts "a malformed head releases the journal lock"; regression control "a failed append releases the journal lock" | pass; both pass on main too (the card labels only the second a control; the first has no lock to leave on main) |
| 6 | journal-lock.test.ts "an append reached from inside another append of the same process is refused" | pass; on main fails "the inner append is refused with LOCKED: undefined" |
| 7 | journal-lock.test.ts "the actor is resolved before the lock and ts is read inside it" | pass; on main fails: order `['session-default']`, no lock created |
| 8 | journal.test.ts, update-json.test.ts (17/17), two-windows, fault-points, op-intent-dup, ship-throw, review-admit-strand, candidate-pins, second-pass, side-write-faults, candidate-withdraw, journal-owed: unchanged | pass in the DoD run below |
| 9 | journal-lock-refusal.test.ts (a), (b), (c) | pass; on main each fails "the journal lock was refused" (no lock to refuse). (c) deviates from the card, see below |
| 10 | docs/OPERATIONS.md (Audit, two new paragraphs), docs/ARCHITECTURE.md (journal row, `journal.ts` sentence), CHANGELOG.md (above `- T1-BOUND-STATS:`) | reviewer |

Acceptance 9 (c), deviation for a ruling: the card says that after the reconcile `release next` runs the command once. It cannot: after `aidlc ops reconcile <id> --status cancelled`, `ReleaseRunner.issue` finds the step's record by its key and `settleStep` (src/loop/release-runner.ts, T0-RELEASE-OP-REISSUE) takes the cancelled record as the step, `failed`, so `release next` stops the attempt with `release-health` "staging deployment failed" and runs no command; no other status makes the step run again (an open status waits, a terminal one settles it). Reporting the stopped attempt makes the goal terminal. The test asserts this observed outcome (stop, command not run, one operation, `cancelled`) and docs/OPERATIONS.md states it; the sweep's recovery text for release-runner.ts:314 ("then aidlc release next <attemptId>") is accurate as a command, not as a recovery of the step. A change to that behaviour is outside `allow_paths`.

Seams: (a) to (c) arm the refusal for one event type by wrapping `Journal.prototype.append` (it calls the real method; it only arms the `wx` open of `<journal>.append.lock` to throw the absent-path `EPERM`). (b) runs the fixture under an actor whose pid is a process that has exited, on this host, so `aidlc review release` accepts the request as the operator's recovery after the shipping process ended. The interleave of acceptance 2 is deterministic: the child runs inside the patched head read, while the lock is held.

Revert check (each hunk of `Journal.append` reverted on its own in the worktree, then restored; tests: journal-lock.test.ts and journal-lock-refusal.test.ts):

| Hunk | Fails | Result |
|---|---|---|
| H1 actor resolved before the lock (moved into the section) | acc 7 "session-default is written before the lock file is created" | red (1 of 11) |
| H2 the `updateJson` section (head read and append run with no lock) | acc 1 "the chain verifies", 2, 3, 4, 6, 7, 9 (a) (b) (c) "the journal lock was refused" | red (9 of 11) |
| H3 `ts` read inside the section (moved before the lock) | acc 7 "the waiting append's ts ... is no earlier than ..." (case added after the RED commit for this row) | red (1 of 11) |
| H4 the change returns the record it received (returning a new record writes `<journal>.append`) | acc 1 "the lock record is never written", acc 7 | red (2 of 11) |

Platforms: every case of both new files runs on Windows and Linux; none is gated on `process.platform`. The absent-path `EPERM` (acceptance 4, 9) and the present-path `EPERM` (acceptance 4) are injected at `fs.openSync`, so they do not depend on the OS. Acceptance 1 accepts an unforced absent-path `EPERM` (`syscall` `open`, path the lock file) as a refusal; it arises only on Windows. No OS error message is asserted. Run here on Windows only; the coordinator runs Linux.

Contention probe (the child of acceptance 1, four processes of 150 appends, three runs on Windows under the load of other agents): returned 600, 598 (2 absent-path `EPERM`) and 598 (1 `LOCKED`, 1 absent-path `EPERM`); the probe counts only, and each run of the test itself, which verifies the chain, passed. The test asserts the chain, the count of returned appends (at least 300) and the allowed codes, never the number of refusals.

verify-card-run-writes: covered file changed since sync commit 34d741ef: `src/state/journal.ts` only. The change adds a lock file create and remove around each append; no card-run record write or journal append is added, removed or reordered. tests/scenarios/fault-points.test.ts passes in the DoD run with no pin added. Outcome: in sync; the sync commit and the Bounds line move at CLOSE as the hygiene says (SKILL.md not edited in this attempt). The skill's "Keeping in sync" command still names f1344090 while its Sync commit line names 34d741ef.

DoD (`dod_command` exactly as above, Windows, on af92d983 plus the uncommitted docs): exit 0; tests 260, suites 18, pass 260, fail 0, cancelled 0, skipped 0; duration 215.5 s. tests/infra/update-json.test.ts on its own: 17 of 17 pass ("one lock primitive in src" included: no `wx`, `sleepSync` or `Atomics.wait` outside src/state/store.ts).

Doc-reading run (every test file that names ARCHITECTURE.md, OPERATIONS.md, CHANGELOG.md or SKILL.md: 81 files, one `node --test` call, Windows): exit 0; tests 1905, suites 151, pass 1893, fail 0, skipped 12 (existing platform skips). One sentence of the new Audit paragraphs (the card takeover recovery) was corrected after that run started; the four files that slice the Audit section or pin docs prose (journal-owed, bench, verifier, prose) were run again after it: 84 of 84 pass.

Budget: the diff exceeds `budget: 450` (see the line counts in the report); the source change is 31 added and 17 removed lines in src/state/journal.ts, the rest is the tests the card names, the docs and this evidence.

### Attempt 2 (repair of R3 decision 1, card amended in 6dd1f094)

Commits: RED `81d89031` (the clock test and (c) through goal resume), fix `3c4b97a2` (src/state/journal.ts), then the docs, the R7 reader check and this evidence.

Findings and what was done:

| Finding | Done |
|---|---|
| F1 implicit `ts` can move back with the clock | Inside the section `append` reads the head event's `ts` (private `headEvent`; `head()` still returns `{ seq, hash }`) and uses it when `Date.parse(nowIso())` is earlier; `input.ts` is recorded as given (journal.ts:147-152). Test "an implicit ts never moves back with the clock, and an explicit ts is recorded as given": the clock is mocked with `mock.timers` (`apis: ['Date']`), which `nowIso` (`new Date()`) reads, so no source seam was added. Input classes: no head (first event takes the reading); head with `ts` and an earlier reading (the head's `ts`); a later reading (as read); equal readings (the same `ts`); an explicit earlier `input.ts` (kept as given); an implicit append after it (compared with the head event only, so 11:30 after an explicit 11:00). `verify()` checks `seq`, `prevHash` and the hashes, not `ts` order: the chain with the explicit earlier `ts` verifies, and the test asserts it (no problems, 6 events). |
| F2 to F7 per-site recovery list incomplete and wrong in four places | Ruling applied: the list is removed from docs/OPERATIONS.md, CHANGELOG.md and the card's sweep. OPERATIONS.md (Audit) states R1 (with the `ts` rule), R2, R5, the rule of R6 and the three cases of acceptance 9 only; no sentence about takeover, goal creation, lease renewal, review admission, release results or `goal reconcile` remains. |
| 9 (c) text and `aidlc goal resume` | The test now continues past the stop: the stopped attempt is reported to the goal (`release-result`, what `aidlc release next` does for a STOP or DONE attempt, src/cli/main.ts, release next action), which makes the goal `STOP` and terminal; `resume` requires a terminal goal (controller.ts, `case 'resume'`: "resume applies only to a terminal goal"). The `resume` report (`aidlc goal resume`, src/cli/main.ts, goal resume action) opens generation 1 and directs `verify-arc`; after `arc-verified` a new attempt opens, and with its candidate and approval recorded its `release next` runs the deploy once; the ledger then holds one deploy operation per attempt. The resume is called in process, not through the CLI: the CLI reads the real clock and the fixture's goal deadline is on the fixed clock, so a CLI resume today gives a time stop (seen while building the test). |

Clause check against the amended card (code line in src/state/journal.ts; the test that fails without it):

| Clause | Code | Test that fails without it |
|---|---|---|
| R1 actor before the lock | :144 | acc 7 "session-default is written before the lock file is created" (revert H1) |
| R1 head read and append in one section on `<file>.append` | :146-163 | acc 1 "the chain verifies", acc 2 (revert H2) |
| R1 `ts` read inside the section | :149 | acc 7 "the waiting append's ts ... is no earlier than ..." (revert H3) |
| R1 the head's `ts` when the clock reads earlier | :152 | clock test "the clock reads earlier than the head" (revert H5) |
| R1 `input.ts` recorded as given | :152 | clock test "an explicit ts is recorded as given" (revert H6) |
| R1/R7 the record path is never written | :164 | acc 1 "the lock record is never written", acc 7 (revert H4) |
| R2 wait, retry and refusal of `updateJson` | :146 (store.ts unchanged) | acc 3, acc 4 (revert H2) |
| R3 release and rethrow | `updateJson`'s release (store.ts unchanged) | acc 5 "no lock file is left" (both cases and the EIO control) |
| R4 innermost, not reentrant | :146 | acc 6 "the inner append is refused with LOCKED" (revert H2) |
| R5 dead owner's lock stays | `updateJson` refusal (store.ts unchanged) | acc 3 second half (revert H2) |
| R6 no caller changed; three cases | no caller edited | acc 9 (a) (b) (c) "the journal lock was refused" (revert H2) |
| R7 readers take no lock | `readAll`, `head`, `verify`, `filter`, `exists` unchanged | acc 3 reader check, added in attempt 2: with `readAll` taking the lock (scratch variant), acc 3 fails with LOCKED |
| R8 docs | OPERATIONS.md Audit, ARCHITECTURE.md (attempt 1, unchanged), CHANGELOG.md | reviewer; doc-reading run below |

Revert check of the attempt 2 hunks (each alone, then restored; journal-lock.test.ts and journal-lock-refusal.test.ts):

| Hunk | Fails | Result |
|---|---|---|
| H5 the head-`ts` floor (`ts: input.ts ?? read`) | clock test "the clock reads earlier than the head: the head's ts is used" | red (1 of 12) |
| H6 the floor applied to `input.ts` as well | clock test "an explicit ts is recorded as given, earlier than the head included" | red |
| R7 scratch variant: `readAll` takes the journal lock | acc 3 "LOCKED: locked by another writer ..." | red |

Platforms: the clock test mocks `Date` only and runs on Windows and Linux; no new platform gate.

DoD attempt 2 (`dod_command` exactly, Windows, on 3c4b97a2 plus the uncommitted docs, the R7 reader check and this evidence): exit 0; tests 261, suites 18, pass 261, fail 0, cancelled 0, skipped 0; 251.2 s. tests/scenarios/fault-points.test.ts alone: 28 of 28, no pin added (verify-card-run-writes: in sync, as in attempt 1). tests/surface/prose.test.ts (byte caps): 16 of 16.

Doc-reading run attempt 2 (81 files that name ARCHITECTURE.md, OPERATIONS.md, CHANGELOG.md or SKILL.md, one `node --test` call, Windows, under load): tests 1905, suites 151, pass 1891, fail 2, skipped 12. The two failures are tests/infra/exec.test.ts ("T0-EXEC-TREE-KILL run on real processes") and tests/infra/exec-sync-tree.test.ts ("T0-EXEC-SYNC-TREE-KILL runSync with killTree on real processes"), which read no document this card changes; run alone right after, both files pass, 84 of 84 (machine load).

Coordinator verification:
- At 41257b4f, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/infra/journal-lock.test.ts, tests/scenarios/journal-lock-refusal.test.ts): tests 11, pass 11, fail 0, skipped 0.
- Windows, docpins: 79 test files reading 3 changed documents: # tests 1866 # pass 1854 # fail 0
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.

Coordinator verification:
- At 128c6e47, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/infra/journal-lock.test.ts, tests/scenarios/journal-lock-refusal.test.ts): tests 12, pass 12, fail 0, skipped 0.
- Windows, docpins: 79 test files reading 3 changed documents: # tests 1866 # pass 1853 # fail 1 docpins: tests/infra/exec.test.ts failed in the parallel run and passes alone (# pass 61): load
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.
