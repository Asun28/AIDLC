---
id: T1-R3-SUPPORTED-FINDINGS
title: The R3 prompt, REVIEW.md and the reviewer agent drop the instructions to disprove the change, to block when uncertain and to be exhaustive, and state a finding standard by which a finding blocks only when it cites a file and line and states an observable failure, a stated card item it breaks or a hard boundary it breaches; reviewPolicyVersion becomes REVIEW.md@7
status: todo
branch: T1-R3-SUPPORTED-FINDINGS
worktree: D:\wt\AIDLC\T1-R3-SUPPORTED-FINDINGS
plan_ref: plans/loop-evidence.md#order-of-work
allow_paths:
  - src/review/pre-review.ts
  - REVIEW.md
  - templates/REVIEW.md
  - .claude/agents/reviewer.md
  - templates/claude/agents/reviewer.md
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/surface/pre-review.test.ts
  - tests/surface/templates.test.ts
  - docs/OPERATIONS.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/edge-scope.test.ts tests/surface/lesson-match.test.ts tests/surface/config.test.ts
dod_exit: 0
requirements:
  - R1. In `buildReviewPrompt` (src/review/pre-review.ts, the formal branch of the opening line, :402 at 5b9fa3fc) the text from `Default to skepticism:` through `Every finding needs file:line, why it fails and a concrete fix.` shall be replaced by the text NOW of Acceptance detail 1. No other prompt-builder text changes: the pre-review (R2) opening, `PERSPECTIVES`, the coverage lines and every other line the builder writes stay byte for byte; the embedded policy and its hash in the policy heading (:426) change with REVIEW.md, in R2 and R3 prompts alike.
  - R2. Both REVIEW.md copies shall gain the six lines of Acceptance detail 2 directly after the line that begins `17. Bugfix root cause` and the blank line under it, followed by one blank line, so `## What Important means here` comes next; and the three lines of `## Verdict budget` from the one that begins `Never pad:` shall be the three lines of Acceptance detail 3. No other line changes and the two copies stay byte-identical.
  - R3. Both reviewer agent copies (.claude/agents/reviewer.md, templates/claude/agents/reviewer.md) shall replace procedure step 1 (one line) and step 3 (two lines) with the lines of Acceptance detail 4. No other line changes; the two copies stay byte-identical and ASCII.
  - R4. `reviewPolicyVersion` shall be `REVIEW.md@7` in aidlc.config.json and templates/aidlc.config.json, with no other key changed, and the sentence of docs/OPERATIONS.md that names the current version (:363 at 5b9fa3fc) shall read as Acceptance detail 5. No other line of docs/OPERATIONS.md changes.
  - R5. tests/surface/templates.test.ts shall pin `REVIEW.md@7` as the current version at every place Acceptance detail 6 lists, keep every earlier move and add the move to @7, and gain the tests of acceptance 2 and 3. tests/surface/pre-review.test.ts shall gain the constant and the first call of `withoutAddedSentences` of Acceptance detail 1 and the tests of acceptance 1 and 7. No other assertion of either file changes, and the six `PRE_CHANGE` hashes stay.
  - R6. In every formal prompt, a single pass or any angle of `PERSPECTIVES`, with either REVIEW.md copy as its policy, the reviewer instructions the builder writes from its own text and the applied policy as embedded shall not match `actively try to disprove`, `when uncertain` or `be exhaustive` in any letter case once every run of white space is folded to one space, so a phrase wrapped over a line break or written with a CRLF counts. The card contract, the diff, the delta, prior findings, learned invariants, advisory notes and surviving mutants are quoted evidence: a phrase they quote reaches the prompt unchanged.
  - R7. Before SHIP, a full-set reviewer bench run of the candidate shall be compared with `run`, the raw full-set report of main's reviewer inside `bench/outcome/replay-main.json` (T1-OUTCOME-REPLAY), and the owner shall decide acceptance 6 on that comparison (spec R5). The per-case trial reports under `trials` of that file are not part of this comparison.
