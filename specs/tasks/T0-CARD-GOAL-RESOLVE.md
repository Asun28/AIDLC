---
id: T0-CARD-GOAL-RESOLVE
title: A command that names a card acts on the goal that projects that card, and refuses naming the candidates when none or several do, instead of taking the newest active goal
status: todo
branch: T0-CARD-GOAL-RESOLVE
worktree: D:\wt\AIDLC\T0-CARD-GOAL-RESOLVE
allow_paths:
  - src/core/card-goal.ts
  - src/cli/main.ts
  - tests/core/card-goal.test.ts
  - tests/scenarios/card-goal.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-GOAL-RESOLVE.md
dod_command: npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/card-goal.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a command that names a card runs without `--goal` (`aidlc card next|attempt|close|ci-reconcile|report|status|takeover <card>`, `aidlc review pre|r3|dispute|accept <card>`), the CLI shall act on the one non-terminal goal whose projection (`cards`) holds the card; with no such goal it shall act on the one terminal goal that projects the card.
  - R2. IF no goal projects the card, or more than one goal qualifies at the step of R1 that decides, THEN the command shall exit non-zero before it reads or writes any card run, naming the card and every candidate goal id, and saying to pass `--goal <id>` (or, with no candidate, to create a goal with `aidlc goal new --card <card>`).
  - R3. WHEN `--goal <id>` is given, the command shall use that goal only if it projects the card or already holds a run for it; otherwise it shall exit non-zero before it writes anything, naming the goal and the goals that project the card.
  - R4. The resolution shall be one pure function in `src/core/card-goal.ts` over the goal records (and, for R3, whether the named goal holds a run), used by every command of R1; commands that name no card keep their goal resolution.
  - R5. `docs/OPERATIONS.md` (Sessions), `docs/ARCHITECTURE.md` (module map) and `CHANGELOG.md` shall state the rule.
acceptance:
  - 1. `tests/core/card-goal.test.ts`: with an older active goal projecting the card and a newer active goal that does not, the older one is chosen (the #72 case); one terminal goal projecting it is chosen when no active goal does; two active goals, or two terminal goals and no active one, are refused naming both ids and `--goal`; no projecting goal is refused naming the card and `aidlc goal new --card`. [R1] [R2] [R4] [dod arm 1]
  - 2. `tests/core/card-goal.test.ts`: an explicit goal that projects the card is used; one that does not but holds its run is used; one that neither projects it nor holds its run is refused naming that goal and the projecting goals; an unknown goal id is refused. [R3] [dod arm 1]
  - 3. `tests/scenarios/card-goal.test.ts` runs the CLI from the sources with two active goals, the card projected by the older one: `aidlc card close <card> --metadata` without `--goal` writes the older goal's run and creates no run file in the newer goal; `aidlc card close <card> --metadata` of a registered card no goal projects exits non-zero naming it and `aidlc goal new --card`, and no run file is created in any goal; `aidlc card close <card> --goal <newer>` exits non-zero and creates no run in the newer goal. [R1] [R2] [R3] [dod arm 1]
  - 4. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R5] [dod arm 1]
depends_on: []
budget: 260
tdd: true
sweep: "grep -n 'latestActiveGoalId\\|cardCtx\\|findRun' src/cli/main.ts src/loop/card-runner.ts: main.ts:97 latestActiveGoalId returns the explicit id, else the newest non-terminal goal, else the newest goal, whatever it projects; main.ts:416 cardCtx (card next :429, attempt :448, close :466, ci-reconcile :479, review pre :686, r3 :698, dispute :728, accept :741) resolves with it and then ensureCardRun creates a run in that goal (controller.ts:593, which journals CARD_DISPATCHED); card report :490, status :500 and takeover :528 call it directly. Goal-level commands (goal status :235, next :340, report :362, authorize :393, board :405, release start :827, audit verify :946, seal :962, evidence retain :988) name no card and keep it. review findings (card-runner.ts:419 findRun) already refuses a card with runs in several goals and is read only. Goal.cards (types.ts:822) is the projection; Goal.terminal (:834)."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, changing goal-level commands, a card run created before the goal is resolved]
non_goals: [removing the stray run and journal events issue #72 describes (state is never edited by hand), `aidlc report --card` (a goal-level command), `review findings` (read only, already refuses ambiguity)]
diagnosis:
  root_cause: "cardCtx resolves the goal with latestActiveGoalId, which knows nothing of the card: without --goal it takes the newest non-terminal goal. With two goals active, a card command of one session resolved to another session's newer goal, and ensureCardRun then created and journaled a run of the card in a goal that does not project it (issue #72: goals g-20260926044930-c26d79 and g-20260926045125-c0bdde, journal seq 7-11)."
  same_class: "Every command that takes a <cardId> resolves its goal through cardCtx or latestActiveGoalId directly (card report, status, takeover); all of them are in scope. Commands that name no card have no card to resolve by."
hygiene: "Filed from issue #72. Pass --goal on every card and review command while this card runs (docs/LESSONS.md 2026-09-26 T0-BASE-SYNC-HOLD-NARRATION). Run the mutation sweep over every new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (Sessions), docs/ARCHITECTURE.md (module map), CHANGELOG.md
---

# T0-CARD-GOAL-RESOLVE

## Deliverable
A card command without `--goal` acts on the goal that projects the card, never on whichever goal was created last. When the card has no goal, or more than one, the command stops before touching any run and names the goals to choose from. An explicit `--goal` that does not project the card is refused unless it already holds the card's run, so no command creates a run of a card in a goal that does not own it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/card-goal.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
