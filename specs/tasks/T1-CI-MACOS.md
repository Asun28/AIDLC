---
id: T1-CI-MACOS
title: ci.yml gains a check-macos job that runs npm ci, the typecheck and the suite on macos-latest on pushes, continues on error and is not a required check
status: todo
branch: T1-CI-MACOS
worktree: D:\wt\AIDLC\T1-CI-MACOS
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - .github/workflows/ci.yml
  - tests/surface/ci-macos.test.ts
  - changelog.d/T1-CI-MACOS.md
  - specs/tasks/T1-CI-MACOS.md
dod_command: npm run typecheck && node --test tests/surface/ci-macos.test.ts tests/surface/install-smoke.test.ts tests/surface/bench.test.ts tests/surface/workflow-permissions.test.ts tests/surface/init-base-ci.test.ts tests/surface/review-bench.test.ts tests/core/config.test.ts tests/surface/ci-shard.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. `.github/workflows/ci.yml` shall gain the job `check-macos` of acceptance detail 1 after the last job of the file, with every other job, the triggers (:3-13), the top-level `permissions` block (:15-16) and the top-level `concurrency` block of T1-CI-SHARD unchanged.
  - R2. The job shall carry `continue-on-error: true` at job level and the condition `github.event_name == 'push'`, so its failure does not fail the workflow run and it reports `skipped`, not a failure, on a pull request head.
  - R3. `tests/surface/ci-macos.test.ts` (new) shall read the parsed workflow and `aidlc.config.json` and hold the two tests of the acceptance list.
  - R4. The new changelog.d/T1-CI-MACOS.md shall hold the entry of acceptance detail 2 followed by one line feed.
acceptance:
  - 1. `tests/surface/ci-macos.test.ts`, "T1-CI-MACOS acceptance 1: ci.yml has a check-macos job on macos-latest that runs npm ci, the typecheck and the suite in that order, continues on error, runs on push only and has no permissions key". The parsed job: `runs-on` is `macos-latest`, `continue-on-error` is `true`, `if` is `github.event_name == 'push'`, the `run` steps are `npm ci`, `npm run typecheck` and `npm test` in that order, the job has no `strategy` and no `permissions` key, and the checkout and setup-node steps are those of acceptance detail 1. Fails on main (no such job). [R1] [R2] [R3] [dod arm 2]
  - 2. Same file, "T1-CI-MACOS acceptance 2: no required check names macOS, the check job still runs on ubuntu-latest only and the Windows suite in check-windows-shard". `github.requiredChecks` of `aidlc.config.json` deep-equals the four names of tests/core/config.test.ts:10 and none contains `macos`; `jobs.check.strategy.matrix.os` deep-equals `['ubuntu-latest']` and `jobs['check-windows-shard']['runs-on']` is `windows-latest` (card T1-CI-SHARD). Passes on the base, main with T1-CI-SHARD and T1-INSTALL-GIT-DEP, and with this card. [R1] [R3] [dod arm 2]
  - 3. tests/surface/install-smoke.test.ts (the job of T1-INSTALL-GIT-DEP), tests/surface/ci-shard.test.ts (the jobs `check`, `check-windows-shard` and `check-windows`, the triggers, `permissions` and `concurrency` of T1-CI-SHARD, and no other job named `check (windows-latest, 22)`), tests/surface/bench.test.ts (:211-221), tests/surface/workflow-permissions.test.ts (:152-160), tests/surface/init-base-ci.test.ts (:375-389), tests/surface/review-bench.test.ts (:417) and tests/core/config.test.ts pass with no line changed. They pass on the base and with this card. [R1] [dod arm 2]
  - 4. changelog.d/T1-CI-MACOS.md holds the entry of acceptance detail 2 followed by one line feed (reviewer-verified against the diff), and tests/surface/changelog-fragments.test.ts passes with the new file. [R4] [dod arm 2]