acceptance:
  - 1. tests/surface/pre-review.test.ts "T1-R3-SUPPORTED-FINDINGS acceptance 1, every formal prompt states the finding standard and none of the three phrases, with either REVIEW.md copy as its policy". Its card is `fixtureCard()`, whose text quotes none of the phrases, so the whole prompt is the measure. Fails on main by assertion (the opening lacks NOW; REVIEW.md holds `when uncertain`). [R1] [R2] [R6] [dod arm 1] Detail item 1.
  - 2. tests/surface/templates.test.ts "T1-R3-SUPPORTED-FINDINGS acceptance 2, both REVIEW.md copies hold the finding standard before the Important section and the new Never pad lines". Fails on main by assertion. [R2] [dod arm 1] Detail items 2 and 3.
  - 3. Same file, "T1-R3-SUPPORTED-FINDINGS acceptance 3, both reviewer agents carry steps 1 and 3 of the finding standard and neither old step". Fails on main by assertion. [R3] [dod arm 1] Detail item 4.
  - 4. Same file, the pins of Acceptance detail 6 read `REVIEW.md@7` and the history test carries the move to @7. Each fails on main by assertion (both configs give `REVIEW.md@6`; OPERATIONS.md names @6 as current). [R4] [R5] [dod arm 1] Detail items 5 and 6.
  - 5. The hash-pin test "T1-REVIEW-COVERAGE R3 decision 1 (F2)" of tests/surface/pre-review.test.ts passes on main and with this card with its six hashes unchanged, and tests/surface/mirror.test.ts, prose.test.ts, r2-pass-notes.test.ts, edge-scope.test.ts, lesson-match.test.ts and config.test.ts pass unchanged. [R1] [R2] [R3] [R5] [dod arm 1]
  - 6. Manual, decided by the owner before SHIP. The bench comparison of Acceptance detail 7 qualifies. [R7]
  - 7. tests/surface/pre-review.test.ts "T1-R3-SUPPORTED-FINDINGS acceptance 7, a card and a diff that quote the three phrases reach the formal prompt unchanged". REVIEW.md as policy, `includeDiff: true`, `fixtureCard()` with the title `quotes actively try to disprove, when uncertain, block and be exhaustive`, one more acceptance item `2. the old prompt said be exhaustive. [dod arm 1]` and the diff `+// when uncertain, block` and one LF; for each perspective as in acceptance 1 the prompt has the line `- title: ` plus the title, the line of that item indented by two spaces and the diff line, and its first line and its text from `## Review policy` up to `## Learned invariants`, folded, match none of the three patterns. Fails on main by assertion (the first line holds the phrases). [R6] [dod arm 1]
depends_on: [T1-DOD-RECORD-2]
budget: 200
tdd: true
sweep: "On main at 5b9fa3fc. `git grep -n -i -E 'disprove|uncertain|exhaust' -- src tests templates .claude REVIEW.md docs` finds the instructions only at src/review/pre-review.ts:402, REVIEW.md:79-80, templates/REVIEW.md:79-80 and both reviewer.md copies at :13 and :17-18; the other hits describe the single R3 pass or are unrelated (docs/OPERATIONS.md:383, src/loop/card-runner.ts:2035 and tests/scenarios/t0-flow.test.ts:648 comments, the effort `uncertainty` field, arc.md:19) and stay. Pins of the formal opening: tests/surface/pre-review.test.ts:240 (`every material finding`, `do not stop`; NOW keeps both), :884 (`DECISIONS_CLAUSE.now`; NOW keeps it), :863-892 (`PRE_CHANGE` hashes through `withoutAddedSentences`, :1155-1157), :1182 (`EVERY_FINDING` absent from R3). Pins of REVIEW.md: tests/surface/templates.test.ts:163-172 (`## Verdict budget`, `fewer verified findings`; kept), :196-202, :549-565, :666-676 (config version), :567-571, :679-695, :738-750 (OPERATIONS version sentence and history), :698-766 (Impact bar and axes; untouched since the new section sits before `## What Important means here`); tests/surface/mirror.test.ts:72; tests/surface/prose.test.ts:264-284 (removed instructions over REVIEW.md, agents and prompts) and :291-293 (reviewer step 8, unchanged); tests/surface/r2-pass-notes.test.ts:113-135 (output contract, unchanged). The reviewer agent copies are pinned by templates.test.ts:55-65, :159-160 and :556-561 (step 9 after step 8) and prose.test.ts:292, none on step 1 or 3. Only docs/OPERATIONS.md:363 names REVIEW.md@6 as current; stats.test.ts and scenario fixtures use older versions as data. Ten paths, two over the cap of 8: REVIEW.md, the reviewer agent and the config are each a pair kept identical or in step (mirror.test.ts, templates.test.ts:196-202), templates.test.ts pins the version of both configs and of the OPERATIONS sentence, and docs/OPERATIONS.md:363 must say @7 in the same commit or templates.test.ts fails (brief rule 3; the docs card is T1-EVIDENCE-DOCS). The fallback R3 (claude -p) receives the built prompt, not the agent file, so the agent change affects only interactive reviews."
forbid:
  - weakening, skipping or deleting a test to go green, or changing an assertion other than those R5 names
  - changing a `PRE_CHANGE` hash, the R2 opening line, `PERSPECTIVES`, `CLASS_LINE`, `PRE_EXISTING_LINE` or any text `buildReviewPrompt` writes other than the segment of R1
  - filtering, rewording or dropping a phrase that quoted evidence (card, diff, delta, findings, lessons, notes, mutants) carries
  - changing a dimension, the Impact bar, Untrusted content or the output contract of REVIEW.md, or any line of it other than those of R2
  - changing src/core/review-policy.ts, `ADVISORY_TAG`, `classifyVerdict` or any code that decides whether a reason blocks
  - a change to CHANGELOG.md, docs/ARCHITECTURE.md or any line of docs/OPERATIONS.md other than the sentence of R4
  - running an aidlc command of this card's run with the candidate's code, other than the bench candidate arm of acceptance 6
