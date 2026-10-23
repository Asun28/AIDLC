---
id: T0-LOOP-BENCH
title: npm run bench measures the loop's hot paths (each hook event, the Stop hook over 200 finished goals, the CLI start) with deterministic counts against ceilings in bench/baseline.json that only go down, and a CI job fails a change that raises one
status: todo
branch: T0-LOOP-BENCH
worktree: D:\wt\AIDLC\T0-LOOP-BENCH
allow_paths:
  - bench/
  - tests/surface/bench.test.ts
  - package.json
  - tsconfig.test.json
  - .github/workflows/ci.yml
  - CLAUDE.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-LOOP-BENCH.md
dod_command: npm run typecheck && node --test tests/surface/bench.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. bench/counter.ts, loaded with `node --import`, shall count for one process `modules` (modules loaded from file URLs), `depBytes` (source bytes of the ones under node_modules), `ownBytes` (source bytes of the others, reported and never compared), `startFsCalls` (synchronous fs calls before the entry module `hooks/entry` or `cli/main` loads), `fsCalls` and `fsBytesRead` (synchronous fs calls, and the bytes `readFileSync` returned, from that load until exit), `spawns` (child processes started) and `entry` (`dist` or `src`, the directory the entry module loaded from); it shall count a fs call only when its direct caller is not a `node:` frame, so Node's own module loader never counts, keep `fs.realpathSync.native` callable, and write the counts as JSON at exit to the file `AIDLC_BENCH_OUT` names, with the unwrapped fs functions.
  - R2. bench/journeys.ts shall define six journeys run with the counter, `hook.pre-bash`, `hook.pre-edit`, `hook.prompt` and `hook.stop` (one event each on stdin of `bin/aidlc-hook.js`, in the repository root), `hook.stop.200-goals` (the Stop event over a state directory holding 200 DONE goals) and `cli.start` (`bin/aidlc.js goal list` over an empty state directory); each run shall get a fresh state directory under the OS temp directory, removed after the run, and an environment holding no `AIDLC_*`, `CLAUDE_CODE_SESSION_ID`, `RELEASE_APPROVAL` or `AIDLC_RELEASE_APPROVAL` variable other than the bench's own (`AIDLC_STATE_DIR`, `AIDLC_SESSION=bench`, `AIDLC_BENCH_OUT`); `outBytes` (stdout plus stderr bytes) joins the counts.
  - R3. bench/ratchet.ts `compare` shall fail a gated metric whose count exceeds `ceiling * (1 + slack)`, with the metric's slack from the baseline, and compare `startFsCalls` only when the journey ran the entry the baseline recorded; `ratchet` shall return each ceiling as the lower of the ceiling and the count, add a journey or a metric missing from the baseline at its count, never raise a ceiling, and refuse (throw) when a journey ran the `src` entry.
  - R4. `npm run bench` (bench/run.ts) shall run every journey once and print one line per journey with each gated metric, its ceiling and its status, and the three largest dependencies by bytes; `--time <n>` adds the median wall time of n further runs without the counter, reported and never compared; `--check` exits 1 when a metric fails and 0 otherwise; `--ratchet` writes the lowered ceilings to bench/baseline.json; `--json` prints the report as JSON.
  - R5. bench/baseline.json shall hold the slack of each gated metric once (`modules` 0.05, `depBytes` 0.02, `startFsCalls` 0.1, `fsCalls` 0.1, `fsBytesRead` 0.1, `spawns` 0, `outBytes` 0) and, per journey, the entry and the ceiling of each gated metric, written by `npm run bench -- --ratchet` after `npm run build` on this card's candidate.
  - R6. `.github/workflows/ci.yml` shall carry a `bench` job on ubuntu-latest, beside `check`, that runs `npm ci`, `npm run build` and `npm run bench -- --check`; no hook, card-machine step, DoD or `npm run check` runs the bench, and nothing under src/ imports from bench/.
  - R7. `tsconfig.test.json` shall include `bench/**/*.ts`, so `npm run typecheck` covers the bench; `docs/OPERATIONS.md` shall carry a `## Loop benchmark` section after `## Evals` stating the journeys, the metrics, why wall time is reported and never gated, the ratchet rule (ceilings only go down; a raise is a hand edit of bench/baseline.json in the PR that needs it, with the reason in the PR body), when the bench runs (every PR and every push to main in CI; by hand with `--time` before and after a Node, dependency or Claude Code upgrade) and the rule that a metric stays gated only while lowering it lowers the median wall time; `docs/ARCHITECTURE.md` one sentence naming bench/; CLAUDE.md one `npm run bench` line in Commands; CHANGELOG.md Unreleased an entry under this card id.
