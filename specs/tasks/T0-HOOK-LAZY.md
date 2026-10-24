---
id: T0-HOOK-LAZY
title: A PreToolUse hook loads neither zod nor yaml; the guards load the schema, state and router modules on first use, and an aidlc.config.json text the schema accepted is stamped under .aidlc/cache/hook-config, so the next event skips the schema
status: todo
superseded_by: T0-HOOK-LAZY-2
branch: T0-HOOK-LAZY
worktree: D:\wt\AIDLC\T0-HOOK-LAZY
allow_paths:
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - src/hooks/lazy.ts
  - src/config.ts
  - src/config-file.ts
  - tests/surface/hook-lazy.test.ts
  - tests/surface/bench.test.ts
  - bench/journeys.ts
  - bench/baseline.json
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-LAZY.md
dod_command: npm run typecheck && node --test tests/surface/hook-lazy.test.ts tests/surface/hooks.test.ts tests/surface/hook-name.test.ts tests/surface/fix-task-clear.test.ts tests/surface/bench.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts && npm run build && node bench/run.ts --check
dod_exit: 0
requirements:
  - R1. src/hooks/index.ts and src/hooks/entry.ts shall import statically no module whose import graph reaches zod or yaml. The modules a guard needs that do (`src/config.ts`, `src/core/types.ts`, `src/core/router.ts`, `src/state/goal-store.ts`, `src/state/journal.ts`, `src/state/claims.ts`, `src/coordination/lease.ts`) shall load on first use through `src/hooks/lazy.ts`, which lists them in its exported `LAZY_MODULES` and loads each with `require` from `createRequire` (node:module) and the extension of lazy.ts's own file (`.ts` under src/, `.js` under dist/). `CONFIG_FILE` moves to `src/config-file.ts`, which imports nothing, and `src/config.ts` re-exports it.
  - R2. `loadHookConfig(cwd, probe, env)` shall check the config text with `ProjectConfig` only when the file `<state root>/cache/hook-config`, with the state root `resolveStatePaths(cwd, env)` gives, does not hold exactly the stamp of that text: the lower-case hex sha256 over the bytes of `config`, `config-file`, `core/types` and `core/ci-policy` (the relative import graph of `src/config.ts`, with lazy.ts's extension, in that order) and of zod's `package.json`, each followed by one NUL byte, then over the text. After the schema accepts the text it writes the stamp with `writeFileSync`, only when the state root directory exists (creating `cache/` under it). A stamp file that is absent, unreadable or holds anything else, a state root that does not exist or cannot be resolved, and a stamp computation or write that fails each leave the schema check in place. The lookup, the read, the legacy reading, the JSON parse and the regular-expression check run as on main, in main's order.
  - R3. `runHook` and `dispatchHook` shall pass their environment to `loadHookConfig`, so the stamp is read and written under the state directory the guards use (`AIDLC_STATE_DIR` included). The guards' decisions, outputs and order are unchanged, and `runHook`, `dispatchHook` and `loadHookConfig` stay synchronous.
  - R4. bench/journeys.ts shall run a journey that has an event once without the counter, in the same state directory, before its counted or timed run, so each hook journey measures a session whose stamp is written. bench/baseline.json shall hold the ceilings `npm run bench -- --ratchet` lowers after `npm run build` on this card's candidate, and the `fsBytesRead` ceiling of each hook journey raised by hand to its count (the stamp reads about 75 KB of schema sources), with the reason in the PR body.
  - R5. docs/OPERATIONS.md Hooks shall carry, after its first paragraph, one paragraph stating which modules load on first use, the stamp (its file, what it hashes, when it is written, what every other state of the file does), what a stamp written by hand can change, and the measured times; the first paragraph's measured time per tool call shall be the new measurement; the Loop benchmark journeys paragraph shall state the uncounted first run. docs/ARCHITECTURE.md shall carry a `cache/hook-config` row in the state table and one sentence on `src/hooks/lazy.ts` after the hooks sentence; CHANGELOG.md Unreleased an entry under this card id.
acceptance:
  - 1. tests/surface/hook-lazy.test.ts runs `bin/aidlc-hook.js` with `bench/counter.ts` in the repository root over a fresh state directory and sends a PreToolUse Bash event (`git status`) and a PreToolUse Edit event, each twice: the first run of each loads zod and leaves `cache/hook-config` holding the R2 stamp, which the test computes itself from the four sources under the entry directory the counter reports (`src` or `dist`) and `node_modules/zod/package.json`; the second run of each loads no module under node_modules (`depBytes` 0, no `deps`); every run exits 0 with no output. [R1] [R2] [dod arm 2]
  - 2. tests/surface/hook-lazy.test.ts calls `loadHookConfig` over five config texts: valid with an unknown `hooks` key, failing the schema, not JSON, with a `hooks.productionPatterns` entry that is not a regular expression, and no file; with no state root, a cold state root and the same root warm, each result deepEquals the literal result the test states for that text (a config value or a `HookConfigError` with its literal detail); a stamp is left exactly for the two texts the schema accepts (the valid one and the one with the bad pattern); a stamp file holding the stamp with one character changed, and a stamp path that is a directory, give the same literal results; after a valid text is stamped, a schema-failing text gives the schema error; a stamp the test writes for the schema-failing text makes `loadHookConfig` return that text's legacy reading, so a hit skips the schema and nothing else. [R2] [dod arm 2]
  - 3. tests/surface/hook-lazy.test.ts, `dispatchHook` on a PreToolUse Bash event in a git fixture whose state root holds the stamp of a valid config, after the config is replaced by a schema-failing text, denies with the literal broken-config denial main gives, on two runs in a row; `runHook('protect-paths', ...)` with `AIDLC_STATE_DIR` naming an existing directory writes the stamp there, and with `AIDLC_STATE_DIR` naming a directory that does not exist creates nothing. [R2] [R3] [dod arm 2]
  - 4. tests/surface/hook-lazy.test.ts: every `LAZY_MODULES` entry names a file under src/ with the `.ts` extension; each loader of lazy.ts returns the namespace object `import()` of that file returns; the relative import graph of `src/config.ts`, followed from the source text, is exactly `config`, `config-file`, `core/types` and `core/ci-policy`, and the only package it imports is `zod`; the static imports of src/hooks/index.ts and src/hooks/entry.ts name none of `LAZY_MODULES`. [R1] [R2] [dod arm 2]
  - 5. `npm run build && node bench/run.ts --check` exits 0 on the candidate [dod arms 3, 4]; in bench/baseline.json `hook.pre-bash` and `hook.pre-edit` carry `depBytes` 0 and `modules` at most 15; tests/surface/bench.test.ts passes with the uncounted first run and reads the changed Loop benchmark paragraph exactly. [R4] [dod arm 2]
  - 6. tests/surface/hook-lazy.test.ts reads the new docs/OPERATIONS.md Hooks paragraph whole, the changed sentence of the first Hooks paragraph, the docs/ARCHITECTURE.md row and sentence, and the CHANGELOG.md entry beginning `- T0-HOOK-LAZY:`, and each assertion fails with any one sentence removed. [R5] [dod arm 2]
  - 7. `npm run typecheck` is clean [dod arm 1]; tests/surface/hooks.test.ts, hook-name.test.ts, fix-task-clear.test.ts, prose.test.ts and mirror.test.ts pass [dod arm 2], and the diff changes no assertion in the first three (reviewer-verified). [R1] [R3]
depends_on: []
budget: 150
tdd: true
sweep: "Measured at main 794624a on Windows with Node 22.23.1, interleaved, median of 15 runs over a written stamp: PreToolUse Bash 246 ms on main against 128 ms with a prototype of this card, Edit 249 against 130, UserPromptSubmit 248 against 204, Stop 241 against 200 (bare node start about 50 ms). Counts of the PreToolUse Bash hook under bench/counter.ts: modules 189 to 12, depBytes 1.14 MB to 0, fsCalls 7 to 8, fsBytesRead 3.6 KB to 78.5 KB; the first run after a config or schema change loads zod as main does (modules 110). zod loads 95 files (about 60 ms, 60 of them locales, which every zod entry exports), yaml 72 (about 39 ms). Every hook event checks aidlc.config.json with ProjectConfig (loadHookConfig), so lazy loading alone keeps zod on every event; the stamp removes it. A redirect of zod's locale index saved 16 ms net and is not used. Callers of loadHookConfig: src/hooks/entry.ts dispatchHook, runHook; tests/surface/hooks.test.ts calls it 19 times with temp directories outside git and no AIDLC_STATE_DIR, so no stamp is written there. Pinned docs: tests/surface/bench.test.ts reads the Loop benchmark paragraphs exactly; tests/surface/fix-task-clear.test.ts reads the fix-task row of the ARCHITECTURE state table."
forbid:
  - a guard decision, output or order in src/hooks/index.ts that differs from main for any config text while the stamp file holds only values loadHookConfig wrote
  - a stamp written by any function but loadHookConfig, or outside an existing state root
  - an asynchronous runHook, dispatchHook or loadHookConfig
  - a changed assertion in tests/surface/hooks.test.ts, hook-name.test.ts or fix-task-clear.test.ts
  - removing the schema check from loadProjectConfig in src/config.ts
  - a ceiling in bench/baseline.json raised by hand other than fsBytesRead of the hook journeys
non_goals:
  - zod out of the prompt and Stop events (src/core/router.ts reads CARD_ID_REGEX from src/core/types.ts; the Stop hook parses every goal with zod)
  - the git rev-parse spawn per hook (about 25 ms)
  - the src/ walk of bin/resolve-entry.js (115 fs calls)
  - the Stop hook reading every goal
  - guarding .aidlc/cache/hook-config against hand edits
  - a bench journey for the first event after a config change
hygiene: "RED first: seam modules (src/hooks/lazy.ts exporting LAZY_MODULES and loaders over static imports, src/config-file.ts) are committed before the RED run, so tests/surface/hook-lazy.test.ts fails on its assertions, not on imports. Tests build fixtures under a fresh mkdtemp directory removed in a finally block, read no clock, build child environments without AIDLC_* variables, and take every expected result from a literal or from the rule in R2, never from the code under test on another path."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-HOOK-LAZY

## Deliverable
Each Bash, Edit, Write and MultiEdit tool call runs the PreToolUse hook. On main that hook loads zod and yaml (167 files, 1.14 MB) before any guard runs, and checks `aidlc.config.json` with the zod schema on every event. After this card the guards load the schema, state and router modules only on the branches that use them, and the schema check runs only for a config text it has not accepted before under the same schema: the hook writes a stamp of the accepted text to `.aidlc/cache/hook-config` and the next event compares the stamp instead of loading zod. Measured: 246 ms to 128 ms per Bash call on Windows.

## The rule against main
For every config text, `loadHookConfig` returns what main returns, provided the stamp file holds only values `loadHookConfig` wrote. A stamp is written only after the schema accepted the text, and it hashes the text with every file the schema is built from and zod's version, so a match means the same schema accepted the same text, and the check would accept it again (the schema's refinements are pure functions of the input). Every other state of the stamp file runs main's check.

