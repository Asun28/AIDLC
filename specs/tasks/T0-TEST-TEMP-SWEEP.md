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
  - R2. (restated 2026-11-12, body section Planner ruling: the scan by name) `tests/surface/test-temp.test.ts` shall parse every `.ts` file under tests/ with the TypeScript compiler API (`ts.createSourceFile`, public API only, no type checker) and report every occurrence in code of one of the three names `mkdtempSync`, `mkdtemp` and `mkdtempDisposableSync` as (a) an identifier in any position (an expression, a property or member name, a binding or parameter name, an import or export specifier, a type position), compared by its text after escapes, or (b) a string literal or a template literal without substitutions whose whole text is one of the names, unless the occurrence is exempt; a private name counts by its text without the `#`. Exempt are only: an occurrence whose nearest enclosing function is one of four functions declared at the top level of their files, `tmpDir` of tests/infra/helpers.ts, `tempDir` of tests/surface/evals.test.ts, `tempDir` of tests/surface/command-lines.test.ts (each records its directory at creation and removes it in an `after` hook, card T0-EVAL-TEST-TEMP, whose acceptance 3 requires the one `mkdtempSync(` of evals.test.ts) and `inTemp` of tests/surface/eval-test-temp.test.ts (it removes its directory in a `finally`); and, in those four files, the specifier of the name in an import declaration at the top level. The scan does not resolve what a name refers to: one of the three names is reported whatever it is bound to, so no way of reaching the fs function that writes its name passes, and code that uses such a name for something else is reported as well and takes another name. A function nested inside an allowed helper is not exempt, and a function of the same name in another file is not exempt. Text in comments, a string that holds a name among other characters, and a template literal with a substitution are not occurrences. The check's own file holds no occurrence: it builds the three names from parts. Each report names the file, the line counted by line feeds, and the nearest enclosing function: its own name, which is the name node of a function declaration or of a named function expression, and for a method or accessor the text of an identifier, a private name with its `#`, a string or numeric literal, or a computed name whose expression is such a literal (a computed name of any other expression is no name); `<constant> (immediately invoked)` for a function expression or arrow function without a name of its own that is, with no wrapper between other than the one pair of parentheses the call needs, the callee of the call that initializes a variable declared with `const` (not `let`, `var`, `using` or `await using`) under a plain name, not a binding pattern; `<anonymous>` for every other function without a name of its own, a function or arrow function assigned to a variable or a property and a function declaration without a name (`export default function () {}`) included, since no name is inferred; `module scope` outside any function.
  - R3. The full suite shall pass once on the candidate (`npm test`, exit 0) before the first review, since the DoD runs the changed files but the migration touches 47 of them.
