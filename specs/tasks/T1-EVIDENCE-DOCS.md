---
id: T1-EVIDENCE-DOCS
title: CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md describe the loop-run DoD record of T1-DOD-RECORD-2, both implementer agent copies tell the worker to run a successful card attempt with the shell tool's 10-minute timeout, and a surface test pins each text at its place
status: merged
branch: T1-EVIDENCE-DOCS
worktree: D:\wt\AIDLC\T1-EVIDENCE-DOCS
plan_ref: plans/loop-evidence.md#order-of-work
allow_paths:
  - CHANGELOG.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - .claude/agents/implementer.md
  - templates/claude/agents/implementer.md
  - tests/surface/loop-evidence-docs.test.ts
dod_command: npm run typecheck && node --test tests/surface/loop-evidence-docs.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts tests/infra/stray-processes.test.ts tests/surface/release-version.test.ts
dod_exit: 0
requirements:
  - R1. CHANGELOG.md shall carry the entry E1 of Acceptance detail 1 as one line within the Unreleased section, after the line `## Unreleased` and before the next release heading, `## 0.2.0 - 2026-11-14`, with one blank line directly before and after it; the entry of T1-OUTCOME-REPORT may stand on either side. No other line changes.
  - R2. docs/OPERATIONS.md shall carry paragraph O1 directly after the paragraph that begins `A DoD receipt names the command` (:106 at 6f49a492) and before `### T1 feature` (:108), with one blank line on both sides. No other line changes.
  - R3. docs/ARCHITECTURE.md shall carry clause A1 in the `cards/<goalId>/<cardId>.json` row of the persisted-state table directly after `receipts, ` and before `closure flags` (:191 at 6f49a492). No other change.
  - R4. Both implementer agent copies shall carry the four lines I1 of Acceptance detail 1 directly after the line of procedure step 3 (it begins `3. Run`, :21 at 6f49a492) and before step 4, the two copies staying byte-identical and ASCII, so the worker that runs `aidlc card attempt <id> --outcome success` sets the shell tool's timeout to its 10-minute maximum, above the 9-minute DoD timeout of T1-DOD-RECORD-2.
  - R5. A new test file tests/surface/loop-evidence-docs.test.ts shall pin each text whole at its place (Acceptance detail 2), read every file with CRLF folded to LF, and check the CHANGELOG through one pure function over the text, built on `changelogSince010` of tests/infra/changelog.ts, with the rows of Acceptance detail 3: row 1 the file, the other rows an in-memory fixture.
  - R6. The sentences of E1, O1 and A1 about T1-DOD-RECORD-2 shall be true of main (it merged at 402a07f3, PR 314); the sentences about this card's own additions (the last sentence of E1 and of O1, and I1) shall be true of this card's candidate.
acceptance:
  - 1. tests/surface/loop-evidence-docs.test.ts "CHANGELOG.md carries the entry under Unreleased, above the 0.2.0 section". Row 1 fails on main by assertion; rows 2 to 8, on the in-memory fixture, have the results Acceptance detail 3 states on main and with this card. [R1] [R5] [dod arm 1] Detail items 1 and 3.
  - 2. Same file, "OPERATIONS.md carries the loop-run DoD paragraph after the DoD receipt paragraph". Fails on main by assertion. [R2] [R5] [dod arm 1] Detail item 2.
  - 3. Same file, "ARCHITECTURE.md names the DoD run record in the card-run row". Fails on main by assertion. [R3] [R5] [dod arm 1] Detail item 2.
  - 4. Same file, "both implementer agents run a successful attempt with the 10-minute shell timeout". Fails on main by assertion. [R4] [R5] [dod arm 1] Detail item 2.
  - 5. tests/surface/templates.test.ts, prose.test.ts, mirror.test.ts, tests/infra/stray-processes.test.ts (its I1 check needs item 7 of the implementer agent directly above the blank line before `Report`) and tests/surface/release-version.test.ts pass unchanged. [R1] [R2] [R3] [R4] [dod arm 1]
  - 6. Every sentence of the four texts holds as R6 states: those on T1-DOD-RECORD-2 against main at PREPARE, those on this card's own additions against its candidate (reviewer-verified; the R3 reviewer decides). [R6]
