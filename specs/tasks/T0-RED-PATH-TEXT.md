---
id: T0-RED-PATH-TEXT
title: "card-loop.md BUILD and the BUILD directive name `card attempt --red-receipt` as the way to record RED, and `aidlc card red` for the scaffold ship path only"
status: todo
branch: T0-RED-PATH-TEXT
worktree: D:\wt\AIDLC\T0-RED-PATH-TEXT
allow_paths:
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - src/loop/card-runner.ts
  - tests/scenarios/build-red-narration.test.ts
  - tests/scenarios/dispute-running-attempt.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-RED-PATH-TEXT.md
  - specs/tasks/T0-RED-PATH-TEXT.md
dod_command: npm run typecheck && node --test tests/scenarios/build-red-narration.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/accept-table.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. In both copies of `card-loop.md` (`.claude/skills/aidlc-loop/` and `templates/claude/skills/aidlc-loop/`), the first sentence of BUILD shall read ``TDD: prove behavioral RED first (`card attempt --red-receipt`; scaffold: `card red`).`` (line breaks may fall anywhere a space stands). The rest of the file is unchanged apart from line breaks; the two copies stay identical, ASCII, and at most 6500 bytes.
  - R2. The BUILD directive that `CardRunner` returns for a `tdd: true` card with no RED receipt shall, when `this.shipPath` is not a `ScaffoldShipPath`, carry the narration `<prefix><label> at effort <effort>: establish behavioural RED first, then implement within allow_paths and run the DoD. Record the result with `aidlc card attempt <id> --outcome success --dod-receipt "<command: exit code and counts>" --red-receipt "<sha>:<test>"` or `aidlc card attempt <id> --outcome fail --cause ...`. <ACCEPTANCE_TABLE>`.
  - R3. When `this.shipPath` is a `ScaffoldShipPath` (the test `src/loop/card-runner.ts:1432` already uses), that narration shall read `<prefix><label> at effort <effort>: establish behavioural RED first with `aidlc card red <id>` (task.ps1 -Phase red writes .review/<id>.red), then implement within allow_paths and run the DoD.` followed by the record sentence and the table of main, unchanged.
  - R4. `aidlc card red` shall keep its refusal on the `github` and `dry-run` ship paths, and every other narration shall stay as on main.
  - R5. `docs/OPERATIONS.md`, in the paragraph that opens "A success attempt on a `tdd: true` card is refused when neither the stored run nor the attempt carries a RED receipt", and `changelog.d/T0-RED-PATH-TEXT.md` shall state that on the `github` and `dry-run` ship paths the RED receipt is recorded with `--red-receipt "<sha>:<test>"` on `aidlc card attempt`, that `aidlc card red <id>` records it on the scaffold ship path only, and that the BUILD directive names the one for the configured ship path.
