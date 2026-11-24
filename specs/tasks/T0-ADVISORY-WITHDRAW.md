---
id: T0-ADVISORY-WITHDRAW
title: "A candidate whose last R3 decision is an advisory (non-merge-blocking) block can be withdrawn so its repair goes back to the DoD and R3, and card next at SHIP after such a block ships nothing while the review checkout HEAD is not the bound candidate"
status: merged
branch: T0-ADVISORY-WITHDRAW
worktree: D:\wt\AIDLC\T0-ADVISORY-WITHDRAW
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/advisory-withdraw.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-ADVISORY-WITHDRAW.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T0-ADVISORY-WITHDRAW.md
dod_command: npm run typecheck && node --test tests/scenarios/advisory-withdraw.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/candidate-pins.test.ts tests/scenarios/card-amend-continue.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/review-rule-ship.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `CardRunner.withdrawalRefusal` shall admit a withdrawal of the bound candidate when the latest R3 decision (outcome `pass` or `block`) recorded on its digest is a block that `invocationBlocking` reads as not merge-blocking; a latest decision that is a pass or a merge-blocking block shall still refuse with the text that begins `R3 decided candidate`, a candidate with a ruled pass still refuses with that text whatever invocation follows the ruled pass, and every other refusal stays as on main.
  - R2. An admitted withdrawal of such a candidate shall write what a withdrawal writes on main (counted failure with cause `withdrawn: <finding>`, BUILD, pending repair of kind `withdrawn` with the finding and the digest), and the repaired candidate shall get its own R3 decision before any ship.
  - R3. `CardRunner.ship`, after the formal review gate admits the ship and before the merge intent is recorded, shall, in a git repository with a candidate sha recorded, with no ruled pass on the candidate's digest and when the latest R3 decision (outcome `pass` or `block`) on the candidate's digest is a block that `invocationBlocking` reads as not merge-blocking, read the HEAD of the review checkout; when it differs from the candidate sha the card runner shall return a `wait` directive with `on: candidate-moved` and `pollSeconds: 0` whose narration names both shas, `aidlc card withdraw <id> --cause "<finding>"` and checking out the candidate, and shall record no operation, spend no retry and write no run. A HEAD read that throws ships as on main, and so does a candidate whose latest R3 decision is a pass, a pass by ruling or a merge-blocking block, or that has none; a candidate with a ruled pass ships as on main whatever invocation follows the ruled pass (no HEAD read, no `candidate-moved` wait).
  - R4. The description of `aidlc card withdraw` shall name the advisory case, and `docs/OPERATIONS.md` (the withdrawal paragraph), `docs/ARCHITECTURE.md` (the `CardRunner.withdrawCandidate` entry) and `changelog.d/T0-ADVISORY-WITHDRAW.md` shall state R1 and R3.
acceptance:
  - 1. `tests/scenarios/advisory-withdraw.test.ts`, real git in the fixture repository, `gateRequired` false, R3 by a scripted command. A candidate c1 gets an R3 block on the standards axis alone (outcome `block-advisory`); a fix commit c2 moves HEAD; `card next` returns `wait` on `candidate-moved` naming c1, c2 and `aidlc card withdraw`, with no merge operation recorded, `noVerdictRetriesUsed` 0 and the stored run unchanged. RED on main, where the ship merges. [R3] [dod arm 2]
  - 2. Same file: `withdrawCandidate` then succeeds (state BUILD, pending repair `withdrawn` with the finding, attempt cause `withdrawn: <finding>`); `card next` opens the repair; a success recording c2 leads `card next` to the R3 `review` directive for decision 2; a pass on c2 lets `card next` ship to merged. RED on main, where the withdrawal is refused with `R3 decided`. [R1] [R2] [dod arm 2]
  - 3. Same file: a block on the spec axis with `gateRequired` false (merge-blocking, tier unset) and a pass each keep the `R3 decided` refusal with the stored run and the journal unchanged; after a pass, `card next` ships as on main with HEAD at the candidate and with HEAD moved past it (no `candidate-moved` wait). [R1] [R3] [dod arm 2]
  - 4. The existing withdrawal, pin, amend-continue, fault-point and review-rule-ship tests pass with no change; review-rule-ship acceptance 7 (a commit after a ruled pass) still ends in the ship path's stale-verdict stop. [R1] [R3] [dod arms 3, 4, 5, 6, 7]
  - 5. The CLI description and the text of R4 (reviewer-verified against the diff); the fragment has the form of `changelog.d/README.md` and the prose test passes. [R4] [dod arms 1, 8, 9]
  - 6. `tests/scenarios/advisory-withdraw.test.ts`: a candidate with a ruled pass followed by an advisory block on the same digest refuses the withdrawal with the text that begins `R3 decided candidate`, and the stored run and the journal are unchanged. RED without the ruled-pass condition, where the withdrawal is admitted. [R1] [dod arm 2]
  - 7. Same file: a ruled pass, then an advisory block on the same digest and a moved HEAD, reaches the ship path with the ruled candidate (no `candidate-moved` wait). RED without the ruled-pass condition in `movedHead`. [R3] [dod arm 2]
