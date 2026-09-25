---
id: T0-APPROVER-IDENTITY
title: aidlc authorize, aidlc plan approve and aidlc report --result approved record the git identity of the repository as the approver when no --by is given, instead of the literal user
status: todo
branch: T0-APPROVER-IDENTITY
worktree: D:\wt\AIDLC\T0-APPROVER-IDENTITY
allow_paths:
  - src/probes/git.ts
  - src/cli/main.ts
  - tests/infra/git.test.ts
  - tests/surface/approver.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-APPROVER-IDENTITY.md
dod_command: npm run typecheck && node --test tests/infra/git.test.ts tests/surface/approver.test.ts
dod_exit: 0
requirements:
  - R1. `GitProbe.userIdentity(cwd)` shall return the trimmed output of `git config user.email` when it is not empty, else the trimmed output of `git config user.name` when that is not empty, else `undefined`; a git command that exits non-zero counts as unset, and the method never throws.
  - R2. `aidlc authorize <kind>`, `aidlc plan approve <goalId>` and `aidlc report --result approved` run without `--by` shall record `grantedBy` as `GitProbe.userIdentity` of the main checkout, and as `user` when that is `undefined`; with `--by <who>` they shall record `<who>` as given.
acceptance:
  - 1. With a scripted runner, `userIdentity` returns the email when `user.email` is set; the name when `user.email` exits 1 or prints only whitespace and `user.name` is set; `undefined` when both exit 1 or print only whitespace; and the email when both are set (tests/infra/git.test.ts). [R1] [dod arm 1]
  - 2. In a temporary git repository whose global and system git config are isolated (`GIT_CONFIG_GLOBAL` pointing at an empty file, `GIT_CONFIG_NOSYSTEM=1`) and whose local config sets `user.email`, `aidlc plan approve <goal>`, `aidlc authorize development --goal <goal>` and `aidlc report --goal <goal> --result approved` without `--by` each add an authorization whose `grantedBy` is that email, read from `aidlc goal status <goal>` (tests/surface/approver.test.ts). [R2] [dod arm 1]
  - 3. In the same setup, `--by "release manager"` on each of the three commands records `release manager`; a repository with only `user.name` set records the name; a repository with neither set records `user` (tests/surface/approver.test.ts). [R2] [dod arm 1]
  - 4. `docs/OPERATIONS.md` (after the `aidlc authorize production` example) states the default approver; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentence this card adds to `docs/OPERATIONS.md` and fails when it is removed (tests/surface/approver.test.ts). [R2] [dod arm 1]
depends_on: []
budget: 200
tdd: true
sweep: "grep -rn \"'user'\" src/ and grep -rn -- '--by' src/cli/main.ts: the literal default is at src/cli/main.ts:376 (authorize --by), src/cli/main.ts:656 (plan approve --by) and src/loop/controller.ts:464 (the approved report with no data.by, reached by `aidlc report --result approved` since main.ts:350 has no default). `goal extend --by` (main.ts:244) is required and stays. The intake authorizations of `goal new` take grantedBy from the request source (controller.ts:134,145) and stay. No code reads git user.name or user.email today; only test fixtures set them."
forbid: [reading the git identity on any command other than these three approvals, or when --by is given, changing the controller fallback 'user' at controller.ts:464 that library callers rely on, changing the AuthorizationRecord schema]
non_goals: [the grantedBy of the intake authorizations written by goal new, the --author default of intent new, recording identity on journal events, goal extend --by]
hygiene: "Run the mutation sweep over userIdentity and the three CLI defaults before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (after the authorize production example), CHANGELOG.md
---

# T0-APPROVER-IDENTITY

## Deliverable
An approval recorded without `--by` names who approved it: `aidlc authorize`, `aidlc plan approve` and `aidlc report --result approved` default the approver to the repository's git identity (`user.email`, else `user.name`), so `grantedBy` in the goal record and the audit trail says who approved instead of `user`. An explicit `--by` still wins; with no git identity the default stays `user`. Git is read only on these three commands and only when `--by` is absent.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/git.test.ts tests/surface/approver.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
