---
id: T0-UNRESOLVED-NARRATION
title: The wait of aidlc next on unresolved operations names each operation, tells an issued or running one (may still be running) from an intended or UNKNOWN one (no recorded outcome) and asks to check before recording, with what next decides unchanged; the goal-lease comments and the Sessions sentence say what the code does
status: todo
branch: T0-UNRESOLVED-NARRATION
worktree: D:\wt\AIDLC\T0-UNRESOLVED-NARRATION
size_exception: "approved by the coordinator as planner and approver of the audit changes under the owner's (asun28) instructions of 2026-11-11 and 2026-11-12: about 26 changed source lines in src/loop/controller.ts (the narration about 12, the two comments about 14), about 300 lines of tests/scenarios/unresolved-narration.test.ts (the narration cases with exact strings, the twelve kinds and the card-id forms, the instrumented single read and no-write spies, and the precedence and grace rows), about 55 lines added to tests/surface/prose.test.ts (the two document tests), 6 document lines (docs/OPERATIONS.md 4: the changed Sessions line removed and added, paragraph N and its blank line; CHANGELOG.md 2) and about 90 lines of attempt evidence; budget counts added plus deleted lines"
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/unresolved-narration.test.ts
  - tests/surface/prose.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-UNRESOLVED-NARRATION.md
dod_command: npm run typecheck && node --test tests/scenarios/unresolved-narration.test.ts tests/scenarios/release-reissue.test.ts tests/infra/reconcile.test.ts tests/scenarios/op-intent-dup.test.ts tests/surface/prose.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/review-release.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `GoalController.next` returns the `wait` of its reconcile step (src/loop/controller.ts:216-225 on main at 6b89407f, `const unresolved = this.ops.unresolved(goal.id)` to the `return Directive.parse({ kind: 'wait', ...`), its `narration` shall be the head sentence `No new mutation is admitted while <n> operation(s) of this goal are unresolved.` followed, each after one space, by one sentence per record of the one `unresolved` result that `on` is built from (one ledger read per call, so `on` and the narration name the same records), in the order it returned them (`OperationLedger.list` sorts by `intentRecordedAt`, src/coordination/reconcile.ts:45-51, :99-101), where `<n>` is their count. For a stored `status` of `issued` or `running` the sentence is `Operation <id> (<kind>, <status><card>) may still be running; check the issuing command and provider before recording its current outcome with <cmd>.`; for `intended` or `UNKNOWN` it is `Operation <id> (<kind>, <status><card>) has no recorded outcome; check the issuing command and provider before recording its current outcome with <cmd>.`; `<cmd>` is the code span `aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>`, the command of src/cli/main.ts:1077 with the values its `--status` option declares (:1079); `<card>` is `, card <cardId>` when `cardId` is a non-empty string (white space and a card the goal does not project included, written as stored) and nothing when it is absent or empty. Id, kind (each of the twelve `OperationKind` values), status and card id are written as stored and unquoted, as T0-NARRATION-QUOTE writes loop identifiers and enum values. The class is the stored `status` alone: no clock, `issuedAt`, `timeoutMs`, `reconciledAt`, `providerOperationId`, `releaseAttempt` or `error` is read for the narration. A record written before this card gets the same narration. A record that fails the `OperationRecord` schema (malformed JSON, a wrong type, a kind or status in another letter case) never reaches the narration: the ledger read throws `StoreError` (src/state/store.ts:84-102) and `next` throws, as on main. Exact text gives the strings.
  - R2. Everything else of `next` shall stay as on main, in this order: the terminal check (:210-214, `goal.terminal || goal.state === 'DONE' || goal.state === 'STOP'`) returns before any ledger read; then the reconcile step, which waits whenever `unresolved` is not empty, whatever the classes, with `kind` `wait`, `on` `reconcile:<ids joined by commas>` in the same order, `until` the `graceEndsAt` of `checkAdmission(effectiveGoalDeadline(goal.deadlines), now, goal.deadlines.graceMs)` and `pollSeconds` 60, and makes no goal save, journal append or board write; a call at or after the end of the grace saves the STOP of :221 (reason `time`, detail `reconciliation grace expired with unresolved operations`, `unresolvedOperations` the ids in the same order) with the narration `Reconciliation grace expired.`; then the deadline step (:227-232); then the ownership step (:234-239); then the state steps. The step reads the ledger without a lock, as on main: the narration is a snapshot of that one read. `OperationLedger`, the CLI and the release runner are not changed.
  - R3. The header comment of src/loop/controller.ts (:8-9, `One goal has one coordinator: the goal lease is claimed at intake and checked on every mutation.`) and the comment of the ownership step (:234, `this session must hold the goal lease (or attach read-only)`) shall be replaced by the comments of Exact text, which say what the code does: `createGoal` claims the goal lease once (:191) with the 10-minute TTL (src/coordination/lease.ts:20) and nothing renews it (the hook renews `card:` leases only, src/hooks/index.ts:611); the ownership step of `next` reads it (:235) and waits only while another session holds it unreleased with `expiresAt` at or after now (:237, the inclusive boundary); `aidlc goal takeover` and the closing session (`releaseGoalLease`, :489-521) may take it over, and the closing session releases it; report admission checks the goal generation and terminality without a goal-lease fence (:530-532) and then calls `next` (:704); goal records stay last-writer-wins; a live card lease stops another session's `card next` on that card (src/loop/card-runner.ts:910-913, :638). No code changes with them.
  - R4. docs/OPERATIONS.md, Sessions, shall replace the first sentence of the bullet at :209 (`A second window that runs \`aidlc next\` on a goal owned by another live session receives \`wait\` with the owner and lease expiry.`) by sentence L of Exact text and change nothing else of the section, so the section stays below the 13,701 bytes tests/surface/prose.test.ts:348-363 allows (13,556 bytes at 6b89407f, 13,682 after) and keeps the pinned last-writer-wins sentence (`LOCK_SESSIONS`, :339-340) word for word. These stay unchanged, each for the reason body section Unchanged text gives: README.md:3, docs/ARCHITECTURE.md, the same_class lines of specs/tasks/T0-CARD-LEASE-HEARTBEAT.md:49 and T0-CARD-LEASE-HEARTBEAT-2.md:51, the narration of the owner wait (:238) and docs/OPERATIONS.md:205, :309 and :609.
  - R5. docs/OPERATIONS.md, Running a goal, shall gain paragraph N of Exact text as its own paragraph directly after the paragraph that begins `Narration (card T0-NARRATION-QUOTE).` (:53), separated from it and from the next paragraph by one blank line each.
  - R6. CHANGELOG.md, Unreleased, shall carry the entry of Exact text directly above the entry that begins `- T0-BOARD-OWNER-WAIT`, separated from it by one blank line.
