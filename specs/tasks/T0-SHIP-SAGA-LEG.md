---
id: T0-SHIP-SAGA-LEG
title: A scaffold ship that reports the leg that failed in its saga report (`[SAGA-FAIL] <leg> (= first pending leg)`) is classified by that leg for the DoD, verify, license and leak legs, so a DoD failure whose output holds license words is a counted failed attempt instead of a final risk stop (issue 347)
status: todo
branch: T0-SHIP-SAGA-LEG
worktree: D:\wt\AIDLC\T0-SHIP-SAGA-LEG
allow_paths:
  - src/delivery/ship.ts
  - tests/infra/ship.test.ts
  - tests/scenarios/ship-saga-leg.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-SAGA-LEG.md
dod_command: npm run typecheck && node --test tests/infra/ship.test.ts tests/scenarios/ship-saga-leg.test.ts tests/scenarios/ship-failing-line.test.ts
dod_exit: 0
requirements:
  - R1. The scaffold leg report of a ship output shall be its last line that, with leading and trailing white space removed, reads `[SAGA-FAIL] <leg>` or `[SAGA-FAIL] <leg> (= first pending leg)`, where `<leg>` is one of the scaffold's leg names `card-check`, `DoD`, `verify`, `commit`, `scope-gate`, `budget-gate`, `license-gate`, `leak-gate`, `push+PR`, `R3-review`, `CI-gate`, `merge`, `local-merge`, matched exactly. A last `[SAGA-FAIL]` line of any other form (the github path's bare `[SAGA-FAIL]`, a between-legs failure `[SAGA-FAIL] <operation>; first pending leg after it = <leg>`, any other text) is not a leg report.
  - R2. WHEN a ship output that `classifyShipOutput` classifies through the sentinel map (after the `[SHIP-EFFECT-UNKNOWN]` rule, the exit-0 contract and the whole-receipt timeout, which are unchanged) has a leg report naming `DoD`, `verify`, `license-gate` or `leak-gate`, its outcome shall be that leg's class (`dod-failed`, `verify-failed`, `license-blocked`, `secrets-blocked` in that order), whatever other rule of the sentinel map the output also matches. The detail and the failing line are those of that class's rule of the sentinel map when the rule matches the output, and `saga leg <leg>` when it does not.
  - R3. WHEN the leg report names any other leg of R1, or the last `[SAGA-FAIL]` line is a between-legs failure of the form in R1, the four rules of the sentinel map whose class is `dod-failed`, `verify-failed`, `license-blocked` or `secrets-blocked` shall not decide the outcome; every other rule decides in the existing order, and an output no other rule matches stays `unclassified`. An output with no `[SAGA-FAIL]` line, or whose last `[SAGA-FAIL]` line is neither a leg report nor a between-legs failure, is classified as before this card.
  - R4. `docs/OPERATIONS.md` (Running a goal, beside the paragraph on the merge contract) and `docs/ARCHITECTURE.md` (Ship path adapters, the `ScaffoldShipPath` item) shall state R1 to R3, and `CHANGELOG.md` Unreleased shall carry the change under this card id and issue 347.
