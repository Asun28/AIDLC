---
id: T0-RETAIN-STALE-CANDIDATE
title: "aidlc evidence retain refuses an entry of a candidate-bound kind whose card merged another candidate, and a file of an earlier candidate takes the kind earlier-candidate"
status: merged
branch: T0-RETAIN-STALE-CANDIDATE
worktree: D:\wt\AIDLC\T0-RETAIN-STALE-CANDIDATE
allow_paths:
  - src/audit/verifier.ts
  - src/audit/manifest.ts
  - src/cli/main.ts
  - tests/scenarios/retain-stale-candidate.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-RETAIN-STALE-CANDIDATE.md
  - specs/tasks/T0-RETAIN-STALE-CANDIDATE.md
dod_command: npm run typecheck && node --test tests/scenarios/retain-stale-candidate.test.ts tests/surface/verifier-binding.test.ts tests/surface/verifier.test.ts tests/surface/manifest.test.ts tests/scenarios/audit.test.ts tests/scenarios/evidence-id.test.ts tests/scenarios/manifest-lock.test.ts tests/scenarios/seal-binding.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. When `--kind` is a candidate-bound kind as an exact whole string, `--card` is not empty, the goal journal holds one or more merge digests of that card, and `--candidate` is not empty and is none of them, `aidlc evidence retain` shall exit 1, before it calls the evidence store, with the text `evidence <id> of the candidate-bound kind <kind> names candidate <digest>, and <card> merged <the merge digests, joined by a comma and a space>: aidlc audit verify blocks such an entry (EVIDENCE_STALE_CANDIDATE). Evidence of a merged candidate takes its digest as --candidate; a file of an earlier candidate takes --kind earlier-candidate`. The merge digests are those `verifyAudit` compares, from one function that both call, and the command takes them from the journal only when its chain verifies, as the verifier does.
  - R2. Every other retain, and every report of `verifyAudit`, shall be what it is on main at 2b789c3f. A retain with no `--card` or an empty one, with no `--candidate` or an empty one, or of another kind is not checked, and the command does not read the journal for the check; a retain for a card with no merge digest, or on a journal whose chain does not verify, is not refused.
  - R3. A refused retain shall leave the evidence directory, the manifest and the journal byte for byte as they were.
  - R4. `src/audit/manifest.ts` shall export `EARLIER_CANDIDATE_KIND`, the string `earlier-candidate`, which is not in `CANDIDATE_BOUND_KINDS`, as the kind of a file of a candidate of a card that did not merge, such as the review verdict that blocked it.
  - R5. `docs/OPERATIONS.md`, Audit, shall state in one paragraph directly below the paragraph on `evidence retain` and `audit seal` the refusal with its conditions and its text, the retains that are not checked, that a candidate-bound kind takes only evidence of the merged candidate, the kind `earlier-candidate`, and the correction of an entry the audit reports as stale (a retain of the same id, file and digest under that kind), while `docs/ARCHITECTURE.md`, Evidence and audit chain, item 2, gains one sentence and `changelog.d/T0-RETAIN-STALE-CANDIDATE.md` holds one entry.
