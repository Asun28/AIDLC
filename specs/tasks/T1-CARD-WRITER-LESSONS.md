---
id: T1-CARD-WRITER-LESSONS
title: The plan and project-cards directives carry the count and the ten most recent lessons of docs/LESSONS.md, and the card templates and the planner agent say a card is checked against them before it is registered
status: todo
branch: T1-CARD-WRITER-LESSONS
worktree: D:\wt\AIDLC\T1-CARD-WRITER-LESSONS
plan_ref: plans/lesson-delivery.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/loop/directive.ts
  - src/loop/controller.ts
  - tests/scenarios/card-writer-lessons.test.ts
  - specs/tasks/_TEMPLATE.md
  - templates/cards/_TEMPLATE.md
  - .claude/agents/planner.md
  - templates/claude/agents/planner.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CARD-WRITER-LESSONS.md
  - specs/tasks/T1-CARD-WRITER-LESSONS.md
dod_command: npm run typecheck && node --test tests/scenarios/card-writer-lessons.test.ts tests/scenarios/t1-plan.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/narration-quote.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/card.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. The `plan` directive and the `project-cards` directive shall each carry a `lessons` field that holds the path of `docs/LESSONS.md`, the count of its valid lesson lines and its ten most recent lesson lines in file order.
  - R2. The narration of the `plan` directive and of the `project-cards` directive shall name the lesson count and `docs/LESSONS.md` and say that every card is checked against the lessons of the `lessons` field before it is registered.
  - R3. The two card templates and the two planner agent copies shall say that the directive that asks for cards carries the most recent lessons of `docs/LESSONS.md` and that a card is checked against them before it is registered.
  - R4. The Lessons paragraph of `docs/OPERATIONS.md` and the directive table of `docs/ARCHITECTURE.md` shall say that the `plan` and `project-cards` directives carry the count and the ten most recent lesson lines.
acceptance:
  - 1. tests/scenarios/card-writer-lessons.test.ts (new), with a `docs/LESSONS.md` under the fixture root that holds 12 valid lesson lines, the `- (none yet)` placeholder and one line that is not a lesson - the `plan` directive that `controller.next` returns for a T0 goal with no card has `lessons.count` 12, `lessons.recent` deep-equal to the last 10 valid lines in file order and `lessons.file` equal to the path of that file. It fails on main, where the directive has no `lessons` field. [R1] [dod arm 2]
  - 2. Same file, same lessons file - a `lessons` field deep-equal to that of item 1 is on the `plan` directive of a T1 goal and on the `project-cards` directive of each place that builds one - a T0 goal created for an existing card, a T1 goal after `plan-produced`, and a T1 goal in RUN after a `revision` that names a registered card. [R1] [dod arm 2]
  - 3. Same file - with no `docs/LESSONS.md` under the fixture root, the `plan` directive and a `project-cards` directive each carry `lessons.count` 0 and an empty `lessons.recent`, and `controller.next` does not throw. [R1] [dod arm 2]
  - 4. Same file - the narration of each of the five directives of items 1 and 2 holds `12 lessons so far`, `docs/LESSONS.md` and the word `registered`, and still holds the text it has on main, in that order `no planning funnel`, `no full forge`, `validate the card`, `No cards registered` and `Plan accepted`; with no lessons file it holds `0 lessons so far`. No line of a lesson is in a narration. The test does not pin the whole new sentence. [R2] [dod arm 2]
  - 5. The narration `Projection invalid` is built by the same call as `No cards registered` (src/loop/controller.ts:329), so the test of that call covers its `lessons` field; that its narration gains the same sentence is reviewer-verified against the diff. [R1] [R2]
  - 6. Both card templates gain one comment line under `acceptance:` and both planner copies gain one line under their inputs, each stating R3; the two planner copies stay byte-identical and the two templates differ only on their `worktree` line (reviewer-verified against the diff; tests/surface/mirror.test.ts, tests/surface/templates.test.ts and tests/surface/card.test.ts pass with no line of them changed). [R3] [dod arm 2]
  - 7. The Lessons paragraph of `docs/OPERATIONS.md` states R4 after its PREPARE clause and before the clause `CLOSE appends at most one dated`, and the rows of `plan` and `project-cards` in the directive table of `docs/ARCHITECTURE.md` name `lessons` (reviewer-verified against the diff; tests/scenarios/lesson-dup.test.ts passes with no line changed). [R4] [dod arm 2]
  - 8. `changelog.d/T1-CARD-WRITER-LESSONS.md` holds one line in the form of `changelog.d/README.md` (tests/surface/changelog-fragments.test.ts). [R1] [R2] [dod arm 2]
  - 9. `npm run typecheck` exits 0, and every other test of the DoD passes with no line of it changed. [R1] [dod arm 1] [dod arm 2]