acceptance:
  - 1. `tests/scenarios/unresolved-narration.test.ts` "an issued or a running operation may still be running, and the goal still waits on it": an `issued` merge past its timeout and a `running` ci-rerun, each alone, give the exact narration of R1, the `wait` of main, one ledger read and no write. Fails on main. [R1] [R2] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. Same file, "an UNKNOWN operation has no recorded outcome": the exact narration, the same `wait`, one read and no write. Fails on main. [R1] [R2] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. Same file, "an intended operation has no recorded outcome, and a card id is written as stored": no card, an empty, a white-space and a non-projected card id. Fails on main. [R1] [R2] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. Same file, "several unresolved operations are named in ledger order, each with its class": UNKNOWN, issued, intended and running among terminal ones; then all twelve kinds. Fails on main. [R1] [R2] [dod arm 1] Detail: body section Acceptance detail, item 4.
  - 5. Same file, "what next decides around the narration is unchanged": terminal before reconciliation, run-card once all are terminal, the wait inside the grace, the STOP at its end, reconciliation before ownership, the deadline before ownership. Passes on main and with this card. [R2] [dod arm 1] Detail: body section Acceptance detail, item 5.
  - 6. tests/scenarios/release-reissue.test.ts, tests/infra/reconcile.test.ts and tests/scenarios/op-intent-dup.test.ts pass unchanged. Passes on main and with this card. [R2] [dod arm 1] Detail: body section Acceptance detail, item 6.
  - 7. tests/surface/prose.test.ts "the Sessions section says when the goal lease is claimed and what the ownership step and aidlc report do with it": sentence L, one sentence, in the section, the old sentence gone; the Sessions readers pass unchanged. Fails on main. [R4] [dod arm 1] Detail: body section Acceptance detail, item 7.
  - 8. Same file, "Running a goal states the wait on unresolved operations, and the CHANGELOG entry sits above T0-BOARD-OWNER-WAIT": literal adjacency of paragraph N and of the entry, each once. Fails on main. [R5] [R6] [dod arm 1] Detail: body section Acceptance detail, item 8.
  - 9. The two comments of R3 equal Exact text, the CHANGELOG entry states R1 to R4, and the files R4 keeps are not in the diff (reviewer-verified against the diff). [R3] [R4] [R6] Detail: body section Acceptance detail, item 9.
