
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
- Deadlines (3h/card, 12h/arc) and attempt limits persist across session changes.

### Lessons, docs and companion skills
- PREPARE reads `docs/LESSONS.md` once per card; CLOSE appends at most one
  dated line to it, only when a review block or an incident taught a rule
  the playbook did not state. Past lines are never rewritten.
- When adding, removing or renaming files, commands or flags, grep `docs/`
  and `README.md` for stale references and fix them in the same commit.
- Companion skills are advisory and called by name: `tdd` (before any
  test), `diagnose` (T0-bugfix, the card `diagnosis:` field), `grilling`
  (T1/T2 intake questions), `merge-conflicts` (base moved). The loop's
  gates decide; a skill never overrides `aidlc next`.

### Writing density (all text, at all times)
Applies to everything written in or about this repository: chat output,
PR titles and bodies, commit messages, code comments, docs, cards, skill
files, changelog entries.

No mannered prose. Mannered prose substitutes metaphor and flourish for a
direct statement: "a dial worth turning" for "a parameter worth varying",
"this point earns its keep" for "this point still matters". The phrases
exist to display the writer, not to convey the idea, and readers can tell;
they make the reader work harder so the writer can perform. They are also
imprecise: a metaphor drags in connotations the writer did not choose and
cannot control. Say what you mean. When a literal phrase is available, use
it. Remove mannered prose wherever you find it in text you are editing.
