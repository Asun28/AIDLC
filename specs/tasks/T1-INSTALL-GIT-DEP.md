---
id: T1-INSTALL-GIT-DEP
title: package.json builds dist/ in a prepare script in place of prepack, so a git install starts and npm pack builds once; scripts/install-smoke.ts installs the packed tarball and a git URL of the checkout into temporary directories and starts each installed CLI; and a ci.yml job runs it on ubuntu-latest and windows-latest on pushes only
status: todo
branch: T1-INSTALL-GIT-DEP
worktree: D:\wt\AIDLC\T1-INSTALL-GIT-DEP
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - package.json
  - scripts/install-smoke.ts
  - tests/surface/install-smoke.test.ts
  - .github/workflows/ci.yml
  - changelog.d/T1-INSTALL-GIT-DEP.md
  - specs/tasks/T1-INSTALL-GIT-DEP.md
dod_command: npm run typecheck && node --test tests/surface/install-smoke.test.ts tests/surface/bench.test.ts tests/surface/workflow-permissions.test.ts tests/surface/init-base-ci.test.ts tests/surface/review-bench.test.ts tests/infra/build-atomic.test.ts tests/core/config.test.ts tests/surface/ci-shard.test.ts tests/surface/changelog-fragments.test.ts && node scripts/install-smoke.ts
dod_exit: 0
requirements:
  - R1. The `scripts` object of `package.json` (:29-39) shall hold the entry `prepare` with the value `npm run build` in place of the entry `prepack` (:38), with every other key of the file as it is.
  - R2. `scripts/install-smoke.ts` (new) shall export `gitInstallSpec(checkout, sha, windows)`, which returns the text `git+`, the `file:` URL that `pathToFileURL` of node:url gives the absolute path `checkout` under the path rules `windows` selects, a hash sign and `sha`.
  - R3. The same file shall export `smoke(deps)`, with `deps` holding `checkout`, `version`, `runner` (a `SyncRunner` of src/probes/exec.ts), `tmpRoot` and `now`, which runs the six commands of acceptance detail 1 in that order, each as an argv call through `deps.runner` with `killTree` true and `timeoutMs` the whole milliseconds left to a deadline 420000 ms after its first `deps.now()` call, and returns `{ ok, lines }` with the two lines of acceptance detail 2.
  - R4. WHEN a step of an install fails by a rule of acceptance detail 2, `smoke` shall skip the later steps of that install, still run the other install, and return `ok` false; a step whose turn comes at or after the deadline is not started and fails with `deadline`.
  - R5. `smoke` shall create one directory with `mkdtempSync` under `deps.tmpRoot`, keep every file it writes inside it, and remove it before it returns or throws.
  - R6. WHEN the file is started as `node scripts/install-smoke.ts`, it shall call `smoke` with the repository root (the parent of `scripts/`), the `version` of `package.json`, `runSync`, `os.tmpdir()` and `Date.now`, print the two lines to stdout and set the exit code 0 when `ok` is true and 1 otherwise; importing the file runs nothing.
  - R7. `.github/workflows/ci.yml` shall gain the job `install-smoke` of acceptance detail 3 after the `bench` job (:43-53), with the condition `github.event_name == 'push'` so that it runs on pushes and is skipped on pull requests, and with every other job (`check`, `bench`, and `check-windows-shard` and `check-windows` of T1-CI-SHARD), the triggers (:3-13), the top-level `permissions` block (:15-16) and the top-level `concurrency` block of T1-CI-SHARD unchanged.
  - R8. The new changelog.d/T1-INSTALL-GIT-DEP.md shall hold the entry of acceptance detail 4 followed by one line feed.