depends_on: []
budget: 240
tdd: true
sweep: "On main at 9d0cb20c. `git grep -n -E 'R3 decided candidate|no R3 decision has decided|before R3 has decided' -- src tests docs`: the refusal at card-runner.ts:1594 (pinned by /R3 decided/ in candidate-withdraw.test.ts), the recordAttempt refusal at card-runner.ts:1501 (pinned whole by card-amend-continue.test.ts:98, so left unchanged), the CLI description at main.ts:713, docs/OPERATIONS.md:108 and docs/ARCHITECTURE.md:230. `git grep -n 'git.head(' -- src/loop/card-runner.ts`: pinnedCandidate alone; `CardRunner.ship` reads no HEAD before it records the merge intent. `.claude/skills/verify-card-run-writes/SKILL.md` covers `CardRunner.ship`; R3 adds no write."
forbid: [network, a change to an existing test file]
non_goals:
  - "a run already stopped by the stale-verdict retry (the issue's own run): `card withdraw` keeps its stopped-run refusal; the owner lifts that stop"
  - "a withdrawal after an R3 pass, with or without advisory notes: still refused"
  - "the text of the `review-no-verdict` stop for other stale verdicts, and the recordAttempt refusal text"
diagnosis:
  root_cause: "An advisory R3 block leaves the episode succeeded and the run in SHIP (formalReviewGate returns undefined for a non-blocking block), while withdrawalRefusal refuses any candidate with an R3 pass or block on its digest and recordAttempt refuses a succeeded episode. So a fix commit can never be bound, and `card next` ships the moved HEAD, which the github ship path rejects as [R3-STALE-VERDICT-SHA], classified review-no-verdict, retried once and stopped as missing/malformed/stale."
  same_class: "A pass (or a pass by ruling) followed by a new commit reaches the same ship of a HEAD R3 never read; there the ship path's stale-verdict refusal stays as on main (review-rule-ship acceptance 7 pins it), by the owner's ruling. The review commands already refuse a moved checkout (refuseChangedCheckout)."
hygiene: "Issue 449. The tests run real git so the HEAD read is the product's own; the ship path is DryRunShipPath, which merges whatever it is given, so main's ship is observable as a merge."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, changelog.d/T0-ADVISORY-WITHDRAW.md
---

# T0-ADVISORY-WITHDRAW

From issue 449.

## Diagnosis
After an advisory R3 block the run is in SHIP with a succeeded episode. No command binds a fix commit, and `card next` ships a HEAD R3 never read, which ends in a misleading no-verdict STOP.

## Deliverable
`card withdraw` admits a candidate whose last R3 decision is an advisory block, so the fix takes the ordinary repair path: DoD, then its own R3 decision. After such a block, `card next` at SHIP refuses to ship a review checkout whose HEAD is not the bound candidate and says what to run.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/advisory-withdraw.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/candidate-pins.test.ts tests/scenarios/card-amend-continue.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/review-rule-ship.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass and the existing withdrawal, pin, amend-continue, fault-point and review-rule-ship tests pass unchanged.

## PR summary
### What
`aidlc card withdraw` now accepts a candidate whose latest R3 decision is an advisory block. After such a block, `aidlc card next` at SHIP does not ship a moved HEAD.

### Why / Intent
Issue 449. After an advisory R3 finding, no command could bind the fix commit. The ship then failed on a stale verdict and stopped with a wrong reason.

### How / Behaviour
`withdrawalRefusal` reads the latest R3 decision on the candidate and admits an advisory block. After an advisory block, `CardRunner.ship` reads the checkout HEAD after the R3 gate. When HEAD is not the candidate, it returns a `candidate-moved` wait and writes nothing. A pass or a ruled pass ships as before, by the owner's ruling. A ruled pass also refuses a withdrawal, whatever follows it.

### System impact
Only the card runner and the CLI help text change. A pass and a merge-blocking block still refuse a withdrawal.

### Security
No new input, network call or credential.

### Tests and review
`tests/scenarios/advisory-withdraw.test.ts` uses real git and a scripted reviewer. The existing withdrawal, pin, amend-continue, fault-point and review-rule-ship tests pass unchanged. R3 reviews the candidate.

### Risk
Low. A HEAD read that fails ships as before. The guard runs only in a git repository, with a recorded candidate sha whose latest R3 decision is an advisory block.

### Ownership
The aidlc loop maintainers.

### Docs
`docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `changelog.d/T0-ADVISORY-WITHDRAW.md` state the change.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/advisory-withdraw.test.ts`, the three `acceptance 1` tests. RED at b9e23dd911: `card next` returned `close` (the moved HEAD merged). HEAD at the candidate and a HEAD that cannot be read ship as on main | pass after the fix |
| 2 | Same file, test `acceptance 2`. RED at b9e23dd911: the withdrawal was refused with `R3 decided candidate` | pass after the fix |
| 3 | Same file, the four `acceptance 3` tests: spec block (after a dispute settles the repair) and pass refuse with nothing written; after a pass, HEAD at the candidate and HEAD moved past it both ship with no `candidate-moved` wait (these four also pass on main) | pass |
| 4 | DoD: `candidate-withdraw`, `candidate-pins`, `card-amend-continue`, `fault-points`, `review-rule-ship` (acceptance 7 still ends in the stale-verdict stop) unchanged | pass |
| 5 | `src/cli/main.ts` withdraw description, the docs and the fragment; `changelog-fragments`, `prose` | reviewer-verified; pass |
| 6 | Same file, test `acceptance 6`. RED at 5b86f598: the withdrawal was admitted (no exception) | pass after the fix |
| 7 | Same file, test `acceptance 7` (base-sync R3, F3). RED at e4d1f890: `card next` returned the `candidate-moved` wait | pass after the fix |

Guards: each of nine loosened in turn; a test of this file caught seven. `equivalent:` `invocationBlocking` in `movedHead`, since a merge-blocking block gets REVIEW_FIX, a review directive or a stop before this point of `ship`. `equivalent:` `isGit` in `movedHead`, since outside a git repository the HEAD read throws, with the same result.
