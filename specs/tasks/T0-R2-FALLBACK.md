---
id: T0-R2-FALLBACK
title: A preReview.fallback reviewer (Claude Sonnet 5, effort high, xhigh for large or core candidates) runs R2 while the primary holds a quota or billing hold, and DeepSeek is the primary again (part 2 of issue #92)
status: todo
branch: T0-R2-FALLBACK
worktree: D:\wt\AIDLC\T0-R2-FALLBACK
allow_paths:
  - src/config.ts
  - src/core/types.ts
  - src/core/review-effort.ts
  - src/loop/card-runner.ts
  - aidlc.config.json
  - tests/surface/config.test.ts
  - tests/core/review-effort.test.ts
  - tests/scenarios/r2-fallback.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-R2-FALLBACK.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/core/review-effort.test.ts tests/scenarios/r2-fallback.test.ts
dod_exit: 0
requirements:
  - R1. `preReview.fallback` shall be an optional reviewer in `ProjectConfig`: `command` (non-empty, no empty or blank argument) and `reviewer` (not blank, different from `preReview.reviewer` after trimming and case folding) required; `timeoutMs`, `shell`, `maxDiffBytes` and `answerMarker` defaulted as for the primary; `effort` an optional review effort policy. It shares the primary's `rounds`, `perspectives`, `coverage` and `onExhausted`.
  - R2. The review effort policy shall take an optional `xhigh` rule of the same shape as the `high` rule (`minChangedLines`, `paths`), checked first: a candidate whose added plus deleted lines reach it or that changes a matching path runs at `xhigh`; an `xhigh` rule with a default of `max` is refused. A collected diff with no `diff --git ` section selects `xhigh` when the policy has an `xhigh` rule. A policy without an `xhigh` rule selects as before.
  - R3. The R2 gate and `aidlc review pre` shall resolve the pre-reviewer per dispatch, as the R3 fallback does: the primary unless its latest round of the card, on any candidate, holds an unexpired quota hold, then the fallback unless it holds one too; with both held the gate is WAIT on `pre-review-quota` until the earlier hold clears and names both reviewers. The fallback never replaces a primary that is not held, and a block or a no-verdict never switches reviewer. The `pre-review` directive names the resolved reviewer; `review pre` runs its command with `{effort}` expanded from its effort policy over the collected diff, records the round, its `PRE_REVIEW_DECIDED` event and its evidence note under that reviewer's name with the level it ran at, and re-checks the reviewer on the record locked at reservation (a hold recorded or cleared meanwhile refuses: run the command again). Both reviewers share the cycle's rounds and its single no-verdict retry. Without `preReview.fallback` every gate decision, directive, round and hold is as before this card.
  - R4. This repository's `aidlc.config.json` shall run DeepSeek as the R2 primary again (`deepseek --model deepseek-v4-pro`, reviewer `deepseek-v4-pro`, `answerMarker` `=== answer ===`) with the fallback `claude -p --model claude-sonnet-5 --effort {effort}` and the read-only tools of the R3 fallback, reviewer `claude-sonnet-5`, `answerMarker` empty, `timeoutMs` 1200000, `maxDiffBytes` 800000, and effort `high` by default and `xhigh` from 500 changed lines or a change under `src/core/**`, `src/coordination/**` or `src/state/**`. The installed template keeps no fallback, as it keeps no `formalReview.fallback`: its R2 command is empty. The temporary swap of a8293d7 is undone: its OPERATIONS sentence and its CHANGELOG line are removed, and the answer-marker test pins the DeepSeek marker again.
  - R5. `docs/OPERATIONS.md` and the CHANGELOG Unreleased section shall state R1 to R4.
acceptance:
  - 1. `tests/surface/config.test.ts`: a fallback with only `command` and `reviewer` parses with the primary's defaults; an empty or blank argument, a blank reviewer and a reviewer named like the primary in any spelling are refused at their paths; the blank-refusal sweep lists `preReview.fallback.reviewer` and `preReview.fallback.command`; this repository's config and the template parse to the values of R4 exactly; the answer-marker test pins `=== answer ===` for this repository again. [R1] [R4] [dod arm 1]
  - 2. `tests/core/review-effort.test.ts`: the `xhigh` rule selects `xhigh` at and above `minChangedLines` and on a matching path, before the `high` rule; below it the `high` rule or the default applies; an `xhigh` rule with a `max` default is refused; a diff with no `diff --git ` section selects `xhigh` under an `xhigh` rule; every existing case of a policy without one is unchanged. [R2] [dod arm 1]
  - 3. `tests/scenarios/r2-fallback.test.ts`: with a fallback, a primary that answers 402 Insufficient Balance is held and the next gate is a `pre-review` directive naming the fallback, not WAIT; `review pre` runs the fallback's command with `{effort}` expanded (`high` for a small candidate, `xhigh` for one under `src/core/**`), and the round, its event and its evidence note name the fallback and the level; a pass opens the ship. [R3] [dod arm 1]
  - 4. The same file: a fallback no-verdict is retried on the fallback while the primary holds, and a second one stops the card as before (the retry is shared); a fallback block returns the card to BUILD and the repaired candidate goes to the fallback while the primary still holds; once the primary's hold clears the primary runs; with both held the gate waits until the earlier hold and names both; a reservation whose reviewer changed since the first read is refused. [R3] [dod arm 1]
  - 5. The same file: without `preReview.fallback`, the same 402 round gives WAIT on `pre-review-quota` and the directive, the round and the hold are as before this card. [R3] [dod arm 1]
  - 6. `tests/surface/config.test.ts` reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section, fails with any one removed, and fails if the temporary sentence of a8293d7 is still in `docs/OPERATIONS.md`. [R4] [R5] [dod arm 1]
depends_on: []
budget: 560
tdd: true
sweep: "grep -n 'this.config.preReview\\|pre-review-quota\\|pre-reviewer .* is on a quota hold' src/loop/card-runner.ts; grep -n 'high:' src/core/types.ts src/core/review-effort.ts: the R2 gate (card-runner.ts:1076 preReviewGate), the admission guard (:1973 preReviewAdmission) and the dispatch (:2000 preReview) each read `this.config.preReview` and treat a quota hold of the latest round for the candidate as WAIT or a refusal; R2 has no reviewer selection and no review pool. The R3 fallback resolves its reviewer in formalReviewerNow (:1311) and is the model for the R2 twin. ReviewEffortPolicy (types.ts:288) has only a `high` rule; selectReviewEffort and selectReviewEffortFromDiff (review-effort.ts:17, :47) read it. preReviewEligibility (:238) and the blocked-receipt rule (:345) read only the primary's `command` and `rounds`, which the fallback shares. The T1-STORE-CAS candidate (56dac35) changes card-runner.ts only at lines 21, 155, 650-740 and 916-930 and touches none of config.ts, types.ts, review-effort.ts or pre-review.ts."
forbid: [editing src/core/review-policy.ts, src/delivery/github-ship.ts or the store, lease and journal modules, a card-runner.ts hunk inside lines 1-30, 150-160, 640-750 or 880-935 of the base, a new import added inside the existing import at card-runner.ts line 21, a change to a lease or run-store write path, a change to the R3 reviewer selection, a fallback that runs while the primary is not held, a change to the R2 behaviour without a fallback]
non_goals: ["a fallback in templates/aidlc.config.json: the installed R2 command is empty, and the template keeps no formalReview.fallback either", "a hold narration of its own for a billing state", "review pools for R2: R2 has none", "the status of 402 from a provider (T0-R2-BILLING-HOLD non-goal)"]
hygiene: "Part 2 of issue #92, card (B) of the coordinating session's ruling: card-runner.ts may change at the R2 gate, admission and dispatch and in one new R2 helper, disjoint from the T1-STORE-CAS candidate; the exact hunks, as line ranges of the base card-runner.ts (main at 318631c), are: after 40, one new import line (`import type { PreReviewConfig } from '../config.ts';`); after 43, the `PreReviewer` type (2 lines); 1088, the pending-round expiry in `preReviewGate` (the timeout of the reviewer the round names); 1149-1166, the R2 gate in `preReviewGate` (the reviewer from `preReviewerNow`, the WAIT on `waitUntil` naming both reviewers when a fallback is configured, the no-verdict stop and the `pre-review` directive naming the resolved reviewer, the switch note); 1972-1996, the new `preReviewerNow` helper before `preReviewAdmission`, whose hold refusal asks it and whose return adds `reviewer`; 2001-2069, `preReview`: the primary check, the reviewer resolved before the lock and re-checked under it (a changed reviewer refuses), the diff cap name of the reviewer, the `{effort}` level of the fallback, the reservation's `effort` field and the panel `vars`; 2092, the evidence note (`(effort <level>)` when a level was expanded); 2130, the `PRE_REVIEW_DECIDED` data (`effort` when present). No lease or run-store write path changes; the reservation written under the existing lock gains the `effort` field. Mutation sweep and doc-sentence tests before the first review (docs/LESSONS.md 2026-09-24); every property of an acceptance item asserted on every case it names (docs/LESSONS.md 2026-09-26 T0-SHIP-MERGE-REFUSED)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-R2-FALLBACK

## Deliverable
R2 keeps running when its primary reviewer is held: a quota or billing hold of DeepSeek hands the round to Claude Sonnet 5 at an effort sized to the candidate, under the same rounds, angles and retry, and every record names the reviewer that ran. DeepSeek is the primary again, and the temporary swap is undone.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts tests/core/review-effort.test.ts tests/scenarios/r2-fallback.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
