---
id: T0-CI-RED-LOGS
title: The GitHub ship path puts the failed step's log of each red Actions job on its CI gate output, so a red CI run is classified (a code defect is a counted repair, a transient failure takes its rerun) instead of stopping as unknown on check names alone
status: todo
branch: T0-CI-RED-LOGS
worktree: D:\wt\AIDLC\T0-CI-RED-LOGS
superseded_by: T0-CI-RED-LOGS-2
allow_paths:
  - src/delivery/github-ship.ts
  - src/probes/gh.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/gh.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CI-RED-LOGS.md
dod_command: npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/gh.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the CI gate of the GitHub ship path finds a failed check run of a GitHub Actions job of the configured repository (its app is `github-actions`, its details URL is `https://github.com/<repository>/actions/runs/<run>/job/<job>` and the job id is the check run's id), the ship path shall read that job's log (`gh api repos/<repo>/actions/jobs/<job>/logs`) and write, right after the `[CI-GATE-RED]` line, one `[CI-GATE-LOG] actions/runs/<run>/job/<job>` line followed by the lines of the failed step (from the runner's last `##[group]Run ` step header before its last `##[error]Process completed with exit code N.` line up to that exit line; from the top of the log when no step header precedes it, and the whole log when it has no exit line), with the byte order mark and the timestamps removed and every colour code and other control character (tab and C1 controls included) removed or replaced by a space, the last 60 non-empty lines, each capped at 240 characters and encoded as untrusted text; at most 3 jobs, in the order of the gate line. The gate lines write every `/` of a check name escaped as `\/`, so no check name forms a `runs/<id>` ahead of the job line.
  - R2. WHEN the log of such a job cannot be read (the command exits non-zero, for an expired, missing or unfinished log), the ship path shall write its `[CI-GATE-LOG]` line with `log unavailable` and no log lines, and the ship outcome stays `ci-red`; a failed check run that is not such a job (another app, another host or repository in its details URL, or a job id other than its own) gets no `[CI-GATE-LOG]` line and no log is read for it.
  - R3. The card runner shall classify that output with the existing CI classifier: a failing test or a compile error is a code defect (BUILD with a counted failed attempt, card T0-SHIP-REPAIR-ATTEMPT), a network or runner failure is transient (one rerun, recorded under the run of the first `[CI-GATE-LOG]` line), and output with no log line, or none the classifier recognises, is unknown and stops with STOP/ci as before; no text of a log line is read as a sentinel, a check name, a PR number or a run id.
acceptance:
  - 1. tests/infra/github-ship.test.ts - a red Actions job whose log holds a failing node test, then the runner's exit line and post-step lines, gives a `ci-red` output with the `[CI-GATE-LOG]` line and the failed step's lines only (no exit line, no post-step line, no timestamp, no byte order mark), at most the last 60, each capped at 240 characters and encoded; log lines holding `[SHIP-BASE-SYNC-MERGED]`, `[SAGA-DONE]`, `PR #9` or `runs/999` change neither the outcome, the PR number nor the run id; an earlier step's output is not on the output; a check named `check runs/999` is written with its slash escaped. [R1] [R3] [dod arm 1]
  - 2. tests/infra/github-ship.test.ts - a job log the API refuses gives `log unavailable` and outcome `ci-red`; a failed check that is not an Actions job of the repository (another app, a foreign host, a foreign repository, a job id other than the check run id) gets no log line and no log read; four failed Actions jobs read three logs, in gate order. tests/infra/gh.test.ts - the job log probe returns the log on exit 0 and nothing on a non-zero exit. [R1] [R2] [dod arm 1]
  - 3. tests/infra/github-ship.test.ts, through the card runner built from the project config - a red job whose log holds an assertion failure returns a build directive with a counted failed attempt; one whose failed step holds `ECONNRESET` returns the rerun directive with the rerun recorded under the run of the job URL, also when an earlier step printed text the classifier reads as a code defect and when a failed check is named `check runs/999`; one whose log is unavailable stops with STOP/ci and no rerun. [R3] [dod arm 1]
  - 4. docs/OPERATIONS.md (Ship gates) and CHANGELOG.md Unreleased carry the rules under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [R3] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "grep -n 'CI-GATE-RED\\|checksJson\\|checkRuns\\|runs/' src/delivery/github-ship.ts src/probes/gh.ts src/loop/card-runner.ts: github-ship.ts:257 returns fail('[CI-GATE-RED]', checksJson(failed)) with names and conclusions only; gh.ts checkRuns reads name, status and conclusion; card-runner.ts:2357 classifies the ship output with classifyCiFailure, whose code and transient patterns read only non-gate lines, so a GitHub-path receipt has no evidence and is unknown; card-runner.ts:2359 takes the rerun id from the first `runs/<id>` of the output, which the GitHub path never prints, so a rerun is recorded as ship-<operation>. The one CI_CLASSIFIED event in this repository's journals (.aidlc/journal) is class unknown."
forbid: [weakening or skipping a test to go green, a change to the CI classifier patterns or to card-runner.ts, printing a log line unencoded, reading a log line as a gate line, a sentinel, a PR number or a run id, fetching more than three logs per gate]
non_goals: [the same-cause rule on a constant ship detail (issue #67 item 1, the next card), the CI gate timeout, rerunning a transient failure from the ship path, the scaffold ship path]
diagnosis:
  root_cause: "The GitHub ship path writes a red CI gate as check names and conclusions only, and the classifier never reads a check name as evidence (card R7), so every red CI run on this path is class unknown and the card stops with STOP/ci: the code-defect repair of T0-SHIP-REPAIR-ATTEMPT and the transient rerun are unreachable on this repository's own ship path. Reproduced by classifying a GitHub-path receipt (a red `check (ubuntu-latest, 22)` gate line): class unknown, no evidence."
  same_class: "The CI gate timeout writes pending checks only, which is correct: nothing failed. The scaffold ship path prints its own CI log lines and is outside this card."
hygiene: "Found while scoping issue #67 item 1 (the same-cause rule on a constant ship detail), which depends on this card: without log lines no failing line exists to name the cause. The log is untrusted text: encode each line once where it is formatted (docs/LESSONS.md 2026-09-15 T0-SHIP-BASE-SYNC-2). Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24); the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: docs/OPERATIONS.md (Ship gates), CHANGELOG.md
---

# T0-CI-RED-LOGS

## Deliverable
A red CI run on the GitHub ship path carries the log of the failed step of each red Actions job, so the loop can tell a code defect (a counted repair attempt) from a transient failure (one rerun under the real run id) instead of stopping every red run as unknown. Log text is data: encoded, capped, and never read as a sentinel, a check name, a PR number or a run id.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/gh.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
