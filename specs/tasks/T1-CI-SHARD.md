---
id: T1-CI-SHARD
title: The ci workflow runs the Windows suite in four test shards behind one job that keeps the required check name check (windows-latest, 22) and succeeds only when all four succeeded, and a new run of a pull request cancels the older in-progress run of that pull request
status: todo
branch: T1-CI-SHARD
worktree: D:\wt\AIDLC\T1-CI-SHARD
plan_ref: plans/loop-throughput.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - .github/workflows/ci.yml
  - tests/surface/ci-shard.test.ts
  - tests/infra/github-ship.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-CI-SHARD.md
dod_command: npm run typecheck && node --test tests/surface/ci-shard.test.ts tests/infra/github-ship.test.ts tests/surface/bench.test.ts tests/surface/workflow-permissions.test.ts tests/surface/init-base-ci.test.ts tests/core/config.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `.github/workflows/ci.yml` shall carry the `concurrency` block of Acceptance detail 1 between the top-level `permissions` block (:15-16) and `jobs:` (:18).
  - R2. The `check` job shall run on `ubuntu-latest` only (`matrix.os` `[ubuntu-latest]`, `matrix.node` `[22]`) with its steps unchanged, so its check run keeps the name `check (ubuntu-latest, 22)`.
  - R3. A new job `check-windows-shard` shall run on `windows-latest`, with `fail-fast` false and `matrix.shard` `[1, 2, 3, 4]`, the steps of the `check` job in their order, `npm test` replaced by the shard command of Acceptance detail 1.
  - R4. A new job `check-windows` named `check (windows-latest, 22)` shall need `check-windows-shard`, run on `ubuntu-latest` under `if: always()` and fail unless `needs.check-windows-shard.result` is `success`.
  - R5. The `bench` job, the triggers (:3-13), the `permissions` block, package.json (its `test` script runs the whole suite), aidlc.config.json and the other workflows shall stay as they are on main.
  - R6. The github ship path shall keep reading the check runs of the candidate head sha only (src/delivery/github-ship.ts:297 and :375, src/probes/gh.ts:156), unchanged, so a cancelled run of an older head stops no ship, while a red or cancelled shard on the head stops it.
  - R7. CHANGELOG.md, Unreleased, shall carry the entry of Acceptance detail 2 directly above the entry that begins `- T0-R3-POOL-WAIT`, followed by one blank line.
