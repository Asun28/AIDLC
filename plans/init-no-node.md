---
slug: init-no-node
title: aidlc init qualifies on a repository with no Node package
spec: specs/init-no-node.md
size: T1
status: draft
created: 2026-11-04T21:30:00Z
---

# Plan: aidlc init qualifies on a repository with no Node package (from specs/init-no-node.md)

## 1. Goal and boundaries
`aidlc init` on a repository with no Node package leaves working guards, the right base branch and no workflow that
fails on every push. This is the blocker found by the qualification on MyInspection (queue step 3). Personal use comes
first, so the hook command names this machine's CLI by absolute path. Cut: a published package, the rename, a shim
installed into the target. Deferred: the review commands of a downstream repository, MyInspection's own card findings.
Success: both cards merged with DoD, review and CI green, and a real init on a fresh clone of MyInspection gives a hook
that denies a matching command, `base: master` and no Node workflow.

## 2. Minimal acceptable loop
Hook first, because guards that are off are the worst of the three. The second card touches the same file and depends
on the first.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
`src/scaffold/init.ts` resolves the hook command and writes the config and workflows. `src/probes/hook-wiring.ts` (new)
runs the wired dispatcher for `aidlc doctor`.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
`initProject` gains `hookEntry?: string`; a call without it writes what it writes today, so the library callers and
their tests keep their result. Only the CLI passes it.

## Files that change
- src/scaffold/init.ts
- src/cli/main.ts
- src/probes/hook-wiring.ts (new)
- .github/workflows/agent-evals.yml
- .github/workflows/aidlc-ci.yml
- .github/workflows/docs-check.yml
- templates/github/workflows/agent-evals.yml
- templates/github/workflows/aidlc-ci.yml
- tests/surface/init-no-package.test.ts (new)
- tests/surface/init-base-ci.test.ts (new)
- tests/surface/command-lines.test.ts
- docs/OPERATIONS.md
- CHANGELOG.md

## Order of work
1. T1-INIT-HOOK-PATH: absolute hook command, one dispatcher per entry, the `aidlc doctor` hook line.
2. T1-INIT-BASE-CI: default branch in the config, no Node workflow without a `package.json`, no fetching `npx`.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-INIT-HOOK-PATH | MUST | The hook runs on a repository with no package, and doctor shows when it does not | - | - | - |
| T1-INIT-BASE-CI | MUST | Right base, no Node workflow, no fetching npx | T1-INIT-HOOK-PATH | - | - |

## Risks
- The absolute path is per machine and `.claude/settings.json` is committed. On another machine the hook exits 1 and the guards are off. `aidlc doctor` reports it, and the plan accepts this for personal use.
- `npx --no-install aidlc` in this repository's own CI relies on npx finding the package's own bin. The PR's CI run shows it.
- aidlc-6c's cards also merge into `CHANGELOG.md`, so each card may need a base merge and a second review round.

## Proof
- Each card's DoD.
- After both merge: a real `aidlc init` on a fresh depth 1 clone of MyInspection, a hook process run with a matching Bash event exits 2, `base` is `master`, `aidlc-ci.yml` is absent, and `aidlc doctor` reports `hookCommand: ok`.
