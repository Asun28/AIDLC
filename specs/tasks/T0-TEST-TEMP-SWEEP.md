---
id: T0-TEST-TEMP-SWEEP
title: Every remaining mkdtempSync site of tests/ uses the registering tmpDir helper, and a check fails on any mkdtemp call outside the four helpers that register their removal
status: todo
branch: T0-TEST-TEMP-SWEEP
worktree: D:\wt\AIDLC\T0-TEST-TEMP-SWEEP
allow_paths:
  - tests/surface/test-temp.test.ts
  - tests/core/ci-policy.test.ts
  - tests/core/journal-event-types.test.ts
  - tests/infra/base-sync.test.ts
  - tests/infra/exec.test.ts
  - tests/infra/git.test.ts
  - tests/infra/github-ship-merge-refused.test.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/init.test.ts
  - tests/scenarios/board-watch.test.ts
  - tests/scenarios/candidate-withdraw.test.ts
  - tests/scenarios/context-pack.test.ts
  - tests/scenarios/evidence-id.test.ts
  - tests/scenarios/manifest-lock.test.ts
  - tests/scenarios/mutants-review.test.ts
  - tests/scenarios/pre-existing.test.ts
  - tests/scenarios/t1-plan.test.ts
  - tests/surface/approver.test.ts
  - tests/surface/bench.test.ts
  - tests/surface/bounds.test.ts
  - tests/surface/card.test.ts
  - tests/surface/config.test.ts
  - tests/surface/fix-task-clear.test.ts
  - tests/surface/hook-git-prefetch.test.ts
  - tests/surface/hook-lazy.test.ts
  - tests/surface/hook-name.test.ts
  - tests/surface/incident.test.ts
  - tests/surface/init-base-ci.test.ts
  - tests/surface/init-no-package.test.ts
  - tests/surface/lease-heartbeat.test.ts
  - tests/surface/lesson-match.test.ts
  - tests/surface/lessons.test.ts
  - tests/surface/manifest.test.ts
  - tests/surface/mutants.test.ts
  - tests/surface/ops-intent.test.ts
  - tests/surface/outcome-github.test.ts
  - tests/surface/outcome-ingest.test.ts
  - tests/surface/outcome-usage.test.ts
  - tests/surface/ps-guard-read.test.ts
  - tests/surface/ps-guard-wire.test.ts
  - tests/surface/r2-pass-notes.test.ts
  - tests/surface/readme.test.ts
  - tests/surface/review-bench-export.test.ts
  - tests/surface/review-bench.test.ts
  - tests/surface/reviewer-env.child.ts
  - tests/surface/reviewer-env.test.ts
  - tests/surface/security-check.test.ts
  - tests/surface/stats.test.ts
  - specs/tasks/T0-TEST-TEMP-SWEEP.md
dod_command: npm run typecheck && node --test tests/surface/test-temp.test.ts tests/core/ci-policy.test.ts tests/core/journal-event-types.test.ts tests/infra/base-sync.test.ts tests/infra/exec.test.ts tests/infra/git.test.ts tests/infra/github-ship-merge-refused.test.ts tests/infra/github-ship.test.ts tests/infra/init.test.ts tests/scenarios/board-watch.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/context-pack.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/pre-existing.test.ts tests/scenarios/t1-plan.test.ts tests/surface/approver.test.ts tests/surface/bench.test.ts tests/surface/bounds.test.ts tests/surface/card.test.ts tests/surface/config.test.ts tests/surface/fix-task-clear.test.ts tests/surface/hook-git-prefetch.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-name.test.ts tests/surface/incident.test.ts tests/surface/init-base-ci.test.ts tests/surface/init-no-package.test.ts tests/surface/lease-heartbeat.test.ts tests/surface/lesson-match.test.ts tests/surface/lessons.test.ts tests/surface/manifest.test.ts tests/surface/mutants.test.ts tests/surface/ops-intent.test.ts tests/surface/outcome-github.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/ps-guard-read.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/readme.test.ts tests/surface/review-bench-export.test.ts tests/surface/review-bench.test.ts tests/surface/reviewer-env.test.ts tests/surface/security-check.test.ts tests/surface/stats.test.ts tests/surface/eval-test-temp.test.ts tests/scenarios/evidence-id.test.ts tests/scenarios/manifest-lock.test.ts
dod_exit: 0
requirements:
  - R1. Every `mkdtempSync` call of tests/ outside the four helpers of R2 shall be replaced by `tmpDir(<the same prefix>)` of tests/infra/helpers.ts (registering, card T0-TEST-TEMP-CLEANUP), or `tmpDir(<prefix>, <parent>)` where the site creates the directory inside another one (tests/surface/review-bench.test.ts:158); a `realpathSync.native` around the call and the site's own removal (`cleanup`, `rmSync`) stay as they are, a `finally` that ends processes before it removes their directory keeps that order (tests/infra/exec.test.ts:359-382), and the imports the change leaves unused are removed.
  - R2. `tests/surface/test-temp.test.ts` shall parse every `.ts` file under tests/ with the TypeScript compiler API and report every call whose callee resolves to `mkdtempSync`, `mkdtemp` or `mkdtempDisposableSync` of `fs`, `node:fs`, `fs/promises` or `node:fs/promises`, reached by a named import, an aliased import, a namespace or default import (`fs.mkdtempSync`, `fs.promises.mkdtemp`), destructuring (`const { mkdtempSync: m } = fs`), property or element access (`fs['mkdtempSync']`) or `require` (`require('node:fs').mkdtempSync`), and every reference to one of them that is not called (passed or stored), unless the call lies directly in one of four functions: `tmpDir` of tests/infra/helpers.ts, `tempDir` of tests/surface/evals.test.ts, `tempDir` of tests/surface/command-lines.test.ts (each records its directory at creation and removes it in an `after` hook, card T0-EVAL-TEST-TEMP, whose acceptance 3 requires the one `mkdtempSync(` of evals.test.ts) and `inTemp` of tests/surface/eval-test-temp.test.ts (it removes its directory in a `finally`). A call is exempt only when its nearest enclosing function is one of those four at that file; a function nested inside an allowed helper is not exempt, and a function of the same name in another file is not exempt. Text in strings and comments is not a call. Each report names the file, the line and the enclosing function (or module scope).
  - R3. The full suite shall pass once on the candidate (`npm test`, exit 0) before the first review, since the DoD runs the changed files but the migration touches 47 of them.
