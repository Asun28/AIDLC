---
id: T1-INIT-HOOK-LOCAL-DOCS
title: README.md and docs/OPERATIONS.md describe the local settings file that aidlc init writes on a repository with no aidlc package, and the three tests that pin the old sentences pin the new ones
status: todo
branch: T1-INIT-HOOK-LOCAL-DOCS
worktree: D:\wt\AIDLC\T1-INIT-HOOK-LOCAL-DOCS
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - README.md
  - docs/OPERATIONS.md
  - tests/surface/readme.test.ts
  - tests/surface/init-no-package.test.ts
  - specs/tasks/T1-INIT-HOOK-LOCAL-DOCS.md
dod_command: npm run typecheck && node --test tests/surface/readme.test.ts tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/hook-lazy.test.ts tests/surface/init-base-ci.test.ts
dod_exit: 0
requirements:
  - R1. The paragraph of README.md that begins `.claude/settings.json` holds a `permissions.deny` list (:95) shall read the text of acceptance detail 1, and `README_SENTENCES[1]` of tests/surface/readme.test.ts (:52) pins that text.
  - R2. The paragraph of docs/OPERATIONS.md that begins `--no-hooks` writes (:15) shall read the text of acceptance detail 2, and `SETUP_SENTENCE` of tests/surface/readme.test.ts (:57) pins that text.
  - R3. The paragraph of docs/OPERATIONS.md that begins `On a repository with no Node package` (:325) shall read the text of acceptance detail 3 on one line, still after the paragraph that begins `A PowerShell tool call is under the same rule`, and `paragraph` of tests/surface/init-no-package.test.ts (:320) pins that text.
  - R4. Every other line of the two documents and of the two test files shall stay as it is.
acceptance:
  - 1. `tests/surface/readme.test.ts`, test "T1-INIT-SURFACE acceptance 6: the README section, OPERATIONS Setup and Unreleased carry the exact text" (:80; its name ends with a requirement tag of its own card, left out here): the literal `README_SENTENCES[1]` (:52) is the text of acceptance detail 1 and the literal `SETUP_SENTENCE` (:57) the text of acceptance detail 2; the test's own lines and its other literals are unchanged. Fails on main for the two new texts. [R1] [R2] [dod arm 2]
  - 2. `tests/surface/init-no-package.test.ts`, test "T1-INIT-HOOK-PATH acceptance 7: OPERATIONS and the CHANGELOG hold the exact texts" (:319; its name ends with two requirement tags of its own card, left out here): the literal `paragraph` (:320) is the text of acceptance detail 3; the `entry` literal (:325), which is the CHANGELOG entry of T1-INIT-HOOK-PATH, and every other line are unchanged. Fails on main for the new paragraph. [R3] [dod arm 2]
  - 3. tests/infra/init.test.ts (its :168-185 pin the two Setup sentences as adjacent and the upgrade paragraph), tests/surface/readme.test.ts "T1-INIT-SURFACE acceptance 2" (:60, the README path list against `initProject({ target })`) and its check that neither document holds `so no guard runs` (:85), tests/surface/ps-guard-wire.test.ts (:139-147), tests/surface/hook-lazy.test.ts (:210), tests/surface/init-base-ci.test.ts (:394), tests/surface/prose.test.ts and tests/surface/templates.test.ts pass with no line changed. They pass on main and with this card. [R4] [dod arm 2]
  - 4. Each sentence of the three texts holds against src/scaffold/init.ts and src/probes/hook-wiring.ts as T1-INIT-HOOK-LOCAL and T1-HOOK-WIRING-LOCAL left them, and the diff changes only the three paragraphs and the three literals (reviewer-verified against the diff). [R4]
depends_on: [T1-INIT-HOOK-LOCAL, T1-CHANGELOG-FRAGMENTS]
budget: 40
tdd: true
sweep: "On main at 35de54fe. `grep -rnE 'no Node package|per machine|writes the same files|not wired|settings\\.json' tests docs README.md`. The three paragraphs and their pins: README.md:95, pinned whole by tests/surface/readme.test.ts:52 (`README_SENTENCES[1]`, checked with `includes` inside the section What aidlc init writes at :81); docs/OPERATIONS.md:15, pinned by readme.test.ts:57 (`SETUP_SENTENCE`, checked with `includes` inside the section Setup at :84); docs/OPERATIONS.md:325, pinned as one whole line after the PowerShell paragraph by tests/surface/init-no-package.test.ts:320-323. Pins that stay: readme.test.ts:51 (`README_SENTENCES[0]`), :53-54, :56 (`SETUP_USAGE`), :58 (the CHANGELOG entry of T1-INIT-SURFACE, a record of that card), :60-69 (the README path list against `initProject({ target })`, which passes no `hookEntry`, so it holds no `.claude/settings.local.json`), :85 (neither document may hold `so no guard runs`); tests/infra/init.test.ts:167-185 (the Setup list sentence, its `.review/` sentence, adjacent, and the upgrade paragraph); tests/surface/ps-guard-wire.test.ts:139-147 and tests/surface/hook-lazy.test.ts:210 (sentences of the section Hooks that this card does not touch); tests/surface/init-base-ci.test.ts:394 (the default-branch paragraph); init-no-package.test.ts:325 (the CHANGELOG entry of T1-INIT-HOOK-PATH, a record of that card). tests/surface/prose.test.ts sizes the section Sessions (:326-359), which this card does not touch. The three old texts are false after T1-INIT-HOOK-LOCAL: `--no-hooks` no longer writes the same files as a plain init on a repository with no aidlc package, the hook entries are no longer in `.claude/settings.json` there, and on another machine doctor prints `not wired`, not `FAILED`."
forbid:
  - weakening, skipping or deleting a test to go green
  - a change to a test line other than the three literals of acceptance 1 and 2
  - a change to the README path list, to `README_SENTENCES[0]`, to `SETUP_USAGE`, to the Setup list sentence or to a CHANGELOG entry; the card changes no byte of CHANGELOG.md
  - the text `so no guard runs` in either document (tests/surface/readme.test.ts:85)
  - a line break inside the paragraph of acceptance detail 3 (the test finds it as one line)
  - a change under src
