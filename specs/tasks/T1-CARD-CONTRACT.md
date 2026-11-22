---
id: T1-CARD-CONTRACT
title: "A new card run holds one digest for each contract field of its card, and pure rules give the fields that changed, the evidence they touch and the digest of an amended candidate"
status: todo
branch: T1-CARD-CONTRACT
worktree: D:\wt\AIDLC\T1-CARD-CONTRACT
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/core/contract.ts
  - src/loop/controller.ts
  - tests/core/contract.test.ts
  - tests/scenarios/card-contract.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CARD-CONTRACT.md
  - specs/tasks/T1-CARD-CONTRACT.md
dod_command: npm run typecheck && node --test tests/core/contract.test.ts tests/scenarios/card-contract.test.ts tests/core/amendments.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The function `contractDigests` of `src/core/contract.ts` shall return one SHA-256 hex digest for each of `requirements`, `acceptance`, `allow_paths`, `forbid`, `non_goals`, `dod_command`, `dod_exit`, `budget` and `tdd`, computed over the canonical JSON of the value the parsed card holds for that field, with `null` for a field the parsed card leaves undefined.
  - R2. WHEN `ensureCardRun` creates a run, the controller shall record on it `contract`, the digests of the card as the registry of the main checkout holds it at that call, and leave the record of an existing run as it is.
  - R3. The function `changedContractFields` shall return, in the order of R1, the fields whose digest in a recorded contract differs from the digest of the card.
  - R4. The function `invalidatedBy` shall return `dod` when the changed fields hold `acceptance`, `dod_command`, `dod_exit` or `tdd`, `review` when they hold `requirements`, `acceptance`, `allow_paths`, `forbid` or `non_goals`, both when both hold, and neither for `budget` alone.
  - R5. The function `amendedDigest` shall return its digest argument for a count of 0 and otherwise the SHA-256 hex digest of the previous result followed by a line feed and the word `amended`, applied that count of times.
  - R6. The `CardRun` schema shall hold an optional `contract`, a record from field name to digest, and `amendments`, an array that defaults to empty, of entries with `at`, `by`, `reason`, `revision`, `changed` and `invalidated`.
  - R7. The files `docs/ARCHITECTURE.md` and `changelog.d/T1-CARD-CONTRACT.md` shall state R1 to R6 and say that the command arrives with T1-CARD-AMEND.
acceptance:
  - 1. `tests/core/contract.test.ts`. `contractDigests` returns the nine keys of R1. For each field, two cards that differ in that field alone differ in that digest alone. Two card files that parse to the same values (other key order, other line breaks inside a list item) give the same nine digests, and so do a card that leaves an optional list out and one that gives it empty where the parsed card holds the same value for both. [R1] [dod arm 2]
  - 2. Same file. `changedContractFields` returns the differing fields in the order of R1, and none for equal contracts. `invalidatedBy` gives the row of R4 for each of the nine fields alone and `dod` and `review` for `budget` with `acceptance`. [R3] [R4] [dod arm 2]
  - 3. Same file. `amendedDigest(d, 0)` is `d`; `amendedDigest(d, 1)` is the SHA-256 hex digest of `d`, a line feed and `amended`; `amendedDigest(d, 2)` equals `amendedDigest(amendedDigest(d, 1), 1)` and differs from both. [R5] [dod arm 2]
  - 4. `tests/scenarios/card-contract.test.ts`. A run that `ensureCardRun` creates holds `contract` equal to `contractDigests` of its card; after the card file changes on disk a second `ensureCardRun` returns the run with the same `contract`. `CardRun.parse` of a record without `contract` and without `amendments` gives undefined and an empty array, and a record with one amendment round-trips. [R2] [R6] [dod arm 2]
  - 5. The typecheck passes, and `tests/core/amendments.test.ts` and `tests/scenarios/fault-points.test.ts` pass with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 6. The docs state R1 to R6 (reviewer-verified against the diff). [R7]
depends_on: [T1-CONTINUE-CI]
budget: 200
sweep: "On main at f51534d2. src/loop/controller.ts:770 is where `ensureCardRun` writes `cardRevision` on a new run, the one place a run is created. src/core/types.ts:901-902 holds `cardRevision` and its comment 'Nothing in src reads it'. src/core/amendments.ts holds `routeAmendment` and `mapRevision` (goal revisions) and is not changed. `canonicalJson` is the function src/audit/manifest.ts:159 uses; read where it is defined before writing another. The card schema with its defaults is `Card` in src/core/types.ts, and src/artifacts/card.ts parses a card file into it."
forbid: [weakening or skipping a test to go green, a digest over the card file's bytes, a change to `candidate.digest` of any run, editing .aidlc state by hand]
non_goals: [the act that records an amendment and the use of `amendedDigest` in `recordAttempt` (T1-CARD-AMEND), a `contract` for a run created before this card, a report or a gate when the card differs from the recorded contract, a change to `routeAmendment` or to goal revisions]
hygiene: "Line numbers are from main at f51534d2; read them again at PREPARE. The schema gains fields, so every parsed run holds `amendments`: run `npm test` once before the attempt is recorded, because a test outside the DoD may compare a whole run record. The fault-point check drives `card next`, which creates the run: when its expected record changes, follow the verify-card-run-writes skill before SHIP and at CLOSE. src/core/contract.ts is a new module that src/loop/controller.ts imports, so the `cli.start` module count of the loop benchmark rises by one; the DoD runs the benchmark after the build, and T1-CONTINUE-REVIEW-2 moved the ceiling to the count it measured. Name the module in docs/ARCHITECTURE.md (tests/surface/module-map.test.ts) and run every test file that reads that document."
doc_sync: docs/ARCHITECTURE.md
---

# T1-CARD-CONTRACT

## Deliverable
Each new card run records what its card's contract was when the run started, and four pure functions hold the rules an amendment applies. No caller amends yet.

## Why
`specs/card-continuation.md`, R10 and R12 to R14: nothing binds a run to its card text today, so no command can say what an amendment changed or which evidence it touches.

## Rules that decide edge cases
- A digest is over the parsed value, never over the file's bytes: a change of layout is no change of contract.
- `acceptance` touches both kinds of evidence; `budget` touches none.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/contract.test.ts tests/scenarios/card-contract.test.ts tests/core/amendments.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the four files passes, the build succeeds and every benchmark count is within its ceiling.
