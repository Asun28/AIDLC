---
id: T1-PANEL-ARMS-REPORT
title: docs/reliability/panel.md reports Codex+Codex against Codex+Fable 5.2 as panels of R3, from the saved 2026-11-16 Codex pair and the Fable runs, with union, intersection and unique hits computed in bench/outcome/panel.ts, against the keep rule of intent/review-panel.md
status: todo
branch: T1-PANEL-ARMS-REPORT
worktree: D:\wt\AIDLC\T1-PANEL-ARMS-REPORT
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - bench/outcome/panel.ts
  - bench/outcome/panel.json
  - bench/outcome/README.md
  - docs/reliability/panel.md
  - tests/surface/outcome-panel.test.ts
  - specs/tasks/T1-PANEL-ARMS-REPORT.md
dod_command: npm run typecheck && node --test tests/surface/outcome-panel.test.ts tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `unionOf(members)` (new, exported from bench/outcome/panel.ts, pure) shall take two or more members, each the case results of one bench report trial, and return over the case ids every member holds: per member hits and false blocks; `union` (a bug case hit when any member hit it, a clean case a false block when any member blocked it); `intersection` (hit or false block only when every member did); `uniqueHits` per member; and `excluded`, the ids of cases that are `no-verdict` or `error` in any member, counted in neither union nor intersection.
  - R2. `node bench/outcome/panel.ts assemble --commit <sha>` shall read the inputs of the body section Inputs and refuse, writing nothing, when a file is missing or unparsable, a report's stage is not `formal`, a Fable report lacks `options.formalCommand` or a Codex report has one, the policy hashes of the paired reports differ, or the case ids of a pair differ.
  - R3. `measures` in panel.json shall hold, for stage 1: Codex round 1 alone, Codex+Codex (round 1 with the field-order run), Codex+Fable (round 1 with Fable), each with R1's fields, on the miss subset and the clean cases; and, when stage 2 inputs exist, the same per trial and as median, min and max over 3 trials on all replay and clean cases, with the median per-triple wall time of the slower member over that of single Codex.
  - R4. `keep` in panel.json shall apply the stage gate and keep rule of intent/review-panel.md as the owner accepted it before this card starts: `stage2` is `run` only when Fable's unique hits over Codex round 1 are at least the field-order run's (8); with stage 2 inputs, `panel` is `keep` only when the better composition gains at least 7 hits at the median over single Codex with at most 1 more false block and a wall-time ratio of at most 1.5, and `member2` is `fable` only when Codex+Fable gains at least 5 hits at the median over Codex+Codex with at most 1 more false block, else `codex`. Without the gate, `stage2` is `skip` and `panel` and `member2` are absent.
  - R5. `docs/reliability/panel.md` (new) shall begin `# Review panel`, hold the sections `Method`, `Earlier records`, `Stage 1`, `Stage 2` (stating "not run" and the gate value when absent), `Keep rule` and `What these numbers do not show`, and give every number in a table row `| <measure> | <value> | <source> |` whose source is a code span holding a JSON pointer into panel.json or the path of an earlier record. Earlier records cites the rows of intent/review-panel.md (Existing bench records). What these numbers do not show names: the stage 1 subset was chosen for baseline misses, the field-order run is not an identical rerun, Fable ran with about 10 more lessons in docs/LESSONS.md than the 2026-11-16 Codex runs (same REVIEW.md), Fable hit its usage limit so its clean cases and 3 bug cases have no verdict (issue 385), one replay set from this repository, no loop measure yet.
  - R6. bench/outcome/README.md shall name panel.ts and panel.json.
