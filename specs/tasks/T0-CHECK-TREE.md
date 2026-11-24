---
id: T0-CHECK-TREE
title: "npm run check:tree runs the eight test files that read whole directories of the tree, and the card template of this repository names it for every dod_command"
status: todo
branch: T0-CHECK-TREE
worktree: D:\wt\AIDLC\T0-CHECK-TREE
allow_paths:
  - package.json
  - specs/tasks/_TEMPLATE.md
  - tests/surface/check-tree.test.ts
  - specs/tasks/T0-CHECK-TREE.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/check-tree.test.ts tests/surface/templates.test.ts tests/surface/card.test.ts tests/surface/edge-scope.test.ts tests/surface/budget-doc.test.ts tests/surface/bench.test.ts tests/surface/ci-shard.test.ts tests/surface/release-version.test.ts tests/infra/build-atomic.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The `check:tree` script of `package.json` shall be the command of the Text section.
  - R2. The line after the `dod_command` line of `specs/tasks/_TEMPLATE.md` shall be the comment of the Text section.
  - R3. No line of `templates/cards/_TEMPLATE.md` shall name `check:tree`.
acceptance:
  - 1. `tests/surface/check-tree.test.ts`, a new file, test 1. The `check:tree` script equals the command of the Text section, and each file it names exists. [R1] [dod arm 3]
  - 2. In test 2, the line after the `dod_command` line of `specs/tasks/_TEMPLATE.md` equals the comment of the Text section, and `templates/cards/_TEMPLATE.md` does not hold `check:tree`. [R2] [R3] [dod arm 3]
  - 3. `npm run check:tree` exits 0 on the candidate. [R1] [dod arm 2]
  - 4. The other test files of the dod_command, which read `package.json` or a card template, pass with no line changed, and the typecheck is clean. [dod arm 1] [dod arm 3]
depends_on: []
budget: 40
tdd: true
sweep: "On main at 6bdd4abd. `git grep -F check:tree` finds nothing. The tests that read the repository's own package.json are build-atomic, bench, ci-shard and release-version; the tests that read a card template of the tree are templates, card, edge-scope, budget-doc and init (init reads the installed copy only). The change of the Text section was tried in a clone: the two new tests fail with ERR_ASSERTION without it and pass with it, the typecheck is clean, and all of tests/surface passes (1,311 tests, 0 failures). The new file sorts after tests/infra and tests/scenarios, so it moves no timing-sensitive test of those directories to another CI shard."
forbid:
  - weakening or skipping a test to go green
non_goals:
  - "a new gate, a `cards validate` finding or a check that a card's dod_command holds the script"
  - "the planner agents, the installed card template and `CLAUDE.md`: no downstream repository has these eight test files"
  - "a test that finds a new whole-tree test and asks for it in the script; a card that adds one edits the list"
  - "the full suite before R3, and tests that pin one message or document (`pre-review`, `t0-flow`, `op-intent-dup`, `manifest-lock`)"
  - "a changelog fragment: no behaviour of the package changes"
hygiene: "RED: the new test file alone on the base, where both tests fail on assertions. The script adds 3.4 s to each DoD run on this machine, and the same to each mutant of `aidlc card mutants`, which runs the dod_command per mutant; a mutant that a whole-tree test kills is then not listed as a survivor, and that report is advisory."
doc_sync: none
---

# T0-CHECK-TREE

The owner asked for this card in session on 2026-11-24, after the backtest below.

## Why
A test that reads a whole directory can fail on any card, and few cards run it. In the registered `dod_command` of the 263 cards that ran since 2026-11-01, `test-temp` is named by 11, `module-map` by 7 and `parse-guard` by 7.

Backtest of 2026-11-24 over the failed pull request CI runs that GitHub lists since 2026-09-14 (25 cards):

| Cause | Cards |
|---|---|
| a test outside the card's DoD, not a flake | 12 |
| a test inside the card's DoD | 8 |
| a test outside the card's DoD, read as a flake from its log | 4 |
| no test file (the `bench` job) | 1 |

The eight files ran on the failing commits of the 12 in a clone. They failed on the same test file as CI for 7 (T0-SHIP-THROW-SLOT-2, T1-REVIEW-BENCH-EXPORT-2, T0-EVAL-CHECKOUT-BUSY, T0-ENV-CASE, T1-TEST-AUDIT-LIST-2, T0-DOD-VENV, T0-PREFETCH-TIMEOUT) and passed on the other 5 and on 10 merged commits, in 1.4 to 4.5 s each. A commit has only those of the eight that existed then.

A warning for each test that names a file of `allow_paths` was tried on the same cards and dropped: it warned on 394 of 429 cards, with a median of 40 tests per card.

Limits: the eight were chosen after the failures were read, so 7 of 12 is likely higher than the share on new cards. A failed run that was rerun to green is not in the data.

## Text
The script, after `check` in `package.json`:

```
"check:tree": "node --test tests/core/parse-guard.test.ts tests/infra/update-json.test.ts tests/surface/layers.test.ts tests/surface/mirror.test.ts tests/surface/module-map.test.ts tests/surface/prose.test.ts tests/surface/test-audit.test.ts tests/surface/test-temp.test.ts",
```

The line after `dod_command` in `specs/tasks/_TEMPLATE.md`:

```
# in this repository the dod_command runs `npm run check:tree` after the typecheck: the tests that read whole directories of the tree
```

## Keep rule
Over the next 200 cards that run after the merge, at most 1 card has a CI failure in one of the eight files. The rate before was 7 in 263 cards, which is 5.3 in 200. Above 1, the owner decides whether the script stays.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/check-tree.test.ts tests/surface/templates.test.ts tests/surface/card.test.ts tests/surface/edge-scope.test.ts tests/surface/budget-doc.test.ts tests/surface/bench.test.ts tests/surface/ci-shard.test.ts tests/surface/release-version.test.ts tests/infra/build-atomic.test.ts
```
- Expected exit code: 0
- Assertion: the two new tests and the eight whole-tree files pass, the other test files pass with no line changed, and the typecheck is clean.
