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
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - linking, resolving, reopening or blocking a finding by its identity
  - a model call or a network call to compute an identity
  - a new store write or journal append
  - editing .aidlc state by hand
non_goals: [identity on R2 findings, identity in the bench (T1-BENCH-ROUNDS uses the function), a change to the verdict schema, a change to CHANGELOG.md]
hygiene: "Line numbers are from main at 0f28b51e and move with T1-REVIEW-SEVERITY; read them again at PREPARE. This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
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
