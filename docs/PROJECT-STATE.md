# AIDLC project state

Updated: 2026-09-11. Working directory: `D:\Projects\AIDLC`.

## Current deliverable

The v5 plan (`docs/plans/PLAN-aidlc-loop.md`) is now implemented as a TypeScript library and CLI in `src/`, with Claude Code assets in `templates/` that `aidlc init` copies into a target repository. The plan documents, the capability comparison and the session review remain the requirement authority; this implementation is their runtime.

## Verified

- `npx tsc -p tsconfig.json --noEmit` and `npx tsc -p tsconfig.test.json --noEmit`: 0 errors.
- `node --test "tests/**/*.test.ts"`: 413 tests, 39 suites, 0 failures.
- Eight defects found by the test suites were fixed before this state was recorded (fail-open unattended-mutation guard, inline card lists, case-insensitive write verbs in the frozen-path hook, `.env.example` allowed, template placeholders rejected in specs, empty journal reported as level `none`, ORM detection regex, router over-matching "build a new <feature>" as T2).
- Skill file sizes are under the plan's caps and asserted by `tests/surface/templates.test.ts`: SKILL.md 4170, card-loop.md 6134, arc.md 4109, release.md 4488, migrate.md 2267 bytes.

## Pending

1. (done) Scenario tests under `tests/scenarios/` cover the T0 flow, T1 arc, review block then second block, CI rerun, deadline expiry, two sessions on one card, staging/production release with recovery, audit and amendments; they surfaced and fixed four loop defects (re-ship after a completed review request, no exit from REVIEW_FIX, release steps not synced from reconciled operations, production checkpoint bound to the staging environment).
2. Live qualification on a real repository with the scaffold ship path: Q3 (T1 arc), Q4 (T2 checkpoint with plan-forge), Q23 and Q24 (two windows, shared review pool), Q1 (T0 with real RED receipt).
3. Provider onboarding: tests and a live run for the native `github` ship path (`src/delivery/github-ship.ts`), real `gh` review admission signals, and at least one bound `aidlc.ops.json` in a downstream project for Q16-Q22.
4. Tests for the CLI itself (`src/cli/main.ts`); `src/scaffold/init.ts` and the skill-file byte caps are covered by `tests/infra/init.test.ts` and `tests/surface/templates.test.ts`.

Resolved since the first draft: the templates and CLI are aligned (`aidlc op` is an alias of `aidlc ops`, `aidlc goal reconcile <id>` exists, and `next`/`report`/`board` accept `--goal <id>` as well as the positional id).

## Accepted decisions (carried from v5)

- Accept dynamic requirements, old-card amendments, new systems and bugs; proportionate routing; automatic execution to integrated acceptance.
- Development, tests, review and integration are the default; deployment, migration and operations are opt-in per target and never activated by the presence of tools or files.
- Multiple sessions are a normal target: shared leases, generations, fencing and review admission live in `.aidlc/` under the main checkout; a single controller is an interim mode only.
- Task-based effort with at most three baseline attempts and one justified escalation; same cause twice stops early; quota and infrastructure failures do not escalate.
- Development DONE is not board emptiness; full audit claims require the verifier and a host capture boundary.
- No new external orchestrator; this package is the orchestrator and adapts to project tools (scaffold `task.ps1`, `gh`, bound provider operations).

## Next steps, in order

1. (done) Scenario tests written; four defects fixed.
2. Run `node bin/aidlc.js init --dry-run` against `D:\Projects\MyInspection` and compare the merged settings and card template with the scaffold's, then run a T0 goal there with `shipPath: "scaffold"` from the main checkout.
3. Qualify the `github` ship path against a scratch repository (PR, verdict file, check runs, squash merge); the adapter has scripted-runner tests only.
4. Bind `aidlc.ops.json` in one downstream project and run a staging-only release attempt.

The source repository for scaffold conventions remains `D:\Projects\claude-devops-scaffold`; the downstream reference is `D:\Projects\MyInspection`. No Git repository, remote or deployment was created for AIDLC itself.