non_goals:
  - a code check that a block reason meets the standard; the classification of a reason stays as it is
  - an `[unstated]` tag, the delta rule, a dimension filter, a two-decision cap, removing the second pass, the card contract pin (spec non-goals)
  - the fallback policy text that `CardRunner.reviewPolicy` uses when REVIEW.md is missing (src/loop/card-runner.ts:322-327); the prompt carries the standard itself
  - a downstream repository's REVIEW.md, which `aidlc init` never overwrites
  - records and queue requests written under REVIEW.md@6; no migration, and a pass recorded under an earlier version stays valid for its candidate only
  - the CHANGELOG entry and the OPERATIONS and ARCHITECTURE text on the standard (T1-EVIDENCE-DOCS)
  - the sentences that call the single R3 pass exhaustive (docs/OPERATIONS.md:383, a comment in card-runner.ts:2035); they say R3 is never fanned out, which stays true
hygiene: "Start only after T1-OUTCOME-REPLAY (goal reliability-baseline-2) has merged and bench/outcome/replay-main.json is on main; acceptance 6 compares against it. That card is in another goal, so the order is kept by the coordinator, not by depends_on. Line numbers are from main at 5b9fa3fc, after T0-RELEASE-0-2-0 merged (it changed the CHANGELOG slices of both test files and the version in five places, none a line this card changes or pins); find each place by its content at PREPARE. OWNER TEXT: the owner approves Acceptance detail 1 to 5 word for word before the run starts; the coordinator retains the approval (`aidlc evidence retain --card T1-R3-SUPPORTED-FINDINGS --kind owner-approval`) before PREPARE, and a changed text is a replacement card. GATE-CHANGE DELIVERY: this card changes the gate that reviews it. Every aidlc command of its run (card next, card attempt, review r3, evidence retain, review bench compare, card close) is run from the clean main checkout as `node D:\\Projects\\AIDLC\\bin\\aidlc.js`, so main's code, aidlc.config.json and REVIEW.md review the card until it merges. The one command run with the candidate's code is the bench candidate arm of acceptance 6, `node bin/aidlc.js review bench run` in the card worktree, which reads no goal state and writes nothing under the state directory (src/cli/main.ts, the `bench run` action). At PREPARE the coordinator retains as `r3-gate-prepare` (kind `gate-delivery`): `git -C D:\\Projects\\AIDLC rev-parse HEAD`; the empty output of `git -C D:\\Projects\\AIDLC status --porcelain --untracked-files=no`; the sha256 of REVIEW.md and of aidlc.config.json in the main checkout (`Get-FileHash -Algorithm SHA256`); and the `target=` line that `AIDLC_ENTRY_DEBUG=1` prints, which names the main checkout's src/cli/main.ts (a dist/ target stops the run for the owner, since a build of another commit would review the card). Before SHIP it runs `git -C D:\\Projects\\AIDLC fetch origin main` and retains the same values as `r3-gate-ship` with `git rev-parse origin/main`: each equals its PREPARE value, origin/main equals the PREPARE commit, and every R3 invocation of the run records that REVIEW.md sha256 as `policyHash` and `REVIEW.md@6` as `policyVersion` (`aidlc card status`). No other card ships between this card's first `card attempt` and its SHIP. Any difference stops the run before SHIP for the owner. TDD: tests first in two commits. Commit 1: in pre-review.test.ts the constant, the first call of `withoutAddedSentences` and the tests of acceptance 1 and 7; in templates.test.ts the changes of Acceptance detail 6 and the tests of acceptance 2 and 3; record acceptance 1 to 4 and 7 failing by assertion and acceptance 5 passing. Commit 2: the text of R1 to R4. A typecheck failure or a missing import is not RED evidence. Revert table before the first R3, each a scratch change restored afterwards: NOW set back to BEFORE (acceptance 1 and 7 fail, acceptance 5 passes); a builder change that removes the phrases from quoted card text (acceptance 7); one REVIEW.md copy reverted (mirror.test.ts and acceptance 2); the section placed after `## What Important means here` (acceptance 2); the old Never pad lines put back (acceptance 1 and 2); `when uncertain` written across a line break in REVIEW.md (acceptance 1); one agent copy's step 3 reverted (mirror.test.ts and acceptance 3); either config at @6 (acceptance 4); the OPERATIONS sentence at @6 (acceptance 4). BENCH: `bench/outcome/replay-main.json` is a wrapper (`commit`, `policyHash`, `run`, `trials`, `leftOut`), not a report `bench compare` reads (rule (a) of src/review/bench.ts:615), so the value of its `run` key, the raw one-trial report over evals/review/replay/, is written unchanged as JSON to D:\\Projects\\AIDLC\\_local\\loop-evidence\\replay-main-run.json by a script file kept outside the worktree. Run the candidate arm once, on a candidate whose src/review/pre-review.ts, REVIEW.md and aidlc.config.json carry the text of R1, R2 and R4, in the card worktree in Git Bash: `node bin/aidlc.js review bench run --stage formal --dir evals/review/replay --rules <the rules of run> --trials 1 --json`, its output saved as D:\\Projects\\AIDLC\\_local\\loop-evidence\\candidate-run.json outside the worktree with the sha256 of those three files; run `review bench compare` of the two files from the main checkout (with one trial each it answers inconclusive, which detail 7 allows), and retain the three files with `--card T1-R3-SUPPORTED-FINDINGS`. A rerun of the arm or of a case needs the owner's word; stop and report at the goal's spend ceiling (intent, Constraints). Before the first review the coordinator runs every test file that reads REVIEW.md, the reviewer agents, both configs or docs/OPERATIONS.md and records the counts; the full suite runs in CI."
doc_sync: REVIEW.md, templates/REVIEW.md, .claude/agents/reviewer.md, templates/claude/agents/reviewer.md, docs/OPERATIONS.md (the version sentence only; the rest goes to T1-EVIDENCE-DOCS)
---