acceptance:
  - 1. `tests/scenarios/retain-stale-candidate.test.ts`, a new file, test 1, 31 cases, each on a journal of its own. `staleCandidateRefusal` returns the whole text for each of the five candidate-bound kinds with an earlier digest, for one operation as the card runner journals it, for a merge that a reconciliation found succeeded, and for an earlier digest of a card with two merges (the text names both digests in order). It returns nothing for a merge digest (one merge, each of two), for the kinds `earlier-candidate`, `artifact`, `Review-Verdict` and `review-verdict` with a space after it, for an absent or empty digest or card, and where the card has no merge digest (a merge of another card, no event, an intent with no result, a failed result, a succeeded result of another card, a succeeded result of the card for the intent of another card, an operation that is not a merge, an intent with no digest). For every case `verifyAudit`, given a manifest that holds the same entry, reports `EVIDENCE_STALE_CANDIDATE` for exactly the refused entries. [R1] [R2] [dod arm 2]
  - 2. In test 2, `staleCandidateRefusal` does not call its journal function for an entry of another kind or with an absent or empty digest or card, and calls it once for a candidate-bound entry that has both; `EARLIER_CANDIDATE_KIND` is `earlier-candidate` and is not candidate-bound. [R2] [R4] [dod arm 2]
  - 3. In test 3, through the command run in process (`runCliInProcess`), after a succeeded merge, a retain of a `review-verdict` with an earlier digest exits 1 with the whole text in stderr, and no evidence directory and no journal event appear; with a manifest that holds an entry, a refused retain of a new id and one of an id the manifest holds leave the journal and every file of the evidence directory byte for byte. [R1] [R3] [dod arm 2]
  - 4. In test 4, through the command, a `review-verdict` retained before the merge, and after it a retain of the merged candidate, one of the kind `earlier-candidate` with an earlier digest, one with no `--card`, one with no `--candidate` and one for another card each exit 0; the manifest and the journal hold the six in order, and `verifyAudit` reports as stale only the one retained before the merge. On a journal whose chain does not verify, a retain of a `review-verdict` with an earlier digest exits 0, the manifest holds it, and `verifyAudit` reports `JOURNAL_CHAIN` and no stale entry. The test passes with the RED seam too: it states what R2 keeps. [R2] [R4] [dod arm 2]
  - 5. In test 5, a manifest holds a `review-verdict` of an earlier candidate, as a retain made it before this card, and `verifyAudit` blocks on it; a retain through the command of the same id, content and digest under `earlier-candidate` exits 0; then `verifyAudit` reports no block, the entry has the new kind and the same file digest, the other entry is as it was, and the journal holds one `EVIDENCE_RETAINED` event with the new kind. The test passes with the RED seam too: the replacement it shows is the one the document names as the correction. [R4] [dod arm 2]
  - 6. `tests/surface/verifier-binding.test.ts`, `tests/surface/verifier.test.ts`, `tests/surface/manifest.test.ts`, `tests/scenarios/audit.test.ts`, `tests/scenarios/evidence-id.test.ts`, `tests/scenarios/manifest-lock.test.ts` and `tests/scenarios/seal-binding.test.ts` pass with no line changed, and the typecheck reports no error. [R2] [dod arm 1] [dod arm 2]
  - 7. The paragraph and the sentence of R5 are in the two documents (reviewer-verified against the diff), and `changelog.d/T0-RETAIN-STALE-CANDIDATE.md` holds one entry under this card id followed by one line feed (`tests/surface/changelog-fragments.test.ts`). [R5] [dod arm 2]
depends_on: []
budget: 250
tdd: true
sweep: "On main at 5325b3ce, and again at 2b789c3f for the files of this card. `git grep -n -F '.retain(' -- src` finds one caller of `EvidenceStore.retain`: the `evidence retain` action of src/cli/main.ts. The merge digests are a closure inside `verifyAudit` with one use. `tests/surface/manifest.test.ts` (retaining the same id replaces the entry) and docs/OPERATIONS.md, Audit, pin the replacement of an entry by a retain of its id. `tests/scenarios/card-close-cleanup.test.ts` compares the whole CLOSE section of both card-loop.md copies and the close narration with literals that name `--candidate <digest>`, and card-loop.md is at 6492 of its 6500 bytes, so this card leaves both as they are. A trial of this change in a worktree that was discarded: the 88 test files that read docs/OPERATIONS.md, docs/ARCHITECTURE.md, card-loop.md or changelog.d, with the audit test files, ran 2146 tests with 2 failures, the card-loop.md comparison (the trial then dropped its change to that file) and the changelog fragment of a card not yet registered; 30 single changes to the guards of src/audit/verifier.ts and src/cli/main.ts each fail a test of the new file."
forbid:
  - a new journal event type or a new manifest field
  - weakening or skipping a test to go green
non_goals:
  - a retain made before the merge of its card, which is accepted, and which `aidlc audit verify` reports when a repair then replaces its candidate
  - an entry with no card, which the verifier compares with the final candidate digest of a sealed manifest only
  - a command that removes an entry or marks it, since a retain of the same id replaces it
  - the text of card-loop.md and of the close narration, which a test compares whole and which has 8 bytes left under its cap; the refusal gives the rule where the mistake is made
  - `card close --evidence`, which accepts any intact file retained for the card, of any kind
