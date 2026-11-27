---
id: T0-README-PLAIN
title: README.md in plain English for IT professionals, without sentences that only guard against objections, with its operator detail moved to docs/OPERATIONS.md and docs/ARCHITECTURE.md
status: todo
branch: T0-README-PLAIN
worktree: D:\wt\AIDLC\T0-README-PLAIN
allow_paths:
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - tests/surface/readme.test.ts
  - tests/surface/prose.test.ts
  - tests/surface/verifier.test.ts
  - tests/surface/removed-surface.test.ts
  - specs/tasks/T0-README-PLAIN.md
  - changelog.d/T0-README-PLAIN.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/readme.test.ts tests/surface/verifier.test.ts tests/surface/removed-surface.test.ts tests/surface/release-version.test.ts tests/surface/unattended.test.ts tests/surface/changelog-fragments.test.ts tests/infra/build-atomic.test.ts tests/infra/github-ship.test.ts tests/infra/init.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/extend-running-card.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. README.md shall follow the Design section of this card.
  - R2. README.md shall contain none of the Removed excerpts.
  - R3. Each Moved fact shall be stated at its destination, and each README link to a destination section shall resolve.
  - R4. Each statement under Corrections shall read as stated there.
  - R5. The Install and First goal sections shall reproduce a dry run on a fresh `aidlc init` repository with the default configuration, with any merge labelled simulated.
acceptance:
  - 1. tests/surface/readme.test.ts pins the opening paragraph and the How it works and Status sections whole, Status with the version read from package.json, and a test that removes each sentence in turn fails. [R1] [dod arm 3]
  - 2. tests/surface/readme.test.ts asserts each Removed excerpt absent from README.md, one assertion per excerpt, each failing on main at 359fbd14. [R2] [dod arm 3]
  - 3. tests/surface/readme.test.ts keeps one guard row per HOOK_NAMES guard with the event cell derived from the dispatch table and plain "blocks when" literals, reads the path list from docs/OPERATIONS.md Setup, asserts README_SENTENCES 2 to 4 against the docs/OPERATIONS.md sentences that state them (the quoting rule added under Hooks included), and keeps the "so no guard runs" exclusion. [R3] [dod arm 3]
  - 4. tests/surface/prose.test.ts acceptance 8 keeps its Sessions half and asserts that README.md has no Multi-session section and links docs/OPERATIONS.md#sessions; Sessions is at most 13,696 UTF-8 bytes with LF endings (reviewer-verified against 359fbd14). [R3] [dod arm 2]
  - 5. tests/surface/verifier.test.ts holds the new README audit literal and tests/surface/removed-surface.test.ts the new Lifecycle repair cycles row. [R4] [dod arm 3]
  - 6. Every Moved fact appears at its named destination. Every README section link resolves there. The README follows Design, including section order, first-use definitions, plain-English guard descriptions, Limits row order and every Correction. The moved states table and adjacent prose agree (reviewer-verified against the diff). [R1] [R3] [R4]
  - 7. The attempt's receipt shows the Install and First goal commands on a fresh `aidlc init` repository: the default configuration, the card registration, the observed pass count and the simulated ship; README.md shows those commands and outputs (reviewer-verified against the receipt). [R5]
  - 8. The release-version, unattended, build-atomic, github-ship, init, goal-card-count and extend-running-card tests are unchanged and pass, and `git diff --numstat origin/main...HEAD -- src` is empty (reviewer-verified against the diff). [dod arm 3]
  - 9. changelog.d/T0-README-PLAIN.md holds one line in the changelog.d/README.md form, and no changed file holds an em dash or corner bracket (reviewer-verified against the diff). [dod arm 2]
