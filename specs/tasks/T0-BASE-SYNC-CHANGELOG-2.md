---
id: T0-BASE-SYNC-CHANGELOG-2
title: A base-sync conflict whose only hunks are entries both sides added to the CHANGELOG Unreleased section is merged by keeping both, and the merge is always a new candidate that is verified and reviewed from scratch, never shipped on the reviews of the candidate it replaces (replacement of T0-BASE-SYNC-CHANGELOG, whose first candidate was recorded with a wrong full-check claim)
status: todo
branch: T0-BASE-SYNC-CHANGELOG-2
worktree: D:\wt\AIDLC\T0-BASE-SYNC-CHANGELOG-2
allow_paths:
  - src/delivery/github-ship.ts
  - src/delivery/ship.ts
  - src/loop/card-runner.ts
  - tests/infra/github-ship.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-BASE-SYNC-CHANGELOG-2.md
dod_command: npm run typecheck && node --test tests/infra/github-ship.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the base sync of the GitHub ship path meets a merge conflict whose only conflicted path is `CHANGELOG.md`, and every conflict hunk lies in the `## Unreleased` section and is a pure insertion on both sides (with `merge.conflictStyle=diff3` the base part of every hunk is empty, so neither side removed or changed a line the other side kept), the ship path shall resolve each hunk by keeping both sides whole (the card's lines first, then the base's, since the card merges later and the section is newest first) and commit the merge with a message naming both sides and the rule.
  - R2. WHEN any other conflict remains (another path, a hunk outside `## Unreleased`, or a hunk whose base part is not empty), the ship path shall leave the whole merge for the merge-conflicts skill, as it does today, and resolve no hunk mechanically.
  - R3. The merge commit of R1 shall be a new candidate: the ship shall not push or merge it, and shall return `[SHIP-BASE-SYNC-MERGED]`, which the card runner handles like `[SHIP-BASE-SYNC-CONFLICT]` (BUILD with the merge-conflict repair, the DoD receipt and the retained receipt cleared), so the DoD, R2 and R3 run on the merge result and no receipt, pass or decision of the replaced candidate carries over to it.
acceptance:
  - 1. A base sync where the card and the base each add one entry at the top of `## Unreleased` commits a merge whose CHANGELOG carries the card's entry, then the base's, each byte-identical to its side, and returns `[SHIP-BASE-SYNC-MERGED]` naming the merge commit; no push, PR or merge command runs (tests/infra/github-ship.test.ts). [R1] [R3] [dod arm 1]
  - 2. Each of these leaves the merge for the skill with `[SHIP-BASE-SYNC-CONFLICT]` and resolves nothing: a conflict in another path besides `CHANGELOG.md`, a CHANGELOG hunk outside `## Unreleased`, a CHANGELOG hunk where one side edits or removes a line of the base (non-empty base part), and a CHANGELOG hunk where the card rewrites an existing entry (tests/infra/github-ship.test.ts). [R2] [dod arm 1]
  - 3. After `[SHIP-BASE-SYNC-MERGED]` the card run is in BUILD with the merge-conflict repair and no DoD or retained receipt; recording the merge commit as the next attempt leads to a `pre-review` directive for that candidate, and `review r3` on it is a new decision, so with both R3 decisions already used the SHIP gate stops for review instead of shipping (tests/scenarios/t0-flow.test.ts). [R3] [dod arm 1]
  - 4. `docs/OPERATIONS.md` (the base sync paragraph) states the rule, the cases it leaves to the skill and that the merge is a new candidate reviewed from scratch; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [R3] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "grep -n 'baseSync\\|SHIP-BASE-SYNC\\|merge-conflict' src/: github-ship.ts:238-276 baseSync tests the merge with merge-tree (clean: logs and ships the reviewed head, :257-260), otherwise runs git merge --no-commit and returns [SHIP-BASE-SYNC-CONFLICT] with the merge left in the worktree (:275); ship.ts:68 classifies that sentinel as merge-failed (SENTINEL_MAP, where the new sentinel is classified too); card-runner.ts:2360-2372 turns a merge-failed outcome with a conflict diagnostic into BUILD with pendingRepair merge-conflict and the receipts cleared; card-runner.ts:1199-1203 stops a third R3 decision (MAX_SUBSTANTIVE_REVIEW_DECISIONS = 2, types.ts:1002). Tests: tests/infra/github-ship.test.ts:350-352 (conflict in CHANGELOG.md), t0-flow.test.ts (merge-conflict repair)."
forbid: [shipping or merging a candidate whose base sync conflicted without a new DoD, R2 and R3 on the merge result, carrying a receipt, pass or decision of the replaced candidate to the merge, resolving a hunk that removes or changes a line, resolving any path other than CHANGELOG.md, reordering or rewording either side's entries]
non_goals: [the scaffold ship path, a clean base sync (it ships the reviewed head; CI on the PR runs on the merge ref), the two-decision R3 allowance, other files with append-only sections]
diagnosis:
  root_cause: "A base-sync conflict of two entries both added at the top of CHANGELOG Unreleased stops the ship like any conflict, and the agent resolves by hand a hunk whose resolution is fixed by the text alone. Evidence: T0-AUDIT-READMIT (PR #55) conflicted this way twice (PR #50, PR #53), and T0-QUOTA-FALSE-HOLD-2 (PR #44) once; the second conflict on PR #55 came after both R3 decisions and was merged under a human ruling that the earlier reviews carried the merge. That ruling is what this card must not repeat: a conflict means the base changed under the card, so the merge result is judged anew."
  same_class: "The same union applies to any append-only list, but only CHANGELOG.md is named here; every other path stays with the skill."
hygiene: "Found while shipping T0-AUDIT-READMIT (PR #55). Run the mutation sweep over the hunk classifier (empty base part, section bounds, path set) before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (base sync paragraph), CHANGELOG.md
---

# T0-BASE-SYNC-CHANGELOG-2

## Deliverable
When the only conflict of a base sync is two sets of new entries at the top of the CHANGELOG `## Unreleased` section, the ship path keeps both, commits the merge and stops the ship there: the merge is a new candidate, and it goes through the DoD, R2 and R3 like any other. Any other conflict stays with the merge-conflicts skill, and nothing reviewed on the old candidate is carried to the merge.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Ruling
Replacement of T0-BASE-SYNC-CHANGELOG: its attempt 1 recorded candidate 7c2210b with a receipt saying `npm run check` passed, but one test failed (tests/surface/templates.test.ts:88: the CHANGELOG entry quoted a heading marker, which cut the Unreleased slice short). The DoD itself was green. A succeeded episode takes no new attempt, and reviewing a candidate known to fail would spend an R3 decision on it, so the fixed commits (e341b99) go through a fresh ledger here.