non_goals:
  - a changelog entry; the fragment changelog.d/T1-INIT-HOOK-LOCAL.md of T1-INIT-HOOK-LOCAL records the behaviour
  - listing `.claude/settings.local.json` in the README path list; the test builds that list from an init with no `hookEntry`, which writes no local file
  - docs/QUICKSTART.md and the `--profile` text, which T1-INIT-PROFILE writes
  - docs/ARCHITECTURE.md, whose sentence on `hook-wiring.ts` T1-HOOK-WIRING-LOCAL updates; it has no sentence on where init writes hook entries
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE, after T1-INIT-HOOK-LOCAL has merged. Before writing, read src/scaffold/init.ts and src/probes/hook-wiring.ts as merged and check each sentence of the three texts against them; if a sentence does not hold, stop and report, since the texts are fixed in this card. Tests first, in two commits: the first changes the three literals and records the two tests failing on the old document text; the second changes the documents. Revert table, each row a scratch change restored afterwards: each of the three paragraphs put back to its text on main, one at a time (acceptance 1 red twice, acceptance 2 red once). Run `npm test` once before the first review, since other test files read both documents (lesson 2026-11-11 T0-RELEASE-OP-REISSUE)."
---

# T1-INIT-HOOK-LOCAL-DOCS

## Deliverable
The README and the operating guide say where `aidlc init` writes its hook entries on a repository with no aidlc package, what `--no-hooks` leaves out, and what `aidlc doctor` prints on a machine where init has not run.

## Why
T1-INIT-HOOK-LOCAL moves the absolute hook command to `.claude/settings.local.json` (owner decision of 2026-11-16). Three paragraphs describe the old placement, and each is pinned by a test, so the code card would have needed two documents and three test files more than its paths and budget allow. This card changes the three paragraphs and their three pins together. Lesson 2026-11-15 T1-REPLAY-CLEAN: a test that pins a document a card changes is in `allow_paths` with the literal the card may update.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/readme.test.ts tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/hook-lazy.test.ts tests/surface/init-base-ci.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. README.md, in place of the paragraph at :95
`` `.claude/settings.json` holds a `permissions.deny` list and the hook entries. On a repository with no aidlc package the hook command names the absolute path of the CLI that ran `aidlc init`, a path that holds on one machine only, so init writes the hook entries to `.claude/settings.local.json`, adds that file to `.gitignore` and leaves no aidlc hook entry in `.claude/settings.json`; each person who works in the repository runs `aidlc init` once. `aidlc init --no-hooks` writes the same deny list, merges no hook entry and writes no `.claude/settings.local.json`. A hook already in either file stays as it is and keeps running, so a repository with no hooks wired runs no guard. With no dispatcher wired in either file, `aidlc doctor` prints `not wired` on its `hookCommand` line. ``

### 2. docs/OPERATIONS.md, in place of the paragraph at :15
`` `--no-hooks` writes the same `permissions.deny` list, merges no hook entry into `.claude/settings.json` and writes no `.claude/settings.local.json`; a hook already in either file stays as it is and keeps running, so a repository with no hooks wired runs no guard, and `aidlc doctor` prints `not wired` on its `hookCommand` line when neither file wires a dispatcher. ``

### 3. docs/OPERATIONS.md, in place of the paragraph at :325
`` On a repository with no Node package (cards T1-INIT-HOOK-PATH and T1-INIT-HOOK-LOCAL), `aidlc init` writes the hook command as `node "<path>/bin/aidlc-hook.js"`, the absolute path of the CLI that ran it, because `npx --no-install aidlc hook auto` exits 1 there and a hook that exits 1 does not stop a tool call. The path holds on one machine only, so init writes these hook entries to `.claude/settings.local.json`, adds that file to the target's `.gitignore` when no line names it, and removes every aidlc dispatcher entry from `.claude/settings.json`, an absolute one written by an earlier init included; Claude Code reads the hook entries of both files. Each person who works in the repository runs `aidlc init` once: until then no dispatcher is wired on that machine and `aidlc doctor` prints `not wired` on the `hookCommand` line, and after the CLI's checkout moves it prints `FAILED` until `aidlc init` runs again. ``

Each text is given between double backticks with one space inside them; the document text starts at the first character after that space and ends before the last space.
