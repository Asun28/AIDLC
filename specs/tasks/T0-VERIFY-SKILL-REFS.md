---
id: T0-VERIFY-SKILL-REFS
title: "The Not covered list and the Shown failing record of the verify-card-run-writes skill are reference files beside SKILL.md, and each of the two sections says when to read its file"
status: todo
branch: T0-VERIFY-SKILL-REFS
worktree: D:\wt\AIDLC\T0-VERIFY-SKILL-REFS
allow_paths:
  - .claude/skills/verify-card-run-writes/SKILL.md
  - .claude/skills/verify-card-run-writes/references/not-covered.md
  - .claude/skills/verify-card-run-writes/references/shown-failing.md
  - tests/surface/templates.test.ts
  - changelog.d/T0-VERIFY-SKILL-REFS.md
  - specs/tasks/T0-VERIFY-SKILL-REFS.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `.claude/skills/verify-card-run-writes/references/not-covered.md` shall hold the line `# Not covered` and then lines 54 to 75 of `.claude/skills/verify-card-run-writes/SKILL.md` on main at 026debc9, which are the body of its section `## Not covered`, byte for byte and with nothing after them.
  - R2. `.claude/skills/verify-card-run-writes/references/shown-failing.md` shall hold the line `# Shown failing` and then lines 78 to 98 of that file on main at 026debc9, which are the body of its section `## Shown failing`, byte for byte and with nothing after them.
  - R3. In `SKILL.md` each of the two sections shall keep its heading line, with a body of at most 400 bytes and no code fence that says what its reference file holds and carries one sentence made of `Read`, the file as the code span `references/not-covered.md` or `references/shown-failing.md`, `when` and the case in which to read it.
  - R4. The body of `## Not covered` in `SKILL.md` shall still name the lease, the review queue and more than one fault per run.
  - R5. Every line of `SKILL.md` outside those two bodies shall stay as on main at 026debc9.
  - R6. Each reference file shall be ASCII and free of the four placeholder markers that acceptance 1 of `T1-VERIFY-SKILL` refuses in `SKILL.md`.
  - R7. `changelog.d/T0-VERIFY-SKILL-REFS.md` shall state that the Not covered list and the Shown failing record are reference files beside `SKILL.md`, that each of the two sections of `SKILL.md` says when to read its file, and the size of `SKILL.md` before and after.
acceptance:
  - 1. `tests/surface/templates.test.ts`, describe `T1-VERIFY-SKILL`, gains one test whose name begins with `T0-VERIFY-SKILL-REFS`. For each of the two sections it asserts that the reference file exists beside `SKILL.md`, opens with its title line, is ASCII and carries none of the four placeholder markers, and that the body of the section in `SKILL.md` is at most 400 bytes, holds no code fence, names the file as a code span and holds `Read`, that code span and `when` in that order once runs of white space are one space. RED on main at 026debc9, where neither file exists. [R1] [R2] [R3] [R6] [dod arm 2]
  - 2. The same test asserts that `references/not-covered.md` matches the three patterns that acceptance 2 of the describe applies to the section (the lease, the review queue, more than one fault per run), and that `SKILL.md` holds no `not ok` in any case and with any white space between the two words, so the TAP excerpt is in the reference file only. [R1] [R2] [dod arm 2]
  - 3. The existing test `acceptance 4` reads `references/shown-failing.md` in place of the section, its name says so, and its assertions are otherwise as on main. Every other existing test of the describe passes with no line changed, among them acceptance 1 (8000 bytes, ASCII, placeholders), acceptance 2 (the ten headings, and the three patterns on the `## Not covered` body of `SKILL.md`) and the `T0-VERIFY-SYNC-CMD` test. [R2] [R3] [R4] [dod arm 2]
  - 4. The two reference files hold the lines R1 and R2 name, byte for byte, each section body in `SKILL.md` says what its file holds, and `git diff origin/main...HEAD -- .claude/skills/verify-card-run-writes/SKILL.md` shows no changed line outside the two bodies (reviewer-verified against the diff). [R1] [R2] [R3] [R5]
  - 5. `tests/surface/mirror.test.ts` and `tests/surface/prose.test.ts` pass with no change, the typecheck reports no error, and `changelog.d/T0-VERIFY-SKILL-REFS.md` says what R7 says (reviewer-verified against the diff) in the form of `changelog.d/README.md`. [R6] [R7] [dod arms 1, 3, 4, 5]
