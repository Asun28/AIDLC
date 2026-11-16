---
slug: install-portability
title: A machine that is not the author's can install aidlc, run init and keep working guards
intent: intent/install-portability.md
status: draft
created: 2026-11-16T02:45:00Z
skills_applied: []
---

# Spec: a machine that is not the author's can install aidlc, run init and keep working guards
From intent: intent/install-portability.md. Status: draft. Skills applied: (none).

## Requirements (EARS)
- R1. WHEN the package is installed from a git URL or from the tarball of `npm pack` into a directory with no other copy of it, the installed `aidlc --version` shall exit 0 and print the version of `package.json`.
- R2. The repository shall hold a script that performs both installs of R1 in temporary directories and exits non-zero when either installed CLI does not start.
- R3. The CI workflow shall run the script of R2 on `ubuntu-latest` and `windows-latest`.
- R4. WHEN `aidlc init` resolves a hook command that names an absolute path, the init command shall write that command to `.claude/settings.local.json` of the target and write no hook entry with an absolute path to `.claude/settings.json`.
- R5. WHEN `aidlc init` writes `.claude/settings.local.json`, the init command shall add that path to the target's `.gitignore` when no entry there covers it.
- R6. The hook line of `aidlc doctor` shall read the dispatcher command from `.claude/settings.local.json` as well as from `.claude/settings.json`.
- R7. WHEN the platform is neither Windows nor Linux, the context-pack reader `readOpenedSource` shall open the source without following a link, compare the device and inode of the opened file with those of the path, and return the text only when they are equal.
- R8. IF the installed git refuses `--no-lazy-fetch`, THEN the base-sync check and the finding-identity read shall run their git commands without the option only in a repository with no promisor remote, and refuse as they do today in one that has a promisor remote.
- R9. WHEN the installed git refuses `--no-lazy-fetch`, the doctor command shall print one line that names the limit and the git release that lifts it.
- R10. The README shall state the git release each named feature needs: 2.38 for the `github` ship path and 2.45 for reads in a partial clone.
- R11. WHERE `--profile claude-github` is given, the init command shall write a configuration with the `claude-code` provider, the `github` ship path and a Claude formal-review command, with every other written file as without the option.
- R12. The repository shall hold a quickstart document that lists, in order, the commands from install to a first pull request under the `claude-github` profile.
- R13. The CI workflow shall run the typecheck and the suite on `macos-latest` on pushes only, in a job whose failure does not fail the workflow and whose name is not in `github.requiredChecks`.

## Design
The git install fails because npm builds a git dependency with its `prepare` script and this
package builds in `prepack` only; `"prepare": "npm run build"` produces `dist/` in the packed
tree [SOURCE: scratch experiment of 2026-11-16 on a clone of 35de54fe: `dist/` present,
`aidlc --version` prints 0.2.0]. `scripts/install-smoke.ts` packs the checkout, installs the
tarball and a `git+file://` URL of the checkout into two temporary directories and starts each
CLI. `resolveHookCommand` keeps its three results; the settings merge of `src/scaffold/init.ts`
routes a command that matches `ABSOLUTE_DISPATCHER` to the local settings file. Claude Code merges hook entries
across settings files, so the local entry runs beside no shared one [SOURCE: Claude Code
documentation, hooks and settings pages, read 2026-11-16]. `readOpenedSource` gains a POSIX
branch built on `fstatSync` and `lstatSync`, with a second resolved-path check for a swapped
parent directory. The macOS job runs on pushes only: the ship path fails on any red check of a
pull request, required or not (`src/delivery/github-ship.ts:384-391`). A probe runs `git --no-lazy-fetch version` once
per process; a second probe reads whether any `remote.<name>.promisor` or
`extensions.partialclone` key is set. The profile is a JSON overlay under `templates/profiles/`
merged over `templates/aidlc.config.json` at init.

## Interfaces and contracts
- `package.json` `scripts.prepare` (new). `scripts/install-smoke.ts` (new), exit 0 or 1.
- `.claude/settings.local.json` in a target (new file written by init, same `hooks` shape).
- `aidlc init --profile <name>`; the only name is `claude-github`. An unknown name exits 1.
- `aidlc doctor` gains at most one line, `gitLazyFetch`. Its exit code does not change.
- No directive, state record or ship sentinel changes.

## Data model and migration impact
none. A target initialised before R4 keeps its absolute command in `.claude/settings.json`
until `aidlc init` runs again, which moves it.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Publishing to the npm registry, or renaming the package.
- Making the macOS job a required check, or fixing suite failures that are specific to macOS.
- A Codex reviewer in the profile, or any new provider.
- Lifting the refusal for a partial clone on git older than 2.45.

## Acceptance
- 1. `node scripts/install-smoke.ts` exits 0 on main after the change and exits 1 when `scripts.prepare` is removed. [R1] [R2]
- 2. The CI workflow has a job that runs the script on both runners. [R3]
- 3. An init into a target with no aidlc package leaves `.claude/settings.json` with no absolute path and `.claude/settings.local.json` with the dispatcher command, and the path ignored. [R4] [R5]
- 4. `aidlc doctor` reports the hook command of a target whose dispatcher is only in the local file. [R6]
- 5. The POSIX branch returns the text of a regular file and refuses a path replaced by a link between resolve and open. [R7]
- 6. With a runner that refuses `--no-lazy-fetch`, the base-sync value and the identity read succeed without a promisor remote and are refused with one. [R8]
- 7. `aidlc doctor` prints the `gitLazyFetch` line only when the option is refused. [R9]
- 8. The README sentence names both releases. [R10]
- 9. An init with the profile writes the three settings; an init without it writes today's file byte for byte. [R11]
- 10. `docs/QUICKSTART.md` exists and every `aidlc` command it lists is a registered command. [R12]
- 11. The workflow has the macOS job with `continue-on-error: true` and a push-only condition, and `aidlc.config.json` does not name it. [R13]
