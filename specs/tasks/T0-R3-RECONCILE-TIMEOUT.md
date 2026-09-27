---
id: T0-R3-RECONCILE-TIMEOUT
title: A pending R3 decision is reconciled against the timeout recorded on its reservation, never the live configuration looked up by reviewer name (issue #96)
status: todo
branch: T0-R3-RECONCILE-TIMEOUT
worktree: D:\wt\AIDLC\T0-R3-RECONCILE-TIMEOUT
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - tests/scenarios/r3-fallback.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-R3-RECONCILE-TIMEOUT.md
dod_command: npm run typecheck && node --test tests/scenarios/r3-fallback.test.ts
dod_exit: 0
requirements:
  - R1. The formal reservation (`ReviewInvocation`, `src/core/types.ts`) shall record `timeoutMs`, the timeout of the reviewer the decision is dispatched to (the primary's, the fallback's or the base-sync reviewer's), in the card run and in the retained `.reservation.json`, and the decided invocation keeps it.
  - R2. The reconciliation of a pending formal invocation with no result envelope (`retainedFormalResult`) shall treat it as in flight while its age is at most the recorded `timeoutMs` plus the reconciliation grace, and charge it as an unrecoverable no-verdict once its age is past that, whatever the live configuration says: renaming or removing `formalReview.fallback` or `formalReview.baseSync`, or changing any `timeoutMs`, while the decision runs never shortens or lengthens it. An invocation with no recorded `timeoutMs` (written before this card) is reconciled against the live timeout of the reviewer it names, as before.
  - R3. `docs/OPERATIONS.md` (the reconciliation sentence of the formal review section) and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/scenarios/r3-fallback.test.ts`: a primary dispatch and a fallback dispatch each record their own `timeoutMs` on the pending reservation, read inside the reviewer call, and on the retained `.reservation.json`; the decided invocation keeps it. [R1] [dod arm 1]
  - 2. The same file: a pending invocation of the fallback and one of the base-sync reviewer, each with a recorded 600 s timeout and no envelope, stay in flight (`review r3` refuses with the in-flight message, no reviewer runs) at an age of exactly 600 s plus the grace, and are charged as a no-verdict without running a reviewer at 1 ms past it, under a configuration where the reviewer is renamed, where it is removed, and where every `timeoutMs` is 1 s. [R2] [dod arm 1]
  - 3. The same file: a pending primary invocation with no recorded `timeoutMs` is in flight at an age of exactly the live 1 s plus the grace and charged 1 ms past it, as before this card. [R2] [dod arm 1]
  - 4. The same file reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section, and fails with any one removed. [R3] [dod arm 1]
depends_on: []
budget: 300
tdd: true
diagnosis:
  root_cause: "card-runner.ts:1741 (`retainedFormalResult`) reconciles a pending formal invocation against `this.formalReviewerFor(pending.reviewer).timeoutMs`, the live configuration looked up by the name the invocation records: renaming or removing the fallback or the base-sync reviewer, or changing a timeout, while a decision runs reconciles it against another timeout (the primary's when the name no longer resolves), so a running decision can be charged early and its result discarded when it returns."
  same_class: "In-flight R3 state read from the live configuration: only the reconcile timeout (fixed). The pool request of a recovered or charged result is settled under the key of the reservation's own base, policy version and reviewer (`reviewRequestKey`), and a queue request is completed, released or cancelled by that key, the request carrying its own pool, so the live pool rule (`formalPool`) never decides an in-flight request; the in-flight refusal (`inFlight`) and the allowance count read the record only; the effort, the policy hash, the base-sync flag and the reviewer name are recorded at reservation; the failed-dispatch release reads the retained files; the operation ledger records its own `timeoutMs` on each intent. A hold is matched to a reviewer by the name the invocation records (the R3 fallback design, docs/OPERATIONS.md): a renamed reviewer is a new one, whose first dispatch on a held account records another hold at no cost. The R2 side was fixed by T0-R2-FALLBACK-3."
sweep: "grep -n 'formalReviewerFor(\\|formalPool(\\|timeoutMs' src/loop/card-runner.ts; grep -rn 'timeoutMs' src --include=*.ts: formalReviewerFor is called only at card-runner.ts:1741; formalPool only at the admission of a new dispatch (:1495); the formal reservation is built at :1530. T1-STORE-CAS-2 (aidlc-a6) edits card-runner.ts only at lines 21, 155, 650-705 and 916-930; this card's hunks are 1530 and 1741 of the base."
forbid: [editing card-runner.ts lines 1-30, 150-160, 640-750 or 880-935 of the base, editing src/core/review-policy.ts, src/delivery/github-ship.ts or the store, lease and journal modules, a change to the R3 reviewer selection, the R2 code or the pool rule, a reconcile timeout read from the live configuration when the invocation records one]
non_goals: ["a hold matched by the recorded name after a rename: the R3 fallback design keeps it (a renamed reviewer is a new reviewer)", "the age of a reservation whose log exists, which is measured from the log's modification time on the host clock, as before"]
hygiene: "Filed from issue #96, the R3 twin of T0-R2-FALLBACK-3 (LESSONS 2026-09-27). The exact card-runner.ts hunks are listed here before the attempt is recorded. Mutation sweep before the first review (docs/LESSONS.md 2026-09-24); every property of an acceptance item asserted on every case it names, at both edges (docs/LESSONS.md 2026-09-26 T0-SHIP-MERGE-REFUSED); an R2 advisory that names a defect is fixed before the attempt is recorded (coordinating session)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-R3-RECONCILE-TIMEOUT

## Deliverable
A formal (R3) decision that is still running keeps the timeout it was dispatched with: a configuration change while it runs never charges it early or lets it run longer.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/r3-fallback.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