acceptance:
  - 1. `tests/scenarios/build-red-narration.test.ts`, a new file, `makeFixture` (dry-run ship path). A `tdd: true` card driven to its first BUILD directive has a narration equal to R2 for that card, which holds `--red-receipt "<sha>:<test>"` and no `task.ps1`. RED on main, whose narration names only `task.ps1 -Phase red`. [R2] [dod arm 2]
  - 2. Same file. The same card with a `CardRunner` whose `shipPath` is a `ScaffoldShipPath` (a subclass whose `readRedReceipt` returns no receipt is allowed) has a narration that holds ``establish behavioural RED first with `aidlc card red <id>` (task.ps1 -Phase red writes .review/<id>.red)`` and no `--red-receipt`. RED on main, whose narration does not name `aidlc card red`. [R3] [dod arm 2]
  - 3. Same file. Each copy of `card-loop.md`, with runs of white space read as one space, holds the R1 sentence and does not hold ``(`aidlc card red <id>`; scaffold: task.ps1``. RED on main. [R1] [dod arm 2]
  - 4. In `tests/scenarios/dispute-running-attempt.test.ts` only the constant `BEFORE_RED` (line 427) changes, to the R2 narration for card `T0-DRA`; every assertion that uses it passes. `accept-table`, `dod-receipt-required` and `t0-flow`, which match the prefix `establish behavioural RED first`, pass with no change. [R2] [R4] [dod arms 3, 4, 5, 6]
  - 5. `tests/surface/templates.test.ts` (the 6500-byte cap and ASCII rule of card-loop.md) and `tests/surface/mirror.test.ts` (the two copies) pass with no change. [R1] [dod arms 7, 8]
  - 6. The OPERATIONS.md sentence and the fragment say what R5 says (reviewer-verified against the diff); the fragment has the form of `changelog.d/README.md` and the prose test passes. [R5] [dod arms 9, 10]
depends_on: []
budget: 120
tdd: true
sweep: "On main at aecf88e4. `git grep -n -E 'card red|red-receipt|Phase red' -- src docs README.md .claude templates tests`: the wrong instruction stands in both card-loop.md copies at line 48; `tdd/SKILL.md:62-63` and `diagnose/SKILL.md:31` (both copies) already name `--red-receipt` with the scaffold exception; `docs/OPERATIONS.md:98` already states the refusal of `card red` off the scaffold path; the BUILD narration is `src/loop/card-runner.ts:1454`, pinned in full only by `tests/scenarios/dispute-running-attempt.test.ts:427` and by its prefix in accept-table:34, dod-receipt-required:349 and t0-flow:1044. card-loop.md is 6494 of its 6500 bytes; the R1 parenthetical (52 bytes) replaces one of 54."
forbid: [a change to src/cli/main.ts, a change to the byte caps in tests/surface/templates.test.ts, a change to another existing test file or to another line of dispute-running-attempt.test.ts, a change to the tdd or diagnose skills]
non_goals:
  - "option 1 of issue 437: `aidlc card red` recording a RED receipt on the github and dry-run ship paths"
  - a `--goal` option on `aidlc card red`
  - the narration of a BUILD directive that already has a RED receipt, or of a repair
diagnosis:
  root_cause: "`card-loop.md:48` (both copies) names `aidlc card red <id>` as the way to prove RED, with task.ps1 as the scaffold variant. `src/cli/main.ts:950-965` registers `card red` as a scaffold phase that exits 1 on any other ship path, so on the `github` path this repository uses the instruction cannot be followed. The BUILD narration at `src/loop/card-runner.ts:1454` names only `task.ps1 -Phase red`, also scaffold-only, and no command that records RED on other paths."
  same_class: "The tdd and diagnose skills name `--red-receipt` correctly; OPERATIONS.md:98 states the refusal. The repair narration at card-runner.ts:3476 (`Establish the RED receipt again`) names no command and stays as it is."
hygiene: "Issue 437, found while running T0-AMEND-DELTA (PR 436), whose implementer ran `card red` first and fell back to `--red-receipt`. Option 2 of the issue: one write path for the receipt."
doc_sync: changelog.d/T0-RED-PATH-TEXT.md
---

# T0-RED-PATH-TEXT

From issue 437.

## Diagnosis
card-loop.md BUILD tells the implementer to run `aidlc card red <id>`, which refuses on every ship path but scaffold; this repository ships on `github`. The BUILD directive names only the scaffold's `task.ps1 -Phase red`. Neither names `--red-receipt` on `aidlc card attempt`, the one way to record RED off the scaffold path.

## Deliverable
card-loop.md BUILD names `card attempt --red-receipt` and, for scaffold, `card red`. The BUILD directive names the command for the configured ship path: `--red-receipt "<sha>:<test>"` in the success command off scaffold, `aidlc card red <id>` on scaffold.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/build-red-narration.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/accept-table.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, the pinned narration follows R2, the other narration tests pass unchanged, and card-loop.md stays within its cap and identical in both copies.
