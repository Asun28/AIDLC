---
id: T0-SHIP-BASE-SYNC
title: The GitHub ship path syncs the candidate with its base before any remote effect, so a conflict returns the card to BUILD with the merge left in the worktree instead of a PR GitHub never runs CI on
status: todo
branch: T0-SHIP-BASE-SYNC
worktree: C:\wt\T0-SHIP-BASE-SYNC
allow_paths:
  - src/delivery/github-ship.ts
  - src/delivery/ship.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/ship.test.ts
  - README.md
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-BASE-SYNC.md
dod_command: npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/ship.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the GitHub ship path has a candidate-bound verdict for the committed head, it shall fetch the base and test the merge of the base into the head before any push, PR or local merge.
  - R2. WHEN the test merge reports a conflict, the ship path shall start the same merge in the card worktree (never committing it), print git's own conflict diagnostic on its output and fail the ship as merge-failed, so the card runner returns the card to BUILD naming merge-conflicts.
  - R3. WHEN the test merge is clean, the ship path shall continue with the head unchanged, so the reviewed candidate is the commit that is pushed, gated and merged.
  - R4. WHEN the base cannot be fetched or resolved, or the merge test fails for a reason other than a conflict, the ship path shall fail as merge-failed without a conflict diagnostic, which the runner stops with reason tool and the resume command.
acceptance:
  - 1. `GitHubShipPath.ship` runs the base sync after the verdict check and before any remote effect, in both modes. Remote mode: `git fetch --quiet --no-tags origin +refs/heads/<base>:refs/remotes/origin/<base>` in the worktree (`GitProbe.fetchBase`), then `refs/remotes/origin/<base>` resolved as a commit (`GitProbe.resolveBase`); local mode: no fetch, `refs/heads/<base>` first (`resolveBase` with `preferLocal`). `<base>` is `req.base` without an `origin/` prefix, the same name the PR targets. Then `git merge-tree --write-tree HEAD <ref>` in the worktree, exit 0 meaning clean, exit 1 a conflict, anything else a failure. github-ship.test.ts asserts the fetch, the resolve and the merge-tree calls in that order, all before `git push`, and that local mode issues no fetch. [R1] [dod arm 1]
  - 2. On a conflict the path runs `git merge --no-ff --no-commit <ref>` in the worktree with `LC_ALL=C` in the child environment (so the diagnostic is the English line the runner matches), appends every stdout and stderr line of that merge to the ship output verbatim (`Auto-merging ...`, `CONFLICT (content): Merge conflict in <path>`, `Automatic merge failed; fix conflicts and then commit the result.`), then fails with `[SHIP-BASE-SYNC-CONFLICT] <ref> conflicts with HEAD`; `classifyShipOutput` maps the sentinel to `merge-failed` (ship.test.ts) and `hasConflictDiagnostic` is true for the receipt. Nothing is pushed, no PR is created, the local merge into the main checkout is not attempted and HEAD does not move. If that merge unexpectedly completes (exit 0), `git merge --abort` restores the worktree and the ship fails as in acceptance 4. Through the card runner (`shipThroughConfig`), the outcome is a `build` directive whose `skills` start with `merge-conflicts`, with `pendingRepair.kind === 'merge-conflict'` and no DoD receipt. The seeded RED is this scenario against the previous path, where the conflicting candidate was pushed and the ship reported `merged`. [R2] [dod arm 1]
  - 3. On a clean test merge the ship output carries one plain line naming the base ref and its oid, no new sentinel, and the chain continues unchanged: the head pushed, gated and squash-merged is the commit the verdict names, and the merge token tip equals it (the happy-path test asserts the tip and the sync line; `readMergeToken(...).tip === HEAD`). A base that is already an ancestor of the head is clean. [R3] [dod arm 1]
  - 4. A failed fetch, an unresolvable base ref or a merge-tree exit other than 0 or 1 fails with `[SHIP-BASE-SYNC-FAIL] <reason>` (the git stderr on the same line), mapped to `merge-failed` in `SENTINEL_MAP`, with no conflict diagnostic in the output, so the runner's default branch stops the card with reason `tool` and the `[SAGA-RESUME]` command; the worktree is untouched (no `git merge` issued). github-ship.test.ts covers the fetch failure and the merge-tree error; ship.test.ts covers the classification. [R4] [dod arm 1]
  - 5. Docs: `docs/ARCHITECTURE.md` (the `GitHubShipPath` chain names the base sync between the verdict and the push), `docs/OPERATIONS.md` (Ship gates: the sync, its two sentinels, the git 2.38 requirement for `merge-tree --write-tree`, and that the worktree is left mid-merge for the merge-conflicts skill), `README.md` (the github chain line and the git version under prerequisites) and the CHANGELOG Unreleased entry; the header comment of `github-ship.ts` states the chain with the sync. [dod arm 1]