depends_on: [T0-REGISTRY-PER-CALL]
budget: 480
tdd: true
diagnosis:
  root_cause: "The reconcile step of `GoalController.next` (src/loop/controller.ts:216-225 at 6b89407f) waits on every operation `OperationLedger.unresolved` returns, which lists `intended`, `issued`, `running` and `UNKNOWN` records (src/coordination/reconcile.ts:99-101), with one fixed narration that calls each of them an operation of unknown outcome and names `aidlc ops reconcile` without an id. A ship records its merge operation with a 60-minute timeout (src/loop/card-runner.ts:1205), marks it `issued` (:1313) and keeps it so until the ship command, run with the same timeout (:1317), returns; an asynchronous release deploy is left `running` after its command returns (src/delivery/ops.ts:164, src/loop/release-runner.ts:409-413); and an intent is recorded before its command starts, so an `intended` operation may be running. A second window is told that each of these has an unknown outcome to record. Separately, two comments of the same file have said since the first commit (b9457c9e) that the goal lease is checked on every mutation and that this session must hold it, while the ownership step of `next` only reads the lease (:235-239) and report admission checks the generation and terminality (:530-532); the Sessions bullet of docs/OPERATIONS.md (:209) describes the owner wait and the takeover and not that the ownership step goes on once the lease has expired."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-drafts-5\\probe-main.mts on main at 8dcb9392 (src/loop and src/coordination are unchanged at 6b89407f): a T1 goal in RUN with one `issued` merge of T1-A gives `wait` on `reconcile:op-20260910233000-685a2f3b`, until 2026-09-11T12:05:00.000Z, pollSeconds 60, narration `Reconcile 1 operation(s) with unknown outcome before admitting any new mutation: run \\`aidlc ops reconcile\\`.`"
  same_class: "Other texts that name `aidlc ops reconcile` for unresolved operations: the release wait (src/loop/release-runner.ts:349-350) names each id and says the command may still be running; the ship wait on an effect of unknown outcome (card-runner.ts:2834) names the id; the takeover refusals (controller.ts:510, card-runner.ts:847) and the `goal reconcile` note (src/cli/main.ts:398) name no id and are non-goals. Other text that says more than the goal lease does: the comment at card-runner.ts:623-624 (`as the controller renews the goal lease`), which T0-DOD-RECEIPT-REQUIRED corrects, and the same_class lines of T0-CARD-LEASE-HEARTBEAT and T0-CARD-LEASE-HEARTBEAT-2, which are not edited (R4)."
sweep: "On main at 6b89407f: git grep -n \"unknown outcome\\|reconcile:\\|before admitting any new mutation\\|operation(s)\" -- src tests docs README.md .claude templates CHANGELOG.md finds the narration only at controller.ts:224; no test, doc or skill quotes it. git grep -n \"reconcile:\" -- tests: release-reissue.test.ts:123 pins `on` of the goal wait (unchanged), op-intent-dup.test.ts:146 asserts the goal does not wait (unchanged). tests/infra/reconcile.test.ts:77-106 pin what `unresolved` lists (unchanged). git grep -n \"ops reconcile\" -- src: main.ts:1077-1088 (the command and its `--status` values), release-runner.ts:349-350 (release wait), card-runner.ts:2834, controller.ts:510, card-runner.ts:847, main.ts:384, :398 (other texts, non-goals). git grep -n -i \"goal lease\\|one coordinator\\|every mutation\" -- src docs README.md .claude templates: controller.ts:9 and :234 (R3), docs/OPERATIONS.md:209 (R4), :205, :309, :609 and docs/ARCHITECTURE.md:14 (true as worded), README.md:3 (true as worded), card-runner.ts:623-624 (T0-DOD-RECEIPT-REQUIRED). git grep -n \"resourceKeys.goal(\" -- src: controller.ts:191 (the only claim), :235 (read), :490 (close), main.ts:141, :395, :508 and hooks/index.ts:729 (reads and the takeover). Readers of the Sessions section: tests/surface/prose.test.ts:323-370 and :398-408, tests/scenarios/two-windows.test.ts:1665-1666, tests/scenarios/review-release.test.ts:723-727 (all pass unchanged; none quotes the replaced sentence). No test reads the Narration paragraph of Running a goal."
forbid:
  - weakening or skipping a test to go green
  - any change to what `next` decides: the wait, its `on`, `until` or `pollSeconds`, the grace STOP, the terminal, deadline and ownership steps, the order of the steps, or the work it admits
  - a second ledger read in the reconcile step, or reading a clock, `issuedAt`, `timeoutMs` or any record field other than id, kind, status and cardId for the narration
  - trimming, quoting or dropping a stored card id, or quoting an operation id, kind or status (T0-NARRATION-QUOTE forbids quoting loop-made identifiers)
  - a goal-lease read, write, renewal or check added to `next` or `report`
  - a change to src/coordination/reconcile.ts, src/cli/main.ts or src/loop/release-runner.ts
  - editing specs/tasks/T0-CARD-LEASE-HEARTBEAT.md or specs/tasks/T0-CARD-LEASE-HEARTBEAT-2.md
  - any change to tests/surface/prose.test.ts other than the added describe block of acceptance 7 and 8
  - a new `mkdtempSync` call, a removal in `finally`, `fx.cleanup()` or a direct `rmSync` of a temporary directory in the new tests; directories come from `makeFixture` and are removed with `cleanup` of tests/infra/helpers.ts in a `t.after` hook, where every spy is restored too
  - editing .aidlc state by hand
non_goals:
  - dispatching another card while an operation of a different card is unresolved
  - inferring that an operation is still running from `issuedAt` plus `timeoutMs`
  - naming in the narration the command that continues (`aidlc card next`, `aidlc release next`)
  - goal-lease enforcement, renewal or a lease check in `report`
  - the comment at src/loop/card-runner.ts:623-624, which T0-DOD-RECEIPT-REQUIRED corrects
  - the takeover refusals and the `goal reconcile` note that name `aidlc ops reconcile` without an id
  - the narrations of the owner wait (controller.ts:238) and the release wait
