---
id: T0-CI-PERMISSIONS
title: ci.yml sets permissions contents read at the top level as the other four workflows do, and a test requires that of every workflow and the exact block of ci.yml
status: todo
branch: T0-CI-PERMISSIONS
worktree: D:\wt\AIDLC\T0-CI-PERMISSIONS
allow_paths:
  - .github/workflows/ci.yml
  - tests/surface/workflow-permissions.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-CI-PERMISSIONS.md
dod_command: npm run typecheck && node --test tests/surface/workflow-permissions.test.ts tests/surface/bench.test.ts tests/surface/init-base-ci.test.ts tests/surface/review-bench.test.ts
dod_exit: 0
requirements:
  - R1. `.github/workflows/ci.yml` shall gain a top-level `permissions:` block holding only `contents: read`, after the blank line :14 and before `jobs:` :15, with one blank line after it (the form of aidlc-ci.yml:13-16); nothing else in the file changes and no job gets a `permissions` key. No step needs more: `actions/checkout@v4` reads the repository; `actions/setup-node@v4` with `cache: npm` and `npm ci` use the Actions cache and the npm registry, which the token's scopes do not govern (taken from GitHub's documentation; the pull request's first CI run confirms it, and the Attempt evidence records that run's cache restore and save steps); typecheck, test, build and `npm run bench -- --check` run locally; the doctor step runs local version probes with `|| true`; no step uploads, comments, pushes, tags or calls the GitHub API.
  - R2. `tests/surface/workflow-permissions.test.ts` (new) shall define `permissionProblems(text)`, which parses a workflow with `YAML.parse` of `yaml` (a parse error propagates) and returns its problems. A mapping is a plain object as `YAML.parse` returns for a YAML mapping (not null, not an array). A value is rendered with `JSON.stringify`, a missing one as `absent`. Problems, in this order: a top-level `permissions` that is not a mapping, `top-level permissions is not a mapping of scopes`, and no other top-level problem; else a `contents` other than the string `read`, `top-level contents is <value>`, then each other scope in key order whose value is not the string `read` or `none`, `top-level <scope> is <value>`; then `jobs` present and not a mapping, `jobs is not a mapping of jobs`; else for each job in key order, a job that is not a mapping, `job <id> is not a mapping`; a `permissions` that is present and neither the string `read-all` nor a mapping, `job <id> permissions is not "read-all" or a mapping of scopes: <value>`; each scope of a mapping whose value is not the string `read` or `none`, `job <id> <scope> is <value>`.
  - R3. The same file shall define `ciPermissionsExact(text)`, true only when the top-level `permissions` deep-equals `{ contents: 'read' }` and no job has an own `permissions` property; and shall require that every `.yml` and `.yaml` file of `.github/workflows` (at least five, `ci.yml` among them) has no problem of R2 and that ci.yml is exact.
  - R4. CHANGELOG.md, Unreleased, shall carry the entry of acceptance detail 5 directly above the entry that begins `- T0-CARDS-PROJECTED-REENTRY`.
acceptance:
  - 1. `tests/surface/workflow-permissions.test.ts` "permissionProblems on each input class": each row gives its exact list and a malformed YAML throws. New checker; each clause removed fails a row. [R2] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. Same file, "ciPermissionsExact refuses an added read scope and a job override". New checker; each clause removed fails a row. [R3] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. Same file, "every workflow under .github/workflows has no permission problem and ci.yml is exact". Fails on main for ci.yml (`top-level permissions is not a mapping of scopes`). [R1] [R3] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. tests/surface/bench.test.ts, tests/surface/init-base-ci.test.ts and tests/surface/review-bench.test.ts, the readers of ci.yml, pass unchanged. Passes on main and with this card. [R1] [dod arm 1] Detail: body section Acceptance detail, item 4.
  - 5. The CHANGELOG entry is the text of the detail (reviewer-verified against the diff). [R4]
depends_on: []
budget: 200
tdd: true
diagnosis:
  root_cause: "`.github/workflows/ci.yml` has no `permissions` block (:1-15), so the token of its `check` and `bench` jobs gets the repository's default scopes, while agent-evals.yml:13, aidlc-ci.yml:14, docs-check.yml:17 and security-scanners.yml:10 each set `contents: read`. No test reads the `permissions` key of any workflow, so nothing pinned the four or caught the fifth."
  repro: "git grep -n 'permissions' -- .github on main at 37ce711f: four hits, none in ci.yml."
  same_class: "The five workflows of .github/workflows: four set the block, ci.yml is fixed here. The three workflow templates under templates/github/workflows (agent-evals, aidlc-ci, security-scanners) set `contents: read` and are not read by this card's test: a non-goal. No workflow sets a job-level `permissions`."
