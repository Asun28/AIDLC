---
id: T1-GIT-LAZY-FETCH-PROBE
title: A probe exported from base-sync.ts finds by running the option whether git accepts --no-lazy-fetch and, when it does not, whether the repository has a promisor remote; doctor's baseSync then runs without the option in a repository with none, stays refused in one that has one, and doctor prints a gitLazyFetch line in both cases
status: todo
branch: T1-GIT-LAZY-FETCH-PROBE
worktree: D:\wt\AIDLC\T1-GIT-LAZY-FETCH-PROBE
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/probes/base-sync.ts
  - src/cli/main.ts
  - tests/infra/base-sync.test.ts
  - tests/surface/templates.test.ts
  - docs/OPERATIONS.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T1-GIT-LAZY-FETCH-PROBE.md
dod_command: npm run typecheck && node --test tests/infra/base-sync.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/infra/github-ship.test.ts tests/surface/init-no-package.test.ts
dod_exit: 0
requirements:
  - R1. `src/probes/base-sync.ts` shall export `gitLazyFetchSupport(runner, cwd)`, which returns `accepted`, `plain`, `promisor` or `unknown` by the rules of acceptance detail 1, runs at most two git commands through `runner`, each with `{ cwd, timeoutMs: 30000 }`, decides from exit codes alone, reads no version text and never throws.
  - R2. `baseSyncReport` shall take the optional input `support`; with `plain` every git call of the check runs without `--no-lazy-fetch`, and with any other value or with none every call carries it as today (:28-30, :39), so a call without the input returns what it returns on main.
  - R3. The same file shall export `baseSyncChecks(input)`, which for `isGit` false returns `{ baseSync: 'n/a' }` and runs no git, and otherwise reads `gitLazyFetchSupport(input.runner ?? runSync, input.cwd)` once and returns an object whose first key `baseSync` is `baseSyncReport` of the input with that `support`, followed by the key `gitLazyFetch` with the text of acceptance detail 2 for `plain` or `promisor`, and by no such key for `accepted` or `unknown`.
  - R4. The `checks` object of `aidlc doctor` shall hold the entries of `baseSyncChecks({ isGit, cwd, base })` in place of its `baseSync` entry (src/cli/main.ts:346), so `gitLazyFetch` stands directly after `baseSync` and before `hookCommand` when it is present; doctor's exit code does not change.
  - R5. The git bullet of README.md (:17) shall read the text of acceptance detail 3.
  - R6. docs/OPERATIONS.md (:37) shall hold the three sentences of acceptance detail 4 in place of the one sentence that tests/surface/templates.test.ts:265 pins, and that test pins the three in its place.
  - R7. The header comment of src/probes/base-sync.ts (:6-8) shall say what the module does on a git that refuses the option, in place of `refuses it (exit 129) and the value is UNREADABLE`.
  - R8. CHANGELOG.md, Unreleased, shall carry the entry of acceptance detail 5 directly above the entry that begins `- reliability-baseline-2`.
