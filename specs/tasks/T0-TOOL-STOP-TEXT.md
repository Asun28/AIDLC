---
id: T0-TOOL-STOP-TEXT
title: The pre-review and ship tool stops name the one way on that exists, a replacement card through goal resume, and never card next, which returns the same stop (issue 85 item 2)
status: merged
branch: T0-TOOL-STOP-TEXT
worktree: D:\wt\AIDLC\T0-TOOL-STOP-TEXT
allow_paths:
  - src/core/stop.ts
  - src/loop/card-runner.ts
  - tests/scenarios/r2-fallback.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-TOOL-STOP-TEXT.md
dod_command: npm run typecheck && node --test tests/scenarios/r2-fallback.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. `src/core/stop.ts` shall export `toolStopNextAction(goalId, cardId, cause)`, the next action of the two tool stops named in R2. It gives the cause, says the stop is final for the card, and names the way on, which is to fix the cause, register a replacement card that carries the candidate, then run `aidlc goal resume <goal> --reason "..." --replace '{"<card>":"<replacement>"}'`. It never names `card next`.
  - R2. The stop for a second pre-review no-verdict in one cycle (`src/loop/card-runner.ts`, about line 1166) and the stop for an unclassified ship outcome (about line 2497) shall take their next action from R1. The ship's `[SAGA-RESUME]` command, when its output carries one, goes into the stop's detail, labelled as a diagnostic that does not lift the stop, and never into the next action.
  - R3. WHILE a card run carries such a stop, `aidlc card next` shall return that same stop, as it does now; nothing lifts a tool stop (a recorded resume is issue 109).
  - R4. `docs/OPERATIONS.md` (the `tool` row of the stop table and the base-sync failure sentence that names the `[SAGA-RESUME]` command) and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/scenarios/r2-fallback.test.ts`: two no-verdicts in one cycle stop the card with the reason `tool`; the next action names the goal, the card and `aidlc goal resume <goal> --reason "..." --replace '{"<card>":"<replacement>"}'` and contains no `card next`; `card next` afterwards returns the same stop. [R1] [R2] [R3] [dod arm 1]
  - 2. `tests/scenarios/t0-flow.test.ts`: a merge failure without a conflict diagnostic whose ship output carries `[SAGA-RESUME] aidlc card next <card>` stops the card with the reason `tool`; the next action is the one R1 gives and contains no `card next`; the detail names that command as a diagnostic that does not lift the stop; `card next` afterwards returns the same stop. [R1] [R2] [R3] [dod arm 1]
  - 3. The same file reads the exact sentences this card writes in `docs/OPERATIONS.md` and the CHANGELOG Unreleased section, and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 180
tdd: true
sweep: "grep -rn \"makeStop('tool'\" src gives two sites, both in src/loop/card-runner.ts: the pre-review no-verdict stop (about line 1166) and the unclassified ship outcome (about line 2497). The card machine selects a persisted stop first (src/core/card-machine.ts), and only ownership, time and a merged card's ownership stop are ever lifted."
forbid: [lifting a tool stop or any other stop, a new command, editing src/loop/card-runner.ts beyond the two stop lines, naming card next in a tool stop's next action]
non_goals: ["a recorded card resume that lifts a tool stop, with the round-count rule it needs: issue 109", "the wording of the stop details beyond the diagnostic label", "stops with any other reason", "the PREPARE worktree-probe tool stop (card-runner.ts about line 760, from worktree.ts:33 and :47): issue 111, after a hunk check"]
hygiene: "Issue 85 item 2 (item 1 is PR 88). Option A of the coordinating session's check; option B is issue 109. card-runner.ts hunks: about line 1166, free; about line 2497, which waits until aidlc-94's T0-BASE-SYNC-CHANGELOG-EDGES (issue 60, edits 2491 and 2494) lands on main, then main is merged and that line edited. aidlc-a6's T1-AUDIT-FACTS-2 edits 21 and 2309-2322. Narrowed after R2 cycle 1 (candidate d4ed885), on the coordinating session's decision, to the two stops the card built: an R2 question asked whether the doc row dropping probe hid another tool stop, and it did, the PREPARE worktree-probe stop at card-runner.ts about line 760, because the same-class sweep grepped the literal makeStop('tool' and missed a stop reason passed through a variable; that stop is issue 111. Mutation sweep before the first review (docs/LESSONS.md 2026-09-24); every property of an acceptance item asserted on every case (docs/LESSONS.md 2026-09-26 T0-SHIP-MERGE-REFUSED)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-TOOL-STOP-TEXT

## Deliverable
A tool stop tells the actor the truth: the card cannot go on under this stop, and the way on is a replacement card through `aidlc goal resume --replace`; the ship's own resume marker is kept as a labelled diagnostic.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/r2-fallback.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
