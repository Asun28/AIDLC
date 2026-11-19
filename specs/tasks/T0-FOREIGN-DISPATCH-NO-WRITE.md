---
id: T0-FOREIGN-DISPATCH-NO-WRITE
title: aidlc card next from a session that is not the holder of a live card lease writes nothing to the run record or the journal and returns a stop that names the holder, where it saved an ownership STOP onto the holder's run (issue 378)
status: todo
branch: T0-FOREIGN-DISPATCH-NO-WRITE
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/foreign-dispatch.test.ts
  - tests/scenarios/two-windows.test.ts
  - tests/scenarios/ownership-wait.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE.md
  - specs/tasks/T0-FOREIGN-DISPATCH-NO-WRITE.md
dod_command: npm run typecheck && node --test tests/scenarios/foreign-dispatch.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/ownership-wait.test.ts tests/scenarios/t0-flow.test.ts tests/core/card-machine.test.ts tests/infra/worktree.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. When `CardRunner.next` runs while the card lease record is unreleased, not past `expiresAt`, and owned by a session or host other than the acting one (a foreign live lease), it shall return a `stop` directive with reason `ownership` and leave the run record and the goal journal unchanged - no `save`, no `CARD_STATE`, no `NOTE`, no lease write. This covers the assessment path (`assess`, today src/loop/card-runner.ts:790 and the save at :959) and the `held` claim in `prepare` (today :1065-1068), which saves the same stop when a lease is taken between the assessment and the claim. Line numbers are from main at ff925160; read them again at PREPARE.
  - R2. The stop of R1 shall have a detail that names the holder session, host, lease generation and `expiresAt`, and a nextAction that says the holder continues the card, and that `aidlc card takeover <card> --goal <goal>` applies only once the lease has expired and the card's operations are reconciled.
  - R3. Every other ownership path shall behave as on main - the holder's own renewal and its revalidation of an ownership stop; a stop of the holder's own dispatch carrying an old generation; the ownership stop of an expired lease at PREPARE's claim; the lifting of an ownership stop whose lease is absent or released; the read of the stored run over the caller's snapshot; a persisted blocking stop (risk, time) that stands; `aidlc next` waiting on a projected card stopped for ownership under a live lease, for a stop already on the record.
  - R4. docs/OPERATIONS.md (Sessions, the sentence "a dispatch from a window that kept the run it read before the takeover records only its ownership stop on the stored run (which the owner's next call clears)") and the stop table row `ownership`, and the doc comment of `assess`, shall state R1 instead; docs/ARCHITECTURE.md is changed only where a sentence states the old behaviour. A new fragment changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE.md records the change.
acceptance:
  - 1. tests/scenarios/foreign-dispatch.test.ts, new test "T0-FOREIGN-DISPATCH-NO-WRITE acceptance 1 - card next under another session's live card lease writes nothing and names the holder" - session B prepares the card and holds its lease; session A runs `runner().next` on the stored run in BUILD; the directive is `stop`, reason `ownership`, its detail names B's session, the generation and the expiry; the run file bytes, the journal line count and the lease file bytes are as before A's call.
  - 2. Same file, new test "T0-FOREIGN-DISPATCH-NO-WRITE acceptance 2 - the holder continues after a foreign dispatch with no recovery step" - after acceptance 1's call, B's `runner().next` returns the BUILD directive it returned before A's call, and journals no `LEASE_RENEWED` with `revalidated`.
  - 3. Same file, new test "T0-FOREIGN-DISPATCH-NO-WRITE acceptance 3 - the held claim in PREPARE writes nothing" - a lease B takes after A's assessment selected PREPARE (injected through the lease store between the two reads) makes A's call return the stop of R2 with the run and journal unchanged.
  - 4. tests/scenarios/two-windows.test.ts, the test around line 320 ("A's stale dispatch then records its ownership stop") asserts the new behaviour - A's directive is `stop`/`ownership` and the stored run keeps state BUILD with no stop; its other assertions (generation, lease holder) stay.
  - 5. A fixture that relied on a foreign dispatch to persist an ownership stop (tests/scenarios/ownership-wait.test.ts `stoppedForOwnership`, and any other found by the DoD run) writes that stop with `fx.store.saveCardRun` and `makeStop`, as tests/scenarios/two-windows.test.ts:677 does; every assertion after the fixture stays as on main.
  - 6. Every other test in the DoD passes with no line changed, and fault-points.test.ts passes (the change removes writes from `CardRunner.next` and adds none).
