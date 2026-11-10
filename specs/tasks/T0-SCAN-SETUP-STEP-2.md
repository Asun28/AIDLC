---
id: T0-SCAN-SETUP-STEP-2
title: "A red secret-scan check whose failed step is a listed scanner setup step is classified by its other evidence, not as a security finding, only when every gate line of the output is exactly what the GitHub ship path prints, so a scanner download outage stops as `ci`, not `risk`"
status: todo
branch: T0-SCAN-SETUP-STEP-2
worktree: D:\wt\AIDLC\T0-SCAN-SETUP-STEP-2
allow_paths:
  - src/core/ci-policy.ts
  - src/config.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/core/ci-policy.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/surface/templates.test.ts
  - tests/infra/github-ship.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-SCAN-SETUP-STEP.md
  - specs/tasks/T0-SCAN-SETUP-STEP-2.md
dod_command: npm run typecheck && node --test tests/core/ci-policy.test.ts tests/scenarios/ci-rerun.test.ts tests/surface/templates.test.ts tests/infra/github-ship.test.ts
dod_exit: 0
requirements:
  - R1. A red check whose name matches a secret or security scan (`SECURITY_CHECK_NAME`) shall not count as a security hit when all of these hold: every `[CI-GATE-RED]` and `[CI-GATE-STEP]` line of the classified text (the extra log and the log excerpt of every job) is in the printed form of R2, and the text has no `[CI-GATE-TIMEOUT]` line; exactly one `[CI-GATE-STEP]` line names the check, and it names a failed step listed in `ci.scanSetupSteps`; the check has at most one job record and at most one gate record, these agree on its conclusion, and it is one red check; no red gate line is unresolved. A hit from a job record marked `aggregate` (a receipt wrapper) is never such a check. The check is then classified as any other red check is (transient only on the structured evidence of T0-CI-RERUN-STRUCTURED, code-defect on code evidence in the log text, else unknown), and the classification's evidence ends with `scan-setup: <check> failed at <step> before its scan` for each such check, both names decoded and written as JSON strings, also when another hit keeps the class `security`.
  - R2. A gate line shall be in the printed form only when it is the line the GitHub ship path prints: for `[CI-GATE-RED]`, the sentinel, one space and the JSON array `checksJson` prints (each element `name`, then `conclusion` a string or null, then `status` only when it is a string other than `completed`); for `[CI-GATE-STEP]`, the sentinel, one space and the JSON `gateStepLine` prints (`check`, then `job` a job id of digits, then `step` null or `number` a positive integer, `name` and `conclusion` strings); in both, keys in that order, no other or repeated key, no other spacing, U+2028, U+2029 and `/` written escaped, and every `name` and `check` a non-blank string in the encoding of `encodeUntrusted` (no `[` or `]`, and every `%` followed by `25`, `5B` or `5D`). One gate line in any other form denies the exemption to every check of the text, whatever check it names and whether or not a check can be read from it.
  - R3. Every other red scan check shall stay `security` as before T0-SCAN-SETUP-STEP: no step line for the check, a null step, a failed step not on the list, an empty list, two step lines for the check, a `[CI-GATE-RED]` or `[CI-GATE-STEP]` line anywhere in the text in another form than R2 (malformed, a blank check, a repeated key, a raw bracket or a percent sign that is not one of the three escapes, a legacy `name=conclusion` red line), a `[CI-GATE-TIMEOUT]` line, two job records or two gate records of the check, records of the check that disagree on its conclusion, an unresolved red gate line, an aggregate wrapper named for a scan; raw gitleaks output (`leaks found: N`, `RuleID:`) in the log text and an unparsed red gate line naming a scan are hits of their own and keep the class `security`.
  - R4. `ProjectConfig` shall have a field `ci.scanSetupSteps` (non-blank strings) whose default is `["Install gitleaks (pinned version, checksum verified)"]`, the step of the shipped `security-scanners.yml` that installs the scanner before its scan step; `templates/aidlc.config.json` and `aidlc.config.json` carry it, and the card runner's CI gate and `aidlc ci classify --log` pass it to `classifyCiFailure`.
  - R5. WHEN the gate output of run 42467444385 attempt 1 reaches the card runner (Gitleaks red at step 3, the install step, after `curl: (22) The requested URL returned error: 504`), the runner shall stop with STOP/ci, not STOP/risk, persist no rerun intent, and journal CI_CLASSIFIED with class `unknown`.
  - R6. `docs/OPERATIONS.md` (the security class paragraph), `docs/ARCHITECTURE.md` (the outcome map's security clause, with the R1 conditions, the R2 form, the default list and the two readers of the configured list) and the CHANGELOG Unreleased section shall state R1 to R4.
acceptance:
  - 1. `tests/core/ci-policy.test.ts`: the gate and step lines of run 42467444385 attempt 1 classify as `unknown` under the default list, with no `security:` evidence and the `scan-setup:` evidence entry last. Fails on main. [R1] [R4] [dod arm 1]
  - 2. Same file: each R3 case stays `security`, with no `scan-setup:` evidence where the check itself is not exempt and with it where raw gitleaks output is the remaining hit. [R3] [dod arm 1]
  - 3. Same file: each of these denies the exemption of the Gitleaks check of the run's lines: beside them, a step line naming `build` whose `check` key is repeated with the Gitleaks check as its first value; beside them, the same line with its step conclusion null; the check's step line with a raw `[` in its step name, that name listed as written; the check written with `%5b` in its step line; a red line whose first element repeats `name` (the Gitleaks check, then `build`) beside the check's own element; beside them, a legacy red line for another check; beside them, a `[CI-GATE-TIMEOUT]` line; beside them, a second step line of the check at the same listed step. A check name and a step name holding `%5B`, `%5D`, `%25` and `\/` in the printed form are exempt when the decoded step is listed. Each denial fails at 8f13ddb. [R1] [R2] [R3] [dod arm 1]
  - 4. Same file: a scan setup failure whose step is also on `transientSteps` is `transient`; one beside a second red check with an `AssertionError` in the log is `code-defect`, also when that other check's records disagree on its conclusion; one beside a second red scan check stays `security` and keeps its `scan-setup:` evidence; `aidlc ci classify --log` on the run's gate output prints `unknown` under the default config and `security` under a config with `ci.scanSetupSteps` empty. [R1] [R4] [dod arm 1]
  - 5. `tests/scenarios/ci-rerun.test.ts`: the card runner given the run's gate output stops with STOP/ci, persists no rerun intent and journals CI_CLASSIFIED class `unknown`; the existing R7 security tests pass unchanged. Fails on main. [R5] [dod arm 1]
  - 6. `tests/surface/templates.test.ts`: every default `ci.scanSetupSteps` entry names a step of the shipped `security-scanners.yml` that comes before the step running `gitleaks git`, and `templates/aidlc.config.json` and `aidlc.config.json` parse to that default. [R4] [dod arm 1]
  - 7. `tests/infra/github-ship.test.ts`: the receipt `GitHubShipPath` prints for a red Actions job named `Gitleaks [x] 100% /runs` whose failed step is titled `Install [gitleaks] 100% /tmp`, classified with that title listed, is `unknown` with the `scan-setup:` entry naming both decoded names, and `security` with the list empty. [R1] [R2] [dod arm 1]
  - 8. The docs and CHANGELOG state R1 to R4 (reviewer-verified against the diff). [R6]
depends_on: []
budget: 250
tdd: true
diagnosis:
  root_cause: "`classifyCiFailure` (src/core/ci-policy.ts:189 and :203 at 19b0da8) counts every red check whose name matches `SECURITY_CHECK_NAME` as a security hit from the name alone, so a Gitleaks job that never scanned is `security` and the card runner (src/loop/card-runner.ts:2832) stops with STOP/risk. At 8f13ddb the exemption still reads which check a step line names from a line the ship path does not print: a repeated `check` key moves a Gitleaks step line to `build` in both the parsed and the malformed path, and a raw bracket in a step name passes the printed-form check."
  repro: "PR 236, run 42467444385 attempt 1: job `Gitleaks (committed history)` failed at step 3 `Install gitleaks (pinned version, checksum verified)` (curl error 504 downloading the binary) and step 4 `Scan committed history` was skipped; T1-FINDING-REPRO stopped with STOP/risk \"security gate red\". At 19b0da8 `aidlc ci classify --log` on that gate line, its step line and the curl line prints class `security`. The user's rerun of the job scanned 1275 commits with no leaks. The forms of R3 decision 4 on 8f13ddb are in .review/ of the old worktree and in its card's attempt evidence."
  same_class: "Each push into `securityHits` in `classifyCiFailure` (a failed independent job, a red gate check, an unparsed red gate line, raw gitleaks output), each place that reads a check identity from a gate line (`readGate`, `readStep`, `readStepCheck`), and `aidlc ci classify --log`; list each in the attempt evidence as covered by R1, kept by R3, removed, or not affected."
sweep: "grep -n \"SECURITY_CHECK_NAME\\|securityHits\\|invalidSteps\\|isShipStepPayload\\|transientSteps\" src. Lines are from 8f13ddb; read them again at PREPARE."
forbid: [weakening or skipping a test to go green, granting a rerun to a scan check other than through `ci.transientSteps` as any check gets one, treating a failed scan step as setup, reading a check identity from a gate line in another form than R2 for the exemption, editing .aidlc state by hand]
non_goals: [adding the install step to `ci.transientSteps` (left by the user's ruling of 2026-11-11), changing the gate or step lines the GitHub ship path prints, changing `src/delivery/`, changing `security-scanners.yml`, a new CI failure class, the transient path's reading of step lines]
hygiene: "Replacement of T0-SCAN-SETUP-STEP (goal g-20261110042335-f69024, stopped for review on R3 decision 4) by the user's ruling of 2026-11-11. Continues its branch line at 8f13ddb. Decision 1 blocked on 5 findings, decision 2 on a blank check, decision 3 on a missing or mistyped `job` and `number`, decision 4 on a repeated `check` key that hides the Gitleaks identity of a step line (parsed and malformed paths) and a raw bracket in a step name: each round found another line the ship path does not print whose identity the exemption still read. This card reads no identity from such a line: one gate line in another form denies every exemption, so `readStepCheck` and the per-check list of malformed lines go. The encoding check lives in core/ci-policy beside `decodeCheckName` (core imports nothing from delivery); acceptance 7 pins it to the printer. `tests/infra/github-ship.test.ts` changes where it builds a `ci` config and for acceptance 7. A step line names only the first failed step of a job, so list a setup step only when its failure skips the scan (a scan step without `if: always()`); the docs state that limit. Outside text in the evidence is a JSON string (T0-NARRATION-QUOTE). Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-SCAN-SETUP-STEP-2

## Deliverable
A Gitleaks job that fails while installing the scanner, before any scan, no longer stops the card as a security finding (STOP/risk, "remove the finding"); it is classified by its other evidence and, with none, stops as an unknown CI failure (STOP/ci) for diagnosis. The exemption reads only gate output in the exact form the GitHub ship path prints; any other gate line keeps every scan check `security`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/ci-policy.test.ts tests/scenarios/ci-rerun.test.ts tests/surface/templates.test.ts tests/infra/github-ship.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
