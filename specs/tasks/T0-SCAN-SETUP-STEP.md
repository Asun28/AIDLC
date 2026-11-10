---
id: T0-SCAN-SETUP-STEP
title: "A red secret-scan check whose failed step is a listed scanner setup step is classified by its other evidence, not as a security finding, so a scanner download outage stops as `ci`, not `risk`"
status: todo
superseded_by: T0-SCAN-SETUP-STEP-2
branch: T0-SCAN-SETUP-STEP
worktree: D:\wt\AIDLC\T0-SCAN-SETUP-STEP
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
dod_command: npm run typecheck && node --test tests/core/ci-policy.test.ts tests/scenarios/ci-rerun.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. A red check whose name matches a secret or security scan (`SECURITY_CHECK_NAME`) shall not count as a security hit when all of these hold: at least one `[CI-GATE-STEP]` line names the check, and every step line that names it names a failed step listed in `ci.scanSetupSteps`; no step line that names the check, or whose check cannot be read (a blank check included), is malformed, a step line being malformed unless it is exactly the line the GitHub ship path prints (`gateStepLine`: one space after `[CI-GATE-STEP]`, then the JSON of `check` a non-blank string, `job` a job id of digits and `step` null or `number` a positive integer, `name` and `conclusion` strings, in that order, with no other or repeated key, no other spacing, and `/` written as `\/`); the check has at most one job record and at most one gate record, these agree on its conclusion, and it is one red check; no red gate line is unresolved. A hit from a job record marked `aggregate` (a receipt wrapper) is never such a check. The check is then classified as any other red check is (transient only on the structured evidence of T0-CI-RERUN-STRUCTURED, code-defect on code evidence in the log text, else unknown), and the classification's evidence ends with `scan-setup: <check> failed at <step> before its scan` for each such check, both names as JSON strings, also when another hit keeps the class `security`.
  - R2. Every other red scan check shall stay `security` as before this card: no step line for the check, a null step, a failed step not on the list, an empty list, two step lines for the check with one not on the list, a malformed step line naming the check or naming no readable check, two job records or two gate records of the check, records of the check that disagree on its conclusion, an unresolved red gate line, an aggregate wrapper named for a scan; raw gitleaks output (`leaks found: N`, `RuleID:`) in the log text and an unparsed red gate line naming a scan are hits of their own and keep the class `security`.
  - R3. `ProjectConfig` shall have a field `ci.scanSetupSteps` (non-blank strings) whose default is `["Install gitleaks (pinned version, checksum verified)"]`, the step of the shipped `security-scanners.yml` that installs the scanner before its scan step; `templates/aidlc.config.json` and `aidlc.config.json` carry it, and the card runner's CI gate and `aidlc ci classify --log` pass it to `classifyCiFailure`.
  - R4. WHEN the gate output of run 42467444385 attempt 1 reaches the card runner (Gitleaks red at step 3, the install step, after `curl: (22) The requested URL returned error: 504`), the runner shall stop with STOP/ci, not STOP/risk, persist no rerun intent, and journal CI_CLASSIFIED with class `unknown`.
  - R5. `docs/OPERATIONS.md` (the security class paragraph), `docs/ARCHITECTURE.md` (the outcome map's security clause, with the R1 conditions, the default list and the two readers of the configured list) and the CHANGELOG Unreleased section shall state R1 to R3.
acceptance:
  - 1. `tests/core/ci-policy.test.ts`: the gate and step lines of run 42467444385 attempt 1 classify as `unknown` under the default list, with no `security:` evidence and the `scan-setup:` evidence entry last. Fails before the fix. [R1] [R3] [dod arm 1]
  - 2. Same file: each R2 case stays `security`, with no `scan-setup:` evidence where the check itself is not exempt and with it where raw gitleaks output is the remaining hit. [R2] [dod arm 1]
  - 3. Same file: a scan setup failure whose step is also on `transientSteps` is `transient`; one beside a second red check with an `AssertionError` in the log is `code-defect`, also when that other check's records disagree on its conclusion; one beside a second red scan check stays `security` and keeps its `scan-setup:` evidence; `aidlc ci classify --log` on the run's gate output prints `unknown` under the default config and `security` under a config with `ci.scanSetupSteps` empty. [R1] [R3] [dod arm 1]
  - 4. `tests/scenarios/ci-rerun.test.ts`: the card runner given the run's gate output stops with STOP/ci, persists no rerun intent and journals CI_CLASSIFIED class `unknown`; the existing R7 security tests pass unchanged. Fails before the fix. [R4] [dod arm 1]
  - 5. `tests/surface/templates.test.ts`: every default `ci.scanSetupSteps` entry names a step of the shipped `security-scanners.yml` that comes before the step running `gitleaks git`, and `templates/aidlc.config.json` and `aidlc.config.json` parse to that default. [R3] [dod arm 1]
  - 6. The docs and CHANGELOG state R1 to R3 (reviewer-verified against the diff). [R5]
depends_on: []
budget: 220
tdd: true
diagnosis:
  root_cause: "`classifyCiFailure` (src/core/ci-policy.ts:189 and :203 at 19b0da8) counts every red check whose name matches `SECURITY_CHECK_NAME` as a security hit from the name alone; the `[CI-GATE-STEP]` line that places the failure in the install step is read only as transient evidence, so a Gitleaks job that never scanned is `security` and the card runner (src/loop/card-runner.ts:2832) stops with STOP/risk."
  repro: "PR 236, run 42467444385 attempt 1: job `Gitleaks (committed history)` failed at step 3 `Install gitleaks (pinned version, checksum verified)` (curl error 504 downloading the binary) and step 4 `Scan committed history` was skipped; T1-FINDING-REPRO stopped with STOP/risk \"security gate red\". At 19b0da8 `aidlc ci classify --log` on that gate line, its step line and the curl line prints class `security`. The user's rerun of the job scanned 1275 commits with no leaks."
  same_class: "Each push into `securityHits` in `classifyCiFailure` (a failed independent job, a red gate check, an unparsed red gate line, raw gitleaks output) and `aidlc ci classify --log`; list each in the attempt evidence as covered by R1, kept by R2, or not affected."
sweep: "grep -n \"SECURITY_CHECK_NAME\\|securityHits\\|transientSteps\" src. Lines are from main at 19b0da8; read them again at PREPARE."
forbid: [weakening or skipping a test to go green, granting a rerun to a scan check other than through `ci.transientSteps` as any check gets one, treating a failed scan step as setup, editing .aidlc state by hand]
non_goals: [adding the install step to `ci.transientSteps`, changing the step lines the GitHub ship path prints, changing `security-scanners.yml`, a new CI failure class]
hygiene: "`tests/infra/github-ship.test.ts` changes only where it builds a `ci` config, which gains the new field. A step line names only the first failed step of a job, so list a setup step only when its failure skips the scan (a scan step without `if: always()`); the docs state that limit. Outside text in the evidence is a JSON string (T0-NARRATION-QUOTE)."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-SCAN-SETUP-STEP

## Deliverable
A Gitleaks job that fails while installing the scanner, before any scan, no longer stops the card as a security finding (STOP/risk, "remove the finding"); it is classified by its other evidence and, with none, stops as an unknown CI failure (STOP/ci) for diagnosis.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/ci-policy.test.ts tests/scenarios/ci-rerun.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence

Attempt 1 (effort medium). RED receipt `3db5358`: acceptance 1, 3, 4 and 5 failed on their assertions (`security` where `unknown` or `transient` was expected, STOP/risk where STOP/ci was expected, no `ci.scanSetupSteps` default); acceptance 2 passed, since it pins main's behaviour.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/core/ci-policy.test.ts` "acceptance 1: a scan check red at its listed install step is no security finding and says why" | pass |
| 2 | `tests/core/ci-policy.test.ts` "acceptance 2: a scan check stays security unless every record of it places the failure in a listed setup step" (26 gate cases, 3 direct-record cases, 11 step-line forms under two configurations, the note only on the two raw-output cases) | pass |
| 3 | `tests/core/ci-policy.test.ts` "acceptance 3: the exempt check takes the class its other evidence gives, and ci classify reads the configured list" (also: another check with disagreeing records, a second red scan check keeping the note) | pass |
| 4 | `tests/scenarios/ci-rerun.test.ts` "T0-SCAN-SETUP-STEP acceptance 4" and the R7 security tests unchanged | pass |
| 5 | `tests/surface/templates.test.ts` "T0-SCAN-SETUP-STEP acceptance 5" | pass |
| 6 | docs/OPERATIONS.md (paragraph after the gitleaks gate), docs/ARCHITECTURE.md (outcome map security clause), CHANGELOG.md Unreleased | reviewer |

Rule against main (lesson T0-EXIT-ZERO-NOT-MERGED-3): the change only removes hits from the security list, so an input main classifies as `code-defect`, `transient` or `unknown` keeps its class and its evidence. An input main classifies as `security` stays `security` unless every R1 condition holds for each check-name hit and no other hit remains; it then gets the class main gives the same input with that check's name not read as a scan, plus the `scan-setup` evidence line. When another hit remains, the class stays `security`, the exempt check's `security:` line is dropped and its `scan-setup:` line is added, so the STOP/risk detail names the remaining hit.

Same class (`securityHits` pushes in `classifyCiFailure`, and the callers):
- a failed independent job named for a scan: covered by R1 (acceptance 1, the job passed in directly).
- a red gate check named for a scan: covered by R1 (acceptance 1).
- an unparsed red gate line naming a scan: kept by R2, no check is attached to the hit (acceptance 2).
- raw gitleaks output (`leaks found`, `RuleID:`): kept by R2 (acceptance 2).
- `aidlc ci classify --log` (src/cli/main.ts) and the card runner's CI gate (src/loop/card-runner.ts): both pass `ci.scanSetupSteps` (acceptance 3 and 4); no other caller of `classifyCiFailure` or reader of `SECURITY_CHECK_NAME` exists in `src/`.

`tests/infra/github-ship.test.ts` changes only its `ci` config builder, which now spreads the fixture's `ci` so the new required field is present; its 58 tests pass.

Attempt 2 (effort medium), repair of R3 decision 1 (F1 to F5). The card's R1, R2, R5 and acceptance 2 and 3 were amended on main at d793fe5 to state the rules the block read, and merged into the branch. Regression RED before the repair: acceptance 2 (no note on raw gitleaks output) and acceptance 3 (`security` where `code-defect` was expected beside another check's disagreeing records) failed on their assertions.

