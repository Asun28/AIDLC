# aidlc

AI-native SDLC orchestrator in TypeScript. It implements the Anthropic AI-native SDLC playbook loop, intent -> spec -> plan -> cards -> diff -> review -> release -> incident, with the bounded autonomy of the v5 plan in `docs/plans/PLAN-aidlc-loop.md`: sized routing (T0-bugfix/T0/T1/T2), one coordinator per goal, shared-session leases and review admission, hard admission deadlines, bounded review/CI/effort retries, opt-in release and migration stages, and a hash-chained evidence journal that an independent verifier can check. Every `aidlc next` call returns exactly one typed directive; the agent (Claude Code or any other driver) performs that move and reports the result.

## Status

Version 0.1.0.

- The development-only loop (intake, routing, planning gates, card execution, arc selection, integrated acceptance, closure) is implemented and tested (413 tests: unit suites plus end-to-end scenarios for the T0 flow, T1 arc, review block, CI rerun, deadlines, two windows, staging/production release, audit and amendments).
- Ship paths are adapters: `dry-run` is exercised by tests; `scaffold` drives `scripts/task.ps1` from claude-devops-scaffold and classifies its sentinels; `github` mirrors that chain natively with `git` and `gh` (commit, push, PR, candidate-bound verdict, CI check runs, squash merge). The scaffold and github paths need qualification against a real repository before the loop is advertised as run-verified (plan Q3/Q4/Q23/Q24).
- Release and migration modules are opt-in. Until provider operations are bound in `aidlc.ops.json`, an enabled target stops with `release-config` and prints `NOT CONFIGURED`; a development-only goal never needs them.
- "Fully audited" is never assumed. `aidlc audit verify --claim-full` reports `verified` only with a sealed manifest, an intact journal and an asserted host capture boundary; otherwise it reports `BLOCKED/capability` with the exact prerequisite.

## Requirements

