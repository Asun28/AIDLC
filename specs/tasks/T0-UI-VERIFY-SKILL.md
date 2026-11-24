---
id: T0-UI-VERIFY-SKILL
title: "An optional ui-verify skill, installed by aidlc init, says how a card that changes a user-visible interface runs the app and keeps screenshots, and video when motion or timing matters"
status: todo
branch: T0-UI-VERIFY-SKILL
worktree: D:\wt\AIDLC\T0-UI-VERIFY-SKILL
allow_paths:
  - templates/claude/skills/ui-verify/SKILL.md
  - .claude/skills/ui-verify/SKILL.md
  - tests/infra/init.test.ts
  - tests/surface/templates.test.ts
  - README.md
  - docs/OPERATIONS.md
  - changelog.d/T0-UI-VERIFY-SKILL.md
  - specs/tasks/T0-UI-VERIFY-SKILL.md
dod_command: npm run typecheck && node --test tests/infra/init.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/readme.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. The skill `ui-verify` shall be one ASCII file of at most 3000 bytes, the same in both trees, that `aidlc init` installs and whose description names the interface, screenshots, video and when to use it.
  - R2. The skill shall apply only when an acceptance item asks for it or the card changes a file that the project's interface verify skill covers, and shall add no gate.
  - R3. The skill shall say what the project's own `.claude/skills/verify-<surface>/SKILL.md` holds (coverage with a sync commit, launch, drive with the project's own harness, flows with their end states, cleanup by pid), that it adds no dependency, and that it is run once before it is committed.
  - R4. The skill shall ask, for each interface acceptance item, for a capture before and after at the same viewport and data, an assertion of the end state beside the picture, and video only for motion, timing or a flow of several steps (numbered captures where no recorder exists).
  - R5. The skill shall allow made-up data only, report a flow that was not run as `Unverified`, and keep captures outside the worktree, retained after the recorded success with `aidlc evidence retain` naming goal, card and candidate digest, and taken again after a candidate that changes a covered file.
  - R6. The files `README.md` and `docs/OPERATIONS.md` shall name the skill in what `aidlc init` writes, and OPERATIONS shall say that it is optional and that the audit does not report an old capture as stale.
acceptance:
  - 1. `tests/infra/init.test.ts`, the test of an empty directory, lists `.claude/skills/ui-verify/SKILL.md`, and the pinned Setup sentence names the skill. RED on main. [R1] [R6] [dod arm 2]
  - 2. `tests/surface/templates.test.ts` gains one test of the template file; it exists, is at most 3000 bytes and ASCII, starts with `---\nname: ui-verify\n`, and its folded description, case ignored, holds each of `interface`, `screenshot`, `video` and `use when`. RED on main. [R1] [dod arm 2]
  - 3. `tests/surface/mirror.test.ts` and `tests/surface/readme.test.ts` pass with no change. [R1] [R6] [dod arm 2]
  - 4. The skill text reads as R2 to R5 say, and one OPERATIONS paragraph in Companion skills as R6 says (reviewer-verified against the diff). [R2] [R3] [R4] [R5] [R6]
  - 5. The skill was followed once from its text alone on a scratch page outside the worktree; `## Attempt evidence` holds the commands, the asserted end state, the sha256 of each capture and the steps not run (reviewer-verified against the diff). [R3] [R4] [R5]
depends_on: []
budget: 180
tdd: true
sweep: "Main at 5cdf5497, `git grep -nE 'secure-api-review|skills/grilling|skills/tdd'`: the lists of shipped skills are README.md:70-73, docs/OPERATIONS.md:13 (pinned at tests/infra/init.test.ts:168) and tests/infra/init.test.ts:29. src/scaffold/init.ts:138 copies the whole skills tree. mirror.test.ts refuses the prefix `verify-` only. A prototype of the text is 2322 bytes."
forbid: [network, a new dependency, a change under src/, a change to REVIEW.md or reviewPolicyVersion]
non_goals:
  - "a gate, a card state or a config key"
  - "`screenshot` in CANDIDATE_BOUND_KINDS, decided after a pilot"
  - "the MyInspection pilot: its own card in that repository"
  - "dispatching the verifier agent, and trigger-rate cases (issue 428)"
  - "formal verification and property-based interface tests"
hygiene: "The owner approved this card on 2026-11-24. Start after T0-SMALL-ISSUES-410-411-465, T0-BENCH-FOLLOWUPS and T1-REVIEW-FOLLOWUP-ISSUE-2 merge or stop (docs/OPERATIONS.md, README.md). templates.test.ts pins the Project verify skills section whole; leave it. Write the text in own words: an adapted pstack passage needs a notice this card does not allow. Stop by pid any browser the trial starts."
doc_sync: README.md, docs/OPERATIONS.md, changelog.d/T0-UI-VERIFY-SKILL.md
---

# T0-UI-VERIFY-SKILL

## Deliverable
One optional skill, in both trees, and the lists that name it, for the repositories that run `aidlc init`; this one has no interface.

## Why
The owner asked on 2026-11-24 for optional run, screenshot and video checks of interface changes. The SHIP rule already runs a project's `verify-*` skill; nothing shipped says how to write one for an interface.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/init.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/readme.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is the typecheck, dod arm 2 the `node --test` command.
