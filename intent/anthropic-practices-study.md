---
slug: anthropic-practices-study
title: Card the practices of Anthropic's articles on Claude Ship, verification, code review, skills and context that this repository's records support
author: asun28 (owner); drafted by the coordinator session
status: accepted
created: 2026-11-24T05:20:00Z
source: human
---

# Intent: Card the practices of Anthropic's articles on Claude Ship, verification, code review, skills and context that this repository's records support
Author: asun28 (owner); drafted by the coordinator session. Status: accepted.

The status is accepted under the owner's instruction quoted below, which asked for cards from what the coordinator and Codex agree. The owner has not read this result.

## Problem
The owner listed 26 pages on 2026-11-24 (Anthropic's articles and documentation on Claude Ship, verification, code review, skills, CLAUDE.md, loops, context engineering, test impact analysis and source control) and asked: "Deepresearh below pages and it's sub ones if important and compare with what we are doing and our problems that we are facing see if we can borrow P0 P1 P2 some improvamnce from advisory for our AIDLC project. [the links] bring Codex Astra max and disscuss and make agreements on P0 P1 P2 improvemance and to create cards with AIDLC loop".

The coordinator (Claude Fable 5.2) and Codex gpt-6-astra, read-only at reasoning effort max, discussed the 26 pages and 18 pages they link to and agreed. Every outside figure is a lead, not evidence. Each practice was checked against this repository by read-only scripts over the card-run records, the goal records, the journals and the session logs, on main at 276d3874 to 9278ab1d. The page texts, the scripts, their outputs, the briefs and the answers are in `_local/anthropic-practices-consensus/`, which is not tracked. One of the pages, the AI-native SDLC playbook, is the design this repository implements, so most of what the pages ask for is here already.

## The sources checked against this repository
| What the sources ask for | What the records show | Result |
| --- | --- | --- |
| Human time is the scarce resource and is measured: approvals, comments, how long a change waits on a person | The most frequent recorded owner act is a deadline extension: 62 in November 2026 on 43 goals, four of them created in October (39 of the 166 goals created in November were extended); 40 of the 62 were granted after the deadline had passed, at the median about 5 hours after it (the two middle values are 4.6 and 5.1); 34 of the 43 extended goals reached DONE. 16 findings were ruled (15 deferred, 14 with a recorded issue number), and 8 amendments and 4 continuations are recorded. These are recorded interventions: no record measures the time the owner worked. `aidlc bounds` prints a count of extensions per goal and no act by period | Card T0-BOUNDS-OWNER-ACTS (P0). The limits themselves are the owner's (below) |
| Review effort follows the risk of the change, a repository says what failure looks like per area, and a path can carry a higher bar; adversarial review can ask for validation against concerns that do not arise | Every block on every path is merge-blocking (`gateRequired` true, `tierPaths` empty). Card runs with a formal decision since 2026-11-10: a card naming a `bench/` code path passed its first decision 5 of 19 times, with 28 blocks in 46 decisions, 7 runs stopped for review at some point and 13 of the 16 ruled findings; a card naming another `src/` path 50 of 75 times, with 39 blocks in 135 decisions. One reader's labels of every third finding that cites `bench/` (31 of 92, not adjudicated): about 7 name a wrong result on an input the repository's commands produce, 9 allege missing behavioural coverage or fixtures that do not discriminate, about 8 name handling of an input that the card's requirements asked for, about 7 name an input or environment no command writes and no requirement names | Card T0-REVIEW-REPORT-SCRIPTS (P0). The tier that exists and a smaller allowance are deferred |
| The reviewer is scored on past defects with clean controls, scored again whenever its prompts, tools or model change, with a tuning set apart from the test set | The reviewer bench exists. A report records the `REVIEW.md` hash, its options, the argv of a `--pre-command` override and the path and hash of a `--formal-command` file; it does not record the commit read, the lessons each prompt carried, the command and effort of each dispatched review, or the case bytes, and `docs/reliability/panel.md` had to reconstruct two of these. Three commits changed what the reviewer receives since the arms run of 2026-11-16, and the last recall over all 124 cases is of 2026-11-15 | Card T0-BENCH-INPUTS (P1). No test split is carded: it needs an exposure audit first |
| Review converges: a cap on rounds, diff-only later review, a class per finding, no repeats | The cap (4 decisions), the class and the re-raise identity exist. The block rate by decision number is 134 of 272, 63 of 146, 23 of 51 and 12 of 27. Since 2026-11-15, 25 of 32 later blocks hold a re-raised finding. Where the later findings sit, by a line comparison with stated limits: 13 of 37 placed on lines the repair did not change | No card. The owner dropped diff-scoped later review on 2026-11-14, and nothing measured here reopens it |
| A change cannot modify its own checks; a review is bound to a commit; a new gate starts in observe mode | `REVIEW.md` is read from the main checkout (its working tree, not a commit), the card contract is pinned by hash in the run record, and a review is bound to one candidate | Already here |
| Verification by running; for a fix, the failing test first | DoD and RED receipts are machine checks. A recorded repro does not establish a benefit or its absence in these records (3 of 23 findings re-raised with one, 40 of 334 without, on selected samples) | No card |
| Minor findings do not block | Blocks whose every reason is P2: 16 of 88 since 2026-11-15. The unpublished arms report on the branch of T1-ARMS-REPORT measures 6 of 34 hits tagged P2, 17.6%, against the owner's maximum of 15% | No change: the owner's rule of 2026-11-16 stands |
| A miss becomes a rule only after two occurrences and a check; rules are pruned | `docs/LESSONS.md` grew from 25,845 bytes on 2026-10-01 to 102,457; delivery is bounded (3,000 bytes to the reviewer, the newest lines to the card writer and the implementer) | No card |
| Test selection, a merge queue, a rule for flaky tests | Pull-request CI takes 8.7 minutes at the median (60 runs of 2026-11-22 to 24); 31 of 31 pushes to main are green; 1 of 30 CI classifications is transient | No card |
| Lean CLAUDE.md and skills, loaded when needed; skill use is measured | Read or Skill requests detected in the session logs, not successful loads: of 67 sessions that ran a loop command, the loop skill in 65 and its card module in 61; of 52 that edited a test file, the tdd skill in 37. 38 of 83 logs hold a compaction; after 19 of 43 compactions followed by a loop command (19 of 44 at Codex's later reading) a module read, a Skill request or an agent prompt naming the module came before it, which does not establish that the module was read again | No card. The tdd figure belongs to `intent/tdd-rule-reach.md` |
| The Claude Ship products | Team and Enterprise plans; a second coordinator beside this loop | Not adopted |

## Proposed outcome
1. P0, card T0-BOUNDS-OWNER-ACTS: `aidlc bounds` reports the recorded owner acts by month (extensions and how many came after the deadline, continuations, amendments, rulings), who recorded them, and the card runs left in STOP by month. No command changes what it does.
2. P0, card T0-REVIEW-REPORT-SCRIPTS: both `REVIEW.md` copies gain a section that says what blocks a report script under `bench/`, the policy version moves to `REVIEW.md@8`, and the card template and the planner say what a card for such a script asks for.
3. P1, card T0-BENCH-INPUTS: a bench report records the commit and state of the checkout, the hash of each case file and, per review, the command, the effort, the lesson hash and the prompt hashes.
4. P2: empty.
5. Order: card 1, then card 2, then card 3, one after another (each edits `docs/OPERATIONS.md`).
6. Not carded, each with what would reopen it:
   - A time grant carried by the owner's own act (`--until` on `card continue`, `card amend`, `review rule`): 4 of the 62 November extensions fall within 30 minutes of such an act and 6 of 17 acts were made past the deadline. Reopened by a count from card 1's report and `_local/anthropic-practices-consensus/facts7.ts`.
   - A test split of `evals/review/`: an exposure audit of the cases, individual adjudication and a family-grouped reservation before first scoring.
   - A record of skill loads by a new hook: the session logs hold the read and Skill requests it would record (detected requests, not successful loads). Reopened by a count of corrections or violations after a compaction.
   - `bench compare` naming the inputs that differ: after card 3 has produced reports that hold them.
   - Test selection (sustained CI above 10 minutes, Plan A), a merge queue, a flaky-test rule, a repro step, lesson pruning, more reviewers, verifier agents, HTML reports, `.claude/rules/`: a measured cost in this repository's records, or an escaped defect attributable to the gap.
   - An automatic pass after repeated blocks: the same, and the owner's explicit authorization besides, since it sets a required verification aside.

## Affected users and systems
Through card 1: `src/state/bounds.ts`, its two test files, `docs/OPERATIONS.md`, `README.md`. Through card 2: both `REVIEW.md` copies, both configuration files, both card templates, both planner copies, `docs/OPERATIONS.md`, `tests/surface/templates.test.ts`, and through the templates every repository that runs `aidlc init` afterwards; the text of every review prompt changes. Through card 3: `src/review/bench.ts`, `tests/surface/review-bench.test.ts`, `docs/OPERATIONS.md`, `evals/review/README.md`.

## Constraints
- Outside figures are leads, never evidence.
- No new blocking gate on a card run, no new dependency, no change to `tierPaths`, `gateRequired`, an allowance constant, a deadline or the verdict schema.
- The agreements of 2026-11-17 (Plan A), 2026-11-18 (Plan B), 2026-11-23 (lesson delivery) and 2026-11-24 (agent quality) stand, and so do the owner's decisions of 2026-11-14 (later review) and 2026-11-16 (P2 findings).
- `CLAUDE.md` is not changed.
- No goal is opened by this intent: a goal's deadlines start when it is created.

## Limits of the measurements
Review findings are not adjudicated defects, and runs of one card family are correlated. The reading of the `bench/` findings is one reader's on a third of them. The `by` text of an act is free text: it shows recorded attribution, not authenticated authority. The extension figures do not say who waited for what. The line comparisons of later findings choose the previous candidate by its commit, test added-side hunks only and take a site as a file and a start line; Codex could not rerun them in its sandbox. The session-log counts are detected tool requests, not successful loads, and do not show that a read came before an edit. Pass rates by path compare different work, not one change under two bars.

## Decisions left to the owner
1. Open a goal for each card when it should run, in the order above.
2. The limits of a goal and whether a wait counts against them (`src/core/deadlines.ts:4-7`): of the 128 single-card November goals that reached DONE, 24 took over 3 hours, 15 over 6 and 8 over 12, and 10 of the 32 goals that started with 12 hours were extended too. Card 1 reports the acts by month and the two intervals its requirements name; it does not report these lifetimes, and it changes no limit.
3. Three cards have waited for a ruling since they stopped at decision 4: T1-OUTCOME-HISTORY (2026-11-11), T1-REVIEW-FOLLOWUP-ISSUE and T1-ARMS-REPORT (2026-11-16). The third holds the measured answers on rounds inside a decision, the verdict field order, the R2 arm and the P2 share.
4. Registered cards for `bench/` scripts whose requirements ask for broad refusals keep them until the owner amends them; card 2 changes what new cards ask for and what a reviewer blocks on beyond a card's requirements.
5. Card 2 changes text that every review receives. A reviewer bench comparison before and after calls models and is the owner's option; card 3, run first or second, would record what each side of it measured.
6. The sources name `/doctor prompt-audit` and `/skill-doctor` for CLAUDE.md and the skills; whether the installed Claude Code has them was not checked.
7. Whether to file issues for the rows of outcome 6.

## Open questions
- (none)