acceptance:
  - 1. `tests/surface/install-smoke.test.ts` (new), "T1-INSTALL-GIT-DEP acceptance 1 gitInstallSpec gives a git+file URL with the commit for a Windows path and a POSIX path". The two rows of acceptance detail 1. Fails on main (no module; with the seam of the hygiene it fails by assertion). [R2] [dod arm 2]
  - 2. Same file, "T1-INSTALL-GIT-DEP acceptance 2 smoke runs the six commands in order with killTree and the time left and reports both installs ok". Scripted runner and a fixed clock; the recorded calls deep-equal the list of acceptance detail 1, and the result deep-equals `{ ok: true, lines: ['tarball: ok 0.2.0', 'git <sha>: ok 0.2.0'] }` with the scripted sha. Fails on main. [R3] [dod arm 2]
  - 3. Same file, "T1-INSTALL-GIT-DEP acceptance 3 each failing step gives one FAILED line, skips the rest of that install, leaves the other install running and makes ok false". One row per rule of acceptance detail 2. Fails on main. [R4] [dod arm 2]
  - 4. Same file, "T1-INSTALL-GIT-DEP acceptance 4 a step whose turn comes at or after the deadline is not started". A clock that passes 420000 ms after the pack call; the runner saw no call after it and both lines end `(deadline)`. Fails on main. [R3] [R4] [dod arm 2]
  - 5. Same file, "T1-INSTALL-GIT-DEP acceptance 5 the temporary directory is gone after a passing run, a failing run and a runner that throws". `tmpRoot` is a directory of the test; it is empty after each. Fails on main. [R5] [dod arm 2]
  - 6. Same file, "T1-INSTALL-GIT-DEP acceptance 6 package.json builds in prepare and has no prepack, and ci.yml runs the script on both runners on pushes only". `scripts.prepare` equals `npm run build`, `scripts` has no key `prepack`, and the `install-smoke` job, read by its name, has the shape of acceptance detail 3. Fails on main (no `prepare`, a `prepack`, no job). [R1] [R7] [dod arm 2]
  - 7. Same file, "T1-INSTALL-GIT-DEP acceptance 7 aidlc.config.json requires no install-smoke check". No entry of `github.requiredChecks` contains `install-smoke`; tests/core/config.test.ts, whose :10 and :38-40 pin the four required names, passes unchanged. Passes on main and with this card. [R7] [dod arm 2]
  - 8. `node scripts/install-smoke.ts`, run in the card worktree at the candidate commit, exits 0 and prints `tarball: ok <version>` and `git <sha>: ok <version>` with the candidate sha and the `version` of package.json (0.2.0 at 2ef2bbf4). The file does not exist on main. [R1] [R3] [R6] [dod arm 3]
  - 9. tests/surface/bench.test.ts (its :211-221 read the `bench` and `check` jobs and :233-236 the `check`, `test`, `typecheck` and `bench` scripts), tests/surface/workflow-permissions.test.ts (:152-161), tests/surface/init-base-ci.test.ts (:375-389), tests/surface/review-bench.test.ts (:417), tests/infra/build-atomic.test.ts (:62, :346 read `scripts.build`) and tests/surface/ci-shard.test.ts (card T1-CI-SHARD; it reads the `check`, `check-windows-shard` and `check-windows` jobs, the triggers, `permissions` and `concurrency`, and requires that no other job is named `check (windows-latest, 22)`) pass with no line changed; no test reads `prepack` or `prepare`. They pass on the base, main with T1-CI-SHARD, and with this card. [R1] [R7] [dod arm 2]
  - 10. changelog.d/T1-INSTALL-GIT-DEP.md holds the entry of acceptance detail 4 followed by one line feed (reviewer-verified against the diff), and tests/surface/changelog-fragments.test.ts passes with the new file. [R8] [dod arm 2]
