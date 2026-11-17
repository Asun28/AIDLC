---
id: T0-GUARD-SWEEP
title: Before the first review the implementer loosens each guard its change adds, one at a time, and sees a test fail, as both copies of implementer.md (step 2 and the report) and a new Guards section of both copies of the tdd skill say
status: merged
branch: T0-GUARD-SWEEP
worktree: D:\wt\AIDLC\T0-GUARD-SWEEP
allow_paths:
  - .claude/agents/implementer.md
  - templates/claude/agents/implementer.md
  - .claude/skills/tdd/SKILL.md
  - templates/claude/skills/tdd/SKILL.md
  - tests/surface/guard-sweep.test.ts
  - changelog.d/T0-GUARD-SWEEP.md
  - specs/tasks/T0-GUARD-SWEEP.md
dod_command: npm run typecheck && node --test tests/surface/guard-sweep.test.ts tests/surface/loop-evidence-docs.test.ts tests/infra/stray-processes.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. `.claude/agents/implementer.md` and its byte-identical copy `templates/claude/agents/implementer.md` shall carry the two lines G1 of Acceptance detail 1 directly after the second line of step 2 (`   a diff over about 200 lines not mandated by the card means stop and ask.`) and before the line that starts `3. Run`, and the two lines G2 of Acceptance detail 1 directly after the line `  checks gained/lost, next hypothesis.`; every other byte stays as on main, and both files stay ASCII.
  - R2. `.claude/skills/tdd/SKILL.md` and its byte-identical copy `templates/claude/skills/tdd/SKILL.md` shall carry the section of Acceptance detail 2, followed by one blank line, directly before the line `## Anti-patterns (a fake RED)` (so after the line `  placement (new units get new files).` and its blank line); every other byte stays as on main, and each file stays within the 3500-byte cap of tests/surface/templates.test.ts (2998 bytes on main, 3441 with the section).
  - R3. The new `changelog.d/T0-GUARD-SWEEP.md` shall hold the entry of Acceptance detail 3 followed by one line feed.
acceptance:
  - 1. tests/surface/guard-sweep.test.ts (new), test "T0-GUARD-SWEEP acceptance 1 - both implementer copies carry the guard sweep in step 2 and in the report". The two files are byte-equal and ASCII; the two lines after the second line of step 2 equal G1 and the line after them starts `3. Run`; the two lines after `  checks gained/lost, next hypothesis.` equal G2 and the line after them is `Do not claim done; the loop verifies and ships.`. Fails on main by assertion. [R1] [dod arm 2]
  - 2. Same file, test "T0-GUARD-SWEEP acceptance 2 - both tdd skill copies carry the Guards section between Seams and Anti-patterns within the cap". The two files are byte-equal; the lines from `## Guards` to the line before the next blank line equal the section of Acceptance detail 2, compared whole; the two lines before `## Guards` are `  placement (new units get new files).` and an empty line; the two lines after the section are an empty line and `## Anti-patterns (a fake RED)`; each file is at most 3500 bytes. Fails on main by assertion. [R2] [dod arm 2]
  - 3. Same file, test "T0-GUARD-SWEEP acceptance 3 - the fragment holds its entry". `fragmentEntry(root, 'T0-GUARD-SWEEP')` (tests/infra/changelog.ts) equals the entry of Acceptance detail 3, compared whole. Fails on main (no file). [R3] [dod arm 2]
  - 4. tests/surface/loop-evidence-docs.test.ts (I1 after step 3 of both implementer copies), tests/infra/stray-processes.test.ts (I1 after step 6, then an empty line and `Report (compact`; the implementer copies equal and ASCII), tests/surface/templates.test.ts (the tdd cap of 3500; the implementer points at the tdd skill), tests/surface/mirror.test.ts, tests/surface/prose.test.ts and tests/surface/changelog-fragments.test.ts pass with no line changed. [R1] [R2] [R3] [dod arm 2]
  - 5. `npm run typecheck` exits 0. [dod arm 1]
depends_on: [T1-CHANGELOG-FRAGMENTS]
budget: 120
tdd: true
sweep: "Pins of the changed files, by grep over tests, src, evals and scripts at 7089a843: tests/surface/loop-evidence-docs.test.ts:67-75 (the four I1 lines after step 3 of both implementer copies, then step 4), tests/infra/stray-processes.test.ts:631-651 (the seven I1 lines after step 6, then an empty line and the line that starts `Report (compact`; the copies byte-equal and ASCII), tests/surface/templates.test.ts:137 (tdd cap 3500) and :152 (the implementer names .claude/skills/tdd/SKILL.md), tests/surface/mirror.test.ts (templates/claude equals .claude), tests/surface/prose.test.ts:100-116 (phrases removed from agent prompts, among them double-check and re-verify). No test pins `2. GREEN`, `## Seams`, `## Anti-patterns (a fake RED)` or the report bullet. The tdd skill is 2998 bytes on main."
forbid: [weakening or skipping a test to go green, a change under src/, a change to an agent file other than implementer.md, a change to the aidlc-loop skill files, a change to REVIEW.md or the review policy, a change to CHANGELOG.md]
non_goals: [a card-machine receipt or gate for the sweep, a planner ready-check that each requirement clause has an acceptance row, `aidlc card mutants` coverage outside src/, docs/OPERATIONS.md]
hygiene: "Source: the consult of 2026-11-17 on the next goal (Fable 5.2 at xhigh, owner-requested) and `aidlc review stats`. Of the 40 most recently reviewed cards, 21 were blocked at least once, and 6 of their 33 blocking R3 decisions (5 cards) held only untested-guard findings; T1-CHANGELOG-FRAGMENTS spent R3 decisions 1 and 2 on such findings although the T1-OUTCOME-ESCAPED lesson about them was in its directive. The Seams rule of the tdd skill (`No test at a seam the card does not name`) stays: a guard the change adds belongs to the seam of the acceptance item it serves, which the new section says. After the merge, count guard-only blocks in the next 20 reviewed cards; two or more means a card-machine receipt is the next step. The implementer model changed on the same day (T1-IMPLEMENTER-MODEL), so count that class alone."
doc_sync: "none: docs/OPERATIONS.md describes the loop's commands, state and agent models, the procedure text is in the agent and skill files this card changes, and the fragment records the change."
---

