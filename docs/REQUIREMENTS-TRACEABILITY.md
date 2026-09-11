# Requirements traceability

Maps the v5 plan (`docs/plans/PLAN-aidlc-loop.md`) to code and tests. Status values: `implemented` (code plus tests naming the claim), `implemented-untested` (code present, no dedicated test), `partial` (code covers part; the rest needs live qualification or a project binding), `not-in-scope` (deliberately excluded by the plan or this release).

Test files are under `tests/core`, `tests/infra` and `tests/surface`; the suite is 360 tests across 39 suites.

## R1-R46 supplement groups (plan section 3)

| Requirement | Module(s) | Test(s) | Status |
|---|---|---|---|
| R1-R3 impact-based classification, qualified ids/issues, request-size vs ProjectTier vs phase prefix, concise size output | `src/core/router.ts` (`classifyRequest`, `formatRouting`), `src/core/types.ts` (`RequestSize`, `ProjectTier`) | `tests/core/router.test.ts` (Q2) | implemented |
| R4-R6 five lazy modules, kind/size separation, no duplicate decomposition, tests as the union of DoD/surfaces/risk/acceptance | `src/core/router.ts` (modules), `templates/claude/skills/aidlc-loop/*` (five files), `src/loop/controller.ts` (planning allowance, no re-projection by default) | `tests/core/router.test.ts` | partial: module loading is the skill router's job; the union-of-checks rule is instruction text, not enforced code |
| R7-R8 named version-correct probes and scoped states | `src/probes/git.ts`, `src/probes/gh.ts`, `src/probes/exec.ts`, `src/core/card-machine.ts` | `tests/infra/git.test.ts`, `tests/infra/gh.test.ts`, `tests/infra/exec.test.ts`, `tests/core/card-machine.test.ts` | implemented |
| R9-R12 concise progress, legal WAIT, one completion owner, durable recovery | `src/loop/controller.ts` (wait directives), `src/coordination/lease.ts`, `src/state/goal-store.ts` (`recover`), `src/state/store.ts` (interrupted writes) | `tests/infra/lease.test.ts`, `tests/infra/store.test.ts`, `tests/infra/goal-store.test.ts` | implemented |
| R13 three-hour card / twelve-hour arc, preserved counters, task-based effort with one bounded escalation | `src/core/deadlines.ts`, `src/core/effort.ts`, `src/loop/controller.ts` (`extendDeadline`) | `tests/core/deadlines.test.ts` (Q8, Q25), `tests/core/effort.test.ts` (Q25) | implemented |
| R14-R16 read current card/authority once, safe start-or-attach, light PREPARE | `src/delivery/worktree.ts` (`decideWorktree`), `src/loop/card-runner.ts` (`prepare`) | `tests/infra/worktree.test.ts` | partial: start-or-attach is tested; the real `task.ps1 -Phase start` invocation is not exercised |
| R17-R19 behavioural RED, non-TDD exemption, proportionate tests, no test weakening | `src/loop/card-runner.ts` (RED receipt, `tdd` flag), `src/hooks/index.ts` (`protectTests`), `src/core/types.ts` (`Card.tdd`) | `tests/surface/hooks.test.ts`, `tests/surface/card.test.ts` | implemented |
| R20-R21 one ship path with preserved base/mode, no ReviewGate default change, reject advisory merge of a known defect | `src/delivery/ship.ts`, `src/delivery/github-ship.ts`, `src/loop/card-runner.ts` (`capabilityBlocker`) | `tests/infra/ship.test.ts` | implemented: `tests/infra/github-ship.test.ts` (adapter), `tests/scenarios/review-block.test.ts` (block handling) |
| R22-R24 substantive vs script counters, one retry owner, diagnose CI before rerun, persisted rerun identity | `src/core/review-policy.ts`, `src/core/ci-policy.ts` | `tests/core/review-policy.test.ts` (Q6), `tests/core/ci-policy.test.ts` (Q7) | implemented |
| R25-R27 deduplicated finding dispositions, verified closure, policy-based lessons, no blind main pull | `src/core/review-policy.ts` (`findingMarker`), `src/loop/card-runner.ts` (`close`, `markClosure`), `src/probes/git.ts` (`contains`, `divergence`) | `tests/infra/git.test.ts` | partial: finding markers exist; idempotent issue creation against `gh` is not implemented |
| R28-R31 disposable board, cap of two with resource awareness, scoped child context, exact ownership and candidate evidence | `src/state/board.ts`, `src/core/arc.ts`, `src/loop/controller.ts` (`run-card` context), `src/probes/git.ts` (`candidate`) | `tests/infra/board.test.ts`, `tests/core/arc.test.ts` (Q9) | implemented |
| R32-R34 integrated goal DONE, bounded coherent repair, one T2 checkpoint, formal live amendments | `src/core/goal-machine.ts`, `src/loop/controller.ts` (`arc-verified`, `arc-failed`, `checkpoint`), `src/core/amendments.ts` | `tests/core/goal-machine.test.ts` (Q10), `tests/core/amendments.test.ts` (Q5) | implemented (controller paths need scenario tests) |
| R34a-R34g lifecycle modules | see LC1-LC12 below | see below | partial |
| R35-R36 complete STOP classes, bounded reconciliation, owned cancellation, terminal generation guard, actionable partial result | `src/core/types.ts` (`StopReason`), `src/core/stop.ts`, `src/coordination/reconcile.ts`, `src/loop/controller.ts` (stale generation refused) | `tests/core/stop.test.ts`, `tests/infra/reconcile.test.ts` (Q18) | implemented |
| R37-R39 concise autonomy instructions, attributed pointers, no hidden-reasoning requirement | `templates/claude/skills/aidlc-loop/*`, `src/providers/claude-api.ts` (thinking display omitted) | none | implemented-untested |
| R40-R45 measured five-file budgets, entry/index alignment, actual copying and reference checks | `templates/claude/skills/aidlc-loop/*` (SKILL 4170, card-loop 6134, arc 3829, release 4488, migrate 2267 bytes), `src/scaffold/init.ts` | none | implemented: `tests/surface/templates.test.ts` asserts the byte caps, ASCII-only content and the CLI routing of every skill file |
| R46 route evidence and lifecycle fault/recovery qualification | `src/loop/*` | none | not-in-scope for unit tests; requires live replays (see Q3/Q4) |

