---
slug: install-portability
title: A machine that is not the author's can install aidlc, run init and keep working guards
spec: specs/install-portability.md
size: T1
status: draft
created: 2026-11-16T03:00:00Z
---

# Plan: a machine that is not the author's can install aidlc, run init and keep working guards (from specs/install-portability.md)

## 1. Goal and boundaries
A git or tarball install starts, `aidlc init` leaves no absolute path in a committed file, the
context pack loads on macOS, a git older than 2.45 works outside a partial clone, and one init
profile leads to a first pull request. Cut: npm publish, the rename, a required macOS check.
Success: `node scripts/install-smoke.ts` exits 0 in CI on Ubuntu and Windows, and the acceptance
list of the spec holds on main.

## 2. Minimal acceptable loop
T1-INSTALL-GIT-DEP alone makes the package installable; every other card is independent of it.

## 3. Tech stack
none this version

## 4. Directory structure
- `scripts/install-smoke.ts` (new)
- `templates/profiles/claude-github.json` (new)
- `docs/QUICKSTART.md` (new)

## 4.5 Module design
- `package.json`: `scripts.prepare` builds `dist/` for a git install.
- `scripts/install-smoke.ts`: pack, install twice into temporary directories, start each CLI.
- `src/probes/hook-wiring.ts` and the doctor hook line: read the local settings file too.
- `src/scaffold/init.ts`: an absolute dispatcher command is written to `.claude/settings.local.json`; `--profile` overlays `templates/profiles/<name>.json` on the template configuration.
- `src/loop/context-pack.ts`: a POSIX branch of `readOpenedSource`, with the device and inode comparison and a second resolved-path check, since the comparison alone does not refuse a swapped parent directory (`tests/scenarios/context-pack.test.ts:195`).
- `src/probes/base-sync.ts`: a probe of `--no-lazy-fetch` support and of a promisor remote; the base-sync runner uses it.
- `src/loop/card-runner.ts`: the finding-identity read uses the same probe.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
The probe exported by `src/probes/base-sync.ts` (T1-GIT-LAZY-FETCH-PROBE) is used by
T1-IDENTITY-READ-OLD-GIT. No frozen contract changes.

## Files that change
- package.json
- scripts/install-smoke.ts (new)
- .github/workflows/ci.yml
- src/scaffold/init.ts
- src/probes/hook-wiring.ts
- src/loop/context-pack.ts
- src/probes/base-sync.ts
- src/loop/card-runner.ts
- src/cli/main.ts
- templates/profiles/claude-github.json (new)
- docs/QUICKSTART.md (new)
- README.md
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md

## Order of work
Cards run one at a time: nearly every card edits `CHANGELOG.md` or `docs/OPERATIONS.md`.
1. T1-INSTALL-GIT-DEP: the `prepare` script, the smoke script, its CI job.
2. T1-CONTEXT-PACK-POSIX: the POSIX branch and its test.
3. T1-GIT-LAZY-FETCH-PROBE: the probe, the base-sync runner, the doctor line, the README sentence.
4. T1-HOOK-WIRING-LOCAL: the doctor hook line reads `.claude/settings.local.json`.
5. T1-INIT-HOOK-LOCAL: init writes the absolute command to the local settings file and the ignore entry.
6. T1-INIT-HOOK-LOCAL-DOCS: the README and OPERATIONS text of 5 and the tests that pin them.
7. T1-INIT-PROFILE: the profile overlay and the quickstart.
8. T1-CI-MACOS: the macOS job, on pushes only.
9. T1-IDENTITY-READ-OLD-GIT: the identity read through the probe, after card
   T1-REVIEW-FOLLOWUP-ISSUE of `plans/review-recall.md` has merged (both edit `card-runner.ts`).

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-INSTALL-GIT-DEP | MUST | git and tarball installs start; smoke script in CI | - | - | - |
| T1-CONTEXT-PACK-POSIX | MUST | context pack loads on macOS | - | - | - |
| T1-GIT-LAZY-FETCH-PROBE | MUST | base sync works on a git older than 2.45 outside a partial clone; doctor line; README | - | - | yes |
| T1-HOOK-WIRING-LOCAL | MUST | doctor reads the dispatcher from settings.local.json | - | - | - |
| T1-INIT-HOOK-LOCAL | MUST | absolute hook command in settings.local.json only | T1-HOOK-WIRING-LOCAL | - | - |
| T1-INIT-HOOK-LOCAL-DOCS | MUST | README and OPERATIONS state the new placement | T1-INIT-HOOK-LOCAL | - | - |
| T1-INIT-PROFILE | SHOULD | `init --profile claude-github` and the quickstart | T1-INIT-HOOK-LOCAL, T1-INIT-HOOK-LOCAL-DOCS | - | - |
| T1-CI-MACOS | SHOULD | suite on macos-latest on pushes, not required | T1-INSTALL-GIT-DEP, T1-CONTEXT-PACK-POSIX | - | - |
| T1-IDENTITY-READ-OLD-GIT | MUST | finding identity recorded on a git older than 2.45 outside a partial clone | T1-GIT-LAZY-FETCH-PROBE, T1-REVIEW-FOLLOWUP-ISSUE | - | - |

Budgets: 200, 130, 180, 110, 200, 40, 200, 70 and 130 changed lines, 1260 in total.

## Risks
- `prepare` runs on every `npm ci` and `npm install` of this checkout, so a build failure fails the install, and the CI tests that start `bin/aidlc.js` then run the compiled build (the entry prefers a `dist/` at least as new as `src/`).
- The smoke script needs network access to the npm registry; it runs in CI and in the card's DoD, not in `npm test`. The ship path fails on any red check (`src/delivery/github-ship.ts:384-391`), so a red `install-smoke` job stops a ship although it is not in `github.requiredChecks`.
- For the same reason the macOS job runs on pushes only: on a pull request one macOS-only test failure would stop every ship.
- `tests/infra/base-sync.test.ts:264-271` forbids the text of the last unsupported git release in `docs/OPERATIONS.md` and `base-sync.ts`; the cards write "older than 2.45".
- A hook in `.claude/settings.local.json` is per machine. Under the quickstart's own install the hook command is relative and committed (`src/scaffold/init.ts:220`), so the local file is written only for a target with no aidlc package.
- Not verified before the cards run: a `git+file://<path>#<sha>` install from a linked worktree and from CI's detached merge commit; any git older than 2.45 (exit 129 is taken from the docs and tests); the check conclusion GitHub reports for a failed `continue-on-error` job.
- Owner to confirm at approval: the macOS job on pushes only; test F2 of `tests/scenarios/finding-identity.test.ts` skipped on a git older than 2.45; no dispatcher at all in the shared `.claude/settings.json` of a target with no package; the profile pins the reviewer to `claude-opus-5-5` and sets no `gateRequired`; `prepack` stays, so `npm pack` builds twice.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `node scripts/install-smoke.ts` exits 0 on main.
- Arc: `aidlc init --profile claude-github` in an empty git repository, then `aidlc doctor`, with the hook command reported.
- Arc: the `install-smoke` job appears in a pull-request run and the macOS job in the push run of main.

## 10. After merge
none this version (development-only target)