hygiene: "Line numbers are from main at 6b89407f (src/loop, src/coordination and src/cli are as at 8dcb9392; docs/OPERATIONS.md moved by 2 lines from :180 on); read them again at PREPARE. This card merges after T0-PROD-GATE-GENERATION and T0-REGISTRY-PER-CALL, which both change src/loop/controller.ts (both still `todo`): the first the intake records of `createGoal` and the `approved` case of `report`, the second wraps `next`, `report` and `createGoal` by delegating to private methods that keep their bodies, so the reconcile step and the ownership comment move into the method that holds the body of `next`; compare against both merged diffs at PREPARE. Insert the CHANGELOG entry directly above the entry that begins `- T0-BOARD-OWNER-WAIT`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. The Sessions section of docs/OPERATIONS.md has 144 bytes free under the cap at 6b89407f and this card uses 126; measure it again at PREPARE, and stop and report if a card merged before this one has grown the section past 18 bytes of the room left. Before the first R3, revert each source hunk in a scratch copy and run the acceptance tests (lesson 2026-11-11 T0-AUDIT-FIXES): the class test of each of the four statuses, the card clause (`cardId !== undefined`, a trimmed id), the order (sorted by class), the head count, a second ledger read. Run the new test file on Linux as well as Windows (lesson T0-DIRTY-SUCCESS-2). Before the first review the coordinator runs every test file that reads a document this card changes and records the counts in the Attempt evidence; the full suite runs in CI. src/loop/controller.ts is not in the verify-card-run-writes coverage record. No platform case: the change builds strings from ledger records; the tests start no child process."
doc_sync: docs/OPERATIONS.md (Running a goal, paragraph N; Sessions, sentence L), CHANGELOG.md
---

# T0-UNRESOLVED-NARRATION

## Deliverable
While an operation of a goal is unresolved, `aidlc next` still waits and admits no new mutation, as on main, but its narration names each operation (id, kind, status, card), tells an `issued` or `running` one, which may still be running, from an `intended` or `UNKNOWN` one, which has no recorded outcome, and asks for each to check the issuing command and the provider before recording its current outcome with `aidlc ops reconcile <id> --status ...`. The goal-lease comments of src/loop/controller.ts and the Sessions bullet of docs/OPERATIONS.md say what the code does with the goal lease; no lease check is added.

## Why
Audit items F16 and F14, analysed by two consultants and ruled by the coordinator on 2026-11-12; the draft was reviewed by Codex and amended to the coordinator's rulings. F16: a second window is told that a merge whose ship command is still running has an unknown outcome to reconcile. F14: the comments say the goal lease is checked on every mutation. The ownership step reads but never renews the goal lease; CLOSE may take over and release it. Report admission checks generation and terminality without a goal-lease fence, then calls `next`. Both change text in one file and no behaviour of the dispatch, so they are one card.

## Exact text

Narration of R1, one operation per class (`<id>`, `<kind>`, `<status>`, `<cardId>` as stored; the backticks are part of the narration):

```text
No new mutation is admitted while 1 operation(s) of this goal are unresolved. Operation <id> (<kind>, <status>, card <cardId>) may still be running; check the issuing command and provider before recording its current outcome with `aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>`.
```

```text
No new mutation is admitted while 1 operation(s) of this goal are unresolved. Operation <id> (<kind>, <status>) has no recorded outcome; check the issuing command and provider before recording its current outcome with `aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>`.
```

Several operations of mixed classes, as the ledger lists them (`op-1` to `op-4` stand for the record ids):

```text
No new mutation is admitted while 4 operation(s) of this goal are unresolved. Operation op-1 (merge, UNKNOWN, card T1-B) has no recorded outcome; check the issuing command and provider before recording its current outcome with `aidlc ops reconcile op-1 --status <succeeded|failed|running|cancelled|UNKNOWN>`. Operation op-2 (merge, issued, card T1-A) may still be running; check the issuing command and provider before recording its current outcome with `aidlc ops reconcile op-2 --status <succeeded|failed|running|cancelled|UNKNOWN>`. Operation op-3 (deploy, intended) has no recorded outcome; check the issuing command and provider before recording its current outcome with `aidlc ops reconcile op-3 --status <succeeded|failed|running|cancelled|UNKNOWN>`. Operation op-4 (ci-rerun, running, card T1-A) may still be running; check the issuing command and provider before recording its current outcome with `aidlc ops reconcile op-4 --status <succeeded|failed|running|cancelled|UNKNOWN>`.
```

Checked against the code: an asynchronous release deploy is `running` after its command returned while the provider still works (src/delivery/ops.ts:164 returns `issued` for an async binding that exits 0; src/loop/release-runner.ts:409-413 marks it `running`), which `may still be running` and `check ... provider` cover; an intent is recorded before its command runs and `markIssued` follows the command (release-runner.ts:403-406; card-runner.ts:1205, :1313), so an `intended` operation may be running or done, which `has no recorded outcome` does not deny; `running` is among the values because the provider may report the operation still running.

