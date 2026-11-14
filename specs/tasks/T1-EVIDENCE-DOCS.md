---
id: T1-EVIDENCE-DOCS
title: CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md describe the loop-run DoD record of T1-DOD-RECORD-2 and the finding standard of T1-R3-SUPPORTED-FINDINGS, both implementer agent copies tell the worker to run a successful card attempt with the shell tool's 10-minute timeout, and a surface test pins each text at its place
status: todo
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
dod_command: npm run typecheck && node --test tests/surface/loop-evidence-docs.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts tests/surface/module-map.test.ts tests/infra/stray-processes.test.ts tests/scenarios/candidate-pins.test.ts tests/scenarios/review-admit-foreign.test.ts
dod_exit: 0
requirements:
  - R1. CHANGELOG.md shall carry the entries E1 and E2 of Acceptance detail 1, in that order, each one line followed by one blank line, directly after the line `## Unreleased` and the blank line under it, so above `## 0.2.0 - 2026-11-14`. No other line changes.
  - R2. docs/OPERATIONS.md shall carry paragraph O1 directly after the paragraph that begins `A DoD receipt names the command` (:106 at 5b9fa3fc) and before `### T1 feature`, and paragraph O2 directly after the paragraph that begins `Second pass (card T1-R3-SECOND-PASS)` (:456) and before the paragraph that begins `Placeholders in argv:`, each with one blank line on both sides. No other line changes.
  - R3. docs/ARCHITECTURE.md shall carry clause A1 in the `cards/<goalId>/<cardId>.json` row of the persisted-state table directly after `receipts, ` and before `closure flags` (:191 at 5b9fa3fc), and sentence A2 in the paragraph that names `src/review/pre-review.ts` directly after `restarts the pre-review cycle.` and one space (:42). No other change.
  - R4. Both implementer agent copies shall carry the four lines I1 of Acceptance detail 1 directly after the line of procedure step 3 (it begins `3. Run`, :21 at 5b9fa3fc) and before step 4, the two copies staying byte-identical and ASCII, so the worker that runs `aidlc card attempt <id> --outcome success` sets the shell tool's timeout to its 10-minute maximum, above the 9-minute DoD timeout of T1-DOD-RECORD-2.
  - R5. A new test file tests/surface/loop-evidence-docs.test.ts shall pin each text whole at its place (Acceptance detail 2), read every file with CRLF folded to LF, and check the CHANGELOG through one pure function over the text, built on `changelogSince010` of tests/infra/changelog.ts, with the rows of Acceptance detail 3: row 1 the file, the other rows an in-memory fixture.
  - R6. The sentences of E1, E2, O1, O2, A1 and A2 about T1-DOD-RECORD-2 and T1-R3-SUPPORTED-FINDINGS shall be true of main at PREPARE, after both have merged; the sentences about this card's own additions (the last sentence of E1 and of O1, and I1) shall be true of this card's candidate.
acceptance:
  - 1. tests/surface/loop-evidence-docs.test.ts "CHANGELOG.md carries the two entries first under Unreleased, above the 0.2.0 section". Row 1 fails on main by assertion; rows 2 to 8, on the in-memory fixture, have the results Acceptance detail 3 states on main and with this card. [R1] [R5] [dod arm 1] Detail items 1 and 3.
  - 2. Same file, "OPERATIONS.md carries the loop-run DoD paragraph after the DoD receipt paragraph and the finding standard paragraph in the formal review section". Fails on main by assertion. [R2] [R5] [dod arm 1] Detail item 2.
  - 3. Same file, "ARCHITECTURE.md names the DoD run record in the card-run row and the finding standard in the review paragraph". Fails on main by assertion. [R3] [R5] [dod arm 1] Detail item 2.
  - 4. Same file, "both implementer agents run a successful attempt with the 10-minute shell timeout". Fails on main by assertion. [R4] [R5] [dod arm 1] Detail item 2.
  - 5. Same file, "the policy the docs describe is on main": REVIEW.md holds the line `## Finding standard` once and both configs give `REVIEW.md@7`. Fails by assertion on main before T1-R3-SUPPORTED-FINDINGS merges (5b9fa3fc) and passes at PREPARE, once it has merged. [R6] [dod arm 1]
  - 6. tests/surface/templates.test.ts, prose.test.ts, mirror.test.ts, module-map.test.ts, tests/infra/stray-processes.test.ts (its I1 check needs item 7 of the implementer agent directly above the blank line before `Report`), tests/scenarios/candidate-pins.test.ts and review-admit-foreign.test.ts pass unchanged. [R2] [R3] [R4] [dod arm 1]
  - 7. Every sentence of the seven texts holds as R6 states: those on the two prerequisite cards against main at PREPARE, those on this card's own additions against its candidate (reviewer-verified; the R3 reviewer decides). [R6]