depends_on: []
budget: 600
tdd: true
sweep: "Main at 359fbd14. README pins: tests/surface/readme.test.ts (opening paragraph, init section, guard cells, four sentences), tests/surface/prose.test.ts:337-370 (Multi-session, LOCK), tests/surface/verifier.test.ts:473-475 (audit bullet), tests/surface/removed-surface.test.ts:22-26 (two Limits rows), tests/surface/release-version.test.ts:41-43, tests/surface/unattended.test.ts:66-80, tests/infra/build-atomic.test.ts:328-357, tests/infra/github-ship.test.ts:1278; src/state/bounds.ts:14 and docs/OPERATIONS.md:567 name the README Limits order. Pins of the edited docs: OPERATIONS Setup in tests/infra/init.test.ts:166-190 and tests/scenarios/review-resolve.test.ts:1001-1004; Hooks in tests/surface/hooks.test.ts and tests/surface/ps-guard-read.test.ts; ARCHITECTURE Module map in tests/surface/module-map.test.ts. `tests/scenarios/goal-card-count.test.ts:117-118` pins Architecture line 50. `tests/scenarios/extend-running-card.test.ts:245-258` pins part of line 52. tests/surface/outcome-clean.test.ts:69-87 requires the card of each confirmed clean case to have no successor; T1-README-SCOPE backs one, so this card leaves T1-README-SCOPE.md unchanged (owner amendment, 2026-11-27)."
forbid: [any change under src/]
non_goals:
  - "Follow-up issues instead: docs/OPERATIONS.md Sessions on review-pool locking (src/coordination/review-queue.ts:70-97), the CLAUDE.md phrase 'read-only apart from derived transitions', docs/REQUIREMENTS-TRACEABILITY.md:98"
  - "Moving the Limits table out of README.md, or changing src/state/bounds.ts"
  - "Deleting docs/PROJECT-STATE.md."
  - "Editing CHANGELOG.md"
doc_sync: README.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md
hygiene: "Planned 2026-11-27 by Claude and Codex in four rounds (_local/readme-consensus, gitignored); only items both agreed are in this card. T0-STALE-DOCS-REMOVE (todo, another goal) also edits README.md and tests/surface/removed-surface.test.ts: no dependency, and whichever card merges second syncs its base by merge."
---

# T0-README-PLAIN

## Deliverable
An IT professional learns from README.md, in plain English, what aidlc is, how it works and how to try it; operator detail lives in docs/OPERATIONS.md and docs/ARCHITECTURE.md, and no README sentence exists only to answer an objection.

## Design
Sections in order: opening; How it works; Status; Requirements; Install; First goal; What aidlc init writes; Limits; Documentation; Development; License.
- Opening, verbatim: "aidlc is a command-line tool and TypeScript library for coordinating AI coding agents in a Git repository. Give it a goal, such as fixing a bug. It tells Claude Code or another agent how to break the work into task cards and what to do next. It sets time and retry limits, tracks test results and reviews, checks the configured gates before shipping, and records the evidence for each card."
- How it works: seven one-line bullets, about 170 words, defining goal, card, directive, DoD and R3 at first use: sizing (T0-bugfix, T0, T1, T2); one directive per `aidlc next`, the outcome recorded with `aidlc report`; gates (the DoD command; R3, a review of the exact commit when the project requires one); limits (3 hours per card and 12 hours per multi-card goal by default, capped attempts, reviews and CI reruns; a STOP names the reason and the next action); sessions ("After another session takes over a card, the previous owner cannot start shipping it."); evidence (a hash-chained journal, `aidlc audit verify`); opt-in delivery (`aidlc.ops.json`).
- Status: the `Version` line; the loop is implemented and this repository ships its own pull requests through the `github` ship path; one bullet for the three ship paths with "candidate-bound verdict, base sync, push, PR"; development is the default target and the others need their commands in `aidlc.ops.json`; the `--claim-full` sentence. No scaffold qualification claim and no PROJECT-STATE link.
- Install: the aidlc checkout apart from the target repository, `npm install`, `npm link` or `node <checkout>/bin/aidlc.js`, `aidlc init`, `aidlc doctor`; init sets provider `mock` and ship path `dry-run`, and one sentence says what to set for real runs.
- First goal: the dry run of R5, defining receipt at first use and naming the operator's shipping command; `aidlc run` outside the transcript, with the provider it needs; `aidlc board --watch` in one line.
- What aidlc init writes: two sentences, links to docs/OPERATIONS.md Setup (path list) and Hooks (exact conditions), and the guard table with one plain "blocks when" clause per guard.
- Limits: the table, rows in their order, with the Corrections; the bounds paragraph in two sentences and a link. Documentation: ARCHITECTURE, OPERATIONS, DELIVERY-OPS, REVIEW.md, REQUIREMENTS-TRACEABILITY, the plan, LESSONS, CHANGELOG. Development: the pinned build line, CLAUDE.md Conventions and the ARCHITECTURE Module map.

