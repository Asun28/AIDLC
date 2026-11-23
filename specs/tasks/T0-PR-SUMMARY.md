---
id: T0-PR-SUMMARY
title: "The GitHub ship path writes the pull request text from the PR summary section of the card file, and keeps the fixed line where the card has none"
status: todo
branch: T0-PR-SUMMARY
worktree: D:\wt\AIDLC\T0-PR-SUMMARY
allow_paths:
  - src/delivery/github-ship.ts
  - tests/infra/pr-summary.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-PR-SUMMARY.md
  - specs/tasks/T0-PR-SUMMARY.md
dod_command: npm run typecheck && node --test tests/infra/pr-summary.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. A line reads a text when it equals that text once its trailing white space is removed. The summary of a card text is the lines after the first line that reads `## PR summary`, up to the next line that starts with `# ` or `## ` or to the end of the text, joined with `\n` and trimmed, with every `\r\n` of the text read as `\n`. WHEN no reason of R2 applies, `prBody(cardText, cardId, reviewed)`, exported from `src/delivery/github-ship.ts`, shall return `{ body }` alone, where `body` is the summary, then `\n\n---\n`, then `Card: specs/tasks/<cardId>.md. Formal review: pass.` for `reviewed` true and `Card: specs/tasks/<cardId>.md. Formal review: no pass recorded for this commit.` for `reviewed` false.
  - R2. `prBody` shall return `{ body, reason }`, with `body` the fixed line `Closed loop: worktree + TDD + independent review. DoD in specs/tasks/<cardId>.md.` and `reason` the first of these that applies, in this order: `no card file`, the text is undefined; `no PR summary section`, no line reads `## PR summary`; `the headings are not the nine in order`, the lines of the summary that start with `### ` do not read `### What`, `### Why / Intent`, `### How / Behaviour`, `### System impact`, `### Security`, `### Tests and review`, `### Risk`, `### Ownership` and `### Docs`, each once, in that order; `no text under a heading`, one of those lines has no line with a character other than white space before the next of them or the end of the summary; `over 4000 characters`, the `length` of the summary string is above 4000; `the character @`, the summary holds `@`; `a NUL character`, the summary holds the character U+0000.
  - R3. WHEN a remote ship is about to run `gh pr create`, `GitHubShipPath.ship` shall read `specs/tasks/<cardId>.md` under the worktree of the card as UTF-8, a file it cannot read being an undefined text, and pass the `body` of `prBody` as the `--body` value, with `reviewed` true only where the verdict the ship read is a `pass` whose `sha` is absent or is the head and whose `run_status` is absent or `success`.
  - R4. WHEN that `gh pr create` returns the pull request number, the ship shall write one line on its output directly before the line that reports the number: `PR body: the PR summary of the card` where `prBody` returned no reason, and `PR body: the fixed line (<reason>)` where it returned one.
  - R5. For every ship, the outcome, the sentinels, the subprocess calls, their order, their other arguments and the pull request title shall be what they are on main at 4e6f3efb, and a ship that reuses an open pull request, whose `gh pr create` fails or that ends before that call writes no line that starts with `PR body:`.
  - R6. `docs/OPERATIONS.md`, Ship gates (GitHub ship path), shall state in one paragraph directly above the `aidlc review resolve` paragraph the form of the summary (its heading line, the nine headings, the two limits), the fixed line with the seven reasons, the last line the ship adds, the `PR body:` output line and that a pull request that already exists keeps its text, while `docs/ARCHITECTURE.md` names the source of the pull request text in its `GitHubShipPath` item and `changelog.d/T0-PR-SUMMARY.md` holds one entry.
