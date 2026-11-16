---
id: T1-ARMS-REPORT
title: docs/reliability/arms.md reports the rounds, field-order and DeepSeek R2 arms against the owner's keep rules from bench/outcome/arms.json, assembled from the arms run, and CHANGELOG.md carries the entry of goal review-recall
status: todo
branch: T1-ARMS-REPORT
worktree: D:\wt\AIDLC\T1-ARMS-REPORT
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - bench/outcome/arms.ts
  - bench/outcome/arms.json
  - bench/outcome/deepseek-r2.json
  - bench/outcome/README.md
  - docs/reliability/arms.md
  - tests/surface/outcome-arms.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-ARMS-REPORT.md
dod_command: npm run typecheck && node --test tests/surface/outcome-arms.test.ts tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/surface/release-version.test.ts
dod_exit: 0
requirements:
  - R1. `missTriples(cases, replay)` (new, exported from bench/outcome/arms.ts) shall return the ids of the bug cases of evals/review/replay/ whose candidate/base/card triple holds at least one case scored `miss` in bench/outcome/replay-main.json, sorted; on main's files these are the cases of 25 triples, 35 of them misses.
  - R2. `node bench/outcome/arms.ts assemble --commit <sha>` shall read the arm reports the arms run left under `_local/arms/` (body section Inputs) and refuse, writing nothing, when: a report is missing or unparsable; a report's `options` (T1-BENCH-ROUNDS R5, T1-BENCH-ORDER-PRE R4) or stage differs from its arm; the case ids of a miss-subset report differ from `missTriples`; the clean reports do not hold exactly the cases of evals/review/clean/; the R2 reports (R9) review a candidate out of the run order of R9, skip one before the last reviewed, hold a case twice, or hold a case of no candidate of that order; the formal reports differ in `policyHash`; any report has `leftCheckouts`; or `--commit` is not a commit of the repository. Otherwise it shall write `bench/outcome/arms.json` with `commit`, `policyHash`, the reports reduced as bench/outcome/replay.ts `reduce` does with `rounds` and `matched.severity` kept, the spend readings, and `measures` (R3).
  - R3. `measures` shall hold, each computed by an exported pure function from the reduced reports and the case files: rounds arm: hits after round 1, 2 and 3 on the miss subset, hits added by rounds 2 and 3, hits added by round 3 alone, the median over groups whose round 1 blocked of the summed round wall time and of round 1's wall time and their ratio, false blocks on the clean cases after round 1 and after the last round; order arm: hits on the miss subset, its gain over the rounds arm's round-1 hits, false blocks on the clean cases and the change from the rounds arm's round-1 false blocks; R2 arm: candidates reviewed (clean and replay), the bug cases of the reviewed replay candidates and their hits, recall over those cases with a 95% interval from a seeded bootstrap over candidates (2000 draws, fixed seed), false blocks over the reviewed clean candidates, billed CNY and USD at 6.669 CNY per USD (X-Rates, 2026-11-10 08:03 UTC), the CNY per review as the mean of the settled balance differences of spend.json over the reviews they span, and the spend of the aborted runs listed apart from it; the P2 share: hits of the rounds arm whose `matched.severity` is P2, over its hits; Codex reviews counted over all formal reports.
  - R4. `keep` in arms.json shall give, per arm, `keep` or `drop` by the owner's rules of intent/review-recall.md (Decisions, 2026-11-16) applied to `measures`: rounds kept when rounds 2 and 3 add at least 6 hits and the wall-time ratio is at most 2, with round 3 kept only when it adds at least 2; order kept when it gains at least 3 hits and adds no false block; R2 takes one of three values: `keep` only when all 124 bug cases and all 15 clean cases were reviewed, recall is at least 0.20, false blocks at most 2 and USD per review at most 0.30; `drop` when a leg has failed for certain (USD per review above 0.30 after at least three settled reviews, three or more false blocks, or recall below 0.20 even with every unreviewed bug case counted a hit); otherwise `not determined`, which the second goal treats as off. P2 non-blocking allowed when the P2 share is at most 0.15.
  - R5. `docs/reliability/arms.md` (new) shall begin `# Review arms`, hold the sections `Method`, `Rounds inside one decision`, `Verdict field order`, `DeepSeek R2 prefilter`, `Severity of the hits`, `Keep rules` and `What these numbers do not show`, and give every number in a table row `| <measure> | <value> | <source> |` whose source is a code span holding a JSON pointer into bench/outcome/arms.json; Method names the commit, the commands of the arms run and bench/outcome/deepseek-r2.json; What these numbers do not show states that the miss subset was chosen for its baseline misses, that the R2 cost per review is a mean of settled balance differences at the stated rate and date and not a median, that a drop on cost says nothing about recall, that the R2 recall is over the cases of the sampled candidates with its seed, counts and interval and is not a rate over the 124, that the arms ran once, and that the policy is REVIEW.md@7 while the 71.8% baseline is REVIEW.md@6. No em dash, no corner bracket.
  - R6. bench/outcome/deepseek-r2.json shall hold the `--pre-command` file the R2 arm used, unchanged; bench/outcome/README.md shall name arms.ts and arms.json.
  - R9. `r2RunOrder(clean, replay)` (exported from bench/outcome/arms.ts) shall return the R2 run order fixed before the R2 probe (Claude Fable 5.2 consult, 2026-11-16): the candidate/base/card triple of batch 0 (`r2-batch-0.json`, reviewed before the order was fixed) first, then the 15 clean triples, then the other replay triples, each of the last two lists ordered by the sha256 of `review-recall-r2:<candidate> <base> <card path>`, hex ascending. The reports `r2-c<NN>.json` (one triple each, NN from 01 in that order) follow a prefix of it.
  - R7. CHANGELOG.md shall carry one entry for goal review-recall within the Unreleased section, naming the severity tag, the finding identity, the clean cases, the bench options, the follow-up issue step and the arms report; no other line changes.
