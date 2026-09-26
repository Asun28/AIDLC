---
id: T1-README-SCOPE
title: The README first paragraph states that aidlc is not an implementation of the AWS AI-DLC methodology and names what it is, a bounded-autonomy control plane for coding agents that is driver-agnostic
status: todo
branch: T1-README-SCOPE
worktree: D:\wt\AIDLC\T1-README-SCOPE
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - README.md
  - tests/surface/readme.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-README-SCOPE.md
dod_command: npm run typecheck && node --test tests/surface/readme.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The first paragraph of README.md shall state that aidlc is not an implementation of the AWS AI-DLC methodology and that it is a bounded-autonomy control plane for coding agents, driver-agnostic.
acceptance:
  - 1. The first paragraph of README.md (the text between the title and the first blank line after it) contains the added sentence verbatim; a test reads that paragraph and fails with the sentence removed or moved to a later paragraph (tests/surface/readme.test.ts). [R1] [dod arm 1]
  - 2. The rest of the first paragraph is unchanged apart from that sentence, and `docs/ARCHITECTURE.md` Patterns borrowed still credits the AWS AI-DLC workflows (tests/surface/readme.test.ts). [R1] [dod arm 1]
  - 3. `CHANGELOG.md` Unreleased carries the entry under this card id, and the added text carries no em dash or CJK corner bracket (tests/surface/readme.test.ts, tests/surface/prose.test.ts). [R1] [dod arm 1]
  - 4. `git diff --numstat origin/main...HEAD -- src` is empty. [R1]
depends_on: [T1-INIT-SURFACE]
budget: 60
tdd: true
forbid: [any change under src/, removing the AWS AI-DLC credit from docs/ARCHITECTURE.md]
non_goals: [a rewrite of the README, a naming change of the package]
doc_sync: README.md, CHANGELOG.md
---

# T1-README-SCOPE

## Deliverable
A reader of the README's first paragraph learns that aidlc is not the AWS AI-DLC methodology and that it is a bounded-autonomy control plane for coding agents, independent of the driver.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/readme.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
