---
id: T1-BENCH-ROUNDS
title: aidlc review bench run --rounds reviews a blocked candidate again inside one decision with the found reasons marked not to repeat, while a round adds a new P0 or P1 reason, and scores every round
status: todo
branch: T1-BENCH-ROUNDS
worktree: D:\wt\AIDLC\T1-BENCH-ROUNDS
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/review/bench.ts
  - src/review/pre-review.ts
  - src/cli/main.ts
  - tests/surface/review-bench-rounds.test.ts
  - docs/OPERATIONS.md
  - tests/surface/review-bench.test.ts
  - specs/tasks/T1-BENCH-ROUNDS.md
dod_command: npm run typecheck && node --test tests/surface/review-bench-rounds.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts tests/surface/lesson-match.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/edge-scope.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review bench run` shall take `--rounds <n>`, an integer from 1 to 3, default 1. Any other value, and a value above 1 with `--stage pre`, are refused before any review with the option named. With `--rounds 1` every prompt and case score is as on main.
  - R2. With `--stage formal` and `--rounds` n above 1, each group and trial (src/review/bench.ts:166-188) shall review round 1 as on main; round r+1 (r < n) runs on the same checkout when round r's bound verdict is a block (`bindToCandidate`, :318-325) that adds at least one new cited reason (`citedReasonsOf`) and at least one of its new reasons has `findingSeverity` P0 or P1 (T1-REVIEW-SEVERITY); every cited reason of round 1 is new. A reason is new when its `findingIdentity` (T1-FINDING-IDENTITY), with lines read from the checkout's working tree, differs from the identity of every cited reason of an earlier round, or, when it or an earlier reason has no identity, when its trimmed text differs from every earlier cited reason's. A round ending in no verdict or a quota hold stops the rounds of that group; a quota hold also holds the rest of the run as on main (:176).
  - R3. `buildReviewPrompt` (src/review/pre-review.ts:393-478) shall take `foundInDecision` (optional list of reasons). When it is not empty, the prompt shall hold, directly after the `## Prior findings` section, a section `## Found earlier in this decision` with one line per reason, the reason as a JSON string after `- `, preceded by the sentences: "These defects are already reported for this candidate in this decision. Do not report them again and do not re-raise them with re:F<n>. Review the whole diff for defects they do not cover. Block only on a defect not listed here; pass when you find none." The bench passes every cited reason of rounds 1 to r to round r+1. When the list is absent or empty the prompt is byte-identical to main; the card runner never passes it.
  - R4. With `--rounds` above 1, a bug case's `outcome` and `matched` shall be scored on the cited reasons of every round run, in round order; a clean case is `false-block` when any round blocked. Each case result shall carry `rounds`, one entry per round run with `outcome` (the score on rounds 1 to r), `durationMs` (that round's panel wall time) and `cited` (the count of that round's cited reasons); the report shall carry `roundTotals`, the trial-1 totals after rounds 1 to r for r from 1 to n, a case with fewer rounds keeping its last score.
  - R5. Every report shall carry `options` with `rounds` (the value used).
  - R6. docs/OPERATIONS.md (Reviewer bench, at the `aidlc review bench run` paragraph) shall state R1 to R5.
acceptance:
  - 1. `tests/surface/review-bench-rounds.test.ts` (new), "T1-BENCH-ROUNDS acceptance 1: rounds run while a block adds a new P0 or P1 reason and the found reasons reach the next prompt". Scripted reviewer (the `runner` option): round 1 blocks with a `[P1]` miss, round 2 blocks with a new `[P0]` hit, round 3 is not run at `--rounds 2`; round 2's prompt holds the section of R3 with round 1's reason. Fails on main (option refused). [R1] [R2] [R3] [R4] [dod arm 1]
  - 2. Same file, "T1-BENCH-ROUNDS acceptance 2: no further round after a pass, after a block with only repeated or only P2 new reasons, or after no verdict". Repeated covers same identity with other text, and same text with no identity. Fails on main. [R2] [dod arm 1]
  - 3. Same file, "T1-BENCH-ROUNDS acceptance 3: rounds and roundTotals score each round on the union of cited reasons, and a clean case blocked in round 2 is a false block". Fails on main. [R4] [R5] [dod arm 1]
  - 4. Same file, "T1-BENCH-ROUNDS acceptance 4: --rounds outside 1 to 3, or above 1 with --stage pre, is refused before any review, and --rounds 1 prompts as main does". Fails on main for the refusals. [R1] [R3] [dod arm 1]
  - 5. tests/surface/review-bench.test.ts, pre-review.test.ts, lesson-match.test.ts, r2-pass-notes.test.ts, edge-scope.test.ts and prose.test.ts pass with no line changed. [R1] [R3] [dod arm 1]
  - 6. The OPERATIONS.md paragraph is as R6 states (reviewer-verified against the diff). [R6]
depends_on: [T1-REVIEW-SEVERITY-3, T1-FINDING-IDENTITY]
budget: 230
tdd: true
sweep: "Main at 0f28b51e. bench.ts: `runReviewBench` :147-188 (stage config :153, groups :166-170, trials :173-179, quota hold :176 and :294), `reviewGroup` :199-215 (detached checkout), `reviewIn` :257-300 (prompt `common` with `priorFindings: []` and `round: 1` at :278; formal :287-292), `bindToCandidate` :318-325, `score` :327-338, `totalsOf` :340-356, `ReviewBenchReport` :69-85, `BenchCaseResult` :35-49. pre-review.ts: `buildReviewPrompt` :393-478 (Prior findings at :450), `renderPriorFindings` :264-290. CLI: `review bench run` src/cli/main.ts:1167-1187 (`--rules` checked :1179, `--trials` :1180)."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test, other than an expected literal that pins the exact text of a document line this card's requirements change, or the exact shape of a record or report whose fields this card's requirements add (a deepEqual of `FindingStats`, `ReviewFinding`, a bench report or case result, or `CardRun['closure']`), updated to the new text or by the added fields and nothing else, each such line named in the Attempt evidence with the requirement that changes it (a test file outside allow_paths needs a recorded amendment first)
  - a change to the prompt, schema or verdict handling of the card runner's R2 or R3
  - writing aidlc.config.json or any configuration file from the bench
non_goals: [rounds in the card loop, the verdict field order and an R2 reviewer argv (T1-BENCH-ORDER-PRE), running the arms, a change to CHANGELOG.md]
hygiene: "Run `npm run check` (typecheck and the full suite, as CI runs it) in the worktree before recording the attempt and put its totals in the Attempt evidence (lesson of T1-REVIEW-SEVERITY-2, CI run 43757539597). Line numbers are from main at 0f28b51e and move with T1-REVIEW-SEVERITY and T1-FINDING-IDENTITY; read them again at PREPARE."
doc_sync: docs/OPERATIONS.md (Reviewer bench)
---

# T1-BENCH-ROUNDS

## Deliverable
`aidlc review bench run --rounds 3` measures how many more of a candidate's defects R3 finds when a blocked candidate is reviewed again inside one decision with what it already found marked "do not repeat".

## Why
33.3% of cards with a formal decision had two or more blocks and 45.2% passed at decision 1 (docs/reliability/baseline.md). OCR runs a second round inside one decision with the confirmed findings marked "do not repeat" and stops when a round finds nothing new; the outside review of 2026-11-15 ranks it first, to be measured on the recall baseline before the loop uses it. Owner's keep rule and the P0/P1 trigger: intent/review-recall.md, Decisions 2026-11-16.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/review-bench-rounds.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts tests/surface/lesson-match.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/edge-scope.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.

## Attempt evidence

Attempt 1 (base main 7001e968).

RED: commit 9b52b7b3, `node --test tests/surface/review-bench-rounds.test.ts`, 4 of 4 failing for the stated reasons:
- `not ok 1 - T1-BENCH-ROUNDS acceptance 1: ...`: AssertionError, `calls.length` actual 1, expected 2 (the option is ignored, one review).
- `not ok 2 - T1-BENCH-ROUNDS acceptance 2: ...`: AssertionError, actual 1, expected 2 (scenario "the same identity in other words": no second round).
- `not ok 3 - T1-BENCH-ROUNDS acceptance 3: ...`: AssertionError, actual 2, expected 5 (one review per candidate).
- `not ok 4 - T1-BENCH-ROUNDS acceptance 4: ...`: `Missing expected rejection: 0` (`--rounds 0` not refused).

Changed after RED, in the new test file only: the acceptance 1 literal `## Prior findings\n- none` corrected to `- none (first round of this cycle)`, the text `renderPriorFindings` gives for no finding (the test was wrong, the prompt is unchanged); added at GREEN, each shown failing by a mutant below: the acceptance 2 check that a repeated reason is listed again (M8), the acceptance 3 duration sum with scripted receipt durations (M26), and the acceptance 4 CLI refusal naming `"two"` (M25).

| Item | Proof | Result |
|---|---|---|
| 1 | tests/surface/review-bench-rounds.test.ts, acceptance 1 (scripted runner, real git checkout) | pass |
| 2 | same file, acceptance 2 (pass, no verdict in round 1 or 2, same identity in other words, same trimmed text with no identity, P2-only and repeated-only rounds, quota hold, the working-tree reader) | pass |
| 3 | same file, acceptance 3 | pass |
| 4 | same file, acceptance 4 (library and CLI refusals, `--rounds 1` prompt equal to a run without the option, empty `foundInDecision` byte-identical) | pass |
| 5 | review-bench, pre-review, lesson-match, r2-pass-notes, edge-scope and prose tests in the DoD, all pass; pre-review.test.ts prompt hashes unchanged | pass |
| 6 | docs/OPERATIONS.md, Reviewer bench, new paragraph "`--rounds <n>` (card T1-BENCH-ROUNDS; ...)" directly after the `aidlc review bench run` paragraph | reviewer-verified |

Pinned literals updated (forbid exception), tests/surface/review-bench.test.ts:
- line 440, `OPERATIONS_SECTION`: one element added, the R6 paragraph, its text equal to the docs paragraph; no existing element changed.
- line 766, `Object.keys(report)` in "T1-BENCH-TRIALS-2 acceptance 3": `'options'` added after `'rules'` (R5); nothing else.

Working-tree reader (`checkoutLines`, src/review/bench.ts): realpath, then `resolvesInside` the checkout, then `isFile`, all inside a try; a NUL path, `../outside.ts`, an absolute outside path, a directory and a missing file give no lines (acceptance 2). The symlink-out case runs where the account can create links; this Windows account cannot (EPERM), so it ran here only through the `../` and absolute cases.

Mutants (each applied alone, `node --test tests/surface/review-bench-rounds.test.ts`): all 26 killed.
M1 severity filter dropped (acc 2); M2 P0 only (acc 1-3); M3 P1 only (acc 2-3); M4 newness by text only (acc 2-3); M5 newness by identity only (acc 2); M6 no trim (acc 2); M7 every reason new (acc 2-3); M8 only new reasons passed on (acc 2); M9 score on the last round only (acc 1-3); M10 clean false block on the last round only (acc 3); M11 no roundTotals carry-forward (acc 3); M12 range refusal dropped (acc 4); M13 pre refusal dropped (acc 4); M14 found reasons not passed (acc 1-3); M15 quota hold not held (acc 2); M16 reader leaves the checkout (acc 2); M17 reader throws (acc 2); M18 `rounds` on one round (acc 4); M19 `roundTotals` on one round (acc 4); M20 per-round cited count of the union (acc 1-3); M21 section on the pre stage only (acc 1-3); M22 section text changed (acc 1-3); M23 section on an empty list (acc 1, 4); M24 `options` dropped (acc 1, 3, 4); M25 CLI integer check dropped (acc 4); M26 case duration of the last round (acc 3).

DoD: exit 0, 151 tests, 150 pass, 0 fail, 1 skipped (T1-LESSON-MATCH acceptance 4, NTFS refuses a tab or a quote in a name).
Full suite (`npm run check` on 99ac1143): exit 0, 3737 tests, 3709 pass, 0 fail, 28 skipped.
Diff against main: src 94 added, 23 removed (bench.ts +83/-21, pre-review.ts +5, main.ts +4/-2); docs +2; tests +253/-1 (new file 251).

Repair of R3 decision 1, F1 (`[P2] 14 scope fidelity (class: missing-case-rounds) @ src/review/bench.ts:327`), base main 7001e968.

RED: commit 8664e6b7, `node --test tests/surface/review-bench-rounds.test.ts`, acceptance 3 failing: AssertionError, `rounds` actual `undefined` for b-unscorable, c-card-absent, d-bad-checkout, e-wrong-card and g-skipped (expected `['error', 'error']` and `[]`). Added assertions only; no existing line of the file changed.
Fix: commit 173f58a4.

Class sweep: every path in src/review/bench.ts that builds a case result, with `--rounds` above 1, and the acceptance 3 case that shows its `rounds`:
| Path | `rounds` | Case |
|---|---|---|
| `score`, scored (hit, miss, pass, false-block) | one entry per round run | a-scored `['miss', 'miss']`; a-hit, b-miss, c-clean, d-clean above |
| `score`, no verdict or quota hold in the round | one entry per round run | f-quota `['no-verdict']` |
| `errorOf` from `unscorable(c)` in a reviewed group (expected file not changed) | an `error` entry per round run, `cited` per round | b-unscorable `['error', 'error']`, cited `[1, 0]` |
| `errorOf` before any round: card file absent | `[]` | c-card-absent |
| `errorOf` before any round: card file outside the checkout, card does not parse, no committed diff | `[]` (same fill in `runReviewBench`) | the c-card-absent fill (F1-M2 shows the fill is per result) |
| `errorOf` from `reviewGroup`: `git worktree add` fails, or a throw | `[]` | d-bad-checkout |
| `errorOf` when every case is unscorable (card id mismatch) | `[]` | e-wrong-card |
| `stopped` (quota hold stopped the run) | `[]` | g-skipped |
`roundTotals`: a case with `rounds: []` keeps its own outcome for every r (the docs paragraph says so); acceptance 3 asserts `errors: 4, noVerdict: 2` in both entries.

F1 mutants (each alone, `node --test tests/surface/review-bench-rounds.test.ts`), all killed: F1-M1 empty list dropped on every no-round path (acc 3); F1-M2 dropped for a card file absent (acc 3); F1-M3 dropped for a failed checkout (acc 3); F1-M4 dropped for an all-unscorable group (acc 3); F1-M5 dropped for a quota stop (acc 3); F1-M6 empty list on `--rounds 1` too (acc 4); F1-M7 no error entries for an unscorable case in a reviewed group (acc 3); F1-M8 `roundTotals` without the empty-list check (acc 2, 3); F1-M9 a no-round case counted as no outcome in `roundTotals` (acc 3).
Pinned literal: tests/surface/review-bench.test.ts line 440 (the R6 paragraph this card added) updated to the new docs text, two clauses added; nothing else.

DoD on 173f58a4: exit 0, 151 tests, 150 pass, 0 fail, 1 skipped (T1-LESSON-MATCH acceptance 4, NTFS).
Full suite (`npm run check` on 173f58a4): exit 0, 3737 tests, 3709 pass, 0 fail, 28 skipped.
