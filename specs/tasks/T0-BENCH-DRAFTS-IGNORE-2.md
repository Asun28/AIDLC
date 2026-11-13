---
id: T0-BENCH-DRAFTS-IGNORE-2
title: (replaces T0-BENCH-DRAFTS-IGNORE) Git ignores the reviewer bench case files directly under evals/review and no directory there, so the unconfirmed drafts of the export no longer fill git status, and a confirmed case is committed with git add -f
status: todo
branch: T0-BENCH-DRAFTS-IGNORE-2
worktree: D:\wt\AIDLC\T0-BENCH-DRAFTS-IGNORE-2
allow_paths:
  - .gitignore
  - evals/review/README.md
  - tests/surface/bench-drafts-ignore.test.ts
  - tests/surface/review-bench.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-BENCH-DRAFTS-IGNORE-2.md
dod_command: npm run typecheck && node --test tests/surface/bench-drafts-ignore.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-export.test.ts tests/surface/test-temp.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The root `.gitignore` shall gain, after its last line `*.log`, one blank line and then three lines, the comment of acceptance detail 1, the rule `/evals/review/*.json` and the exception `!/evals/review/*.json/`. No other line of the file changes, and the file ends with one line break.
  - R2. With those lines git shall ignore a file directly under `evals/review` whose name ends in `.json`, and nothing else. A directory directly under `evals/review` whose name ends in `.json` is not ignored, and neither is any file in it.
  - R3. `evals/review/README.md` shall gain, as its last paragraph (after the paragraph that begins `A draft comes from the finding's reason alone`, separated by one blank line), the paragraph of acceptance detail 4. No other line of the file changes.
  - R4. `tests/surface/review-bench.test.ts` shall gain exactly one element, the paragraph of R3, as the last element of `CASES_README`. No other line of that file changes, so its test of acceptance 9 of T1-REVIEW-BENCH requires the README whole with the new paragraph and its removal loop covers both sentences of it.
  - R5. A new test file `tests/surface/bench-drafts-ignore.test.ts` shall pin the three lines of R1 as text, and shall pin what git reads from the root `.gitignore`, in a new repository under a temporary directory that holds a byte copy of that file, for path names and for files and a directory that exist (acceptance detail 1 to 3).
  - R6. CHANGELOG.md shall carry the entry of acceptance detail 5 directly above the entry that begins ``- `CLAUDE.md` and `templates/CLAUDE.aidlc.md` (Hard limits) carry two rules``, followed by one blank line, and the new test file shall require it as a whole line of the part of CHANGELOG.md from `## Unreleased` to the heading `## 0.1.0 - 2026-09-11`.
acceptance:
  - 1. `tests/surface/bench-drafts-ignore.test.ts` "the root .gitignore carries the rule and its exception once, under the comment". Fails on main by assertion (no line of the file is the rule). [R1] [R5] [dod arm 1] Detail in the body section Acceptance detail, item 1.
  - 2. Same file, "git reads the rule as case files directly under evals/review and nothing else". On main the first row fails by assertion (exit 1 where 0 is expected) and the five other rows pass; with this card all six pass. [R1] [R2] [R5] [dod arm 1] Detail item 2.
  - 3. Same file, "a directory named like a case file and the files in it are not ignored". On main it fails by assertion (the draft file is listed as untracked); with the rule and without the exception it fails by assertion (the two files of the directory are not listed); with this card it passes. [R1] [R2] [R5] [dod arm 1] Detail item 3.
  - 4. `tests/surface/review-bench.test.ts`, the test of acceptance 9 of T1-REVIEW-BENCH, passes with the README paragraph and the new element, fails with the paragraph and without the element, and fails with the element and without the paragraph. [R3] [R4] [dod arm 1] Detail item 4.
  - 5. `tests/surface/bench-drafts-ignore.test.ts` "CHANGELOG.md carries the entry above the 0.1.0 section". Fails on main by assertion. [R6] [dod arm 1] Detail item 5.
  - 6. tests/surface/review-bench-export.test.ts, tests/surface/test-temp.test.ts, tests/surface/templates.test.ts and tests/surface/prose.test.ts pass unchanged. They pass on main and with this card. [R3] [R5] [R6] [dod arm 1]