acceptance:
  - 1. `tests/surface/outcome-panel.test.ts` (new), "T1-PANEL-ARMS-REPORT acceptance 1: unionOf gives union, intersection, unique hits and excluded". Fixture members hitting 33 and 35 of 64 with 27 shared give union 41, intersection 27, unique 6 and 8; a shared clean block is one union false block; a no-verdict case in one member is excluded. Fails on main (no module). [R1] [dod arm 1]
  - 2. Same file, "T1-PANEL-ARMS-REPORT acceptance 2: assemble refuses each input fault of R2 and writes nothing". Fails on main. [R2] [dod arm 1]
  - 3. Same file, "T1-PANEL-ARMS-REPORT acceptance 3: measures and keep equal those recomputed from the inputs". Fixture edges: Fable unique hits 8 and 7; gains 7 and 6; false blocks +1 and +2; ratio 1.5 and 1.51; Fable over Codex+Codex 5 and 4; stage-1-only inputs; and the committed panel.json. Fails on main. [R3] [R4] [dod arm 1]
  - 4. Same file, "T1-PANEL-ARMS-REPORT acceptance 4: panel.md has its title, sections and the banned-character rule, and every table value equals its source". Fails on main. [R5] [dod arm 1]
  - 5. outcome-baseline.test.ts and prose.test.ts pass with no line changed. [R6] [dod arm 1]
  - 6. The limits of R5 and the README line are as stated (reviewer-verified against the diff). [R5] [R6]
depends_on: [T1-BENCH-FORMAL-COMMAND, T1-BENCH-CLEAN-40-2]
budget: 300
tdd: true
sweep: "Saved Codex pair, policy aa7f80bac1a3: _local/arms/rounds-miss.json (`rounds[0]` per case is round 1, 33 hits), order-miss.json (35), rounds-clean.json and order-clean.json (1 of 15 each, the same case). Earlier unions computed by hand: _local/bench-step4/scripts (2026-11-07) and the arms of 2026-11-16. Pattern for assemble and the table-row rule: bench/outcome/replay.ts (assembleReplay, reduce) and, if merged by then, bench/outcome/arms.ts of T1-ARMS-REPORT (a card of goal review-recall, not of this goal)."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - a new bench run, or a rerun of an arm, inside this card
  - editing a report under _local/arms/, _local/panel-arms/ or a case under evals/review/
  - a keep verdict that differs from the rule of R4
non_goals: [a `bench union` CLI command, switching the panel on (T1-R3-PANEL-ON), a change under src/]
hygiene: "If the stage 1 Fable reports are missing, the Fable run's policy hash is not aa7f80bac1a3, or the owner has not accepted the keep rule in intent/review-panel.md, STOP/capability."
---

# T1-PANEL-ARMS-REPORT

## Deliverable
The owner reads in one page whether a second R3 reviewer finds enough more defects to run, and whether it should be Fable 5.2 or a second Codex run.

## Inputs
- Stage 1 (coordinator, from a worktree of main after T1-BENCH-FORMAL-COMMAND merges, while REVIEW.md still hashes to aa7f80bac1a3, the policy of the 2026-11-16 arms; it does at ff925160): `_local/panel-arms/fable-miss.json` and `fable-clean.json`, `aidlc review bench run --stage formal --formal-command bench/outcome/fable-r3.json --json` on `_local/arms/miss25` and on the 15 clean case files of main at 1def7f99, copied to `_local/panel-arms/clean15/` before T1-BENCH-CLEAN-40-2 merges (that card marks one of them unconfirmed; pass `--include-unconfirmed` so all 15 pair with the Codex runs). The Codex side is the saved pair under `_local/arms/`.
- Stage 2 (only when `keep.stage2` of a stage-1 assembly is `run`): `codex-replay.json`, `codex-clean.json`, `fable-replay.json`, `fable-clean.json`, `--trials 3` on `evals/review/replay` and `evals/review/clean` (40 confirmed cases after T1-BENCH-CLEAN-40-2).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-panel.test.ts tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the four new tests pass and the existing tests pass unchanged.

## Attempt evidence
Build attempt 1. RED receipt `c7a7ce14:outcome-panel acceptance 1-4` (with a stub `bench/outcome/panel.ts` exporting the signatures: acceptance 1 threw `not implemented`, acceptance 2 had no refusal for `missing file`, acceptance 3 had no document, acceptance 4 had no `docs/reliability/panel.md`; on main the module is missing).

