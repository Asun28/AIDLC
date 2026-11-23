# Shown failing
Scratch break, never committed: in `src/loop/card-runner.ts`,
`CardRunner.preReview`, the `PRE_REVIEW_DECIDED` journal append was moved
from after `this.commitReviewed` (the store write that saves the R2 pass
round) to before it. `git diff --name-only` against the sync commit listed
`src/loop/card-runner.ts`; the check failed (exit 1, 2 of 28 failed):
the record write after the early append failed, and the journal reported
a pass the run did not hold. `git restore` dropped the change and the
check passed (28 of 28). From
`node --test --test-reporter=tap tests/scenarios/fault-points.test.ts`:

```
    not ok 3 - B preReview R2 pass (review pre): the fault-free run has fault points and no violation, and every fault point and its recovery keep I1 to I6 [R1] [R2] [R3]
      location: 'D:\\wt\\AIDLC\\T1-VERIFY-SKILL\\tests\\scenarios\\fault-points.test.ts:786:5'
      error: |-
        Expected values to be strictly deep-equal:
        +   'B preReview R2 pass (review pre) k=3 of 3, failed renameSync cards\\g-20260911000000-af8e3f\\T1-FP.json; the command threw: EIO: injected fault 3, renameSync cards\\g-20260911000000-af8e3f\\T1-FP.json; recovery: next -> wait, next -> wait; after the command: I3: PRE_REVIEW_DECIDED seq 9 (cycle 0, round 1, outcome pass, decision undefined) names no pass round the card run holds (preReview.rounds)',
    not ok 11 - every fault point of A to E reaches its command's fault-free end state or matches its pin exactly, and no pin is stale [R5] [R6]
```

The broken-order self-test proves the enumerator can fail; this section
proves the check fails on the real code.