depends_on: []
budget: 260
tdd: true
diagnosis:
  root_cause: "`aidlc review bench export` writes its drafts into `evals/review/`, a directory of tracked files, and no ignore rule covers them. On main at f994389c 490 unconfirmed drafts stand untracked there beside 30 tracked confirmed cases and README.md, so `git status` prints 490 lines for them and a file that needs attention is hard to see (audit of 2026-11-11, hygiene item H5; the owner chose the ignore rule on 2026-11-14)."
  repro: "On the main checkout at f994389c, counted 2026-11-14. `git status --porcelain evals/review` prints 490 lines; `git ls-files evals/review` prints 31 paths; every untracked case file has `confirmed` false and every tracked one `confirmed` true. With the rule supplied through `core.excludesFile`, `git status --porcelain evals/review` prints nothing and `git ls-files evals/review` still prints 31."
  same_class: "Other places a draft can land. `--dir <path>` of the export names any directory, which this rule does not cover. `aidlc init` writes no rule for evals/review into a downstream repository (src/scaffold/init.ts lists `.aidlc/`, `_local/` and `.review/`). Both are non-goals."
sweep: "On main at d4c878fc. `git grep -n 'evals/review' -- src tests docs README.md .gitignore` and `git grep -n -i gitignore -- tests`. tests/surface/review-bench.test.ts:452-476 holds `CASES_README`, the whole of evals/review/README.md paragraph by paragraph, compared at :492, and `OPERATIONS_SECTION`, the whole Reviewer bench section of docs/OPERATIONS.md, compared at :487, so this card puts its paragraph in the README and in `CASES_README` and leaves docs/OPERATIONS.md alone. tests/surface/review-bench-export.test.ts:916 reads the README for two needles, unchanged. No test reads the root `.gitignore` (tests/infra/init.test.ts reads the one `aidlc init` writes into a temporary target; tests/surface/mutants.test.ts writes its own). `git check-ignore` is used nowhere in src or tests. The root `.gitignore` has 32 lines, ends with `*.log` and one line break, holds no line with `evals`, and has line feeds only (`.gitattributes` sets `eol=lf`). No directory exists under evals/review on main."
forbid:
  - weakening, skipping or deleting a test to go green
  - any change to `.gitignore` beyond the four lines of R1, or lines by which git ignores README.md, a directory under evals/review, a file in such a directory or a path outside evals/review
  - deleting, moving, renaming or editing any case file under evals/review, tracked or not, or any ref under refs/aidlc/bench
  - a change to an existing element of `CASES_README` or to any other line of tests/surface/review-bench.test.ts
  - a change to src, to docs/OPERATIONS.md or to docs/ARCHITECTURE.md
  - a new dependency
non_goals:
  - the refs under refs/aidlc/bench that pin the drafts' candidates
  - how many files `aidlc review bench run` loads (it loads every case file of the directory, ignored or not)
  - an ignore rule that `aidlc init` writes into a downstream repository, or one for a directory named with `--dir`
  - confirming, moving or deleting any draft
