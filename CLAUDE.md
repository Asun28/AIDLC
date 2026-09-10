# AIDLC

## AI-native SDLC (aidlc)

This repository runs the AI-native SDLC loop. State lives in `.aidlc/` (main
checkout, gitignored) and is owned by the `aidlc` CLI; never edit it by hand.
Skill: `.claude/skills/aidlc-loop/SKILL.md`. Review policy: `REVIEW.md`.

### Commands
- `aidlc doctor`                       preflight: git, gh, state dir, interrupted writes
- `aidlc goal new "<request>"`         intake + routing (size, kind, target, modules)
- `aidlc next --goal <id>`             one JSON directive: the only next move
- `aidlc report --goal <id> --result <...>`  commit the outcome of that move
- `aidlc board --goal <id>`            regenerate the board view (never the truth)
- `aidlc cards validate`               card registry checks (`check-cards` compatible)
- `aidlc evals run --threshold 0.9`    continuous evals over `evals/*.json`
- `aidlc audit verify --goal <id>`     journal chain, operations, manifest, level
- `aidlc release start --goal <id> --target staging|production|package`
- `aidlc monitor check --bands bands.yaml --data <file>`  control bands -> intent

### Artifact chain (each stage commits what the next consumes)
intent/<slug>.md -> specs/<slug>.md -> plans/<slug>.md -> specs/tasks/<id>.md
(cards) -> diff/PR -> review verdict -> release evidence -> incident intent.
The plan is the single source of truth; cards are its machine-checkable
projection. Findings from monitoring re-enter as intent.md.

### Verifying your work
- Build: the project's build command must finish clean.
- Test: the card's `dod_command` and the affected checks, all green; never
  skip or delete a failing test.
- Lint: zero warnings where a lint gate exists.
Run all applicable checks before reporting any task complete, and paste the
output. If a test fails, fix the code, not the test. A hook blocks "done"
while an active card lacks a fresh DoD receipt.

### Hard limits (no exceptions)
- Never weaken, skip or delete tests to go green; that is a failure, not a fix.
- "Done" has exactly one definition: the machine gate passed (DoD, review,
  CI, integrated acceptance). Green cards alone do not deliver a goal.
- No `--no-verify`; no force-push, reset --hard or history rewrite on shared
  branches; never rebase or amend receipt-bound or published history.
- Stop and confirm before hard-to-reverse actions or scope changes;
  production, tag/publish and data operations require recorded authority.
- Maker/checker deadlock: after two rounds of mutual non-acceptance, stop
  for a human ruling; do not fan out reviewers or switch accounts.
- Never echo or commit secrets; never fabricate endpoints, keys or results.
- Deadlines (3h/card, 12h/arc) and attempt limits survive session changes.
