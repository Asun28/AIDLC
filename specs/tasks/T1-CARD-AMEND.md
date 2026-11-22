---
id: T1-CARD-AMEND
title: "The runner records an amendment of a started card in one locked update, clears the DoD receipt and re-derives the candidate digest by the fields that changed"
status: todo
branch: T1-CARD-AMEND
worktree: D:\wt\AIDLC\T1-CARD-AMEND
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/card-amend.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CARD-AMEND.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-CARD-AMEND.md
dod_command: npm run typecheck && node --test tests/scenarios/card-amend.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/fault-points.test.ts tests/surface/templates.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. WHEN `CardRunner.amendCard(goal, card, act)` is called with `by` and `reason` on a run whose recorded `contract` differs from the digests of `card`, the runner shall, in one locked update, append an amendment (`at`, `by`, `reason`, `revision` one above the run's `cardRevision`, `changed`, `invalidated`), set `cardRevision` to that revision and `contract` to the card's digests.
  - R2. WHEN `invalidated` holds `dod`, the update shall unset `dodReceipt` and `blockedReceipt` and reopen a succeeded effort episode as a review block does (`reopenAfterReviewBlock`), with the amendment's revision in the reason, so that the success that bound the candidate stays a success and the next attempt is admitted.
  - R3. WHEN `invalidated` holds `review`, the update shall replace `candidate.digest` and the `candidate` of each CI rerun that equals it by `amendedDigest` of that digest applied once, unset `blockedReceipt`, and leave every review invocation and every pre-review round as it is.
  - R4. WHILE a run holds n amendments whose `invalidated` holds `review`, `recordAttempt` shall record each candidate under `amendedDigest` of the digest it computes, applied n times.
  - R5. The update shall leave `state`, `stop`, `review`, `findings`, `continuations`, `redReceipt`, `deadline`, the commit of the candidate, the outcome of every attempt and, when `invalidated` holds no `dod`, `effort` as they were.
  - R6. IF the card has no run in the goal, the run is DONE or has `mergeVerified`, an operation of the card is `intended`, `issued`, `running` or `UNKNOWN`, a review invocation is `pending`, the run has a pending repair, the run holds no `contract`, the contract equals the card's, or `by` or `reason` is blank after trimming, THEN the runner shall throw with the cause and write nothing.
  - R7. The update shall owe one `NOTE` event whose persisted data holds `amendment` (`by`, `reason`, `revision`, `changed`, `invalidated`), which the runner appends after the write and the next `aidlc card next` delivers once when that append failed.
  - R8. The file `docs/ARCHITECTURE.md` shall state R1 to R7; `changelog.d/T1-CARD-AMEND.md` says in one entry what `CardRunner.amendCard` records and invalidates and that the command arrives with T1-AMEND-COMMAND.
acceptance:
  - 1. `tests/scenarios/card-amend.test.ts`, a run whose candidate R3 passed and that has not shipped, after the `acceptance` of its card changed. `amendCard` records one amendment with `changed` `acceptance`, `invalidated` `dod` and `review` and revision 1; `cardRevision` is 1; `contract` equals the card's digests; the run holds no DoD receipt and an effort episode that is no longer `succeeded` with the same attempt outcomes; `candidate.digest` equals `amendedDigest` of the old digest applied once, and so does the `candidate` of a CI rerun entry the run held for it; the fields of R5 and the `candidateDigest` of every invocation are deep-equal to their values before. [R1] [R2] [R3] [R5] [dod arm 2]
  - 2. Same file. `aidlc card next` then returns a `build` directive and no ship; a successful attempt on the same commit records the amended digest; `aidlc card next` returns a `review` directive; the pass raises `substantiveDecisions` by one and the dry-run ship merges. In a second row the run had used its two decisions, and `aidlc card next` stops it for review after the attempt. [R3] [R4] [dod arm 2]
  - 3. Same file, one row per case. `budget` alone: the amendment holds `changed` `budget` and an empty `invalidated`, the DoD receipt and the digest stay, and `aidlc card next` ships with no new review. `dod_command` alone: the DoD receipt is unset and the digest stays, and after a successful attempt on the same commit `aidlc card next` ships with no new review. `requirements` alone: the DoD receipt stays, the digest is amended, and `aidlc card next` returns a `review` directive. A run in STOP for review: the amendment keeps the stop and the state. [R1] [R2] [R3] [R5] [dod arm 2]
  - 4. Same file. Each refusal names its cause and leaves the card-run file, where one exists, and the journal byte-identical: no run, a DONE run, a run with `mergeVerified`, an unresolved operation, a pending review invocation, a pending repair, a run with no `contract`, a contract equal to the card's, a blank `by`. [R6] [dod arm 2]
  - 5. Same file. The journal gains exactly one `NOTE` event with `amendment`. Fault rows: a throw from `fs.renameSync` onto the card-run record leaves the card-run file and the journal byte-identical; a throw from `fs.appendFileSync` onto the goal journal leaves the amendment in the run, and after one `aidlc card next` the journal holds exactly one such event. [R7] [dod arm 2]
  - 6. The record of `.claude/skills/verify-card-run-writes/SKILL.md` names `CardRunner.amendCard` among the commands the check does not drive, with `tests/scenarios/card-amend.test.ts`, within 8000 bytes. `tests/scenarios/card-contract.test.ts`, `card-continue.test.ts` and `fault-points.test.ts` pass with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 7. Each of the two texts holds what R8 assigns to it and no more is required of it (reviewer-verified against the diff). [R8]
depends_on: [T1-CARD-CONTRACT]
budget: 240
sweep: "On main at 212ff184. git grep -n '\\.candidate(' -- src: one caller, src/loop/card-runner.ts:1348, in `recordAttempt`; :1359 is the dry-run path of the same function, which takes the commit as the digest. Both get R4. Readers of a candidate digest that this card leaves as they are, because the invocations keep their digests: `lastFormalInvocation` :1971, `ruledPass` :1956, `secondPassDue` :1943, the pending-block evidence :888-895, the repeated-pass rule src/core/review-policy.ts:159, the same-candidate rule :2072-2078 (it compares commits). `canRerun` (src/core/ci-policy.ts:366-384) counts reruns by `candidate`, which R3 carries. The blocked receipt (src/core/types.ts, `reusableReceipt` src/loop/card-runner.ts:578-589) is bound to a digest and is unset. `reopenAfterReviewBlock` is src/core/effort.ts:39. The owed event type `NOTE` comes from T1-OWED-EVENT-TYPES; `contractDigests`, `changedContractFields`, `invalidatedBy` and `amendedDigest` from T1-CARD-CONTRACT."
forbid: [weakening or skipping a test to go green, changing the digest of a review invocation or of a pre-review round, changing a review counter, lifting a stop, moving a deadline, editing a card file from the runner, a change to tests/scenarios/fault-points.test.ts, editing .aidlc state by hand]
non_goals: [the command, its output and the rule text (T1-AMEND-COMMAND), a gate or a report when the card differs from the recorded contract, an amendment of a run created before T1-CARD-CONTRACT (it holds no `contract` and is refused), an amendment while a repair is pending, a record or a check of the owner's delegation, the amendment among the commands tests/scenarios/fault-points.test.ts drives, a change to `aidlc goal amend`]
hygiene: "Line numbers are from main at 212ff184; read them again at PREPARE. Follow `CardRunner.ruleFinding` (src/loop/card-runner.ts:661-676) for the locked update and the owed event, with the amendment in the persisted event data. The skill record is near its 8000 bytes: change only the lines that must change. The DoD runs the loop benchmark after the build. Run every test file that reads docs/ARCHITECTURE.md before the attempt is recorded. This card changes a file the verify-card-run-writes coverage record names, so that skill runs before SHIP and at CLOSE."
doc_sync: docs/ARCHITECTURE.md
---

# T1-CARD-AMEND

## Deliverable
`CardRunner.amendCard` records the owner's amendment of a started card: the run keeps its findings, decisions and counters, and loses only the evidence the changed fields touch.

## Why
`specs/card-continuation.md`, R11 to R16. A started card is amended today by a commit with no effect on the run: a review pass given under the old requirements still ships, and no record says what changed.

## Rules that decide edge cases
- The act records a change that a commit to the card file already made. It edits no card.
- An amended candidate is another candidate to every review rule, because its digest differs; its commit, its findings and its counters stay.
- The act lifts no stop: a stopped run is amended first and continued second.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-amend.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/fault-points.test.ts tests/surface/templates.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the five files passes, the build succeeds and every benchmark count is within its ceiling.
