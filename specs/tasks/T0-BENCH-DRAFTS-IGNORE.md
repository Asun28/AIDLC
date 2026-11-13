---
id: T0-BENCH-DRAFTS-IGNORE
title: Git ignores the reviewer bench case files under evals/review, so the unconfirmed drafts of the export no longer fill git status, and a confirmed case is committed with git add -f
status: todo
branch: T0-BENCH-DRAFTS-IGNORE
worktree: D:\wt\AIDLC\T0-BENCH-DRAFTS-IGNORE
superseded_by: T0-BENCH-DRAFTS-IGNORE-2
allow_paths:
  - .gitignore
  - evals/review/README.md
  - tests/surface/bench-drafts-ignore.test.ts
  - tests/surface/review-bench.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-BENCH-DRAFTS-IGNORE.md
dod_command: npm run typecheck && node --test tests/surface/bench-drafts-ignore.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-export.test.ts tests/surface/test-temp.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The root `.gitignore` shall gain, after its last line `*.log`, one blank line and then two lines, the comment of acceptance detail 1 and the rule `/evals/review/*.json`. No other line of the file changes, and the file ends with one line break.
  - R2. `evals/review/README.md` shall gain, as its last paragraph (after the paragraph that begins `A draft comes from the finding's reason alone`, separated by one blank line), the paragraph of acceptance detail 3. No other line of the file changes.
  - R3. `tests/surface/review-bench.test.ts` shall gain exactly one element, the paragraph of R2, as the last element of `CASES_README`. No other line of that file changes, so its test of acceptance 9 of T1-REVIEW-BENCH requires the README whole with the new paragraph and its removal loop covers both sentences of it.
  - R4. A new test file `tests/surface/bench-drafts-ignore.test.ts` shall pin the two lines of R1 as text, and shall pin what git reads from the root `.gitignore`, in a new repository under a temporary directory that holds a byte copy of that file (acceptance detail 1 and 2).
  - R5. CHANGELOG.md shall carry the entry of acceptance detail 4 directly above the entry that begins ``- `CLAUDE.md` and `templates/CLAUDE.aidlc.md` (Hard limits) carry two rules``, followed by one blank line, and the new test file shall require it as a whole line of the part of CHANGELOG.md from `## Unreleased` to the heading `## 0.1.0 - 2026-09-11`.
acceptance:
  - 1. `tests/surface/bench-drafts-ignore.test.ts` "the root .gitignore carries the rule once, under its comment". Fails on main by assertion (no line of the file is the rule). [R1] [R4] [dod arm 1] Detail in the body section Acceptance detail, item 1.
  - 2. Same file, "git reads the rule as case files directly under evals/review and nothing else". On main the first row fails by assertion (exit 1 where 0 is expected) and the five other rows pass; with this card all six pass. [R1] [R4] [dod arm 1] Detail item 2.
  - 3. `tests/surface/review-bench.test.ts`, the test of acceptance 9 of T1-REVIEW-BENCH, passes with the README paragraph and the new element, fails with the paragraph and without the element, and fails with the element and without the paragraph. [R2] [R3] [dod arm 1] Detail item 3.
  - 4. `tests/surface/bench-drafts-ignore.test.ts` "CHANGELOG.md carries the entry above the 0.1.0 section". Fails on main by assertion. [R5] [dod arm 1] Detail item 4.
  - 5. tests/surface/review-bench-export.test.ts, tests/surface/test-temp.test.ts, tests/surface/templates.test.ts and tests/surface/prose.test.ts pass unchanged. They pass on main and with this card. [R2] [R4] [R5] [dod arm 1]
