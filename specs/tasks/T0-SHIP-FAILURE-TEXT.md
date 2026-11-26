---
id: T0-SHIP-FAILURE-TEXT
title: "A ship that stops on a failure sentinel keeps the sentinel line's text in the STOP/tool detail"
status: todo
branch: T0-SHIP-FAILURE-TEXT
allow_paths:
  - src/delivery/ship.ts
  - src/loop/card-runner.ts
  - tests/scenarios/ship-failure-text.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - changelog.d/T0-SHIP-FAILURE-TEXT.md
  - specs/tasks/T0-SHIP-FAILURE-TEXT.md
dod_command: npm run typecheck && node --test tests/scenarios/ship-failure-text.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/narration-quote.test.ts tests/infra/ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/ship-failing-line.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `ShipResult` (`src/delivery/ship.ts`) shall gain an optional `failureText: string`, which `classifyShipOutput` sets when the outcome comes from a `SENTINEL_MAP` rule (the loop over `SENTINEL_MAP`, and the leg-bound branch when a rule matched): the first line of the receipt text, read as `failingLine` reads it (`printedText`, then control characters as spaces, trimmed), that the matched rule's regex tests; percent-decoded for `%25`, `%5B` and `%5D` only, in one pass, then encoded with `encodeUntrusted`, so text the ship path already encoded is unchanged and no bracket remains; cut to its first 500 code points before the encoding. It is never normalised as an effort cause. No other field of any result changes: `outcome`, `detail`, `sentinels`, `resumeCommand` and `prNumber` stay byte-identical for every receipt.
  - R2. The STOP/tool that `applyShipResult` writes for an outcome with no other branch (`src/loop/card-runner.ts`, the `merge-failed`/`default` case after the conflict check) shall append `; failure text: <JSON string of failureText>` to its detail, after the ship detail and before the resume-marker clause, when `failureText` is set; its next action then reads `read the ship failure text in this stop's detail` in place of `inspect the ship output and the retained receipt`. Without `failureText` (an `unclassified` outcome) the stop is byte-identical to main.
  - R3. The change shall leave unchanged which outcome stops, to the conflict repair, to a retry, to an allowance, to the operation record, to the journal or to the evidence note: no write is added, removed or reordered.
  - R4. `docs/ARCHITECTURE.md` (the card runner outcome map, "any other merge failure -> STOP/tool") and `docs/OPERATIONS.md` (the T0-SHIP-MERGE-REFUSED paragraph, after "a sync that finds the base merging cleanly.") shall state R2 in one sentence each, and one changelog fragment shall record it.
