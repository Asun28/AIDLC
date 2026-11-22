---
id: T0-CONTRACT-GATE-2
title: "The loop refuses new work on a card run while the card differs from its recorded contract"
status: merged
branch: T0-CONTRACT-GATE-2
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/card-contract-gate.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-CONTRACT-GATE-2.md
  - specs/tasks/T0-CONTRACT-GATE-2.md
dod_command: npm run typecheck && node --test tests/scenarios/card-contract-gate.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/card-amend-command.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The card runner shall hold one contract gate, a function of a card and one record of its run that reads nothing else. The gate applies when the record holds a `contract`, holds no `mergeVerified`, is not in state DONE, and at least one contract field of the card has another digest than the record's (`changedContractFields`); it shall apply to no other record.
  - R2. `CardRunner.recordAttempt` shall ask the gate on the record it reads, directly after it delivers the owed events of that record. WHEN the gate applies, `recordAttempt` shall refuse an attempt of any outcome with the message of R6 before its write.
  - R3. `CardRunner.preReview` and `CardRunner.formalReview` shall each ask the gate on the record they read for their guards, directly after their refusal of a stopped run. WHEN the gate applies, the method shall refuse with the message of R6, having reserved no round and no decision, made no request to the review pool and run no reviewer.
  - R4. The dispatch of `CardRunner.next` shall ask the gate on the record its state selection reads, before any write of that selection. WHEN the gate applies and the selected state is BUILD, REVIEW_FIX or SHIP, `next` shall refuse with the message of R6 before it saves the run, appends a journal event of its own, renews the card lease, starts an attempt or dispatches a ship. In every other selected state `next` shall return what it returns for the unchanged card.
  - R5. The gate shall be asked again, with the card the call holds, on the record locked where `preReview` reserves its round, on the record locked where `formalReview` reserves its decision, and on the record re-read under the card-run lock before the ship is dispatched. WHEN the gate applies there, the method shall refuse the reservation, and `next` shall withdraw the ship as it does for every other change of that record, each with a message that names the changed contract fields, that the contract was amended after the call read the run, and that the command is to be run again.
  - R6. A refusal of R2, R3 or R4 shall carry one message that names the card, the changed contract fields in the order of `CONTRACT_FIELDS`, the command `aidlc card amend <card> --by <who> --reason <text>` as the owner's act, and the restoring of the card text as the other way and as the way to take where the amendment is refused; `aidlc card next <card>` shall exit non-zero with that message.
  - R7. WHEN the amendment is recorded or the card text is restored, the calls the gate refused shall proceed as they do for an unchanged card.
  - R8. `docs/OPERATIONS.md`, Amendments, shall state R1 to R7 and, for each of the three cases in which the amendment is refused while the gate applies (a pending repair, an unresolved operation of the card, a formal review in flight), the way on; `docs/ARCHITECTURE.md` shall name the gate beside `CardRunner.amendCard`; `changelog.d/T0-CONTRACT-GATE-2.md` shall say in one entry what the loop now refuses.
