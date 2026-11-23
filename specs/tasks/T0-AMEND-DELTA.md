---
id: T0-AMEND-DELTA
title: "A review decision on a candidate whose card was amended since the stage's last decision receives no delta and marks no finding outsideDelta, so a finding the amended contract raises is not counted a first-round miss (issue 415)"
status: todo
branch: T0-AMEND-DELTA
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/amend-delta.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-AMEND-DELTA.md
  - specs/tasks/T0-AMEND-DELTA.md
dod_command: npm run typecheck && node --test tests/scenarios/amend-delta.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/card-amend-continue.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `CardRunner.lastReviewedSha(run, stage)` (src/loop/card-runner.ts), the base of the delta of R9 (card T1-REVIEW-INPUTS) for `review pre`, `review r3` and `shipBindings`, shall return undefined when the stage's last decided record (the pre-review round, or the formal invocation, with outcome `pass` or `block` and a `candidateSha`, as on main) has a `requestedAt` no later than the `at` of an amendment in `run.amendments` whose `invalidated` holds `review`. Otherwise it returns what it returns on main.
  - R2. A decision with no delta base by R1 shall behave as a stage's first decision does on main: `review pre` and `review r3` collect no delta, the prompt carries no `## Delta since the last reviewed candidate` section (so no no-change note), `shipBindings` returns no `deltaPaths`, and `recordFindings` marks no new finding `outsideDelta`. The locked re-reads of `lastReviewedSha` that refuse a dispatch when a decision landed meanwhile keep their code.
  - R3. A decision recorded after the amendment shall be a delta base again, as on main: the next decision on the same commit gets the empty delta and its new findings are marked `outsideDelta`.
  - R4. docs/OPERATIONS.md, Review inputs (card T1-REVIEW-INPUTS) and Amendments, shall state R1 to R3; changelog.d/T0-AMEND-DELTA.md shall carry the fragment.
acceptance:
  - 1. tests/scenarios/amend-delta.test.ts "issue 415 - R3 on the amended candidate of the same commit marks no first-round miss": a card whose R3 decision 1 blocks on `sha-1`, the card's `requirements` amended (`invalidated` holds `review`), decision 2 on `sha-1` under the amended digest blocks with a new finding on a file of the candidate: the finding has no `outsideDelta`, the prompt the reviewer received has no `Delta since the last reviewed candidate` section, and `aidlc review stats` for the card counts 0 first-round misses. Fails on main. [R1] [R2] [dod arm 2]
  - 2. Same file "R2 on the amended candidate of the same commit marks no first-round miss": the same with `preReview.command` set, round 1 blocks, the amendment, round 2 on `sha-1` blocks with a new finding: no `outsideDelta`, no delta section in the prompt. Fails on main. [R1] [R2] [dod arm 2]
  - 3. Same file "a ship-path decision after an amendment is bound to no delta": after a formal decision on `sha-1` and an amendment invalidating `review`, `shipBindings(run).deltaPaths` is undefined; with an amendment that invalidates only `dod` it is `[]`, as on main. Fails on main for the first case. [R1] [R2] [dod arm 2]
  - 4. Same file "an amendment followed by a repair commit gives no delta either": decision 1 on `sha-1`, the amendment, a new candidate `sha-2`: decision 2 receives no delta and marks no finding. Fails on main. [R1] [R2] [dod arm 2]
  - 5. Same file "a decision after the amendment is the delta base again": decision 2 (after the amendment) on `sha-1` decided, decision 3 on `sha-1` receives the no-change note and marks its new finding `outsideDelta`. [R3] [dod arm 2]
  - 6. tests/scenarios/t0-flow.test.ts (its T1-REVIEW-INPUTS tests), card-amend.test.ts, card-amend-continue.test.ts and fault-points.test.ts pass with no line changed; the typecheck is clean. [R2] [R3] [dod arm 1] [dod arm 2]
  - 7. docs/OPERATIONS.md and the fragment state R4 (reviewer-verified against the diff); tests/surface/changelog-fragments.test.ts and tests/surface/prose.test.ts pass. [R4] [dod arm 2]
depends_on: []
budget: 200
tdd: true
diagnosis:
  root_cause: "Symptom: after `aidlc card amend` invalidates review, the next decision on the same commit records every new finding with `outsideDelta` (`(first-round miss)` in `aidlc review findings`, `firstRoundMiss` in `aidlc review stats`), and the R2/R3 prompt tells the reviewer every new finding is a first-round miss. Cause: `lastReviewedSha` (src/loop/card-runner.ts:561) reads only the commit of the stage's last decision. `amendCard` gives the candidate a new digest on the same commit (`amendedDigest`), so the delta from that commit to the candidate is empty, and `recordFindings` (src/core/review-policy.ts:475) marks every new finding outside it."
  same_class: "The three readers of `lastReviewedSha`: `review r3` (card-runner.ts:2330), `review pre` (card-runner.ts:2978) and `shipBindings` (card-runner.ts:1786); one change in `lastReviewedSha` covers all three. An amendment followed by a repair commit has the same defect on another commit (acceptance 4)."
sweep: "On main at ad088ed0. `git grep -n lastReviewedSha -- src`: the definition and the seven call sites in src/loop/card-runner.ts. `git grep -n outsideDelta -- src`: set only in src/core/review-policy.ts:475, read by src/cli/main.ts:254 and src/review/stats.ts:317, which need no change. No gate reads `outsideDelta`."
forbid: [a change to the `ReviewFinding` or `CardRun` schema, a change to src/core/review-policy.ts, weakening or skipping a test to go green]
non_goals: [a separate `outsideDelta` value for an amended contract (the issue's second option; R1 marks nothing instead), a delta of the card text given to the reviewer]
hygiene: "Issue 415, a follow-up of card T1-CARD-AMEND (PR 414). Display and statistics only: no gate reads `outsideDelta`. The prompt change of R2 is the same defect seen by the reviewer."
doc_sync: docs/OPERATIONS.md
---

# T0-AMEND-DELTA

From issue 415.

## Deliverable
`lastReviewedSha` stops treating a decision made under an earlier contract as the delta base, so a review after `aidlc card amend` is judged like a first decision: no delta, no first-round-miss mark.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/amend-delta.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/card-amend-continue.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, the neighbouring tests pass unchanged, and the typecheck is clean.
