---
id: T0-CONTRACT-GATE
title: "The loop refuses new work on a card run whose card differs from its recorded contract, wherever the owner's amendment could be recorded"
status: todo
branch: T0-CONTRACT-GATE
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/card-contract-gate.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-CONTRACT-GATE.md
  - specs/tasks/T0-CONTRACT-GATE.md
dod_command: npm run typecheck && node --test tests/scenarios/card-contract-gate.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/card-amend-command.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The card runner shall hold one contract gate, which applies to a card run when the run holds a `contract`, at least one contract field of the card has another digest than the run's (`changedContractFields`), and `CardRunner.amendCard` would admit an amendment of the run for a `by` and a `reason` that are not blank; the gate shall apply to no other run.
  - R2. WHEN the gate applies, `CardRunner.recordAttempt` shall refuse an attempt of any outcome before its write.
  - R3. WHEN the gate applies, `CardRunner.preReview` and `CardRunner.formalReview` shall refuse before a round or a decision is reserved and before the reviewer runs, reading the card run no more often than they do without the gate.
  - R4. WHEN the gate applies and the selected state of the run is BUILD, REVIEW_FIX or SHIP, `CardRunner.next` shall refuse before it saves the run, appends a journal event of its own, starts an attempt or dispatches a ship.
  - R5. WHEN the selected state of the run is PREPARE or STOP, `CardRunner.next` shall return what it returns for the unchanged card.
  - R6. Each refusal shall carry one message that names the card, the changed contract fields in the order of `CONTRACT_FIELDS`, the command `aidlc card amend <card> --by <who> --reason <text>` as the owner's act, and the restoring of the card text as the other way, and `aidlc card next <card>` shall exit non-zero with that message.
  - R7. WHEN the amendment is recorded or the card text is restored, the calls the gate refused shall proceed as they do for an unchanged card.
  - R8. `docs/OPERATIONS.md`, Amendments, shall state R1 to R7 and that where no amendment is admitted the loop goes on until one is; `docs/ARCHITECTURE.md` shall name the gate beside `CardRunner.amendCard`; `changelog.d/T0-CONTRACT-GATE.md` shall say in one entry what the loop now refuses.
acceptance:
  - 1. `tests/scenarios/card-contract-gate.test.ts`, a run in BUILD with an attempt running, after the `requirements` of the card changed on disk. `next` rejects with a message that holds the card id, `requirements`, `aidlc card amend <card> --by <who> --reason <text>` and the restoring of the card text; `recordAttempt` with the outcomes `success`, `fail` and `not-counted` each reject with the same message; after each call the card-run file and the journal are byte-identical. With `requirements` and `acceptance` both changed the message names both, in that order. [R1] [R2] [R4] [R6] [dod arm 2]
  - 2. Same file, a run in REVIEW_FIX after an R3 block on decision 1, the card changed. `next` rejects with the message, the attempts of the effort episode are as they were, and the card-run file and the journal are byte-identical. [R4] [dod arm 2]
  - 3. Same file, the selected state SHIP, the card changed. On a bound candidate with no review, whose stored state is still BUILD, `next` rejects and the journal holds no further `CARD_STATE` event; `formalReview` rejects, the run holds no invocation and the reviewer did not run. After an R3 pass, `next` rejects, the ship path received no request and the operation ledger holds no operation of the card. With pre-review configured, `preReview` rejects, the run holds no round and the reviewer did not run. After each call the card-run file and the journal are byte-identical. [R3] [R4] [dod arm 2]
  - 4. Same file, the rows where no amendment is admitted, each with the card changed, seeded as `tests/scenarios/card-amend.test.ts`, acceptance 4, seeds them. A run with no `contract`, a run with `mergeVerified`, a run that is DONE, an operation of the card in each of `intended`, `issued`, `running` and `UNKNOWN`, a pending formal invocation and a pending repair. On each, `next` returns the directive kind it returns on the same run for the unchanged card, and with a pending repair or no `contract` a `recordAttempt` that is admitted for the unchanged card is recorded. With a `withdrawn` repair finished by a success on another commit, `next` then rejects with the message and `amendCard` is admitted. [R1] [dod arm 2]
  - 5. Same file. A run created and not yet prepared returns the `prepare` directive, and a run stopped for review returns the `stop` directive with its stop, each with the card changed. [R5] [dod arm 2]
  - 6. Same file. After `amendCard` on the run of item 1, `next` returns the `build` directive; a second change of the card is refused again; with the card text restored in place of an amendment, `next` returns the `build` directive and the run holds no amendment. After `amendCard` on the passed candidate of item 3, `next` returns the `review` directive. [R7] [dod arm 2]
  - 7. Same file. `aidlc card next <card>` through the CLI on the run of item 1 exits 1 with the message on its standard error, and the card-run file and the journal are byte-identical. [R6] [dod arm 2]
  - 8. `tests/scenarios/card-amend.test.ts`, `card-amend-command.test.ts`, `card-contract.test.ts`, `card-continue.test.ts`, `candidate-withdraw.test.ts`, `t0-flow.test.ts` and `fault-points.test.ts` pass with no line changed, the typecheck reports no error, and `npm run build && npm run bench -- --check` exits 0. [R3] [dod arm 1] [dod arm 2] [dod arm 3]
  - 9. Each of the three texts holds what R8 assigns to it (reviewer-verified against the diff). [R8]
