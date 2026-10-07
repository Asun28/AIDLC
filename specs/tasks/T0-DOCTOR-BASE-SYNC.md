---
id: T0-DOCTOR-BASE-SYNC
title: aidlc doctor reports whether the local base branch matches origin and names the git command that brings them together; entry check 1 says to push main after committing planning artifacts
status: todo
branch: T0-DOCTOR-BASE-SYNC
worktree: D:\wt\AIDLC\T0-DOCTOR-BASE-SYNC
allow_paths:
  - src/probes/base-sync.ts
  - src/probes/git.ts
  - src/cli/main.ts
  - tests/infra/base-sync.test.ts
  - tests/surface/templates.test.ts
  - .claude/skills/aidlc-loop/SKILL.md
  - templates/claude/skills/aidlc-loop/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-DOCTOR-BASE-SYNC.md
dod_command: npm run typecheck && node --test tests/infra/base-sync.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc doctor` shall print `baseSync`, comparing `refs/heads/<base>` with `refs/remotes/origin/<base>` in the main checkout, where `<base>` is the config `base` without an `origin/` prefix. It reads the refs as they are and never fetches. The value is exactly one of `in sync with origin/<base>`; `ahead <a> of origin/<base>: unpublished commits on <base>; push them (git push origin <base>)`; `behind <b> of origin/<base>: on <base>, git merge --ff-only origin/<base>`; `diverged from origin/<base> (ahead <a>, behind <b>): on <base>, git merge origin/<base>, resolve, then git push origin <base>`; `n/a` outside a git repository; `n/a (no <base> branch)` or `n/a (no origin/<base>)` when that ref does not name a commit; `UNREADABLE: git rev-parse failed (exit <n>)` when a ref lookup exits other than 0 (found) or 1 (absent), and `UNREADABLE: git rev-list failed (exit <n>)` when git cannot count or its output is not two non-negative integers, with `(UNREADABLE)` in place of `(exit <n>)` when there is no numeric exit code. A base that is not a plain branch name after the prefix is removed (empty, a character other than an ASCII letter or digit, `.`, `_`, `/` or `-`, or a leading `-`) gives `n/a (base is not a plain branch name)`, and git is not run. Git's own text never appears in the value. The counts compare the two branch refs, not HEAD, so the branch checked out in the main checkout does not change them. Nothing in this check throws or changes doctor's exit code.
  - R2. Entry check 1 of `.claude/skills/aidlc-loop/SKILL.md` and `templates/claude/skills/aidlc-loop/SKILL.md` shall say to push main after committing the goal's planning artifacts, and to run the git command a `baseSync` value names (the `n/a` and `UNREADABLE` values name none). Both copies stay identical, ASCII and under the 4500-byte cap, and the existing entry check 1 pins still match. To stay under the cap, the Route line `Prints size, kind, target, card count (or unknown), modules, next module.` is removed: it only lists the fields `aidlc goal new` prints itself, and no test pins it.
  - R3. `docs/OPERATIONS.md` shall state R1 (the values, that doctor never fetches, and why: planning commits left only on local main diverge from card PRs cut from origin) and R2; `docs/ARCHITECTURE.md` shall name `src/probes/base-sync.ts`; the CHANGELOG Unreleased section shall carry an entry naming this card.
acceptance:
  - 1. `tests/infra/base-sync.test.ts`, in real temporary repositories (a bare origin and a clone with a commit; skipped by name when git is missing): `baseSyncReport` returns the exact R1 line for in sync, ahead 2, behind 1, and diverged ahead 2 behind 1; for a missing `origin/<base>` and a missing local `<base>` branch; for a config base spelled `origin/main`; for a base of `-x`, `ma in` and a base holding a line break, which give the not-plain line and run no git; and with another branch checked out in the clone, where the counts still compare the two branch refs. Outside a git repository it returns `n/a`. [R1] [dod arm 1]
  - 2. The same file: with a scripted runner whose `rev-list` exits 128 with stderr text, the value is `UNREADABLE: git rev-list failed (exit 128)`; whose `rev-parse` exits 128, `UNREADABLE: git rev-parse failed (exit 128)`; whose `rev-list` has no exit code, `UNREADABLE: git rev-list failed (UNREADABLE)`; whose `rev-list` exits 0 with empty output, `UNREADABLE: git rev-list failed (exit 0)`. No value contains the stderr text, and nothing throws. [R1] [dod arm 1]
  - 3. The same file: `node bin/aidlc.js doctor --json` run in a clone that is ahead of its origin by one commit prints `baseSync` with the ahead line and exits 0. [R1] [dod arm 1]
  - 4. `tests/surface/templates.test.ts`: entry check 1, in both identical copies under the cap, says to push main and to run the git command a `baseSync` value names; the removed Route line is absent from both copies; the existing T0-PLANNING-CLAIMS pins still match. [R2] [dod arm 1]
  - 5. The same file reads `baseSync` and the no-fetch statement in `docs/OPERATIONS.md`, `base-sync.ts` in `docs/ARCHITECTURE.md`, and a T0-DOCTOR-BASE-SYNC entry in the CHANGELOG Unreleased section. [R3] [dod arm 1]
depends_on: []
budget: 350
tdd: true
diagnosis:
  root_cause: "Entry check 1 of the aidlc-loop skill told sessions to commit planning artifacts on main and said nothing about pushing them, and `aidlc doctor` reported only uncommitted planning files. Local main reached 53 commits ahead and 4 behind origin/main while doctor printed `workingTree: clean`. Card branches start from origin/main, so PR 146 rewrote the 'Context pack split' section of docs/plans/PLAN-v5.1-hardening.md that local main was also editing; the sync on 2026-10-07 conflicted there (resolved in 306e6cb)."
  same_class: "Any commit made on the main checkout and not pushed: planning artifacts, card text amendments, closure metadata. All of them show up as ahead counts in baseSync."
sweep: "grep -n 'workingTree\\|doctorWorkingTree' src/cli/main.ts lists the doctor surface; grep -rn 'divergence(' src lists the existing callers of the count probe, which keep their HEAD default."
forbid: [a fetch or any network call from doctor, git text in the doctor value, changing doctor's exit code, raising the SKILL.md cap, removing an existing pin]
non_goals: ["pushing automatically", "a Stop-hook reminder for unpushed commits", "remotes other than origin, which the ship path also assumes"]
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-DOCTOR-BASE-SYNC

## Deliverable
`aidlc doctor` shows when local main and origin/main have drifted apart and prints the git command that brings them together, so the next session publishes planning commits before a card PR edits the same text.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/base-sync.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