depends_on: []
budget: 130
tdd: true
sweep: "Main at b9c0ee67. Four places build these directives - src/loop/controller.ts:304, :312 and :318 in `nextInPlan` and :329 in `nextInCards`, which holds two narrations. Each example of acceptance 1, 2 and 4 was run through the scenario fixture on 2026-11-23 - a T0 goal with no card gives `plan` (`no planning funnel`), a T1 goal gives `plan` (`no full forge`), a T0 goal for an existing card gives `project-cards` (:304), a T1 goal after `plan-produced` gives `project-cards` from :329 (`No cards registered`), and a T1 goal in RUN after a `revision` naming a registered card gives `project-cards` from :312 (`Plan accepted`). `git grep -n` for the narration texts over src, tests, docs, templates, .claude, README.md, bench and evals finds only those four places and src/hooks/index.ts:788, a hook line with other words that this card leaves alone; no test and no document quotes them. No test compares a `plan` or `project-cards` directive whole or its narration for equality (grep for `deepEqual(` on a directive and for `equal(<x>.narration,`); tests/scenarios/t1-plan.test.ts and tests/scenarios/narration-quote.test.ts match parts of the PLAN narration and tests/scenarios/t0-flow.test.ts:46 reads the kind. The directive table is docs/ARCHITECTURE.md:159-160 and no test holds `planRef, cardsDir, outputs`. `git grep -n LESSONS -- .claude/agents .claude/skills specs/tasks/_TEMPLATE.md templates/cards` finds only .claude/skills/aidlc-loop/card-loop.md:109, about writing a lesson. `readLessons(file, recent)` (src/artifacts/lessons.ts:134) takes the count as its second argument - a file of 12 lessons, the placeholder and a line that is not a lesson gives count 12 and the last 10 in file order, and an absent file gives count 0 and no lines. src/cli/main.ts:25 and :27 import the controller and the card runner, and the card runner already imports src/artifacts/lessons.ts, so the new import adds no module to the CLI start. These directives are printed by `aidlc next` (src/cli/main.ts:520), `aidlc goal new` (:385) and `aidlc report` - whole as JSON, the default when stdout is not a terminal, and as the narration in the human line. Only the Sessions section of docs/OPERATIONS.md has a byte cap (tests/surface/prose.test.ts:357); the Lessons paragraph (docs/OPERATIONS.md:739) is under Companion skills."
forbid:
  - a change to `readLessons`, to the lesson line format or to the `lessons` field of the PREPARE directive
  - a change to a review prompt or to `REVIEW.md`
non_goals:
  - the human line of `aidlc next`, `aidlc goal new` and `aidlc report` - it prints the narration, which names the count and the file, and does not list the lesson lines, as for PREPARE; `--json` prints them
  - an audience mark, a keyword selector or a new lesson kind - the ten most recent lines are sent whatever they are about
  - a `docs/LESSONS.md` that exists and cannot be read - `readLessons` throws and the command fails, as at PREPARE
  - a test that reaches the `Projection invalid` narration (acceptance 5)
  - the context pack (card T1-PACK-KEEP-NEWEST) and the skill files under `.claude/skills/aidlc-loop/`, which are at their byte caps
  - measuring the effect (plans/lesson-delivery.md, Proof)
