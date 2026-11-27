---
id: T0-DOC-CLAIMS-3
title: "Three stale doc claims: review-pool writes, the board write of aidlc next, init and CLI tests (issues 523, 524, 525)"
status: merged
branch: T0-DOC-CLAIMS-3
worktree: D:\wt\AIDLC\T0-DOC-CLAIMS-3
allow_paths:
  - docs/OPERATIONS.md
  - CLAUDE.md
  - src/cli/main.ts
  - docs/REQUIREMENTS-TRACEABILITY.md
  - tests/surface/doc-claims.test.ts
  - tests/surface/prose.test.ts
  - changelog.d/T0-DOC-CLAIMS-3.md
  - specs/tasks/T0-DOC-CLAIMS-3.md
dod_command: npm run typecheck && node --test tests/surface/doc-claims.test.ts tests/surface/prose.test.ts tests/surface/readme.test.ts tests/surface/claude-md-size.test.ts tests/surface/claude-md-reuse.test.ts tests/surface/removed-surface.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. (issue 523) In the lock sentence of `docs/OPERATIONS.md`, Sessions, `release and review-pool records stay last-writer-wins` shall become `release records stay last-writer-wins`: `ReviewQueue.updatePool` (`src/coordination/review-queue.ts`) writes the pool record inside `section`, under the queue's lock, while `GoalStore.saveRelease` (`src/state/goal-store.ts:133`) writes with `atomicWriteJson` and no lock. No other text of the section changes, so the section gets shorter and stays under the 13,701-byte cap of `tests/surface/prose.test.ts` acceptance 8.
  - R2. `tests/surface/prose.test.ts` acceptance 8 shall pin the corrected sentence: `LOCK_SESSIONS` changes as in R1, and its unfenced list names `release records` and no longer `release and review-pool records`; every other assertion of the test stays as it is.
  - R3. (issue 524) The sentence of `CLAUDE.md`, Architecture, that starts `One directive per call.` shall say that `aidlc next` writes only its derived transitions and the board view, a derived view, in place of `is read-only apart from derived transitions`; the description of the `next` command in `src/cli/main.ts` shall name the board write the same way. `CLAUDE.md` keeps its line count or fewer.
  - R4. (issue 525) `docs/REQUIREMENTS-TRACEABILITY.md` shall drop the line `` `src/scaffold/init.ts` and `src/cli/main.ts` have no automated tests. ``: `tests/infra/init.test.ts`, `tests/surface/init-base-ci.test.ts` and `tests/surface/init-no-package.test.ts` call `initProject`, and `tests/infra/cli-inprocess.test.ts` runs the CLI.
  - R5. `changelog.d/T0-DOC-CLAIMS-3.md` shall state R1, R3 and R4.
acceptance:
  - 1. `tests/surface/doc-claims.test.ts`, new file, one test per claim: (a) the Sessions section of `docs/OPERATIONS.md` holds `release records stay last-writer-wins` and no `review-pool records stay last-writer-wins`; (b) `CLAUDE.md` holds no `read-only apart from derived transitions` and its `One directive per call.` sentence names the board view; (c) the `next` command description in `src/cli/main.ts` holds no `read-only apart from derived transitions` and names the board; (d) `docs/REQUIREMENTS-TRACEABILITY.md` holds no `have no automated tests` line for `src/scaffold/init.ts` and `src/cli/main.ts`, and the four test files of R4 exist. Each test is RED on main on its own first assertion. [R1] [R3] [R4] [dod arm 2]
  - 2. `tests/surface/prose.test.ts` acceptance 8 passes with the sentence of R2 and the Sessions section under 13,701 bytes. [R1] [R2] [dod arm 2]
  - 3. `readme.test.ts`, `claude-md-size.test.ts`, `claude-md-reuse.test.ts`, `removed-surface.test.ts`, `command-lines.test.ts` and `templates.test.ts` pass unchanged; `git diff` shows no change to `templates/CLAUDE.aidlc.md`. [R3] [dod arm 2]
  - 4. `changelog.d/T0-DOC-CLAIMS-3.md` follows `changelog.d/README.md` (`tests/surface/changelog-fragments.test.ts` passes). [R5] [dod arm 2]
  - 5. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 60
tdd: true
sweep: "On main at 36b00f31. Issue 523: the claim is the LOCK_SESSIONS sentence at `docs/OPERATIONS.md:309`, pinned whole by `tests/surface/prose.test.ts:339` with the unfenced list at `:352`; the Sessions section is 13,696 bytes against the cap of 13,701 (`:349`), so the fix must not lengthen it. `docs/plans/PLAN-v5.1-hardening.md:163` says last-writer-wins of another record and is a dated plan, left as is. Issue 524: `CLAUDE.md:36` and `src/cli/main.ts:510` hold the claim; `src/loop/controller.ts:419` calls `writeBoard` on each `next`. `tests/surface/readme.test.ts:84` lists the same phrase as removed from README.md only, so it is unaffected. No test pins the `One directive per call.` sentence or the command description. The sentence is in the Architecture section, not the aidlc section, so `templates/CLAUDE.aidlc.md` does not change. Issue 525: `docs/REQUIREMENTS-TRACEABILITY.md:98`; `tests/surface/removed-surface.test.ts:69` and `:100` read that file and pin no text of line 98."
forbid: [network]
non_goals:
  - "lines 96 and 97 of `docs/REQUIREMENTS-TRACEABILITY.md` (scenario tests of the runners, a test of `github-ship.ts`); a follow-up issue if they are stale"
  - "any change to how review-pool or release records are written"
  - "the text of PR 529 (T0-BOARD-SUPERSEDED), which also edits the Sessions section"
doc_sync: docs/OPERATIONS.md, CLAUDE.md, docs/REQUIREMENTS-TRACEABILITY.md
hygiene: "Issues 523, 524 and 525, found while planning T0-README-PLAIN (2026-11-27). RED first: acceptance 1 on main."
---

# T0-DOC-CLAIMS-3

Issues 523, 524 and 525: three doc claims the code no longer matches.

## Why
`docs/OPERATIONS.md` lists review-pool records as unfenced while the queue lock covers them; `CLAUDE.md` and the `next` help call `aidlc next` read-only apart from derived transitions while it writes the board view; `docs/REQUIREMENTS-TRACEABILITY.md` says init and the CLI have no tests while four test files cover them.

## Deliverable
The three corrected texts, the prose pin updated to the corrected sentence, and one new test per claim.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/doc-claims.test.ts tests/surface/prose.test.ts tests/surface/readme.test.ts tests/surface/claude-md-size.test.ts tests/surface/claude-md-reuse.test.ts tests/surface/removed-surface.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: each stale claim is gone, each corrected text is present, and the Sessions section stays under its cap.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|

## PR summary

### What
Three doc corrections and the help text of `aidlc next`.

### Why / Intent
Issues 523, 524 and 525: the docs state what the code does not do.

### How / Behaviour
Text only; `src/cli/main.ts` changes one description string.

### System impact
None at runtime.

### Security
No change.

### Tests and review
A new test per claim, RED on main; the prose pin of the Sessions sentence follows the corrected sentence.

### Risk
Low. PR 529 also edits the Sessions section; whichever merges second syncs the base.

### Ownership
Docs, `CLAUDE.md`.

### Docs
A changelog fragment.
