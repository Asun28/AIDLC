---
id: T0-FOREIGN-DISPATCH-NO-WRITE-2
title: (replaces T0-FOREIGN-DISPATCH-NO-WRITE and carries its candidate) aidlc card next from a session that is not the holder of a live card lease writes nothing to the run record or the journal and returns a stop that names the holder, where it saved an ownership STOP onto the holder's run (issue 378)
status: todo
branch: T0-FOREIGN-DISPATCH-NO-WRITE-2
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/foreign-dispatch.test.ts
  - tests/scenarios/two-windows.test.ts
  - tests/scenarios/ownership-wait.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE-2.md
  - specs/tasks/T0-FOREIGN-DISPATCH-NO-WRITE-2.md
  - src/cli/main.ts
  - specs/tasks/T0-FOREIGN-DISPATCH-NO-WRITE.md
dod_command: npm run typecheck && node --test tests/scenarios/foreign-dispatch.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/ownership-wait.test.ts tests/scenarios/t0-flow.test.ts tests/core/card-machine.test.ts tests/infra/worktree.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. When `CardRunner.next` runs while the card lease record is unreleased, not past `expiresAt`, and owned by a session or host other than the acting one (a foreign live lease), it shall return a `stop` directive with reason `ownership` and leave the run record and the goal journal unchanged - no `save`, no `CARD_STATE`, no `NOTE`, no lease write. This covers the assessment path (`assess`, today src/loop/card-runner.ts:790 and the save at :959) and the `held` claim in `prepare` (today :1065-1068), which saves the same stop when a lease is taken between the assessment and the claim. Line numbers are from main at ff925160; read them again at PREPARE.
  - R2. The stop of R1 shall have a detail that names the holder session, host, lease generation and `expiresAt`, and a nextAction that says the holder continues the card, and that `aidlc card takeover <card> --goal <goal>` applies only once the lease has expired and the card's operations are reconciled.
  - R3. Every other ownership path shall behave as on main - the holder's own renewal and its revalidation of an ownership stop; a stop of the holder's own dispatch carrying an old generation; the ownership stop of an expired lease at PREPARE's claim; the lifting of an ownership stop whose lease is absent or released; the read of the stored run over the caller's snapshot; a persisted blocking stop (risk, time) that stands; `aidlc next` waiting on a projected card stopped for ownership under a live lease, for a stop already on the record.
  - R4. docs/OPERATIONS.md (Sessions, the sentence "a dispatch from a window that kept the run it read before the takeover records only its ownership stop on the stored run (which the owner's next call clears)") and the stop table row `ownership`, and the doc comment of `assess`, shall state R1 instead; docs/ARCHITECTURE.md is changed only where a sentence states the old behaviour. The comment in the `card status` action of src/cli/main.ts (today :778, "a run stopped for ownership before PREPARE names no owner in its stop") shall say that the stop of a dispatch under another session's live lease names the holder and is not saved; no code line of src/cli/main.ts changes. A new fragment changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE-2.md records the change.
acceptance:
  - 1. tests/scenarios/foreign-dispatch.test.ts, new test "T0-FOREIGN-DISPATCH-NO-WRITE acceptance 1 - card next under another session's live card lease writes nothing and names the holder" - session B prepares the card and holds its lease; session A runs `runner().next` on the stored run in BUILD; the directive is `stop`, reason `ownership`, its detail names B's session, the generation and the expiry; the run file bytes, the journal line count and the lease file bytes are as before A's call.
  - 2. Same file, new test "T0-FOREIGN-DISPATCH-NO-WRITE acceptance 2 - the holder continues after a foreign dispatch with no recovery step" - after acceptance 1's call, B's `runner().next` returns the BUILD directive it returned before A's call, and journals no `LEASE_RENEWED` with `revalidated`.
  - 3. Same file, new test "T0-FOREIGN-DISPATCH-NO-WRITE acceptance 3 - the held claim in PREPARE writes nothing" - a lease B takes after A's assessment selected PREPARE (injected through the lease store between the two reads) makes A's call return the stop of R2 with the run and journal unchanged.
  - 4. tests/scenarios/two-windows.test.ts, the test around line 320 ("A's stale dispatch then records its ownership stop") asserts the new behaviour - A's directive is `stop`/`ownership` and the stored run keeps state BUILD with no stop; its other assertions (generation, lease holder) stay. In the same file, the test "T0-SESSION-IDENTITY-2, live to expired" asserts at its line 148 (on main at ff925160) that the stop of window B's dispatch under window A's live lease names no owner; that line asserts instead that the detail names `win-A`, the generation and the expiry (R2), and the test's other lines stay.
  - 5. A fixture that relied on a foreign dispatch to persist an ownership stop (tests/scenarios/ownership-wait.test.ts `stoppedForOwnership`, and any other found by the DoD run) writes that stop with `fx.store.saveCardRun` and `makeStop`, as tests/scenarios/two-windows.test.ts:677 does; every assertion after the fixture stays as on main.
  - 6. Every other test in the DoD passes with no line changed, and fault-points.test.ts passes (the change removes writes from `CardRunner.next` and adds none).