hygiene: "Issue 447. The owner chose all three options of the issue in session on 2026-11-23. Option 3 needs no command: a retain of an id the manifest holds replaces the entry, and goal g-20261123004949-8953c6 was corrected so on that day (its audit reports no block). RED: the new test file with a seam, `EARLIER_CANDIDATE_KIND` and a `staleCandidateRefusal` that returns nothing and that the command does not call; tests 1 to 3 fail there on assertions, and tests 4 and 5 pass before and after. No file of the verify-card-run-writes coverage record changes. The full suite runs once before the first review."
doc_sync: docs/OPERATIONS.md (Audit), docs/ARCHITECTURE.md (Evidence and audit chain), changelog.d/T0-RETAIN-STALE-CANDIDATE.md
---

# T0-RETAIN-STALE-CANDIDATE

Issue 447. The owner chose all three options of the issue in session, 2026-11-23.

## Deliverable
`aidlc evidence retain` refuses the entry that `aidlc audit verify` would block
as `EVIDENCE_STALE_CANDIDATE` through the merges of its card, and says what to
do. A file of an earlier candidate has a kind of its own, `earlier-candidate`.
The documents give the rule and the correction of an entry that is already stale.

## Why no new command
Option 3 of the issue asked for a command that marks an entry as superseded.
`aidlc evidence retain` with an id the manifest holds replaces that entry, and
the journal records each retain. So the correction is a retain of the same id,
file and digest under `earlier-candidate`.

## Rules that decide edge cases
- The refusal and the audit use one function for the merge digests, on the same events, so they agree on every journal.
- An empty `--card` or `--candidate` counts as absent, as in the verifier.
- The refusal comes before the store is called, so it comes before the checks of the lock section (sealed manifest, file name, missing `--file`).
- The text names whole digests, since the operator passes one to `--candidate`.

## PR summary
### What
`aidlc evidence retain` now refuses evidence that is bound to a candidate which did not merge. A new kind, `earlier-candidate`, holds such a file.

### Why / Intent
The audit blocks on such an entry (`EVIDENCE_STALE_CANDIDATE`). Before this change, the command accepted the entry with no warning. Then the goal could not pass the audit (issue 447).

### How / Behaviour
- The command reads the merges of the card from the goal journal. It refuses a candidate-bound entry whose digest is not a merge digest.
- The refusal gives the merge digests and the two correct forms of the command.
- A retain of the same id under `earlier-candidate` corrects an entry that is already stale.

### System impact
The refusal and the audit use one function, so they agree. The audit reports the same findings as before. No stored record changes its form.

### Security
No new input and no new command. The check uses the journal only when its hash chain verifies. A refused retain writes nothing.

### Tests and review
- Five new tests pass; the DoD passes with 88 tests and the full suite with 4105.
- 34 single changes to the guards: a test fails for each one.
- R3 blocked one time, and the repair makes test 3 prove that a refused retain creates no directory.

### Risk
Low. The command refuses only an entry that the audit blocks. It does not check a retain before the merge; the audit reports that case later.

### Ownership
Card `T0-RETAIN-STALE-CANDIDATE`, goal `g-20261123104444-889a3b`, issue 447. The repository owner chose the direction.

### Docs
`docs/OPERATIONS.md` (Audit) has a new paragraph with the rule and the correction procedure. `docs/ARCHITECTURE.md` has one new sentence. `changelog.d/T0-RETAIN-STALE-CANDIDATE.md` holds the entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/retain-stale-candidate.test.ts tests/surface/verifier-binding.test.ts tests/surface/verifier.test.ts tests/surface/manifest.test.ts tests/scenarios/audit.test.ts tests/scenarios/evidence-id.test.ts tests/scenarios/manifest-lock.test.ts tests/scenarios/seal-binding.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the five new tests pass, the audit and manifest tests pass with no line changed, the typecheck is clean and the changelog fragment is well formed.

