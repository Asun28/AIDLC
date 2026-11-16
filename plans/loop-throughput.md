---
slug: loop-throughput
title: CI on a pull request finishes in about half the time, the implementer's model is named, and a card's changelog entry is its own file
spec: specs/loop-throughput.md
size: T1
status: draft
created: 2026-11-16T22:30:00Z
---

# Plan: CI on a pull request finishes in about half the time, the implementer's model is named, and a card's changelog entry is its own file (from specs/loop-throughput.md)

## 1. Goal and boundaries
The Windows suite of the `ci` workflow runs in four shards behind the existing check name, a
new pull-request run cancels the older one, the implementer agent names its model, and a card
writes its changelog entry to its own file. Cut: sharding the Ubuntu job or `build-test`,
removing the second Ubuntu run of the suite, a test selection, the implementer model by card,
writing fragments into `CHANGELOG.md` at a release, moving sections of `docs/OPERATIONS.md`.
Success criteria: on the pull-request run of T1-CI-SHARD itself the time from the earliest
shard start to the end of `check (windows-latest, 22)` is at most 10 minutes, against
18 min 23 s on pull request 342; and the card lead time p50 of the next 30 merged cards is
below the baseline 0.85 hours. With 30 cards the second number is not a significance test; it
is reported with its count.

## 2. Minimal acceptable loop
T1-CI-SHARD alone gives the CI time. T1-CHANGELOG-FRAGMENTS alone gives the fragment rule and
its check.

## 3. Tech stack
none this version

## 4. Directory structure
- `changelog.d/` (new): `README.md` and one file per card
- `tests/surface/ci-shard.test.ts`, `tests/surface/changelog-fragments.test.ts` (new)

## 4.5 Module design
- `.github/workflows/ci.yml`: the `check` job on `ubuntu-latest` only; `check-windows-shard` with `matrix.shard` 1 to 4 and the full `node --test ... --test-shard=<k>/4` command; `check-windows`, named `check (windows-latest, 22)`, which needs the shards; a `concurrency` group.
- `tests/infra/github-ship.test.ts`: one describe at its end that pins which sha the CI gate reads.
- Both `implementer.md` copies, both `arc.md` copies, `tests/surface/templates.test.ts`, `docs/OPERATIONS.md`: the implementer's model.
- `tests/infra/changelog.ts`: `fragmentProblems` and `fragmentEntry`. `tests/surface/changelog-fragments.test.ts`: the check over `changelog.d/`. `tests/surface/prose.test.ts`: `changelog.d/` joins its scope. `CLAUDE.md`: the rule.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
The fragment form (`changelog.d/<CARD-ID>.md`, one entry line and one line feed) is frozen by
T1-CHANGELOG-FRAGMENTS; every card that starts after it merges writes a fragment and names
that card in `depends_on`. The check names `check (ubuntu-latest, 22)` and
`check (windows-latest, 22)` and `github.requiredChecks` do not change.

## Files that change
- .github/workflows/ci.yml
- tests/surface/ci-shard.test.ts (new)
- tests/infra/github-ship.test.ts
- CHANGELOG.md
- templates/claude/agents/implementer.md
- .claude/agents/implementer.md
- templates/claude/skills/aidlc-loop/arc.md
- .claude/skills/aidlc-loop/arc.md
- tests/surface/templates.test.ts
- docs/OPERATIONS.md
- CLAUDE.md
- changelog.d/README.md (new)
- changelog.d/T1-CHANGELOG-FRAGMENTS.md (new)
- changelog.d/T1-IMPLEMENTER-MODEL.md (new)
- tests/infra/changelog.ts
- tests/surface/changelog-fragments.test.ts (new)
- tests/surface/prose.test.ts

## Order of work
1. T1-CI-SHARD and T1-CHANGELOG-FRAGMENTS start together: they share no path. T1-CI-SHARD is
   the last card whose entry goes to `CHANGELOG.md`.