## Decisions
- A stamp, since no field of the hook event says whether the config is valid; only running the schema does (contrast T1-EFF-HOOK-QUIET-2, where an event field covered the case). Every way the stamp can be wrong (absent, stale, torn by a concurrent write, unreadable, no state directory, a failed write) is a miss, which costs one zod load and changes no decision.
- Content hashes, not file times: npm gives every installed file the same mtime, so an upgrade that changes the schema without changing a size would match a stamp built from file stats. Hashing about 75 KB costs about 0.3 ms; `fsBytesRead` of the hook journeys is raised by hand for it.
- A stamp written by hand can change one thing: a text the schema rejects reads as its legacy `hooks` values, the reading main gives every valid text; the regular-expression check still runs. A writer of `aidlc.config.json` can already turn production-gate and protect-tests off with a schema-valid config (empty pattern lists), and a frozen config cannot be edited at all, so a writer of `.aidlc/` gains nothing a writer of the config lacks.
- `require`, since the guards decide synchronously and `runHook` has 162 synchronous callers in tests/surface/hooks.test.ts. tsc rewrites the extension of import paths and never of `require` paths, so lazy.ts takes the extension of its own file. Node loads an ES module through `require` from 22.12 (engines: 22.18 and later) and prints no warning for it from 22.13; a module imported statically and one loaded through `require` are one instance, so `StoreError` stays one class.
- `writeFileSync`, not the atomic temp-and-rename write: a torn or concurrent write leaves a value that does not match, which is a miss, and no temporary file is left under `cache/`.
