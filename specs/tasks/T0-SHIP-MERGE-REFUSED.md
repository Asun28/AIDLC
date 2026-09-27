---
id: T0-SHIP-MERGE-REFUSED
title: A merge GitHub refuses because the base moved after the ship's base sync goes through the base sync again, a CHANGELOG merge or a merge-conflict repair on a new candidate, instead of an unclassified tool stop
status: merged
branch: T0-SHIP-MERGE-REFUSED
worktree: D:\wt\AIDLC\T0-SHIP-MERGE-REFUSED
allow_paths:
  - src/delivery/github-ship.ts
  - src/probes/gh.ts
  - tests/infra/github-ship-merge-refused.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-MERGE-REFUSED.md
dod_command: npm run typecheck && node --test tests/infra/github-ship-merge-refused.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `gh pr merge` refuses on the GitHub ship path, the path shall read the PR's merge state with `gh pr view <n> --json mergeable,mergeStateStatus`, taking only those two fields and only the values GitHub defines, and WHEN `mergeable` is `CONFLICTING` or `mergeStateStatus` is `DIRTY`, run the base sync again on a fresh fetch of the base.
  - R2. WHILE `mergeable` is `UNKNOWN` (and `mergeStateStatus` is not `DIRTY`), the path shall read it again up to five reads, three seconds apart through the injected sleep and never a clock; an `UNKNOWN` still unsettled at the fifth read shall run the base sync as the local test of what GitHub has not decided, never be taken as `CONFLICTING` or `MERGEABLE`. A `MERGEABLE` refusal (a failed check, a missing review, a protection rule, `BLOCKED`, `BEHIND`, `UNSTABLE`, `CLEAN`) shall start no base sync and keep `[SHIP-MERGE-FAIL]`, naming the state.
  - R3. A base sync run after a refusal shall end the ship as a sync before the push ends it: `[SHIP-BASE-SYNC-MERGED]` for a CHANGELOG-only Unreleased conflict, `[SHIP-BASE-SYNC-CONFLICT]` with git's diagnostic for any other conflict (each a new candidate the card runner builds and reviews from scratch), `[SHIP-BASE-SYNC-FAIL]` for a fetch or merge-tree failure, and `[SHIP-MERGE-FAIL]` naming the state when the base merges cleanly; the same ship shall never push, open a PR or retry the merge after the refusal.
  - R4. A merge state that cannot be read (gh fails, malformed JSON, a value GitHub does not define) shall start no base sync and keep `[SHIP-MERGE-FAIL]` naming it unreadable; every text from gh reaches the ship output encoded once.
  - R5. `docs/OPERATIONS.md` (after the base sync paragraph) and `CHANGELOG.md` shall state R1 to R4.
acceptance:
  - 1. `tests/infra/github-ship-merge-refused.test.ts`: `GhProbe.prMergeState` returns the two fields for values GitHub defines, drops any other value and throws on a gh failure or malformed JSON. [R1] [R4] [dod arm 1]
  - 2. The same file: after a refusal, `CONFLICTING` (with `DIRTY` or alone) and `DIRTY` with `UNKNOWN` fetch the base again and end with `[SHIP-BASE-SYNC-CONFLICT]` carrying git's diagnostic (`hasConflictDiagnostic` true), and a CHANGELOG-only conflict ends with `[SHIP-BASE-SYNC-MERGED]` with both entries kept, the card's first. [R1] [R3] [dod arm 1]
  - 3. The same file: `UNKNOWN` twice then `CONFLICTING` reads three times with two 3 s sleeps; `UNKNOWN` five times reads five times with four sleeps and runs the sync, ending with `[SHIP-MERGE-FAIL]` naming "UNKNOWN ... after 5 reads" when the base merges cleanly and with `[SHIP-BASE-SYNC-CONFLICT]` when it conflicts. [R2] [R3] [dod arm 1]
  - 4. The same file: `MERGEABLE` with `BLOCKED`, `BEHIND`, `UNSTABLE` or `CLEAN`, and an unreadable state (gh failure, malformed JSON, an undefined value), fetch nothing after the refusal and end with `[SHIP-MERGE-FAIL]` naming the state and carrying no conflict diagnostic; a fetch or merge-tree failure in the second sync ends with `[SHIP-BASE-SYNC-FAIL]`; untrusted gh text is encoded. [R2] [R3] [R4] [dod arm 1]
  - 5. Every ship of items 2 to 4 tries `gh pr merge` once and neither pushes, opens a PR nor merges after the refusal. [R3] [dod arm 1]
  - 6. The same file reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section and fails with any one removed. [R5] [dod arm 1]
