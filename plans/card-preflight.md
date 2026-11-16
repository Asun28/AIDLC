---
slug: card-preflight
title: Measure why cards are replaced and check a draft card against main before it is registered
spec: specs/card-preflight.md
size: T1
status: draft
created: 2026-11-16T03:00:00Z
---

# Plan: measure why cards are replaced and check a draft card against main before registration (from specs/card-preflight.md)

## 1. Goal and boundaries
A committed table of what successors changed, and a reader option on `aidlc cards validate`
measured against a keep rule on 45 cases. Cut: a gate on the reader, a path rule, a pin sweep,
a budget estimate, a DoD run on the base. Success: the reader report states both keep-rule
numbers with their counts and the share random naming gives, and the owner can decide from it
whether a later goal gates registration on the reader.
Budget: 45 reader runs on the Codex subscription, and at most 20 USD billed if the fallback runs.

## 2. Minimal acceptable loop
T1-OUTCOME-REPLACE-CAUSE alone gives the comparison. T1-CARD-READER with T1-CARD-READER-CLI
alone gives the option for use by hand on the next draft card.

## 3. Tech stack
none this version

## 4. Directory structure
- `bench/outcome/replace-cause.ts`, `bench/outcome/reader-cases.ts`, `bench/outcome/reader-report.ts` (new)
- `bench/outcome/reader-cases.json`, `bench/outcome/reader-results.json` (new)
- `src/review/card-reader.ts` (new)
- `docs/reliability/replacement.md`, `docs/reliability/card-reader.md` (new)

## 4.5 Module design
- `bench/outcome/replace-cause.ts`: successor comparison over the registry, with the repository's card parser.
- `src/review/card-reader.ts`: the prompt, the result schema, one run of the configured argv. No reviewer runner of `src/review/pre-review.ts` is reusable whole (`runReviewPanel` returns verdicts only; `runAngle` is private), so the reader reuses `expandCommand` and `reviewerEnv` and reads the last non-blank stdout line.
- `src/cli/main.ts`: `--reader` on `cards validate`. `src/config.ts`: `cardReader`.
- `bench/outcome/reader-cases.ts`: case selection and the hit rule.
- `bench/outcome/reader-report.ts`: collects the stored results and computes the keep-rule numbers.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
The reader result `{ unsupported: [{ item, sentence, file, line, why }] }` is frozen by
T1-CARD-READER; the CLI, case and report cards read it.

## Files that change
- bench/outcome/replace-cause.ts (new)
- docs/reliability/replacement.md (new)
- src/review/card-reader.ts (new)
- src/cli/main.ts
- src/config.ts
- aidlc.config.json
- bench/outcome/reader-cases.ts (new)
- bench/outcome/reader-cases.json (new)
- bench/outcome/reader-report.ts (new)
- bench/outcome/reader-results.json (new)
- docs/reliability/card-reader.md (new)
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md

## Order of work
1. T1-OUTCOME-REPLACE-CAUSE: the comparison script and its tests. Starts beside 2.
2. T1-CARD-READER: the prompt, the schema, the run. Starts beside 1 (no shared path).
3. T1-OUTCOME-REPLACE-REPORT: `docs/reliability/replacement.md`. After 1.
4. T1-CARD-READER-CLI: the option, the configuration key, the docs. After 2, and after card
   T1-BENCH-ORDER-PRE of `plans/review-recall.md` has merged (both edit `src/cli/main.ts`).
5. T1-CARD-READER-CASES: the case file and the hit rule. After 1.
6. Coordinator, no card: run `aidlc cards validate --card <id> --reader` on the 45 cases, each
   from a detached worktree at the case's commit, results to `_local/reader/`.
7. T1-CARD-READER-REPORT: the results file and the report. After 4, 5 and the run of 6.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-OUTCOME-REPLACE-CAUSE | MUST | what each successor changed, as a script with tests | - | W1 | - |
| T1-CARD-READER | MUST | the reader prompt, result schema and run | - | W1 | yes |
| T1-OUTCOME-REPLACE-REPORT | MUST | the replacement table, recomputed by a test | T1-OUTCOME-REPLACE-CAUSE | - | - |
| T1-CARD-READER-CLI | MUST | `aidlc cards validate --card <id> --reader` and `cardReader` | T1-CARD-READER | - | - |
| T1-CARD-READER-CASES | MUST | 30 replaced and 15 first-pass cases, and the hit rule | T1-OUTCOME-REPLACE-CAUSE | - | - |
| T1-CARD-READER-REPORT | MUST | the reader's result against the keep rule | T1-CARD-READER, T1-CARD-READER-CLI, T1-CARD-READER-CASES | - | - |

Budgets: 200, 200, 100, 200, 200 and 200 changed lines, 1100 in total. Generated data files are
listed in allow_paths and not counted.

## Risks
- The reader reads a card written before its code existed; a case's commit must be the one that first added the card, or the reader sees the finished code. CI checks out no history (`.github/workflows/ci.yml:27`), so the test of the case commits skips there.
- A hit counts an item the successor changed for any reason, and naming one item at random hits in 42% of the eligible pairs, two in 56%. The keep rule therefore compares the reader with the random share the report computes, not with a fixed number alone.
- 30 and 15 cases give wide intervals; the report prints counts beside shares.
- The first-pass cases come from `evals/review/clean/`; three of those cards are themselves successors.
- A reader command that writes is a configuration error: this repository's command runs Codex with `--sandbox read-only`. Whether Codex accepts the reader's JSON schema is not verified before the card runs.
- A path rule was measured and cut: narrowed until it flags no card in the registry's history, it would have stopped none of the 101 replacements.
- Owner to confirm at approval: the changed keep rule; `--reader` prints the reader result only and skips the registry checks; the reader's effort is fixed at `medium`.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `node bench/outcome/replace-cause.ts` on main prints the totals of the report.
- Arc: `aidlc cards validate --card <an unstarted card> --reader` on main prints a result.
- Arc: `node --test tests/surface/outcome-reader.test.ts` passes on main.

## 10. After merge
none this version (development-only target)
