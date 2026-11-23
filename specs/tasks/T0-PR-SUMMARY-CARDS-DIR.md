---
id: T0-PR-SUMMARY-CARDS-DIR
title: "The GitHub ship path reads the PR summary from the configured cardsDir and names that path in the fixed line and the Card: line"
status: todo
branch: T0-PR-SUMMARY-CARDS-DIR
worktree: D:\wt\AIDLC\T0-PR-SUMMARY-CARDS-DIR
allow_paths:
  - src/delivery/github-ship.ts
  - src/loop/card-runner.ts
  - tests/infra/pr-summary.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-PR-SUMMARY-CARDS-DIR.md
  - specs/tasks/T0-PR-SUMMARY-CARDS-DIR.md
dod_command: npm run typecheck && node --test tests/infra/pr-summary.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The card path for a cards directory `d` and a card id `c` is `<d>/<c>.md`, with `d` as given. `prBody(cardText, cardId, reviewed, cardsDir)`, exported from `src/delivery/github-ship.ts`, shall return what it returns on main at fcc91cd8 with every `specs/tasks/<cardId>.md` in the fixed line and in the `Card:` line replaced by the card path for `cardsDir`, where `cardsDir` undefined (or left out) is `specs/tasks`.
  - R2. `GitHubShipOptions` shall have an optional `cardsDir` field, and WHEN a remote ship is about to run `gh pr create`, `GitHubShipPath.ship` shall read the card file at `path.join(<worktree>, cardsDir, '<cardId>.md')` and pass that `cardsDir` to `prBody`, a `cardsDir` that is undefined being `specs/tasks`.
  - R3. `shipPathFor` in `src/loop/card-runner.ts` shall pass `config.cardsDir` as `cardsDir` to the `GitHubShipPath` it makes.
  - R4. Every other output, call, argument and outcome of a ship shall be what it is on main at fcc91cd8.
  - R5. `docs/OPERATIONS.md` (Ship gates, Pull request text) and the `GitHubShipPath` item of `docs/ARCHITECTURE.md` shall name `<cardsDir>/<card>.md` as the file the ship reads and the path the two lines name, the sentence that the ship reads `specs/tasks/<card>.md` whatever `cardsDir` is shall be gone, and `changelog.d/T0-PR-SUMMARY-CARDS-DIR.md` shall hold one entry.
acceptance:
  - 1. `tests/infra/pr-summary.test.ts`, new describe. With `cardsDir` `docs/cards`, `prBody` deep-equals `{ body }` with the summary, the rule and `Card: docs/cards/T1-A.md. Formal review: pass.` (and `... no pass recorded for this commit.` for `reviewed` false), and for an undefined text `{ body: 'Closed loop: worktree + TDD + independent review. DoD in docs/cards/T1-A.md.', reason: 'no card file' }`; with `cardsDir` passed as undefined each result equals the three-argument call, which names `specs/tasks/T1-A.md`. [R1] [dod arm 2]
  - 2. Same describe, the ship. A `GitHubShipPath` with `cardsDir` `docs/cards` whose worktree holds `docs/cards/T1-A.md` with a valid summary and a pass verdict for the head ends `merged`; `gh pr create` runs once with the `--body` that ends `Card: docs/cards/T1-A.md. Formal review: pass.`, and the output holds `PR body: the PR summary of the card`. The same ship with the card file only at `specs/tasks/T1-A.md` sends the fixed line that names `docs/cards/T1-A.md` and writes `PR body: the fixed line (no card file)`. A ship with no `cardsDir` option and the file at `specs/tasks/T1-A.md` sends the summary body that names `specs/tasks/T1-A.md`. [R2] [R4] [dod arm 2]
  - 3. Same describe, the wiring. `shipPathFor` with a config whose `shipPath` is `github`, `repository` is `o/r` and `cardsDir` is `docs/cards` returns a `GitHubShipPath` whose `options.cardsDir` is `docs/cards`; with `cardsDir` left out of the config it is `specs/tasks`. [R3] [dod arm 2]
  - 4. The existing tests of `pr-summary.test.ts`, `github-ship.test.ts`, `github-ship-merge-refused.test.ts` and `templates.test.ts` pass unchanged, and the typecheck reports no error. [R4] [dod arm 1] [dod arm 2]
  - 5. `changelog.d/T0-PR-SUMMARY-CARDS-DIR.md` holds one entry (`tests/surface/changelog-fragments.test.ts`), and the two documents hold what R5 assigns to them (reviewer-verified against the diff). [R5] [dod arm 2]
depends_on: []
budget: 120
tdd: true
diagnosis:
  root_cause: "`GitHubShipPath.ship` builds the card file path from the literal segments `specs` and `tasks` (src/delivery/github-ship.ts:394), and `prBody` writes `specs/tasks/` into both lines (lines 244 and 260); the ship options carry no cards directory, so the configured `cardsDir` (src/config.ts:120) never reaches the path."
  same_class: "`git grep -n specs/tasks -- src` on fcc91cd8: in src/delivery/github-ship.ts the two `prBody` lines and the `See specs/tasks/<id>.md` line of the ship's commit message (line 323). The commit message is left as a non-goal. src/loop/card-runner.ts:3808 already joins `config.cardsDir`."
sweep: "On main at fcc91cd8. `git grep -n 'new GitHubShipPath' -- src` finds shipPathFor alone (src/loop/card-runner.ts:269). `git grep -n 'specs/tasks/T1-A\\|DoD in specs' -- tests` finds only tests/infra/pr-summary.test.ts, whose constants stay valid since the default is `specs/tasks`. tests/surface/templates.test.ts:107 pins one sentence of the ARCHITECTURE GitHubShipPath item, which this card keeps."
forbid:
  - a new subprocess call or a new source module
  - weakening or skipping a test to go green
non_goals:
  - the commit message `See specs/tasks/<id>.md` the ship writes when it commits, which keeps its text
  - normalising the spelling of `cardsDir` (a trailing slash, a backslash, a `./` prefix or an absolute path) in the two lines; it is written as configured, and the file is read with `path.join`
  - an empty `cardsDir`, which the config schema refuses; a direct construction with `''` is not tested
  - the text of a pull request that already exists (issue 446)
---

# T0-PR-SUMMARY-CARDS-DIR

From issue 445.

## Deliverable
In a repository whose `cardsDir` is not `specs/tasks`, the GitHub ship path reads
the `## PR summary` section from `<cardsDir>/<card>.md` in the worktree, and the
fixed line and the `Card:` line name that path.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/pr-summary.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, the existing ship and template tests pass unchanged, the typecheck is clean and the changelog fragment is well formed.
