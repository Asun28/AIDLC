---
id: T0-PROTECT-GIT
title: "A protect-git hook guard refuses the irreversible git forms the deny rules cannot match"
status: todo
branch: T0-PROTECT-GIT
allow_paths:
  - src/hooks/protect-git.ts
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - tests/surface/protect-git.test.ts
  - tests/surface/hooks.test.ts
  - tests/surface/hook-name.test.ts
  - tests/surface/ps-guard-wire.test.ts
  - tests/surface/readme.test.ts
  - tests/surface/stdin-script.test.ts
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-PROTECT-GIT.md
  - specs/tasks/T0-PROTECT-GIT.md
dod_command: npm run typecheck && node --test tests/surface/protect-git.test.ts tests/surface/hooks.test.ts tests/surface/hook-name.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/readme.test.ts tests/surface/stdin-script.test.ts tests/surface/settings-deny.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. A new guard `protect-git` (`src/hooks/protect-git.ts`, listed in `HOOK_NAMES`) shall decide on the `command` of a `PreToolUse` Bash or PowerShell event and return exit 2 with one stderr line naming the refused git command as a JSON string and the rule (CLAUDE.md, Hard limits) when any git command in it is one of: `reset` with `--hard`; `push` with `--force`, an argument that starts with `--force-with-lease`, a single-dash option cluster holding `f`, or an argument that is not an option and starts with `+` followed by at least one character; `clean` with `--force` or a single-dash option cluster holding `f`; `checkout` whose first argument is `--` and is followed by at least one argument, or whose only argument is `.`; `commit` with a single-dash option cluster holding `n` before any of `m`, `F`, `C`, `c` and `t`; any subcommand with the argument `--no-verify`. Options and arguments are read in any position after the subcommand. The rows of acceptance 1 and 2 are the contract (lesson of T0-SMALL-ISSUES-463-428-ZOD): a spelling outside them is decided by the reading of R2 and R3, and one that reading lets through is not a defect of this card, since the guard is a reminder of a written rule, not a security boundary.
  - R2. A git command is a command whose name, lower case, without its path and `.exe`, is `git`, after any of the words `sudo`, `env`, `command`, `exec`, `nohup`, `time` and `NAME=value` assignments. Its subcommand is its first word after the git options, where `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--super-prefix`, `--config-env`, `--exec-path` and `--attr-source` without `=` take the next word as their value and every other word that starts with `-` is skipped alone. The subcommand and its arguments are compared case-sensitively.
  - R3. The guard reads the command with a scanner that splits commands at unquoted `;`, `&&`, `||`, `|`, `&` and line breaks (and on PowerShell also `{`, `}`, `(` and `)`), joins quoted parts into the word they belong to and drops the quotes (Bash single, double and `$'...'` quotes, backslash escapes; PowerShell single and double quotes, backtick escapes and here-strings), skips comments, and skips the body of a Bash heredoc. A quoted text and a heredoc body are data: a git command inside them is not read, except the one quoted word after `-c` (or an option cluster ending in `c`) of `bash`, `sh`, `zsh`, `dash` and `ksh`, after `-Command` or a prefix of it from `-c` of `pwsh` and `powershell`, and the words after `/c` or `/k` of `cmd`, which are scanned again as a command (Bash, PowerShell and Bash respectively). An unquoted `$(...)` and an unquoted backtick span in Bash are scanned again as a command.
  - R4. `dispatchHook` (`src/hooks/entry.ts`) shall run `protect-git` for Bash and PowerShell events last and in the second pass only, as it runs `stdin-script`, so it never replaces another guard's block; `aidlc hook protect-git` runs it alone.
  - R5. `docs/OPERATIONS.md` (Hooks table, one paragraph listing the forms of R1 to R3, and the deny-list paragraph of card T0-DENY-IRREVERSIBLE-GIT, which now names this guard in place of "card 3 of the plan"), `README.md` (guard table), `docs/ARCHITECTURE.md` (the guard count) and `changelog.d/T0-PROTECT-GIT.md` shall state the guard.