acceptance:
  - 1. tests/surface/ci-shard.test.ts (new), "T1-CI-SHARD acceptance 1 - the Windows suite runs in four shard jobs that run the test script of package.json with the shard option before the pattern". Job `check-windows-shard` - `runs-on` `windows-latest`; `strategy.fail-fast` false and `strategy.matrix` deep-equal to `{ shard: [1, 2, 3, 4] }`; no `if`, `permissions` or `continue-on-error`; the checkout and setup-node steps of `check` with `node-version` 22; `run` steps `npm ci`, `npm run typecheck`, the shard command, `npm run build`, `node bin/aidlc.js doctor --json || true`, in that order. The shard command is the `test` script of package.json with `--test-shard=${{ matrix.shard }}/4 ` inserted before the quoted pattern, and that script is `node --test --test-reporter=spec "tests/**/*.test.ts"`. Fails on main by assertion. [R3] [R5] [dod arm 2]
  - 2. Same file, "T1-CI-SHARD acceptance 2 - the job named check (windows-latest, 22) needs the shards, always runs and fails unless they succeeded, and check runs on ubuntu-latest only". Job `check-windows` - `name` `check (windows-latest, 22)`, `needs` `check-windows-shard`, `if` `always()`, `runs-on` `ubuntu-latest`, no `strategy`, one step with `env.RESULT` `${{ needs.check-windows-shard.result }}` and `run` `test "$RESULT" = success`; no other job has that name; `jobs.check.strategy.matrix` deep-equals `{ os: ['ubuntu-latest'], node: [22] }` and the `run` steps of `check` are those of main (`npm ci`, `npm run typecheck`, `npm test`, `npm run build`, the doctor line). Fails on main by assertion. [R2] [R4] [dod arm 2]
  - 3. Same file, "T1-CI-SHARD acceptance 3 - one concurrency group per pull request cancels only pull-request runs, and the triggers and permissions are unchanged". `concurrency` deep-equals the block of Acceptance detail 1; `on` and `permissions` deep-equal their values on main. Fails on main by assertion. [R1] [R5] [dod arm 2]
  - 4. Same file, "T1-CI-SHARD acceptance 4 - the shard command of ci.yml, run for shards 1 to 4 over a fixture, runs each test file in exactly one shard". A `tmpDir` (tests/infra/helpers.ts) holds package.json `{"type":"module"}`, tests/root.test.ts and tests/<a|b|c>/f<1|2|3>.test.ts, each defining one test named `file <its path>`. For k from 1 to 4 the shard command read from ci.yml, `${{ matrix.shard }}` replaced by k, is split into words (quotes removed), `node` replaced by `process.execPath`, and run in the fixture with `NODE_TEST_CONTEXT` removed from the environment; each run exits 0 and names at least one test, and the four outputs name each of the ten tests once. Fails on main (no shard command). [R3] [dod arm 2]
  - 5. tests/infra/github-ship.test.ts, a `describe('T1-CI-SHARD shard checks on the ship gate')` appended at the end of the file, test "T1-CI-SHARD acceptance 5 - the gate reads the check runs of the candidate head only, so a cancelled run of an older head stops nothing, and a red or cancelled shard on the head is ci-red". The three rows of Acceptance detail 3. Passes on main and with this card; red when the check-runs read names another sha than HEAD (revert table). [R6] [dod arm 2]
  - 6. tests/surface/bench.test.ts (:211-237), tests/surface/workflow-permissions.test.ts (:152-160), tests/surface/init-base-ci.test.ts (:375-391), tests/core/config.test.ts (:10 and :38-45, the four required names), the other tests of tests/infra/github-ship.test.ts and tests/surface/prose.test.ts pass with no line changed. They pass on main and with this card. [R2] [R5] [R6] [dod arm 2]
  - 7. The CHANGELOG entry is the text of Acceptance detail 2 at the anchor of R7 (reviewer-verified against the diff). [R7]