depends_on: [T1-DOD-RECORD-2, T1-R3-SUPPORTED-FINDINGS]
budget: 180
tdd: true
sweep: "On main at 5b9fa3fc. Readers of the places changed: the DoD receipt paragraph (docs/OPERATIONS.md:106) and `### T1 feature` are pinned by no test; the formal review section is read by tests/surface/prose.test.ts:303-313 (the End-of-turn paragraph before `Placeholders in argv:`), tests/scenarios/candidate-pins.test.ts:521-529 (needles in the section) and tests/scenarios/review-admit-foreign.test.ts:211 (the `Placeholders in argv:` line), none on the order of the Second pass paragraph; docs/OPERATIONS.md:363 (the version sentence) belongs to T1-R3-SUPPORTED-FINDINGS. The card-run row of docs/ARCHITECTURE.md:191 is read by substring (tests/surface/templates.test.ts, and tests/scenarios/journal-owed.test.ts:510-514 after `the run revision`), and no pinned substring spans `receipts, closure flags`; no test pins `restarts the pre-review cycle. Both prompts` (:42). CHANGELOG.md: T0-RELEASE-0-2-0 merged at 55a508c0, so `## Unreleased` (:3) is followed by one blank line and `## 0.2.0 - 2026-11-14` (:5), `## 0.1.0 - 2026-09-11` is at :446, and tests/infra/changelog.ts exports `changelogSince010` (the part from `## Unreleased` to the line feed before the 0.1.0 heading, the empty string when either heading is missing or doubled). The implementer agent copies (2296 bytes, identical, ASCII, no byte cap) are read by tests/infra/stray-processes.test.ts:631-652 (item 7 directly after step 6 and directly above the blank line before `Report`, so the new lines go into step 3, not after item 7), tests/surface/prose.test.ts:295-297, tests/surface/templates.test.ts:55-65, :152 and :342, and tests/surface/mirror.test.ts; none pins step 3. The workers' own instructions name `card attempt` only in card-loop.md:56 of the aidlc-loop skill, at 6494 of its 6500-byte cap (templates.test.ts CAPS), so the instruction goes to the implementer agent. CLAUDE.md is 191 of 200 lines."
forbid:
  - weakening, skipping or deleting a test to go green, or changing an existing test file
  - any change to src, REVIEW.md, the configs, CLAUDE.md, templates/CLAUDE.aidlc.md, the aidlc-loop skill files or README.md
  - changing an existing line of the three documents other than the two lines of docs/ARCHITECTURE.md that gain A1 and A2, or a line of the implementer agent other than the four lines of R4
  - in the new test file `Date.now()`, a temporary directory or a child process
