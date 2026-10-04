---
id: T0-CI-RERUN-STRUCTURED
title: A CI failure is transient (the one rerun) only on structured evidence for every red check, never on log text (issue 76 item 2, plan finding F5)
status: todo
branch: T0-CI-RERUN-STRUCTURED
worktree: D:\wt\AIDLC\T0-CI-RERUN-STRUCTURED
allow_paths:
  - src/core/ci-policy.ts
  - src/delivery/github-ship.ts
  - src/config.ts
  - templates/aidlc.config.json
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/core/ci-policy.test.ts
  - tests/infra/github-ship.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CI-RERUN-STRUCTURED.md
dod_command: npm run typecheck && node --test tests/core/ci-policy.test.ts tests/infra/github-ship.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/review-block.test.ts tests/infra/ship.test.ts
dod_exit: 0
requirements:
  - R1. `ProjectConfig` (`src/config.ts`) and `templates/aidlc.config.json` shall carry `ci.transientSteps`, a list of job step names, default `["Set up job", "Complete job"]` (the steps GitHub runs itself). It is the declared contract of which failed steps are infrastructure; a listed project step grants the rerun on any failure in that step.
  - R2. The GitHub ship path (`ciLogLines`, `src/delivery/github-ship.ts`) shall print, for each red Actions job whose record it reads, one line `[CI-GATE-STEP] {"check":"<encoded name>","job":"<id>","step":{"number":n,"name":"<encoded>","conclusion":"failure"}}`, with `"step":null` when the record places no failed step, and no line when the record cannot be read; names are encoded as the gate encodes check names. `[CI-GATE-STEP]` is not a sentinel of `SENTINEL_MAP`: the frozen oracle of T0-SHIP-FAILURE-ORACLE stays green unchanged.
  - R3. The rule, stated once: `classifyCiFailure` (`src/core/ci-policy.ts`) shall classify a red CI failure as `transient` only on structured evidence for every red check (its conclusion is `startup_failure`, or a `[CI-GATE-STEP]` line of that check names a failed step listed in `ci.transientSteps`); log text never grants a rerun; a text-only transient is `unknown`: no rerun, STOP/ci. The red checks are those of the structured gate lines; with none, the failed jobs passed in, which carry no step evidence. A cancelled conclusion is `unknown` unless structured evidence makes it transient, with no text override. `code-defect` and `security` keep their evidence and precedence; step lines never reach the log patterns; the transient log patterns stay in the evidence list and grant nothing.
  - R4. The card runner (`applyShipResult`, `src/loop/card-runner.ts`) shall pass `this.config.ci.transientSteps` at its one `classifyCiFailure` call; `aidlc ci classify --log` (`src/cli/main.ts`) shall say in its output that a log alone cannot be transient.
  - R5. `docs/OPERATIONS.md` and `CHANGELOG.md` shall state the rule, the opt-in (list only steps whose failures are usually infrastructure), and that the scaffold path, whose CI gate prints no step lines, never earns a transient rerun (issue 137).
acceptance:
  - 1. tests/core/ci-policy.test.ts - the log-only transient cases that classified as `transient` (a network error, a lost runner, a cancelled job with transient text) classify as `unknown`, their transient matches kept as evidence; a red check with a `[CI-GATE-STEP]` failed step `Set up job` or `Complete job` is `transient`, with a project step, `"step":null` or no step line it is `unknown`, and with conclusion `startup_failure` it is `transient`; two red checks are `transient` only when both carry evidence; a custom `transientSteps` list makes its step transient and the default does not; code-defect and security evidence win over structured transient evidence as before; a step name such as `AssertionError` or `flaky` in a step line is no log evidence. [R1] [R3] [dod arm 1]
  - 2. tests/infra/github-ship.test.ts - the ship path prints one `[CI-GATE-STEP]` line per red Actions job whose record it reads (the failed step, or `"step":null`), none when the record cannot be read, and encodes the names; a red job failed at a project step is no rerun under the default list and one rerun when the step is listed in `ci.transientSteps`. tests/infra/ship.test.ts passes unchanged, and `classifyShipOutput` of a receipt with only a `[CI-GATE-STEP]` line is `unclassified` on a nonzero exit. [R2] [R3] [dod arm 1]
  - 3. tests/scenarios/ci-rerun.test.ts and tests/scenarios/review-block.test.ts - the transient fixtures carry a structured red check and its `[CI-GATE-STEP]` line naming `Set up job`, and the rerun flow, the per-candidate allowance and the locked-ledger decisions behave as before; a log-only transient fixture is STOP/ci with no rerun intent. [R3] [R4] [dod arm 1]
  - 4. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences and fails with any one removed; `aidlc ci classify --log` on a log-only transient prints `unknown` and the note. [R4] [R5] [dod arm 1]