## MS1-MS5 shared sessions

| Requirement | Module(s) | Test(s) | Status |
|---|---|---|---|
| MS1 ownership has a shared scope (canonical resource keys, session/pid/start identity, generation) | `src/coordination/lease.ts` (`resourceKeys`, `LeaseStore`), `src/state/paths.ts` (`resolveRepoIdentity`) | `tests/infra/lease.test.ts` (Q23), `tests/infra/paths.test.ts` | implemented |
| MS2 handoff reconciles old effects first | `src/coordination/lease.ts` (`takeover`), `src/coordination/reconcile.ts` (`unresolved`), CLI `goal takeover` | `tests/infra/lease.test.ts` | implemented |
| MS3 review as a shared provider/account queue with dedupe and persisted order | `src/coordination/review-queue.ts`, `src/core/review-policy.ts` (`reviewRequestKey`) | `tests/infra/review-queue.test.ts` (Q24) | implemented |
| MS4 quota/congestion is WAIT with one notification owner | `src/coordination/review-queue.ts` (`hold`), `src/core/review-policy.ts` (`detectQuotaHold`), `src/loop/card-runner.ts` | `tests/infra/review-queue.test.ts`, `tests/core/review-policy.test.ts` | implemented |
| MS5 implement the missing minimum; state the participating boundary | `src/coordination/*` (single-machine shared state directory) | `tests/infra/*` | partial: coordinates sessions on one machine sharing `.aidlc/`; cross-machine or provider-side admission is out of scope and stated so |

## MA1-MA3 model and subagent assignment

| Requirement | Module(s) | Test(s) | Status |
|---|---|---|---|
| MA1 assign by role and supported capability; role profiles | `src/core/roles.ts` (`resolveRoleProfile`, `DEFAULT_MODELS`), `src/core/types.ts` (`RoleProfile`) | `tests/core/roles.test.ts` | implemented (role check result is recorded but no live check runs) |
| MA2 start at task effort; four attempts max; one escalation; same cause twice stops | `src/core/effort.ts`, `src/core/roles.ts` (`assessTaskEffort`), `src/loop/card-runner.ts` (`build`, `recordAttempt`) | `tests/core/effort.test.ts` (Q25) | implemented |
| MA3 reviewer independence and resource bounds | `src/core/roles.ts` (`reviewerIndependent`), `src/coordination/review-queue.ts` | `tests/core/roles.test.ts` | implemented |

## LC1-LC12 lifecycle modules

