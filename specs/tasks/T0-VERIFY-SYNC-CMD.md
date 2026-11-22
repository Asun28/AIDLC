---
id: T0-VERIFY-SYNC-CMD
title: The Keeping in sync command of the verify-card-run-writes skill names the sync commit through the `Sync commit:` line, not a sha of its own
status: todo
branch: T0-VERIFY-SYNC-CMD
worktree: D:\wt\AIDLC\T0-VERIFY-SYNC-CMD
allow_paths:
  - .claude/skills/verify-card-run-writes/SKILL.md
  - tests/surface/templates.test.ts
  - changelog.d/T0-VERIFY-SYNC-CMD.md
  - specs/tasks/T0-VERIFY-SYNC-CMD.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
acceptance:
  - 1. `tests/surface/templates.test.ts`, describe `T1-VERIFY-SKILL`, gains a test that fails on main at 02611bbc and passes after the fix. It asserts that the section `## Keeping in sync` of `.claude/skills/verify-card-run-writes/SKILL.md` holds no hexadecimal run of 7 or more characters, names the `Sync commit:` line as the commit the diff starts from, and that its `git diff --name-only` command lists exactly the files of the `## Coverage` record, in the record's order. [dod arm 2]
  - 2. The section's command names the commit by a word the next sentence defines as the sha on the `Sync commit:` line, so moving that line at CLOSE moves the command with it. The four outcomes, the `Sync commit:` line and the other sections are unchanged; the file stays ASCII and at most 8000 bytes (the existing acceptance 1 and 2 tests). [dod arm 2]
  - 3. `changelog.d/T0-VERIFY-SYNC-CMD.md` holds the entry under this card id followed by one line feed; `git diff --numstat origin/main...HEAD -- src templates` is empty. [dod arm 3]
tdd: true
budget: 45
forbid: [any change under src/ or templates/, a change to the `Sync commit:` line, a change to the existing assertions of tests/surface/templates.test.ts]
non_goals: [moving the sync commit, changing the closure steps of card-loop.md, a script that reads the `Sync commit:` line]
hygiene: "Issue 424. The skill has no copy under templates/claude/ (CLAUDE.md, Conventions), so only .claude/ changes. The file is 7998 bytes under the 8000-byte cap; dropping the 40-character sha leaves room for the defining sentence."
doc_sync: changelog.d/T0-VERIFY-SYNC-CMD.md
---

# T0-VERIFY-SYNC-CMD

From issue 424.

## Diagnosis
`.claude/skills/verify-card-run-writes/SKILL.md`, `## Keeping in sync`, gives
`git diff --name-only 402a07f3... -- <files>` and calls that commit the sync
commit. The `Sync commit:` line has moved at each closure since (now c7ab79a9);
the command did not, because nothing ties the two. Whoever follows the section
diffs against an old commit and sees covered files as changed.

## Deliverable
The command carries no sha; it names the commit of the `Sync commit:` line, so
there is one place to move at CLOSE. A test keeps any sha out of the section and
keeps the command's file list equal to the coverage record.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new Keeping in sync test and the existing skill tests pass; the changelog fragment is well formed.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `tests/surface/templates.test.ts`, test `T0-VERIFY-SYNC-CMD: Keeping in sync names the commit of the Sync commit: line, ...`; RED before the fix: `Keeping in sync holds no commit sha; the Sync commit: line is the only one` | pass after the fix |
| 2 | Same test (the command and the `Sync commit:` reference); acceptance 1 and 2 tests of `T1-VERIFY-SKILL` (ASCII, 7994 <= 8000 bytes, four outcomes) | pass |
| 3 | `tests/surface/changelog-fragments.test.ts`; `git diff --numstat origin/main...HEAD -- src templates` | pass; empty |

Repair after R3 decision 1 (F1 hex check, F2 revision link): the test now refuses any hexadecimal run of 7 or more characters in either case and of any length, takes the revision word from the command and requires the text right after the command to define that word as the sha on the `Sync commit:` line. Mutants of the skill each fail the test: `SYNC` replaced by `HEAD`, the defining sentence reworded, an uppercase 7-character run, a 41-character run.