sweep: "On main at 37ce711f (ci.yml unchanged since 46eb7980). git grep -n 'permissions' -- .github templates/github tests: agent-evals.yml:13, aidlc-ci.yml:14, docs-check.yml:17, security-scanners.yml:10 and the three templates set `contents: read`, ci.yml sets none, no job sets any, no test reads the key. Readers of ci.yml or of every workflow file: tests/surface/bench.test.ts:211 (the bench and check jobs), tests/surface/init-base-ci.test.ts:374-389 (the npx form), tests/surface/review-bench.test.ts:416 (no review bench text); ci.yml has no template copy (templates/github/workflows holds agent-evals, aidlc-ci and security-scanners). Steps of ci.yml read for R1: check (:16-35: checkout, setup-node with cache npm, npm ci, typecheck, npm test, npm run build, doctor with || true), bench (:40-50: checkout, setup-node with cache npm, npm ci, npm run build, npm run bench -- --check). `yaml` is already a dependency (package.json:43)."
forbid:
  - weakening, skipping or deleting a test to go green
  - any change to ci.yml beyond the three lines of R1, a permission other than contents read, or a permissions key on a job
  - a change to another workflow or to a template
  - a new dependency
non_goals:
  - the workflow templates under templates/github/workflows
  - audit item H8 (the suite runs three times per pull request), no change by ruling
  - the process-tree tests of tests/infra/exec.test.ts (card T0-EXEC-TEST-LOAD)
hygiene: "Line numbers are from main at 37ce711f; read them again at PREPARE. Tests first, in two commits: the first adds tests/surface/workflow-permissions.test.ts whole with ci.yml unchanged and records acceptance 3 failing for ci.yml (`top-level permissions is not a mapping of scopes`, no permissions block) while acceptance 1 and 2 pass; the second adds the block of R1. Before the first R3, remove each clause of the two checkers in a scratch copy and record the row that fails (the revert lists of acceptance detail 1 and 2). Insert the CHANGELOG entry directly above the entry that begins `- T0-CARDS-PROJECTED-REENTRY`, followed by a blank line; T0-REGISTRY-PER-CALL uses the same anchor, and the later of the two merges main first. The npm-cache statement of R1 comes from GitHub's documentation; the Attempt evidence records the setup-node cache steps of the pull request's first CI run. The dod_command is the targeted DoD: the typecheck, this card's test file and the readers of ci.yml; before the first review the coordinator runs every test file that reads CHANGELOG.md and records the counts in the Attempt evidence; the full suite runs in CI. No file of the verify-card-run-writes coverage changes. Implementer: Sonnet 5.5 at low effort."
doc_sync: CHANGELOG.md
---

# T0-CI-PERMISSIONS

## Deliverable
`.github/workflows/ci.yml` sets `permissions: contents: read` at the top level, as the other four workflows do. A new test requires of every workflow under `.github/workflows` a top-level `contents: read` with no permission other than `read` or `none` at the top level or in any job, and of ci.yml exactly that block and no job override.

## Why
Audit of 2026-11-11, hygiene item H9; the coordinator decides and plans; split from the draft of T0-EXEC-TEST-LOAD after its Codex review of 2026-11-12, whose findings on the workflow checker are taken as ruled. ci.yml is the only workflow of five without a `permissions` block, so its token gets the repository's default scopes.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/workflow-permissions.test.ts tests/surface/bench.test.ts tests/surface/init-base-ci.test.ts tests/surface/review-bench.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. This is the targeted DoD; every test file that reads CHANGELOG.md runs at the coordinator's checkpoint before the first review.

## Acceptance detail