Header comment of src/loop/controller.ts, lines 7 to 15 after the change (line 7 and the closing ` */` are unchanged; the replaced text is the end of line 8 and line 9):

```text
 * it regenerates the board view. `report()` commits externally observed results (plan output,
 * card results, arc verification, release results, revisions, cancellation). The goal lease names
 * the goal's coordinator: `createGoal` claims it once and nothing renews it. The ownership step of
 * `next` reads it and waits only while another session holds it unreleased with `expiresAt` at or
 * after now; `aidlc goal takeover` and the closing session (`releaseGoalLease`) may take it over,
 * and the closing session releases it. Report admission checks the goal generation and terminality
 * without a goal-lease fence, then calls `next`. Goal records stay last-writer-wins; a live card
 * lease stops another session's `card next` on that card.
 */
```

Comment of the ownership step, in place of `// 3. Ownership: this session must hold the goal lease (or attach read-only).`:

```text
    // 3. Ownership: this step reads the goal lease and waits while another session holds it unreleased with `expiresAt`
    // at or after now (attach read-only); an absent, released or expired lease, or this session's, goes on. Nothing renews it.
```

Sentence L, docs/OPERATIONS.md, Sessions, the new first sentence of the bullet at :209 (126 bytes longer than the sentence it replaces; the section goes from 13,556 to 13,682 bytes, 18 below the most the cap allows). The bullet's later sentence on the closing session, the last-writer-wins sentence of :205 and its card-lease sentences already state the closing takeover, last-writer-wins and that a live card lease stops another session, so L does not repeat them:

```text
The goal lease is claimed at intake and never renewed; the ownership step of `aidlc next` waits (owner, expiry) only while another session holds it unreleased and not past `expiresAt`, and `aidlc report` checks generation and terminality, not the lease.
```

Paragraph N, docs/OPERATIONS.md, Running a goal, its own paragraph directly after the paragraph that begins `Narration (card T0-NARRATION-QUOTE).`:

```text
While a goal that is not terminal, `DONE` or `STOP` has an operation that is `intended`, `issued`, `running` or `UNKNOWN`, `aidlc next` admits no new mutation: it returns `wait` on `reconcile:<ids>` until the reconciliation grace after the current goal deadline ends, and a call at or after that end stops the goal for time, listing them (card T0-UNRESOLVED-NARRATION). The narration of that `wait` names each such operation, in the order `aidlc ops list --goal <id>` prints them, with its kind, its status and its card when it has one, says that an `issued` or `running` one may still be running and that an `intended` or `UNKNOWN` one has no recorded outcome, and asks to check the issuing command and the provider before recording the current outcome with `aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>`.
```

CHANGELOG.md entry (one line):

```text
- T0-UNRESOLVED-NARRATION (audit items F16 and F14): while an operation of a goal that is not terminal, `DONE` or `STOP` is `intended`, `issued`, `running` or `UNKNOWN`, the `wait` of `aidlc next` names each such operation, in the order `aidlc ops list --goal <id>` prints them, with its id, kind, status and card when it has one: an `issued` or `running` one may still be running, an `intended` or `UNKNOWN` one has no recorded outcome, and for each the narration asks to check the issuing command and the provider before recording its current outcome with `aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>`. The class comes from the stored status alone. Before this card that narration called every such operation one of unknown outcome and named `aidlc ops reconcile` without an id, also for a merge whose ship command was still running. What `aidlc next` decides is unchanged: it waits on `reconcile:<ids>` until the reconciliation grace after the current goal deadline ends, a call at or after that end stops the goal for time, and no new mutation is admitted meanwhile. The header and ownership-step comments of `src/loop/controller.ts` now say what the code does, which this card does not change: the goal lease is claimed at intake and never renewed, the ownership step of `aidlc next` waits on it only while another session holds it unreleased and not past `expiresAt`, `aidlc goal takeover` and the closing session may take it over and the closing session releases it, report admission checks the goal generation and terminality without a goal-lease fence and then calls `next`, goal records stay last-writer-wins, and a live card lease stops another session's `card next` on its card. In docs/OPERATIONS.md (Sessions) the first sentence of the second-window bullet now says when the goal lease is claimed, that it is never renewed, when the ownership step waits on it and that `aidlc report` checks generation and terminality, not the lease.
```

