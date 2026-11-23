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

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/pr-summary.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, the two ship test files pass unchanged, the typecheck is clean and the changelog fragment is well formed.
