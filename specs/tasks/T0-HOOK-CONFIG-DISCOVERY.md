---
id: T0-HOOK-CONFIG-DISCOVERY
title: The hook guards read aidlc.config.json at the main checkout root the CLI reads, from every cwd inside the repository, and the relative doctor spellings pass only from that root (issue 118)
status: todo
branch: T0-HOOK-CONFIG-DISCOVERY
worktree: D:\wt\AIDLC\T0-HOOK-CONFIG-DISCOVERY
allow_paths:
  - src/hooks/index.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-CONFIG-DISCOVERY.md
dod_command: npm run typecheck && node --test tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. `loadHookConfig(cwd)` shall read `<mainRoot>/aidlc.config.json`, where mainRoot is `resolveRepoIdentity(cwd).mainRoot` (the directory above git's common directory), the file the CLI reads through `loadProjectConfig(repo.mainRoot)`, from every cwd inside a repository: the main checkout root, a subdirectory of it, a linked worktree and a subdirectory of one. Outside a git checkout, and wherever git cannot answer, `resolveRepoIdentity` gives cwd itself and the file in cwd is read as before. No other file is read, neither a subdirectory's own `aidlc.config.json` nor a linked worktree's copy.
  - R2. From every cwd inside a repository, `loadHookConfig` shall return what it returns at the main checkout root (the same config, or a `HookConfigError` with the same file and detail), so every guard decides at `runHook` and at `dispatchHook` as at the root for the same resolved file target and session state, apart from R3 doctor exemptions and their cwd-specific repair text. A relative Edit or Write target still resolves against the event cwd, and an Edit or Write of the config file named by its absolute path stays the repair route from every cwd, a linked worktree included.
  - R3. Under a config that cannot be used, `node bin/aidlc.js doctor` and `node node_modules/aidlc/bin/aidlc.js doctor` (each alone or followed by ` --json`, ` 2>&1` or ` --json 2>&1`) shall be exempt from the broken-config check only when the event cwd, compared as a canonical path, is the directory that holds the config; `aidlc doctor` and `npx --no-install aidlc doctor` with the same tails are exempt from that check from every cwd. No absolute spelling is added. Each config-error denial and the UserPromptSubmit line shall list the cwd-eligible exemptions, and elsewhere name the node spellings as eligible only from the quoted directory of the config. Existing legacy guard denials still take precedence, including a production pattern matching doctor or a frozen config file; their decisions and text remain unchanged under R4. The existing repair text describes these exemptions, not a promise to bypass other guards.
  - R4. At the main checkout root and outside any checkout, no decision of any guard shall change, at `runHook` or at `dispatchHook`: exit code, decision and reason (or the same throw).
  - R5. `docs/OPERATIONS.md` (Hooks) and the CHANGELOG Unreleased section shall state R1 to R3, and that a change to `hooks.*` on a card branch takes effect for the guards only after it merges, since every session, a worktree included, reads main's file; that this is deliberate (a card branch cannot change its own guards); and that a broken branch copy is caught by that card's tests and CI, not by a lockout. The CHANGELOG entry names the three deliberate changes against main (C1 to C3 in the hygiene).
acceptance:
  - 1. `tests/surface/hooks.test.ts`, in a real temporary git repository with a commit, a subdirectory, a linked worktree and a subdirectory of that worktree (skipped by name when git is missing): `loadHookConfig` from each cwd returns the root's result for a valid config freezing `contracts/` (whose file is the one `loadProjectConfig(resolveRepoIdentity(cwd).mainRoot)` reads), for a config that is not JSON (a `HookConfigError` naming `<mainRoot>/aidlc.config.json`, which `loadProjectConfig` refuses with a `ConfigError` from the same cwd), and for no config (the defaults); an `aidlc.config.json` in the subdirectory and a different committed copy in the worktree are never read. [R1] [R2] [dod arm 1]
  - 2. The same repository: `dispatchHook` from each cwd decides a fixed set of events (Bash writing a frozen path, naming a release, `npm test`; Edit of a frozen file, of a source file, of the config by its absolute path) exactly as from the root after the R3 repair-text substitution, under the valid and the broken config; for a relative config path, compare each cwd with the root event naming that same absolute target (relative paths resolve against their event cwd), under both config states; a session in the linked worktree repairs main's malformed-JSON config through an Edit of its absolute path, while an Edit of the worktree's own copy is denied. Also compare legacy doctor denials from a schema-invalid config with productionPatterns matching doctor, and legacy frozen-config edit denials, from every cwd. [R2] [R4] [dod arm 1]
  - 3. The same repository under the malformed-JSON config (which yields default legacy hooks): each of the sixteen doctor spellings passes from the root; from the subdirectory and from the worktree the eight `node` spellings are denied and the eight others pass; the denial text and the UserPromptSubmit line in each cwd list exactly the spellings that pass there. [R3] [dod arm 1]
  - 4. The pins of T0-HOOK-CONFIG-CLOSED-3 that run in a temporary directory outside any checkout hold unchanged (a directory below the one holding the config takes the defaults there), restated in their comment as outside a checkout. [R1] [R4] [dod arm 1]
  - 5. The same file reads the paragraph this card adds to the Hooks section of `docs/OPERATIONS.md`, the replaced sentence "the file is looked for in the working directory only (issue 118)" is gone, and the CHANGELOG Unreleased entry is read. [R5] [dod arm 1]
depends_on: []
budget: 450
tdd: true
diagnosis:
  root_cause: "loadHookConfig (src/hooks/index.ts) joined the hook event's cwd with aidlc.config.json, so a session whose cwd was below the checkout root, or in a linked worktree, read another file than the CLI (which reads loadProjectConfig(resolveRepoIdentity(cwd).mainRoot)): a subdirectory without the file took the defaults (issue 118), a subdirectory with its own file (templates/ here) took that one, and a worktree took the branch's copy, which a card branch can edit."
  same_class: "Every reader of the project config goes through loadProjectConfig(repo.mainRoot) (the CLI, verify-before-done) or loadHookConfig (the PreToolUse guards and route-new-work); after this card both take mainRoot from resolveRepoIdentity, one git spawn per hook process (about 17 ms measured on Windows), cached per process. Known limit, not a new fail-open since it equals main: where git is missing or fails, resolveRepoIdentity gives cwd and the file in cwd is read. Known limit shared with the CLI and the state directory: with a bare common directory, mainRoot is the bare repository's parent. The relative doctor spellings of T0-HOOK-CONFIG-CLOSED-2 rested on the event cwd holding the config; R3 keeps them exactly where that still holds."
sweep: "grep -n 'loadHookConfig\\|CONFIG_FILE\\|DOCTOR_COMMANDS\\|CONFIG_REPAIR\\|isConfigFile' src/hooks/index.ts lists every reader of the config path and of the doctor list; grep -rn 'loadProjectConfig(' src lists the CLI readers, all on repo.mainRoot."
forbid: [reading any aidlc.config.json other than the one at mainRoot inside a repository or in cwd outside one, walking directories by hand instead of asking resolveRepoIdentity, adding an absolute or quoted doctor spelling, changing config.ts or src/state/paths.ts, changing a decision at the main checkout root or outside a checkout]
non_goals: ["the PowerShell tool outside the guards: issue 117, held for the user", "the option and program forms of the classifier: issue 135", "a directory that is not its own repository but sits inside another follows git's answer, as the CLI and the state directory do"]
hygiene: "Issue 118, design approved by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: boundary (A), the config is <mainRoot>/aidlc.config.json for the hooks and the CLI alike, so a card branch cannot change its own guards; rule 3 for the relative doctor spellings, with no absolute spelling (the partial-grammar lesson); invariants I1 to I5. Deliberate changes against main, each where the old decision came from a file that was not the project's config: C1, a subdirectory holding its own aidlc.config.json now follows the root's; C2, a subdirectory without one follows the root's instead of the defaults; C3, a linked worktree follows main's copy instead of its own. Before R3 the hand-run Codex pre-check answers Q1 (at the main checkout root and outside any checkout, does any decision of any guard at runHook or dispatchHook change from main's) no, Q2 (from any other cwd in the repository, is every decision identical to main's decision at the root for the same resolved target and session state, apart from R3 doctor exemptions and repair text) yes, Q3 (does any cwd other than the config's directory exempt a relative doctor spelling from the broken-config check, or does config-error text list a spelling ineligible for that cwd; legacy guard denials remain authoritative) no, Q4 (is any file read other than <mainRoot>/aidlc.config.json inside a repository or <cwd>/aidlc.config.json outside one) no. The doc-pin extension of the option (1) ruling on T0-HOOK-CLASSIFIER (R2 advisory on 0e69b5b) was met in 267486f and is pinned by T0-HOOK-CLASSIFIER-3 acceptance 5; nothing of it is left for this card."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-HOOK-CONFIG-DISCOVERY

## Deliverable
A session anywhere inside the repository, a subdirectory or a linked worktree included, is guarded by the same `aidlc.config.json` the CLI reads, and the relative doctor commands pass only where they name this checkout's CLI.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Contract clarification (2026-10-04)

Under the user's delegation to decide the continuation, R2 compares resolved targets and session state; relative targets retain their event cwd. R3 lists exemptions from the broken-config check, subject to legacy guards. This resolves the independent pre-check's Q2/Q3 contradictions with R2/R4 without changing root decisions or weakening guards. Existing attempts and review allowances remain in force. Operations documentation must state these qualifications; acceptance 2 exercises relative edits and the legacy denials from every cwd.
