---
id: T1-INIT-BASE-CI
title: aidlc init names the target's default branch and adds no workflow that needs a package.json, and no workflow runs npx in a form that can fetch a package
status: todo
branch: T1-INIT-BASE-CI
worktree: D:\wt\AIDLC\T1-INIT-BASE-CI
plan_ref: plans/init-no-node.md#order-of-work
allow_paths:
  - src/scaffold/init.ts
  - .github/workflows/agent-evals.yml
  - .github/workflows/aidlc-ci.yml
  - .github/workflows/docs-check.yml
  - templates/github/workflows/agent-evals.yml
  - templates/github/workflows/aidlc-ci.yml
  - tests/surface/init-base-ci.test.ts
  - tests/surface/command-lines.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-INIT-BASE-CI.md
dod_command: npm run typecheck && node --test tests/surface/init-base-ci.test.ts tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc init` creates `aidlc.config.json`, `base` shall be the remote default branch (`git symbolic-ref refs/remotes/origin/HEAD` with `refs/remotes/origin/` dropped), else the current branch (`git symbolic-ref HEAD` with `refs/heads/` dropped), else the template value. An existing config stays unchanged.
  - R2. WHEN the target holds an entry other than `.git` and no `package.json`, `initProject` shall not write `.github/workflows/aidlc-ci.yml` or `.github/workflows/agent-evals.yml`, and `report.skipped` shall carry each as `<path> (no package.json)`. `--force` does not override this, and `--dry-run` reports the same. An empty target and a target with a `package.json` get both, as at 417df0a. `security-scanners.yml` is always written.
  - R3. Every `npx aidlc` in `.github/workflows/agent-evals.yml`, `.github/workflows/aidlc-ci.yml`, `.github/workflows/docs-check.yml` and their copies under `templates/github/workflows/` shall read `npx --no-install aidlc`.
  - R4. The two lines of `tests/surface/command-lines.test.ts` that name `npx aidlc evals run` (43 and 46) shall name `npx --no-install aidlc evals run`; no other line of that file changes.
  - R5. `docs/OPERATIONS.md` shall carry the OPERATIONS paragraph of the Doc text section after the paragraph starting `Agent files name a model and an effort`.
  - R6. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/surface/init-base-ci.test.ts` - with real git repositories, `initProject` writes `base` `master` for a clone whose remote default branch is `master`, `develop` for a repository with no remote on branch `develop`, and `main` for a directory that is no repository; a tag named like the branch still gives the branch name; an existing `aidlc.config.json` keeps its bytes. [R1] [dod arm 2]
  - 2. Same file - over a directory holding one file and no `package.json`, neither workflow is written, `report.skipped` carries both reason strings, `security-scanners.yml` is written, and the same holds with `force` and `dryRun`. [R2] [dod arm 2]
  - 3. Same file - over an empty directory, and over a directory holding a `package.json`, both workflows are written. `.git` alone counts as empty. [R2] [dod arm 2]
  - 4. Same file - no workflow file under `.github/workflows/` or `templates/github/workflows/` holds `npx aidlc`. [R3] [dod arm 2]
  - 5. `tests/surface/command-lines.test.ts` - T1-EVALS-NO-KEY acceptance 1 passes on the new text, and the file differs from 417df0a by those two lines. [R4] [dod arm 2]
  - 6. Same file as 1 - `docs/OPERATIONS.md` holds the OPERATIONS paragraph and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R5] [R6] [dod arm 2]
depends_on: [T1-INIT-HOOK-PATH-2]
budget: 290
tdd: true
sweep: "git grep on main 417df0a: `npx aidlc` in workflows is .github/workflows/agent-evals.yml:29, aidlc-ci.yml:32 and 35, docs-check.yml:32 and templates/github/workflows/agent-evals.yml:29, aidlc-ci.yml:32 and 35; in tests it is tests/surface/command-lines.test.ts:43 and 46, while tests/surface/hooks.test.ts:709 names `npx aidlc doctor` for another reason and stays. `aidlc-ci.yml` and `agent-evals.yml` are pinned by tests/infra/init.test.ts:27 over an empty target, which is why an empty target keeps them. OPERATIONS:13 is the pinned Setup sentence (tests/infra/init.test.ts:166), so the new text is its own paragraph. `git grep 'base:'` over tests finds no assertion on the `base` of an initialised config. R1 uses full refs because `--short` printed `heads/develop` with a tag `develop` beside the branch."
forbid: [weakening or skipping a test to go green, editing tests/infra/init.test.ts, a change to `templates/aidlc.config.json`, any change to a workflow other than the `npx aidlc` text, an edit of any file under `.aidlc/`]
non_goals: [generating a workflow for another language, the review commands of a target, MyInspection's own card findings, the `npx --no-install aidlc` spellings elsewhere, the rename]
hygiene: "Prove each arm with a mutant: dropping the remote lookup fails the `master` case of acceptance 1; treating `.git` as content fails acceptance 3; letting `force` write the workflows fails acceptance 2. The doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
---

# T1-INIT-BASE-CI

## Deliverable
A config created by `aidlc init` names the target's default branch. A repository with no `package.json` gets no workflow that fails on every push, and no workflow can fetch the unrelated npm `aidlc` package.

## Implementation notes
- Read the directory before any write of `initProject`, since `init` itself creates entries: `readdirSync(target).filter((n) => n !== '.git')`, and a missing target counts as empty.
- The skip belongs in `copyTree` or a filter on its `rel`. `copyTree` already special-cases `.claude/settings.json`.
- Use `execFileSync('git', ['-C', target, 'symbolic-ref', ...], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })` in a try. A clone sets `origin/HEAD`, and a repository with no remote fails the first call.
- Set `cfg['base']` only when the lookup returns a name, next to `cfg['cardsDir']`.

## Doc text
OPERATIONS paragraph:

A config that `aidlc init` creates names the target's default branch (card T1-INIT-BASE-CI): the remote default, else the current branch, else `main`. On a repository with no `package.json`, `init` writes no `aidlc-ci.yml` and no `agent-evals.yml`, since both need one, and reports each as skipped. Every workflow calls `npx --no-install aidlc`, because a bare `npx aidlc` with no local package fetches the unrelated npm package of that name.

CHANGELOG entry:

- T1-INIT-BASE-CI (bugfix): a config that `aidlc init` creates names the target's default branch, and a repository with no `package.json` gets no `aidlc-ci.yml` and no `agent-evals.yml`, each reported as skipped. Every workflow calls `npx --no-install aidlc`, so a repository with no local package cannot fetch the unrelated npm package of that name.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/init-base-ci.test.ts tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed file passes; the acceptance tests name their acceptance number.