depends_on: []
budget: 280
tdd: true
sweep: "Every place that grants a CI rerun from text, on main e62fd7a: ci-policy.ts TRANSIENT_PATTERNS (the grant, classifyCiFailure:153-176), its cancelled-conclusion branch (a cancelled job becomes transient on transient text), and aidlc ci classify --log (main.ts:781), which classifies a log alone. canRerun reads only the class; the rerun reconcile reads gh runView status (structured). The only classifyCiFailure call in the loop is card-runner.ts:2460."
forbid: [weakening or skipping a test to go green (the flipped expectations are the log-only transient cases of tests/core/ci-policy.test.ts, the project-step rerun of tests/infra/github-ship.test.ts, and the transient fixtures of the two scenario files, which gain the structured lines; all named in the acceptance), a card-runner.ts change outside the classifyCiFailure call (line 2460 on main e62fd7a), src code (ship.ts SENTINEL_MAP) mapping [CI-GATE-STEP], src code (ci-policy.ts classifyCiFailure) granting transient from log text, a change to canRerun or the rerun allowance, a change to the code-defect or security evidence or precedence, an edit of tests/infra/ship.test.ts]
non_goals: [the scaffold's task.ps1 printing step lines (issue 137), the ship classifier (issue 76 item 3, done), the rerun allowance and its ledger]
diagnosis:
  root_cause: "classifyCiFailure (ci-policy.ts) classifies a red CI failure as transient when any of ten TRANSIENT_PATTERNS matches the ship output's log text, and canRerun then grants the one same-origin rerun (issue 76 item 2, plan finding F5); a cancelled job becomes transient on the same text. The GitHub ship path already reads each red Actions job's record (ciLogLines) but prints only log lines, so no structured evidence reaches the classifier."
  same_class: "The sweep above: the transient grant, the cancelled branch and the log-only CLI are the text-derived rerun decisions; the rerun ledger and the reconcile are structured."
hygiene: "Budget 250 to 280, granted by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: the overage is mutation pins (E2, G3, S2) and the doc-sentence and CLI tests; src is 103. Issue 76 item 2, design approved by aidlc-37 (delegation of 2026-09-27T09:20Z): option b, ci.transientSteps with the default of option a; the scaffold path's loss of the text rerun is accepted as fail-closed (issue 137); aidlc ci classify --log says a log alone cannot be transient. Sequencing amended on 2026-10-04 under the user's delegation to finish the next unclaimed card and make all decisions: this card may review and ship independently of T1-BOUND-TELEMETRY-2. There is no declared dependency or runtime requirement on telemetry; the prior hold coordinated overlapping edits only. Before shipping, merge the latest base and rerun the DoD and required reviews for any changed candidate; preserve telemetry changes if they merge first. The attempt is recorded at the green DoD (the verify-before-done hook, issue 133). Before R3, a hand Codex pre-check answers no to both: can any rerun be granted from log text alone, and does any failure main classified as code-defect or security change class. Run the mutation sweep over every new branch before the first review; the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); a reclassification is stated as one rule against main and pre-checked (docs/LESSONS.md 2026-09-28 T0-EXIT-ZERO-NOT-MERGED-3)."
doc_sync: docs/OPERATIONS.md (CI failure classes and reruns), CHANGELOG.md
---

# T0-CI-RERUN-STRUCTURED

## Deliverable
A CI rerun is granted on structured evidence only: a check that failed to start, or a failed step the repository declares as infrastructure. Log text no longer grants a rerun; a text-only transient stops for diagnosis.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/ci-policy.test.ts tests/infra/github-ship.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/review-block.test.ts tests/infra/ship.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
