
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
- `aidlc release start --goal <id>`     release attempt for the target set by `aidlc goal new --target`
- `aidlc monitor check --bands bands.yaml --data <file>`  control bands -> intent

### Artifact chain (each stage commits what the next consumes)
intent/<slug>.md -> specs/<slug>.md -> plans/<slug>.md -> specs/tasks/<id>.md
(cards) -> diff/PR -> review verdict -> release evidence -> incident intent.
The plan is the single source of truth; cards are its machine-checkable
projection. Findings from monitoring re-enter as intent.md.

### Verifying your work
- Test: the card's `dod_command` runs the typecheck and the card's own
  tests, all green. The full suite and the build run in CI on every
  candidate; run them locally only when the change can break them in a way
  the card's tests cannot show.
- Lint: zero warnings where a lint gate exists.
Paste the DoD output before reporting a task complete. The card machine
refuses SHIP without a DoD receipt; the Stop hook only reminds.

### Hard limits
- Never weaken, skip or delete tests to go green; if a test fails, fix the
  code, not the test.
- "Done" has exactly one definition: the machine gate passed (DoD, review,
  CI, integrated acceptance). Green cards alone do not deliver a goal.
- No `--no-verify`; no force-push, reset --hard or history rewrite on shared
  branches; never rebase or amend receipt-bound or published history.
- Stop and confirm before hard-to-reverse actions or scope changes;
  production, tag/publish and data operations require recorded authority.
- Maker/checker deadlock: after two rounds of mutual non-acceptance, stop
  for a human ruling; do not fan out reviewers or switch accounts.
- A review ruling (`aidlc review rule`) is recorded only on the owner's instruction in the session.
- Never echo or commit secrets; never fabricate endpoints, keys or results.
- Never feed a script to an interpreter on standard input (`python -`, a
  heredoc into `node`): write it to a file outside the worktree and run the
  file.
- Leave no process running: before you report, find any process you started
  that has not ended, check it is that process, stop its tree by pid (never
  by name) and name it in the report.

### Docs
When adding, removing or renaming files, commands or flags, grep `docs/` and
`README.md` for stale references and fix them in the same commit.

### Writing density
Applies to everything written in or about this repository: chat output,
PR titles and bodies, commit messages, code comments, docs, cards, skill
files, changelog entries.

No mannered prose: metaphor or flourish in place of a direct statement, such
as "a dial worth turning" for "a parameter worth varying". It makes the
reader work harder and carries connotations the writer did not choose. When
a literal phrase is available, use it. Remove mannered prose wherever you
find it in text you are editing.