acceptance:
  - 1. `tests/infra/pr-summary.test.ts`, a new file, test of the valid summary. For a card text whose summary is followed by a `## Attempt evidence` section, for one whose summary ends the text, and for the first with every line ending `\r\n`, `prBody(text, 'T1-A', true)` deep-equals `{ body }` with the literal body of R1 that ends `Card: specs/tasks/T1-A.md. Formal review: pass.`, and with `reviewed` false the body ends `Formal review: no pass recorded for this commit.`. Text between the `## PR summary` line and `### What` is part of the body. A summary of exactly 4000 characters returns no reason. T1-A is the fixture card. [R1] [dod arm 2]
  - 2. Same file, test of the reasons. Each of these deep-equals `{ body, reason }` with the fixed line for `T1-A` and the reason named: an undefined text, `no card file`; a text with no line that reads `## PR summary`, and one whose only such line is indented, `no PR summary section`; a summary without `### Risk`, one with `### Risk` and `### Security` exchanged, one with `### What` twice and one with a tenth line `### Notes`, `the headings are not the nine in order`; a summary whose `### Security` has only blank lines under it and one whose `### Docs` ends the summary, `no text under a heading`; a summary of 4001 characters, `over 4000 characters`; a summary that holds `@`, `the character @`; a summary that holds a NUL character, `a NUL character`. A summary with exchanged headings that also holds `@` gives the headings reason, one of 4001 characters that also holds `@` gives the length reason, and one that holds `@` and a NUL character gives the `@` reason. [R2] [dod arm 2]
  - 3. Same file, the ship with a summary. In a fixture whose worktree holds `specs/tasks/T1-A.md` with a valid summary and a pass verdict for the head, a remote ship ends `merged`; `gh pr create` runs once and its arguments deep-equal `pr`, `create`, `--repo`, `o/r`, `--base`, `main`, `--head`, `T1-A`, `--title`, `feat: [T1-A]`, `--body` and the body `prBody` returns for that text with `reviewed` true; the output holds `PR body: the PR summary of the card` once, directly before the line that reports number 42. [R3] [R4] [R5] [dod arm 2]
  - 4. Same file, the ship without a summary. With no card file in the worktree the `--body` value is the fixed line and the output holds `PR body: the fixed line (no card file)` once, directly before the line that reports the number; with a card file whose summary holds `@` the value is the fixed line and the line reads `PR body: the fixed line (the character @)`. Both ships end `merged`. [R3] [R4] [dod arm 2]
  - 5. Same file, `reviewed`. With `requireVerdict` false and a valid summary, the `--body` value ends `Formal review: no pass recorded for this commit.` for each of: no verdict file, a pass verdict whose `sha` is not the head, a pass verdict for the head with `run_status` `tool_error`, a block verdict whose `sha` is not the head. With the default `requireVerdict` and a pass verdict that carries no `sha`, it ends `Formal review: pass.`. [R3] [dod arm 2]
  - 6. Same file, no line without a created pull request. A ship whose listing holds one `OPEN` pull request ends `merged` with number 8 and runs no `gh pr create`; a ship whose `gh pr create` exits 1 ends `pr-failed`; a ship with no verdict file ends `review-no-verdict`. No output line of the three starts with `PR body:`. [R5] [dod arm 2]
  - 7. `tests/infra/github-ship.test.ts` and `tests/infra/github-ship-merge-refused.test.ts` pass, `git diff --numstat origin/main -- tests` lists `tests/infra/pr-summary.test.ts` alone, and the typecheck reports no error. [R5] [dod arm 1] [dod arm 2]
  - 8. `changelog.d/T0-PR-SUMMARY.md` holds one entry under this card id followed by one line feed (`tests/surface/changelog-fragments.test.ts`), and the two documents hold what R6 assigns to them (reviewer-verified against the diff). [R6] [dod arm 2]
depends_on: []
budget: 230
tdd: true
sweep: "On main at 4e6f3efb. `git grep -n pr.,.'create' -- src` finds one call, src/delivery/github-ship.ts:359, the only place aidlc writes a pull request text; the scaffold path opens its pull request in the project's own task.ps1. `git grep -l 'gh pr create' -- tests` finds five files (tests/infra/github-ship.test.ts, tests/infra/github-ship-merge-refused.test.ts, tests/scenarios/journal-owed.test.ts, tests/scenarios/ship-effect-unknown.test.ts, tests/scenarios/t0-flow.test.ts); each scripts the call by a key prefix and none reads the `--body` value. Six test files construct `GitHubShipPath`, and `git grep -l 'PR summary' -- tests` finds none, so every existing ship keeps the fixed line. No test compares the whole ship output: the reads of `receipt.stdout` in the two ship test files are `match`, `includes` and counts of filtered lines. `git grep -c 'Closed loop: worktree'` finds the source line and the todo card T1-SHIP-PUBLISH, which keeps its `--body ...`."
forbid:
  - a new subprocess call or a new source module
  - a change to an existing test file
  - weakening or skipping a test to go green