non_goals:
  - CLAUDE.md and templates/CLAUDE.aidlc.md (191 of 200 lines, tests/surface/claude-md-size.test.ts); the sentence that the card machine refuses SHIP without a DoD receipt stays, since the receipt stays required
  - the count of advisory `[question]` and `[suggestion]` reasons at goal close (plan, Risks); a goal-close step of the coordinator, not a text of this card
  - holding across the next release cut: a release heading put between `## Unreleased` and E1 fails acceptance 1, and the card that cuts that release updates the check, as T0-RELEASE-0-2-0 did for 69 test files
  - the sentences that call the single R3 pass exhaustive (docs/OPERATIONS.md:383); they say R3 is never fanned out, which stays true
  - the version sentence of docs/OPERATIONS.md:363 (T1-R3-SUPPORTED-FINDINGS) and the bench comparison itself
  - the BUILD narration of the loop and the aidlc-loop skill, which say nothing of the DoD now run inside `card attempt`
hygiene: "Line numbers are from main at 5b9fa3fc; find each place by its content at PREPARE. At PREPARE read the merged T1-DOD-RECORD-2 (card and code: the field `loopDod`, `LOOP_DOD_TIMEOUT_MS` of 9 minutes, the tree kill at the timeout and its fallback when taskkill, ps or the tree helper fails, the `loopDod=` status line, `ran: false` with its reasons, no record on a refused success or on an attempt that is not a success) and the merged T1-R3-SUPPORTED-FINDINGS (REVIEW.md section `## Finding standard`, the formal prompt, the bench comparison against `run` of replay-main.json). If a sentence about those two cards does not hold for what merged, stop before writing and report it: the card is not edited after its run starts and the coordinator registers a replacement. The sentences about this card's own additions (the last sentence of E1 and of O1, and I1) are checked against the candidate, not against main. Tests first, in two commits: commit 1 adds tests/surface/loop-evidence-docs.test.ts whole and records acceptance 1 (row 1), 2, 3 and 4 failing by assertion and acceptance 5 passing; commit 2 adds the seven texts. Revert table before the first review, each a scratch change restored afterwards: E1 removed, E2 removed, E1 and E2 swapped, both moved below `## 0.2.0 - 2026-11-14`, an entry line and a blank line put between `## Unreleased` and E1, the blank line after E2 removed (acceptance 1); O1 removed, O1 placed after `### T1 feature`, O2 removed, O2 placed after `Placeholders in argv:` (acceptance 2); A1 removed, A2 moved to the end of its paragraph (acceptance 3); I1 removed from one copy (acceptance 4 and mirror.test.ts), I1 placed after item 7 (acceptance 4 and tests/infra/stray-processes.test.ts). Before the first review the coordinator runs every test file that reads CHANGELOG.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md or an implementer agent copy and records the counts; the full suite runs in CI."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md, .claude/agents/implementer.md, templates/claude/agents/implementer.md
---

# T1-EVIDENCE-DOCS

## Deliverable
The changelog, the operating guide and the architecture note describe the loop-run DoD record (T1-DOD-RECORD-2, spec R1 to R3) and the finding standard (T1-R3-SUPPORTED-FINDINGS, spec R4). Both implementer agent copies tell the worker to run a successful `card attempt` with the shell tool's timeout at its 10-minute maximum. A surface test pins each text at its place; the two changelog entries stand first under `## Unreleased`, above the release section 0.2.0.

