---
id: T0-BENCH-FOLLOWUPS
title: "Bench follow-ups of issues 319, 381 and 391: labels.ts drops a stale Codex message and logs the events behind a Codex label, panel.ts pairs stage 2 with the confirmed cases and refuses rounds the bench cannot write, and the --formal-command text stands in the Reviewer bench section"
status: todo
branch: T0-BENCH-FOLLOWUPS
worktree: D:\wt\AIDLC\T0-BENCH-FOLLOWUPS
allow_paths:
  - bench/outcome/labels.ts
  - bench/outcome/panel.ts
  - tests/surface/outcome-labels.test.ts
  - tests/surface/outcome-panel.test.ts
  - tests/surface/review-bench.test.ts
  - docs/OPERATIONS.md
  - docs/reliability/panel.md
  - changelog.d/T1-BENCH-FORMAL-COMMAND.md
  - changelog.d/T0-BENCH-FOLLOWUPS.md
  - specs/tasks/T0-BENCH-FOLLOWUPS.md
dod_command: npm run typecheck && node --test tests/surface/outcome-labels.test.ts tests/surface/outcome-panel.test.ts tests/surface/outcome-adjudicate.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-formal-command.test.ts tests/surface/test-temp.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `codexAnswer` shall take the label from the last `item.completed` event whose item is an `agent_message`, and give no label when that event's text is missing, not a string or empty.
  - R2. The log line of a Codex call shall hold `events`, the parsed `agent_message` completions and `turn.completed` events of its stdout in order, for a call of any exit code, and an empty list for a call that threw.
  - R3. The labelling run shall take its tables, its command runner, its git, its output directory and its stderr through arguments, and `main` shall pass the ones it uses today.
  - R4. `panel.ts` shall pair each stage 2 report with the confirmed cases of its case directory, and stage 1 reports with every case of theirs as before.
  - R5. `panel.ts` shall refuse a multi-round report holding a case whose `rounds` the bench cannot write, by the four rules of the Round rules section.
  - R6. The `--formal-command` paragraph of `docs/OPERATIONS.md` shall be a paragraph of `### Reviewer bench`, directly after the `--order` paragraph, and the separate section of that paragraph shall be gone.
  - R7. `docs/reliability/panel.md` shall state R4 and R5 in its refusal paragraph, and `changelog.d/T1-BENCH-FORMAL-COMMAND.md` and `changelog.d/T0-BENCH-FOLLOWUPS.md` shall each hold their entry in the form of `changelog.d/README.md`.
acceptance:
  - 1. `tests/surface/outcome-labels.test.ts`. A final `agent_message` with a missing, null, numeric or empty text after one that names a label gives a null label and an empty text; a later labelled message still gives its label. RED on main for the first three. [R1] [dod arm 2]
  - 2. Same file. `events` of `codexAnswer` holds exactly the message and usage events in order, with other events and unparsable lines left out, and `codexAnswer` run again on those events gives the same label and cost. [R2] [dod arm 2]
  - 3. Same file, through the exported run with scripted commands. A Codex cost above the bound, an unreadable Codex cost and a Codex call that throws each give exit 3 after the lines of that finding's calls are in `raw.jsonl`, with no call for the next finding, no `labels.jsonl` and no `disagreements.jsonl`, and the checkout removed. A cost of exactly the bound goes on, asks both findings and writes both files. The Codex lines hold `events`, the Claude lines do not. [R2] [R3] [dod arm 2]
  - 4. Same file, the selection and log rules of issue 319 F1 to F5. For each second-pass join predicate (`goalId`, `cardId`, `stage`, `secondPass`, `outcome`, `decision`, `candidateSha`) a decision that differs in it alone leaves the finding outside the second-pass group; a finding and a decision that both lack the round, or both lack the candidate, do not join; a merged replacement target is outside the clean group when fewer than 15 cards qualify; a card's findings of three goals given in reverse come in goal order; a finding key given twice is selected once, also across groups, where the first group keeps it; a pair with exactly one labelled log line is not asked. Each passes on main, and each fails with its rule removed (table of mutations in the card body). [dod arm 2]
  - 5. Same file. The two assertions on an unreadable Codex usage stand in the test that reads the Codex cost, unchanged, and no longer in the test on reading inside the checkout. [dod arm 2]
  - 6. `tests/surface/outcome-panel.test.ts`. With an unconfirmed case file in each stage 2 directory, reports of the confirmed cases assemble and a report that also holds the unconfirmed case is refused; a stage 1 report without an unconfirmed case of its directory is refused. RED on main for the first. [R4] [dod arm 2]
  - 7. Same file. Each rule of the Round rules section refuses a report that breaks it alone, naming the file, the case and the rule, and writes nothing; a three-round case, an error case with error rounds and a no-verdict case with its one round assemble. RED on main for the refusals. The fixture `withRounds` writes what the bench writes in place of two uncited rounds; every other assertion of the file stays. [R5] [dod arm 2]
  - 8. `tests/surface/review-bench.test.ts`. `OPERATIONS_SECTION` gains the paragraph and the acceptance 9 test passes; RED on main. Every other line of the file stays. [R6] [dod arm 2]
  - 9. Doc text (reviewer-verified against the diff). The moved paragraph says `this section` where it named the section below, and keeps every other word; R7 holds. `tests/surface/changelog-fragments.test.ts` passes. [R6] [R7] [dod arm 2]
