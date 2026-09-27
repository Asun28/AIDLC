---
id: T0-FM-COMMENT-CUT
title: Card front matter keeps a hash inside a quoted scalar, as YAML does, and cards validate reports every value a comment cuts at a hash directly followed by text (issue 97)
status: todo
branch: T0-FM-COMMENT-CUT
worktree: D:\wt\AIDLC\T0-FM-COMMENT-CUT
allow_paths:
  - src/artifacts/frontmatter.ts
  - src/artifacts/card.ts
  - tests/surface/frontmatter.test.ts
  - tests/surface/card.test.ts
  - specs/tasks/T0-PASS-REASONS-WORDING.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-FM-COMMENT-CUT.md
dod_command: npm run typecheck && node --test tests/surface/frontmatter.test.ts tests/surface/card.test.ts
dod_exit: 0
requirements:
  - R1. `stripComment` (`src/artifacts/frontmatter.ts`) shall read a comment as YAML does: a hash sign after a space or a tab starts a comment (any other blank, a non-breaking space included, is text, as in YAML), except inside a quoted scalar, which opens only where a scalar starts (the value start, or after `[`, `{` or `,` inside a flow collection) and closes at its unescaped closing quote (a backslash escapes in a double-quoted scalar, a doubled quote in a single-quoted one); a hash directly after any other character, or at the very start of the value, is text as before. `scalar`, `blockList`, the inline-list reader and the nested-key reader of `src/artifacts/card.ts` use it, and the inline-list reader splits a flow list only at a comma outside a quoted item, so a quoted value or a quoted flow-list item keeps its hash and its commas.
  - R2. `parseCardText` shall report, as `[CARD-FM-COMMENT-CUT]`, every front-matter value (a key, a nested key or a list item) the comment rule shortens where the comment begins with a hash directly followed by a non-blank character (an issue or a PR number written after the hash), naming the key or the list item and giving the full raw value and the text kept; a key is read with or without a space after its colon, as the card readers read it. It is blocking on a card that is neither `merged` nor carries `superseded_by`, and a warning otherwise. A comment of a hash, a space and text (the form the installed card template uses to annotate its keys) is not reported, and neither is a line in the body of a block scalar (`|` or `>`, with or without indicators), where YAML reads a hash as text.
  - R3. `specs/tasks/T0-PASS-REASONS-WORDING.md`, the one card that is neither merged nor superseded and that the rule cuts (its title ends "(issue" and loses the number), shall write the reference without the hash, so `aidlc cards validate` stays green on main.
  - R4. `docs/OPERATIONS.md` and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/surface/frontmatter.test.ts`: a hash inside a double-quoted or a single-quoted value, with escaped quotes (`\"`, `''`) before it, and inside a quoted item of a flow list, is kept, and a comment after the closing quote is still cut; in a plain value a space and a hash still start a comment; a hash after a non-blank character (`PR#84`, `md#45-x`) or at the value start is kept; a quote inside a plain value (`the card's`, `a "b" c`) opens nothing; a hash after a non-breaking space is kept; a flow list splits only at a comma outside a quoted item. [R1] [dod arm 1]
  - 2. `tests/surface/card.test.ts`: the three known cases of the issue (T1-PARSE-GUARD acceptance 7, T1-STORE-CAS-2 acceptance 14 and 15 as written at R2 round 1) each give one `[CARD-FM-COMMENT-CUT]` naming the acceptance item with its full raw text and its kept text; the same items quoted give none and keep the hash in the parsed acceptance. [R1] [R2] [dod arm 1]
  - 3. The same file: the finding is blocking on a `todo`, an `in-progress` and an `in-review` card and a warning on a `merged` card and on a card with `superseded_by`; a title, a nested `diagnosis` key and an inline flow-list item are each reported under their key, and so are a top-level and a nested key written without a space after the colon; a hash-space comment (the scaffold template card), the body of a literal and of a folded block scalar (a key's and a list item's), and a quoted inline item holding a comma give no finding, and that item is read whole with its hash. [R1] [R2] [dod arm 1]
  - 4. The same file: this repository's card registry loads with no blocking `[CARD-FM-COMMENT-CUT]`, and T0-PASS-REASONS-WORDING's title keeps its issue number. [R3] [dod arm 1]
  - 5. The two test files read the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section, and fail with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 440
tdd: true
diagnosis:
  root_cause: "stripComment (src/artifacts/frontmatter.ts:36) removes everything from any whitespace followed by a hash sign, and scalar, blockList, parseInlineList and extractNested apply it to every value, quoted or not; cards validate reports nothing, so a value naming an issue with a hash was cut before R2 and R3 read it (T1-PARSE-GUARD acceptance 7 in PR 78; T1-STORE-CAS-2 acceptance 14 and 15 at R2 round 1)."
  same_class: "Every reader of a front-matter value goes through stripComment (scalar, blockList, parseInlineList, extractNested), so the one rule fixes them all; the strict YAML parse (splitFrontMatter) already reads quotes as YAML does and is not used for card fields. A measurement over specs/tasks found 76 cut values in 36 cards: 45 inside quoted scalars or quoted flow-list items (kept from this card on) and 31 plain values, all of them issue or PR references (reported: a warning on the 30 merged or superseded cards' values, blocking on T0-PASS-REASONS-WORDING, fixed here). The installed card template annotates keys with a hash, a space and text, which stays an unreported comment."
sweep: "grep -rn 'stripComment' src: frontmatter.ts:36 (definition), :45 scalar, :59 blockList; card.ts:159 parseInlineList, :171 extractNested. CI runs npx aidlc cards validate (aidlc-ci.yml, docs-check.yml), which fails on any blocking finding."
forbid: [editing src/loop/card-runner.ts or any other src module, a blocking finding on a merged or superseded card, a finding for a hash-space comment, editing any card other than T0-PASS-REASONS-WORDING and this card]
non_goals: ["reading card fields from the strict YAML parse (escape processing and multi-line scalars): a larger change of every card field", "editing the merged and superseded cards the rule cuts: they are history and get a warning", "a multi-line quoted scalar: the readers read one line per value, as before", "changing how scalar and blockList read a key holding a block scalar: the report treats its body as text, as YAML does, and the readers are unchanged"]
hygiene: "Filed from issue 97 (plan finding F11). The coordinating session recommended YAML semantics and a validate report, left blocking or warning to this card with the constraint that main stays green; the hash-space exemption keeps the installed template's annotations quiet. Mutation sweep before the first review (docs/LESSONS.md 2026-09-24); every property of an acceptance item asserted on every case (docs/LESSONS.md 2026-09-26 T0-SHIP-MERGE-REFUSED); a self-test case per spelling a scanner accepts or refuses (docs/LESSONS.md 2026-09-24 T1-OPUS55-PROMPTS). R3 decision 1 blocked on four findings, repaired in REVIEW_FIX: a block-scalar body reported as a cut, a quoted inline item split at its comma, a key without a space after its colon read by the readers but not by the report, and a non-breaking space taken as comment separation."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-FM-COMMENT-CUT

## Deliverable
A card value that names an issue or a PR with a hash sign no longer reaches the reviewers cut short without a word: a quoted value keeps its hash, as YAML reads it, and `aidlc cards validate` names every plain value a reference-like comment cuts, blocking on an active card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/frontmatter.test.ts tests/surface/card.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