non_goals:
  - the instruction that asks an author for the section, which a later card adds to the build directive
  - a configured `cardsDir` other than `specs/tasks`, which gets the fixed line with `no card file`, as the commit message and the fixed line of the path name `specs/tasks` today
  - the text of a pull request that already exists, which the ship leaves as it is
  - the pull request title, the scaffold ship path and the dry-run ship path
  - a check of the style, the spelling or the sentence length of the summary
  - Markdown structure inside the summary, where a line that starts with `# ` or `## ` ends it even inside a code fence, and the front matter, whose lines are read like every other line of the file
hygiene: "The owner's request in session on 2026-11-23: pull request text a person can read, short, in New Zealand spelling and ASD-STE100 style, with the parts What, Why / Intent, How / Behaviour, System impact, Security, Tests and review, Risk, Ownership and Docs. Card text copied by a program cannot be that, so an author writes the summary and the ship carries it. RED fails on assertions: the RED commit exports a `prBody` that always returns the fixed line with `no card file` (tdd skill, seam). No new module, so the cli.start ceiling of the loop benchmark is not touched. The `@` rule keeps GitHub from notifying an account the text names. The full suite runs once before the first review, because four scenario files construct the ship path and many test files read the two documents. Before the first review each guard of `prBody` and of `reviewed` is loosened in turn and a test of items 1 to 6 fails."
doc_sync: docs/OPERATIONS.md (Ship gates), docs/ARCHITECTURE.md (the GitHubShipPath item), changelog.d/T0-PR-SUMMARY.md
---

# T0-PR-SUMMARY

From the owner's request in session, 2026-11-23.

## Deliverable
`GitHubShipPath` writes the text of a new pull request from the `## PR summary`
section of the card file in the worktree. A card with no valid section gets the
fixed line the path writes today, and the ship output says which text was used
and why.

## Rules that decide edge cases
- The card file is read whole, front matter included. Only the first line that reads `## PR summary` starts a summary.
- The nine headings are compared with their exact text. A line `#### x` or `###x` is text, not a heading.
- Text before `### What` is part of the summary.
- The 4000 limit is on the summary alone, before the last line is added.
- The reasons are checked in the order of R2, and the first that applies is the one reported.
- A verdict the ship could not read or parse is no pass.

## PR summary
### What
The GitHub ship path now takes the pull request text from the card file. It reads the PR summary section.

### Why / Intent
The old text was one fixed line. A person could not see what a change does, or why.

### How / Behaviour
- The author writes nine short parts in the card file, from What to Docs.
- The ship copies the section into the new pull request. It adds one line with the card path and the review result.
- If the section is missing or not valid, the ship uses the old fixed line. The ship output gives the reason.

### System impact
Only `src/delivery/github-ship.ts` changes. The ship runs no new command. A pull request that exists keeps its text.

### Security
The ship refuses a section that contains an at sign, so GitHub sends no notification to an account. The text goes to `gh` as one argument and not through a shell. The ship also refuses a NUL character, because no command can receive it.

### Tests and review
- Six new tests in `tests/infra/pr-summary.test.ts` pass. The DoD passes with 112 tests.
- 44 single changes to the new code: a test fails for 43 of them. One change is equivalent.
- The full suite ran once. Two document tests failed, the paragraph moved, and the related test files now pass.
- R3 blocked one time: an empty commit id counted as a pass. The check is now exact.

### Risk
Low. A card with no section gets the same text as before. A repository with a different card directory also gets the old text.

### Ownership
Card `T0-PR-SUMMARY`, goal `g-20261123004949-8953c6`. The repository owner asked for the change.

### Docs
`docs/OPERATIONS.md` (Ship gates) and `docs/ARCHITECTURE.md` describe the new text. `changelog.d/T0-PR-SUMMARY.md` holds the entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/pr-summary.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, the two ship test files pass unchanged, the typecheck is clean and the changelog fragment is well formed.

