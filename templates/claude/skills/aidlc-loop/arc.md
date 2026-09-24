# arc: multi-card selection, live changes, integrated acceptance

Goal states: PLAN, CARDS, RUN, WAIT, VERIFY-ARC, DELIVER, CLOSE, DONE, STOP.
`aidlc next --goal <id>` returns one directive; `aidlc report` commits the
result. `aidlc board` regenerates the view; it is never the truth for
clocks, approvals or history.
Arc deadline: 12h from intake, planning and waits included. At the deadline
admit no new card across the arc; reconcile within the 5 min grace, then
STOP/time. Retries, revisions, successors and wakeups never reset it; an
extension is explicit and recorded (`aidlc goal extend`).

## Ready set and dispatch
- Select from the accepted dependency graph plus integrated prerequisite
  evidence: a `depends_on` is closed when merged on the base, not "green".
- Freeze/interface cards run alone before dependents. A contraction
  (`migration_phase: contract`) is a later compatibility step, never first.
- Workers: at most two, only with disjoint allow_paths AND disjoint declared
  resources (ports, databases, builds) AND verified ownership controls. One
  reviewer slot or uncertain locking => one worker. The lead reads and
  verifies; it is never an uncounted third writer. The host-wide writer cap
  counts every window; child claims are admission, not extra capacity.
- Children receive card + revision, project/base/mode, goal authority,
  deadline, the elapsed time against it (`elapsed <s> / <s>`), owner
  generation, role/effort profile, review pool and evidence location;
  they read project rules themselves and return compact state
  plus verifiable refs, never a transcript or a bare success line.
- Child STOP blocks its dependents; independent ready work continues. An
  empty ready set with required gaps is WAIT or STOP, never DONE.
- Tier S / scaffold-core cards go through task-loop under the same shared
  admission; a branch that cannot is a capability blocker.

## Amendments (live changes)
- Unstarted card: formal amendment in place (new card revision).
- Running or reviewed card: reconcile produced effects (commits, PR,
  review), then a recorded contract amendment or a linked successor.
- Merged card: history is immutable; a successor implements the change.
- Card-text-only request: validate text; no code execution.
- User amendments version the same goal; unaffected evidence is retained;
  superseded cards map to replacements or authorized removals. A stale
  generation/revision dispatch is revalidated before any mutation. A fresh
  continuation after a terminal generation links it and keeps exhausted
  limits unless the user explicitly changes them.

## VERIFY-ARC (every multi-card goal)
Green cards are not a delivered goal. Run integrated acceptance on the final
integrated SHA: the requested user workflows, relevant E2E and evals, plus
security, performance and accessibility checks by actual impact. Failure =>
at most one bounded in-scope repair cycle (`aidlc goal repair`) with coherent
repair cards (not one per assertion, not relabeled T0), then rerun the
affected integrated checks. A second failure => STOP/arc-verify. Repair
keeps the arc deadline and counters.

## CLOSE / DONE
Development target: DONE needs every mandatory outcome of the accepted
revision mapped to retained verification on the final SHA; required cards,
defects, metadata and applicable data/security criteria resolved;
superseded work mapped; cleanup and terminal accounting verified. No cloud,
deploy or monitor setup is required. Other targets hand to release.md via
DELIVER. Disabled stages report not_requested, never PASS or missing.

## Pacing
The parent owns continuation for nested work: one completion mechanism per
signal (in-turn notification or one scheduler owner), never both. Verify
live tool schemas; do not invent scheduler fields. Poll active CI at 60-120 s
within deadlines. Child DONE never cancels the parent's next-card step. On
terminal handling: stop admitting work, reconcile, persist no-new-work,
cancel only owned entries, retain evidence, return. Approval may stay a
visible WAIT during an active interaction; an unattended run STOPs with the
prepared approval target and precise next action.