# T1-R3-SUPPORTED-FINDINGS

## Deliverable
The formal (R3) prompt, both REVIEW.md copies and both reviewer agent copies no longer tell the reviewer to actively try to disprove the change, to block when uncertain or to be exhaustive. They state one finding standard: a finding blocks only when it cites a file and line of the candidate and states an observable failure, the stated requirement, acceptance item, `non_goals` entry or `forbid:` item it breaks, or the hard boundary it breaches; any other finding is reported under a `[question]` or `[suggestion]` tag, which `ADVISORY_TAG` (src/core/review-policy.ts:261 at 5b9fa3fc) already makes advisory in both stages. `reviewPolicyVersion` is `REVIEW.md@7`. The card ships only after the owner has decided the bench comparison against main's reviewer.

## Why
Intent loop-evidence, outcome 4; spec R4 and R5. The first formal R3 decision blocked 161 of 292 card runs, and the prompt asks for blocks on uncertainty. The panel (synthesis, agreed after round 2) replaced the three phrases with supported findings, kept the hard boundaries, and required a bench result of main against the candidate before SHIP and the owner's approval of the exact text before the run starts.

The owner approved the text of Acceptance detail 1 to 5 word for word on 2026-11-14, and the 10 allowed paths as an exception to the 8-path rule of intent/loop-evidence.md.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/r2-pass-notes.test.ts tests/surface/edge-scope.test.ts tests/surface/lesson-match.test.ts tests/surface/config.test.ts
```
- Expected exit code: 0
- Assertion: acceptance 1 to 5 and 7 pass. Acceptance 6 is the owner's decision, retained in the goal evidence before SHIP.

## Acceptance detail

### 1. The formal prompt
BEFORE, the text R1 replaces (one line of src/review/pre-review.ts at e6566c68):

`Default to skepticism: actively try to disprove the change against this card and the review policy below. Must-block dimensions 1-6 block on first hit; when uncertain, block; do not self-excuse. Be exhaustive in this single pass: check every hunk of the diff and report every material finding you can defend (must-block, or Important: breaks behaviour, leaks data, breaches a policy). Do not stop after the first few findings; a finding left out costs a repair round and a decision. Every finding needs file:line, why it fails and a concrete fix.`

NOW:

`Judge the change against this card and the review policy below. Check every hunk of the diff in this single pass and report every material finding you can support (must-block, or Important: breaks behaviour, leaks data, breaches a policy). Do not stop after the first few findings; a finding left out costs a repair round and a decision. A finding blocks only when it cites a file and line of the candidate and states one of: an observable failure (the input, then the wrong result or the crash it gives); the stated requirement, acceptance item, non_goals entry or forbid item it breaks; the hard boundary it breaches (a changed path outside allow_paths, dimension 2 or 3, a security gap or data loss). A block reason also names a concrete fix. Any other finding is reported under a [question] or [suggestion] tag and does not block.`

tests/surface/pre-review.test.ts gains, beside `DECISIONS_CLAUSE`, `const R3_STANDARD = { now: <NOW>, before: <BEFORE> }` with a one-line doc comment, and `withoutAddedSentences` gains `.replace(R3_STANDARD.now, R3_STANDARD.before)` as its first call (before the `DECISIONS_CLAUSE` call, since both texts hold that clause); its doc comment names the card. The test of acceptance 1 reads REVIEW.md and templates/REVIEW.md; for each as `reviewPolicy` and for each perspective of `[undefined, ...Object.keys(PERSPECTIVES)]` it builds the formal prompt of `fixtureCard()` (base `main`, head `def456`, round 1 of 2, `includeDiff: true`) and asserts that its first line includes NOW and not `Default to skepticism`, and that the prompt with every white-space run folded to one space matches none of `/actively try to disprove/i`, `/when uncertain/i`, `/be exhaustive/i`.

### 2. REVIEW.md, the finding standard
Six lines, inserted after `17. Bugfix root cause, not symptom (...)` and its blank line, then one blank line before `## What Important means here`:

```text
## Finding standard
A finding blocks only when it cites a file and line of the candidate and states one of:
- an observable failure: the input, then the wrong result or the crash it gives;
- the stated requirement, acceptance item, `non_goals` entry or `forbid:` item it breaks;
- the hard boundary it breaches: a changed path outside `allow_paths` (dimension 1), dimension 2 or 3, a security gap (injection, an authentication or authorization gap, a secret or PII in the diff or in a log) or data loss.
Any other finding, on any dimension, is reported under a `[question]` or `[suggestion]` tag and does not block.
```

The test of acceptance 2 reads each copy with CRLF folded to LF: `## Finding standard` is one line; the six lines from it deep-equal the block above; the line before it is empty and the one before that starts with `17. Bugfix root cause`; the line after the block is empty and the next is `## What Important means here`.

### 3. REVIEW.md, Verdict budget
The section's lines deep-equal, with `## Output contract` after its blank line:

```text
## Verdict budget
Write the verdict before the turn or time budget ends, never on the
last turn; a verdict with fewer verified findings beats no verdict.
Never pad: a finding that does not meet the finding standard is
investigated until it does, reported under a `[question]` tag or
dropped, never padded into a nit.
```

### 4. The reviewer agent
Step 1 becomes one line and step 3 five lines, in both copies:

