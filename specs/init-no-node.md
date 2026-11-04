# Spec: aidlc init on a repository with no Node package

## Problem
A real `aidlc init` on a depth 1 clone of `D:\Projects\MyInspection` (an Android repository, default branch `master`, no `package.json`) on 2026-11-04 found three defects:

1. The hook command `npx --no-install aidlc hook auto` exits 1, because no local package exists. A hook that exits 1 does not stop a tool call, so every guard is off and nothing reports it. npx names the unrelated npm package `aidlc@3.0.0` in its error.
2. `aidlc.config.json` says `base: main`; `aidlc doctor` then reports `n/a (no main branch)`.
3. `aidlc-ci.yml` and `agent-evals.yml` run `npm ci` and `npx aidlc`, so they fail on every push of a repository with no `package.json`. A bare `npx aidlc` in a repository with no local package would fetch the unrelated npm package.

## Accepted behaviour
- `aidlc init` writes a hook command that runs on the target.
- `aidlc doctor` reports a hook command that does not run.
- The created config names the target's default branch.
- `aidlc init` adds no workflow that needs a `package.json` to a repository without one.
- No workflow runs `npx aidlc` in a form that can fetch a package.

## Out of scope
The 132 `aidlc cards validate` findings over MyInspection's own cards, the review command configuration of a downstream repository, the rename of the package, a published npm package.