acceptance:
  - 1. `tests/surface/test-temp.test.ts` "no mkdtemp call of tests/ lies outside a helper that registers its removal" passes; on main (after T0-TEST-TEMP-CLEANUP) it fails, naming the 85 sites the sweep lists with file, line and function. [R1] [R2] [dod arm 1]
  - 2. Same file, "the scan finds every form" (a table test of the scan function over source texts written in a directory from `tmpDir`): a named import call, an aliased import call, a namespace import call, a default import call, `fs.promises.mkdtemp`, an import from `node:fs/promises`, destructuring with and without a rename, `fs['mkdtempSync']`, `require('node:fs').mkdtempSync`, a destructured `require('fs')`, `mkdtempDisposableSync`, and an uncalled reference (`const make = mkdtempSync`) are each reported with the expected file, line and enclosing function; the four helpers at their exact files and functions are not reported; a function named `tmpDir` in another file, and a function nested inside `tmpDir` of helpers.ts, are reported; `'mkdtempSync('` in a string and in a comment, and a local function named `mkdtempSync` not imported from fs, are not. Two rows added by the planner's rulings of 2026-11-12: a call that follows a string holding U+2028 and U+2029 is reported at the line a count of line feeds gives, and a call inside an immediately invoked function assigned to a constant is reported with the enclosing function `<constant> (immediately invoked)`. Rows added by the rulings after the pre-review of 0b22f3d1, each reported unless it says otherwise: a binding default that names the function (`const { make = mkdtempSync } = {}`); a computed binding name (`const { ['mkdtempSync']: make } = fs`) and a nested one (`const { promises: { mkdtemp: make } } = fs`), each with the call of `make`; `const fs = await import('node:fs')` followed by `fs.mkdtempSync(...)`; a reference stored, not called, inside an allowed helper; a call inside a function nested in an allowed helper that bears an allowed helper's name; not reported: `(mkdtempSync)(...)` and `mkdtempSync!(...)` directly inside an allowed helper, and a type-only import used only in type positions (`import type { mkdtempSync } from 'node:fs'; type F = typeof mkdtempSync`). Rows added by the rulings after R3 decision 1, each reported unless it says otherwise: `fs!.mkdtempSync(...)`, `(fs as typeof fs).mkdtempSync(...)`, `(<typeof fs>fs).mkdtempSync(...)`, `(fs satisfies typeof fs).mkdtempSync(...)` and `fs?.mkdtempSync(...)`; `import { default as fs } from 'node:fs'`, `const { default: fs } = await import('node:fs')`, `(await import('node:fs')).default.mkdtempSync(...)` and `import fs = require('node:fs')`, each with a call through `fs`; not reported: a value import used only in a type position (`import { mkdtempSync } from 'node:fs'; export type F = typeof mkdtempSync`). [R2] [dod arm 1]
  - 3. Every file of allow_paths passes in the DoD, and no assertion, test name or test count of any of them changes; tests/infra/exec.test.ts acceptance 5 of T0-EXEC-TREE-KILL (:357-384) keeps ending its processes before it removes its directory. [R1] [dod arm 1]
  - 4. Checkpoint: `npm test` on the candidate exits 0 before the first review, and its output is pasted in the attempt evidence. [R3]
depends_on: [T0-TEST-TEMP-CLEANUP, T0-INCIDENT-INTENT-LEDGER, T0-SHIP-TIMEOUT]
budget: 880
tdd: true
diagnosis:
  root_cause: "The sites in sweep create directories with `mkdtempSync` under the OS temporary directory; many remove theirs at the end of the test, and a test that fails or exits early, or a removal that fails on Windows, leaves them. Together they left about 9 percent of the 71,508 aidlc- directories of 2026-11-11 (aidlc-evals- 2,300 before T0-EVAL-TEST-TEMP, aidlc-evidence- 464, aidlc-ghship- 346, aidlc-cards- 316, aidlc-hook-name- 305, aidlc-incident- 273, aidlc-stats- 254, aidlc-intent- 241, aidlc-stats-pe- 226, aidlc-pe-panel- 197, aidlc-no-package- 164 and smaller ones). Nothing stops a new test from adding another site."
  repro: "On main after T0-TEST-TEMP-CLEANUP the check of acceptance 1 reports the 85 sites."
  same_class: "Other ways a test makes a directory under the OS temporary directory were searched: git grep -n 'mkdirSync(path.join(tmpdir\|mkdirSync(path.join(os.tmpdir' -- tests finds none at 6c1a6cfd. The eval runner's own checkouts (src/evals/runner.ts) are product code and not in this card."
sweep: "git grep -n 'mkdtemp' -- tests at 6c1a6cfd, each call located with the TypeScript AST (file:line [enclosing function]). Allowed by R2, unchanged: tests/infra/helpers.ts:8 [tmpDir], tests/surface/evals.test.ts:19 [tempDir], tests/surface/command-lines.test.ts:18 [tempDir], tests/surface/eval-test-temp.test.ts:16 [inTemp]. Migrated by T0-TEST-TEMP-CLEANUP: tests/scenarios/_harness.ts:53, tests/surface/hooks.test.ts (6), tests/surface/verifier.test.ts:17, tests/surface/pre-review.test.ts (3). Replaced by tmpDir with the same prefix here (R1), 85 sites (83 at 6c1a6cfd and the two the planner's sweep of 2026-11-12 added): tests/core/ci-policy.test.ts:241, 257, 271, 607; tests/core/journal-event-types.test.ts:25 [written]; tests/infra/base-sync.test.ts:34 [cloneOfOrigin], 214 [promisorClone]; tests/infra/exec.test.ts:223 [raceFixture], 359, 436, 665, 703; tests/infra/git.test.ts:150; tests/infra/github-ship-merge-refused.test.ts:35 [refusedShip]; tests/infra/github-ship.test.ts:33 [fixture], 1393; tests/infra/init.test.ts:25, 53, 78, 94 [upgrade], 129, 217 [tempTarget]; tests/scenarios/board-watch.test.ts:44 [fixture]; tests/scenarios/candidate-withdraw.test.ts:385; tests/scenarios/context-pack.test.ts:48, 106, 198; tests/scenarios/evidence-id.test.ts:26 [tempDir] and tests/scenarios/manifest-lock.test.ts:29 [tempDir] (added after 6c1a6cfd by T0-EVIDENCE-ID-COLLISION and T0-MANIFEST-LOCK, lines as on main at fba72f15; each `tempDir` records its directory and an `after` hook removes it, which stays, and neither is one of the four functions of R2); tests/scenarios/mutants-review.test.ts:178, 191, 280, 296; tests/scenarios/pre-existing.test.ts:97; tests/scenarios/t1-plan.test.ts:118; tests/surface/approver.test.ts:34 [fixture]; tests/surface/bench.test.ts:29 [withTemp]; tests/surface/bounds.test.ts:43; tests/surface/card.test.ts:167, 198, 454, 480; tests/surface/config.test.ts:310, 349 [inCheckout]; tests/surface/fix-task-clear.test.ts:22 [repo]; tests/surface/hook-git-prefetch.test.ts:27 [withTemp]; tests/surface/hook-lazy.test.ts:34 [withTemp]; tests/surface/hook-name.test.ts:17 [tempDir]; tests/surface/incident.test.ts:29, 52, 69, 77; tests/surface/init-base-ci.test.ts:27 [tempDir]; tests/surface/init-no-package.test.ts:31 [tempDir]; tests/surface/lease-heartbeat.test.ts:31 [withState]; tests/surface/lesson-match.test.ts:15 [withFile], 95 [repo], 217; tests/surface/lessons.test.ts:16 [dir], 158 [repoAtClose]; tests/surface/manifest.test.ts:11, 36; tests/surface/mutants.test.ts:67 [before hook], 84 [repo], 169 [module scope], 928 [cliFixture]; tests/surface/ops-intent.test.ts:19 [repo]; tests/surface/outcome-github.test.ts:19 [tempDir]; tests/surface/outcome-ingest.test.ts:17 [tempDir]; tests/surface/outcome-usage.test.ts:21 [tempDir]; tests/surface/ps-guard-read.test.ts:27 [context]; tests/surface/ps-guard-wire.test.ts:26 [tempDir]; tests/surface/r2-pass-notes.test.ts:33 [readAnswer]; tests/surface/readme.test.ts:61; tests/surface/review-bench-export.test.ts:61 [repo]; tests/surface/review-bench.test.ts:42 [fixture], 148, 158 (inside the directory of :148, so tmpDir with that parent), 425, 774; tests/surface/reviewer-env.child.ts:22 [tempDir] (a child process that creates, uses and leaves its own directories; reviewer-env.test.ts reads only its output and exit code, so R3 of T0-TEST-TEMP-CLEANUP holds); tests/surface/reviewer-env.test.ts:16 [tempDir]; tests/surface/security-check.test.ts:20; tests/surface/stats.test.ts:451, 578. Unnamed sites are inside a test body. Line numbers of incident.test.ts and github-ship.test.ts move when T0-INCIDENT-INTENT-LEDGER and T0-SHIP-TIMEOUT merge; run the sweep again at PREPARE. Tests that pin behaviour touched: tests/surface/eval-test-temp.test.ts acceptance 3 (exactly one mkdtempSync( in evals.test.ts, kept by R2)."
forbid:
  - changing, removing or skipping an assertion or a test, or changing a test name
  - a change to tests/infra/helpers.ts (owned by T0-TEST-TEMP-CLEANUP) or to the four allowed helpers
  - any change under src/
  - deleting the directories earlier runs left in the OS temporary directory
  - editing .aidlc state by hand