depends_on: []
budget: 220
tdd: true
diagnosis:
  root_cause: "`aidlc review bench export` writes its drafts into `evals/review/`, a directory of tracked files, and no ignore rule covers them. On main at f994389c 490 unconfirmed drafts stand untracked there beside 30 tracked confirmed cases and README.md, so `git status` prints 490 lines for them and a file that needs attention is hard to see (audit of 2026-11-11, hygiene item H5; the owner chose the ignore rule on 2026-11-14)."
  repro: "On the main checkout at f994389c, counted 2026-11-14. `git status --porcelain evals/review` prints 490 lines; `git ls-files evals/review` prints 31 paths; every untracked case file has `confirmed` false and every tracked one `confirmed` true. With the rule supplied through `core.excludesFile`, `git status --porcelain evals/review` prints nothing and `git ls-files evals/review` still prints 31."
  same_class: "Other places a draft can land. `--dir <path>` of the export names any directory, which this rule does not cover. `aidlc init` writes no rule for evals/review into a downstream repository (src/scaffold/init.ts lists `.aidlc/`, `_local/` and `.review/`). Both are non-goals."
sweep: "On main at f994389c. `git grep -n 'evals/review' -- src tests docs README.md .gitignore` and `git grep -n -i gitignore -- tests`. tests/surface/review-bench.test.ts:452-476 holds `CASES_README`, the whole of evals/review/README.md paragraph by paragraph, compared at :492, and `OPERATIONS_SECTION`, the whole Reviewer bench section of docs/OPERATIONS.md, compared at :487, so this card puts its paragraph in the README and in `CASES_README` and leaves docs/OPERATIONS.md alone. tests/surface/review-bench-export.test.ts:916 reads the README for two needles, unchanged. No test reads the root `.gitignore` (tests/infra/init.test.ts reads the one `aidlc init` writes into a temporary target; tests/surface/mutants.test.ts writes its own). `git check-ignore` is used nowhere in src or tests. The root `.gitignore` has 32 lines, ends with `*.log` and one line break, holds no line with `evals`, and has line feeds only."
forbid:
  - weakening, skipping or deleting a test to go green
  - any change to `.gitignore` beyond the three lines of R1, or a rule that matches README.md, a subdirectory of evals/review or a path outside evals/review
  - deleting, moving, renaming or editing any case file under evals/review, tracked or not, or any ref under refs/aidlc/bench
  - a change to an existing element of `CASES_README` or to any other line of tests/surface/review-bench.test.ts
  - a change to src, to docs/OPERATIONS.md or to docs/ARCHITECTURE.md
  - a new dependency
non_goals:
  - the refs under refs/aidlc/bench that pin the drafts' candidates
  - how many files `aidlc review bench run` loads (it loads every case file of the directory, ignored or not)
  - an ignore rule that `aidlc init` writes into a downstream repository, or one for a directory named with `--dir`
  - confirming, moving or deleting any draft
hygiene: "Line numbers are from main at f994389c; find the code by content. Tests first, in two commits. The first adds tests/surface/bench-drafts-ignore.test.ts whole and the new element of `CASES_README`, with `.gitignore`, the README and CHANGELOG.md unchanged, and records acceptance 1, 2 (first row), 3 and 4 failing by assertion. The second adds the three lines of R1, the README paragraph and the CHANGELOG entry. The git child processes of the new test follow the implementer brief (no inherited `GIT_` variable, an empty global configuration file, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CEILING_DIRECTORIES`), and the temporary directory comes from `tmpDir` of tests/infra/helpers.ts and is removed with `cleanup` in an `after` hook. Revert table before the first review, each row a scratch change restored afterwards. The rule replaced in turn by `/evals/review/*`, `/evals/review/**/*.json`, `/evals/**/*.json`, `*.json` and `/evals/review/*.json*`, each failing a row of acceptance 2; the rule removed, failing acceptance 1 and row 1 of acceptance 2; the rule written twice, the comment line removed, the comment and the rule separated by a blank line, a second line that holds `evals`, each failing acceptance 1; the README paragraph removed and the `CASES_README` element removed, each failing acceptance 3; the CHANGELOG entry removed, and the entry moved below the heading `## 0.1.0 - 2026-09-11`, each failing acceptance 4. One equivalent change is named and not counted. `evals/review/*.json` without the leading slash reads the same to git, since a pattern with a slash inside it is anchored to the directory of its `.gitignore`; only the text pin of acceptance 1 tells the two apart."
doc_sync: evals/review/README.md, CHANGELOG.md
---