## Attempt evidence
RED commit 4c65744c holds the tests and a `prBody` seam that returns the fixed line with `no card file` for every text. Five of the six tests fail there on assertions (acceptance 1 to 5). The test of acceptance 6 passes before and after: it states what R5 keeps. Four cases came after RED, each for a guard of the sweep: a text with no final line feed, lines that start with four hashes or with three and no space, a summary without the Docs heading, and one with no heading.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/pr-summary.test.ts`, `acceptance 1`: seven texts, each `deepEqual` to the literal body for `reviewed` true and false; text before `### What`; a heading with trailing white space; `#### Detail` and `###x` as text; 4000 characters | pass |
| 2 | Same file, `acceptance 2`: 21 texts, each `deepEqual` to the fixed line and its reason, an empty text and a NUL character among them; four hold more than one fault and give the first reason of R2 | pass |
| 3 | Same file, `acceptance 3`: `merged`; the arguments of the one `gh pr create` equal the literal list with the body; `PR body: the PR summary of the card` once, directly before the number line | pass |
| 4 | Same file, `acceptance 4`: no card file, a summary that holds `@`, and one that holds a NUL character: the fixed line as `--body`, the reason line directly before the number line, `merged` | pass |
| 5 | Same file, `acceptance 5`: seven verdict states with `requireVerdict` false end `no pass recorded for this commit.`, an empty `sha` and an empty `run_status` among them; a pass with an empty `sha` under the default `requireVerdict` reaches the create call and ends the same; a pass with no `sha` and a pass with `run_status` `success` end `pass.` | pass |
| 6 | Same file, `acceptance 6`: a reused pull request (`merged`, number 8, no create), a create that exits 1 and one that prints no address (`pr-failed`), one that times out (`effect-unknown`), no verdict file (`review-no-verdict`); no `PR body:` line in any | pass |
| 7 | DoD arm 1 exit 0; DoD arm 2, 112 tests, 112 pass, 0 fail; `git diff --numstat origin/main...HEAD -- tests` lists `tests/infra/pr-summary.test.ts` alone | pass |
| 8 | `tests/surface/changelog-fragments.test.ts`; `docs/OPERATIONS.md`, Ship gates, the paragraph that starts `Pull request text (card T0-PR-SUMMARY).`, directly above the `aidlc review resolve` paragraph; `docs/ARCHITECTURE.md`, the last sentence of the `GitHubShipPath` item | pass; the two documents are for the reviewer |

Each requirement clause and the assertion that fails without it:

| Clause | Assertion |
|---|---|
| R1, a line reads a text once its trailing white space is removed | item 1, `the heading line has trailing white space` and `a heading with trailing white space is that heading` |
| R1, the first such line | item 1, `a second summary follows the first` |
| R1, up to a line that starts with `# ` or `## ` | item 1, `a section follows` and `a level-1 heading follows` |
| R1, or to the end of the text | item 1, `the summary ends the text`, with and with no final line feed |
| R1, joined, trimmed, `\r\n` read as `\n` | item 1, the literal body of every text, and the `\r\n` text |
| R1, `{ body }` alone and the two last lines | item 1, `deepEqual` with `reviewed` true and false |
| R2, each reason with the fixed line | item 2, one text or more per reason |
| R2, the order | item 2, the three texts with more than one fault |
| R3, the file under the worktree, and a file that cannot be read | items 3 and 4 |
| R3, the `--body` value | items 3, 4 and 5, the whole argument list |
| R3, `reviewed` | item 5 |
| R4, one line directly before the number line, for each text | items 3 and 4, `bodyLines` |
| R5, the ship as on main, and no line without a created pull request | item 3 (the whole argument list), items 6 and 7 |

Guards, each loosened alone in `src/delivery/github-ship.ts`, run against the new test file, then restored. 44 changes: a test fails for 43, and one is equivalent.

