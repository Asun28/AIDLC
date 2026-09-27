---
id: T1-AUDIT-FACTS-2
title: The merge result of a shipped card journals its head SHA, merge SHA, tree hash and PR number when git and gh can read them, and aidlc audit verify re-derives each fact and names every shipped card without facts (successor of T1-AUDIT-FACTS)
status: todo
branch: T1-AUDIT-FACTS-2
worktree: D:\wt\AIDLC\T1-AUDIT-FACTS-2
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/probes/git.ts
  - src/probes/gh.ts
  - src/audit/verifier.ts
  - src/cli/main.ts
  - tests/surface/verifier.test.ts
  - tests/scenarios/audit.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/infra/gh.test.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/git.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T1-AUDIT-FACTS-2.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. WHEN the card runner verifies a card's merge and the git and gh probes can read the facts, it shall journal the merge `OPERATION_RESULT` with a `ShippedFacts` payload (`headSha`, `mergeSha`, the tree of `mergeSha`, `pr`); a merge whose facts cannot be read journals its result without them and is named by `aidlc audit verify`.
  - R2. `aidlc audit verify` shall re-derive each recorded fact from git and gh and report a mismatch as a block finding naming the card, the fact, the recorded value and the re-derived value.
  - R3. A fact that cannot be re-derived shall be reported as unverified and never count as verified.
  - R4. WHEN `--claim-full` is given, the verifier shall refuse unless every shipped card has at least one re-derived fact, naming each card that has none.
  - R5. No verifier check shall read a narration or free-text field.
  - R6. `aidlc audit verify` shall report a warning naming each shipped card whose merge result carries no facts, and WHEN `--claim-full` is given it shall refuse the claim naming each such card.
acceptance:
  - 1. A merged card on the github ship path whose facts git and gh can read journals one `OPERATION_RESULT` for the merge whose data parses as `ShippedFacts`, with `headSha` equal to the PR head, `mergeSha` equal to the PR merge commit, `tree` equal to `git rev-parse <mergeSha>^{tree}` and `pr` equal to the PR number, all from scripted git and gh probes; ship output text carrying a different SHA does not change them; when gh fails, names no merge commit, the fetch of the base fails or the tree cannot be read, the one `OPERATION_RESULT` carries no facts, the card enters CLOSE as before, and no second result, wait or pending record exists (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 2. `verifyAudit` with scripted probes re-derives a matching journal with no finding, and reports a block finding naming card, fact and both values when any one of `git cat-file -t <mergeSha>`, the tree, `git merge-base --is-ancestor <mergeSha> <base>` or `gh pr view <pr> --json state,mergeCommit,headRefOid` disagrees (tests/surface/verifier.test.ts). [R2] [dod arm 1]
  - 3. With gh unavailable or the merge commit absent from the repository, each affected fact is a warning `FACT_UNVERIFIED` and never counts as re-derived; the facts the other source still answers count, and a card whose facts all go unverified (the commit absent and gh failing, or no probes) counts as having no re-derived fact (tests/surface/verifier.test.ts). [R3] [dod arm 1]
  - 4. `aidlc audit verify --claim-full` reports `BLOCKED` naming each shipped card with no re-derived fact, including every card of a journal written before this change, and `verified` only when every shipped card has one and the existing conditions hold (tests/scenarios/audit.test.ts). [R4] [dod arm 1]
  - 5. Changing every narration and free-text field of a journal changes no finding and no level (tests/surface/verifier.test.ts). [R5] [dod arm 1]
  - 6. A journal with no shipped card reports the same level and findings as before this change (tests/surface/verifier.test.ts). [R2] [dod arm 1]
  - 7. `git diff --numstat origin/main...HEAD -- src` is at most +140 net; the close-out states it as the first entry of the W2+W4+W5 total against +400. [R1]
  - 8. `docs/OPERATIONS.md` (Audit) and `docs/ARCHITECTURE.md` (Evidence and audit chain) state what is re-derived and what `--claim-full` requires; `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads each exact sentence (tests/surface/verifier.test.ts). [R2] [R4] [dod arm 1]
  - 9. Issue filed for plan finding F4 (seven journal event types declared and never written), named in the close-out (issue 101, filed by T1-AUDIT-FACTS). [R5]
  - 10. For a goal with one shipped card whose merge carries facts and one whose merge carries none, plain `aidlc audit verify` reports a warning `FACT_MISSING` naming the second card only and never a pass without comment, and `--claim-full` reports `BLOCKED` naming the second card only; a goal whose shipped cards all carry re-derived facts has no such warning (tests/surface/verifier.test.ts, tests/scenarios/audit.test.ts). [R6] [dod arm 1]
depends_on: [T1-STORE-CAS-2]
budget: 700
tdd: true
sweep: "Survey of main at 5983a1e. No journal event carries a commit SHA, tree hash, check-run id or exec receipt; MANIFEST_SEALED.finalSha is operator input (main.ts:968). The SHA lives only in CardRun.candidate.sha (card-runner.ts:870-876), pr.headRefOid (2238) and the merge token (github-ship.ts:268); the merge OPERATION_RESULT (card-runner.ts:2240) has neither PR nor merge commit though PrInfo.mergeCommit is fetched (gh.ts:87). verifyAudit (verifier.ts:51-144) is offline: chain, ledger, invocation ids, work after terminal, seal, artifact digests, stale candidate. audit verify main.ts:938-954; --claim-full sets hostCaptureBoundary from --capture-boundary."
forbid: [a fact read from ship output text, a network call from a test, a change to the hash-chain format, counting an unverifiable fact as verified]
non_goals: [waiting or retrying to read the facts of a verified merge (removed by the ruling), a pending-merge record, journaling DoD exec receipts (the agent runs the DoD; a runner-owned DoD is a separate change), check-run ids, deleting the unused event types (issue for F4), rewriting journals written before this change]
hygiene: "Successor of T1-AUDIT-FACTS, stopped STOP/review at candidate cd72851 by R3 decision 2: its wait-and-retry path for unreadable merge facts settled the ledger before journaling the result, let two overlapping card next calls append two results, and could settle an unrelated running operation. Ruling of 2026-09-27 by the monitoring session aidlc-37 under the user's delegation (option 1): remove the wait-and-retry machinery completely; facts ride in the merge's one OPERATION_RESULT when they can be read, else it carries none and the gap is named by audit verify (warning) and --claim-full (refusal); R1 and acceptance 1 amended, R6 and acceptance 10 added. Carry the verifier and probe work R3 did not fault (the answered-fact count for the claim, the fetch receipt check). The branch starts from cd72851 and merges main. src/loop/card-runner.ts hunks stay at the imports and the ship result's merge verification (about lines 2300-2340), never in 650-760 where another session edits the takeover. Lesson 2026-09-26 T0-AUDIT-READMIT: recognise the merge result event by every field its one writer sets. Run the mutation sweep over every new branch before the first review."
doc_sync: docs/OPERATIONS.md (Audit), docs/ARCHITECTURE.md (Evidence and audit chain), CHANGELOG.md
---

# T1-AUDIT-FACTS-2

## Deliverable
Each shipped card's merge result in the journal carries facts a third party can check against git and GitHub, and `aidlc audit verify` checks them; the hash chain still proves the records were not altered, and the facts now prove they describe what happened. `--claim-full` names every shipped card without a re-derived fact.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.
