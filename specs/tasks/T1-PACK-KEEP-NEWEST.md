---
id: T1-PACK-KEEP-NEWEST
title: The context pack removes the earliest matching lesson line first when it exceeds its budget, so the newest matching lessons stay
status: todo
branch: T1-PACK-KEEP-NEWEST
worktree: D:\wt\AIDLC\T1-PACK-KEEP-NEWEST
plan_ref: plans/lesson-delivery.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/loop/context-pack.ts
  - tests/core/context-pack.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T1-PACK-KEEP-NEWEST.md
  - specs/tasks/T1-PACK-KEEP-NEWEST.md
dod_command: npm run typecheck && node --test tests/core/context-pack.test.ts tests/scenarios/context-pack.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R5. WHEN the serialized context pack exceeds its budget, the context pack shall remove the earliest matching lesson line first and keep the remaining lines in file order.
  - R6. The context pack paragraph of `docs/OPERATIONS.md` shall say that whole lessons are removed from the start first, the oldest matching line before a newer one.
acceptance:
  - 1. tests/core/context-pack.test.ts, the test at line 30 (`budget removes lesson tail before plan text and preserves complete acceptance`) - at its budget of 285 the pack holds `['- router: second']` in place of `['- loop: first']`, `planSection` stays `Plan text.` and `truncated` stays `{ lessons: 1, plan: false }`; its title names the removal from the start. The changed assertion fails on main. [R5] [dod arm 2]
  - 2. Same file, one new assertion - with the three matching lessons `- loop: first`, `- router: second` and `- loop: third` and a budget of 300, the pack holds `['- router: second', '- loop: third']` in that order and `truncated.lessons` is 1. It fails on main, which keeps the first two. [R5] [dod arm 2]
  - 3. Same file - the second half of the test at line 30 (a plan too long for a budget of 400 leaves no lesson and sets `truncated.plan`) and every other test of the file pass with no line changed. [R5] [dod arm 2]
  - 4. The context pack paragraph of `docs/OPERATIONS.md` states R6 in place of `whole lessons are removed from the end first` and keeps the sentence `Matching lesson lines keep file order` (reviewer-verified against the diff). [R6]
  - 5. `changelog.d/T1-PACK-KEEP-NEWEST.md` holds one line in the form of `changelog.d/README.md` (tests/surface/changelog-fragments.test.ts). [R5] [dod arm 2]
  - 6. `npm run typecheck` exits 0, and every other test of the DoD passes with no line of it changed. [R5] [dod arm 1] [dod arm 2]
depends_on: [T1-CARD-WRITER-LESSONS]
budget: 60
tdd: true
sweep: "Main at b9c0ee67. `git grep -n` for `lessons.pop`, `removed from the end`, `from the end first` and `lesson tail` over src, tests, docs, templates, .claude, README.md, bench and evals finds src/loop/context-pack.ts:77 (the removal), tests/core/context-pack.test.ts:30 (the test title) and docs/OPERATIONS.md:63 (the paragraph); docs/plans/PLAN-v5.1-hardening.md:463 is an archived record and stays. `truncated` is asserted only at tests/core/context-pack.test.ts:12, :36 and :39. tests/scenarios/context-pack.test.ts and tests/scenarios/run-driver.test.ts read a pack and assert no truncation order. Run on 2026-11-23 through `contextPack` with the fixture of the test file - the pack is 297 bytes with both lessons, 278 with the first only and 281 with the second only, so at 285 the second fits where the first did; with the three lessons of acceptance 2 it is 313 bytes with all and 297 with either two, so 300 holds two."
forbid:
  - a change to the fields of the context pack or to its byte budget
non_goals:
  - which lessons match a card, and the order of the lines a pack keeps, which stays file order
  - choosing lessons by score (issue 421), and the five lessons of the PREPARE directive
  - an edit to the merged card T1-RUN-CONTEXT-PACK-2, whose requirement R2 gave the old order
hygiene: "Line numbers are from main at b9c0ee67; read them again at PREPARE. The assertion at tests/core/context-pack.test.ts:30-36 follows requirement R2 of the merged card T1-RUN-CONTEXT-PACK-2 (`remove whole lessons from the end first`). The owner approved the change of that clause on 2026-11-23 (intent/lesson-delivery.md, Decisions), so the assertion changes with the requirement and no test is weakened or removed - the count of assertions in the file does not fall. Card T0-PR-SUMMARY, registered on 2026-11-23, allows docs/OPERATIONS.md; do not run beside it. Not verified before the card runs - whether an implementer acts on the lessons a pack carries; the measure of plans/lesson-delivery.md, Proof, counts only which lessons a pack keeps."
---

# T1-PACK-KEEP-NEWEST

## Deliverable
A context pack over its budget removes the earliest matching lesson line first and keeps the rest in file order. The context pack paragraph of `docs/OPERATIONS.md` says so.

## Why
Plan `plans/lesson-delivery.md`; the measurements are in `intent/lesson-delivery.md`, Problem. Over the 60 merged cards with the newest first decision, 20 packs are truncated, each of those 20 matches at least one of the 20 newest lessons, and 18 of the 20 keep none of them.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/context-pack.test.ts tests/scenarios/context-pack.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; the changed assertion of acceptance 1 and the new assertion of acceptance 2 fail on main and pass with the change.
