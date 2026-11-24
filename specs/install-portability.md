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
- R3. The CI workflow shall run the script of R2 on `ubuntu-latest` and `windows-latest` on pushes only.
- R4. WHEN `aidlc init` resolves a hook command that names an absolute path, the init command shall write that command to `.claude/settings.local.json` of the target and write no hook entry with an absolute path to `.claude/settings.json`.
- R5. WHEN `aidlc init` writes `.claude/settings.local.json`, the init command shall add that path to the target's `.gitignore` when no entry there covers it.
- R6. The hook line of `aidlc doctor` shall read the dispatcher command from `.claude/settings.local.json` as well as from `.claude/settings.json`.
- R7. WHEN the platform is neither Windows nor Linux, the context-pack reader `readOpenedSource` shall open the source without following a link, compare the device and inode of the opened file with those of the path, and return the text only when they are equal.
- R8. The `git` line of `aidlc doctor` shall keep the installed git version.
- R9. IF the installed git is older than 2.45, THEN the `git` line of `aidlc doctor` shall say `UNSUPPORTED` and name git 2.45 or newer, with the exit code of the command unchanged.
- R10. The README shall state git 2.45 or newer as the one supported minimum.
- R11. WHERE `--profile claude-github` is given with `--reviewer-model <id>`, the init command shall write a configuration with the `claude-code` provider, the `github` ship path, `gateRequired` true and a Claude formal-review command that runs the named model, with every other written file as without the option.
- R12. The repository shall hold a quickstart document that lists, in order, the commands from install to a first pull request under the `claude-github` profile.
- R13. The CI workflow shall run the typecheck and the suite on `macos-latest` on pushes only, in a job whose failure does not fail the workflow and whose name is not in `github.requiredChecks`.
- R14. IF `--profile` names no profile file, or is given without `--reviewer-model`, or `--reviewer-model` is given without `--profile`, THEN the init command shall exit non-zero before its first write and say which.

## Design
The git install fails because npm builds a git dependency with its `prepare` script and this
package builds in `prepack` only. `"prepare": "npm run build"` replaces `prepack`: `npm pack`
then runs one `prepare` and one build, the tarball holds `dist/cli/main.js` and nothing under
`src/`, and with both scripts `npm pack` builds twice [SOURCE: drafter scratch run of
2026-11-17 on a copy of main at 2ef2bbf4, Windows, npm 11.14.1]. `prepack` is named nowhere
but `package.json:38` [SOURCE: `git grep prepack` at 2ef2bbf4]. `scripts/install-smoke.ts`
packs the checkout, installs the tarball and a `git+file://` URL of the checkout into two
temporary directories and starts each CLI. Its CI job carries
`if: github.event_name == 'push'`, like the macOS job: the ship path fails on any red check of
a pull request, required or not (`src/delivery/github-ship.ts:384-391`), so on a pull request
both jobs are a skipped check, which that gate accepts.

`resolveHookCommand` keeps its three results; the settings merge of `src/scaffold/init.ts`
routes a command that matches `ABSOLUTE_DISPATCHER` to the local settings file. Claude Code
merges hook entries across settings files, so the local entry runs beside no shared one
[SOURCE: Claude Code documentation, hooks and settings pages, read 2026-11-16].
`readOpenedSource` gains a POSIX branch built on `fstatSync` and `lstatSync`, with a second
resolved-path check for a swapped parent directory.

Git. Every base-sync git call and the finding-identity read run as `git --no-lazy-fetch`,
which git older than 2.45 refuses, and `README.md:17` states 2.38. The README now states 2.45
as the one minimum and doctor says when the installed git is older. `gitVersionLine` in
`src/probes/git.ts` turns the first line of `git --version` into the doctor value; doctor
sets no exit code for any check today (`git: MISSING` exits 0), so an old git changes none.
No code of `src/probes/base-sync.ts` or `src/loop/card-runner.ts` changes: support for an
older git was withdrawn on 2026-11-17 (drafts at commit 33b32e01). The 2.38 sentences of
`docs/ARCHITECTURE.md` and `docs/OPERATIONS.md` state what `git merge-tree --write-tree`
needs and stay.

The profile is a JSON overlay under `templates/profiles/` merged over
`templates/aidlc.config.json` at init. It names no model: the caller gives the reviewer model
with `--reviewer-model`, and init puts it in `formalReview.command` in place of a marker.

## Interfaces and contracts
- `package.json` `scripts.prepare` (new); `scripts.prepack` removed. `scripts/install-smoke.ts` (new), exit 0 or 1.
- `.claude/settings.local.json` in a target (new file written by init, same `hooks` shape).
- `aidlc init --profile <name> --reviewer-model <id>`; the only profile is `claude-github`. Each option without the other, and an unknown name, exit 1.
- The `git` line of `aidlc doctor`: the version line, or the version with `UNSUPPORTED` and the needed release, or `MISSING` as today. The exit code does not change.
- No directive, state record or ship sentinel changes.

## Data model and migration impact
none. A target initialised before R4 keeps its absolute command in `.claude/settings.json`
until `aidlc init` runs again, which moves it.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Publishing to the npm registry, or renaming the package.
- Making the macOS job a required check, or fixing suite failures that are specific to macOS.
- A Codex reviewer in the profile, a reviewer model the profile picks, or any new provider.
- Support for a git older than 2.45: a probe of `--no-lazy-fetch`, or any change to the base-sync calls or the finding-identity read.
- The install check as a pull-request check.

## Acceptance
- 1. `node scripts/install-smoke.ts` exits 0 on main after the change and exits 1 when `scripts.prepare` is removed. [R1] [R2]
- 2. The CI workflow has a job that runs the script on both runners with a push-only condition. [R3]
- 3. An init into a target with no aidlc package leaves `.claude/settings.json` with no absolute path and `.claude/settings.local.json` with the dispatcher command, and the path ignored. [R4] [R5]
- 4. `aidlc doctor` reports the hook command of a target whose dispatcher is only in the local file. [R6]
- 5. The POSIX branch returns the text of a regular file and refuses a path replaced by a link between resolve and open. [R7]
- 6. `gitVersionLine` returns the version line for git 2.45 and newer and the `UNSUPPORTED` value for an older one, and doctor prints it as its `git` entry. [R8] [R9]
- 7. The README git line names 2.45 and no longer states 2.38 as the minimum. [R10]
- 8. An init with the profile and a reviewer model writes the four settings with that model in the review command; an init without the profile writes today's file byte for byte. [R11]
- 9. An init with the profile and no reviewer model, with a reviewer model and no profile, or with an unknown profile exits 1 and writes nothing. [R14]
- 10. `docs/QUICKSTART.md` exists and every `aidlc` command it lists is a registered command. [R12]
- 11. The workflow has the macOS job with `continue-on-error: true` and a push-only condition, and `aidlc.config.json` does not name it. [R13]