non_goals:
  - reaching the module or the function by a way the closed list of the rulings after R3 decision 1 does not name: `process.getBuiltinModule`, `module.createRequire`, `Reflect.get`, a computed name that is not a string literal, a spread copy of the namespace, a value passed through a function
  - an alias of the fs namespace made by a later assignment (`other = fs`) and a re-export of the function from another module: the scan follows declarations with their initializers and the imports of each file, and a missed form of this kind has to be written to get around the check
  - a report for a parameter or local that shadows the name of an fs import: it fails the check for code that makes no directory, and the fix is another name
  - temporary files the product code creates (the eval runner checkouts, the exec tree helper)
  - a process that is killed before its exit handler runs; its directories are left
  - deleting the directories already in the OS temporary directory
hygiene: "Run this card last, when no other card touches tests/ (it depends on T0-TEST-TEMP-CLEANUP, T0-INCIDENT-INTENT-LEDGER and T0-SHIP-TIMEOUT, which edit tests/surface/incident.test.ts and tests/infra/github-ship.test.ts). At PREPARE run the sweep again on main; a site another card added since is migrated here after a card amendment on main that adds its file. A test-only card adds no CHANGELOG entry, as T0-EVAL-TEST-TEMP did not."
doc_sync: none (test only)
---

# T0-TEST-TEMP-SWEEP

## Deliverable
Every migrated test directory is registered at creation for best-effort synchronous removal at normal process exit. A removal that fails is reported on stderr and the test is not failed. A process that is killed can leave directories. This card migrates every remaining site and adds a check that fails when a test creates a temporary directory outside the four registering helpers.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/test-temp.test.ts tests/core/ci-policy.test.ts tests/core/journal-event-types.test.ts tests/infra/base-sync.test.ts tests/infra/exec.test.ts tests/infra/git.test.ts tests/infra/github-ship-merge-refused.test.ts tests/infra/github-ship.test.ts tests/infra/init.test.ts tests/scenarios/board-watch.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/context-pack.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/pre-existing.test.ts tests/scenarios/t1-plan.test.ts tests/surface/approver.test.ts tests/surface/bench.test.ts tests/surface/bounds.test.ts tests/surface/card.test.ts tests/surface/config.test.ts tests/surface/fix-task-clear.test.ts tests/surface/hook-git-prefetch.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-name.test.ts tests/surface/incident.test.ts tests/surface/init-base-ci.test.ts tests/surface/init-no-package.test.ts tests/surface/lease-heartbeat.test.ts tests/surface/lesson-match.test.ts tests/surface/lessons.test.ts tests/surface/manifest.test.ts tests/surface/mutants.test.ts tests/surface/ops-intent.test.ts tests/surface/outcome-github.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/ps-guard-read.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/readme.test.ts tests/surface/review-bench-export.test.ts tests/surface/review-bench.test.ts tests/surface/reviewer-env.test.ts tests/surface/security-check.test.ts tests/surface/stats.test.ts tests/surface/eval-test-temp.test.ts tests/scenarios/evidence-id.test.ts tests/scenarios/manifest-lock.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes, then `npm test` exits 0 once (acceptance 4).

## Planner note of 2026-11-12 (before the start)

The sweep was run again on main at fba72f15, after every other card of the audit that touches tests/ had merged or, for T0-ATTEMPT-NUMBER, was under review with no mkdtemp site in its two test files. `git grep -n "mkdtemp[A-Za-z]*(" -- tests` outside the four helpers of R2 gives 85 calls in 47 files: the count per file is the one the `sweep` field lists for each of its 45 files, plus one call each in tests/scenarios/evidence-id.test.ts and tests/scenarios/manifest-lock.test.ts, which the amendment of today adds to `allow_paths`, to the `dod_command` and to the sweep.

The line numbers of the `sweep` field are those of 6c1a6cfd and have moved in many files: find each site by its content, and list in the Attempt evidence every site migrated with its file, current line and enclosing function, with the total. If the count on the branch is not 85 in 47 files when the build starts, stop and report the difference before migrating anything.

tests/infra/exec.test.ts changed since the card was written (T0-EXEC-TEST-LOAD): the tests R1 names keep their `finally` order (processes ended before their directory is removed), the runner-handle test is now calibrated, and the calibration and its rows already use `tmpDir`. Its five `mkdtempSync` calls are the five the sweep lists, at other lines. Under a parallel run that file can still fail its `runSync` row with the message `fixture not ready before the timeout at scale <n>` (a known limit of that card, on the follow-up list); for the full-suite run of R3, a failure of that row alone, or of tests/scenarios/mutants-review.test.ts or tests/surface/review-bench.test.ts under load, is reported with the file run alone afterwards, and is not a reason to change a test.

R3 of this card asks for one full `npm test` on the candidate before the first review. That is this card's own requirement and the one exception to the standing rule that implementers do not run the full suite.

## Planner rulings of 2026-11-12 after the build report (candidate 676fca5d)

The budget. The card gave 520 for the changed lines of code and counted no attempt evidence; the candidate is 517 changed lines in the 48 test files and 107 lines of evidence in this card, 624 by `git diff --shortstat origin/main...HEAD`. The budget is 700, which also holds the two rows below, their evidence and the coordinator's verification block. A test-only card needs no size exception.

Rulings on the points the implementer disclosed:

| Disclosed point | Ruling |
|---|---|
| The TypeScript compiler starts a new line at U+2028 and U+2029, which tests/infra/github-ship.test.ts holds inside a string, so the first report named one site two lines late; the scan now counts line feeds, and its 85 file and line pairs equal the `git grep` list | Accepted, with a row: R2 says each report names the line, and the line a reader and `git grep` see is the one counted by line feeds. One row of acceptance 2: a source whose call follows a string holding both characters is reported at the line-feed line |
| A call inside an immediately invoked function assigned to a constant is reported with the function `<constant> (immediately invoked)`, where the sweep field says `[module scope]` for tests/surface/mutants.test.ts:169 | Accepted, with a row that pins the format. The sweep field described that site before the scan existed; the report is more exact |
| An allowed helper is exempt only as a top-level function declaration of its file, and only for calls inside it, not for an uncalled reference | Accepted. It is the narrower reading of R2 ("a call is exempt only when its nearest enclosing function is one of those four at that file"), and no existing site depends on the wider one |
| The RED commit 3d3e9d31 holds a local constant named with a word the secret scan treats as a credential name; a later commit renames it | Accepted. The coordinator scanned the five commits of the branch with the pinned gitleaks: no finding. Nothing is rewritten |
| Commits use the prefixes `test:` and `docs:` | Accepted for a test-only card |
| No test observes that tests/infra/exec.test.ts ends its processes before it removes their directory, so that order has no revert row; the diff of that file is its import line and its five sites | Accepted as stated: acceptance 3 asks that the order is kept, and the diff shows no line of a `finally` changed |

## Planner rulings of 2026-11-12 after the pre-review of 0b22f3d1