acceptance:
  - 1. `tests/surface/protect-git.test.ts`, new file, calls `runHook('protect-git', ...)` on `PreToolUse` events. Denied (exit 2, stderr naming the git command as a JSON string): for Bash `git -C ../other push --force`, `git -c user.name=x push origin main --force`, `git --git-dir .git --work-tree . reset --hard HEAD~1`, `git push origin main -f`, `git push -uf origin main`, `git push origin +main`, `git push --force-with-lease`, `git reset HEAD~1 --hard`, `git clean -xdf`, `git clean --force`, `git checkout -- src/a.ts`, `git checkout .`, `git commit -nm wip`, `git commit -m wip -n`, `git merge --no-verify topic`, `/usr/bin/git push --force`, `sudo env GIT_DIR=.git git push --force`, `npm test && git push --force`, `echo ok; git reset --hard`, `bash -c 'git push --force'`, `sh -lc "git -C x reset --hard"`, `echo $(git reset --hard)`, `git push "--force"`; for PowerShell `git.exe -C ..\other push --force`, `& git push --force`, `if ($true) { git reset --hard }`, `pwsh -Command "git push --force"`, `cmd /c git push --force`, `GIT push --force`. [R1] [R2] [R3] [dod arm 2]
  - 2. Same file, allowed (exit 0, no output): `git status`, `git push origin main`, `git push origin feature-f`, `git push --follow-tags origin main`, `git reset --soft HEAD~1`, `git reset HEAD file`, `git clean -n`, `git checkout main`, `git checkout --conflict=diff3 -- CHANGELOG.md`, `git checkout -b topic`, `git commit -m "say -n and --no-verify and git push --force"`, `git commit -am wip`, `git commit -mn` (the message is `n`), `git log --grep=--force`, `grep -rn "git push --force" docs`, `echo 'git reset --hard'`, a Bash heredoc `cat > notes.md <<'EOF'` whose body line is `git push --force`, the commit form `git commit -m "$(cat <<'EOF'` whose message body holds `git reset --hard` and `--no-verify`, a PowerShell here-string `@'` whose body holds `git push --force`, `git PUSH --force` (case-sensitive subcommand), `gitk --all`, a Bash comment `# git push --force`; and a `PreToolUse` Edit event and a `Stop` event exit 0. [R1] [R2] [R3] [dod arm 2]
  - 3. Same file: `dispatchHook` on a `PreToolUse` Bash event `git -C x push --force` returns exit 2 naming the git command; `hookNamesFor` for Bash and PowerShell ends with `stdin-script`, `protect-git`; and on a command both `production-gate` and `protect-git` refuse (a production deploy pattern joined with `&& git push --force`, no approval), the result is `production-gate`'s. RED on main, where `protect-git` is not a hook name. [R4] [dod arm 2]
  - 4. The pinned guard lists of `tests/surface/hooks.test.ts` (unknown-name text, Bash dispatch list, covered names), `tests/surface/hook-name.test.ts` (`KNOWN`), `tests/surface/ps-guard-wire.test.ts` (PowerShell dispatch list) and `tests/surface/stdin-script.test.ts` (shell dispatch list) gain `protect-git`; no other line of those files changes. `tests/surface/readme.test.ts` gains the `protect-git` row of `GUARD_CELLS`, which the README table matches. [R4] [R5] [dod arm 2]
  - 5. `tests/surface/settings-deny.test.ts` passes unchanged, and every other test of `tests/surface/stdin-script.test.ts` passes with only the line of acceptance 4 changed. [R4] [dod arm 2]
  - 6. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `changelog.d/T0-PROTECT-GIT.md` state R1 to R5 (reviewer-verified against the diff; `tests/surface/changelog-fragments.test.ts` passes). [R5] [dod arm 2]
  - 7. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "On main at be12b5ff the deny rules of card T0-DENY-IRREVERSIBLE-GIT (`.claude/settings.json`, 11 per shell tool) match the command text only, and `docs/OPERATIONS.md` names what they miss: `git -C <dir> push --force`, `git -c <key>=<value> push --force`, `bash -c '...'` and `git push origin +<ref>`; reordered flags (`git push origin main --force` is caught by `git push * --force*`, but `git reset HEAD~1 --hard` and `git clean -x -d -f` are reached only by the patterns that happen to fit). No guard in `src/hooks/` reads git commands (issue 498). `stdin-script` (`src/hooks/stdin-script.ts`, card T0-SMALL-ISSUES-463-428-ZOD) is the precedent: a guard in its own file, in `HOOK_NAMES`, dispatched last for Bash and PowerShell in the second pass only, exit 2 with the rule's text. `commandSegments` and `powerShellSegments` (`src/hooks/index.ts`) do not read quotes, so a commit message or heredoc body that mentions `git push --force` would be split into segments; the guard therefore has its own quote-aware scanner. Hook processes see only Claude Code tool calls: git that `npm test`, an aidlc command or a test fixture spawns is not seen, so no exemption is needed. The merge-conflicts skill and the implementer agent use none of the refused forms (`grep -rn \"checkout --\\|reset --hard\\|clean -\\|push --force\\|--no-verify\" templates/claude .claude/skills`). `bench/baseline.json` allows 10 more modules and 2% more dependency bytes per hook journey."
forbid: [network]
non_goals:
  - "`git restore`, `git branch -D`, `git stash drop`, `git rebase`, `git filter-branch` and other rewriting or discarding commands the deny rules do not name"
  - "git aliases (`git -c alias.x='push --force' x`), `core.hooksPath` overrides and git environment variables"
  - "a substitution or command inside double quotes (`\"$(git push --force)\"`), `eval`, `xargs`, `-EncodedCommand` and a script file that runs git"
  - "a change to the deny rules of both settings files"
  - "an exemption for any command, repository or session"
