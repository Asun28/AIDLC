---
id: T0-VERIFY-SKILL-REFS
title: "The Not covered list and the Shown failing record of the verify-card-run-writes skill are reference files beside SKILL.md, and each of the two sections says when to read its file"
status: merged
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

## PR summary
### What
Two long sections of the `verify-card-run-writes` skill move to reference files beside `SKILL.md`. `SKILL.md` goes from 7994 to 5525 bytes.

### Why / Intent
`SKILL.md` was 6 bytes below its 8000-byte cap. The next change to its coverage record had no room. The two sections are necessary only in special cases.

### How / Behaviour
- `references/not-covered.md` holds the list of what the check does not cover.
- `references/shown-failing.md` holds the record of one failed run, with its TAP output.
- Each section in `SKILL.md` keeps a short text that tells the reader when to read its file.

### System impact
Skill text and one test file change. No source code, no command and no state changes. `aidlc init` does not install this skill.

### Security
No new input, command or permission. The two files hold text that was in `SKILL.md` before.

### Tests and review
- One new test checks the two files and the two short sections. The DoD passes with 73 tests.
- 47 single changes to the skill files or the test's fence pattern: a test fails for each.
- The full suite passed before the review: 4097 tests, 0 failures. The repair after the review changes the new test only.

### Risk
Low. The change moves text only. A reader who does not open a reference file still gets a summary in `SKILL.md`.

### Ownership
Card `T0-VERIFY-SKILL-REFS`, goal `g-20261123090044-3aa462`, issue 430.

### Docs
No document names the two sections, so no document changes. `changelog.d/T0-VERIFY-SKILL-REFS.md` holds the entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new test and the existing tests of the skill pass, and the mirror, prose and changelog fragment tests pass.

