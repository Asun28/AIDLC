# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`aidlc` is a TypeScript library plus CLI that runs the AI-native SDLC loop
(intent -> spec -> plan -> cards -> diff -> review -> release -> incident)
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
npm run build                  # tsc -> dist/ (rewrites .ts imports to .js)
node bin/aidlc.js <cmd>        # the CLI (dist/ when it is at least as new as src/, else src/)
npm run dev -- <cmd>           # the CLI from src/cli/main.ts, always current
```

There is no linter; strict `tsc` is the only static gate.

Note: `bin/aidlc.js` and `bin/aidlc-hook.js` load `dist/` only when the
compiled entry is at least as new as every file under `src/`
(`bin/resolve-entry.js`, links followed); a build older than any source
file, or a source tree that cannot be fully inspected, runs the sources. `AIDLC_ENTRY_DEBUG=1` prints the choice.
`npm run dev -- <cmd>` always runs the sources.

## Architecture

Module map, state diagrams and the persisted-state table: `docs/ARCHITECTURE.md`.
Operating guide (running goals, hooks, R2/R3 review, audit): `docs/OPERATIONS.md`.
The parts that take several files to see:

**One directive per call.** `aidlc next` is read-only apart from derived
transitions and returns exactly one typed `Directive` (`src/loop/directive.ts`);
the agent performs that move and commits the outcome with
`aidlc report --result <ReportResult>`. Cards follow the same shape through
`aidlc card next <id>` / `aidlc card attempt <id>`. Nothing else is ever the
next step.

**Layers, inner to outer** (`src/`):
- `core/`: pure decision engines over persisted facts, no I/O. `types.ts`
  holds the zod schema of every persisted record and every limit constant;
  the rest are the router, deadlines, effort, review and CI policies, and
  the goal, card and release state machines.
- `state/`: persistence under `<main checkout>/.aidlc/` (shared by all
  worktrees, gitignored): atomic JSON store, hash-chained append-only
  journal, goal store. `board.ts` renders a Markdown view, never a source
  of truth.
- `coordination/`: multi-session primitives. Leases with generations and
  fencing, the shared review admission queue, the operation ledger with
  explicit UNKNOWN.
- `probes/`: evidence with receipts (`exec.ts` runner, git, gh).
- `delivery/`: worktree start-or-attach and the `ShipPath` adapters
  (`scaffold`, `github`, `dry-run`). Every adapter prints the same
  scaffold-style sentinels so `classifyShipOutput` maps outcomes uniformly.
- `review/pre-review.ts`: builds reviewer prompts, runs the configured
  review commands with receipts, extracts the verdict (last stdout line of
  JSON) and writes it next to the candidate under `<worktree>/.review/`.
- `loop/`: the drivers. `controller.ts` drives the goal machine
  (`next`/`report`), `card-runner.ts` the card machine, `release-runner.ts`
  the release machine.
- `hooks/`: the Claude Code guards, run as one process per event by
  `bin/aidlc-hook.js` (wired in `.claude/settings.json` for PreToolUse, Stop
  and UserPromptSubmit).
- `cli/main.ts`: commander wiring. `scaffold/init.ts`: copies `templates/`
  into a target repository.

**Card state is selected, not stored.** `selectCardState`
(`src/core/card-machine.ts`) re-derives the state from evidence on every
call in a fixed precedence: unknown operations, terminal or stale
ownership, DONE, WAIT, CLOSE, deadline, exhausted allowances, PREPARE,
REVIEW_FIX, BUILD, SHIP. To change what the loop does next, change the
evidence or the precedence, not a transition table.

**Review before ship.** SHIP requires a fresh R2 pre-review pass and then an
R3 formal review pass on the current candidate. Both are external commands
configured in `aidlc.config.json` (`preReview`, `formalReview`; this repo
uses DeepSeek for R2 and Claude Opus 5.5 for R3 while Codex is unavailable)
and can be run by hand with
`aidlc review pre <card>` / `aidlc review r3 <card>`. Allowances are
constants in `core/types.ts` enforced by `core/review-policy.ts`: a block
returns the card to REVIEW_FIX and reopens the effort episode without
spending a build attempt (the ladder counts DoD failures only), a second
substantive block stops the card, a quota hold is WAIT, a missing or
malformed verdict fails closed.

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
  `CLAUDE_SESSION_ID`) identifies the session for leases and the journal.
  `AIDLC_FIX_TASK`, `AIDLC_RELEASE_APPROVAL` and `AIDLC_TARGET_ENV` are read
  by the hooks and ops bindings.
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
  hook command in `settings.json`; edit both. The five `aidlc-loop` skill
  files are ASCII-only with byte caps asserted by
  `tests/surface/templates.test.ts`. The section below is
  `templates/CLAUDE.aidlc.md`, which `aidlc init` appends to a downstream
  repo's CLAUDE.md; keep the two identical.
- Record behaviour changes in `CHANGELOG.md` (Unreleased) and, where they
  touch the loop, in `docs/ARCHITECTURE.md` and `docs/OPERATIONS.md`.

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
- `aidlc release start --goal <id> --target staging|production|package`
- `aidlc monitor check --bands bands.yaml --data <file>`  control bands -> intent

### Artifact chain (each stage commits what the next consumes)
intent/<slug>.md -> specs/<slug>.md -> plans/<slug>.md -> specs/tasks/<id>.md
(cards) -> diff/PR -> review verdict -> release evidence -> incident intent.
The plan is the single source of truth; cards are its machine-checkable
projection. Findings from monitoring re-enter as intent.md.

### Verifying your work
- Build: the project's build command must finish clean.
- Test: the card's `dod_command` and the affected checks, all green; never
  skip or delete a failing test.
- Lint: zero warnings where a lint gate exists.
Run all applicable checks before reporting any task complete, and paste the
output. If a test fails, fix the code, not the test. A hook blocks "done"
while an active card lacks a fresh DoD receipt.

### Hard limits (no exceptions)
- Never weaken, skip or delete tests to go green; that is a failure, not a fix.
- "Done" has exactly one definition: the machine gate passed (DoD, review,
  CI, integrated acceptance). Green cards alone do not deliver a goal.
- No `--no-verify`; no force-push, reset --hard or history rewrite on shared
  branches; never rebase or amend receipt-bound or published history.
- Stop and confirm before hard-to-reverse actions or scope changes;
  production, tag/publish and data operations require recorded authority.
- Maker/checker deadlock: after two rounds of mutual non-acceptance, stop
  for a human ruling; do not fan out reviewers or switch accounts.
- Never echo or commit secrets; never fabricate endpoints, keys or results.
- Deadlines (3h/card, 12h/arc) and attempt limits persist across session changes.

### Lessons, docs and companion skills
- PREPARE reads `docs/LESSONS.md` once per card; CLOSE appends at most one
  dated line to it, only when a review block or an incident taught a rule
  the playbook did not state. Past lines are never rewritten.
- When adding, removing or renaming files, commands or flags, grep `docs/`
  and `README.md` for stale references and fix them in the same commit.
- Companion skills are advisory and called by name: `tdd` (before any
  test), `diagnose` (T0-bugfix, the card `diagnosis:` field), `grilling`
  (T1/T2 intake questions), `merge-conflicts` (base moved). The loop's
  gates decide; a skill never overrides `aidlc next`.

### Writing density (all text, at all times)
Applies to everything written in or about this repository: chat output,
PR titles and bodies, commit messages, code comments, docs, cards, skill
files, changelog entries.

No mannered prose. Mannered prose substitutes metaphor and flourish for a
direct statement: "a dial worth turning" for "a parameter worth varying",
"this point earns its keep" for "this point still matters". The phrases
exist to display the writer, not to convey the idea, and readers can tell;
they make the reader work harder so the writer can perform. They are also
imprecise: a metaphor drags in connotations the writer did not choose and
cannot control. Say what you mean. When a literal phrase is available, use
it. Remove mannered prose wherever you find it in text you are editing.
