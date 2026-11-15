---
id: T1-FINDING-IDENTITY
title: Each formal finding stores an identity computed in code from its cited path, its class or dimension and the whitespace-normalised cited lines at the candidate, and aidlc review stats reports repeat findings by it
status: todo
branch: T1-FINDING-IDENTITY
worktree: D:\wt\AIDLC\T1-FINDING-IDENTITY
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/core/review-policy.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/review/stats.ts
  - tests/core/finding-identity.test.ts
  - tests/scenarios/finding-identity.test.ts
  - tests/surface/stats.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - tests/core/review-policy.test.ts
  - specs/tasks/T1-FINDING-IDENTITY.md
dod_command: npm run typecheck && node --test tests/core/finding-identity.test.ts tests/scenarios/finding-identity.test.ts tests/surface/stats.test.ts tests/core/review-policy.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/second-pass.test.ts
dod_exit: 0
requirements:
  - R1. `findingIdentity(reason, readLines)` (new, src/core/review-policy.ts, no I/O) with `readLines: (file: string, from: number, to: number) => string[] | undefined` shall return the first 16 hex characters of the sha256 of `<file>\n<category>\n<text>`, where `file` is `findingLocation(reason)`; the range is the `:n` or `:n-m` of the same `FINDING_LOCATION` match, cut to at most 40 lines from `n`; `category` is `findingClass(reason)` when it gives one, else the leading decimal number of the text between the opening axis and severity tags (T1-REVIEW-SEVERITY) and the ` @ `, else the empty string; and `text` is the lines `readLines` returns, each trimmed, every run of white space inside collapsed to one space, empty lines dropped, joined with `\n`. It shall return undefined when the reason has no file or no line, when `readLines` returns undefined, or when `text` is empty.
  - R2. `ReviewFinding` (src/core/types.ts:511-562) shall gain `identity` (optional, 16 lowercase hex characters). `RecordFindingsInput` (src/core/review-policy.ts:314-340) shall gain `identities` (optional map from a reason to its identity); `recordFindings` shall set `identity` on each finding it creates whose reason the map holds, and leave a re-raised finding's identity unchanged. A record written before this card parses unchanged.
  - R3. Before each formal `recordFindings` call of the card runner (the R3 decision, src/loop/card-runner.ts:2452 and :2539, and the ship-path decision, :2877-2878), the runner shall compute the identities of the cited reasons of that call with `findingIdentity`, reading lines with `git show <candidateSha>:<file>` through the runner's injected git or exec dependency (argv, never a shell string), and pass them as `identities`. A read that fails, a missing `candidateSha` or a path that leaves the repository gives that reason no identity and no error; the decision, its findings and every other field are as on main. R2 findings get no identity.
  - R4. `FindingStats` (src/review/stats.ts:40-53) shall gain `withIdentity` (formal findings that have an identity) and `repeatByIdentity` (formal findings with an identity, raised at `round` 2 or later and not a re-raise, whose identity equals the identity of a formal finding of the same card run raised at a smaller `round`); every other field keeps its value.
  - R5. docs/OPERATIONS.md (R3, findings) and docs/ARCHITECTURE.md (findings record) shall state R1 to R4 and that `re:F<n>` stays the only link that decides which findings a decision resolves (owner, 2026-11-16).
acceptance:
  - 1. `tests/core/finding-identity.test.ts` (new), "T1-FINDING-IDENTITY acceptance 1: the identity hashes path, category and whitespace-normalised cited lines". Same lines with other indentation or blank lines give the same identity; another file, another class, another dimension number or another line text gives another; the class wins over the dimension; a severity tag and an axis tag are skipped. Fails on main (no export). [R1] [dod arm 1]
  - 2. Same file, "T1-FINDING-IDENTITY acceptance 2: no identity without a file, a line, readable lines or text; a range is cut to 40 lines". Fails on main. [R1] [dod arm 1]
  - 3. Same file, "T1-FINDING-IDENTITY acceptance 3: recordFindings stores the identity of new findings and keeps it on a re-raise". Fails on main by assertion. [R2] [dod arm 1]
  - 4. `tests/scenarios/finding-identity.test.ts` (new), "T1-FINDING-IDENTITY acceptance 4: an R3 block records an identity read from the candidate commit, and an unreadable path records none". A fixture card run (`makeFixture`, tests/scenarios/_harness.ts) with a scripted R3 block citing a line of a committed file and a line of a missing file. Fails on main by assertion. [R3] [dod arm 1]
  - 5. `tests/surface/stats.test.ts`, new test "T1-FINDING-IDENTITY acceptance 5: stats count findings with an identity and repeat findings by identity". A run whose decision 2 raises, with no `re:F<n>`, a finding with the identity of a decision 1 finding, and one with a new identity. Fails on main by assertion. [R4] [dod arm 1]
  - 6. tests/core/review-policy.test.ts, tests/scenarios/second-pass.test.ts and tests/scenarios/fault-points.test.ts pass with no line changed and no pin added. At CLOSE, .claude/skills/verify-card-run-writes/SKILL.md moves its sync commit to the merge commit on main. [R3] [dod arm 1]
  - 7. The doc sentences are as R5 states (reviewer-verified against the diff). [R5]
