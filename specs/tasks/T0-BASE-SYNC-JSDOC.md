---
id: T0-BASE-SYNC-JSDOC
title: The JSDoc of formalPool, formalReviewerFor and CandidateInfo.baseSync names the base-sync reviewer's own pool, its lookup by name and the marking of an undecided base-sync candidate's repair
status: todo
branch: T0-BASE-SYNC-JSDOC
worktree: D:\wt\AIDLC\T0-BASE-SYNC-JSDOC
allow_paths:
  - src/loop/card-runner.ts
  - src/core/types.ts
  - tests/surface/base-sync-jsdoc.test.ts
  - scripts/code-unchanged.mjs
  - CHANGELOG.md
  - specs/tasks/T0-BASE-SYNC-JSDOC.md
dod_command: npm run typecheck && node --test tests/surface/base-sync-jsdoc.test.ts && node scripts/code-unchanged.mjs src/loop/card-runner.ts src/core/types.ts
dod_exit: 0
requirements:
  - R1. The JSDoc of `CardRunner.formalPool` shall state that the base-sync reviewer always queues in its own pool `<pool>/<reviewer>`, and that the primary and the fallback queue in the goal's pool, or one pool each with a fallback configured.
  - R2. The JSDoc of `CardRunner.formalReviewerFor` shall state that it looks the reviewer up by the name the invocation records: the base-sync reviewer under its own name, else the fallback under its own name, else the primary.
  - R3. The JSDoc of `CandidateInfo.baseSync` shall state both markings: the success that clears a merge-conflict repair, and the success that repairs a base-sync candidate no R3 decision has decided yet.
  - R4. No code token of `src/loop/card-runner.ts` or `src/core/types.ts` shall change, which `scripts/code-unchanged.mjs` checks in the dod_command (exit 0 identical, 1 changed, 2 unreadable, never a pass on an error); `CHANGELOG.md` Unreleased shall carry the entry.
acceptance:
  - 1. `tests/surface/base-sync-jsdoc.test.ts` reads the comment directly above each of the three symbols and asserts the exact sentences this card writes, failing with any one removed or moved to another symbol. [R1] [R2] [R3] [dod arm 1]
  - 2. `scripts/code-unchanged.mjs`, which only this card's dod_command runs (never npm test), compares the TypeScript code of `src/loop/card-runner.ts` and `src/core/types.ts`, printed with comments removed, between HEAD and `git merge-base HEAD origin/main`, and exits 0 on the candidate. Proven both ways before R2 round 3: exit 0 on 75ae1c0 (both files identical to the merge base b64ea7d, 2398 and 763 printed lines); exit 1 on a throwaway commit with one changed code line in each file (card-runner.ts reported CHANGED at printed line 1174, types.ts at 473); exit 2 with no file, with a file that does not exist and in a repository without origin/main. [R4] [dod arm 2]
  - 3. The same test file reads the exact CHANGELOG Unreleased sentence this card adds. [R4] [dod arm 1]
depends_on: []
budget: 60
tdd: false
sweep: "grep -n 'private formalPool\\|private formalReviewerFor\\|baseSync' src/loop/card-runner.ts src/core/types.ts: card-runner.ts:1231-1241 formalPool (JSDoc :1232-:1236 names only the fallback layout; the inline comment :1238-:1239 and the code already put the base-sync reviewer in its own pool); :1294-:1299 formalReviewerFor (JSDoc :1294 names only the fallback; the code looks up the base-sync reviewer first, :1297); types.ts:660-668 CandidateInfo (JSDoc :666 names only the merge-conflict marking; card-runner.ts:880-888 also marks the repair of an undecided base-sync candidate). docs/ARCHITECTURE.md and docs/OPERATIONS.md do not name these symbols. In-flight branches: T1-PARSE-GUARD edits card-runner.ts only near :18 and :2153 and not types.ts; T0-CI-RED-LOGS-2 edits neither."
forbid: ["any change to src/loop/card-runner.ts other than the JSDoc comment lines directly above formalPool and formalReviewerFor (exception granted by the coordinating session for this card only; card-runner.ts is otherwise owned by T1-PARSE-GUARD)", "any change to src/core/types.ts other than the JSDoc of CandidateInfo.baseSync", a changed code token in either file, a new no-verdict retry for the base-sync decision, running scripts/code-unchanged.mjs from npm test]
non_goals: [issue #65 item 3 (ruled: no change, see hygiene), the inline comments inside the method bodies, docs/OPERATIONS.md, scripts/code-unchanged.mjs as a repository tool (card-only: no npm test, no CHANGELOG line, no package file)]
hygiene: "Filed from issue #65 item 2 (R2 and R3 advisories on T0-BASE-SYNC-REVIEW). Comment-only: tdd false, since no behaviour changes; the proof is the JSDoc sentence test and the token sweep. Issue #65 item 3 ruling (coordinating session, for the user): keep the single shared no-verdict retry for the base-sync decision; no code change. Reasons: docs/OPERATIONS.md already states it; a base-sync decision is already one decision past the allowance; a retry of its own would widen an allowance in a fail-closed loop; and the change would edit review-policy.ts, which T1-PARSE-GUARD owns."
doc_sync: CHANGELOG.md
---

# T0-BASE-SYNC-JSDOC

## Deliverable
The three comments that T0-BASE-SYNC-REVIEW left describing only the fallback layout or the merge-conflict marking now describe what the code does: the base-sync reviewer's own review pool, its lookup by the recorded reviewer name, and both successes that mark a base-sync candidate. No code token changes.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/base-sync-jsdoc.test.ts && node scripts/code-unchanged.mjs src/loop/card-runner.ts src/core/types.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