## Why
Spec R6 and plan item 3: one card per goal edits the three documents. T1-DOD-RECORD-2 runs the DoD inside `card attempt --outcome success` with a 9-minute timeout (`LOOP_DOD_TIMEOUT_MS = 540_000`); the shell tool of Claude Code stops a command after 2 minutes unless its timeout is raised, at most to 10, and a call stopped that way records nothing (T1-DOD-RECORD-2, non_goals). The worker reads its procedure in the implementer agent; the aidlc-loop card-loop.md has 6 bytes left under its cap.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/loop-evidence-docs.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts tests/surface/module-map.test.ts tests/infra/stray-processes.test.ts tests/scenarios/candidate-pins.test.ts tests/scenarios/review-admit-foreign.test.ts
```
- Expected exit code: 0
- Assertion: acceptance 1 to 6 pass. Acceptance 7 is the reviewer's check against the merged code.

## Acceptance detail

### 1. The texts (each one line, except I1)
E1, CHANGELOG.md:

```text
- T1-DOD-RECORD-2: `aidlc card attempt <card> --outcome success`, once every refusal of a success has passed, runs the card's `dod_command` in the card worktree through the platform shell, as the mutant sweep runs it, and stores on the attempt the record `loopDod`: the commit, whether the worktree was clean, the exit code, or a timeout after 9 minutes (`LOOP_DOD_TIMEOUT_MS`), at which the runner's existing tree kill ends the DoD (when the root has already exited at the timeout, or `taskkill`, `ps` or the tree helper fails, a process of the DoD can remain), the expected exit (`dod_exit`), the duration, the sha256 of the output and its last 4096 bytes; a run with no worktree directory records the DoD as not run. The record changes no card state, outcome or allowance, and the worker's `--dod-receipt` is still required. `aidlc card status` prints a `loopDod=` line that says `DIFFERS` when the exit is not `dod_exit`, and `loopDod=-` when no attempt has a record, as for a run written before this card. Both implementer agent copies tell the worker to run that command with the shell tool's timeout at its 10-minute maximum (card T1-EVIDENCE-DOCS).
```

E2, CHANGELOG.md:

```text
- T1-R3-SUPPORTED-FINDINGS: the R3 prompt, `REVIEW.md` (section Finding standard) and the reviewer agent no longer tell the reviewer to "actively try to disprove" the change, to block "when uncertain" or to "be exhaustive". A finding blocks only when it cites a file and line of the candidate and states an observable failure (the input, then the wrong result or the crash), the stated requirement, acceptance item, `non_goals` entry or `forbid:` item it breaks, or the hard boundary it breaches (a changed path outside `allow_paths`, dimension 2 or 3, a security gap or data loss); any other finding is reported under a `[question]` or `[suggestion]` tag and does not block. `reviewPolicyVersion` is `REVIEW.md@7` in both configs. The owner decided the card on a full-set reviewer bench run of its candidate compared with `run`, main's full-set run in `bench/outcome/replay-main.json`.
```

O1, docs/OPERATIONS.md:

```text
Loop-run DoD record (card T1-DOD-RECORD-2). When `aidlc card attempt <card> --outcome success` has passed every refusal of a success (a dirty worktree, a missing receipt, a mutant marker), the loop runs the card's `dod_command` once in the card worktree, through the platform shell as the mutant sweep runs it, and stores the record `loopDod` on that attempt: the commit and whether the worktree was clean (from the same call's candidate probe), the exit code, the expected exit (`dod_exit`), the duration, the sha256 of the output (stdout, one 0x00 byte, stderr) and its last 4096 bytes. A DoD that has not ended after 9 minutes (`LOOP_DOD_TIMEOUT_MS`) is ended by the tree kill the runner already applies to a timed-out command (`killProcessTree`, src/probes/exec.ts), and the record holds `timedOut: true` with no exit code; when the root has already exited at the timeout, or `taskkill`, `ps` or the tree helper fails, a process of the DoD can remain, and no card of this goal adds cleanup for those cases. A run that names no worktree directory records `ran: false` with the reason and starts nothing. The record changes no card state, outcome or allowance: the DoD receipt above is still what the card machine requires, and an exit that differs from `dod_exit` stops nothing. `aidlc card status <card>` prints the record of the last attempt that has one on a `loopDod=` line after the `lease=` line, with `DIFFERS` when the exit is not `dod_exit` or the DoD timed out, and `loopDod=-` when no attempt has one, as for a run written before this card. A worker runs `card attempt --outcome success` with its shell tool's timeout at the 10-minute maximum, since a call stopped earlier ends the command and records nothing (`.claude/agents/implementer.md`, step 3).
```

O2, docs/OPERATIONS.md:

```text
Finding standard (card T1-R3-SUPPORTED-FINDINGS). The R3 prompt, `REVIEW.md` (section Finding standard) and the reviewer agent require supported findings: a finding blocks only when it cites a file and line of the candidate and states an observable failure (the input, then the wrong result or the crash it gives), the stated requirement, acceptance item, `non_goals` entry or `forbid:` item it breaks, or the hard boundary it breaches (a changed path outside `allow_paths`, dimension 2 or 3, a security gap or data loss). Any other finding, on any dimension, is reported under a `[question]` or `[suggestion]` tag, advisory as those tags already are. The R3 prompt still asks for every hunk of the diff in one pass and every material finding the reviewer can support; the R2 prompt-builder text is unchanged and embeds the updated `REVIEW.md` standard. The card changed the gate that reviewed it, so every aidlc command of its run ran from the clean main checkout, and main's code, configuration and `REVIEW.md` reviewed it until it merged; the owner decided it on a full-set reviewer bench run of its candidate compared with `run`, main's full-set run in `bench/outcome/replay-main.json`.
```

A1, docs/ARCHITECTURE.md (followed by one space and `closure flags`):

```text
the loop-run DoD record `loopDod` of a successful attempt (card T1-DOD-RECORD-2: commit, clean worktree, exit code or timeout, expected exit, duration, output sha256 and tail, or not run with its reason; it changes no state),
```

A2, docs/ARCHITECTURE.md:

```text
The formal prompt and `REVIEW.md` state the finding standard (card T1-R3-SUPPORTED-FINDINGS): a finding blocks only when it cites a file and line of the candidate and states an observable failure, the stated requirement, acceptance item, `non_goals` entry or `forbid:` item it breaks, or the hard boundary it breaches; any other finding is a `[question]` or a `[suggestion]`.
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
| O2 | one line equals O2; the line before is empty and the one before that starts with `Second pass (card T1-R3-SECOND-PASS)`; the line after is empty and the next starts with `Placeholders in argv:` |
| A1 | the line that starts with `` | `cards/<goalId>/<cardId>.json` | `` includes `receipts, ` + A1 + ` closure flags` |
| A2 | the line that includes `` `src/review/pre-review.ts` builds the pre-review (R2) prompt `` includes `restarts the pre-review cycle. ` + A2 + ` Both prompts carry the repository` |
| I1 | in each copy the four lines of I1 follow the line that starts with `3. Run` and the next line starts with `4. Never edit test files`; each copy is ASCII |