acceptance:
  - 1. `tests/surface/outcome-arms.test.ts` (new), "T1-ARMS-REPORT acceptance 1: missTriples gives the cases of the 25 triples that hold a baseline miss". Reads the committed replay files. Fails on main (no module). [R1] [dod arm 1]
  - 2. Same file, "T1-ARMS-REPORT acceptance 2: assemble refuses each input fault of R2 and writes nothing". Fixture reports in a temp directory. Fails on main. [R2] [dod arm 1]
  - 3. Same file, "T1-ARMS-REPORT acceptance 3: the measures and keep verdicts of arms.json equal those recomputed from its reduced reports". Fixture cases for each rule edge (6 and 5 added hits, ratio 2 and 2.01, P2 share 0.15 and 0.16; R2 keep with full coverage, drop on cost after three settled reviews, drop on three false blocks, drop when recall stays below 0.20 with every unreviewed case a hit, not determined on a partial sample) and the committed file. Fails on main. [R3] [R4] [dod arm 1]
  - 4. Same file, "T1-ARMS-REPORT acceptance 4: arms.md has the title, sections and banned-character rule, and every table value equals its JSON pointer in arms.json". Fails on main. [R5] [dod arm 1]
  - 5. Same file, "T1-ARMS-REPORT acceptance 5: CHANGELOG.md carries the goal entry once within Unreleased". Fails on main. [R7] [dod arm 1]
  - 6. outcome-baseline.test.ts, prose.test.ts, templates.test.ts and release-version.test.ts pass with no line changed. [R7] [dod arm 1]
  - 7. The limits of R5, the file of R6 and the entry text are as stated (reviewer-verified against the diff). [R5] [R6] [R7]
  - 8. Same file as acceptance 1, "T1-ARMS-REPORT acceptance 8: r2RunOrder puts the batch-0 triple first, then the clean triples, then the other replay triples, each by the sha256 of its seeded key, and the committed R2 reports follow a prefix of it". Fails on main. [R2] [R9] [dod arm 1]
depends_on: [T1-REPLAY-CLEAN, T1-BENCH-ORDER-PRE, T1-REVIEW-FOLLOWUP-ISSUE]
budget: 300
tdd: true
sweep: "Main at 0f28b51e. bench/outcome/replay.ts: `reduce` and `KEEP` (:24-29) cut case results to `id`, `kind`, `confirmed`, `outcome`, `runStatus`, `detail`, `durationMs`; `assembleReplay` (:79-104) is the pattern for refusing inputs and hashing reports. replay-main.json `/run/cases` holds 124 results, 35 `miss`; evals/review/replay/ holds 124 bug cases on 57 triples, 25 of them with a miss (15 with only misses). The reports of T1-BENCH-ROUNDS and T1-BENCH-ORDER-PRE carry `options`, per-case `rounds` and `roundTotals`. tests/surface/outcome-baseline.test.ts checks baseline.md the same way R5 checks arms.md, with its own expression grammar; this card uses JSON pointers only. CHANGELOG.md `## Unreleased` is followed by entries and then `## 0.2.0 - 2026-11-14`."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test, other than an expected literal that pins the exact text of a document line this card's requirements change, updated to the new text and nothing else, each such line named in the Attempt evidence with the requirement that changes it (a test file outside allow_paths needs a recorded amendment first)
  - a new bench run, or a rerun of an arm, inside this card
  - editing a report under _local/arms/, evals/review/, bench/outcome/replay-main.json or bench/outcome/summary.json
  - a number in arms.md that is not in a table row with its source, other than dates, the commit, card and goal ids and file names
  - a keep verdict that differs from the rule of R4
non_goals: [switching any arm on in the loop (the second goal), a change under src/]
hygiene: "Run `npm run check` (typecheck and the full suite, as CI runs it) in the worktree before recording the attempt and put its totals in the Attempt evidence (lesson of T1-REVIEW-SEVERITY-2, CI run 43757539597). Line numbers are from main at 0f28b51e; read them again at PREPARE. The arm reports are produced by the coordinator before this card starts (plans/review-recall.md, Order of work 5); if they are missing, STOP/capability."
---

# T1-ARMS-REPORT

## Deliverable
The owner reads in one page whether each measured change met its keep rule, with every number traced to the committed arm reports, so the second goal switches on only what the data supports.

## Inputs
Written by the arms run (coordinator) under `_local/arms/` from a worktree pinned at the merge commit of T1-BENCH-ORDER-PRE:
- `rounds-miss.json`: `--stage formal --rounds 3`, `--dir` holding the `missTriples` cases.
- `rounds-clean.json`: `--stage formal --rounds 3 --dir evals/review/clean`.
- `order-miss.json`, `order-clean.json`: `--stage formal --order analysis-first` on the same two directories.
- `r2-batch-0.json` (one replay triple) and `r2-c<NN>.json` (one triple each, in the order of R9): `--stage pre --pre-command bench/outcome/deepseek-r2.json`.
- `spend.json`: the DeepSeek balance in CNY, read before and after each R2 report and, for the cost probe, until two readings 5 minutes apart agree; the aborted runs and their spend are entries of their own.
- `deepseek-r2.json`: the `--pre-command` file.

## Why
The owner's keep rules (intent/review-recall.md, Decisions 2026-11-16) decide which arm the second goal switches on. Writing the verdicts in code, from committed numbers, keeps that decision from resting on a summary.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-arms.test.ts tests/surface/outcome-baseline.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/surface/release-version.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.