## Unchanged text
- README.md:3, `one coordinator per goal`: true as worded. The goal lease records one owner session per goal at any time (the intake session, or the session that took it over), and the ownership step of another session's `aidlc next` waits while that lease is live; the phrase claims neither renewal nor exclusion after expiry, which docs/OPERATIONS.md (Sessions) now states.
- docs/ARCHITECTURE.md: no sentence says more than the code. :161 is the `done` row of the directive table; :164 says a report with a stale `generation` is refused, which is the check `report` makes; :14 says `aidlc goal takeover` takes the goal lease after reconciliation and, of the planning claims, that the goal lease names the owner, both true.
- specs/tasks/T0-CARD-LEASE-HEARTBEAT-2.md:51 (merged, PR 246) and specs/tasks/T0-CARD-LEASE-HEARTBEAT.md:49 (its predecessor, status `todo`, whose attempt evidence the merged card cites) say in same_class that the goal lease `is renewed only by aidlc next`. That was never so (at 6f5b69e3 the claim at controller.ts:162 was in `createGoal`); card files are not edited, and this card's CHANGELOG entry and comments state the fact.
- docs/OPERATIONS.md:205 (the takeover and the card-lease rules), :309 (`The goal lease is not renewed by the hook.`) and :609 (the `ownership` row): true.
- The narration of the owner wait (controller.ts:238), `Goal is coordinated by session <s> (generation <g>). Attach read-only, or take over after reconciliation with \`aidlc goal takeover\` once the lease expires.`: true. It is returned only while the lease of another session is live, and it offers the takeover as one way on; it does not say that the ownership step refuses to go on after expiry.

## Acceptance detail
Each subsection is the full text of the acceptance item of the same number.

Fixture of items 1 to 5, one per row: `makeFixture()` of tests/scenarios/_harness.ts removed by `t.after(() => cleanup(fx.tmp))` with `cleanup` of tests/infra/helpers.ts; cards T1-A and T1-B written with `writeCard`; `goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' })` (state RUN, goal deadline `2026-09-11T12:00:00.000Z`, grace end `2026-09-11T12:05:00.000Z`). A record is written with `fx.ops.recordIntent({ kind, goalId, cardId, target: 'main', ownerGeneration: 0, timeoutMs: 60_000 }, at)`, `at = addMs(T0, -m * MINUTE_MS)` for its own `m`, then `markIssued(id, undefined, at)`, `markRunning(id, at)` or `markResult(id, status, {}, at)` (`UNKNOWN` after `markIssued`). The clock moves with `fx.advance(Date.parse(target) - Date.parse(fx.now()))`. Spies, installed after the records are written and removed in the same `t.after` hook: `fx.ops.unresolved` is wrapped to count calls, return the ledger's result on the first call of a `next` and, on any later call, that result without its first record, so a second read changes `on` or the narration; `fx.store.saveGoal`, `Journal.prototype.append` (src/state/journal.ts) and `fx.controller.writeBoard` are wrapped to count calls and call through. "One read and no write" means: one `unresolved` call, zero `saveGoal`, `append` and `writeBoard` calls, `readFileSync(fx.store.goalFile(goalId))` the same bytes, `fx.events(goalId)` the same events and `fx.store.listCardRuns(goalId)` empty, so no card was dispatched. Expected narrations are literal strings in the test with the record ids put in.

### 1
`tests/scenarios/unresolved-narration.test.ts` "an issued or a running operation may still be running, and the goal still waits on it" passes and fails on main. Control: before any record, `fx.controller.next(goalId)` returns `run-card`. Row (a): one `merge` of T1-A, intent and issue at `m` 30 (its 60 s timeout long past at T0), `issued`. Row (b), in its own fixture: one `ci-rerun` of T1-B at `m` 20, `running` through `markRunning`. For each, `next` returns `kind` `wait`, `on` `reconcile:<id>`, `until` `2026-09-11T12:05:00.000Z`, `pollSeconds` 60 and the narration `No new mutation is admitted while 1 operation(s) of this goal are unresolved. Operation <id> (merge, issued, card T1-A) may still be running; check the issuing command and provider before recording its current outcome with \`aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>\`.` (row b: `(ci-rerun, running, card T1-B)`), with one read and no write. [R1] [R2] [dod arm 1]

### 2
Same file, "an UNKNOWN operation has no recorded outcome" passes and fails on main: one `merge` of T1-A at `m` 30, `markIssued`, then `markResult(id, 'UNKNOWN', { error: 'gh did not answer' }, at)`; `next` returns the `wait` of item 1 with `on` `reconcile:<id>` and the narration `No new mutation is admitted while 1 operation(s) of this goal are unresolved. Operation <id> (merge, UNKNOWN, card T1-A) has no recorded outcome; check the issuing command and provider before recording its current outcome with \`aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>\`.`, with one read and no write. [R1] [R2] [dod arm 1]

### 3
Same file, "an intended operation has no recorded outcome, and a card id is written as stored" passes and fails on main. Each row a fresh fixture with one record at `m` 30 left `intended`, giving the `wait` of item 1 with one read and no write: (a) a `deploy` with no `cardId`: `Operation <id> (deploy, intended) has no recorded outcome; ...` after the head of 1; (b) a `review` with `cardId: ''`: `(review, intended)`, no card; (c) a `merge` with `cardId: ' '`: `(merge, intended, card  )`, the space kept; (d) a `merge` with `cardId: 'T9-OTHER'`, a card the goal does not project: `(merge, intended, card T9-OTHER)`. Each sentence ends `; check the issuing command and provider before recording its current outcome with \`aidlc ops reconcile <id> --status <succeeded|failed|running|cancelled|UNKNOWN>\`.`. [R1] [R2] [dod arm 1]

