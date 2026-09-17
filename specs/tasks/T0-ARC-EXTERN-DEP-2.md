---
id: T0-ARC-EXTERN-DEP-2
title: The arc dependency gate treats a prerequisite merged outside the goal's projection as satisfied, in the controller and in the board view, so a card-execute goal dispatches instead of stopping with a required gap (replacement of T0-ARC-EXTERN-DEP after the board site was added to a reviewed candidate)
status: merged
branch: T0-ARC-EXTERN-DEP-2
worktree: C:\wt\T0-ARC-EXTERN-DEP-2
allow_paths:
  - src/core/arc.ts
  - src/loop/controller.ts
  - src/state/board.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/core/arc.test.ts
  - tests/scenarios/_harness.ts
  - tests/scenarios/t1-arc.test.ts
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-ARC-EXTERN-DEP.md
  - specs/tasks/T0-ARC-EXTERN-DEP-2.md
dod_command: npm run typecheck && node --test tests/core/arc.test.ts tests/scenarios/t1-arc.test.ts tests/infra/board.test.ts
dod_exit: 0
requirements:
  - R1. WHERE a card names a `depends_on` id outside the goal's projection, the arc dependency gate shall treat that prerequisite as closed WHEN the card registry records it as merged, and as an open gap otherwise.
  - R2. The rule shall be the one the revised-projection check already applies (`computeRevision`: a listed card keeps every prerequisite it names, listed or already merged), so a projection the goal admits is a projection the goal can schedule.
  - R3. A prerequisite outside the projection shall never enter the topological order, the dispatch wave, the worker count or the board.
acceptance:
  - 1. `selectArc` leaves a card waiting (verdict `stop`) when its `depends_on` id is absent from `cards` and carries no outcome, and admits it to `ready` and the wave when `outcomes` marks that id `closed`; the absent id itself appears in none of `ready`, `wave`, `waitingOn` or `blockedByStop` (arc.test.ts). [R1] [R3] [dod arm 1]
  - 2. `ArcInput.outcomes` documents that it may carry ids outside `cards` for prerequisites closed elsewhere, and names the caller that fills them (arc.ts doc comment; read in review, no test arm). [R1]
  - 3. `GoalController.cardOutcomes` records `closed` for every `depends_on` id outside `goal.cards` whose registry status is `merged`, and records nothing for one that is not merged or not in the registry, so a genuinely open external prerequisite still stops the goal (t1-arc.test.ts). [R1] [R2] [dod arm 1]
  - 4. A goal projected over one card whose prerequisite merged under a different goal returns `run-card` from `aidlc next`, not `stop` with `no admissible work`; the same goal with the prerequisite left `todo` in the registry still returns `stop` (t1-arc.test.ts). [R1] [R2] [dod arm 1]
  - 5. `docs/ARCHITECTURE.md` states the rule on the `arc.ts` line and CHANGELOG.md Unreleased carries the entry (read in review; no test arm). [dod arm 1]
  - 6. `renderBoard` reports the same arc verdict and wave as the directive for a projection whose prerequisite merged elsewhere: it takes the resolved outcomes from its caller instead of rebuilding them from the projected cards alone (board.test.ts), and `aidlc board` prints the one text it writes rather than a second render of its own, asserted by spawning the command over a projection whose prerequisite merged elsewhere and comparing its stdout with the written board file (t1-arc.test.ts). [R3] [dod arm 1]
  - 7. A prerequisite the registry no longer records is a required gap: the projection is admitted while the prerequisite is merged, the card file is removed, and `aidlc next` then returns `stop` with required gaps remaining (t1-arc.test.ts). [R1] [dod arm 1]
