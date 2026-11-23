---
id: T0-CLAUDE-MD-REUSE
title: "CLAUDE.md gains the rule to check existing dependencies, Node built-ins and helpers before new code, and three of its sentences that the tree contradicts are corrected"
status: todo
branch: T0-CLAUDE-MD-REUSE
worktree: D:\wt\AIDLC\T0-CLAUDE-MD-REUSE
allow_paths:
  - CLAUDE.md
  - tests/surface/claude-md-reuse.test.ts
  - specs/tasks/T0-CLAUDE-MD-REUSE.md
dod_command: npm run typecheck && node --test tests/surface/claude-md-reuse.test.ts tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/config.test.ts tests/surface/bench.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/prose.test.ts tests/surface/readme.test.ts tests/surface/evals.test.ts tests/surface/pre-review.test.ts tests/surface/changelog-fragments.test.ts tests/infra/build-atomic.test.ts tests/infra/init.test.ts tests/infra/stray-processes.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The Conventions section of `CLAUDE.md` shall hold the reuse rule of the Doc text section as its second bullet, directly before the schema bullet.
  - R2. The Layers paragraph of the Architecture section shall introduce its four facts with the words of the Doc text section, in place of `Four facts it leaves out`, and keep every other word.
  - R3. The paragraph `Every side effect is injectable` of the Architecture section shall end with the two sentences of the Doc text section, in place of the clause that says nothing in `tests/` calls `Date.now()`.
  - R4. The schema bullet of the Conventions section shall be the two lines of the Doc text section, which name `src/audit/manifest.ts` beside `src/core/types.ts`.
  - R5. No other line of `CLAUDE.md` shall change, the file shall hold at most 200 lines, and `templates/CLAUDE.aidlc.md` shall stay as it is.
acceptance:
  - 1. `tests/surface/claude-md-reuse.test.ts`, a new file, test 1. With white space collapsed, the Conventions section holds the reuse rule directly followed by the schema bullet, and each of the two is in the file once. The check that reads them fails with the reuse rule removed, with the two bullets in the other order, and with the two bullets moved to the Architecture section. [R1] [R4] [dod arm 2]
  - 2. In test 2, with white space collapsed, the Architecture section holds the Layers sentence from `docs/ARCHITECTURE.md` to `shared by all worktrees;` with the words of R2, and the two sentences of R3. `Runtime details:` and `Some tests read real time` are each in the file once. The check fails without the words of R2 and without the end of the second sentence of R3. [R2] [R3] [dod arm 2]
  - 3. In test 3, the file holds none of the three groups of words the corrections replace, and the check finds each group in a text that wraps it over lines, as the base wraps the second group. [R2] [R3] [R4] [dod arm 2]
  - 4. Reviewer-verified from the diff. `CLAUDE.md` changes in the lines of the Doc text section and in no other (8 lines added, 5 deleted, 198 lines), and `templates/CLAUDE.aidlc.md` is not in the diff. [R5]
  - 5. The 15 other test files of the dod_command, each of which reads `CLAUDE.md`, pass with no line changed, among them the 200-line limit (`tests/surface/claude-md-size.test.ts`) and the template comparison (`tests/surface/mirror.test.ts`), and the typecheck reports no error. [R5] [dod arm 1] [dod arm 2]
  - 6. Reviewer-verified from the tree at the base, with the commands and lines of the sweep. Each corrected sentence states what the tree holds. [R2] [R3] [R4]
