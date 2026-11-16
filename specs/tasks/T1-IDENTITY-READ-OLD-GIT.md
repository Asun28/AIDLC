---
id: T1-IDENTITY-READ-OLD-GIT
title: On a git that refuses --no-lazy-fetch the finding-identity read of the card runner runs once more without the option when the review checkout has no promisor remote, and stays refused when it has one
status: todo
branch: T1-IDENTITY-READ-OLD-GIT
worktree: D:\wt\AIDLC\T1-IDENTITY-READ-OLD-GIT
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/finding-identity.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-IDENTITY-READ-OLD-GIT.md
dod_command: npm run typecheck && node --test tests/scenarios/finding-identity.test.ts tests/infra/base-sync.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the read `git --no-lazy-fetch cat-file blob <candidateSha>:<file>` of `findingIdentities` (src/loop/card-runner.ts:347, the call at :356) returns exit code 129 without a timeout and `gitLazyFetchSupport(this.runner, checkout)` of src/probes/base-sync.ts answers `plain`, the reader shall run `git cat-file blob <candidateSha>:<file>` with the same options and take the lines from that answer by the rule of :357.
  - R2. WHEN the probe answers `accepted`, `promisor` or `unknown`, the reader shall run no git read without `--no-lazy-fetch`, and the file is unread as today, so its reasons get no identity and no error.
  - R3. One call of `findingIdentities` shall run the probe at most once, and only after a read of that call returned exit code 129; a call whose reads return any other answer runs the git commands it runs on main and no other.
  - R4. A second read that throws shall leave the file unread, inside the `try` of :355-360, as a first read that throws does today, so no identity read throws out of the reader; a runner that throws inside the probe gives `unknown` by the probe's own rule.
  - R5. The doc comment of `findingIdentities` (:338-346) shall say what the read does on a git that refuses the option, in place of counting `a git without the option` among the reads that give no identity.
  - R6. docs/OPERATIONS.md shall carry the sentence of acceptance detail 2 in the paragraph that begins `Finding identity (card T1-FINDING-IDENTITY)` (:436), directly after the sentence that ends `as without it.`.
  - R7. CHANGELOG.md, Unreleased, shall carry the entry of acceptance detail 3 directly above the entry that begins `- T1-GIT-LAZY-FETCH-PROBE`.
acceptance:
  - 1. `tests/scenarios/finding-identity.test.ts`, new test "T1-IDENTITY-READ-OLD-GIT acceptance 1: on a git that refuses the option, with no promisor remote, a ship-path block and an R3 block record the identity". The runner of acceptance detail 1 in `shipBlock` and in `r3Block`; each gives `[[HERE, HERE_ID], [MISSING, undefined]]`. Fails on main by assertion (no identity). [R1] [dod arm 2]
  - 2. Same file, new test "T1-IDENTITY-READ-OLD-GIT acceptance 2: on a git that refuses the option a partial clone gets no identity and no read without the option". The `prepare` of the F2 test (:175-189) and the recording runner of acceptance detail 1 in `shipBlock`; the identities are `[[HERE, undefined], [MISSING, undefined]]`, the decision is recorded (`review-fix`), and no recorded git call has `cat-file` as its first argument. Passes on main by the first two checks and with this card; the revert row `promisor` read as `plain` makes it red. [R2] [dod arm 2]
  - 3. Same file, new test "T1-IDENTITY-READ-OLD-GIT acceptance 3: the probe runs at most once per decision and never when no read exits 129". Two rows on a repository with no promisor remote: with the refusing runner and the reasons `HERE` and `MISSING`, which cite two files, the recorded calls hold `git --no-lazy-fetch version` once and `git config` once; with `realGit()` they hold no `version` call, no `config` call and no `cat-file` call without the option. The first row fails on main by assertion (no probe call, no identity). [R3] [dod arm 2]
  - 4. Same file, new test "T1-IDENTITY-READ-OLD-GIT acceptance 4: an unknown probe answer, a runner that throws in the probe and a second read that throws leave the reason without an identity and the decision recorded". Three rows on the runner of acceptance detail 1: `git --no-lazy-fetch version` answered with exit 128 (no read without the option follows); the same call throwing, which the probe answers with `unknown`; the read without the option throwing. Each gives `[[HERE, undefined], [MISSING, undefined]]` and the directive `review-fix`. Passes on main and with this card; the revert rows of the hygiene make it red. [R2] [R4] [dod arm 2]
  - 5. Same file, the F2 test (:172) gains a skip for a real git that refuses the option, decided by running `git --no-lazy-fetch --version` as tests/infra/base-sync.test.ts:13 does, because its own check that the blob is absent runs the option (:190); the helpers `shipBlock` (:88) and `r3Block` (:74) gain an optional runner argument whose default is the runner they build today. No assertion of a test that exists on main changes, and on a git that accepts the option the seven existing tests run and pass as on main. [R1] [R2] [dod arm 2]
  - 6. tests/infra/base-sync.test.ts and tests/scenarios/fault-points.test.ts pass with no line changed. They pass on main and with this card. [R3] [dod arm 2]
  - 7. The doc comment is as R5 says, the sentence of acceptance detail 2 stands in docs/OPERATIONS.md and the entry of acceptance detail 3 in CHANGELOG.md (reviewer-verified against the diff). [R5] [R6] [R7]
