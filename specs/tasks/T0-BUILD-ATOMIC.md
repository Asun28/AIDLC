---
id: T0-BUILD-ATOMIC
title: npm run build writes each output of dist/ whole, through a temporary sibling renamed onto it, and the two compiled entries last, so a hook or CLI process started during a build never loads an empty or partly written module
status: todo
branch: T0-BUILD-ATOMIC
worktree: D:\wt\AIDLC\T0-BUILD-ATOMIC
allow_paths:
  - scripts/build.ts
  - package.json
  - tsconfig.test.json
  - tests/infra/build-atomic.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - CLAUDE.md
  - README.md
  - specs/tasks/T0-BUILD-ATOMIC.md
dod_command: npm run typecheck && node --test tests/infra/build-atomic.test.ts tests/infra/bin-entry.test.ts tests/surface/prose.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/readme.test.ts tests/surface/mirror.test.ts tests/surface/bench.test.ts && npm run build
dod_exit: 0
requirements:
  - R1. `npm run build` shall run `node scripts/build.ts`, which compiles the program of `tsconfig.json` with the TypeScript compiler API and emits the same files with the same bytes as `tsc -p tsconfig.json` at 302dfd1, writing each one to a temporary sibling in the same directory that is then renamed onto it (`atomicWriteText`, src/state/store.ts), and never opening an output path itself for writing; a process that reads an output while the build runs reads the whole earlier file or the whole new one.
  - R2. The build shall write `hooks/entry.js` and `cli/main.js` under the output directory, the compiled entries that `bin/resolve-entry.js` compares with the sources, after every other output of the build, so that once the build makes an entry newer than every source file, each module that entry loads is already an output of this build. A write that fails stops the build before either entry is written, with exit 1 and `build: <error>` on stderr, so a failed build never writes an entry.
  - R3. The build shall honour `-p`/`--project <tsconfig>` and `--outDir <dir>` as tsc does, print every error diagnostic in tsc's format (`<file>(<line>,<col>): error TS<code>: <message>`), and exit 0 when there is none, 2 when there is one and outputs were written, 1 when there is one and the emit was skipped, as tsc does.
  - R4. `tsconfig.test.json` shall typecheck `scripts/**/*.ts`; docs/OPERATIONS.md, as the paragraph right after the paragraph that starts `One hook process per event.`, shall carry the OPERATIONS text of the Doc text section; the CHANGELOG Unreleased section shall carry its entry; the `npm run build` lines of CLAUDE.md (Commands) and README.md shall name `scripts/build.ts`.
acceptance:
  - 1. `tests/infra/build-atomic.test.ts`: the `build` script of package.json, run with a preload that records each `openSync` with a write flag, `writeFileSync` and `renameSync` under a temporary output directory (`--outDir`), writes every output under it (`.js`, `.js.map`, `.d.ts`, `.d.ts.map`) only by a rename from a temporary sibling in the same directory, and opens or writes no output path in place. At 302dfd1 (`tsc -p tsconfig.json`) every output is opened for writing in place. [R1] [dod arm 2]
  - 2. Same file: the outputs of that build are the files of `tsc -p tsconfig.json --outDir <sibling directory>` with the same relative paths and the same bytes, and no temporary file is left under the output directory. [R1] [dod arm 2]
  - 3. Same file: in the record of acceptance 1, the last write onto `hooks/entry.js` and the last write onto `cli/main.js` (a rename onto it, or an open in place) come after the last write onto every other output. At 302dfd1 other outputs are written after `hooks/entry.js`. [R2] [dod arm 2]
  - 4. Same file: `node scripts/build.ts -p <fixture>/tsconfig.json` on a fixture with one type error prints `a.ts(1,7): error TS2322:` and exits 2 with `out/a.js` written; with `noEmitOnError` it exits 1 and writes no output; with the error fixed it exits 0 and prints nothing. [R3] [dod arm 2]
  - 5. Same file: package.json `scripts.build` is `node scripts/build.ts`, `tsconfig.test.json` includes `scripts/**/*.ts`, and one assertion per sentence of the Doc text section, read from docs/OPERATIONS.md (the paragraph after `One hook process per event.`), the CHANGELOG Unreleased section, CLAUDE.md and README.md, so removing any one fails the test. [R4] [dod arm 2]
  - 6. Same file: `node scripts/build.ts -p <fixture>/tsconfig.json` on a fixture with `hooks/entry.ts`, `cli/main.ts` and `core/a.ts`, run with a preload that makes the rename onto `core/a.js` throw, exits 1 with `build: ` and the injected error on stderr and writes neither `hooks/entry.js` nor `cli/main.js`; without the preload it exits 0 and writes all three. [R2] [dod arm 2]
  - 7. `npm run typecheck` is clean [dod arm 1]; tests/infra/bin-entry.test.ts, tests/surface/prose.test.ts, tests/surface/tsconfig-gate.test.ts, tests/surface/readme.test.ts, tests/surface/mirror.test.ts and tests/surface/bench.test.ts (each reads a file this card changes) pass with no assertion changed (reviewer-verified against the diff) [dod arm 2]; `npm run build` exits 0 [dod arm 3].