depends_on: []
budget: 320
tdd: true
sweep: "On main at 34e29932. `grep -rn agent_message` over src, bench and tests finds one reader of the event, labels.ts:116. labels.ts is imported by bench/outcome/adjudicate.ts (claudeAnswer, promptFor, readInside and readLog, none changed) and its test. No document and no test names the heading of OPERATIONS.md line 585. The four round rules hold for all 79 cases of `_local/arms/rounds-miss.json` and `_local/arms/rounds-clean.json`, the saved multi-round reports. evals/review/clean holds one unconfirmed case of 41 and evals/review/replay none of 124."
forbid:
  - network
  - a model or reviewer command in the DoD
  - weakening or skipping a test to go green
non_goals:
  - "a new labelling run, a new panel run or a change to `labels.jsonl`, `panel.json` or any number in docs/reliability"
  - "a check of a round that its counts cannot show: round 1 changed from miss to hit in a case whose round 1 cites another reason is accepted, since a round holds a count and no reasons"
  - "a check of round durations against the case's duration: no stage 1 measure reads a duration"
  - "the raw stdout of a Codex call in the log: the events hold what the label and the cost are read from, and the run reads the whole log again before each finding"
  - "a bound on a Codex call's cost inside the call"
hygiene: "The owner selected issues 319, 381 and 391 in session on 2026-11-24, for one card. Issue 391 asks for the hit rule alone; R5 states every rule the bench's round loop gives, because docs/LESSONS.md (T1-PANEL-ARMS-REPORT) says to validate a saved report the way src/review/bench.ts scores it in the first candidate and not one field per review. RED first, committed before the source change. Temporary directories go through `tmpDir`. T0-BENCH-INPUTS allows review-bench.test.ts and docs/OPERATIONS.md too: not beside this card. T0-BOUNDS-OWNER-ACTS changes another part of docs/OPERATIONS.md."
doc_sync: docs/OPERATIONS.md, docs/reliability/panel.md, changelog.d/T1-BENCH-FORMAL-COMMAND.md, changelog.d/T0-BENCH-FOLLOWUPS.md
---

# T0-BENCH-FOLLOWUPS

Issues 319, 381 and 391.

## Why
Three merged bench cards left follow-ups the owner deferred. Issues 319 and 391 are to be fixed before `bench/outcome/labels.ts` and the panel's stage 2 run again; issue 381 is two gaps in documents.

## Round rules
From `src/review/bench.ts`, the round loop of a formal review and `score`. A round after the first runs only when the round before cites a new P0 or P1 reason, a count is above 0 only on a block, and an unscored round ends the loop. So, for a case with `rounds`:
1. Every round before the last cites at least one reason.
2. A round is `error` exactly when the case is; a `no-verdict` round is the case's only round, cites nothing, and the case is `no-verdict`.
3. The first `hit` round cites at least one reason, and a `pass` round cites none.
4. In a case that is not an `error`, `cited` is empty exactly when the rounds cite nothing in all, and holds no more reasons than they cite.

## Deliverable
The fixes of the three issues, with their tests and documents. No score, label or report number changes.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-labels.test.ts tests/surface/outcome-panel.test.ts tests/surface/outcome-adjudicate.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-formal-command.test.ts tests/surface/test-temp.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the rules of R1 to R6 hold with their tests, and the fragments and the prose check pass.

## PR summary

### What
The labelling script reads a Codex label from the last message only, and logs the events behind it. The panel script pairs stage 2 with confirmed cases and refuses impossible rounds. One document paragraph moves to its section.

