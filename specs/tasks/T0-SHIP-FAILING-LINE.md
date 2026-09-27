---
id: T0-SHIP-FAILING-LINE
title: The cause of a dod-failed, verify-failed, scope-blocked or budget-over ship names the failing line of the ship output, so two ship failures on different lines are two causes and the same line twice still stops the card
status: todo
branch: T0-SHIP-FAILING-LINE
worktree: D:\wt\AIDLC\T0-SHIP-FAILING-LINE
allow_paths:
  - src/delivery/ship.ts
  - src/delivery/github-ship.ts
  - tests/infra/ship.test.ts
  - tests/scenarios/ship-failing-line.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-FAILING-LINE.md
dod_command: npm run typecheck && node --test tests/infra/ship.test.ts tests/infra/github-ship.test.ts tests/scenarios/ship-failing-line.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a ship receipt is classified `dod-failed` or `verify-failed` and one of its lines (stdout, then stderr, ANSI escapes removed, leading and trailing whitespace ignored) is a failing test or compile line, the ship result's detail shall be `sentinel <sentinel>; failing line: <line>` naming the first such line. The failing lines are a TAP `not ok <n>` line without a `# TODO` or `# SKIP` directive, a node:test spec `✖ ` line other than the `✖ failing tests:` heading, a line carrying a TypeScript `error TS<code>:`, a Go `--- FAIL: ` line, and a line starting with `FAIL` or `FAILED` and a space (jest, vitest, pytest).
  - R2. WHEN a ship receipt is classified `scope-blocked` or `budget-over`, the detail shall name the gate line in the same form: the first line matching the outcome's sentinel pattern, which carries the gate's own detail (the out-of-scope paths, the measured lines and the budget).
  - R3. The failing line shall be a cause string only: control characters (Unicode line and paragraph separators included) replaced by spaces, normalised by `normaliseCause` (lower case, digit runs as `N`, `0x` numbers as `0x`, whitespace collapsed), cut to 160 characters, and its brackets and percent signs encoded as the GitHub ship path encodes untrusted text, so it never forms a sentinel or a `[SAGA-RESUME]` marker. The outcome, the sentinels, the resume command and the PR number are read as before, never from the failing line.
  - R4. WHEN no line qualifies, or the outcome is any other, the detail shall stay as it is (`sentinel <sentinel>` for these four outcomes), so two such failures in a row are still the same cause. Through the card runner, two consecutive ship failures of one outcome without progress whose failing lines differ shall be two causes (the ladder admits the next attempt), and the same failing line twice, its numbers changed, shall stop the card as same-cause-stop, as shall two failures with no failing line.
  - R5. `docs/OPERATIONS.md` (the ship repair paragraph) and `CHANGELOG.md` shall state the rule and its limit. The limit, stated before the first review: the failing line picks which cause the ladder counts and never gates a merge; a line of a shape R1 does not list is not read, so that failure keeps the constant detail; two lines that differ only after their first 160 normalised characters are one cause; a failing-shaped line printed by passing output is read as the failing line. Each misread costs at most one attempt: a card stopped one attempt early for a human to resume, or one more attempt within the ladder's four.
