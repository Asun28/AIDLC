---
id: T0-CARD-SHORT
title: The card template asks for short cards on small changes and reviewer-checked doc text, a lesson supersedes T1-OPUS55-MODELS, and stale claims in README.md, docs/PROJECT-STATE.md and REVIEW.md are corrected
status: todo
branch: T0-CARD-SHORT
worktree: D:\wt\AIDLC\T0-CARD-SHORT
allow_paths:
  - templates/cards/_TEMPLATE.md
  - specs/tasks/_TEMPLATE.md
  - docs/LESSONS.md
  - docs/OPERATIONS.md
  - docs/PROJECT-STATE.md
  - README.md
  - REVIEW.md
  - templates/REVIEW.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-SHORT.md
dod_command: npm run typecheck && node --test tests/surface/mirror.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/card.test.ts
dod_exit: 0
requirements:
  - R1. Both card templates shall state, in comments under `acceptance:`, that a change of 30 src lines or fewer gets a card of about 400 words or fewer, and that doc text is proved with `(reviewer-verified against the diff)` unless a program reads that exact text.
  - R2. `docs/LESSONS.md` shall gain one line that names T1-OPUS55-MODELS as superseded and gives the reason, the R2 ac-coverage angle no longer running here.
  - R3. `README.md` shall state no test count and shall describe `docs/PROJECT-STATE.md` as a snapshot of 2026-09-18, and that file shall say so under its title.
  - R4. `REVIEW.md` and `templates/REVIEW.md` shall replace the sentence on who approves with the text under Deliverable, and `reviewPolicyVersion` shall stay `REVIEW.md@6`.
  - R5. `docs/OPERATIONS.md` shall name the `main required checks` ruleset, its four checks and the repository admin bypass, and shall state that the bypass also covers a PR merge forced with this token.
  - R6. The CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. The dod_command passes with no test changed. [R1] [R4] [dod arm 2]
  - 2. Each of R1 to R6 holds in the diff (reviewer-verified against the diff). [R1] [R2] [R3] [R4] [R5] [R6]
depends_on: []
budget: 80
tdd: false
sweep: "git grep -n -E '413 tests|code owner|PROJECT-STATE' -- . ':!specs' ':!CHANGELOG.md' ':!docs/plans' on main at 6f1cb58 finds README.md:9, README.md:181, REVIEW.md:4 and templates/REVIEW.md:4. No test pins these sentences. The two card templates differ only on the worktree line."
forbid:
  - changing a rule, dimension or the impact bar in `REVIEW.md`, or `reviewPolicyVersion`
  - a gate or lint on card length or doc pins
  - deleting or weakening an existing test
non_goals:
  - removing the doc pins of merged cards
  - refreshing the tables of `docs/PROJECT-STATE.md`
hygiene: "T0-R2-OFF left `docs/PROJECT-STATE.md` as a dated snapshot; this card only says so in the file. Every earlier `REVIEW.md` commit changed a rule and bumped the version. This one changes no rule, and the review prompt's sha256 records the exact text, so the 15-card check keeps one label."
---

# T0-CARD-SHORT

## Deliverable
The R1 comments in both templates, the R2 lesson, the R3 and R5 text, and this sentence in both `REVIEW.md` copies:

> Applies to every PR. The agent that wrote the code cannot approve it. Where the repository's branch rules require a human approval, a code owner gives it, informed by these findings.

## Why
Cards for changes under 30 src lines have a median of 769 words, and the short half passed R3 first time about as often as the long half (73% and 78%). 312 of 1,499 acceptance items pin doc text, `tests/surface` is 33% of test lines, and 33 of 483 R3 findings sit there. Lesson T1-OPUS55-MODELS asks for those tests, and it came from an R2 angle this repository no longer runs.

`REVIEW.md` says a human approves through branch protection. On this repository all 155 merged PRs checked have no review decision.

## Limits
Above 80 src lines longer cards did somewhat better, so the length rule stops at 30. The template reaches authors who open it; the lesson reaches the rest at PREPARE.
