---
id: T0-DOD-VENV
title: "The DoD call (dodCall) runs the dod_command with the scripts directory of a Python virtualenv first on PATH when the card worktree or, for the loop-run DoD, the main checkout holds one (.venv, else venv), and the loopDod record names that virtualenv"
status: todo
branch: T0-DOD-VENV
worktree: D:\wt\AIDLC\T0-DOD-VENV
allow_paths:
  - src/probes/virtualenv.ts
  - src/review/mutants.ts
  - src/loop/card-runner.ts
  - src/core/types.ts
  - tests/infra/virtualenv.test.ts
  - tests/scenarios/dod-virtualenv.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-DOD-VENV.md
  - specs/tasks/T0-DOD-VENV.md
dod_command: npm run typecheck && node --test tests/infra/virtualenv.test.ts tests/scenarios/dod-virtualenv.test.ts tests/scenarios/dod-record.test.ts tests/infra/dod-shell.test.ts tests/surface/loop-evidence-docs.test.ts tests/infra/stray-processes.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. New file `src/probes/virtualenv.ts` shall export `virtualenvFor(roots: readonly string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { dir: string; env: NodeJS.ProcessEnv } | undefined`. For each root in order, and in each root for the names `.venv` then `venv`, the directory `dir = path.join(root, name)` is a virtualenv when `dir/pyvenv.cfg` is a regular file and its scripts directory (`dir/Scripts` on win32, `dir/bin` elsewhere) is a directory; a path that cannot be read counts as absent. The first virtualenv found is returned, else undefined.
  - R2. The returned `env` shall be a new object holding every variable of the given `env` except as follows, and the given object shall not be changed. `PATH` is the scripts directory, followed by the platform delimiter (`;` on win32, `:` elsewhere) and the previous value when that value is not empty. `VIRTUAL_ENV` is `dir`. `PYTHONHOME` is absent. On win32 a variable is every key whose upper-case form is its name (as `envValue` of src/core/env-name.ts reads it): the previous `PATH` value is `envValue(env, 'PATH', 'win32')`, the result keeps one key per variable, spelled as the first own key of that name in the given `env` (else in upper case), and holds no other spelling of it.
  - R3. `dodCall` (src/review/mutants.ts) shall take a fifth parameter `roots: readonly string[] = [worktree]`. WHEN `virtualenvFor(roots)` returns a virtualenv, the options of the call, on every ship path, shall carry `env` of R2; otherwise the call shall be the call of main at 450c3328, with no `env` key. `runMutants` keeps its call, so the DoD runs of `aidlc card mutants` look in the card worktree only.
  - R4. `CardRunner.loopDod` (src/loop/card-runner.ts) shall call `dodCall` with the roots `[worktree, this.repo.mainRoot]`. The `loopDod` record of a DoD that ran shall carry `virtualenv`, the `VIRTUAL_ENV` of the call's `env`, when the call has an `env`, and no `virtualenv` key otherwise. The `ran: true` member of `LoopDod` (src/core/types.ts) gains `virtualenv: z.string().optional()`; a record written before this card parses unchanged.
  - R5. The loop-run DoD shall stay a record that changes no card state, outcome or allowance (gating it is card T1-DOD-GATE, issue 124); `recordAttempt` makes the same store writes and journal appends in the same order, and the `aidlc card status` line is unchanged.
  - R6. docs/OPERATIONS.md (a new paragraph directly before the DoD shell paragraph), docs/ARCHITECTURE.md (a `virtualenv.ts` sentence in the `src/probes/` paragraph, before the `processes.ts` sentence) and changelog.d/T0-DOD-VENV.md shall state R1 to R4: where the DoD call looks, the order, what it changes in the environment, and the `virtualenv` field.
