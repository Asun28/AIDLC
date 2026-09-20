---
id: T0-WORKTREE-ROOT-DEFAULT
title: An empty worktreeRoot resolves to <platform root>\<repository name> instead of the machine-wide <platform root>, so two repositories with a card of the same id no longer share one worktree directory
status: todo
branch: T0-WORKTREE-ROOT-DEFAULT
worktree: D:\wt\AIDLC\T0-WORKTREE-ROOT-DEFAULT
allow_paths:
  - src/config.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/surface/config.test.ts
  - tests/scenarios/t0-flow.test.ts
  - templates/cards/_TEMPLATE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-WORKTREE-ROOT-DEFAULT.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `worktreeRoot` is set in `aidlc.config.json`, `resolveWorktreeRoot` shall return it unchanged.
  - R2. WHEN `worktreeRoot` is empty, `resolveWorktreeRoot` shall return the platform root joined with the base name of the main checkout, `%SystemDrive%\wt\<name>` on Windows and `$HOME/.wt/<name>` elsewhere, so a card id is a directory under its own repository's root and never under the machine's.
  - R3. Every caller shall pass the main checkout it resolves for, and the signature shall make an omitted main root a type error rather than a silent machine-wide default.
  - R4. A repository whose worktrees already live under the machine-wide root shall stop at PREPARE with the existing path-mismatch ownership message until it sets `worktreeRoot` explicitly; no worktree is moved, searched for elsewhere or created for it.
acceptance:
  - 1. `resolveWorktreeRoot(config, mainRoot, env, platform)` (tests/surface/config.test.ts, new file): an explicit root is returned as given on both platforms; an empty root gives `path.join(env.SystemDrive, 'wt', name)` for `win32` and `path.join(env.HOME, '.wt', name)` otherwise, where `name` is the base name of `mainRoot` with a trailing separator dropped (`D:\Projects\AIDLC\` and `D:\Projects\AIDLC` resolve the same), computed by the named platform's path rules so the result is the same on any host; a `mainRoot` with no base name (a filesystem root such as `D:\` or `/`) throws an error naming `worktreeRoot` instead of falling back to the unscoped root; a missing or empty `SystemDrive` falls back to `C:` and a missing or empty `HOME` to `/tmp`; `platform` defaults to `process.platform` and `env` to `process.env`. [R1] [R2] [dod arm 2]
  - 2. `mainRoot` is a required parameter, so `npm run typecheck` proves every call site passes it: the two ship-path constructions, `worktreePath` and PREPARE in `src/loop/card-runner.ts` pass the repository's main root, and `aidlc cards project` in `src/cli/main.ts` passes `c.root`. [R3] [dod arm 1]
  - 3. A dry-run PREPARE under an empty `worktreeRoot` records the run's `worktree` as `<platform root>/<basename(fx.tmp)>/<card id>` (t0-flow.test.ts: a fixture with `config: { worktreeRoot: '' }`; the path's last three segments are asserted, the platform root is read off `resolveWorktreeRoot` with the same environment, and no directory is created under it). [R2] [dod arm 2]
  - 4. `templates/cards/_TEMPLATE.md` shows the per-repository default in its example `worktree:` line and still parses once the id is real (templates.test.ts); `docs/OPERATIONS.md` states the new default where it states the old one today and names the migration rule (set `worktreeRoot` to the old root, or move the worktrees, before the next PREPARE; the mismatch stops with the ownership message); CHANGELOG.md Unreleased carries the entry with that rule. [R4] [dod arm 3]
depends_on: []
budget: 120
tdd: true
sweep: "grep -rn 'resolveWorktreeRoot\\|SystemDrive\\|\\.wt' src/ templates/ docs/ README.md CLAUDE.md: the resolver and its four call sites, the template example line, the OPERATIONS paragraph"
forbid: [a second root probed in order when the expected path is missing, a config migration written by the CLI, reading the repository name from a git remote, a change to decideWorktree or findWorktree]
non_goals: [moving existing worktrees, a lookup in the previous root, the renderCard fallback for callers that pass no root, this repository's explicit worktreeRoot (already D:\wt\AIDLC)]
hygiene: "A downstream repository with an empty worktreeRoot and worktrees under the old root stops at its next PREPARE with `worktree for <id> is at <old root>\\<id>, expected <old root>\\<name>\\<id>`; the CHANGELOG entry states the one-line fix. This repository is unaffected: its root is explicit."
doc_sync: templates/cards/_TEMPLATE.md (example worktree line), docs/OPERATIONS.md (worktreeRoot paragraph), CHANGELOG.md
---

# T0-WORKTREE-ROOT-DEFAULT

## Deliverable
`resolveWorktreeRoot` (src/config.ts) returns `%SystemDrive%\wt` on Windows and `$HOME/.wt` elsewhere when `worktreeRoot` is empty, so every repository on a machine that keeps the installed default shares one root and two repositories with a card of the same id collide on one directory (found when this repository's cards were moved to `D:\wt\AIDLC` and `C:\wt` turned out to hold another project's worktrees under the same id pattern). This card scopes the default to the repository: the platform root joined with the base name of the main checkout, `C:\wt\AIDLC` or `~/.wt/AIDLC` for a checkout at `.../AIDLC`. The resolver takes the main root as a required parameter; the four call sites (two ship-path constructions, `worktreePath` and PREPARE in the card runner, `aidlc cards project` in the CLI) pass it. An explicit `worktreeRoot` is unchanged. A repository whose worktrees already sit under the old root is not searched or migrated: its next PREPARE stops with the existing path-mismatch ownership message, and the docs and CHANGELOG say to set `worktreeRoot` to the old root or move the worktrees.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the resolver tests pass for both platforms and both branches (explicit, empty), the dry-run PREPARE scenario records the per-repository path, the template still parses, and typecheck admits no call site without a main root.
