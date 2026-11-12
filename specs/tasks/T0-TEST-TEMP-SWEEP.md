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