| Item | Proof | Result |
|---|---|---|
| 1 | `acceptance 1` in `tests/surface/outcome-panel.test.ts` (33 and 35 of 64, 27 shared: union 41, intersection 27, unique 6 and 8; shared clean block is one union false block; no-verdict and error cases excluded) | pass (failed at RED) |
| 2 | `acceptance 2`: missing, unparsable, stage, Fable without and Codex with `formalCommand`, policy hash, case ids (stage 1 and 2), stage 2 not three trials, `--commit`; nothing written, and the CLI exits 1 with no `panel.json` | pass (failed at RED) |
| 3 | `acceptance 3`: Fable unique 8 and 7, gains 7 and 6, false blocks +1 and +2, ratio 1.5 and 1.51, Fable over Codex+Codex 5 and 4, stage-1-only inputs, stage 2 worked by hand, committed `panel.json` (61 bug cases; 33, 34, 20; unions 40 and 38; unique 5 and 7; 18 excluded; `keep` equals `keep(measures)`) | pass (failed at RED) |
| 4 | `acceptance 4`: title, six sections, no banned character, every table value equals its JSON pointer or appears in its intent/review-panel.md record | pass (failed at RED) |
| 5 | `outcome-baseline.test.ts` and `prose.test.ts`, no line changed | pass, DoD 29 of 29 |
| 6 | R5 limits in `docs/reliability/panel.md`, What these numbers do not show; README section `Review panel (panel.ts)` | present (reviewer to verify) |
| DoD | `npm run typecheck && node --test tests/surface/outcome-panel.test.ts tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts` | exit 0, tests 29, pass 29, fail 0 |
| Full suite | `npm run check` | exit 0, tests 3888, pass 3856, fail 0, skipped 32 |

Guard sweep (each guard loosened in turn, `outcome-panel.test.ts` run, restored): member count `< 2` to `< 1` (acc 1); ids held by every member to any member (acc 1); excluded no-verdict or error to no-verdict only (acc 1); excluded when some member to every member (acc 1, 3); blocked hit or false-block to hit (acc 1, 3); union some to every and intersection every to some (acc 1, 3); unique hit no other member to true (acc 1, 3); common scope of the three compositions removed (acc 3); median even branch to `s[h]` (acc 3); wall time per triple to per case (acc 3); slowest member to first member and to min (acc 3); gate `<` to `<=` (acc 2, 3); fable gain, panel gain `>=` to `>`, false blocks `<= 1` to `<= 2` in both rules, ratio `<= 1.5` to `<= 1.51` (acc 3); better composition fixed to Codex+Fable (acc 3); stage, both `formalCommand` checks, policy hash, case ids, `--commit`, three trials removed (acc 2); round 1 from `rounds[0]` removed (acc 2, 3); stage 2 read only on `run` removed (acc 3); Codex+Codex trial t with t+1 to t with t (acc 3). equivalent: `?.durationMs ?? 0` in the wall time, because `load` refuses pairs whose case ids differ in any trial, so every member holds every case.

Design points: stage 1 compares the compositions on the cases every one of the three reviews scored (61 bug, 0 clean; 18 excluded), which reproduces the coordinator's count; the gate threshold is the constant 8 of the Decisions, and the field-order run's unique hits on those cases (7) are recorded beside it; stage 2 inputs are read from `_local/panel-arms/stage2/`; a triple with a no-verdict case keeps its wall time. Diff size is over the budget of 300 lines (about 480 hand-written lines plus the 131-line generated `panel.json`), all in files the card names.

Build attempt 2 (R3 decision 1 block, six findings). RED receipt `f2af2452:outcome-panel acceptance 2-4`: with the new fixtures on the attempt 1 code, acceptance 2 failed (`an outcome outside the bench enum` was accepted), acceptance 3 failed (`excludedKinds` absent), acceptance 4 failed (counts in the limits). Stage 1 numbers of panel.json are unchanged (61, 33, 34, 20, 40, 38; unique 5 and 7); the only change is the new `excludedKinds` (bug 3, clean 15).