depends_on: []
budget: 100
tdd: true
sweep: "On main at 41593464. `git grep -n -F` over tests, src, .claude, templates, docs and README.md for `Four facts it leaves out`, `nothing in` with `tests/`, `calls` with `Date.now()`, `Every persisted record has a zod schema`, `a fixed clock`, `Module map, describes each` and a temp `.aidlc` finds CLAUDE.md lines 47, 48, 75, 76 and 97 only, so no test and no other document holds a sentence this card changes. The new words `Runtime details`, `Some tests read real time`, `Before adding a package` and `Parse persisted records` are in no tracked file outside specs/tasks. `git grep -l -F CLAUDE.md -- tests` lists 15 files, and the dod_command runs each. Fact of R2: docs/ARCHITECTURE.md:188 says that everything lives under the `.aidlc` directory of the main checkout, shared by all linked worktrees, so the first of the four facts is not one that file leaves out. Fact of R3: `git grep -c 'Date\\.now()' -- tests` lists nine files. Seven hold calls: tests/infra/exec.test.ts (25), tests/infra/goal-store.test.ts (7), tests/infra/git-lookup-timeout.test.ts, tests/infra/lease.test.ts, tests/infra/toolchain-probe.test.ts and tests/infra/update-json.test.ts (2 each) and tests/scenarios/t0-flow.test.ts (1). Each call measures or bounds a wait (a start time, an elapsed time, a deadline of a loop) or gives a file time (an argument of utimesSync at goal-store.test.ts:127 and t0-flow.test.ts:2585, the mtimeMs of a stat stand-in at goal-store.test.ts:225). tests/core/_fixtures.ts:1 and tests/surface/incident.test.ts:531 are comments. Fact of R4: src/audit/manifest.ts:30 exports the zod schema `Manifest` of the evidence manifest, and src/core/types.ts exports `Goal`, `CardRun`, `JournalEvent`, `Lease`, `ReviewRequest`, `ReviewPool`, `OperationRecord`, `ReleaseAttempt`, `IncidentRecord` and `IncidentLedgerFile`, the other records of the Persisted state table of docs/ARCHITECTURE.md. Evidence for R1: docs/LESSONS.md:55 (a hand-written YAML scanner beside the yaml package, two R3 blocks) and docs/LESSONS.md:233 (a direct fs call beside `tmpDir` of tests/infra/helpers.ts, a CI failure after two R3 passes). T0-INIT-CLI-PATH, in progress in another session, adds one line to the Commands list of the aidlc section: the two cards share no line and give 199 lines together. A trial of this change in a worktree that was discarded: the three new tests fail on assertions with CLAUDE.md as on the base and pass with the change, the typecheck is clean, and every file of tests/surface with tests/infra/build-atomic.test.ts, tests/infra/init.test.ts and tests/infra/stray-processes.test.ts passes (1344 tests, 0 failures, 15 skipped)."
forbid:
  - weakening or skipping a test to go green
non_goals:
  - the other seven rules the owner proposed, which the consultation found already stated in the instructions of this repository or in conflict with its code
  - "`templates/CLAUDE.aidlc.md` and the aidlc section: no downstream repository gets the rule"
  - a changelog fragment, since no file of the package changes and the template stays as it is
  - a test that compares the sentences of `CLAUDE.md` with the tree
  - the list of `src/` directories in the Layers paragraph, which names 10 of 15 and points to the Module map
  - agent files and skill files
hygiene: "The owner chose `Rule 6 + 3 fixes` in session on 2026-11-24, after two rounds of consultation with Codex whose citations this session checked. One sentence differs from the text the owner saw. That text said that some infrastructure tests use real time to bound process waits; the sweep found a scenario test and calls that give a file time, so the sentence of R3 names every use. The paths in the reuse rule carry backticks, as the file writes paths. RED: the new test file alone on the base, where tests 1 to 3 fail on assertions."
doc_sync: CLAUDE.md
---

# T0-CLAUDE-MD-REUSE

The owner chose this change in session on 2026-11-24.

## Deliverable
`CLAUDE.md` tells each session to look at what exists before it adds a package
or writes code. Three sentences of the file that the tree contradicts state the
facts. The file grows from 195 lines to 198.

## Why one rule of eight
The owner proposed eight rules. A consultation with Codex, in two rounds, and
this session's own check gave the same result:

| Rule | Result |
|---|---|
| 1. No backward compatibility | Conflicts with the code: records written before a field parse with a default (`src/core/types.ts:945`), the loop has a migration module, and R3 has a fallback reviewer |
| 2. Simplest implementation | Stated: `REVIEW.md` dimension 8 and the tdd skill |
| 3. Grow in layers | Stated: the tdd skill (one vertical slice in each cycle) |
| 4. Modular components | Stated: the Architecture section of `CLAUDE.md` |
| 5. Prefer third-party libraries | Rule 6 covers the case and does not ask for new packages |
| 6. Check what exists first | Added. Two past cards wrote code that existed (`docs/LESSONS.md:55`, `docs/LESSONS.md:233`) |
| 7. Decide for the long term | Stated in part (`REVIEW.md` dimension 17); as written it conflicts with rule 2 |
| 8. Use proven patterns | Would add a survey before each card; its one past mistake has a lesson (`docs/LESSONS.md:54`) |

## Doc text
Architecture, the Layers paragraph. One line changes:

```
-Four facts it leaves out: state lives under `<main checkout>/.aidlc/`, shared
+Runtime details: state lives under `<main checkout>/.aidlc/`, shared
```

Architecture, the paragraph `Every side effect is injectable`. Its last two lines change:

```
-`DryRunShipPath`, a fixed clock and a temp `.aidlc`; nothing in `tests/`
-calls `Date.now()`.
+`DryRunShipPath`, a fixed clock and a temp `.aidlc`.
+Some tests read real time to measure or bound a wait, or for a file time.
```

Conventions. The reuse rule is new, and the schema bullet changes:

```
-- Every persisted record has a zod schema in `src/core/types.ts`; parse at
-  the boundary.
+- Before adding a package or writing code, check `package.json` dependencies,
+  Node built-ins, and helpers in `src/` and `tests/` for the needed capability.
+  Read the relevant APIs before choosing reuse or custom code.
+- Parse persisted records with their zod schemas at the boundary.
+  Core schemas: `src/core/types.ts`; manifest: `src/audit/manifest.ts`.
```

## PR summary
### What
`CLAUDE.md` has one new rule: look at what exists before you add a package or write code. Three sentences that were wrong now state the facts.

### Why / Intent
Two past cards wrote code that existed already. One cost two review blocks and one failed CI. Each session reads `CLAUDE.md`, and three of its sentences said things that the repository contradicts.

### How / Behaviour
- Conventions has a new second bullet: check the `package.json` dependencies, the Node built-ins and the helpers first.
- The Layers paragraph calls its four facts runtime details. One of them is in `docs/ARCHITECTURE.md`, so "facts it leaves out" was wrong.
- The file no longer says that no test calls `Date.now()`. Seven test files call it.
- The schema bullet names `src/audit/manifest.ts` beside `src/core/types.ts`.

### System impact
The change is to the instructions for agents in this repository only. No source file, template or installed file changes. `CLAUDE.md` has 198 of its 200 lines.

### Security
No code, input or permission changes.

### Tests and review
- Three new tests fail on the base and pass on the change.
- The DoD passes with 306 tests. The 15 other test files that read `CLAUDE.md` pass with no line changed.
- 14 single wrong edits of `CLAUDE.md`: a new test fails for each one.

### Risk
Low. The change is text. One line stays free under the limit after card `T0-INIT-CLI-PATH` merges.

### Ownership
Card `T0-CLAUDE-MD-REUSE`, goal `g-20261123193430-ee2aec`. The repository owner chose the rule and the corrections after a consultation with Codex.

### Docs
`CLAUDE.md` is the document. `templates/CLAUDE.aidlc.md` does not change. There is no changelog fragment, because no file of the package changes.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/claude-md-reuse.test.ts tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/config.test.ts tests/surface/bench.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/prose.test.ts tests/surface/readme.test.ts tests/surface/evals.test.ts tests/surface/pre-review.test.ts tests/surface/changelog-fragments.test.ts tests/infra/build-atomic.test.ts tests/infra/init.test.ts tests/infra/stray-processes.test.ts
```
- Expected exit code: 0
- Assertion: the three new tests pass, the 15 other test files pass with no line changed, and the typecheck is clean.

## Attempt evidence
Candidate on the base 4d3ab57c. `CLAUDE.md` there is the file of 41593464, where the sweep ran.

| Acceptance | Evidence |
|---|---|
| 1 | test 1 passes. RED at 889f62f1 |
| 2 | test 2 passes. RED at 889f62f1 |
| 3 | test 3 passes. RED at 889f62f1 |
| 4 | `git diff --stat 4d3ab57c -- CLAUDE.md`: 8 insertions, 5 deletions. `CLAUDE.md` has 198 lines. `git diff --quiet 4d3ab57c -- templates/CLAUDE.aidlc.md` exits 0 |
| 5 | The DoD exits 0: 306 tests, 305 pass, 0 fail, 1 skipped. The diff of `tests/` holds the new file only |
| 6 | The sweep field gives each command and line |

RED: commit 889f62f1 holds the new test file alone. `node --test tests/surface/claude-md-reuse.test.ts` exits 1 there: 3 tests, 3 fail, each with `ERR_ASSERTION`.

Guard sweep: each change was made to `CLAUDE.md` alone, the new test file ran, and the file was restored. 14 changes, and a test fails for each:

| Change | Failing tests |
|---|---|
| the reuse rule is removed | 1 |
| the reuse rule comes after the schema bullet | 1 |
| the reuse rule is in the file twice | 1 |
| the reuse rule and the schema bullet are in Architecture, not in Conventions | 1 |
| the reuse rule does not name the Node built-ins | 1 |
| the reuse rule has no second sentence | 1 |
| the schema bullet does not name the manifest | 1 |
| the schema bullet is as on the base | 1, 3 |
| the Layers paragraph is as on the base | 2, 3 |
| the words of R2 are in the file twice | 2 |
| the last sentence of the paragraph on side effects is as on the base | 2, 3 |
| the real-time sentence is added and the old clause stays | 2, 3 |
| the real-time sentence does not name the file time | 2 |
| the real-time sentence is in Conventions, not in Architecture | 2 |

The trial of the sweep field ran every file of `tests/surface` with a first wording of the real-time sentence (`Some tests use real time to bound a wait or to set a file time.`). The words changed after it, when the sweep found calls that measure a wait and one that a stat stand-in returns. The DoD ran with the final words; it holds each test file that reads `CLAUDE.md`.