depends_on: [T1-DOD-RECORD-2]
budget: 140
tdd: true
sweep: "On main at 6f49a492, checked again at 32a09083, which changed only intent, plans and specs since. T1-DOD-RECORD-2 merged at 402a07f3: `loopDod` on the attempt (src/core/types.ts:632-666), `LOOP_DOD_TIMEOUT_MS = 540_000` and the record (src/loop/card-runner.ts:73, :267-287, run at :1203 after the DoD receipt refusal), `ran: false` with `no-worktree` or `no-directory`, commit and clean only when the same call's candidate probe read them, the runner's `killTree` through the tree helper, whose async runner ends the tree with `killProcessTree` (src/probes/exec.ts:251, taskkill or ps, SIGKILL to the root alone when they fail), the DoD call shared with the mutant sweep (`dodCall`, src/review/mutants.ts:161) and the `loopDod=` line after `lease=` (src/cli/main.ts:107-113, :756). Readers of the places changed: the DoD receipt paragraph (docs/OPERATIONS.md:106) and `### T1 feature` are pinned by no test. The card-run row of docs/ARCHITECTURE.md:191 is read by substring (tests/surface/templates.test.ts:621 and :688, and tests/scenarios/journal-owed.test.ts:511-515 after `the run revision`), and no pinned substring spans `receipts, closure flags`. CHANGELOG.md: `## Unreleased` (:3) is followed by one blank line and `## 0.2.0 - 2026-11-14` (:5); tests/surface/release-version.test.ts:22-33 counts the entries of the 0.2.0 section only; tests/infra/changelog.ts exports `changelogSince010` (the part from `## Unreleased` to the line feed before the 0.1.0 heading, the empty string when either heading is missing or doubled). T1-OUTCOME-REPORT adds one entry within the Unreleased section too, so the check of acceptance 1 accepts another entry above or below E1. The implementer agent copies (2296 bytes, identical, ASCII, no byte cap) are read by tests/infra/stray-processes.test.ts:623-651 (item 7 directly after step 6 and directly above the blank line before `Report`, so the new lines go into step 3, not after item 7), tests/surface/prose.test.ts:295-297, tests/surface/templates.test.ts:56, :152 and :342, and tests/surface/mirror.test.ts; none pins step 3. The workers' own instructions give the attempt invocation in card-loop.md of the aidlc-loop skill, at 6494 of its 6500-byte cap (templates.test.ts:20), and SKILL.md:74 also mentions the command, at 4488 of its 4500-byte cap, so the instruction goes to the implementer agent. CLAUDE.md is 191 of 200 lines."
forbid:
  - weakening, skipping or deleting a test to go green, or changing an existing test file
  - any change to src, REVIEW.md, the configs, CLAUDE.md, templates/CLAUDE.aidlc.md, the aidlc-loop skill files or README.md
  - changing an existing line of the three documents other than the line of docs/ARCHITECTURE.md that gains A1, or a line of the implementer agent other than the four lines of R4
  - in the new test file `Date.now()`, a temporary directory or a child process
non_goals:
  - the R3 finding standard, `REVIEW.md@7` and a bench comparison: T1-R3-SUPPORTED-FINDINGS was cancelled by the owner on 2026-11-15 (intent/loop-evidence.md), so this card documents only T1-DOD-RECORD-2 and the implementer instruction
  - CLAUDE.md and templates/CLAUDE.aidlc.md (191 of 200 lines, tests/surface/claude-md-size.test.ts); the sentence that the card machine refuses SHIP without a DoD receipt stays, since the receipt stays required
  - the order of E1 and the entry of T1-OUTCOME-REPORT under `## Unreleased`: either card may merge first, and each card's check accepts the other entry on either side of its own
  - holding across the next release cut: a release heading put between `## Unreleased` and E1 fails acceptance 1, and the card that cuts that release updates the check, as T0-RELEASE-0-2-0 did for the tests that pin an entry
  - cleanup of a DoD process that outlives the timeout when its root already exited or taskkill, ps or the tree helper fails (plans/loop-evidence.md, Risks); O1 states it
  - the BUILD narration of the loop and the aidlc-loop skill, which say nothing of the DoD now run inside `card attempt`