depends_on: []
budget: 250
tdd: true
sweep: "On main at abcc1298. `CardRunner.amendmentRefusal` (src/loop/card-runner.ts:746-759) is the one statement of when an amendment is admitted; called with a `by` and a `reason` that are not blank it returns nothing exactly when R1's third condition holds and the contract differs. `CardRunner.dispatch` (:1033-1144) selects the state in `assess` (:1063), which journals a `CARD_STATE` event before the state's handler saves the run; `assess` with `dry: true` (:1056) selects the state and writes nothing. `recordAttempt` is at :1389, `formalReview` at :2195, `preReview` at :2864; the two reviews read the persisted run for their guards, and `tests/scenarios/t0-flow.test.ts:2198` counts those reads. A throwaway gate placed after `assess` and at the head of the three methods was run against the whole suite on 2026-11-22: 4043 tests, 1 failure, that read count; no test changes a contract field of a started card without an amendment. The same throwaway gate, placed after `assess`, appended one `CARD_STATE` event (BUILD to SHIP) on every refused `next` of acceptance 3, first case: the gate has to decide before that append."
forbid: [weakening or skipping a test to go green, a change to what `CardRunner.amendCard` admits or records, a gate that applies where no amendment is admitted, a new read of the card run in `preReview` or `formalReview`, a write or a journal event made by a refusal, a new directive kind, a change to src/core/contract.ts, editing .aidlc state by hand]
non_goals: [a record or a check of the owner's delegation, a gate on `aidlc card continue`, `aidlc card withdraw`, `aidlc card ci-reconcile`, `aidlc card close` or the review dispositions, a gate on `aidlc next` of the goal, a report of the changed fields outside a refusal, runs created before T1-CARD-CONTRACT-2]
hygiene: "The owner ruled on 2026-11-22 that an unrecorded change of a started card is refused by a gate (specs/card-continuation.md, Flagged concerns). The gate adds no write, so `.claude/skills/verify-card-run-writes/SKILL.md` records nothing new; the DoD runs tests/scenarios/fault-points.test.ts. Before the first review, the evidence section holds a table that splits each requirement into its clauses and names the assertion that fails without each (docs/LESSONS.md, T1-AMEND-COMMAND). RED fails on assertions, not on a missing import (tdd skill). An owed event of an earlier write is outside this card: the byte-identical rows use runs that owe none."
doc_sync: docs/OPERATIONS.md (Amendments), docs/ARCHITECTURE.md, changelog.d/T0-CONTRACT-GATE.md
---

# T0-CONTRACT-GATE

## Deliverable
One gate in the card runner. While the card of a started run differs from the contract the run recorded, and the owner's amendment could be recorded, the loop records no attempt, dispatches no review and no ship, and starts no build on that card.

## Why
`specs/card-continuation.md`, Flagged concerns, third point: a contract change that nobody records was detected by no gate, so the hard limit on a started card held by discipline alone. The owner ruled on 2026-11-22 that this changes. The run already holds the nine digests (T1-CARD-CONTRACT-2) and the act that records a change (T1-CARD-AMEND, T1-AMEND-COMMAND).

## Rules that decide edge cases
- The gate and the amendment share one statement of when an amendment is admitted. Where `aidlc card amend` would refuse for another reason than an equal contract (a merged or DONE run, an unresolved operation, a formal review in flight, a pending repair, no `contract`), the gate does not apply and the loop goes on as it does today. The loop reaches a point where the amendment is admitted, or the run merges and the change goes to a follow-up card, which is the amendment's own rule. The amendment, once recorded, invalidates the evidence its fields touch, whenever that evidence was made.
- WAIT is selected for an operation that is running or whose outcome is unknown. No amendment is admitted there, so R1 keeps the gate out of it.
- A refusal is an error of the call, as every other refusal of the runner is. It is no directive and no stop.
- A call the gate does not name (`aidlc card continue`, `withdraw`, `ci-reconcile`, `close`, the dispositions of findings) is not refused.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-contract-gate.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/card-amend-command.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the eight files passes, the build succeeds and every benchmark count is within its ceiling.

## Attempt evidence