depends_on: []
budget: 200
tdd: true
sweep: "Main at 2ef2bbf4. Gate - `head` is `git rev-parse --verify HEAD` of the worktree (github-ship.ts:297) and the gate reads `checkRuns(repository, head)` (:375), which requests `repos/<repo>/commits/<sha>/check-runs` (gh.ts:156); tests/infra/gh.test.ts 'checkRuns paginates until a page is smaller than 100 and stops requesting further pages' asserts the sha in the URL, and no ship test asserts which sha the gate reads (each stub matches the prefix `gh api repos/o/r/commits`), hence acceptance 5. A required name must be present (absent is pending, :386-387) and conclude `success`; another reported check may conclude `success`, `neutral` or `skipped` (:388-392); any other conclusion, `cancelled` included, is `[CI-GATE-RED]` (:393-396). So a red shard stops a ship directly and through the aggregate; tests :261, :273 and :287 cover the rules with other names. Ruleset `main required checks` (26745604): the four contexts, integration_id 15368 (GitHub Actions), strict policy false. Shard command, Node 22.23.1 - `--test-shard=1/2` and `2/2` over `\"tests/core/a*.test.ts\"` ran two files and one file; the option placed after the pattern ran all three, exit 0; in a scratch project of ten files (deleted), shards 1/4 to 4/4 ran 3, 3, 2 and 2 files, each once, by index modulo 4 of the sorted paths, under bash and PowerShell 7.6, and `npm test -- --test-shard=1/4` printed the option after the pattern and ran all ten. Node 22 docs: `--test-shard` divides all test files into `total` equal parts (cli.html); glob patterns are the final arguments, double-quoted against shell expansion (test.html). Readers - `git grep -n -e ci.yml -e windows-latest -e ubuntu-latest -e 'check (' -e test-shard -e concurrency -- tests`: bench.test.ts:212-221, workflow-permissions.test.ts:152-160, config.test.ts:10, and check names in fixtures of ci-policy.test.ts and github-ship.test.ts that read no file; init-base-ci.test.ts:375-391 and review-bench.test.ts:416-423 read every workflow. Docs - docs/OPERATIONS.md:582, :608 and :610 and docs/PROJECT-STATE.md:14 stay true (the four required names, every other reported check must succeed, `bench` beside `check`), so no doc changes."
forbid:
  - a change under src, bin, scripts or bench, to package.json, aidlc.config.json, another workflow or a template
  - a shard command that runs `npm test --` or places any option after the test pattern
  - moving, splitting, skipping or deleting a test file, or a `--test-name-pattern`, `--test-skip-pattern` or `--test-concurrency` option in ci.yml
  - a `permissions` key on a job, a change to the top-level `permissions` block, `continue-on-error` in ci.yml, or a change to the `bench` job or the triggers
  - a concurrency group that two push runs can share, or `cancel-in-progress` true for a push run
  - weakening, skipping or deleting a test, or changing a line of a test file that exists on main other than appending the describe of acceptance 5
  - the sequence of two hash signs and a space in the CHANGELOG entry
  - an assertion over the full list of jobs of ci.yml; T1-INSTALL-GIT-DEP and T1-CI-MACOS add jobs to it later
  - the words `review bench` anywhere in ci.yml; tests/surface/review-bench.test.ts (:416-423) refuses them in every workflow, takes 166 s on Windows and is left out of the DoD, so CI is the first run of it
non_goals:
  - sharding the Ubuntu job or `aidlc-ci.yml` (`build-test`), and balancing the shards by duration
  - a rerun of a Windows shard red at a step on `ci.transientSteps` (`Set up job`, `Complete job`) - the aggregate is then red at its own step, so the class is `unknown` and the card stops with STOP/ci (src/core/ci-policy.ts:327, :354), where the single Windows job got the one transient rerun; a follow-up issue if it happens
  - a cancelled run on the candidate head; it stays `[CI-GATE-RED]` and STOP/ci. The group cancels a run only when a newer `pull_request` run of the same pull request starts (another head pushed, or a reopen), which the loop does not cause during a ship
  - removing the typecheck, build or doctor step from the Windows jobs, or a local npm script for one shard
  - docs/OPERATIONS.md and docs/PROJECT-STATE.md (sweep)
hygiene: "Line numbers are from main at 2ef2bbf4; read them again at PREPARE. Tests first, two commits - the test files with ci.yml unchanged (acceptance 1 to 4 fail by assertion, 5 and 6 pass), then ci.yml and the CHANGELOG entry. Revert table before the first review, each a scratch change restored afterwards - concurrency block removed (3 red); `cancel-in-progress: true` (3 red); `windows-latest` back in the `check` matrix (2 red); a shard value removed (1 red); the option moved after the pattern (1 and 4 red); `/3` in place of `/4` (1 and 4 red); `if: always()` removed (2 red); the gate read given `BASE_OID` in place of `head` at github-ship.ts:375 (5 red). Before the first review the coordinator runs every test file that reads CHANGELOG.md (docpins, as for T0-CI-PERMISSIONS). Not verified before the card runs - (1) the shard check names, expected `check-windows-shard (1)` to `(4)` by the rule GitHub applies to `check` (job id, then the matrix values in parentheses; run 43831983917 prints `Complete job name: check (windows-latest, 22)`); (2) that `needs.check-windows-shard.result` of a matrix job is `success` only when all four legs succeeded; GitHub documents the four values and nothing about matrix jobs; the ship path reads each shard check run (github-ship.ts:391), the ruleset only the aggregate; (3) that in a run cancelled by the group the aggregate still runs under `always()` and fails on the older head, which no ship reads; (4) that the aggregate's failed-step excerpt holds no line the CI classifier reads as evidence. The card's own pull request is the first run of the new jobs, and its ship merges only if `check (windows-latest, 22)` reports `success` on the head (an absent required name is pending until the 30-minute gate timeout). At CLOSE read `gh pr view <n> --json statusCheckRollup` and `gh run view <run> --json jobs` and add a closing note to this file - the check names of the `ci` workflow, each shard's test step duration, and the Windows critical path (earliest shard start to the end of `check (windows-latest, 22)`) against 18 min 23 s on PR 342. CHANGELOG anchor - directly above `- T0-R3-POOL-WAIT`; another card with that anchor is merged by the base sync's CHANGELOG union."
---

