---
slug: card-preflight
title: Measure why cards are replaced and check a draft card against main before it is registered
intent: intent/card-preflight.md
status: draft
created: 2026-11-16T02:45:00Z
skills_applied: []
---

# Spec: measure why cards are replaced and check a draft card against main before registration
From intent: intent/card-preflight.md. Status: draft. Skills applied: (none).

## Requirements (EARS)
- R1. The repository shall hold a script that reads the card registry and writes, for each card with `superseded_by`, which of `acceptance`, `requirements`, `allow_paths`, `dod_command` and `budget` its successor changed, the kind of each added path and whether the replaced card's text named it.
- R2. The repository shall hold a report of the totals of R1 that a test recomputes from the registry.
- R3. WHERE `--reader` is given with `--card <id>`, the cards validate command shall run the configured reader command once on that card and print each item the reader names with its item reference, sentence, file, line and reason.
- R4. IF `--reader` is given and no reader command is configured, or the reader's output holds no valid result, THEN the cards validate command shall exit non-zero and say which.
- R5. The reader prompt shall carry the card text and ask only for sentences about existing code, and for acceptance or requirement items, that the checkout does not support.
- R6. The repository shall hold a case file of 30 replaced cards whose successor changed an `acceptance` or `requirements` item and the 15 first-pass cards of `evals/review/clean/`, each with the commit that first added the card.
- R7. The repository shall hold a report that gives, from the reader's results on the case file, the share of replaced cards where the reader named an item the successor changed, the share that naming as many items at random gives, and the count of first-pass cards where it named anything.

## Design
`bench/outcome/replace-cause.ts` parses the registry with the card parser and prints JSON; the
report is `docs/reliability/replacement.md`. Scratch totals at 35de54fe: 101 pairs, acceptance
changed in 89, requirements in 74, budget raised in 59, a path added in 22 [SOURCE: scratch
script of 2026-11-16, not committed; R2 replaces it]. The repository's card parser gives the
same totals except the pairs with no changed field (10, where the scratch parser gave 2).

The reader reuses `expandCommand` and `reviewerEnv` of `src/review/pre-review.ts` and reads
the last non-blank line of stdout as JSON; no runner there is reusable whole. Its result is `{ unsupported: [{ item, sentence, file, line,
why }] }`, where `item` is `R<n>`, `acceptance <n>` or `body`. Its command is `cardReader.command`
in the configuration, empty by default; this repository sets the Codex read-only command of
`formalReview`.

A hit is decided in code: a named `R<n>` or `acceptance <n>` whose text differs in the
successor or is absent from it. The coordinator runs the reader over the case file from
detached worktrees at each case's commit and stores the raw results under `_local/`; the report
card commits the results file and `docs/reliability/card-reader.md`.

A path rule was measured and cut. The rule of the first draft (a named file that does not
exist and that no `allow_paths` entry covers) flags 26 of 348 cards as first committed, on
fixture names such as `src/a.ts`; narrowed until it flags none, it would have stopped none of
the 101 replacements [SOURCE: drafter scratch scripts of 2026-11-16, not committed].

## Interfaces and contracts
- `aidlc cards validate --card <id> --reader` (new option; `--reader` without `--card` exits 1).
- `ProjectConfig.cardReader: { command: string[]; timeoutMs: number }` (new, optional).
- `bench/outcome/reader-cases.json`, `bench/outcome/reader-results.json` (new data files).

## Data model and migration impact
none

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- A gate on the reader's result, at registration or anywhere else.
- A path rule, a pin sweep of the tests that read a file a card changes, or a budget estimate.
- Running a card's `dod_command` on the base.
- A reader for intents, specs or plans.

## Acceptance
- 1. `node bench/outcome/replace-cause.ts` prints one row per superseded card and the totals; the report's numbers equal them. [R1] [R2]
- 2. With a scripted reader that prints a valid result, the option prints each named item; with an empty command, a non-zero exit, a timeout or malformed output it exits non-zero with the reason. [R3] [R4]
- 3. The prompt holds the card text and the three item kinds, and a test pins it. [R5]
- 4. The case file holds 30 and 15 cases, each with a commit that `git cat-file -e` accepts, and a test checks the selection rule on the registry. [R6]
- 5. The report's numbers equal the values a test computes from the results file, the case file and the hit rule. [R7]
