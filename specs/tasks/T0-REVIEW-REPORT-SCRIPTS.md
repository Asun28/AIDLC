---
id: T0-REVIEW-REPORT-SCRIPTS
title: "REVIEW.md says what blocks a report script under `bench/`, the policy version moves to REVIEW.md@8, and the card template and the planner say what a card for such a script asks for"
status: todo
branch: T0-REVIEW-REPORT-SCRIPTS
worktree: D:\wt\AIDLC\T0-REVIEW-REPORT-SCRIPTS
allow_paths:
  - REVIEW.md
  - templates/REVIEW.md
  - aidlc.config.json
  - templates/aidlc.config.json
  - specs/tasks/_TEMPLATE.md
  - templates/cards/_TEMPLATE.md
  - .claude/agents/planner.md
  - templates/claude/agents/planner.md
  - docs/OPERATIONS.md
  - tests/surface/templates.test.ts
  - changelog.d/T0-REVIEW-REPORT-SCRIPTS.md
  - specs/tasks/T0-REVIEW-REPORT-SCRIPTS.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/edge-scope.test.ts tests/surface/budget-doc.test.ts tests/surface/card.test.ts tests/surface/config.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `REVIEW.md` and `templates/REVIEW.md` shall each hold the section of the Review text section, word for word, between the `## Do not report` section and the `## Untrusted content` heading, and the two files shall stay identical.
  - R2. `reviewPolicyVersion` shall be `REVIEW.md@8` in `aidlc.config.json` and in `templates/aidlc.config.json`.
  - R3. The policy version sentence of `docs/OPERATIONS.md` shall read `reviewPolicyVersion` is `REVIEW.md@8` in both configs, with the clause that card T0-REVIEW-REPORT-SCRIPTS added the report scripts section first, the clause that T1-REVIEW-SEVERITY moved it to `REVIEW.md@7` with the severity section second, and the four earlier moves as on main.
  - R4. `docs/OPERATIONS.md` shall hold one paragraph, directly after the Severity paragraph, that names the section and states each of its statements, that it applies only to scripts under `bench/` that read this repository's records and write reports no loop command consumes, that for Bugs findings it replaces the report-only exception of the Impact bar, that such a finding blocks for a named input a repository command produces or the card explicitly supports with the wrong published result or the incorrect refusal it yields, for a write outside the designated output paths, and for a broken explicit requirement or `forbid:` item, that saving a regenerable report does not by itself make it authoritative loop state, that more robustness for an unsupported input is a `[suggestion]`, and that Security findings and the must-block dimensions keep their rules.
  - R5. `specs/tasks/_TEMPLATE.md` and `templates/cards/_TEMPLATE.md` shall each hold the authoring line of the Card text section as a comment line directly after the comment line that begins `# A card that reads input or adds I/O`.
  - R6. `.claude/agents/planner.md` and `templates/claude/agents/planner.md` shall each hold the same authoring line as a bullet of `Rules:` directly before the bullet that begins `- Do not expand scope beyond the spec`, and the two files shall stay identical.
  - R7. `changelog.d/T0-REVIEW-REPORT-SCRIPTS.md` shall say that `REVIEW.md` gains the report scripts section, that the policy version is `REVIEW.md@8`, and that the card template and the planner gain the authoring line.
