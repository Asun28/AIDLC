# card-loop: one card to verified closure

`aidlc card next <id>` returns one directive from the precedence below; do
that move, then `aidlc card report <id> --result <...>`. Read the card, its
plan section and the code once per revision; reload only when authority
changes. PREPARE never reruns the planning funnel or a full survey.

## Precedence (evidence decides, never board or chat)
1. Unknown operation outcome => WAIT: reconcile, admit no new mutation;
   after the 5 min grace => STOP/time listing the unresolved ids.
2. Terminal, stale generation or capability blocker => STOP.
3. Merge verified + closure complete => DONE (return; no new work).
4. Known operation running => WAIT (attach; never duplicate dispatch).
5. Merge verified, closure incomplete => CLOSE.
6. Deadline reached => STOP/time.
7. Review or repair allowance exhausted => STOP/review or STOP/card.
8. No validated context => PREPARE.
9. Fresh substantive block with allowance left => REVIEW-FIX.
10. Acceptance work incomplete => BUILD.
11. Candidate ready, no active operation, merge incomplete => SHIP.

## Probes (check exits before parsing; an error is not an empty result)
- Card: `aidlc cards validate --card <id>` (id, status, dod, allow_paths,
  depends_on, tier, acceptance). Registry is authority; board is a view.
- Worktree/owner: `git worktree list --porcelain`, exact branch + canonical
  path + common dir + lease. A directory name or start exception is not
  ownership; mismatch => STOP/ownership.
- Candidate: HEAD + `git status --porcelain=v1 --untracked-files=all`.
  Dirty/untracked inputs need more than a SHA; the digest binds them.
- Base: explicit refresh, `git rev-list --left-right --count <base>...HEAD`.
- PR: `gh pr list --state all --head --base` then `gh pr view` with head/
  base/merge fields; keep the retained number. Retargeted, closed-unmerged
  or multiple PRs are never a new start.
- DoD: run the parsed command in the worktree; retain exit + output receipt.
- Review: `.review/<branch>.json`; verdict enum is case-sensitive; keep raw
  output; do not assume per-round file names.
- CI: `gh run view <id> --json databaseId,attempt,status,conclusion,headSha,jobs`.

## PREPARE
Validate card, capabilities, owner. Start a worktree only if none exists;
attach only on exact match. Card start is fixed at first PREPARE; deadline =
min(start + 3h, goal deadline). Record role profile, effort baseline, mode
(local/remote) and explicit base. Advisory ship that could merge a known
defect before you read the verdict => STOP/capability. Required gate with
no reviewer => STOP/capability. Tier S / scaffold-core => task-loop, same
admission.

## BUILD
TDD: prove behavioral RED first (`aidlc card red <id>`; scaffold: task.ps1
-Phase red). Bugs keep a reproducing test before the fix. Non-TDD docs use
the explicit exemption (`tdd: false`). Tests are proportionate; new units get
new files. Never weaken or delete a test to hide a failure; a wrong test is
corrected with evidence and re-validated. Checks = DoD + changed paths +
risk criteria + integrated acceptance; reuse evidence only for the same
candidate/base/inputs/runner policy. A diff over about 200 lines not
mandated by the card => stop and ask.
Attempts (MA2): `aidlc card attempt <id> --outcome success|fail|not-counted
--cause "<normalized>" [--progress]`. Record cause, evidence, checks gained
and lost, next hypothesis. Escalate once, only after the third baseline
failure with evidenced progress and a diagnosed harder problem; a fourth
failure ends the episode. No fifth attempt via another session or card.

## SHIP
Pre-review (R2) when `preReview.command` is set: `aidlc review pre <id>` on the
committed candidate; pass opens the ship, block returns to BUILD as a counted
repair, rounds cap per R3 cycle, an R3 block restarts the cycle.
One existing ship command (`aidlc card ship <id>`; scaffold: task.ps1 -Phase
ship from the MAIN checkout, never inside the worktree). Preserve explicit
base and mode across retries; an auth failure never becomes local mode. Do
not change ReviewGate defaults. Persist rerun and merge intent before
issuing. Base moved => reconcile active ship, merge-based sync only; never
rebase or amend receipt-bound or published history; recheck tests and
review; no stale approval.

## Review (R3)
R3 command when `formalReview.command` is set: `aidlc review r3 <id>`.
Allowance: one initial decision + one for a repaired candidate. A second
substantive block => STOP/review. Missing, malformed or stale verdict never
passes; dispatch + one retry TOTAL across script and driver (a script
internal retry consumes it); name one retry owner. Verified quota or
admission hold => WAIT within the deadline through the shared queue
(`aidlc review status`); unknown output alone is not quota. Dedupe by
invocation id, not file count; script counters are tracked separately and
never rewritten. Introduced defect: fix in scope or revert, never defer as a
nit. Unrelated finding: deduplicated issue keyed by card/PR/SHA marker. No
self-approval, no reviewer fan-out, no account switch, no lower effort or
family switch to dodge quota.

## CI
Classify first (`aidlc ci classify`): code defect => BUILD with a new
candidate; justified transient => one same-origin rerun per run/attempt/
candidate, persisted before the request and reconciled after; a lost
response still consumes it. Unknown => diagnose, no rerun. Same normalized
cause twice with no progress stops the branch.

## CLOSE
Verify the feature merge on the intended base, then perform only missing
steps: status and doc_sync via the approved metadata procedure, finding
dispositions replayed idempotently from all retained verdicts, evidence
retained (`aidlc evidence retain`), cleanup, base contents. A reminder or
exit 0 is not closure. Persistence failure after merge => merge_verified +
STOP/audit; never repeat the merge. Lessons only under repository policy;
no unrelated staging, sweeps or base pushes.

## DONE / STOP
DONE is a child result; the parent verifies and delivers the goal. STOP
preserves partial effects, reason and the precise next action. Reasons:
card, capability, scope, risk, frozen, checkpoint, review, tool, ci, auth,
time, arc-verify, release-config, release-auth, release-health, migration,
rollback-auth, audit, ownership, cancelled. Late wakeups check the terminal
generation and do nothing. Never keep waking to manufacture an approval.