acceptance:
  - 1. tests/surface/bench.test.ts, a child process run with the counter that imports one node_modules package, reads a fixture file twice with `readFileSync` and spawns `node -e 0` once reports `modules` of at least 1, `depBytes` above 0, `fsCalls` 2, `fsBytesRead` twice the file size and `spawns` 1; a second run gives the same counts; `fs.realpathSync.native` returns a path under the counter. [R1] [dod arm 2]
  - 2. tests/surface/bench.test.ts, `compare` with ceiling 100 and slack 0.1 passes 110 and fails 111, and skips `startFsCalls` when the entry differs from the baseline's; `ratchet` lowers 100 to 90, keeps 100 for a count of 120, adds a new journey at its counts, and throws when a journey ran the `src` entry. [R3] [dod arm 2]
  - 3. tests/surface/bench.test.ts, two runs of `hook.pre-bash` give identical gated counts, with `spawns` 1 and `outBytes` 0; `hook.stop.200-goals` reads more bytes than `hook.stop`; no state directory a run created is left in the OS temp directory. [R2] [dod arm 2]
  - 4. tests/surface/bench.test.ts, `node bench/run.ts --check --json` in the candidate exits 0 and its report names the six journeys, each gated metric within its ceiling. [R4] [R5] [dod arm 2]
  - 5. tests/surface/bench.test.ts, ci.yml has a `bench` job whose steps run `npm run build` before `npm run bench -- --check`; no file under src/ imports from bench/; the `check` script in package.json does not name bench. [R6] [dod arm 2]
  - 6. `npm run typecheck` is clean with bench/ included [dod arm 1]; tests/surface/tsconfig-gate.test.ts and tests/surface/prose.test.ts pass [dod arm 2]; the OPERATIONS section, the ARCHITECTURE sentence, the CLAUDE.md line and the CHANGELOG entry are reviewer-verified against the diff. [R7]
depends_on: []
budget: 150
tdd: true
sweep: "Hot paths at main eaaa2c9, measured on Windows with Node 22.23.1: a PreToolUse hook takes about 220 ms against 41 ms for a bare node start, the Stop hook about 335 ms; zod costs about 80 ms of it (853 KB of module source), yaml 288 KB, one git rev-parse spawn about 25 ms; bin/resolve-entry.js stats every file under src/ on each hook (about 115 fs calls); the Stop hook reads every goal file (GoalStore.listGoals, 962 KB with the 123 goals of the live state). Node's on-disk compile cache (NODE_COMPILE_CACHE) made the PreToolUse hook slower in an interleaved A/B (293 ms against 222 ms), so it is not used. Pinned files: tests/surface/tsconfig-gate.test.ts reads tsconfig.test.json (extends, no unused-code overrides) and one CLAUDE.md sentence the card leaves unchanged; tests/surface/prose.test.ts bans the em dash in CLAUDE.md, docs/ and specs/; no test reads .github/workflows/ci.yml."
forbid:
  - a change under src/, bin/ or templates/ (the bench measures the loop; it changes none of it)
  - a gate on wall time
  - running the bench from a hook, the card machine, a DoD other than this card's, or `npm run check`
  - a ceiling raised by `--ratchet`
non_goals:
  - the optimizations the bench points at (zod out of the hook path, the src/ walk in bin/resolve-entry.js, the Stop hook reading every goal, the git spawn per hook), each its own card measured by this bench
  - field metrics from the card runs under .aidlc (card wall time, review decisions per card) and control bands over them
  - a context-size bench (skill files, directives, reviewer prompts)
  - a scheduled job that commits lowered ceilings to main
  - asynchronous fs calls (the hooks and the CLI start read synchronously)
hygiene: "RED first: tests/surface/bench.test.ts fails on the missing bench modules. Tests build fixtures under a fresh mkdtemp directory removed in a finally block, read no clock and spawn node with the counter through spawnSync. The 200-goal fixture is written with GoalStore.saveGoal over Goal.parse records with fixed ISO timestamps."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CLAUDE.md, CHANGELOG.md
---

# T0-LOOP-BENCH

## Deliverable
`npm run bench` runs six journeys of the loop (four hook events, the Stop hook over 200 finished goals, the CLI start) once each under a counting preload and compares deterministic counts (modules loaded, dependency bytes, fs calls, bytes read, processes spawned, output bytes) with checked-in ceilings in `bench/baseline.json`. `--check` fails on a count above its ceiling plus the metric's slack, `--ratchet` lowers ceilings and never raises them, and `--time <n>` reports median wall time beside the counts without gating on it. A `bench` CI job runs the check on every PR and every push to main, apart from the `check` job, so no local step gets slower.

## Why counts and not wall time
Wall time on one machine moves by tens of milliseconds between identical runs, so a gate on it fails at random. The counts are the same on every run of the same code, and each one is tied to wall time by measurement: 853 KB of zod source costs about 80 ms per hook, one git spawn about 25 ms. A count that stops tracking wall time leaves the gate (docs/OPERATIONS.md, Loop benchmark).

## Decisions
- Fs calls whose direct caller is a `node:` frame are Node's module loader at work; they change with the Node version and are covered by `modules` and `depBytes`, so they are not counted.
- `startFsCalls` (the bin freshness check) depends on whether `dist/` exists, so it is compared only between runs of the same entry, and `--ratchet` runs only on the compiled entry; CI builds before the check.
- Slack bounds the creep to a fixed share above the best count recorded, and is 0 for spawned processes and for output, which reaches the model's context on every event.
