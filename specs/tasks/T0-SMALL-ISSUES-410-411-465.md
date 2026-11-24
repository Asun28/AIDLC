---
id: T0-SMALL-ISSUES-410-411-465
title: "Three small fixes in one card: a lift earlier than the goal's current stop re-admits nothing (issue 410), a ci rerun of card continue refuses --decisions (issue 411), and parseIntent reads a wrapped open question as one (issue 465)"
status: todo
branch: T0-SMALL-ISSUES-410-411-465
worktree: D:\wt\AIDLC\T0-SMALL-ISSUES-410-411-465
allow_paths:
  - src/loop/controller.ts
  - src/core/continuation.ts
  - src/artifacts/intent.ts
  - tests/scenarios/card-continue-goal.test.ts
  - tests/scenarios/card-continue-ci.test.ts
  - tests/scenarios/review-rule-goal.test.ts
  - tests/surface/intent.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-SMALL-ISSUES-410-411-465.md
  - specs/tasks/T0-SMALL-ISSUES-410-411-465.md
dod_command: npm run typecheck && node --test tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/scenarios/card-continue-command.test.ts tests/scenarios/card-amend-continue.test.ts tests/scenarios/review-rule-goal.test.ts tests/surface/intent.test.ts tests/scenarios/t1-plan.test.ts tests/scenarios/narration-quote.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `GoalController.continueCard` shall take its rerun path only when, beside the conditions on main, the last continuation's `at` is not earlier than the `at` of the goal's stop, and otherwise call the runner, which refuses a run that is not in STOP.
  - R2. `GoalController.ruleFinding` shall take its rerun path only when, beside the conditions on main, the `stopLifted.at` of the last lifted decision is not earlier than the `at` of the goal's stop, and otherwise call the runner, which refuses a run that is not stopped for review.
  - R3. On the rerun path for a goal stopped for `ci`, `continueCard` shall refuse a given `decisions` with the message of `continueCiStop` before any write.
  - R4. `parseIntent` shall give one open question per list item or paragraph of the section, where a list marker is `-`, `*`, `+` or digits with `.` or `)`, followed by white space or the line's end, at any indent, and a line with no marker that directly follows a line with text is joined to its item with one space.
  - R5. `parseIntent` shall drop an item that is `(none)`, or that begins `(none:` or `(none;`, ends with `)` and holds no other parenthesis, and no other item.
  - R6. `docs/OPERATIONS.md` (the Rulings paragraph on a goal stopped for review, the Rerun bullet of Continuations, the `grilling` row) and the `continueCard` item of `docs/ARCHITECTURE.md` shall state R1 to R5 where they describe that behaviour, and the fragment shall record the three changes.
acceptance:
  - 1. `card-continue-goal.test.ts`. Card A is continued, shipped and closed, `aidlc next` stops the goal again for card B, and continuing A throws with the goal, journal and card-run files byte-identical; a lift 1 ms before the goal's stop is refused the same way, and one at the same instant completes the re-admission, a given `decisions` included (a review rerun). [R1] [dod arm 2]
  - 2. `review-rule-goal.test.ts`. The same three rows for a ruling made again. [R2] [dod arm 2]
  - 3. `card-continue-ci.test.ts`. `aidlc card continue --decisions 1` after a ci lift whose re-admission is not done exits 1 with the message and no byte changed; without the option it completes the re-admission with no second continuation. [R3] [dod arm 2]
  - 4. `intent.test.ts`. Rows for a wrapped item (indented, unindented, CRLF), each marker, a nested item, a wrapped line that begins `--flag`, an empty item, a paragraph after a blank line and wrapped paragraphs; each parsed list survives render and parse. [R4] [dod arm 2]
  - 5. Same file. `(none)`, `(none; text)` and a wrapped `(none: text)` give no question; `(none of ...)`, `(none: x) ...`, `(none: x) ... (y)`, `(nonessential)` and `none` each give one. [R5] [dod arm 2]
  - 6. Every existing assertion of the DoD files passes unchanged, the typecheck is clean, and the documents and the fragment hold R6 (reviewer-verified against the diff). [R6] [dod arm 1]