acceptance:
  - 1. `tests/surface/test-temp.test.ts` "no mkdtemp call of tests/ lies outside a helper that registers its removal" passes; on main (after T0-TEST-TEMP-CLEANUP) it fails, naming the 85 sites the sweep lists with file, line and function. [R1] [R2] [dod arm 1]
  - 2. Same file, "the scan reports every occurrence of the three names" (a table test of the scan function over source texts written in directories from `tmpDir`, each row with the expected file, line and enclosing function). Reported: a call through a named import and the import specifier itself; an aliased import specifier; `fs.mkdtempSync(...)` on a namespace, a default import and a `require`; `fs.promises.mkdtemp`; an import from `node:fs/promises`; a binding pattern with and without a rename; `fs['mkdtempSync']` and the same with a template literal without substitutions; `mkdtempDisposableSync`; an uncalled reference; the name behind expression wrappers (`fs!.mkdtempSync`, `(fs as any).mkdtempSync`, `(require)('node:fs').mkdtempSync`, `(await (import('node:fs'))).mkdtempSync`); a name written with an escape, as an identifier and as a string; a local function declared with one of the names; a member name in an interface and in an object literal; a type query `typeof mkdtempSync`; an occurrence in a function nested inside an allowed helper; a function named like an allowed helper in another file; an occurrence inside the arguments of another reported expression (both reported); an occurrence after a string holding U+2028 and U+2029, at the line-feed line; the immediately invoked form with its function name, and the same behind a wrapper as `<anonymous>`. Not reported: each of the four helpers at its file (its import specifier and the occurrences directly inside the function); a comment holding a name; a string that holds a name among other characters (`'mkdtempSync('`); a template literal with a substitution. Rows added by the rulings after the pre-review of the scan by name: a private name (`#mkdtempSync`, also written with an escape) is reported; the name of a function expression inside an allowed helper (`const f = function mkdtempSync() {}`) is reported; in a helper file, a function of the helper's name nested in another function, a module-scope binding pattern (`const { mkdtempSync } = fs`) and an export specifier (`export { mkdtempSync }`) are each reported; an occurrence inside a method with a private name, with a string-literal computed name and with a numeric name is reported with that method's name. Rows added by the rulings after the fourth pre-review: an occurrence inside a method whose computed name is an identifier (`[key]() { ... }`), inside an arrow function assigned to a constant (`const f = () => ...`) and inside the immediately invoked initializer of an `await using` declaration is reported under `<anonymous>`. Rows added by the rulings after the fifth pre-review: an occurrence inside `export default function () { ... }` and inside the immediately invoked initializer of a binding pattern (`const { x } = (() => { ... })()`) is reported under `<anonymous>`, and the scan throws for no source text that parses. [R2] [dod arm 1]
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
  - a name built at run time (a concatenation, a template literal with a substitution, a decoded or computed string): it can only be written to get around the check
  - telling the fs function from another thing that bears one of the three names: the check reports both, and the other thing takes another name
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

## Planner ruling of 2026-11-12: the scan by name

History. The scan was first written to resolve what a callee refers to: how a name is bound to the fs module, how a name is bound to one of the three functions, and which accesses reach them. A first pre-review found forms it missed; R3 decision 1 blocked on three more; the planner then stated the scan's contract as a closed list of binding forms; and a second pre-review, measuring the scan against that list, found four more combinations (a wrapped `require` callee, a wrapped operand of `await`, member names in type and object syntax reported as references, a nested call hidden by an outer match) and two smaller points. Each round the list grew and the next round found its combinations. A syntactic scan that follows bindings is not finished by adding cases.

Ruling. R2 is restated: the scan does not resolve anything. It reports every occurrence in code of one of the three names, as an identifier in any position or as a string or substitution-free template literal that is exactly the name, outside the four allowed functions and the import specifiers of their files. The fs function cannot be reached without writing its name, unless the name is built at run time, which is a non-goal because nobody does that by accident. What the earlier contract tried to rule in or out case by case (wrappers, default bindings, `require` and dynamic import forms, aliases, re-exports, nesting, type positions) is all one case under this rule: the name is there or it is not. The price is stated in R2: something else that bears one of these names is reported too. On the tree after the migration the rule reports nothing: the only occurrences are the import specifier and the one call in each of the four helper files (the planner checked with `git grep`; tests/ holds `.ts` files only).

What this supersedes. The contract paragraph and the rows of "Planner rulings of 2026-11-12 after R3 decision 1", the rows of "after the pre-review of 0b22f3d1" and the two rulings "during the repair after R3 decision 1" are history: R2 and acceptance 2 as restated are the specification. The two rows of the first rulings (the line-feed line, the immediately invoked form) stay. R1, acceptance 1, 3 and 4 and the migration are untouched.

For the implementer. The scan becomes smaller: one walk over every node of each file; an identifier whose text is one of the names, or a string or substitution-free template literal equal to one, is an occurrence; the exemption is decided from the nearest enclosing function and, for import specifiers, from the file. The binding tables and the resolution code go. The three names are built from parts in the check's own file, and a row of the table asserts that the scan reports nothing for that file. Reverts that must each fail a row: identifiers in type positions skipped; property names skipped; binding names skipped; import specifiers reported in a helper file; import specifiers not reported in another file; string literals not read; substitution-free templates not read; text compared before escapes; the exemption widened to any ancestor function; the exemption widened to a function of the same name in another file; a comment read as code; a string holding a name among other characters reported; line counting by the compiler's line map; the immediately invoked naming.