budget: 340
tdd: true
sweep: "grep -rn 'depends_on' src/core/arc.ts src/loop/controller.ts src/artifacts/card.ts: the gate (arc.ts:98), the projection validator that already admits a merged prerequisite (controller.ts:672), the registry check that makes a dangling depends_on a blocking finding (card.ts:213, so a prerequisite always exists in the registry)"
non_goals: [scheduling or closing a card outside the goal's projection, reading merge evidence from git or gh instead of the registry status, changing `aidlc goal resume`, removing the resume workaround from past goals]
diagnosis:
  root_cause: "src/core/arc.ts:88 resolves a dependency only against the goal's own cards: `closed(id)` is `outcomes[id] === 'closed' || byId.get(id)?.status === 'merged'`, and `byId` is built from `input.cards`. An id outside the projection has no entry in either, so `outcome()` falls back to 'todo' and the dependent card lands in `waitingOn` forever; with nothing running, selectArc returns verdict 'stop' and the goal stops with 'no admissible work: no ready work and required gaps remain'. The topological sort one line earlier (arc.ts:51) already skips out-of-goal deps with `if (byId.has(dep))`, so the two halves of the same function disagree about what an out-of-projection dependency means. Reproduced in isolation: selectArc over the single card T1-STATS with depends_on ['T1-DONE-ELSEWHERE'] and empty outcomes returns verdict 'stop', waitingOn ['T1-STATS']."
  same_class: "controller.ts:672-675 (computeRevision) already treats a merged out-of-goal prerequisite as satisfied, which is why a projection with such a prerequisite is admitted and then cannot be scheduled; the card machine's own PREPARE gate reads no depends_on, so the arc gate is the only site. The goal-level fix is in cardOutcomes (controller.ts:292), the one caller that holds both the projection and the registry. The board is the second site of the same class: renderBoard (board.ts:40) rebuilds the outcomes from the projected cards alone, so its Arc line reads verdict=stop wave=- for the projection the controller dispatches; it takes the resolved outcomes from its caller, and the `board` command prints the text writeBoard wrote instead of rendering a second one."
hygiene: "The registry's merged status is the same evidence computeRevision trusts, and card.ts:213 makes a depends_on id that resolves to no card a blocking registry finding, so the lookup cannot silently miss. Resolving the prerequisite in the controller keeps arc.ts pure and keeps the foreign id out of `order`, so the wave, the worker cap and the board are unchanged."
doc_sync: docs/ARCHITECTURE.md (src/core/ module line), CHANGELOG.md
---

# T0-ARC-EXTERN-DEP-2

## Deliverable
Replacement of T0-ARC-EXTERN-DEP (branch T0-ARC-EXTERN-DEP: a0f8cab the controller fix, R2 passed round 1 on all three perspectives with no findings, R3 spent no decision because Codex reported a quota hold; f1d4c9d the board fix, added after the effort episode had succeeded, which the loop will not review under a pinned candidate). This card carries both sites as one candidate and reviews it once. The effects reconciled: the two commits keep, the R2 pass of a0f8cab does not (a fresh round runs on this candidate) and no R3 decision was spent. What reviewed this candidate is recorded in the Ruling below.

A card whose prerequisite merged under a different goal cannot be dispatched: the arc gate reads that prerequisite as `todo` because it is outside the goal's projection, so `aidlc next` stops with `no admissible work: no ready work and required gaps remain`. T1-REVIEW-INPUTS hit this and was worked around with `aidlc goal resume --cards <prerequisite>,<card>`; T1-REVIEW-STATS hits it on intake, and every later card of `plans/review-findings.md` will.

`GoalController.cardOutcomes` resolves each `depends_on` id outside `goal.cards` against the card registry and records `closed` for a merged one, which is the rule `computeRevision` already applies when it admits the projection. `ArcInput.outcomes` documents that it may carry such ids. A prerequisite that is not merged stays an open gap and the goal still stops.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/arc.test.ts tests/scenarios/t1-arc.test.ts tests/infra/board.test.ts
```
- Expected exit code: 0
- Assertion: the arc unit tests pass for the externally closed prerequisite, the still-open gap and the foreign id's absence from wave and worker count; the scenario tests pass for `next` dispatching over a merged out-of-goal prerequisite and stopping over a `todo` one; the board tests pass for the arc line agreeing with the directive.

## Ruling (human, 2026-09-17)
R2 passed round 2 on all three angles. R3 decision 1 (deepseek-v4-pro-r3, run while the Codex quota was exhausted and both MiMo keys were dead) passed with no findings. R3 decision 2 (codex, once its quota returned) blocked with one cited finding, F3: acceptance 3 names a prerequisite absent from the registry and no test exercised that lookup. The finding is marked `outsideDelta`, a first-round miss on the same candidate. The allowance is spent, so the card stopped for adjudication (STOP/review).

Ruling: apply F3 and merge without another review cycle. The repair is one scenario test, proven to discriminate (with `statusOf(dep) !== 'todo'` in place of `=== 'merged'` the case returns `run-card` instead of `stop`); the code it guards was covered by both passes and is unchanged by the repair. DoD 30/30, full suite 660/660.