| Guard | Loosened to | Items that fail |
|---|---|---|
| `cardText === undefined` | removed; `!cardText` | 2, 4; 2 |
| `\r\n` read as `\n` | not replaced | 1 |
| `l.trimEnd() === '## PR summary'` | `l ===`; `l.trim() ===`; `l.startsWith(` | 1; 2; 2 |
| `findIndex` of that line | `findLastIndex` | 1 |
| the return on `start < 0` | removed | 2 |
| `/^##? /` | `/^## /`; `/^#+ /`; `/##? /` | 1; 1 to 5; 1 to 5 |
| `end < 0 ? after : after.slice(0, end)` | always sliced | 1 |
| `.trim()` of the summary | removed | 1, 3, 5 |
| `l.startsWith('### ')` | `l.startsWith('###')` | 1 |
| the count of the headings | removed | 2 |
| the comparison of the headings | removed; no `trimEnd`; any case | 2; 1; 2 |
| `every((l) => l.trim() === '')` | `l === ''`; check removed; read to the end of the summary | 2; 2; 2 |
| `summary.length > PR_SUMMARY_MAX` | `>=`; one higher; removed | 1; 2; 2 |
| `summary.includes('@')` | removed | 2, 4 |
| `summary.includes('\0')` | removed | 2, 4 |
| the order of the reasons | the `@` rule before the limit; the limit before the text rule; the `@` rule before the headings rule; the NUL rule before the `@` rule | 2; 2; 2; 2 |
| `reviewed ? 'pass' : ...` | words exchanged | 1, 3, 5 |
| ship, `sha === undefined` or the head | conjunct removed; `sha === head` alone; `!sha` (the form R3 decision 1 blocked) | 5; 5; 5 |
| ship, `run_status` absent or `success` | conjunct removed; `=== 'success'` alone | 5; 3, 5 |
| ship, the card path under the worktree | under the main checkout | 3, 4, 5 |
| ship, a read failure gives no text | thrown again | 4 |
| ship, the output line | removed; the two texts exchanged; one more written before the create call; one more written after the exit code check and before the number check | 3, 4; 3, 4; 3, 4, 6; 3, 4, 6 |
| ship, `'--body', text.body` | a constant | 3, 4, 5 |

equivalent: `v.verdict?.verdict === 'pass'` loosened to `v.verdict !== undefined`. A block verdict reaches `gh pr create` only with a `sha` that is not the head, because a block with no `sha` or with the head's ends the ship before; the `sha` conjunct already makes `reviewed` false for it. No input tells the two forms apart.

Full suite, run once because the DoD names none of the test files that read the two documents: `npm test` in the worktree, exit 1, 4068 tests, 4034 pass, 2 fail, 32 skipped. The two failures were `tests/scenarios/review-release.test.ts:790` and `tests/scenarios/review-resolve.test.ts:995`, which pin the last two paragraphs of Ship gates. The owner amended R6 (revision 1) and the paragraph moved above the `aidlc review resolve` paragraph. After the move, the repair below and the merge of main at c44e06fc, the 87 test files that read `docs/OPERATIONS.md` or `docs/ARCHITECTURE.md` or construct `GitHubShipPath` pass: 2051 tests, 2038 pass, 0 fail, 13 skipped.

Repair after R3 decision 1, F1 (class empty-sha-as-absent): `reviewed` read a pass verdict whose `sha` is the empty string as a pass with no `sha`. It now compares `sha` with `undefined`. The `sha` values the hunk can be given, each with its test in item 5: absent (`pass.`), the head (`pass.`, also item 3), the empty string (no pass, with `requireVerdict` false and with the default), another commit (no pass). A `sha` that is not a string never reaches the hunk: `parseVerdictDocument` drops it, so it is absent. Other sites of the class in the new code, each with a case added to its test: an empty card text is a text and gives `no PR summary section` (item 2); an empty `run_status` is read as `malformed` by `parseVerdictDocument` and is no pass (item 5). Two sites of the class are left as on main, because R5 keeps every outcome of the ship: the block check and the stale check of the verdict gates (`!v.verdict.sha`, `v.verdict?.sha &&`), which take an empty `sha` as none. The OPERATIONS paragraph said that `github.requireVerdict` on never lets a verdict that is no pass reach the create call; an empty `sha` does, so the paragraph now states the condition of the line itself.

Amendments, each on the owner's instruction in the session and recorded with `aidlc card amend`: revision 1, R6 places the paragraph above the `aidlc review resolve` paragraph; revision 2, R2, R6 and acceptance 2 gain the seventh reason `a NUL character`. `runSync` throws for an argument that holds U+0000 (`The argument 'args[2]' must be a string without null bytes`), so without the rule a summary with one made the ship throw at `gh pr create`, after the push.

Size: the candidate adds 200 test lines, 43 source lines and 4 document and changelog lines before this card file, 247 against the budget of 230; 19 of the test lines and 3 of the source lines came with the repair and the second amendment.