hygiene: "Line numbers are from main at b9c0ee67; read them again at PREPARE. The requirements are on the directive that `GoalController.next` returns, not on a command's output. Before the first review write the table that splits R1 to R4 into their clauses and names the assertion that fails without each (docs/LESSONS.md, 2026-11-22 T1-AMEND-COMMAND), and run `npm run build` and `npm run bench -- --check` (2026-11-22 T1-CONTINUE-REVIEW-2). The `lessons` field is optional in the schema and always set by the controller, so a directive built without it still parses. Lesson text is repository data - it goes in the `lessons` field and never into a narration (card T0-NARRATION-QUOTE quotes repository text in a narration). Cards T0-PR-SUMMARY and T0-RED-PATH-TEXT of other sessions were open on 2026-11-23 when the owner said to run this plan, and allow docs/OPERATIONS.md, the first also docs/ARCHITECTURE.md; with main at c44e06fc their branches change docs/OPERATIONS.md at lines 100 and 692 and docs/ARCHITECTURE.md at line 220, not the Lessons paragraph or the directive table, so a merge of main joins the changes. Not verified before the card runs - that no test outside the DoD reads the two rows of the directive table; CI runs the whole suite."
---

# T1-CARD-WRITER-LESSONS

## Deliverable
The two directives that ask for cards, `plan` and `project-cards`, carry the count and the ten most recent lines of `docs/LESSONS.md` in a `lessons` field, and their narration says to check every card against them before it is registered. Both card templates and both planner copies name the file.

## Why
Plan `plans/lesson-delivery.md`; the measurements are in `intent/lesson-delivery.md`, Problem. Of the 30 newest rules 17 are for whoever writes a card, and no step that writes a card reads the file. Of the newest 60 card runs 32 were blocked at the first formal decision on a dimension that compares the candidate with the card's text.

## At close
The lesson step of this card writes, through `aidlc card close --lesson`, the line that supersedes the lesson of 2026-11-18 for T0-STORE-LIST-ENOENT-2 (`docs/LESSONS.md:194`, an allowlist of import lines in `forbid`) and names its conflict with the hard-boundaries-only guidance of card T1-CARD-FORBID-BOUNDARY. A rule that this card's own review teaches is joined to the same line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-writer-lessons.test.ts tests/scenarios/t1-plan.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/narration-quote.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/card.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; the assertions of acceptance 1 to 4 fail on main and pass with the change.

## Attempt evidence

Attempt 1. RED commit 65cf6c92 (the new test alone, 4 of 4 fail on `lessons` absent: `the plan directive has a lessons field`, deepEqual against `undefined`, and the narration without `12 lessons so far`). GREEN commit 45b48eac.

### Acceptance items

| Item | Proof | Result |
|---|---|---|
| 1 | card-writer-lessons.test.ts, test `the plan directive of a T0 goal with no card carries the lessons file, its count and the ten most recent lines` | fails at 65cf6c92, passes at GREEN |
| 2 | same file, test `each of the five plan and project-cards directives carries the same lessons field` (deepEqual per directive, kind asserted per directive) | fails at 65cf6c92, passes at GREEN |
| 3 | same file, test `with no lessons file the plan and project-cards directives carry count 0 and no lines, and say 0 lessons so far` (`doesNotThrow` on both `next` calls) | fails at 65cf6c92, passes at GREEN |
| 4 | same file, test `each of the five narrations names the count, the file and registration, keeps its text from main and quotes no lesson`; the `0 lessons so far` clause in the item 3 test | fails at 65cf6c92, passes at GREEN |
| 5 | reviewer-verified: src/loop/controller.ts:341-342, one `Directive.parse` whose narration is `(problems.length ? 'Projection invalid: ...' : 'No cards registered ...') + checkLessons` and whose `lessons` is set for both branches | diff |
| 6 | reviewer-verified: specs/tasks/_TEMPLATE.md:20 and templates/cards/_TEMPLATE.md:20 (one comment line under `acceptance:`), .claude/agents/planner.md:11 and templates/claude/agents/planner.md:11 (one line after the inputs); `cmp` of the planner copies is silent and `diff` of the templates shows only line 10 (`worktree`); mirror, templates and card surface tests pass unchanged | diff + DoD |
| 7 | reviewer-verified: docs/OPERATIONS.md:739 (new clause after `(card T1-PREPARE-LESSONS-REF);`, before `CLOSE appends at most one dated`), docs/ARCHITECTURE.md:159-160 (`lessons` in both payload columns); lesson-dup.test.ts passes unchanged | diff + DoD |
| 8 | changelog.d/T1-CARD-WRITER-LESSONS.md, one line; tests/surface/changelog-fragments.test.ts | DoD |
| 9 | `npm run typecheck` and the other nine DoD files, no line of them changed (`git diff main...HEAD --stat -- tests` lists only the new file) | DoD |