acceptance:
  - 1. `tests/scenarios/card-contract-gate.test.ts`, a run in BUILD with an attempt running, after the `requirements` of the card changed on disk. `next` rejects with a message that holds the card id, `requirements`, `aidlc card amend <card> --by <who> --reason <text>`, the restoring of the card text and that it is the way where the amendment is refused; `recordAttempt` with the outcomes `success`, `fail` and `not-counted` each reject with the same message; after each call the card-run file and the journal are byte-identical, and after the refused `next` the card lease is as it was. With `requirements` and `acceptance` both changed the message names both, in that order. [R1] [R2] [R4] [R6] [dod arm 2]
  - 2. Same file, a run in REVIEW_FIX after an R3 block on decision 1, the card changed. `next` rejects with the message, the attempts of the effort episode are as they were, and the card-run file and the journal are byte-identical. [R4] [dod arm 2]
  - 3. Same file, the selected state SHIP, the card changed. On a bound candidate with no review, whose stored state is still BUILD, `next` rejects and the journal holds no further `CARD_STATE` event; `formalReview` rejects, the run holds no invocation, the review queue holds no request and the reviewer did not run. After an R3 pass, `next` rejects, the ship path received no request and the operation ledger holds no operation of the card. With pre-review configured, `preReview` rejects, the run holds no round and the reviewer did not run. After each call the card-run file and the journal are byte-identical. [R3] [R4] [dod arm 2]
  - 4. Same file, the three cases in which `amendCard` refuses, each with the card changed. With a `withdrawn` repair pending, `amendCard` rejects naming the repair, `next` and a `recordAttempt` of a success on another commit reject with the message and write nothing; with the card text restored `next` returns the `build` directive and that success is recorded and ends the repair; with the card changed again `amendCard` is admitted and `next` returns the `review` directive. With a merge operation `intended` after an R3 pass, `amendCard` rejects naming the operation, `next` rejects with the message and the ship path received no request; with the card text restored `next` ships and returns the `close` directive. With a pending formal invocation, `amendCard` rejects naming the review in flight, and `next` and `formalReview` reject with the message, write nothing and run no reviewer. [R1] [R2] [R3] [R4] [R7] [dod arm 2]
  - 5. Same file, the records the gate does not apply to, each with the card changed. On a run with no `contract`, a run with `mergeVerified` and a run in state DONE, `next` returns the directive kind it returns on the same run for the unchanged card, and with no `contract` a `recordAttempt` is recorded. [R1] [dod arm 2]
  - 6. Same file, the other selected states, each with the card changed. A run created and not yet prepared returns the `prepare` directive; a run with an operation of the card that is `issued`, `running` or `UNKNOWN` returns the directive kind it returns for the unchanged card; a run stopped for review returns the `stop` directive with its stop. On that stopped run `preReview` and `formalReview` reject with their refusal of a stopped run, `recordAttempt` rejects with the message of R6, and the card-run file and the journal are byte-identical; after `continueStop`, `next` and `formalReview` reject with the message of R6. With no pre-reviewer configured, `preReview` rejects as unconfigured. [R2] [R3] [R4] [dod arm 2]
  - 7. Same file. After `amendCard` on the run of item 1, `next` returns the `build` directive and a `recordAttempt` of a success is recorded; a second change of the card is refused again; with the card text restored in place of an amendment, `next` returns the `build` directive and the run holds no amendment. After `amendCard` on the passed candidate of item 3, `next` returns the `review` directive and `formalReview` records a decision. [R7] [dod arm 2]
  - 8. Same file. `aidlc card next <card>` through the CLI on the run of item 1 exits 1 with the message on its standard error, and the card-run file and the journal are byte-identical. [R6] [dod arm 2]
  - 9. Same file, an amendment of `budget` that another caller records during the call, the call holding the card it read before. While `formalReview` collects the diff, `formalReview` rejects with a message that names `budget`, that the contract was amended after the command read the run and that the command is to be run again; the run holds no invocation, the reviewer did not run and the pool request is cancelled; the call made again records a decision. While `preReview` collects the diff, `preReview` rejects with the same message, the run holds no round and the reviewer did not run. After `next` selected SHIP on a passed candidate and before the ship records its intent, `next` returns the `wait` directive on `record-changed` whose narration names `budget` and that the contract was amended meanwhile, the ship path received no request and the operation is `cancelled`; `next` made again ships. Between the first read of the dispatch of `next` and its state selection, on a run in BUILD, `next` rejects with the message of R6 naming `budget` and starts nothing; `next` made again returns the `build` directive. [R4] [R5] [dod arm 2]
  - 10. `tests/scenarios/card-amend.test.ts`, `card-amend-command.test.ts`, `card-contract.test.ts`, `card-continue.test.ts`, `candidate-withdraw.test.ts`, `t0-flow.test.ts` and `fault-points.test.ts` pass with no line changed, the typecheck reports no error, and `npm run build && npm run bench -- --check` exits 0. [R3] [dod arm 1] [dod arm 2] [dod arm 3]
  - 11. Each of the three texts holds what R8 assigns to it (reviewer-verified against the diff). [R8]
