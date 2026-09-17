---
id: T0-ARC-EXTERN-DEP
title: The arc dependency gate treats a prerequisite merged outside the goal's projection as satisfied, so a card-execute goal dispatches instead of stopping with a required gap
status: todo
branch: T0-ARC-EXTERN-DEP
worktree: C:\wt\T0-ARC-EXTERN-DEP
allow_paths:
  - src/core/arc.ts
  - src/loop/controller.ts
  - tests/core/arc.test.ts
  - tests/scenarios/_harness.ts
  - tests/scenarios/t1-arc.test.ts
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-ARC-EXTERN-DEP.md
dod_command: npm run typecheck && node --test tests/core/arc.test.ts tests/scenarios/t1-arc.test.ts
dod_exit: 0
requirements:
  - R1. WHERE a card names a `depends_on` id outside the goal's projection, the arc dependency gate shall treat that prerequisite as closed WHEN the card registry records it as merged, and as an open gap otherwise.
  - R2. The rule shall be the one the revised-projection check already applies (`computeRevision`: a listed card keeps every prerequisite it names, listed or already merged), so a projection the goal admits is a projection the goal can schedule.
  - R3. A prerequisite outside the projection shall never enter the topological order, the dispatch wave, the worker count or the board.
acceptance:
  - 1. `selectArc` leaves a card waiting when its `depends_on` id is absent from `cards` and carries no outcome, and admits it to `ready` when `outcomes` marks that id `closed`; the foreign id appears in neither `ready`, `wave` nor `waitingOn`, and `workers` counts only projected cards (arc.test.ts). [R1] [R3] [dod arm 1]
  - 2. `ArcInput.outcomes` documents that it may carry ids outside `cards` for prerequisites closed elsewhere, and names the caller that fills them (arc.ts doc comment; read in review, no test arm). [R1]
  - 3. `GoalController.cardOutcomes` records `closed` for every `depends_on` id outside `goal.cards` whose registry status is `merged`, and records nothing for one that is not merged or not in the registry, so a genuinely open external prerequisite still stops the goal (t1-arc.test.ts). [R1] [R2] [dod arm 1]
  - 4. A goal projected over one card whose prerequisite merged under a different goal returns `run-card` from `aidlc next`, not `stop` with `no admissible work`; the same goal with the prerequisite left `todo` in the registry still returns `stop` (t1-arc.test.ts). [R1] [R2] [dod arm 1]
  - 5. `docs/ARCHITECTURE.md` states the rule on the `arc.ts` line and CHANGELOG.md Unreleased carries the entry (read in review; no test arm). [dod arm 1]
budget: 220
tdd: true
sweep: "grep -rn 'depends_on' src/core/arc.ts src/loop/controller.ts src/artifacts/card.ts: the gate (arc.ts:98), the projection validator that already admits a merged prerequisite (controller.ts:672), the registry check that makes a dangling depends_on a blocking finding (card.ts:213, so a prerequisite always exists in the registry)"
non_goals: [scheduling or closing a card outside the goal's projection, reading merge evidence from git or gh instead of the registry status, changing `aidlc goal resume`, removing the resume workaround from past goals]
diagnosis:
  root_cause: "src/core/arc.ts:88 resolves a dependency only against the goal's own cards: `closed(id)` is `outcomes[id] === 'closed' || byId.get(id)?.status === 'merged'`, and `byId` is built from `input.cards`. An id outside the projection has no entry in either, so `outcome()` falls back to 'todo' and the dependent card lands in `waitingOn` forever; with nothing running, selectArc returns verdict 'stop' and the goal stops with 'no admissible work: no ready work and required gaps remain'. The topological sort one line earlier (arc.ts:51) already skips out-of-goal deps with `if (byId.has(dep))`, so the two halves of the same function disagree about what an out-of-projection dependency means. Reproduced in isolation: selectArc over the single card T1-STATS with depends_on ['T1-DONE-ELSEWHERE'] and empty outcomes returns verdict 'stop', waitingOn ['T1-STATS']."
  same_class: "controller.ts:672-675 (computeRevision) already treats a merged out-of-goal prerequisite as satisfied, which is why a projection with such a prerequisite is admitted and then cannot be scheduled; the card machine's own PREPARE gate reads no depends_on, so the arc gate is the only site. The goal-level fix is in cardOutcomes (controller.ts:292), the one caller that holds both the projection and the registry."
hygiene: "The registry's merged status is the same evidence computeRevision trusts, and card.ts:213 makes a depends_on id that resolves to no card a blocking registry finding, so the lookup cannot silently miss. Resolving the prerequisite in the controller keeps arc.ts pure and keeps the foreign id out of `order`, so the wave, the worker cap and the board are unchanged."
doc_sync: docs/ARCHITECTURE.md (src/core/ module line), CHANGELOG.md
---

# T0-ARC-EXTERN-DEP

## Deliverable
A card whose prerequisite merged under a different goal cannot be dispatched: the arc gate reads that prerequisite as `todo` because it is outside the goal's projection, so `aidlc next` stops with `no admissible work: no ready work and required gaps remain`. T1-REVIEW-INPUTS hit this and was worked around with `aidlc goal resume --cards <prerequisite>,<card>`; T1-REVIEW-STATS hits it on intake, and every later card of `plans/review-findings.md` will.

`GoalController.cardOutcomes` resolves each `depends_on` id outside `goal.cards` against the card registry and records `closed` for a merged one, which is the rule `computeRevision` already applies when it admits the projection. `ArcInput.outcomes` documents that it may carry such ids. A prerequisite that is not merged stays an open gap and the goal still stops.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/arc.test.ts tests/scenarios/t1-arc.test.ts
```
- Expected exit code: 0
- Assertion: the arc unit tests pass for the externally closed prerequisite, the still-open gap and the foreign id's absence from wave and worker count; the scenario tests pass for `next` dispatching over a merged out-of-goal prerequisite and stopping over a `todo` one.
