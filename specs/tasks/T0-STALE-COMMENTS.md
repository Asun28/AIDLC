---
id: T0-STALE-COMMENTS
title: Six code comments that describe a removed cache reset, an unmerged card, decisions where the code counts blocks, a rule the code does not follow, a misplaced doc comment and a missing closure predicate state what the code does
status: merged
branch: T0-STALE-COMMENTS
worktree: D:\wt\AIDLC\T0-STALE-COMMENTS
allow_paths:
  - src/state/paths.ts
  - src/hooks/entry.ts
  - src/loop/card-runner.ts
  - src/core/card-machine.ts
  - specs/tasks/T0-STALE-COMMENTS.md
dod_command: npm run typecheck && node --test tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. The comment above `identityCache` in `src/state/paths.ts` (lines 45-49 at 92796d4f) shall replace the sentence `The cache is per process, so a long-lived test can reset it after creating a repository in a directory it already resolved.` with `The cache is per process and has no reset: an identity resolved before a repository was created in that directory stays until the process ends.` The code has no reset since card T1-SWEEP-DEAD-CODE removed `resetRepoIdentityCache` (tests/surface/removed-surface.test.ts:15-17); `settleRepoIdentity` (:154-158) only adds entries.
  - R2. The comment on `SHELL_TOOLS` in `src/hooks/entry.ts` (line 25) shall replace `A PowerShell command is read as a Bash command until card T1-PS-GUARD-READ adds the PowerShell shapes.` with `Bash and PowerShell commands run the same guards; in the second pass production-gate and protect-paths also read a PowerShell command's own segments and write forms (card T1-PS-GUARD-READ).` Card T1-PS-GUARD-READ has merged, and `productionGate` (src/hooks/index.ts:438) and `protectPaths` (:485) read `powerShellSegments` and `powerShellWrites` for a PowerShell event when not in the classic pass.
  - R3. The doc comment of `preReviewGate` in `src/loop/card-runner.ts` (lines 1396-1397) shall replace `(substantive R3 decisions so far)` with `(substantive R3 blocks so far)`. The code counts blocks: `const cycle = run.review.substantiveBlocks` (:1404), and `PreReviewRound` in src/core/types.ts:361-362 already says blocks.
  - R4. The line `/** A merge-blocking verdict turns the last successful attempt into a counted failure (cause = the block). */` in `src/loop/card-runner.ts` (line 3194) shall be deleted. It documents no declaration (another doc comment and `hasConflictDiagnostic` follow it), and the code does the opposite: a review block reopens the episode and the blocked attempt keeps its success (`reopenAfterReviewBlock`, src/core/effort.ts:35-36); only a ship failure on the code is a counted failure (`afterShipFailure`, :147).
  - R5. The line `/** A ship-side setback that is not the code's fault (a merge conflict, a rejected RED receipt) reopens a succeeded episode so the next attempt is admitted without counting a failure. */` in `src/loop/card-runner.ts` (line 3195) shall move, with its text unchanged, to directly above `export function reopenEpisode` (line 3223), the function it describes, which has no doc comment; `hasConflictDiagnostic` then has its own doc comment directly above it.
  - R6. The comment on `closureComplete` in `src/core/card-machine.ts` (line 28) shall replace `All closure predicates hold (metadata, doc_sync, findings, evidence, cleanup).` with `All closure predicates hold (metadata, docSync, findings, evidence, cleanup, lessons), or the run is persisted as DONE.` The evidence is computed as `run.state === 'DONE' || Object.values(run.closure).every(Boolean)` (src/loop/card-runner.ts:685) over the six flags of `CardRun.closure` (src/core/types.ts:876-884).
  - R7. The diff under `src/` shall change the six comments of R1 to R6 only: no code token, no other comment, and no blank line added or removed. The card file itself also changes (its attempt evidence) and is outside this rule.