depends_on: []
budget: 75
tdd: true
diagnosis:
  root_cause: "`npm run build` is `tsc -p tsconfig.json` (package.json at 302dfd1), and tsc writes each output in place: `ts.sys.writeFile` opens the output path with flag `w`, which empties it, then writes the text. `bin/aidlc-hook.js` and `bin/aidlc.js` choose dist/ when the compiled entry is at least as new as every source (`bin/resolve-entry.js`), which holds for the whole of a rebuild of an unchanged tree, so a hook started while tsc emits can read a module in the moment between the empty and the write. Reproduced at 08bc6f2 in a scratch worktree: three readers looping over the 66 dist/ `.js` files during each of three identical rebuilds read 23 files at 0 bytes (`hooks/index.js` and `core/router.js` among them). With `dist/hooks/index.js` or `dist/core/types.js` empty, a PreToolUse Write of `.env` through `bin/aidlc-hook.js` exits 1 with a SyntaxError and no deny, so the write the secrets guard denies goes ahead; with `dist/core/router.js` empty, a typed request exits 0 with no routing line and `[aidlc hook] lazy.router(...).classifyRequest is not a function` on stderr, the symptom of follow-up 6 of the harness2 report. 883 hook runs during rebuild, touched-source and clean builds all matched the run with no build: tsc emits `hooks/entry.js` second to last, so a build with a stale or missing module is not chosen, and the empty file only lasts a moment."
  same_class: "Writers of a file that a hook or CLI process loads as code while it is written (sweep): (1) `npm run build`, tsc writing dist/: fixed here (R1, R2). (2) A bare `tsc` or `npx tsc` writes dist/ in place as before: not changed, the docs name `npm run build` as the build. The other in-place writers in src/ (sweep below) write data, not code: the state store already writes through `atomicWriteText`, and the only one a hook reads, the fix-task marker (src/cli/main.ts:595), counts by its presence, empty or not (`fixTaskMarker`): not the same class."
sweep: "git grep -n -E 'writeFileSync\\(|appendFileSync\\(|createWriteStream\\(' -- src bin (302dfd1): lessons.ts:123,129; manifest.ts:70,81,83; main.ts:595,648,673; github-ship.ts:491,568; card-runner.ts:1627,1664,2234; controller.ts:801,805; incident.ts:40,104; pre-review.ts:298,900,909,1198; init.ts:48,94,107,155,175; journal.ts:45,142. None writes under dist/. git grep -n -E 'npm run build|tsc -p tsconfig.json|tsc ->' -- docs README.md CLAUDE.md templates tests src bench .github (302dfd1): CLAUDE.md:18,24; README.md:16,24,128; OPERATIONS.md:351,353 and bench.test.ts:216,243,244 (name the command, unchanged); bench/ratchet.ts:89, bench/run.ts:63 (name the command, unchanged); ci.yml:32,49 and aidlc-ci.yml:28 in .github and templates (run the command, unchanged); tsconfig-gate.test.ts:27 (a CHANGELOG line, unchanged)."
forbid: [a change to bin/ or src/hooks/, a change to the compiler options of tsconfig.json, a different set or content of the files in dist/, a change to an existing assertion]
non_goals: [a bare tsc or npx tsc run, what the hook entry does when a module fails to load (exit 1 or exit 0 with the error on stderr), removing outputs of deleted sources, a freshness check of every file in dist/]
doc_sync: docs/OPERATIONS.md (the paragraph after the hook-process paragraph), CHANGELOG.md, CLAUDE.md (Commands), README.md
---

# T0-BUILD-ATOMIC

## Deliverable
`npm run build` runs `node scripts/build.ts`. The script compiles `tsconfig.json` with the TypeScript compiler API, the same program and options as `tsc -p tsconfig.json`, and writes each output through `atomicWriteText` (src/state/store.ts): a temporary sibling renamed onto the output, so a reader sees the whole earlier file or the whole new one. It writes `hooks/entry.js` and `cli/main.js` after every other output, so the moment an entry becomes newer than the sources, every module it loads is already this build's output. Until now tsc emptied each output and then wrote it, and a hook started during the build could load an empty module: a PreToolUse guard then exited 1 with no deny, and the routing guard printed nothing. The script honours `-p` and `--outDir`, prints diagnostics in tsc's format and exits with tsc's codes.

## Doc text
- OPERATIONS: `npm run build` runs `scripts/build.ts` (card T0-BUILD-ATOMIC), which compiles the program of `tsconfig.json` as `tsc -p tsconfig.json` does and writes each file of dist/ to a temporary sibling renamed onto it, `hooks/entry.js` and `cli/main.js` last, so a hook or CLI process started during a build loads the whole earlier module or the whole new one. Under `tsc` a hook could load a module emptied for its rewrite: a PreToolUse guard then exited 1 with no deny and the routing guard printed nothing. A bare `tsc` still writes dist/ in place.
- CHANGELOG: - T0-BUILD-ATOMIC (bugfix): `npm run build` runs `scripts/build.ts`, which emits the files `tsc -p tsconfig.json` emits with the same bytes, each written to a temporary sibling and renamed onto it, and the two compiled entries last. Before, tsc emptied each file of dist/ before writing it, so a hook started during a build could load an empty module and run no guard: a denied write went ahead, and a typed request got no routing line.
- CLAUDE.md: `npm run build                  # scripts/build.ts: tsc -> dist/, each file written whole (rewrites .ts imports to .js)`
- README: `npm run build        # scripts/build.ts: tsc -> dist/, each file written whole`

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/build-atomic.test.ts tests/infra/bin-entry.test.ts tests/surface/prose.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/readme.test.ts tests/surface/mirror.test.ts tests/surface/bench.test.ts && npm run build
```
- Expected exit code: 0
- Assertion: typecheck is clean; the build writes every output by a rename from a temporary sibling, the same files with the same bytes as tsc, the two entries last and none after a failed write; diagnostics and exit codes match tsc; the doc sentences are present; the bin-entry, prose, tsconfig-gate, readme, mirror and bench tests pass; the build exits 0.
