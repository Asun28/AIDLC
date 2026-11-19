---
id: T1-REVIEW-POLICY-PIN
title: An R2 or R3 decision applies the REVIEW.md of the card run's base commit, read with git, not the file in the main checkout's working tree, and records that blob's hash
status: todo
branch: T1-REVIEW-POLICY-PIN
worktree: D:\wt\AIDLC\T1-REVIEW-POLICY-PIN
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - src/probes/git.ts
  - src/loop/card-runner.ts
  - tests/scenarios/review-policy-pin.test.ts
  - tests/infra/git.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T1-REVIEW-POLICY-PIN.md
  - specs/tasks/T1-REVIEW-POLICY-PIN.md
dod_command: npm run typecheck && node --test tests/scenarios/review-policy-pin.test.ts tests/infra/git.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/r3-fallback.test.ts
dod_exit: 0
requirements:
  - R1. `GitProbe.fileAt(cwd, oid, path)` (new, src/probes/git.ts) shall return the bytes of `<oid>:<path>` as UTF-8 text through `git cat-file blob`, or undefined when the commit holds no such file; a git failure other than a missing path throws `GitProbeError`.
  - R2. The card runner's review policy (src/loop/card-runner.ts:424-430) shall be the REVIEW.md of the run's base commit (`run.base.oid`) read with R1; a run with no recorded base reads the configured `base` ref's commit. When that commit holds no REVIEW.md the built-in policy text of main applies. The main checkout's working-tree REVIEW.md is not read on these paths.
  - R3. The policy hash recorded on each decision (`policyHash`, :1527, :2031, :2670) shall be the hash of the text R2 read, so an uncommitted edit to REVIEW.md in the main checkout changes neither the prompt nor the hash.
  - R4. docs/OPERATIONS.md (Formal review (R3) as a command) shall state R2 and R3 and that a REVIEW.md change applies to a card run only after it is on the base the run started from; changelog.d/T1-REVIEW-POLICY-PIN.md records the change.
acceptance:
  - 1. `tests/infra/git.test.ts`, new test "T1-REVIEW-POLICY-PIN acceptance 1: fileAt returns the blob, undefined for a missing path, and throws on a bad oid". Temp repository. Fails on main (no method). [R1] [dod arm 1]
  - 2. `tests/scenarios/review-policy-pin.test.ts` (new), "T1-REVIEW-POLICY-PIN acceptance 2: an uncommitted REVIEW.md edit in the main checkout reaches neither the R3 prompt nor the recorded policy hash; the base commit's text does". makeFixture with a scripted reviewer capturing the prompt. Fails on main. [R2] [R3] [dod arm 1]
  - 3. Same file, "T1-REVIEW-POLICY-PIN acceptance 3: a base commit without REVIEW.md gets the built-in policy". Fails on main only if the fallback path changes; else RED is acceptance 2. [R2] [dod arm 1]
  - 4. second-pass.test.ts and r3-fallback.test.ts pass with no line changed. [R2] [dod arm 1]
  - 5. The OPERATIONS.md and changelog text are as R4 states (reviewer-verified against the diff). [R4]
depends_on: [T1-BENCH-FORMAL-COMMAND]
parallelizable_with: [T1-BENCH-CLEAN-40]
budget: 120
tdd: true
sweep: "Main at ff925160. reviewPolicy src/loop/card-runner.ts:424-430 (reads <mainRoot>/REVIEW.md), callers :1527, :2031, :2670; run.base?.oid used at :2838. GitProbe src/probes/git.ts:47-264 (objectType :155 and treeOf :160 show the cat-file pattern). The candidate worktree's REVIEW.md was never read; this card closes the main-checkout working-tree gap (Codex gpt-6-astra, panel of 2026-11-19; Anthropic Code Review reads REVIEW.md from the base branch only)."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
non_goals: [the reviewer bench, which keeps reading the checkout it runs in so a card worktree can score its own policy; docs/LESSONS.md selection; CLAUDE.md or AGENTS.md handling]
---

# T1-REVIEW-POLICY-PIN

## Deliverable
The rubric a card is reviewed against is a committed fact on its base, the same for every decision of the run, and an edit sitting in the main checkout cannot change it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-policy-pin.test.ts tests/infra/git.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/r3-fallback.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass and the existing tests pass unchanged.