## Attempt evidence
RED commit 3cd8e7e5 holds the change to `tests/surface/templates.test.ts` alone. The new test fails there on its first assertion, `references/not-covered.md missing beside SKILL.md`.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/surface/templates.test.ts`, test `T0-VERIFY-SKILL-REFS: the Not covered list and the Shown failing record are reference files beside SKILL.md, ...`: for each section, the file exists, opens with its title line, is ASCII and has no placeholder marker; the body in `SKILL.md` is at most 400 bytes (280 and 252), holds no run of three backticks or tildes (`FENCE`), is refused with each of eight forms of a fenced block after its last line (`FENCED`), names the file as a code span and holds `Read`, the span and `when` in that order. RED at 3cd8e7e5 | pass after the change |
| 2 | The same test: the three patterns on `references/not-covered.md`, and `/not\s+ok/i` finds nothing in `SKILL.md` | pass |
| 3 | Test `acceptance 4: Shown failing (references/shown-failing.md) names ...` reads the file; `git diff --numstat origin/main...HEAD` lists `32 2 tests/surface/templates.test.ts`, and the two deleted lines are the name of that test and the line that read the section. Acceptance 1, acceptance 2 and the `T0-VERIFY-SYNC-CMD` test pass with no line changed | pass |
| 4 | `git show 026debc9:.claude/skills/verify-card-run-writes/SKILL.md \| sed -n '54,75p'` compared with `references/not-covered.md` from its second line by `cmp`: equal; the same with `sed -n '78,98p'` and `references/shown-failing.md`: equal. `git diff -U0 origin/main...HEAD -- .claude/skills/verify-card-run-writes/SKILL.md` has two hunks, `-54,22 +54,4` and `-78,21 +60,4`, which are the two bodies | pass; what each body says is for the reviewer |
| 5 | DoD arm 1 exit 0; `tests/surface/mirror.test.ts` and `tests/surface/prose.test.ts` are not in the diff and pass; `tests/surface/changelog-fragments.test.ts` passes; DoD tests: 73, 73 pass, 0 fail | pass; the text of the fragment is for the reviewer |

Each requirement clause and the assertion that fails without it:

| Clause | Assertion |
|---|---|
| R1 and R2, the file exists | item 1, `existsSync` |
| R1 and R2, the title line | item 1, `startsWith` |
| R1 and R2, the lines of main, byte for byte, nothing after them | item 4, the two `cmp` runs (reviewer-verified); item 2 for the three terms of the list; `acceptance 4` for the src/ file, the covered function and the TAP excerpt of the record |
| R3, the heading line stays | acceptance 2 of the describe, the ten headings; the new test reads each body by its heading |
| R3, at most 400 bytes | item 1, the byte count |
| R3, no code fence | item 1, `FENCE` on each body and the eight `FENCED` forms on each body |
| R3, the sentence with `Read`, the file as a code span, `when` | item 1, the span check and the phrase check |
| R3, says what the file holds | item 4 (reviewer-verified) |
| R4 | acceptance 2 of the describe, unchanged |
| R5 | item 4, the two hunks (reviewer-verified); acceptance 1, acceptance 3 and the `T0-VERIFY-SYNC-CMD` test for the front matter, the coverage record and Keeping in sync |
| R6 | item 1, the ASCII check and the four markers |
| R7 | item 5 (reviewer-verified) and the fragment test |

Changes, each made alone to one of the three skill files or to the test file, run against `tests/surface/templates.test.ts`, then restored. 43 changes to the skill files and 4 to the fence pattern of the test, and a test fails for each; the unchanged files and the two bodies padded to exactly 400 bytes pass:

| Change | Test that fails |
|---|---|
| `references/not-covered.md` removed | the new test |
| `references/shown-failing.md` removed | the new test and acceptance 4 |
| a title line with two hashes; a title line in another case | the new test |
| a non-ASCII character in either file | the new test |
| `TODO` or `TBD` in the list; `FIXME` or an angle placeholder in the record | the new test |
| either body padded to 401 bytes | the new test |
| a code fence in a body | the new test |
| each of eight forms of a fenced block after the last line of either body, 16 changes: three backticks, three tildes, four backticks, five tildes, three backticks indented with an info string, three tildes indented, tildes in a list item, backticks in a block quote | the new test |
| the `FENCE` pattern of the test loosened to backticks only, to tildes only, to the line start, to a run of four | the new test, on a `FENCED` form |
| the file named without a code span; the other file named | the new test |
| `See` in place of `Read`; `if` in place of `when`; words between `Read` and the file | the new test |
| the list without the lease, without the review queue, without more than one fault per run | the new test |
| `NOT  OK` in capitals with two spaces in `SKILL.md`; `not` and `ok` on two lines | the new test |
| the `SKILL.md` body without the lease | acceptance 2 |
| the record without its `not ok` lines, without a covered function, without a src/ file | acceptance 4 |

Verify skill `verify-card-run-writes`: the card changes no file of the coverage record (`tests/scenarios/fault-points.test.ts`, `src/loop/card-runner.ts`, `src/state/goal-store.ts`, `src/state/store.ts`, `src/state/journal.ts`), so the check and the sync commit are not involved.

Repair after R3 decision 1 (F1, class tilde-fence-not-rejected): the test refused a fence of backticks only. It now refuses any run of three or more backticks or tildes in a section body, and it asserts for each of the two bodies that eight forms of a fenced block, put after the last line of the body, are refused. At the candidate of decision 1 (263c39b3) the eight changes with a tilde fence passed the test; each fails it now. The check has one site, the new test; the helper `fences` of the describe finds the fenced blocks that acceptance 2 and acceptance 4 ask for and refuses nothing.

Each form a section body can hold, and what covers it:

| Form | Covered by |
|---|---|
| a fence of three backticks or of three tildes | `FENCED` forms 1 and 2 on each body; the changes of the table above |
| a longer run: four backticks, five tildes | `FENCED` forms 3 and 4 |
| an indented fence, with or without an info string | `FENCED` forms 5 and 6 |
| a fence in a list item or in a block quote | `FENCED` forms 7 and 8 |
| code spans of one backtick, no fence | the two bodies of the candidate pass |
| a code block of indented lines, with no delimiter | not a fence, so outside R3; the 400-byte bound holds for it |
| an HTML element such as pre | acceptance 1 of the describe refuses an angle-bracket tag anywhere in `SKILL.md` |

Full suite, run once on the candidate skill files, test file and changelog fragment, before this section was written and before the repair, which changes `tests/surface/templates.test.ts` and this card file only: `npm test` exit 0, 4097 tests, 4065 pass, 0 fail, 32 skipped.

Size: 86 lines added and 45 deleted before this card file, against the budget of 200.