acceptance:
  - 1. `tests/infra/base-sync.test.ts`, new test "T1-GIT-LAZY-FETCH-PROBE acceptance 1: gitLazyFetchSupport by each answer of the two git calls". One row per answer of acceptance detail 1, each with the recorded calls (argv, `cwd`, `timeoutMs` 30000) and the value. Fails on main (no export; with the seam of the hygiene by assertion). [R1] [dod arm 2]
  - 2. Same file, new test "T1-GIT-LAZY-FETCH-PROBE acceptance 2: with support plain no git call of the check carries the option, and with accepted, promisor, unknown or none every call does". Scripted runner; for `plain` the three recorded calls begin `git rev-parse`, `git rev-parse` and `git rev-list` with no option between `git` and the command, and for the four others the first three elements of each call are those of :252. Fails on main for `plain`. [R2] [dod arm 2]
  - 3. Same file, new test "T1-GIT-LAZY-FETCH-PROBE acceptance 3: on a git that refuses the option a real clone with no promisor remote reads in sync and gets the plain line". The clone of `cloneOfOrigin` (:33) and a runner that answers exit 129 to every git call whose first argument is `--no-lazy-fetch` and passes every other call to `runSync`; `baseSyncChecks` deep-equals `{ baseSync: 'in sync with origin/main', gitLazyFetch: <the plain text> }` and its keys are in that order. Skipped only when git is missing. Fails on main. [R1] [R2] [R3] [dod arm 2]
  - 4. Same file, new test "T1-GIT-LAZY-FETCH-PROBE acceptance 4: on a git that refuses the option a promisor clone stays UNREADABLE, gets the promisor line and no git read runs without the option". The clone of `promisorClone` (:213) and the runner of acceptance 3, recording; the result deep-equals `{ baseSync: 'UNREADABLE: git rev-parse failed (exit 129)', gitLazyFetch: <the promisor text> }`, and the one recorded call without `--no-lazy-fetch` is the `git config` call of acceptance detail 1. Fails on main. [R1] [R2] [R3] [dod arm 2]
  - 5. Same file, new test "T1-GIT-LAZY-FETCH-PROBE acceptance 5: baseSyncChecks returns baseSync alone on a git that accepts the option or gives no usable answer, and runs no git outside a repository". Scripted runner: `accepted` and `unknown` each give an object with the one key `baseSync`; `isGit` false gives `{ baseSync: 'n/a' }` with no call. Fails on main. [R3] [dod arm 2]
  - 6. Same file, new test "T1-GIT-LAZY-FETCH-PROBE acceptance 6: on a git that accepts the option aidlc doctor --json prints baseSync, no gitLazyFetch key, and hookCommand directly after baseSync". `node bin/aidlc.js doctor --json` in the clone of `cloneOfOrigin`, as :181 runs it; skipped when the real git refuses the option. Passes on main and with this card: it holds the entries a doctor run prints today. [R4] [dod arm 2]
  - 7. Same file, the test at :257 ("on a git that refuses --no-lazy-fetch, a real clone reads UNREADABLE (exit 129)", its name ending with a requirement tag of its own card; skipped unless the real git refuses the option) keeps its assertion on `baseSyncReport` without the `support` input and gains one: `baseSyncChecks` of the same clone deep-equals the value of acceptance 3. No other line of a test that exists on main changes in this file. [R2] [R3] [dod arm 2]
  - 8. `tests/surface/templates.test.ts`, test "T0-DOCTOR-BASE-SYNC acceptance 4 and 5" (:253): the second sentence of its list (:265) is replaced by the three sentences of acceptance detail 4, and no other line of the file changes. Fails on main for the three new sentences. [R6] [dod arm 2]
  - 9. tests/infra/base-sync.test.ts:264-271 (docs/OPERATIONS.md, src/probes/base-sync.ts and the test file name 2.45 and never the release before it), tests/infra/github-ship.test.ts:1278 (README.md matches `2\.38 or newer for the `github` ship path`), tests/surface/prose.test.ts and tests/surface/init-no-package.test.ts (its doctor runs) pass with no line changed. They pass on main and with this card. [R5] [R6] [dod arm 2]
  - 10. README.md:17 is the text of acceptance detail 3, the header comment is as R7 says, the `checks` object spreads `baseSyncChecks` (the wiring of the refused case, which acceptance 3 and 4 prove on the function), and the CHANGELOG entry is the text of acceptance detail 5 (reviewer-verified against the diff). [R4] [R5] [R7] [R8]