### 3. The changelog check
`changelogHolds(text)` takes `part`, `changelogSince010` of the text with CRLF folded to LF, and is true when `part` is not empty, its lines (split at LF) are `## Unreleased`, an empty line, E1, an empty line, E2 and an empty line from its first line on, and E1 and E2 each stand once in the whole text. The fixture F, in memory, is these lines joined by LF with one LF at the end: `# Changelog`, empty, `## Unreleased`, empty, E1, empty, E2, empty, `## 0.2.0 - 2026-11-14`, empty, `- an older entry`, empty, `## 0.1.0 - 2026-09-11`, empty, `- the first entry`.

| Row | Text | Expected |
|---|---|---|
| 1 | CHANGELOG.md | true (false on main) |
| 2 | F | true |
| 3 | F with `- another entry` and an empty line put between the empty line under `## Unreleased` and E1 | false |
| 4 | F with the empty line after E2 removed | false |
| 5 | F with E1 and E2 swapped | false |
| 6 | F with E1, E2 and their empty lines moved directly below `## 0.2.0 - 2026-11-14` and its empty line (the entries cut into 0.2.0) | false |
| 7 | F with E1 and an empty line added after `- an older entry` and its empty line (E1 twice) | false |
| 8 | F without the line `## 0.1.0 - 2026-09-11` (`changelogSince010` gives the empty string) | false |