2. T1-IMPLEMENTER-MODEL, after T1-CHANGELOG-FRAGMENTS has merged: its entry is a fragment.
3. Coordinator, no card: at the close of T1-CI-SHARD, read its own pull-request run
   (`gh pr view <n> --json statusCheckRollup`, `gh run view <id> --json jobs`) and record in
   the card's closing note the check names, each shard's test step time and the time from
   the earliest shard start to the end of `check (windows-latest, 22)`.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-CI-SHARD | MUST | four Windows shards behind the existing check name; a new pull-request run cancels the older one; a test of which sha the CI gate reads | - | W1 | - |
| T1-CHANGELOG-FRAGMENTS | MUST | the fragment rule in CLAUDE.md, `changelog.d/README.md`, the check and the helper | - | W1 | yes |
| T1-IMPLEMENTER-MODEL | MUST | both implementer agent files name `opus`; arc.md, OPERATIONS.md and two test values follow | T1-CHANGELOG-FRAGMENTS | - | - |

Budgets: 200, 120 and 40 changed lines, 360 in total. The W1 cards share no path.

## Risks
- `npm test -- --test-shard=1/4` runs every file with exit 0, because npm puts the option after the pattern. The workflow therefore carries the full `node --test` command; a later edit back to `npm test` would lose no coverage and would make every shard run the whole suite. The test of T1-CI-SHARD runs the workflow's own command over a fixture.
- The split is by file index, and the second shard is the heaviest: about 1,000 to 1,170 s of summed test time against 490 to 650 s for each other shard (drafter estimate from a recent run's log). The expected Windows critical path is about 8 minutes, not 18 min 23 s divided by four.
- A shard that fails at runner setup turns the aggregate check red at its own step, which is not on `ci.transientSteps`, so the failure classifies as `unknown` and the card stops with STOP/ci (`src/core/ci-policy.ts:327`, `:354`) where today the Windows job gets one transient rerun. 0.83% of merged pull requests had a CI rerun (`bench/outcome/summary.json`, view `summary_ci`). A rule for it in `ci-policy` is a follow-up if it occurs.
- The DoD of T1-CI-SHARD leaves out `tests/surface/review-bench.test.ts`, which takes 166 s on Windows only to refuse the words `review bench` in a workflow; the card forbids those words and CI runs the test. The other existing files of that DoD take 85 s one at a time (measured 2026-11-17), against the 540 s limit of a loop-run DoD.
- T1-CI-MACOS of `plans/install-portability.md` asserted the `check` job's OS list; that card is amended in this revision to the list after T1-CI-SHARD. T1-INSTALL-GIT-DEP cites `ci.yml` line numbers that shift; it reads them again at PREPARE.
- Fragments end the shared edit of `CHANGELOG.md` only. `docs/OPERATIONS.md`, `src/loop/card-runner.ts` and `src/cli/main.ts` still put cards in sequence.
- Until a release writes the fragments into `CHANGELOG.md`, the changes not yet released are in two places, the Unreleased section and `changelog.d/`; the README of the directory says so. A change made without a card still edits `CHANGELOG.md`.
- Not verified before the cards run: the check names of the four shards; that `needs.check-windows-shard.result` is `success` only when all four succeeded; that under `always()` the aggregate job runs, and fails, on a cancelled older head; that the aggregate's log holds no line the CI classifier counts as evidence; which model id the alias `opus` resolves to.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: the pull-request run of T1-CI-SHARD shows four shard checks and `check (windows-latest, 22)`, all `success`, and the recorded time of step 3 of the order is at most 10 minutes.
- Arc: `git grep -n "^model:" -- .claude/agents/implementer.md templates/claude/agents/implementer.md` on main prints `model: opus` twice.
- Arc: `node --test tests/surface/changelog-fragments.test.ts` passes on main with the fragments of T1-CHANGELOG-FRAGMENTS and T1-IMPLEMENTER-MODEL in `changelog.d/`.

## 10. After merge
none this version (development-only target)
