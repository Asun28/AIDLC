---
id: T0-CI-STEP-NAMED
title: The failed-step excerpt of a red Actions job places a step with a name of its own by the run-header count of its first second, so the failing test of a named workflow step reaches the CI classifier instead of stopping the card as step unknown (issue 316 item 1)
status: todo
branch: T0-CI-STEP-NAMED
worktree: D:\wt\AIDLC\T0-CI-STEP-NAMED
allow_paths:
  - src/delivery/github-ship.ts
  - tests/infra/github-ship.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CI-STEP-NAMED.md
dod_command: npm run typecheck && node --test tests/infra/github-ship.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the failed step is not step 1 and no line of its first second is the step's own header by the name rule of card T0-CI-RED-LOGS-BOUNDS (the one line of that second reading `##[group]<step name>`, its group holding the runner's `shell: ` line, with as many `##[group]Run ` lines before it in that second as earlier steps other than step 1 started there), the ship path shall place the start at the (k+1)-th `##[group]Run ` line of the failed step's first second, k being the number of earlier steps other than step 1 that started in that second, provided that second holds exactly k+1 `##[group]Run ` lines (a `uses:` step's header, without a `shell: ` line, counts) and the group of the (k+1)-th holds the runner's `shell: ` line; otherwise it shall write `step unknown` as before. The name rule, the end rule, the window, the line cleanup, the caps and the encoding are unchanged. The limit, stated before the first review: a failed `run` step whose own header is printed after its first second, while an earlier step that completed in that second printed there exactly the one `##[group]Run ` line with a `shell: ` line the count expects, is placed at that earlier line; every other shape with an extra or a missing run header in the first second (the step's own output printing a `Run ` group there, an earlier step printing one, a composite step printing two, a failed `uses:` step) is `step unknown`.
  - R2. The card runner shall classify the excerpt of a named step with the existing CI classifier and policy, unchanged: a failing test or a runtime error in it is a code defect (BUILD with a counted failed attempt), a network error in a step listed in `ci.transientSteps` takes its one rerun under the run of the job URL, and a named step that R1 does not place stops with STOP/ci and no rerun.
  - R3. `docs/OPERATIONS.md` (Ship gates) shall state the count rule of R1 in place of the limit "a step with a name of its own" and state the limit that remains, and `CHANGELOG.md` Unreleased shall carry the change under this card id.
acceptance:
  - 1. tests/infra/github-ship.test.ts - the two job shapes of issue 316 (job 132368615236 of Asun28/llm-wiki-flywheel - named steps back to back, the failed named step starting in the end second of the previous step, a pytest `TypeError` and `FAILED` line, the exit line, post steps after it; and job 132209813313 - the failed named step started in the same second as an earlier named step, k = 1) give the `[CI-GATE-LOG]` line and the failed step's lines only, from its own header to before its exit line, with no line of the previous step or of a post step; a named failed step gives `step unknown` when its own output prints a `##[group]Run ` group with a `shell: ` line in its first second, when an earlier step that started in that second printed a second run header, when an earlier composite step that completed in that second printed two run headers, and when it is a `uses:` step (header without a `shell: ` line). [R1] [dod arm 1]
  - 2. tests/infra/github-ship.test.ts, through the card runner built from the project config - the job 132368615236 shape returns a build directive with one counted failed attempt; a named step listed in `ci.transientSteps` whose placed lines hold `ECONNRESET` returns the rerun directive under run 123; a named step R1 does not place stops with STOP/ci, `counted` 0 and no rerun. [R2] [dod arm 1]
  - 3. tests/infra/github-ship.test.ts - every refusal case of the T0-CI-RED-LOGS-2 and T0-CI-RED-LOGS-BOUNDS tests keeps its `step unknown` assertion, except the two whose label states the removed limit ('a step with a name of its own' in BOUNDS acceptance 1 and 'a group reading the name of a step with a name of its own' in the T0-CI-RED-LOGS-2 refusal table), which now assert the failed step's own lines from its header; the common case of BOUNDS acceptance 4 is unchanged. [R1] [dod arm 1]
  - 4. docs/OPERATIONS.md (Ship gates) and CHANGELOG.md Unreleased carry the rule and its limit under this card id; a test reads the exact sentences this card adds and fails with any one removed; the doc sentence constants of T0-CI-RED-LOGS-2 and T0-CI-RED-LOGS-BOUNDS are updated to the revised text of the sentences R3 changes, and nothing else in them. [R3] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "grep -n 'own\\b\\|before === earlier\\|runHeader' src/delivery/github-ship.ts: failedStepLines (line 83) computes `own` from lines reading `##[group]<step name>` in the first second and places the start only when own.length === 1, runHeader(own[0]) and before === earlier; a failed step whose record name is its `name:` never has such a line. grep -n 'name of its own' tests/infra/github-ship.test.ts docs/OPERATIONS.md CHANGELOG.md: the two refusal labels of acceptance 3, the lookalike assertion at about line 675 (its total of two run headers keeps it step unknown under R1), the OPERATIONS Ship gates limit sentence and the 0.2.0 CHANGELOG entry of BOUNDS, which is released history and stays as it is."
forbid: [weakening or skipping a test to go green, removing a refusal case other than the two of acceptance 3, a change to the end rule, the window or the record validation, a change to the CI classifier or to src/loop/card-runner.ts, reading `gh run view --log-failed` or the run log archive, editing a released CHANGELOG section]
non_goals: [an owner-authorised way back to BUILD from a ci stop on the same card (issue 316 item 2; a follow-up issue), placing a failed step whose own header is printed after its first second, the CI classifier patterns (the syrupy 'snapshots unused' failure of job 132209813313 stays class unknown), the scaffold ship path]
diagnosis:
  root_cause: "failedStepLines (src/delivery/github-ship.ts:83) places a failed step other than step 1 only at a line of its first second that reads `##[group]<step name>` (card T0-CI-RED-LOGS-BOUNDS), but a workflow step with `name:` prints `##[group]Run <its command>`, so every failed named step is `step unknown`, the classifier gets no log line and the card stops with STOP/ci. Reproduced on both runs of issue 316: replaying the record and log of job 132368615236 (step 10 `Knowledge bench runner tests`, pytest TypeError) and job 132209813313 (step 8 `Pytest collection (smoke check)`) of Asun28/llm-wiki-flywheel through failedStepLines returns undefined for both; the lines `gh run view --log-failed` attributes to step 10 classify as code-defect (`1 failed`, `TypeError`). This repository's CI names no step, so its own red runs never showed it."
  same_class: "Every workflow whose steps carry `name:`, the default in downstream repositories. Unnamed steps keep the name rule. The run log archive holds per-step files for some runs (this repository's run 43702968273) and only one file per job for others (the downstream run 43568859972), so it cannot replace the record bound."
hygiene: "Issue 316 item 1; item 2 (an owner-authorised resume from a ci stop on the same card) is filed as a follow-up issue. The line of T0-CI-RED-LOGS took six review blocks on the step bound: the remaining limit is stated in R1 before the first review. Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24); the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); log text is untrusted and encoded once where it is formatted (docs/LESSONS.md 2026-09-15 T0-SHIP-BASE-SYNC-2)."
doc_sync: docs/OPERATIONS.md (Ship gates), CHANGELOG.md
---

# T0-CI-STEP-NAMED

## Deliverable
A red CI run whose failed step has a name of its own (a workflow step with `name:`) puts that step's lines on the gate output, placed by the count of `##[group]Run ` headers in its first second, so a failing test in it returns the card to BUILD as a counted repair instead of stopping it as an unclassified ci stop. Shapes the count cannot establish stay `step unknown`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