budget: 320
tdd: true
sweep: "grep -rn 'commit, push, PR\\|push -> PR\\|base sync\\|merge-based sync' README.md docs src .claude/skills: README.md:10 (the github chain), ARCHITECTURE.md:183 (the chain) and :185 (the runner mapping, already correct), OPERATIONS.md:236 (the skill table, already correct), github-ship.ts:3-6 (header), card-loop.md SHIP (already says merge-based sync only), merge-conflicts/SKILL.md (already describes markers left by the sync)"
non_goals: [re-testing the base while the CI gate polls (the window left is the push and PR creation; a PR that turns conflicting after CI ran fails at `gh pr merge` with gh's own diagnostic, which the runner already maps to BUILD), starting the merge in the worktree for that late gh conflict, changing the scaffold path (task.ps1 owns its own sync), a version check in `aidlc doctor`, rebasing or amending the branch]
forbid: [any command that moves HEAD of the card branch inside the ship path (no merge commit, no rebase, no amend), pushing or opening a PR before the sync has run, a rebase in any narration or doc]
diagnosis:
  root_cause: "`GitHubShipPath.ship` pushes and opens the PR without ever comparing the branch with its base. A branch behind a base it conflicts with becomes a PR GitHub runs no pull_request workflow on, so the CI gate polls an empty check-run list until ciTimeoutMs (30 min) and the runner classifies ci-timeout as an unclassified CI failure: STOP/ci (PR #15, T0-BIN-STALE-DIST-3; PR #10 before it). The runner's conflict path (merge-failed with git's diagnostic returns the card to BUILD naming merge-conflicts, T1-LOOP-SKILLS) is reachable only from `gh pr merge` or the local merge, never before the PR exists, and the merge-conflicts skill describes markers left by a base sync that no ship path performs."
  same_class: "Local mode has the same gap one step later: `git merge --no-ff` into the main checkout reported only its stderr, which lacks git's CONFLICT lines (stdout), so a conflict stopped with reason tool and left the main checkout mid-merge. The sync runs before the mode split, so both modes fail in the worktree before main is touched. `ScaffoldShipPath` delegates to task.ps1 and is unchanged."
hygiene: "The sync is read-only in the clean case (`merge-tree --write-tree` writes objects, never refs or the worktree) and mutates the worktree only on a conflict, where the in-progress merge is the deliverable for the merge-conflicts skill. The conflict merge uses --no-commit so the branch head cannot move inside the ship path even if git resolves more than merge-tree predicted; the reviewed candidate stays the shipped commit. Tests script every git call through scriptedRunner and assert call order, never a real repository."
doc_sync: README.md (github chain line, prerequisites), docs/ARCHITECTURE.md (ship adapters), docs/OPERATIONS.md (Ship gates), CHANGELOG.md
---

# T0-SHIP-BASE-SYNC

## Deliverable
`GitHubShipPath.ship` gains a base sync between the candidate-bound verdict check and the first remote effect: fetch the base (remote mode), resolve it, `git merge-tree --write-tree HEAD <ref>`. Clean: one log line, the chain continues with the same head. Conflict: `git merge --no-ff --no-commit <ref>` in the worktree leaves the markers for the merge-conflicts skill, git's diagnostic lines go into the ship output, and `[SHIP-BASE-SYNC-CONFLICT]` classifies as `merge-failed`, which the runner already turns into BUILD naming `merge-conflicts` with the episode reopened and the repair persisted. Fetch or merge-tree failures are `[SHIP-BASE-SYNC-FAIL]`, `merge-failed` without a diagnostic: STOP/tool with the resume command. Both sentinels join `SENTINEL_MAP`. Docs state the chain and the git 2.38 requirement.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/ship.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: the ship path tests assert the fetch, resolve and merge-tree calls before any push in remote mode and no fetch in local mode; the conflict case issues the no-commit merge with `LC_ALL=C`, carries git's diagnostic in the receipt, pushes nothing, moves nothing, and reaches a `build` directive naming `merge-conflicts` through the card runner; the clean case merges the verdict's head with the token tip equal to it; fetch and merge-tree failures classify as `merge-failed` without a diagnostic; the sentinel tests in ship.test.ts map both sentinels; the t0-flow conflict mapping tests still pass.