depends_on: []
budget: 200
tdd: true
diagnosis:
  root_cause: "The two rerun paths compare the stop reason only, so an act on an earlier stop of the same reason matches (410); the rerun calls no runner, so the runner's ci check of `decisions` is skipped (411); the questions are split by line (465)."
  same_class: "`readmitAfterLift` has these two callers only; `continueReviewStop` accepts `decisions`, so a review rerun keeps taking the option; `openQuestions` has one parser."
sweep: "On main at f48806e5: `git grep -n 'stopLifted\\|continuations.at(-1)' -- src/loop/controller.ts` finds the two rerun paths; `git grep -n openQuestions -- src` finds intent.ts, the PLAN narration, `intent new` and incident.ts. No test reads the document sentences of R6. The five new tests fail on f48806e5's sources and pass on a prototype, with every existing test of the four files passing on it."
forbid: [network]
non_goals:
  - "a lift and a goal stop in the same millisecond: read as the act of that stop, as on main"
  - "a clock moved back between the stop and the lift: the rerun is refused, and `aidlc goal resume` re-admits the goal"
  - "issue 411 point 2, fixed by T1-CONTINUE-CI"
  - "Markdown nesting, code fences and several paragraphs in one list item: each further paragraph or nested item stays a question of its own"
hygiene: "The owner selected issues 410, 411 and 465 for one card and one pull request in the session of 2026-11-24. RED first, the five tests committed before the source change. Edit each document sentence in place: T0-BOUNDS-OWNER-ACTS asks to run beside no other card that allows docs/OPERATIONS.md, so start this card after it merges or stops, and read the document lines again at PREPARE. The goal's stop and both lifts take their time from the controller's and runner's injected clock, the journal's `ts` does not, so R1 and R2 compare with `goal.stop.at`."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, changelog.d/T0-SMALL-ISSUES-410-411-465.md
---

# T0-SMALL-ISSUES-410-411-465

## Deliverable
The three issues in one pull request, which closes 410, 411 and 465.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/scenarios/card-continue-command.test.ts tests/scenarios/card-amend-continue.test.ts tests/scenarios/review-rule-goal.test.ts tests/surface/intent.test.ts tests/scenarios/t1-plan.test.ts tests/scenarios/narration-quote.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the rows of acceptance 1 to 5 and every existing test of those files pass.

## PR summary

### What
This change fixes issues 410, 411 and 465 in one pull request.

### Why / Intent
An old lift of a stop could re-admit a goal that another card stopped. A repeated ci continuation ignored a wrong option. A wrapped open question counted as more than one question.

### How / Behaviour
A repeated lift now needs a time that is not earlier than the stop of the goal. A repeated ci continuation refuses the decisions option. The intent parser joins a wrapped line to its question.

### System impact
The change affects the goal controller, the continuation engine and the intent parser. No stored record changes its form.

### Security
The change adds no input, no permission and no network call.

### Tests and review
Five new tests fail on the old code and pass on the new code. The formal review gate reviews the final commit.

### Risk
A lift and a goal stop in the same millisecond count as one event, as before. A clock that moves back makes the repeated lift fail. The operator then resumes the goal.

### Ownership
The repository owner owns this change.

### Docs
The operations and architecture documents state the new rules. The change adds one changelog entry.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | `card-continue-goal.test.ts`, test "acceptance 1" of this card | RED at 14a98207, passes |
| 2 | `review-rule-goal.test.ts`, test "acceptance 2" of this card | RED at 14a98207, passes |
| 3 | `card-continue-ci.test.ts`, test "acceptance 3" of this card | RED at 14a98207, passes |
| 4 | `intent.test.ts`, test "acceptance 4" of this card | RED at 14a98207, passes |
| 5 | `intent.test.ts`, test "acceptance 5" of this card | RED at 14a98207, passes |
| 6 | the DoD command; the diff of the two documents and the fragment | exit 0; reviewer-verified |

Each rule removed alone fails at least one test: the time check of each method, the comparison at equality, the refusal of `decisions` and its limit to `ci`, the blank line that ends an item, each marker form, and the two limits of the `(none` form.