### 4
Same file, "several unresolved operations are named in ledger order, each with its class" passes and fails on main. Row (a), records by intent time: `m` 50 a `merge` of T1-B, `UNKNOWN` (op-1); `m` 45 a `merge` of T1-A, `succeeded`; `m` 40 a `merge` of T1-A, `issued` (op-2); `m` 30 a `deploy` with no card, `intended` (op-3); `m` 25 a `review` of T1-B, `failed`; `m` 20 a `ci-rerun` of T1-A, `running` (op-4); `m` 15 a `deploy`, `cancelled`. `next` returns `wait` with `on` `reconcile:<op-1>,<op-2>,<op-3>,<op-4>` and the mixed narration of Exact text with the four ids put in, with one read and no write; an order grouped or sorted by class fails, and each status has a record of its own, so a class test that drops one status fails. Row (b), a fresh fixture: one `intended` record per `OperationKind` in the order of `OperationKind.options` (src/core/types.ts:704-717), `deploy` at `m` 60 to `other` at `m` 49, no card: the head names 12 and the twelve sentences name the kinds verbatim in that order. [R1] [R2] [dod arm 1]

### 5
Same file, "what next decides around the narration is unchanged" passes on main and with this card. The records of item 4 row (a) unless a row says otherwise. (a) Terminal before reconciliation: the goal saved through `fx.store.saveGoal` with `terminal: true` (state RUN), and in two more fixtures with state `DONE` and with state `STOP` (`terminal` false): `next` returns the terminal directive of :210-214 (`stop` with narration `Goal is terminal. Late wakeups do no new work.`, and `done` for DONE) and the `unresolved` spy counts zero calls. (b) After `markResult` gives op-1 `failed`, op-2 `succeeded`, op-3 `cancelled` and op-4 `failed`, `next` returns `run-card`. (c) The narration at T0 is kept; the clock moved to `2026-09-11T12:01:00.000Z` (after the deadline, inside the grace): `next` returns `wait` with the `on` of item 4, `until` `2026-09-11T12:05:00.000Z`, `pollSeconds` 60 and the narration kept at T0, and the goal is still in RUN. (d) The clock moved to `2026-09-11T12:05:00.000Z`: `next` returns `stop` with narration `Reconciliation grace expired.`, `stop.reason` `time`, `stop.detail` `reconciliation grace expired with unresolved operations` and `stop.unresolvedOperations` the four ids in ledger order, and the stored goal is in STOP. (e) Reconciliation before ownership: a fresh fixture with the record of item 1 row (a); with the acting session set to `actorB` of the harness (`setActorForTests(actorB)` of src/state/journal.ts, set back to `actorA` in the `t.after` hook) while the intake lease of `win-A` is live, `next` returns the reconcile `wait`; after `markResult(id, 'succeeded', {}, at)` it returns `wait` on `owner:win-A`. (f) Deadline before ownership: a fresh fixture with no record; the clock moved to `2026-09-11T12:00:00.000Z`; `fx.leases.takeover(resourceKeys.goal(fx.repo.key, goalId), () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: fx.now(), operation: 'coordinate' })` gives `win-B` a live goal lease (as tests/scenarios/two-windows.test.ts:530 does); acting as `actorA`, `next` returns `stop` with `stop.reason` `time`, not `wait` on `owner:win-B`. [R2] [dod arm 1]

### 6
tests/scenarios/release-reissue.test.ts "a staging deploy interrupted while its command ran is not issued again; release next waits on the intended operation and names aidlc ops reconcile" (its goal wait on `reconcile:<opId>` at :121-123), tests/infra/reconcile.test.ts "reconcile reports running with the provider id and keeps it unresolved" (:77-84) and "unresolved() lists intended/issued/running/UNKNOWN and nothing terminal" (:86-106), and tests/scenarios/op-intent-dup.test.ts (the goal that does not wait, :146) pass unchanged. Passes on main and with this card. [R2] [dod arm 1]

### 7
tests/surface/prose.test.ts, a new `describe` block "goal lease and unresolved operations in the documents (T0-UNRESOLVED-NARRATION)" at the end of the file, test "the Sessions section says when the goal lease is claimed and what the ownership step and aidlc report do with it", passes and fails on main. The block has its own `sessions()` helper, the same text as the one of the T1-STORE-CAS-2 block (:323-327: LF line ends, from `\n## Sessions\n` to the next `\n## `). `LEASE` is sentence L of Exact text; `LEASE.split(SENTENCE_BREAK).length` is 1; `sessions()` includes `LEASE` once and does not include `A second window that runs \`aidlc next\` on a goal owned by another live session`. tests/surface/prose.test.ts "acceptance 8: ..." and "acceptance 13: ..." of T1-STORE-CAS-2 (the byte cap below 13,701 and `LOCK_SESSIONS` word for word), tests/scenarios/two-windows.test.ts (the Sessions sentence at :1665-1666) and tests/scenarios/review-release.test.ts "acceptance 8: the OPERATIONS sentence is the last paragraph of Ship gates and not in Sessions [R4]" pass unchanged. [R4] [dod arm 1]