depends_on: []
budget: 180
tdd: true
freeze: true
sweep: "On main at 35de54fe. `grep -rnE 'no-lazy-fetch|baseSyncReport|exit 129|2\\.45|2\\.38|promisor|partialclone' src tests docs README.md CHANGELOG.md CLAUDE.md templates .claude`. Code: src/probes/base-sync.ts:28-30 (`noLazyFetch` puts the option before every git call), :39 (the one use), :64-68 (`unreadable`); src/cli/main.ts:346 (the one caller of `baseSyncReport`); src/loop/card-runner.ts:356 (the finding-identity read, which T1-IDENTITY-READ-OLD-GIT changes). Tests that pin the option or the exit 129 value: tests/infra/base-sync.test.ts:157 (a scripted `git --no-lazy-fetch rev-parse` exit 129 gives `UNREADABLE: git rev-parse failed (exit 129)`; it calls `baseSyncReport` without `support`, so it holds), :247-253 (the three calls carry the option; same), :257-262 (a real git that refuses: changed by acceptance 7), :264-271 (no file of the three may name the release before 2.45), :62 and :179 (the real-repository suites, skipped when the real git refuses the option; unchanged); tests/surface/templates.test.ts:265 (the OPERATIONS sentence, changed by acceptance 8) and :271 (the ARCHITECTURE sentence on base-sync.ts, which stays true). Doc sentences: docs/OPERATIONS.md:37 (the baseSync paragraph, in the section Setup, which tests/surface/prose.test.ts does not size), README.md:17 (already names 2.38 for the github ship path; tests/infra/github-ship.test.ts:1278 pins that phrase), docs/ARCHITECTURE.md:20. `scriptedRunner` (src/probes/exec.ts:394-407) answers exit 127 to a command it has no entry for, which the probe reads as `unknown`. Doctor keys: tests/infra/stray-processes.test.ts:608-610 and the doctor runs of tests/surface/init-no-package.test.ts:227-231, tests/surface/doctor-interrupted-writes.test.ts:427, tests/surface/cli-cwd-paths.test.ts:284 and tests/surface/config.test.ts:315 read single keys or the order of two other keys; none lists every key. Checked with git 2.56.0 on Windows on 2026-11-16: `git --no-lazy-fetch version` exits 0, an unknown option before the command exits 129, and `git config --get-regexp` with the pattern of acceptance detail 1 exits 1 with no key set and exits 0 printing `extensions.partialclone origin` or `remote.Origin.promisor false` when one is set. No git older than 2.45 was available: the exit 129 of such a git for this option is taken from docs/OPERATIONS.md:37 and tests/infra/base-sync.test.ts:157."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the two changes of acceptance 7 and 8
  - deciding support from `git --version` output or any other version text (lesson 2026-10-07 T0-DOCTOR-BASE-SYNC-2)
  - a git call of the check without `--no-lazy-fetch` when `support` is not `plain`
  - reading the stdout of the `git config` call, or any parse of git output in the probe
  - a cache of the probe result in module state; each `baseSyncChecks` call probes once
  - the text of the release before 2.45, written with its two numbers, in docs/OPERATIONS.md, src/probes/base-sync.ts or tests/infra/base-sync.test.ts (tests/infra/base-sync.test.ts:264-271 fails on it)
  - a change to the README phrase `2.38 or newer for the `github` ship path`
  - a change to src/loop/card-runner.ts, a new file under src, or a new dependency
  - the sequence of two hash signs and a space in the CHANGELOG entry
non_goals:
  - the finding-identity read of src/loop/card-runner.ts:356, which T1-IDENTITY-READ-OLD-GIT changes with this probe
  - lifting the refusal in a repository with a promisor remote on a git older than 2.45
  - a promisor key whose value is `false`; any `remote.<name>.promisor` or `extensions.partialclone` key that is set counts as a promisor remote and the check stays refused
  - a git that refuses the option with an exit code other than 129, a missing git, a timeout; the probe answers `unknown`, the check keeps the option and doctor prints no `gitLazyFetch` line
  - a doctor run through a real git older than 2.45 in CI; no runner has one, so acceptance 3 and 4 stand in for it with a runner that refuses the option
  - the `GIT_NO_LAZY_FETCH` variable of src/review/mutants.ts and src/review/bench.ts
  - docs/ARCHITECTURE.md, whose sentence on `base-sync.ts` (:20) stays true
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Tests first, in two commits: the first adds the new tests, the assertion of acceptance 7 and the three sentences of acceptance 8, with a seam in src/probes/base-sync.ts that exports `gitLazyFetchSupport` returning `unknown` and `baseSyncChecks` returning `{ baseSync: baseSyncReport(input) }`, so acceptance 1 to 5 fail by assertion and 8 fails for the new sentences; the second adds the code and the documents. Revert table, each row a scratch change restored afterwards: the `plain` branch of `baseSyncReport` dropped (2 and 3 red); `promisor` treated as `plain` (4 red); exit 129 widened to any non-zero exit (1 red); the `git config` exit 1 rule widened to any non-zero exit (1 red); a second probe call added (1 red on the call list); the `gitLazyFetch` key put before `baseSync` (3 red); the key added for `accepted` (5 red). Run `npm test` once before the first review: tests/core/parse-guard.test.ts and tests/infra/update-json.test.ts scan all of src, and several test files run doctor. Insert the CHANGELOG entry directly above the entry that begins `- reliability-baseline-2`, followed by a blank line."
---