depends_on: []
budget: 250
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
hygiene: "Issue 378. Replaces T0-FOREIGN-DISPATCH-NO-WRITE, whose attempt 1 (candidate 7a50d53b, RED 6e563600) passed 229 of 230 DoD tests: tests/scenarios/two-windows.test.ts:148 pins the old generic stop that R2 reverses, and that card's acceptance 6 forbade changing it. Owner ruling 2026-11-19 in session add441b9 - a successor card that carries the candidate and allows line 148 and the matching src/cli/main.ts comment. Start the branch from 7a50d53b; the fragment moves to changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE-2.md and the first card file keeps the attempt evidence the branch added to it, and this card file carries it under Attempt evidence. Owner ruling 2026-11-19 in session add441b9 - change the documented behaviour rather than close the issue. RED first - commit acceptance 1 to 4 against src/ as on main (acceptance 1 and 3 fail on the write, acceptance 4 fails on the stored stop), then the fix. .claude/skills/verify-card-run-writes/SKILL.md covers `CardRunner.next` and `CardRunner.save`; run its check before SHIP and record the result. The card adds a test file; it lands in a CI shard by path and needs no workflow change."
doc_sync: changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE-2.md
---

# T0-FOREIGN-DISPATCH-NO-WRITE-2

Issue 378. A session that does not hold a live card lease can read the
card, and today its `aidlc card next` also saves an ownership STOP onto
the holder's run. The holder's next `card next` clears that stop, but if
the holder is idle until its lease expires, `aidlc next` stops the goal
on it. With this card the foreign dispatch is read-only: it returns the
stop, naming the holder, and writes nothing.

## Attempt evidence