A Codex pre-review of 0b22f3d1 verified all 85 replacements in the 47 files (only import lines and site expressions differ; prefixes, parents, `realpathSync` wrappers, assertions and cleanup order intact; no forbidden path, no CHANGELOG entry) and the two rows of the earlier rulings. The coordinator had asked it to look for forms the scan misses; it found several. The scan is a syntactic check against an ordinary new `mkdtempSync` in a test, not a defence against code written to evade it, so the rulings take every form R2's wording covers and state the rest as limits:

| Point | Ruling |
|---|---|
| A binding default that names the function (`const { make = mkdtempSync } = {}`) gives no report | Accepted: it is a reference that is not called, which R2 reports. Row |
| Computed and nested binding names from the namespace (`const { ['mkdtempSync']: make } = fs`, `const { promises: { mkdtemp: make } } = fs`) give no report | Accepted: both are destructuring, which R2 names. Rows |
| A reference stored inside an allowed helper, and a function nested in a helper that bears a helper's name, are refused by the code but no row fails when either restriction is removed | Accepted: two rows. These are the restrictions the implementer added as the narrower reading of R2 |
| `(mkdtempSync)(...)` inside an allowed helper is reported as an uncalled reference | Accepted: parentheses and a non-null assertion around the callee are looked through when deciding whether a reference is called. Row (not reported) |
| A type-only import used in a type position fails the check | Accepted: `import type` and type positions hold no runtime reference. Row (not reported) |
| `const fs = await import('node:fs')` gives no report | Accepted: a dynamic import of the module, awaited in an initializer, is read as `require` is. Row |
| A namespace alias made by a later assignment (`other = fs; other.mkdtempSync(...)`) gives no report | Not in this card: a non-goal with its reason. Following assignments is data flow, which a syntactic scan does not do |
| A re-export of the function from another module, and its consumers, give no report | Not in this card: a non-goal with the same reason |
| An fs import named `fs` makes `fs.mkdtempSync()` on a parameter of the same name a report | Not in this card: a non-goal. The check then fails for code that makes no directory, which is the safe direction, and the fix is a different parameter name |

Reverts that must each fail its row: the binding default not read; computed names not resolved; nested patterns not followed; the dynamic import not read; `called &&` removed from the exemption; `fn.parent === sf` removed from the exemption; the parentheses not looked through (the helper row then reports); type-only imports not excluded (the type row then reports).

The full suite of R3. The implementer ran `npm test` on 733a8434 (3 462 tests, 3 440 pass, 0 fail, 22 skipped). The coordinator ran it again on 0b22f3d1, the head this pre-review read, on 2026-11-12T04:26Z: 3 476 tests, 3 454 pass, 0 fail, 22 skipped, exit 0. It runs it once more on the head that goes to the formal review and records the counts in the Attempt evidence.

## Planner rulings of 2026-11-12 after R3 decision 1

R3 decision 1 blocked the candidate f3463b49 on three findings, all on the scan of tests/surface/test-temp.test.ts; the migration of the 85 sites was not questioned. All three are accepted. Each is the first case of a class, so each class is closed by construction and not case by case:

| Finding (class) | Ruling |
|---|---|
| `fs!.mkdtempSync(...)` and `(fs as typeof fs).mkdtempSync(...)` give no report: the namespace is looked for under parentheses only (fs-expression-wrapper-missed) | Every place where the scan reads an expression to decide what it is (the object of a property or element access, a callee, an initializer, the operand of `await`) first passes it through `ts.skipOuterExpressions`, which removes parentheses, `as`, angle-bracket assertions, `satisfies` and non-null assertions together. Optional chaining needs no step: `fs?.mkdtempSync` is the same node kind. Rows for each wrapper |
| `import { default as fs } from 'node:fs'` and `const { default: fs } = await import('node:fs')` give no report (fs-default-binding-missed) | The property, import specifier or binding name `default` of an fs module object is that module object, wherever a name is bound or a property read: the import specifier, a binding pattern over the module, `.default` and `['default']` on it. `import fs = require('node:fs')` binds the module as `require` does. Rows for each |
| A value import used only in a type position (`typeof mkdtempSync` in a type alias) is reported (type-position-reported) | An identifier for which `ts.isPartOfTypeNode` is true, or that lies inside a type query, is not a runtime reference and is skipped; the same identifier in an expression is reported as before. Row |

The contract of the scan, closed (R2 as this card reads it; what is not on this list is a non-goal). A name is bound to an fs module object by: `import * as x`, a default import, `import { default as x }`, `import x = require(m)`, and a variable or binding pattern initialized with `require(m)`, `await import(m)` or another name so bound, for `m` one of `fs`, `node:fs`, `fs/promises`, `node:fs/promises`, and with `.promises` of an fs object. A name is bound to one of the three functions by: a named or aliased import, and a binding pattern (plain, renamed, with a string-literal computed name, nested under `promises` or `default`, with or without a default value) over an fs module object. A report is made for: a call whose callee, after `ts.skipOuterExpressions`, is a name so bound, or a property access or string-literal element access of one of the three names on an fs module object; and any other runtime reference to such a name or access that is not the callee of a call. Exempt: a call directly in one of the four functions of R2, declared at the top level of its file. Not followed, by the non-goals: assignments after the declaration, values passed through functions, re-exports, spread copies, computed names that are not string literals, `process.getBuiltinModule`, `module.createRequire`, `Reflect.get`, and lexical shadowing.

Reverts that must each fail its row: `skipOuterExpressions` removed at the object of a property access, at a callee and at an initializer (three runs); `default` not treated as the module at the import specifier, in a binding pattern and as a property (three runs); the import-equals form not bound; type positions not skipped.

Before the second formal decision the coordinator has the candidate pre-reviewed against this closed list until a pre-review finds no form on the list that the scan misses.

## Planner rulings of 2026-11-12 during the repair after R3 decision 1

Two points the implementer raised while applying the rulings after R3 decision 1; both change those rulings.

| Point | Ruling |
|---|---|
| `ts.skipOuterExpressions` is in the TypeScript 5.9.3 runtime and not in its public type declarations; the scan reached it through a cast | The planner named a function that is not public API. The scan does not call it. A local function removes the same wrappers through the five public node tests (`ts.isParenthesizedExpression`, `ts.isAsExpression`, `ts.isTypeAssertionExpression`, `ts.isNonNullExpression`, `ts.isSatisfiesExpression`), in a loop, at every place the rulings name. Where those rulings and the contract say `ts.skipOuterExpressions`, read: that local function. The rows and reverts are unchanged |
| With type positions skipped, removing the exclusion of type-only imports leaves every row green: an `import type` name can only stand in a type position in code that compiles, and that position is skipped anyway | The exclusion of type-only imports is removed as redundant; the earlier row (a type-only import used in a type position is not reported) stays and is covered by the rule on type positions. No row with code that does not compile is added |

## Attempt evidence

