---
slug: loop-throughput
title: CI on a pull request finishes in about half the time, the implementer's model is named, and a card's changelog entry is its own file
intent: intent/loop-throughput.md
status: draft
created: 2026-11-16T22:30:00Z
skills_applied: []
---

# Spec: CI on a pull request finishes in about half the time, the implementer's model is named, and a card's changelog entry is its own file
From intent: intent/loop-throughput.md. Status: draft. Skills applied: (none).

## Requirements (EARS)
- R1. The `ci` workflow shall run the test suite on `windows-latest` in four shard jobs, with each test file in exactly one shard.
- R2. The `ci` workflow shall report a check run named `check (windows-latest, 22)` that succeeds only when all four shard jobs succeeded.
- R3. WHEN a pull request gets a new run of the `ci` workflow, the workflow shall cancel the older in-progress run of that pull request.
- R4. The `ci` workflow shall cancel no run that a push started.
- R5. The `github` ship path shall decide its CI gate from the check runs of the candidate head only.
- R6. The two implementer agent files shall each carry the front matter line `model: opus`.
- R7. The `arc.md` skill file, `docs/OPERATIONS.md` and the two test values that pin the implementer's model shall state the model the agent file names.
- R8. The Conventions section of `CLAUDE.md` shall tell a card to record its behaviour change in `changelog.d/<card id>.md`.
- R9. The repository shall hold a test that fails for a file in `changelog.d/` that is neither the README nor one entry line of a registered card.
- R10. The repository shall hold a test helper that returns the entry line of a card's fragment.

## Design
CI. On the head of pull request 342 the Windows check took 18 min 23 s and no other check more
than 5 min 44 s [SOURCE: `gh pr view 342 --json statusCheckRollup`, 2026-11-17]. The `check`
job keeps `ubuntu-latest` only. A new job runs the Windows steps four times with
`matrix.shard` 1 to 4, and its test step is the full command
`node --test --test-reporter=spec --test-shard=<k>/4 "tests/**/*.test.ts"`: `npm test --
--test-shard=1/4` puts the option after the pattern, Node reads it as one more pattern, and
every file runs with exit 0 [SOURCE: drafter measurement of 2026-11-17 in the main checkout
and in a scratch project]. Node expands the pattern itself and gives shard k the files at
index k-1 modulo 4 of the sorted paths [SOURCE: same measurement, bash and PowerShell 7.6]. A
third job named `check (windows-latest, 22)` needs the shard job, runs under `if: always()`
and fails unless the shard job's result is `success`, so `github.requiredChecks` and the
GitHub ruleset keep their names. A `concurrency` group of the workflow and the pull-request
number cancels the in-progress run for `pull_request` events only; a push run gets a group of
its own.

The ship gate needs no source change: it reads `git rev-parse --verify HEAD`
(`src/delivery/github-ship.ts:297`) and the check runs of that sha (`:375`,
`src/probes/gh.ts:156`), so a cancelled run of an older head is never read. On the head, a
required name must be present and `success`, any other reported check may be `success`,
`neutral` or `skipped`, and everything else, `cancelled` included, is `[CI-GATE-RED]`
(`:386-392`); a red shard therefore stops a ship directly and through the aggregate check.
The card adds the ship test that pins this.

Implementer model. `model: inherit` was set by card T1-EFF-AGENTS-DOD and is pinned by
`tests/surface/templates.test.ts:315` and `:350`, `docs/OPERATIONS.md:19` and both `arc.md`
copies. The agent files take the alias `opus`, which the planner, reviewer and
release-specialist files carry, and the pins follow.

Changelog. A fragment is the file `changelog.d/<CARD-ID>.md` holding one line
`- <CARD-ID>: <text>` (a parenthesised note may follow the id) and one line feed; 139 of the
142 card entries since 0.1.0 have this form [SOURCE: drafter measurement of 2026-11-17 on
main at 2ef2bbf4]. The check is a surface test that reads the card ids with
`loadCardRegistry`; it adds no source line. `fragmentEntry` lets a card's own test read its
line, so a later release step changes one function and no test. `CHANGELOG.md` keeps every
byte: a note at the top of Unreleased would make the base-sync changelog merge refuse a hunk
that adds an entry there. Only `CLAUDE.md:113-114` tells a session where the entry goes; the
agent files, the skill files, the card templates, `REVIEW.md` and
`templates/CLAUDE.aidlc.md` do not.

## Interfaces and contracts
- Check runs of the `ci` workflow: `check (ubuntu-latest, 22)` and `bench` as today;
  `check (windows-latest, 22)` is now the job that needs the four shards; four new check runs
  for the shards. `github.requiredChecks` is unchanged.
- The fragment form, the directory `changelog.d/` and its `README.md`.
- `fragmentProblems(name, text, cardIds)` and `fragmentEntry(root, cardId)` in
  `tests/infra/changelog.ts` (test helpers, not package exports).
- No directive, state record, ship sentinel or configuration key changes.

## Data model and migration impact
none. Existing `CHANGELOG.md` entries stay where they are; a card started before
T1-CHANGELOG-FRAGMENTS merges keeps its `CHANGELOG.md` entry.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Moving, splitting, skipping or deleting a test file, or changing what `npm test` runs.
- Sharding the Ubuntu job or `build-test`, or removing the second Ubuntu run of the suite in
  `aidlc-ci.yml`.
- A transient rerun for a shard that fails at runner setup: the aggregate check then fails at
  its own step and the failure classifies as `unknown`.
- Choosing the implementer model by card (`intent/run-attribution.md`, part B).
- Writing the fragments into `CHANGELOG.md` at a release (a later card), or moving an
  existing entry.
- Moving sections of `docs/OPERATIONS.md` into files of their own.

## Acceptance
- 1. A test runs the workflow's own shard command for shards 1 to 4 over a fixture and finds each file run exactly once, and the workflow holds the four shards and the job with the existing check name. [R1] [R2]
- 2. The workflow holds the concurrency group, with cancellation for `pull_request` events only. [R3] [R4]
- 3. A ship test shows that a cancelled check run on an older sha stops nothing and that a cancelled or red shard on the head ends the gate red. [R5]
- 4. Both implementer agent files carry `model: opus`, and `arc.md`, `docs/OPERATIONS.md` and the two pinned test values say the same. [R6] [R7]
- 5. `CLAUDE.md` states the fragment rule and stays within 200 lines. [R8]
- 6. The fragment test fails for a malformed file and passes with the README and a card's fragment, and `fragmentEntry` returns that card's line. [R9] [R10]
