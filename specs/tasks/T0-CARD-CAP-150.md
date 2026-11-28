---
id: T0-CARD-CAP-150
title: "The stop-and-ask diff limit of a card goes from about 200 lines to about 150"
status: todo
branch: T0-CARD-CAP-150
worktree: D:\wt\AIDLC\T0-CARD-CAP-150
allow_paths:
  - .claude/agents/implementer.md
  - templates/claude/agents/implementer.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - tests/surface/guard-sweep.test.ts
  - changelog.d/T0-CARD-CAP-150.md
  - specs/tasks/T0-CARD-CAP-150.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/guard-sweep.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. Both copies of `implementer.md` (`.claude/agents/`, `templates/claude/agents/`) shall hold, as the second line of step 2, `a diff over about 150 lines not mandated by the card means stop and ask.` with its three leading spaces, in place of the line that says `about 200 lines`, and no other change.
  - R2. Both copies of `card-loop.md` (`.claude/skills/aidlc-loop/`, `templates/claude/skills/aidlc-loop/`) shall say `A diff over about 150 lines the card` in place of `A diff over about 200 lines the card`, and no other change, so each copy keeps its 6,492 bytes under the 6,500-byte cap of `tests/surface/templates.test.ts`.
  - R3. The constant `STEP2_LINE2` of `tests/surface/guard-sweep.test.ts` shall hold the line of R1, and every other line of that file stays as it is.
  - R4. `changelog.d/T0-CARD-CAP-150.md` shall state the new limit, the four files that carry it, and that the 250-line budget limit of `[CARD-SIZE]` is unchanged.
acceptance:
  - 1. `tests/surface/guard-sweep.test.ts` passes with `STEP2_LINE2` at the line of R1. RED first, the constant changed alone on main fails T0-GUARD-SWEEP acceptance 1 at `onlyIndex`, because the line stands zero times in each copy. [R1] [R3] [dod arm 3]
  - 2. `git grep -n "about 200 lines" -- .claude templates` prints nothing, and each of the four files of R1 and R2 holds `about 150 lines` once (reviewer-verified against the diff). [R1] [R2]
  - 3. `npm run check:tree` passes, so `tests/surface/mirror.test.ts` holds each pair of copies equal, and `tests/surface/templates.test.ts` passes with `card-loop.md` at 6,492 bytes. [R2] [dod arm 2] [dod arm 3]
  - 4. `changelog.d/T0-CARD-CAP-150.md` follows `changelog.d/README.md` (`tests/surface/changelog-fragments.test.ts` passes) and states the three facts of R4 (reviewer-verified against the diff). [R4] [dod arm 3]
  - 5. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 30
tdd: true
sweep: "On main at d3c0c712, `git grep -n -E 'about 200|200 lines'` over the tracked tree. The rule stands in four files, `.claude/agents/implementer.md:20`, `templates/claude/agents/implementer.md:20`, `.claude/skills/aidlc-loop/card-loop.md:54` and `templates/claude/skills/aidlc-loop/card-loop.md:54`, and in one test constant, `tests/surface/guard-sweep.test.ts:32`, the anchor line of T0-GUARD-SWEEP acceptance 1. No file under `src/`, `docs/` or `README.md` states it. The other hits are another rule or history and stay as they are. They are the 200-line limit of `CLAUDE.md` (`CLAUDE.md:112`, `tests/surface/claude-md-size.test.ts`, `tests/infra/stray-processes.test.ts:643`) and the texts of past goals (`intent/loop-evidence.md:59`, `plans/reliability-baseline-2.md:3`, `specs/reliability-baseline-2.md:3`). `card-loop.md` is 6,492 bytes against a cap of 6,500 (`tests/surface/templates.test.ts:20`), and `150` is as long as `200`."
forbid: [network]
non_goals:
  - "`MAX_CODE_CARD_BUDGET` (250, `src/artifacts/card.ts:35`) and the `[CARD-SIZE]` rule of T0-CARD-SIZE. On 2026-11-28, 123 of the 144 other `todo` cards declare a budget over 150, so a lower validated limit is the owner's separate decision"
  - "the `budget: 400` example line of both card templates and `budgets about <= 400 net lines per card` of both `planner.md` copies"
  - "the 200-line limit of `CLAUDE.md`"
  - "the texts of past goals that name 200 lines"
doc_sync: none
hygiene: "Owner's instruction of 2026-11-28, the card limit goes from 200 lines to 150. The figure is instruction text an agent reads and no program reads it, so R1 and R2 are proved by the anchor constant of the existing test and by the reviewer, and no new test pins the sentence (issue 516)."
---

# T0-CARD-CAP-150

The implementer stops and asks when its diff passes about 150 lines the card does not mandate. The limit was about 200.

## Why
The owner asks for cards of 150 lines or fewer. The rule that makes an implementer stop on a larger diff says about 200 lines, in the implementer agent file and in the card-loop skill file, each with a copy under `templates/` that `aidlc init` installs.

## Deliverable
The figure 150 in the four rule files, the anchor constant of `tests/surface/guard-sweep.test.ts` at the new line, and a changelog fragment.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/guard-sweep.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: both `implementer.md` copies carry the new step 2 line, both pairs of copies are equal, and `card-loop.md` stays within its byte cap.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|

## PR summary

### What
The stop-and-ask diff limit in `implementer.md` and `card-loop.md`, both copies of each, goes from about 200 lines to about 150.

### Why / Intent
The owner's instruction of 2026-11-28.

### How / Behaviour
Text only. An implementer, here and in a repository that runs `aidlc init` after this change, stops and asks at about 150 lines the card does not mandate.

### System impact
None at runtime. No source file changes.

### Security
No change.

### Tests and review
The anchor constant of `tests/surface/guard-sweep.test.ts` follows the new line. The mirror test and the byte cap test cover the copies.

### Risk
Low. A card whose mandated diff is over 150 lines is unaffected, because the rule counts only lines the card does not mandate.

### Ownership
`.claude/agents/`, `.claude/skills/aidlc-loop/` and their `templates/` copies.

### Docs
A changelog fragment.
