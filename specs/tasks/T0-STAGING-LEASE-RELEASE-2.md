---
id: T0-STAGING-LEASE-RELEASE-2
title: (replaces T0-STAGING-LEASE-RELEASE) A release attempt that ends with no unresolved operation releases every environment lease it claimed, checked and released in one lease section; one that leaves an unresolved operation keeps them
status: todo
branch: T0-STAGING-LEASE-RELEASE-2
worktree: D:\wt\AIDLC\T0-STAGING-LEASE-RELEASE-2
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: budget raised from 230 to 420 after two reviews of the card (Codex and Fable 5.2) against main at 92796d4f; about 55 source lines in two files, the rest the class, race, failure and CLI tests the rulings require, docs and attempt evidence; raised from 420 to 610 by the coordinator on the candidate 02120801, which is 578 changed lines: 67 source lines in two files, 420 lines of the acceptance tests, 85 lines of attempt evidence with its 16-row revert table, the rest docs; raised from 610 to 860 by the coordinator on the repair candidate 78e403e7 of R3 decision 1, which is 819 changed lines against main: 95 source lines in two files, 531 lines of tests, 180 lines of attempt evidence with the clause and revert tables the review reads, the rest docs; raised from 860 to 1100 by the coordinator for the repair of the five points a pre-review of 78e403e7 found (an attempt-level section, a per-environment check, a strict ledger read, the empty environment) with one test each; raised from 1100 to 1420 by the coordinator on the redesign candidate 43a50ec7, which is 1294 changed lines (176 in src/loop/release-runner.ts, 3 in src/cli/main.ts, 772 of tests, 329 of attempt evidence with a revert table of 38 rows, 14 of docs), before acceptance 16 is added; raised from 1420 to 1560 by the coordinator on 2026-11-12 for acceptance 17 (five proofs a Codex pre-review of 4f117f50 found missing, about 140 lines of tests and evidence) on a candidate of 1341 changed lines; for the replacement T0-STAGING-LEASE-RELEASE-2: budget 1560 on the candidate carried from T0-STAGING-LEASE-RELEASE at 6ab7a126 (1487 changed lines against main, `git diff --shortstat origin/main...6ab7a126`: 183 in src/loop/release-runner.ts, 3 in src/cli/main.ts, 886 of tests, 401 of attempt evidence, 14 of docs), which passed R3 at decision 2 and the second pass and stopped at SHIP with STOP ci, unclassified failure, because in a GitHub Actions outage every step of the three test jobs of PR 277 succeeded but GitHub did not mark the jobs complete within the ship's 30-minute CI wait; raised from 1560 to 1600 by the coordinator on 2026-11-12: the carried candidate 3f9608e2 is 1548 changed lines with the moved evidence, and the coordinator's verification block is still to be appended"
allow_paths:
  - src/loop/release-runner.ts
  - src/cli/main.ts
  - tests/scenarios/release-lease.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-STAGING-LEASE-RELEASE-2.md