Carried from T0-FOREIGN-DISPATCH-NO-WRITE attempt 1 (candidate 7a50d53b, RED 6e563600):

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/foreign-dispatch.test.ts` acceptance 1. RED on 6e563600: failed on the write (journal 8 lines, expected 7; run saved with `blocker: stale ownership generation`) | pass |
| 2 | same file, acceptance 2. RED on 6e563600: one `LEASE_RENEWED` with `revalidated`, expected 0 | pass |
| 3 | same file, acceptance 3, the lease taken through a `LeaseStore` subclass between the assessment and the claim. RED on 6e563600: run saved at revision 1 with the stop | pass |
| 4 | `tests/scenarios/two-windows.test.ts`, "T0-CARD-TAKEOVER, prepared". RED on 6e563600: stored state `STOP`, expected `BUILD` | pass |
| 5 | `saveOwnershipStop` fixtures: `ownership-wait.test.ts` (`stoppedForOwnership`, the acceptance 5 test of T0-CARD-LEASE-HEARTBEAT) and `two-windows.test.ts` (T0-SESSION-IDENTITY-3 unprepared, T0-CARD-TAKEOVER prepared, refusals, T1-STORE-CAS-2 `stoppedCard`); the dispatch and its assertions stay, the stop it used to save is written after it | pass |
| 6 | DoD: 229 of 230. `two-windows.test.ts:148` (T0-SESSION-IDENTITY-2) asserts the stop of a foreign live-lease dispatch names no owner, which R2 reverses; not changed, reported for a ruling. fault-points 28 of 28 | fail (1) |

Guard sweep (each loosened form, then `foreign-dispatch`, `two-windows`, `ownership-wait`):

| Guard | Loosened form | Failed |
|---|---|---|
| `lease &&` in `next` | `foreignLive(lease!, now)` | acceptance 1 to 3 and 37 others (no lease record) |
| `!lease.released` | dropped | two-windows refusals, T0-CARD-TAKEOVER-2 checkpoint |
| `expiresAt >= now` | `>` | acceptance 1 (at `expiresAt`) |
| session and host compared | session only | acceptance 1 (same session, other host) |
| stored stop kept unless `ownership` | any stored stop kept | acceptance 1 (stored ownership stop) |

Attempt 2 (this card, on 7a50d53b):

| Item | Proof | Result |
|---|---|---|
| 4 | `tests/scenarios/two-windows.test.ts` "T0-SESSION-IDENTITY-2, live to expired", line 148: the stop of B's dispatch under A's live lease names `win-A`, `generation 0` and the lease `expiresAt`; the test's other lines unchanged | pass |
| R4 | `src/cli/main.ts` `card status` comment: the stop of a dispatch under another session's live lease names the holder and is not saved; comment only. `changelog.d/T0-FOREIGN-DISPATCH-NO-WRITE-2.md` moved from the first card's fragment | done |
| 6 | DoD: exit 0, 230 of 230; fault-points 28 of 28 inside it | pass |

Attempt 3 (repair of R3 decision 1, F1 to F4; RED is each test run against the src of c81ccb51):

| Item | Proof | Result |
|---|---|---|
| 1 | `foreign-dispatch.test.ts` acceptance 1 (also same session on another host, a stored ownership stop, the instant of `expiresAt`) | pass |
| 2 | same file, acceptance 2 | pass |
| 3 | same file, acceptance 3: baseline read before `runner.next`; a fresh run at PREPARE and a BUILD run under B's expired lease taken to PREPARE, B acting before A's claim. RED on c81ccb51: journal 8 lines, expected 7 (CARD_STATE BUILD to PREPARE) | pass |
| 4 | `two-windows.test.ts` "T0-CARD-TAKEOVER, prepared" and "T0-SESSION-IDENTITY-2, live to expired" line 148 | pass |
| 5 | `saveOwnershipStop` fixtures as in attempt 1 | pass |
| 6 | DoD exit 0; fault-points inside it | pass |

Input forms and failure paths the repair handles, each with its covering test (`foreign-dispatch.test.ts`):
- A lease another session takes after the dispatch's lease read (one read now decides the dispatch; `assess` takes it from `next`): "R3 F2 - a lease another session takes right after the dispatch reads it writes nothing", a fresh run and a BUILD run whose own lease was released. RED on c81ccb51: run saved STOP `stale ownership generation`, journal 6 lines, expected 5.
- A lease another session takes or renews between the assessment and PREPARE's claim (the claim now precedes every assessment write, chosen by a selection that writes nothing): acceptance 3. RED as above.
- A foreign live lease with the plan checkpoint missing (the lease check now precedes the checkpoint guard): "R3 F4 - with the plan checkpoint missing, a foreign live lease still returns the stop naming the holder". RED on c81ccb51: `wait`, expected `stop`.
- The claim ahead only for PREPARE: "the claim ahead of the assessment is taken only for PREPARE: a stopped run claims no lease".
- The selection writes nothing: "the selection ahead of the claim saves nothing: a merged card stopped for ownership with no lease is reconciled to CLOSE once, journaled".
- PREPARE uses that claim: "PREPARE uses the claim taken ahead of the assessment: a fresh dispatch journals one LEASE_ACQUIRED and no LEASE_RENEWED".
- The holder's own lease skips the selection ahead, so its path is as on main: `t0-flow.test.ts` "T1-REVIEW-FINDINGS-4 R3 decision 1" (fails when the selection also runs for the holder) and the released-lease case of "R3 F2" (fails when a released own lease counts as held).
- The plan checkpoint still holds for a dispatch that may continue, with no claim: `two-windows.test.ts` "T0-CARD-TAKEOVER-2, checkpoint".

Guard sweep of attempt 3 (each loosened form, then `foreign-dispatch`, `two-windows`, `ownership-wait`, `t0-flow`): holder condition dropped, T1-REVIEW-FINDINGS-4 and T1-STORE-CAS-2 duplicate check fail; `!lease.released` in it dropped, R3 F2 fails; claim for any selection, the stopped-run test fails; checkpoint test dropped, T0-CARD-TAKEOVER-2 checkpoint fails; held early return dropped, acceptance 3 and R3 F2 fail; dry save kept, the merged-reconcile test fails; dry append kept, acceptance 3 and R3 F2 fail; `assess` reading the lease again, R3 F2 and the refusals test fail; the claim not handed to PREPARE, the LEASE_ACQUIRED test fails; the lease check after the checkpoint guard, R3 F4 fails. A dry-mode guard on the renewal was removed: the selection runs only on a lease this session does not hold, which the renewal requires, so no input reached it.

Attempt 4 (repair of R3 decision 2, the re-raised F2 and F3 classes; RED is each test run against the src of 0618473a):

Design: every run save and journal append of a `card next` dispatch goes through one writer that, until the dispatch holds a live lease of its own (its renewal or its claim succeeded), makes the write under the card lease's lock after reading the lease there; a live lease of another session or host refuses it with `ForeignLeaseError`, which `next` answers with the holder's stop. A held renewal of this session's lease raises the same error before any write. The holder's path after its renewal takes no extra lease section, as on main.

| Item | Proof | Result |
|---|---|---|
| 1 | `foreign-dispatch.test.ts` acceptance 1 | pass |
| 2 | same file, acceptance 2 | pass |
| 3 | same file, acceptance 3 (both cases) | pass |
| 4 | `two-windows.test.ts` "T0-CARD-TAKEOVER, prepared" and "T0-SESSION-IDENTITY-2, live to expired" | pass |
| 5 | `saveOwnershipStop` fixtures | pass |
| 6 | DoD exit 0, 239 of 239; fault-points inside it; `npm test` 3878 tests, 3846 pass, 0 fail, 32 skipped | pass |

Write points the writer admits, with the covering test (`foreign-dispatch.test.ts`; "loop" is "R3 decision 2 - a lease another session takes right before any lease section of the dispatch stops it there with nothing more written", which injects B's lease before each of A's lease sections in turn and pins the number of sections per dispatch):
- `assess`: CARD_STATE of the selected state (loop: WAIT, PREPARE, DONE scenarios); CARD_STATE and save of a merged card's ownership-stop reconciliation (loop: merged scenario); the `ownership-stop-reconciled` NOTE, the kept-receipt save and its ATTEMPT_FINISHED (same `save`/`append` parameters; their dispatches claim ahead or select after them, no dedicated scenario); a held renewal (raised before any write): "R3 decision 2 F3 - B takes over this session's expired lease before its renewal: a BUILD run needing PREPARE writes nothing" and "... a run at SHIP writes nothing".
- `next`: the WAIT save (loop, WAIT; "R3 decision 2 F2 - B renews its expired lease right after the dispatch reads it, while an operation runs: the WAIT path writes nothing"), the DONE save (loop, DONE), the STOP save (loop, stored risk stop), the REVIEW_FIX saves (same writer; reached only by a holder after its renewal or a held-renewal stop).
- `prepare`: the claim taken ahead (loop, PREPARE section 1), the expired-lease STOP save (loop, PREPARE), the worktree-stop save, LEASE_ACQUIRED/LEASE_RENEWED and the PREPARE/BUILD save (after its own claim: owned).
- `build`: its two saves (same writer; reached after a renewal, a held-renewal stop, or gated when no renewal applies).
- `close` (from `card next`): the held-claim and takeover-refusal STOP saves (loop, merged scenario sections 3 and 4) and the CLOSE/DONE save (loop, merged section 5, after A's own takeover, where B cannot take the lease).

RED on 0618473a: the loop fails at the merged scenario, section 1 (the CLOSE claim): run saved `STOP` where it was `CLOSE`; "R3 decision 2 F2" journal 8 lines, expected 7; "R3 decision 2 F3 ... PREPARE" journal 7 lines, expected 6; "R3 decision 2 F3 ... SHIP" run saved `STOP` (fenced: stale generation).

Guard sweep of attempt 4 (each loosened form, then `foreign-dispatch`, `two-windows`, `ownership-wait`, `t0-flow`): the refusal in the writer dropped, the loop and R3 decision 2 F2 fail; the owned short-cut dropped (a lease section for every holder write), T1-STORE-CAS-2 acceptance 4 fails; owned from the start, the loop and F2 fail; the held-renewal error dropped, "F3 ... a run at SHIP" fails; ownership after an expired claim ahead, or after any claim in `prepare`, the loop fails; any error caught as a foreign lease, T1-STORE-CAS-2 acceptance 4 fails; the refusal told by `instanceof` instead of identity, `ship-throw.test.ts` "T0-SHIP-THROW-SLOT-2 acceptance 5" fails (a thrown revoked proxy makes `instanceof` throw); the WAIT save, the assessment's save, prepare's expired-lease STOP save or close's state save made without the writer, the loop fails. `read &&` on the held-renewal error keeps `takeover`'s assessment as on main (forbid list); a held renewal inside a takeover needs its own new lease to expire within the call, which no test reaches. close's held-claim branch is main's code with its save through the writer: an early return there was tried and its loosened form was still caught by the writer, so it was removed.