hygiene: "Line numbers are from main at 6f49a492; find each place by its content at PREPARE. The sentences of E1, O1 and A1 on T1-DOD-RECORD-2 were checked against that main (sweep); at PREPARE check them again against main, and if one does not hold, stop before writing and report it: the card is not edited after its run starts and the coordinator registers a replacement. The sentences about this card's own additions (the last sentence of E1 and of O1, and I1) are checked against the candidate. Tests first, in two commits: commit 1 adds tests/surface/loop-evidence-docs.test.ts whole and records acceptance 1 (row 1), 2, 3 and 4 failing by assertion; commit 2 adds the four texts. Test about 70 lines, texts about 14; past 250 lines, stop and report. Revert table before the first review, each a scratch change restored afterwards: E1 removed, E1 moved below `## 0.2.0 - 2026-11-14`, the blank line after E1 removed (acceptance 1); O1 removed, O1 placed after `### T1 feature` (acceptance 2); A1 removed (acceptance 3); I1 removed from one copy (acceptance 4 and mirror.test.ts), I1 placed after item 7 (acceptance 4 and tests/infra/stray-processes.test.ts). When CHANGELOG.md conflicts at a base sync (T1-OUTCOME-REPORT adds its entry under `## Unreleased`), keep both entries within the Unreleased section, in either order, each with one blank line directly before and after it (merge-conflicts skill). Before the first review the coordinator runs every test file that reads CHANGELOG.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md or an implementer agent copy and records the counts; the full suite runs in CI."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md, .claude/agents/implementer.md, templates/claude/agents/implementer.md
---

# T1-EVIDENCE-DOCS

## Deliverable
The changelog, the operating guide and the architecture note describe the loop-run DoD record (T1-DOD-RECORD-2, spec R1 to R3). Both implementer agent copies tell the worker to run a successful `card attempt` with the shell tool's timeout at its 10-minute maximum. A surface test pins each text at its place; the changelog entry stands under `## Unreleased`, above the release section 0.2.0.

## Why
Spec R4 (specs/loop-evidence.md) and item 2 of the plan's order of work: one card per goal edits the three documents, and the owner cancelled the finding standard on 2026-11-15, so the goal's docs cover the DoD record alone. T1-DOD-RECORD-2 runs the DoD inside `card attempt --outcome success` with a 9-minute timeout (`LOOP_DOD_TIMEOUT_MS = 540_000`); the shell tool of Claude Code stops a command after 2 minutes unless its timeout is raised, at most to 10, and a call stopped that way records nothing (T1-DOD-RECORD-2, non_goals). The worker reads its procedure in the implementer agent; the aidlc-loop card-loop.md has 6 bytes left under its cap.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/loop-evidence-docs.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts tests/infra/stray-processes.test.ts tests/surface/release-version.test.ts
```
- Expected exit code: 0
- Assertion: acceptance 1 to 5 pass. Acceptance 6 is the reviewer's check against main and the candidate.

## Acceptance detail

### 1. The texts (each one line, except I1)
E1, CHANGELOG.md:

```text
- T1-DOD-RECORD-2: `aidlc card attempt <card> --outcome success`, once every refusal of a success has passed, runs the card's `dod_command` in the card worktree through the platform shell, as the mutant sweep runs it, and stores on the attempt the record `loopDod`: the commit and whether the worktree was clean (when the call's candidate probe read them), the exit code, or a timeout after 9 minutes (`LOOP_DOD_TIMEOUT_MS`), at which the runner's existing tree kill ends the DoD (when the root has already exited at the timeout, or `taskkill`, `ps` or the tree helper fails, a process of the DoD can remain), the expected exit (`dod_exit`), the duration, the sha256 of the output and its last 4096 bytes; a run with no worktree directory records the DoD as not run. The record changes no card state, outcome or allowance, and the worker's `--dod-receipt` is still required. `aidlc card status` prints a `loopDod=` line that says `DIFFERS` when the exit is not `dod_exit`, and `loopDod=-` when no attempt has a record, as for a run written before this card. Both implementer agent copies tell the worker to run that command with the shell tool's timeout at its 10-minute maximum (card T1-EVIDENCE-DOCS).
```

O1, docs/OPERATIONS.md:

```text
Loop-run DoD record (card T1-DOD-RECORD-2). When `aidlc card attempt <card> --outcome success` has passed every refusal of a success (a dirty worktree, a missing receipt, a mutant marker), the loop runs the card's `dod_command` once in the card worktree, through the platform shell as the mutant sweep runs it, and stores the record `loopDod` on that attempt: the commit and whether the worktree was clean (from the same call's candidate probe, when it read them), the exit code, the expected exit (`dod_exit`), the duration, the sha256 of stdout, one 0x00 byte and stderr, and the last 4096 bytes of stdout followed directly by stderr, decoded as UTF-8. A DoD that has not ended after 9 minutes (`LOOP_DOD_TIMEOUT_MS`) is ended by the tree kill the runner already applies to a timed-out command (`killProcessTree`, src/probes/exec.ts), and the record holds `timedOut: true` with no exit code; when the root has already exited at the timeout, or `taskkill`, `ps` or the tree helper fails, a process of the DoD can remain, and no card of this goal adds cleanup for those cases. A run that names no worktree directory records `ran: false` with the reason and starts nothing. The record changes no card state, outcome or allowance: the DoD receipt above is still what the card machine requires, and an exit that differs from `dod_exit` stops nothing. `aidlc card status <card>` prints the record of the last attempt that has one on a `loopDod=` line after the `lease=` line, with `DIFFERS` when the exit is not `dod_exit` or the DoD timed out, and `loopDod=-` when no attempt has one, as for a run written before this card. A worker runs `card attempt --outcome success` with its shell tool's timeout at the 10-minute maximum, since a call stopped earlier ends the command and records nothing (`.claude/agents/implementer.md`, step 3).
```

A1, docs/ARCHITECTURE.md (followed by one space and `closure flags`):

```text
the loop-run DoD record `loopDod` of a successful attempt (card T1-DOD-RECORD-2: commit, clean worktree, exit code or timeout, expected exit, duration, output sha256 and tail, or not run with its reason; it changes no state),
```

I1, both implementer agent copies, after the line of step 3:

```text
   Run `aidlc card attempt <id> --outcome success` with the shell tool's
   timeout at its 10-minute maximum (600000 ms): the command runs the DoD
   again for up to 9 minutes, and a call stopped before it ends records
   nothing.
