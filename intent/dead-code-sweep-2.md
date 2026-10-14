---
slug: dead-code-sweep-2
title: Fix the fix-task clear defect and remove the dead code and obsolete flags the 2026-10-14 unused-code audit found
author: asun28 (engineer)
status: accepted
created: 2026-10-14T09:00:00Z
source: human
---

# Intent: Fix the fix-task clear defect and remove the dead code and obsolete flags the 2026-10-14 unused-code audit found
Author: asun28 (engineer). Status: accepted.

## Problem
An audit of main at 7bdaee2 (`tsc` with `noUnusedLocals` and
`noUnusedParameters`, a TypeScript language-service reference scan of
every export in `src/` and of the test helpers, the import graph,
`npm ls`, and a review of env vars, config fields, CLI options and
compatibility code) found no unused import, local, parameter, package or
source file, and found:

1. A defect: `aidlc card fix-task --clear` (`src/cli/main.ts:591`) writes
   an empty `fix-task` marker, and `fixTaskMarker`
   (`src/hooks/index.ts:481`) reads an existing empty marker as active, so
   the protect-tests hook keeps test files locked after a clear. The
   uncalled `CardRunner.setFixTaskMarker` (`src/loop/card-runner.ts:2685`)
   clears the same way, and `docs/ARCHITECTURE.md` names it as a writer.
2. A gap: `GoalController.extendDeadline` (`src/loop/controller.ts:699`)
   copies the rule of the core `extendDeadline`
   (`src/core/deadlines.ts:74`) without its blank-reason check, so
   `aidlc goal extend --reason " "` records an extension with no reason.
3. Test-only copies of rules production enforces another way: the card
   transition table (`CARD_TRANSITIONS`, `isCardTransitionAllowed`,
   `applyCardDecision`), `tagActionRequiresAuthority` (production checks
   `triggersPublication`), `MAX_COUNTED_ATTEMPTS` (production enforces
   `MAX_BASELINE_ATTEMPTS` and one escalation), `goalDoneEvidence`
   (production checks the stages in `nextInClose`), `DEFAULT_BANDS_YAML`
   (a copy of `templates/bands.yaml`), and the uncalled
   `CardRunner.classify` and `CardRunner.newId`.
4. Exports that only tests call: `fitsBeforeDeadline`, `isGlobalStop`,
   `gateChecks`, `evalFromIncident`, the `showThinking` provider option,
   and the fixtures `countedFailures`, `ensureStatePaths`, `renderSpec`
   and `renderPlan`. `docs/REQUIREMENTS-TRACEABILITY.md` marks MA3, LC9
   and Q5 implemented through pure checks the loop never calls
   (`reviewerIndependent`, `binaryRollbackCompatible`, `routeAmendment`).
5. Obsolete flags: the `CLAUDE_SESSION_ID` fallback, which Claude Code
   never exported (`CHANGELOG.md`); the goal counters
   `lifecycleRepairCycles`, `providerWaitMs` and `planningMs`, which
   nothing reads or writes; the `aidlc security check` stub tells the user
   to bind a scanner in `aidlc.config.json`, which has no such field, and
   has no test; the production gate's deny text names only
   `RELEASE_APPROVAL` while CLAUDE.md names only `AIDLC_RELEASE_APPROVAL`,
   and OPERATIONS does not say that a repository without aidlc state
   honours any approval value.

## Proposed outcome
- `aidlc card fix-task --clear` unlocks the test files.
- A deadline extension with a blank reason is refused, by one rule.
- Each rule has one implementation, the one production runs.
- Test fixtures live in the tests; exports nobody calls are gone; the
  traceability matrix says which checks the loop does not call.
- The session, counter, security and release-approval surfaces say what
  the code does and carry nothing it does not read.

## Affected users and systems
`src/cli/main.ts`, `src/hooks/index.ts`, `src/loop/card-runner.ts`,
`src/loop/controller.ts`, `src/core/` (card-machine, release-machine,
effort, goal-machine, deadlines, stop, ci-policy, types), `src/state/`
(paths, journal), `src/maintain/bands.ts`, `src/evals/runner.ts`,
`src/artifacts/` (spec, plan), `src/providers/claude-api.ts`, their tests,
`docs/`, `CLAUDE.md`, `templates/CLAUDE.aidlc.md` and `CHANGELOG.md`.

## Constraints
- One card per PR, each in its own worktree.
- Library exports removed from `src/index.ts` are named in the CHANGELOG.
- No change to review policy, allowances or the verdict schema.
- A goal record written before still parses after the counter fields go.
- No change to which commands the production gate blocks or admits.
- The user is unavailable (2026-10-14) and asked the agent to decide by
  best practice; the decisions are recorded in the spec.

## Open questions
- (none)