depends_on: []
budget: 200
tdd: true
sweep: "Main at ff925160. The foreign live lease reaches a write in two places in `CardRunner.next` - the selection of `assess` (`ownershipCurrent` false at src/loop/card-runner.ts:790, then the `reusableReceipt` save at :795 when a receipt is kept, the `CARD_STATE` append at :865 and the STOP save at :959) and the `held` claim of `prepare` (:1065-1068). The ownership STOP of an expired lease at :1070-1073 and the worktree-mismatch stop at :1088-1094 are not foreign-live cases and stay. `takeover` refuses a live foreign lease before any write and is unchanged. tests/scenarios/two-windows.test.ts:320-330 asserts the persisted foreign stop (the behaviour this card reverses, ruled by the owner in session add441b9 on 2026-11-19); tests/scenarios/ownership-wait.test.ts:20-34 builds its fixture through it. tests/scenarios/two-windows.test.ts:398 and :862 and the other ownership tests set the stop directly or exercise the holder's path; the DoD run confirms."
forbid:
  - weakening, skipping or deleting a test to go green; the assertions of acceptance 4 and the fixtures of acceptance 5 change only as those items say
  - a change to `selectCardState` or its precedence in src/core/card-machine.ts
  - a change to `CardRunner.takeover`, `recordAttempt`, the lease store or the goal controller
non_goals:
  - "`aidlc card attempt` and `card report` from a foreign session; `recordAttempt` stays unfenced as documented (docs/OPERATIONS.md, Sessions)"
  - "`deliverOwed` at the start of `next`, which journals an event a lost append owed; it is not caused by the foreign dispatch"
  - "issue 379, takeover of a goal that is already DONE"
  - "goal records written by `aidlc next` from a foreign session (issue 300)"
diagnosis:
  root_cause: "`assess` treats a foreign live lease as a card state (`selectCardState` step 2, STOP/ownership) and `next` persists every selected STOP. The run belongs to the lease holder, so a session that only reads the card ends the holder's run, and journals a CARD_STATE in the holder's name of the goal."
  reproduction: "Goal g-20261118102948-c1d226, journal seq 34 (2026-11-18T20:06:40Z) - session add441b9 ran `aidlc card next T1-PREPARE-LESSONS-REF` while session 7b2c2fc6 held the card lease (expiry 20:14:55Z); the run went BUILD -> STOP `stale ownership generation`, revision 4. In the suite, tests/scenarios/two-windows.test.ts:323-327 reproduces it and asserts it."
  same_class: "the `held` claim in `prepare` (R1). Not the same class - the expired-lease stop at PREPARE (the holder may be gone, so the stop guides the takeover) and the ownership stop of the holder's own stale generation."
hygiene: "Issue 378. Owner ruling 2026-11-19 in session add441b9 - change the documented behaviour rather than close the issue. RED first - commit acceptance 1 to 4 against src/ as on main (acceptance 1 and 3 fail on the write, acceptance 4 fails on the stored stop), then the fix. .claude/skills/verify-card-run-writes/SKILL.md covers `CardRunner.next` and `CardRunner.save`; run its check before SHIP and record the result. The card adds a test file; it lands in a CI shard by path and needs no workflow change."
doc_sync: changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE.md
---

# T0-FOREIGN-DISPATCH-NO-WRITE

Issue 378. A session that does not hold a live card lease can read the
card, and today its `aidlc card next` also saves an ownership STOP onto
the holder's run. The holder's next `card next` clears that stop, but if
the holder is idle until its lease expires, `aidlc next` stops the goal
on it. With this card the foreign dispatch is read-only: it returns the
stop, naming the holder, and writes nothing.