acceptance:
  - 1. Each of R1 to R6 is made with the stated text at the stated place (reviewer-verified against the diff). [R1] [R2] [R3] [R4] [R5] [R6]
  - 2. In `git diff <base> -- src` the added and deleted lines are only the lines of the six comments of R1 to R6, each beginning, after indentation, with `/**`, `*` or `*/`; the same ordinary diff (not `--ignore-blank-lines`) shows no blank line added or removed; `npm run typecheck` exits 0 (reviewer-verified against the diff and the DoD output). [R7] [dod arm 1]
  - 3. `tests/scenarios/fault-points.test.ts` passes with no pin added or changed. [R7] [dod arm 1]
depends_on: [T0-DIRTY-SUCCESS-2]
budget: 45
tdd: false
sweep: "git grep -n -e 'reset it after' -e 'long-lived test' -e 'until card T1-' -e 'until card T0-' -e 'R3 decisions so' -e 'decisions so far' -e 'per R3 cycle' -e 'metadata, doc_sync' -e 'merge-blocking verdict turns' -e 'ship-side setback' -- src docs on main at 92796d4f (the paths.ts sentence is split over two lines, so each half is a pattern). Hits and dispositions: src/state/paths.ts:47-48 (R1); src/hooks/entry.ts:25 (R2); src/loop/card-runner.ts:1396 (R3), :3194 (R4), :3195 (R5); src/core/card-machine.ts:28 (R6); src/core/types.ts:361 (`PreReviewRound`: per R3 cycle, counted in blocks; correct, not changed); src/core/types.ts:890 (`pendingRepair`: a ship-side setback awaiting repair, cleared by the next successful attempt; correct, not changed); src/config.ts:37 (blocks allowed per R3 cycle; correct, not changed); docs/ARCHITECTURE.md:38 (the card runner gates SHIP on a fresh pass per candidate and per R3 cycle; correct, not changed); docs/OPERATIONS.md:301 (one R2 round per R3 cycle with `rounds: 1`; correct, not changed) and :311 (rounds capped per R3 cycle; correct, not changed). No other comment in src names a merged card with `until card`. Tests pin none of these comments: tests/surface/removed-surface.test.ts checks the library exports and the CHANGELOG, not src comments."
forbid: [changing any code token, a comment outside R1 to R6, a CHANGELOG entry (no behaviour changes), editing .aidlc state by hand]
non_goals: [the other stale-text findings of the audit (F25b doctor docs, F14 lease comments), rewording correct comments near the six sites, docs/ARCHITECTURE.md and docs/OPERATIONS.md, which state these facts correctly]
hygiene: "Comment-only card: `tdd: false` is the explicit non-TDD exemption of the card template (no behaviour changes, so no RED receipt). No CHANGELOG entry: CLAUDE.md records behaviour changes there, and a comment is none; if the owner asks for one, insert it directly above the entry that begins `- T0-BOARD-OWNER-WAIT (bugfix)`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. Line numbers are from main at 92796d4f; this card follows T0-DIRTY-SUCCESS into src/loop/card-runner.ts (depends_on), so read them again at PREPARE. This card changes src/loop/card-runner.ts, which the verify-card-run-writes coverage record names, so `tests/scenarios/fault-points.test.ts` is in the DoD; the expected outcome is in sync (no write changes). Run that skill before SHIP and at CLOSE, where the sync commit moves to the merge commit on main."
doc_sync: none (comment-only)
---

# T0-STALE-COMMENTS

## Deliverable
Six comments in four source files state what the code does. The new text of each is in R1 to R6. No code changes.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck passes, the fault-point check passes with no pin added, and the diff changes comment lines only.

## Attempt evidence
| Acceptance | Evidence |
|---|---|
| 1 | R1 to R6 applied with the card's text in src/state/paths.ts, src/hooks/entry.ts, src/loop/card-runner.ts (R3, R4, R5), src/core/card-machine.ts; found by quoted text, not line number |
| 2 | `git diff origin/main...HEAD -- src`: 6 insertions, 7 deletions, all comment lines, no blank line added or removed; typecheck exit 0 |
| 3 | `node --test tests/scenarios/fault-points.test.ts` passes, no pin changed |