depends_on: [T1-REVIEW-SEVERITY-3]
budget: 240
tdd: true
sweep: "Main at 0f28b51e. `FINDING_LOCATION` src/core/review-policy.ts:240 and `findingLocation` :247-252 give the file; `findingSite` :274-279 shows how the range is cut from the match. `findingClass` :266-271. `RecordFindingsInput` :314-340, `recordFindings` :385-440 (new findings created at :417-425). Formal `round` is `rec.ledger.substantiveDecisions` at card-runner.ts:2452 (R3) and :2877 (ship path), so `round` is the decision number. `commitReviewed` :2512-2557 calls `recordFindings` at :2539 on the locked record with the `findingsInput` built in `decide`. `countFindings` stats.ts:287-305. card-runner.ts is named by the verify-card-run-writes coverage record; this card adds no store write or journal append."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test, other than an expected literal that pins the exact text of a document line this card's requirements change, or the exact shape of a record or report whose fields this card's requirements add (a deepEqual of `FindingStats`, `ReviewFinding`, a bench report or case result, or `CardRun['closure']`), updated to the new text or by the added fields and nothing else, each such line named in the Attempt evidence with the requirement that changes it (a test file outside allow_paths needs a recorded amendment first)
  - linking, resolving, reopening or blocking a finding by its identity
  - a model call or a network call to compute an identity
  - a new store write or journal append
  - editing .aidlc state by hand
non_goals: [identity on R2 findings, identity in the bench (T1-BENCH-ROUNDS uses the function), a change to the verdict schema, a change to CHANGELOG.md]
hygiene: "Run `npm run check` (typecheck and the full suite, as CI runs it) in the worktree before recording the attempt and put its totals in the Attempt evidence (lesson of T1-REVIEW-SEVERITY-2, CI run 43757539597). Line numbers are from main at 0f28b51e and move with T1-REVIEW-SEVERITY; read them again at PREPARE. This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (R3 findings), docs/ARCHITECTURE.md (findings record)
---

# T1-FINDING-IDENTITY

## Deliverable
Every formal finding carries an identity that the loop computes without a model, and `aidlc review stats` counts findings that a later decision raised again without marking them with `re:F<n>`.

## Why
Findings link only by the reviewer's `re:F<n>` and the cited file, so repeat blocks are not measured (docs/reliability/baseline.md, Sources and gaps). The outside review of 2026-11-15 points to OCR's identity of path, category and normalised quoted code (alibaba/open-code-review, internal/session/compare.go). Here the code is read from the candidate commit, so the verdict schema does not change. Owner, 2026-11-16: record and report only.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/finding-identity.test.ts tests/scenarios/finding-identity.test.ts tests/surface/stats.test.ts tests/core/review-policy.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/second-pass.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; the fault-point check adds no pin.

## Attempt evidence

Attempt 1 (base main eaed61f0).