### 8
Same block, test "Running a goal states the wait on unresolved operations, and the CHANGELOG entry sits above T0-BOARD-OWNER-WAIT", passes and fails on main. docs/OPERATIONS.md with LF line ends: `NARRATION` is its whole line that begins `Narration (card T0-NARRATION-QUOTE).`; the text includes `NARRATION + '\n\n' + N + '\n\n'`, N is paragraph N of Exact text, and N occurs once in the file. CHANGELOG.md with LF line ends: `BOARD` is its whole line that begins `- T0-BOARD-OWNER-WAIT`; the text includes `ENTRY + '\n\n' + BOARD`, ENTRY is the entry of Exact text, and ENTRY occurs once. Joining N to the paragraph before it or removing a blank line fails it. [R5] [R6] [dod arm 1]

### 9
The two comments of R3 equal the comments of Exact text; the CHANGELOG entry (whose whole line acceptance 8 also checks) states R1 to R4, each fact with the condition under which it holds; README.md, docs/ARCHITECTURE.md and the two T0-CARD-LEASE-HEARTBEAT card files are not in the diff (reviewer-verified against the diff). [R3] [R4] [R6]

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/unresolved-narration.test.ts tests/scenarios/release-reissue.test.ts tests/infra/reconcile.test.ts tests/scenarios/op-intent-dup.test.ts tests/surface/prose.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/review-release.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; every existing file listed passes unchanged apart from the describe block added to tests/surface/prose.test.ts.

## Attempt evidence

Sessions bytes at PREPARE on 7097dfd9 (LF, heading to next heading): 13,556 bytes, cap 13,701 (strictly below); sentence L adds 126, so 13,682 after. Room unchanged from the card, no card merged earlier grew the section.

RED, measured on 4c3dceef (source as on main 7097dfd9): tests/scenarios/unresolved-narration.test.ts fails 12 subtests (items 1, 2, 3, 4) on the assertion `narration` actual `Reconcile 1 operation(s) with unknown outcome before admitting any new mutation: run ...` against the expected new narration; the control and item 5 rows (a), (b), (d), (e), (f) pass, and item 5 (c) passes after its narration was compared with the one read at T0. tests/surface/prose.test.ts: 2 fail (`Sessions states sentence L once`, `paragraph N is its own paragraph directly after the Narration paragraph`), 16 pass.

Revert table, measured on 4771cc60 for rows 1 to 14 and on f137c13e for rows 15 to 17, the two differ only in the card file (all 17 rows are revert runs, none a RED-commit observation: the text or source piece was removed or mutated in the working tree, the test run, the file restored with git checkout or by rewriting the original, git status clean afterwards): 17 of 17 red.

| # | piece reverted or mutated (rows 1 to 14: revert run on 4771cc60 with unresolved-narration.test.ts) | result |
|---|---|---|
| 1 | issued/running class dropped | red |
| 2 | intended/UNKNOWN class dropped (all may still be running) | red |
| 3 | only issued is may-run | red |
| 4 | only running is may-run | red |
| 5 | card clause `cardId !== undefined` | red |
| 6 | card id trimmed | red |
| 7 | card id quoted | red |
| 8 | operations ordered by class | red |
| 9 | head count n+1 | red |
| 10 | second ledger read for the narration | red |
| 11 | terminal check after a ledger read | red |
| 12 | reconcile step skipped | red |
| 13 | grace expiry no longer stops | red |
| 14 | pollSeconds changed | red |
| 15 | sentence L removed from docs/OPERATIONS.md (revert run) | red: tests/surface/prose.test.ts:432, `Sessions states sentence L once` |
| 16 | paragraph N removed from docs/OPERATIONS.md (revert run) | red: tests/surface/prose.test.ts:440, `paragraph N is its own paragraph directly after the Narration paragraph` |
| 17 | CHANGELOG entry removed (revert run) | red: tests/surface/prose.test.ts:445, `the entry sits directly above T0-BOARD-OWNER-WAIT` |

DoD on 4771cc60: `npm run typecheck` clean, then node --test of the seven files: tests 158, pass 158, fail 0, exit 0.

Document sentences against code and test:

| sentence | code | test |
|---|---|---|
| paragraph N, Running a goal | src/loop/controller.ts reconcile step, `unresolvedNarration` | unresolved-narration items 1 to 5; prose test 8 |
| sentence L, Sessions | ownership step (reads the lease, inclusive `expiresAt`), `createGoal` claim, report admission | prose test 7 |
| CHANGELOG entry | same as the two above, plus the two comments | prose test 8; comments reviewer-verified |

Changed lines `git diff --shortstat origin/main...HEAD` before this section: 5 files, 353 insertions, 5 deletions (358 against budget 480).
