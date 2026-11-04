---
id: T0-LESSON-DUP
title: aidlc card close --lesson appends no second line for a lesson docs/LESSONS.md already holds for the same card, kind, rule and source under any date, and the close directive says the flag writes the line itself, so a lesson is recorded once
status: merged
branch: T0-LESSON-DUP
worktree: D:\wt\AIDLC\T0-LESSON-DUP
allow_paths:
  - src/artifacts/lessons.ts
  - src/loop/card-runner.ts
  - tests/scenarios/lesson-dup.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-LESSON-DUP.md
dod_command: npm run typecheck && node --test tests/scenarios/lesson-dup.test.ts tests/surface/lessons.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the lesson step is recorded with a lesson text (`aidlc card close <id> --lesson`, `CardRunner.markClosure`) and docs/LESSONS.md already holds a valid lesson line for the same card with the same kind, rule and source, under any date, the step shall append no line and shall journal and record that existing line as the lesson.
  - R2. WHEN the file holds no such line, the step shall append exactly one line as at f7dd8c7: the pending line of an earlier attempt when one is journaled, else the line dated with the UTC date of the close; a line of another card, or of the same card with another kind, rule or source, does not count as written.
  - R3. The `close` directive of a card whose lesson step is open shall leave `lessons` out of the steps it tells the agent to complete through the metadata procedure, and shall state that `--lesson` appends the line to docs/LESSONS.md itself, so the line is not written by hand; it still names `--skip-lesson` and that `--all` never records the step.
  - R4. docs/OPERATIONS.md, right after the Lessons sentence of the STOP reasons section that ends with `when a review block or an incident taught a rule the playbook did not state.`, shall carry the OPERATIONS sentence of the Doc text section, and the CHANGELOG Unreleased section shall carry its entry.
acceptance:
  - 1. `tests/scenarios/lesson-dup.test.ts`: a card at CLOSE with the five mechanical steps marked, docs/LESSONS.md holding a hand-written line for that card with the lesson's kind, rule and source dated one day after the UTC date of the clock, then `markClosure` with that lesson text: the closure records `lessons` true, the file holds exactly that one line for the lesson (byte-equal to the hand-written one), the last `EVIDENCE_RETAINED` names it as `lesson`, no `EVIDENCE_RETAINED` carries `lessonPending`, and the next `card next` returns `done`. At f7dd8c7 the file holds two lines for the lesson. [R1] [dod arm 2]
  - 2. Same file: with the file holding lines for the same card with another rule, another kind and another source, and a line with the same kind, rule and source for another card id, `markClosure` appends exactly one line, dated with the UTC date of the clock, and every earlier line is still there unchanged. [R2] [dod arm 2]
  - 3. Same file: the `close` directive of a card with all six steps missing names the steps `(metadata, docSync, findings, evidence, cleanup)` to complete by hand, `aidlc card close <id> --metadata` to mark them, says that `--lesson` appends the line to docs/LESSONS.md itself, and names `--skip-lesson` and `--all`; with only `lessons` missing it names no step to complete through the metadata procedure, and names `aidlc card close <id> --lesson "` and `--skip-lesson`. At f7dd8c7 both list `lessons` among the steps completed through the metadata procedure. [R3] [dod arm 2]
  - 4. Same file: one assertion per sentence of the Doc text section, read from docs/OPERATIONS.md (after the Lessons sentence of the STOP reasons section) and from the CHANGELOG Unreleased section, so removing any one fails the test. [R4] [dod arm 2]
  - 5. `npm run typecheck` is clean [dod arm 1]; tests/surface/lessons.test.ts, tests/scenarios/t0-flow.test.ts (one line appended, a retry writes no second line, a retry on another date reuses the pending line), tests/scenarios/fault-points.test.ts and tests/surface/prose.test.ts pass with no assertion changed (reviewer-verified against the diff). [R2] [R3] [dod arm 2]