| Requirement | Module(s) | Test(s) | Status |
|---|---|---|---|
| LC1 development first; explicit activation by target; `not_requested` | `src/core/goal-machine.ts` (`stagesForTarget`), `src/core/router.ts` (target detection) | `tests/core/goal-machine.test.ts` (Q15), `tests/core/router.test.ts` (Q15/Q16) | implemented |
| LC2 select checks by actual impact; data impact from contracts | `src/core/migrate.ts` (`detectDataImpact`), `src/core/router.ts` (`dataImpact`) | `tests/core/migrate.test.ts` (Q20) | implemented |
| LC3 bind to real project tools; NOT CONFIGURED | `src/delivery/ops.ts` (`loadDeliveryOps`, `resolveRoles`, `executeOperation`, `lookupOperation`) | `tests/infra/ops.test.ts` | implemented |
| LC4 durable lifecycle identity and one owner; intent before mutation | `src/coordination/reconcile.ts`, `src/loop/release-runner.ts` (`issue`), environment leases | `tests/infra/reconcile.test.ts` (Q18) | implemented: `tests/scenarios/release.test.ts` (Q18 reconciliation, Q16/Q17/Q19/Q22) |
| LC5 target-specific release states | `src/core/release-machine.ts`, `src/loop/release-runner.ts` | `tests/core/release-machine.test.ts` (Q16, Q17, Q22) | implemented: `tests/scenarios/release.test.ts` |
| LC6 authorization binds to effects and evidence | `src/core/authorization.ts` | `tests/core/authorization.test.ts` (Q17, Q21) | implemented |
| LC7 health is measured | `src/core/health.ts` | `tests/core/health.test.ts` (Q19) | implemented |
| LC8 migration planning and execution are separate | `src/core/migrate.ts` (`buildMigrationPlan`, `checkMigrationOrdering`) | `tests/core/migrate.test.ts` (Q20) | implemented (execution through bound `migration-apply` is untested) |
| LC9 recovery matches data risk | `src/core/migrate.ts` (`assessRecovery`, `binaryRollbackCompatible`) | `tests/core/migrate.test.ts` (Q21) | implemented |
| LC10 breach, repair and operations feedback are bounded | `src/loop/release-runner.ts` (`recoverOrStop`), `src/loop/controller.ts` (`release-result` -> STOP/release-health), `src/maintain/*` | `tests/core/release-machine.test.ts` (Q22), `tests/surface/bands.test.ts`, `tests/surface/incident.test.ts` | partial: lifecycle repair card creation is a directive to the agent, not automated |
| LC11 overall DONE respects the selected target | `src/core/goal-machine.ts` (`goalDoneEvidence`), `src/loop/controller.ts` (`nextInClose`) | `tests/core/goal-machine.test.ts` (Q11) | implemented |
| LC12 audit claim boundary | `src/audit/manifest.ts`, `src/audit/verifier.ts`, `src/state/journal.ts` | `tests/surface/verifier.test.ts` (Q12), `tests/infra/journal.test.ts` (Q12) | partial: the host capture boundary (model turns and tool calls captured by Claude Code) is asserted by the operator, not detected |

## Q1-Q25 qualification (plan section 8)

