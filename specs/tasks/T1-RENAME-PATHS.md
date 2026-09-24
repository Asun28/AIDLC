---
id: T1-RENAME-PATHS
title: Renamed files are listed by both their source and destination path, unquoted, so the scope gate refuses a file moved out of allow_paths and the effort path rule matches a non-ASCII rename source
status: merged
branch: T1-RENAME-PATHS
worktree: D:\wt\AIDLC\T1-RENAME-PATHS
allow_paths:
  - src/review/pre-review.ts
  - src/probes/git.ts
  - src/core/review-effort.ts
  - tests/surface/pre-review.test.ts
  - tests/core/review-effort.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - tests/infra/git.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-RENAME-PATHS.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/core/review-effort.test.ts tests/scenarios/r3-fallback.test.ts tests/infra/git.test.ts
dod_exit: 0
requirements:
  - R3. The changed-path listing used by the scope gate and the effort path rule shall name a renamed file by both its source and its destination path, unquoted.
acceptance:
  - 1. The changed-path listing in `src/review/pre-review.ts` (~:690) and `GitProbe` (`src/probes/git.ts` ~:137) run `git diff --name-only -z --no-renames`, so a rename appears as its source and its destination path; a path with non-ASCII characters is returned as written, with no C-quoting or octal escapes (pre-review.test.ts argv assertion; git.test.ts on a real temporary repository with a non-ASCII rename). [R3] [dod arm 1]
  - 2. The scope gate refuses a candidate that renames a file from inside `allow_paths` to a path outside it, and one that renames a file from outside `allow_paths` into it (pre-review.test.ts). [R3] [dod arm 1]
  - 3. The effort path rule matches a rename source through the changed-path list alone: `renameSources` is removed and its callers use the list; a small candidate renaming a non-ASCII file out of `src/core/*.ts` (single-segment glob) selects `high` (review-effort.test.ts, r3-fallback.test.ts). [R3] [dod arm 1]
  - 4. `docs/OPERATIONS.md` replaces the rename-limit sentence of card T1-OPUS55-R3-3 with the new rule and `CHANGELOG.md` Unreleased carries the entry; a test reads the exact sentences this card adds and fails with any one removed. [R3] [dod arm 1]
depends_on: [T1-REVIEW-LOOP-GUARDS]
plan_ref: plans/review-followups.md#7
budget: 220
tdd: true
sweep: "grep -rn 'name-only\|renameSources' src/ tests/: the two name listings (pre-review.ts:690, git.ts:137), renameSources (review-effort.ts:45) and its callers and tests"
non_goals: [copy detection, changing the effort thresholds or globs, changing how the diff text itself is collected]
forbid: [loosening the scope gate]
hygiene: "Follow-ups 2 and 4 of goal g-20260923224425-e5e886. --no-renames with -z lists both sides of a rename without quoting, so one listing fixes the scope gate (a rename out of allow_paths was named by its destination only) and the octal-escape miss in renameSources, which this card removes. Every R2 and R3 prompt carries the changed-path list, so a rename now shows there as a deletion and an addition. Run the mutation sweep before the first review (docs/LESSONS.md)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-RENAME-PATHS

## Deliverable
`git diff --name-only` names a renamed file by its destination only, and `renameSources` keeps git's C-quoting for non-ASCII names. This card lists changed paths with `--no-renames -z`, so a rename shows both paths unquoted. The scope gate then refuses a file moved across the `allow_paths` boundary, and the effort path rule matches every rename source, which lets `renameSources` go.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/core/review-effort.test.ts tests/scenarios/r3-fallback.test.ts tests/infra/git.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
