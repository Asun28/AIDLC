---
id: T0-PR-SUMMARY-ASK
title: "Every narration that asks for the acceptance table also asks the author for the PR summary section of the card file, directly before the table instruction"
status: merged
branch: T0-PR-SUMMARY-ASK
worktree: D:\wt\AIDLC\T0-PR-SUMMARY-ASK
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/pr-summary-ask.test.ts
  - tests/scenarios/dispute-running-attempt.test.ts
  - tests/scenarios/build-red-narration.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-PR-SUMMARY-ASK.md
  - specs/tasks/T0-PR-SUMMARY-ASK.md
dod_command: npm run typecheck && node --test tests/scenarios/pr-summary-ask.test.ts tests/scenarios/accept-table.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/build-red-narration.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The summary instruction is this text: `When allow_paths lists this card file, write a `## PR summary` section in it before the final DoD run, for a person who reads the pull request: the headings `### What`, `### Why / Intent`, `### How / Behaviour`, `### System impact`, `### Security`, `### Tests and review`, `### Risk`, `### Ownership` and `### Docs` in that order, one to three short sentences under each, in ASD-STE100 style (at most 20 words a sentence, active voice, one meaning for each word) and New Zealand spelling, at most 4000 characters and no `@`. The GitHub ship path makes it the text of the pull request it creates. Correct it on every repair.` Every narration that carries the acceptance table instruction of card T0-ACCEPT-TABLE shall carry the summary instruction once, directly before the table instruction, with one space between the two; on main at 7f093e1d these are the narration of the `build` directive before a RED receipt on the scaffold ship path, the one before a RED receipt on any other ship path, the one with a RED receipt, and the narration of a formal repair.
  - R2. Every other character of those four narrations, and every other directive, shall be what it is on main at 7f093e1d.
  - R3. `docs/OPERATIONS.md`, Findings and dispositions, shall state in one paragraph directly below the Acceptance table paragraph that every narration with the table instruction carries the summary instruction directly before it, with its text, that no parser, gate or schema field reads the style of the section, and that the GitHub ship path reads the section (Ship gates), while `changelog.d/T0-PR-SUMMARY-ASK.md` holds one entry.
acceptance:
  - 1. `tests/scenarios/pr-summary-ask.test.ts`, a new file, four tests. The narration of a build before RED off the scaffold ship path, of a build before RED on it, of a build with a RED receipt and of the build of an R3 repair each splits on the summary instruction into two parts, and on the summary instruction, one space and the table instruction into two parts. The four tests fail on main at 7f093e1d. [R1] [dod arm 2]
  - 2. `tests/scenarios/dispute-running-attempt.test.ts` and `tests/scenarios/build-red-narration.test.ts` each gain one constant with the summary instruction, and each of their narration templates names it, with one space, before the table constant; `git diff --numstat origin/main...HEAD` lists the first with 4 lines added and 3 deleted and the second with 3 added and 2 deleted. Their comparisons of whole narrations pass, which shows that nothing else of a narration changed. [R1] [R2] [dod arm 2]
  - 3. `tests/scenarios/accept-table.test.ts`, `tests/scenarios/dod-receipt-required.test.ts`, `tests/scenarios/t0-flow.test.ts` and `tests/scenarios/fault-points.test.ts` pass with no line changed, and the typecheck reports no error. [R2] [dod arm 1] [dod arm 2]
  - 4. `changelog.d/T0-PR-SUMMARY-ASK.md` holds one entry under this card id followed by one line feed (`tests/surface/changelog-fragments.test.ts`), and the paragraph of R3 is in `docs/OPERATIONS.md` (reviewer-verified against the diff). [R3] [dod arm 2]
depends_on: [T0-PR-SUMMARY]
budget: 140
tdd: true
sweep: "On main at 7f093e1d. `git grep -n ACCEPTANCE_TABLE -- src` finds the constant and its four uses in src/loop/card-runner.ts: the two narrations of `build` before a RED receipt (card T0-RED-PATH-TEXT gave the scaffold ship path its own), the one with a RED receipt, and the review-fix narration. Four test files hold the table text: tests/scenarios/accept-table.test.ts (a split count), tests/scenarios/dod-receipt-required.test.ts (`endsWith` the table text and a split count, both true with the summary instruction before the table), and the two files that compare whole narrations, tests/scenarios/dispute-running-attempt.test.ts (three templates) and tests/scenarios/build-red-narration.test.ts (two); tests/scenarios/t0-flow.test.ts matches a narration by a pattern. A trial of this change on main at 7f093e1d, in a worktree that was discarded: those files, the new test file and tests/scenarios/fault-points.test.ts pass (199 tests) once the five templates name the new constant, the 82 test files that read docs/OPERATIONS.md pass with the paragraph in the place R3 names (2027 tests, 0 fail), and `npm run bench -- --check` reports every count within its ceiling."
forbid:
  - a parser, gate, schema field or persisted record for the section
  - a change to a write of the card run or to the order of its writes
  - weakening or skipping a test to go green
non_goals:
  - a check of the style, the spelling or the sentence length of a summary
  - the instruction in an agent file, a skill file or CLAUDE.md
  - a configured `cardsDir` other than `specs/tasks`, which card T0-PR-SUMMARY leaves with the fixed line
  - the summary of a card whose allow_paths do not list its card file
hygiene: "Second card of the owner's request in session on 2026-11-23, after T0-PR-SUMMARY: every author is asked for the section, in the directive the author reads at BUILD, where card T0-ACCEPT-TABLE put the table instruction. RED: the new test file alone, four tests that fail on their assertions. src/loop/card-runner.ts is in the coverage record of the verify-card-run-writes skill: the change adds no write and reorders none, the fault-point check is in the DoD, and the outcome is `in sync`. The full suite runs once before the first review."
doc_sync: docs/OPERATIONS.md (Findings and dispositions), changelog.d/T0-PR-SUMMARY-ASK.md
---