## Removed (verbatim excerpts of README.md at 359fbd14; each excerpt is the text after `<line>: `)
- 3: aidlc is not an implementation of the AWS AI-DLC methodology
- 10: need qualification against a real repository before the loop is advertised as run-verified
- 11: a development-only goal never needs them
- 12: "Fully audited" is never assumed.
- 17: read git with `--no-lazy-fetch`, which an older git refuses
- 50: and writes nothing
- 98: A hook already in the file stays as it is and keeps running, so a repository with no hooks wired runs no guard.
- 104: with no `goals/` directory in the resolved state directory, any non-empty selected approval reference passes this lookup
- 132: `aidlc next` is read-only apart from derived transitions
- 136: Lease records are never rewritten for an identity change
- 138: A mutation is fenced against its generation; a stale writer cannot commit.
- 139: lease expiry alone does not prove the owner stopped
- 141: Quota holds are WAIT, not defects
- 159: A time STOP that `aidlc goal extend` lifted is not counted.
- 159: Records are read one at a time with no snapshot across files

## Moved (README.md line at 359fbd14 -> destination)
- 17 git probes -> docs/OPERATIONS.md:43-45, 529, 743. 24 build selection -> docs/OPERATIONS.md:344. 32 PATH detail -> docs/OPERATIONS.md:17.
- 56-96 path list -> docs/OPERATIONS.md Setup, a new text block outside the pinned adjacent sentences.
- 98 `--no-hooks` -> docs/OPERATIONS.md Setup (its `--no-hooks` sentence). 100 guard value quoting and the plain-id exception -> a new sentence under docs/OPERATIONS.md Hooks, pinned (dispatch is at line 344). 104 `goals/` tail -> docs/OPERATIONS.md:352. 113 unusable config -> docs/OPERATIONS.md:364.
- 117-130 goal states table -> a new table in docs/ARCHITECTURE.md Goal state machine; card precedence -> docs/ARCHITECTURE.md Card state precedence. 132 report results -> docs/ARCHITECTURE.md Directive contract.
- 136-141 Multi-session -> docs/OPERATIONS.md Sessions (lines 265-271) and docs/ARCHITECTURE.md: identity change, and the queue key, joining a matching request, persisted admission order and lookup before releasing a lost response's slot (src/coordination/review-queue.ts:5-8).
- 159 bounds detail -> docs/OPERATIONS.md:591, 593. 163-183 Layout -> docs/ARCHITECTURE.md Module map. 201 Conventions -> CLAUDE.md Conventions.

## Corrections
- Card directives include `pre-review` and `review` (src/loop/card-runner.ts:85-86); `aidlc board` prints text through a pipe (src/cli/main.ts:621-624); `aidlc run` needs provider `claude-code` (src/cli/main.ts:527).
- Limits: card and arc admission are defaults; explicit T1/T2 gets 12 hours even for a standalone release, otherwise a standalone release gets 3 hours and an unknown or multiple card count 12; a shorter configured limit wins (src/loop/controller.ts:185-191, src/core/deadlines.ts:30-33, 49-52). Implementation attempts: the same cause twice in a row without progress stops early (src/core/effort.ts:76-80). Lifecycle row: `| Lifecycle repair cycles | 1, specified by the plan; not enforced in code | `docs/plans/PLAN-aidlc-loop.md` |` (plan line 423; src/loop/controller.ts:781 names no number). Card workers: 2, only with disjoint paths and resources (src/loop/controller.ts:417-418).
- Goal states (docs/ARCHITECTURE.md): CARDS can hold an invalid projection; DELIVER includes migration; an extension, a ruling or a continuation can reopen the applicable STOP within its generation (src/loop/controller.ts:353-360, 503-506, 1168-1185). Correct the resume-only claim at line 89; line 52 already describes extension.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/readme.test.ts tests/surface/verifier.test.ts tests/surface/removed-surface.test.ts tests/surface/release-version.test.ts tests/surface/unattended.test.ts tests/surface/changelog-fragments.test.ts tests/infra/build-atomic.test.ts tests/infra/github-ship.test.ts tests/infra/init.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/extend-running-card.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## PR summary

### What
This change rewrites README.md in plain English for IT professionals. It removes 15 sentences that only answered objections.

### Why / Intent
The owner asked for a clear and concise README for IT professionals. Claude and Codex agreed on each change in four planning rounds.