RED: commit c5698834, `node --test tests/core/finding-identity.test.ts tests/scenarios/finding-identity.test.ts tests/surface/stats.test.ts`, 5 failing for the stated reasons:
- `not ok 1 - T1-FINDING-IDENTITY acceptance 1: ...`: `TypeError: policy.findingIdentity is not a function` (no export).
- `not ok 2 - T1-FINDING-IDENTITY acceptance 2: ...`: `TypeError: policy.findingIdentity is not a function` (no export).
- `not ok 3 - T1-FINDING-IDENTITY acceptance 3: ...`: AssertionError, actual `undefined`, expected `'aaaaaaaaaaaaaaaa'`.
- `not ok 1 - T1-FINDING-IDENTITY acceptance 4: an R3 block ...`: AssertionError, actual `undefined`, expected `'98b1379faaa9ac80'`.
- `not ok 5 - ... (T1-FINDING-IDENTITY)` acceptance 5: AssertionError, `withIdentity: undefined, repeatByIdentity: undefined`, expected `4, 1`.

Added after RED, at GREEN, each shown failing by a mutant below: a second acceptance 4 test for the ship-path decision (M11), the `ReviewFinding` schema assertions in acceptance 3 (M13), and the R2-round row in acceptance 5 (M15).

| Item | Proof | Result |
|---|---|---|
| 1 | tests/core/finding-identity.test.ts, acceptance 1 | pass |
| 2 | tests/core/finding-identity.test.ts, acceptance 2 | pass |
| 3 | tests/core/finding-identity.test.ts, acceptance 3 | pass |
| 4 | tests/scenarios/finding-identity.test.ts, acceptance 4 (R3 decision and ship-path decision, real git, scripted reviewer) | pass |
| 5 | tests/surface/stats.test.ts, "T1-FINDING-IDENTITY acceptance 5" | pass |
| 6 | tests/core/review-policy.test.ts, tests/scenarios/second-pass.test.ts, tests/scenarios/fault-points.test.ts unchanged (`git diff main --stat` lists none of them), in the DoD | pass |
| 7 | docs/OPERATIONS.md, paragraph "Finding identity (card T1-FINDING-IDENTITY)" after Severity; docs/ARCHITECTURE.md, persisted-state row `cards/<goalId>/<cardId>.json`, clause "their identity (`ReviewFinding.identity` ...)" | reviewer-verified |

Pinned literals updated (forbid exception, R4 adds the fields): tests/surface/stats.test.ts lines 131, 141, 177 and 549, each a `FindingStats` deepEqual that gains `withIdentity: 0, repeatByIdentity: 0` and nothing else.

Store writes and journal appends: none added, removed or reordered. `CardRunner.findingIdentities` only runs `git show <candidateSha>:<file>` through the injected runner, before `commitReviewed` (R3) and before the ship-path `updateCardRun`, outside the lock; the identities ride in the existing `RecordFindingsInput`. Verify skill verify-card-run-writes: `git diff --name-only 402a07f3 -- <covered files>` lists `src/loop/card-runner.ts`; no line of the card diff touches `updateCardRun`, `saveCardRun`, `atomicWrite*` or `append(`; `node --test tests/scenarios/fault-points.test.ts` passes inside the DoD with no pin added. Outcome: in sync (the sync commit moves at CLOSE).

Hand mutants (edit, run the named test file, restore; none committed):
| Mutant | Test | Result |
|---|---|---|
| M1 no inner white-space collapse | finding-identity core | killed (acc 1) |
| M2 blank lines kept | core | killed (acc 1, 2) |
| M3 no trim | core | killed (acc 1, 2) |
| M4 no 40-line cap | core | killed (acc 2) |
| M5 dimension before class | core | killed (acc 1) |
| M6 axis/severity tags not skipped | core | killed (acc 1) |
| M7 empty text hashed | core | killed (acc 2) |
| M8 a location with no line accepted | core | killed (acc 2) |
| M9 `recordFindings` does not set identity | core | killed (acc 3) |
| M10 R3 decision does not pass identities | scenario | killed (acc 4, R3) |
| M11 ship-path decision does not pass identities | scenario | killed (acc 4, ship path) |
| M12 lines read from another commit (`HEAD~1`) | scenario | killed (both acc 4) |
| M13 schema accepts any identity string | core | killed (acc 3) |
| M14 same decision counts as earlier (`<=`) | stats | killed (acc 5) |
| M15 an R2 finding counts as earlier | stats | killed (acc 5) |
| M16 `withIdentity` not counted | stats | killed (acc 5) |
| M17, M18 family totals drop either field | stats | killed (acc 5) |
| M19 exit code of `git show` ignored | scenario | survives: equivalent with real git, a failed `git show` writes nothing on stdout, so the text is empty and no identity results |
| M20 missing `candidateSha` guard removed | scenario | survives: equivalent, `git show undefined:<file>` names no object and fails; the guard saves the call |