hygiene: "This card replaces T0-BENCH-DRAFTS-IGNORE under the owner's rule of 2026-11-13, by which a card is not edited after its run starts and one that proves wrong is replaced. The predecessor fixed the rule as the single line `/evals/review/*.json` and forbade a rule that matches a subdirectory of evals/review; that line also matches a directory whose name ends in `.json` and hides every file in it (its first formal decision, finding class ignore-matches-directories), so the card contradicted itself. This card adds the exception line, R2 and acceptance 3, and differs in nothing else but the card id. Carry: on the current main apply the predecessor's change to everything but its card file, `git diff d4c878fc de73fcee -- . ':!specs'` (branch T0-BENCH-DRAFTS-IGNORE, commits c68bfd6a and c8b34e4c), then change what the exception line, acceptance 3 and the card id in the CHANGELOG entry and the test file need. Tests first, in two commits. The first holds tests/surface/bench-drafts-ignore.test.ts whole and the new element of `CASES_README`, with `.gitignore`, the README and CHANGELOG.md unchanged, and records acceptance 1, 2 (first row), 3, 4 and 5 failing by assertion. The second adds the four lines of R1, the README paragraph and the CHANGELOG entry. The git child processes of the test follow the implementer brief (no inherited `GIT_` variable, an empty global configuration file, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CEILING_DIRECTORIES`), and each temporary directory comes from `tmpDir` of tests/infra/helpers.ts and is removed with `cleanup` in an `after` hook. Revert table before the first review, each row a scratch change restored afterwards. The rule replaced in turn by `/evals/review/*`, `/evals/review/**/*.json`, `/evals/**/*.json`, `*.json`, `/evals/review/*.json*` and `evals/review/*.json` (no leading slash, which reads the same to git and differs in the printed pattern), each failing a row of acceptance 2 or the listing of acceptance 3; the rule removed, failing acceptance 1, row 1 of acceptance 2 and acceptance 3; the exception removed, and the exception written without its trailing slash (which then excepts the case files too), each failing acceptance 1 and acceptance 3; the exception placed above the rule, failing acceptance 1 and acceptance 3; the rule written twice, the comment line removed, the comment and the rule separated by a blank line, a further line that holds `evals`, each failing acceptance 1; the README paragraph removed and the `CASES_README` element removed, each failing acceptance 4; the CHANGELOG entry removed, and the entry moved below the heading `## 0.1.0 - 2026-09-11`, each failing acceptance 5."
doc_sync: evals/review/README.md, CHANGELOG.md
---

# T0-BENCH-DRAFTS-IGNORE-2

## Deliverable
Git ignores the case files directly under `evals/review/` and no directory there. Plain `git status` no longer lists the 490 unconfirmed drafts of `aidlc review bench export`; the 30 tracked confirmed cases stay tracked; a newly confirmed case is committed with `git add -f`. The bench README says so, and a test pins the lines as text and as git reads them.

## Why
This card replaces T0-BENCH-DRAFTS-IGNORE, whose single rule line also matched a directory named like a case file, against its own `forbid` (hygiene). Audit of 2026-11-11, hygiene item H5. The drafts are the owner's data, so the audit left the choice (ignore, move or delete) to the owner, who chose the ignore rule on 2026-11-14. Nothing is deleted or moved.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/bench-drafts-ignore.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-export.test.ts tests/surface/test-temp.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. This is the targeted DoD; every test file that reads CHANGELOG.md runs at the coordinator's checkpoint before the first review.

## Acceptance detail

### 1
Test "the root .gitignore carries the rule and its exception once, under the comment". `RULE` is `/evals/review/*.json`, `EXCEPT` is `!/evals/review/*.json/`, and `COMMENT` is this line.

`# reviewer bench cases: a draft of aidlc review bench export stays local, and a confirmed case is committed with git add -f (evals/review/README.md)`

The lines of the root `.gitignore`, split at line feeds, are read. Exactly one line equals `RULE` and exactly one equals `EXCEPT`; the line after `RULE` is `EXCEPT`; the line before `RULE` equals `COMMENT`; the line before `COMMENT` is empty; no line other than those three contains `evals`; the text ends with `EXCEPT` and one line feed. On main no line equals `RULE`.

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

### 3
Test "a directory named like a case file and the files in it are not ignored". A second repository of the same kind (its own temporary directory, `git init`, the byte copy of the root `.gitignore`) gets three files, each with the content `{}` and a line feed: `evals/review/draft.json`, `evals/review/archive.json/README.md` and `evals/review/archive.json/inner.json`. The test runs `git status --porcelain --untracked-files=all` there. The lines of its standard output, sorted, deep-equal `?? .gitignore`, `?? evals/review/archive.json/README.md`, `?? evals/review/archive.json/inner.json`. The draft file is not listed, and the two files of the directory are.

