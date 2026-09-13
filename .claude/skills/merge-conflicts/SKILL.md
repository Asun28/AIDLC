---
name: merge-conflicts
description: >-
  Resolve conflict markers left by a merge-based base sync in a card
  worktree, by the intent of each side. Use only when git reports
  conflicts; never to choose a rebase.
---
# merge-conflicts: resolve by intent

1. See the state: `git status`, `git diff --name-only --diff-filter=U`,
   both histories (`git log --oneline <base>...HEAD`), each conflicting
   file in full.
2. Find the primary sources of each side: commit messages, the PR, the
   card (`allow_paths`, acceptance) and its plan section. Know why each
   change was made before touching a hunk.
3. Resolve each hunk by intent. Keep both where they are compatible;
   where they are not, keep the side the card's goal needs and note the
   trade-off in the merge commit. Never invent behaviour, never take a
   whole side blindly.
4. Merge only. No rebase, no amend of receipt-bound or published history.
5. Run the checks: typecheck, the card's `dod_command`, the affected
   tests. Fix what the merge broke, inside `allow_paths`.
6. Stage and commit the merge. It is a new candidate: DoD and the R2/R3
   review run again; no stale approval carries over.
7. Cannot resolve by intent: `git merge --abort`, then STOP/card with the
   conflicting paths and both intents stated.

Adapted from mattpocock/skills (MIT, (c) 2026 Matt Pocock); notice in
docs/THIRD-PARTY-NOTICES.md.
