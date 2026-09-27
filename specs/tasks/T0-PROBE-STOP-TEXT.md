---
id: T0-PROBE-STOP-TEXT
title: The PREPARE stop for a failed worktree probe names the replacement path like every other tool stop, and the replacement carries the candidate only when one was built (issue 111)
status: todo
branch: T0-PROBE-STOP-TEXT
worktree: D:\wt\AIDLC\T0-PROBE-STOP-TEXT
allow_paths:
  - src/core/stop.ts
  - src/loop/card-runner.ts
  - tests/core/stop.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-PROBE-STOP-TEXT.md
dod_command: npm run typecheck && node --test tests/core/stop.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the worktree decision of PREPARE (`src/loop/card-runner.ts`, about line 760) stops with the reason `tool` (a failed worktree list, `src/delivery/worktree.ts:33`, or a failed common git directory, `:47`), the stop shall name the git error and take the next action of `toolStopNextAction` through `makeStop`'s `finalFor`; a stop with the reason `ownership` from the same decision keeps its own next action, since the owner's `card next` lifts it.
  - R2. `toolStopNextAction(goalId, cardId, cause, candidate)` shall name a replacement card that carries the candidate only when `candidate` is true (the default, which keeps the stops of T0-TOOL-STOP-TEXT as they are), and `makeStop` shall pass `finalFor.candidate` through; the PREPARE stop passes whether the run records a candidate.
  - R3. `docs/OPERATIONS.md` (the `tool` row of the stop table) and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/core/stop.test.ts`: the rule's text with and without a candidate, and `makeStop` passing `finalFor.candidate` through (a candidate by default). [R2] [dod arm 1]
  - 2. `tests/scenarios/t0-flow.test.ts`: a worktree list and a common git directory that fail at PREPARE each stop the card with the reason `tool`, a detail naming the git error, and the next action the rule gives without a candidate, which contains no `card next`; `card next` afterwards returns the same stop; a run that already records a candidate names the replacement that carries it; a branch checked out at another path stops with `ownership` and its own next action. [R1] [R2] [dod arm 1]
  - 3. The same file reads the exact `tool` row of `docs/OPERATIONS.md` and the entry this card adds to the CHANGELOG Unreleased section. [R3] [dod arm 1]
depends_on: []
budget: 120
tdd: true
diagnosis:
  root_cause: "decideWorktree (src/delivery/worktree.ts) returns stopReason tool when the git probe itself fails (lines 33 and 47), and PREPARE (card-runner.ts about line 760) made the stop with the fixed next action 'resolve the worktree/ownership conflict before starting'. A tool stop is selected before anything else (card-machine.ts) and nothing lifts it, so after the probe is fixed card next returns the same stop."
  same_class: "Every makeStop call whose reason is not a literal, each traced to the values that reach it (docs/LESSONS.md 2026-09-27 T0-TOOL-STOP-TEXT): card-runner.ts about line 760, decision.stopReason from decideWorktree, tool at worktree.ts:33 and :47 (this card) and ownership at :38, :43 and :49 (lifted by the owner's card next, unchanged); controller.ts:333, the goal-level stop, reason taken from the first stopped card, next action carrying each stopped card's own next action (checked and correct once the card stops are). The literal tool stops are card-runner.ts about 1166 and 2500 (T0-TOOL-STOP-TEXT). The effort policy's stop actions (effort.ts) reach a card stop only through makeStop with a literal reason. So this card closes the class."
sweep: "grep -rn 'makeStop(' src | grep -v \"makeStop('\" lists the two non-literal calls; grep -rn \"stopReason: 'tool'\" src lists the probe sources."
forbid: [editing src/loop/card-runner.ts outside about line 760, changing when the worktree decision stops or which reason it gives, the stops of T0-TOOL-STOP-TEXT]
non_goals: ["a recorded card resume that lifts a tool stop: issue 109", "the wording of the probe details in worktree.ts"]
hygiene: "Issue 111, the stop T0-TOOL-STOP-TEXT was narrowed away from after its sweep grepped the literal makeStop('tool'. card-runner.ts hunk: about line 760 (1 line to 3), cleared by the coordinating session's hunk check (aidlc-94's issue 106 card edits 501-502, 1147-1149, 1174, 2110, 2343, 2457 and 2485; aidlc-a6's T1-BOUND-TELEMETRY was told to keep clear of 760). Ships after T0-SHIP-QUOTA-RESET and the issue 106 card. Built RED first on a local branch (b610e3f, 4 assertion failures, a seam taking the candidate flag and ignoring it) and GREEN (5014eee); mutation sweep 8/8."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-PROBE-STOP-TEXT

## Deliverable
The last tool stop that named a way on that cannot work now names the one that can: a replacement card through `aidlc goal resume --replace`, carrying the candidate only when one was built.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/stop.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
