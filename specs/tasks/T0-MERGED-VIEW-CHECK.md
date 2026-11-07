---
id: T0-MERGED-VIEW-CHECK
title: A `merged` ship reads its PR view under the rule a `merge-unconfirmed` ship already follows, for its verification, its PR record and its merge facts
status: todo
branch: T0-MERGED-VIEW-CHECK
worktree: D:\wt\AIDLC\T0-MERGED-VIEW-CHECK
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/merge-unconfirmed.test.ts
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-MERGED-VIEW-CHECK.md
dod_command: npm run typecheck && node --test tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/journal-owed.test.ts
dod_exit: 0
requirements:
  - R1. When a `merged` ship is verified through its PR view, the card runner shall count the view only when its number equals the requested PR, its state is OPEN, MERGED or CLOSED, and `headRefOid` is a non-empty string, and shall treat any other answer as gh not answering, so the run waits on `merge-verify` with the operation UNKNOWN.
  - R2. The card runner shall take merge facts of a `merged` ship only from a view that R1 counts, in state MERGED, at the candidate sha, and otherwise the merge result shall carry no facts.
  - R3. The card runner shall record the PR of a `merged` ship as MERGED only when the merge is verified.
  - R4. The dry-run verification and a merge token at the candidate shall verify a `merged` ship as they do on main.
  - R5. `docs/ARCHITECTURE.md` shall state R1 and R2 for a merged ship, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/merge-unconfirmed.test.ts`: a `[SAGA-DONE]` ship with no token and each of these gh answers waits on `merge-verify` with the operation UNKNOWN, `mergeVerified` false and no PR recorded as MERGED - `{}`; MERGED without `headRefOid`; another PR number MERGED at the candidate; no number; an unknown state. [R1] [R3] [dod arm 2]
  - 2. `tests/scenarios/merge-unconfirmed.test.ts`: a `[SAGA-DONE]` ship that gh reads MERGED at the candidate closes the card and its `OPERATION_RESULT` carries `headSha`, `mergeSha` and `pr` with the literal values. [R1] [R2] [dod arm 2]
  - 3. `tests/scenarios/merge-unconfirmed.test.ts`: a `[SAGA-DONE]` ship with a token at the candidate closes the card with no facts when gh reads the PR MERGED at another head, when gh names another PR, and when gh reads it OPEN with a merge commit. [R2] [R4] [dod arm 2]
  - 4. `tests/scenarios/merge-unconfirmed.test.ts`: a `[SAGA-DONE]` ship on a run with no candidate sha that gh reads MERGED at a named head closes the card, as on main, with no facts; the same answer without `headRefOid` waits. [R1] [R2] [dod arm 2]
  - 5. The test at `tests/scenarios/merge-unconfirmed.test.ts:294`, which pins the dry-run close, passes with no change to its dry-run rows. [R4] [dod arm 2]
  - 6. `docs/ARCHITECTURE.md` and the CHANGELOG hold the text R5 asks for. [R5] Reviewer-verified.
depends_on: []
budget: 150
tdd: true
sweep: "`prView` callers on bbbdb10: `src/loop/card-runner.ts:2635` is the only one that decides a merge. `src/delivery/github-ship.ts:381` reads the view it just merged only to refuse a state other than MERGED, and the card machine verifies the result after it, so it is out of scope. `src/loop` and `src/audit` read no field of `run.pr`, so R3 changes a record no gate reads."
diagnosis:
  root_cause: "T0-EXIT-ZERO-NOT-MERGED left `view`, the raw `GhProbe.prView` cast, in the `merged` arm of `applyShipResult` by its forbid clause: line 2654 verifies on `view.state` and line 2647 takes the facts from `view`, while the `answered` check beside them applies to `merge-unconfirmed` only."
  same_class: "The `merge-unconfirmed` arm already uses `answered`. `GhProbe.prFacts` returns raw JSON that the audit reads through its own schema. Line 2674 records the PR as MERGED on a `merged` ship even when the merge is not verified."
forbid:
  - changing `GhProbe.prView` or `src/delivery/github-ship.ts`
  - changing what a `merge-unconfirmed` ship does
  - changing the dry-run or merge token verification
  - weakening or skipping a test to go green
non_goals:
  - stopping a `merged` ship whose view is definite and not merged at the candidate: it waits as on main
hygiene: "Issue 131 and its comment. Rule against main: a `merged` ship main verified through a gh answer stays verified only when that answer is the requested PR, a known state and a named head; every other such answer now waits with the operation UNKNOWN. Nothing main left UNKNOWN now closes. Dry-run and token verification are unchanged. Facts come only from a counted view MERGED at the candidate, so a token-verified merge whose view differs now carries no facts and audit verify names FACT_MISSING, as it does for `merge-unconfirmed`. Line numbers checked on main at bbbdb10."
---

# T0-MERGED-VIEW-CHECK

## Deliverable
A `merged` ship counts a PR view only when it is the requested PR, in a known state, at a named head. Closes issue 131.

## Acceptance
```powershell
npm run typecheck && node --test tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/journal-owed.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