acceptance:
  - 1. `tests/surface/templates.test.ts`, one new test. Both `REVIEW.md` copies hold the six sentences of the section under its heading, the heading directly after the `## Do not report` section and directly before `## Untrusted content`; removing any one sentence, and moving the section above `## Cap the nits`, each fail the check; the two copies are equal. RED on main, where neither copy holds the heading. [R1] [dod arm 2]
  - 2. Same file, the version. The three assertions that read the version of both configs (lines 222, 627 and 739 on main) expect `REVIEW.md@8`. The five test titles that name `REVIEW.md@7` (lines 216, 613, 631, 730 and 802) name `REVIEW.md@8`, so the title check of T0-REVIEW-VERSION-TITLES passes; the title of line 216 also names T0-REVIEW-REPORT-SCRIPTS where it says `since T1-REVIEW-SEVERITY-3`. The four sentence checks (lines 635, 747, 758 and 810) read `REVIEW.md@8`, and `HISTORY` (lines 804 to 809) opens with `(card T0-REVIEW-REPORT-SCRIPTS added the report scripts section;` and ` T1-REVIEW-SEVERITY moved it to` followed by the version 7 in code quotes and ` with the severity section;`, then its four later clauses unchanged; removing either new clause fails that test as removing an old one does. No other assertion of the file changes. [R2] [R3] [dod arm 2]
  - 3. Same file, one new test. Both card templates hold the authoring line as the comment line after the input-forms line, both planner copies hold it as the bullet before `- Do not expand scope beyond the spec`, and removing it from any one of the four files fails the check. RED on main. [R5] [R6] [dod arm 2]
  - 4. `tests/surface/edge-scope.test.ts`, `tests/surface/budget-doc.test.ts`, `tests/surface/card.test.ts` and `tests/surface/config.test.ts` pass with no line changed. [R2] [R5] [dod arms 3, 4, 5, 6]
  - 5. Doc text (reviewer-verified against the diff). `docs/OPERATIONS.md` holds the paragraph of R4 after the Severity paragraph, and the fragment states R7 in the form of `changelog.d/README.md`. [R4] [R7] [dod arms 7, 8]
  - 6. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 140
tdd: true
sweep: "The whole suite, run against a clone of main at dc0bea82 with this card's text applied (the section before `## Untrusted content` in both `REVIEW.md` copies, `REVIEW.md@8` in both configs, the new opening of the version sentence in `docs/OPERATIONS.md`, the authoring line in both card templates and both planner copies; the clone is not tracked), gives 4,165 tests and 7 failures, every one in tests/surface/templates.test.ts: the tests titled at lines 216, 613, 631, 730, the second test of the T1-REVIEW-PRE-EXISTING block (its sentence check at lines 747 and 758), 802, and the title check of T0-REVIEW-VERSION-TITLES. The same clone with the section placed between `## Impact bar` and `## Cap the nits` fails one more test, the adjacency check of T0-REVIEW-IMPACT-BAR (`barHolds`, line 787 to 790), which is why the section stands below `## Do not report`. `git grep -n -F 'REVIEW.md@7' -- tests/surface/templates.test.ts` finds lines 216, 222, 613, 627, 631, 635, 730, 739, 747, 758, 802 and 810; in the other tracked files outside `specs/` it finds aidlc.config.json:13, templates/aidlc.config.json:13 and the sentence of docs/OPERATIONS.md (line 385). `git grep -n -F` for `Report scripts`, `input-producing` and `REVIEW.md@8` in the nine text files and the test file finds nothing on main. The line numbers are those of main at 9bdcf00b, where the test file is unchanged since the clone. The Severity paragraph is docs/OPERATIONS.md:497; the input-forms comment is line 19 of both card templates; the scope bullet is line 29 of both planner copies. No scenario, core or infra test fails in the clone."
forbid: [network, "a change to `VERDICT_SCHEMA`, to `tierPaths`, to `gateRequired` or to an allowance constant of `src/core/types.ts`"]
non_goals:
  - "the tier of a card, a smaller review allowance or an automatic deferral for `bench/` cards"
  - "dimension 6 and the other must-block dimensions, and Security findings: their rules stay"
  - "a registered card whose requirements ask for broad refusals: its amendment is the owner's"
  - "a reviewer bench run in the DoD: the bench calls models, and a comparison before and after is the owner's option"
  - "a path other than `bench/` (scripts elsewhere keep the Impact bar as it is)"