acceptance:
  - 1. tests/infra/ship.test.ts - the issue 347 shape: a scaffold DoD-leg failure output holding a line with `LICENSE-POLICY`, a line with `依赖许可不合规（见 docs/LICENSE-POLICY.md）`, a failing TAP line, `[SAGA-DONE] card-check`, `  [SAGA-FAIL] DoD (= first pending leg)`, `[SAGA-TODO] verify -> ...` and the throw text `DoD 未通过（退出码 1）。修绿再 ship。`, exit 1, is `dod-failed` with the detail `sentinel DoD 未通过` and the failing TAP line; the same output on main is `license-blocked`. [R2] [dod arm 1]
  - 2. tests/infra/ship.test.ts - a table, one row per leg of R2, whose output also holds text of each of the other three leg-bound rules and a bracketed sentinel of an earlier rule (`[SHIP-MERGE-FAIL]`, `[CI-GATE-RED]`), gives that leg's class; a row per leg of R2 without its throw text gives that class with the detail `saga leg <leg>`; the leg report with and without ` (= first pending leg)` and with leading spaces decides alike; with two `[SAGA-FAIL]` lines the last decides. [R1] [R2] [dod arm 1]
  - 3. tests/infra/ship.test.ts - a leg report naming `scope-gate`, `budget-gate`, `CI-gate` or `R3-review` with that leg's own bracketed sentinel and the license, secrets, verify and DoD texts in the output gives the leg's sentinel class (`scope-blocked`, `budget-over`, `ci-red`, `review-blocked`); a leg report naming `commit` with only the license text, and a between-legs failure `[SAGA-FAIL] preflight (review-backend availability / account guard / env bootstrap - between card-check and DoD); first pending leg after it = DoD` with only the license text, are `unclassified`; `[SAGA-FAIL]` bare, `[SAGA-FAIL] ship`, `[SAGA-FAIL] leg failed`, `[SAGA-FAIL] dod` (another case) and an output with no `[SAGA-FAIL]`, each with the license and DoD texts, keep main's class (`license-blocked`); every row of the existing `SENTINELS` table and every existing exit-0 case keeps its outcome. [R1] [R3] [dod arm 1]
  - 4. tests/scenarios/ship-saga-leg.test.ts, through the card runner and a ship path that classifies the acceptance 1 output with `classifyShipOutput` (as `ReceiptShipPath` of tests/scenarios/ship-failing-line.test.ts does) - a DoD-green attempt refuted by that ship returns a build directive with one counted failed attempt and no stop; the same ship classified as on main (the output without its leg report line) stops the card with STOP/risk. [R2] [dod arm 1]
  - 5. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "grep -n 'SENTINEL_MAP\\|for (const \\[re, cls\\]' src/delivery/ship.ts: the map (line 65) and the loop of classifyShipOutput (line 235) that returns the first rule matching anywhere in the output; the four throw-text rules at lines 89-93 match bare words. grep -rn \"license-blocked\\|secrets-blocked\" src/loop/card-runner.ts: both are a final STOP/risk (line 3178), dod-failed and verify-failed a refuted attempt (line 3151). grep -n 'SAGA-FAIL' D:/Projects/claude-devops-scaffold/scripts/task.ps1 D:/Projects/MyInspection/scripts/task.ps1: the saga report line `  [SAGA-FAIL] $sagaFailPoint`, `$sagaFailPoint` = `<leg> (= first pending leg)` or `<sagaAt>; first pending leg after it = <leg>`; the leg list at `$sagaLegs`."
forbid: [weakening or skipping a test to go green, removing or reordering a rule of the sentinel map, a change to the exit-0 contract, the `[SHIP-EFFECT-UNKNOWN]` rule or the timeout rule, a change to src/loop/card-runner.ts or to what a class does there, a change to github-ship.ts output, editing a released CHANGELOG section]
non_goals: [an output with no leg report (the github and dry-run paths, a scaffold without the saga report) keeps the bare-word rules, an owner-authorised way back to BUILD from a final stop (issue 326), the scaffold's own output, reading the scaffold catch record]
diagnosis:
  root_cause: "classifyShipOutput (src/delivery/ship.ts:235) returns the first rule of SENTINEL_MAP that matches anywhere in the ship output, and the license rule `/依赖许可不合规|LICENSE-POLICY/` (line 91) precedes the DoD rule (line 93). A scaffold ship that failed at its DoD leg prints the DoD's own output and the card's text before its saga report, so a word of that text decides the class: MyInspection operation op-20261116235005-093645ab (card T0-SCRIPTS-ORPHAN-FUNCS, whose card text names docs/LICENSE-POLICY.md) was recorded `license-blocked: sentinel 依赖许可不合规` and stopped as a final risk stop, while the scaffold's catch record says `{gate: dod, detail: DoD exit 1}` and its saga report says `[SAGA-FAIL] DoD`. The scaffold prints that report (`  [SAGA-FAIL] <leg> (= first pending leg)`, task.ps1 catch block) after every leg's output, and the classifier never reads which leg it names."
  same_class: "Any output text of an earlier leg (the DoD's test output, verify output, card text) that matches a rule ahead of the failing leg's own rule: the four throw-text rules match bare words, and the DoD of a scaffold repository that tests its ship script can print a bracketed sentinel such as [SHIP-MERGE-FAIL]. R2 covers both for the four legs whose class is read from throw text; the other legs print their own bracketed sentinel, which R3 lets decide as before."
hygiene: "Issue 347. The receipt of the misclassified ship was not retained; the acceptance 1 output is built from task.ps1 (MyInspection scripts/task.ps1 lines 1266 and 1496 and the catch block) and the card's forbid line. Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24); the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: docs/OPERATIONS.md (Running a goal), docs/ARCHITECTURE.md (Ship path adapters), CHANGELOG.md
---

# T0-SHIP-SAGA-LEG

## Deliverable
A scaffold ship whose saga report names the leg that failed is classified by that leg when the leg is DoD, verify, license-gate or leak-gate, so text the card or its DoD prints cannot turn a DoD failure into a license or secrets stop. Any other leg named by the report keeps its bracketed sentinel; output without a report is classified as before.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/ship.test.ts tests/scenarios/ship-saga-leg.test.ts tests/scenarios/ship-failing-line.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
