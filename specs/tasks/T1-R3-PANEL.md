---
id: T1-R3-PANEL
title: With formalReview.panel set, each R3 decision runs the primary and one more configured reviewer concurrently on one reservation and one prompt snapshot, blocks when either cites a block, passes only on two passes, and records the member on every finding
status: todo
branch: T1-R3-PANEL
worktree: D:\wt\AIDLC\T1-R3-PANEL
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - src/config.ts
  - src/core/types.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - tests/scenarios/r3-panel.test.ts
  - tests/surface/config.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T1-R3-PANEL.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-R3-PANEL.md
dod_command: npm run typecheck && node --test tests/scenarios/r3-panel.test.ts tests/surface/config.test.ts tests/surface/pre-review.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. `formalReview.panel` (optional, src/config.ts) shall be an object `{ reviewer, command, timeoutMs?, shell?, maxDiffBytes?, effort? }` validated as `formalReview.fallback` is (non-empty argv, no blank argument), with `reviewer` differing after trimming and case folding from `formalReview.reviewer`, the fallback's and the base-sync reviewer's. `secondPass: true` together with `panel` is refused naming both keys. Absent, every dispatch is as on main.
  - R2. With `panel` set, each formal dispatch by `aidlc review r3` shall run the resolved primary (the configured primary, or the fallback per the ledger as on main) and the panel member concurrently through `runReviewPanel` under one reservation, one pool request of the primary, one prompt built once from one findings snapshot and one delta, each member with its own argv, timeout and `{effort}`; it records one R3 decision.
  - R3. `runReviewPanel` (src/review/pre-review.ts) shall take an optional command per perspective; the formal panel's perspectives are the two reviewer names. The aggregate outcome shall be: a cited block from either member is a block; a pass needs a pass from both; when one member blocks and the other holds on quota, the decision is the block; when one member holds and the other passes, the held member reruns once with the other member's command under the held member's perspective name, and the decision is the aggregate of the two verdicts; any other missing or malformed verdict is the decision's no-verdict as on main.
  - R4. Every finding recorded from a panel decision shall carry `perspective` (src/core/types.ts:522) set to the member that cited it; a `re:F<n>` from either member re-raises the finding; a finding is resolved only when neither member re-raises it; the disputes answered and the deadlock count follow the per-round rule of main (a decision counts once however many members re-raise).
  - R5. docs/OPERATIONS.md (Formal review (R3) as a command, and Review panel at its sentence "The formal review is never fanned out") and docs/ARCHITECTURE.md shall state R1 to R4, that the panel is fixed in configuration before a run, and that the deadlock rule of CLAUDE.md stands unchanged; changelog.d/T1-R3-PANEL.md records the change.
acceptance:
  - 1. `tests/scenarios/r3-panel.test.ts` (new), "T1-R3-PANEL acceptance 1: one reservation, one prompt, two argv, one decision". Scripted runner; asserts both argv ran with the same prompt bytes and the ledger holds one decision. Fails on main. [R2] [R3] [dod arm 1]
  - 2. Same file, "T1-R3-PANEL acceptance 2: aggregate outcomes". Cases: block+pass is block; pass+pass is pass; block+hold is block; pass+hold reruns the held member once on the other command, then pass+pass passes and pass+block blocks; pass+malformed is no-verdict. Fails on main. [R3] [dod arm 1]
  - 3. Same file, "T1-R3-PANEL acceptance 3: findings carry their member; a re:F<n> by either member re-raises; a finding one member drops and the other re-raises stays open; two members re-raising one dispute count once". Fails on main. [R4] [dod arm 1]
  - 4. tests/surface/config.test.ts, new test "T1-R3-PANEL acceptance 4: panel validation and the secondPass refusal". Fails on main. [R1] [dod arm 1]
  - 5. pre-review.test.ts, second-pass.test.ts, r3-fallback.test.ts and fault-points.test.ts pass with no line changed; the record of .claude/skills/verify-card-run-writes/SKILL.md (coverage and sync commit) describes the code after the change and the file stays within the byte cap of tests/surface/templates.test.ts. [R1] [R3] [dod arm 1]
  - 6. The docs and changelog text are as R5 states (reviewer-verified against the diff). [R5]
depends_on: [T1-PANEL-ARMS-REPORT]
budget: 250
tdd: true
sweep: "Main at ff925160. Formal dispatch src/loop/card-runner.ts:2140-2160 (runReviewPanel with perspectives []), reviewer resolution per ledger (Fallback reviewer, docs/OPERATIONS.md), findings recording :2580 and :2920. runReviewPanel src/review/pre-review.ts:1316-1372, RunReviewPanelOptions :1280-1293, aggregateVerdicts :1216 (quota hold outranks block today). Config: FormalReviewConfig src/config.ts:99-105, fallback and baseSync name checks :171-181. ReviewFinding.perspective src/core/types.ts:522."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than an expected literal or record shape this card's requirements change, each named in the Attempt evidence
  - a pass recorded on fewer than two verdicts
  - widening the panel, or adding a reviewer, after a dispute or a deadlock
  - writing aidlc.config.json or templates/aidlc.config.json (T1-R3-PANEL-ON)
non_goals: [folding one defect cited by both members into one finding (T1-R3-PANEL-FOLD), a panel at R2 or base sync, more than two members, an agreement filter, a per-finding verification call]
hygiene: "Run `npm run check` before recording the attempt and put its totals in the Attempt evidence. Line numbers are from main at ff925160; read them again at PREPARE. The verify-card-run-writes skill applies if a covered write moves."
---

# T1-R3-PANEL

## Deliverable
A repository can run two formal reviewers on every R3 decision, off by default, with one decision, one snapshot and the deadlock rule unchanged.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/r3-panel.test.ts tests/surface/config.test.ts tests/surface/pre-review.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: the four new tests pass and the existing tests pass unchanged.
