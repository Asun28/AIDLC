# CLAUDE.md

## What this is

`aidlc` is a TypeScript library plus CLI that runs the AI-native SDLC loop
with bounded autonomy. This repository runs the loop on itself: `.claude/`
here is the live copy of what `aidlc init` installs from `templates/`, and
this repo's own cards live in `specs/tasks/`. Node >= 22.18 is required; the
CLI and tests run the TypeScript sources directly (type stripping), so no
build step is needed for development.

## Commands

```bash
npm run check                  # typecheck (src + tests) then the full suite; CI runs this, then `npm run build`
npm run typecheck              # tsc -p tsconfig.test.json --noEmit
npm test                       # node --test over tests/**/*.test.ts, spec reporter
node --test tests/core/router.test.ts                                   # one file
node --test --test-name-pattern "same cause" tests/core/effort.test.ts  # one test by name
npm run test:watch
npm run build                  # scripts/build.ts: tsc -> dist/, each file written whole (rewrites .ts imports to .js)
node bin/aidlc.js <cmd>        # the CLI (dist/ when it is at least as new as src/, else src/)
npm run dev -- <cmd>           # the CLI from src/cli/main.ts, always current
npm run bench                  # loop benchmark: deterministic counts of each hook event against bench/baseline.json (--check, --ratchet, --time 5)
```

There is no linter; strict `tsc` with `noUnusedLocals` and `noUnusedParameters` is the only static gate.

Note: `bin/aidlc.js` and `bin/aidlc-hook.js` load `dist/` only when the
compiled entry is at least as new as every file under `src/`
(`bin/resolve-entry.js`, links followed); a build older than any source
file, or a source tree that cannot be fully inspected, runs the sources. `AIDLC_ENTRY_DEBUG=1` prints the choice.

## Architecture

Module map, state diagrams and the persisted-state table: `docs/ARCHITECTURE.md`.
Operating guide (running goals, hooks, R2/R3 review, audit): `docs/OPERATIONS.md`.
The parts that take several files to see:

**One directive per call.** `aidlc next` is read-only apart from derived
transitions and returns exactly one typed `Directive` (`src/loop/directive.ts`);
cards follow the same shape through `aidlc card next <id>` /
`aidlc card attempt <id>`.

**Layers, inner to outer** (`src/`): `core/` (pure decision engines, no I/O),
`state/`, `coordination/`, `probes/`, `delivery/`, `review/`, `loop/`, `hooks/`,
`cli/` and `scaffold/`. `docs/ARCHITECTURE.md`, Module map, describes each.
Four facts it leaves out: state lives under `<main checkout>/.aidlc/`, shared
by all worktrees; every `ShipPath` adapter (`scaffold`, `github`, `dry-run`)
prints the same scaffold-style sentinels so `classifyShipOutput` maps outcomes
uniformly; a review verdict is the last stdout line of JSON, written next to
the candidate under `<worktree>/.review/`; and the hooks are wired in
`.claude/settings.json` for PreToolUse, Stop and UserPromptSubmit.

**Card state is selected, not stored.** `selectCardState`
(`src/core/card-machine.ts`) re-derives the state from evidence on every
call in a fixed precedence: unknown operations, terminal or stale
ownership, DONE, WAIT, CLOSE, deadline, exhausted allowances, PREPARE,
REVIEW_FIX, BUILD, SHIP. To change what the loop does next, change the
evidence or the precedence, not a transition table.

**Review before ship.** SHIP requires an R3 formal review pass on the current
candidate, and a fresh R2 pre-review pass before it only when `preReview.command` is set.
This repository leaves it empty, so a candidate goes from the DoD to R3. Both
are external commands configured in `aidlc.config.json` (`preReview`,
`formalReview`; this repo uses Codex gpt-6-astra for R3, with Claude Opus 5.5
as the fallback) and can be run by hand with `aidlc review pre <card>` /
`aidlc review r3 <card>`. Allowances are constants in `core/types.ts` enforced
by `core/review-policy.ts`, and a missing or malformed verdict fails closed;
what a block or a quota hold does: `docs/OPERATIONS.md`, Pre-review (R2).

**Every side effect is injectable.** `GoalController`, `CardRunner` and
`ReleaseRunner` take a deps object (`runner`, `git`, `gh`, `shipPath`, `now`,
stores). Tests use `scriptedRunner` from `src/probes/exec.ts`,
`DryRunShipPath`, a fixed clock and a temp `.aidlc`; nothing in `tests/`
calls `Date.now()`.

## Configuration and environment

- `aidlc.config.json` is parsed by the zod `ProjectConfig` in `src/config.ts`.
  `templates/aidlc.config.json` is the copy `aidlc init` installs; add new
  fields to both.
- `AIDLC_STATE_DIR` overrides the state directory. `AIDLC_SESSION` (else
  `CLAUDE_CODE_SESSION_ID`) identifies the session for leases and the
  journal. The hooks read `AIDLC_FIX_TASK` and `RELEASE_APPROVAL` (else
  `AIDLC_RELEASE_APPROVAL`); aidlc sets `AIDLC_TARGET_ENV` for an ops
  command whose binding has `targetSelection: env`, and `aidlc run` sets
  `AIDLC_RUN_NO_SHIP=1` for its provider.
