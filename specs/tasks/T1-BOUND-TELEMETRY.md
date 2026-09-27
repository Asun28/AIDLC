---
id: T1-BOUND-TELEMETRY
title: Every bound in the Limits table journals BOUND_FIRED when it fires, and the board shows one line with each bound's firing count and the goal outcomes that followed
status: todo
branch: T1-BOUND-TELEMETRY
worktree: D:\wt\AIDLC\T1-BOUND-TELEMETRY
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/state/board.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/scenarios/deadline.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/t0-flow.test.ts
  - README.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-BOUND-TELEMETRY.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. WHEN a bound of the README Limits table fires, the loop shall journal one `BOUND_FIRED` event whose zod payload names the bound.
  - R2. The board shall render one `Bounds:` line giving, per fired bound, the firing count and the terminal outcome of the goal after each firing (`DONE`, `STOP/<reason>` or `open`).
  - R3. The change shall add no config key and no file under `.aidlc/`.
  - R4. The README Limits table shall state that the lifecycle repair bound is defined and not enforced.
acceptance:
  - 1. Each firing point journals exactly one `BOUND_FIRED` with its bound name: card deadline (including the two `stopWith` paths that journal nothing today), arc deadline, reconciliation grace, review decisions, no-verdict retry, CI rerun allowed and CI rerun denied, attempts (the STOP that journals nothing today), planning invocations and integration repair; a scenario per bound asserts the event (tests/scenarios/deadline.test.ts, tests/scenarios/review-block.test.ts, tests/scenarios/ci-rerun.test.ts, tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 2. A `BOUND_FIRED` event whose payload names no known bound fails to parse (tests/infra/board.test.ts). [R1] [dod arm 1]
  - 3. Over fixture journals of three goals, the board prints one line `Bounds: <bound> <n> (DONE a, STOP/<reason> b, open c); ...` in a fixed bound order, the outcome of a firing being the goal's first terminal event after it, and `Bounds: none fired` when there are none (tests/infra/board.test.ts). [R2] [dod arm 1]
  - 4. No config key is added (`ProjectConfig` keys unchanged) and no path under `.aidlc/` is written by the board beyond what it writes today (tests/infra/board.test.ts). [R3] [dod arm 1]
  - 5. The README Limits table row for repair cycles says the lifecycle repair bound is defined and not enforced; a test reads the exact row (tests/infra/board.test.ts). [R4] [dod arm 1]
  - 6. `git diff --numstat origin/main...HEAD -- src` is at most +90 net (raised from +50 by the monitoring session under the user's delegation, for the R3 decision 1 repair of this card's own code; W5 goes to +214); the close-out states it and the W2+W4 running total against +400. [R1]
  - 7. `docs/OPERATIONS.md` names `BOUND_FIRED` and the board line; `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads each exact sentence (tests/infra/board.test.ts). [R1] [R2] [dod arm 1]
depends_on: [T1-AUDIT-FACTS-2]
budget: 980
tdd: true
sweep: "Survey of main at 5983a1e. Limits constants types.ts:998-1007, MAX_BASELINE_ATTEMPTS effort.ts:14. Firing points: card 3h card-machine.ts:97-103 via card-runner.ts:553-554 (CARD_STATE), card-runner.ts:2336-2337 and 2364-2365 (stopWith, no event); arc 12h controller.ts:209-212 (GOAL_STOPPED time); grace controller.ts:200-203, card-machine.ts:59-68; review decisions review-policy.ts:198-202, card-runner.ts:2262-2264; no-verdict retry review-policy.ts:193-195, card-runner.ts:2283-2286; CI rerun ci-policy.ts:187-204, card-runner.ts:2303-2323 (CI_RERUN only when allowed); attempts effort.ts:81-101, STOP card-runner.ts:803-806 (no event); planning controller.ts:252-256; integration repair controller.ts:514-516, arc.ts:191; lifecycle repair MAX_LIFECYCLE_REPAIR_CYCLES never read, counter types.ts:797 never incremented; workers arc.ts:140-148 is a cap, not a firing. Board: renderBoard board.ts:46-86, hardcoded denominators."
forbid: [a new config key, a new file under .aidlc/, a counter kept outside the journal, a change to any bound's value]
non_goals: [enforcing the lifecycle repair bound, counting the worker cap, a per-bound history view, tuning any default, firing the release reconciliation grace or the R2 round limits (issue 126)]
hygiene: "Lesson 2026-09-18 T1-REVIEW-STATS: derive the count from the event the loop persists at the firing, never from a counter kept for enforcement."
doc_sync: README.md (Limits), docs/OPERATIONS.md (board), CHANGELOG.md
superseded_by: T1-BOUND-TELEMETRY-2
---

# T1-BOUND-TELEMETRY

## Deliverable
Each bound that fires leaves one `BOUND_FIRED` event in the journal, and `aidlc board` shows, in one line, how often each bound fired and how the goals ended afterwards, so the defaults in the Limits table can be judged from data.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.

## Firing sites (same class), line numbers at cc53042
Every site keys its firing `goal/card-or-dash/bound/value`, the value read from a persisted fact, and journals it once, before the stop it causes is saved: card sites under the card-run lock, goal sites before `persistStop` under the goal lease.
- Card selection (card-runner.ts:564; saved by `next` at 654, the takeover at 749 and the revalidated save at 568): `card-deadline` (card-machine.ts:101) and `reconciliation-grace` (card-machine.ts:63) keyed by the run deadline; `review-decisions`, or `no-verdict-retry` when more than one retry was used (card-machine.ts:108), keyed by the candidate digest; `attempts` on a terminal episode (card-machine.ts:111) keyed by the attempt count.
- `attempts`, keyed by the recorded attempt count: REVIEW_FIX ladder stop (card-runner.ts:604), BUILD ladder stop (816), ship failure that ends the ladder (2388), repair refused after a rejected RED receipt (2498) and after a merge conflict (2526).
- `review-decisions` or `no-verdict-retry`, keyed by the candidate digest: R3 gate past two decisions (1248), command-path review stop (1922), ship-path review stop (2417), ship-path no-verdict stop (2441).
- `ci-rerun-allowed` (2465, no stop) and `ci-rerun-denied` (2469, transient class only), keyed by the candidate digest.
- `card-deadline`, keyed by the run deadline: RED receipt rejected after the deadline (2493), merge conflict after the deadline (2521).
- controller.ts: `reconciliation-grace` (211) and `arc-deadline` (221) keyed by the effective goal deadline, `planning-invocations` (265) keyed by the planning count, `integration-repair` (528) keyed by the repair cycle count.

## Stop sites left without a firing, and why
- Fallback stops and a stop another call saved meanwhile (card-runner.ts:654, 1022, 1081, 2340): the stop that was saved carries its own firing.
- Ownership, worktree and fence stops (759, 764, 779, 942, 1986, 2577, 2588): no Limits bound applies.
- R2 rounds exhausted (1154) and R2 no verdict twice (1185): the limits are configured values, not Limits rows; whether they should fire is the open question of issue 126.
- Advisory refusal (2413), security and content risk (2453, 2511), auth (2504), capability (2507) and unclassified ship outcome (2539): not bounds.
- STOP/ci for an unclassified CI failure (2475): a classification stop, not the rerun allowance. The WAIT when another window used the rerun: that window's rerun is its own firing.
- `recordAttempt` and third-decision refusals: they throw and persist nothing.
- controller.ts human, release and cancel stops (202, 496, 498, 548, 551, 563); 337 inherits a card's stop, which fired at the card.
- release-runner.ts:126, the release reconciliation grace: a bound stop outside `allow_paths`, recorded in issue 126.
- The worker cap is a cap, not a firing. The lifecycle repair bound is defined and not enforced, so nothing fires; recorded in issue 126.

## Amendments
- 2026-09-28, `budget:` 800 -> 950, by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: "862 of the 929 churn lines are tests, each pinning an R3 decision 1 finding (F1-F6 at the write boundary, class C), a condition set by aidlc-37 (one entry per key, keys from persisted facts), or a sweep survivor. src is +87 against the +90 cap, and the W2+W4 total is +183. Trimming them would weaken the proof R3 decision 2 reads." This is the last raise; an R2 fix that would pass 950 goes to aidlc-37 first.
- 2026-09-28, `budget:` 950 -> 980, by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: "R2 retry on cc53042 blocked (edge-cases): the firing key omitted goal.generation, so a resumed generation's firing on the same persisted value was deduplicated. The repair adds one scenario (about 20 lines) and carries the dirscan fix (6b5e8e4, 4a863c0) that R2 raised earlier." This is the final raise; beyond 980 the answer is a trim or a successor.
- 2026-09-28, candidate record: attempt 3 on 4a863c0 was refused (card-runner.ts:865, the episode had succeeded on cc53042; issue 128), so cc53042 stayed the candidate until the R2 retry on it blocked and reopened the episode. The repair carries the dirscan fix as 34680cc and 6826930 (cherry-picked from 6b5e8e4 and 4a863c0, issue 127) and the generation key as 8750adc and 07e8207.

## Ruling
- 2026-09-28, Ruling by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: R3 decision 2 on b4de1bc blocked on six findings (the CI key named the candidate alone; goal firings were not serialized; a damaged journal read as holding no key; a failed firing append left a CI-denied card in SHIP without its stop; a dangling or unlistable journal file or directory read as none fired), so the card stopped (STOP/review, second substantive block). First successor T1-BOUND-TELEMETRY-2 carries b4de1bc and persists each stop first with pendingFiring in the same locked write (an outbox). Goal g-20260927122725-25e8cb was cancelled with this ruling; the 36 review files were retained as goal evidence.