Input forms and failure paths of the repair hunks, each with its test (`tests/core/ci-policy.test.ts`):
- a step line whose payload is not JSON: no readable check, every exemption denied (acceptance 2, "a malformed step line naming no readable check"). F1.
- a step line of valid JSON with no `check`, or a `check` that is not a string: no readable check, every exemption denied (acceptance 2, the two cases after it). F1.
- a step line naming the check with a malformed step (`conclusion` null): the check's exemption denied, also with the setup step on `transientSteps` (acceptance 2, two cases). F1.
- two job records of the check beside one gate record: denied, counted before matching (acceptance 2, direct case 1); one job record and one gate record that agree: exempt (acceptance 2, last assertion). F2.
- a job record and a gate record of the check that disagree: denied (acceptance 2, direct case 2). F3.
- another check whose records disagree: no effect on the scan check, class `code-defect` (acceptance 3). F3.
- an aggregate wrapper named for a scan: its hit is never exempt (acceptance 2, direct case 3).
- an exempt check beside another red scan check: class `security`, evidence starts with the other hit and ends with the note (acceptance 3). F4.
- the docs: docs/ARCHITECTURE.md outcome map clause and docs/OPERATIONS.md paragraph state every R1 condition, the default list and the two readers (acceptance 6). F5.

Attempt 3 (effort medium), repair of R3 decision 2 (F1, re:F1 of decision 1): a step line whose `check` is blank or whitespace was read as naming the check `""`, so a malformed one did not deny the exemption. `readStep` now refuses a blank check and `readStepCheck` maps it to null, so such a line, malformed or not, names no readable check and denies every exemption. Regression RED before the repair: acceptance 2 returned `unknown` for "a malformed step line with the blank check \"\"".

