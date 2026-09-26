---
id: T0-CI-RED-LOGS-BOUNDS
title: The failed-step excerpt of a red Actions job closes the four boundary corners T0-CI-RED-LOGS-2 was merged with under a human ruling (an earlier composite step's run headers, a later step's exit line, absent record times, no end time with an exit line), failing closed without losing the common case
status: todo
branch: T0-CI-RED-LOGS-BOUNDS
worktree: D:\wt\AIDLC\T0-CI-RED-LOGS-BOUNDS
allow_paths:
  - src/delivery/github-ship.ts
  - src/probes/gh.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/gh.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CI-RED-LOGS-BOUNDS.md
dod_command: npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/gh.test.ts
dod_exit: 0
requirements:
  - R1. WHEN another step started or completed in the failed step's first second and could have printed the `run` headers counted there (an earlier composite action prints one per sub-step), the ship path shall not place the start unless the failed step's own header is proven by evidence no other step's output can supply, and shall write `step unknown` otherwise.
  - R2. WHEN the failed step printed no exit line of its own and any later step (a post-action included, with or without a `##[group]Run ` header) started in the failed step's end second, the ship path shall not place the end and shall write `step unknown`; no line of a later step, its exit line included, shall reach the excerpt.
  - R3. The job record probe shall treat a step whose `started_at` or `completed_at` key is absent as malformed (`log unavailable`), a record whose failed step has no end time shall leave the end unplaced (`step unknown`) whether or not an exit line follows the start, and a placed step with no non-empty line shall write `step unknown` rather than a bare `[CI-GATE-LOG]` line.
  - R4. The ship path shall keep placing the common case: a `run` step that fails with its runner exit line, its first second shared with the end of the previous step and its end second with the post steps that follow, in the shape of this repository's CI jobs (job 108335174101 of this repository).
  - R5. `docs/OPERATIONS.md` (Ship gates) and `CHANGELOG.md` shall state the changed rules and the limit that remains.
acceptance:
  - 1. tests/infra/github-ship.test.ts - an earlier composite step that started (or completed) in the failed step's first second and printed two `run` headers there, the failed step printing none, gives `step unknown`, and the earlier step's assertion output never reaches the excerpt; through the card runner a transient failed step in that shape is not classified as a code defect. [R1] [dod arm 1]
  - 2. tests/infra/github-ship.test.ts - a failed step without an exit line followed in its end second by a post-action (no `##[group]Run ` header) that prints an assertion and an exit line gives `step unknown`; through the card runner a transient failed step in that shape is not a counted repair. [R2] [dod arm 1]
  - 3. tests/infra/gh.test.ts and tests/infra/github-ship.test.ts - a record step without a `completed_at` (or `started_at`) key gives `log unavailable` through the probe and the gate; a record whose failed step has `completed_at: null` and an exit line gives `step unknown`; a placed step of blank lines only gives `step unknown`. [R3] [dod arm 1]
  - 4. tests/infra/github-ship.test.ts - the common case of R4 (previous step ending and post steps starting in the failed step's boundary seconds, the failed step printing its header and exit line) still gives the failed step's lines, and through the card runner an assertion there is a counted repair and a network error a rerun under the job's run. [R4] [dod arm 1]
  - 5. docs/OPERATIONS.md (Ship gates) and CHANGELOG.md Unreleased carry the rules under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R5] [dod arm 1]
depends_on: [T0-CI-RED-LOGS-2]
budget: 250
tdd: true
sweep: "grep -n 'failedStepLines\\|runHeader\\|inSecond\\|laterInEnd\\|isJobStep' src/delivery/github-ship.ts src/probes/gh.ts: the start is headers[rank] when the first second holds one run header per step that started in it (inSecond), which an earlier composite step's sub-step headers can satisfy; the end is the first exit line after the start, and the later-step guard (laterInEnd) looks only for `##[group]Run ` lines, so a post-action's exit line in the end second passes; isJobStep accepts an absent time key (t === undefined); an undefined end is refused only when no exit line is found."
forbid: [weakening or skipping a test to go green, a change to the CI classifier patterns or to card-runner.ts, making the common case of R4 `step unknown`, placing a start or an end on text another step's output can supply, printing a log line unencoded]
non_goals: [the same-cause rule on a constant ship detail (issue #67 item 1), GitHub Enterprise hosts, the run log archive (one file per job, no step files), the CI gate timeout, the scaffold ship path]
diagnosis:
  root_cause: "A job log has no step boundaries (the run log archive holds one file per job, checked on run 36217117337) and the job record gives whole-second times, so T0-CI-RED-LOGS-2 places the failed step by runner signatures (a `run` header's `shell:` line, the exit line) counted within a second; R3 decision 2 (Codex gpt-6-astra) reproduced four corners where those signatures come from another step or the record is incomplete, and the card was merged under a human ruling because the excerpt chooses a repair path and never gates a merge."
  same_class: "Every boundary rule of failedStepLines: the start count, the end exit line, the later-step guard and the record validation; R4 pins the case the rules exist for."
hygiene: "Filed from T0-CI-RED-LOGS-2 R3 decision 2 (goal g-20260926082227-b382ce, PR #83, merged under a human ruling). If no rule satisfies both R1-R3 and R4, state that in the card and ask for a ruling before the first review rather than after it (the line of T0-CI-RED-LOGS took six review blocks on this one question). Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24); the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: docs/OPERATIONS.md (Ship gates), CHANGELOG.md
---

# T0-CI-RED-LOGS-BOUNDS

## Deliverable
The failed-step excerpt of a red Actions job never carries another step's lines in the four corners R3 decision 2 of T0-CI-RED-LOGS-2 reproduced: they become `step unknown` (or `log unavailable` for an incomplete record), while the common case (a `run` step failing with its exit line between shared boundary seconds) keeps its excerpt, so the loop still tells a code defect from a transient failure on this repository's CI.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/gh.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
