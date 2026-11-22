---
id: T1-CARD-AMEND
title: "`aidlc card amend` records an amendment of a started card, clears the DoD receipt and re-derives the candidate digest by the fields that changed, and the hard limit on a started card names both recorded acts"
status: todo
branch: T1-CARD-AMEND
worktree: D:\wt\AIDLC\T1-CARD-AMEND
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/card-amend.test.ts
  - CLAUDE.md
  - templates/CLAUDE.aidlc.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CARD-AMEND.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-CARD-AMEND.md
dod_command: npm run typecheck && node --test tests/scenarios/card-amend.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/fault-points.test.ts tests/surface/claude-md-size.test.ts tests/surface/command-lines.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. WHEN `aidlc card amend <cardId> --by <who> --reason <text> [--goal <id>]` runs on a run whose recorded `contract` differs from the card of the main checkout, the command shall, in one locked update, append an amendment (`at`, `by`, `reason`, `revision` one above the run's `cardRevision`, `changed`, `invalidated`), set `cardRevision` to that revision and `contract` to the card's digests.
  - R2. WHEN `invalidated` holds `dod`, the update shall unset `dodReceipt` and `blockedReceipt` and reopen a succeeded effort episode as a review block does (`reopenAfterReviewBlock`), with the amendment's revision in the reason, so that the success that bound the candidate stays a success and the next attempt is admitted.
  - R3. WHEN `invalidated` holds `review`, the update shall replace `candidate.digest` and the `candidate` of each CI rerun that equals it by `amendedDigest` of that digest applied once, unset `blockedReceipt`, and leave every review invocation and every pre-review round as it is.
  - R4. WHILE a run holds n amendments whose `invalidated` holds `review`, `recordAttempt` shall record each candidate under `amendedDigest` of the digest it computes, applied n times.
  - R5. The update shall leave `state`, `stop`, `review`, `findings`, `continuations`, `redReceipt`, `deadline`, the commit of the candidate, the outcome of every attempt and, when `invalidated` holds no `dod`, `effort` as they were.
  - R6. IF the card has no run in the goal, the run is DONE or has `mergeVerified`, an operation of the card is `intended`, `issued`, `running` or `UNKNOWN`, a review invocation is `pending`, the run has a pending repair, the run holds no `contract`, the contract equals the card's, or `--by` or `--reason` is blank after trimming, THEN the command shall exit non-zero with the cause and write nothing.
  - R7. The update shall owe one `NOTE` event whose persisted data holds `amendment` (`by`, `reason`, `revision`, `changed`, `invalidated`), which the runner appends after the write and the next `aidlc card next` delivers once when that append failed.
  - R8. The command shall run on a goal in any state, as `aidlc card ci-reconcile` does, and start no run.
  - R9. The command's output shall hold the amendment and, for a run in STOP for `review` or `ci`, name `aidlc card continue`.
  - R10. The Hard limits of `CLAUDE.md` and of `templates/CLAUDE.aidlc.md` shall say, in place of the item "After a card run starts, do not edit the card's requirements, acceptance or budget", that a session does not change the contract of a started card on its own, that the owner's amendment is recorded with `aidlc card amend` and a stopped run continues with `aidlc card continue`, each only on the owner's instruction in the session or under a delegation the owner gave and the record names, and that a point the card does not cover and the owner does not amend becomes a follow-up issue.
  - R11. The files `docs/OPERATIONS.md` (a paragraph on the command with its refusals, the table of the evidence each field touches and what the act keeps), `docs/ARCHITECTURE.md` and `changelog.d/T1-CARD-AMEND.md` shall state R1 to R9.
acceptance:
  - 1. `tests/scenarios/card-amend.test.ts`, a run whose candidate R3 passed and that has not shipped, after the `acceptance` of its card changed on disk. The command exits 0: one amendment with `changed` `acceptance`, `invalidated` `dod` and `review` and revision 1; `cardRevision` 1; `contract` equal to the card's digests; no DoD receipt; an effort episode that is no longer `succeeded` and holds the same attempt outcomes; `candidate.digest` equal to `amendedDigest` of the old digest applied once, and so is the `candidate` of its CI rerun entry; the fields of R5 and the `candidateDigest` of every invocation are deep-equal to their values before. [R1] [R2] [R3] [R5] [dod arm 2]
  - 2. Same file. `aidlc card next` then returns a `build` directive and no ship; a successful attempt on the same commit records the amended digest; `aidlc card next` returns a `review` directive; the pass raises `substantiveDecisions` by one and the dry-run ship merges. In a second row the run had used its two decisions, and `aidlc card next` stops it for review after the attempt. [R3] [R4] [dod arm 2]
  - 3. Same file, one row per case. `budget` alone: the amendment holds `changed` `budget` and an empty `invalidated`, the DoD receipt and the digest stay, and `aidlc card next` ships with no new review. `dod_command` alone: the DoD receipt is unset and the digest stays, and after a successful attempt on the same commit `aidlc card next` ships with no new review. `requirements` alone: the DoD receipt stays, the digest is amended, and `aidlc card next` returns a `review` directive. [R1] [R2] [R3] [dod arm 2]
  - 4. Same file. On a run in STOP for review the amendment keeps the stop and the state, and the output names `aidlc card continue`; the command runs while the goal is stopped for review. [R5] [R8] [R9] [dod arm 2]
  - 5. Same file. Each refusal exits non-zero, names its cause and leaves the card-run file and the journal byte-identical: no run, a DONE run, a run with `mergeVerified`, an unresolved operation, a pending review invocation, a pending repair, a run with no `contract`, a contract equal to the card's, a blank `--by`. [R6] [dod arm 2]
  - 6. Same file. The journal gains exactly one `NOTE` event with `amendment`. Fault rows: a throw from `fs.renameSync` onto the card-run record leaves the card-run file and the journal byte-identical; a throw from `fs.appendFileSync` onto the goal journal leaves the amendment in the run, and after one `aidlc card next` the journal holds exactly one such event. [R7] [dod arm 2]
  - 7. Both rule files hold the text of R10 and no longer hold the replaced item; `tests/surface/claude-md-size.test.ts`, `command-lines.test.ts`, `mirror.test.ts` and `templates.test.ts` pass. The record of `.claude/skills/verify-card-run-writes/SKILL.md` names `CardRunner.amendCard` among the commands the check does not drive, with `tests/scenarios/card-amend.test.ts`, within 8000 bytes. `tests/scenarios/card-contract.test.ts`, `card-continue.test.ts` and `fault-points.test.ts` pass with no line changed. [R10] [dod arm 1] [dod arm 2]
  - 8. The docs state R1 to R9 (reviewer-verified against the diff). [R11]
depends_on: [T1-CARD-CONTRACT]
budget: 230
sweep: "On main at f51534d2. git grep -n '\\.candidate(' -- src: one caller, src/loop/card-runner.ts:1348, in `recordAttempt`; :1359 is the dry-run path of the same function, which takes the commit as the digest. Both get R4. Readers of a candidate digest that this card leaves as they are, because the invocations keep their digests: `lastFormalInvocation` :1971, `ruledPass` :1956, `secondPassDue` :1943, the pending-block evidence :888-895, the repeated-pass rule src/core/review-policy.ts:159, the same-candidate rule :2072-2078 (it compares commits). `canRerun` (src/core/ci-policy.ts:366-384) counts reruns by `candidate`, which R3 carries. The blocked receipt (src/core/types.ts:574-581, `reusableReceipt` src/loop/card-runner.ts:578-589) is bound to a digest and is unset. CLAUDE.md:168-170 and templates/CLAUDE.aidlc.md:50 hold the item R10 replaces; CLAUDE.md has 192 of 200 lines. src/cli/main.ts:776-785 (`ci-reconcile`) is the command line on a stopped goal, and :719-750 a command that reads an existing run and starts none."
forbid: [weakening or skipping a test to go green, changing the digest of a review invocation or of a pre-review round, changing a review counter, lifting a stop, moving a deadline, editing a card file from the command, a change to tests/scenarios/fault-points.test.ts, a change to .claude/skills/aidlc-loop/, editing .aidlc state by hand]
non_goals: [a gate or a report when the card differs from the recorded contract, an amendment of a run created before T1-CARD-CONTRACT (it holds no `contract` and is refused), an amendment while a repair is pending, a record or a check of the owner's delegation, the amendment among the commands tests/scenarios/fault-points.test.ts drives, a change to `aidlc goal amend`]
hygiene: "Line numbers are from main at f51534d2; read them again at PREPARE. Follow `CardRunner.ruleFinding` (src/loop/card-runner.ts:661-676) for the locked update and the owed event. Edit CLAUDE.md and templates/CLAUDE.aidlc.md together: the section 'AI-native SDLC (aidlc)' of CLAUDE.md is the template's text. The skill record is near its 8000 bytes: shorten other words of its list to fit. This card changes a file the verify-card-run-writes coverage record names, so that skill runs before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (the command), docs/ARCHITECTURE.md, CLAUDE.md, templates/CLAUDE.aidlc.md
---

# T1-CARD-AMEND

## Deliverable
The owner's amendment of a started card is one recorded act: the run keeps its findings, decisions and counters, and loses only the evidence the changed fields touch. The hard limit on a started card says who may change it and by which commands.

## Why
`specs/card-continuation.md`, R11 to R17. A started card is amended today by a commit with no effect on the run: a review pass given under the old requirements still ships, and no record says what changed. Two rule texts disagree about whether it may be done at all.

## Rules that decide edge cases
- The act records a change that a commit to the card file already made. It edits no card.
- An amended candidate is another candidate to every review rule, because its digest differs; its commit, its findings and its counters stay.
- The act lifts no stop: a stopped run is amended first and continued second.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-amend.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/fault-points.test.ts tests/surface/claude-md-size.test.ts tests/surface/command-lines.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck reports no error and every test of the eight files passes.