- `.aidlc/`, `.review/`, `_local/` and the planning scratch files
  (`task_plan.md`, `findings.md`, `progress.md`) are gitignored working state.

## Conventions

- ESM, strict TypeScript with `erasableSyntaxOnly` (no enums, namespaces or
  parameter properties) and `verbatimModuleSyntax` (`import type` for
  types). Relative imports carry an explicit `.ts` extension.
- Every persisted record has a zod schema in `src/core/types.ts`; parse at
  the boundary.
- Provider and reviewer commands are argv arrays, never shell strings.
- Tests are `node:test` + `node:assert/strict` under
  `tests/{core,infra,scenarios,surface}`. Shared fixtures:
  `tests/core/_fixtures.ts`, `tests/infra/helpers.ts`, and `makeFixture` in
  `tests/scenarios/_harness.ts` for end-to-end goal and card runs. Use fixed
  ISO timestamps.
- `templates/claude/**` and `.claude/**` are kept identical apart from the
  hook command in `settings.json`; edit both.
  `.claude/skills/verify-*/` holds this repository's own verify skills,
  which have no copy under `templates/claude/` and which `aidlc init` does
  not install. The five `aidlc-loop` skill files are ASCII-only with byte
  caps asserted by `tests/surface/templates.test.ts`. The section below is
  `templates/CLAUDE.aidlc.md`, which `aidlc init` appends to a downstream
  repo's CLAUDE.md; keep the two identical.
- Record behaviour changes in `CHANGELOG.md` (Unreleased) and, where they
  touch the loop, in `docs/ARCHITECTURE.md` and `docs/OPERATIONS.md`.
- This file stays within 200 lines (`tests/surface/claude-md-size.test.ts`):
  every session loads it, and a longer file costs context and adherence, so
  detail goes in `docs/`.

## AI-native SDLC (aidlc)

This repository runs the AI-native SDLC loop. State lives in `.aidlc/` (main
checkout, gitignored) and is owned by the `aidlc` CLI; never edit it by hand.
Skill: `.claude/skills/aidlc-loop/SKILL.md`. Review policy: `REVIEW.md`.

### Commands
- `aidlc doctor`                       preflight: git, gh, state dir, interrupted writes
- `aidlc goal new "<request>"`         intake + routing (size, kind, target, modules)
- `aidlc next --goal <id>`             one JSON directive: the only next move
- `aidlc report --goal <id> --result <...>`  commit the outcome of that move
- `aidlc board --goal <id>`            regenerate the board view (never the truth)
- `aidlc cards validate`               card registry checks (`check-cards` compatible)
- `aidlc evals run --threshold 0.9`    continuous evals over `evals/*.json`
- `aidlc audit verify --goal <id>`     journal chain, operations, manifest, level
- `aidlc release start --goal <id>`     release attempt for the target set by `aidlc goal new --target`
- `aidlc monitor check --bands bands.yaml --data <file>`  control bands -> intent

### Artifact chain (each stage commits what the next consumes)
intent/<slug>.md -> specs/<slug>.md -> plans/<slug>.md -> specs/tasks/<id>.md
(cards) -> diff/PR -> review verdict -> release evidence -> incident intent.
The plan is the single source of truth; cards are its machine-checkable
projection. Findings from monitoring re-enter as intent.md.

### Verifying your work
- Test: the card's `dod_command` runs the typecheck and the card's own
  tests, all green. The full suite and the build run in CI on every
  candidate; run them locally only when the change can break them in a way
  the card's tests cannot show.
- Lint: zero warnings where a lint gate exists.
Paste the DoD output before reporting a task complete. The card machine
refuses SHIP without a DoD receipt; the Stop hook only reminds.

### Hard limits
- Never weaken, skip or delete tests to go green; if a test fails, fix the
  code, not the test.
- "Done" has exactly one definition: the machine gate passed (DoD, review,
  CI, integrated acceptance). Green cards alone do not deliver a goal.
- No `--no-verify`; no force-push, reset --hard or history rewrite on shared
  branches; never rebase or amend receipt-bound or published history.
- Stop and confirm before hard-to-reverse actions or scope changes;
  production, tag/publish and data operations require recorded authority.
- Maker/checker deadlock: after two rounds of mutual non-acceptance, stop
  for a human ruling; do not fan out reviewers or switch accounts.
- Never echo or commit secrets; never fabricate endpoints, keys or results.

### Docs
When adding, removing or renaming files, commands or flags, grep `docs/` and
`README.md` for stale references and fix them in the same commit.

### Writing density
Applies to everything written in or about this repository: chat output,
PR titles and bodies, commit messages, code comments, docs, cards, skill
files, changelog entries.

No mannered prose: metaphor or flourish in place of a direct statement, such
as "a dial worth turning" for "a parameter worth varying". It makes the
reader work harder and carries connotations the writer did not choose. When
a literal phrase is available, use it. Remove mannered prose wherever you
find it in text you are editing.