acceptance:
  - 1. `tests/scenarios/ship-failure-text.test.ts`, new file, unit rows on `classifyShipOutput` (exit 1): the three `[SHIP-MERGE-FAIL]` lines `src/delivery/github-ship.ts` prints (refused with a named merge state, refused with gh's text, `PR <n> state OPEN after merge` with n 7), a `[SHIP-PUSH-FAIL]` line and a `[SHIP-PR-NUMBER-FAIL]` line each give `failureText` equal to the line with its brackets encoded; a line already holding `%5B`, `%5D` and `%25` keeps them unchanged; a raw `[SAGA-RESUME] x` and `100%` after the sentinel come out as `%5BSAGA-RESUME%5D x` and `100%25`; an ESC colour sequence and a tab are removed or made a space; a 2000-character line gives 500 code points before encoding with no split surrogate pair. RED on main (`failureText` undefined). [R1] [dod arm 2]
  - 2. Same file: for the receipt of acceptance 1's merge-refused row and of a `[SHIP-BASE-SYNC-MERGED]` row, `outcome`, `detail`, `sentinels`, `resumeCommand` and `prNumber` equal literal values that main gives (pinned in the file); an `unclassified`, `merged`, `merge-unconfirmed` or `effect-unknown` result has no `failureText`. `tests/infra/ship.test.ts`, which pins outcome and detail across the sentinel map, passes unchanged. [R1] [dod arm 2]
  - 3. Same file, scenario through `makeFixture` and a ship path whose result the real classifier reads (the `TextShipPath` shape of `tests/scenarios/narration-quote.test.ts`, its own copy): a ship printing the `[SHIP-MERGE-FAIL]` line GitHubShipPath prints for PR 7 refused as `mergeable MERGEABLE (mergeStateStatus BLOCKED)` with gh text `X Pull request 7 is not mergeable: the base branch policy prohibits the merge`, `[SAGA-FAIL]` and `[SAGA-RESUME] aidlc card next <id>` stops `tool`; the persisted stop detail and the `card next` narration both hold `failure text: ` followed by the JSON string of that line encoded, and the next action starts `read the ship failure text in this stop's detail`. A second `card next` returns the same stop. RED on main. [R2] [dod arm 2]
  - 4. Same file: an `unclassified` ship (exit 1, no sentinel) gives a stop whose detail and next action equal main's text exactly; a `[SHIP-BASE-SYNC-CONFLICT]` ship with a `CONFLICT (content)` line still returns BUILD naming `merge-conflicts`, with the narration and `pendingRepair.detail` unchanged. The operation record's error and the `OPERATION_RESULT` event data of the scenario in acceptance 3 equal what main writes. [R2] [R3] [dod arm 2]
  - 5. `tests/scenarios/t0-flow.test.ts`, test `T0-TOOL-STOP-TEXT (issue 85 item 2)`: only its expected `stop.nextAction` and `stop.detail` strings change, to the R2 text for its `[SHIP-MERGE-FAIL] Pull request <n> is not mergeable: ...` output (n 7); `git diff origin/main --stat -- tests/` lists the new file and t0-flow.test.ts only, and the t0-flow diff touches those two assertions only. The other listed DoD files pass unchanged, `tests/scenarios/fault-points.test.ts` included. [R2] [R3] [dod arm 2]
  - 6. `docs/ARCHITECTURE.md` and `docs/OPERATIONS.md` state R2 at the places R4 names (reviewer-verified against the diff); `changelog.d/T0-SHIP-FAILURE-TEXT.md` holds one line in the form of `changelog.d/README.md`. [R4] [dod arm 2]
  - 7. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 160
tdd: true
sweep: "On main at a15a0611 `GitHubShipPath` prints a refused merge as `[SHIP-MERGE-FAIL] <encodeUntrusted(flat(detail))>` (`src/delivery/github-ship.ts:317-318`, `:486`, `:488`, `:491`), one line holding gh's stderr or the PR state. `classifyShipOutput` reduces `detail` to `sentinel \\[SHIP-MERGE-FAIL\\]` because `merge-failed` has no `FAILING_LINE_AT` entry (`src/delivery/ship.ts:121`, `:274`). The card runner keeps only that detail: the operation error (`src/loop/card-runner.ts:3417`), the evidence note of outcome and sentinels (`:3311`) and the STOP/tool (`:3580`), whose next action asks for 'the ship output and the retained receipt', and no receipt of the ship is retained anywhere. `push-failed` and `pr-failed` reach the same stop with the same loss. Changing `detail` itself was rejected: `tests/scenarios/dispute-running-attempt.test.ts:434-435` pins the detail of a `[SHIP-BASE-SYNC-MERGED]` merge-failed outcome inside the conflict narration and `pendingRepair`, and `detail` is the effort cause of four outcomes (`ship-failing-line.test.ts:63-71`). Callers grep (lessons T0-HOOK-FAIL-CLOSED, T1-GOAL-OWED): the only test pinning the STOP/tool text of a sentinel outcome is `tests/scenarios/t0-flow.test.ts:4882` and `:4885`; `narration-quote.test.ts:365` checks `includes(JSON.stringify(detail))`, which still holds; `adopt-merge.test.ts:77` and `review-resolve.test.ts:849` build their own stops. `applyShipResult` is named by the verify-card-run-writes skill, so `fault-points.test.ts` is in the DoD; R3 adds no write."
forbid: [network]
non_goals:
  - "an `unclassified` outcome (no sentinel), whose receipt keeps no line to quote; retaining whole ship receipts is a separate change"
  - "the operation record, the journal event and the evidence note, which keep their main text (R3)"
  - "the conflict repair path and the STOP/card and STOP/time stops of a conflict, which already name the detail"
  - "the cause of a first refusal like PR 482's, which only a kept failure text can show"
  - "a scaffold (task.ps1) change"
hygiene: "From issue 489 (card T0-BENCH-INPUTS, PR 482). RED first: acceptance 1 and 3 on main. A field added to `ShipResult`, not a changed `detail`, so every caller of `detail` reads what it read before."
---

# T0-SHIP-FAILURE-TEXT

From issue 489.

## Why
A ship that GitHub refuses to merge stops STOP/tool with only `sentinel \[SHIP-MERGE-FAIL\]` in its detail. gh's refusal text is on the ship output, but nothing after the classifier keeps it, and the stop asks the reader to inspect a receipt that is not retained. A later session cannot learn why the merge was refused.

## Deliverable
`classifyShipOutput` keeps the matched sentinel line as `failureText` (capped at 500 code points, encoded). The STOP/tool of a sentinel outcome quotes it and its next action points at it. A test file, one changed pair of assertions in t0-flow, two doc sentences and a changelog line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/ship-failure-text.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/narration-quote.test.ts tests/infra/ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/ship-failing-line.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: a STOP/tool of a merge, push or PR failure carries the sentinel line's text; every other result and stop is as on main.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | tests/scenarios/ship-failure-text.test.ts, the three failureText unit tests | RED at 5a612f34 (failureText undefined); pass on the candidate |
| 2 | tests/scenarios/ship-failure-text.test.ts, "the other fields of a result are those of main"; tests/infra/ship.test.ts unchanged | the pins pass at 5a612f34 and on the candidate; ship.test.ts passes unchanged |
| 3 | tests/scenarios/ship-failure-text.test.ts, "a refused merge stops STOP/tool with the failure text" | RED at 5a612f34 (detail without failure text); pass on the candidate |
| 4 | tests/scenarios/ship-failure-text.test.ts, the refused-merge test's operation and OPERATION_RESULT rows, and "an unclassified ship keeps main's stop text" | pass at 5a612f34 and on the candidate |
| 5 | `git diff origin/main --stat -- tests/`; the other DoD files | the new file and two changed assertions in t0-flow.test.ts (T0-TOOL-STOP-TEXT test); the other files, fault-points.test.ts included, pass unchanged |
| 6 | `git diff origin/main -- docs changelog.d`; tests/surface/changelog-fragments.test.ts | one sentence in each doc at the R4 places, one fragment line; pass |
| 7 | `npm run typecheck` | exit 0 |
| R3 d1 F1 | tests/scenarios/ship-failure-text.test.ts, the cut test: `%5B`, `%5D` and `%25` as the 500th code point and just past it | fails with the ship.ts of 17e7c8d0 (cut before decode gave a trailing `%25`); passes on the repair, which decodes, cuts, then encodes |
| R3 d1 F2 | tests/scenarios/ship-failure-text.test.ts: `ops[0].error`, the whole next action of both stops, the card next narration and the whole conflict narration asserted with `assert.equal` | pass on main's sources (5a612f34) for the unchanged paths and on the repair |
| R3 d1 inputs | The repair hunk of `failureText` takes one printed line: no escape, each of `%5B`, `%5D`, `%25` inside the line, at the 500th code point and past it, a raw `[`, `]` or `%`, an ESC sequence and a tab, a 1000-emoji line (surrogate pairs at the cut), no matching line (undefined). It raises no error | each covered by the unit tests named above |

## PR summary

### What
A ship that stops on a refused merge, a failed push or a failed PR step now keeps the failure line in the STOP/tool detail.

### Why / Intent
Before, the stop held only the sentinel name and asked for a receipt that was never retained, so GitHub's refusal text was lost (issue 489).

### How / Behaviour
`classifyShipOutput` sets a new optional `failureText` from the line its sentinel rule matched. The card runner adds it to the STOP/tool detail as a JSON string and points the next action at it.

### System impact
`detail` and every other field are unchanged, so effort causes, conflict repairs and the operation record read what they read before. No write is added.

### Security
The text comes from gh and git output. It is capped at 500 code points and encoded so it cannot form a sentinel or a resume marker, and it is quoted as a JSON string in the stop.

### Tests and review
A new test file covers the classifier rows, an unchanged-result guard and a card-run scenario. One t0-flow test changes its two expected strings to the new stop text.

### Risk
A long stop detail in `aidlc card next` output, at most about 500 more characters.

### Ownership
The aidlc maintainers own `src/delivery/` and `src/loop/`.

### Docs
docs/ARCHITECTURE.md and docs/OPERATIONS.md state the rule. A changelog fragment records it.