# T1-CI-SHARD

## Deliverable
The `ci` workflow runs the Windows suite in four parallel jobs, `check-windows-shard` with `--test-shard=1/4` to `4/4`. A job named `check (windows-latest, 22)` needs the four and succeeds only when all four succeeded, so `github.requiredChecks`, tests/core/config.test.ts and the ruleset `main required checks` keep the four names. `check` runs on `ubuntu-latest` only. A new run of a pull request cancels the older in-progress run of that pull request; a push run is never cancelled. No source changes: the gate already reads the check runs of the candidate head only, and acceptance 5 pins that.

## Why
On PR 342 the Windows check took 18 min 23 s; in run 43831983917 its `npm test` step took 17 min 35 s against 4 min 49 s on Ubuntu, and its other steps 46 s. Card lead time p50 is 0.85 h (docs/reliability/baseline.md:39), and each repair push pays the Windows run again.

Expected balance, an estimate: Node gives shard k the files whose index in the sorted path list is k-1 modulo 4 (52, 51, 51, 51 of 205). Top-level test durations of the Windows log, mapped to files by test name (imprecise), put most time in shard 2, about 1,000 to 1,170 s against 490 to 650 s in each other shard. The single job ran about 2.8 files at once, so shard 2's test step would take 6 to 7 minutes and the Windows critical path about 8, about 10 minutes less per run.

The shard command is the full `node --test` line, not `npm test -- --test-shard=<k>/4`: npm appends the option after the pattern, Node reads it as one more pattern, and every shard runs the whole suite with exit 0. The aggregate job runs on `ubuntu-latest`, which starts sooner, and runs no test.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/ci-shard.test.ts tests/infra/github-ship.test.ts tests/surface/bench.test.ts tests/surface/workflow-permissions.test.ts tests/surface/init-base-ci.test.ts tests/core/config.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every acceptance test above passes.

## Acceptance detail

### 1. ci.yml after the card
Between `permissions` and `jobs:`, one blank line on each side:
```yaml
# A new run of a pull request cancels the older run of that pull request. A push run has a group of its own run id,
# so no push run waits for or cancels another.
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```
In `check`, `os: [ubuntu-latest, windows-latest]` becomes `os: [ubuntu-latest]`. After `check`, before the `bench` comment:
```yaml
  # The Windows suite in four shards; Node splits the test files by path. The option stays before the pattern: Node reads
  # an argument after the pattern as another pattern and runs every file.
  check-windows-shard:
    runs-on: windows-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: node --test --test-reporter=spec --test-shard=${{ matrix.shard }}/4 "tests/**/*.test.ts"
      - run: npm run build
      - name: doctor (informational)
        shell: bash
        run: node bin/aidlc.js doctor --json || true

  # Keeps the required check name of aidlc.config.json and the `main required checks` ruleset; runs no test and
  # succeeds only when every shard succeeded.
  check-windows:
    name: check (windows-latest, 22)
    needs: check-windows-shard
    if: always()
    runs-on: ubuntu-latest
    steps:
      - env:
          RESULT: ${{ needs.check-windows-shard.result }}
        run: test "$RESULT" = success
```