acceptance:
  - 1. New file `tests/infra/virtualenv.test.ts`, real temporary directories made with `mkdtempSync` and removed in a finally block. Rows - (a) a root holding `.venv/pyvenv.cfg` and `.venv/bin` with platform `linux` returns `dir` `<root>/.venv` and `PATH` `<root>/.venv/bin:/usr/bin` from `{ PATH: '/usr/bin' }`; (b) `.venv/Scripts` with platform `win32` and the env `{ Path: 'C:\\x', PATH: 'C:\\y', PYTHONHOME: 'h', pythonhome: 'h2', virtual_env: 'old', KEEP: 'k' }` returns an env whose keys are exactly `Path`, `KEEP` and `virtual_env` (the spelling given) with `Path` the scripts directory `path.join(root, '.venv', 'Scripts')` followed by `;C:\\x`, and `virtual_env` `path.join(root, '.venv')`; (c) no PATH at all gives `PATH` the scripts directory alone; (d) `.venv` without `pyvenv.cfg` and a `venv` with both is `venv`; (e) `.venv` and `venv` both valid is `.venv`; (f) roots `[a, b]` with a virtualenv in both is `a`'s, and with one only in `b` is `b`'s; (g) a root that does not exist, and a `.venv` whose scripts directory is a file, return undefined; (h) the env given is deep-equal to a copy taken before the call. RED on main: the module does not exist. [R1] [R2] [dod arm 2]
  - 2. Same file: `dodCall({ dod_command: 'x' }, wt, 5000, ship, [wt])` with a virtualenv in `wt` carries `env` whose `VIRTUAL_ENV` is `<wt>/.venv` for `github`, `dry-run` and `scaffold`, the rest of the call as on main; with no virtualenv the call deep-equals the four-argument call. [R3] [dod arm 2]
  - 3. New file `tests/scenarios/dod-virtualenv.test.ts`, a card at BUILD built as `atBuild` of tests/scenarios/dod-record.test.ts builds it (real `runSync` for the DoD), with `dod_command` `aidlc-venv-probe-450`, a command name no PATH holds. The main checkout (`fx.repo.mainRoot`) holds `.venv/pyvenv.cfg` and, in the platform's scripts directory, a probe program of that name (`aidlc-venv-probe-450.cmd` on win32, an executable `sh` script elsewhere) that prints `main venv` and exits 0. A recorded success stores a `loopDod` with `exitCode` 0, `virtualenv` `<mainRoot>/.venv` and an `outputTail` that holds `main venv`. RED on main: the exit code is not 0 and the record has no `virtualenv`. [R3] [R4] [dod arm 3]
  - 4. Same file: with also a `venv` in the card worktree whose probe prints `worktree venv`, the record has `virtualenv` `<worktree>/venv` and the tail holds `worktree venv` and not `main venv`. [R1] [R4] [dod arm 3]
  - 5. `tests/scenarios/dod-record.test.ts` (whose fixture holds no virtualenv: the runner options and the record deep-equal those of main, no `env` and no `virtualenv`), `tests/infra/dod-shell.test.ts`, `tests/surface/loop-evidence-docs.test.ts`, `tests/infra/stray-processes.test.ts` and `tests/scenarios/fault-points.test.ts` pass with no line changed. [R3] [R5] [dod arms 4-8]
  - 6. The typecheck is clean; the texts of R6 (reviewer-verified against the diff); the fragment has the form of `changelog.d/README.md` and the prose test passes. [R6] [dod arms 1, 9, 10]
depends_on: []
budget: 200
tdd: true
sweep: "On main at 450c3328. `git grep -n dodCall -- src tests`: src/review/mutants.ts:171 (definition), :195 (runMutants), src/loop/card-runner.ts:350 (loopDod), tests/infra/dod-shell.test.ts:60, 63, 77 (four arguments; unchanged by an optional fifth). `git grep -n -i -E 'venv|virtualenv|VIRTUAL_ENV' -- src`: none. The `LoopDod` record is deep-equal pinned in tests/scenarios/dod-record.test.ts:89 and its runner options at :90; the fixture's main checkout and worktree are fresh temporary directories, so neither gains a key. docs/OPERATIONS.md pins: the DoD shell paragraph is followed by the DoD receipt paragraph (dod-shell.test.ts:189) and the loop-run DoD paragraph by `### T1 feature` (loop-evidence-docs.test.ts:59), so the new paragraph goes before the DoD shell paragraph; nothing pins the line before it. docs/ARCHITECTURE.md: the `src/probes/` paragraph must end with the `processes.ts` sentence (stray-processes.test.ts:662)."
forbid: [network, a change to an existing test file]
non_goals:
  - "gating an attempt on the loop-run DoD's exit, or recording a failing re-run as an environment failure: card T1-DOD-GATE (issue 124) owns what a differing exit does"
  - "a config key for the DoD environment, conda or other environment managers, running an activate script, or a virtualenv outside the two roots"
  - "the main checkout as a root for `aidlc card mutants` (src/cli/main.ts, which another goal holds)"
  - "a change to the `aidlc card status` line"
