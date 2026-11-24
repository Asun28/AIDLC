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
