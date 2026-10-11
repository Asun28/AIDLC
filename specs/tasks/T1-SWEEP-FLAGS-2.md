---
id: T1-SWEEP-FLAGS-2
title: (successor) The eval workflow runs on the claude-code provider when ANTHROPIC_API_KEY is set and says it skipped otherwise, shipped command lines name only declared options, and the env var docs match the code
status: merged
branch: T1-SWEEP-FLAGS-2
worktree: D:\wt\AIDLC\T1-SWEEP-FLAGS-2
plan_ref: plans/dead-code-sweep.md#order-of-work
allow_paths:
  - .github/workflows/agent-evals.yml
  - templates/github/workflows/agent-evals.yml
  - CLAUDE.md
  - templates/CLAUDE.aidlc.md
  - .claude/agents/release-specialist.md
  - templates/claude/agents/release-specialist.md
  - .claude/skills/aidlc-loop/release.md
  - templates/claude/skills/aidlc-loop/release.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - docs/OPERATIONS.md
  - tests/surface/command-lines.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP-FLAGS-2.md
dod_command: npm run typecheck && node --test tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/infra/init.test.ts
dod_exit: 0
requirements:
  - R1. The `evals` job of `.github/workflows/agent-evals.yml` and of `templates/github/workflows/agent-evals.yml` (kept identical) shall set the job variable `HAS_ANTHROPIC_KEY: ${{ secrets.ANTHROPIC_API_KEY != '' }}`; WHEN it is `'true'`, the `Install Claude Code` and `Run eval suite` steps run, the second as `npx aidlc evals run --provider claude-code --threshold 0.9 --json > evals-result.json` with `ANTHROPIC_API_KEY` from the secret; otherwise both are skipped and an `Evals skipped` step prints `::warning title=Evals skipped::ANTHROPIC_API_KEY is not set, so the eval suite did not run`, so the job succeeds and says why. No step sets `AIDLC_PROVIDER`, which nothing reads.
  - R2. The `aidlc release start` command lines of `CLAUDE.md`, `templates/CLAUDE.aidlc.md`, the release module and the release-specialist agent shall name `--goal <id>` and no `--target` (the command declares only `--goal`; the target is the goal's, set by `aidlc goal new --target`), and line 4 of the card-loop module shall say to call `aidlc card next <id>` again after the move instead of `aidlc card report <id> --result <...>` (`card report` requires `--data`). The `.claude/` and `templates/claude/` copies stay identical, ASCII and under their byte caps.
  - R3. The environment paragraph of `CLAUDE.md` shall say that `AIDLC_SESSION`, else `CLAUDE_CODE_SESSION_ID` (else the older `CLAUDE_SESSION_ID`), identifies the session; that the hooks read `AIDLC_FIX_TASK` and `AIDLC_RELEASE_APPROVAL`; and that aidlc sets `AIDLC_TARGET_ENV` for an ops command whose binding has `targetSelection: env`. The `aidlc run` paragraph of `docs/OPERATIONS.md` shall state that the driver runs the provider with `AIDLC_RUN_NO_SHIP=1`, under which the CLI does not ship: `aidlc card next` returns a `wait` on `driver-ship-boundary` where it would ship, and `aidlc card ship` fails.
  - R4. The CHANGELOG Unreleased section shall carry an entry naming this card and its predecessor T1-SWEEP-FLAGS.
acceptance:
  - 1. `tests/surface/command-lines.test.ts`: the two workflow files are byte-identical; the `evals` job sets the R1 `HAS_ANTHROPIC_KEY` line; the `Install Claude Code` and `Run eval suite` steps carry `if: env.HAS_ANTHROPIC_KEY == 'true'`, the `Evals skipped` step `if: env.HAS_ANTHROPIC_KEY != 'true'` and the exact R1 warning line; the eval step's `run:` line is the R1 command; neither file contains `AIDLC_PROVIDER`. On PR CI of this repository, which has no `ANTHROPIC_API_KEY` secret, the `evals` check concludes success with the warning. [R1] [dod arm 2]
  - 2. The same file: none of `CLAUDE.md`, `templates/CLAUDE.aidlc.md`, the two release-specialist agents, the two release modules and the two card-loop modules has a backtick span starting `aidlc release start` that contains `--target`, or one starting `aidlc card report` that contains `--result`; each of those files that names `aidlc release start` names `aidlc release start --goal <id>`; both card-loop modules name `aidlc card next <id>` again after the move. [R2] [dod arm 2]
  - 3. `tests/surface/templates.test.ts` (the caps, ASCII and identical-copy checks) and `tests/infra/init.test.ts` pass unchanged. [R2] [dod arms 3, 4]
  - 4. `tests/surface/command-lines.test.ts`: `CLAUDE.md` names `CLAUDE_CODE_SESSION_ID` and `targetSelection: env`, and no longer says `AIDLC_TARGET_ENV` is read by the hooks; `docs/OPERATIONS.md` names `AIDLC_RUN_NO_SHIP=1`; the CHANGELOG Unreleased section carries a T1-SWEEP-FLAGS-2 entry naming T1-SWEEP-FLAGS. [R3] [R4] [dod arm 2]
depends_on: []
budget: 180
tdd: true
sweep: "grep -rn 'release start\\|card report' over .claude templates CLAUDE.md README.md docs (docs/plans and card files excluded): CLAUDE.md:153, templates/CLAUDE.aidlc.md:17, release-specialist.md:12 (both copies), aidlc-loop/release.md:3 (both), aidlc-loop/card-loop.md:4 (both); README.md and OPERATIONS.md name neither. grep -rn AIDLC_PROVIDER src bin .github templates: only the two workflow lines. grep -n 'CLAUDE_SESSION_ID\\|AIDLC_TARGET_ENV\\|AIDLC_RUN_NO_SHIP' CLAUDE.md docs/OPERATIONS.md README.md docs/ARCHITECTURE.md: CLAUDE.md:110-111 are the stale lines; OPERATIONS, README and ARCHITECTURE already name CLAUDE_CODE_SESSION_ID; AIDLC_RUN_NO_SHIP is read at src/cli/main.ts:455,602 and set at 148, documented nowhere."
forbid: [raising a skill byte cap, adding a CLI option, changing the eval threshold]
non_goals: ["a generic checker of every aidlc command line in the docs", "the `aidlc security check` stub message", "documenting ANTHROPIC_PROFILE"]
hygiene: "Successor of T1-SWEEP-FLAGS, which stopped for ci on 2026-10-12: its candidate 29bf81d (R2 round 1 pass, R3 decision 1 pass) shipped as PR #153, where the Agent evals job, now on the claude-code provider, exited 1 because the repository has no ANTHROPIC_API_KEY secret (the job had passed on main only because it ran on mock); every reported check must succeed for the ship (src/delivery/github-ship.ts). User ruling 2026-10-12: run the evals when the key is set, otherwise skip with a visible warning. Carries the T1-SWEEP-FLAGS commits and every attempt, review and stop record; PR #153 is closed unmerged once this card's PR exists. One fresh review cycle; no counter resets."
doc_sync: CLAUDE.md, docs/OPERATIONS.md, CHANGELOG.md
---

# T1-SWEEP-FLAGS-2

## Deliverable
The eval CI job calls a model when the repository has an ANTHROPIC_API_KEY secret and says it skipped when it has none, the release and card-loop command lines in the shipped skills and CLAUDE.md run as written, and the env var docs name the variables the code reads and sets.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/infra/init.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
