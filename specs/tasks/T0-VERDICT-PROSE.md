---
id: T0-VERDICT-PROSE
title: An unterminated JSON-looking opener in the reviewer's prose voids the complete verdict document that follows it; only a text that completes into valid JSON is a document cut short
status: todo
branch: T0-VERDICT-PROSE
worktree: C:\wt\T0-VERDICT-PROSE
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/pre-review.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-VERDICT-PROSE.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the reviewer output carries a JSON-looking opener that never closes, the extractor shall decide what it is by completion: the text from that opener to the end, with its open string closed, the separator or the key the cut left dangling resolved and every open container closed, either parses as JSON, in which case it is a document cut short and the output is malformed, or it does not, in which case it opened no document and the scan resumes at the character after the opener.
  - R1b. WHERE such an opener is prose, the output shall still be malformed unless a parseable top-level document begins after it, so a final document corrupt in its interior is never answered by a draft earlier in the reasoning.
  - R2. WHERE prose that opens like JSON precedes a complete top-level document, that document shall decide the verdict, as it does when the prose carries no opener at all.
  - R3. The truncated-output rules shall be unchanged: an unfinished document that follows the last parseable one, an unfinished enclosing array, a final lone opener with only whitespace after it, and a final document that does not parse each make the output malformed, and no earlier draft ever stands in for the decisive document.
acceptance:
  - 1. `extractVerdict` returns the final `pass` of the captured failure shape: prose quoting an unterminated fragment (a backtick-quoted `{"item"` followed by more prose) and then a well-formed verdict document as the last line; the same output with the fragment removed already returns it, so the fragment is the only difference (pre-review.test.ts). [R1] [R2] [dod arm 1]
  - 2. Every pre-change extraction case keeps its result, asserted in one list (a corrupt final document among them, which is malformed because no parseable document begins after it): an unfinished enclosing array (`[{"verdict":"pass","reasons":[]}`), a final lone `{`, a final `{` with trailing whitespace, a truncated trailing document after a complete one, a final document that does not parse, a block cut short after a nested axis, and a draft before the decisive document (pre-review.test.ts). [R1b] [R3] [dod arm 1]
  - 3. The completion predicate is exercised through `extractVerdict` at both edges: an opener whose remainder cannot complete (a key followed by `/`, an unquoted word after a closed value, prose between the opener and a later document) opens nothing and the later document decides; an opener whose remainder completes once its open string and its open containers are closed (a cut-short object, one cut short after a nested axis, an unfinished enclosing array, a reason string cut at the end of the output, with or without a trailing newline) is a document cut short and the output is malformed, whatever parseable document precedes it. [R1] [R3] [dod arm 1]
  - 4. `docs/OPERATIONS.md` states the completion rule where it states the extraction rule today (the `command` paragraph of Pre-review (R2)), and CHANGELOG.md Unreleased carries the entry (read in review; no test arm). [dod arm 1]
depends_on: []
budget: 180
tdd: true
sweep: "grep -rn 'topLevelDocuments\\|extractVerdict' src/ tests/: the walker, its one caller in the same module, and the prose in docs/OPERATIONS.md that states the rule the walker applies"
forbid: [a change to the verdict schema or the classification, a change to the R3 stage, a reviewer prompt change, a new dependency]
non_goals: [detectQuotaHold matching a quota word in reviewer prose (the second defect of this incident), parsing a verdict out of a document that is genuinely cut short, accepting a draft earlier in the reasoning]
diagnosis:
  root_cause: "`topLevelDocuments` (src/review/pre-review.ts) treats every character after a JSON-looking opener that never closes as being inside that document, and `extractVerdict` returns undefined whenever such an opener exists, so a reviewer that quotes a JSON contract or a test literal in its prose loses the complete verdict document it printed on its last line. The rule was written for a truncated tail (T1-REVIEW-FINDINGS-3 and -4: a block cut short after a nested axis must not be read from its last axis) and cannot tell a cut-short document from prose that merely opens like one. Reproduced deterministically: extractVerdict of the two-line output `The docs line is `+'`'+`\"coverage\":[{\"item\"/`+'`'+` which matches.` followed by `{\"verdict\":\"pass\",\"reasons\":[]}` returns undefined, and returns the pass once the fragment is removed."
  same_class: "`extractVerdict` is the only caller of the walker, and the only reader of its result is `finalizeReview`, so the walker is the single site. The incident has a second, separate defect: with no verdict, `classifyPreReview` falls through to `detectQuotaHold` over the raw output, whose /quota/i pattern matches a reviewer's prose about this repository's own quota-hold code, so three rounds were recorded as quota holds (WAIT, no round consumed, no retry consumed) instead of no-verdicts that would have consumed the retry and stopped the card. That is out of scope here and carries its own card; this fix removes the cause that produced the unusable output in the first place."
  evidence: ".review/T1-REVIEW-COVERAGE.pre.0.1.1.fd16e683.*.log, .pre.0.1.2.392de0bf.*.log and .pre.0.1.3.bd0c7e39.*.log in C:\\wt\\T1-REVIEW-COVERAGE: nine angle runs over three rounds, every one ending with a well-formed verdict document, seven of them extracted as undefined; the unterminated openers are at ac-coverage line 607 (`{\"item\"/`) and edge-cases line 998 (`{\"verdict\"'))!;`)."
doc_sync: docs/OPERATIONS.md (Pre-review (R2), the extraction rule), CHANGELOG.md
---

# T0-VERDICT-PROSE

## Deliverable
The R2 and R3 stages read the verdict as the last top-level JSON document of the reviewer's whole output. Since T1-REVIEW-FINDINGS-4 an opener that never closes makes the entire output malformed, so that a document cut short is never read from a nested part of itself. A reviewer that quotes a JSON contract in its reasoning, which every review of the review system does, trips the same rule: the quoted fragment opens a document that never closes, the complete verdict on the last line is swallowed by it, and the round is recorded with no verdict. This card keeps the truncation rule and separates the two cases by completion: the text from an unterminated opener to the end is a document cut short when closing its open string and its open containers yields valid JSON, and is prose otherwise, in which case the opener starts nothing and the scan continues after it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts
```
- Expected exit code: 0
- Assertion: the extraction tests pass, including the captured prose-opener shape, every pre-change truncation case and both edges of the completion predicate.
