---
id: T1-AUDIT-FACTS
title: The merge result of every shipped card journals its head SHA, merge SHA, tree hash and PR number read from git and gh, and aidlc audit verify re-derives each fact from git and gh, so the audit checks reality and not only the chain
status: todo
branch: T1-AUDIT-FACTS
worktree: D:\wt\AIDLC\T1-AUDIT-FACTS
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
  - tests/infra/git.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-AUDIT-FACTS.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. WHEN the card runner verifies a card's merge, it shall journal the merge `OPERATION_RESULT` with a `ShippedFacts` payload (`headSha`, `mergeSha`, the tree of `mergeSha`, `pr`) read from the git and gh probes.
  - R2. `aidlc audit verify` shall re-derive each recorded fact from git and gh and report a mismatch as a block finding naming the card, the fact, the recorded value and the re-derived value.
  - R3. A fact that cannot be re-derived shall be reported as unverified and never count as verified.
  - R4. WHEN `--claim-full` is given, the verifier shall refuse unless every shipped card has at least one re-derived fact, naming each card that has none.
  - R5. No verifier check shall read a narration or free-text field.
acceptance:
  - 1. A merged card on the github ship path journals one `OPERATION_RESULT` for the merge whose data parses as `ShippedFacts`, with `headSha` equal to the PR head, `mergeSha` equal to the PR merge commit, `tree` equal to `git rev-parse <mergeSha>^{tree}` and `pr` equal to the PR number, all from scripted git and gh probes; ship output text carrying a different SHA does not change them (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 2. `verifyAudit` with scripted probes re-derives a matching journal with no finding, and reports a block finding naming card, fact and both values when any one of `git cat-file -t <mergeSha>`, the tree, `git merge-base --is-ancestor <mergeSha> <base>` or `gh pr view <pr> --json state,mergeCommit,headRefOid` disagrees (tests/surface/verifier.test.ts). [R2] [dod arm 1]
  - 3. With gh unavailable or the SHA absent from the repository, each affected fact is a warning `FACT_UNVERIFIED` and the card counts as having no re-derived fact (tests/surface/verifier.test.ts). [R3] [dod arm 1]
  - 4. `aidlc audit verify --claim-full` reports `BLOCKED` naming each shipped card with no re-derived fact, including every card of a journal written before this change, and `verified` only when every shipped card has one and the existing conditions hold (tests/scenarios/audit.test.ts). [R4] [dod arm 1]
  - 5. Changing every narration and free-text field of a journal changes no finding and no level (tests/surface/verifier.test.ts). [R5] [dod arm 1]
  - 6. A journal with no shipped card reports the same level and findings as before this change (tests/surface/verifier.test.ts). [R2] [dod arm 1]
  - 7. `git diff --numstat origin/main...HEAD -- src` is at most +140 net; the close-out states it as the first entry of the W2+W4+W5 total against +400. [R1]
  - 8. `docs/OPERATIONS.md` (Audit) and `docs/ARCHITECTURE.md` (Evidence and audit chain) state what is re-derived and what `--claim-full` requires; `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads each exact sentence (tests/surface/verifier.test.ts). [R2] [R4] [dod arm 1]
  - 9. Issue filed for plan finding F4 (seven journal event types declared and never written), named in the close-out. [R5]
depends_on: [T1-STORE-CAS]
budget: 600
tdd: true
sweep: "Survey of main at 5983a1e. No journal event carries a commit SHA, tree hash, check-run id or exec receipt; MANIFEST_SEALED.finalSha is operator input (main.ts:968). The SHA lives only in CardRun.candidate.sha (card-runner.ts:870-876), pr.headRefOid (2238) and the merge token (github-ship.ts:268); the merge OPERATION_RESULT (card-runner.ts:2240) has neither PR nor merge commit though PrInfo.mergeCommit is fetched (gh.ts:87). verifyAudit (verifier.ts:51-144) is offline: chain, ledger, invocation ids, work after terminal, seal, artifact digests, stale candidate. audit verify main.ts:938-954; --claim-full sets hostCaptureBoundary from --capture-boundary."
forbid: [a fact read from ship output text, a network call from a test, a change to the hash-chain format, counting an unverifiable fact as verified]
non_goals: [journaling DoD exec receipts (the agent runs the DoD; a runner-owned DoD is a separate change), check-run ids, deleting the unused event types (issue for F4), rewriting journals written before this change]
hygiene: "Lesson 2026-09-26 T0-AUDIT-READMIT: recognise the merge result event by every field its one writer sets. Run the mutation sweep over every new branch before the first review."
doc_sync: docs/OPERATIONS.md (Audit), docs/ARCHITECTURE.md (Evidence and audit chain), CHANGELOG.md
---

# T1-AUDIT-FACTS

## Deliverable
Each shipped card's merge result in the journal carries facts a third party can check against git and GitHub, and `aidlc audit verify` checks them; the hash chain still proves the records were not altered, and the facts now prove they describe what happened. `--claim-full` names every shipped card without a re-derived fact.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.