depends_on: [T1-CI-SHARD, T1-CHANGELOG-FRAGMENTS]
budget: 200
tdd: true
sweep: "On main at 2ef2bbf4. `git grep -nE 'ci\\.yml|ubuntu-latest|windows-latest|macos' -- tests`, `git grep -nE 'prepack|prepare|package\\.json' -- tests bench bin scripts .github docs README.md CLAUDE.md` and `git grep -nE 'npm (ci|pack|run build)' -- .github`. `prepack` occurs once outside the cards, at package.json:38: no test, workflow, document, bin script or bench file names it, and none names a `prepare` script. Readers of ci.yml or of every workflow file: tests/surface/bench.test.ts:211-221 (a `bench` job on ubuntu-latest with `npm ci`, then `npm run build` before `npm run bench -- --check`, and a `check` job), tests/surface/workflow-permissions.test.ts:152-161 (no permission problem in any workflow, and `ciPermissionsExact` for ci.yml, which is false when a job has its own `permissions`), tests/surface/init-base-ci.test.ts:375-389 (no workflow holds the bare `npx aidlc`), tests/surface/review-bench.test.ts:417 (no workflow holds `review bench`). tests/core/config.test.ts:10 and :38-40 pin the four names of `github.requiredChecks` in aidlc.config.json, which this card does not edit. tests/infra/init.test.ts:168 and tests/surface/readme.test.ts:51 name `aidlc-ci.yml` inside doc sentences this card does not change; tests/core/ci-policy.test.ts and tests/infra/github-ship.test.ts use `check (ubuntu-latest, 22)` as fixture text only. Readers of package.json scripts: tests/infra/build-atomic.test.ts:62 and :346 (`build`), tests/surface/bench.test.ts:233-236. bin/resolve-entry.js:11-18 reads no package.json: it loads dist/cli/main.js when that file is at least as new as every `.ts` file under src/. Workflows that run `npm ci`, which runs `prepare` once this card merges: ci.yml:32 (`check`, then `npm test` at :34 and `npm run build` at :35) and :51 (`bench`, then `npm run build` at :52), aidlc-ci.yml:26 (`build-test`, a required check, which runs `npm run build --if-present` at :28 before `npm test` at :30), agent-evals.yml:25 and docs-check.yml:30. `files` (package.json:22-28) ships dist, bin, templates, README.md and LICENSE, and bin/aidlc.js:10-12 loads dist/cli/main.js, else src/cli/main.ts, which a git install on main lacks. tsconfig.test.json includes `scripts/**/*.ts`, so the typecheck covers the new script. The github ship path requires every check run reported on a pull request head to conclude success, and accepts neutral or skipped for a name not in `github.requiredChecks` (src/delivery/github-ship.ts:384-393). docs/OPERATIONS.md, docs/ARCHITECTURE.md, README.md and CLAUDE.md name ci.yml only for the bench job (OPERATIONS Loop benchmark, pinned at bench.test.ts:245) and CLAUDE.md:15 (`CI runs this, then npm run build`); neither changes. After T1-CI-SHARD, ci.yml also has the four `check-windows-shard` jobs, which run `npm ci` before the shard test command and `npm run build`, and tests/surface/ci-shard.test.ts reads ci.yml (T1-CI-SHARD acceptance 1 to 4); none of its assertions reads another job, apart from requiring that no other job is named `check (windows-latest, 22)`, which `install-smoke` meets since it has no `name`."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of a test file that exists on main
  - an edit of aidlc.config.json, or an `install-smoke` name in `github.requiredChecks`
  - a `permissions` key on the new job, a change to the top-level `permissions` block, the text `npx aidlc` without `--no-install` or the text `review bench` in ci.yml
  - the new job without the condition `github.event_name == 'push'`, or a change to the triggers of ci.yml
  - a command built as a shell string, or a call that does not go through `deps.runner`
  - a change to scripts/build.ts, to bin/, to package-lock.json, or to package.json other than the `prepare` entry in place of the `prepack` entry
  - a call of the smoke script from `npm test`, `npm run check` or a test file
  - a new dependency
  - the sequence of two hash signs and a space in the entry (once the entry is in CHANGELOG.md, tests/surface/templates.test.ts cuts the Unreleased slice there, lesson 2026-11-07 T0-ACCEPT-TABLE)