hygiene: "From `intent/anthropic-practices-study.md`, P0 of the two-party result of 2026-11-24. Card runs since 2026-11-10 whose card names a `bench/` code path pass their first formal decision 5 of 19 times against 50 of 75 for other `src/` paths, and hold 13 of the 16 findings the owner ruled. The text of every formal and pre-review prompt changes, since both carry `REVIEW.md`. RED first: the two new tests and the changed version assertions and titles, committed before the text. Both `REVIEW.md` copies, both planner copies and both configs change in one commit each pair, so no test sees one copy ahead of the other. Other open cards allow `docs/OPERATIONS.md` and `tests/surface/templates.test.ts`: run this card beside none of them and read every line number again at PREPARE. Before this card merges, finish or recover every formal review reservation of the other runs: a request keeps its own key across the version move, but a decision recovered afterwards is recorded with the configured version and not the reservation's (`src/loop/card-runner.ts:2837` on main at 9bdcf00b), so a version 7 review recovered after the merge would be recorded as version 8 beside its old policy hash. Checked against the newest lessons of docs/LESSONS.md on 2026-11-24: every test that pins a changed sentence is named (T0-RED-PATH-TEXT), each document gets the whole rule (T0-PR-SUMMARY-REUSED), no substring an acceptance item asks of new text is on main already (`Report scripts`, `REVIEW.md@8` and `input-producing` have no match in the four text files on main; T1-CARD-WRITER-LESSONS), the forbid holds hard boundaries only (T1-CARD-WRITER-LESSONS), and the two lessons of 2026-11-24 do not apply (the new tests read tracked files in process and this card introduces no environment-dependent behaviour, T0-INIT-CLI-PATH; no code here reads `review.invocations`, T0-ADVISORY-WITHDRAW)."
doc_sync: docs/OPERATIONS.md, changelog.d/T0-REVIEW-REPORT-SCRIPTS.md
---

# T0-REVIEW-REPORT-SCRIPTS

From `intent/anthropic-practices-study.md` (P0).

## Why
Scripts under `bench/` read this repository's records and write reports that a person or a test reads; `package.json` does not ship them and no command of the loop reads their output. They are reviewed at the bar of loop code. Since 2026-11-10, card runs whose card names a `bench/` code path pass their first formal decision 5 of 19 times, a third of them stopped for review at some point, and 13 of the 16 findings the owner ruled are theirs, each deferred. A hand reading of 31 of the 92 findings on those files found about a quarter that name a wrong result on an input the repository produces, and about a quarter that name an input no command writes and no requirement names. The Impact bar of 2026-11-07 makes a defect that "can change only a report" a suggestion, and a reviewer reads a saved report as a persisted record, so the exception does not apply where it was meant to.

## Deliverable
One section in both `REVIEW.md` copies, the policy version at 8, and one authoring line in both card templates and both planner copies.

## Review text
The section, placed between `## Do not report` and `## Untrusted content`:

```
## Report scripts
Applies only to scripts under `bench/` that read this repository's records and write reports no loop command consumes. For Bugs findings, this section replaces the report-only exception of the Impact bar. Block for a named input produced by a repository command or explicitly supported by the card that yields a wrong published result or an incorrect refusal; a write outside designated output paths; or violation of an explicit card requirement or `forbid:` item. A regenerable report is not authoritative loop state merely because it is saved. Additional robustness for unsupported inputs is a `[suggestion]`. Security findings and must-block dimensions retain their existing rules.
```

## Card text
The authoring line. In the card templates it is a comment line (two spaces, `#`, one space, then the text); in the planner copies it is a bullet (`- `, then the text):

`A card for a report script under bench/ names its input-producing commands, any other input it explicitly supports, and the results it publishes; a required refusal covers a failure one of those commands can produce or an explicit owner requirement, and more input validation is a non-goal.`

with `bench/` in code quotes.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/edge-scope.test.ts tests/surface/budget-doc.test.ts tests/surface/card.test.ts tests/surface/config.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: both policy copies hold the section in its place, both configs and the documentation name version 8 with its history, the four authoring files hold the line, and the template, card, config, changelog and prose checks pass.