Input forms of the repair hunks, each with its test (acceptance 2 in `tests/core/ci-policy.test.ts`): a malformed step line with check `""` or `"  "` (null conclusion), with the default lists and with the install step on `transientSteps`; a well-formed step line with check `""` or `"  "` naming the scan step, under the same two configurations. Each stays `security` with no `scan-setup:` line. A blank check was never transient evidence, since a red check with a blank name is never evidenced (test "successor R3: unnamed independent failures cannot earn a rerun", unchanged and passing).

Attempt 4 (effort medium), repair of R3 decision 3 (F1, re:F1 of decisions 1 and 2): `readStep` read a step line with `job` or `step.number` absent or mistyped as evidence. Rather than add one field per round (lesson T0-CARD-TAKEOVER-2), a step line now counts toward the exemption only when it is byte for byte the line `gateStepLine` in src/delivery/github-ship.ts prints (`isShipStepPayload`): the JSON is rebuilt from its validated fields in the printed order with the printed escapes and compared with the payload. `readStep` and the transient evidence are unchanged, so nothing main reads as transient changes. R1 was amended on main at 4c8c07d to define a malformed step line this way. Regression RED before the repair: acceptance 2 returned `unknown` for "no job and no number".

Input forms of the repair hunk, each in acceptance 2 of `tests/core/ci-policy.test.ts`, each under the default lists and with the install step on `transientSteps`, each `security` with no `scan-setup:` line: `job` and `step.number` absent; `job` null and `number` a string; a numeric `job`; a `job` that is not digits; `number` 0; `number` 3.5; another top-level key; another step key; a repeated key; another key order; other spacing inside the JSON and two spaces after the sentinel. Positive form: a step name holding `/` printed as `\/` is exempt under a list naming it, and the same line with a bare `/` is not. A non-JSON payload, an array, and a step that is not an object are refused by the same function before the comparison. Limit: a change to the form `gateStepLine` prints makes every red scan check `security` again until `isShipStepPayload` follows it, which fails closed.