## Planner rulings of 2026-11-12 after the pre-review of the scan by name

A Codex pre-review of the scan by name, asked to find any way of writing one of the three names in code without a report, found no way of reaching the fs function unreported and four smaller points. All four are accepted:

| Point | Ruling |
|---|---|
| A private name `#mkdtempSync` gives no report: it is a private identifier, not an identifier | R2 says a name of these three is reported whatever it is bound to. A private name counts by its text without the `#`, escapes resolved. Rows |
| Inside an allowed helper, the name of a function expression (`const f = function mkdtempSync() {}`) gives no report: it took the scope around it, as the name of a declaration does | The name of a function expression is bound inside that function, so its nearest enclosing function is itself, which is a nested function and not exempt. Only the name of a function declaration belongs to the scope around it. Row |
| An occurrence inside a method with a private name, a string-literal computed name or a numeric name is reported under `<anonymous>` | The enclosing function's name is the text of its name node in each of these forms; R2 says so now. Rows |
| Three changes to the exemption leave every row green: dropping the top-level requirement, exempting every module-scope occurrence of a helper file, exempting export specifiers there | Three rows, each in a helper file: a function of the helper's name nested in another function; a module-scope binding pattern; an export specifier. Each is reported |

Reverts that must each fail its row: private names not read; the name of a function expression given the scope around it; each of the three method-name forms reported as `<anonymous>` (one run or three); the top-level requirement dropped; module-scope occurrences of a helper file exempt; export specifiers exempt.

## Planner rulings of 2026-11-12 after the fourth pre-review

The fourth Codex pre-review found no missing occurrence and no exemption beyond R2, with all 37 rows passing and the eight new reverts failing their rows. Its three points are on the label of the enclosing function in a report, which decides nothing about what is reported. All three are accepted, and R2 now states the label exactly:

| Point | Ruling |
|---|---|
| A method with a computed name that is an identifier (`[key]() {}`) is reported under `key` | A computed name counts only when its expression is a string or numeric literal; otherwise the method has no name and the label is `<anonymous>`. Row |
| The immediately invoked initializer of an `await using` declaration is labelled `<name> (immediately invoked)`, because the declaration flags of `await using` contain the bit of `const` | The form is given for `const` only: the declaration kind is compared exactly, after masking to the block-scoped kinds. Row |
| `const f = () => ...` is reported under `f`, an inferred name R2 does not list, and no row covers it | No name is inferred. A function or arrow function assigned to a variable or a property is `<anonymous>` unless it is the immediately invoked form. The inference is removed. Row |

Reverts that must each fail its row: a computed name of any expression taken as the name; the declaration kind tested by its `const` bit; the name of the variable inferred for an assigned function.

## Planner rulings of 2026-11-12 after the fifth pre-review

The fifth Codex pre-review found every other function label as R2 gives it (constructors `<anonymous>`, a static block under the function around it or `module scope`), all 40 rows passing, all 25 scan mutations failing, no missing occurrence, no excess exemption, no private API and no report for the check's own file. One block and one risk, both accepted:

| Point | Ruling |
|---|---|
| `export default function () { return 'mkdtempSync'; }` makes the scan throw a `TypeError`: the label code looks for the call around a function whose parent is the source file | A defect: the scan must report, never throw, for any source that parses. The immediately invoked form is looked for only on a function expression or arrow function, after its own name was checked; a function declaration without a name is `<anonymous>`. Row, and the revert is the old order |
| The immediately invoked initializer of a binding pattern (`const { x } = (() => { ... })()`) is `<anonymous>`, which R2 did not say | R2 says it now: the form needs a plain name. Row |

Reverts that must each fail its row: the immediately invoked check before the kind of the function is known (the default-export row throws or mislabels); a binding pattern accepted as the constant (the row then needs a name the pattern does not have: record what the revert does).