hygiene: "From issue 498 and the plan agreed with Codex on 2026-11-26 (card 3). RED first: acceptance 1 to 3 on main, where `runHook` refuses the unknown name `protect-git`. The guard is a reminder of a written rule, not a security boundary, as `stdin-script` states; a form the scanner does not read is let through. Keep the scanner in `src/hooks/protect-git.ts`; do not change `commandSegments` or `powerShellSegments`, which other guards read."
---

# T0-PROTECT-GIT

From issue 498 (card 3 of the plan agreed with Codex on 2026-11-26), after Lydia Hallie's talk "Rethinking Claude Code Best Practices" (AI Engineer CODE, 2026-11-11): commands that cannot be taken back get a rule the model cannot talk past.

## Why
Card T0-DENY-IRREVERSIBLE-GIT added deny rules, but a deny rule matches the command text. `git -C <dir> push --force`, `git -c k=v push --force`, `bash -c '...'`, `git push origin +main` and flags in another order run.

## Deliverable
A `protect-git` guard that reads each git command of a Bash or PowerShell call, its global options and its arguments in any order, and refuses the same operations the deny rules name.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/protect-git.test.ts tests/surface/hooks.test.ts tests/surface/hook-name.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/readme.test.ts tests/surface/stdin-script.test.ts tests/surface/settings-deny.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every denied row exits 2, every allowed row exits 0, the guard runs last in the second pass.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | tests/surface/protect-git.test.ts, acceptance 1: 23 Bash rows and 6 PowerShell rows, and after R3 decision 1 seven Bash and two PowerShell regression rows (attached commit message, parenthesis in a comment or heredoc, ANSI-C escape, five nested `cmd /c`, empty here-strings); the comment, heredoc and ANSI-C rows and the quoted-heredoc commit row were also run through bash with a stub `git` that prints its arguments, and bash agrees | RED at a3d2fb82 (`protect-git` is an unknown hook name, exit 2 with the unknown-name text), passes on the candidate |
| 2 | tests/surface/protect-git.test.ts, acceptance 2: 21 Bash rows, 3 PowerShell rows, an Edit event and a Stop event, and after R3 decision 1 four Bash and two PowerShell rows (a quote inside a quoted substitution heredoc, a parenthesis in a heredoc body, a script operand before `-c`, `pwsh -File` and a positional script before `-Command`) | RED at a3d2fb82 (unknown name exits 2), passes on the candidate |
| 3 | tests/surface/protect-git.test.ts, acceptance 3 | RED at a3d2fb82 (`hookNamesFor` has no `protect-git`), passes on the candidate |
| 4 | tests/surface/hooks.test.ts, hook-name.test.ts, ps-guard-wire.test.ts, stdin-script.test.ts, readme.test.ts; `git diff origin/main -- tests/surface` | pass; one list line each (three in hooks.test.ts) and the `GUARD_CELLS` row |
| 5 | tests/surface/settings-deny.test.ts; the other tests of stdin-script.test.ts | pass; settings-deny.test.ts unchanged |
| 6 | `git diff origin/main -- docs changelog.d README.md`; tests/surface/changelog-fragments.test.ts | OPERATIONS table row, forms paragraph, deny-list note and known-name list; ARCHITECTURE guard count; one fragment line; pass |
| 7 | `npm run typecheck` | exit 0 |

## PR summary

### What
A new hook guard, `protect-git`, refuses git commands that cannot be taken back. It reads Bash and PowerShell tool calls.

### Why / Intent
The deny rules of card T0-DENY-IRREVERSIBLE-GIT match the command text only. Forms such as `git -C dir push --force` and `bash -c '...'` passed (issue 498).

### How / Behaviour
The guard scans the command with quotes, heredocs and comments read. It finds each git command, skips the git options and reads the arguments in any order. It refuses force push, `reset --hard`, `clean -f`, `checkout -- <paths>`, `checkout .`, `commit -n` and `--no-verify`, with exit 2.

### System impact
The dispatcher runs the guard last, in the second pass only. It never replaces the block of another guard.

### Security
The guard is a reminder of a written rule, not a security boundary. A form it does not read passes.

### Tests and review
New rows in tests/surface/protect-git.test.ts pin each refused and each allowed spelling. The pinned guard lists of four tests gain the name.

### Risk
A safe command that the scanner misreads is blocked. Quoted text is data, so commit messages that name these commands pass.

### Ownership
Hooks, `src/hooks/protect-git.ts`.

### Docs
docs/OPERATIONS.md, README.md, docs/ARCHITECTURE.md and a changelog fragment describe the guard.
