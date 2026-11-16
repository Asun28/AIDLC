---
slug: install-portability
title: A machine that is not the author's can install aidlc, run init and keep working guards
author: asun28 (owner)
status: draft
created: 2026-11-16T02:30:00Z
source: human
---

# Intent: a machine that is not the author's can install aidlc, run init and keep working guards
Author: asun28 (owner). Status: draft.

## Problem
An outside review of 2026-11-16 (commit 7001e96, Linux, Node 22.23.4, git 2.43.0) could not
install or run aidlc outside this checkout. Each point was checked against main at 35de54fe on
2026-11-16:

- `npm i -D git+file:///D:/Projects/AIDLC` (Windows, Node 22.23.1) installs `LICENSE`,
  `README.md`, `bin/`, `package.json` and `templates/` and neither `dist/` nor `src/`;
  `npx --no-install aidlc --version` then fails with `ERR_MODULE_NOT_FOUND` for
  `src/cli/main.ts`. `package.json` builds in `prepack` only. The same install from a clone
  whose `package.json` adds `"prepare": "npm run build"` holds `dist/` and prints `0.2.0`
  (scratch experiment, not committed).
- The name `aidlc` on the npm registry is another project (`aidlc-io/aidlc` 3.0.0, read with
  `npm view aidlc`), so `templates/` workflows that call `npx --no-install aidlc` depend on a
  git or path install.
- `resolveHookCommand` (`src/scaffold/init.ts:219`) writes `node "<absolute path>/bin/aidlc-hook.js"`
  into the committed `.claude/settings.json` of a target with no aidlc package.
  `plans/init-no-node.md` accepted this for personal use: on another machine the hook exits 1
  and the guards are off.
- `readOpenedSource` (`src/loop/context-pack.ts:58`) throws
  `Opened context source verification requires Windows or Linux` on any other platform. The CI
  matrix is `ubuntu-latest` and `windows-latest` (`.github/workflows/ci.yml:23`).
- Every base-sync git call and the finding-identity read run as `git --no-lazy-fetch`
  (`src/probes/base-sync.ts:29`, `src/loop/card-runner.ts:356`), which git older than 2.45
  refuses with exit 129 (`docs/OPERATIONS.md:37`). `README.md:17` states git 2.38. The review
  reports five failing tests of `tests/scenarios/finding-identity.test.ts` on git 2.43.
- `templates/aidlc.config.json` sets `provider: mock`, `shipPath: dry-run` and an empty
  `formalReview.command`; no documented path leads from `aidlc init` to a first real pull request.

## Proposed outcome
1. `npm i -D github:Asun28/AIDLC`, and a tarball of `npm pack`, install a CLI that starts; a
   script proves it and CI runs the script on pushes. The package builds once per packaging
   operation.
2. `aidlc init` writes a machine-specific hook command into `.claude/settings.local.json` and
   never an absolute path into `.claude/settings.json`.
3. A `run-card` directive loads its context pack on macOS.
4. The README and `aidlc doctor` state git 2.45 or newer as the one supported minimum, so
   the two documented versions no longer disagree.
5. `aidlc init --profile claude-github` writes a configuration that can ship a pull request
   with the Claude Code provider, the `github` ship path, a required review gate and a Claude
   formal reviewer whose model the caller names at setup, and a quickstart lists the steps
   from install to the first pull request.
6. CI runs the suite on `macos-latest` on pushes, as a job that is not a required check.

## Affected users and systems
A team installing aidlc into its own repository; `package.json`, `scripts/`,
`.github/workflows/ci.yml`, `src/scaffold/init.ts`, `src/loop/context-pack.ts`,
`src/cli/main.ts` (doctor line, init option), `templates/`, `README.md`,
`docs/OPERATIONS.md`, `CHANGELOG.md`.

## Constraints
- Owner decision of 2026-11-16: the machine-specific hook command goes to
  `.claude/settings.local.json`; the committed `.claude/settings.json` keeps no absolute path.
- No new provider, ship path or stage; `--profile` is an option of the existing `init` command.
- Publishing to the npm registry and the rename are not in this goal.
- Owner decision of 2026-11-17 (approval of the reviewed plan, in the session): support for
  a git older than 2.45 is not built now. The probe of `--no-lazy-fetch` support and the
  finding-identity read on an old git are deferred (drafts at commit 33b32e01), and no code of
  `src/probes/base-sync.ts` or `src/loop/card-runner.ts` changes in this goal.
- Owner decision of 2026-11-17: the install check runs on pushes only, so a registry outage
  cannot stop a ship; the profile names no reviewer model of its own and sets `gateRequired`.
- Cards of at most 200 changed lines and at most 8 allowed paths.

## Open questions
- (none)