dod_command: npm run typecheck && node --test tests/scenarios/release-lease.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts tests/infra/lease.test.ts
dod_exit: 0
requirements:
  - R1. `ReleaseRunner.next` shall have one exit through which every return passes, and that exit applies R2 to R5 when the attempt it is about to return is in `DONE` or `STOP`; the public `next` runs the step logic and the exit, and the recursive calls inside the step logic (release-runner.ts:190, :206, :220, :232, :298, :328 on main at 92796d4f) call the step logic, not the exit. So no terminal return is edited one by one, and the exit covers every terminal path: an attempt already terminal when `next` is called (:125-126), the STOPs saved at :150, :160 (`ownership`), :181, :209, :252, :265, :305 and :309, the transitions that can save STOP or DONE at :187, :199, :217, :271 and :294, and the terminal returns that T0-RELEASE-OP-REISSUE (STOP `time` and STOP `audit` of `issue`) and T0-RELEASE-REPORT-STEP (three STOPs `release-health`) add.
  - R2. WHEN the exit of R1 sees a terminal attempt and the goal's operation ledger holds no record that belongs to the attempt by the association predicate of T0-RELEASE-OP-REISSUE R3 (its `releaseAttempt` is the attempt id, or its `idempotencyKey` is exactly one of the attempt's three release-step keys) with status `intended`, `issued`, `running` or `UNKNOWN`, THE runner shall release each environment lease of the attempt by R3 before `next` returns.
  - R3. For each key `resourceKeys.environment(<name>)` (`env:` and the lower-cased name) built from the attempt's `environment` and from the `target` of every record that belongs to the attempt (R2's predicate), THE runner shall decide and write in one `LeaseStore.update(key, change)` section (lease.ts:45-47, the public lease section every lease write goes through; no change to src/coordination/lease.ts): the change marks the record it holds `released` and keeps its generation and every other field only when the record is present, not released, its `operation` is exactly `release:<attemptId>`, and its owner has the session and host of `currentActor()` (an expired lease of this session included); otherwise it returns the record unchanged, which writes nothing. `LeaseStore.release` is not used, since it checks owner and generation but not `operation` (lease.ts:115-120), so a renewal by this session for another attempt that lands before the section takes the lock (`claim` renews in place and rewrites `operation`, lease.ts:71-72) leaves that lease held. An absent lease, a released one, one with no `operation` or another attempt's, and one of another session or of this session on another host are left unchanged.
  - R4. WHEN a record that belongs to the attempt (R2's predicate) has status `intended`, `issued`, `running` or `UNKNOWN`, THE runner shall leave every lease of the attempt unchanged; this covers the STOP `time` after the reconciliation grace (:149-151), the STOPs of T0-RELEASE-OP-REISSUE R5, and any terminal attempt `next` is called on while such a record exists.
  - R5. WHEN the section of R3 throws for a key (its lock is not acquired, or the lease file is unreadable, malformed or fails the `Lease` schema, which `updateJson` reports through `readJson`, src/state/store.ts:83-101), THE runner shall go on with the other keys and return the terminal attempt as saved with its directive, whose narration gains, for each key that failed, the key, the error message and the command `aidlc release next <attemptId>`, which runs R1 to R5 again on the terminal attempt. An operation ledger that cannot be read releases no further lease: when the read before the per-key sections fails, every lease of the attempt is kept; when the read inside the section of one key fails, that lease and the leases of the keys after it are kept, and a lease an earlier section released stays released, since it was released after a read inside its own section that showed no unresolved operation. Nothing throws out of `next` for the terminal attempt, and the narration names the operation ledger, the store error, the leases kept and that command.
  - R6. The CLOSE branch's own release (:274-281, which releases the lease of `attempt.environment` whatever its `operation`) shall be removed in favour of R1 to R3, so a lease this session renewed for another attempt is no longer released when this attempt closes.
  - R7. `aidlc release next` shall report `release-result` to the goal (src/cli/main.ts:1136-1138) only when the goal record it loaded is not terminal (`Goal.terminal` false), because `GoalController.report` throws for a terminal goal (src/loop/controller.ts:516); so the retry command of R5, run on an attempt whose STOP has already stopped its goal, exits 0 and still applies R1 to R5. With a goal that is not terminal the report is made as on main.
  - R8. `ReleaseRunner.reportStep` shall stay without a lease release: the only attempt it saves in `DONE` is a `package` attempt in PREPARE, and an attempt claims environment leases only in STAGE, APPLY and RECOVER (:156-163); a later `aidlc release next` on that attempt applies R1. `aidlc release next` is the CLI entry point of R1 to R7; `aidlc release packet` and `aidlc release candidate` write no lease; `GoalController` reads no environment lease.
  - R9. Each document shall state the facts named after it: docs/OPERATIONS.md, section Standalone release (package / staging / production), R2 to R5 and R7 and that no command takes over an environment lease of another session; docs/ARCHITECTURE.md, the paragraph after the release state diagram, R1, R2 and R4 in one sentence; CHANGELOG.md, Unreleased, the card id and R1 to R7.
  - R10. The cleanup of R1 to R3 and the admission of a release step (`issue`, T0-RELEASE-OP-REISSUE R4) shall be serialized on the lease key of the environment: inside the `LeaseStore.update` section of a key the cleanup reads the operation ledger again and decides on that read (the read before the sections only collects the keys), and `issue` records its intent in the section of the same key only while the lease is the attempt's own by the conditions of R3. WHEN `issue` finds that the attempt does not hold the lease (a caller working on an older copy of the attempt after the cleanup released it), it records no intent, appends no journal event, runs no command and `next` returns a wait on `environment:<name>`. So an unresolved operation of the attempt that exists when a lease would be released keeps it, and no intent is recorded for a lease already released. (Added by the planner after R3 decision 1 of 2026-11-11, which found the ledger read outside the lock.)
  - R11. The cleanup of an attempt (all of its key sections) and the admission of a release step of that attempt (R10) shall each run inside one section per attempt: a `LeaseStore.update` section on the key `release-attempt:<attemptId>`, whose record is never written (the change returns what it received), taken before any environment key's section and held across them; an environment key's section is taken inside it, one key at a time, and no other lock is taken inside a key's section but the journal's. So the admission and the cleanup of one attempt never interleave, also when they touch two environments (a cleanup that has released `env:production` and is deciding `env:staging` cannot have a recovery of the same attempt admitted on production in between). A held attempt section is handled as a failed key section is (R5): nothing is released, the attempt is returned as saved and the narration names the retry command. An admission that finds the attempt section held (by the cleanup, or by another admission of the attempt) is refused as an admission that finds the environment key's section held is on main since T0-RELEASE-OP-REISSUE: `LOCKED` is thrown out of `next`, no intent is recorded and no command runs, and the command run again after the holder has ended meets the rule of R10. (Ruling of 2026-11-11 on the candidate 43a50ec7.)
  - R12. Inside the section of the key of an environment E, the unresolved check shall cover, beside the records that belong to the attempt (R2's predicate, whatever their target), every record of the operation ledger whose `target` names E, whatever attempt or goal it belongs to. A target names E when the lease store gives its key the lease file of E's key (`LeaseStore.file(resourceKeys.environment(target))` equals `LeaseStore.file` of the key of the section), so two names that differ only in letter case or in `\` against `/` are one environment, as they are one lease (ruling of 2026-11-12 on the candidate 4f117f50, which compared the key strings and so released the lease of `ops/prod` under a running operation on `ops\prod`): when any of them is `intended`, `issued`, `running` or `UNKNOWN`, the lease of E is kept. So another attempt of this session whose operation is still running on E keeps E's lease when this attempt ends (its claim renewed the lease with its own `operation`); the lease is then released by a later `aidlc release next <attemptId>` of the attempt the lease names, once nothing targeting E is unresolved, and the narration of a kept lease names that command.
  - R13. The ledger reads of the cleanup shall be strict: every entry the operations directory lists is read and parsed, and an entry that is listed and cannot be read or does not parse (an unreadable file, a directory without search permission, where `existsSync` answers false and `OperationLedger.list` would drop the record without a word) makes the read fail, which R5 handles as an operation ledger that cannot be read. An operations directory that does not exist is an empty ledger. An entry is a name of the operations directory that ends in `.json`, the names `listJsonFiles` (src/state/store.ts) selects for every reader of the ledger; any other name (the temporary file of an atomic write in progress, a lock file, a name ending in `.JSON`) is not a record of the ledger, is not read and does not fail the read. (Ruling of 2026-11-12 on the candidate 4f117f50.)
  - R14. WHEN the attempt's `environment` is absent or an empty string, the admission check of R10 and the sections of R11 shall be skipped and `issue` shall do what it does on main for that attempt (state it in the card evidence and pin it with a test), so a repeated `aidlc release next` gives that result each time and never a wait on `environment:` that nothing ends. The skip covers the cleanup as well: the cleanup of an attempt without an environment takes no attempt section and uses its key sections as R1 to R5 state. What main does for such an attempt in `issue` is a throw (an empty `environment` fails the schema of the operation intent on `target`; an absent one throws a `TypeError` in `resourceKeys.environment`), and the candidate keeps it; a clearer refusal of such an attempt at `aidlc release candidate` is a card of its own. (Ruling of 2026-11-11 on the candidate 43a50ec7.)
acceptance:
  - 1. `tests/scenarios/release-lease.test.ts` "a staging attempt that ends in DONE releases env:staging, and another session then acquires it": the lease is released at DONE and the other session's claim acquires it. Fails on main. [R1] [R2] [R3] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. Same file, "a delivered production attempt releases the staging and the production lease it claimed": both leases are released at DONE. Fails on main. [R2] [R3] [R6] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. Same file, "every terminal path passes the one exit": a failed staging deploy, a deploy without production authority, an `ownership` STOP at APPLY and attempts stored in STOP and in DONE each leave this attempt's leases released and another session's lease unchanged. Fails on main. [R1] [R2] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. Same file, "an attempt with an unresolved operation keeps its leases": a record of the attempt in `intended`, `issued`, `running` or `UNKNOWN` keeps `env:staging`, also after STOP `time`; with no ledger record the lease is released. Fails on main in its last case only. [R2] [R4] [dod arm 1] Detail: body section Acceptance detail, item 4.
  - 5. Same file, "only the attempt's own lease of this session and host is released": leases of another operation, session or host, released or absent stay unchanged; an expired own lease is released. The `release:<other attempt>` case fails on main. [R3] [R6] [dod arm 1] Detail: body section Acceptance detail, item 5.
  - 6. Same file, "a renewal for another attempt that lands before the cleanup takes the lock keeps the lease": the lease stays held with that operation and generation. Fails on main and against a read-then-release cleanup. [R3] [dod arm 1] Detail: body section Acceptance detail, item 6.
  - 7. Same file, "a lease cleanup that fails leaves the attempt terminal, releases the other leases and names the command that retries it": the narration names the key, the error and `aidlc release next <attemptId>`, the other lease is released, and the next `next` releases the failed one. Fails on main. [R5] [dod arm 1] Detail: body section Acceptance detail, item 7.
  - 8. Same file, "aidlc release next run twice on a stopped attempt exits 0 both times": the first CLI run reports `release-result`, the second skips it, both exit 0 and the lease is released. Fails on main. [R5] [R7] [dod arm 1] Detail: body section Acceptance detail, item 8.
  - 9. `tests/scenarios/release.test.ts`, `tests/scenarios/release-publication.test.ts`, `tests/scenarios/release-reissue.test.ts` and `tests/infra/lease.test.ts` pass unchanged. [R3] [R8] [dod arm 1] Detail: body section Acceptance detail, item 9.
  - 10. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md state the facts R9 names (reviewer-verified against the diff). [R9] Detail: body section Acceptance detail, item 10.
  - 11. Same file, "an intent recorded around the cleanup is seen by its lease section or never recorded for a released lease": a late intent keeps the lease; a late `issue` records nothing and waits. Fails at the candidate c2108334. [R5] [R10] [dod arm 1] Detail: body section Acceptance detail, item 11.
  - 12. Same file, "the admission and the cleanup of one attempt never interleave across two environments": an admission reached while the cleanup holds the attempt section records nothing until the cleanup ends, and a cleanup that finds the section held releases nothing. Fails at the candidate 78e403e7. [R11] [dod arm 1] Detail: body section Acceptance detail, item 12.
  - 13. Same file, "another attempt's unresolved operation on the environment keeps its lease": B's cleanup keeps `env:staging` while A's or another goal's staging record is unresolved, and `aidlc release next <B>` releases it once A's operation has succeeded. Fails at the candidate 78e403e7. [R12] [dod arm 1] Detail: body section Acceptance detail, item 13.
  - 14. Same file, "a ledger entry that is listed and cannot be read keeps every lease": an entry that is not JSON, one that fails the `OperationRecord` schema and (POSIX only) a directory without search permission each release nothing; a missing operations directory releases. [R13] [R5] [dod arm 1] Detail: body section Acceptance detail, item 14.
  - 15. Same file, "an attempt without an environment is issued as on main, every time": three `next` calls give main's result, never a wait on `environment:`. [R14] [dod arm 1] Detail: body section Acceptance detail, item 15.
  - 16. Same file, "the stops T0-RELEASE-REPORT-STEP added release the leases": failed `stage-verify` and `recover-verify` reports end in STOP with the leases released, and each fails when that exit or its release write is removed. [R1] [dod arm 1] Detail: body section Acceptance detail, item 16.
  - 17. Same file, five proofs the pre-review of 4f117f50 found missing, each failing under its revert: (a) "an unresolved record of the attempt on another environment keeps every lease"; (b) "two spellings of one environment are one lease"; (c) a refused `next` leaves the journal unchanged; (d) no lease file exists for `release-attempt:<attemptId>`; (e) "a name that is not a ledger entry is not read". [R2] [R4] [R12] [R10] [R11] [R13] [dod arm 1] Detail: body section Acceptance detail, item 17.
depends_on: [T0-RELEASE-OP-REISSUE]
budget: 1600
tdd: true
diagnosis:
  root_cause: "The environment lease is released in one place, the CLOSE branch of `ReleaseRunner.next` (release-runner.ts:270-281 at 92796d4f), and only for the environment the attempt names at that moment. Every other terminal path returns without a release: STAGE to DONE of a staging target (:198-202) and every STOP. A production attempt claims `env:staging` in STAGE and then switches its `environment` to production at CHECKPOINT, so CLOSE never releases the staging lease either. The lease then expires unreleased; `LeaseStore.claim` answers `expired` to any other session, `next` turns that into STOP `ownership` (:159-161), and no command takes over an environment lease. The one release that exists reads nothing about which attempt holds the lease, and `aidlc release next` on an attempt whose goal is already stopped exits 1, so it cannot serve as a retry."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\9050b3d1-5897-4caa-9057-e38858fcf6bf\\scratchpad\\probe4.test.ts P19 (after a production STOP: staging released=false, production released=false); C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-release.test.ts case C (staging DONE: lease released=false; another session's claim after the TTL: expired)."
  same_class: "Every resource lease a runner claims and must give back: the goal lease (`GoalController.releaseGoalLease` at DONE) and card leases (card close and takeover) have their own release paths and cards; the review pool slot is released by the queue. Every terminal return of `ReleaseRunner.next` passes the exit of R1, including those the two sibling cards add."
sweep: "git grep -n \"leases\\.\\|resourceKeys.environment\\|state: 'STOP'\\|transitionRelease(\\|this\\.next(\" -- src/loop/release-runner.ts on main at 92796d4f: :157 the only claim (STAGE, APPLY, RECOVER; operation `release:<id>`): unchanged; :276-277 the only release, in CLOSE: removed (R6); STOP saves at :150 (grace, unresolved: R4), :160 (`ownership`; another session's lease, left by R3), :181, :209, :252, :265, :305, :309 (R1); transitions that can save STOP or DONE at :187, :199, :217, :271, :294 (R1); recursive calls at :190, :206, :220, :232, :298, :328 (step logic, R1); :340 `reportStep` to DONE (R8). src/cli/main.ts:1136-1138 the `release-result` report (R7). git grep -n \"resourceKeys.environment\\|env:\" -- src: lease.ts:183 (the key) and release-runner.ts only. Tests that pin the current behaviour: no release test asserts a lease (git grep -n \"env:staging\\|env:production\\|resourceKeys.environment\" -- tests finds only tests/infra/lease.test.ts:193, the key's lower-casing); tests/infra/lease.test.ts:28-33, :40, :101 and :122 pin the `LeaseStore` methods this card uses through `update` and stay green, since src/coordination/lease.ts is not changed."
forbid: [weakening or skipping a test to go green, releasing a lease of an environment while the ledger, as read inside that lease's section, holds a record that belongs to the attempt or targets that environment and is intended, issued, running or UNKNOWN, releasing a lease of another session or host or whose operation names another attempt, deciding a release outside the lease's own update section, a change to src/coordination/lease.ts, editing .aidlc state by hand]
non_goals: [a status write that lands after the section's read (`aidlc ops reconcile` or a provider lookup writing `running` or `UNKNOWN` over a record the section read as terminal: the ledger has no lock on a record's status and accepts a terminal record going back to an unresolved one, src/coordination/reconcile.ts, on main as here; the release decides on the ledger as read inside the section, and making status writes atomic is a ledger card of its own), a command that takes over an expired environment lease of another session, releasing the staging lease when a production attempt leaves STAGE for CHECKPOINT (it stays held until the attempt is terminal), renewing environment leases while an attempt waits at CHECKPOINT or OBSERVE, a `release-result` reported by hand with `aidlc report`, the `disposition` `pending` that the ownership STOP (:160) and the publication STOP (:309) leave, leases left by attempts that were terminal before this card (their owner session releases them with `aidlc release next <attemptId>`), `.claude/skills/aidlc-loop/release.md` (4494 of its 4500 bytes)]
hygiene: "This card replaces T0-STAGING-LEASE-RELEASE, which stopped for ci: its candidate 6ab7a126 passed R3 at decision 2 and the second pass, and at SHIP the loop stopped it with STOP ci `unclassified failure: diagnose before any rerun` (2026-11-11T20:46:23Z) because, in a GitHub Actions outage, GitHub did not mark the three test jobs of PR 277 complete within the ship's 30-minute CI wait, although every step of them succeeded; all five checks of PR 277 are green since 21:01Z, and the loop has no command that clears a CI stop. The branch T0-STAGING-LEASE-RELEASE-2 starts from main, and the diff of 6ab7a126 against main (`git diff origin/main...6ab7a126`, merge base 877af98f; the commits of main after that base change none of its files) is applied to it as the candidate, with these changes only. (1) Every place of the diff that names T0-STAGING-LEASE-RELEASE as the card of the change names T0-STAGING-LEASE-RELEASE-2: the CHANGELOG entry begins `- T0-STAGING-LEASE-RELEASE-2 (bugfix, replaces T0-STAGING-LEASE-RELEASE, audit item F5)`, docs/OPERATIONS.md and docs/ARCHITECTURE.md say `(card T0-STAGING-LEASE-RELEASE-2)`, and the first line of tests/scenarios/release-lease.test.ts begins `// Card T0-STAGING-LEASE-RELEASE-2:`. At 6ab7a126 these are the four places that name it (CHANGELOG.md:23, docs/ARCHITECTURE.md:130, docs/OPERATIONS.md:173, tests/scenarios/release-lease.test.ts:1; none in src and no test title); the names of other cards (T0-RELEASE-OP-REISSUE, T0-RELEASE-REPORT-STEP) stay. (2) The hunk of specs/tasks/T0-STAGING-LEASE-RELEASE.md, its Attempt evidence, is not applied to that file: the evidence moves into a section `## Attempt evidence` of this file under a History line that names the predecessor, with a note at each figure of where it was measured (the commit of the branch T0-STAGING-LEASE-RELEASE it was run on, and the run: the Windows DoD, the coordinator's Linux run, the revert check), followed by the DoD of this card on its own branch. The old card file stays as it is on main. R1 to R14 and acceptance 1 to 17 are those of the predecessor and are met by the carried candidate, so the work of this card is the carry, the renaming of (1), the moved evidence and the DoD. RED: commit tests/scenarios/release-lease.test.ts alone first, on the sources of main, run it (it fails on main, as the predecessor's first RED commit 76133640 did; its RED commits b668608e and d9d5173a failed at earlier candidates and stay in the moved evidence) and record that commit as the RED receipt; then commit the rest of the diff. The coordinator closes PR 277 in favour of the PR of this card; the implementer does not. Line numbers are from main at 92796d4f; read them again at PREPARE. The line references in the requirements, acceptance, diagnosis and sweep point at main as it was when the card was written: read each again by its content, and do not renumber them. Insert the CHANGELOG entry directly above the entry that begins `- T0-SCAN-SETUP-STEP-2`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-RELEASE-OP-REISSUE, the earlier card of this list, merges first into the same files (src/loop/release-runner.ts, docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md); R2 reuses its association predicate, so call the same function rather than restating it. The lease section of R3 uses the existing public `LeaseStore.update`, so src/coordination/lease.ts and tests/infra/lease.test.ts stay out of allow_paths. Act as another session in a test with `LeaseStore.claim(key, { actor: actorB, now })` from tests/scenarios/_harness.ts, never by changing the process session; the CLI test of acceptance 8 sets `AIDLC_SESSION` for its child process and writes the lease for that session and `os.hostname()`. Give fabricated ledger records distinct `intentRecordedAt` values. Before the first R3, revert each source hunk in a scratch copy and run the tests of its requirement (lesson 2026-11-11 T0-AUDIT-FIXES). Neither changed source file is in the verify-card-run-writes coverage record."
doc_sync: docs/OPERATIONS.md (Standalone release), docs/ARCHITECTURE.md (release state machine), CHANGELOG.md
---

# T0-STAGING-LEASE-RELEASE-2

## Deliverable
`aidlc release next` releases the environment leases an attempt claimed when the attempt ends (`DONE` or `STOP`) with no operation of it intended, issued, running or UNKNOWN, checking in the lease's own lock section that the lease is still this session's lease for this attempt. A STOP that leaves such an operation keeps the leases, so no other session deploys to an environment whose last change is not known. A failed release is named with the command that retries it, and that command exits 0 on a stopped goal.

## Why
Replaces T0-STAGING-LEASE-RELEASE, whose candidate 6ab7a126 passed R3 at decision 2 and the second pass and stopped at SHIP for ci: during a GitHub Actions outage on 2026-11-11 every step of the three test jobs of PR 277 succeeded, but GitHub did not mark the jobs complete within the ship's 30-minute CI wait, so the loop recorded an unclassified failure. All five checks of PR 277 are green since 21:01Z. The loop has no command that clears a CI stop, so this card carries the candidate, as T0-DIRTY-SUCCESS-2 carried the candidate of T0-DIRTY-SUCCESS.

Audit of 2026-11-11, item F5, confirmed by two models; card reviewed by two more on 2026-11-11 and amended to the planner's rulings. A staging goal that ends STAGE to DONE keeps `env:staging`, and so does every STOP and every production attempt. After the 10-minute TTL every other session's release of that environment stops with `ownership`, and no command takes the lease over. A blanket release on STOP is unsafe: a STOP for time after the reconciliation grace leaves an operation whose outcome is not known.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/release-lease.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts tests/infra/lease.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; the four existing files pass unchanged.

## Acceptance detail
Each subsection is the full text of the acceptance item of the same number; the item in the front matter is its summary.

### 1
`tests/scenarios/release-lease.test.ts` "a staging attempt that ends in DONE releases env:staging, and another session then acquires it" passes and fails on main (main leaves the lease unreleased; after its TTL the other session's claim is `expired`). [R1] [R2] [R3] [dod arm 1]

### 2
Same file, "a delivered production attempt releases the staging and the production lease it claimed" passes and fails on main (main leaves `env:staging`). [R2] [R3] [R6] [dod arm 1]

### 3
Same file, "every terminal path passes the one exit": a failed staging deploy (STOP `release-health`), a publishing deploy without production authority (STOP `release-auth` from `issue`), a production attempt stopped for `ownership` at APPLY by another session's expired `env:production` lease (its own `env:staging` released, the other session's lease unchanged), and a terminal attempt stored directly in `STOP` and in `DONE` (as tests/scenarios/release.test.ts:230-248 stores attempts) each leave this attempt's leases released; passes and fails on main. [R1] [R2] [dod arm 1]

### 4
Same file, "an attempt with an unresolved operation keeps its leases": terminal attempts stored directly with one record each in `intended`, `issued`, `running` and `UNKNOWN`, once with `releaseAttempt` the attempt id and once with `releaseAttempt` absent or another attempt's and the attempt's exact `stage-deploy` key, leave `env:staging` held; a record of another attempt without the key that targets another environment (`production`) does not keep `env:staging` (the same record targeting `staging` keeps it since R12, which acceptance 13 covers); an `UNKNOWN` deploy past the reconciliation grace gives STOP `time` with the lease held, and a further `next` leaves it so. A terminal attempt with no ledger record at all releases. On main every unresolved case passes (main releases nothing at a terminal attempt) and the last case, the release with no ledger record, fails. [R2] [R4] [dod arm 1]

### 5
Same file, "only the attempt's own lease of this session and host is released": a lease with no `operation`, one with `release:<other attempt>` (fails on main at CLOSE, which releases it), one of another session, one of this session's id on another host, a released one and an absent one are left as they are; an expired lease of this session is released; an attempt whose `environment` is `Staging` releases the lease under `env:staging`; the `target` of a record that belongs to the attempt only by its key adds its environment's lease. [R3] [R6] [dod arm 1]

### 6
Same file, "a renewal for another attempt that lands before the cleanup takes the lock keeps the lease": a lease store wrapper whose `update` for `env:staging` first renews the lease by this session with `operation` `release:<other attempt>` and then runs the real section; after DONE the lease is held with that operation and its generation unchanged. It fails on main, where no lease section runs after DONE, so the injected renewal never happens and the test's own check that it landed fails; it passes with this card, and it fails against a cleanup that reads the lease and then calls `LeaseStore.release` (the revert check of `hygiene` runs that variant). [R3] [dod arm 1]

### 7
Same file, "a lease cleanup that fails leaves the attempt terminal, releases the other leases and names the command that retries it": with `env:staging` and `env:production` both held by a delivered production attempt, a lease store whose `update` throws once for `env:staging` gives the `done` directive with a narration holding `env:staging`, the error message and `aidlc release next <attemptId>`, `env:production` released and the stored attempt `DONE`; the next `next` releases `env:staging`. A malformed `env:staging` lease file gives the same narration with the store error and leaves the attempt terminal. Passes and fails on main. [R5] [dod arm 1]

### 8
Same file, "aidlc release next run twice on a stopped attempt exits 0 both times": the CLI, run as `node src/cli/main.ts` with `AIDLC_SESSION` set and a lease written for that session and this host, on an attempt stored in STOP: the first run reports `release-result` and stops the goal, the second skips the report, both exit 0, and the lease is released. Fails on main (the second run exits 1 with `goal ... is terminal`). [R5] [R7] [dod arm 1]

### 9
`tests/scenarios/release.test.ts`, `tests/scenarios/release-publication.test.ts`, `tests/scenarios/release-reissue.test.ts` and `tests/infra/lease.test.ts` pass unchanged (lease.test.ts:28-33 pins that `claim` renews in place with a new `operation`, :40 the expired report, :101 release and re-acquisition, :122 the locked refusals). [R3] [R8] [dod arm 1]

### 10
docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md state the facts R9 names (reviewer-verified against the diff). [R9]

### 11
Same file, "an intent recorded around the cleanup is seen by its lease section or never recorded for a released lease": through wrapper seams and no timer, (a) an `intended` or a `running` record of the attempt written between the cleanup's first read and its section of `env:staging` keeps the lease; (b) a caller with a STAGE copy of the attempt whose `issue` runs after the cleanup released the lease, after a renewal for another attempt, or after the lease file was removed records no intent, runs no command and gets the wait on `environment:<name>`; (c) a ledger that becomes unreadable at the first key keeps every lease and at the second key keeps that lease and the ones after it. Fails at the candidate c2108334 (`intended with env:staging released`). [R5] [R10] [dod arm 1]

### 12
Same file, "the admission and the cleanup of one attempt never interleave across two environments": through wrapper seams and no timer, a caller with a RECOVER copy of the attempt whose `issue` for production is reached while the cleanup holds the attempt section (after it released `env:production`, before it decides `env:staging`) records no intent and runs no command until the cleanup has ended, and after it the admission rule of R10 applies; the reverse order (the admission holds the attempt section, the cleanup is refused as a failed section of R5 and releases nothing). Fails at the candidate 78e403e7. [R11] [dod arm 1]

### 13
Same file, "another attempt's unresolved operation on the environment keeps its lease": attempt A issues an asynchronous staging deploy that stays `running`; attempt B of the same session claims staging (the lease now names `release:B`) and its deploy fails; B's cleanup keeps `env:staging`, and the same for A's record `intended`, `issued` and `UNKNOWN` and for a record of another goal that targets staging; after A's operation is `succeeded`, `aidlc release next <B>` releases the lease, and A's own cleanup leaves a lease that names B unchanged. A record that targets another environment and belongs to another attempt does not keep the lease. Fails at the candidate 78e403e7 (`running with env:staging released`). [R12] [dod arm 1]

### 14
Same file, "a ledger entry that is listed and cannot be read keeps every lease": an operations directory holding an entry that is not JSON, one that fails the `OperationRecord` schema, and (POSIX only, skipped on Windows and for uid 0, mode restored in a `finally`) a directory with read and no search permission, each give the unreadable-ledger result of R5 and release nothing; an operations directory that does not exist releases the leases. [R13] [R5] [dod arm 1]

### 15
Same file, "an attempt without an environment is issued as on main, every time": an attempt whose `environment` is `''` and one where it is absent, at STAGE: three `next` calls in a row give the result main gives (stated in the test name), never a wait on `environment:`. [R14] [dod arm 1]

### 16
Same file, "the stops T0-RELEASE-REPORT-STEP added release the leases": a failed `stage-verify` report and a failed `recover-verify` report each end in STOP with the attempt's leases released by the exit of R1, and each case fails when that exit or its release write is removed. The third stop T0-RELEASE-REPORT-STEP added, a failed `package-run-proof`, is not a case: a package attempt returns from PREPARE on every call and never enters STAGE, APPLY or RECOVER, the only states in which a step claims an environment lease, so that stop has no lease to release and a test of it would pass without this card. (T0-RELEASE-REPORT-STEP merged before this card as PR 276; ruling of 2026-11-12 on the candidate c34826bd.) [R1] [dod arm 1]

### 17
Same file, five proofs the pre-review of 4f117f50 found missing, each failing under the revert named: (a) "an unresolved record of the attempt on another environment keeps every lease": a delivered production attempt holds `env:staging` and `env:production`, a record that belongs to the attempt (once by `releaseAttempt`, once by the exact step key with `releaseAttempt` absent) targets production and is `running`; both leases stay held, and the test fails when `releaseOperationOf(o, attempt)` is removed from the in-section check while the target comparison stays [R2] [R4]; (b) "two spellings of one environment are one lease": attempt A's operation is `running` on `ops\prod`, attempt B of the same session claims `ops/prod` and its deploy fails; B's cleanup keeps the lease; fails at 4f117f50 [R12]; (c) the refusal of R10 leaves the goal journal unchanged (the event count before and after the refused `next` is equal) [R10]; (d) no lease file exists for `release-attempt:<attemptId>` after a cleanup and after an admission (`LeaseStore.file` of that key is absent), and the test fails when the attempt section's change returns a record [R11]; (e) "a name that is not a ledger entry is not read": with a file `op-x.json.tmp-1-abcdef12` and a file `op-bad.JSON`, both holding text that is not JSON, the cleanup releases the lease; with a malformed `op-bad.json` it keeps it by R5 [R13]. The child process of the CLI case of this file also removes `NODE_OPTIONS` from its environment, and each POSIX-only case is a named subtest that skips on Windows, and as root, with its reason. [dod arm 1]

## Attempt evidence

History: this card carries the candidate `6ab7a126` of its predecessor T0-STAGING-LEASE-RELEASE (branch T0-STAGING-LEASE-RELEASE, PR 277), which passed the formal review and stopped for ci at SHIP. The evidence of that card follows as it stood at `6ab7a126`, its headings one level down; every figure in it was measured on the branch T0-STAGING-LEASE-RELEASE at the commit its note names, none on this branch. This card's own figures are in the last section.

### Predecessor T0-STAGING-LEASE-RELEASE


Attempt 1 (effort high), base `6b506343`.

Measured on the branch T0-STAGING-LEASE-RELEASE: the RED figures at `76133640`, the DoD, doc-reading run and revert check at the candidate `02120801` (Windows), the coordinator's Linux run at `5342036f`.

RED commit `76133640` (the test file alone, sources of main): 8 tests, 0 pass, 8 fail. First failing assertion per test:

| Test | First failing assertion on main |
|---|---|
| 1 staging DONE | `fx.leases.claim(env:staging, actorB)` after the TTL: `'expired' !== 'acquired'` (main leaves the lease unreleased) |
| 2 production delivered | `{ staging: false, production: true }` vs `{ staging: true, production: true }` (main releases only `env:production` at CLOSE) |
| 3 every terminal path | `failed staging deploy`: `false !== true` (STOP release-health leaves `env:staging` held) |
| 4 unresolved keeps | `a terminal attempt with no ledger record`: `false !== true`; every unresolved case before it passes on main |
| 5 own lease only | `no operation`: `released: true` vs `released: false` (main's CLOSE releases it) |
| 6 renewal race | `the renewal for another attempt landed after the attempt was saved DONE` (no lease section runs after DONE on main) |
| 7 cleanup fails | narration `Release delivered to production; final state for production is OBSERVE.` lacks `env:staging` |
| 8 CLI twice | second run: `aidlc: goal ... is terminal (STOP); ...`, `1 !== 0` |

Commit `5535c09d` corrects the test helper `hold` to return the lease as read from the store: `claim` returns `operation: undefined` as a key, which the stored record omits, so test 5 compared unequal for that reason too; after the correction test 5 still fails on main at `released: true` vs `released: false` (checked by running it against the sources of main). The GREEN commit adds the cases the revert check asked for (below) and the input-class cases.

Two statements of the card that the tests cannot meet as written, reported, not worked around:
- Acceptance 4 says "Passes" (on main), but it also requires "A terminal attempt with no ledger record at all releases", which main does not do; every other case of item 4 passes on main.
- Acceptance 6 says it "passes on main only because main releases nothing at DONE". The renewal is made by the lease store wrapper inside the first `env:staging` section that runs after the attempt is saved terminal; main runs no lease section after DONE, so the renewal never happens and the assertion that it landed (and the `operation` assertion after it) fails on main. The test does fail against the read-then-`LeaseStore.release` variant (revert row M12).

Reading of the card: R5 names a lease section that throws. A ledger that cannot be read (a malformed record under `operations/`) is read before any lease section; the exit then keeps every lease (R2 cannot show that no unresolved record exists, and `forbid` bars releasing while one may) and gives the narration of R5 with `operation ledger`, the store error and `aidlc release next <attemptId>`, instead of throwing out of `next` for an attempt that is already terminal. Test 7, last case.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/release-lease.test.ts` "a staging attempt that ends in DONE releases env:staging, and another session then acquires it" | pass; fails on main |
| 2 | same file, "a delivered production attempt releases the staging and the production lease it claimed" (also: `env:staging` held at CHECKPOINT, both held at OBSERVE) | pass; fails on main |
| 3 | same file, "every terminal path passes the one exit": failed staging deploy, publishing deploy without production authority, ownership STOP at APPLY (own `env:staging` released, other session's `env:production` deep-equal to before), stored STOP, stored DONE | pass; fails on main |
| 4 | same file, "an attempt with an unresolved operation keeps its leases": 4 statuses x 3 associations (`releaseAttempt`, key only, key with another attempt's `releaseAttempt`) x stored STOP and DONE; UNKNOWN past the grace gives STOP `time` with the lease held, twice; no record releases | pass; the no-record case fails on main |
| 5 | same file, "only the attempt's own lease of this session and host is released": stored CLOSE production attempt with each lease class; unchanged leases are not written (file modification time kept); `Staging`; key-only record target | pass; fails on main |
| 6 | same file, "a renewal for another attempt that lands before the cleanup takes the lock keeps the lease" | pass; fails on main (see above) |
| 7 | same file, "a lease cleanup that fails leaves the attempt terminal, releases the other leases and names the command that retries it": throw once for `env:staging`, then retry; a nested STOP named once; malformed file; file that is not a lease; held lock (`LOCKED`, `timeoutMs` 50) then retry; unreadable ledger | pass; fails on main |
| 8 | same file, "aidlc release next run twice on a stopped attempt exits 0 both times" | pass; fails on main |
| 9 | `tests/scenarios/release.test.ts`, `release-publication.test.ts`, `release-reissue.test.ts`, `tests/infra/lease.test.ts`, unchanged | pass (DoD) |
| 10 | docs/OPERATIONS.md (Standalone release, paragraph after the `aidlc ops reconcile` paragraph), docs/ARCHITECTURE.md (paragraph after the `finalStateForTarget` paragraph below the release diagram), CHANGELOG.md (Unreleased, directly above `- T0-SCAN-SETUP-STEP-2`) | for the reviewer |

Per-hunk revert check (each hunk reverted alone in the worktree, `node --test tests/scenarios/release-lease.test.ts`, restored):

| Hunk (requirement) | Reverted to | Test and first failing assertion | Result |
|---|---|---|---|
| M1 exit in public `next` (R1) | `return this.step(goal, attempt)` | all 8 tests, e.g. test 1 `'expired' !== 'acquired'` | red, 8 of 8 |
| M2 nested steps call the step logic (R1) | the seven nested calls go through `next` | test 7 `a nested STOP is cleaned up at the exit alone` (the inner exit's failure was retried by the outer one) | red |
| M3 exit acts on DONE or STOP only (R1, R2) | the state check removed | test 2 `env:staging stays held while the attempt waits at CHECKPOINT` | red |
| M4 unreadable ledger keeps the leases (R4 reading) | the error rethrown | test 7 `MALFORMED_JSON ... op-unreadable.json` thrown | red |
| M5 unresolved record keeps the leases (R2, R4) | the check removed | test 4 `intended, releaseAttempt, STOP` | red |
| M6a lease not released (R3) | condition removed | test 5 `released: not written` (modification time changed) | red |
| M6b `operation` is `release:<attemptId>` (R3) | condition removed | test 5 `no operation`; test 6 deep-equal (lease released) | red |
| M6c owner session (R3) | condition removed | test 5 `another session` | red |
| M6d owner host (R3) | condition removed | test 5 `this session on another host` | red |
| M7 keys from the records' `target` (R3) | attempt environment only | tests 2, 3 (`ownership stop at APPLY: own env:staging`), 5 (`the target of a record that belongs by its key`), 7 | red |
| M7b key by `resourceKeys.environment` (R3) | `` `env:${name}` `` | test 5 `environment Staging is named by the key env:staging` (the lease file name is case-insensitive, so the key text is the observable) | red |
| M8 a failed section does not stop the other keys (R5) | the error rethrown | tests 5 and 7 (`lease section unavailable` thrown) | red |
| M9 failure named with the retry command (R5) | `return out` | tests 5 and 7 (narration without `env:staging`) | red |
| M10 CLOSE release removed (R6) | the main CLOSE block restored | test 5 `no operation` (`released: true`) | red |
| M11 report only for a goal that is not terminal (R7) | condition removed | test 8, second run `goal ... is terminal (STOP)`, `1 !== 0` | red |
| M12 variant: read the lease, then `LeaseStore.release` (R3, acceptance 6) | the section replaced by `read` + `release(key, generation)` | test 6 deep-equal (the renewed lease was released) | red |

Every row is red. The input-class cases added after this run (a `succeeded`, `failed` or `cancelled` record releases, an unresolved record that does not belong releases, an `operation` of the attempt id with a suffix is kept, no environment and no record names nothing) guard against a widened predicate (a terminal status in the unresolved list, an association without `releaseOperationOf`, a prefix match on `operation`), not against a removed hunk.

Input classes of the new predicates:

| Predicate | Class | Test |
|---|---|---|
| exit applies (state) | DONE, STOP | 3 (stored STOP and DONE, nested STOPs), 1, 2 |
| | a non-terminal return (CHECKPOINT, OBSERVE) | 2 (leases held) |
| unresolved record | `intended`, `issued`, `running`, `UNKNOWN` | 4 |
| | `succeeded`, `failed`, `cancelled` | 4 (terminal statuses release) |
| | belongs by `releaseAttempt`; by key with `releaseAttempt` absent; by key with another attempt's | 4 |
| | an unresolved record that does not belong (another attempt, no key) | 4 (releases) |
| | no record | 4 |
| | ledger unreadable | 7 |
| lease is the attempt's own (`mine`) | absent; released; no `operation`; `release:<other attempt>`; `release:<attemptId>` plus a suffix | 5 |
| | another session; this session on another host; expired of this session | 5 |
| keys | attempt environment; record target by `releaseAttempt`; record target by key only; `Staging` lower-cased; duplicate key once | 2, 3, 5, 7 |
| | no environment and no record | 5 |
| report to the goal (R7) | goal not terminal; goal terminal | 8 |

Doc-reading run (Windows): the 78 test files that `grep -rlE "ARCHITECTURE\.md|OPERATIONS\.md|CHANGELOG\.md" tests --include=*.test.ts` lists, in one `node --test` call on the final docs: 1863 tests, 1851 pass, 0 fail, 12 skipped, exit 0. The ARCHITECTURE.md sentence is a paragraph of its own after the `finalStateForTarget` paragraph, outside the `src/coordination/` paragraph that tests/scenarios/op-intent-dup.test.ts:355 pins.

DoD (`npm run typecheck && node --test tests/scenarios/release-lease.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts tests/infra/lease.test.ts`, Windows): exit 0; `tsc -p tsconfig.test.json --noEmit` clean; `# tests 49`, `# pass 49`, `# fail 0`, `# skipped 0` (8 tests in the new file, 41 in the four existing files).

#### Attempt 2 (repair of R3 decision 1)

Measured on the branch T0-STAGING-LEASE-RELEASE at `9ae67885` (RED) and `78e403e7` (the candidate of this attempt: DoD, doc-reading run and revert check, Windows).

RED commit `9ae67885` adds the test "an intent recorded around the cleanup is seen by its lease section or never recorded for a released lease" alone; on the attempt-1 sources it fails at `op-... intended with env:staging released` (the forbid of the card), the other 8 tests pass.

**F1 (stale-ledger-cleanup).** The cleanup decided on a ledger read made before it took the lease lock. Now each key's `LeaseStore.update` section checks ownership (`ownLease`, release-runner.ts:148) and reads the ledger again (:185) before it releases (:190); the first read (:173) only collects the keys and detects an unreadable ledger. `issue` records a step's intent in the section of the same key (T0-RELEASE-OP-REISSUE R4), and now only while `ownLease` holds for that lease (:415-416); otherwise it returns `wait` on `environment:<name>` with nothing recorded, journaled or run (:421). The two sections exclude each other on the one lock file of the key, so either `issue`'s section runs first (the intent is on disk and the cleanup's section sees it and keeps the lease) or the cleanup's runs first (the lease is released, and `issue`'s section finds no lease of the attempt and records nothing). Second-case answer: with the attempt-1 code the second case could leave an operation without a held lease (an `issue` whose `claim` came before the release; test 9 (b) fails there with `op-... running with env:staging released`); `issue` now cannot record an intent for a lease the attempt does not hold. A caller with an older copy of the attempt that claims again after the release re-acquires the lease (`claim` acquires a released lease) and records with that lease held, so the operation still has a held lease; that caller then saves its copy of the attempt over the terminal record, the attempt-record race of every stale caller (no attempt lock), which this card does not change.

Regression (deterministic seams, no timer), test 9: (a) a lease store whose first `env:staging` section first records an `intended` (and, second case, `running`) record of the attempt: the section sees it and the lease stays held; (b) the reverse order: a caller with a STAGE copy of the attempt whose `claim` is followed, before its `issue`, by the cleanup of the stored STOP attempt (and, as further classes, by a renewal of this session for another attempt and by the removal of the lease file): `wait` on `environment:staging`, no ledger record, no command run; (c) a ledger that becomes unreadable at the first or the second section. Revert rows A1 (unresolved check on the first read, the asked-for revert), A1b, A2, A2b, A3, A4, A6 and M12 fail it.

Class sweep, every read the cleanup makes before it takes a lock, and every place in `next` that decides on a ledger read and then writes a lease:

| Read or site | Why it cannot go stale, or what changed |
|---|---|
| attempt record (`out.attempt`: id, goalId, environment, DONE or STOP) | It selects the keys and whether the exit runs; it is never a reason to release. Release needs `ownLease` and a ledger read inside the section, and `issue` records only under the same check, so a stale attempt record cannot release a lease under an operation. |
| first ledger read (:173; R3 targets) | Collects keys only. A record recorded later carries the target of a lease its `issue` held in that key's section: a key missing from the set is not touched (lease kept), a key in the set is re-read in its section. A failed read keeps every lease (R5). |
| lease record | Never read outside the section: no `read` before `update`; the CLOSE `read` + `release` is removed (R6). |
| `currentActor()` | Cached for the process; not state another writer changes. |
| step's `claim` (:232) after the ledger reads at :207, :224, :227 | `claim` only acquires or renews, never releases; a stale read can only leave the lease held. |
| `issue` (:414-420) | Ledger read and intent in one section of the key (T0-RELEASE-OP-REISSUE), now also the ownership check. |
| reconcile loop (:207-213), step sync, `settleStep` | Write the ledger or the attempt, never a lease. |
| `grep -n "leases\." src/loop/release-runner.ts` | Three sites: the cleanup section (:182), `claim` (:232), `issue`'s section (:414). No other lease write. |

**F2, F3 (ledger-failure-docs).** docs/OPERATIONS.md and CHANGELOG.md said an unreadable ledger lets the other leases go on and names a lease key. Rewritten as separate cases. The code: a failed first read keeps every lease and names `the operation ledger`, the store error, `every environment lease of the attempt kept` and the retry (test 7, last case); a failed read inside a section keeps that lease and every later key and names them (test 9 (c), both orders); a failed lease section lets the other keys go on and names the key, the error and the retry (test 7), and when both happen the narration names both (test 9, last case). Every sentence the card added to the three documents was checked against the code and a test:

| Sentence (docs/OPERATIONS.md, Standalone release) | Code | Test |
|---|---|---|
| keys: environment and record targets; production releases `env:staging` too | :178 | 2, 5 (key-only target) |
| one section per lease checks the lease and reads the ledger again; conditions | :182-190, :148-151 | 4, 5, 9 |
| any other lease is left as it is and not written | :183, :185 return the record | 5 (modification time) |
| unresolved record (STOP/time included) keeps the leases | :185 | 4 |
| a step records its intent only while the attempt holds the lease, else `wait` on `environment:<name>` | :415-416, :421 | 9 (b) |
| a failed lease section: other leases go on, narration key, error, retry | :191-194, finish | 7 |
| ledger cannot be read: no further release; first read keeps every lease; in-section read keeps that one and later; narration | :172-176, :186-188, :195 | 7 (last case), 9 (c) |
| `release-result` only for a goal that is not terminal | main.ts:1137 | 8 |
| no command takes over another session's environment lease; STOP/ownership; only the owner session releases it | `claim` (lease.ts:74, unchanged), `ownLease` session and host | 3 (ownership case), 5 (another session) |
| ARCHITECTURE.md: one exit; each lease in its own section that re-reads the ledger; `issue` records only while holding the lease | :144, :182-190, :415 | 1-3, 9 |
| CHANGELOG.md: same facts plus R6 (CLOSE release removed) and R7 | as above, CLOSE case :345 | 5 (`no operation`), 8 |

Clause table (amended card):

| Clause | Code | Test that fails without it (revert row) |
|---|---|---|
| R1 one exit for every return | :144 | all 9 (M1) |
| R1 nested calls go to the step logic | :265, :281, :295, :307, :365, :400, :446 | 7 nested STOP (M2) |
| R1 exit acts on DONE or STOP only | :162 | 2 held at CHECKPOINT (M3) |
| R1 every terminal path (release-health, release-auth, ownership, audit of `issue`, stored STOP, DONE) | :144 | 3 (M1) |
| R2 no unresolved record (by `releaseOperationOf`) before release | :164, :185 | 4, 9 (A1, A1b) |
| R3 keys from environment and record targets | :178 | 2, 3, 5, 7 (M7) |
| R3 key built by `resourceKeys.environment` | :178 | 5 Staging narration (M7b) |
| R3 decide and write in one `update` section; not `LeaseStore.release` | :182-190 | 6, 9 (M12) |
| R3 not released / operation / session / host; expired included | :150 | 5, 6, 9 (M6a, M6b, M6c, M6d, A8) |
| R3 otherwise unchanged, nothing written | :183, :185 | 5 (M6a) |
| R4 unresolved record keeps every lease, STOP time included | :185 | 4 (A1b) |
| R5 failed section: other keys go on, narration key, error, retry | :191-194, :166-170 | 5, 7, 9 (M8, M9) |
| R5 unreadable ledger keeps the leases, nothing thrown, narration names it | :172-176, :186-188, :195 | 7, 9 (A3, A4, A5, A6) |
| F1 `issue` records only while holding the lease | :415-416, :421 | 9 (b) (A2, A2b) |
| R6 CLOSE release removed | :345 | 5 `no operation` (M10) |
| R7 report only for a goal that is not terminal | main.ts:1137 | 8 (M11) |
| R8 `reportStep` without a release | no code (unchanged) | release.test.ts package proof, unchanged |
| R9 docs | docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md | doc-reading run; for the reviewer |

Attempt 2 revert check (each hunk alone, `node --test tests/scenarios/release-lease.test.ts`, restored); 23 rows, every row red:

| Hunk | Reverted to | First failing test and assertion |
|---|---|---|
| A1 in-section unresolved check | decided on the first read | 9 `op-... intended with env:staging released` |
| A1b in-section unresolved check | removed | 4 `intended, releaseAttempt, STOP`; 9 |
| A2 `issue` ownership check | `held = true` | 9 `op-... running with env:staging released` |
| A2b `issue`'s not-held `wait` | removed | 9 `Cannot read properties of undefined (reading 'id')` |
| A3 in-section ledger error caught | rethrown | 9 (narration names a lease failure, not the ledger) |
| A4 loop stops at a ledger error | goes on | 9 (no ledger narration) |
| A5 first ledger read caught | rethrown | 7 `MALFORMED_JSON` thrown |
| A6 kept keys from the failing one | all keys | 9 (c) second order |
| A8 cleanup ownership check | removed | 3 the other session lease; 5 `no operation`; 6 |
| M1 exit | `return this.step(...)` | 9 of 9 |
| M2 nested steps | through `next` | 7 `a nested STOP is cleaned up at the exit alone` |
| M3 terminal check | removed | 2 `env:staging stays held while the attempt waits at CHECKPOINT` |
| M6a not released | removed | 5 `released: not written`; 9 |
| M6b operation | removed | 5 `no operation`; 6; 9 renewal for another attempt |
| M6c session | removed | 5 `another session` |
| M6d host | removed | 5 `this session on another host` |
| M7 record targets | environment only | 2, 3, 5, 7, 9 |
| M7b key builder | `` `env:${name}` `` | 5 Staging narration |
| M8 per-key catch | rethrown | 5, 7, 9 |
| M9 failure narration | removed | 5, 7, 9 |
| M10 CLOSE release | restored | 5 `no operation` |
| M11 R7 | condition removed | 8 `goal ... is terminal (STOP)` |
| M12 read, then `LeaseStore.release` | variant | 6; 9 `intended with env:staging released` |

Doc-reading run (Windows), on the final documents: the 78 test files that read docs/ARCHITECTURE.md, docs/OPERATIONS.md or CHANGELOG.md, in one `node --test` call: 1863 tests, 1851 pass, 0 fail, 12 skipped, exit 0.

DoD (`dod_command` exactly, Windows): exit 0; typecheck clean; `# tests 50`, `# pass 50`, `# fail 0`, `# skipped 0` (9 tests in tests/scenarios/release-lease.test.ts, 41 in the four existing files).

#### Attempt 3 (redesign: R11 to R14 after the pre-review of 78e403e7)

Measured on the branch T0-STAGING-LEASE-RELEASE: "the GREEN commit" and "the GREEN working tree" of this attempt are `43a50ec7` (DoD, doc-reading run and revert check, Windows; the Linux run under WSL); the RED figures at `b668608e`.

Base: merge of origin/main `6069047e` (no change to src/loop/release-runner.ts or src/cli/main.ts from main). RED commit `b668608e` adds acceptance 12 to 15 alone (with the fixture hygiene below); the sources there are those of 78e403e7. First failing assertion per new test at `b668608e`, Windows:

| Acceptance | Test | First failing assertion at b668608e (sources of 78e403e7) |
|---|---|---|
| 12 | "the admission and the cleanup of one attempt never interleave across two environments" | `nothing admitted while the cleanup holds the attempt section`: `{ runs: 1, rollbacks: 1 }` instead of `{ runs: 0, rollbacks: 0 }` |
| 13 | "another attempt's unresolved operation on the environment keeps its lease" | `running with env:staging released` |
| 14 | "a ledger entry that is listed and cannot be read keeps every lease" | narration `Release attempt delivered.` without the ledger note, at the entry whose link target is gone (the list drops it); the not-JSON and schema entries already failed the read there |
| 15 | "an attempt without an environment is issued as on main, every time: next throws before any intent, a schema error on target for '' and a TypeError for an absent environment" | `Missing expected exception: empty, call 1` (78e403e7 returns the wait on `environment:`) |

Acceptance 16 is not built: T0-RELEASE-REPORT-STEP is not on main (coordinator's instruction); it is added after that card merges.

**Lock order (R11).** Cleanup (`releaseLeases`, release-runner.ts:201-260 at the GREEN commit): the strict first ledger read (:219), then, when the attempt names an environment, `attemptSection` (:156-161, `LeaseStore.update('release-attempt:<attemptId>')` whose change returns what it received) around `releaseEach` (:254); inside it one key at a time: `this.leases.update(key, …)` (:231), in which `ownLease` (:232) and the strict ledger read (:234) decide (:239); the section closes before the next key's opens. Admission (`issue`, :480-497): `attemptSection` (:489), inside it `this.leases.update(resourceKeys.environment(environment), …)` (:490), in which `ownLease` (:491) and, only when it holds, the step's ledger read and `recordIntent` run; the journal append and the command come after both sections. No lock is taken inside a key section (the ledger writes are atomic renames without a lock; no journal append happens inside). An attempt without an environment takes no attempt section (R14): the cleanup runs its key sections directly (:251), the admission runs the section as on main (:480-487).

**R14, what main does** (probe on origin/main's release-runner.ts, an attempt stored at STAGE with the bound deploy of `opsConfigured()`): `environment: ''` throws a `ZodError` on `target` (too small) from `recordIntent` inside the `env:` section, no record, no command, each of three calls; `environment` absent throws `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` from `resourceKeys.environment`, each call. The card keeps both (test 15, with a held `release-attempt:` lock that changes nothing). With an unbound deploy or a publication without authority an empty environment records no intent and reaches the same STOP as on main.

**R12 and an earlier test of this card.** Test 4's case "an unresolved record of another attempt, without the key, releases" (attempt 1) contradicts R12 when the record targets the same environment; the case now gives the record the target `production` (another environment), where R12 still releases; the same-environment class is acceptance 13.

**Errors of the reads the change relies on** (`strictLedger`, :168-191): operations directory ENOENT: empty ledger (test 14, last case); ENOTDIR (a regular file at the path; on POSIX also a path under a regular file) and EACCES (no read permission): `StoreError READ_FAILED`, every lease kept (test 14, regular-file case; POSIX case without read permission). An entry: ENOENT (a link whose target is gone), EACCES (no read permission, or a directory without search permission), EISDIR: `READ_FAILED`; not JSON: `MALFORMED_JSON`; schema: `SCHEMA_VIOLATION`; each keeps every lease (first read) or the remaining ones (read in a section), named in the narration. Nothing is thrown out of `next` for a terminal attempt; a held attempt section (`LOCKED`) is a failed section (R11). The admission's held attempt section throws the store's `LOCKED` error out of `next`, as a held environment section did before (T0-RELEASE-OP-REISSUE R4).

**Test hygiene.** Every fixture is `makeFixture()` in `inFixture(t, …)`, removed by `t.after(() => cleanup(fx.tmp))` with `cleanup` from tests/infra/helpers.ts; no `fx.cleanup()`, no `mkdtempSync`, no `tmpDir` needed. The CLI child of acceptance 8 runs with `process.execPath`, without any inherited variable whose upper-cased name starts with `GIT_`, and with `GIT_CEILING_DIRECTORIES` the fixture's parent; it does not commit.

| Temporary directory or path | Created | Removed |
|---|---|---|
| fixture root `fx.tmp` (every test) | `makeFixture()` (tests/scenarios/_harness.ts) in `inFixture` | `t.after(() => cleanup(fx.tmp))` |
| `<operations>-moved` (test 14) | `renameSync` inside `fx.tmp` | with `fx.tmp` |
| planted lock files `<lease file>.lock` (tests 7, 12, 15) | `writeFileSync` inside `fx.tmp` | test 7 removes its planted lock file with `rmSync(lock)` (a file the test wrote, to show the retry); the others with `fx.tmp` |
| lease file `env:staging` (test 11 (b), `removed` case) | written by `claim` inside `fx.tmp` | `rmSync(fx.leases.file(STAGING))`: a file, the intervention under test |

POSIX-only cases (test 14: operations directory mode `0o600` and `0o300`, an entry mode `0o000`) are skipped on Windows and for uid 0 and restore the mode in a `finally`. Linux run (WSL, Node v22.23.1, uid 1000) of tests/scenarios/release-lease.test.ts on the GREEN working tree: tests 13, pass 13, fail 0, skipped 0.

Clause table (R1 to R14):

| Clause | Code (GREEN commit) | Test that fails without it (revert row) |
|---|---|---|
| R1 one exit | :146 | 12 of 13 (M1) |
| R1 nested calls to the step logic | `this.step(` calls in `step`, `recoverOrStop`, `settleStep`, `issue` | 7 nested STOP (M2) |
| R1 exit on DONE or STOP only | :203 | 2 held at CHECKPOINT (M3) |
| R2 no unresolved record of the attempt | :234, :239 | 4, 11, 13 (A1b) |
| R3 keys from environment and record targets | :225 | 2, 3, 5, 7, 11, 12 (M7) |
| R3 key built by `resourceKeys.environment` | :225 | 5 (M7b) |
| R3 decide and write in the key section; no `LeaseStore.release` | :231-240 | 6, 11 (M12) |
| R3 ownership conditions | :150-153, :232 | 3, 5, 6, 11, 13 (M6a-d, A8) |
| R4 unresolved record keeps every lease | :239 | 4 (A1b) |
| R5 failed key section: others go on, narration | :242, :211 | 5, 7, 11 (M8, M9) |
| R5 unreadable ledger: first read keeps all; in-section read keeps the rest; narration | :219-222, :236, :244-247 | 7, 11, 14 (A3, A4, A5, A6) |
| R6 CLOSE release removed | :407 | 5 (M10) |
| R7 report only for a goal that is not terminal | main.ts:1137 | 8 (M11) |
| R8 `reportStep` without a release | no code | release.test.ts unchanged |
| R9 docs | docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md | doc table below; reviewer |
| R10 in-section ledger read decides | :234 | 11 (A1) |
| R10 admission only while the lease is the attempt's own; else wait | :491-497 | 11, 12 (A2, A2b) |
| R11 cleanup inside the attempt section | :254 | 12 (B1) |
| R11 ORDER: attempt section before the key sections (cleanup) | :254 around :231 | 12 (B1b: attempt section after the keys) |
| R11 ORDER: one key section at a time | :229-249 | 12 (B1c: second key nested in the first) |
| R11 admission inside the attempt section | :489 | 12 reverse order (B2) |
| R11 ORDER: attempt section before the environment section (admission) | :489-490 | 12 admission-order case (B2b) |
| R11 held attempt section is a failed section, nothing released | :255-257 | 12 reverse order (M8b) |
| R12 record targeting the environment keeps the lease | :234 | 13 (B4) |
| R12 names compared by `resourceKeys.environment` | :234 | 13 `STAGING` case (B4b) |
| R12 kept lease named with the retry command | :212, :248 | 13 (B5) |
| R13 strict read | :168-191 | 14 link case (B6) |
| R13 missing directory is empty | :174 | 14 (B6b) |
| R13 schema and parse errors fail the read | :185, :188 | 14 (B6c, B6d) |
| R14 admission without environment as on main | :480-487 | 15 (B7) |
| R14 cleanup without environment takes no attempt section | :251 | 12 environment-less case (B7b) |

Revert check of attempt 3 (each hunk alone in the worktree, `node --test tests/scenarios/release-lease.test.ts`, restored; Windows; on the GREEN working tree): 38 rows, every row red.

| Row | Reverted to | First failing test and assertion |
|---|---|---|
| B1 | cleanup without the attempt section | 12 `nothing admitted while the cleanup holds the attempt section` |
| B1b | attempt section after the keys | 12 same |
| B1c | second key's section nested in the first | 12 `the cleanup had released env:production when the admission came`; 7; 11 |
| B2 | admission without the attempt section | 12 same as B1 |
| B2b | admission: environment section first | 12 `the cleanup met no section of the admission` |
| B4 | per-environment check removed | 13 `running with env:staging released` |
| B4b | raw target compared | 13 `running, its target spelled STAGING with env:staging released` |
| B5 | kept-lease narration removed | 13 narration `staging deployment failed` |
| B6 | `OperationLedger.list` instead of the strict read | 14 `Release attempt delivered.` (link case) |
| B6b | missing directory not empty | 14 `an operations directory that does not exist is an empty ledger` |
| B6c | schema check removed | 14 schema case (code) |
| B6d | parse error read as `READ_FAILED` | 7, 11, 14 (`MALFORMED_JSON`) |
| B7 | admission without environment takes the sections | 15 `empty, call 1` |
| B7b | cleanup without environment takes the attempt section | 12 environment-less case |
| A1 | decided on the first read | 11 `intended with env:staging released`; 13 |
| A1b | in-section check removed | 4, 11, 13 |
| A2 | issue records without the lease | 11 `running with env:staging released`; 12 |
| A2b | not-held wait removed | 11, 12 (`Cannot read properties of undefined (reading 'id')`) |
| A3 | in-section ledger error rethrown | 11 |
| A4 | loop goes on after a ledger error | 11 |
| A5 | first read rethrown | 7, 14 (`MALFORMED_JSON` thrown) |
| A6 | all keys named as kept | 11 |
| A8 | cleanup ownership check removed | 3, 5, 6, 13 |
| M1 | exit removed | 12 of 13 |
| M2 | nested steps through `next` | 7 |
| M3 | terminal check removed | 2 |
| M6a | not-released condition removed | 5, 11, 12 |
| M6b | operation condition removed | 5, 6, 11, 13 |
| M6c | session condition removed | 5 |
| M6d | host condition removed | 5 |
| M7 | record targets removed | 2, 3, 5, 7, 11, 12 |
| M7b | `` `env:${name}` `` | 5 |
| M8 | key-section failure rethrown | 5, 7, 11 |
| M8b | attempt-section failure rethrown | 12 (`LOCKED` thrown) |
| M9 | failure narration removed | 5, 7, 11, 12 |
| M10 | CLOSE release restored | 5 |
| M11 | R7 condition removed | 8 |
| M12 | read, then `LeaseStore.release` | 6, 11 |

Forbid and non-goals:

| Entry | Where it is kept | Proof |
|---|---|---|
| forbid: weakening or skipping a test | none weakened; test 4's other-attempt case moved to another environment because R12 supersedes it (above) | diff of the test file |
| forbid: releasing while the ledger read in the section holds an unresolved record of the attempt or targeting the environment | :234, :239 | 4, 11, 13 |
| forbid: releasing another session's, host's or attempt's lease | `ownLease` :150-153 | 5, 6 |
| forbid: deciding a release outside the lease's section | :231-240 | 6, 11 (M12) |
| forbid: change to src/coordination/lease.ts | `git diff origin/main -- src/coordination` empty | |
| forbid: editing .aidlc state by hand | no command against the repository state | |
| non-goal: a status write after the section's read | not handled; the section decides on its own read | stated |
| non-goal: a takeover command | none added | |
| non-goal: staging release when a production attempt leaves STAGE | staging stays held | 2 (held at CHECKPOINT and OBSERVE) |
| non-goal: renewing leases at CHECKPOINT or OBSERVE | not done | |
| non-goals: `release-result` by hand, the `pending` disposition, leases of attempts terminal before this card, `.claude/skills/aidlc-loop/release.md` | untouched | |

Document sentences (docs/OPERATIONS.md, Standalone release; docs/ARCHITECTURE.md after the release diagram; CHANGELOG.md):

| Sentence | Code | Test or clause |
|---|---|---|
| keys: environment and record targets; production releases `env:staging` too | :225 | 2, 5 |
| attempt section (never written, taken when the attempt names an environment), one lease section at a time, conditions incl. records targeting the environment | :156-161, :229-251, :150-153, :234 | 12, 13, 4, 5 |
| any other lease is left and not written | :232, :239 | 5 (modification time) |
| unresolved record of the attempt or another attempt on the environment keeps the leases; narration names them and the retry | :239, :248, :212 | 4, 13 |
| step records only inside both sections while holding the lease; else wait on `environment:<name>`; held attempt section: lock error, nothing recorded | :489-497 | 11, 12 |
| no environment: neither section; error before any intent (always for absent, for empty whenever an intent would be recorded) | :480-487 | 15; R14 probe above |
| failed lease section continues with the other keys; held attempt section releases nothing; narration | :242, :255-257, :211 | 7, 12 |
| strict read; missing directory empty; unreadable ledger releases no further lease; narration | :168-191, :219-222, :236, :244-247 | 7, 11, 14 |
| `release-result` only for a goal that is not terminal | main.ts:1137 | 8 |
| no takeover; STOP/ownership; only the owner session releases, once nothing on the environment is unresolved | lease.ts:74 unchanged, `ownLease`, :234 | 3, 5, 13 |
| CHANGELOG: CLOSE release removed (R6) | :407 | 5 (M10) |

Doc-reading run (Windows, GREEN working tree): the 79 test files that read docs/ARCHITECTURE.md, docs/OPERATIONS.md or CHANGELOG.md (main added one since attempt 2), one `node --test` call: 1870 tests, 1857 pass, 1 fail, 12 skipped. The failure is tests/infra/exec.test.ts "T0-EXEC-TREE-KILL run on real processes"; that file run alone: 61 tests, 61 pass, 0 fail (machine load, a file this card does not change or execute).

DoD (`dod_command` exactly, Windows, GREEN working tree): exit 0; typecheck clean; tail: `# tests 54`, `# suites 1`, `# pass 54`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0` (13 tests in tests/scenarios/release-lease.test.ts, 41 in the four existing files).

Diff against the merge base with main (8e101c4c) at the GREEN commit: 1294 changed lines (+1270 / -24), over the budget of 1100: tests/scenarios/release-lease.test.ts 772, the card 329 (attempt evidence of three attempts), src/loop/release-runner.ts 176, docs/OPERATIONS.md 10, src/cli/main.ts 3, docs/ARCHITECTURE.md 2, CHANGELOG.md 2.

#### Attempt 4 (merge of main with T0-OPS-CWD and T0-RELEASE-REPORT-STEP; acceptance 16)

Measured on the branch T0-STAGING-LEASE-RELEASE: "the commit that adds this section" is `c34826bd`, on the merge `b1b466d5` (DoD and doc-reading run, Windows; the Linux run under WSL; the revert check on the merged working tree).

Merge commit `b1b466d5` (origin/main `a7ea9bc6` into the candidate 43a50ec7). Conflicts, all in src/loop/release-runner.ts, resolved by keeping both sides: the `node:fs` import (main's `statSync` with this card's `readFileSync`, `readdirSync` and `path`); the types and ops imports (main's `operationCwd` with this card's value import of `OperationRecord` and `Lease`); and `issue`'s admission, where main added `directoryExists` to the intent condition inside the environment section and this card had moved that condition into `admit` inside the attempt section: `admit` now records the intent only when the operation directory exists (main's `release-config` STOP after the sections is unchanged). CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md merged without conflict, both sides' sentences kept. main's report-step stops (STAGE, RECOVER, PREPARE) and `prepareNeeds` came in as main has them; their returns pass the exit of R1 unchanged.

Rulings of 2026-11-11 on 43a50ec7 (card f14ef5f3), checked against the candidate, no change needed: R11 (an admission that finds the attempt section held throws `LOCKED` out of `next`, no intent, no command: test 12, first case), R14 (the cleanup of an attempt without an environment takes no attempt section: test 12, environment-less case; `issue` keeps main's throw: test 15), acceptance 4 (the other-attempt record without the key targeting `production` does not keep `env:staging`: test 4; targeting `staging` keeps it: test 13).

**Acceptance 16.** Two tests: "the stops T0-RELEASE-REPORT-STEP added release the leases: a failed stage-verify report" (a staging goal deployed through `next`, which claims `env:staging`; `reportStep` stores `stage-verify` failed; the next `next` gives STOP `release-health` `staging verification failed` and `env:staging` is released) and "…: a failed recover-verify report" (a production attempt stored in RECOVER with `recover` succeeded and a staging record and lease; `reportStep` stores `recover-verify` failed; the next `next` claims `env:production` and gives STOP `release-health` `recovery verification failed`; both leases released). Each fails under M1 (exit removed) and M13 (the release write of the exit removed): `the STOP of a failed stage-verify releases env:staging`, `the STOP of a failed recover-verify releases both leases`. **The failed `package-run-proof` case is not built**: a package attempt never enters STAGE, APPLY or RECOVER, the only states whose step claims an environment lease (`claim` at release-runner.ts:308 at `b1b466d5`), and `issue`, the only writer of a record with an environment target for the attempt, runs only in those states; so no command gives a package attempt a lease the exit could release, and a test of that STOP would pass for another reason. Reported to the coordinator.

Line numbers at the head of this attempt shift from attempt 3 by the merged code: the exit +14 (`next` :160, `ownLease` :164, `attemptSection` :170, `strictLedger` :182, `releaseLeases` :215, first read :233, key section :245, in-section read :248, decision :253, environment skip :265, attempt section :268), `issue` +22 (environment skip :502, attempt section :511, ownership :513, wait :519, intent condition :500), CLOSE :427. The clause and forbid tables of attempt 3 hold with these lines; acceptance 16 adds the row "R1 the report-step STOPs pass the exit: :160 (M1, M13): tests 16a, 16b".

Revert check on the merged working tree (each hunk alone, `node --test tests/scenarios/release-lease.test.ts`, restored, the file compared byte for byte with its copy afterwards): 39 rows (the 38 of attempt 3 and M13 `return open.length ? lease : { ...lease, released: true }` → `return lease`), every row red, none green. Rows that gained a failing test since attempt 3: M1 (14 of 15 fail, both acceptance 16 tests among them), M3 (2: test 2 and acceptance 16 stage-verify, whose lease must stay held at the `stage` directive), M13 (13 of 15, both acceptance 16 tests among them).

Runs at the commit that adds this section (parent `b1b466d5`):
- DoD (`dod_command` exactly, Windows): exit 0; typecheck clean; `# tests 56`, `# suites 1`, `# pass 56`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0` (15 in tests/scenarios/release-lease.test.ts, 41 in the four existing files).
- Linux (WSL, Node v22.23.1, uid 1000), tests/scenarios/release-lease.test.ts: tests 15, pass 15, fail 0, skipped 0.
- The 80 test files that read docs/ARCHITECTURE.md, docs/OPERATIONS.md or CHANGELOG.md, with tests/scenarios/release-report-step.test.ts, tests/scenarios/ops-cwd.test.ts and tests/infra/ops.test.ts (the files of PR 276 and PR 275), one `node --test` call, Windows: 1895 tests, 1883 pass, 0 fail, 12 skipped, exit 0.
- Diff against the merge base with main (a7ea9bc6): 1341 changed lines (+1317 / -24), within the budget of 1420: tests/scenarios/release-lease.test.ts 801, the card 347, src/loop/release-runner.ts 176, docs/OPERATIONS.md 10, src/cli/main.ts 3, docs/ARCHITECTURE.md 2, CHANGELOG.md 2.

#### Attempt 5 (repair of the pre-review of 4f117f50; acceptance 17)

Measured on the branch T0-STAGING-LEASE-RELEASE: "the commit that adds this section" and "the head of this attempt" are `e40e45ed` (DoD, doc-reading run and revert check, Windows; the Linux run under WSL); the RED figures at `d9d5173a`.

Merge `adb50c4a` (origin/main with the card amendment 877af98f, card text only). RED commit `d9d5173a` adds acceptance 17 alone (with the `NODE_OPTIONS` and named-subtest changes); at its sources (those of 4f117f50) 17 (b) fails at `B's cleanup keeps the lease under A's running operation on ops\prod` (`true !== false`), and (a), (c), (d), (e) pass: they are coverage proofs, each red under the revert row named below.

**Point 1, lease identity (R12).** The in-section check now compares lease files: a record's target names the section's environment when `this.leases.file(resourceKeys.environment(target))` equals `this.leases.file(key)` (`leaseOf`, release-runner.ts in `releaseLeases`). The key list had the same defect: `new Set` of key strings gave `env:ops\prod` and `env:ops/prod` as two keys of one lease file, so that lease was decided twice and a failed or kept lease was named twice; the keys are now collected by lease file, first name kept (17 (b), second case: one `LOCKED` failure for the one lease; row C2b). `issue` needs no change: its one key comes from the attempt's environment, `LeaseStore.update` locks and reads by lease file, and `ownLease` reads the record's owner and operation, not its key string, so the admission and the step's `claim` already act on the lease file whatever the spelling.

**Points 2, 3, 5.** Acceptance 17 (a) to (e) as the card states them, each with its revert row (C1 to C5). R13's entry rule is the code's (`.json` names, as `listJsonFiles` selects); 17 (e) pins it. The CLI child drops `NODE_OPTIONS` beside every `GIT_*` name; the three POSIX permission cases of test 14 are named subtests with `skip` set to `POSIX permission bits do not apply on Windows` or `root reads and lists regardless of permission bits`, so a skip is reported with its reason.

**Point 4, documents.** Rewritten to what the merged code does, each sentence with the state in which it holds: docs/OPERATIONS.md (the opening paragraph: leases still the attempt's own and kept by nothing unresolved; one lease per lease file; the attempt section only when the attempt names an environment; a cleanup run by another session releases nothing. The admission bullet: for an attempt that names an environment. The environment-less bullet: no attempt section and no ownership check; an empty environment still takes the section of `env:`, where a held lock fails first; the error before any intent; the cleanup still takes its records' targets' lease sections. The failed-section bullet: the attempt section only for an attempt that names an environment. The strict-read bullet: the entry rule. The takeover bullet: no record of that attempt and none on that environment unresolved). docs/ARCHITECTURE.md: the ownership conditions of R3 and the lease-file identity. CHANGELOG.md: the lease-file identity, the environment-less case and the entry rule.

| Sentence (state in which it holds) | Code | Test |
|---|---|---|
| OPERATIONS: leases given back only when still the attempt's own and kept by nothing unresolved; production covers `env:staging` | `ownLease`, in-section check, key list | 2, 4, 5, 13 |
| OPERATIONS: two names of one lease file are one lease, decided once | `leaseOf`, `byFile` | 17 (b) |
| OPERATIONS: attempt section when the attempt names an environment, then one lease section at a time; conditions; other leases not written; another session releases nothing | `attemptSection`, key loop, `ownLease` | 5, 12, 13 |
| OPERATIONS: admission inside both sections for an attempt that names an environment; wait; lock error while the cleanup holds the attempt section | `issue` | 11, 12, 17 (c) |
| OPERATIONS: no environment: no attempt section, no ownership check; `env:` section for an empty one; error before any intent; cleanup still takes its records' targets' sections | `issue` environment skip, `releaseLeases` environment skip | 15, 12 (environment-less case) |
| OPERATIONS: failed lease section continues; held attempt section releases nothing | key loop catch, attempt section catch | 7, 12 |
| OPERATIONS: entry rule; unreadable entry; missing directory; no further release | `strictLedger`, first read, in-section read | 14, 11, 17 (e) |
| ARCHITECTURE: one exit; attempt section when named; releases a lease still this session's whose operation names the attempt; same lease file; `issue` under both sections | `next`, `releaseLeases`, `issue` | 1 to 5, 12, 17 (b) |
| CHANGELOG: as above, plus R6 and R7 | CLOSE, main.ts | 5, 8 |

Revert check on the head of this attempt (each hunk alone, `node --test tests/scenarios/release-lease.test.ts`, Windows, restored; both source files compared byte for byte with their copies afterwards): 45 rows, every row red, none green. The 39 rows of attempt 4 (B4, B4b and M7b rewritten to the new lines: B4 removes the lease-file comparison, B4b compares `` `env:${target}` `` with the key, M7b builds the key as `` `env:${name}` ``) and six rows for acceptance 17:

| Row | Reverted to | First failing test and assertion |
|---|---|---|
| C1 (17 a) | `releaseOperationOf(o, attempt) \|\|` removed from the in-section check, the target comparison kept | 17 (a) `a running production record of the attempt by releaseAttempt` |
| C2 (17 b) | target compared by key string (`resourceKeys.environment(o.target) === key`) | 17 (b) `B's cleanup keeps the lease under A's running operation on ops\prod` |
| C2b (17 b) | keys collected by key string | 17 (b) `one failed section for the one lease` (two `LOCKED` failures) |
| C3 (17 c) | the refused admission appends a `NOTE` event | 17 (c) `the refused admission appends no journal event` |
| C4 (17 d) | the attempt section's change returns a record | 17 (d) `no release-attempt record after a cleanup` |
| C5 (17 e) | every listed name read as an entry | 17 (e) `op-x.json.tmp-1-abcdef12 is not a ledger entry` |

Rows whose count of failing tests changed since attempt 4: B4 and B4b (2: 13 and 17 (b)), B6d (4), A1 (3), A1b (5), A2 (3: 11, 12, 17 (c)), A2b (3), A5 (3), A8 (4), M1 (18 of 20), M3 (2), M6a and M6b (4), M7 (7), M8 (3), M9 (5), M12 (3), M13 (16 of 20).

Runs at the commit that adds this section (parent `d9d5173a`):
- DoD (`dod_command` exactly, Windows): exit 0; typecheck clean; `# tests 64`, `# suites 1`, `# pass 61`, `# fail 0`, `# cancelled 0`, `# skipped 3`, `# todo 0` (20 tests and 3 POSIX subtests in tests/scenarios/release-lease.test.ts, the 3 subtests skipped on Windows with their reason; 41 in the four existing files).
- Linux (WSL, Node v22.23.1, uid 1000), tests/scenarios/release-lease.test.ts: tests 23, pass 23, fail 0, skipped 0 (the three permission subtests run).
- The 80 test files that read docs/ARCHITECTURE.md, docs/OPERATIONS.md or CHANGELOG.md, one `node --test` call, Windows: 1883 tests, 1871 pass, 0 fail, 12 skipped, exit 0.
- Diff against the merge base with main (877af98f): 1474 changed lines (+1450 / -24), within the budget of 1560: tests/scenarios/release-lease.test.ts 886, the card 388, src/loop/release-runner.ts 183, docs/OPERATIONS.md 10, src/cli/main.ts 3, docs/ARCHITECTURE.md 2, CHANGELOG.md 2.

#### After the third pre-review of e40e45ed (coordinator edits, documents only)

The coordinator's document edits of the branch T0-STAGING-LEASE-RELEASE, commit `b5e9278c`.

A third Codex pre-review of e40e45ed found the four earlier points closed, the lock order and the lease-file comparison correct, the two cases of acceptance 17 (a) each failing on its own under the revert C1, and three sentences to correct; the coordinator edited them. No source or test changes.

1. docs/OPERATIONS.md, the paragraph that opens the section: "each ledger record that belongs to the attempt" now reads "each ledger record of the attempt's goal that belongs to the attempt". `releaseOperationOf` (src/loop/release-runner.ts:76) returns false for a record of another goal, so a record of another goal that names the attempt as its `releaseAttempt` does not belong (acceptance 4).
2. docs/OPERATIONS.md, first item of the list, and CHANGELOG.md: the narration names a kept lease, and the command that releases it, only for a lease that is this session's own for the attempt and that an unresolved record keeps. A lease that fails the ownership check (src/loop/release-runner.ts:253, another session's lease or one whose operation names another attempt) is returned unchanged before the unresolved check and is not named; the earlier sentences promised the narration for every kept lease.
3. docs/OPERATIONS.md and CHANGELOG.md: "only while the goal is not terminal" now reads "as that command loaded it" (src/cli/main.ts:1137 checks the goal record the command loaded; a goal another command stops in between is not seen, R7).

Coordinator verification of T0-STAGING-LEASE-RELEASE (branch T0-STAGING-LEASE-RELEASE; each line names its commit):
- At 5342036f, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/scenarios/release-lease.test.ts): tests 8, pass 8, fail 0, skipped 0.
- Windows, docpins: 78 test files reading 3 changed documents: # tests 1863 # pass 1850 # fail 1 docpins: tests/infra/exec.test.ts failed in the parallel run and passes alone (# pass 61): load
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.

Coordinator verification of T0-STAGING-LEASE-RELEASE (branch T0-STAGING-LEASE-RELEASE; each line names its commit):
- At b5e9278c, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/scenarios/release-lease.test.ts): tests 23, pass 23, fail 0, skipped 0.
- Windows, docpins: 80 test files reading 3 changed documents: # tests 1883 # pass 1871 # fail 0
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.

### T0-STAGING-LEASE-RELEASE-2 (this card, branch T0-STAGING-LEASE-RELEASE-2)

Base: main at `a01506e3`. The figures of this section were measured on this branch, at the commit each line names, on Windows.

RED commit `f6b188b0`: tests/scenarios/release-lease.test.ts alone, as at `6ab7a126` with its first line naming this card, on the sources of main: 20 tests, 2 pass, 18 fail, each by an assertion; first failing assertion per test (the two that pass on main are test 13 of an attempt without an environment, which pins main's own throw, and acceptance 17 (a), whose leases main never releases):

| Test | First failing assertion on main |
|---|---|
| 1 | the other session's claim after the TTL: `'expired' !== 'acquired'` |
| 2 | `{ staging: true, production: true }` expected, deep-equal fails |
| 3 | `failed staging deploy` |
| 4 | `a terminal attempt with no ledger record` |
| 5 | `no operation` |
| 6 | `the renewal for another attempt landed after the attempt was saved DONE` |
| 7 | narration `Release delivered to production; final state for production is OBSERVE.` without `env:staging` |
| 8 | second run `goal ... is terminal (STOP)`, `1 !== 0` |
| 9 | `the intent landed before the section` |
| 10 | `the cleanup had released env:production when the admission came` |
| 11 | narration `staging deployment failed` without `aidlc release next <B>` |
| 12 | narration `Release attempt delivered.` without the ledger note |
| 14 | `the STOP of a failed stage-verify releases env:staging` |
| 15 | `the STOP of a failed recover-verify releases both leases` |
| 17 (b) | `one failed section for the one lease` (main makes no lease section, so the narration names none) |
| 17 (c) | `the refused admission appends no journal event` (main issues the step) |
| 17 (d) | the cleanup's release, `false !== true` |
| 17 (e) | `op-x.json.tmp-1-abcdef12 is not a ledger entry` |

Carry commit `ea9c4bd7`: the diff of `6ab7a126` against main (`git diff origin/main...6ab7a126`, merge base `877af98f`) for src/loop/release-runner.ts, src/cli/main.ts, docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md, applied with `git apply --3way` (clean), and the card id renamed in three places. `git grep -n "T0-STAGING-LEASE-RELEASE" -- src tests docs CHANGELOG.md` gives four hits: CHANGELOG.md:23 (`T0-STAGING-LEASE-RELEASE-2` and the clause `replaces T0-STAGING-LEASE-RELEASE`), docs/ARCHITECTURE.md:130 and docs/OPERATIONS.md:173 (`(card T0-STAGING-LEASE-RELEASE-2)`), tests/scenarios/release-lease.test.ts:1 (`// Card T0-STAGING-LEASE-RELEASE-2:`). `git diff 6ab7a126 ea9c4bd7 -- src tests docs CHANGELOG.md`: 4 files, 4 insertions, 4 deletions, exactly these four lines:

- CHANGELOG.md:23 `- T0-STAGING-LEASE-RELEASE (bugfix, audit item F5): …` → `- T0-STAGING-LEASE-RELEASE-2 (bugfix, replaces T0-STAGING-LEASE-RELEASE, audit item F5): …`
- docs/ARCHITECTURE.md:130 `… (card T0-STAGING-LEASE-RELEASE).` → `… (card T0-STAGING-LEASE-RELEASE-2).`
- docs/OPERATIONS.md:173 `… (card T0-STAGING-LEASE-RELEASE). …` → `… (card T0-STAGING-LEASE-RELEASE-2). …`
- tests/scenarios/release-lease.test.ts:1 `// Card T0-STAGING-LEASE-RELEASE: …` → `// Card T0-STAGING-LEASE-RELEASE-2: …`

The old card file specs/tasks/T0-STAGING-LEASE-RELEASE.md is as on main; its evidence is the section above.

DoD (`dod_command` of this card, from the worktree root, Windows, at `ea9c4bd7`): exit 0; typecheck clean; `# tests 64`, `# suites 1`, `# pass 61`, `# fail 0`, `# cancelled 0`, `# skipped 3`, `# todo 0` (the 3 skipped are the POSIX permission subtests of test 12, skipped on Windows with their reason).

Revert check (Windows, at `ea9c4bd7`): the 45 rows of the predecessor's attempt 5, each hunk alone, `node --test tests/scenarios/release-lease.test.ts`, restored; afterwards both source files were equal byte for byte to their copies and `git status` was empty. 45 of 45 red, none green, each with the same count of failing tests as at `e40e45ed` (for example M1 18 of 20, M13 16 of 20, C1 to C5 one each).

Changed lines (`git diff --shortstat origin/main...HEAD` at the commit that adds this section): 1548 changed lines (7 files, +1524 / -24; merge base `a01506e3`): tests/scenarios/release-lease.test.ts 886, this card 462 (its body and the moved evidence), src/loop/release-runner.ts 183, docs/OPERATIONS.md 10, src/cli/main.ts 3, docs/ARCHITECTURE.md 2, CHANGELOG.md 2; within, against the budget of 1560.

Coordinator verification:
