---
slug: agent-quality-study
title: Card the practices of the Uncle Bob article on agents and code quality that this repository's records support
author: asun28 (owner); drafted by the coordinator session
status: accepted
created: 2026-11-23T20:45:00Z
source: human
---

# Intent: Card the practices of the Uncle Bob article on agents and code quality that this repository's records support
Author: asun28 (owner); drafted by the coordinator session. Status: accepted.

The status is accepted under the owner's instruction quoted below, which asked for cards from what the coordinator and Codex agree. The owner read the coordinator's report of this result on 2026-11-24 and gave the instructions recorded under Decisions.

## Problem
The owner pasted on 2026-11-24 an article by jexchan, written from a live conversation between Matt Pocock and Robert C. Martin (Uncle Bob), and asked: "aidlc disscuss with codex astra max: see if we can adopt below experienses from a blog: [the pasted article], use data to support and list with a P0 P1 P2 and make them into cards after both of you agreed. don't ask me I am away".

The coordinator (Claude Fable 5.2) and Codex gpt-6-astra, read-only at reasoning effort max, discussed it in five rounds and agreed. The article's figures are leads, not evidence. Each claim was checked against this repository by read-only scripts on main at 4d3ab57c to f48f727a. The scripts, their outputs, the briefs and the answers are in `_local/uncle-bob-consensus/`, which is not tracked. Except for the function comparisons below, the review figures use the 413-run reading of the journals, taken at about 09:05 NZDT on 2026-11-24 (413 card runs with a first substantive formal decision). The function comparisons use an earlier reading of that morning (412 runs, 309 of them used); other sessions were recording decisions meanwhile. The round 1 brief of the discussion cites a third reading (411 runs).

## The article checked against this repository
| Claim of the article | What the records show | Result |
| --- | --- | --- |
| A score per function from complexity and coverage (CRAP) finds what to refactor, and messy code slows an agent | 2,681 functions under `src/`: complexity median 2, p90 8, maximum 128 (`CardRunner.applyShipResult`); 245 over 8. Line coverage 25,629 of 25,867 lines (99.1%) in one run of the suite, so the score is approximately the complexity for all 29 functions over 30. The function comparisons, from the 412-run reading (309 runs used, 3,939 observations of one function in one run, changed lines outside every function left out): formal block citations per 100 added-side changed lines inside functions, by the complexity of the changed function (1 to 4, 5 to 8, 9 to 15, 16 to 30, over 30): 1.99, 1.53, 1.27, 1.56, 2.35; Bugs or Security citations: 0.71, 0.55, 0.72, 0.64, 0.60. Runs that change 1 to 30 such lines pass their first formal decision 67.7%, 66.1% and 63.6% of the time, grouped by the most complex function changed (at most 8, 9 to 30, over 30). By size alone: 97 of 148 (1 to 30 lines), 31 of 105 (31 to 100), 9 of 41 (over 100) | No gate and no card. These observational comparisons do not establish a benefit from a complexity gate |
| Mutation testing on every task | `aidlc card mutants` exists since 2026-11-06 and no gate reads it. The evidence tree keeps 5 reports, all of 9 and 10 November, against 158 source cards first reviewed since 2026-11-07; a sweep took 5.1 to 24.2 minutes. 506 of 508 kept formal prompts read `- none` under `## Surviving mutants`, and that text stands for no report, an unusable report, a report of another candidate and a sweep with no survivor. Of the 158 source runs, 29 first decisions name dimension 6 and 5 name only it. Over all cards since 2026-11-07, 42 runs are first blocked naming dimension 6, 40 of them have a later decision, and in 8 the next decision names it again. A replay of the sweep on six reviewed candidates left survivors on passed and on blocked candidates; their relevance was not adjudicated | Card T0-MUTANT-EVIDENCE-STATE (P0). No sweep step, trigger or gate |
| A rule a program can judge becomes a check | Plan B of 2026-11-18 adopted this. For two tools that prose asks for there is little recorded evidence of use: the sweep (5 kept reports against 158 cards) and `aidlc review repro` (a recorded repro on 8 of 85 runs with a formal finding since 2026-11-10, a wider denominator than the request) | The two cards below are checks of this kind |
| A person declares the module dependencies and a checker enforces them | `CLAUDE.md` lines 45 to 47 list ten directories inner to outer and nothing checks it. Of 372 relative imports inside `src/`, three run against the order (`src/state/claims.ts` to `src/probes/git.ts`, `src/probes/hook-wiring.ts` to `src/scaffold/init.ts`, `src/cli/main.ts` to `src/scaffold/init.ts`); five directories and the root files have no place in it; the graph of all units has no cycle; `src/core/` imports no other directory and only `node:crypto` of Node | Card T0-LAYER-ORDER-TEST (P2) |
| Deep modules; architecture stays with people | `src/loop/card-runner.ts` holds 3,875 lines (15.0% of `src/`, 2,837 on 2026-11-01); 43 of the 180 `feat:` merges since 2026-10-24 touch it, counted in round 1; 284 of 786 block reasons that cite `src/` name it. A card naming it passes its first decision as often as other source cards at a budget of 200 or less (24 of 34 against 43 of 64) and less often above (29 of 113 against 55 of 123) | No card. A redesign is the owner's T2 checkpoint |
| Several agents with a clean context per role | The planner, implementer, reviewer and verifier agents exist; Plan B did not adopt more reviewers | No card |
| Keep the values, not the red, green, refactor habit | The RED receipt is a machine check and a hard limit; no record isolates its cost or benefit | No change |
| Small steps, short-lived specifications | `MAX_CODE_CARD_BUDGET` is 250; first decisions pass 76.0% of 25, 65.8% of 73 and 35.6% of 236 runs at a budget of 1 to 100, 101 to 200 and over 200. Plan B did not adopt splitting by budget or a word gate, and these numbers do not compare equal scope | No change |
| People watch scores and read less code | `aidlc review stats`, `aidlc bounds` and the reliability baseline exist; no unused production export was found among 893 | No card |