### How / Behaviour
README.md now has an opening paragraph, How it works, Status, Install and a first-goal dry run. The init path list moves to docs/OPERATIONS.md Setup. The goal states table moves to docs/ARCHITECTURE.md with corrected rows.

### System impact
No source file changes. Only documents and the tests that pin their text change.

### Security
No security effect. The README guard table still lists every guard, and docs/OPERATIONS.md Hooks keeps the exact conditions.

### Tests and review
tests/surface/readme.test.ts pins the new README parts and checks that each removed sentence is absent. The new tests failed on the old README at commit 5c00cc9b and pass now. R3 reviews the candidate before ship.

### Risk
Low. A reader who looks for a moved fact finds a link to its new place.

### Ownership
The aidlc maintainers own README.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md.

### Docs
README.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md and changelog.d/T0-README-PLAIN.md change.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | tests/surface/readme.test.ts, `T0-README-PLAIN acceptance 1` | pass |
| 2 | tests/surface/readme.test.ts, `T0-README-PLAIN acceptance 2` and `2.1` to `2.15`, one test per excerpt; with README.md of 359fbd14 all 15 fail (15 fail, 0 pass), first RED at 5c00cc9b | pass |
| 3 | tests/surface/readme.test.ts, `T1-INIT-SURFACE acceptance 2`, `3` and `6`, with the dispatch facts of docs/OPERATIONS.md Hooks pinned (R3 decision 1, F2) | pass |
| 4 | tests/surface/prose.test.ts, `acceptance 8`; docs/OPERATIONS.md Sessions unchanged at 13,696 bytes | pass |
| 5 | tests/surface/verifier.test.ts, `T1-AUDIT-FACTS acceptance 8`; tests/surface/removed-surface.test.ts, `T1-SWEEP-DEAD-CODE acceptance 3`; the other Limits rows against src/core/deadlines.ts:30-33 and 49-52, src/core/effort.ts:76-80 and src/loop/controller.ts:185-191 and 417-418 | pass; reviewer check |
| 6 | Moved facts in the candidate: docs/OPERATIONS.md:87-89, 577 and 791 (git), 388 (build selection), 61 (PATH), 15 (`--no-hooks`), 17-59 (path list), 405 (guard quoting), 396 (`goals/` tail), 415 (unusable config), 307 (Sessions), 639 and 641 (bounds), 615 (Limits order); docs/ARCHITECTURE.md:91-102 (states table), 104 (resume sentence), 18 (review queue, its own paragraph: tests/scenarios/review-admit-strand.test.ts:205-226 pins the sentence before line 16's T0-REVIEW-ADMIT-STRAND sentence), 14 (identity change), 153 (card precedence), 187 (report results), 8 (Module map). README links: #sessions, #setup, #hooks, #running-a-goal, #watching-a-goal, #bound-statistics, #module-map | reviewer check |
| 7 | Dry run on a fresh `aidlc init` repository (below) | done |
| 8 | DoD arm 3; `git diff --numstat origin/main...HEAD -- src` is empty | pass |
| 9 | changelog.d/T0-README-PLAIN.md (one line); no em dash or corner bracket in the changed files (owner amendment, revision 1, dropped the `superseded_by` item: tests/surface/outcome-clean.test.ts:69-87) | pass |

Dry run (item 7), 2026-11-27, on a new repository with one commit and a bare `origin`:
- `aidlc init`: provider `mock`, ship path `dry-run`, `formalReview.command` empty; `aidlc doctor` reported `provider: mock: ok`.
- `aidlc goal new "fix the crash when a claim has no adjuster" --bug-evidence`: size T0-bugfix, directive `plan`.
- Card T0-CLAIM-NO-ADJUSTER written, `aidlc cards validate` ok, committed and pushed; `aidlc report --result cards-projected` returned `run-card`.
- `aidlc card next`: `prepare` (the `git worktree add` command), then `build`.
- RED commit 880f684: `a claim with no adjuster has no adjuster name` failed (2 tests, 1 pass, 1 fail).
- DoD: `node --test tests/claims.test.mjs: exit 0, 2 pass, 0 fail`; `aidlc card attempt --outcome success` recorded.
- `aidlc card next`: the dry-run ship recorded a merge operation `succeeded` and returned `close`; `main` stayed at the card commit (simulated merge).
- `aidlc card close --all`, then `--skip-lesson`: card `done`; `aidlc next`: `verify-arc`; `aidlc report --result arc-verified`: goal `done`.