# T1-GIT-LAZY-FETCH-PROBE

## Deliverable
On a git that refuses `--no-lazy-fetch`, `aidlc doctor` reads `baseSync` without the option in a repository with no promisor remote, keeps the refusal in a repository that has one, and prints a `gitLazyFetch` line that says which applies. The probe that decides this is exported from `src/probes/base-sync.ts` for T1-IDENTITY-READ-OLD-GIT. The README states the git release each feature needs.

## Why
Outside review of 2026-11-16 on git 2.43, confirmed on main at 35de54fe: every git call of the base-sync check runs as `git --no-lazy-fetch <command>` (src/probes/base-sync.ts:29), which a git older than 2.45 refuses with exit 129, so `baseSync` is `UNREADABLE` there (docs/OPERATIONS.md:37), while README.md:17 names 2.38 only. The option exists so that a partial clone never fetches a missing object. A repository with no promisor remote has nothing to fetch, so the option can be left out there. Spec specs/install-portability.md R8 to R10.

Shape. The probe runs the option itself, never a version comparison. `baseSyncReport` takes the probe result as an optional input, so every existing test of it, which passes none, holds unchanged. `baseSyncChecks` gives doctor both entries, so the refused case is testable with an injected runner; no CI runner has a git older than 2.45.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/base-sync.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/infra/github-ship.test.ts tests/surface/init-no-package.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. The probe
First call: `git --no-lazy-fetch version`.

- Exit code 0 and not timed out: `accepted`. No second call.
- Exit code 129 and not timed out: second call `git config --get-regexp ^(remote\..*\.promisor|extensions\.partialclone)$` (one argv element for the pattern). Exit code 1 and not timed out: `plain`. Any other answer (exit code 0, another exit code, no exit code, a timeout, a runner that throws): `promisor`.
- Any other answer of the first call (another exit code, no exit code, a timeout, a runner that throws): `unknown`. No second call.

git matches the pattern against the key with its section and variable names in lower case, so `extensions.partialClone` and `remote.<name>.promisor` under any remote name match.

### 2. The doctor texts
- `plain`: `git refuses --no-lazy-fetch (git older than 2.45): this repository has no promisor remote, so the checks that use the option run git without it`
- `promisor`: `git refuses --no-lazy-fetch (git older than 2.45) and this repository has a promisor remote: the checks that use the option are refused until git is 2.45 or newer`

### 3. The README bullet
`- git (state lives in the main checkout's `.aidlc/` so all worktrees share it); 2.38 or newer for the `github` ship path, whose base sync tests the merge with `git merge-tree --write-tree`, and 2.45 or newer in a partial clone (a repository with a promisor remote), where the reads that must not fetch need `git --no-lazy-fetch`.`

### 4. The OPERATIONS sentences
In place of the sentence that begins `Every git call of the check runs as` and ends `(exit 129)`.`:

1. `Every git call of the check runs as `git --no-lazy-fetch <command>`, so a partial clone never fetches a missing object from its promisor remote.`
2. `A git older than 2.45 refuses the option (card T1-GIT-LAZY-FETCH-PROBE): doctor finds that by running `git --no-lazy-fetch version`, never from a version number, and then asks `git config` whether a `remote.<name>.promisor` or `extensions.partialclone` key is set; with none set the check runs its git calls without the option, since a repository with no promisor remote has nothing to fetch, and with one set, whatever its value, the value stays `UNREADABLE: git rev-parse failed (exit 129)`.`
3. `In both cases doctor prints a `gitLazyFetch` line directly after `baseSync` that says which applies; on a git that accepts the option the line is absent.`

### 5. The CHANGELOG entry
`- T1-GIT-LAZY-FETCH-PROBE: on a git that refuses `--no-lazy-fetch` (older than 2.45), `aidlc doctor` reads `baseSync` without the option when the repository has no promisor remote, where before the value was `UNREADABLE: git rev-parse failed (exit 129)`; with a `remote.<name>.promisor` or `extensions.partialclone` key set the value stays that refusal. Doctor finds the refusal by running `git --no-lazy-fetch version` and prints a `gitLazyFetch` line after `baseSync` in both cases, and no such line on a git that accepts the option. `src/probes/base-sync.ts` exports the probe (`gitLazyFetchSupport`). The README states 2.38 for the `github` ship path and 2.45 for a partial clone.`