### Requirement clauses

| Clause | Assertion that fails without it |
|---|---|
| R1 `plan` directive carries `lessons` | item 1 test `assert.ok(lessons)`; item 2 test, names `T0 goal with no card`, `T1 goal` |
| R1 `project-cards` directive carries `lessons` (each of the three places) | item 2 test, names `T0 goal for an existing card` (:316), `T1 goal after plan-produced` (:342), `T1 goal in RUN after a revision naming a registered card` (:324) |
| R1 `file` is the path of docs/LESSONS.md | `assert.equal(lessons.file, file)` (item 1); `file` in the item 2 and item 3 deepEquals |
| R1 count of valid lesson lines (placeholder and a non-lesson line not counted) | `assert.equal(lessons.count, 12)`; count 0 in the item 3 deepEquals |
| R1 ten most recent lines, file order | `deepEqual(lessons.recent, VALID.slice(-10))`; `VALID.slice(2)` in item 2 |
| R2 narration names the count | `includes('12 lessons so far')` per directive; `includes('0 lessons so far')` with no file |
| R2 narration names docs/LESSONS.md | `includes('docs/LESSONS.md')` per directive |
| R2 says every card is checked before it is registered | `includes('registered')` per directive, and `registered` after `12 lessons so far` per directive (the `No cards registered` text of main already holds the word) |
| R2 narration keeps its text from main | `includes(onMain)` per directive |
| R1 (design) the field is optional in the schema; count is a whole non-negative number | test 5: `Directive.parse` of a `plan` and a `project-cards` directive without `lessons` does not throw; count -1 and 1.5 throw |
| R2 (design) no lesson text in a narration | no valid line and no rule text is a substring; no `rule number` |
| R3 templates and planner copies | reviewer-verified, item 6 lines |
| R4 OPERATIONS Lessons paragraph and ARCHITECTURE table | reviewer-verified, item 7 lines; lesson-dup.test.ts:105-106 pins the paragraph end |

### Guard sweep

Each mutant applied to the GREEN source, the test run, the source restored (script outside the worktree; `git status` clean after each run).

| Guard added | Loosened form | Test that failed |
|---|---|---|
| `readLessons(..., 10)` | default (5) | tests 1, 2 |
| `lessonsPath(this.repo.mainRoot)` | another root | tests 1, 2, 3, 4 |
| count in the sentence | fixed `12` | test 4 |
| `lessons` on the plan directive (:330) | dropped | tests 1, 2, 4 |
| `lessons` at :316 (T0 existing card) | dropped | tests 2, 4 |
| `lessons` at :324 (Plan accepted) | dropped | test 2 |
| `lessons` at :342 (nextInCards) | dropped | test 2 |
| `checkLessons` at :330, :316, :324, :342 | dropped, one at a time | test 3 each (and test 4 for :330, :316) |
| `before it is registered` in the sentence | `first` | test 3 |
| schema `lessons` on `plan` / `project-cards` | removed (zod strips the key) | tests 1, 2, 4 / tests 2, 4 |
| schema `.optional()` | required | test 5 |
| schema count `.int().nonnegative()` | `z.number()` | test 5 |
| `Projection invalid` branch of :342 gains the sentence | not reached by a test (non_goal, acceptance 5) | reviewer-verified: the sentence is appended outside the parenthesised ternary |