| Finding | Fix | Proof |
|---|---|---|
| F1 unbound record values | each earlier-record row is bound by its measure to its record and the phrase whose number is the value (`EARLIER`); swapped values fail | acceptance 4: 89 to 124, union 41 to 33 and Codex+Codex 40 to 41 each give one problem |
| F2 stage 2 summaries | `median`, `min`, `max` fold every numeric R1 field per composition (`cases`, kinds, members, union, intersection, unique hits) | acceptance 3: Codex+Fable median, min and max worked by hand |
| F3 prose counts | rows `/measures/stage1/excludedKinds/bug` (3) and `/clean` (15); the lessons limit states the fact without a count | acceptance 4: no count in the limits apart from stage, round and issue names and dates |
| F4 unvalidated cases | zod schema per case (id, kind, outcome, duration, rounds), outcome for its kind, duplicate id in a trial | acceptance 2: seven new faults, nothing written |
| F5 trial boundaries | every trial of every report of a kind holds the same case ids; stage 1 reports are one trial, stage 2 three | acceptance 2: `[a,b]/[c]/[d]` against `[a]/[b,c]/[d]`, consecutive Codex trials that differ, a two-trial stage 1 report |
| F6 triple key | triples from the case files (candidate, base, card path), once per triple and trial, slowest member; refuse a case with no case file and a non-finite ratio | acceptance 2: missing case file, all-zero Codex durations; acceptance 3: fixture without verdict files gives 1 and 200/150 |

Class sites checked: F1 every earlier-record row (14) and every pointer row; F2 `median`, `min`, `max` and `keep` (now reads `union`); F3 every prose line of panel.md (left: `SHA-256`, `T1-...`, `t+1 (mod 3)`, names); F4 every case of every trial, `rounds`; F5 stage 1 and stage 2 groups and the trial counts; F6 the timing of all three compositions, and the wall-time ratio.

Guard sweep, attempt 2 (loosened, `outcome-panel.test.ts` run, restored): kind enum, duration `>= 0` required, outcome for its kind, duplicate id, trial count, every trial same ids, missing case file, finite ratio (acc 2); triple key from case files, slowest member of a triple, `excluded` left out of the fold, `excludedKinds` by kind (acc 3); a round with a negative duration (acc 2). equivalent: the zod outcome enum for the outcome and for round outcomes, because the outcome-for-its-kind check rejects every value outside the enum.

Attempt 2 DoD: `npm run typecheck && node --test tests/surface/outcome-panel.test.ts tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts` exit 0, tests 29, pass 29, fail 0. `npm run check`: exit 0, tests 3888, pass 3856, fail 0, skipped 32.

Build attempt 3 (R3 decision 2 block, five findings; owner approved one more repair). RED receipt `a90a1d6a:outcome-panel acceptance 2-3`: the attempt 3 tests against the attempt 2 `panel.ts` (with only `LESSON_COMMITS` added so the file loads) fail acceptance 2 and 3, because the stage 1 fixture's error case with `rounds: []` (src/review/bench.ts:209) is refused where it must be left out; acceptance 4 then failed on the missing lesson rows. Each other new rule is shown by the guard sweep below (each guard loosened makes a fault of acceptance 2 pass). panel.json stage 1 numbers are unchanged (61, 33, 34, 20, 40, 38; unique 5 and 7); added: `lessons`.

Lesson counts (`parseLessonLine` of src/artifacts/lessons.ts over `git show <sha>:docs/LESSONS.md`, NEVER, ALWAYS and NOTE lines): arms 1418c7b9acc18621171384e3d92d7ffcbcde3a07 (merge of T1-BENCH-ORDER-PRE, PR 339; the arms worktrees `_arms-p` and `_arms-q` are gone and their reports name no commit, so this is the plan's pin) 171; the commits just before (35de54fe, committed 26 s before rounds-miss started) and after (ef3e0ac3) also 171. Stage 1 be8b2c8a584bd56b982e14d3f1c70f32d0e354f2 (`git rev-list -1 --before=2026-11-19T01:46:00Z origin/main`, includes be8b2c8a) 187. Added 16 (the card's estimate: about 10). The review prompt carries only the newest NEVER and ALWAYS lines within `REVIEW_LESSONS_MAX_BYTES`.