| Test | Module(s) | Test(s) | Status |
|---|---|---|---|
| Q1 T0 bug: RED/receipt policy, minimal fix, regression evidence, closure | `src/loop/card-runner.ts`, `src/hooks/index.ts` (`protectTests`) | `tests/surface/hooks.test.ts` | partial: needs a live T0 replay through a real ship path |
| Q2 routing | `src/core/router.ts` | `tests/core/router.test.ts` | implemented |
| Q3 T1 arc: automatic dependency-ordered dispatch and combined behaviour | `src/core/arc.ts`, `src/loop/controller.ts` | `tests/core/arc.test.ts` | implemented in fixtures: `tests/scenarios/t1-arc.test.ts` (freeze-first, cap two, shared resources, child STOP, one repair cycle); live replay on a real repository still pending |
| Q4 T2 with plan-forge, projection, combined approval | `src/loop/controller.ts` (`checkpoint`), `src/core/authorization.ts` | `tests/core/authorization.test.ts` (Q4) | partial: checkpoint gate tested; plan-forge integration and live T2 pending |
| Q5 amendments | `src/core/amendments.ts`, `src/loop/controller.ts` (`revision`) | `tests/core/amendments.test.ts` | implemented |
| Q6 review: defect blocks merge, missing/stale never passes, one retry | `src/core/review-policy.ts`, `src/core/card-machine.ts` | `tests/core/review-policy.test.ts`, `tests/core/card-machine.test.ts` | implemented |
| Q7 CI: repair code, rerun transient once, never duplicate | `src/core/ci-policy.ts`, `src/loop/card-runner.ts` (`ciReconcile`) | `tests/core/ci-policy.test.ts` | implemented |
| Q8 recovery: deadlines/counters/owner persist; terminal wakeup does no work | `src/core/deadlines.ts`, `src/core/card-machine.ts`, `src/loop/controller.ts` (terminal directives) | `tests/core/deadlines.test.ts`, `tests/core/card-machine.test.ts` | implemented: `tests/scenarios/deadline.test.ts`, `tests/scenarios/t0-flow.test.ts` (no work after DONE) |
| Q9 isolation: cap two, serialisation, no third writer | `src/core/arc.ts` | `tests/core/arc.test.ts` | implemented |
| Q10 integration: green cards with a broken workflow fail; one repair cycle | `src/core/goal-machine.ts`, `src/core/arc.ts` (`canOpenIntegrationRepair`) | `tests/core/goal-machine.test.ts`, `tests/core/arc.test.ts` | implemented |
| Q11 lifecycle: required UI/security/data/package proof cannot be omitted | `src/core/goal-machine.ts` (`goalDoneEvidence`) | `tests/core/goal-machine.test.ts` | partial: stage gating only; UI/security proof binding is project-specific |
| Q12 evidence persists after cleanup; tampering and stale candidates fail | `src/audit/*`, `src/state/journal.ts` | `tests/surface/verifier.test.ts`, `tests/surface/manifest.test.ts`, `tests/infra/journal.test.ts` | implemented |
| Q13 local/docs: non-TDD evidence, no invented RED, no automatic deployment | `src/core/types.ts` (`Card.tdd`), `src/loop/card-runner.ts` | `tests/surface/card.test.ts` | partial: non-TDD flag honoured; local ship mode untested |
| Q14 packaging: measured caps, copied modules, matching indexes | `templates/`, `src/scaffold/init.ts` | none | partial: caps measured at authoring, no automated check; `init` has no test |
| Q15 optional stages: development-only finishes without cloud | `src/core/goal-machine.ts`, `src/core/router.ts` | `tests/core/goal-machine.test.ts`, `tests/core/router.test.ts` | implemented |
| Q16 delivery targets finish at their target; no promotion | `src/core/release-machine.ts`, `src/core/router.ts` | `tests/core/release-machine.test.ts`, `tests/core/router.test.ts` | implemented |
| Q17 production authority gates all external effects incl. tag-triggered CD | `src/core/authorization.ts`, `src/core/release-machine.ts` (`tagActionRequiresAuthority`), `src/loop/release-runner.ts` (`triggersPublication`) | `tests/core/authorization.test.ts`, `tests/core/release-machine.test.ts` | implemented |
| Q18 operation recovery: lost response reconciled; one owner | `src/coordination/reconcile.ts`, `src/core/card-machine.ts` | `tests/infra/reconcile.test.ts`, `tests/core/card-machine.test.ts` | implemented |
| Q19 health decides success; missing signals never PASS | `src/core/health.ts` | `tests/core/health.test.ts` | implemented |
| Q20 migration detection and ordering; irreversible alternative | `src/core/migrate.ts` | `tests/core/migrate.test.ts` | implemented (interrupted backfill resume is a directive, not automated) |
| Q21 recovery: staging rehearsal vs production recovery point; incompatible rollback blocked | `src/core/migrate.ts`, `src/core/authorization.ts` | `tests/core/migrate.test.ts`, `tests/core/authorization.test.ts` | implemented |
| Q22 incident loop: recovery is not delivery; repair deduplicated | `src/core/release-machine.ts` (dispositions), `src/maintain/incident.ts` | `tests/core/release-machine.test.ts`, `tests/surface/incident.test.ts` | implemented |
| Q23 shared sessions: one writer per card, takeover reconciles first | `src/coordination/lease.ts`, `src/core/card-machine.ts` | `tests/infra/lease.test.ts`, `tests/core/card-machine.test.ts` | implemented in-process; two real windows on one repo need a live qualification run |
| Q24 review congestion: one provider request, queueing at capacity | `src/coordination/review-queue.ts` | `tests/infra/review-queue.test.ts`, `tests/core/review-policy.test.ts` | implemented in-process; live provider admission pending |
| Q25 model policy: task baseline independent of coordinator; single escalation; counters persist | `src/core/effort.ts`, `src/core/roles.ts` | `tests/core/effort.test.ts`, `tests/core/deadlines.test.ts` | implemented |

## Known gaps

- No scenario tests yet for `src/loop/controller.ts`, `src/loop/card-runner.ts` and `src/loop/release-runner.ts` beyond the engines they compose.
- `src/delivery/github-ship.ts` (native git/gh ship chain) has no dedicated test yet; its sentinels reuse `classifyShipOutput`, which is tested.
- `src/scaffold/init.ts` and `src/cli/main.ts` have no automated tests.