depends_on: []
budget: 60
tdd: true
diagnosis:
  root_cause: "The `close` directive (src/loop/card-runner.ts:2747 at f7dd8c7) lists `lessons` among the missing steps to complete through the existing approved metadata procedure and then mark with `aidlc card close`, so an agent writes the lesson line by hand and then passes `--lesson`. `markClosure` (:2758) skips its append only when docs/LESSONS.md holds the exact line it would write (`hasLesson`, src/artifacts/lessons.ts:95-98, called with `pending ?? formatLesson(entry)` at :2784): the pending line of an earlier attempt, else the line dated with the UTC date of the close. A hand-written line with any other date, such as a local date in GMT+13, is not that line, so a second copy is appended. Seen at the close of a card of goal g-20261019092137-6fcee2 (follow-up 2 of the harness2 report); reproduced through the CLI at f7dd8c7: a hand-written line dated one day after the UTC date and `card close --lesson` with the same text leave two lines."
  same_class: "Writers in src/ that skip an append when the line is already there (sweep): (1) `markClosure`, the lesson step: fixed here (R1). (2) `appendLesson` itself checks nothing and is only called from `markClosure`: unchanged. (3) src/state/journal.ts, the only other `appendFileSync`, appends hash-chained events and checks no line: not the same class. Finding dispositions are deduplicated by marker in src/core/review-policy.ts, not by a dated line: unchanged."
sweep: "git grep -n -E 'appendFileSync|hasLesson|appendLesson|formatLesson' -- src (f7dd8c7): lessons.ts:95, :106-118, card-runner.ts:2784-2788, journal.ts:142. git grep -n -E 'missing closure steps|metadata procedure|--skip-lesson' -- src tests docs templates .claude: card-runner.ts:2745-2747, lessons.test.ts:187-188, t0-flow.test.ts:98 (both assert the flags are named, kept), card-loop.md:103 in .claude and templates (names the metadata procedure for status and doc_sync only, unchanged)."
forbid: [a change to the frozen lesson line format or LESSON_LINE, rewriting or removing an existing line of docs/LESSONS.md, matching a lesson by wording other than the exact kind, rule and source, a change to appendLesson's append-only writes, a change to an existing assertion]
non_goals: [a lesson written by hand in another wording or with a malformed line (it still gets the line `--lesson` writes), the base-sync R3 prompt maxRounds, the R2 advisory on recordReviewOutcome, the card-loop.md CLOSE text]
doc_sync: docs/OPERATIONS.md (STOP reasons, the Lessons paragraph), CHANGELOG.md
---

# T0-LESSON-DUP

## Deliverable
`CardRunner.markClosure` (src/loop/card-runner.ts) treats a lesson line that docs/LESSONS.md already holds for the same card, kind, rule and source as written, whatever its date: the lesson step appends nothing and records that line. A new helper in src/artifacts/lessons.ts finds such a line. Without one, the step appends one line as before. The `close` directive no longer lists `lessons` among the steps to complete through the metadata procedure; it says `--lesson` appends the line itself, so the agent does not write it by hand. Until now a line written by hand and then recorded with `--lesson` was appended twice whenever its date was not the UTC date of the close. docs/OPERATIONS.md and CHANGELOG.md state the rule.

## Doc text
- OPERATIONS: `aidlc card close --lesson` appends that line itself, so it is not written by hand; a line the file already holds for the same card, kind, rule and source counts as written under any date, and the step appends nothing (card T0-LESSON-DUP).
- CHANGELOG: - T0-LESSON-DUP (bugfix): `aidlc card close --lesson` appends no second line for a lesson that docs/LESSONS.md already holds for the same card, kind, rule and source under another date, and the close directive says the flag writes the line itself instead of listing the lesson step among the steps completed by hand. Before, a line written by hand and then recorded with `--lesson` was appended twice whenever its date was not the UTC date of the close.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/lesson-dup.test.ts tests/surface/lessons.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: typecheck is clean; a lesson already in the file under another date is recorded with no second line, any other line leaves the one append as before, the close directive says `--lesson` writes the line itself, the doc sentences are present, and the existing lessons, T0 flow, fault-point and prose tests pass.
