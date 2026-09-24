---
id: T1-PROMPT-CHECK-2
title: The end-of-turn wording says a note after the verdict line is ignored only when it holds no JSON, and the removed-instruction check catches the phrasings the T1-OPUS55-PROMPTS reviews found missing
status: todo
branch: T1-PROMPT-CHECK-2
worktree: D:\wt\AIDLC\T1-PROMPT-CHECK-2
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/prose.test.ts
  - tests/surface/pre-review.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-PROMPT-CHECK-2.md
dod_command: npm run typecheck && node --test tests/surface/prose.test.ts tests/surface/pre-review.test.ts
dod_exit: 0
requirements:
  - R4. The end-of-turn wording shall say that a note after the verdict line is ignored only when it contains no JSON.
  - R5. The removed-instruction check shall catch 'be very conservative', 'be more conservative', 're verify' and 'verify ... with a subagent' with any number of words between within one sentence.
acceptance:
  - 1. The end-of-turn sentence in `src/review/pre-review.ts`, the `docs/OPERATIONS.md` paragraph and the `CHANGELOG.md` entry say a note after the verdict line is ignored only when it contains no JSON, because the reader takes the last JSON document that parses; the exact-sentence tests and the prompt-hash helper follow the new text and the six original prompt hashes still hold (prose.test.ts, pre-review.test.ts). [R4] [dod arm 1]
  - 2. `removedInstructions` catches 'be very conservative', 'be more conservative', 'stay more conservative', 're verify' and 'verify every step of the result with a subagent', each with a self-test case, and does not match across a sentence end (a case where 'verify' and 'with a subagent' sit in two sentences stays clean); the scan of every agent, skill and review-policy file still finds nothing (prose.test.ts). [R5] [dod arm 1]
  - 3. `CHANGELOG.md` Unreleased carries the entry; a test reads the exact sentences this card adds and fails with any one removed. [R4] [R5] [dod arm 1]
depends_on: [T1-RENAME-PATHS]
plan_ref: plans/review-followups.md#7
budget: 150
tdd: true
sweep: "grep -rn 'no verdict line before it\|REMOVED_INSTRUCTIONS' src/ tests/ docs/ CHANGELOG.md: the prompt line (pre-review.ts:254), the OPERATIONS paragraph (OPERATIONS.md:210), the CHANGELOG entry, the patterns (prose.test.ts:73)"
non_goals: [changing the verdict reader, adding new forbidden instructions beyond the listed phrasings]
forbid: [loosening the existing patterns]
hygiene: "Follow-up 1 of goal g-20260923224425-e5e886: the R2 and R3 advisories on T1-OPUS55-PROMPTS (PR #34). List every variant of each phrase before the first review and run the mutation sweep (docs/LESSONS.md)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-PROMPT-CHECK-2

## Deliverable
The end-of-turn rule says a note after the verdict line is ignored, which holds only for a note with no JSON in it: the reader takes the last JSON document that parses. This card fixes that wording in the prompt, the docs and the CHANGELOG, and widens the removed-instruction patterns to the phrasings the T1-OPUS55-PROMPTS reviews found missing, without letting a match cross a sentence end.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/prose.test.ts tests/surface/pre-review.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