# T0-PR-SUMMARY-ASK

From the owner's request in session, 2026-11-23. Follows T0-PR-SUMMARY.

## Deliverable
The `build` directive and the build directive of a formal repair ask the author
to write the `## PR summary` section of the card file, in plain short sentences
for a person. The GitHub ship path already makes that section the pull request
text (card T0-PR-SUMMARY); with this card every author is asked for it.

## Rules that decide edge cases
- The instruction is constant text. It does not depend on the card, its allow_paths or the ship path.
- In the three `build` narrations the table instruction stays last. In the repair narration the summary instruction stands where the table instruction stood, and the table instruction follows it.
- No code reads the section here. The ship reads it (card T0-PR-SUMMARY).

## PR summary
### What
The build instructions now ask each author to write a PR summary in the card file.

### Why / Intent
The ship can already use this section as the pull request text. But no instruction asked authors to write it. A person must be able to read a pull request in one minute.

### How / Behaviour
- The `build` directive carries one more instruction, directly before the acceptance table instruction.
- The instruction gives the nine headings and the style: short sentences, active voice, New Zealand spelling.
- The repair directive carries the same instruction.

### System impact
One text constant in `src/loop/card-runner.ts` changes four narrations. No state, no gate and no command changes. Each build directive is about 600 characters longer.

### Security
No new input and no new command. The instruction tells authors not to use the at sign, so GitHub sends no notification to an account.

### Tests and review
- Four new tests in `tests/scenarios/pr-summary-ask.test.ts` pass. The DoD passes with 224 tests.
- Eight single changes to the narrations: a test fails for each one.
- The full suite passes: 4095 tests, 0 failures.

### Risk
Low. The change is text only. If an author does not write the section, the pull request keeps the old one-line text.

### Ownership
Card `T0-PR-SUMMARY-ASK`, goal `g-20261123071418-eb255b`. The repository owner asked for the change.

### Docs
`docs/OPERATIONS.md` (Findings and dispositions) has a new paragraph. `changelog.d/T0-PR-SUMMARY-ASK.md` holds the entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/pr-summary-ask.test.ts tests/scenarios/accept-table.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/build-red-narration.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the four new tests pass, the narration tests and the fault-point check pass, the typecheck is clean and the changelog fragment is well formed.

## Attempt evidence
RED commit 00093007 holds the new test file alone. Its four tests fail there on assertions: no narration of main holds the summary instruction.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/pr-summary-ask.test.ts`, four tests named `acceptance 1`: a build before RED off the scaffold ship path, one on it (`NoRedScaffold`), one with a RED receipt, and the build of an R3 repair; each narration splits in two on the summary instruction, and in two on the instruction, one space and the table instruction. RED at 00093007 | pass after the change |
| 2 | `git diff --numstat origin/main...HEAD`: `4 3 tests/scenarios/dispute-running-attempt.test.ts`, `3 2 tests/scenarios/build-red-narration.test.ts`; each gains the constant and its templates (three and two) name it before the table constant; their `deepEqual` and `equal` comparisons of whole narrations pass | pass |
| 3 | DoD arm 1 exit 0; DoD arm 2, 224 tests, 224 pass, 0 fail, with `accept-table`, `dod-receipt-required`, `t0-flow` and `fault-points` among them; the numstat lists none of those four files | pass |
| 4 | `tests/surface/changelog-fragments.test.ts`; `docs/OPERATIONS.md`, Findings and dispositions, the paragraph that starts `PR summary instruction (card T0-PR-SUMMARY-ASK).`, directly below the Acceptance table paragraph | pass; the paragraph is for the reviewer |

Each requirement clause and the assertion that fails without it:

| Clause | Assertion |
|---|---|
| R1, every narration with the table instruction | item 1, one test for each of the four narrations |
| R1, once | item 1, the first split count |
| R1, directly before the table instruction, one space between | item 1, the second split count |
| R1, the text | item 1, the literal constant of the test file |
| R2, every other character of the four narrations | item 2, the whole-narration comparisons of the two test files |
| R2, every other directive | `git diff --numstat origin/main...HEAD` lists `7 4 src/loop/card-runner.ts`: the constant with its comment and a blank line, and the four narration lines |

Changes, each made alone in `src/loop/card-runner.ts`, run against the new test file, then restored. Eight changes, and a test fails for each:

| Change | Test that fails |
|---|---|
| the instruction removed before RED on the scaffold ship path | the scaffold test |
| the instruction removed before RED off it | the test before RED |
| the instruction removed with a RED receipt | the RED receipt test |
| the instruction removed from the repair narration | the repair test |
| the instruction after the table in the repair narration | the repair test |
| no space between the two with a RED receipt | the RED receipt test |
| the instruction twice before RED off the scaffold ship path | the test before RED |
| another word in the instruction text | all four |

Verify skill `verify-card-run-writes`: `git diff --name-only c7ab79a9 -- tests/scenarios/fault-points.test.ts src/loop/card-runner.ts src/state/goal-store.ts src/state/store.ts src/state/journal.ts` lists `src/loop/card-runner.ts`. This card changes text of four narrations there, adds no write and reorders none, and `tests/scenarios/fault-points.test.ts` passes (28 tests, in the DoD). Outcome: in sync.

Full suite, run once on the candidate source, tests, document and changelog fragment, before this section was written: `npm test` exit 0, 4095 tests, 4063 pass, 0 fail, 32 skipped. `npm run bench -- --check` on the same change in the trial: every count within its ceiling.

Size: 121 lines added and 9 deleted before this card file, against the budget of 140.