```text
1. Judge only this diff against this card. Check every hunk in one pass.
3. A finding blocks only under the finding standard of REVIEW.md: it
   cites a file and line and states an observable failure (input, then
   wrong result or crash), the stated requirement, acceptance item,
   non_goals entry or forbid item it breaks, or the hard boundary it
   breaches. Tag any other finding `[question]` or `[suggestion]`.
```

The test of acceptance 3, for each copy with white space folded: the text includes both steps as folded; the steps come in the order 1, 2 (`2. Two axes`), 3, 4 (`4. Cap nits`); it matches none of `/exhaust/i`, `/uncertain/i`, `/disprove/i`.

### 5. Version
Both configs: `"reviewPolicyVersion": "REVIEW.md@7"`. In docs/OPERATIONS.md:363 the sentence that begins `` `reviewPolicyVersion` is `REVIEW.md@6` in both configs`` becomes:

"`reviewPolicyVersion` is `REVIEW.md@7` in both configs (card T1-R3-SUPPORTED-FINDINGS added the finding standard; T0-REVIEW-IMPACT-BAR moved it to `REVIEW.md@6` with the impact bar; T1-REVIEW-PRE-EXISTING moved it to `REVIEW.md@5` with the `[pre-existing]` tag; T1-REVIEW-CLASS-SWEEP to `REVIEW.md@4` with the class tag, T1-REVIEW-INPUTS to `REVIEW.md@3`); a pass recorded under an earlier version stays valid for its candidate only."

### 6. tests/surface/templates.test.ts (lines at 5b9fa3fc)
| Lines | Change |
|---|---|
| 202, 563, 675 | `'REVIEW.md@6'` becomes `'REVIEW.md@7'` (config pins) |
| 571, 683, 694 | `` '`reviewPolicyVersion` is `REVIEW.md@6` in both configs' `` becomes `@7` |
| 740-744 | `HISTORY`: the first element becomes `'(card T1-R3-SUPPORTED-FINDINGS added the finding standard;'`, followed by the new element `` ' T0-REVIEW-IMPACT-BAR moved it to `REVIEW.md@6` with the impact bar;' ``; the other three stay |
| 746, 749 | `holds` reads `@7`; the not-current check reads `` '`reviewPolicyVersion` is `REVIEW.md@6`' `` |
| 196, 567, 666, 738 | the test names say `REVIEW.md@7` where they say `REVIEW.md@6` as current, and :738 says `names @6 as current nowhere` |
| end of file | a new `describe` with the tests of acceptance 2 and 3 |

Lines 538, 543, 644, 656 and 715 record earlier moves and stay.

### 7. The bench comparison (acceptance 6)
The baseline is `run` of `bench/outcome/replay-main.json`, extracted to `_local/loop-evidence/replay-main-run.json` (hygiene, BENCH); the candidate is one full-set run over evals/review/replay/ with the same `--rules` and `--trials 1`. Each has one trial, so its `summary` medians are the values of that trial. The three-trial reports of ten cases under `trials` are not read for this item.

| Measure | Read from the baseline and the candidate report | Qualifies when |
|---|---|---|
| False-block rate on clean cases | `summary.falseBlockRate.median` | candidate is at most half of the baseline; with a baseline of 0 the candidate must be 0 (owner, 2026-11-14); a baseline of null goes to the owner |
| Recall | `summary.recall.median` | candidate is at least the baseline less 0.05 |
| Dimensions 1 to 3 | each bug case whose finding is on dimension 1, 2 or 3: the number after the axis tag of the reason its `note` quotes (a replay bug case keeps the `note` of its export draft, T1-OUTCOME-REPLAY R5) | no such case is `hit` in the baseline and `miss` in the candidate |
| No verdict, errors | `summary.noVerdict`, `summary.errors` and the cases behind them | listed for the owner, who decides whether a case is rerun |
| `bench compare` | its output line | recorded; it does not decide the item |

Different case ids in the two reports (compare names them) mean the arm ran with other options; it is rerun only on the owner's word.