Implementer attempt on branch T0-TEST-TEMP-SWEEP from ebd2892b. Commits: 3d3e9d31 (RED: tests/surface/test-temp.test.ts alone), 733a8434 (R1: the 85 sites), a2b45c16 (the scan counts lines by LF; see RED), 928b23c9 (a local of the scan renamed from `key` to `prop`), 676fca5d (evidence), cc2a1aa3 (merge of origin/main at a087161e; conflict in this card only, main's rulings placed above this section), 61a51d81 (the two rows of the planner rulings), then this evidence commit, which changes only this card.

Sweep after the merge (cc2a1aa3, actual run): acceptance 1 passes (pass 2, fail 0 for the file), and `git grep -n "mkdtemp[A-Za-z]*(" -- tests` outside the four helpers and tests/surface/test-temp.test.ts finds 0 lines: no site came in with main.

Sweep before any edit (ebd2892b, actual run): `git grep -n "mkdtemp[A-Za-z]*(" -- tests` gives 90 lines; minus the four helpers of R2 and the string at tests/surface/eval-test-temp.test.ts:56, 85 calls in 47 files, as the planner note says. After 928b23c9 (actual run): the same grep finds only the four helpers, that string and the table strings of tests/surface/test-temp.test.ts. `git grep -c "mkdtemp" -- tests` names five files: the files of the four helpers (their own calls, imports, test names and the string above) and tests/surface/test-temp.test.ts, where every occurrence is inside a string literal; 0 occurrences elsewhere.

### RED (3d3e9d31, actual run, `node --test tests/surface/test-temp.test.ts`)
- Acceptance 1: fails (exit 1, pass 1, fail 1) with the AssertionError message `85 sites outside the four helpers:` followed by one line per site, `<file>:<line> [<enclosing function>] call of mkdtempSync`.
- The RED scan counted lines as the compiler does, which also ends a line at U+2028 and U+2029; tests/infra/github-ship.test.ts:533 holds both in a string, so its second site was reported as :1393 where git grep shows :1391. a2b45c16 counts lines by LF. Actual run on 928b23c9 with the 47 files restored to 3d3e9d31: 85 sites, and their file:line list equals the git grep list of the sweep line for line.
- Acceptance 2: passes on 3d3e9d31 (the scan exists in the RED commit; the card lets it pass on its own rows). Its rows are shown to bite by the revert table.

### Migrated sites (928b23c9, current line, enclosing function): 85 in 47 files
- tests/core/ci-policy.test.ts: 241 [callback of test], 257 [callback of test], 271 [callback of test], 607 [callback of test]
- tests/core/journal-event-types.test.ts: 25 [written]
- tests/infra/base-sync.test.ts: 34 [cloneOfOrigin], 214 [promisorClone]
- tests/infra/exec.test.ts: 518 [raceFixture], 664 [callback of it], 742 [callback of it], 975 [callback of it], 1013 [callback of it]
- tests/infra/git.test.ts: 155 [callback of it]
- tests/infra/github-ship-merge-refused.test.ts: 35 [refusedShip]
- tests/infra/github-ship.test.ts: 33 [fixture], 1391 [callback of test]
- tests/infra/init.test.ts: 25 [callback of test], 53 [callback of test], 78 [callback of test], 94 [upgrade], 129 [callback of test], 217 [tempTarget]
- tests/scenarios/board-watch.test.ts: 43 [fixture]
- tests/scenarios/candidate-withdraw.test.ts: 385 [callback of test]
- tests/scenarios/context-pack.test.ts: 48 [callback of test], 106 [callback of test], 198 [callback of test]
- tests/scenarios/evidence-id.test.ts: 26 [tempDir]
- tests/scenarios/manifest-lock.test.ts: 29 [tempDir]
- tests/scenarios/mutants-review.test.ts: 178 [callback of withSetup], 191 [callback of withSetup], 280 [callback of withSetup], 296 [callback of withSetup]
- tests/scenarios/pre-existing.test.ts: 97 [callback of test]
- tests/scenarios/t1-plan.test.ts: 118 [callback of test]
- tests/surface/approver.test.ts: 34 [fixture]
- tests/surface/bench.test.ts: 29 [withTemp]
- tests/surface/bounds.test.ts: 42 [callback of test]
- tests/surface/card.test.ts: 167 [callback of test], 198 [callback of test], 454 [callback of test], 480 [callback of test]
- tests/surface/config.test.ts: 310 [callback of test], 349 [inCheckout]
- tests/surface/fix-task-clear.test.ts: 22 [repo]
- tests/surface/hook-git-prefetch.test.ts: 27 [withTemp]
- tests/surface/hook-lazy.test.ts: 34 [withTemp]
- tests/surface/hook-name.test.ts: 17 [tempDir]
- tests/surface/incident.test.ts: 52 [callback of test], 75 [callback of test], 92 [callback of test], 100 [callback of test]
- tests/surface/init-base-ci.test.ts: 27 [tempDir]
- tests/surface/init-no-package.test.ts: 31 [tempDir]
- tests/surface/lease-heartbeat.test.ts: 31 [withState]
- tests/surface/lesson-match.test.ts: 16 [withFile], 96 [repo], 218 [callback of test]
- tests/surface/lessons.test.ts: 16 [dir], 158 [repoAtClose]
- tests/surface/manifest.test.ts: 11 [callback of test], 36 [callback of test]
- tests/surface/mutants.test.ts: 67 [callback of before], 84 [repo], 169 [SYMLINK_OK (immediately invoked)], 928 [cliFixture]
- tests/surface/ops-intent.test.ts: 19 [repo]
- tests/surface/outcome-github.test.ts: 19 [tempDir]
- tests/surface/outcome-ingest.test.ts: 17 [tempDir]
- tests/surface/outcome-usage.test.ts: 21 [tempDir]
- tests/surface/ps-guard-read.test.ts: 27 [context]
- tests/surface/ps-guard-wire.test.ts: 26 [tempDir]
- tests/surface/r2-pass-notes.test.ts: 33 [readAnswer]
- tests/surface/readme.test.ts: 60 [callback of test]
- tests/surface/review-bench-export.test.ts: 60 [repo]
- tests/surface/review-bench.test.ts: 42 [fixture], 148 [callback of test], 158 [callback of test], 425 [callback of test], 774 [callback of test]
- tests/surface/reviewer-env.child.ts: 22 [tempDir]
- tests/surface/reviewer-env.test.ts: 16 [tempDir]
- tests/surface/security-check.test.ts: 20 [callback of test]
- tests/surface/stats.test.ts: 451 [callback of test], 578 [callback of test]

Lines move by -1, 0 or +1 against 3d3e9d31, from the import lines removed (`node:os`, and `path` in readme.test.ts) and the helpers import line added.
`callback of <name>` is a function passed to that call; `SYMLINK_OK (immediately invoked)` is the module-scope IIFE the sweep field calls [module scope].

### Revert table for the final scan (each row an actual run with one change, restored from a copy in memory after each; `git diff --stat HEAD` empty at the end)
| Reverted or mutated | Run on | Test run | Result | |
|---|---|---|---|---|
| S1 named and aliased imports not bound | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/named.ts:3 [named] call of mkdtempSync'; - 'tests/forms/aliased.ts:2 [aliased] call of mkdtempSync'; - 'tests/forms/fs-promises.ts:2 [module scope] call of mkdtemp'; and 10 more | red |
| S2 an aliased import bound by its local name | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/aliased.ts:2 [aliased] call of mkdtempSync'; - 'tests/forms/default-specifier.ts:2 [module scope] call of mkdtempSync' | red |
| S3 namespace import not an fs object | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/namespace.ts:2 [module scope] call of mkdtempSync'; - 'tests/forms/destructure-rename.ts:3 [renamed] call of mkdtempSync'; - 'tests/forms/fs-promises-namespace.ts:2 [module scope] call of mkdtemp'; and 1 more | red |
| S4 default import not an fs object | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/default.ts:3 [callback of test] call of mkdtempSync'; - 'tests/forms/promises.ts:3 [viaPromises] call of mkdtemp'; - 'tests/forms/destructure.ts:3 [module scope] call of mkdtempSync'; and 11 more | red |
| S5 fs.promises not followed | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/promises.ts:3 [viaPromises] call of mkdtemp' | red |
| S6 fs/promises modules not listed | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/fs-promises.ts:2 [module scope] call of mkdtemp'; - 'tests/forms/fs-promises-namespace.ts:2 [module scope] call of mkdtemp' | red |
| S7 destructuring from an fs object not bound | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/destructure.ts:3 [module scope] call of mkdtempSync'; - 'tests/forms/destructure-rename.ts:3 [renamed] call of mkdtempSync'; - 'tests/forms/require-destructure.ts:3 [viaRequire] call of mkdtempSync'; and 4 more | red |
| S8 element access not read | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/element.ts:2 [module scope] call of mkdtempSync'; - 'tests/forms/default-element.ts:2 [module scope] call of mkdtempSync' | red |
| S9 require not an fs object | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/require.ts:1 [module scope] call of mkdtempSync'; - 'tests/forms/require-destructure.ts:3 [viaRequire] call of mkdtempSync'; - 'tests/forms/require-variable.ts:2 [module scope] call of mkdtempSync'; and 1 more | red |
| S10 mkdtempDisposableSync not a target | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/disposable.ts:2 [module scope] call of mkdtempDisposableSync' | red |
| S11 an uncalled reference not reported | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/reference.ts:2 [module scope] reference of mkdtempSync'; - 'tests/forms/binding-default.ts:2 [module scope] reference of mkdtempSync'; - 'tests/infra/helpers.ts:3 [tmpDir] reference of mkdtempSync'; and 1 more | red |
| S12 exemption by function name in any file | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/elsewhere.ts:3 [tmpDir] call of mkdtempSync' | red |
| S13 exemption by any enclosing function, not the nearest | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/infra/helpers.ts:4 [inner] call of mkdtempSync'; - 'tests/surface/command-lines.test.ts:3 [tempDir] call of mkdtempSync' | red |
| S14 no exemption | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/infra/helpers.ts:3 [tmpDir] call of mkdtempSync'; + 'tests/surface/evals.test.ts:3 [tempDir] call of mkdtempSync'; + 'tests/surface/command-lines.test.ts:3 [tempDir] call of mkdtempSync'; and 3 more | red |
| S15 any identifier with a target name is a target (local function) | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/aliased.ts:2 [aliased] call of mkdtempSync'; - 'tests/forms/destructure-rename.ts:3 [renamed] call of mkdtempSync'; + 'tests/forms/local.ts:2 [module scope] call of mkdtempSync'; and 4 more | red |
| S16 a text scan instead of the AST (strings and comments) | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/forms/named.ts:3 [module scope] call of mkdtempSync'; - 'tests/forms/named.ts:3 [named] call of mkdtempSync'; - 'tests/forms/aliased.ts:2 [aliased] call of mkdtempSync'; and 35 more | red |
| S17 enclosing function not named | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/forms/named.ts:3 [module scope] call of mkdtempSync'; + 'tests/forms/aliased.ts:2 [module scope] call of mkdtempSync'; - 'tests/forms/named.ts:3 [named] call of mkdtempSync'; and 21 more | red |
| S18 line counted from 0 | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/forms/named.ts:2 [named] call of mkdtempSync'; + 'tests/forms/aliased.ts:1 [aliased] call of mkdtempSync'; + 'tests/forms/namespace.ts:1 [module scope] call of mkdtempSync'; and 77 more | red |
| S19 acceptance 1 with no exemption (the four helpers reported) | d554af8b | acceptance 1 | exit 1, fail 1: + 'tests/infra/helpers.ts:18 [tmpDir] call of mkdtempSync'; + 'tests/surface/command-lines.test.ts:18 [tempDir] call of mkdtempSync'; + 'tests/surface/eval-test-temp.test.ts:16 [inTemp] call of mkdtempSync'; and 1 more | red |
| P1 the binding default not read | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/binding-default.ts:2 [module scope] reference of mkdtempSync' | red |
| P2 computed names not resolved | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/computed.ts:3 [module scope] call of mkdtempSync' | red |
| P3 nested patterns not followed | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/nested.ts:4 [nested] call of mkdtemp'; - 'tests/forms/nested-default.ts:2 [module scope] call of mkdtempSync' | red |
| P4 the dynamic import not read | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/dynamic.ts:2 [module scope] call of mkdtempSync'; - 'tests/forms/default-pattern.ts:2 [module scope] call of mkdtempSync'; - 'tests/forms/default-property.ts:1 [module scope] call of mkdtempSync'; and 1 more | red |
| P5 `called &&` removed from the exemption | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/infra/helpers.ts:3 [tmpDir] reference of mkdtempSync' | red |
| P6 `fn.parent === sf` removed from the exemption | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/surface/command-lines.test.ts:3 [tempDir] call of mkdtempSync' | red |
| B1 the compiler line count in place of the line-feed count | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/forms/separators.ts:5 [module scope] call of mkdtempSync'; - 'tests/forms/separators.ts:3 [module scope] call of mkdtempSync' | red |
| B2 the immediately invoked function named module scope | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/forms/iife.ts:3 [module scope] call of mkdtempSync'; - 'tests/forms/iife.ts:3 [probe (immediately invoked)] call of mkdtempSync' | red |
| D1 skipOuterExpressions removed at the object of a property access | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/non-null.ts:2 [module scope] call of mkdtempSync'; - 'tests/forms/as.ts:2 [module scope] call of mkdtempSync'; - 'tests/forms/angle.ts:2 [module scope] call of mkdtempSync'; and 1 more | red |
| D2 skipOuterExpressions removed at a callee (replaces P7, parentheses not looked through) | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/surface/evals.test.ts:3 [tempDir] reference of mkdtempSync'; + 'tests/surface/eval-test-temp.test.ts:3 [inTemp] reference of mkdtempSync' | red |
| D3 skipOuterExpressions removed at an initializer | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/wrapped-initializer.ts:2 [module scope] call of mkdtempSync' | red |
| D4 default not the module at the import specifier | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/default-specifier.ts:2 [module scope] call of mkdtempSync' | red |
| D5 default not the module in a binding pattern | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/default-pattern.ts:2 [module scope] call of mkdtempSync' | red |
| D6 default not the module as a property | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/default-property.ts:1 [module scope] call of mkdtempSync'; - 'tests/forms/default-element.ts:2 [module scope] call of mkdtempSync' | red |
| D7 the import-equals form not bound | d554af8b | acceptance 2 | exit 1, fail 1: - 'tests/forms/import-equals.ts:2 [module scope] call of mkdtempSync' | red |
| D8 type positions not skipped | d554af8b | acceptance 2 | exit 1, fail 1: + 'tests/forms/type-only.ts:2 [module scope] reference of mkdtempSync'; + 'tests/forms/type-position.ts:2 [module scope] reference of mkdtempSync' | red |
| R1: tests/surface/review-bench.test.ts:158 back to `mkdtempSync(path.join(dir, 'bad-'))` | 928b23c9 | acceptance 1 | exit 1, fail 1, names `tests/surface/review-bench.test.ts:158 [callback of test]` | red |
| R1: tests/surface/reviewer-env.child.ts as at 3d3e9d31 | 928b23c9 | acceptance 1 | exit 1, fail 1, names `tests/surface/reviewer-env.child.ts:22 [tempDir]` | red |
| R1: tests/surface/review-bench.test.ts as at 3d3e9d31 | 928b23c9 | acceptance 1 | exit 1, fail 1, names its 5 sites | red |
| R1: all 47 files as at 3d3e9d31 | 928b23c9 | acceptance 1 | exit 1, fail 1, `85 sites outside the four helpers` | red |
| R1 imports: an unused `import { tmpdir } from 'node:os'` left in tests/surface/stats.test.ts | 928b23c9 | `npm run typecheck` | exit 2, TS6133 'tmpdir' is declared but its value is never read | red |

Rows red: 40/40. S1-S19: the single mutations of the scan (first run on 928b23c9), with their text updated to the code of d554af8b. P1-P6: the reverts of the rulings after the pre-review of 0b22f3d1 (first run on af94e449); P7 (parentheses not looked through) is replaced by D2, since the callee is now read through the outer-expression function, and P8 (type-only imports not excluded) left the table with the exclusion it reverted, by the rulings during the repair after R3 decision 1. B1-B2: the rows of the rulings after the build report (first run on 61a51d81). D1-D8: the reverts of the rulings after R3 decision 1 (`skipOuterExpressions` in their labels is the local outer-expression function). The R1 reverts of the migration and the unused-import row ran on 928b23c9; the 47 files and their imports have not changed since 733a8434. The `finally` order of tests/infra/exec.test.ts (processes ended before `rmSync` of their directory, the `finally` blocks at :682, :763, :993, :1020) has no revert row: no test observes that order, and 733a8434 changes only the `mkdtempSync` line of each of those tests (`git diff 3d3e9d31 733a8434 -- tests/infra/exec.test.ts`: 6 lines, the import and the 5 sites).

### Acceptance 3
`git diff -U0 3d3e9d31 733a8434`, every changed line outside tests/surface/test-temp.test.ts is an import line or a site line (checked by filtering the diff: no other `+`/`-` line). No assertion, test name or test call changes, so no test count changes.

### DoD (actual runs, the card's `dod_command` from the worktree root)
- 61a51d81 (final test code): `npm run typecheck` exit 0, then `node --test` over the 48 files: tests 1013, suites 81, pass 1004, fail 0, cancelled 0, skipped 9, exit 0.
- 733a8434, a2b45c16 and 928b23c9: the same counts, exit 0. The two ruling rows are inside the existing acceptance 2 test, so the test count stays 1013.
- Temporary directory (`os.tmpdir()`, entries starting `aidlc-`), each run: 72480 before, 72480 after, 0 new and 0 gone entries (`comm` of the two listings); no `could not remove` line in either output.

### Full suite, R3 / acceptance 4 (733a8434, actual run, `npm test`, nothing else started beside it)
tests 3462, suites 247, pass 3440, fail 0, cancelled 0, skipped 22, duration_ms 380702, exit 0. No file failed, so no file was rerun alone. Raw output kept by the implementer outside the repository (4019 lines). This full run of R3 was on 733a8434, before the two scan commits (a2b45c16, 928b23c9), the merge of main (cc2a1aa3) and the two rows (61a51d81); it was not rerun. Changed since 733a8434: tests/surface/test-temp.test.ts, this card, and main's files of the merge (.claude/skills/verify-card-run-writes/SKILL.md, CHANGELOG.md, docs/ARCHITECTURE.md, docs/LESSONS.md, docs/OPERATIONS.md, specs/tasks/T0-ATTEMPT-NUMBER.md, specs/tasks/T0-AUDIT-BINDING.md, src/core/effort.ts, src/loop/card-runner.ts, tests/core/effort.test.ts, tests/scenarios/dispute-running-attempt.test.ts). The DoD on 61a51d81 runs tests/surface/test-temp.test.ts.

### Repair round after the pre-review of 0b22f3d1
Commits: 869c7e76 (merge of origin/main at 99fbde2d; conflict in this card only, main's rulings placed above this section), 290cffcc (RED: nine rows), c51ad6fd (GREEN: the scan), af94e449 (the nested-helper row corrected, below), then this evidence commit, which changes only this card. R1 and the 47 files are unchanged in this round.

The table test now writes each row in a directory of its own and compares the reports in row order, so a helper's file can appear in more than one row; the expectations of the earlier rows are unchanged.

RED (290cffcc, actual run, `node --test tests/surface/test-temp.test.ts`: acceptance 1 pass, acceptance 2 fail):

| Row | Red before the fix |
|---|---|
| binding default `const { make = mkdtempSync } = {}` | yes: no report |
| computed binding name `const { ['mkdtempSync']: make } = fs`, call of `make` | yes: no report |
| nested binding name `const { promises: { mkdtemp: make } } = fs`, call of `make` | yes: no report |
| `const fs = await import('node:fs')`, then `fs.mkdtempSync('x')` | yes: no report |
| a reference stored inside `tmpDir` of helpers.ts | no: reported already |
| a function nested in `tempDir` of command-lines.test.ts bearing the name `tempDir` | no: reported already (see the correction below) |
| `(mkdtempSync)(prefix)` directly in `tempDir` of evals.test.ts, not reported | yes: reported as a reference |
| `mkdtempSync!(prefix)` directly in `inTemp` of eval-test-temp.test.ts, not reported | yes: reported as a reference |
| `import type { mkdtempSync } from 'node:fs'; type F = typeof mkdtempSync`, not reported | yes: reported as a reference |

GREEN (c51ad6fd): a binding element's initializer is read (only its name and property name declare); destructuring of an fs object resolves a computed name given as a string and follows a nested pattern under `promises`; `await import('<fs module>')` is an fs object as `require` is; parentheses and non-null assertions around a callee are looked through; a type-only import declaration or specifier binds nothing. No data flow and no scope analysis were added (the non-goals).

Correction (af94e449): the RED commit named the nested function `tmpDir`, which is not the helper allowed at command-lines.test.ts, so the revert of `fn.parent === sf` left the table green (actual run on c51ad6fd: exit 0, fail 0). The row now names it `tempDir`, the helper of that file; the revert below is red.

Reverts: the reverts of these rulings are rows P1-P6 of the revert table for the final scan above (P7 and P8 left it; see that table).

The 85 pairs (c51ad6fd, actual run): a scratch copy of `tests/` and `src/` at c51ad6fd under the gitignored `_local/`, with the 47 files restored to 3d3e9d31, gives 85 sites in acceptance 1, the same 85 file and line pairs as the `git grep` sweep and the same report lines as the scan of 928b23c9. Acceptance 1 passes on the real tree.

DoD (af94e449, actual run, the card's `dod_command`): `npm run typecheck` exit 0, then tests 1013, suites 81, pass 1004, fail 0, cancelled 0, skipped 9, exit 0. Temporary directory (`aidlc-*`): 69479 before, 69290 after; 0 new entries, 189 gone, which the DoD does not remove (another process cleaned the temporary directory during the run).

Full suite: not run in this round; the coordinator runs it on the final head.

### Repair after R3 decision 1
Commits: bf2a0d91 (merge of origin/main at bf5c5909), d08846a3 (RED), 155cfcc9 (GREEN and two rows for contract lines), 4a9aa4e0 (a row for an initializer under an assertion), 9c21f6d6 (merge of origin/main at ce4d4054), d554af8b (the rulings during the repair: the local outer-expression function, the type-only exclusion removed), then this evidence commit, which changes only this card. Every merge conflicted in this card only. The 47 files of R1 are unchanged.

RED (d08846a3, actual run): acceptance 1 pass, acceptance 2 fail. Rows of the rulings and whether each failed before the fix:

| Row | Red before |
|---|---|
| `fs!.mkdtempSync(...)` | yes |
| `(fs as typeof fs).mkdtempSync(...)` | yes |
| `(<typeof fs>fs).mkdtempSync(...)` | yes |
| `(fs satisfies typeof fs).mkdtempSync(...)` | yes |
| `fs?.mkdtempSync(...)` | no |
| `import { default as fs } from 'node:fs'` | yes |
| `const { default: fs } = await import('node:fs')` | yes |
| `(await import('node:fs')).default.mkdtempSync(...)` | yes |
| `import fs = require('node:fs')` | no |
| a value import used only in `typeof` of a type alias, not reported | yes (reported as a reference) |

Rows added for lines of the closed contract that had none, and whether each failed on the scan of d08846a3 (the last three measured on a scratch copy that runs the scan of d08846a3 against the final rows):

| Contract line | Row | Red before |
|---|---|---|
| a variable initialized with `require(m)` | `const fs = require('node:fs')` | no |
| a variable initialized with another name so bound | `const other = fs` | no |
| the module `fs/promises` | `import * as fsp from 'fs/promises'` | no |
| a binding pattern nested under `default` | `const { default: { mkdtempSync: make } } = await import('node:fs')` | yes |
| a binding pattern with a default value | `const { mkdtempSync: make = fallback } = fs` | no |
| a runtime reference to an access that is not the callee of a call | `const make = fs.mkdtempSync` | no |
| `['default']` on an fs module object | `ns['default'].mkdtempSync(...)` | yes |
| the outer-expression step at an initializer (the ruled revert needs a row to fail) | `const fs = require('node:fs') as typeof import('node:fs')` | yes |

GREEN (155cfcc9, then d554af8b): a local function removes parentheses, `as`, angle-bracket and non-null assertions and `satisfies` through `ts.isParenthesizedExpression`, `ts.isAsExpression`, `ts.isTypeAssertionExpression`, `ts.isNonNullExpression` and `ts.isSatisfiesExpression`, at the object of a property or element access, at the operand of `await`, at an initializer and at a callee; `default` of an fs module object is the module at the import specifier, in a binding pattern (also nested) and as `.default` or `['default']`; `import x = require(m)` binds the module, as before; an identifier for which `ts.isPartOfTypeNode` is true, or inside a type query, is skipped. The exclusion of type-only imports is removed (redundant with the type-position rule, by the rulings during the repair). 155cfcc9 called `ts.skipOuterExpressions` through a cast; d554af8b replaces it.

Public API: every `ts.` name the scan uses at d554af8b is declared in node_modules/typescript/lib/typescript.d.ts (checked name by name). The remaining `as` casts narrow to public types only: `fn as ts.Expression`, `node as ts.PropertyAccessExpression | ts.ElementAccessExpression` (three, after `memberName` has matched one of the two), `fn as ts.SignatureDeclaration`, and `readdirSync(...) as string[]`.

The 85 pairs (d554af8b, actual run): on a scratch copy of `tests/` and `src/` under the gitignored `_local/`, with the 47 files at 3d3e9d31, acceptance 1 reports 85 sites with the same file and line pairs as the `git grep` sweep and the same report lines as the scan of 928b23c9. Acceptance 1 passes on the real tree.

DoD (d554af8b, actual run, the card's `dod_command`): `npm run typecheck` exit 0, then tests 1013, suites 81, pass 1004, fail 0, cancelled 0, skipped 9, exit 0. Temporary directory (`aidlc-*`): 69290 before, 69290 after, 0 new and 0 gone entries; no `could not remove` line in the output.

Reverts: the table for the final scan above (40/40, the scan rows on d554af8b).

### Size
`git diff --shortstat origin/main...HEAD` at af94e449 (origin/main 99fbde2d): 49 files changed, 472 insertions(+), 181 deletions(-), 653 lines before this evidence update; the total with it is given in the report, against the budget of 780 (attempt evidence counted).

## Planner rulings on the points disclosed in the repair rounds (coordinator, before R3)

The points of the first build report are ruled in the section "Planner rulings of 2026-11-12 after the build report". These are the points the implementer disclosed in the repair rounds after it; none is an edit the card forbids.

| Disclosed point | Ruling |
|---|---|
| The table test writes each row to a directory of its own and compares the reports in row order, so that the file of an allowed helper can appear in more than one row; the expected results of the earlier rows are unchanged | Accepted. The rows on a stored reference and on a nested function need a file at a helper's path each |
| One of the implementer's own new rows named its nested function `tmpDir` where the helper allowed in tests/surface/command-lines.test.ts is `tempDir`, so the revert of `fn.parent === sf` first stayed green; a later commit corrects the name and the revert is red | Accepted. A correction of a new row before any review, found by running the revert |
| The 19 mutations of the first round were written against the scan as it was then; they were run again against the final scan, two with their text updated to the code that replaced what they changed | Accepted. The one revert table of the evidence names the commit each group ran on |
| The merge commits of main into the branch carry messages amended once before anything was built on them | Noted. They were unpushed, and the ship squashes them |
| The count of `aidlc-*` entries in the system temporary directory fell by 189 during one DoD run while this card's run added and removed none | Noted. Another process removed entries; the card's own figure is 0 new entries per DoD run |

## The full suite on the candidate (acceptance 4, coordinator)

R3 and acceptance 4 ask for one `npm test` on the candidate with exit 0 before the first review.

| Run | Commit | Tests | Pass | Fail | Skipped | Exit |
|---|---|---|---|---|---|---|
| implementer, 2026-11-12 | 733a8434 (the migration, before the later scan commits) | 3462 | 3440 | 0 | 22 | 0 |
| coordinator, 2026-11-12T04:26Z | 0b22f3d1 (the head the pre-review read) | 3476 | 3454 | 0 | 22 | 0 |
| coordinator, 2026-11-12T04:45Z | a82d8f18 (the final test code, with main merged at 99fbde2d) | 3476 | 3454 | 0 | 22 | 0 |

The last run took 370 s with nothing else running on the machine; no file failed, so none was run again alone. The commits after a82d8f18 change this card file only (this section and the coordinator's Linux and document-reader runs below). The raw output of each run is kept in the coordinator's scratchpad (`sweep-npm-test.txt`, `sweep-npm-test-final.txt`, `sweep-npm-test-final2.txt`); its last lines are the counts above.

Coordinator verification:
- At 523ae7c6, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/core/ci-policy.test.ts, tests/core/journal-event-types.test.ts, tests/infra/base-sync.test.ts, tests/infra/exec.test.ts, tests/infra/git.test.ts, tests/infra/github-ship-merge-refused.test.ts, tests/infra/github-ship.test.ts, tests/infra/init.test.ts, tests/scenarios/board-watch.test.ts, tests/scenarios/candidate-withdraw.test.ts, tests/scenarios/context-pack.test.ts, tests/scenarios/evidence-id.test.ts, tests/scenarios/manifest-lock.test.ts, tests/scenarios/mutants-review.test.ts, tests/scenarios/pre-existing.test.ts, tests/scenarios/t1-plan.test.ts, tests/surface/approver.test.ts, tests/surface/bench.test.ts, tests/surface/bounds.test.ts, tests/surface/card.test.ts, tests/surface/config.test.ts, tests/surface/fix-task-clear.test.ts, tests/surface/hook-git-prefetch.test.ts, tests/surface/hook-lazy.test.ts, tests/surface/hook-name.test.ts, tests/surface/incident.test.ts, tests/surface/init-base-ci.test.ts, tests/surface/init-no-package.test.ts, tests/surface/lease-heartbeat.test.ts, tests/surface/lesson-match.test.ts, tests/surface/lessons.test.ts, tests/surface/manifest.test.ts, tests/surface/mutants.test.ts, tests/surface/ops-intent.test.ts, tests/surface/outcome-github.test.ts, tests/surface/outcome-ingest.test.ts, tests/surface/outcome-usage.test.ts, tests/surface/ps-guard-read.test.ts, tests/surface/ps-guard-wire.test.ts, tests/surface/r2-pass-notes.test.ts, tests/surface/readme.test.ts, tests/surface/review-bench-export.test.ts, tests/surface/review-bench.test.ts, tests/surface/reviewer-env.test.ts, tests/surface/security-check.test.ts, tests/surface/stats.test.ts, tests/surface/test-temp.test.ts): tests 1000, pass 989, fail 0, skipped 11.
- Windows, docpins: no document changed
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.