depends_on: [T1-GIT-LAZY-FETCH-PROBE, T1-REVIEW-FOLLOWUP-ISSUE]
budget: 130
tdd: true
sweep: "On main at 35de54fe. `grep -rn 'findingIdentities' src tests`: the method at src/loop/card-runner.ts:347 and its two callers, :2471 (the R3 decision) and :2901 (the ship-path decision); no test names it. `grep -rnE 'no-lazy-fetch|cat-file' src tests`: the read at card-runner.ts:356 inside the `try` of :355-360; tests/scenarios/finding-identity.test.ts:31 (`realGit` throws on a `cat-file` or `show` call when asked to), :190 (the F2 presence check, real git with the option), :197 (a read without the option that does fetch). That test file runs real git through `realGit` (:29-33) and has no skip, so on a git that refuses the option its tests that expect `HERE_ID` (:100, :112, :139, :205) fail, and so does the last check of F2 (:198), whose presence helper runs the option; that is five tests, the number the outside review of 2026-11-16 reported failing on git 2.43 (the review's own list was not available when this card was written). Other test files reach `findingIdentities` through a formal block with a scripted runner; `scriptedRunner` (src/probes/exec.ts:394-407) answers exit 127 to a command it has no entry for, which is not 129, so they run the git commands they run on main. docs/OPERATIONS.md:436 describes the read; `grep -rnE 'Finding identity \\(card|no identity read touches' tests`: no hit, so no test pins the paragraph; it is in the section Formal review (R3) as a command, which tests/surface/prose.test.ts does not size. .claude/skills/verify-card-run-writes/SKILL.md covers the store writes of `CardRunner`; `findingIdentities` reads only and adds no write, and tests/scenarios/fault-points.test.ts is in the DoD to show the writes are as before. T1-REVIEW-FOLLOWUP-ISSUE (specs/tasks/T1-REVIEW-FOLLOWUP-ISSUE.md, status todo at 35de54fe) lists src/loop/card-runner.ts and docs/OPERATIONS.md in its allow_paths, hence the dependency."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the skip and the two helper arguments of acceptance 5
  - a git read without `--no-lazy-fetch` when the probe did not answer `plain`
  - a probe call before a read returned exit code 129, or more than one probe call in one `findingIdentities` call
  - a probe result kept on the `CardRunner` instance or in module state
  - `git show`, or a read through a shell (lesson 2026-11-16 T1-FINDING-IDENTITY)
  - a change to src/probes/base-sync.ts, to src/core/review-policy.ts or to a store write of `CardRunner`
  - the text of the release before 2.45, written with its two numbers, in docs/OPERATIONS.md (tests/infra/base-sync.test.ts:264-271 fails on it)
  - a new file under src, or a new dependency
  - the sequence of two hash signs and a space in the CHANGELOG entry