# T0-GUARD-SWEEP

## Deliverable
Before a candidate goes to its first review, the implementer loosens each guard its change adds, one at a time, runs that guard's test file, sees a test fail and restores the guard; a guard no test catches gets an assertion at the seam of the acceptance item it serves. Both copies of `implementer.md` say so in step 2 and in the report, and both copies of the tdd skill say how in a new `## Guards` section.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/guard-sweep.test.ts tests/surface/loop-evidence-docs.test.ts tests/infra/stray-processes.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Acceptance detail

### 1. G1 and G2 (both implementer copies)
G1, the two lines after the second line of step 2 (three spaces of indent, as the step's continuation line):
```
   Then sweep each guard the change adds, as the tdd skill's Guards section
   says, and list the sweep in the card's Attempt evidence table.
```
G2, the two lines after `  checks gained/lost, next hypothesis.`:
```
- the guard sweep: each guard the change adds, its loosened form and the
  test that failed, or `equivalent:` and why no input can tell them apart.
```

### 2. The Guards section (both tdd skill copies)
```
## Guards
A guard the change adds (a bound or comparison, a regex class, quantifier
or anchor, an early return, a filter, sort or dedupe) is behaviour of the
acceptance item it serves: test it at that item's seam. Before the first
review, loosen each guard in turn, run its test file, see a test fail,
then restore it. A guard no test catches gets an assertion there; a
loosened form no input can detect is recorded as `equivalent:` with why.
```

### 3. The fragment entry (`changelog.d/T0-GUARD-SWEEP.md`, one line and one line feed)
```
- T0-GUARD-SWEEP: before the first review the implementer loosens each guard its change adds, one at a time, and sees a test fail. Both copies of `implementer.md` add the sweep to step 2 and to the report, and both copies of the tdd skill gain a `## Guards` section: a guard the change adds (a bound or comparison, a regex class, quantifier or anchor, an early return, a filter, sort or dedupe) is tested at the seam of the acceptance item it serves, each guard is loosened in turn and its test file run until a test fails, then restored, and a loosened form no input can detect is recorded as `equivalent:`. Of the 40 most recently reviewed cards before this change, 6 of 33 blocking R3 decisions held only untested-guard findings.
```

## Attempt evidence

RED: commits 02fb13c9 (test) and b8974c05 (typecheck fix of the same test, no assertion changed); `node --test tests/surface/guard-sweep.test.ts` on the unchanged files: tests 3, pass 0, fail 3 (acceptance 1: AssertionError "G1 follows the second line of step 2"; acceptance 2: AssertionError "\"## Guards\" stands once"; acceptance 3: ENOENT, no `changelog.d/T0-GUARD-SWEEP.md`).

| Item | Proving test or command | Result |
| --- | --- | --- |
| 1 | tests/surface/guard-sweep.test.ts, "T0-GUARD-SWEEP acceptance 1 - ..." | pass (red on main) |
| 2 | tests/surface/guard-sweep.test.ts, "T0-GUARD-SWEEP acceptance 2 - ..." | pass (red on main) |
| 3 | tests/surface/guard-sweep.test.ts, "T0-GUARD-SWEEP acceptance 3 - ..." | pass (red on main, no file) |
| 4 | loop-evidence-docs, stray-processes, templates, mirror, prose, changelog-fragments tests (dod arm 2), no line changed | pass |
| 5 | `npm run typecheck` (dod arm 1) | exit 0 |

Revert table: each change made alone, `node --test tests/surface/guard-sweep.test.ts` run, the file restored.

| Row | Scratch change | Red test (first failing assertion) |
| --- | --- | --- |
| a | delete G1 from `.claude/agents/implementer.md` | acceptance 1 (the copies are byte-equal) |
| a2 | delete G1 from both implementer copies | acceptance 1 (G1 follows the second line of step 2) |
| b | delete G2 from both implementer copies | acceptance 1 (G2 follows the report bullet) |
| c | change one byte of G1 in the template copy only (sweep to swept) | acceptance 1 (the copies are byte-equal) |
| d | move the Guards section after Anti-patterns, both copies | acceptance 2 (Seams ends right before Guards) |
| e | pad the `.claude` tdd copy to 3501 bytes | acceptance 2 (the copies are byte-equal) |
| e2 | pad both tdd copies to 3501 bytes | acceptance 2 (at most 3500 bytes, is 3501) |
| f | change one word of the fragment (one to each) | acceptance 3 (strict equality) |
| g | add a CR before a line feed in the template tdd copy | acceptance 2 (the copies are byte-equal) |
| g2 | add a CR before a line feed in both implementer copies | acceptance 1 (LF line endings only) |

Guard sweep: the change adds no code guard (text only); every row above turned a test red, none is `equivalent:`.

Note: the tdd skill comes to 3442 bytes, not the 3441 R2 states: 2998 on main plus the section's 7 lines (436 characters and 7 line feeds) and the blank line after it is 3442; the section matches Acceptance detail 2 byte for byte, and the 3500 cap holds.