depends_on: [T1-INSTALL-GIT-DEP, T1-CONTEXT-PACK-POSIX, T1-CI-SHARD, T1-CHANGELOG-FRAGMENTS]
budget: 70
tdd: true
sweep: "On main at 35de54fe. `grep -rnE 'ci\\.yml|ubuntu-latest|windows-latest|macos' tests/`: no test names macOS. Readers of ci.yml or of every workflow file: tests/surface/bench.test.ts:211-221 (the `bench` and `check` jobs), tests/surface/workflow-permissions.test.ts:152-160 (`ciPermissionsExact` is false when a job has its own `permissions`), tests/surface/init-base-ci.test.ts:375-389 (no bare `npx aidlc`), tests/surface/review-bench.test.ts:417 (no `review bench` text), and after T1-INSTALL-GIT-DEP tests/surface/install-smoke.test.ts (the `install-smoke` job). tests/core/config.test.ts:10 and :38-40 pin the four names of `github.requiredChecks`: `check (ubuntu-latest, 22)`, `check (windows-latest, 22)`, `build-test`, `Gitleaks (committed history)`. The github ship path requires every check run reported on a pull request head to conclude success, neutral or skipped, whether or not its name is required (src/delivery/github-ship.ts:384-391); a job that fails with `continue-on-error: true` still reports a failed check run for that job, so without the push condition one macOS-only test failure would stop every ship of this repository. A job skipped by its `if` reports `skipped`, which :391 accepts for a name that is not required. The triggers of ci.yml (:3-13) are a push to main or master, with docs paths ignored, and every pull request. ci.yml has no template copy under templates/github/workflows. After T1-CI-SHARD, `check` runs on ubuntu-latest only, the Windows suite runs in the four `check-windows-shard` jobs behind the job `check-windows` named `check (windows-latest, 22)`, a top-level `concurrency` block gives each push run a group of its own, and tests/surface/ci-shard.test.ts reads ci.yml (T1-CI-SHARD acceptance 1 to 4); none of its assertions reads another job, apart from requiring that no other job is named `check (windows-latest, 22)`, which `check-macos` meets since it has no `name`, so the new job breaks none of them; and a push run, the only run the job takes part in, is never cancelled by that group."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of a test file that exists on main
  - an edit of aidlc.config.json, or a macOS name in `github.requiredChecks`
  - a `permissions` key on the job, a change to the top-level `permissions` block, or a change to another job or to the triggers
  - `continue-on-error` on a step in place of the job, or a job without the push condition
  - a change to another workflow, to a template or to a file under src or tests that exists on main
  - a skip or a platform condition added to a test so that it passes on macOS
  - the sequence of two hash signs and a space in the entry
non_goals:
  - making the macOS job a required check
  - fixing a test that fails on macOS; each such failure becomes a follow-up issue after the first run on main
  - running the job on pull requests; that needs either a suite that is green on macOS or a rule in the github ship path that lets a named check fail, and neither is in this goal
  - the `build`, bench and install-smoke steps on macOS
  - reading the result of the job from the loop; nothing in aidlc reads the checks of a commit on main for this job
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE, after T1-CI-SHARD and T1-INSTALL-GIT-DEP have merged, since each changes the same file (T1-CI-SHARD first). Not verified when this card was written, taken from GitHub's documented behaviour as the author recalls it: that a failed job with job-level `continue-on-error: true` reports a failed check run while the workflow run concludes success, and that a job whose `if` is false reports a check run with the conclusion `skipped`. The first cannot be seen from this card's own pull request, where the job is skipped; the second can: at CLOSE, read the check runs of the pull request head and record in this file that `check-macos` reported `skipped`. If it reported anything else, open a follow-up issue before the next ship. The first real run of the job is the push of the merge commit to main; read its result then and open one follow-up issue per failing test. Tests first, in two commits: the first adds tests/surface/ci-macos.test.ts and records acceptance 1 failing on main while acceptance 2 passes; the second adds the job. Revert table, each row a scratch change restored afterwards: `continue-on-error` removed (1 red); the `if` removed (1 red); `npm test` before `npm run typecheck` (1 red); a `permissions` key added to the job (1 red, and workflow-permissions.test.ts red)."
---

# T1-CI-MACOS

## Deliverable
The `ci` workflow runs the typecheck and the suite on `macos-latest` for every push it is triggered by. The job cannot fail the workflow run and is not a required check.

## Why
Outside review of 2026-11-16: the `ci` workflow runs the suite on `ubuntu-latest` (`check`) and `windows-latest` (`check-windows-shard`, card T1-CI-SHARD) only, so nothing shows whether the suite runs on macOS. T1-CONTEXT-PACK-POSIX removes the one known refusal there. Spec specs/install-portability.md R13.

The plan asks for a job with `continue-on-error: true` that is not in `github.requiredChecks`. That alone is not enough for this repository: the github ship path stops a ship when any check run on the pull request head failed, required or not (src/delivery/github-ship.ts:384-391), and the plan expects macOS-only failures (plans/install-portability.md, Risks). The job therefore runs on pushes only and is skipped on pull requests, so it reports on main and never on a pull request head. Whether to run it on pull requests later is the owner's decision; the non_goals name what that needs.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/ci-macos.test.ts tests/surface/install-smoke.test.ts tests/surface/bench.test.ts tests/surface/workflow-permissions.test.ts tests/surface/init-base-ci.test.ts tests/surface/review-bench.test.ts tests/core/config.test.ts tests/surface/ci-shard.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. The job
```yaml
  check-macos:
    if: github.event_name == 'push'
    runs-on: macos-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```
A comment above the job says that it is not a required check, that it is skipped on pull requests because the ship path requires every reported check to pass, and that its failures become follow-up issues.

### 2. The entry
changelog.d/T1-CI-MACOS.md (new), this one line and one line feed:

"- T1-CI-MACOS: the `ci` workflow gains the job `check-macos`, which runs `npm ci`, the typecheck and the suite on `macos-latest` for each push that triggers the workflow. The job has `continue-on-error: true`, so its failure does not fail the workflow run, and it is not in `github.requiredChecks`. It is skipped on pull requests, because the `github` ship path requires every check reported on a pull request head to pass; a test that fails on macOS becomes a follow-up issue."
