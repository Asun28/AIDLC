---
id: T0-RETAIN-STALE-CANDIDATE
title: "aidlc evidence retain refuses an entry of a candidate-bound kind whose card merged another candidate, and a file of an earlier candidate takes the kind earlier-candidate"
status: todo
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

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/retain-stale-candidate.test.ts tests/surface/verifier-binding.test.ts tests/surface/verifier.test.ts tests/surface/manifest.test.ts tests/scenarios/audit.test.ts tests/scenarios/evidence-id.test.ts tests/scenarios/manifest-lock.test.ts tests/scenarios/seal-binding.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the five new tests pass, the audit and manifest tests pass with no line changed, the typecheck is clean and the changelog fragment is well formed.
