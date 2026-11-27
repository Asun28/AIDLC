# aidlc

aidlc is a command-line tool and TypeScript library for coordinating AI coding agents in a Git repository. Give it a goal, such as fixing a bug. It tells Claude Code or another agent how to break the work into task cards and what to do next. It sets time and retry limits, tracks test results and reviews, checks the configured gates before shipping, and records the evidence for each card.

## How it works

- **Sizing.** A goal is one request, sized T0-bugfix or T0 (one card), T1 (about 2 to 5 cards) or T2 (a new system, planned and approved first). A card is one task: the files it may change, a Definition of Done (DoD) command and an acceptance list.
- **One step at a time.** `aidlc next` returns one directive, the next step as JSON; the agent does it and records the outcome with `aidlc report`.
- **Gates.** A card ships only after a passing run of its DoD command is recorded and, when the project requires it, R3: a review of the exact commit by a separate reviewer.
- **Limits.** By default a card gets 3 hours and a multi-card goal 12; attempts, reviews and CI reruns are capped. A goal that hits a limit stops and names the reason and the next action.
- **Shared sessions.** Leases record which session owns each goal and card. After another session takes over a card, the previous owner cannot start shipping it ([Sessions](docs/OPERATIONS.md#sessions)).
- **Evidence.** A hash-chained journal records each state change and operation; `aidlc audit verify` checks it.
- **Opt-in delivery.** Package, staging, production and migration run only for goals that target them, with commands bound in `aidlc.ops.json`.

## Status

Version 0.2.0.

- The development loop, from request to merged cards, is implemented and tested. This repository ships its own pull requests with it, through the `github` ship path.
- Ship paths: `github` runs the chain with `git` and `gh` (commit, candidate-bound verdict, base sync, push, PR, CI check runs, squash merge); `scaffold` drives `scripts/task.ps1` from claude-devops-scaffold; `dry-run`, the default after `aidlc init`, records a simulated merge without pushing or merging.
- Development is the default target. Package, staging, production and migration targets need their commands bound in `aidlc.ops.json`; until then a goal for one of them stops with `release-config`.
- `aidlc audit verify --claim-full` reports `verified` only with a sealed manifest, an intact journal, an asserted host capture boundary and, for every shipped card, at least one fact of its merge re-derived from git or GitHub; otherwise it reports `BLOCKED/capability` with the exact prerequisite.

## Requirements

- Node.js 22.18 or newer. The CLI runs the TypeScript sources directly, so no build step is needed.
- git 2.45 or newer (`aidlc doctor` marks an older git `UNSUPPORTED`).
- Optional: `gh` for the `github` ship path and its CI checks, PowerShell 7 (`pwsh`) for the `scaffold` ship path, and the `claude` CLI or an Anthropic API key for a model provider.

## Install

aidlc runs from its own checkout against a separate target repository.

```bash
git clone <aidlc repository URL> aidlc
cd aidlc
npm install
npm link        # puts aidlc on PATH; without it, run node <aidlc checkout>/bin/aidlc.js
cd <your repository>
aidlc init      # configuration, Claude Code skills, agents and hooks, review policy, templates
aidlc doctor    # checks git, gh, the state directory, the configuration and the cards
```

`aidlc init` sets the provider to `mock` and the ship path to `dry-run`. For real runs, choose the ship path (`shipPath`), the provider (`provider`) and the R3 reviewer (`formalReview.command`) in `aidlc.config.json`; [Setup](docs/OPERATIONS.md#setup) lists every key.

## First goal

A dry run of one bug fix on a fresh `aidlc init` repository with the default configuration. Each comment names the directive the call returned. Commands print JSON when the output is piped or `--json` is set; `aidlc board` prints text. A receipt is the observed result of a check: the RED receipt names the commit and the test that failed before the fix, and the DoD receipt names the command, its exit code and the pass count.

```bash
aidlc goal new "fix the crash when a claim has no adjuster" --bug-evidence
aidlc next                              # plan: T0-bugfix, write one card
# the agent writes specs/tasks/T0-CLAIM-NO-ADJUSTER.md from specs/tasks/_TEMPLATE.md
aidlc cards validate --card T0-CLAIM-NO-ADJUSTER
git add specs/tasks && git commit -m "card: T0-CLAIM-NO-ADJUSTER" && git push
aidlc report --result cards-projected --cards T0-CLAIM-NO-ADJUSTER
aidlc next                              # run-card
aidlc card next T0-CLAIM-NO-ADJUSTER    # prepare: names the git worktree command to run
aidlc card next T0-CLAIM-NO-ADJUSTER    # build: commit a failing test, then the fix
aidlc card attempt T0-CLAIM-NO-ADJUSTER --outcome success --red-receipt "880f684:a claim with no adjuster has no adjuster name" --dod-receipt "node --test tests/claims.test.mjs: exit 0, 2 pass, 0 fail"
aidlc card next T0-CLAIM-NO-ADJUSTER    # close: the dry-run ship recorded a simulated merge
aidlc card close T0-CLAIM-NO-ADJUSTER --all
aidlc card close T0-CLAIM-NO-ADJUSTER --skip-lesson "first run"
aidlc next                              # verify-arc
aidlc report --result arc-verified --data '{"evidence":"node --test tests/claims.test.mjs: exit 0, 2 pass, 0 fail"}'
aidlc next                              # done
```

`aidlc card next` is also the operator's shipping command. On the `github` ship path it pushes the branch, opens the pull request, waits for the required CI checks and squash-merges. Before that it returns `pre-review` when a pre-review (R2) command is configured, which `aidlc review pre <card>` runs, and then `review` when an R3 reviewer is configured, which `aidlc review r3 <card>` runs.

`aidlc run --goal <id> --max-steps 40` lets the `claude-code` provider do the steps. It needs `provider` set to `claude-code`, stops before shipping, and also stops at a question, a checkpoint, a release step, a review block or quota hold, the end of the goal or its step limit ([Running a goal](docs/OPERATIONS.md#running-a-goal)). `aidlc board --watch` shows a goal and its cards ([Watching a goal](docs/OPERATIONS.md#watching-a-goal)).

## What aidlc init writes

`aidlc init` adds the configuration (`aidlc.config.json`), Claude Code skills, agents and hook settings, the review policy (`REVIEW.md`), CI workflows and planning templates; [Setup](docs/OPERATIONS.md#setup) lists every path. It skips a file that exists unless `--force` is set, and merges `.claude/settings.json`, `.gitignore` and its `CLAUDE.md` section into files that exist.

The hook settings run these guards on Claude Code tool calls; [Hooks](docs/OPERATIONS.md#hooks) gives the exact conditions.

| Guard | Runs on | Blocks |
|---|---|---|
| `production-gate` | `PreToolUse`: Bash, PowerShell | a command that writes and matches a production pattern, unless the approval reference in `RELEASE_APPROVAL` names a current production authorization |
| `protect-paths` | `PreToolUse`: Bash, PowerShell, Edit, Write, MultiEdit | an edit of a frozen path (`hooks.frozenPaths`), or a command that writes one |
| `protect-tests` | `PreToolUse`: Edit, Write, MultiEdit | an edit of a test file while a fix task is active |
| `secrets-guard` | `PreToolUse`: Bash, PowerShell, Edit, Write, MultiEdit | a write to a secret file such as `.env` or a `.pem` key, or text that holds a credential |
| `stdin-script` | `PreToolUse`: Bash, PowerShell | a command that starts an interpreter on a script read from standard input |
| `protect-git` | `PreToolUse`: Bash, PowerShell | a git command that force-pushes, runs `reset --hard` or `clean -f`, discards changes with `checkout`, or skips the git hooks |
| `verify-before-done` | `Stop` | nothing; it reminds the agent of a missing DoD receipt or of uncommitted planning files |
| `route-new-work` | `UserPromptSubmit` | nothing; it prints the routing line for a new request |

## Limits

Values are defaults. A shorter admission limit, set with `aidlc goal new --limit-hours` or `userLimitMs` in `aidlc.config.json`, wins.

| Limit | Value | Where |
|---|---|---|
| Card admission | 3 h from first PREPARE, or the goal deadline when that is earlier | `src/core/deadlines.ts` |
| Arc admission | 12 h for an explicit T1 or T2 goal, a standalone release included, and for an unknown or multiple card count; 3 h for one card and for any other standalone release | `src/core/deadlines.ts`, `src/loop/controller.ts` |
| Reconciliation grace | 5 min after a deadline; unresolved outcomes stay UNKNOWN | `src/core/deadlines.ts`, `src/core/card-machine.ts` |
| Substantive review decisions | 2 (initial + one for a repaired candidate); with a command reviewer up to 4 for repairs; from decision 2 a block re-raising a finding the author disputed, or a block on decision 4, stops (a ship-path reviewer: second block stops); a continuation the owner records with `aidlc card continue` admits the further decisions it names | `src/core/review-policy.ts` |
| No-verdict retry | 1 total across script and driver | `src/core/review-policy.ts` |
| Transient CI rerun | 1 per run/attempt/candidate, persisted before the request | `src/core/ci-policy.ts` |
| Implementation attempts | 3 at baseline effort, plus 1 escalated attempt only with evidenced progress and an available level; the same cause twice in a row without progress stops early | `src/core/effort.ts` |
| Planning invocations | 2 (initial + one corrective) | `src/loop/controller.ts` |
| Integration repair cycles | 1 | `src/core/arc.ts`, `src/loop/controller.ts` |
| Lifecycle repair cycles | 1, specified by the plan; not enforced in code | `docs/plans/PLAN-aidlc-loop.md` |
| Card workers | 2, only with disjoint paths and resources | `src/core/arc.ts` |

`aidlc bounds [--goal <id>]` counts how often each of the first nine limits fired, with the current outcome of each goal that hit one, and reports the owner acts recorded by month and the card runs left in STOP. [Bound statistics](docs/OPERATIONS.md#bound-statistics) explains each count.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, state machines, the directive contract, persisted state, the audit chain and ship paths.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): setup, running goals, sessions, hooks, review, audit and STOP reasons.
- [docs/DELIVERY-OPS.md](docs/DELIVERY-OPS.md): binding release, migration and recovery to your own tools.
- [REVIEW.md](REVIEW.md): the review policy R3 applies.
- [docs/REQUIREMENTS-TRACEABILITY.md](docs/REQUIREMENTS-TRACEABILITY.md): plan requirements mapped to code and tests.
- [docs/plans/PLAN-aidlc-loop.md](docs/plans/PLAN-aidlc-loop.md): the plan this implementation follows.
- [docs/LESSONS.md](docs/LESSONS.md): rules learned from past cards.
- [CHANGELOG.md](CHANGELOG.md) and `changelog.d/`: changes by release.

## Development

```bash
npm run check        # typecheck (src + tests) and run the suite
node --test "tests/**/*.test.ts"
npm run build        # scripts/build.ts: tsc -> dist/, each file written whole
```

Conventions: [CLAUDE.md](CLAUDE.md), section Conventions. Source layout: [Module map](docs/ARCHITECTURE.md#module-map).

## License

MIT