- Node.js >= 22.18 (the CLI runs TypeScript sources directly through type stripping; `npm run build` emits `dist/`).
- git (state lives in the main checkout's `.aidlc/` so all worktrees share it).
- Optional: `gh` (remote ship, PR and CI probes), `pwsh` 7 (scaffold ship path), `claude` CLI or an Anthropic API credential (model providers).

## Quick start

```bash
npm install
npm run build                      # optional; bin/aidlc.js falls back to src/ on Node 22
node bin/aidlc.js init             # lays intent/, specs/, plans/, .claude/, REVIEW.md, bands.yaml, evals/, aidlc.config.json over the repo
node bin/aidlc.js doctor           # toolchain, config, state dir, card registry, provider
node bin/aidlc.js goal new "fix the null pointer when a claim has no adjuster" --bug-evidence
node bin/aidlc.js next             # one directive: plan | project-cards | checkpoint | run-card | verify-arc | release | wait | close | done | stop
```

The loop is `next` -> act -> `report` -> `next`:

```bash
aidlc report --result plan-produced --plan-ref plans/claims-status.md
aidlc report --result cards-projected --cards T1-STATUS-API,T1-STATUS-PANEL
aidlc card next T1-STATUS-API          # prepare | build | ship | review-fix | wait | close | done | stop
aidlc card attempt T1-STATUS-API --outcome success --dod-receipt "npm test exit 0"
aidlc card next T1-STATUS-API          # ships through the configured ship path
aidlc report --result arc-verified --data '{"evidence":"e2e run 1234"}'
aidlc audit verify
```

When stdout is not a TTY every command prints one JSON document; pass `--json` to force it.

## The loop

Goal states (`src/core/goal-machine.ts`):

| State | Meaning | Leaves when |
|---|---|---|
| PLAN | intent accepted, plan pending | plan produced (or T0 card resolved) |
| CARDS | projection validated, authority pending | cards valid and (for T2) the plan+projection checkpoint approved |
| RUN | dispatching ready cards, at most two workers | all required cards closed |
| WAIT | child result, provider hold or dependency pending | evidence permits progress |
| VERIFY_ARC | integrated acceptance on the final SHA | `arc-verified` or one bounded repair cycle |
| DELIVER | opt-in package/staging/production attempt | requested target verified |
| CLOSE | closure predicates (status, doc sync, findings, evidence, cleanup) | all verified |
| DONE / STOP | terminal; late wakeups do no new work | never (a resume links a new generation) |

Card states (`src/core/card-machine.ts`) are selected from evidence in a fixed precedence: reconcile unknown operations first, then STOP conditions, DONE, WAIT, CLOSE, admission deadline, exhausted allowances, PREPARE, REVIEW_FIX, BUILD, SHIP.

`aidlc next` is read-only apart from derived transitions (deadline STOP, CARDS -> RUN once authorized, RUN -> VERIFY_ARC once all cards closed, CLOSE -> DONE once closure holds). `aidlc report --result <r>` commits externally observed results: `intent-accepted`, `plan-produced`, `plan-failed`, `cards-projected`, `approved`, `rejected`, `card-result`, `arc-verified`, `arc-failed`, `release-result`, `revision`, `cancel`, `resume`.

## Multi-session

Several windows may work on one repository. State is shared through `<main checkout>/.aidlc/`. Each window must identify itself: under Claude Code every subprocess carries `CLAUDE_CODE_SESSION_ID` and every hook event its `session_id`, so each Claude Code session is one loop session (a `/clear` starts a new one); elsewhere set `AIDLC_SESSION` per window; without either, every process shares one default token stored in `.aidlc/session-default`, which is the plan's interim single-controller mode and `aidlc doctor` warns about it. Lease records are never rewritten for an identity change: a lease claimed under the default token by an earlier version, or by a session that has ended, stays as recorded and expires after its 10-minute TTL. `aidlc goal takeover <id>` then takes the goal lease once the old owner's operations are reconciled; it does not take card leases. A card lease is continued by running with `AIDLC_SESSION` set to the owner session id that `aidlc card status <card>` and the PREPARE ownership stop show; no card takeover command exists yet.

- Leases (`src/coordination/lease.ts`): atomic file claims per goal, card, integration base, environment and review pool, with owner session/pid/start, expiry, heartbeat and a monotonically advancing generation. A mutation is fenced against its generation; a stale writer cannot commit.
- Takeover (`aidlc goal takeover`) is allowed only after the previous owner's operations are reconciled; lease expiry alone does not prove the owner stopped.
- Review admission (`src/coordination/review-queue.ts`): one shared queue per provider pool, deduplicated by repository + candidate digest + base + policy version + reviewer; a matching running request is joined, admission follows persisted order, a lost response keeps its slot until looked up.
- Quota holds are WAIT, not defects: a confirmed rate limit records the provider's retry-after on the pool, one notification owner is registered, and other windows do not retry the same signal.

## Limits

| Limit | Value | Where |
|---|---|---|
| Card admission | 3 h from first PREPARE (or the goal deadline, whichever is earlier) | `src/core/deadlines.ts` |
| Arc admission | 12 h for multi-card goals; 3 h for one-card and standalone release goals | `src/core/deadlines.ts` |
| Reconciliation grace | 5 min after a deadline; unresolved outcomes stay UNKNOWN | `src/core/deadlines.ts`, `src/core/card-machine.ts` |
| Substantive review decisions | 2 (initial + one for a repaired candidate); second block stops | `src/core/review-policy.ts` |
| No-verdict retry | 1 total across script and driver | `src/core/review-policy.ts` |
| Transient CI rerun | 1 per run/attempt/candidate, persisted before the request | `src/core/ci-policy.ts` |
| Implementation attempts | 3 at baseline effort, plus 1 escalated attempt only with evidenced progress and an available level; same cause twice stops early | `src/core/effort.ts` |
| Planning invocations | 2 (initial + one corrective) | `src/loop/controller.ts` |
| Integration / lifecycle repair cycles | 1 each | `src/core/arc.ts`, `src/loop/controller.ts` |
| Card workers | 2, only with disjoint paths and resources; 1 with a single reviewer slot | `src/core/arc.ts` |

## Layout

```
src/
  core/          types (zod schemas), router, deadlines, effort, review/ci policies, health, authorization, arc, goal/card/release machines, migrate, amendments, roles
  state/         canonical paths, atomic JSON store, hash-chained journal, goal store, board view
  coordination/  leases + fencing, shared review queue, operation ledger + reconciliation
  probes/        exec receipts, git and gh probes
  delivery/      worktree start-or-attach, ship path adapters, provider operation bindings
  artifacts/     front matter, cards, intent.md, spec.md, plan.md (+ definition-of-ready gates)
  providers/     model provider interface, mock, Claude API (SDK), Claude Code CLI
  maintain/      control bands (Western Electric), incident ledger -> intent
  evals/         deterministic eval runner
  audit/         evidence manifest + seal, independent verifier
  hooks/         Claude Code hook handlers
  loop/          typed directives, goal controller, card runner, release runner
  scaffold/      `aidlc init`
  cli/           commander entry
templates/       files copied by `aidlc init` (.claude skills: aidlc-loop plus the tdd, diagnose, grilling and merge-conflicts companions; agents; settings; REVIEW.md; bands.yaml; artifact templates; docs incl. LESSONS and third-party notices; workflows)
tests/           node:test suites (core, infra, surface)
docs/            architecture, traceability, operations, plans
```

## Documentation

- `docs/ARCHITECTURE.md` - modules, state machines, directive contract, persisted state, audit chain, ship adapters.
- `docs/REQUIREMENTS-TRACEABILITY.md` - v5 plan requirements (R, MS, MA, LC, Q) mapped to code and tests.
- `docs/OPERATIONS.md` - running goals end to end, provider bindings, hooks, evals, audit, STOP reasons.
- `docs/plans/PLAN-aidlc-loop.md` - the canonical v5 plan this implementation follows.
- `docs/PROJECT-STATE.md` - what is verified, what is pending, next steps.

## Development

```bash
npm run check        # typecheck (src + tests) and run the suite
node --test "tests/**/*.test.ts"
npm run build        # tsc -> dist/
```

Conventions: ESM, strict TypeScript with `erasableSyntaxOnly` (no enums, namespaces or parameter properties), relative imports with explicit `.ts` extensions (rewritten to `.js` on build), every persisted record has a zod schema, no shell strings for provider commands (argv arrays only), fixed ISO timestamps in tests.

## License

MIT