acceptance:
  - 1. tests/infra/ship.test.ts - a `dod-failed` receipt gives `sentinel DoD 未通过; failing line: <line>` for each shape R1 lists, the first failing line in receipt order when several are present, a `verify-failed` receipt the same, and a passing TAP line, a `# TODO` or `# SKIP` line, the `✖ failing tests:` heading and a `FAIL` word inside a line are never the failing line. [R1] [dod arm 1]
  - 2. tests/infra/ship.test.ts - a `scope-blocked` and a `budget-over` receipt give their gate line (out-of-scope paths; measured lines and budget), and the budget line of two receipts that differ only in their counts is the same detail. [R2] [dod arm 1]
  - 3. tests/infra/ship.test.ts - a failing line with ANSI colours, a tab, a Unicode line separator, sentinel-like text (`[SAGA-DONE]`, `[SAGA-RESUME] x`, `[SHIP-MERGE-FAIL]`) and more than 160 normalised characters gives an encoded, normalised line of at most 160 characters with no `[` or `]`, and the outcome, sentinels, resume command and PR number equal those of the same receipt without the line. [R3] [dod arm 1]
  - 4. tests/infra/ship.test.ts and tests/scenarios/ship-failing-line.test.ts - a receipt of each of the four outcomes with no qualifying line keeps `sentinel <sentinel>`, and every other outcome keeps its detail; through the card runner, for each of the four outcomes, two consecutive failures without progress on different lines admit attempt 3, the same line twice with different numbers stops the card as same-cause-stop, and two failures with no failing line stop it too. [R4] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R5] [dod arm 1]
depends_on: [T0-SHIP-REPAIR-ATTEMPT]
budget: 400
tdd: true
sweep: "grep -n 'detail' src/delivery/ship.ts: classifyShipOutput gives every sentinel outcome the constant detail `sentinel <first alternative of its pattern>`, so the refuted cause `ship <outcome>: <detail>` (card-runner.ts:2404) is the same for every failure of that outcome; DryRunShipPath's `dry-run outcome <outcome>` is a fixture detail and stays."
forbid: [weakening or skipping a test to go green, a change to src/loop/card-runner.ts or src/core/effort.ts, a change to SENTINEL_MAP or to how the outcome, sentinels, resume command or PR number are read, reading the failing line for anything but the detail, a failing line in the detail unencoded or unnormalised, a change to DryRunShipPath's detail]
non_goals: [the outcome classification reading sentinels from untrusted output (a test printing a sentinel), failing lines of runners R1 does not list, the CI gate path (its cause is the classifier's evidence), the red-missing detail]
diagnosis:
  root_cause: "classifyShipOutput (src/delivery/ship.ts:102) returns `sentinel ${re.source.split('|')[0]}` as the detail of every sentinel outcome, a constant per outcome, and the card runner refutes the bound success with the cause `ship ${outcome}: ${detail}` (src/loop/card-runner.ts:2404); effort.ts compares normalised causes, so two consecutive dod-failed, verify-failed, scope-blocked or budget-over ships without progress are always the same cause and stop the card as same-cause-stop at the second failure, whatever failed (issue #67 item 1, R3 decision 1 of T0-SHIP-REPAIR-ATTEMPT)."
  same_class: "Every ship outcome whose failure counts on the effort ladder: dod-failed, verify-failed, scope-blocked and budget-over. A code-defect CI failure already names the classifier's evidence line in its cause, and the other outcomes count no attempt."
hygiene: "Issue #67 item 1; the other items are done. card-runner.ts and effort.ts are not edited (other sessions hold card-runner.ts ranges; message aidlc-37 before any card-runner.ts edit). encodeUntrusted moves from github-ship.ts to ship.ts and is imported back, unchanged. Run the mutation sweep over every new branch before the first review, with receipt-side mutants (docs/LESSONS.md 2026-09-26 T0-SHIP-MERGE-REFUSED); the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); the limit in R5 is stated before the first review (docs/LESSONS.md 2026-09-26 T0-CI-RED-LOGS-2)."
doc_sync: docs/OPERATIONS.md (ship repair paragraph), CHANGELOG.md
---

# T0-SHIP-FAILING-LINE

## Deliverable
A ship that fails on the candidate's own code counts a failed attempt whose cause names what failed: the first failing test or compile line of a `dod-failed` or `verify-failed` ship, the gate line of a `scope-blocked` or `budget-over` ship. Two failures on different lines are two causes, so the ladder reaches its repair and escalation attempts; the same line twice without progress still stops the card, as does a failure the rules cannot read.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/ship.test.ts tests/infra/github-ship.test.ts tests/scenarios/ship-failing-line.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