depends_on: []
budget: 200
tdd: true
sweep: "On main at 026debc9. `git grep -n -E 'Shown failing|Not covered' -- . ':!specs' ':!CHANGELOG.md' ':!docs/LESSONS.md'` finds the two headings of SKILL.md (lines 53 and 77) and tests/surface/templates.test.ts (lines 383, 429 to 432 and 482 to 489), so no document and no other test names either section. `git grep -n 'verify-card-run-writes' -- tests docs src templates README.md CLAUDE.md` finds tests/surface/templates.test.ts, tests/surface/mirror.test.ts:52, which already reads a file below a verify skill directory as part of that skill, a comment at tests/scenarios/fault-points.test.ts:122 and docs/OPERATIONS.md:751, which names the skill and its check only. `git ls-files '.claude/skills/*/references/*' 'templates/claude/skills/*/references/*'` is empty, so these are the first reference files of a skill here. A trial of this change on main at 026debc9, in a worktree that was discarded, gave SKILL.md at 5525 bytes (7994 before), section bodies of 280 and 252 bytes and reference files of 1397 and 1630 bytes; the new test failed without the reference files on `references/not-covered.md missing beside SKILL.md`, and the typecheck and the templates, mirror and prose test files passed with the change."
forbid:
  - a copy of the skill or of a reference file under templates/claude/
  - weakening or skipping a test to go green
non_goals:
  - "a change to the 8000-byte cap of acceptance 1, or a second, lower cap"
  - "moving any other section of the skill to a reference file"
  - "a rule about reference files in card-loop.md, docs/OPERATIONS.md or CLAUDE.md: no document names either section"
  - "moving the sync commit: the card changes no file of the coverage record"
  - "trigger-rate cases for the skill (issue 428) and reasons for its rules (issue 429)"
hygiene: "Issue 430, found by checking the repository skills against the skill-creator guide (Progressive Disclosure). The skill has no copy under templates/claude/ (CLAUDE.md, Conventions), and tests/surface/mirror.test.ts exempts every file below .claude/skills/verify-*/ from the shipped-by-templates check, so the reference files exist under .claude/ only. Check of R1 and R2 at the candidate: `git show 026debc9:.claude/skills/verify-card-run-writes/SKILL.md | sed -n '54,75p'` equals references/not-covered.md from its second line, and the same with `sed -n '78,98p'` equals references/shown-failing.md from its second line. RED is the new test alone, which fails on its first assertion."
doc_sync: changelog.d/T0-VERIFY-SKILL-REFS.md
---

# T0-VERIFY-SKILL-REFS

From issue 430.

## Deliverable
`.claude/skills/verify-card-run-writes/SKILL.md` is 7994 bytes against its
8000-byte cap, so the next write or command added to its coverage record has
no room. Two of its sections are needed only in specific cases and load on
every use: the list of what the check does not cover, and the record of one
scratch break with its TAP excerpt. Both texts move, byte for byte, to
reference files beside `SKILL.md`. Each section stays in `SKILL.md` with a
short body that says what its file holds and when to read it. In the trial
`SKILL.md` came to 5525 bytes.

## Rules that decide edge cases
- The cap in the test stays 8000 bytes, and the card adds no lower cap.
- The body of `## Not covered` in `SKILL.md` keeps the three terms its test pins, so that test does not change.
- After this card, a card that adds a command the check does not drive edits `references/not-covered.md`, not `SKILL.md`.
- No document names either section, so no document changes; the changelog fragment records the move.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new test and the existing tests of the skill pass, and the mirror, prose and changelog fragment tests pass.