DoD: `npm run typecheck && node --test tests/core/finding-identity.test.ts tests/scenarios/finding-identity.test.ts tests/surface/stats.test.ts tests/core/review-policy.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/second-pass.test.ts`: exit 0, tests 132, pass 132, fail 0 (final tree).

Full suite (`npm run check`): exit 0, tests 3728, pass 3700, fail 0, skipped 28.

### Repair of R3 decision 1 (finding F1, identity-read-throws)

Cause: `CardRunner.findingIdentities` called the runner without a catch; a ship-path reason citing a path with a NUL byte made `runSync` throw `ERR_INVALID_ARG_VALUE` out of `applyShipResult` before its decision was saved. Fix (src/loop/card-runner.ts, `findingIdentities`): each file's read runs inside `try`; a throw, a non-zero exit or a timeout caches `undefined` for that file, so the reason gets no identity and the decision is recorded as without it. No store write or journal append added, removed or reordered.

Regression tests (tests/scenarios/finding-identity.test.ts), each failing on 79d9af32's card-runner.ts (catch removed) and passing with the fix:
- `repair F1: a ship-path block citing every reviewer path form ...`: on 79d9af32, `The argument 'args[1]' must be a string without null bytes`.
- `repair F1: a runner that throws on the read ... ship-path decision ...`: on 79d9af32, `injected runner failure`.
- `repair F1: a runner that throws on the read ... R3 decision ...`: on 79d9af32, `injected runner failure`.

Class sweep: every way the reader can be reached with input from a reviewer. The R3 path reads only reasons whose file is a changed path of the candidate (`citedReasonsOf(verdict, changedPaths)`); the ship path checks no changed path, so every form below reaches the reader there.
| Input form | Behaviour | Test |
|---|---|---|
| NUL byte in the path (the runner refuses the argument and throws) | no identity, decision recorded | repair F1 path-form test (ship); on R3 the NUL path is no changed path, so it is never read (repair F1 R3 test asserts it is not recorded) |
| a runner that throws for any other reason | no identity, decision recorded | repair F1 throwing-runner tests, ship and R3 |
| path that leaves the repository (`../outside.ts`) | git exits 128: no identity | repair F1 path-form test |
| `..` segment that leaves the repository (`src/../../outside.ts`) | git exits 128: no identity | repair F1 path-form test |
| absolute path (`/etc/hosts`) | git exits 128: no identity | repair F1 path-form test |
| file the candidate commit does not hold | git exits 128: no identity | acceptance 4, both tests |
| empty path (`@ :1`) or a path with no letter or digit | no file (`FINDING_LOCATION`, `findingLocation`): the reader is never called, no identity | acceptance 2 ("no file") |
| no line (`@ file:` without a number) | no identity, reader never called | acceptance 2 ("no line") |
| very long range (`:2-100000`) | cut to 40 lines from 2; the identity of the lines the file holds | repair F1 path-form test, acceptance 2 |
| line past the end (`:99999999999999999999`) | empty text: no identity | repair F1 path-form test |
| timed-out read | treated as failed: no identity | code path shared with the non-zero exit; no separate test |
| `..` segment that stays inside the repository (`src/../src/a.ts`) | git resolves it and returns the file: an identity over the path text as cited | no test; recorded and reported only |
| a directory path (ship path only) | `git show <sha>:<dir>` exits 0 with git's tree listing: an identity over the listing, no error | no test; follow-up candidate (`git cat-file blob` would refuse a tree, but R3 names `git show`) |

Mutant: catch removed (card-runner.ts as at 79d9af32): the three repair tests fail as listed above; restored, all five tests of the file pass.
Repair hunks reread: the `try` wraps only the runner call and the split of its stdout; the cache, the identity computation and both call sites are unchanged, and nothing the catch swallows reaches a store write.

Verify skill verify-card-run-writes after the repair: covered file `src/loop/card-runner.ts` changed, no write or append line in the repair diff, fault-point test passes in the DoD with no pin added: in sync.
DoD (repair): exit 0, tests 135, pass 135, fail 0.
Full suite (repair, `npm run check`): exit 0, tests 3731, pass 3703, fail 0, skipped 28.