```

### 2. Where the test finds each text
| Text | Check (lines of the LF text) |
|---|---|
| O1 | one line equals O1; the line before is empty and the one before that starts with `A DoD receipt names the command`; the line after is empty and the next is `### T1 feature` |
| A1 | the line that starts with `` | `cards/<goalId>/<cardId>.json` | `` includes `receipts, ` + A1 + ` closure flags` |
| I1 | in each copy the four lines of I1 follow the line that starts with `3. Run` and the next line starts with `4. Never edit test files`; each copy is ASCII |

### 3. The changelog check
`changelogHolds(text)` takes `part`, `changelogSince010` of the text with CRLF folded to LF, and is true when `part` is not empty, E1 stands once in the whole text, and in the lines of `part` (split at LF) E1 stands after the first line `## Unreleased` with no line starting `## ` between them, with an empty line directly before it and directly after it. The fixture F, in memory, is these lines joined by LF with one LF at the end: `# Changelog`, empty, `## Unreleased`, empty, E1, empty, `## 0.2.0 - 2026-11-14`, empty, `- an older entry`, empty, `## 0.1.0 - 2026-09-11`, empty, `- the first entry`.

| Row | Text | Expected |
|---|---|---|
| 1 | CHANGELOG.md | true (false on main) |
| 2 | F | true |
| 3 | F with `- another entry` and an empty line put between the empty line under `## Unreleased` and E1 (another card's entry above, as T1-OUTCOME-REPORT's) | true |
| 4 | F with the empty line after E1 removed | false |
| 5 | F with E1 and its empty line moved directly below `## 0.2.0 - 2026-11-14` and its empty line (the entry cut into 0.2.0) | false |
| 6 | F with E1 and an empty line added after `- an older entry` and its empty line (E1 twice) | false |
| 7 | F without the line `## 0.1.0 - 2026-09-11` (`changelogSince010` gives the empty string) | false |
| 8 | F with `- another entry` and an empty line put between the empty line after E1 and `## 0.2.0 - 2026-11-14` (another card's entry below) | true |