non_goals:
  - an identity in a repository with a promisor remote on a git that refuses the option; the read stays refused and the reason gets no identity
  - a real git older than 2.45 in CI; no runner has one, so the tests use a runner that answers exit 129 to every git call whose first argument is the option
  - the F2 test on a real git that refuses the option; it is skipped there, and acceptance 2 covers the partial clone with the refusing runner
  - the base-sync check and the doctor line, which T1-GIT-LAZY-FETCH-PROBE changed
  - an exit code 129 that `cat-file` gives for another reason on a git that accepts the option; the probe then answers `accepted` and the file is unread, as today
  - `aidlc review stats` and every reader of `ReviewFinding.identity`
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE, after T1-GIT-LAZY-FETCH-PROBE and T1-REVIEW-FOLLOWUP-ISSUE have merged, since the second edits card-runner.ts. Tests first, in two commits: the first adds the four tests, the skip and the helper arguments and records acceptance 1 and the first row of acceptance 3 failing on main by assertion; the second changes card-runner.ts and the documents. Revert table, each row a scratch change restored afterwards: the second read dropped (1 red); `promisor` read as `plain` (2 red); the probe run before the first read (3 red, second row); the probe run once per file (3 red, first row); the second read moved outside the `try` (4 red, third row); `unknown` read as `plain` (4 red, first and second rows). Run `npm test` once before the first review, since many test files reach a formal block through `CardRunner`. Insert the CHANGELOG entry directly above the entry that begins `- T1-GIT-LAZY-FETCH-PROBE`, followed by a blank line."
---

# T1-IDENTITY-READ-OLD-GIT

## Deliverable
A formal block on a machine whose git refuses `--no-lazy-fetch` records the identity of each cited finding when the review checkout has no promisor remote. With a promisor remote the read stays refused and nothing is fetched.

## Why
Outside review of 2026-11-16 on git 2.43, confirmed on main at 35de54fe: the finding-identity read runs as `git --no-lazy-fetch cat-file blob` (src/loop/card-runner.ts:356), a git older than 2.45 refuses the option, and every finding is then recorded without an identity; five tests of tests/scenarios/finding-identity.test.ts fail there. The option keeps a partial clone from fetching a blob. A checkout with no promisor remote has nothing to fetch, so the read can run without it. Spec specs/install-portability.md R8.

Shape. The reader asks the probe of T1-GIT-LAZY-FETCH-PROBE only after a read exits 129, so on a git that accepts the option it runs the commands it runs today and every existing test with a scripted runner is unaffected.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/finding-identity.test.ts tests/infra/base-sync.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. The refusing runner
A `SyncRunner` that records every call, answers a git call whose first argument is `--no-lazy-fetch` with exit code 129 and the stderr `unknown option: --no-lazy-fetch` (built with `scriptedRunner`), passes every other git call to `runSync`, and passes a command that is not git to `scriptedRunner({})`, as `realGit` does (:29-33). On a repository with no promisor remote the probe then answers `plain` through real git's `git config`; after the `prepare` of the F2 test it answers `promisor`.

### 2. The OPERATIONS sentence
`On a git that refuses `--no-lazy-fetch` (older than 2.45) the read runs once more without the option when the review checkout has no promisor remote, which `gitLazyFetchSupport` (`src/probes/base-sync.ts`) decides by running the option and reading `git config`, at most once per decision; with a promisor remote the read stays refused and the reason gets no identity (card T1-IDENTITY-READ-OLD-GIT).`

### 3. The CHANGELOG entry
`- T1-IDENTITY-READ-OLD-GIT: on a git that refuses `--no-lazy-fetch` (older than 2.45), a formal block records the identity of a cited finding when the review checkout has no promisor remote: the read of the cited lines runs once more without the option. Before, every finding was recorded without an identity there. With a `remote.<name>.promisor` or `extensions.partialclone` key set the read stays refused, so a partial clone still fetches nothing. The card runner asks the probe of T1-GIT-LAZY-FETCH-PROBE at most once per decision and only after a read exits 129, so on a git that accepts the option it runs the commands it ran before.`