diagnosis:
  root_cause: "`CardRunner.loopDod` (src/loop/card-runner.ts:346) runs the `dod_command` through `dodCall` (src/review/mutants.ts:171), whose options carry no `env`, so the child inherits the loop process's PATH. A worker that ran the DoD with the repository's `.venv` active got exit 0; the loop's re-run resolved `python` to the system interpreter and failed at import (issue 450, llm-wiki-flywheel cards T1-KBCITE-CHECK and T1-KBCITE-ECHO)."
  same_class: "The DoD runs of `aidlc card mutants` use the same `dodCall` and gain the worktree root. No other caller runs a `dod_command`."
hygiene: "Issue 450. A virtualenv directory is untracked, so a fresh card worktree usually has none and the worker uses the main checkout's: the loop-run DoD looks in the worktree first, then the main checkout. The environment goes in as a variable object, never through the shell text, so no path is quoted into a command line and a `$`, backtick, `%` or quote in a path changes nothing. RED first: the new tests committed against main's code before the fix. Test environments are built per call (lessons of T0-BIN-STALE-DIST-4 and T0-REVIEWER-UTF8): the unit rows pass their own env objects; the scenario probe name is one no PATH holds, so the host's PATH cannot make it pass. The verify-card-run-writes check runs before SHIP since src/loop/card-runner.ts is in its coverage record (recordAttempt's writes are unchanged)."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, changelog.d/T0-DOD-VENV.md
---

# T0-DOD-VENV

From issue 450.

## Diagnosis
The loop-run DoD of a successful `card attempt` inherits the loop's PATH. In a Python repository whose DoD needs the repository's virtualenv, the worker's run with the virtualenv active passes and the loop's re-run uses the system `python` and fails at import.

## Deliverable
The DoD call puts the scripts directory of a virtualenv first on PATH, sets `VIRTUAL_ENV` and removes `PYTHONHOME`, as an activate script does, when the card worktree or (for the loop-run DoD) the main checkout holds `.venv` or `venv` with a `pyvenv.cfg`. The `loopDod` record names the virtualenv it used.

## PR summary
### What
The loop's DoD re-run now uses the repository's Python virtualenv when the card worktree or the main checkout has one.

### Why / Intent
Issue 450. The worker's DoD passed with `.venv` active, and the loop's re-run used the system Python and failed at import.

### How / Behaviour
- `virtualenvFor` finds `.venv`, else `venv`, holding `pyvenv.cfg` and its scripts directory, in the given roots in order.
- `dodCall` runs the DoD with that scripts directory first on PATH, `VIRTUAL_ENV` set and `PYTHONHOME` removed.
- The loop-run DoD looks in the card worktree, then the main checkout; `aidlc card mutants` looks in the worktree.
- The `loopDod` record carries `virtualenv` when one was used.

### System impact
A repository with no virtualenv in either root runs the DoD exactly as before. The loop-run DoD still changes no card state.

### Security
No new command. Paths go into the environment object, not into a shell command line.

### Tests and review
- Unit rows over real temporary directories for the lookup order, the layout per platform and the environment it builds.
- A scenario runs a probe program from a virtualenv in the main checkout, and one in the worktree that takes precedence.
- The existing DoD record, DoD shell, docs and fault-point tests pass unchanged.

### Risk
Low. Only a repository holding a virtualenv in one of the two roots sees a different PATH.

### Ownership
Card `T0-DOD-VENV`, issue 450.

### Docs
`docs/OPERATIONS.md` (new paragraph before the DoD shell paragraph), `docs/ARCHITECTURE.md` (`src/probes/`) and `changelog.d/T0-DOD-VENV.md`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/virtualenv.test.ts tests/scenarios/dod-virtualenv.test.ts tests/scenarios/dod-record.test.ts tests/infra/dod-shell.test.ts tests/surface/loop-evidence-docs.test.ts tests/infra/stray-processes.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, and the DoD record, DoD shell, docs and fault-point tests pass unchanged.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