depends_on: []
budget: 320
tdd: true
sweep: "grep -n 'SHIP-MERGE-FAIL\\|hasConflictDiagnostic\\|prView\\|baseSync(' src/delivery/github-ship.ts src/loop/card-runner.ts src/probes/gh.ts: github-ship.ts:333 wrote `[SHIP-MERGE-FAIL] <encoded gh stderr>` on one line when `gh pr merge` refused, and card-runner.ts:2602 hasConflictDiagnostic matches GitHub's refusal only at the start of a line, so the refusal was never a conflict and the run stopped as STOP/tool (issue #85: PR #84 of T0-GOAL-CARD-COUNT-2, CONFLICTING after PR #83 merged). baseSync (github-ship.ts:373) already turns a conflict into [SHIP-BASE-SYNC-CONFLICT] with git's lines or [SHIP-BASE-SYNC-MERGED], which the runner builds as a merge-conflict repair; gh.ts prView (:110) reads no merge state. card-runner.ts is not changed. In-flight T0-CI-RED-LOGS-BOUNDS edits github-ship.ts only in failedStepLines (:83-:125) and gh.ts only at :51, disjoint from this card's hunks."
forbid: [editing src/loop/card-runner.ts (owned by T1-STORE-CAS), a merge retried or a push in the ship that saw the refusal, a clock read (Date.now) for the re-read wait, UNKNOWN taken as CONFLICTING or MERGEABLE]
non_goals: ["issue #85 item 2: a STOP/tool stop whose printed resume (aidlc card next) returns the same stop, which needs card-runner.ts (owned by T1-STORE-CAS)", "a resumable wait for an UNKNOWN that stays unsettled and a base that merges cleanly (it keeps [SHIP-MERGE-FAIL]); it needs a new ship outcome in card-runner.ts", "BEHIND on a repository that requires branches up to date before merging: GitHub then refuses a MERGEABLE, BEHIND PR, which this card keeps as [SHIP-MERGE-FAIL] with no base sync; this repository has no branch protection, so GitHub merges a BEHIND PR here", "a merge refusal for a failed check, a missing review or a protection rule (kept as [SHIP-MERGE-FAIL], now naming the state)"]
hygiene: "Filed from issue #85 item 1. Design ruled by the coordinating session: read the two fields only; re-read UNKNOWN a bounded number of times with a fixed wait through the injected sleep; DIRTY counts as CONFLICTING; UNKNOWN at the bound runs the base sync as local ground truth (merge-tree against the fetched base is the textual test GitHub's CONFLICTING reports, and the sync is read-only until it finds a conflict); a refusal that is not a conflict starts no base sync. Written in a local worktree while main was held for T1-STORE-CAS; registered on main after the all-clear (T1-STORE-CAS stopped without merging). Mutation sweep before the first review (docs/LESSONS.md 2026-09-24); the RED run has a seam method that reads nothing (docs/LESSONS.md 2026-09-26 T1-PARSE-GUARD). Budget 320: the candidate changes 299 lines, 235 of them the new test file that pins every state the refusal can meet."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-SHIP-MERGE-REFUSED

## Deliverable
When another session's merge moves the base between a card's base sync and its merge, GitHub refuses the merge and the card no longer stops with an unclassified tool stop and a dead resume. The ship path asks GitHub why, runs the base sync again when the answer is a conflict (or GitHub has not decided), and hands the card the same CHANGELOG merge or merge-conflict repair a sync before the push would have.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship-merge-refused.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