| Finding | Fix | Proof |
|---|---|---|
| 1 lessons count | `lessons` in panel.json (both commits, counts, added); five rows in the limits section | acceptance 3 (fixture 2 and 3 lessons, committed 171, 187, 16), acceptance 4 (rows present), refusal when LESSONS.md cannot be read |
| 2 empty rounds | an unscored case of a multi-round report may have `rounds: []` and is left out | acceptance 3: stage 1 fixture b28 `error` with `rounds: []` excluded, excludedKinds bug 2 |
| 3 rounds required | `validateReport`: with `options.rounds` above 1 every case holds `rounds` (at most that many), a scored case at least one ending on its outcome; a one-round report holds none | acceptance 2: five faults |
| 4 kind per id | `checkPairs`: same kind per id in every member of stage 1 and of each stage 2 trial | acceptance 2: stage 1 and stage 2 trial 2 faults |
| 5 id collisions | `checkPairs` compares sorted id arrays element by element; ids follow the `ReviewBenchCase` syntax | acceptance 2: `b3,b4`, `b 3`, a member whose ids are a prefix of the others' |

Fields panel.ts reads, and the check that guards each (all in acceptance 2 unless named):

| Field | Guard |
|---|---|
| report `stage` | `Envelope` string; `validateReport` formal stage |
| report `policyHash` | `Envelope` string; `load` one hash per stage |
| report `options.formalCommand` | `validateReport`: present on a Fable report, absent on a Codex report |
| report `options.rounds` | `Envelope` whole number at least 1; `validateReport` rounds rules |
| report `trialResults` | `Envelope` array of at least one; `validateReport` trial count (one in stage 1, three in stage 2) |
| report `trialResults[].cases` | `Envelope` array; every element through `Case` |
| case `id` | `Case` id syntax (src/core/types.ts:883); unique per trial; `checkPairs` element-wise id arrays; stage 2 triple from the case files (refusal when none) |
| case `kind` | `Case` enum; `checkPairs` same kind per id across members |
| case `outcome` | `Case` enum; outcome for its kind (`KIND_OUTCOMES`); equal to the last round's |
| case `durationMs` | `Case` finite, at least 0, required; stage 2 wall-time ratio refused when not finite |
| case `rounds`, `rounds[0].outcome`, `rounds[0].durationMs` | `Case` round shape (outcome, finite duration, cited count); presence rules of `validateReport`; round 1 read only from a non-empty `rounds` |
| case `confirmed`, `cited`, `runStatus`, `matched`, `detail`, `verdictRef`, `logRef` | not read; `Case` checks each against `BenchCaseResult` (src/review/bench.ts:36-53) |
| report `reviewer`, `rules`, `leftCheckouts`, top-level `cases`, `totals`, `summary`, `roundTotals` | not read and not checked |

Guard sweep, attempt 3: every guard of `panel.ts`, 57 in all, loosened in turn with `outcome-panel.test.ts` run and the file restored, each caught: unionOf member count; ids held by every member; scored: no-verdict and error; excluded when some member; blocked: hit or false-block; union some; intersection every; unique: no other member; common scope; excludedKinds by kind; median even branch; triple key; slowest of a triple; fold drops excluded; orphan triple; finite ratio; Codex+Codex rotation; gate <; fable gain >=; fable false blocks <=; panel gain >=; panel false blocks <=; ratio <=; better follows member2; id syntax; kind enum; confirmed boolean; cited array; duration finite >= 0; round shape; options.rounds int >= 1; envelope trialResults; outcome for its kind; duplicate id; one-round report holds no rounds; multi-round case has rounds; at most options.rounds; scored case has a round; empty rounds allowed for unscored; last round equals outcome; trial count; formal stage; Fable formalCommand; Codex no formalCommand; policy hash; pair ids element-wise; pair id lengths; pair kinds; stage 1 pairing called; stage 2 pairing called; commit check; round 1 is rounds[0]; round 1 only when rounds hold one; stage 2 read only on run; lessons unreadable; lesson count by parser; lessons added. Also caught (separate runs): runStatus, matched, detail, verdictRef, logRef loosened to any. equivalent: the `Outcome` enum (case and round), because the outcome-for-its-kind check rejects every value outside it.

Attempt 3 DoD: `npm run typecheck && node --test tests/surface/outcome-panel.test.ts tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts` exit 0, tests 29, pass 29, fail 0. `npm run check`: exit 0, tests 3888, pass 3856, fail 0, skipped 32.