non_goals:
  - publishing to the npm registry and renaming the package
  - making `install-smoke` a required check or running it on pull requests; on a pull request head the job is skipped, which the github ship path accepts for a check that is not required (src/delivery/github-ship.ts:389-391), so an npm registry outage cannot stop a ship, and a git install broken by a pull request shows in that card's own smoke run and in the next push run of main
  - the second build of the workflows that run `npm run build` after `npm ci` (the `check`, `check-windows-shard` and `bench` jobs of ci.yml, aidlc-ci.yml:28); those steps stay, and tests/surface/bench.test.ts:217-220 requires the one of the `bench` job
  - a machine with no access to the npm registry; both installs fail there and the script exits 1
  - uncommitted changes; the git install takes HEAD and the tarball install takes the working tree, and the script does not compare the two
  - a checkout path with a character that `pathToFileURL` percent-encodes, such as a space; how npm reads such a URL was not verified and no test covers it
  - an install of this checkout without devDependencies or with `--ignore-scripts`; with `prepare`, `npm ci --omit=dev` fails in the build, and `--ignore-scripts` builds no `dist/`, so bin/aidlc.js runs the sources
  - README.md and docs text for the install command, which T1-INIT-PROFILE writes in docs/QUICKSTART.md
  - a macOS runner, which T1-CI-MACOS adds
hygiene: "Line numbers are from main at 2ef2bbf4; read them again at PREPARE. T1-CI-SHARD changes ci.yml first (a top-level `concurrency` block, `check` on ubuntu-latest only, and the jobs `check-windows-shard` and `check-windows` between `check` and `bench`), so every ci.yml line number of this card is read again at PREPARE on a main that has it. Verified by the owner on 2026-11-16 (intent/install-portability.md): `npm i -D git+file:///D:/Projects/AIDLC` on main installs LICENSE, README.md, bin/, package.json and templates/ only and `npx --no-install aidlc --version` fails with ERR_MODULE_NOT_FOUND for src/cli/main.ts; the same install from a clone whose package.json adds the prepare script holds dist/ and prints 0.2.0. Verified on 2026-11-17 in a scratch copy of main at 2ef2bbf4 outside both checkouts (Windows, Node 22.23.1, npm 11.14.1), with `prepack` replaced by `prepare`: after `npm ci --ignore-scripts` there was no dist/; `npm pack --pack-destination <dir>` printed one `> aidlc@0.2.0 prepare` and one `> aidlc@0.2.0 build` and wrote aidlc-0.2.0.tgz with 347 entries, 304 of them under package/dist/ (dist/cli/main.js, dist/index.js, dist/index.d.ts and dist/hooks/entry.js among them) and none under package/src/; with both `prepack` and `prepare` the same pack ran each and built twice; `npm ci` with scripts ran `prepare` and built dist/, after which `AIDLC_ENTRY_DEBUG=1 node bin/aidlc.js --version` printed `reason=dist`; `npm ci --omit=dev` failed in `prepare` with ERR_MODULE_NOT_FOUND for `typescript`. Not verified when this card was written, so check each by hand at PREPARE before any test is written, and stop and report if one fails: (a) a `git+file:` URL that ends in a hash sign and a full commit sha installs that commit; (b) npm can clone a linked worktree such as the card worktree through a `git+file:` URL (the owner's runs used the main checkout and a clone); (c) the step timings fit the 420000 ms deadline on this machine. Not verifiable before the merge, because the job is skipped on the card's own pull request: that the clone works from the checkout actions/checkout leaves on a push (the job asks for a full checkout, `fetch-depth: 0`), and that a matrix job whose `if` is false reports a check run that concludes `skipped`. At CLOSE, read the check runs of the pull request head and record in this file the name and conclusion that `install-smoke` reported, then read the push run of the merge commit on main and record both `install-smoke` results; open a follow-up issue for anything other than `skipped` on the head or `success` on main. With `prepare`, `npm ci` builds dist/ before the tests in the `check` job (ci.yml:32-34 at 2ef2bbf4) and in the four `check-windows-shard` jobs of T1-CI-SHARD, so the tests that start bin/aidlc.js or bin/aidlc-hook.js load the compiled build there; the required `build-test` job (aidlc-ci.yml:26-30) already builds before `npm test` on ubuntu-latest, so the new case is the Windows shards: before the first review run `npm run build` and then `npm test` once on Windows and record the counts in the Attempt evidence. Tests first, in two commits: the first adds tests/surface/install-smoke.test.ts and a seam scripts/install-smoke.ts whose `gitInstallSpec` returns an empty string and whose `smoke` returns `{ ok: false, lines: [] }` and runs nothing, so acceptance 1 to 6 fail by assertion; the second adds the script, the prepare entry and the job. Revert table, each row a scratch change restored afterwards, recorded in the Attempt evidence of this file: `scripts.prepare` removed and committed on a scratch branch (`node scripts/install-smoke.ts` exits 1 with a `git <sha>: FAILED` line; acceptance 6 red); `prepack` added back beside `prepare` (6 red); the job's `if` removed (6 red); `killTree` dropped (2 red); the deadline check dropped (4 red); the removal of the temporary directory dropped (5 red); the version comparison dropped (3 red); the job's matrix cut to one runner (6 red). Before reporting, confirm no npm or node process started by the script is still running."
---