depends_on: []
budget: 250
tdd: true
sweep: "On main at b9e10702. `CardRunner.amendmentRefusal` (src/loop/card-runner.ts:746-759) states when an amendment is admitted; this card leaves it as it is and the gate does not call it. `CardRunner.assess` (:875-998) selects the state and is where `next` renews the card lease and appends `CARD_STATE`; with `dry: true` it saves and appends nothing, and main runs it dry only on a lease the session does not hold. `recordAttempt` (:1389) reads the run at :1393, refuses an interrupted mutant sweep at :1405, delivers owed events at :1407 and makes its one write at :1469 through `saveCardRun` (src/state/goal-store.ts:60), a compare-and-set on the revision it read; the saves of `next` go the same way. `formalReview` (:2195) reads at :2197, commits a retained result before its stop refusal at :2219, and reserves under the lock at :2304 after the `REVIEW_ADMITTED` append at :2303; a refusal in that lock cancels the pool request (:2329-2336). `preReview` (:2864) reads at :2867, refuses a stopped run at :2871 and reserves under the lock at :2914. The ship records its intent at :1563, re-reads the run under the lock at :1622 and asks `shipDrift` (:1723), whose refusal cancels the intent and the pool request and returns `wait` on `record-changed` (:1645-1670). `tests/scenarios/t0-flow.test.ts:2198` counts the card-run reads of a review dispatch and the DoD runs it unchanged, so the gate adds no read there. `GoalController.ensureCardRun` (src/loop/controller.ts:774) records the contract when the run is created. A prototype of this card (the gate inside `assess` for `next`, at the four head sites and the three locked sites) was run on 2026-11-22 against every example of items 1 to 9 and against the whole suite."
forbid: [weakening or skipping a test to go green, a change to what `CardRunner.amendCard` admits or records, a new directive kind, a change to src/core/contract.ts, editing .aidlc state by hand]
non_goals: [a record or a check of the owner's delegation, a gate on any other card command or on a disposition of findings, a gate on `aidlc next` of the goal, a gate on the commit of a review result or a ship result whose dispatch was admitted, a report of the changed fields outside a refusal, runs that hold no `contract`, a change of the card file made while a call runs]
hygiene: "The owner ruled on 2026-11-22 that an unrecorded change of a started card is refused by a gate (specs/card-continuation.md, Flagged concerns), and, in the session on the question issue 418 puts, that the gate does not depend on whether the amendment is admitted. This card supersedes T0-CONTRACT-GATE; its branch holds tests that can be reused. The gate adds no write of the card run, so `.claude/skills/verify-card-run-writes/SKILL.md` records nothing new; the DoD runs tests/scenarios/fault-points.test.ts. Before the first review, the evidence section holds a table that splits each requirement into its clauses and names the assertion that fails without each (docs/LESSONS.md, T1-AMEND-COMMAND). RED fails on assertions, not on a missing import (tdd skill). The byte-identical rows use runs that owe no event and hold no retained review result."
doc_sync: docs/OPERATIONS.md (Amendments), docs/ARCHITECTURE.md, changelog.d/T0-CONTRACT-GATE-2.md
---

# T0-CONTRACT-GATE-2

## Deliverable
One gate in the card runner. While the card of a started run differs from the contract the run recorded, the loop records no attempt, dispatches no review and no ship, and starts no build on that card, until the owner's amendment is recorded or the card text is restored.

## Why
`specs/card-continuation.md`, Flagged concerns, third point: a contract change that nobody records was detected by no gate, so the hard limit on a started card held by discipline alone. The owner ruled on 2026-11-22 that this changes.

T0-CONTRACT-GATE built the gate so that it applied only where `aidlc card amend` would be admitted. Two R3 decisions showed that rule cannot be held: whether an amendment is admitted depends on the operation ledger, a review in flight and a pending repair, which the call itself and other sessions change between its reads, and at the ship the call's own merge intent makes the amendment inadmissible (issue 418). The owner ruled in the session, on the question issue 418 puts, that the gate is independent of that: it applies whenever the card differs, on a run that is neither merged nor DONE. This card builds that gate and supersedes T0-CONTRACT-GATE.

## Rules that decide edge cases
- The gate reads the card and one record of its run. It reads no operation, no review in flight and no pending repair, so what another session does to those cannot change its answer.
- Where the amendment is refused while the gate applies, the loop does no work on the card until the card text is restored. The three cases and the way on in each, as the prototype ran them: with a pending repair, restore the card text, finish the repair, then change the card and amend; with a merge operation `intended`, restore the card text and ship; with a formal review in flight, let its result land (`aidlc review r3` commits a retained result before it asks the gate) and amend, or restore the card text. With an operation `issued`, `running` or `UNKNOWN` the selected state is WAIT, which R4 does not refuse.
- Each call keeps what it does before it asks the gate, with its own message or directive: the delivery of owed events; in `recordAttempt` the refusal of an interrupted mutant sweep; in `preReview` and `formalReview` the refusal of an unconfigured reviewer, in `formalReview` the commit of a result an earlier reservation retained, and in both the refusal of a stopped run; in `next` the stop under another session's live card lease and the wait for a plan checkpoint. The gate decides the calls these let through.
- A call acts on the card it read. R5 covers the one way the record can come to differ from that card during the call, an amendment another session records. On the three locked records the gate is one check among the others of that record, and whichever applies first refuses; item 9 uses an amendment of `budget`, which no other check sees. `recordAttempt` and the saves of `next` need no second check: their write is a compare-and-set on the record they read, so an amendment recorded meanwhile refuses them as stale. An amendment recorded between the first read of `next` and its state selection is seen by the gate of R4, which cannot tell it from an unrecorded change and refuses with the message of R6; the command made again proceeds. A refusal of R5 leaves what the other refusals on that record leave: in `formalReview` the `REVIEW_ADMITTED` event of the admission stays and the pool request is cancelled; at the ship the intent and the pool request are withdrawn with their events.
- A refusal of R2, R3 or R4 is an error of the call, as every other refusal of the runner is. It is no directive and no stop. At the ship's re-read the refusal is the existing `wait` on `record-changed`.
- A call the gate does not name (`aidlc card continue`, `withdraw`, `ci-reconcile`, `close`, `takeover`, `adopt-merge`, the dispositions of findings) is not refused, and neither is the commit of a review result or a ship result whose dispatch was admitted.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-contract-gate.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/card-amend-command.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the eight files passes, the build succeeds and every benchmark count is within its ceiling.

## Attempt evidence

### Attempt 1

RED receipt: `737e1aea:tests/scenarios/card-contract-gate.test.ts`. On that commit (base d08ffdd2, no source change) the file fails on assertions: 9 tests, 1 pass (item 5, whose rows the gate does not apply to), 8 fail, each with `ERR_ASSERTION` (missing expected exception or rejection, or an unexpected CLI exit); no import or type error, and `npm run typecheck` reports none. After RED the guard sweep added assertions to the same file (test 1: the owed event and the lost-checks success; test 3: the dirty-candidate scenario; test 5: `recordAttempt` on merged and DONE runs); no assertion of the RED commit was changed or removed.

DoD: the dod_command from the worktree, exit 0: typecheck no error; node --test over the eight files: 200 tests, 200 pass, 0 fail; build ok; bench: every count within its ceiling (6 journeys). Also `node --test tests/surface/*.test.ts`: exit 0, 1289 tests, 1275 pass, 0 fail, 14 skipped; `npm test`: exit 0, 4052 tests, 4020 pass, 0 fail, 32 skipped.

Guard sweep. Script outside the worktree (`sweep.mjs` in the session scratchpad): each row loosens one guard in `src/loop/card-runner.ts`, runs `node --test tests/scenarios/card-contract-gate.test.ts`, and restores the file. Every row exits 1.

| Guard | Loosened form | Failing tests | First failing assertion |
| --- | --- | --- | --- |
| R1 the record holds a `contract` | no-contract check removed (absent contract read as `{}`) | 5 | next on the no-contract row refused with all nine fields |
| R1 no `mergeVerified` | condition removed | 5 | `recordAttempt, mergeVerified` (the R6 message instead of the run's own refusal) |
| R1 not DONE | condition removed | 5 | next on the DONE row refused with the R6 message |
| R1 at least one field changed | `if (!changed.length) return undefined` removed | 1 to 9 | every unchanged-card call refused with an empty field list |
| R2 head site in `recordAttempt` | gate removed | 1, 4, 6 | `Missing expected exception: success` |
| R2 position after the owed events | gate moved before `deliverOwed` | 1 | `the owed event is delivered before the refusal` |
| R2 directly after the owed events | gate moved after the lost-checks refusal | 1 | `a success with lost checks` |
| R3 head site in `formalReview` | gate removed | 3, 4, 6 | `formalReview` |
| R3 head site in `preReview` | gate removed | 3 | `preReview` |
| R3 position after the stop refusal, `formalReview` | gate moved before the stop refusal | 6 | `formalReview` (R6 message instead of `card run is stopped (review)`) |
| R3 position after the stop refusal, `preReview` | gate moved before the stop refusal | 6 | `preReview` |
| R3 directly after the stop refusal, `formalReview` | gate moved after `refuseDirtyCandidate` | 3 | `formalReview, dirty candidate` |
| R3 directly after the stop refusal, `preReview` | gate moved after `refuseDirtyCandidate` | 3 | `preReview, dirty candidate` |
| R4 head site in the state selection of `next` | `gated` ignored | 1 to 4, 6 to 9 | `Missing expected exception: next` |
| R4 gated state BUILD | BUILD left out of the list | 1, 4, 6, 7, 8, 9 | `Missing expected exception: next` |
| R4 gated state REVIEW_FIX | REVIEW_FIX left out | 2, 6 | `Missing expected exception.` (test 2, next) |
| R4 gated state SHIP | SHIP left out | 3, 4, 7 | `Missing expected exception: next` |
| R4 dry renewal (no lease claim in a dry assessment) | the dry assessment claims the lease | 1 | `the card lease is not renewed` |
| R5 locked record of `formalReview` | `refuseAmendedContract` removed from the reservation | 9 | `Missing expected rejection.` (formalReview) |
| R5 locked record of `preReview` | `refuseAmendedContract` removed from the reservation | 9 | `Missing expected rejection.` (preReview) |
| R5 re-read before the ship | the `shipDrift` check disabled | 9 | the `wait` / `record-changed` directive deep-equal |

No row is `equivalent:`. The first sweep found the `mergeVerified` row undetected (a merged run selects CLOSE, which R4 does not gate); test 5 gained the `recordAttempt` comparison on merged and DONE runs, which detects it. The two "directly after" rows of R3 and the lost-checks row of R2 were added with their assertions in the same way.

Clauses (docs/LESSONS.md, T1-AMEND-COMMAND): each clause and the assertion that fails without it.

| Req | Clause | Assertion (test: message or value) |
| --- | --- | --- |
| R1 | one gate of the card and one record, reading nothing else (no operation, review in flight, pending repair) | 4: `next` refused with the R6 message in each of the three cases where `amendCard` refuses (repair, `intended` operation, review in flight), and `formalReview` in the third |
| R1 | applies only with a `contract` | 5: `no contract` kinds `['close','close']`, and the no-contract `recordAttempt` recorded (`outcomes` `['success']`) |
| R1 | applies only with no `mergeVerified` | 5: `recordAttempt, mergeVerified` |
| R1 | applies only when not DONE | 5: `DONE` kinds `['close','close']` |
| R1 | applies only when a field differs (`changedContractFields`) | 7: next returns `build` with the card text restored, `amendments` `[]`; sweep row "at least one field changed" fails every test |
| R1 | applies to no other record | 5: the three rows and the two `recordAttempt` rows |
| R2 | asked on the record `recordAttempt` reads | 1: `success`, `fail`, `not-counted` |
| R2 | directly after the owed events | 1: `the owed event is delivered before the refusal`; `a success with lost checks` |
| R2 | an attempt of any outcome refused | 1: the three outcomes |
| R2 | with the R6 message, before the write | 1: `refusal(['requirements'])` and the byte comparison after each outcome |
| R3 | `preReview` asks on the record it reads | 3: `preReview`; `preReview, dirty candidate` |
| R3 | `formalReview` asks on the record it reads | 3: `formalReview`; 4: `formalReview` with a review in flight |
| R3 | directly after the refusal of a stopped run | 6: `formalReview` and `preReview` reject with `card run is stopped (review)`; 3: the two dirty-candidate rejections |
| R3 | no round, no decision reserved | 3: `preReview.rounds.length` 0, `review.invocations.length` 0 |
| R3 | no request to the review pool | 3: `queued()` `[]` after `formalReview` (and in the dirty-candidate scenario) |
| R3 | no reviewer run | 3: `calls.r3` 0, `calls.r2` 0; 4: `calls.r3` stays 1 |
| R4 | asked on the record the state selection reads | 9: the amendment between the first read and the selection refused with `refusal(['budget'])` |
| R4 | before any write of the selection | 1, 2, 3: the byte comparisons after `next` |
| R4 | refused in BUILD | 1: `next` |
| R4 | refused in REVIEW_FIX | 2: `refusal(['requirements'])` |
| R4 | refused in SHIP (stored BUILD with a bound candidate, and after a pass) | 3: `next`, `next after the pass` |
| R4 | before saving the run or appending its own journal event | 1, 2, 3: byte comparisons; 3: `events('CARD_STATE').length` unchanged |
| R4 | before renewing the card lease | 1: `the card lease is not renewed` |
| R4 | before starting an attempt | 2: attempts unchanged; 9: `no attempt is started`, `no event after the amendment` |
| R4 | before dispatching a ship | 3: `ship.requests.length` 0 and no operation; 4: no ship request with an `intended` operation |
| R4 | every other state as for the unchanged card | 6: `prepare`; `operation issued/running/UNKNOWN` `['wait','wait']`; `stop` with its stop; 5: `close` |
| R4 | the state the gate judges is the state `next` executes: the operation ledger read once (attempt 2, F1) | 6 F1: `next during the completion` (`wait`), `no attempt is started`, `next after the completion` refused; `next during the renewal`; `next with an operation issued during the call` refused |
| R4 | the same for the worktree read (attempt 2, F1) | 6 F1: `the worktree that appears during the call`, `the worktree that appears during the renewal` (equal to the unchanged card with no worktree) |
| R4 | the same for the run record (attempt 2, class sweep) | 6 F1: `next with the record changed after its read` refused, the card lease not renewed |
| R5 | asked again on the record locked for the pre-review round | 9: `preReview` rejects with `amended(['budget'])`, no round, `calls.r2` 0 |
| R5 | asked again on the record locked for the formal decision | 9: `formalReview` rejects with `amended(['budget'])`, no invocation, `calls.r3` 0 |
| R5 | asked again on the record re-read before the ship | 9: `wait` on `record-changed`, `ship.requests.length` 0 |
| R5 | with the card the call holds | 9: the message names `budget`, the field the amendment recorded meanwhile |
| R5 | the reservation refused; the ship withdrawn as for any other change | 9: `the pool request is cancelled`; operation `['cancelled']`, queue `['completed','cancelled']` |
| R5 | message names the fields, that the contract was amended after the call read the run, and to run again | 9: `amended(['budget'])` exact text; the ship narration exact text |
| R5 | the call made again proceeds (rule) | 9: `the call made again records a decision`, `next made again ships`, `next` returns `build` |
| R6 | one message for R2, R3 and R4 | 1, 3: the same `refusal()` for `recordAttempt`, `next`, `formalReview`, `preReview` |
| R6 | names the card, the fields in `CONTRACT_FIELDS` order | 1: `next, two fields` (`requirements, acceptance`) |
| R6 | names `aidlc card amend <card> --by <who> --reason <text>`, the restoring, and that restoring is the way where the amendment is refused | 1: exact message text |
| R6 | `aidlc card next <card>` exits non-zero with the message | 8: `[r.status, r.stderr]` equal to `[1, 'aidlc: <message>\n']`, bytes unchanged |
| R7 | after the amendment the calls proceed | 7: `build`, outcomes `['success']`; `review` and `formalReview records a decision`; 4: `next after the amendment` returns `review` |
| R7 | with the card text restored the calls proceed | 7: `build`, `amendments` `[]`; 4: `build` and the repair ended, `next ships with the card text restored`, `next with the card text restored` returns `review` |
| R7 | a later change is refused again | 7: `the second change` refused with `refusal(['acceptance'])` |
| R8 | OPERATIONS, ARCHITECTURE, changelog texts | reviewer-verified (item 11); the changelog line passes `tests/surface/changelog-fragments.test.ts` |

### R3 decision 1

Candidate d9bddb59, blocked on one finding, F1: "[spec] [P1] 14 scope fidelity (class: contract-gate-selection-drift) @ src/loop/card-runner.ts:922: [Bugs] R4 is bypassed when a concurrent operation completes between the dry assessment and the actual assessment. [...]" It holds: the dry assessment of the gate and the executed assessment each read the operation ledger (`this.ops.unresolved`, twice per pass) and the worktree kind (`pathKind`) themselves, so an operation that completed between the passes let the dry pass select WAIT and the executed pass select BUILD, renew the lease and start an attempt.

Repair: `assess` reads each input of the selection that lies outside the run record once, through `SelectionFacts` (the unresolved operations of the card and the worktree kind off the dry-run ship path), on its first use, and keeps it; the dry assessment of the gate takes the same `SelectionFacts` with the record, lease and clock of the assessment it guards. The reads stay where the selection first needs them: a first version read them at the head of `assess`, before the reusable-receipt save, and `tests/scenarios/t0-flow.test.ts` (`T1-REVIEW-FINDINGS-4 R3 decision 1: the gate re-validates after the hand-off reload ...`, which writes the run at the first ledger read) failed with CARD_RUN_STALE; on an unchanged card the ledger is now read where it was before. The other inputs of the selection were checked: `reusableReceipt`, `blockAnswered`, `invocationBlocking`, `withContest`, `reviewNextAction`, `admittedDecisions` and `selectCardState` read only the run, the card and the configuration; `currentActor()` and `now` are the same for both passes. The lease claim is the one input the dry pass cannot have before the refusal; it assumes `renewed`. A claim that is not `renewed` either throws (`held`, the foreign dispatch, which writes nothing) or leaves the lease and the run as read (`acquired`, `expired`), and then differs from the dry pass only in keeping an ownership stop, which selects WAIT on an unknown operation or STOP, never BUILD, REVIEW_FIX or SHIP.

### Attempt 2

RED receipt: `aa3d09b6:tests/scenarios/card-contract-gate.test.ts`. On that commit, with the candidate's source, the new test `6 [R4] R3 decision 1 F1` fails for F1's reason: `next during the completion` expected `'wait'`, actual `'build'`; the other 9 tests pass. After RED the same test gained the renewal, first-read and record scenarios below, which the guard sweep needed; no earlier assertion changed.

DoD: the dod_command from the worktree, exit 0: typecheck no error; node --test over the eight files: 201 tests, 201 pass, 0 fail; build ok; bench: every count within its ceiling (6 journeys). `npm test`: exit 0, 4053 tests, 4021 pass, 0 fail, 32 skipped. The full guard sweep (25 rows of attempt 1 and these) reran on the repair: every row exits 1.

Guard sweep rows added (same script; every row exits 1):

| Guard | Loosened form | Failing test | First failing assertion |
| --- | --- | --- | --- |
| F1 the executed assessment selects on the facts read once | it reads the ledger again at the selection | 6 F1 | `next during the completion` |
| F1 the ledger read is kept | read again on each use | 6 F1 | `next during the completion` |
| F1 the worktree kind is kept | read again on each use | 6 F1 | `the worktree that appears during the renewal` |
| F1 the dry assessment takes the caller's facts | it reads the ledger and the worktree itself | 6 F1 | `the worktree that appears during the call` |
| F1 the worktree kind is read once | `pathKind` read at the selection | 6 F1 | `the worktree that appears during the renewal` |
| R4 the dry assessment takes the caller's record | it reads the run record itself | 6 F1 | `next with the record changed after its read` |
| R4 dry renewal (rerun) | the dry assessment claims the lease | 1 | `the card lease is not renewed` |

Class sweep (contract-gate-selection-drift: the gate's answer and the work admitted after it resting on different reads):
- `next`: the run record, the operation ledger, the worktree kind and the lease are now each read once for the gate and the executed selection; the lease renewal is covered by the reasoning above.
- The dry assessment of `dispatch` on a lease this session does not hold (which decides only whether to claim the lease for PREPARE): its selection and the gated one that follows both run with `prepared` false on the lease read once, and PREPARE precedes REVIEW_FIX, BUILD and SHIP in `selectCardState`, so neither can select a gated state. `equivalent:` sharing facts there changes no gated decision.
- `recordAttempt`: the gate does not depend on a selection; it reads the record once and the write is a compare-and-set on that record's revision.
- `preReview`, `formalReview` and the ship: the gate reads the record once and is asked again on the locked record (R5); no selection is involved.
- `takeover` calls `assess` without `gated`; the card names no gate there.