## Attempt evidence
RED commit 128e2c31 holds the new test file and a seam: `EARLIER_CANDIDATE_KIND`, and a `staleCandidateRefusal` that returns nothing and that the command does not call. Tests 1 to 3 fail there on assertions. Tests 4 and 5 pass there and after. The final test file gives the same result on the source of that commit.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/retain-stale-candidate.test.ts`, test `acceptance 1`: 31 cases; the refusal compared whole, and the `EVIDENCE_STALE_CANDIDATE` findings of `verifyAudit` on a manifest with the same entry compared whole. RED at 128e2c31 | pass after the change |
| 2 | test `acceptance 2`: a journal function that fails when called, for six entries; a count of calls for one entry; the constant. RED at 128e2c31 | pass after the change |
| 3 | test `acceptance 3`: the command in process; exit 1, the text in stderr, the journal and the evidence directory compared with a record taken before each refused retain; the record holds the bytes of the journal, whether the evidence directory exists, and the bytes of each file of it. RED at 128e2c31 | pass after the change |
| 4 | test `acceptance 4`: six retains exit 0 and are in the manifest and the journal in order; the audit reports as stale only the one made before the merge; on a journal with an altered first event the retain exits 0; on a journal file that cannot be read the retain reaches the store and the append fails, as on main | pass before and after |
| 5 | test `acceptance 5`: block finding before, no block after, the two entries compared whole (the other entry as it was, the corrected one equal to the earlier one but for its kind), one `EVIDENCE_RETAINED` event | pass before and after |
| 6 | DoD arm 1 exit 0; DoD arm 2, 88 tests, 88 pass, 0 fail, with the seven named files among them; `git diff --numstat origin/main...HEAD` lists none of the seven | pass |
| 7 | `tests/surface/changelog-fragments.test.ts`; `docs/OPERATIONS.md`, Audit, the paragraph that starts `Evidence of an earlier candidate (card T0-RETAIN-STALE-CANDIDATE).`, directly below the paragraph on `evidence retain` and `audit seal`; `docs/ARCHITECTURE.md`, Evidence and audit chain, the end of item 2 | pass; the two texts are for the reviewer |

Each requirement clause and the assertion that fails without it:

| Clause | Assertion |
|---|---|
| R1, a candidate-bound kind as an exact whole string | test 1: the five kinds are refused; `Review-Verdict` and `review-verdict` with a space after it are not |
| R1, `--card` is not empty | test 1, `no card` and `an empty card` |
| R1, one or more merge digests of that card | test 1: the control `one operation as the card runner journals it` is refused, and each of six cases that change one part of that operation is not; `a merge of another card only`; `no journal event of the card`; a reconciliation counts |
| R1, `--candidate` is not empty and is none of them | test 1: `no candidate digest`, `an empty candidate digest`, a merge digest for each kind, and each digest of a card with two merges |
| R1, exit 1 | test 3, the status of three refused retains |
| R1, before it calls the evidence store | test 3: no evidence directory after the first refusal; the record of the directory and the journal is equal after each later one |
| R1, the text | test 1 compares it whole, with one digest and with two; test 3 finds it whole in stderr |
| R1, one function that both call | test 1: refusal and audit finding agree on 31 journals; `git grep -n mergeDigests -- src` lists the function, its call in `verifyAudit` and its call in `staleCandidateRefusal` |
| R1, from the journal only when its chain verifies | test 4, the second goal |
| R2, every other retain | test 4: six retains exit 0, and the manifest and the journal hold them in order |
| R2, every report of `verifyAudit` | item 6: `verifier-binding`, `verifier`, `audit` and `seal-binding` pass with no line changed; test 1 compares each stale finding whole |
| R2, not checked and no journal read | test 2 |
| R2, no merge digest, or a chain that does not verify: not refused | test 1 (eight cases), test 4 (the retain before the merge, the second goal, and the third goal for a journal file that cannot be read) |
| R3 | test 3: the record is taken before the first refused retain, and again before the two refused retains on a manifest that holds an entry |
| R4, the constant and its value | test 2 |
| R4, not candidate-bound | test 2; test 1, `the kind "earlier-candidate"`; test 4, `earlier` is not reported; test 5 |

Changes, each made alone in the source, run against the new test file, then restored. 34 changes, and a test fails for each:

| Change | Test that fails |
|---|---|
| `staleCandidateRefusal`: the kind is not checked | 1, 2, 4, 5 |
| an absent digest is checked | 1, 2 |
| an absent card is checked | 2 |
| an empty card is checked | 2 |
| the journal is read before the conditions | 2 |
| a card with no merge is refused | 1, 2, 4 |
| a merge digest is refused | 1, 3, 4 |
| only the first merge digest is accepted | 1 |
| only the last merge digest is accepted | 1 |
| nothing is refused | 1, 3 |
| the text names short digests | 1, 3 |
| the text names the first merge digest only | 1 |
| the text names another kind for an earlier candidate | 1, 3 |
| `mergeDigests`: a result of another card counts | 1 |
| a failed result counts | 1 |
| a reconciliation does not count | 1 |
| an intent of another card counts | 1 |
| an operation of another kind counts | 1 |
| an intent with no result counts | 1 |
| only the first merge | 1 |
| `evidence retain`: the command does not refuse | 3 |
| the refusal comes after the store write | 3 |
| the refusal comes after the journal event | 3 |
| the command checks no card | 3 |
| the command checks no digest | 3 |
| the command checks a fixed kind | 3 |
| the refusal names another id | 3 |
| the command reads no journal event | 3 |
| the command reads a journal whose chain does not verify | 4 |
| the command reads only a journal whose chain does not verify | 3, 4 |
| a journal that cannot be read stops the command before the store | 4 |
| a refused retain creates the evidence directory | 3 |
| a refused retain writes an empty file into the evidence directory | 3 |
| a refused retain appends a byte to the journal | 3 |

Verify skill `verify-card-run-writes`: `git diff --name-only origin/main...HEAD` lists no file of its coverage record. Outcome: in sync, no run needed.

Full suite, run once on the candidate source, tests, documents and changelog fragment, before this section was written: `npm test` exit 0, 4105 tests, 4073 pass, 0 fail, 32 skipped. One guard came after that run: the command takes no event from a journal file that cannot be read (test 4, the third goal). The DoD and the sweep ran again after it. The repair of R3 decision 1 changed the new test file and this file only, and the DoD ran again.

## Repair of R3 decision 1
F1, class directory-absence-not-asserted: acceptance 3 says that no evidence directory appears after a refused retain, and the record of test 3 held files only, so an empty directory changed nothing it compared. On the blocked candidate 65e6a581 the change `a refused retain creates the evidence directory` failed no test; on this candidate it fails test 3.

The repair, in `tests/scenarios/retain-stale-candidate.test.ts` only:
- The record of test 3 (`written`) holds the key `.` when the evidence directory exists. No retained file can have that name: a retain refuses a file name that ends with a dot.
- Test 3 also asserts `existsSync` of the directory as false before and after the first refused retain.
- The record reads the journal and each file as `latin1`, one character for each byte, so `byte for byte` in R3 is what the comparison does.

Sites of the class in the allow_paths: the first refused retain of test 3 (no directory before or after), and its two later refused retains (the directory exists, and the record before and after is equal). Tests 1, 2, 4 and 5 assert no absence. One more assertion was narrower than its acceptance sentence: item 5 says that the other entry is as it was, and test 5 compared four fields of it; it now compares the two entries whole.

States the repaired record handles, each with its assertion:

| State of the evidence directory | Assertion |
|---|---|
| absent | test 3, before and after the first refused retain: the keys of the record are `journal` only, and `existsSync` is false |
| present and empty | the change `a refused retain creates the evidence directory` fails test 3 |
| present with files | test 3, the two refused retains on a manifest that holds an entry; the changes that write an empty file and that append a byte to the journal fail test 3 |
| a directory inside it | not made by any retain; `readFileSync` of it throws, so the test fails |

Size: 229 lines added and 18 deleted before this card file, against the budget of 250.