### 2. The CHANGELOG entry
"- T1-CI-SHARD (CI): the `ci` workflow runs the Windows suite in four jobs, `check-windows-shard` with `node --test --test-shard=<k>/4` over the files of `npm test`, so each test file runs in one shard. The job `check-windows`, named `check (windows-latest, 22)`, needs the four and succeeds only when all four succeeded, so the required check names are unchanged; `check` runs on `ubuntu-latest` only. A new run of a pull request cancels the older in-progress run of that pull request; a push run is never cancelled. The github ship path reads the check runs of the candidate head only, so a cancelled run of an older head stops no ship, and a red shard stops a ship as any red check does. Local `npm test` still runs the whole suite. On PR 342 the Windows check took 18 min 23 s."

### 3. The rows of acceptance 5
`U` is `check (ubuntu-latest, 22)`, `W` is `check (windows-latest, 22)`, `S(k)` is `check-windows-shard (k)`. Each row is a `GitHubShipPath` on its own `fixture({ verdict: 'pass', reasons: [], sha: HEAD })` with `runnerWith`, `requiredChecks: [U, W]` and a function entry for `gh api repos/o/r/commits` that records `args[1]` and answers by the sha in it. A read lists `U`, `S(1)` to `S(4)`, `W` in that order, each `completed` and `success` unless the row says otherwise.
- a. A URL naming `HEAD` gets all success; any other URL gets `S(1)` to `S(4)` `cancelled` and `W` `failure`. Outcome `merged`; every recorded URL starts with `repos/o/r/commits/<HEAD>/check-runs`.
- b. `HEAD` gets `S(2)` `cancelled` and `W` `failure`. Outcome `ci-red`; the receipt holds `[CI-GATE-RED] [{"name":"check-windows-shard (2)","conclusion":"cancelled"},{"name":"check (windows-latest, 22)","conclusion":"failure"}]`; `gh pr merge` is not called.
- c. `HEAD` gets `S(3)` `failure` and `W` `success`. Outcome `ci-red`; the gate line names `S(3)` alone; no merge.

## Attempt evidence
RED commit fb9e0122 (test files only, ci.yml unchanged): `node --test tests/surface/ci-shard.test.ts tests/infra/github-ship.test.ts` 73 tests, 69 pass, 4 fail; acceptance 1 to 4 each fail with AssertionError at their first assertion (no `check-windows-shard` job, no `check-windows` job, no `concurrency` block), acceptance 5 passes.

| Item | Proving test or command | Result |
|------|-------------------------|--------|
| 1 | tests/surface/ci-shard.test.ts, acceptance 1 | pass |
| 2 | tests/surface/ci-shard.test.ts, acceptance 2 | pass |
| 3 | tests/surface/ci-shard.test.ts, acceptance 3 | pass |
| 4 | tests/surface/ci-shard.test.ts, acceptance 4 (shards 1/4 to 4/4 over the ten-file fixture) | pass |
| 5 | tests/infra/github-ship.test.ts, `T1-CI-SHARD shard checks on the ship gate` | pass |
| 6 | the dod_command (bench, workflow-permissions, init-base-ci, config, github-ship, prose) | pass, exit 0 |
| 7 | CHANGELOG.md entry above `- T0-R3-POOL-WAIT` | reviewer-verified against the diff |

Revert table, each row a scratch change restored afterwards: concurrency removed (3 red); `cancel-in-progress: true` (3 red); `windows-latest` back in the `check` matrix (2 red); shard 4 removed (1 red); the option after the pattern (1 and 4 red); `/3` in place of `/4` (1 and 4 red); `if: always()` removed (2 red); the gate read given `BASE_OID` in place of `head` at github-ship.ts:375 (5 red).