### 1
`describe('T0-CI-PERMISSIONS workflow permissions [R1] [R2] [R3]')`, test "permissionProblems on each input class". `OK` is `permissions:\n  contents: read\n`, `J` is `OK + 'jobs:\n  a:\n'`, and `P` is `top-level permissions is not a mapping of scopes`. Rows (text, exact list):
- accepted: `OK`; `permissions:\n  contents: read\n  actions: none\n`; `OK + 'jobs:\n  a:\n    runs-on: x\n'`; `J + '    permissions: read-all\n'`; `J + '    permissions:\n      contents: read\n      checks: none\n'`; `J + '    permissions: {}\n'`: each `[]`.
- top level not a mapping, each `[P]`: `name: x\n` (absent), `permissions:\n` (null), `permissions: read-all\n`, `permissions: write-all\n`, `permissions: [contents]\n`, `permissions: true\n`, `permissions: 1\n`, `permissions: ""\n`, and `- a\n` (a document that is a list).
- contents: `permissions: {}\n` `['top-level contents is absent']`; `contents: write` `['top-level contents is "write"']`; `contents: Read` `['top-level contents is "Read"']`; `contents: true` `['top-level contents is true']`; `contents:` (null) `['top-level contents is null']`.
- other scopes after `contents: read`: `pull-requests: write` `['top-level pull-requests is "write"']`; `id-token: WRITE` `['top-level id-token is "WRITE"']`; `actions: 1` `['top-level actions is 1']`.
- jobs container after `OK`: `jobs: [a]\n`, `jobs: x\n`, `jobs:\n` (null), each `['jobs is not a mapping of jobs']`.
- job container: `'jobs:\n  a: x\n'` `['job a is not a mapping']`; `'jobs:\n  a:\n'` (null) the same; `'jobs:\n  a: [1]\n'` the same.
- job permissions after `J`: `    permissions:\n` (null) `['job a permissions is not "read-all" or a mapping of scopes: null']`; `[contents]`, `true`, `1`, `""`, `Read-all`, `write-all`, each the same with its rendering (`["contents"]`, `true`, `1`, `""`, `"Read-all"`, `"write-all"`).
- job scopes: `contents: write` `['job a contents is "write"']`; `contents: true` `['job a contents is true']`.
- combined: `permissions:\n  contents: write\n  pull-requests: write\njobs:\n  a:\n    permissions:\n      contents: write\n  b: x\n` gives `['top-level contents is "write"', 'top-level pull-requests is "write"', 'job a contents is "write"', 'job b is not a mapping']`.
- `permissions: [\n` (malformed YAML): `permissionProblems` throws the parse error.
Revert list, each clause removed alone and failing a row: the mapping check of the top level (a falsy-value shortcut fails the `true`, `1` and list rows), the exact string `read` of contents (`Read`, `true`), `none` accepted, the other-scope check, the jobs container check, the job container check, `read-all` accepted at job level, the job scope check, the rendering (`"write"` against `write`), the key order (the combined row), the parse error swallowed (the malformed row).

### 2
Same describe, test "ciPermissionsExact refuses an added read scope and a job override": `OK + 'jobs:\n  a:\n    runs-on: x\n'` true; `permissions:\n  contents: read\n  actions: read\n` false (an added read scope, which `permissionProblems` accepts); `J + '    permissions: {}\n'` false (an empty job override, which `permissionProblems` accepts); `J + '    permissions:\n      contents: read\n'` false; `name: x\n` false. Reverts that fail a row: the deep equality replaced by a check of `contents` alone (the `actions: read` row), the job check removed or reading the truthiness of `permissions` (the `{}` row).

### 3
Same describe, test "every workflow under .github/workflows has no permission problem and ci.yml is exact": the `.yml` and `.yaml` files of `<repo>/.github/workflows` are at least five and include `ci.yml`; `permissionProblems` of each deep-equals `[]` (message: the file and its problems); `ciPermissionsExact` of ci.yml is true. On main `ci.yml` gives `[P]`. ci.yml with this card, lines 13 to 18: `  pull_request:`, blank, `permissions:`, `  contents: read`, blank, `jobs:`.

### 4
The readers of ci.yml, unchanged and in the DoD: tests/surface/bench.test.ts:211 parses the `bench` and `check` jobs (a top-level key changes neither); tests/surface/init-base-ci.test.ts:374-389 reads every workflow file for the bare `npx aidlc` form (the block adds none); tests/surface/review-bench.test.ts:416 reads every workflow for `review bench` (none added). This list is not every reader of CHANGELOG.md: those run at the coordinator's checkpoint (hygiene).

### 5
The CHANGELOG entry, one line, directly above `- T0-CARDS-PROJECTED-REENTRY`:

"- T0-CI-PERMISSIONS (CI, audit item H9): `.github/workflows/ci.yml` sets `permissions: contents: read` at the top level, as the other four workflows do; before, it had no `permissions` block, so the token of its `check` and `bench` jobs had the repository's default scopes. `tests/surface/workflow-permissions.test.ts` requires of every workflow under `.github/workflows` a top-level `contents: read` with no permission other than `read` or `none` at the top level or in any job, and of ci.yml exactly that block and no job override."

## Attempt evidence
- RED c124def8 (test file alone): acceptance 1, 2 pass; 3 fails `ci.yml: top-level permissions is not a mapping of scopes` (assertion).
- GREEN 7ea3da91: ci.yml lines 15-17 block, CHANGELOG entry above T0-CARDS-PROJECTED-REENTRY.
- Revert table on 7ea3da91, 14 of 14 red (checker clause mutated in a scratch copy of the test): top mapping as truthiness; contents exactly read; none accepted; other top scope; jobs container; job container; read-all at job level; job scope; rendering; key order; parse error swallowed; exact by contents alone; exact without job check; exact by truthiness of non-empty job permissions.
- DoD on 7ea3da91: exit 0, 95 tests, 95 pass, 0 fail.
- CHANGELOG sentence is true by ci.yml block and the live test (acceptance 3).
- Changed lines: see report, budget 170.
