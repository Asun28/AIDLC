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
context pack loads on macOS, the README and `aidlc doctor` state git 2.45 or newer, and one
init profile leads to a first pull request. Cut: npm publish, the rename, a required macOS
check, support for a git older than 2.45 (withdrawn on 2026-11-17; the drafts of
T1-GIT-LAZY-FETCH-PROBE and T1-IDENTITY-READ-OLD-GIT are at commit 33b32e01), the install
check on pull requests. Success: `node scripts/install-smoke.ts` exits 0 in the push run of
main on Ubuntu and Windows, and the acceptance list of the spec holds on main.

## 2. Minimal acceptable loop
T1-INSTALL-GIT-DEP alone makes the package installable; every other card is independent of it.

## 3. Tech stack
none this version

## 4. Directory structure
- `scripts/install-smoke.ts` (new)
- `templates/profiles/claude-github.json` (new)
- `docs/QUICKSTART.md` (new)

## 4.5 Module design
- `package.json`: `scripts.prepare` builds `dist/` for a git install and replaces `scripts.prepack`.
- `scripts/install-smoke.ts`: pack, install twice into temporary directories, start each CLI.
- `src/probes/hook-wiring.ts` and the doctor hook line: read the local settings file too.
- `src/scaffold/init.ts`: an absolute dispatcher command is written to `.claude/settings.local.json`; `--profile` overlays `templates/profiles/<name>.json` on the template configuration and puts the caller's reviewer model into the review command.
- `src/loop/context-pack.ts`: a POSIX branch of `readOpenedSource`, with the device and inode comparison and a second resolved-path check, since the comparison alone does not refuse a swapped parent directory (`tests/scenarios/context-pack.test.ts:195`).
- `src/probes/git.ts`: `gitVersionLine`, the doctor value for the first line of `git --version`. `src/cli/main.ts`: the doctor `git` entry uses it; `init` gains `--profile` and `--reviewer-model`.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
No frozen contract changes. `gitVersionLine` is used by the doctor command only.

## Files that change
- package.json
- scripts/install-smoke.ts (new)
- .github/workflows/ci.yml
- src/scaffold/init.ts
- src/probes/hook-wiring.ts
- src/probes/git.ts
- src/loop/context-pack.ts
- src/cli/main.ts
- templates/profiles/claude-github.json (new)
- docs/QUICKSTART.md (new)
- README.md
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- changelog.d/T1-INSTALL-GIT-DEP.md (new)
- changelog.d/T1-CONTEXT-PACK-POSIX.md (new)
- changelog.d/T1-GIT-MIN-VERSION.md (new)
- changelog.d/T1-HOOK-WIRING-LOCAL.md (new)
- changelog.d/T1-INIT-HOOK-LOCAL.md (new)
- changelog.d/T1-INIT-HOOK-LOCAL-DOCS.md (new)
- changelog.d/T1-INIT-PROFILE.md (new)
- changelog.d/T1-CI-MACOS.md (new)

## Order of work
Every card starts after T1-CHANGELOG-FRAGMENTS of `plans/loop-throughput.md` has merged and
writes its changelog entry to its own file under `changelog.d/`, so `CHANGELOG.md` no longer
puts the cards in sequence. Two cards run together only when they share no path; the shared
ones are `docs/OPERATIONS.md`, `README.md`, `src/cli/main.ts`, `src/scaffold/init.ts`,
`.github/workflows/ci.yml` and two test files.
1. T1-INSTALL-GIT-DEP (the `prepare` script, the smoke script, its push-only CI job; after
   T1-CI-SHARD, which changes `ci.yml` first) beside T1-CONTEXT-PACK-POSIX (the POSIX branch
   and its test).
2. T1-GIT-MIN-VERSION (the README line and the doctor `git` entry) beside T1-HOOK-WIRING-LOCAL
   (the doctor hook line reads `.claude/settings.local.json`).
3. T1-INIT-HOOK-LOCAL (init writes the absolute command to the local settings file and the
   ignore entry) beside T1-CI-MACOS (the macOS job, on pushes only).
4. T1-INIT-HOOK-LOCAL-DOCS: the README and OPERATIONS text of T1-INIT-HOOK-LOCAL and the
   tests that pin them.
5. T1-INIT-PROFILE: the profile overlay, the reviewer-model option and the quickstart.

