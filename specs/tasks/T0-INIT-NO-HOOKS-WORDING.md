---
id: T0-INIT-NO-HOOKS-WORDING
title: The README and OPERATIONS text for aidlc init --no-hooks says a hook already installed keeps running, not that no guard runs
status: todo
branch: T0-INIT-NO-HOOKS-WORDING
worktree: D:\wt\AIDLC\T0-INIT-NO-HOOKS-WORDING
allow_paths:
  - README.md
  - docs/OPERATIONS.md
  - tests/surface/readme.test.ts
  - specs/tasks/T0-INIT-NO-HOOKS-WORDING.md
dod_command: npm run typecheck && node --test tests/surface/readme.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The README section `What aidlc init writes` shall state that `aidlc init --no-hooks` merges no hook entry, that a hook already in `.claude/settings.json` stays as it is and keeps running, and that a repository with no hooks wired runs no guard.
  - R2. `docs/OPERATIONS.md` under `## Setup` shall state the same three facts.
acceptance:
  - 1. `tests/surface/readme.test.ts` pins the corrected README sentence exactly, and the phrase `so no guard runs` is in neither the README section nor `docs/OPERATIONS.md` Setup. [R1] [dod arm 1]
  - 2. `tests/surface/readme.test.ts` pins the corrected OPERATIONS Setup sentence exactly. [R2] [dod arm 1]
  - 3. `tests/surface/prose.test.ts` passes. [R1] [R2] [dod arm 1]
depends_on: []
budget: 30
tdd: true
sweep: "Survey of main at 92d8848. The false phrase `so no guard runs` stands at README.md:93 and docs/OPERATIONS.md:15, pinned at tests/surface/readme.test.ts:52 and :57; the CHANGELOG entry of T1-INIT-SURFACE does not make the claim. init.ts leaves a hook already in the file unchanged under --no-hooks (tests/infra/init.test.ts), so an earlier `aidlc init` dispatcher keeps running. R3 decision 1 of T1-INIT-SURFACE raised this as an advisory after the candidate was bound, and a bound candidate takes no new commit (lesson T0-WORKTREE-ROOT-DEFAULT, issue 128), so this card carries the fix."
forbid: [changing what --no-hooks does, removing a hook from a settings file, changing any other sentence of the README section]
non_goals: [a flag that removes hooks, the CHANGELOG, whose T1-INIT-SURFACE entry is accurate]
doc_sync: README.md, docs/OPERATIONS.md
---

# T0-INIT-NO-HOOKS-WORDING

## Deliverable
An adopter reading about `--no-hooks` learns that a hook already in `.claude/settings.json` keeps running, so the flag cannot be read as a way to turn the guards off.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/readme.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