# T1-INSTALL-GIT-DEP

## Deliverable
A git install of aidlc holds `dist/` because `package.json` builds in `prepare`, which replaces `prepack`, so `npm pack` builds once. `scripts/install-smoke.ts` packs the checkout, installs the tarball and a `git+file:` URL of the checkout at HEAD into two temporary directories, starts each installed `aidlc --version` and exits 1 when either does not print the version of `package.json`. A `ci.yml` job runs the script on `ubuntu-latest` and `windows-latest` on pushes and is skipped on pull requests.

## Why
Outside review of 2026-11-16, confirmed on main at 35de54fe (intent/install-portability.md): a git install has neither `dist/` nor `src/`, because `package.json` builds in `prepack` only (:38) and npm builds a git dependency with its `prepare` script. The name `aidlc` on the npm registry is another project, so the workflows under `templates/github/workflows`, which call `npx --no-install aidlc`, depend on a git or path install. Spec specs/install-portability.md R1 to R3.

Owner decision of 2026-11-17: `prepare` replaces `prepack`, since npm runs both on `npm pack` and each builds; and the job runs on pushes only, since the github ship path fails on any red check of a pull request head, required or not (src/delivery/github-ship.ts:384-393), so a registry outage on a pull request would stop a ship.

The script needs the npm registry for the dependencies of the installed package, so it is not part of `npm test`. The card proves it twice: a fast test of its exported functions with a scripted runner (dod arm 2) and one real run (dod arm 3), which is also the only run before the merge.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/install-smoke.test.ts tests/surface/bench.test.ts tests/surface/workflow-permissions.test.ts tests/surface/init-base-ci.test.ts tests/surface/review-bench.test.ts tests/infra/build-atomic.test.ts tests/core/config.test.ts tests/surface/ci-shard.test.ts tests/surface/changelog-fragments.test.ts && node scripts/install-smoke.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the smoke run prints two `ok` lines. Arm 1 is the typecheck, arm 2 the test files, arm 3 the smoke run.

## Acceptance detail

### 1. The commands
`gitInstallSpec('D:\\wt\\AIDLC\\x', S, true)` is `git+file:///D:/wt/AIDLC/x#` followed by `S`; `gitInstallSpec('/home/runner/work/AIDLC/AIDLC', S, false)` is `git+file:///home/runner/work/AIDLC/AIDLC#` followed by `S`.