Probed on 2026-11-14 with git on Windows in a scratch repository. With the rule and the exception the listing is those three lines. With the rule alone it is `?? .gitignore` only, since the rule matches the directory `archive.json` and git then lists nothing in it. Without both lines it holds `?? evals/review/draft.json` as well. A plain `git add evals/review/a.json` exits 1 with the hint to use `-f`, and `git add -f evals/review/a.json` stages the file.

### 4
The README paragraph, one line, the last paragraph of evals/review/README.md and the last element of `CASES_README`.

"`.gitignore` lists `/evals/review/*.json`, so plain `git status` leaves out a case file that is not tracked and `git add` adds it only with `-f`: commit a confirmed case with `git add -f evals/review/<id>.json`. A case file that is tracked stays tracked, and `git status` shows a change to it as before."

The existing test of acceptance 9 of T1-REVIEW-BENCH compares the README, split at blank lines, with `CASES_README`, and requires that removing any sentence of any element makes the comparison fail; it needs no other change.

### 5
Test "CHANGELOG.md carries the entry above the 0.1.0 section". The part of CHANGELOG.md from the first `## Unreleased` to the line feed before `## 0.1.0 - 2026-09-11`, split at line feeds, includes the entry as a whole line. The slice ends at the 0.1.0 heading and not at the next heading, because a release cut (audit item H12, a card of its own) will put a release heading between `## Unreleased` and this entry, and the entry stays above 0.1.0 then. The entry, one line.

"- T0-BENCH-DRAFTS-IGNORE-2 (replaces T0-BENCH-DRAFTS-IGNORE, audit item H5): `.gitignore` lists `/evals/review/*.json`, so plain `git status` no longer lists the unconfirmed drafts that `aidlc review bench export` writes into `evals/review/` (490 stood untracked on 2026-11-14); a second line excepts a directory of such a name, so nothing in a directory is hidden. A tracked case stays tracked, and a newly confirmed case is committed with `git add -f evals/review/<id>.json` (evals/review/README.md). `aidlc review bench run` loads every case file of the directory as before; the two lines change only what git lists."

## Attempt evidence

Receipts are in the implementer scratchpad folder `h5-2` (red1.log, red3-rule-only.log, revert.mjs, revert.log, dod.log).

### Commits
- `00322333` test: RED. `tests/surface/bench-drafts-ignore.test.ts` whole and the new `CASES_README` element; `.gitignore`, README and CHANGELOG.md unchanged.
- `081281a2` the four `.gitignore` lines, the README paragraph, the CHANGELOG entry.
- `fae40df2` a third commit, not planned by the card: a type fix of 2 lines in the new test file (`SpawnSyncReturns<string>` for the `git` helper; `npm run typecheck` rejected `ReturnType<typeof spawnSync<string>>`). The RED commit was left as it was.

### RED, measured on 00322333
| Acceptance | Result on 00322333 | Failing assertion |
|---|---|---|
| 1 | not ok | "exactly one line is the rule": `0 !== 1` |
| 2, row 1 | not ok | `evals/review/T0-X.g-20260101000000-abcdef.F1.json: exit code`, `1 !== 0`; the loop stops at row 1, rows 2 to 6 expect exit 1 and no output, which a repository without the rule gives |
| 3 | not ok | listing has the extra line `?? evals/review/draft.json` |
| 4 | not ok | T1-REVIEW-BENCH acceptance 9: "the doc texts this card adds are present whole": `false == true` (element present, paragraph absent) |
| 5 | not ok | the entry is not a line of the part above 0.1.0: `actual: false` |

Intermediate RED of acceptance 3 (rule `/evals/review/*.json` with its comment, without the exception, in a scratch `.gitignore`, then restored; red3-rule-only.log): "git reads the rule..." ok; "a directory named like a case file..." not ok, the lines `?? evals/review/archive.json/README.md` and `?? evals/review/archive.json/inner.json` are missing.

