---
id: T0-REPRO-SAME-SHA
title: aidlc review repro refuses a finding whose reviewed candidate is the card run's current candidate, so a repro run before the repair attempt is recorded no longer tests the reviewed commit twice and records reproduced false (issue 317)
status: todo
branch: T0-REPRO-SAME-SHA
worktree: D:\wt\AIDLC\T0-REPRO-SAME-SHA
allow_paths:
  - src/review/repro.ts
  - tests/scenarios/finding-repro.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REPRO-SAME-SHA.md
dod_command: npm run typecheck && node --test tests/scenarios/finding-repro.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the card run's current candidate (`candidate.sha`) and the finding's `candidateSha` name the same commit (compared as the commits `git rev-parse --verify <sha>^{commit}` resolves in the main checkout, so an abbreviated and a full SHA of one commit are the same), `aidlc review repro` shall refuse before any run, with exit 1, no temporary checkout or state directory created and nothing written to the card run, with a message that names the commit and says to record the repair attempt first (`aidlc card attempt <cardId> --outcome success --candidate-sha <sha>`); a SHA that does not resolve to a commit is refused the same way, naming it.
  - R2. Every other refusal, the two runs, the cleanup, the record and its lock, and the prompt line of a repro are unchanged.
  - R3. `docs/OPERATIONS.md` (the Repros list of card T1-FINDING-REPRO-2) shall add the refusal of R1 to the refusals before any run, and `CHANGELOG.md` Unreleased shall carry it under this card id.
acceptance:
  - 1. tests/scenarios/finding-repro.test.ts - a card run whose `candidate.sha` is the finding's `candidateSha` (full, and abbreviated to 7 characters) is refused with exit 1, a message naming the commit and `aidlc card attempt`, the card run byte-for-byte unchanged (the finding has no `repro`), and no `aidlc-repro-` checkout or state directory left under the temp directory and no extra entry in `git worktree list`; a `candidate.sha` that names no commit is refused naming it. [R1] [dod arm 1]
  - 2. tests/scenarios/finding-repro.test.ts - acceptance 1 and 2 of card T1-FINDING-REPRO-2 pass unchanged: a repro with a distinct repaired candidate still records the non-zero exit at the reviewed SHA, 0 at the repair and reproduced. [R2] [dod arm 1]
  - 3. docs/OPERATIONS.md (Repros) and CHANGELOG.md Unreleased carry the refusal under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R3] [dod arm 1]
depends_on: []
budget: 150
tdd: true
sweep: "grep -n 'currentSha\\|candidateSha' src/review/repro.ts: runRepro reads currentSha from found.candidate?.sha and finding.candidateSha and runs runAt twice with no comparison of the two; grep -rn 'candidate' src/cli/main.ts near the repro command: the CLI passes the store and options through and prints both exits without the SHAs."
forbid: [weakening or skipping a test to go green, a change to the two runs, the overlay, the cleanup or the record of a repro, reading the card worktree HEAD in place of the recorded candidate, a change to src/cli/main.ts]
non_goals: [recording a test runner's collected or selected counts beside the exit (issue 317 suggested check 1; it is runner-specific), a repro whose argv selects no test at a distinct candidate, the order of the REPRO_REQUEST sentence]
diagnosis:
  root_cause: "runRepro (src/review/repro.ts) takes the current candidate from the card run record (`found.candidate.sha`), which moves only when `aidlc card attempt --outcome success` records the repaired candidate. Run before that, the current candidate is still the reviewed one: both runs check out the reviewed commit and the --files overlay copies the reviewed test file onto it, so the repaired test never runs and the record says reproduced false. Reproduced from the record of issue 317 (llm-wiki-flywheel, goal g-20261113215957-9454fc, T1-KBEVAL-LINKER F1): `reviewed.sha` and `current.sha` are both 179c5c705df1f62a6ba9b93b08e0502e8c67e34d, both exit 0; the same argv in a detached checkout of 179c5c7 with the test file of ea040d2 exits 1 (3 failed, 2 passed, 41 deselected), also through src/probes/exec.ts run with the repro's options."
  same_class: "The other readers of the recorded candidate (review pre, review r3) run after the attempt that records it; the repro is the one command the REVIEW_FIX narration asks for during the repair, before that attempt."
hygiene: "Issue 317 named the current candidate as ea040d2; the record shows 179c5c7 for both runs, which is the defect. The doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); run the revert table before the first review (docs/LESSONS.md 2026-11-14 T1-OUTCOME-SUMMARY)."
doc_sync: docs/OPERATIONS.md (Repros), CHANGELOG.md
---

# T0-REPRO-SAME-SHA

## Deliverable
`aidlc review repro` refuses to run when the card run's current candidate is still the reviewed commit, and tells the author to record the repair attempt first, so a repro can no longer test the reviewed commit twice and report the fix as not reproduced.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/finding-repro.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