### Why / Intent
Issues 319, 381 and 391 hold follow-ups that the owner deferred. Issues 319 and 391 must be fixed before those scripts run again.

### How / Behaviour
A last Codex message without text gives no label, so the call can be asked again. A report of the confirmed cases is accepted in stage 2. A multi-round report that breaks one of four round rules is refused, and nothing is written.

### System impact
No file under `src/` changes. The labelling run is now an exported function that takes its commands and paths as arguments. `panel.json`, computed again from the saved inputs, is identical.

### Security
The change adds no input, secret or network access. The log keeps model messages and usage in a directory that git ignores.

### Tests and review
Five tests failed before the source changed. A table of 49 mutations has no survivor. The R3 review gate checks the change.

### Risk
Low. The round rules hold for the 79 cases of the two saved multi-round reports. A rule that is too strict refuses a report and changes no number.

### Ownership
The aidlc maintainers own the bench scripts and their documents.

### Docs
`docs/OPERATIONS.md` keeps every other word of the moved paragraph. `docs/reliability/panel.md` states the new refusals. Two changelog fragments are added, one for T1-BENCH-FORMAL-COMMAND.

## Attempt evidence
RED commit 6556b03655b346959d21ec2dc63b4d149fa83f00 holds the tests of items 1, 2 and 4 to 8 on the sources of main: 45 tests, 5 failed (items 1, 2, 6, 7 and 8), each on its assertion. Item 4 passes on main, as the card says. The run test of item 3 came with the exported run it calls, and the mutations below show it fails.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/surface/outcome-labels.test.ts` "acceptance 1": a missing, null, numeric or empty last text gives null and an empty text; a later label is kept | pass, RED before |
| 2 | Same file, "acceptance 2": the five message and usage events in order, the other events and lines left out, the same label and cost when read again | pass, RED before |
| 3 | Same file, "acceptance 3": five stops with exit 3 (above the bound, above it with exit 1, no usage event, an unreadable usage, a throw), and a run at the bound | pass |
| 4 | Same file, the two "acceptance 4" tests and the labelled line in "the log decides what is asked again and what was spent" | pass, mutations below |
| 5 | Same file: the two assertions stand in "an answer gives a label only when its last line is one of the five" | pass |
| 6 | `tests/surface/outcome-panel.test.ts` "acceptance 6" | pass, RED before |
| 7 | Same file, "acceptance 7": 14 refusals and 6 accepted reports | pass, RED before |
| 8 | `tests/surface/review-bench.test.ts`, T1-REVIEW-BENCH acceptance 9 with the paragraph in `OPERATIONS_SECTION` | pass, RED before |
| 9 | Document diff (reviewer-verified); `tests/surface/changelog-fragments.test.ts` | pass |

`node bench/outcome/panel.ts assemble` on the saved stage 1 inputs, at the commit `panel.json` names, writes a file identical to the committed `panel.json`.

Mutations, each applied alone, its test file run and the file restored. All 49 fail a test.

| File | Mutations | Failing test |
|---|---|---|
| labels.ts, `selectFindings` | each of the seven join predicates removed; the round guard and the candidate guard removed | "acceptance 4: a finding is second-pass only" |
| labels.ts, `selectFindings` | replacement target kept; goal order removed; dedupe removed | "acceptance 4: a merged replacement target" |
| labels.ts, `readLog` | label ignored when a pair has one line | "the log decides what is asked again" |
| labels.ts, `codexAnswer` | an earlier text kept for a last message without a text, and for an empty one | "acceptance 1" |
| labels.ts, `codexAnswer` | events without usage, without messages, with every object; `item.started` read; any item type read | "acceptance 2" |
| labels.ts, `runLabels` | events not logged, not logged for a throw; unreadable cost goes on; bound inclusive; stop removed; exit 0; checkout kept | "acceptance 3" |
| panel.ts, stage 2 | filter removed, for replay only, for clean only; filter applied in stage 1 | "acceptance 6" |
| panel.ts, rule 1 | removed; first round only; every round | "acceptance 7" |
| panel.ts, rule 2 | removed; error only; no-verdict only; the round's outcome only; the case's outcome only; every difference | "acceptance 7" |
| panel.ts, rule 3 | hit part removed; every hit round; pass part removed | "acceptance 7" |
| panel.ts, rule 4 | each half removed; at least; equal; error case not exempt; all rules not run | "acceptance 7" |