A card of this plan may also run beside a card of `plans/execution-gate.md` when the two share
no path; `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `src/cli/main.ts` are the paths the
two plans share.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-INSTALL-GIT-DEP | MUST | git and tarball installs start; one build per packaging operation; smoke script in CI on pushes | T1-CI-SHARD, T1-CHANGELOG-FRAGMENTS | W1 | - |
| T1-CONTEXT-PACK-POSIX | MUST | context pack loads on macOS | T1-CHANGELOG-FRAGMENTS | W1 | - |
| T1-GIT-MIN-VERSION | MUST | README and doctor state git 2.45 or newer | T1-CHANGELOG-FRAGMENTS | W2 | - |
| T1-HOOK-WIRING-LOCAL | MUST | doctor reads the dispatcher from settings.local.json | T1-CHANGELOG-FRAGMENTS | W2 | - |
| T1-INIT-HOOK-LOCAL | MUST | absolute hook command in settings.local.json only | T1-HOOK-WIRING-LOCAL, T1-CHANGELOG-FRAGMENTS | W3 | - |
| T1-CI-MACOS | SHOULD | suite on macos-latest on pushes, not required | T1-INSTALL-GIT-DEP, T1-CONTEXT-PACK-POSIX, T1-CI-SHARD, T1-CHANGELOG-FRAGMENTS | W3 | - |
| T1-INIT-HOOK-LOCAL-DOCS | MUST | README and OPERATIONS state the new placement | T1-INIT-HOOK-LOCAL, T1-CHANGELOG-FRAGMENTS | - | - |
| T1-INIT-PROFILE | SHOULD | `init --profile claude-github --reviewer-model <id>` and the quickstart | T1-INIT-HOOK-LOCAL, T1-INIT-HOOK-LOCAL-DOCS, T1-GIT-MIN-VERSION, T1-CHANGELOG-FRAGMENTS | - | - |

Budgets: 200, 130, 90, 110, 200, 70, 40 and 200 changed lines, 1040 in total. The cards of
one window share no path.

## Risks
- `prepare` runs on every `npm ci` and `npm install` of this checkout, so a build failure fails the install, and the tests that start `bin/aidlc.js` then run the compiled build (the entry prefers a `dist/` at least as new as `src/`). On Ubuntu that is what the required `build-test` job already does; the new case is the Windows check. T1-INSTALL-GIT-DEP therefore runs `npm run build` and then `npm test` on Windows before its first review. `npm ci` takes about 7 s longer, and the `docs-check` and `agent-evals` workflows build on `npm ci` too.
- The smoke script needs network access to the npm registry; it runs in the push run of main and in the card's DoD, not in `npm test` and not on a pull request. Its first CI run is the push of the card's own merge commit, so its result is read at the card's close.
- The smoke job and the macOS job carry a job-level push condition, so each shows on a pull request as one skipped check. The ship path accepts a skipped check that is not required (`src/delivery/github-ship.ts:391`).
- An old git changes no exit code of `aidlc doctor`; doctor sets none for any check today. A machine with git older than 2.45 still fails at the first base sync, now with the doctor line and the README naming the reason.
- `tests/infra/base-sync.test.ts:264-271` forbids the text of the last unsupported git release in `docs/OPERATIONS.md`, `src/probes/base-sync.ts` and that test file; T1-GIT-MIN-VERSION changes none of the three.
- A hook in `.claude/settings.local.json` is per machine. Under the quickstart's own install the hook command is relative and committed (`src/scaffold/init.ts:220`), so the local file is written only for a target with no aidlc package.
- T1-INIT-PROFILE is at its 200 lines; the drafter's estimate with the reviewer-model rules is about 205. The coordinator estimates again when T1-INIT-HOOK-LOCAL-DOCS has merged and, if it is still over, moves `docs/QUICKSTART.md` to a card of its own before T1-INIT-PROFILE starts.
- Not verified before the cards run: that a `git+file:<path>#<sha>` install takes that commit and can clone a linked worktree; the check name and conclusion GitHub reports for a skipped matrix job; the doctor test with a substitute `git` on Linux (it is skipped on Windows, where a `git.cmd` first on PATH is not run without a shell); that 2.45 is the first git with `--no-lazy-fetch` (taken from the lesson of 2026-10-07, not read again in the release notes).
- Decided at the approval of 2026-11-17: the macOS job and the smoke job on pushes only; no dispatcher at all in the shared `.claude/settings.json` of a target with no package; the profile names no reviewer model and sets `gateRequired`; `prepare` replaces `prepack`; no support for a git older than 2.45 now.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `node scripts/install-smoke.ts` exits 0 on main.
- Arc: `aidlc init --profile claude-github --reviewer-model <id>` in an empty git repository, then `aidlc doctor`, with the hook command and the git version reported.
- Arc: the `install-smoke` job and the macOS job appear in the push run of main and as skipped checks in a pull-request run.

## 10. After merge
none this version (development-only target)