`smoke` makes its directory `<dir>`, then `<dir>/pack`, `<dir>/tarball` and `<dir>/git`, and writes `{"name":"aidlc-smoke","private":true}` as `package.json` into the last two. The calls, in order, each `[command, args, { cwd, timeoutMs, killTree: true }]`:

1. `git rev-parse HEAD`, cwd `checkout`. The sha is the trimmed stdout.
2. `npm pack --pack-destination <dir>/pack`, cwd `checkout`. The tarball is the one file of `<dir>/pack` whose name ends in `.tgz`.
3. `npm install --no-audit --no-fund <absolute path of the tarball>`, cwd `<dir>/tarball`.
4. `npx --no-install aidlc --version`, cwd `<dir>/tarball`.
5. `npm install --no-audit --no-fund <gitInstallSpec(checkout, sha, process.platform === 'win32')>`, cwd `<dir>/git`.
6. `npx --no-install aidlc --version`, cwd `<dir>/git`.

### 2. The lines and the failure rules
Line 1 is `tarball: ok <version>` or `tarball: FAILED <step> (<how>)`. Line 2 is `git <sha>: ok <version>`, or `git <sha>: FAILED <step> (<how>)`, or `git: FAILED sha (<how>)` when call 1 gave no sha. `<step>` is `pack` (call 2), `install` (call 3 or 5), `start` or `version` (call 4 or 6).

- A call fails when it timed out (`timeout`), has no exit code (`no exit code`) or exits non-zero (`exit <n>`); a call that would start at or after the deadline fails with `deadline` and is not started.
- Call 1 also fails when its trimmed stdout is not 40 or 64 lower-case hexadecimal characters (`not a commit id`).
- Call 2 also fails when `<dir>/pack` holds no file or more than one file ending in `.tgz` (`<n> .tgz files`).
- A start that exits 0 fails as `version` when its trimmed stdout is not `version` (`printed <the first 80 characters as a JSON string>`).
- A failed pack fails the tarball install only; a failed call 1 fails the git install only.

### 3. The job
```yaml
  install-smoke:
    if: github.event_name == 'push'
    runs-on: (the matrix os, written as ci.yml:20 writes it)
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: node scripts/install-smoke.ts
```
The test reads the parsed workflow and finds the job by its name, not by its place, since T1-CI-MACOS adds a job after it: `if` is `github.event_name == 'push'`, the matrix `os` deep-equals the two names, the checkout step has `fetch-depth` 0, `npm ci` comes before `node scripts/install-smoke.ts`, and the job has no `permissions` key. A comment above the job says what it runs, that it needs the npm registry, and that it is skipped on pull requests so that a registry outage cannot stop a ship.

### 4. The entry
changelog.d/T1-INSTALL-GIT-DEP.md (new), this one line and one line feed:

"- T1-INSTALL-GIT-DEP: `package.json` builds `dist/` in a `prepare` script in place of `prepack`, so a git install of aidlc (`npm i -D github:Asun28/AIDLC`, or a `git+file:` URL) holds the compiled CLI; before, such an install held neither `dist/` nor `src/` and `aidlc --version` failed with ERR_MODULE_NOT_FOUND. `npm pack` builds once, through `prepare`. `prepare` also runs on `npm ci` and `npm install` of this checkout, which now build `dist/`, so a test that starts `bin/aidlc.js` after `npm ci` runs the compiled CLI. `node scripts/install-smoke.ts` packs the checkout, installs the tarball and a git URL of the checkout at HEAD into temporary directories, starts each installed `aidlc --version` and exits 1 when either does not print the version of `package.json`; it needs the npm registry, so `npm test` does not run it. The `install-smoke` job of the `ci` workflow runs it on `ubuntu-latest` and `windows-latest` for each push that triggers the workflow; it is skipped on pull requests and is not in `github.requiredChecks`, so a registry outage cannot stop a ship."