## Proposed outcome
1. P0, card T0-MUTANT-EVIDENCE-STATE: the formal prompt opens its `## Surviving mutants` section with the state of the report for the candidate (no report, unusable, for another candidate, or the counts of the sweep), and its statement says that a report that is missing, unusable or for another candidate is not a finding. No throughput gain is claimed.
2. P1: empty.
3. P2, card T0-LAYER-ORDER-TEST, as amended on 2026-11-24 (Decisions): `CLAUDE.md` states an order the tree obeys (`core`, `scaffold`, `probes`, `state`, `coordination`, `delivery`, `review`, `loop`, `hooks`, `cli`), and one test reads every import under `src/` from the syntax tree and fails on an import against that order, on a dependency of `src/core/` on another directory or on a Node built-in other than `crypto`, on a cycle between top-level units, and on a unit that is in no list. As first registered, the card kept the sentence of `CLAUDE.md` and allowed the three imports that run against it.
4. Not carded, each with what would reopen it:
   - A complexity, CRAP or coverage gate and a size ceiling: adjudicated defects and repair time at equal change size, by card family, then a prospective comparison.
   - A sweep before every first decision, in the repair after a dimension 6 block, or as a gate: adjudicated relevant survivors per minute on blocked against passed candidates, a rising repeat rate, or a cheaper sweep; a pilot must measure adherence and repair time.
   - A split of `src/loop/card-runner.ts`: a specific extraction with an interface and evidence that it lowers repair or context cost.
   - Splitting cards by budget and a word gate: total delivery time and family spend for equal scope.
   - New agent roles, a relaxed RED receipt, disposable specifications, an architecture viewer: a measured need.

## Affected users and systems
Through card 1: `src/loop/card-runner.ts`, `src/review/pre-review.ts`, their two test files, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, a changelog fragment, and every formal review prompt, the reviewer bench included. Through card 2: a new test file, the Layers sentence of `CLAUDE.md` and one paragraph of `docs/ARCHITECTURE.md`. No file under `templates/`, so no downstream repository changes.

