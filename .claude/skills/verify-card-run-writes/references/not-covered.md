# Not covered
- Two-session interleavings of the lease and the review queue, and
  writes to the lease, review-queue, operation-ledger and `.review/` files.
- More than one fault per run, a crash inside one write, a process
  that dies mid-command, a torn journal line.
- Commands the check does not drive: `CardRunner.takeover`,
  `CardRunner.disputeFinding`, `CardRunner.acceptFinding`,
  `CardRunner.ruleFinding` (its write, `FINDING_RULED`, lift's
  `REVIEW_DECIDED` appends: `tests/scenarios/review-rule*.test.ts`),
  `CardRunner.continueStop`, `CardRunner.withdrawCandidate`,
  `CardRunner.adoptMerge`, `CardRunner.amendCard` (fault rows:
  `tests/scenarios/card-continue.test.ts`, `candidate-withdraw.test.ts`,
  `adopt-merge.test.ts`, `card-amend.test.ts`), `aidlc review repro` (`runRepro`,
  `src/review/repro.ts`, T1-FINDING-REPRO-2: one `GoalStore.updateCardRun`
  write of the finding's `repro` after both runs, no journal append: a
  failed write exits 1, changes neither), failed and not-counted attempts,
  R2/R3 blocks, no-verdict results, `card next` PREPARE, BUILD and CLOSE
  steps (T0-PREPARE-WORKTREE: PREPARE start writes PREPARE, no worktree
  path).
- A confirmed violation the current code shows is not a pass: it is
  pinned in `KNOWN_VIOLATIONS` with its counterexample and filed as a
  T0-bugfix card, so those fault points are known defects, not covered
  behaviour.
