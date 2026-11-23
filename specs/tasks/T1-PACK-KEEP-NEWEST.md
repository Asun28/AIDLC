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
hygiene: "Line numbers are from main at b9c0ee67; read them again at PREPARE. The assertion at tests/core/context-pack.test.ts:30-36 follows requirement R2 of the merged card T1-RUN-CONTEXT-PACK-2 (`remove whole lessons from the end first`). The owner approved the change of that clause on 2026-11-23 (intent/lesson-delivery.md, Decisions), so the assertion changes with the requirement and no test is weakened or removed - the count of assertions in the file does not fall. Cards T0-PR-SUMMARY and T0-RED-PATH-TEXT of other sessions were open on 2026-11-23 when the owner said to run this plan, and allow docs/OPERATIONS.md; with main at c44e06fc their branches change it at lines 100 and 692, not the context pack paragraph at line 63, so a merge of main joins the changes. Not verified before the card runs - whether an implementer acts on the lessons a pack carries; the measure of plans/lesson-delivery.md, Proof, counts only which lessons a pack keeps."
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

## Attempt evidence

Attempt 1. RED commit 61d8b2d8 (test change alone): `node --test tests/core/context-pack.test.ts` gave 3 pass, 2 fail; test 4 failed with actual `'- loop: first'`, expected `'- router: second'`; test 5 failed with actual `['- loop: first', '- router: second']`, expected `['- router: second', '- loop: third']`. Both fail on the assertion because main keeps the first lessons.

Byte sizes measured through `contextPack` with the fixture of the test file: both lessons 297, first only 278, second only 281; three lessons 313, `router: second` + `loop: third` 297, `loop: first` + `router: second` 297, `loop: first` + `loop: third` 294 (the card's sweep says 297 for either two; every pair is still at most 300, so the budgets 285 and 300 stand).

### Acceptance

| Item | Proof | Result |
|---|---|---|
| 1 | tests/core/context-pack.test.ts, `budget removes lessons from the start before plan text and preserves complete acceptance`: `pack.lessons` is `['- router: second']` at 285; `planSection` and `truncated` lines unchanged | fails at RED, passes |
| 2 | same file, `budget removes the earliest matching lesson first and keeps the newest in file order`: `['- router: second', '- loop: third']`, `truncated.lessons` 1, bytes at most 300 | fails at RED, passes |
| 3 | same file, lines 35 to 45 of the first test and tests 1 to 3: no line changed (`git diff main -- tests/core/context-pack.test.ts`) | pass |
| 4 | docs/OPERATIONS.md:63, sentence `whole lessons are removed from the start first, the oldest matching line before a newer one (card T1-PACK-KEEP-NEWEST)`; `Matching lesson lines keep file order` kept | reviewer-verified |
| 5 | changelog.d/T1-PACK-KEEP-NEWEST.md, tests/surface/changelog-fragments.test.ts | pass |
| 6 | `npm run typecheck` exit 0; DoD 42 tests pass, 0 fail | pass |

### Requirement clauses

| Clause | Assertion that fails without it |
|---|---|
| R5 removal from the start when over budget | test 4 `pack.lessons` deepEqual `['- router: second']`; test 5 `pack.lessons` deepEqual (guard A) |
| R5 the remaining lines keep file order | test 5 `pack.lessons` deepEqual `['- router: second', '- loop: third']` (guard B) |
| R5 `truncated.lessons` counts each removed line | test 4 `truncated` deepEqual `{ lessons: 1, plan: false }`; test 5 `truncated.lessons` equal 1 (guard C) |
| R6 the doc sentence | none automated; reviewer-verified at docs/OPERATIONS.md:63 |

### Guard sweep

The change adds no new guard; it replaces the removal end in src/loop/context-pack.ts:77 (`pop()` to `shift()`). Loosened forms, each run on tests/core/context-pack.test.ts, then restored (5 pass after restore):

| Loosened form | Failing test |
|---|---|
| A: back to `pack.lessons.pop()` | tests 4 and 5 |
| B: `shift()` then `pack.lessons.reverse()` | test 5 |
| C: `shift()` without `truncated.lessons++` | tests 4 and 5 |

Stale-text grep `git grep -n -i -E "lesson tail|from the end|lessons\.pop|end first" -- src tests docs templates .claude README.md bench evals`: docs/plans/PLAN-v5.1-hardening.md:463 (archived) and tests/scenarios/fault-points.test.ts:109 (`from the end the card names for the command`, the end state of a run, not lesson order). The comments of src/loop/context-pack.ts name no removal order.