# T0-BENCH-DRAFTS-IGNORE

## Deliverable
Git ignores the case files directly under `evals/review/`. Plain `git status` no longer lists the 490 unconfirmed drafts of `aidlc review bench export`; the 30 tracked confirmed cases stay tracked; a newly confirmed case is committed with `git add -f`. The bench README says so, and a test pins the rule as text and as git reads it.

## Why
Audit of 2026-11-11, hygiene item H5. The drafts are the owner's data, so the audit left the choice (ignore, move or delete) to the owner, who chose the ignore rule on 2026-11-14. Nothing is deleted or moved.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/bench-drafts-ignore.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-export.test.ts tests/surface/test-temp.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. This is the targeted DoD; every test file that reads CHANGELOG.md runs at the coordinator's checkpoint before the first review.

## Acceptance detail

### 1
Test "the root .gitignore carries the rule once, under its comment". `RULE` is `/evals/review/*.json`. `COMMENT` is this line.

`# reviewer bench cases: a draft of aidlc review bench export stays local, and a confirmed case is committed with git add -f (evals/review/README.md)`

The lines of the root `.gitignore`, split at line feeds, are read. Exactly one line equals `RULE`; the line before it equals `COMMENT`; the line before `COMMENT` is empty; no line other than those two contains `evals`; the text ends with `RULE` and one line feed. On main no line equals `RULE`.

### 2
Test "git reads the rule as case files directly under evals/review and nothing else". A temporary directory from `tmpDir` becomes a repository (`git init`), and the bytes of the root `.gitignore` are written to `.gitignore` in it. No other file is created. For each row the test runs `git check-ignore -v --no-index -- <path>` in that directory and reads the exit code and standard output. `n` is the 1-based number of the `RULE` line in the root `.gitignore`.

| Path | Exit code | Standard output |
|---|---|---|
| `evals/review/T0-X.g-20260101000000-abcdef.F1.json` | 0 | `.gitignore:<n>:/evals/review/*.json`, a tab, the path, a line feed |
| `evals/review/README.md` | 1 | empty |
| `evals/review/sub/x.json` | 1 | empty |
| `evals/x.json` | 1 | empty |
| `evals/review/x.json.bak` | 1 | empty |
| `sub/evals/review/x.json` | 1 | empty |

Probed on 2026-11-14 with git on Windows in a scratch repository holding the root `.gitignore` plus the three lines: the six rows gave these results, a plain `git add evals/review/a.json` exited 1 with the hint to use `-f`, and `git add -f evals/review/a.json` staged the file.

### 3
The README paragraph, one line, the last paragraph of evals/review/README.md and the last element of `CASES_README`.

"`.gitignore` lists `/evals/review/*.json`, so plain `git status` leaves out a case file that is not tracked and `git add` adds it only with `-f`: commit a confirmed case with `git add -f evals/review/<id>.json`. A case file that is tracked stays tracked, and `git status` shows a change to it as before."

The existing test of acceptance 9 of T1-REVIEW-BENCH compares the README, split at blank lines, with `CASES_README`, and requires that removing any sentence of any element makes the comparison fail; it needs no other change.

### 4
Test "CHANGELOG.md carries the entry above the 0.1.0 section". The part of CHANGELOG.md from the first `## Unreleased` to the line feed before `## 0.1.0 - 2026-09-11`, split at line feeds, includes the entry as a whole line. The slice ends at the 0.1.0 heading and not at the next heading, because a release cut (audit item H12, a card of its own) will put a release heading between `## Unreleased` and this entry, and the entry stays above 0.1.0 then. The entry, one line.

"- T0-BENCH-DRAFTS-IGNORE (audit item H5): `.gitignore` lists `/evals/review/*.json`, so plain `git status` no longer lists the unconfirmed drafts that `aidlc review bench export` writes into `evals/review/` (490 stood untracked on 2026-11-14). A tracked case stays tracked, and a newly confirmed case is committed with `git add -f evals/review/<id>.json` (evals/review/README.md). `aidlc review bench run` loads every case file of the directory as before; the rule changes only what git lists."