### Revert table (measured on fae40df2 with scratch changes, each restored by `git checkout --`; `git diff --stat` empty at the end)
| # | Change | Test that went red | Acceptance |
|---|---|---|---|
| 1 | rule replaced by `/evals/review/*` | root .gitignore text; git reads the rule | 1, 2 |
| 2 | rule replaced by `/evals/review/**/*.json` | root .gitignore text; git reads the rule; directory test | 1, 2, 3 |
| 3 | rule replaced by `/evals/**/*.json` | same three | 1, 2, 3 |
| 4 | rule replaced by `*.json` | same three | 1, 2, 3 |
| 5 | rule replaced by `/evals/review/*.json*` | root .gitignore text; git reads the rule | 1, 2 |
| 6 | rule replaced by `evals/review/*.json` | root .gitignore text; git reads the rule | 1, 2 |
| 7 | rule removed | all three | 1, 2, 3 |
| 8 | exception removed | root .gitignore text; directory test | 1, 3 |
| 9 | exception without trailing slash | root .gitignore text; git reads the rule; directory test | 1, 2, 3 |
| 10 | exception above the rule | root .gitignore text; directory test | 1, 3 |
| 11 | rule written twice | root .gitignore text; git reads the rule | 1, 2 |
| 12 | comment line removed | root .gitignore text | 1 |
| 13 | blank line between comment and rule | root .gitignore text | 1 |
| 14 | a further line holding `evals` | root .gitignore text | 1 |
| 15 | README paragraph removed | T1-REVIEW-BENCH acceptance 9 | 4 |
| 16 | `CASES_README` element removed | T1-REVIEW-BENCH acceptance 9 | 4 |
| 17 | CHANGELOG entry removed | CHANGELOG.md carries the entry above the 0.1.0 section | 5 |
| 18 | CHANGELOG entry moved below `## 0.1.0 - 2026-09-11` | same | 5 |

Rows red: 18 of 18.

### DoD, measured on fae40df2
`npm run typecheck && node --test` of the six files: exit 0; tests 128, pass 128, fail 0, cancelled 0, skipped 0. (The first run on 081281a2 failed typecheck; that is the type fix above.)

### Document sentences against tests
| Sentence | Made true by | Test |
|---|---|---|
| README paragraph, sentence 1 (`.gitignore` lists the rule, so plain `git status` leaves out an untracked case file and `git add` needs `-f`) | the rule line; the ignored draft (git check-ignore row 1) and `git status` listing | bench-drafts-ignore.test.ts: git reads the rule; directory test (draft not listed) |
| README paragraph, sentence 2 (a tracked case stays tracked, `git status` shows its change) | git ignore rules do not apply to tracked files; the card's repro `git ls-files evals/review` prints 31 paths with the rule in effect | not covered by a test of this card (git behaviour; stated in the card's diagnosis) |
| README paragraph, text as a whole | README and `CASES_README` carry it | review-bench.test.ts T1-REVIEW-BENCH acceptance 9 |
| CHANGELOG sentence 1 (the rule, drafts no longer listed, a second line excepts a directory of such a name) | the two `.gitignore` lines | bench-drafts-ignore.test.ts: root .gitignore text; git reads the rule; directory test |
| CHANGELOG sentence 2 (tracked case stays tracked, `git add -f`) | as README sentence 2 | entry present: CHANGELOG test; behaviour as above |
| CHANGELOG sentence 3 (`aidlc review bench run` loads every case file as before) | no change to src (diff touches no file under src) | none; the diff holds no src file |
| `.gitignore` comment | the comment line, byte for byte | bench-drafts-ignore.test.ts: root .gitignore text |

### Changed lines against the budget of 260
- Without this evidence commit (`git diff --shortstat origin/main...HEAD` at fae40df2): 5 files changed, 98 insertions(+).
- With this evidence commit: 6 files changed, 160 insertions(+) (98 + 62 lines of this section), under the budget of 260.