## Constraints
- Outside figures are leads, never evidence.
- No new blocking gate on a card run (`intent/review-verification.md`, Constraints), no new dependency, no change to `REVIEW.md`, to the verdict schema or to the allowance constants.
- The agreements of 2026-11-17 (Plan A), 2026-11-18 (Plan B) and 2026-11-23 (lesson delivery) stand.
- `CLAUDE.md` keeps its count of lines (199 of 200 on 2026-11-24): card 2 rewrites the Layers sentence on the lines it has and changes no other sentence.
- No goal is opened by this intent: a goal's deadlines start when it is created.

## Limits of the measurements
Review citations are not adjudicated defects, and runs of one card family are correlated. The function measurements are observations: they count added-side changed lines inside functions and leave out changes outside every function. Coverage comes from one run and is a lower bound. Kept reports do not show every sweep that ran. The replay is six candidates, 20 mutants each at most, two of them with the settings of an earlier run, and no survivor was adjudicated.

## Decisions (owner, 2026-11-24, in the session)
Card T0-MUTANT-EVIDENCE-STATE was run by another session and merged as PR 464 (50008e4d) on 2026-11-24. The owner then read the coordinator's report of this result and replied "adk codex for advise". The coordinator put the decisions this intent left to the owner to Codex gpt-6-astra (read-only, reasoning effort max) with facts measured that day, and reported the advice. The owner replied "just record the card for now". The coordinator took that as the instruction to record card T0-LAYER-ORDER-TEST as the advice amends it, and to do nothing else: no goal is opened, and the decisions that remain are in the next section, each with the advice on it.

The amendment settles the order of the Layers sentence of `CLAUDE.md`. As first registered, the card kept the sentence and allowed three imports. `CLAUDE.md` lists `scaffold/` last and `state/` before `probes/`, and the tree contradicts both: `scaffold/` imports no other unit under `src/` and `src/probes/hook-wiring.ts` and `src/cli/main.ts` import it, and `src/state/claims.ts` imports `src/probes/git.ts`. Codex advised restating the sentence to an order the tree obeys and allowing no import against it. The coordinator had favoured keeping the sentence, and agreed after reading that `src/state/paths.ts` runs `git rev-parse` itself and that the Module map of `docs/ARCHITECTURE.md` states no rule that keeps `src/state/` clear of `src/probes/`. The card now carries the order `core`, `scaffold`, `probes`, `state`, `coordination`, `delivery`, `review`, `loop`, `hooks`, `cli`, and `CLAUDE.md` is one of its paths. A probe of main at e1f17a05 finds no import against that order (83 source files, 375 relative imports inside `src/`), and the whole suite passes on a clone of main at 9278ab1d whose `CLAUDE.md` holds the restated sentence (4,175 tests, 0 fail, 32 skipped). Codex read the amended card and this intent before they were committed, asked for two corrections of fact, which were made, and then answered CONFIRM.

## Decisions left to the owner
1. Open a goal for card T0-LAYER-ORDER-TEST when it should run.
2. Card 1 changes text that every formal review receives, and the paragraph of `docs/OPERATIONS.md` that begins "The reviewer bench stays outside the loop" asks for a reviewer bench comparison before such a change; the main checkout holds no record of one for PR 464. Codex advises the full comparison of the formal stage (30 confirmed cases, 3 trials, the commit before 50008e4d against it, 180 reviews). The coordinator advises reading the kept reviews first: the comparison takes about 4.3 hours of reviewer time at the median of 1.4 minutes per review.
3. `docs/LESSONS.md` line 32 asks for a mutation sweep before every first R3 decision. Codex and the coordinator both advise a line that supersedes it.
4. Whether to file issues for the items of outcome 4. Codex and the coordinator both advise one issue, for the item on the sweep, to adjudicate the survivors of the replay.

## Open questions
- (none)
