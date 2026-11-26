---
id: T0-DENY-IRREVERSIBLE-GIT
title: "Both settings files deny the irreversible git commands that CLAUDE.md forbids, and Read(~/.ssh/**)"
status: todo
branch: T0-DENY-IRREVERSIBLE-GIT
allow_paths:
  - .claude/settings.json
  - templates/claude/settings.json
  - tests/surface/settings-deny.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-DENY-IRREVERSIBLE-GIT.md
  - specs/tasks/T0-DENY-IRREVERSIBLE-GIT.md
dod_command: npm run typecheck && node --test tests/surface/settings-deny.test.ts tests/surface/templates.test.ts tests/infra/init.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `permissions.deny` of `.claude/settings.json` and of `templates/claude/settings.json` shall be the same list, in the same order.
  - R2. That list shall keep the 18 `Read(...)` rules it holds on main, in their order, and add after them `Read(~/.ssh/**)` and, for each of `Bash` and `PowerShell`, the 11 rules `git reset --hard`, `git reset --hard *`, `git push --force*`, `git push -f*`, `git push * --force*`, `git push * -f`, `git push * -f *`, `git clean -*f*`, `git checkout -- *`, `git checkout .`, `* --no-verify*`, in that order (41 rules in all).
  - R3. Under the matching the Claude Code permissions page documents (`*` matches any text, spaces and empty text included; a rule matches the whole command; `PowerShell` rules match case-insensitively), each denied row of acceptance 2 shall match at least one `Bash` rule and at least one `PowerShell` rule, and no allowed row shall match any rule of either tool.
  - R4. `docs/OPERATIONS.md` shall state what the list denies and that a rule misses another form of the same program (`git -C <dir> push --force`, `bash -c '...'`), which a hook guard is to cover (issue 498).
acceptance:
  - 1. `tests/surface/settings-deny.test.ts`, new file. The two deny lists parse from JSON and are deep-equal; the template list equals the 18 `Read(...)` rules of main followed by the 23 rules of R2 in order. RED on main, where the list holds 18 rules. [R1] [R2] [dod arm 2]
  - 2. Same file, one table test through a matcher written in the test from R3 (rule text to an anchored regular expression, `*` to `.*`, flag `i` for `PowerShell`). The rows are the contract; the card claims nothing about a command not in them. Denied: `git reset --hard`, `git reset --hard HEAD~1`, `git push --force`, `git push --force-with-lease origin T0-X`, `git push -f origin main`, `git push origin main --force`, `git push origin main -f`, `git clean -f`, `git clean -fdx`, `git clean -d -f`, `git checkout -- src/a.ts`, `git checkout .`, `git commit --no-verify -m x`, `git push --no-verify origin T0-X`, and `GIT PUSH --FORCE` for `PowerShell` only. Allowed: `git push origin main`, `git push -u origin T0-X`, `git push --follow-tags origin main`, `git push origin feature-f`, `git checkout --conflict=diff3 -- CHANGELOG.md` (the ship path, `src/delivery/github-ship.ts:642`), `git checkout main`, `git checkout -b T0-X origin/main`, `git reset --soft HEAD~1`, `git reset HEAD src/a.ts`, `git clean -n`, `git restore --staged src/a.ts`, `git commit -m fix`. RED on main for the denied rows. [R3] [dod arm 2]
  - 3. `docs/OPERATIONS.md:378`, the sentence on the scaffold's 18 secret-file denials, is replaced by one paragraph that names the 19 `Read` rules, the 11 git rules per shell tool, the bypass forms of R4 and issue 498 (reviewer-verified against the diff). `changelog.d/T0-DENY-IRREVERSIBLE-GIT.md` holds one line in the form of `changelog.d/README.md`. [R4] [dod arm 2]
  - 4. The typecheck is clean, and `tests/surface/templates.test.ts`, `tests/infra/init.test.ts` (which read the template deny list, so `aidlc init` merges the new rules downstream) and `tests/surface/changelog-fragments.test.ts` pass unchanged. [R1] [dod arms 1, 2]
depends_on: []
budget: 120
tdd: true
sweep: "On main at 3cfa0e89 both settings files deny the same 18 `Read(...)` rules and nothing else, and no guard in `src/hooks/` matches `reset --hard`, `push --force`, `clean -f` or `--no-verify`. No skill, agent or doc under `.claude/`, `templates/claude/` or `docs/` tells the agent to run a command a new rule denies: `git checkout --conflict=diff3 -- CHANGELOG.md` is run by the ship path through argv, not through the Bash tool, and is in the allowed rows anyway; the merge-conflicts skill recovers with `git merge --abort`. Permission rules apply to the agent's tool calls only, so git that `npm test` or an aidlc command spawns is unaffected. `tests/infra/init.test.ts:230` and `tests/surface/templates.test.ts:79` read the deny list from the template or count at least 18, so neither needs a change. Matching rules, from https://code.claude.com/docs/en/permissions (2026-11-26): `*` matches any text including spaces and can stand anywhere; deny rules apply to every subcommand of a compound command and past leading environment assignments; `PowerShell(...)` rules have the shape of `Bash(...)` rules and match case-insensitively; `Read(~/...)` is home-relative; the page says a rule misses `git -C . push`, `git -c ... push` and `bash -c`, and is not a security boundary."
forbid: [network]
non_goals:
  - "a hook guard that reads `git -C`, `-c`, reordered flags or `bash -c`: card 3 of the plan in issue 498"
  - "`git restore` without `--staged`, `git stash drop` or `clear`, `git branch -D`, `git push origin +<ref>` and `git commit -n`: left to the hook guard, since a literal rule for them would also deny safe forms"
  - "the Hard limits text of `CLAUDE.md` and `templates/CLAUDE.aidlc.md` (issue 500)"
  - "sandbox or `autoMode.environment` settings"
  - "a test of Claude Code's own matcher: the matcher in the test models the documented rules and the rows pin the intended reach"
hygiene: "From issue 498 and the plan agreed with Codex on 2026-11-26 (card 1). RED first: acceptance 1 and 2 alone, on main. Keep the hook `command` lines of the two settings files as they are; they differ by design. The rule order of R2 is the order a reader scans; do not sort."
---

# T0-DENY-IRREVERSIBLE-GIT

From issue 498 (card 1 of the plan agreed with Codex on 2026-11-26), after Lydia Hallie's talk "Rethinking Claude Code Best Practices" (AI Engineer CODE, 2026-11-11).

## Why
`CLAUDE.md` forbids force-push, `reset --hard` and `--no-verify` in prose only, and no hook guard matches them. Auto mode blocked 89% of planted dangerous commands in Anthropic's August study, so about one in ten still runs. These commands cannot be taken back. A deny rule is checked before the auto mode classifier, and a committed rule also reaches cloud sessions and, through `aidlc init`, downstream repositories.

## Deliverable
23 deny rules added to both settings files, a test that the two lists match and that pins which commands they deny and allow, and one paragraph in `docs/OPERATIONS.md` that says what the rules miss.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/settings-deny.test.ts tests/surface/templates.test.ts tests/infra/init.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: both deny lists are the same 41 rules, the denied rows match and the allowed rows do not.
